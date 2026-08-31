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
import {
  getRecentCategoryIds,
  markCategoryUsed
} from '@/lib/recentCategories'

const store = useExpenseStore()
const categoryStore = useCategoryStore()
const accountStore = usePaymentAccountStore()
const familyStore = useFamilyStore()
const auth = useAuthStore()

const formVisible = ref(false)
const filterVisible = ref(false)
const editingId = ref<string | null>(null)
const listEl = ref<HTMLElement | null>(null)

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
  memberId: '',
  payerId: '',
  spentAt: new Date(),
  note: ''
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
  // 消费成员
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
  // 每次进入首页都重新拉一次成员列表,保证最新（SettingsView 加成员后能立即反映）
  await familyStore.load()
  // 防御：如果 memberId 没值且家庭成员已加载，默认选自己
  if (!form.value.memberId && currentFamilyMemberId.value) {
    form.value.memberId = currentFamilyMemberId.value
  }
  // payerId 同理
  if (!form.value.payerId && currentFamilyMemberId.value) {
    form.value.payerId = currentFamilyMemberId.value
  }
})

function openForm() {
  editingId.value = null
  form.value = {
    amount: '',
    categoryId: categoryStore.items[0]?.id || '',
    accountId: accountStore.items[0]?.id || '',
    memberId: currentFamilyMemberId.value || memberOptions.value[0]?.id || '',
    payerId: currentFamilyMemberId.value || memberOptions.value[0]?.id || '',
    spentAt: new Date(),
    note: ''
  }
  formVisible.value = true
  nextTick(() => amountInputRef.value?.focus())
}

function openEdit(e: any) {
  editingId.value = e.id
  form.value = {
    amount: String(e.amount),
    categoryId: e.category_id,
    accountId: e.account_id || accountStore.items[0]?.id || '',
    memberId: e.member_id,
    payerId: e.payer_id || e.member_id,
    spentAt: new Date(e.spent_at),
    note: e.note || ''
  }
  formVisible.value = true
}

function closeForm() {
  formVisible.value = false
  editingId.value = null
}

async function submitForm() {
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
  if (!form.value.memberId) {
    notify.error('请选择消费成员')
    return
  }
  if (!form.value.payerId) {
    notify.error('请选择付款人')
    return
  }
  if (editingId.value) {
    // 编辑模式
    const r = await store.update(editingId.value, {
      amount: amt,
      categoryId: form.value.categoryId,
      accountId: form.value.accountId,
      memberId: form.value.memberId,
      payerId: form.value.payerId,
      spentAt: form.value.spentAt.toISOString(),
      note: form.value.note.trim().slice(0, 200)
    })
    if (r.ok) {
      markCategoryUsed(familyStore.family?.id, form.value.categoryId)
      closeForm()
      notify.success(r.message)
    } else {
      notify.error(r.message)
    }
  } else {
    // 新增模式
    const r = await store.add({
      amount: amt,
      categoryId: form.value.categoryId,
      accountId: form.value.accountId,
      memberId: form.value.memberId,
      payerId: form.value.payerId,
      spentAt: form.value.spentAt.toISOString(),
      note: form.value.note.trim().slice(0, 200)
    })
    if (r.ok) {
      markCategoryUsed(familyStore.family?.id, form.value.categoryId)
      closeForm()
      notify.success(r.message)
    } else {
      notify.error(r.message)
    }
  }
}

async function deleteOne(id: string) {
  try {
    await ElMessageBox.confirm('确定删除这笔账单吗？', '提示', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    const r = await store.remove(id)
    if (r.ok) notify.success(r.message)
    else notify.error(r.message)
  } catch {}
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
      <div class="stat-card">
        <div class="stat-label">今日支出</div>
        <div class="stat-value">{{ fmtMoney(store.todayTotal) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">本月支出</div>
        <div class="stat-value">{{ fmtMoney(store.monthTotal) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">本年支出</div>
        <div class="stat-value">{{ fmtMoney(store.yearTotal) }}</div>
      </div>
      <div class="stat-card highlight">
        <div class="stat-label">筛选区间合计</div>
        <div class="stat-value">{{ fmtMoney(store.totalAmount) }}</div>
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

    <MemberStatsPanel @jump-to-list="onJumpToList" />

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
      <div v-for="e in store.filteredExpenses" :key="e.id" class="list-row">
        <span class="cell-time">{{ formatDate(e.spent_at) }}</span>
        <span class="cell-member">
          <span class="member-main">{{ getMemberLabel(e.member_id) }}</span>
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
            @click="deleteOne(e.id)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </span>
      </div>
      <div v-if="store.filteredExpenses.length === 0" class="empty">
        暂无账单
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
          >
            <template #prepend><span class="amount-prepend">¥</span></template>
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
            <el-select v-model="form.memberId" size="default" style="width: 100%">
              <el-option v-for="m in memberOptions" :key="m.id" :label="m.label" :value="m.id" />
            </el-select>
          </el-form-item>

          <el-form-item label="付款人" required>
            <el-select v-model="form.payerId" size="default" style="width: 100%">
              <el-option v-for="m in memberOptions" :key="m.id" :label="m.label" :value="m.id" />
            </el-select>
          </el-form-item>
        </div>

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
              value-format="x"
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
        <el-button @click="closeForm">取消</el-button>
        <el-button
          type="primary"
          :disabled="!form.amount || !form.categoryId || !form.accountId || !form.memberId"
          @click="submitForm"
        >
          {{ isEditing ? '保存修改' : '提交' }}
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
.home {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 20px;
}
.page-title {
  font-size: 24px;
  margin: 0 0 4px;
}
.page-sub {
  margin: 0;
  color: var(--color-text-soft);
  font-size: 14px;
}
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
.stat-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: var(--shadow-card);
}
.stat-card.highlight {
  background: linear-gradient(135deg, #f56c2c, #ff9d4d);
  color: #fff;
}
.stat-card.highlight .stat-label {
  color: rgba(255, 255, 255, 0.85);
}
.stat-label {
  color: var(--color-text-soft);
  font-size: 13px;
  margin-bottom: 6px;
}
.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.stat-card.highlight .stat-value {
  color: #fff;
}
.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.active-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.active-label {
  font-size: 13px;
  color: var(--color-text-soft);
}
.list-card {
  background: #fff;
  border-radius: 12px;
  padding: 4px 24px;
  box-shadow: var(--shadow-card);
  margin-bottom: 20px;
}
.list-head,
.list-row {
  display: grid;
  grid-template-columns: 100px 1.4fr 1fr 1fr 1.4fr 90px 90px;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  font-size: 13px;
}
.list-head {
  color: var(--color-text-soft);
  font-weight: 500;
  border-bottom: 1px solid var(--color-border);
}
.list-row {
  border-bottom: 1px solid var(--color-border);
}
.list-row:last-child {
  border-bottom: none;
}
.cell-time {
  color: var(--color-text-soft);
  font-variant-numeric: tabular-nums;
}
.cell-member {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.member-main {
  color: var(--color-text);
  font-weight: 500;
}
.member-payer {
  font-size: 11px;
  color: var(--color-text-soft);
}
.cat-chip,
.acc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #fafbfc;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.cell-note {
  color: var(--color-text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-amount {
  text-align: right;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.cell-actions {
  text-align: right;
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: #c0c4cc;
}
.expense-form .form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.amount-prepend {
  font-weight: 600;
  color: var(--color-primary);
}
.muted {
  color: var(--color-text-soft);
}
</style>
