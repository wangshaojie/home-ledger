-- ===========================
-- v2026-09-01 多人分摊（方案 C）
--
-- 场景：全家旅游等"多人共用"的支出，一笔总费用由一人付款。
-- 做法：记账时选择多个消费成员，系统按均分/自定义比例把金额拆成多条子记录，
--       同组的子记录共享同一个 group_id（客户端生成 uuid），
--       方便列表折叠展示、编辑/删除整组处理。
--
-- 说明：group_id 为 NULL 表示普通单条记录，不受影响。
-- ===========================

alter table public.expenses
  add column if not exists group_id uuid;

create index if not exists idx_expenses_group on public.expenses(group_id);

-- 刷 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
