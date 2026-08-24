// 数据库行类型（Supabase schema → TS 类型）
// v1.1 接 Supabase 时用

export interface DbProfile {
  id: string
  email: string
  family_id: string | null
  display_name: string | null
  joined_at: string
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
  category_id: string
  account_id: string | null
  amount: number
  spent_at: string
  note: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}
