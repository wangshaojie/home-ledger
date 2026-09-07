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
--   - p_splits NULL 或 '[]' → 按现有成员数均分(同 addShared)
--   - p_splits 非空(数组 [{member_id, amount}]) → 校验合计 ≈ p_total_amount,然后按 member_id UPDATE 每条
--   - 成员数变化 / p_splits 跟实际子记录不匹配 → raise(走前端"删+重建"分支)
--
-- 不做的事:
--   - 改 member 集合(N 变)→ 不在 RPC 范围,前端走"删整组 + addShared"分支
--   - 改 group_id 本身 → 保持稳定是设计意图
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
  select count(*), array_agg(member_id order by member_id)
    into v_existing, v_existing_members
  from public.expenses
  where group_id = p_group_id
    and family_id = v_family_id
    and deleted_at is null;

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

  -- 5. 决定 splits
  if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
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
  end if;

  -- 6. 校验 splits 成员集合 == DB 现存成员集合 + 合计 ≈ 总金额
  select array_agg((s->>'member_id')::uuid order by (s->>'member_id')::uuid),
         sum((s->>'amount')::numeric)
    into v_split_members, v_sum
  from jsonb_array_elements(v_splits) s;

  if (select array_agg(u order by u) from unnest(v_split_members) u) <>
     (select array_agg(u order by u) from unnest(v_existing_members) u) then
    raise exception 'splits 成员列表与现有子记录不匹配(成员数变化请走删+重建分支)' using errcode = '23514';
  end if;
  if abs(v_sum - p_total_amount) > 0.01 then
    raise exception 'splits 合计 % 与总金额 % 不一致', v_sum, p_total_amount using errcode = '22023';
  end if;

  -- 7. UPDATE 整组(保持 group_id 不变,RLS 仍生效)
  for v_idx in 1..jsonb_array_length(v_splits) loop
    v_split_member := (v_splits->(v_idx-1)->>'member_id')::uuid;
    v_split_amt := (v_splits->(v_idx-1)->>'amount')::numeric;
    update public.expenses
       set amount = v_split_amt,
           category_id = p_category_id,
           account_id = p_account_id,
           payer_id = p_payer_id,
           spent_at = p_spent_at,
           note = p_note,
           tags = v_clean
     where group_id = p_group_id
       and member_id = v_split_member
       and deleted_at is null;
  end loop;

  -- 8. 返回更新后的整组
  return query
    select e.id, e.member_id, e.amount
    from public.expenses e
    where e.group_id = p_group_id and e.deleted_at is null
    order by e.member_id;
end;
$$;

-- 授权给 authenticated(anon 调不动,需要 user session)
grant execute on function public.update_shared_expense(
  uuid, numeric, uuid, uuid, uuid, timestamptz, text, text[], jsonb
) to authenticated;

NOTIFY pgrst, 'reload schema';
