import { useFamilyStore } from '@/stores/family'
import { useCategoryStore } from '@/stores/category'
import { usePaymentAccountStore } from '@/stores/paymentAccount'
import { useExpenseStore } from '@/stores/expense'
import { useUiStore } from '@/stores/ui'

/**
 * 清空所有业务 store + 业务相关 localStorage key
 * 账号切换（A→退出→B，或 A 直接换邮箱+码）时必须调一次
 */
export function resetBusinessState() {
  useFamilyStore().reset()
  useCategoryStore().reset()
  usePaymentAccountStore().reset()
  useExpenseStore().reset()
  useUiStore().globalLoading = false
  // 业务缓存 key（如有）一并清掉
  for (const k of ['homeledger_profile_cache']) {
    try { localStorage.removeItem(k) } catch {}
  }
}
