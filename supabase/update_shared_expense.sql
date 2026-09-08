-- ===========================
-- v2026-09-07 update_shared_expense(p_group_id, ...)
--    整组 UPDATE 分摊记录(group_id 保持不变)
--
-- 背景:之前分摊记录(group_id 非 NULL)只能整组删除,不能改金额/分类/时间等。
--       现在 RPC 一次性把整组所有子记录的 amount / category / account / payer /
--       spent_at / note / tags 全部 UPDATE 掉,group_id 保持稳定。
--       优点:列表折叠(按 group_id)、统计图聚合(按 group_id)零改动,审计链 1 条更新。
--
-- 行为:
--   - p_splits NULL 或 '[]' → 按"新成员数 N"均分(N = 传入 splits 的成员数,
--     不再限定等于 v_existing;允许 N 增 N 减,新成员数由前端在 form.value.memberIds 决定)
--   - p_splits 非空(数组 [{member_id, amount}]) → 校验合计 ≈ p_total_amount,
--     然后按 member_id 操作:
--       · 集合相交成员 → UPDATE amount + 其它字段
--       · 现存但不在 splits → 软删(deleted_at = now())
--       · splits 有但不存在 → INSERT 新子记录(同 group_id,继承 category/account/payer/spent_at/note/tags)
--   - 成员数变化(增/减)→ 不再 raise,正常处理;group_id 保持稳定
--
-- 不做的事:
--   - 改 group_id 本身 → 保持稳定是设计意图
--     (唯一例外:减员到只剩 1 人时清空 group_id 退化为普通单条,见 7d)
--
-- 权限:auth.uid() 取 user(不是 MCP token),RLS 仍生效。
--       配套 RLS 放宽(见 update_shared_expense_rls.sql)允许同家庭成员互改。
-- ===========================

drop function if exists public.update_shared_expense(
  uuid, numeric, uuid, uuid, uuid, timestamptz, text, text[], jsonb
);

create function public.update_shared_expense(
  p_group_id uuid,
  p_total_amount numeric,
  p_category_id uuid,
  p_account_id uuid,
  p_payer_id uuid,
  p_spent_at timestamptz,
  p_note text,
  p_tags text[],
  p_splits jsonb default null
)
returns table (expense_id uuid, member_id uuid, amount numeric)
language plpgsql
security invoker
set search_path = public, auth
set timezone = 'Asia/Shanghai'
as $$
declare
  v_user uuid;
  v_family_id uuid;
  v_n int;
  v_idx int;
  v_per numeric;
  v_splits jsonb := '[]'::jsonb;
  v_split_member uuid;
  v_split_amt numeric;
  v_existing int;
  v_existing_members uuid[];
  v_split_members uuid[];
  v_sum numeric := 0;
  v_clean text[] := '{}';
  v_t text;
  -- v2026-09-08 7d 清 group_id 前快照剩余子记录 id,返回按 id 匹配
  v_return_ids uuid[];
