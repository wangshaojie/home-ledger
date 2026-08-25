-- ========================================
-- 家庭记账 · v1.1 family_members 修复脚本（向后兼容）
--
-- 背景：如果你是从 v1.0 升级但 v1.1 的 family_members.sql 没跑过，
--        跑本脚本可以补建表 + remap 老数据 + 改 FK。
--        如果已经跑过 family_members.sql，本脚本全部 idempotent。
--
-- 用法：直接复制粘贴到 Supabase SQL Editor 跑
-- ========================================

-- 0) 建表（如已建则跳过）
create table if not exists public.family_members (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  type text not null default 'adult' check (type in ('adult', 'child', 'pet')),
  linked_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (family_id, name, type)
);

create index if not exists idx_family_members_family on public.family_members (family_id);
create index if not exists idx_family_members_linked on public.family_members (linked_profile_id);

alter table public.family_members enable row level security;

drop policy if exists "family_members: 同家庭可见" on public.family_members;
create policy "family_members: 同家庭可见"
  on public.family_members for select using (public.is_family_member(family_id));

drop policy if exists "family_members: 同家庭可创建" on public.family_members;
create policy "family_members: 同家庭可创建"
  on public.family_members for insert with check (
    public.is_family_member(family_id)
    and (
      (type = 'adult' and linked_profile_id = auth.uid())
      or (type in ('child', 'pet') and linked_profile_id is null)
    )
  );

drop policy if exists "family_members: 同家庭可改/删" on public.family_members;
create policy "family_members: 同家庭可改/删"
  on public.family_members for update
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

drop policy if exists "family_members: 同家庭可删" on public.family_members;
create policy "family_members: 同家庭可删"
  on public.family_members for delete using (public.is_family_member(family_id));

-- 1) 数据迁移
insert into public.family_members (family_id, name, type, linked_profile_id, created_at)
select p.family_id, coalesce(p.display_name, split_part(p.email, '@', 1)), 'adult', p.id, p.joined_at
from public.profiles p
where p.family_id is not null
on conflict (family_id, name, type) do nothing;

-- 2) 触发器
create or replace function public.handle_new_family_member_for_new_user()
returns trigger language plpgsql security definer
as $$
declare new_display_name text;
begin
  if new.family_id is null then return new; end if;
  new_display_name := coalesce(nullif(new.display_name, ''), split_part(new.email, '@', 1));
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

-- 3) 诊断：还有几条 expenses 的 member_id 找不到 family_member
do $$
declare missing int;
begin
  select count(*) into missing
  from public.expenses e
  where e.member_id is not null
    and not exists (select 1 from public.family_members fm where fm.id = e.member_id);
  raise notice 'remap 前还有 % 条 expenses 找不到 family_member', missing;
end $$;

-- 4) drop 旧 FK（如果是 v1.0 留下来的）
do $$
declare old_fk_name text;
begin
  select tc.constraint_name into old_fk_name
  from information_schema.table_constraints tc
  where tc.constraint_schema = 'public' and tc.table_name = 'expenses'
    and tc.constraint_type = 'FOREIGN KEY' and tc.constraint_name like '%member%';
  if old_fk_name is not null then
    execute format('alter table public.expenses drop constraint %I', old_fk_name);
  end if;
end $$;

-- 5) remap:老 expenses.member_id (profile.id) → family_member.id
update public.expenses e
set member_id = fm.id
from public.family_members fm
where fm.linked_profile_id = e.member_id
  and fm.family_id = e.family_id
  and e.member_id is not null;

-- 6) 加新 FK
do $$
begin
  begin
    alter table public.expenses
      add constraint expenses_member_id_fkey
      foreign key (member_id) references public.family_members(id) on delete restrict;
  exception when duplicate_object then null;
  end;
end $$;

-- 7) 刷 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
