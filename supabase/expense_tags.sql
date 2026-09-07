-- ===========================
-- v2026-09-07 账单自由标签(tags)
--
-- 背景:category 是单选(交通/餐饮/...),但"旅游"等场景天然跨多个 category,
--       用单分类筛选永远筛不全。引入自由标签作为正交维度,
--       用户可随手给账单打 #旅游 / #出差 / #可报销 等标签,
--       配合"高级筛选"按 tag 跨分类聚合。
--
-- 设计取舍:
-- 1) 用 text[] 而非关联表 —— 标签不需要单独管理,数量小、纯字符串,
--    简单 select 一次拿全,前端用 el-tag 风格展示/编辑
-- 2) 默认空数组,旧账不破坏(只显示无标签)
-- 3) GIN 索引 —— 支持 @> (contains) 高效反查
-- 4) 与现有 category 共存 —— 标签是"附属维度",不替代主分类
-- ===========================

alter table public.expenses
  add column if not exists tags text[] not null default '{}';

-- GIN 索引:支持 tags @> '{旅游}' 这种 contains 查询
create index if not exists idx_expenses_tags on public.expenses using gin (tags);

-- 数组长度上限 20(单 tag 长度由应用层/mcp RPC 规范化保证:trim、去 # 前缀、slice(0,32))
-- 不要再加 bool_and(...) 等聚合函数 —— check 约束不接受聚合/unnest 别名,
-- 之前 char_length(t) 报 42703 column "t" does not exist 就是这个原因
alter table public.expenses
  drop constraint if exists expenses_tags_check;
alter table public.expenses
  add constraint expenses_tags_check
  check (
    array_length(tags, 1) is null
    or array_length(tags, 1) <= 20
  );

-- 刷 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
