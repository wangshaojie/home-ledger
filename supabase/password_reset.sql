-- ========================================
-- 家庭记账 · 桌面端 OTP 改密码
-- 不走 Supabase Auth reauth（v3.x 有 bug），自己实现
-- ========================================

create table if not exists public.password_reset_codes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  code text not null check (char_length(code) = 6),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  -- ⚠️ v2026-08-25 新增：失败计数，连续 5 次错误后该 OTP 失效（防 6 位数字暴力枚举）
  failed_attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_prc_user_email on public.password_reset_codes(user_id, email, code);
create index if not exists idx_prc_expires on public.password_reset_codes(expires_at);

alter table public.password_reset_codes enable row level security;

-- 5 分钟过期：建个 cleanup 函数
create or replace function public.cleanup_expired_password_reset_codes()
returns void
language sql
security definer
as $$
  delete from public.password_reset_codes where expires_at < now() - interval '1 day';
$$;

-- 如果表已存在（旧版本部署过），补 failed_attempts 字段
alter table public.password_reset_codes
  add column if not exists failed_attempts int not null default 0;
