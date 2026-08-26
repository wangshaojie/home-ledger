-- HomeLedger · 修复 expenses RLS：同家庭成员都能软删/修改
-- v1.1.7 之前策略：expenses 的 UPDATE / DELETE 只允许 creator_id = auth.uid()
-- 症状：家庭其他成员点"删除"按钮（HomeView.vue 256 行 deleteOne）报：
--   "new row violates row-level security policy for table \"expenses\""
-- 原因：UI 上"删除"按钮对所有账单都显示，但 RLS 限定只有创建者能改/删。
-- 解决：放宽 UPDATE / DELETE 策略到 is_family_member(family_id)，
--   INSERT 仍要求 creator_id = auth.uid()（谁创建谁负责），不变。

-- ===========================
-- expenses UPDATE：同家庭可改
-- 旧：using (creator_id = auth.uid() and public.is_family_member(family_id))
--     with check (creator_id = auth.uid() and public.is_family_member(family_id))
-- 新：放宽到所有同家庭成员。with check 里**不**保留 creator_id 限制，
--     否则家庭成员 A 帮 B 改 payer_id 时会因为 creator_id 变成 B 而失败。
-- ===========================
drop policy if exists "expenses: 创建者可改" on public.expenses;
create policy "expenses: 创建者可改"
  on public.expenses
  for update
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

-- ===========================
-- expenses DELETE：同家庭可软删
-- 旧：using (creator_id = auth.uid() and public.is_family_member(family_id))
-- 新：放宽到所有同家庭成员。注意前端 remove() 是软删
--     (update deleted_at)，不走 DELETE，所以这条策略实际上是为"硬删"留口子。
--     配合 UPDATE 策略放宽，软删就能跨成员工作了。
-- ===========================
drop policy if exists "expenses: 创建者可删" on public.expenses;
create policy "expenses: 创建者可删"
  on public.expenses
  for delete
  using (public.is_family_member(family_id));

-- ===========================
-- 验证
-- 跑完后可以查一下当前 expenses 的 4 条策略：
--   select polname, polcmd from pg_policy
--   where polrelid = 'public.expenses'::regclass
--   order by polname;
--
-- 期望看到：
--   expenses: 同家庭可见       | r (SELECT)
--   expenses: 创建者可创建      | a (INSERT)
--   expenses: 创建者可改        | w (UPDATE)   ← 新
--   expenses: 创建者可删        | d (DELETE)   ← 新
-- ===========================
