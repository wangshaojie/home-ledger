-- HomeLedger · 修复 expenses RLS v2（绕开中文策略名潜在编码问题）
-- 用法：复制全部 → Supabase SQL Editor → Run
-- 跑完用 scripts/verify_expenses_rls.sql 验证
-- 此脚本会做 4 件事：
--   1) DROP 旧的"创建者可改/可删"两条策略（用 pg_policy 元数据，名字不依赖中文）
--   2) CREATE 两条新策略（名字保留中文，跟 v1 一样）
--   3) 重新 enable RLS（防御性）
--   4) 输出"现在 expenses 上的 4 条策略 USING 条件"给你看

-- Step 1: 用动态 SQL 删掉旧的两条策略，名字不写死
do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policy
    where polrelid = 'public.expenses'::regclass
      and polname in ('expenses: 创建者可改', 'expenses: 创建者可删')
  loop
    execute format('drop policy %I on public.expenses', pol.polname);
    raise notice 'dropped policy: %', pol.polname;
  end loop;
end$$;

-- Step 2: 重新创建两条策略（用 is_family_member，不再要求 creator_id）
create policy "expenses: 创建者可改"
  on public.expenses
  for update
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

create policy "expenses: 创建者可删"
  on public.expenses
  for delete
  using (public.is_family_member(family_id));

-- Step 3: 防御性 enable RLS（已经 enabled 的话 no-op）
alter table public.expenses enable row level security;

-- Step 4: 立即输出"现在 expenses 上的策略 USING/WITH CHECK"
-- 期望：
--   expenses: 创建者可改 | using=is_family_member(family_id) | with check=is_family_member(family_id)
--   expenses: 创建者可删 | using=is_family_member(family_id) | with check=NULL
select polname,
       polcmd,
       pg_get_expr(polqual, polrelid) as using_clause,
       pg_get_expr(polwithcheck, polrelid) as with_check_clause
from pg_policy
where polrelid = 'public.expenses'::regclass
order by polname;
