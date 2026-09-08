// 数据库行类型（Supabase schema → TS 类型）
// v1.1 接 Supabase 时用

export interface DbProfile {
  id: string
  email: string
  family_id: string | null
  display_name: string | null
  joined_at: string
  email_verified?: boolean // v2026-08-25 新加：是否完成邮箱验证
}

export interface DbFamily {
  id: string
  name: string
  created_by: string
  created_at: string
  invite_code: string
}

export interface DbCategory {
  id: string
  family_id: string
  name: string
  icon: string
  is_default: boolean
  sort_order: number
  created_at: string
}

export interface DbExpense {
  id: string
  family_id: string
  creator_id: string
  member_id: string
  payer_id: string
  category_id: string
  account_id: string | null
  amount: number
  spent_at: string
  note: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  group_id: string | null // v2026-09-01 多人分摊：同组子记录共享同一 group_id
  tags: string[] // v2026-09-07 自由标签（如 #旅游 #出差），跨分类聚合用
}

/**
 * v1.1 家庭成员（不再直接用 profiles 当消费成员）
 * - adult: linked_profile_id 非空，对应一个登录用户
 * - child/pet: linked_profile_id 为 NULL，没有自己的账号，由父母代记账
 * - family: v2026-09-08 "家庭"虚拟成员（每家一个，由触发器/backfill 自动创建），
 *   公共开销维度——记账选它则这笔钱不计入任何个人；支持改名（如"家用"），
 *   不允许删除；付款人下拉排除它（付款必须是真人）
 */
export interface DbFamilyMember {
  id: string
  family_id: string
  name: string
  type: 'adult' | 'child' | 'pet' | 'family'
  linked_profile_id: string | null
  created_at: string
  // v2026-09-04 创建者驱离成员用:非空表示已被移出家庭(行保留以支撑历史账单)
  kicked_at?: string | null
}
