-- ========================================
-- 家庭记账 · MCP 设备 Token 管理
-- 日期: 2026-09-02
-- 目的: 让 AI agent(Codex / Mavis / WorkBuddy 等)
--       通过短期 access_token 调 Supabase,而不是用 service_role
--
-- 安全模型:
--   1. MCP server 永远拿不到 service_role,只能用用户授权的 token
--   2. token 是 32 字节随机串,只存 bcrypt 哈希在 DB
--   3. token 有 scopes(写/读/管理),用户可单独吊销某台设备
--   4. 所有 MCP 写操作都进 mcp_audit_log,可追溯
--   5. 用户必须已经登录(authenticated)才能 issue token,
--      且 issue 给自己的设备(不能 issue 给别人)
--   6. 30 天自动过期 + 用户可主动 revoke
--
-- 三张表:
--   - mcp_device_tokens: 设备 + token 哈希
--   - mcp_audit_log:     所有 MCP 调用的审计日志
--
-- 四个 RPC:
--   - issue_mcp_token(device_name):            已登录用户给"自己"签发新 token
--   - verify_mcp_token(p_token):                SECURITY DEFINER,验 token 返 user_id
--   - revoke_mcp_device(p_device_id):           用户吊销自己的某台设备
--   - mcp_add_expense(...):                     写账专用 RPC(走 token,不直连表)
-- ========================================

-- ===========================
-- 0. 启用 pgcrypto(crypt/gen_random_bytes 依赖)
-- Supabase 默认把 pgcrypto 装在 extensions schema,
-- 必须 ALTER EXTENSION ... SET SCHEMA public 才能在 public 下直接调用
-- ===========================
create extension if not exists pgcrypto;
alter extension pgcrypto set schema public;

-- ===========================
-- 1. mcp_device_tokens
-- ===========================
create table if not exists public.mcp_device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_name   text not null,                  -- 用户给设备起的名(例:"我的 Mavis")
  token_hash    text not null unique,           -- crypt(token, gen_salt('bf'))
  scopes        text[] not null default array['expense:read','expense:write'],
  last_used_at  timestamptz,
  expires_at    timestamptz not null,           -- 默认 now() + 30 days
  revoked_at    timestamptz,                    -- 用户主动吊销
  created_at    timestamptz not null default now()
);

create index if not exists idx_mcp_device_tokens_user
  on public.mcp_device_tokens(user_id) where revoked_at is null;

-- RLS: 用户只能看/管自己的设备
alter table public.mcp_device_tokens enable row level security;

drop policy if exists "mcp_device_tokens: 用户看自己的设备" on public.mcp_device_tokens;
create policy "mcp_device_tokens: 用户看自己的设备"
  on public.mcp_device_tokens
  for select
  using (user_id = auth.uid());

-- update 仅用于"软吊销",必须限定 user_id = auth.uid()
drop policy if exists "mcp_device_tokens: 用户吊销自己的设备" on public.mcp_device_tokens;
create policy "mcp_device_tokens: 用户吊销自己的设备"
  on public.mcp_device_tokens
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- insert/delete 由 SECURITY DEFINER RPC 完成,不走 RLS

