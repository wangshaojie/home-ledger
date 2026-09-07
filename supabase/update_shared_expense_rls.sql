-- ===========================
-- v2026-09-07 expenses UPDATE/DELETE 策略放宽:同家庭可改可删
--
-- 背景:之前 expenses UPDATE/DELETE 策略是 creator_id = auth.uid(),
--       只有创建者能改/删自己的账。这导致家庭里"丈夫创建的分摊,
--       妻子想改一下"被 RLS 拦掉。家庭记账场景下,同家庭成员互改/互删账
--       是合理需求。
--
-- 改法:把 USING / WITH CHECK 改为"同家庭成员"即可,不再限 creator。
--       SELECT 策略不动(还是同家庭可见)。
--
-- 安全考虑:
--   - 仍然限制在家庭内,跨家庭仍然不能改
--   - 没有"二次校验"机制,任意家庭成员都能改任何账
--   - 如果将来要"权限分层"(比如孩子不能改大人的账),
--     需要在 family_members 加 role 字段并扩展 RLS
-- ===========================

-- 1. UPDATE 策略放宽:同家庭可改
drop policy if exists "expenses: 创建者可改" on public.expenses;
create policy "expenses: 同家庭可改"
  on public.expenses
  for update
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

-- 2. DELETE 策略放宽:同家庭可删
drop policy if exists "expenses: 创建者可删" on public.expenses;
create policy "expenses: 同家庭可删"
  on public.expenses
  for delete
  using (public.is_family_member(family_id));

NOTIFY pgrst, 'reload schema';
