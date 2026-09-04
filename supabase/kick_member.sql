-- ========================================
-- 家庭记账 · 创建者驱离成员(kick)
--
-- 背景:目前创建者只能删自己添加的 child/pet(未关联账号),
--   对通过邀请码加入的 adult(linked_profile_id 非空)无法移除,
--   family.ts removeMember 会提示"请自行离开家庭"。
-- 本脚本让家庭创建者可以强制移出已关联账号的成员。
--
-- 数据完整性设计:
--   - 被移出成员行可能被历史账单引用(expenses.member_id / payer_id,
--     FK on delete restrict,物理删除会失败且丢失历史归属),因此不物理删除:
--     给 family_members 加 kicked_at 软移出标记;
--   - 当前成员列表 / 记账选人 / MCP 成员清单都过滤 kicked_at is null,
--     历史账单 join family_members 仍能取到姓名(行还在);
--   - 被移出者 profiles.family_id 置空 → RLS(is_family_member)立即生效,
--     ta 无法再查看该家庭任何数据(账单保留,归家庭所有);
--   - 被移出者日后用原邀请码重新加入时,触发器会把原行复活
--     (linked_profile_id 仍指向 ta → 清 kicked_at),历史账单归属不丢。
--
-- 幂等,可直接在 Supabase SQL Editor 跑
-- ========================================

-- ===========================
-- 1. family_members 加 kicked_at(软移出标记)
-- ===========================
alter table public.family_members
  add column if not exists kicked_at timestamptz;
comment on column public.family_members.kicked_at is
  '非空表示该成员已被创建者移出家庭(行保留以支撑历史账单),当前成员列表应过滤';

-- ===========================
-- 2. 触发器函数支持"重新加入复活":
--    命中 linked 行时同步名字并把 kicked_at 清掉
-- ===========================
create or replace function public.handle_new_family_member_for_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  new_display_name text;
begin
  -- 只在 profile.family_id 不为 null 时(即已加入家庭)才处理
  if new.family_id is null then
    return new;
  end if;

  -- display_name 优先用 profile 的,没有就用邮箱前缀
  new_display_name := coalesce(
    nullif(new.display_name, ''),
    split_part(new.email, '@', 1)
  );

  -- 该家庭已存在该账号对应的成员行(如通过邀请码 join 过):
  -- 直接同步显示名到该行,而不是再插一条,否则会撞
  -- (family_id, linked_profile_id) 部分唯一约束 → duplicate key
  -- kicked_at = null:被创建者移出后重新加入 → 复活该行(历史账单归属不变)
  update public.family_members
  set name = new_display_name, kicked_at = null
  where family_id = new.family_id
    and linked_profile_id = new.id;

  -- 家庭里还没有该账号的成员行(刚 join / 首次建) → 新建;
  -- 撞 (family_id, name, type) 同名同类型时沿用旧行为跳过
  if not found then
    insert into public.family_members (family_id, name, type, linked_profile_id, created_at)
    values (new.family_id, new_display_name, 'adult', new.id, now())
    on conflict (family_id, name, type) do nothing;
  end if;

  return new;
end;
$$;

-- ===========================
-- 3. kick_family_member RPC:创建者移出已关联账号的成员
-- ===========================
create or replace function public.kick_family_member(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_family_id uuid;
  v_target record;
begin
  -- 当前用户所属家庭
  select family_id into v_family_id
  from public.profiles
  where id = auth.uid();

  if v_family_id is null then
    raise exception '当前用户未加入任何家庭' using errcode = '23514';
  end if;

  -- 仅家庭创建者可驱离成员
  if not exists (
    select 1 from public.families f
    where f.id = v_family_id and f.created_by = auth.uid()
  ) then
    raise exception '只有家庭创建者可以移出成员' using errcode = '42501';
  end if;

  -- 目标必须是本家庭已关联账号的成员
  select * into v_target
  from public.family_members fm
  where fm.id = p_member_id and fm.family_id = v_family_id;

  if v_target.id is null then
    raise exception '成员不存在或不属于当前家庭' using errcode = '23514';
  end if;

  if v_target.linked_profile_id is null then
    raise exception '该成员未关联账号,请使用「删除」' using errcode = '23514';
  end if;

  if v_target.linked_profile_id = auth.uid() then
    raise exception '不能移出自己' using errcode = '23514';
  end if;

  -- 1) 解除该用户与家庭的关联(RLS 基于 profiles.family_id → 立即失去访问,
  --    ta 名下创建的账单仍保留在家庭中)
  update public.profiles
  set family_id = null
  where id = v_target.linked_profile_id;

  -- 2) family_member 行打 kicked_at 软移出标记(不物理删除:
  --    可能被历史账单引用,保留行让历史 join 仍能显示姓名)
  update public.family_members
  set kicked_at = now()
  where id = v_target.id;

  return true;
end;
$$;

grant execute on function public.kick_family_member(uuid) to authenticated;

-- ===========================
-- 4. mcp_list_members 过滤已移出成员(与 App 内成员列表一致)
-- ===========================
drop function if exists public.mcp_list_members(text);
create function public.mcp_list_members(p_token text)
returns table (
  id uuid,
  name text,
  member_type text,
  is_me boolean
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

  if not public.mcp_check_rate_limit(v_user, 'list_members') then
    raise exception '请求过于频繁' using errcode = '23514';
  end if;

  select p.family_id into v_family_id from public.profiles p where p.id = v_user;
  if v_family_id is null then
    raise exception '当前用户未加入任何家庭' using errcode = '23514';
  end if;

  return query
  select fm.id, fm.name, fm.type,
         (fm.linked_profile_id = v_user) as is_me
  from public.family_members fm
  where fm.family_id = v_family_id
    and fm.kicked_at is null
  order by fm.created_at;

  insert into public.mcp_audit_log(user_id, device_id, tool_name, action, params, result)
  values (v_user, v_device_id, 'mcp_list_members', 'list_members',
          jsonb_build_object('device', v_device_name),
          'ok');
end;
$$;

grant execute on function public.mcp_list_members(text) to anon, authenticated;

-- ===========================
-- 5. 自检 + 刷 schema cache
-- ===========================
do $$
declare
  has_col boolean;
  has_fn boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'family_members' and column_name = 'kicked_at'
  ) into has_col;
  raise notice 'family_members.kicked_at 列: %', has_col;

  select exists (
    select 1 from pg_proc
    where proname = 'kick_family_member' and pronamespace = 'public'::regnamespace
  ) into has_fn;
  raise notice 'kick_family_member 函数: %', has_fn;
end $$;

NOTIFY pgrst, 'reload schema';
