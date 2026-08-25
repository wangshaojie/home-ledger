-- ========================================
-- 家庭记账 · 支付账户 (payment_accounts)
-- 支付宝 / 花呗 / 微信 / 招行信用卡 / 现金 等
-- 每家庭一套，CRUD 由家庭成员操作
-- ========================================

create table if not exists public.payment_accounts (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  icon text not null default '💳',
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (family_id, name)
);
create index if not exists idx_payment_accounts_family on public.payment_accounts(family_id);

-- ========================================
-- expenses 表加 account_id 字段（已部署过的加 if not exists）
-- ========================================
alter table public.expenses
  add column if not exists account_id uuid references public.payment_accounts(id) on delete set null;
create index if not exists idx_expenses_family_account on public.expenses(family_id, account_id);

-- ========================================
-- RLS
-- ========================================
alter table public.payment_accounts enable row level security;

drop policy if exists "payment_accounts: 同家庭可见" on public.payment_accounts;
create policy "payment_accounts: 同家庭可见"
  on public.payment_accounts
  for select
  using (public.is_family_member(family_id));

drop policy if exists "payment_accounts: 同家庭可创建" on public.payment_accounts;
create policy "payment_accounts: 同家庭可创建"
  on public.payment_accounts
  for insert
  with check (public.is_family_member(family_id) and is_default = false);

drop policy if exists "payment_accounts: 同家庭可改自定义" on public.payment_accounts;
create policy "payment_accounts: 同家庭可改自定义"
  on public.payment_accounts
  for update
  using (public.is_family_member(family_id) and is_default = false)
  with check (public.is_family_member(family_id) and is_default = false);

drop policy if exists "payment_accounts: 同家庭可删自定义" on public.payment_accounts;
create policy "payment_accounts: 同家庭可删自定义"
  on public.payment_accounts
  for delete
  using (public.is_family_member(family_id) and is_default = false);

-- ========================================
-- create_family_with_defaults 加 5 个默认账户
-- ========================================
create or replace function public.create_family_with_defaults(p_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_family_id uuid;
  v_invite text;
begin
  if exists (select 1 from public.families where name = p_name) then
    raise exception '家庭名称已存在';
  end if;

  v_invite := upper(substring(md5(random()::text) from 1 for 6));

  insert into public.families (name, created_by, invite_code)
  values (p_name, auth.uid(), v_invite)
  returning id into v_family_id;

  update public.profiles
  set family_id = v_family_id, joined_at = now()
  where id = auth.uid();

  -- 10 个默认分类
  insert into public.categories (family_id, name, icon, is_default, sort_order) values
    (v_family_id, '餐饮',     '🍚', true, 10),
    (v_family_id, '商超购物', '🛒', true, 20),
    (v_family_id, '水电燃气', '💡', true, 30),
    (v_family_id, '交通出行', '🚗', true, 40),
    (v_family_id, '居家日用', '🏠', true, 50),
    (v_family_id, '医疗健康', '💊', true, 60),
    (v_family_id, '服饰美妆', '👕', true, 70),
    (v_family_id, '休闲娱乐', '🎮', true, 80),
    (v_family_id, '人情往来', '🎁', true, 90),
    (v_family_id, '其他',     '📦', true, 100);

  -- 6 个默认支付账户
  insert into public.payment_accounts (family_id, name, icon, is_default, sort_order) values
    (v_family_id, '现金',       '💵', true, 10),
    (v_family_id, '微信支付',   '💚', true, 20),
    (v_family_id, '支付宝',     '🅰️', true, 30),
    (v_family_id, '花呗',       '🌸', true, 40),
    (v_family_id, '京东白条',   '🟧', true, 50),
    (v_family_id, '招商信用卡', '💳', true, 60);

  return v_family_id;
end;
$$;

grant execute on function public.create_family_with_defaults(text) to authenticated;
