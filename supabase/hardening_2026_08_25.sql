-- ========================================
-- 家庭记账 · 数据完整性 + 安全性 加固
-- 日期: 2026-08-25
-- 触发原因: code review 发现 5 个高严重度问题
--
-- 1. expenses 的 FK 列(member_id/category_id/account_id/payer_id)
--    不校验 family_id 一致性,跨家庭数据污染
-- 2. families.created_by 缺 on delete,删创建者被 FK 卡死
-- 3. join_family_by_invite 没校验已在家庭中,切家庭产生孤儿 family_member
-- 4. expenses_default_payer 触发器无 SECURITY DEFINER + LIMIT 1 随机选
-- 5. family_members 没 (family_id, linked_profile_id) 部分唯一约束
--
-- 全部 idempotent,可重复跑
-- ========================================

-- ===========================
-- 修 2: families.created_by 加 on delete set null
-- ===========================
do $$
declare
  has_no_action boolean;
begin
  -- 查找现有 FK 的删除行为
  select confdeltype = 'a' into has_no_action  -- 'a' = no action
  from pg_constraint
  where conname = 'families_created_by_fkey';

  if has_no_action then
    alter table public.families
      drop constraint families_created_by_fkey;
    alter table public.families
      add constraint families_created_by_fkey
      foreign key (created_by) references public.profiles(id) on delete set null;
    raise notice 'families_created_by_fkey 已改为 on delete set null';
  else
    raise notice 'families_created_by_fkey 已经是 set null 或更严格,跳过';
  end if;
end $$;

-- ===========================
-- 修 5: family_members 加 (family_id, linked_profile_id) 部分唯一
-- (linked_profile_id 非空时唯一,防止同 user 在同家庭被 link 多次)
-- ===========================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'family_members_family_linked_unique'
  ) then
    alter table public.family_members
      add constraint family_members_family_linked_unique
      unique (family_id, linked_profile_id);
    raise notice 'family_members (family_id, linked_profile_id) 部分唯一已加';
  else
    raise notice 'family_members 部分唯一约束已存在,跳过';
  end if;
end $$;

-- ===========================
-- 修 4: expenses_default_payer 触发器重写
--  - 加 security definer + set search_path
--  - lookup 不到时 raise exception(避免静默留 NULL)
--  - 用新的部分唯一约束,不再需要 LIMIT 1
-- ===========================
create or replace function public.expenses_default_payer()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  default_payer_id uuid;
begin
  if new.payer_id is not null then
    return new;
  end if;

  -- 找当前 auth user 对应的 family_member(同家庭)
  select id into default_payer_id
  from public.family_members
  where linked_profile_id = auth.uid()
    and family_id = new.family_id
  limit 1;

  if default_payer_id is null then
    raise exception
      'expenses_default_payer: 当前用户 (auth.uid()=%) 在家庭 % 中没有对应的 family_member,无法填默认 payer_id',
      auth.uid(), new.family_id
      using errcode = '23514';
  end if;

  new.payer_id := default_payer_id;
  return new;
end;
$$;

drop trigger if exists trg_expenses_default_payer on public.expenses;
create trigger trg_expenses_default_payer
  before insert on public.expenses
  for each row execute function public.expenses_default_payer();

-- ===========================
-- 修 1: expenses FK 跨家庭一致性触发器
-- 校验 member_id / category_id / account_id / payer_id 都属于同一 family_id
-- ===========================
create or replace function public.expenses_check_family_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  bad_column text;
  bad_value uuid;
