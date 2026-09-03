-- ========================================
-- 新增 mcp_list_categories:让 AI 记账前能取到家庭分类清单(category_id)
-- 2026-09-03
-- ========================================
drop function if exists public.mcp_list_categories(text);
create function public.mcp_list_categories(p_token text)
returns table (
  id uuid,
  name text,
  icon text,
  is_default boolean,
  sort_order int
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_device_id uuid;
  v_device_name text;
  v_family_id uuid;
begin
  select t.user_id, t.device_id, t.device_name
    into v_user, v_device_id, v_device_name
  from public.verify_mcp_token(p_token) t;

  -- 读操作限流
  if not public.mcp_check_rate_limit(v_user, 'list_categories') then
    raise exception '请求过于频繁' using errcode = '23514';
  end if;

  select p.family_id into v_family_id from public.profiles p where p.id = v_user;
  if v_family_id is null then
    raise exception '当前用户未加入任何家庭' using errcode = '23514';
  end if;

  return query
  select c.id, c.name, c.icon, c.is_default, c.sort_order
  from public.categories c
  where c.family_id = v_family_id
  order by c.sort_order, c.created_at;

  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user, v_device_id, 'mcp_list_categories', 'list_categories',
          jsonb_build_object('device', v_device_name),
          'ok');
end;
$$;

grant execute on function public.mcp_list_categories(text) to anon, authenticated;
