-- ========================================
-- 家庭记账 · Supabase 数据库 schema
-- 在 Supabase SQL Editor 中执行
-- ========================================

-- 1) 启用扩展
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2) profiles：用户扩展信息
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  family_id uuid,
  display_name text,
  joined_at timestamptz not null default now()
);

create index idx_profiles_family on public.profiles(family_id);

-- 3) families：家庭
create table public.families (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  invite_code text not null unique
);
create index idx_families_invite on public.families(invite_code);

-- 4) categories：支出分类（每家庭一套）
create table public.categories (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  icon text not null default '📦',
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (family_id, name)
);
create index idx_categories_family on public.categories(family_id);

-- 5) expenses：支出账单
create table public.expenses (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references public.families(id) on delete cascade,
  -- 注意：creator_id / member_id FK 指向 public.profiles（不是 auth.users）
  -- 因为 PostgREST 跨 schema 解析不了指向 auth.users 的 FK，关联查询会报
  -- "Could not find a relationship between 'expenses' and 'member_id' in the schema cache"
  -- 改成指向 profiles 后，PostgREST 才能识别并支持 join
  creator_id uuid not null references public.profiles(id) on delete set null,
  member_id uuid not null references public.profiles(id) on delete set null,
  category_id uuid references public.categories(id), -- 允许 NULL:MCP/可选分类时不强制归类
  amount numeric(10, 2) not null check (amount > 0 and amount <= 999999.99),
  spent_at timestamptz not null,
  note text check (char_length(note) <= 200),
  image_urls text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_expenses_family_spent on public.expenses(family_id, spent_at desc);
create index idx_expenses_family_member on public.expenses(family_id, member_id);
create index idx_expenses_family_category on public.expenses(family_id, category_id);
create index idx_expenses_creator on public.expenses(creator_id);

-- 6) 自动维护 updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_expenses_updated
  before update on public.expenses
  for each row execute function public.handle_updated_at();

-- 7) 新用户自动创建 profile
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
