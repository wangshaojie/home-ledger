-- ========================================
-- 家庭记账 · MCP 激活 - 拆 verify + create-device 两个 RPC
-- 日期: 2026-09-02
-- 目的: 之前 exchange_activation_for_mcp_token 一步搞定
--       现在拆成两步:verify(验码) + create_device(创建设备)
--       前端体验更清晰(输完 OTP 看到"✓ 验证通过"再输设备名)
--
-- 流程:
--   1. POST /api/send-otp { email }
--      → issue_activation_code(email) 拿 code → Resend 发邮件
--   2. POST /api/verify-otp { email, code }
--      → verify_activation_code(email, code) 验码,返 user_id
--      → 前端暂存 user_id
--   3. POST /api/create-device { user_id, device_name }
--      → issue_mcp_token_by_user(user_id, device_name) 创建设备
--      → 返 mcp_token + device_id
-- ========================================

-- 0. 启用 pgcrypto(gen_random_bytes + crypt 依赖)
-- Supabase 默认装在 extensions schema,必须 SET SCHEMA public 才能在 public 下调用
create extension if not exists pgcrypto;
alter extension pgcrypto set schema public;

-- 1. verify_activation_code(p_email, p_code) - 验 OTP,返 user_id
--    不消费 code(create-device 时再消费,允许 verify 后用户取消)
drop function if exists public.verify_activation_code(text, text);
create function public.verify_activation_code(p_email text, p_code text)
returns table (rc_user_id uuid, rc_email text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_record record;
begin
  -- 找 user
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception '邮箱未注册' using errcode = 'P0002';
  end if;

  -- 找最新一条未消费且未过期的 code
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

  return query select v_user_id, p_email;
end;
$$;

grant execute on function public.verify_activation_code(text, text) to anon, authenticated;

-- 2. issue_mcp_token_by_user(p_user_id, p_email, p_code, p_device_name)
--    在 verify_activation_code 通过后调用
--    二次校验 user_id + email + code 仍有效(防 verify 后用户长时间离开,code 过期)
--    创建设备,写审计
drop function if exists public.issue_mcp_token_by_user(uuid, text, text, text);
create function public.issue_mcp_token_by_user(
  p_user_id uuid,
  p_email text,
  p_code text,
  p_device_name text
)
returns table (rc_mcp_token text, rc_expires_at timestamptz, rc_device_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_record record;
  v_mcp_token text;
  v_mcp_expires timestamptz;
  v_device_id uuid;
  v_active_devices int;
begin
  -- 1. 二次校验 code 仍有效
  select * into v_record
  from public.mcp_activation_codes
  where user_id = p_user_id
    and email = p_email
    and code = p_code
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_record.id is null then
    raise exception '验证码已过期,请重新申请' using errcode = 'P0002';
  end if;

  -- 2. 标记已消费
  update public.mcp_activation_codes
  set consumed_at = now()
  where id = v_record.id;

  -- 3. 设备数限制
  select count(*) into v_active_devices
  from public.mcp_device_tokens
  where user_id = p_user_id
    and revoked_at is null
    and expires_at > now();
  if v_active_devices >= 5 then
    raise exception '设备数已达上限(5 台),请先吊销旧设备' using errcode = '23514';
  end if;

  -- 4. 创建设备
  v_mcp_token := encode(gen_random_bytes(32), 'hex');
  v_mcp_expires := now() + interval '30 days';

  insert into public.mcp_device_tokens (user_id, device_name, token_hash, expires_at)
  values (p_user_id, trim(p_device_name), crypt(v_mcp_token, gen_salt('bf')), v_mcp_expires)
  returning id into v_device_id;

  -- 5. 审计
  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (p_user_id, v_device_id, 'activation', 'issue_mcp_token_via_otp',
          jsonb_build_object('device_name', p_device_name, 'via', 'resend_otp'),
          'ok');

  return query select v_mcp_token, v_mcp_expires, v_device_id;
end;
$$;

grant execute on function public.issue_mcp_token_by_user(uuid, text, text, text) to anon, authenticated;

-- 3. 验证
do $$
declare
  v_rpc_count int;
begin
  select count(*) into v_rpc_count
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('issue_activation_code','verify_activation_code','issue_mcp_token_by_user');
  raise notice 'MCP OTP 相关 RPC 数量: % (期望 3)', v_rpc_count;
end $$;

NOTIFY pgrst, 'reload schema';
