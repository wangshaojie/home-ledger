-- ===========================
-- v2026-09-07 mcp_add_expense 加 tags 入参
--
-- 背景:App 端已支持自由标签(#旅游 / #出差 / #可报销),MCP / AI agent
--       记账时也应该能附带,否则 AI 没法把账自动归到"旅游"这种跨分类场景。
-- 改动:为 mcp_add_expense 新增第 9 个参数 p_tags text[] default '{}',
--       单人/分摊两路 INSERT 同步写 tags,审计日志也带过去。
--       注意:必须用 drop + 重建,不能只 create or replace——参数列表变了
--       旧函数定义残留会变成 orphan 仍在 GRANT 里挂着。
-- ===========================

drop function if exists public.mcp_add_expense(text, numeric, text, uuid, uuid, date, text, uuid[]);

create function public.mcp_add_expense(
  p_token text,
  p_amount numeric,
  p_note text,
  p_category_id uuid,
  p_account_id uuid,
  p_spent_at date,
  p_device_fingerprint text default null,
  p_member_ids uuid[] default null,
  -- v2026-09-07 自由标签,跨分类筛选用
  p_tags text[] default '{}'
)
returns table (expense_id uuid, family_id uuid, creator_id uuid, amount numeric, spent_at date)
language plpgsql
security definer
set search_path = public, auth
set timezone = 'Asia/Shanghai'
as $$
declare
  v_user uuid;
  v_device_id uuid;
  v_device_name text;
  v_family_id uuid;
  v_default_payer uuid;
  v_spent_at timestamptz;
  v_member_ids uuid[];
  v_n int;
  v_idx int;
  v_per numeric;
  v_amt numeric;
  v_group_id uuid;
  v_result record;
  -- 规范化后的 tag:trim、去 #、空串丢弃
  v_tags text[];
  v_tag text;
begin
  -- 0. 规范化 tags:trim + 去 # 前缀 + 去空 + 单 tag 长度上限 32
  if p_tags is not null then
    v_tags := '{}';
    for v_tag in select unnest(p_tags) loop
      v_tag := btrim(v_tag);
      v_tag := regexp_replace(v_tag, '^#+', '', 'g');
      v_tag := btrim(v_tag);
      if v_tag is not null and char_length(v_tag) between 1 and 32 then
        v_tags := array_append(v_tags, v_tag);
      end if;
    end loop;
    -- 单次记账最多 20 个
    if array_length(v_tags, 1) is not null and array_length(v_tags, 1) > 20 then
      v_tags := (select array_agg(t) from (select unnest(v_tags) t limit 20) s);
    end if;
  else
    v_tags := '{}';
  end if;

  -- 1. 验 token
  select t.user_id, t.device_id, t.device_name
    into v_user, v_device_id, v_device_name
  from public.verify_mcp_token(p_token) t;

  -- 2. 限流
  if not public.mcp_check_rate_limit(v_user, 'add_expense') then
    insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result, error_message)
    values (v_user, v_device_id, 'mcp_add_expense', 'add_expense',
            jsonb_build_object('amount', p_amount, 'note', p_note, 'tags', v_tags),
            'rate_limited', '每用户每分钟最多 30 次记账');
    raise exception '请求过于频繁,请稍后再试' using errcode = '23514';
  end if;

  -- 3. 参数校验
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result, error_message)
    values (v_user, v_device_id, 'mcp_add_expense', 'add_expense',
            jsonb_build_object('amount', p_amount, 'tags', v_tags),
            'error', '金额必须 > 0 且 <= 10000000');
    raise exception '金额必须 > 0 且 <= 10000000' using errcode = '22023';
  end if;

  -- 3.1 消费时间 = 发任务时刻(北京时间)
  if p_spent_at is null or p_spent_at = current_date then
    v_spent_at := now();
  else
    v_spent_at := p_spent_at::timestamptz;
  end if;
  if v_spent_at::date > current_date + interval '1 day' then
    raise exception 'spent_at 不能在未来' using errcode = '22023';
  end if;
  if v_spent_at::date < current_date - interval '10 years' then
    raise exception 'spent_at 不能早于 10 年前' using errcode = '22023';
  end if;

  -- 4. 取用户当前家庭
  select p.family_id into v_family_id from public.profiles p where p.id = v_user;
  if v_family_id is null then
    raise exception '当前用户未加入任何家庭,无法记账' using errcode = '23514';
  end if;

  -- 5. 校验 category_id 必须同家庭或 null(系统默认)
  if p_category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = p_category_id and (c.family_id = v_family_id or c.family_id is null)
  ) then
    raise exception 'category_id 不存在或不属于当前家庭' using errcode = '23514';
  end if;

  -- 5.5 未指定分类时默认"餐饮"
  if p_category_id is null then
    select c.id into p_category_id
    from public.categories c
    where c.family_id = v_family_id and c.name = '餐饮'
    order by c.sort_order, c.created_at
    limit 1;
  end if;

  -- 6. 校验 account_id 必须同家庭
  if p_account_id is not null and not exists (
    select 1 from public.payment_accounts pa
    where pa.id = p_account_id and pa.family_id = v_family_id
  ) then
    raise exception 'account_id 不存在或不属于当前家庭' using errcode = '23514';
  end if;

  -- 6.5 未指定账户时默认取"微信支付"
  if p_account_id is null then
    select pa.id into p_account_id
    from public.payment_accounts pa
    where pa.family_id = v_family_id and pa.name = '微信支付'
    limit 1;
  end if;

  -- 7. 默认付款人
  select fm.id into v_default_payer
  from public.family_members fm
  where fm.linked_profile_id = v_user and fm.family_id = v_family_id
  limit 1;

  if v_default_payer is null then
    select fm.id into v_default_payer
    from public.family_members fm
    where fm.family_id = v_family_id
    order by fm.created_at
    limit 1;
  end if;

  -- 7.5 消费成员列表
  if p_member_ids is null or cardinality(p_member_ids) = 0 then
    v_member_ids := array[v_default_payer];
  else
    v_member_ids := p_member_ids;
    if exists (
      select 1 from unnest(v_member_ids) mid
      where mid is null
         or not exists (
              select 1 from public.family_members fm
              where fm.id = mid and fm.family_id = v_family_id
            )
    ) then
      raise exception '存在不属于当前家庭的消费成员' using errcode = '23514';
    end if;
    select array_agg(mid) into v_member_ids
    from (
      select distinct mid from unnest(v_member_ids) mid where mid is not null
    ) t;
  end if;

  v_n := cardinality(v_member_ids);

  -- 8. INSERT:单人 1 条,多人均分拆条(共享 group_id)
  --    v2026-09-07 同步把规范化后的 v_tags 写进 tags 列
  if v_n = 1 then
    insert into public.expenses (family_id, creator_id, member_id, amount, note, category_id, account_id, payer_id, spent_at, tags)
    values (v_family_id, v_user, v_member_ids[1], p_amount, p_note, p_category_id, p_account_id, v_default_payer, v_spent_at, v_tags);

    select e.id, e.family_id, e.creator_id, e.amount, e.spent_at
      into v_result
    from public.expenses e
    where e.creator_id = v_user
      and e.family_id = v_family_id
      and e.amount = p_amount
      and e.spent_at = v_spent_at
      and e.deleted_at is null
    order by e.created_at desc
    limit 1;
  else
    v_group_id := uuid_generate_v4();
    v_per := round(p_amount / v_n, 2);
    for v_idx in 1..v_n loop
      if v_idx = v_n then
        v_amt := round(p_amount - v_per * (v_n - 1), 2);
      else
        v_amt := v_per;
      end if;
      if v_amt > 0 then
        insert into public.expenses (family_id, creator_id, member_id, amount, note, category_id, account_id, payer_id, spent_at, group_id, tags)
        values (v_family_id, v_user, v_member_ids[v_idx], v_amt, p_note, p_category_id, p_account_id, v_default_payer, v_spent_at, v_group_id, v_tags);
      end if;
    end loop;
  end if;

  -- 9. 写审计(同步带上 tags)
  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user, v_device_id, 'mcp_add_expense', 'add_expense',
          jsonb_build_object('amount', p_amount, 'note', p_note,
                             'category_id', p_category_id, 'account_id', p_account_id,
                             'spent_at', v_spent_at, 'member_ids', v_member_ids,
                             'group_id', v_group_id, 'tags', v_tags,
                             'device', v_device_name,
                             'fingerprint', p_device_fingerprint),
          'ok');

  -- 10. 返回
  if v_n = 1 then
    return query select v_result.id, v_result.family_id, v_result.creator_id, v_result.amount, v_result.spent_at::date;
  else
    return query
    select e.id, e.family_id, e.creator_id, e.amount, e.spent_at::date
    from public.expenses e
    where e.group_id = v_group_id and e.deleted_at is null
    order by e.amount desc;
  end if;
end;
$$;

-- 授权同步更新(9 参)
grant execute on function public.mcp_add_expense(text, numeric, text, uuid, uuid, date, text, uuid[], text[]) to anon, authenticated;

-- 刷 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
