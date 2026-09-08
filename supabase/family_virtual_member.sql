-- ========================================
-- 家庭记账 · v2026-09-08 "家庭"虚拟成员(公共开销维度)
--
-- 背景:想看"不属于任何个人的家庭开支"(水电、房租、日用品),
--   而 expenses.member_id 是全系统核心维度(列表展示/筛选/三种统计/
--   多人分摊/MCP 记账),全部挂在它上面。
--   方案:在 family_members 里加一种 type='family' 的虚拟成员,
--   每个家庭自动拥有一个,记账时"消费成员"选「家庭」即公共开销,
--   零改动 expenses 表,所有现有按 member 的逻辑自动兼容。
--
-- 内容:
--   1. type check 约束扩展 'family'
--   2. partial unique index:每家最多一个 family 类型成员
--   3. 触发器:新建 families 行时自动创建「家庭」成员
--   4. 存量家庭 backfill
--
-- 行为约定:
--   - linked_profile_id 恒为 NULL(没有登录账号,同 child/pet)
--   - 前端"付款人"下拉排除该成员(付款必须是真人);消费成员可选
--   - 前端删除/移出按钮隐藏;family.ts removeMember 有代码层兜底
--   - 支持改名(如改成"家用"),改名不影响统计口径(按 id 聚合)
--
-- 幂等,可直接在 Supabase SQL Editor 跑
-- ========================================

-- ===========================
-- 1. type check 约束扩展 'family'
--    (内联创建的约束名由 PG 自动生成,按定义内容动态找,兼容历史命名)
-- ===========================
do $$
declare
  v_conname text;
begin
  for v_conname in
    select conname
    from pg_constraint
    where conrelid = 'public.family_members'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'type'
  loop
    execute format('alter table public.family_members drop constraint %I', v_conname);
    raise notice 'dropped old type check constraint: %', v_conname;
  end loop;

  execute $ddl$alter table public.family_members
    add constraint family_members_type_check
    check (type in ('adult', 'child', 'pet', 'family'))$ddl$;
  raise notice 'added new type check constraint (adult/child/pet/family)';
end $$;

-- ===========================
-- 2. 每家最多一个 family 类型成员
--    (unique(family_id, name, type) 挡不住"家庭 + 家用"两条,加 partial index)
-- ===========================
create unique index if not exists family_members_one_virtual_family
  on public.family_members (family_id)
  where type = 'family';

-- ===========================
-- 3. 新建家庭时自动创建「家庭」成员
--    security definer:绕过 family_members 的 insert RLS
--    (RLS 只放行 adult/child/pet,family 类型只能由触发器/backfill 创建)
-- ===========================
create or replace function public.handle_new_family_virtual_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.family_members (family_id, name, type, linked_profile_id)
  values (new.id, '家庭', 'family', null)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_family_created_virtual_member on public.families;
create trigger on_family_created_virtual_member
  after insert on public.families
  for each row execute function public.handle_new_family_virtual_member();

-- ===========================
-- 4. 存量家庭 backfill
-- ===========================
insert into public.family_members (family_id, name, type, linked_profile_id)
select f.id, '家庭', 'family', null
from public.families f
where not exists (
  select 1 from public.family_members fm
  where fm.family_id = f.id and fm.type = 'family'
);

-- ===========================
-- 5. 自检 + 刷 schema cache
-- ===========================
do $$
declare
  v_families int;
  v_virtual int;
begin
  select count(*) into v_families from public.families;
  select count(*) into v_virtual
  from public.family_members fm
  where fm.type = 'family';
  raise notice '家庭数: %, family 虚拟成员数(应相等): %', v_families, v_virtual;
end $$;

NOTIFY pgrst, 'reload schema';
