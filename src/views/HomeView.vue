<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useExpenseStore } from '@/stores/expense'
import { useCategoryStore } from '@/stores/category'
import { usePaymentAccountStore } from '@/stores/paymentAccount'
import { useFamilyStore } from '@/stores/family'
import { useAuthStore } from '@/stores/auth'
import { notify } from '@/lib/notify'
import { displayNameOf } from '@/lib/displayName'
import MemberStatsPanel from '@/components/MemberStatsPanel.vue'
import { useAnimatedNumber } from '@/lib/useAnimatedNumber'
import {
  getRecentCategoryIds,
  markCategoryUsed
} from '@/lib/recentCategories'

const store = useExpenseStore()

// 统计卡片数字滚动过渡：切换筛选/记账时数值平滑变化，避免生硬跳变
const todayTotalDisplay = useAnimatedNumber(() => store.todayTotal)
const monthTotalDisplay = useAnimatedNumber(() => store.monthTotal)
const yearTotalDisplay = useAnimatedNumber(() => store.yearTotal)
const totalAmountDisplay = useAnimatedNumber(() => store.totalAmount)
const categoryStore = useCategoryStore()
const accountStore = usePaymentAccountStore()
const familyStore = useFamilyStore()
const auth = useAuthStore()

const formVisible = ref(false)
const filterVisible = ref(false)
const editingId = ref<string | null>(null)
const listEl = ref<HTMLElement | null>(null)
// 成员统计图引用：记账/分摊/编辑/删除成功后调 reload() 让图重算
const statsPanelRef = ref<{ reload: () => Promise<void> } | null>(null)
// 提交锁：避免网络往返期间用户重复点击/回车导致重复记账
const submitting = ref(false)

