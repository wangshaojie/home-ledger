-- ========================================
-- 家庭记账 · 桌面端 OTP 改密码 RPC
-- 三个 RPC：
--   1. request_password_reset(email) → 生成 6 位 OTP（仅返回 code 给前端用于发邮件，不写库后再次读）
--   2. verify_password_reset_code(email, code) → 校验 OTP + 失败计数，返回一次性 verify_token
--   3. complete_password_reset(verify_token, new_password) → 改密码 + revoke 所有 session
-- ========================================

-- 工具：生成 6 位数字
create or replace function public.gen_6_digit_code()
returns text
language plpgsql
as $$
declare
  code text;
begin
  code := lpad(floor(random() * 1000000)::text, 6, '0');
  return code;
end;
$$;

-- 1. 申请改密码 OTP（生成 + 插入 + 返回 code，前端拿到后调 Resend 发邮件）
-- ⚠️ v2026-08-25 安全加固：grant 只给 authenticated（之前给 anon 会被未登录用户调）
--    加上"邮箱必须对应当前登录用户"（auth.uid() 必须 = 该 email 对应的 user.id）
--    防止用户 A 通过调这个 RPC 把用户 B 的 OTP 触发出来
drop function if exists public.request_password_reset(text);
create function public.request_password_reset(p_email text)
returns table (rc_code text, rc_expires_at timestamptz, rc_user_id uuid)
language plpgsql
security definer
as $$
declare
  v_target_user_id uuid;
  v_generated_code text;
  v_expires_at timestamptz;
begin
  select id into v_target_user_id from auth.users where email = p_email;
  if v_target_user_id is null then
    raise exception '邮箱不存在';
  end if;

  -- 安全：必须是当前登录用户申请自己的 OTP（防止 A 帮 B 触发邮件轰炸/枚举）
  if v_target_user_id <> auth.uid() then
    raise exception '只能申请当前登录账号的改密码';
  end if;

  -- 限制：每用户 60 秒只能请求一次（防刷）
  if exists (
    select 1 from public.password_reset_codes
    where user_id = v_target_user_id
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception '请求过于频繁，请稍后再试';
  end if;

  v_generated_code := public.gen_6_digit_code();
  v_expires_at := now() + interval '5 minutes';
  insert into public.password_reset_codes (user_id, email, code, expires_at)
    values (v_target_user_id, p_email, v_generated_code, v_expires_at);

  return query select v_generated_code, v_expires_at, v_target_user_id;
end;
$$;

-- ⚠️ v2026-08-25: revoke from anon，之前同时给 anon + authenticated 是错的
revoke execute on function public.request_password_reset(text) from anon;
grant execute on function public.request_password_reset(text) to authenticated;

-- 2. 验证 OTP，返回一次性 verify_token
-- ⚠️ v2026-08-25 安全加固：
--    a. 同 request_password_reset：必须 auth.uid() = email 对应 user.id
--    b. 失败次数限流：5 次失败后该 OTP 失效（防止暴力枚举 6 位数字）
--    c. grant 只给 authenticated
drop function if exists public.verify_password_reset_code(text, text);
create function public.verify_password_reset_code(p_email text, p_code text)
returns text
language plpgsql
security definer
as $$
declare
  v_target_user_id uuid;
  v_record record;
  v_verify_token text;
  v_failed_count int;
begin
  select id into v_target_user_id from auth.users where email = p_email;
  if v_target_user_id is null then
    raise exception '邮箱不存在';
  end if;

  -- 安全：必须是为自己的邮箱校验
  if v_target_user_id <> auth.uid() then
    raise exception '只能验证当前登录账号的验证码';
  end if;

  -- 找最新一条未消费且未过期的 code
  select * into v_record
  from public.password_reset_codes
  where user_id = v_target_user_id
    and email = p_email
    and code = p_code
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_record.id is null then
    -- 失败计数：把同 email 最新一条未消费 OTP 的 failed_attempts +1
    -- 累计 5 次后强制 expire
    update public.password_reset_codes
    set failed_attempts = coalesce(failed_attempts, 0) + 1,
        expires_at = case
          when coalesce(failed_attempts, 0) + 1 >= 5
            then now() - interval '1 second'
          else expires_at
        end
    where id = (
      select id from public.password_reset_codes
      where user_id = v_target_user_id
        and email = p_email
        and consumed_at is null
        and expires_at > now()
      order by created_at desc
      limit 1
    );
    raise exception '验证码错误或已过期（连续 5 次错误后验证码将失效）';
  end if;

  -- 标记已消费
  update public.password_reset_codes
  set consumed_at = now()
  where id = v_record.id;

  -- 生成 verify_token（uuid + 16 字节随机）
  v_verify_token := v_record.id::text || '-' || encode(gen_random_bytes(16), 'hex');
  return v_verify_token;
end;
$$;

revoke execute on function public.verify_password_reset_code(text, text) from anon;
grant execute on function public.verify_password_reset_code(text, text) to authenticated;

-- 3. 完成改密码：consume verify_token + 改密码 + revoke 该 user 的所有 session
-- ⚠️ v2026-08-25 安全加固：
--    a. SECURITY DEFINER + auth.uid() 必须等于 token 对应 user.id（之前没有这层，拿到 token 任何人都能改）
--    b. 改密成功后 delete from auth.sessions（让所有设备强制重登）
--    c. grant 只给 authenticated

create or replace function public.complete_password_reset(p_verify_token text, p_new_password text)
returns text
language plpgsql
security definer
as $$
declare
  v_record_id uuid;
  v_secret text;
  v_target_user_id uuid;
  v_record record;
begin
  -- parse verify_token: "{uuid}-{32-hex-secret}"
  v_record_id := (split_part(p_verify_token, '-', 1) || '-' ||
                  split_part(p_verify_token, '-', 2) || '-' ||
                  split_part(p_verify_token, '-', 3) || '-' ||
                  split_part(p_verify_token, '-', 4) || '-' ||
                  split_part(p_verify_token, '-', 5))::uuid;
  v_secret := split_part(p_verify_token, '-', 6);

  if length(v_secret) <> 32 then
    raise exception 'verify_token 格式错误';
  end if;

  -- 找 record（必须未过期）
  select * into v_record
  from public.password_reset_codes
  where id = v_record_id
    and consumed_at is not null
    and expires_at > now() - interval '5 minutes';  -- 验证后 5 分钟内必须完成改密

  if v_record.id is null then
    raise exception 'verify_token 无效或已过期';
  end if;

  v_target_user_id := v_record.user_id;

  -- ⚠️ 安全：必须是为自己的账号完成改密（防止拿别人 token 改别人密码）
  if v_target_user_id <> auth.uid() then
    raise exception '只能完成当前登录账号的改密';
  end if;

  -- 改密码：SECURITY DEFINER 用函数 owner（postgres 角色）权限直接改
  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  where id = v_target_user_id;

  -- ⚠️ 改密成功后 revoke 该 user 的所有 session（旧密码/旧 token 立刻失效，所有设备强制重登）
  delete from auth.sessions where user_id = v_target_user_id;

  -- 标记 verify_token 失效（让同 token 不能再用）
  update public.password_reset_codes
  set expires_at = now() - interval '1 hour'
  where id = v_record_id;

  return '密码已更新，请用新密码重新登录';
end;
$$;

revoke execute on function public.complete_password_reset(text, text) from anon;
grant execute on function public.complete_password_reset(text, text) to authenticated;
