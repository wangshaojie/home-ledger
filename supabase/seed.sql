-- ========================================
-- 创建家庭时自动种入 10 个默认分类
-- 通过 SECURITY DEFINER 函数暴露给前端调用
-- ========================================

create or replace function public.create_family_with_defaults(p_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_family_id uuid;
  v_invite text;
begin
  -- 校验重名
  if exists (select 1 from public.families where name = p_name) then
    raise exception '家庭名称已存在';
  end if;

  -- 生成 6 位邀请码
  v_invite := upper(substring(md5(random()::text) from 1 for 6));

  -- 创建家庭
  insert into public.families (name, created_by, invite_code)
  values (p_name, auth.uid(), v_invite)
  returning id into v_family_id;

  -- 把当前用户加入家庭
  update public.profiles
  set family_id = v_family_id, joined_at = now()
  where id = auth.uid();

  -- 插入 10 个默认分类
  insert into public.categories (family_id, name, icon, is_default, sort_order) values
    (v_family_id, '餐饮',     '🍚', true, 10),
    (v_family_id, '商超购物', '🛒', true, 20),
    (v_family_id, '水电燃气', '💡', true, 30),
    (v_family_id, '交通出行', '🚗', true, 40),
    (v_family_id, '居家日用', '🏠', true, 50),
    (v_family_id, '医疗健康', '💊', true, 60),
    (v_family_id, '服饰美妆', '👕', true, 70),
    (v_family_id, '休闲娱乐', '🎮', true, 80),
    (v_family_id, '人情往来', '🎁', true, 90),
    (v_family_id, '其他',     '📦', true, 100);

  return v_family_id;
end;
$$;

-- 授权
grant execute on function public.create_family_with_defaults(text) to authenticated;

-- 邀请码加入家庭
create or replace function public.join_family_by_invite(p_invite text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_family_id uuid;
begin
  select id into v_family_id
  from public.families
  where invite_code = upper(p_invite);

  if v_family_id is null then
    raise exception '邀请码无效';
  end if;

  -- 当前用户已有家庭则覆盖（简单实现，v1.1 优化）
  update public.profiles
  set family_id = v_family_id
  where id = auth.uid();

  return v_family_id;
end;
$$;

grant execute on function public.join_family_by_invite(text) to authenticated;