-- ===========================
-- 2. mcp_audit_log
-- ===========================
create table if not exists public.mcp_audit_log (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_id     uuid references public.mcp_device_tokens(id) on delete set null,
  tool_name     text not null,                  -- 调用的 MCP 工具名
  action        text not null,                  -- 动作:add_expense / list_recent / ...
  params        jsonb,                          -- 调用参数(脱敏后)
  result        text not null,                  -- 'ok' / 'rate_limited' / 'error: ...'
  error_message text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_mcp_audit_log_user_time
  on public.mcp_audit_log(user_id, created_at desc);
create index if not exists idx_mcp_audit_log_device_time
  on public.mcp_audit_log(device_id, created_at desc);

-- RLS: 用户能看自己的审计日志
alter table public.mcp_audit_log enable row level security;

drop policy if exists "mcp_audit_log: 用户看自己的日志" on public.mcp_audit_log;
create policy "mcp_audit_log: 用户看自己的日志"
  on public.mcp_audit_log
  for select
  using (user_id = auth.uid());

-- insert 由 SECURITY DEFINER RPC 完成(需要代填 user_id/device_id)

-- ===========================
-- 3. issue_mcp_token(device_name)
--    已登录用户给"自己"签发一个 30 天有效的 token
--    返回: 明文 token(只此一次返回)+ expires_at
-- ========================================
drop function if exists public.issue_mcp_token(text);
create function public.issue_mcp_token(p_device_name text)
returns table (access_token text, expires_at timestamptz, device_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_token text;
  v_hash text;
  v_exp timestamptz := now() + interval '30 days';
  v_device_id uuid;
  v_count int;
begin
  if v_user is null then
    raise exception '未登录,无法签发 MCP token' using errcode = '28000';
  end if;

  if p_device_name is null or length(trim(p_device_name)) = 0 or length(p_device_name) > 100 then
    raise exception 'device_name 不能为空且不能超过 100 字符';
  end if;

  -- 限流:每用户最多 5 台活跃设备
  select count(*) into v_count
  from public.mcp_device_tokens
  where user_id = v_user and revoked_at is null and expires_at > now();
  if v_count >= 5 then
    raise exception '每用户最多 5 台活跃设备,请先吊销旧的' using errcode = '23514';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');   -- 64 字符
  v_hash := crypt(v_token, gen_salt('bf'));

  insert into public.mcp_device_tokens(user_id, device_name, token_hash, expires_at)
  values (v_user, trim(p_device_name), v_hash, v_exp)
  returning mcp_device_tokens.id into v_device_id;

  return query select v_token, v_exp, v_device_id;
end;
$$;

revoke execute on function public.issue_mcp_token(text) from anon;
grant execute on function public.issue_mcp_token(text) to authenticated;

-- ===========================
-- 4. verify_mcp_token(p_token)
--    MCP server 每次调用前先调这个验 token
--    返 user_id + scopes + device_id
--    同时更新 last_used_at(轻量,不写 audit_log,audit_log 由具体工具 RPC 写)
-- ========================================
drop function if exists public.verify_mcp_token(text);
create function public.verify_mcp_token(p_token text)
returns table (user_id uuid, scopes text[], device_id uuid, device_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_record record;
begin
  if p_token is null or length(p_token) <> 64 then
    raise exception 'token 格式错误' using errcode = '28000';
  end if;

  select t.user_id, t.scopes, t.id as device_id, t.device_name
    into v_record
  from public.mcp_device_tokens t
  where t.token_hash = crypt(p_token, t.token_hash)
    and t.revoked_at is null
    and t.expires_at > now()
  limit 1;

  if v_record.user_id is null then
    raise exception 'token 无效、已吊销或已过期' using errcode = '28000';
  end if;

  -- 更新 last_used_at(best-effort,失败不影响)
  begin
    update public.mcp_device_tokens
    set last_used_at = now()
    where id = v_record.device_id;
  exception when others then
    null;
  end;

  return query select v_record.user_id, v_record.scopes, v_record.device_id, v_record.device_name;
end;
$$;

-- verify_mcp_token 必须同时给 anon + authenticated
-- 因为 MCP server 还没拿到 user,只能用 token 验
-- 这正是 security definer 的意义:不依赖 auth.uid(),靠 token 自身
grant execute on function public.verify_mcp_token(text) to anon, authenticated;

-- ===========================
-- 5. revoke_mcp_device(p_device_id)
--    用户吊销自己的一台设备
-- ========================================
drop function if exists public.revoke_mcp_device(uuid);
create function public.revoke_mcp_device(p_device_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_affected int;
begin
  if v_user is null then
    raise exception '未登录' using errcode = '28000';
  end if;

  update public.mcp_device_tokens
  set revoked_at = now()
  where id = p_device_id
    and user_id = v_user
    and revoked_at is null;

  get diagnostics v_affected = row_count;
  if v_affected = 0 then
    raise exception '设备不存在或已吊销' using errcode = 'P0002';
  end if;

  return '设备已吊销,该 token 立即失效';
end;
$$;

revoke execute on function public.revoke_mcp_device(uuid) from anon;
grant execute on function public.revoke_mcp_device(uuid) to authenticated;

-- ===========================
-- 6. 辅助:限流判断(每用户每分钟最多 30 次 MCP 写操作)
--    SECURITY DEFINER,可被具体工具 RPC 调用
-- ========================================
drop function if exists public.mcp_check_rate_limit(uuid, text);
create function public.mcp_check_rate_limit(p_user uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- 写操作限流
  if p_action in ('add_expense','update_expense','delete_expense') then
    select count(*) into v_count
    from public.mcp_audit_log
    where user_id = p_user
      and action = p_action
      and created_at > now() - interval '1 minute';
    return v_count < 30;
  end if;
  -- 读操作:每分钟 120 次
  select count(*) into v_count
  from public.mcp_audit_log
  where user_id = p_user
    and action = p_action
    and created_at > now() - interval '1 minute';
  return v_count < 120;
end;
$$;

grant execute on function public.mcp_check_rate_limit(uuid, text) to anon, authenticated;

-- ===========================
-- 7. mcp_add_expense(...)
--    MCP 专用记账 RPC:
--      - 必须先 verify_mcp_token,从中拿到 user_id
--      - 不接受外部传 creator_id(必须 = token 对应 user)
--      - 不接受外部传 family_id(必须 = 用户当前家庭)
--      - category_id 必须 = 用户家庭或 null(走系统默认)
--      - account_id 必须 = 用户家庭
--      - 写审计日志
--      - 限流(30/min)
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

-- mcp_add_expense 不走 auth.uid(),靠 token 自身,所以给 anon + authenticated
-- 攻击面分析:即使 anon 拿到 token 也只能操作该 user 家庭,且所有写都有审计
grant execute on function public.mcp_add_expense(text, numeric, text, uuid, uuid, date, text) to anon, authenticated;

-- ===========================
-- 8. mcp_list_recent(p_token, p_limit)
--    看最近 N 笔(用户当前家庭的所有账单)
-- ========================================
drop function if exists public.mcp_list_recent(text, int);
create function public.mcp_list_recent(p_token text, p_limit int default 10)
returns table (
  expense_id uuid,
  amount numeric,
  note text,
  category_id uuid,
  category_name text,
  account_id uuid,
  account_name text,
  spent_at date,
  creator_id uuid,
  creator_name text
)
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
  v_actual_limit int;
begin
  select t.user_id, t.device_id, t.device_name
    into v_user, v_device_id, v_device_name
  from public.verify_mcp_token(p_token) t;

  -- 限流
  if not public.mcp_check_rate_limit(v_user, 'list_recent') then
    raise exception '请求过于频繁' using errcode = '23514';
  end if;

  v_actual_limit := least(greatest(coalesce(p_limit, 10), 1), 100);

  select family_id into v_family_id from public.profiles where id = v_user;
  if v_family_id is null then
    raise exception '当前用户未加入任何家庭' using errcode = '23514';
  end if;

  return query
  select
    e.id, e.amount, e.note,
    e.category_id, c.name,
    e.account_id, pa.name,
    e.spent_at::date, e.creator_id, p.display_name
  from public.expenses e
  left join public.categories c on c.id = e.category_id
  left join public.payment_accounts pa on pa.id = e.account_id
  left join public.profiles p on p.id = e.creator_id
  where e.family_id = v_family_id
    and e.deleted_at is null
  order by e.spent_at desc, e.created_at desc
  limit v_actual_limit;

  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user, v_device_id, 'mcp_list_recent', 'list_recent',
          jsonb_build_object('limit', v_actual_limit, 'device', v_device_name),
          'ok');
end;
$$;

grant execute on function public.mcp_list_recent(text, int) to anon, authenticated;

-- ===========================
-- 9. mcp_delete_expense(p_token, p_expense_id)
--    软删(同家庭成员可删,通过 verify_mcp_token 拿到 user_id,再走 RLS)
-- ========================================
drop function if exists public.mcp_delete_expense(text, uuid);
create function public.mcp_delete_expense(p_token text, p_expense_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_device_id uuid;
  v_device_name text;
  v_family_id uuid;
  v_target_family uuid;
  v_creator uuid;
begin
  select t.user_id, t.device_id, t.device_name
    into v_user, v_device_id, v_device_name
  from public.verify_mcp_token(p_token) t;

  if not public.mcp_check_rate_limit(v_user, 'delete_expense') then
    raise exception '请求过于频繁' using errcode = '23514';
  end if;

  -- 查 expense 归属
  select family_id, creator_id into v_target_family, v_creator
  from public.expenses where id = p_expense_id and deleted_at is null;

  if v_target_family is null then
    raise exception '账单不存在或已删除' using errcode = 'P0002';
  end if;

  select family_id into v_family_id from public.profiles where id = v_user;
  if v_family_id is null or v_family_id <> v_target_family then
    insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result, error_message)
    values (v_user, v_device_id, 'mcp_delete_expense', 'delete_expense',
            jsonb_build_object('expense_id', p_expense_id),
            'error', '账单不属于当前用户的家庭');
    raise exception '无权删除该账单' using errcode = '42501';
  end if;

  -- 软删(expenses 无 deleted_by 列,只置 deleted_at)
  update public.expenses
  set deleted_at = now()
  where id = p_expense_id and deleted_at is null;

  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user, v_device_id, 'mcp_delete_expense', 'delete_expense',
          jsonb_build_object('expense_id', p_expense_id, 'creator_id', v_creator, 'device', v_device_name),
          'ok');

  return 'ok';
end;
$$;

grant execute on function public.mcp_delete_expense(text, uuid) to anon, authenticated;

-- ===========================
-- 10. 验证输出
-- ========================================
do $$
declare
  v_table_count int;
  v_rpc_count int;
begin
  select count(*) into v_table_count
  from information_schema.tables
  where table_schema = 'public' and table_name in ('mcp_device_tokens','mcp_audit_log');
  raise notice 'mcp 相关表数量: % (期望 2)', v_table_count;

  select count(*) into v_rpc_count
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('issue_mcp_token','verify_mcp_token','revoke_mcp_device',
                    'mcp_check_rate_limit','mcp_add_expense','mcp_list_recent','mcp_delete_expense');
  raise notice 'mcp 相关 RPC 数量: % (期望 7)', v_rpc_count;

  raise notice '--- 验证 grant ---';
  raise notice 'issue_mcp_token: anon 应无,authenticated 应有';
  raise notice 'verify_mcp_token: anon + authenticated 都应有';
  raise notice 'mcp_add_expense: anon + authenticated 都应有(因 SECURITY DEFINER 走 token)';
end $$;

NOTIFY pgrst, 'reload schema';
