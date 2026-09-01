-- ========================================
-- 家庭记账 · 固定口径统计 RPC（今日/本月/本年支出合计）
-- ========================================
-- 背景：该 Supabase 项目的 PostgREST 不支持 `select=sum(amount)` 聚合语法
--       （实测报 PGRST200 "Could not find a relationship between 'expenses' and 'sum'"），
--       因此改为数据库端聚合函数，前端通过 supabase.rpc('get_family_totals', ...) 调用。
-- 时区：三个时间下界（今日 0 点 / 本月 1 日 0 点 / 本年 1 月 1 日 0 点）
--       由前端按本地时区计算后作为参数传入，与前端列表口径完全一致。
-- 安全：security definer + set search_path = public + 显式 schema 限定；
--       仅允许 authenticated 调用，anon/public 不可执行。
-- ========================================

create or replace function public.get_family_totals(
  p_today timestamptz,
  p_month timestamptz,
  p_year timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_fid uuid;
  v_today numeric;
  v_month numeric;
  v_year numeric;
begin
  select family_id into v_fid from public.profiles where id = auth.uid();
  if v_fid is null then
    return '{"today":0,"month":0,"year":0}'::jsonb;
  end if;

  select coalesce(sum(amount), 0) into v_today
  from public.expenses
  where family_id = v_fid and deleted_at is null and spent_at >= p_today;

  select coalesce(sum(amount), 0) into v_month
  from public.expenses
  where family_id = v_fid and deleted_at is null and spent_at >= p_month;

  select coalesce(sum(amount), 0) into v_year
  from public.expenses
  where family_id = v_fid and deleted_at is null and spent_at >= p_year;

  return jsonb_build_object('today', v_today, 'month', v_month, 'year', v_year);
end;
$$;

revoke execute on function public.get_family_totals(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_family_totals(timestamptz, timestamptz, timestamptz) to authenticated;
