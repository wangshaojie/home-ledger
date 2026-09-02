-- ========================================
-- 家庭记账 · 微信小程序绑定表
-- 在 Supabase SQL Editor 中执行
-- ========================================

-- 1) 微信小程序绑定：一个微信 openid 对一个 auth 用户
--    Edge Function verify_wx_miniprogram（service_role）负责读写
create table if not exists public.wx_miniprogram_bindings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_id text not null,   -- 微信小程序 AppID
  openid text not null,   -- 用户在该小程序下的 openid
  bound_at timestamptz not null default now(),
  unique (app_id, openid)
);

create index if not exists idx_wx_bindings_user on public.wx_miniprogram_bindings(user_id);

-- 2) RLS：本表仅供 Edge Function（service_role 绕过 RLS）操作，
--    普通客户端仅允许查询自己的绑定记录
alter table public.wx_miniprogram_bindings enable row level security;

create policy "wx_bindings: 本人可查"
  on public.wx_miniprogram_bindings
  for select
  using (auth.uid() = user_id);
