-- v2026-08-25 登录体系重构：密码为主，邮箱用于验证
-- profiles 加 email_verified 字段 + 触发器自动从 auth.users.email_confirmed_at 同步
-- （避免双重事实源：只要 auth.users 那边确认了，profiles 自动跟着变）

-- 1) 加列（如果不存在）
alter table public.profiles
  add column if not exists email_verified boolean not null default false;

-- 2) 已存在的存量用户：把 auth.users.email_confirmed_at 不为空的都标 true
update public.profiles p
set email_verified = true
from auth.users u
where p.id = u.id
  and u.email_confirmed_at is not null
  and p.email_verified = false;

-- 3) 同步触发器：auth.users 的 confirmed_at 变化时自动同步到 profiles
--    但因为 trigger 函数必须存在于 public schema 才能在 RLS 下被调用，
--    用 security definer 让它能跨 schema 读 auth.users
create or replace function public.sync_email_verified()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- 首次确认（at 从 null 变成非 null）时标 true
  if (TG_OP = 'UPDATE'
      and OLD.email_confirmed_at is null
      and NEW.email_confirmed_at is not null) then
    update public.profiles
    set email_verified = true
    where id = NEW.id and email_verified = false;
  end if;
  return NEW;
end;
$$;

-- 4) 把触发器挂到 auth.users 上（如果之前没挂过）
drop trigger if exists trg_sync_email_verified on auth.users;
create trigger trg_sync_email_verified
  after update of email_confirmed_at on auth.users
  for each row
  execute function public.sync_email_verified();

-- 5) signUp 时 Supabase 默认不发 session（要邮箱验证）。
--    这条已经在 Supabase Auth 后台 "Enable email confirmations" 配好了。
--    不需要 SQL 操作，但留个注释提醒：
--    Dashboard → Authentication → Providers → Email → 关闭 "Confirm email" 会让验证邮件不发。
--    必须保持 Confirm email 开启。
