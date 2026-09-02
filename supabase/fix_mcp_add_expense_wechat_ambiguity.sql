-- ========================================
-- 修复: mcp_add_expense 完整重建(最终版 v2)
-- 解决的问题:
-- 1) 42702 裸列名歧义(RETURNS TABLE 的 family_id 等 OUT 列 vs 表列)
--    —— 所有 SELECT/子查询列引用加表别名
-- 2) 消费时间 = 发任务时刻(北京时间):
--    - 未指定日期 → now()(与 App 手动记账默认"当前时刻"一致,
--      前端显示真实时分,不再出现 UTC date 零点偏移导致的 08:00)
--    - 显式传 YYYY-MM-DD → 北京当日 00:00(补记某天)
--    - 函数级 set timezone = 'Asia/Shanghai',函数内 current_date/::date 按北京算
-- 3) 未指定支付账户时默认"微信支付"
-- 与基线 supabase/mcp_device.sql 中函数完全一致
-- ========================================

drop function if exists public.mcp_add_expense(text, numeric, text, uuid, uuid, date, text);
create function public.mcp_add_expense(
  p_token text,
  p_amount numeric,
  p_note text,
  p_category_id uuid,
  p_account_id uuid,
  p_spent_at date,
  p_device_fingerprint text default null
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

  -- 3.1 消费时间 = 发任务时刻(北京时间)。与 App 手动记账一致(默认当前时刻)。
  --     函数已 set timezone Asia/Shanghai,本函数内 current_date/::date 均按北京算。
  --     关键:AI agent 调用时往往自动填"今天"日期,所以"今天"等同未指定 → now()(真实时刻)
  --     只有补记历史某天(非今天)才落北京当日 00:00
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
  -- 注意:RETURNS TABLE 含 family_id 等 OUT 列,裸列名会与 PL/pgSQL 变量歧义,所有列引用必须带表别名
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

  -- 6. 校验 account_id 必须同家庭(null 允许)
  if p_account_id is not null and not exists (
    select 1 from public.payment_accounts pa
    where pa.id = p_account_id and pa.family_id = v_family_id
  ) then
    raise exception 'account_id 不存在或不属于当前家庭' using errcode = '23514';
  end if;

  -- 6.5 未指定账户时默认取"微信支付"(家庭内无同名账户则保持 NULL,不报错)
  if p_account_id is null then
    select pa.id into p_account_id
    from public.payment_accounts pa
    where pa.family_id = v_family_id and pa.name = '微信支付'
    limit 1;
  end if;

  -- 7. 找 family_member 写 payer_id(走默认)
  select fm.id into v_default_payer
  from public.family_members fm
  where fm.linked_profile_id = v_user and fm.family_id = v_family_id
  limit 1;

  -- 8. INSERT(走原 expenses RLS + 触发器,creator_id 强制为 v_user,family_id 强制为 v_family_id)
  insert into public.expenses (family_id, creator_id, member_id, amount, note, category_id, account_id, payer_id, spent_at)
  values (v_family_id, v_user, v_default_payer, p_amount, p_note, p_category_id, p_account_id, v_default_payer, v_spent_at);

  -- 查刚插入的记录(不用 returning,避免触发器上下文列歧义)
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

  -- 9. 写审计
  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user, v_device_id, 'mcp_add_expense', 'add_expense',
          jsonb_build_object('amount', p_amount, 'note', p_note,
                             'category_id', p_category_id, 'account_id', p_account_id,
                             'spent_at', v_spent_at, 'device', v_device_name,
                             'fingerprint', p_device_fingerprint),
          'ok');

  return query select v_result.id, v_result.family_id, v_result.creator_id, v_result.amount, v_result.spent_at::date;
end;
$$;

grant execute on function public.mcp_add_expense(text, numeric, text, uuid, uuid, date, text) to anon, authenticated;

-- 顺手给 mcp_list_recent 也设函数级北京时间时区:
-- 否则凌晨(北京0-8点)记账后,list_recent 输出 spent_at::date 会按 UTC 差一天
alter function public.mcp_list_recent(text, int) set timezone = 'Asia/Shanghai';