begin
  -- member_id 必须同家庭
  if new.member_id is not null and not exists (
    select 1 from public.family_members
    where id = new.member_id and family_id = new.family_id
  ) then
    bad_column := 'member_id'; bad_value := new.member_id;
    raise exception 'expenses.% (%) 不属于 family_id (%)', bad_column, bad_value, new.family_id
      using errcode = '23514';
  end if;

  -- category_id 必须同家庭(系统默认分类 family_id=null,需要单独允许)
  if new.category_id is not null and not exists (
    select 1 from public.categories
    where id = new.category_id
      and (family_id = new.family_id or family_id is null)
  ) then
    bad_column := 'category_id'; bad_value := new.category_id;
    raise exception 'expenses.% (%) 不属于 family_id (%)', bad_column, bad_value, new.family_id
      using errcode = '23514';
  end if;

  -- account_id 必须同家庭(null 允许,删除的账户也是 null)
  if new.account_id is not null and not exists (
    select 1 from public.payment_accounts
    where id = new.account_id and family_id = new.family_id
  ) then
    bad_column := 'account_id'; bad_value := new.account_id;
    raise exception 'expenses.% (%) 不属于 family_id (%)', bad_column, bad_value, new.family_id
      using errcode = '23514';
  end if;

  -- payer_id 必须同家庭
  if new.payer_id is not null and not exists (
    select 1 from public.family_members
    where id = new.payer_id and family_id = new.family_id
  ) then
    bad_column := 'payer_id'; bad_value := new.payer_id;
    raise exception 'expenses.% (%) 不属于 family_id (%)', bad_column, bad_value, new.family_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_expenses_family_consistency on public.expenses;
create trigger trg_expenses_family_consistency
  before insert or update on public.expenses
  for each row execute function public.expenses_check_family_consistency();

-- ===========================
-- 修 3: join_family_by_invite 拒绝已在家庭中
-- 必须在 family_id 上有 RLS 旁路才看到原 family 的 family_member 孤儿
-- 重写:已加入家庭就 raise exception(避免覆盖产生孤儿)
-- ===========================
-- 先看原函数签名,定位到定义位置
-- 改法:create or replace 整个函数,加 family_id is null 校验
-- 注:这是 SECURITY DEFINER 函数,能跨 user 看见

-- 由于 seed.sql 的 join_family_by_invite 定义较长,这里直接 drop + recreate
-- 如果你改了 seed.sql,需要同步这里
do $$
declare
  fn_oid oid;
begin
  select oid into fn_oid
  from pg_proc
  where proname = 'join_family_by_invite'
    and pronamespace = 'public'::regnamespace;

  if fn_oid is not null then
    -- 拿函数体(从 pg_get_functiondef)
    -- 我们不重写,只校验现有函数在调用时检查 family_id
    -- 改法:加一个 BEFORE 触发器在 update profiles 上拦截
    raise notice 'join_family_by_invite 函数存在,需手动加 family_id 校验';
    raise notice '→ 在 update profiles set family_id = ... 前加: if (select family_id from profiles where id = auth.uid()) is not null then raise exception';
  end if;
end $$;

-- 用 trigger 方式强制 family_id 切换前为空
create or replace function public.profiles_block_rejoin()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- 只在 family_id 从 null 变为非 null 时校验
  -- (即 join 行为;leave family 是清空,允许)
  if old.family_id is null and new.family_id is not null then
    -- 不需要额外校验,join RPC 自己会调 auth.uid() 确认身份
    null;
  end if;

  -- 如果是 family_id 从 X 改为 Y(切家庭),禁止
  if old.family_id is not null and new.family_id is not null and old.family_id <> new.family_id then
    raise exception '用户已属于家庭 (%),不能直接切换到 (%)。请先离开当前家庭。',
      old.family_id, new.family_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_block_rejoin on public.profiles;
create trigger trg_profiles_block_rejoin
  before update of family_id on public.profiles
  for each row execute function public.profiles_block_rejoin();

-- ===========================
-- 验证 + 刷 schema cache
-- ===========================
do $$
declare
  has_constraint boolean;
  has_trigger boolean;
begin
  select exists (
    select 1 from pg_constraint where conname = 'family_members_family_linked_unique'
  ) into has_constraint;
  raise notice 'family_members_family_linked_unique 唯一约束: %', has_constraint;

  select exists (
    select 1 from pg_trigger
    where tgname = 'trg_expenses_family_consistency'
  ) into has_trigger;
  raise notice 'expenses 跨家庭一致性触发器: %', has_trigger;

  select exists (
    select 1 from pg_trigger
    where tgname = 'trg_profiles_block_rejoin'
  ) into has_trigger;
  raise notice 'profiles 切家庭拦截触发器: %', has_trigger;
end $$;

NOTIFY pgrst, 'reload schema';
