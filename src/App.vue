<script setup lang="ts">
import { onMounted, watch, ref } from 'vue'
import { RouterView } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFamilyStore } from '@/stores/family'
import { useCategoryStore } from '@/stores/category'
import { usePaymentAccountStore } from '@/stores/paymentAccount'
import { useExpenseStore } from '@/stores/expense'
import { resetBusinessState } from '@/lib/resetBusinessState'
import UpdateDialog from '@/components/UpdateDialog.vue'

const auth = useAuthStore()
const family = useFamilyStore()
const category = useCategoryStore()
const paymentAccount = usePaymentAccountStore()
const expense = useExpenseStore()

// 防止 onMounted + watch 同时触发跑两遍
let loadingPromise: Promise<void> | null = null
const ready = ref(false)

async function bootstrapBusinessData() {
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    if (auth.isAuthenticated && auth.profile?.family_id) {
      await Promise.all([family.load(), category.load(), paymentAccount.load()])
      // 等分类就绪后再拉账单（避免外键关系对不上）
      await expense.load()
    } else {
      resetBusinessState()
    }
  })()
  try {
    await loadingPromise
  } finally {
    loadingPromise = null
  }
}

onMounted(async () => {
  await auth.init()
  await bootstrapBusinessData()
  ready.value = true
})

// 监听登录态：onMounted 之后 uid 变化就重载
watch(
  () => auth.user?.id || auth.profile?.id || '',
  async (newId, oldId) => {
    if (!ready.value) return
    if (newId === oldId) return
    if (newId) {
      await auth.refreshProfile()
      await bootstrapBusinessData()
    } else {
      resetBusinessState()
    }
  }
)

// 家庭绑定变化（创建/加入家庭）→ 拉业务数据
watch(
  () => auth.profile?.family_id || '',
  async (newFid, oldFid) => {
    if (!ready.value) return
    if (newFid === oldFid) return
    if (newFid) {
      await bootstrapBusinessData()
    }
  }
)
</script>

<template>
  <RouterView />
  <UpdateDialog />
</template>

<style>
#app {
  height: 100vh;
  width: 100vw;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>