// 成员统计点击柱子 → 跳到列表 + 预填 memberIds（MemberStatsPanel emit）
async function onJumpToList(memberId: string) {
  await nextTick()
  listEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const amountInputRef = ref<HTMLInputElement | null>(null)

const form = ref({
  amount: '',
  categoryId: '',
  accountId: '',
  memberIds: [] as string[],
  payerId: '',
  spentAt: new Date(),
  note: '',
  // v2026-09-01 多人分摊（方案 C）
  splitMode: 'equal' as 'equal' | 'custom',
  splitAmounts: {} as Record<string, number>
})

const isEditing = computed(() => editingId.value !== null)

const recentCategoryIds = computed(() =>
  getRecentCategoryIds(familyStore.family?.id)
)

const categoryOptions = computed(() => {
  // 最近用过的置顶 + 其他按 sort_order 排，el-select 会按这个顺序展示
  const map = new Map(categoryStore.items.map((c) => [c.id, c]))
  const recents = recentCategoryIds.value
    .map((id) => map.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
  const recentSet = new Set(recentCategoryIds.value)
  const others = categoryStore.items.filter((c) => !recentSet.has(c.id))
  const all = [...recents, ...others]
  return all.map((c) => ({
    id: c.id,
    label: `${c.icon}  ${c.name}`,
    raw: c
  }))
})

const filterRange = computed({
  get: () => store.filter.range,
  set: (v: any) => (store.filter.range = v)
})

// 当前生效的筛选条件 chips（时间维度走顶部 radio,这里只展示成员/分类/金额）
const activeFilterChips = computed(() => {
  const chips: { key: string; label: string; onClose: () => void }[] = []
  // 成员
  for (const mid of store.filter.memberIds) {
    const m = familyStore.members.find((x) => x.id === mid)
    const label = m ? displayNameOf(m) : mid.slice(0, 8)
    chips.push({
      key: 'member-' + mid,
      label: '消费成员: ' + label,
      onClose: () => {
        store.filter.memberIds = store.filter.memberIds.filter((x) => x !== mid)
      }
    })
  }
  // 分类
  for (const cid of store.filter.categoryIds) {
    const c = categoryStore.items.find((x) => x.id === cid)
    const label = c ? c.name : cid.slice(0, 8)
    chips.push({
      key: 'cat-' + cid,
      label: '分类: ' + label,
      onClose: () => {
        store.filter.categoryIds = store.filter.categoryIds.filter((x) => x !== cid)
      }
    })
  }
  // 金额
  if (store.filter.minAmount != null || store.filter.maxAmount != null) {
    const min = store.filter.minAmount ?? '不限'
    const max = store.filter.maxAmount ?? '不限'
    chips.push({
      key: 'amount',
      label: `金额: ¥${min} ~ ¥${max}`,
      onClose: () => {
        store.filter.minAmount = undefined
        store.filter.maxAmount = undefined
      }
    })
  }
  return chips
})

function clearAllFilters() {
  store.filter.memberIds = []
  store.filter.categoryIds = []
  store.filter.minAmount = undefined
  store.filter.maxAmount = undefined
}

const memberOptions = computed(() =>
  familyStore.members.map((m) => ({
    id: m.id,
    label: displayNameOf(m)
  }))
)

const accountOptions = computed(() =>
  accountStore.items.map((a) => ({
    id: a.id,
    label: `${a.icon} ${a.name}`
  }))
)

/**
 * v1.1 找到当前登录用户对应的 family_member 行（用 linked_profile_id 匹配）
 * 记账表单的"消费成员"默认选这个
 */
const currentFamilyMember = computed(() => {
  return familyStore.members.find((m) => m.linked_profile_id === auth.user?.id) || null
})
const currentFamilyMemberId = computed(() => currentFamilyMember.value?.id || '')

onMounted(async () => {
  // 家庭成员由 App.vue bootstrap 统一拉，HomeView 不再重复 load
  //（之前"if (members.length === 0) await load()" 仍然会与 App.vue 并发触发，
  //  因为 HomeView 是子组件，onMounted 早于 App.vue onMounted 完成；并发到 supabase
  //  就是 2 个 family_members 请求。SettingsView 加成员直接 push 到 store.value，
  //  HomeView 第二次进入会拿到最新值）
  // 防御：如果 memberIds 没值且家庭成员已加载，默认选自己
  if (form.value.memberIds.length === 0 && currentFamilyMemberId.value) {
    form.value.memberIds = [currentFamilyMemberId.value]
  }
  // payerId 同理
  if (!form.value.payerId && currentFamilyMemberId.value) {
    form.value.payerId = currentFamilyMemberId.value
  }
})

function openForm() {
  editingId.value = null
  const defaultMid = currentFamilyMemberId.value || memberOptions.value[0]?.id || ''
  form.value = {
    amount: '',
    categoryId: categoryStore.items[0]?.id || '',
    accountId: accountStore.items[0]?.id || '',
    memberIds: defaultMid ? [defaultMid] : [],
    payerId: currentFamilyMemberId.value || memberOptions.value[0]?.id || '',
    spentAt: new Date(),
    note: '',
    splitMode: 'equal',
    splitAmounts: {}
  }
  formVisible.value = true
  nextTick(() => amountInputRef.value?.focus())
}

function openEdit(e: any) {
  // 分摊记录必须整组处理，禁止单独编辑
  if (e.group_id) {
    notify.info('分摊记录需整组处理，暂不支持单独编辑。如需修改，请删除整组后重新记账')
    return
  }
  editingId.value = e.id
  form.value = {
    amount: String(e.amount),
    categoryId: e.category_id,
    accountId: e.account_id || accountStore.items[0]?.id || '',
    memberIds: [e.member_id],
    payerId: e.payer_id || e.member_id,
    spentAt: new Date(e.spent_at),
    note: e.note || '',
    splitMode: 'equal',
    splitAmounts: {}
  }
  formVisible.value = true
}

function closeForm() {
  formVisible.value = false
  editingId.value = null
  submitting.value = false
}

async function submitForm() {
  // 防止重复提交：网络往返期间用户再次点击/按回车会被直接拦掉
  if (submitting.value) return
  submitting.value = true
  try {
    // 防御性归一：el-date-picker 默认写回 Date 对象，但若加了 value-format='x' 会变成 number
    // 这里统一转成 Date 再 toISOString,避免 "toISOString is not a function" 报错
    const spentAtDate =
      form.value.spentAt instanceof Date
        ? form.value.spentAt
        : new Date(form.value.spentAt)
    if (Number.isNaN(spentAtDate.getTime())) {
      notify.error('消费时间无效')
      return
    }
    const amt = parseFloat(form.value.amount)
    if (!amt || amt <= 0 || amt > 999999.99) {
      notify.error('金额必须大于 0 且不超过 999999.99')
      return
    }
    if (!form.value.categoryId) {
      notify.error('请选择分类')
      return
    }
    if (!form.value.accountId) {
      notify.error('请选择支付账户')
      return
    }
    if (form.value.memberIds.length === 0) {
      notify.error('请选择消费成员')
      return
    }
    if (!form.value.payerId) {
      notify.error('请选择付款人')
      return
    }
    if (editingId.value) {
      // 编辑模式（分摊记录已在 openEdit 拦截，这里只处理单条）
      const r = await store.update(editingId.value, {
        amount: amt,
        categoryId: form.value.categoryId,
        accountId: form.value.accountId,
        memberId: form.value.memberIds[0],
        payerId: form.value.payerId,
        spentAt: spentAtDate.toISOString(),
        note: form.value.note.trim().slice(0, 200)
      })
      if (r.ok) {
        markCategoryUsed(familyStore.family?.id, form.value.categoryId)
        closeForm()
        notify.success(r.message)
        void statsPanelRef.value?.reload()
      } else {
        notify.error(r.message)
      }
    } else if (form.value.memberIds.length > 1) {
      // 多人分摊（方案 C）：按均分/自定义拆分后批量插入
      if (form.value.splitMode === 'custom') {
        const total = splitTotal.value
        if (Math.abs(total - amt) > 0.01) {
          notify.error(`分摊金额合计 ¥${total.toFixed(2)} 与总金额 ¥${amt.toFixed(2)} 不一致，请调整`)
          return
        }
      }
      const splits = splitPreview.value
        .map((s) => ({ memberId: s.memberId, amount: round2(s.amount) }))
        .filter((s) => s.amount > 0)
      const r = await store.addShared({
        splits,
        payerId: form.value.payerId,
        categoryId: form.value.categoryId,
        accountId: form.value.accountId,
        spentAt: spentAtDate.toISOString(),
        note: form.value.note.trim().slice(0, 200)
      })
      if (r.ok) {
        markCategoryUsed(familyStore.family?.id, form.value.categoryId)
        closeForm()
        notify.success(r.message)
        void statsPanelRef.value?.reload()
      } else {
        notify.error(r.message)
      }
    } else {
      // 新增模式：单条
      const r = await store.add({
        amount: amt,
        categoryId: form.value.categoryId,
        accountId: form.value.accountId,
        memberId: form.value.memberIds[0],
        payerId: form.value.payerId,
        spentAt: spentAtDate.toISOString(),
        note: form.value.note.trim().slice(0, 200)
      })
      if (r.ok) {
        markCategoryUsed(familyStore.family?.id, form.value.categoryId)
        closeForm()
        notify.success(r.message)
        void statsPanelRef.value?.reload()
      } else {
        notify.error(r.message)
      }
    }
  } finally {
    submitting.value = false
  }
}

async function deleteOne(e: any) {
  const isGroup = !!e.group_id
  try {
    await ElMessageBox.confirm(
      isGroup
        ? '该记录属于多人分摊，删除后将连同整组记录一并删除，确定吗？'
        : '确定删除这笔账单吗？',
      '提示',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消'
      }
    )
    const r = await store.remove(e.id)
    if (r.ok) {
      notify.success(r.message)
      void statsPanelRef.value?.reload()
    } else {
      notify.error(r.message)
    }
  } catch {}
}

// ===== 多人分摊（方案 C）：金额拆分工具 =====
function round2(n: number) {
  return Math.round(n * 100) / 100
}

/** 均分：总金额按人数拆分，最后一人补齐差额，保证总和精确 */
function equalSplits(amount: number, memberIds: string[]): { memberId: string; amount: number }[] {
  const n = memberIds.length
  if (n === 0) return []
  const per = round2(amount / n)
  return memberIds.map((id, i) => ({
    memberId: id,
    amount: i === n - 1 ? round2(amount - per * (n - 1)) : per
  }))
}

/** 分摊预览：均分自动算，自定义用输入值 */
const splitPreview = computed(() => {
  const amt = parseFloat(form.value.amount) || 0
  const ids = form.value.memberIds
  if (ids.length === 0) return []
  if (form.value.splitMode === 'custom') {
    return ids.map((id) => ({
      memberId: id,
      name: getMemberLabel(id),
      amount: form.value.splitAmounts[id] || 0
    }))
  }
  return equalSplits(amt, ids).map((s) => ({
    memberId: s.memberId,
    name: getMemberLabel(s.memberId),
    amount: s.amount
  }))
})

const splitTotal = computed(() => splitPreview.value.reduce((s, x) => s + x.amount, 0))

/** 把均分值预填到自定义金额输入框，方便微调 */
function recomputeSplitAmounts() {
  const amt = parseFloat(form.value.amount) || 0
  const map: Record<string, number> = {}
  equalSplits(amt, form.value.memberIds).forEach((s) => (map[s.memberId] = s.amount))
  form.value.splitAmounts = map
}

function onSplitModeChange(mode: 'equal' | 'custom') {
  if (mode === 'custom') recomputeSplitAmounts()
}

function onMembersChange() {
  if (form.value.splitMode === 'custom') recomputeSplitAmounts()
}

/**
 * 消费成员下拉框值统一入口：
 * - 新增（多选）：直接是 string[]
 * - 编辑（单选）：是 string，需包回数组，保持 form.memberIds 始终为数组
 */
function onMemberSelectUpdate(v: string | string[]) {
  form.value.memberIds = Array.isArray(v) ? v : (v ? [v] : [])
  onMembersChange()
}

/**
 * 家庭成员可编辑/删除账单
 * v2026-08-26 放开：原限制仅创建者（creator_id === currentUserId），
 * 与数据库 RLS 一致（UPDATE/DELETE 策略均为 is_family_member(family_id)）
 */
function canEditExpense() {
  return true
}

function getMemberLabel(id: string) {
  return memberOptions.value.find((m) => m.id === id)?.label || '-'
}
function getPayerLabel(id: string) {
  return memberOptions.value.find((m) => m.id === id)?.label || '-'
}

function getCategory(id: string) {
  return categoryStore.items.find((c) => c.id === id)
}

function getAccount(id: string | null | undefined) {
  if (!id) return null
  return accountStore.items.find((a) => a.id === id) || null
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${m}-${day} ${hh}:${mm}`
}

function fmtMoney(n: number) {
  return '¥ ' + Number(n).toFixed(2)
}
</script>

<template>
  <div class="home">
    <div class="page-header">
      <div>
        <h2 class="page-title">家庭账单</h2>
        <p class="page-sub">
          {{ familyStore.family?.name || '家庭' }} · 共 {{ store.items.length }} 笔
        </p>
      </div>
      <el-button type="primary" size="large" class="add-btn" @click="openForm">
        <el-icon><Plus /></el-icon>
        <span style="margin-left: 4px">记一笔</span>
      </el-button>
    </div>

    <div class="stat-row">
      <div class="stat-card tone-orange">
        <div class="stat-icon"><el-icon><Sunny /></el-icon></div>
        <div class="stat-body">
          <div class="stat-label">今日支出</div>
          <div class="stat-value">{{ fmtMoney(todayTotalDisplay) }}</div>
        </div>
      </div>
      <div class="stat-card tone-blue">
        <div class="stat-icon"><el-icon><Calendar /></el-icon></div>
        <div class="stat-body">
          <div class="stat-label">本月支出</div>
          <div class="stat-value">{{ fmtMoney(monthTotalDisplay) }}</div>
        </div>
      </div>
      <div class="stat-card tone-green">
        <div class="stat-icon"><el-icon><TrendCharts /></el-icon></div>
        <div class="stat-body">
          <div class="stat-label">本年支出</div>
          <div class="stat-value">{{ fmtMoney(yearTotalDisplay) }}</div>
        </div>
      </div>
      <div class="stat-card highlight">
        <div class="stat-icon"><el-icon><Wallet /></el-icon></div>
        <div class="stat-body">
          <div class="stat-label">筛选区间合计</div>
          <div class="stat-value">{{ fmtMoney(totalAmountDisplay) }}</div>
        </div>
      </div>
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="filterRange" size="default">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="today">今日</el-radio-button>
        <el-radio-button value="yesterday">昨日</el-radio-button>
        <el-radio-button value="week">本周</el-radio-button>
        <el-radio-button value="month">本月</el-radio-button>
        <el-radio-button value="30d">近 30 天</el-radio-button>
      </el-radio-group>
      <el-button @click="filterVisible = true">
        <el-icon><Filter /></el-icon>
        <span style="margin-left: 4px">高级筛选</span>
      </el-button>
    </div>

    <!-- 当前生效的筛选条件(成员/分类/金额);点击 × 单独清除 -->
    <div v-if="activeFilterChips.length > 0" class="active-filters">
      <span class="active-label">当前筛选：</span>
      <el-tag
        v-for="chip in activeFilterChips"
        :key="chip.key"
        closable
        size="default"
        type="info"
        @close="chip.onClose()"
      >
        {{ chip.label }}
      </el-tag>
      <el-button text type="primary" size="small" @click="clearAllFilters">
        清空全部
      </el-button>
    </div>

    <MemberStatsPanel ref="statsPanelRef" @jump-to-list="onJumpToList" />

    <div ref="listEl" class="list-card">
      <div class="list-head">
        <span>消费时间</span>
        <span>消费成员</span>
        <span>分类</span>
        <span>支付账户</span>
        <span>备注</span>
        <span style="text-align: right">金额</span>
        <span style="text-align: right">操作</span>
      </div>
      <TransitionGroup name="row" tag="div" class="list-body">
        <div v-for="e in store.filteredExpenses" :key="e.id" class="list-row">
        <span class="cell-time">{{ formatDate(e.spent_at) }}</span>
        <span class="cell-member">
          <span class="member-main">
            {{ getMemberLabel(e.member_id) }}
            <span v-if="e.group_id" class="split-badge">分摊</span>
          </span>
          <span v-if="e.payer_id && e.payer_id !== e.member_id" class="member-payer">
            <span class="payer-prefix">{{ getPayerLabel(e.payer_id) }} 付</span>
          </span>
        </span>
        <span>
          <span class="cat-chip">
            <span class="cat-icon">{{ getCategory(e.category_id)?.icon }}</span>
            {{ getCategory(e.category_id)?.name }}
          </span>
        </span>
        <span>
          <span v-if="getAccount(e.account_id)" class="acc-chip">
            <span class="acc-icon">{{ getAccount(e.account_id)?.icon }}</span>
            {{ getAccount(e.account_id)?.name }}
          </span>
          <span v-else class="muted">-</span>
        </span>
        <span class="cell-note">{{ e.note || '-' }}</span>
        <span class="cell-amount">{{ fmtMoney(e.amount) }}</span>
        <span class="cell-actions">
          <el-button
            text
            type="primary"
            size="small"
            :disabled="!canEditExpense()"
            @click="openEdit(e)"
          >
            <el-icon><Edit /></el-icon>
          </el-button>
          <el-button
            text
            type="danger"
            size="small"
            :disabled="!canEditExpense()"
            @click="deleteOne(e)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </span>
        </div>
      </TransitionGroup>
      <div v-if="store.filteredExpenses.length === 0" class="empty">
        <div class="empty-icon"><el-icon><Wallet /></el-icon></div>
        <div class="empty-title">暂无账单</div>
        <div class="empty-hint">点击右上角「记一笔」开始记录家庭开支</div>
      </div>
    </div>

    <el-dialog
      v-model="formVisible"
      :title="isEditing ? '编辑账单' : '记一笔支出'"
      width="560px"
      :close-on-click-modal="false"
      @closed="closeForm"
    >
      <el-form label-position="top" class="expense-form">
        <el-form-item label="金额" required class="form-full">
          <el-input
            ref="amountInputRef"
            v-model="form.amount"
            placeholder="0.00"
            type="number"
            step="0.01"
            max="999999.99"
            size="large"
            class="amount-input"
          >
            <template #prefix><span class="amount-prefix">¥</span></template>
          </el-input>
        </el-form-item>

        <el-form-item label="分类" required class="form-full">
          <el-select
            v-model="form.categoryId"
            size="default"
            style="width: 100%"
            placeholder="选择分类"
            filterable
          >
            <el-option
              v-for="c in categoryOptions"
              :key="c.id"
              :label="c.label"
              :value="c.id"
            />
          </el-select>
        </el-form-item>

        <div class="form-row">
          <el-form-item label="消费成员" required>
            <el-select
              :model-value="isEditing ? (form.memberIds[0] || '') : form.memberIds"
              :multiple="!isEditing"
              :collapse-tags="!isEditing && form.memberIds.length > 1"
              size="default"
              style="width: 100%"
              :placeholder="isEditing ? '请选择消费成员' : '多选为多人分摊'"
              @update:model-value="onMemberSelectUpdate"
            >
              <el-option v-for="m in memberOptions" :key="m.id" :label="m.label" :value="m.id" />
            </el-select>
          </el-form-item>

          <el-form-item label="付款人" required>
            <el-select v-model="form.payerId" size="default" style="width: 100%">
              <el-option v-for="m in memberOptions" :key="m.id" :label="m.label" :value="m.id" />
            </el-select>
          </el-form-item>
        </div>

        <!-- 多人分摊（方案 C）：选 2 人及以上时出现 -->
        <el-form-item
          v-if="!isEditing && form.memberIds.length > 1"
          label="分摊方式"
          class="form-full"
        >
          <div class="split-block">
            <el-radio-group v-model="form.splitMode" size="default" @change="onSplitModeChange">
              <el-radio-button value="equal">按人数均分</el-radio-button>
              <el-radio-button value="custom">自定义金额</el-radio-button>
            </el-radio-group>

            <div v-if="form.splitMode === 'custom'" class="split-rows">
              <div v-for="mid in form.memberIds" :key="mid" class="split-row">
                <span class="split-name">{{ getMemberLabel(mid) }}</span>
                <el-input-number
                  v-model="form.splitAmounts[mid]"
                  :min="0"
                  :max="999999.99"
                  :precision="2"
                  :step="0.01"
                  :controls="false"
                  size="small"
                  style="width: 130px"
                />
                <span class="split-unit">元</span>
              </div>
            </div>

            <div class="split-preview">
              <span v-for="s in splitPreview" :key="s.memberId" class="split-chip">
                {{ s.name }} ¥{{ s.amount.toFixed(2) }}
              </span>
              <span
                class="split-total"
                :class="{
                  danger:
                    form.splitMode === 'custom' &&
                    Math.abs(splitTotal - (parseFloat(form.amount) || 0)) > 0.01
                }"
              >
                合计 ¥{{ splitTotal.toFixed(2) }}
              </span>
            </div>
          </div>
        </el-form-item>

        <div class="form-row">
          <el-form-item label="支付账户" required>
            <el-select v-model="form.accountId" size="default" style="width: 100%">
              <el-option v-for="a in accountOptions" :key="a.id" :label="a.label" :value="a.id" />
            </el-select>
          </el-form-item>

          <el-form-item label="消费时间" required>
            <el-date-picker
              v-model="form.spentAt"
              type="datetime"
              size="default"
              style="width: 100%"
              :max-date="new Date()"
              format="YYYY-MM-DD HH:mm"
            />
          </el-form-item>
        </div>

        <el-form-item label="备注" class="form-full">
          <el-input
            v-model="form.note"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="如：超市买菜 / 物业费"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="closeForm" :disabled="submitting">取消</el-button>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="
            submitting ||
            !form.amount ||
            !form.categoryId ||
            !form.accountId ||
            form.memberIds.length === 0
          "
          @click="submitForm"
        >
          {{
            isEditing
              ? '保存修改'
              : form.memberIds.length > 1
                ? `提交（${form.memberIds.length} 人分摊）`
                : '提交'
          }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="filterVisible" title="高级筛选" width="480px">
      <el-form label-position="top">
        <el-form-item label="分类">
          <el-select
            v-model="store.filter.categoryIds"
            multiple
            placeholder="不选则显示全部"
            style="width: 100%"
          >
            <el-option
              v-for="c in categoryStore.items"
              :key="c.id"
              :label="`${c.icon} ${c.name}`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="消费成员">
          <el-select
            v-model="store.filter.memberIds"
            multiple
            placeholder="不选则显示全部"
            style="width: 100%"
          >
            <el-option
              v-for="m in memberOptions"
              :key="m.id"
              :label="m.label"
              :value="m.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="金额区间">
          <div style="display: flex; gap: 10px; align-items: center">
            <el-input-number
              v-model="store.filter.minAmount"
              :min="0"
              :max="999999.99"
              placeholder="最小"
              controls-position="right"
            />
            <span>—</span>
            <el-input-number
              v-model="store.filter.maxAmount"
              :min="0"
              :max="999999.99"
              placeholder="最大"
              controls-position="right"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          @click="store.filter.categoryIds = []; store.filter.memberIds = []; store.filter.minAmount = undefined; store.filter.maxAmount = undefined"
        >
          清空
        </el-button>
        <el-button type="primary" @click="filterVisible = false">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* v2026-09-03 质感升级 */
.home {
  max-width: 1200px;
  margin: 0 auto;
  padding-bottom: 24px;
}
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 24px;
}
.page-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 4px;
  letter-spacing: -0.3px;
  background: linear-gradient(135deg, #1f2329 0%, #4a5160 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.page-sub {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0;
}
.add-btn {
  background: linear-gradient(135deg, #ff8f4d, #f56c2c) !important;
  border: none !important;
  box-shadow: 0 6px 18px -4px rgba(245, 108, 44, 0.45) !important;
  border-radius: 12px !important;
  padding: 12px 22px !important;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s !important;
  position: relative;
  overflow: hidden;
}
.add-btn::after {
  content: '';
  position: absolute;
  top: 0;
  left: -120%;
  width: 60%;
  height: 100%;
  background: linear-gradient(100deg, transparent 0%, rgba(255, 255, 255, 0.35) 50%, transparent 100%);
  transition: left 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}
.add-btn:hover,
.add-btn:focus {
  background: linear-gradient(135deg, #ff9d61, #f5753a) !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 10px 24px -4px rgba(245, 108, 44, 0.55) !important;
}
.add-btn:hover::after {
  left: 130%;
}
.add-btn:active {
  transform: translateY(0) !important;
}

/* === 统计卡片(沿用 .app-stat-card 的视觉,但保留模板类名) === */
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.stat-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 22px 24px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.05);
  overflow: hidden;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.stat-card::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -30%;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.18;
  pointer-events: none;
  transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.stat-card:hover {
  transform: translateY(-3px);
}
.stat-card:hover::before {
  opacity: 0.32;
}
.tone-orange::before { background: var(--color-primary); }
.tone-blue::before { background: var(--color-blue); }
.tone-green::before { background: var(--color-green); }

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.stat-card:hover .stat-icon {
  transform: scale(1.08) rotate(-4deg);
}
.tone-orange .stat-icon {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  box-shadow: 0 4px 12px -2px rgba(245, 108, 44, 0.3);
}
.tone-blue .stat-icon {
  background: var(--color-blue-soft);
  color: var(--color-blue);
  box-shadow: 0 4px 12px -2px rgba(79, 124, 255, 0.3);
}
.tone-green .stat-icon {
  background: var(--color-green-soft);
  color: var(--color-green);
  box-shadow: 0 4px 12px -2px rgba(47, 181, 95, 0.3);
}
.stat-body { flex: 1; min-width: 0; position: relative; z-index: 1; }
.stat-label {
  color: var(--color-text-soft);
  font-size: 13px;
  margin-bottom: 6px;
  font-weight: 500;
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
  white-space: nowrap;
}
.stat-card.highlight {
  background: linear-gradient(135deg, #ff8f4d 0%, #f56c2c 100%);
  border: none;
  color: #fff;
  box-shadow: 0 10px 28px -6px rgba(245, 108, 44, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.stat-card.highlight::before { display: none; }
.stat-card.highlight:hover {
  box-shadow: 0 14px 36px -6px rgba(245, 108, 44, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.stat-card.highlight .stat-icon {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  box-shadow: none;
}
.stat-card.highlight .stat-label { color: rgba(255, 255, 255, 0.88); }
.stat-card.highlight .stat-value { color: #fff; font-size: 28px; }

/* === 筛选条(玻璃面板) === */
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
  margin-bottom: 16px;
  transition: box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.filter-bar:hover {
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03), 0 0 0 1px rgba(245, 108, 44, 0.15);
}
.filter-bar :deep(.el-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.filter-bar :deep(.el-radio-button) {
  margin: 0;
  padding: 0;
  flex-shrink: 0;
}
.filter-bar :deep(.el-radio-button + .el-radio-button) { margin-left: 0; }
.filter-bar :deep(.el-radio-button__inner) {
  border: none !important;
  background: transparent !important;
  border-radius: 8px !important;
  padding: 8px 16px !important;
  box-shadow: none !important;
  color: var(--color-text-soft) !important;
  font-weight: 500 !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.filter-bar :deep(.el-radio-button__inner:hover) {
  color: var(--color-primary) !important;
  background: rgba(245, 108, 44, 0.06) !important;
}
.filter-bar :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: linear-gradient(135deg, var(--color-primary-soft) 0%, #ffe2d0 100%) !important;
  color: var(--color-primary) !important;
  font-weight: 600 !important;
  box-shadow: inset 0 0 0 1px rgba(245, 108, 44, 0.2) !important;
}
.filter-bar :deep(.el-button) {
  border-radius: 10px !important;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.filter-bar :deep(.el-button:hover) {
  border-color: var(--color-primary) !important;
  color: var(--color-primary) !important;
  background: var(--color-primary-soft) !important;
}
@media (max-width: 900px) {
  .filter-bar :deep(.el-radio-button__inner) {
    padding: 7px 12px !important;
  }
}

/* === 当前生效的筛选条件 === */
.active-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(245, 108, 44, 0.04) 0%, rgba(245, 108, 44, 0.01) 100%);
  border-radius: var(--radius-md);
  border: 1px solid rgba(245, 108, 44, 0.15);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
}
.active-filters .active-label {
  font-size: 13px;
  color: var(--color-text-soft);
  font-weight: 500;
}
.active-filters :deep(.el-tag) {
  border-radius: 999px !important;
  background: rgba(255, 255, 255, 0.8) !important;
  border-color: var(--color-border) !important;
}

/* === 列表卡片(玻璃 + 行 hover 渐变光带) === */
.list-card {
  position: relative;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 6px 0;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.05);
  overflow: hidden;
}

/* 列表行增删/重排过渡动画(优化版) */
.row-enter-active,
.row-leave-active {
  transition: opacity 0.32s cubic-bezier(0.16, 1, 0.3, 1), transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.row-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.row-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.row-leave-active {
  position: absolute;
  left: 0;
  right: 0;
}
.row-move {
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}

.list-head,
.list-row {
  display: grid;
  grid-template-columns: 1.1fr 0.7fr 1.1fr 0.9fr 1.4fr 1fr 0.7fr;
  align-items: center;
  padding: 13px 20px;
  font-size: 13px;
}
.list-head {
  color: var(--color-text-muted);
  font-weight: 600;
  background: linear-gradient(180deg, #fafbfc 0%, #f4f5f7 100%);
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  padding: 14px 20px 12px;
  letter-spacing: 0.3px;
}
.list-row {
  border-bottom: 1px solid #f2f3f5;
  transition: background 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}
.list-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--color-primary), var(--color-yellow));
  border-radius: 0 2px 2px 0;
  opacity: 0;
  transform: scaleY(0.4);
  transform-origin: center;
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.list-row:hover {
  background: linear-gradient(90deg, rgba(245, 108, 44, 0.04) 0%, transparent 100%);
}
.list-row:hover::before {
  opacity: 1;
  transform: scaleY(1);
}
.list-row:hover .cell-actions { opacity: 1; }
.list-row:last-child { border-bottom: none; }
.cell-time {
  color: var(--color-text-soft);
  font-variant-numeric: tabular-nums;
}
.cell-member {
  display: flex;
  flex-direction: column;
  gap: 3px;
  line-height: 1.3;
}
.member-main { color: var(--color-text); font-weight: 500; }
.member-payer { font-size: 11px; color: var(--color-text-soft); }
.payer-prefix {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
}
.cell-note {
  color: var(--color-text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 8px;
}
.cell-amount {
  text-align: right;
  font-weight: 700;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.2px;
  background: linear-gradient(135deg, var(--color-text) 0%, var(--color-primary) 120%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.cell-actions {
  text-align: right;
  opacity: 0.35;
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

/* === Chip 升级(带边框 + 阴影) === */
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: var(--color-primary-soft);
  border: 1px solid rgba(245, 108, 44, 0.15);
  border-radius: 999px;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.cat-chip:hover {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.acc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: var(--color-blue-soft);
  border: 1px solid rgba(79, 124, 255, 0.15);
  border-radius: 999px;
  color: var(--color-blue);
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.acc-chip:hover {
  background: var(--color-blue);
  color: #fff;
  border-color: var(--color-blue);
}
.acc-icon, .cat-icon { font-size: 14px; }
.img-icon { font-size: 16px; color: var(--color-primary); }
.muted { color: var(--color-text-muted); }

.empty {
  text-align: center;
  padding: 64px 0;
}
.empty-icon {
  font-size: 48px;
  color: var(--color-text-muted);
  opacity: 0.4;
  margin-bottom: 14px;
  display: inline-flex;
  width: 80px;
  height: 80px;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-soft);
  border-radius: 50%;
}
.empty-title {
  color: var(--color-text-soft);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}
.empty-hint { color: var(--color-text-muted); font-size: 13px; }

.cat-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  width: 100%;
}
.cat-cell {
  border: 1px solid var(--color-border);
  background: #fff;
  padding: 10px 4px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-soft);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.cat-cell:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px -2px rgba(245, 108, 44, 0.2);
  transform: translateY(-2px);
  color: var(--color-text);
}
.cat-cell.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  box-shadow: inset 0 0 0 1px var(--color-primary), 0 4px 12px -2px rgba(245, 108, 44, 0.3);
}
.cat-icon-lg { font-size: 22px; }
.hint { font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }

/* === 记账弹框:两列紧凑布局 === */
.expense-form :deep(.el-form-item) { margin-bottom: 14px; }
.expense-form :deep(.el-form-item__label) {
  padding-bottom: 2px;
  line-height: 1.2;
  font-size: 13px;
  font-weight: 500;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}
.form-row :deep(.el-form-item) { margin-bottom: 14px; }
.form-full { display: block; }

.amount-input :deep(.el-input__wrapper) {
  border-radius: 10px !important;
  padding: 4px 12px !important;
  box-shadow: 0 0 0 1px var(--color-border) inset !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.amount-input :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--color-primary) inset !important;
}
.amount-input :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 2px var(--color-primary) inset, 0 0 0 4px rgba(245, 108, 44, 0.12) !important;
}
.amount-input :deep(.el-input__prefix) { padding-right: 8px; }
.amount-prefix {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-primary);
  letter-spacing: 0;
}
.amount-input :deep(.el-input__inner) {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  height: 36px;
  line-height: 36px;
}

.cat-pick-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: #fff;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.cat-pick-btn:hover {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(245, 108, 44, 0.08);
}
.cat-pick-btn.empty { color: #c0c4cc; }
.cat-pick-btn.empty:hover { border-color: var(--color-primary); color: var(--color-primary); }
.cat-pick-icon { font-size: 22px; line-height: 1; }
.cat-pick-name { font-size: 15px; font-weight: 500; flex: 1; text-align: left; }
.cat-pick-arrow { color: #c0c4cc; font-size: 14px; }

.cat-step {
  max-height: 56vh;
  overflow-y: auto;
  padding: 4px 4px 8px;
}
.cat-section { margin-bottom: 14px; }
.cat-section:last-child { margin-bottom: 0; }
.cat-section-title {
  font-size: 12px;
  color: var(--color-text-soft);
  font-weight: 600;
  margin-bottom: 8px;
  padding-left: 2px;
  letter-spacing: 0.3px;
}
.cat-grid-6 {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}
.cat-cell-sm {
  border: 1px solid var(--color-border);
  background: #fff;
  padding: 10px 4px 8px;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-soft);
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  min-height: 72px;
  justify-content: center;
}
.cat-cell-sm:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
  box-shadow: 0 4px 12px -2px rgba(245, 108, 44, 0.2);
  transform: translateY(-2px);
}
.cat-cell-sm.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  box-shadow: inset 0 0 0 1px var(--color-primary), 0 4px 12px -2px rgba(245, 108, 44, 0.3);
}
.cat-icon-md { font-size: 22px; line-height: 1; }
.cat-name-sm { font-size: 12px; line-height: 1.2; }

.split-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--color-green-soft);
  color: var(--color-green);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  vertical-align: 1px;
  border: 1px solid rgba(47, 181, 95, 0.15);
}
.split-block { width: 100%; }
.split-block :deep(.el-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.split-block :deep(.el-radio-button) { margin: 0; padding: 0; }
.split-block :deep(.el-radio-button + .el-radio-button) { margin-left: 0; }
.split-block :deep(.el-radio-button__inner) {
  border: none !important;
  background: transparent !important;
  border-radius: 8px !important;
  padding: 6px 14px !important;
  box-shadow: none !important;
  color: var(--color-text-soft) !important;
  font-weight: 500 !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.split-block :deep(.el-radio-button__inner:hover) {
  color: var(--color-primary) !important;
  background: rgba(245, 108, 44, 0.06) !important;
}
.split-block :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: var(--color-primary-soft) !important;
  color: var(--color-primary) !important;
  font-weight: 600 !important;
  box-shadow: inset 0 0 0 1px var(--color-primary) !important;
}
.split-rows {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.split-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(245, 108, 44, 0.03);
  border-radius: 8px;
}
.split-name {
  min-width: 64px;
  font-size: 13px;
  color: var(--color-text);
  font-weight: 500;
}
.split-unit { font-size: 12px; color: var(--color-text-muted); }
.split-preview {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 10px 12px;
  background: var(--color-primary-soft);
  border-radius: 10px;
  border: 1px solid rgba(245, 108, 44, 0.12);
}
.split-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 500;
  border: 1px solid rgba(245, 108, 44, 0.15);
}
.split-total {
  font-size: 12px;
  color: var(--color-primary);
  margin-left: 4px;
  font-weight: 600;
}
.split-total.danger {
  color: var(--el-color-danger);
  font-weight: 700;
}

/* Dialog 整体升级 */
.home :deep(.el-dialog) {
  border-radius: 16px !important;
  overflow: hidden;
  box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.25) !important;
}
.home :deep(.el-dialog__header) {
  background: linear-gradient(135deg, rgba(245, 108, 44, 0.04) 0%, transparent 100%);
  padding: 20px 24px 16px !important;
  margin-right: 0 !important;
}
.home :deep(.el-dialog__title) {
  font-size: 17px;
  font-weight: 700;
}
.home :deep(.el-dialog__footer) {
  padding: 8px 24px 20px !important;
  border-top: 1px solid var(--color-border);
  margin-top: 8px;
}
.home :deep(.el-dialog__footer .el-button--primary) {
  background: linear-gradient(135deg, #ff8f4d, #f56c2c) !important;
  border: none !important;
  box-shadow: 0 4px 12px -2px rgba(245, 108, 44, 0.4) !important;
  border-radius: 10px !important;
  padding: 10px 22px !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.home :deep(.el-dialog__footer .el-button--primary:hover) {
  transform: translateY(-1px) !important;
  box-shadow: 0 8px 18px -2px rgba(245, 108, 44, 0.5) !important;
}

/* 响应式 */
@media (max-width: 1100px) {
  .stat-row { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .stat-row { grid-template-columns: 1fr; }
  .list-head { display: none; }
  .list-row { grid-template-columns: 1fr; gap: 4px; padding: 14px 16px; }
}

/* 可访问性:关闭所有动画 */
@media (prefers-reduced-motion: reduce) {
  .stat-card,
  .stat-card::before,
  .stat-icon,
  .list-row,
  .list-row::before,
  .add-btn,
  .add-btn::after,
  .cell-amount,
  .row-enter-active,
  .row-leave-active,
  .row-move {
    animation: none !important;
    transition: none !important;
  }
  .stat-card:hover,
  .list-row:hover,
  .add-btn:hover,
  .cat-cell:hover,
  .cat-cell-sm:hover {
    transform: none;
  }
}
</style>