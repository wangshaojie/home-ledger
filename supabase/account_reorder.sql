-- ========================================
-- v2026-09-01 支付账户排序：系统默认账户（现金等）也可拖动排序
-- 使用方法：Supabase Dashboard → SQL Editor → 粘贴执行
-- ========================================

-- 1. 放宽 update 策略：同家庭成员可更新任意账户（含系统默认账户），用于拖拽排序
drop policy if exists "payment_accounts: 同家庭可改自定义" on public.payment_accounts;
create policy "payment_accounts: 同家庭可改"
  on public.payment_accounts
  for update
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

-- 2. 列级授权：authenticated 只能更新 name / icon / sort_order（编辑 + 排序），
--    防止通过 API 篡改 is_default 等系统字段
revoke update on public.payment_accounts from authenticated;
grant update (name, icon, sort_order) on public.payment_accounts to authenticated;

NOTIFY pgrst, 'reload schema';
