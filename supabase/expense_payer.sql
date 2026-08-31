-- ========================================
-- 家庭记账 · expenses.payer_id 字段
--
-- 背景：v1.1 之前 expenses 只有两个相关 ID：
--   - creator_id：谁记的账（永远是登录用户）
--   - member_id：钱算谁头上（"消费成员"）
-- 缺一个维度："谁掏的钱"。比如你拿自己的卡替媳妇付账，
-- creator=你、member=媳妇、payer=你（钱从你卡出）。
--
-- 本脚本：
-- 1. 加 payer_id 字段（NOT NULL → family_members）
-- 2. 写一个 BEFORE INSERT 触发器：payer_id 没填时默认填当前登录用户对应的 family_member
-- 3. 老数据迁移：现有 expenses.payer_id = member_id（历史默认"谁消费谁付"）
-- 4. 加索引
-- 5. NOTIFY pgrst reload schema
-- ========================================

-- 1) 加字段（先 nullable，老数据补完再改 not null）
alter table public.expenses
  add column if not exists payer_id uuid references public.family_members(id) on delete restrict;

-- 2) 老数据迁移：payer 默认等于 member（"谁消费谁付"是合理默认值）
update public.expenses
set payer_id = member_id
where payer_id is null;

-- 3) 改成 NOT NULL
alter table public.expenses
  alter column payer_id set not null;

-- 4) 索引
create index if not exists idx_expenses_family_payer on public.expenses(family_id, payer_id);

-- 5) 触发器：INSERT 时如果调用方没传 payer_id,默认填当前登录用户对应的 family_member
create or replace function public.expenses_default_payer()
returns trigger language plpgsql
as $$
declare
  default_payer_id uuid;
begin
  if new.payer_id is not null then
    return new;
  end if;

  -- 找当前 auth user 对应的 family_member（必须是同家庭）
  select id into default_payer_id
  from public.family_members
  where linked_profile_id = auth.uid()
    and family_id = new.family_id
  limit 1;

  if default_payer_id is not null then
    new.payer_id := default_payer_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_expenses_default_payer on public.expenses;
create trigger trg_expenses_default_payer
  before insert on public.expenses
  for each row execute function public.expenses_default_payer();

-- 6) 刷 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
