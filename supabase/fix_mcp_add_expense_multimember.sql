-- ========================================
-- mcp_add_expense v5: 消费成员支持多选(默认 1 人=爸爸,多人均分拆条共享 group_id)
--   同时新增 mcp_list_members(家庭消费成员清单,AI 记账前取 member_id)
-- 保留 v4 默认:分类=餐饮 / 账户=微信支付 / 付款人=爸爸 / 时间=发任务时刻(北京)
-- ========================================

-- ---------- 1. 重建 mcp_add_expense(8 参版) ----------
-- 兼容旧版:先删 7 参旧版,再删 8 参旧版(防重载残留)
drop function if exists public.mcp_add_expense(text, numeric, text, uuid, uuid, date, text);
drop function if exists public.mcp_add_expense(text, numeric, text, uuid, uuid, date, text, uuid[]);
create function public.mcp_add_expense(
  p_token text,
  p_amount numeric,
  p_note text,
  p_category_id uuid,
  p_account_id uuid,
  p_spent_at date,
  p_device_fingerprint text default null,
  p_member_ids uuid[] default null
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
begin
  -- 1. 验 token
  select t.user_id, t.device_id, t.device_name
    into v_user, v_device_id, v_device_name
  from public.verify_mcp_token(p_token) t;

  -- 2. 限流
  if not public.mcp_check_rate_limit(v_user, 'add_expense') then
    insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result, error_message)
    values (v_user, v_device_id, 'mcp_add_expense', 'add_expense',
            jsonb_build_object('amount', p_amount, 'note', p_note),
            'rate_limited', '每用户每分钟最多 30 次记账');
    raise exception '请求过于频繁,请稍后再试' using errcode = '23514';
  end if;

  -- 3. 参数校验
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result, error_message)
    values (v_user, v_device_id, 'mcp_add_expense', 'add_expense',
            jsonb_build_object('amount', p_amount),
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

  -- 6. 校验 account_id 必须同家庭(null 允许)
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

  -- 7. 默认付款人:token 用户对应成员(通常爸爸);找不到取家庭第一个成员
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

  -- 7.5 消费成员列表(可多选):
  --     未指定/空 → 默认 token 用户对应成员一人
  --     指定 → 校验全部属于当前家庭并去重;多人均分拆条(最后一人补齐差额)
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

  -- 8. INSERT:单人落单条(无 group_id);多人均分拆多条共享 group_id
  if v_n = 1 then
    insert into public.expenses (family_id, creator_id, member_id, amount, note, category_id, account_id, payer_id, spent_at)
    values (v_family_id, v_user, v_member_ids[1], p_amount, p_note, p_category_id, p_account_id, v_default_payer, v_spent_at);

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
    -- 与 App equalSplits 一致:人均 round2(总额/人数),最后一人补齐差额
    v_group_id := uuid_generate_v4();
    v_per := round(p_amount / v_n, 2);
    for v_idx in 1..v_n loop
      if v_idx = v_n then
        v_amt := round(p_amount - v_per * (v_n - 1), 2);
      else
        v_amt := v_per;
      end if;
      if v_amt > 0 then
        insert into public.expenses (family_id, creator_id, member_id, amount, note, category_id, account_id, payer_id, spent_at, group_id)
        values (v_family_id, v_user, v_member_ids[v_idx], v_amt, p_note, p_category_id, p_account_id, v_default_payer, v_spent_at, v_group_id);
      end if;
    end loop;
  end if;

  -- 9. 写审计
  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user, v_device_id, 'mcp_add_expense', 'add_expense',
          jsonb_build_object('amount', p_amount, 'note', p_note,
                             'category_id', p_category_id, 'account_id', p_account_id,
                             'spent_at', v_spent_at, 'member_ids', v_member_ids,
                             'group_id', v_group_id, 'device', v_device_name,
                             'fingerprint', p_device_fingerprint),
          'ok');

  -- 10. 返回:单人 1 行;多人返回整组分摊记录
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

grant execute on function public.mcp_add_expense(text, numeric, text, uuid, uuid, date, text, uuid[]) to anon, authenticated;

-- ---------- 2. 新增 mcp_list_members ----------
drop function if exists public.mcp_list_members(text);
create function public.mcp_list_members(p_token text)
returns table (
  id uuid,
  name text,
  member_type text,
  is_me boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_device_id uuid;
  v_device_name text;
  v_family_id uuid;
begin
  select t.user_id, t.device_id, t.device_name
    into v_user, v_device_id, v_device_name
  from public.verify_mcp_token(p_token) t;

  -- 读操作限流
  if not public.mcp_check_rate_limit(v_user, 'list_members') then
    raise exception '请求过于频繁' using errcode = '23514';
  end if;

  select p.family_id into v_family_id from public.profiles p where p.id = v_user;
  if v_family_id is null then
    raise exception '当前用户未加入任何家庭' using errcode = '23514';
  end if;

  return query
  select fm.id, fm.name, fm.type,
         (fm.linked_profile_id = v_user) as is_me
  from public.family_members fm
  where fm.family_id = v_family_id
  order by fm.created_at;

  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user, v_device_id, 'mcp_list_members', 'list_members',
          jsonb_build_object('device', v_device_name),
          'ok');
end;
$$;

grant execute on function public.mcp_list_members(text) to anon, authenticated;
