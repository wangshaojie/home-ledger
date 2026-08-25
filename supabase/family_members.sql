-- ========================================
-- 家庭记账 · family_members 表（v1.1）
--
-- 背景：原来 expenses.member_id 直接 FK 到 profiles.id，
-- 意味着要记账选"消费归属"必须先有 auth user。
-- 这导致小孩、宠物、未注册的家人都没法记账（父母没法替他们建账）。
--
-- v1.1 方案：引入 family_members 表，记录"家庭内的成员身份"，
--   - 大人（adult）：linked_profile_id 非空，对应一个 Supabase auth user
--   - 小孩（child）：linked_profile_id 为 NULL，没有 auth user
--   - 宠物（pet）：linked_profile_id 为 NULL
--
-- 改 FK：expenses.member_id 改为指向 family_members.id
-- 数据迁移：把现有 profiles 中所有已加入家庭的行，复制成 family_members 行
-- ========================================

-- 1) 新表
create table if not exists public.family_members (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  type text not null default 'adult' check (type in ('adult', 'child', 'pet')),
  -- linked_profile_id: 仅 adult 才有值。NULL 表示该成员没有自己的账号
  -- 用 on delete set null：profile 删除时保留 family_member 行（变孤儿成员，避免级联删掉所有老账单）
  linked_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- 一个家庭不能有两个同名同类型的成员
  -- 注意：NULL 在 unique 中视为不同，所以多个 NULL name + type 不冲突（但 name 不能 NULL，所以这没事）
  unique (family_id, name, type)
);

create index if not exists idx_family_members_family on public.family_members (family_id);
create index if not exists idx_family_members_linked on public.family_members (linked_profile_id);

-- 2) RLS
alter table public.family_members enable row level security;

drop policy if exists "family_members: 同家庭可见" on public.family_members;
create policy "family_members: 同家庭可见"
  on public.family_members
  for select
  using (public.is_family_member(family_id));

drop policy if exists "family_members: 同家庭可创建" on public.family_members;
create policy "family_members: 同家庭可创建"
  on public.family_members
  for insert
  with check (
    public.is_family_member(family_id)
    -- adult 必须 linked 到自己；child/pet 必须不 linked
    and (
      (type = 'adult' and linked_profile_id = auth.uid())
      or (type in ('child', 'pet') and linked_profile_id is null)
    )
  );

drop policy if exists "family_members: 同家庭可改/删" on public.family_members;
create policy "family_members: 同家庭可改/删"
  on public.family_members
  for update
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

drop policy if exists "family_members: 同家庭可删" on public.family_members;
create policy "family_members: 同家庭可删"
  on public.family_members
  for delete
  using (public.is_family_member(family_id));

-- 3) 数据迁移：把现有 profiles（已加入家庭的）复制成 family_members
--    安全措施：仅在目标 family_member 不存在（按 family_id+name+type）时才插入
insert into public.family_members (family_id, name, type, linked_profile_id, created_at)
select
  p.family_id,
  coalesce(p.display_name, split_part(p.email, '@', 1)) as name,
  'adult' as type,
  p.id as linked_profile_id,
  p.joined_at as created_at
from public.profiles p
where p.family_id is not null
on conflict (family_id, name, type) do nothing;

-- 4) 触发器：新 auth user 注册并加入家庭时，自动建一条 family_member 行
--    这覆盖通过 join_family_by_invite 加入的新用户
create or replace function public.handle_new_family_member_for_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  new_display_name text;
begin
  -- 只在 profile.family_id 不为 null 时（即已加入家庭）才建
  if new.family_id is null then
    return new;
  end if;

  -- display_name 优先用 profile 的，没有就用邮箱前缀
  new_display_name := coalesce(
    nullif(new.display_name, ''),
    split_part(new.email, '@', 1)
  );

  insert into public.family_members (family_id, name, type, linked_profile_id, created_at)
  values (new.family_id, new_display_name, 'adult', new.id, now())
  on conflict (family_id, name, type) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_profile_family_member on public.profiles;
create trigger trg_profile_family_member
  after insert or update of family_id, display_name on public.profiles
  for each row execute function public.handle_new_family_member_for_new_user();

-- 5) 改 expenses.member_id FK：先 drop 旧 FK，再 remap 老数据（profile.id → family_member.id），
--    最后加新 FK。三个动作必须按顺序，因为新 FK 会立刻校验现有数据。
--    注意：v1.0 的老账单的 member_id 是 profiles.id，不是 family_member.id。

-- 5a) drop 旧 FK (expenses.member_id → profiles.id)
do $$
declare
  old_fk_name text;
begin
  select tc.constraint_name into old_fk_name
  from information_schema.table_constraints tc
  where tc.constraint_schema = 'public'
    and tc.table_name = 'expenses'
    and tc.constraint_type = 'FOREIGN KEY'
    and tc.constraint_name like '%member%';

  if old_fk_name is not null then
    execute format('alter table public.expenses drop constraint %I', old_fk_name);
  end if;
end $$;

-- 5b) remap:把老 expenses.member_id (profile.id) 替换成对应的 family_member.id
--      对应关系: profile.id → family_member.linked_profile_id (按 family_id 匹配)
update public.expenses e
set member_id = fm.id
from public.family_members fm
where fm.linked_profile_id = e.member_id
  and fm.family_id = e.family_id
  and e.member_id is not null;

-- 5c) 加新 FK
alter table public.expenses
  add constraint expenses_member_id_fkey
  foreign key (member_id) references public.family_members(id) on delete restrict;

-- 6) 刷 PostgREST schema cache（让前端立刻能用新表）
NOTIFY pgrst, 'reload schema';
