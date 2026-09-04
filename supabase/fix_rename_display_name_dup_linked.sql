-- ========================================
-- 修复:通过邀请码加入家庭后,修改显示名报错
--   duplicate key value violates unique constraint "family_members_family_linked_unique"
--
-- 根因:
--   profiles 表上有 AFTER 触发器 trg_profile_family_member(update of display_name 时触发),
--   其函数 handle_new_family_member_for_new_user() 每次改名都会向 family_members
--   插入一行 (family_id, 新显示名, 'adult', linked_profile_id = 自己),
--   仅 on conflict (family_id, name, type) do nothing。
--   但该用户已在家庭里有一条自己的成员行(邀请码 join 时由同一触发器创建),
--   于是新插入行撞上 hardening_2026_08_25.sql 加的
--   unique (family_id, linked_profile_id) 部分唯一约束 → 整个 UPDATE 回滚,
--   前端即看到 duplicate key 报错。
--
-- 修复:家庭里已有该账号的 linked 行 → 直接同步改名(不重复插入);
--       没有才插入,仍保留 (family_id, name, type) 撞名跳过兜底。
-- 幂等,可直接在 Supabase SQL Editor 跑;重复跑无副作用。
-- ========================================

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
  update public.family_members
  set name = new_display_name
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

-- 自检:同一账号在同一家庭应只有一条成员行,正常返回 0 行
select fm.family_id, fm.linked_profile_id, count(*) as dup_cnt
from public.family_members fm
where fm.linked_profile_id is not null
group by fm.family_id, fm.linked_profile_id
having count(*) > 1;

-- 刷新 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
