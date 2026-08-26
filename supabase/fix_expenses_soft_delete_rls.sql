-- HomeLedger · 修复：软删（UPDATE deleted_at）报 42501 "new row violates row-level security policy"
-- ============================================================
-- 根因：PostgreSQL RLS 要求 UPDATE 后的"新行"仍然满足 SELECT 策略（否则报 42501）。
--       原 SELECT 策略带 deleted_at IS NULL，软删把 deleted_at 置为非空后，
--       新行不再可见 → UPDATE 被拒。
-- 修复：SELECT 策略只保留 is_family_member，软删行仍对同家庭成员可见。
--       应用层所有查询（stores/expense.ts 的 load / aggregateByCreator /
--       aggregateByMember）已统一加 .is('deleted_at', null) 过滤，UI 行为不变。
-- 用法：复制全部 → Supabase SQL Editor → Run；或用 exec_sql.cjs 执行本文件
-- ============================================================

drop policy if exists "expenses: 同家庭可见" on public.expenses;
create policy "expenses: 同家庭可见"
  on public.expenses
  for select
  using (public.is_family_member(family_id));

alter table public.expenses enable row level security;

-- 输出确认：期望 "expenses: 同家庭可见" 的 using 不再包含 deleted_at
select polname,
       polcmd,
       pg_get_expr(polqual, polrelid) as using_clause,
       pg_get_expr(polwithcheck, polrelid) as with_check_clause
from pg_policy
where polrelid = 'public.expenses'::regclass
order by polname;
