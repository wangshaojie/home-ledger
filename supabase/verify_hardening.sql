-- 模拟一个别的家庭 + 别的 member,然后试跨家庭污染
do $$
declare
  other_family_id uuid;
  other_member_id uuid;
  my_family_id uuid := '69d8c03c-d714-44b7-a34e-da52c169d66e';
  my_member_id uuid := '990b1762-5e5c-4a70-bb0f-a67f908b49bb';
  test_result text;
  other_info text;
begin
  -- 直接造一个别的家庭 + 别的 member
  insert into public.families (id, name, created_by, invite_code)
  values (gen_random_uuid(), '测试别人家', '5e8761f1-22c0-43c9-804a-ad69e7cfa240', 'TEST0001')
  returning id into other_family_id;

  insert into public.family_members (id, family_id, name, type, linked_profile_id)
  values (gen_random_uuid(), other_family_id, '测试人', 'child', null)
  returning id into other_member_id;

  other_info := 'other_family=' || other_family_id::text || ', other_member=' || other_member_id::text;

  begin
    -- 关键攻击:我家的 family_id,别人的 member_id
    insert into public.expenses (family_id, creator_id, member_id, payer_id, category_id, account_id, amount, spent_at)
    values (my_family_id, '5e8761f1-22c0-43c9-804a-ad69e7cfa240', other_member_id, my_member_id, null, null, 1.00, now());
    test_result := '❌ FAIL: 跨家庭污染没拦截';
    delete from public.expenses where member_id = other_member_id and family_id = my_family_id;
  exception when others then
    test_result := '✅ PASS: ' || sqlerrm;
  end;

  -- 清理
  delete from public.family_members where id = other_member_id;
  delete from public.families where id = other_family_id;

  create temp table _test_result (info text, result text) on commit drop;
  insert into _test_result values (other_info, test_result);
end $$;

select * from _test_result;