begin
  -- 0. 规范化 tags
  if p_tags is not null then
    foreach v_t in array p_tags loop
      v_t := btrim(v_t);
      v_t := regexp_replace(v_t, '^#+', '', 'g');
      v_t := btrim(v_t);
      if v_t is not null and char_length(v_t) between 1 and 32 then
        v_clean := array_append(v_clean, v_t);
      end if;
    end loop;
  end if;

  -- 1. 当前用户 + 家庭
  v_user := auth.uid();
  if v_user is null then
    raise exception '未登录' using errcode = '23514';
  end if;
  select family_id into v_family_id from public.profiles where id = v_user;
  if v_family_id is null then
    raise exception '当前用户未加入任何家庭' using errcode = '23514';
  end if;

  -- 2. 金额校验
  if p_total_amount is null or p_total_amount <= 0 or p_total_amount > 10000000 then
    raise exception '金额必须 > 0 且 <= 10000000' using errcode = '22023';
  end if;

  -- 3. 拉整组子记录(必须在同家庭、未删除)
  -- ⚠️ RETURNS TABLE 的 OUT 参数 member_id 会跟 expenses.member_id 撞名,
  --     SELECT 里所有列引用必须带表别名,否则报 "column reference is ambiguous"。
  select count(*), array_agg(e.member_id order by e.member_id)
    into v_existing, v_existing_members
  from public.expenses e
  where e.group_id = p_group_id
    and e.family_id = v_family_id
    and e.deleted_at is null;

  if v_existing = 0 then
    raise exception '未找到该分摊组,可能已被删除' using errcode = '23514';
  end if;

  v_n := v_existing;

  -- 4. 校验 category / account / payer 同家庭
  if p_category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = p_category_id and (c.family_id = v_family_id or c.family_id is null)
  ) then
    raise exception 'category_id 不存在或不属于当前家庭' using errcode = '23514';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.payment_accounts pa
    where pa.id = p_account_id and pa.family_id = v_family_id
  ) then
    raise exception 'account_id 不存在或不属于当前家庭' using errcode = '23514';
  end if;
  if p_payer_id is not null and not exists (
    select 1 from public.family_members fm
    where fm.id = p_payer_id and fm.family_id = v_family_id
  ) then
    raise exception 'payer_id 不存在或不属于当前家庭' using errcode = '23514';
  end if;

  -- 4.5 兼容字符串形式的 p_splits(旧前端 JSON.stringify 后传的是 jsonb 字符串标量):
  --     解出内层文本再转 jsonb,避免被第 5 步判成"非数组"而走兜底分支,
  --     导致成员增/减不生效(7a 软删 / 7c INSERT 全部跳过)。
  if p_splits is not null and jsonb_typeof(p_splits) = 'string' then
    p_splits := (p_splits #>> '{}')::jsonb;
  end if;

  -- 5. 决定 splits
  --   p_splits 为空 → 按"前端想留下的成员数"均分;
  --   注意:这里 v_n 不能用 v_existing(原 N),否则增/减员场景会算错。
  --   改成:从 p_splits 元素个数取 N;p_splits 为空时取 v_existing 兜底。
  if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    v_n := v_existing;
    v_per := round(p_total_amount / v_n, 2);
    for v_idx in 1..v_n loop
      v_splits := v_splits || jsonb_build_array(
        jsonb_build_object(
          'member_id', v_existing_members[v_idx],
          'amount', case when v_idx = v_n
                       then round(p_total_amount - v_per * (v_n - 1), 2)
                       else v_per end
        )
      );
    end loop;
  else
    v_splits := p_splits;
    v_n := jsonb_array_length(v_splits);
  end if;

  -- 6. 校验 splits 合计 ≈ 总金额(成员集合不再要求 == v_existing,
  --    增/减员都会被允许,差集成员后续被软删/新增 INSERT)
  select array_agg((s->>'member_id')::uuid order by (s->>'member_id')::uuid),
         sum((s->>'amount')::numeric)
    into v_split_members, v_sum
  from jsonb_array_elements(v_splits) s;

  if abs(v_sum - p_total_amount) > 0.01 then
    raise exception 'splits 合计 % 与总金额 % 不一致', v_sum, p_total_amount using errcode = '22023';
  end if;

  -- 7. 成员集合三段处理(保留 group_id 稳定):
  --    7a) 软删"已离职"成员:v_existing \ v_split_members 的子记录打 deleted_at
  --    7b) UPDATE 留任成员:amount / category / account / payer / spent_at / note / tags
  --    7c) INSERT 新增成员:同 group_id,继承 family/creator/category/account/payer/spent_at/note/tags
  --
  -- ⚠️ 全部走 EXECUTE 动态 SQL:RETURNS TABLE 的 OUT 参数 member_id / amount
  --    跟 expenses 表列同名,静态 SQL 会被 PL/pgSQL 解析器判 ambiguous。
  --    字符串里的裸列名只走 Postgres 普通 SQL 解析,看不到 PL/pgSQL 变量,无歧义。

  -- 7a) 软删减员
  execute
    'update public.expenses
        set deleted_at = now()
      where group_id = $1
        and family_id = $2
        and deleted_at is null
        and not (member_id = any($3::uuid[]))'
  using p_group_id, v_family_id, v_split_members;

  -- 7b) UPDATE 留任成员
  for v_idx in 1..jsonb_array_length(v_splits) loop
    v_split_member := (v_splits->(v_idx-1)->>'member_id')::uuid;
    v_split_amt := (v_splits->(v_idx-1)->>'amount')::numeric;
    execute
      'update public.expenses
         set amount = $1,
             category_id = $2,
             account_id = $3,
             payer_id = $4,
             spent_at = $5,
             note = $6,
             tags = $7
       where group_id = $8
         and member_id = $9
         and deleted_at is null'
    using v_split_amt,
          p_category_id,
          p_account_id,
          p_payer_id,
          p_spent_at,
          p_note,
          v_clean,
          p_group_id,
          v_split_member;
  end loop;

  -- 7c) INSERT 新增成员(差集 = v_split_members \ v_existing_members)
  --    用 array operation 计算差集,逐个 INSERT
  --    创作者用当前用户(不是老 creator),跟 addShared 保持一致
  for v_split_member, v_split_amt in
    select (s->>'member_id')::uuid,
           (s->>'amount')::numeric
      from jsonb_array_elements(v_splits) s
     where not ((s->>'member_id')::uuid = any(v_existing_members))
  loop
    execute
      'insert into public.expenses
         (family_id, creator_id, member_id, payer_id,
          category_id, account_id, amount, spent_at, note, group_id, tags)
       values
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)'
    using v_family_id,
          v_user,
          v_split_member,
          p_payer_id,
          p_category_id,
          p_account_id,
          v_split_amt,
          p_spent_at,
          p_note,
          p_group_id,
          v_clean;
  end loop;

  -- 8. 快照剩余子记录 id(7d 可能清掉 group_id,返回不能再按 group_id 匹配)
  select array_agg(e.id) into v_return_ids
  from public.expenses e
  where e.group_id = p_group_id and e.deleted_at is null;

  -- 7d) 减员到只剩 1 人 → 清空 group_id,退化为普通单条
  --     与"新增单条记账"保持一致:列表不再折叠、不显示"分摊 1 份"徽章,
  --     后续编辑走单条路径;再改回多人时前端走"删原 + addShared"
  --     分支重新生成 group_id,行为闭环。
  --     (单条记录多选成员转分摊本来就走删+增,不受影响)
  if jsonb_array_length(v_splits) = 1 then
    execute
      'update public.expenses
          set group_id = null
        where group_id = $1
          and deleted_at is null'
    using p_group_id;
  end if;

  -- 9. 返回更新后的整组(按快照 id,兼容 7d 已清 group_id 的情况)
  -- 注意:SELECT 列名不能与 returns table 的 OUT 参数同名(member_id/amount),
  --     否则 Postgres 报 "column reference is ambiguous"。
  --     显式 AS 成 _out_* 前缀即可,Postgres 按位置把结果填进 OUT 参数。
  return query
    select e.id as expense_id,
           e.member_id as _out_member_id,
           e.amount as _out_amount
    from public.expenses e
    where e.id = any(v_return_ids)
    order by e.member_id;
end;
$$;

-- 授权给 authenticated(anon 调不动,需要 user session)
grant execute on function public.update_shared_expense(
  uuid, numeric, uuid, uuid, uuid, timestamptz, text, text[], jsonb
) to authenticated;

-- ===========================
-- v2026-09-08 一次性存量清理:把已经是"1 人组"的分摊组退化为普通单条
-- (历史 bug:多人分摊改 1 人后 group_id 残留,列表显示"分摊 1 份")
-- 幂等:清理后不存在 1 人组,重复跑无副作用
-- ===========================
update public.expenses
   set group_id = null
 where group_id is not null
   and deleted_at is null
   and group_id in (
     select group_id
       from public.expenses
      where group_id is not null
        and deleted_at is null
      group by group_id
     having count(*) = 1
   );

NOTIFY pgrst, 'reload schema';
