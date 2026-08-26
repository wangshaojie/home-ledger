-- 诊断：当前用户是不是这个 family 的成员
-- 在 SQL Editor 跑，把"current user uuid"和"expense id"替换成真实值

-- 1. 看 auth.users 里有哪些用户
--    把下方的 "<user-id-from-jwt>" 替换成你 DevTools 看到的 JWT 里的 sub 字段
select id, email, created_at
from auth.users
order by created_at desc
limit 10;

-- 2. 看 family_members 表现状（所有家庭的所有成员）
select fm.family_id,
       fm.user_id,
       fm.role,
       f.name as family_name,
       u.email
from public.family_members fm
left join public.families f on f.id = fm.family_id
left join auth.users u on u.id = fm.user_id
order by fm.created_at desc
limit 20;

-- 3. 看那条 expense 本身的 family_id 和 creator_id
--    把 <expense-id> 替换成 d8470c3a-cb49-466b-9341-0082c5f71657 或当前失败的 id
select id, family_id, creator_id, amount, deleted_at
from public.expenses
where id = 'd8470c3a-cb49-466b-9341-0082c5f71657';

-- 4. 用 is_family_member 函数模拟"如果以 user X 身份调用，会过 RLS 吗"
--    替换 <user-id> 和上面查到的 family_id
--    期望 true（如果该 user 是该 family 成员）
--    期望 false（如果该 user 不在 family 里）
-- select public.is_family_member('<family_id>'::uuid) as is_member_check_using_user_session;
