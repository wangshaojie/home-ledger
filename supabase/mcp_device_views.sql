-- ========================================
-- 家庭记账 · MCP 设备管理 视图 / 列表 RPC(给桌面端 Vue 用)
-- 日期: 2026-09-02
-- 必须先跑 mcp_device.sql
--
-- 提供:
--   - mcp_list_my_devices(): 当前登录用户的活跃设备列表
--   - mcp_list_my_audit_log(p_limit): 当前登录用户最近 N 条审计
-- ========================================

-- ===========================
-- 1. mcp_list_my_devices()
-- 返: 设备 id、设备名、scopes、最后使用时间、创建时间、是否过期
-- 桌面端用这个列"已连接设备"列表
-- ========================================
drop function if exists public.mcp_list_my_devices();
create function public.mcp_list_my_devices()
returns table (
  device_id uuid,
  device_name text,
  scopes text[],
  last_used_at timestamptz,
  created_at timestamptz,
  expires_at timestamptz,
  status text   -- 'active' / 'expired' / 'revoked'
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception '未登录' using errcode = '28000';
  end if;

  return query
  select
    t.id, t.device_name, t.scopes, t.last_used_at, t.created_at, t.expires_at,
    case
      when t.revoked_at is not null then 'revoked'
      when t.expires_at <= now() then 'expired'
      else 'active'
    end as status
  from public.mcp_device_tokens t
  where t.user_id = v_user
  order by t.created_at desc;
end;
$$;

revoke execute on function public.mcp_list_my_devices() from anon;
grant execute on function public.mcp_list_my_devices() to authenticated;

-- ===========================
-- 2. mcp_list_my_audit_log(p_limit)
-- 桌面端"我的 AI 记账历史"页用
-- ========================================
drop function if exists public.mcp_list_my_audit_log(int);
create function public.mcp_list_my_audit_log(p_limit int default 50)
returns table (
  log_id bigint,
  tool_name text,
  action text,
  params jsonb,
  result text,
  error_message text,
  device_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_actual_limit int;
begin
  if v_user is null then
    raise exception '未登录' using errcode = '28000';
  end if;

  v_actual_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  return query
  select
    l.id, l.tool_name, l.action, l.params, l.result, l.error_message,
    coalesce(t.device_name, '(已删除设备)') as device_name,
    l.created_at
  from public.mcp_audit_log l
  left join public.mcp_device_tokens t on t.id = l.device_id
  where l.user_id = v_user
  order by l.created_at desc
  limit v_actual_limit;
end;
$$;

revoke execute on function public.mcp_list_my_audit_log(int) from anon;
grant execute on function public.mcp_list_my_audit_log(int) to authenticated;

-- ===========================
-- 3. 验证
-- ========================================
do $$
begin
  raise notice 'mcp_list_my_devices: 桌面端"已连接设备"页用';
  raise notice 'mcp_list_my_audit_log: 桌面端"AI 记账历史"页用';
  raise notice '两个 RPC 都 revoke from anon,只 grant authenticated';
end $$;
