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
drop policy if exists "profiles: 自己的资料可读写" on public.profiles;
create policy "profiles: 自己的资料可读写"
  on public.profiles
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- 同家庭成员可看到彼此的 display_name（用于记账时选择消费成员）
drop policy if exists "profiles: 同家庭成员可见" on public.profiles;
create policy "profiles: 同家庭成员可见"
  on public.profiles
  for select
  using (family_id = public.my_family_id() and id <> auth.uid());

-- ===========================
-- families
-- ===========================
drop policy if exists "families: 同家庭成员可见" on public.families;
create policy "families: 同家庭成员可见"
  on public.families
  for select
  using (public.is_family_member(id));

drop policy if exists "families: 任何登录用户可创建（创建后自动 join）" on public.families;
create policy "families: 任何登录用户可创建（创建后自动 join）"
  on public.families
  for insert
  with check (auth.uid() = created_by);

drop policy if exists "families: 仅创建者可改" on public.families;
create policy "families: 仅创建者可改"
  on public.families
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- ===========================
-- categories
-- ===========================
drop policy if exists "categories: 同家庭可见" on public.categories;
create policy "categories: 同家庭可见"
  on public.categories
  for select
  using (public.is_family_member(family_id));

drop policy if exists "categories: 同家庭可创建" on public.categories;
create policy "categories: 同家庭可创建"
  on public.categories
  for insert
  with check (public.is_family_member(family_id) and is_default = false);

drop policy if exists "categories: 同家庭可改自定义" on public.categories;
create policy "categories: 同家庭可改自定义"
  on public.categories
  for update
  using (public.is_family_member(family_id) and is_default = false)
  with check (public.is_family_member(family_id) and is_default = false);

drop policy if exists "categories: 同家庭可删自定义" on public.categories;
create policy "categories: 同家庭可删自定义"
  on public.categories
  for delete
  using (public.is_family_member(family_id) and is_default = false);

-- ===========================
-- expenses
-- ⚠️ v2026-08-25 修复：expenses INSERT/UPDATE/DELETE 都要校验 family_id
-- 之前只校验 creator_id，攻击者可以 insert family_id = 别人家庭的 id 污染数据
-- ===========================
drop policy if exists "expenses: 同家庭可见" on public.expenses;
create policy "expenses: 同家庭可见"
  on public.expenses
  for select
  using (public.is_family_member(family_id) and deleted_at is null);

drop policy if exists "expenses: 创建者可创建" on public.expenses;
create policy "expenses: 创建者可创建"
  on public.expenses
  for insert
  with check (creator_id = auth.uid() and public.is_family_member(family_id));

drop policy if exists "expenses: 创建者可改" on public.expenses;
create policy "expenses: 创建者可改"
  on public.expenses
  for update
  using (creator_id = auth.uid() and public.is_family_member(family_id))
  with check (creator_id = auth.uid() and public.is_family_member(family_id));

drop policy if exists "expenses: 创建者可删" on public.expenses;
create policy "expenses: 创建者可删"
  on public.expenses
  for delete
  using (creator_id = auth.uid() and public.is_family_member(family_id));
