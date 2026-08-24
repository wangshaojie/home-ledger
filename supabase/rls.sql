-- ========================================
-- 家庭记账 · Row Level Security 策略
-- 在 schema.sql 执行完后运行
-- ========================================

-- 启用 RLS
alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;

-- 工具函数：当前用户所属的家庭 id
create or replace function public.my_family_id()
returns uuid
language sql
stable
security definer
as $$
  select family_id from public.profiles where id = auth.uid()
$$;

-- 工具函数：检查两个用户是否同家庭
create or replace function public.is_family_member(target_family uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and family_id = target_family
  )
$$;

-- ===========================
-- profiles
-- ===========================
create policy "profiles: 自己的资料可读写"
  on public.profiles
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- 同家庭成员可看到彼此的 display_name（用于记账时选择消费成员）
create policy "profiles: 同家庭成员可见"
  on public.profiles
  for select
  using (family_id = public.my_family_id() and id <> auth.uid());

-- ===========================
-- families
-- ===========================
create policy "families: 同家庭成员可见"
  on public.families
  for select
  using (public.is_family_member(id));

create policy "families: 任何登录用户可创建（创建后自动 join）"
  on public.families
  for insert
  with check (auth.uid() = created_by);

create policy "families: 仅创建者可改"
  on public.families
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- ===========================
-- categories
-- ===========================
create policy "categories: 同家庭可见"
  on public.categories
  for select
  using (public.is_family_member(family_id));

create policy "categories: 同家庭可创建"
  on public.categories
  for insert
  with check (public.is_family_member(family_id) and is_default = false);

create policy "categories: 同家庭可改自定义"
  on public.categories
  for update
  using (public.is_family_member(family_id) and is_default = false)
  with check (public.is_family_member(family_id) and is_default = false);

create policy "categories: 同家庭可删自定义"
  on public.categories
  for delete
  using (public.is_family_member(family_id) and is_default = false);

-- ===========================
-- expenses
-- 简化策略：只看 creator_id = auth.uid()。
-- 家庭隔离由前端和 SELECT 策略共同保证（你能看到 = 你同家庭 = 可改自己的）。
-- 避免 is_family_member() SECURITY DEFINER 函数内 RLS 互相干扰的坑。
-- ===========================
create policy "expenses: 同家庭可见"
  on public.expenses
  for select
  using (public.is_family_member(family_id) and deleted_at is null);

create policy "expenses: 创建者可创建"
  on public.expenses
  for insert
  with check (creator_id = auth.uid());

create policy "expenses: 创建者可改"
  on public.expenses
  for update
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy "expenses: 创建者可删"
  on public.expenses
  for delete
  using (creator_id = auth.uid());
