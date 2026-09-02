-- ========================================
-- 家庭记账 · MCP 设备功能 自检脚本
-- 跑法: 必须在 mcp_device.sql + mcp_device_views.sql 都跑完后执行
--
-- 检查项:
--   1. 表是否创建(2 张)
--   2. RPC 是否创建(9 个)
--   3. RLS 是否启用
--   4. grant 配置是否正确
--   5. 模拟 anon / authenticated 调用的权限表现
-- ========================================

-- 1. 表
select 'table_check' as check_name,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('mcp_device_tokens','mcp_audit_log')
  ) as actual,
  2 as expected,
  case when (
    select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('mcp_device_tokens','mcp_audit_log')
  ) = 2 then '✅ PASS' else '❌ FAIL' end as result;

-- 2. RPC
select 'rpc_check' as check_name,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('issue_mcp_token','verify_mcp_token','revoke_mcp_device',
                      'mcp_check_rate_limit','mcp_add_expense','mcp_list_recent',
                      'mcp_delete_expense','mcp_list_my_devices','mcp_list_my_audit_log')
  ) as actual,
  9 as expected,
  case when (
    select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('issue_mcp_token','verify_mcp_token','revoke_mcp_device',
                      'mcp_check_rate_limit','mcp_add_expense','mcp_list_recent',
                      'mcp_delete_expense','mcp_list_my_devices','mcp_list_my_audit_log')
  ) = 9 then '✅ PASS' else '❌ FAIL' end as result;

-- 3. RLS
select 'rls_check' as check_name,
  t.tablename,
  t.rowsecurity as rls_enabled,
  case when t.rowsecurity then '✅' else '❌' end as result
from pg_tables t
where t.schemaname = 'public' and t.tablename in ('mcp_device_tokens','mcp_audit_log')
order by t.tablename;

-- 4. grant 配置
select
  p.proname as function_name,
  r.rolname as grantee,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
from pg_proc p
cross join pg_roles r
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('issue_mcp_token','verify_mcp_token','revoke_mcp_device',
                    'mcp_add_expense','mcp_list_recent','mcp_delete_expense',
                    'mcp_list_my_devices','mcp_list_my_audit_log')
  and r.rolname in ('anon','authenticated')
order by p.proname, r.rolname;

-- 5. 预期 grant 模式(对照检查)
select
  proname,
  case
    when proname in ('issue_mcp_token','revoke_mcp_device','mcp_list_my_devices','mcp_list_my_audit_log')
      then 'anon:NO, authenticated:YES'
    when proname in ('verify_mcp_token','mcp_add_expense','mcp_list_recent','mcp_delete_expense')
      then 'anon:YES, authenticated:YES (走 token 不走 auth.uid())'
    else '?'
  end as expected_grant
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('issue_mcp_token','verify_mcp_token','revoke_mcp_device',
                  'mcp_add_expense','mcp_list_recent','mcp_delete_expense',
                  'mcp_list_my_devices','mcp_list_my_audit_log')
order by proname;
