-- ========================================
-- 家庭记账 · MCP 激活专用 OTP(Resend 通道,绕开 Supabase SMTP 限流)
-- 日期: 2026-09-02
--
-- 设计: 不用 Supabase Auth,激活页走 Vercel API + Resend 直接发邮件
--       一次调用 exchange_activation_for_mcp_token(email, code, device_name)
--       直接返 mcp_token,免去 access_token 中间层
--
-- 流程(简化版):
--   1. 前端 POST /api/send-otp { email }
--      → 调 issue_activation_code(email) 拿 6 位 code
--      → Vercel API 调 Resend 发邮件
--   2. 前端 POST /api/exchange { email, code, device_name }
--      → 调 exchange_activation_for_mcp_token(email, code, device_name)
--      → 验 OTP + 创建设备 + 返 mcp_token
--   3. 用户复制 mcp_token,到终端跑 home-ledger-mcp login
-- ========================================

-- ===========================
-- 1. mcp_activation_codes
-- ===========================
create table if not exists public.mcp_activation_codes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  email           text not null,
  code            text not null,                 -- 6 位数字
  failed_attempts int not null default 0,        -- 失败计数
  consumed_at     timestamptz,
  expires_at      timestamptz not null,          -- 5 分钟
  created_at      timestamptz not null default now()
);

create index if not exists idx_mcp_activation_codes_email_time
  on public.mcp_activation_codes(email, created_at desc);

-- RLS:anon/authenticated 都不直读,全部走 SECURITY DEFINER RPC
alter table public.mcp_activation_codes enable row level security;

-- ===========================
-- 2. issue_activation_code(p_email)
--    返: 6 位 code + 过期时间 + user_id
--    限流: 同邮箱 60 秒内只能申请 1 次
-- ========================================
drop function if exists public.issue_activation_code(text);
create function public.issue_activation_code(p_email text)
returns table (rc_code text, rc_expires_at timestamptz, rc_user_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_code text;
  v_expires_at timestamptz;
begin
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception '邮箱未注册' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.mcp_activation_codes
    where email = p_email
      and created_at > now() - interval '60 seconds'
      and consumed_at is null
  ) then
    raise exception '请求过于频繁,请稍后再试' using errcode = '23514';
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  v_expires_at := now() + interval '5 minutes';

  insert into public.mcp_activation_codes (user_id, email, code, expires_at)
  values (v_user_id, p_email, v_code, v_expires_at);

  return query select v_code, v_expires_at, v_user_id;
end;
$$;

grant execute on function public.issue_activation_code(text) to anon, authenticated;

-- ===========================
-- 3. exchange_activation_for_mcp_token(p_email, p_code, p_device_name)
--    一次性: 验 OTP + 创建设备 + 返 mcp_token
--    5 次失败后强制 expire
-- ========================================
drop function if exists public.exchange_activation_for_mcp_token(text, text, text);
create function public.exchange_activation_for_mcp_token(
  p_email text,
  p_code text,
  p_device_name text
)
returns table (rc_mcp_token text, rc_expires_at timestamptz, rc_device_id uuid, rc_user_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_record record;
  v_mcp_token text;
  v_mcp_expires timestamptz;
  v_device_id uuid;
  v_active_devices int;
begin
  -- 1. 取 user
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception '邮箱未注册' using errcode = 'P0002';
  end if;

  -- 2. device_name 校验
  if p_device_name is null or length(trim(p_device_name)) = 0 or length(p_device_name) > 100 then
    raise exception '设备名不合法(1-100 字符)' using errcode = '22023';
  end if;

  -- 3. 找最新一条未消费且未过期的 code
  select * into v_record
  from public.mcp_activation_codes
  where user_id = v_user_id
    and email = p_email
    and code = p_code
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_record.id is null then
    -- 失败计数
    update public.mcp_activation_codes
    set failed_attempts = coalesce(failed_attempts, 0) + 1,
        expires_at = case
          when coalesce(failed_attempts, 0) + 1 >= 5
            then now() - interval '1 second'
          else expires_at
        end
    where id = (
      select id from public.mcp_activation_codes
      where user_id = v_user_id
        and email = p_email
        and consumed_at is null
        and expires_at > now()
      order by created_at desc
      limit 1
    );
    raise exception '验证码错误或已过期' using errcode = 'P0002';
  end if;

  -- 4. 标记已消费
  update public.mcp_activation_codes
  set consumed_at = now()
  where id = v_record.id;

  -- 5. 设备数限制
  select count(*) into v_active_devices
  from public.mcp_device_tokens
  where user_id = v_user_id
    and revoked_at is null
    and expires_at > now();
  if v_active_devices >= 5 then
    raise exception '设备数已达上限(5 台),请先吊销旧设备' using errcode = '23514';
  end if;

  -- 6. 创建设备 + 生成 mcp_token
  v_mcp_token := encode(gen_random_bytes(32), 'hex');
  v_mcp_expires := now() + interval '30 days';

  insert into public.mcp_device_tokens (user_id, device_name, token_hash, expires_at)
  values (v_user_id, trim(p_device_name), crypt(v_mcp_token, gen_salt('bf')), v_mcp_expires)
  returning id into v_device_id;

  -- 7. 写审计
  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user_id, v_device_id, 'activation', 'issue_mcp_token_via_otp',
          jsonb_build_object('device_name', p_device_name, 'via', 'resend_otp'),
          'ok');

  return query select v_mcp_token, v_mcp_expires, v_device_id, v_user_id;
end;
$$;

grant execute on function public.exchange_activation_for_mcp_token(text, text, text) to anon, authenticated;

-- ===========================
-- 4. 验证
-- =======================================
do $$
declare
  v_table_count int;
  v_rpc_count int;
begin
  select count(*) into v_table_count
  from information_schema.tables
  where table_schema = 'public' and table_name = 'mcp_activation_codes';
  raise notice 'mcp_activation_codes 表数量: % (期望 1)', v_table_count;

  select count(*) into v_rpc_count
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('issue_activation_code','exchange_activation_for_mcp_token');
  raise notice 'MCP OTP 相关 RPC 数量: % (期望 2)', v_rpc_count;
end $$;

NOTIFY pgrst, 'reload schema';
