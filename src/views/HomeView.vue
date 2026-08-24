<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useExpenseStore } from '@/stores/expense'
import { useCategoryStore } from '@/stores/category'
import { usePaymentAccountStore } from '@/stores/paymentAccount'
import { useFamilyStore } from '@/stores/family'
import { useAuthStore } from '@/stores/auth'
import { notify } from '@/lib/notify'
import { isSupabaseConfigured } from '@/lib/supabase'
import { displayNameOf } from '@/lib/displayName'

const store = useExpenseStore()
const categoryStore = useCategoryStore()
const accountStore = usePaymentAccountStore()
const familyStore = useFamilyStore()
const auth = useAuthStore()

const formVisible = ref(false)
const filterVisible = ref(false)
const editingId = ref<string | null>(null)

const form = ref({
  amount: '',
  categoryId: '',
  accountId: '',
  memberId: '',
  spentAt: new Date(),
  note: ''
})

const isEditing = computed(() => editingId.value !== null)

const filterRange = computed({
  get: () => store.filter.range,
  set: (v: any) => (store.filter.range = v)
})

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

const currentUserId = computed(() => auth.user?.id || auth.profile?.id || '')

onMounted(() => {
  // 防御：如果 memberId 没值且家庭成员已加载，默认选自己
  if (!form.value.memberId && currentUserId.value) {
    form.value.memberId = currentUserId.value
  }
})

function openForm() {
  editingId.value = null
  form.value = {
    amount: '',
    categoryId: categoryStore.items[0]?.id || '',
    accountId: accountStore.items[0]?.id || '',
    memberId: currentUserId.value || memberOptions.value[0]?.id || '',
    spentAt: new Date(),
    note: ''
  }
  formVisible.value = true
}

function openEdit(e: any) {
  editingId.value = e.id
  form.value = {
    amount: String(e.amount),
    categoryId: e.category_id,
    accountId: e.account_id || accountStore.items[0]?.id || '',
    memberId: e.member_id,
    spentAt: new Date(e.spent_at),
    note: e.note || ''
  }
  formVisible.value = true
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
  if (editingId.value) {
    // 编辑模式
    const r = await store.update(editingId.value, {
      amount: amt,
      categoryId: form.value.categoryId,
      accountId: form.value.accountId,
      memberId: form.value.memberId,
      spentAt: form.value.spentAt.toISOString(),
      note: form.value.note.trim().slice(0, 200)
    })
    if (r.ok) {
      formVisible.value = false
      editingId.value = null
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
      spentAt: form.value.spentAt.toISOString(),
      note: form.value.note.trim().slice(0, 200)
    })
    if (r.ok) {
      formVisible.value = false
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

function canEditExpense(e: any) {
  // 原型模式：所有账单都能删
  if (!isSupabaseConfigured) return true
  return e.creator_id === currentUserId.value
}

function getMemberLabel(id: string) {
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

    <div class="list-card">
      <div class="list-head">
        <span>消费时间</span>
        <span>成员</span>
        <span>分类</span>
        <span>账户</span>
        <span>备注</span>
        <span style="text-align: right">金额</span>
        <span style="text-align: right">操作</span>
      </div>
      <div v-for="e in store.filteredExpenses" :key="e.id" class="list-row">
        <span class="cell-time">{{ formatDate(e.spent_at) }}</span>
        <span>{{ getMemberLabel(e.member_id) }}</span>
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
            :disabled="!canEditExpense(e)"
            @click="openEdit(e)"
          >
            <el-icon><Edit /></el-icon>
          </el-button>
          <el-button
            text
            type="danger"
            size="small"
            :disabled="!canEditExpense(e)"
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

    <el-dialog v-model="formVisible" :title="isEditing ? '编辑账单' : '记一笔支出'" width="540px">
      <el-form label-position="top">
        <el-form-item label="金额" required>
          <el-input v-model="form.amount" placeholder="0.00" type="number" step="0.01" max="999999.99" size="large">
            <template #prepend>¥</template>
          </el-input>
        </el-form-item>

        <el-form-item label="分类" required>
          <div class="cat-grid">
            <button
              v-for="c in categoryStore.items"
              :key="c.id"
              class="cat-cell"
              :class="{ active: form.categoryId === c.id }"
              type="button"
              @click="form.categoryId = c.id"
            >
              <span class="cat-icon-lg">{{ c.icon }}</span>
              <span>{{ c.name }}</span>
            </button>
          </div>
        </el-form-item>

        <el-form-item label="支付账户" required>
          <el-select v-model="form.accountId" size="large" style="width: 100%" placeholder="选择用什么付的">
            <el-option v-for="a in accountOptions" :key="a.id" :label="a.label" :value="a.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="消费成员" required>
          <el-select v-model="form.memberId" size="large" style="width: 100%">
            <el-option v-for="m in memberOptions" :key="m.id" :label="m.label" :value="m.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="消费时间" required>
          <el-date-picker
            v-model="form.spentAt"
            type="datetime"
            size="large"
            style="width: 100%"
            :max-date="new Date()"
            format="YYYY-MM-DD HH:mm"
            value-format="x"
          />
        </el-form-item>

        <el-form-item label="备注">
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
        <el-button @click="formVisible = false; editingId = null">取消</el-button>
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
        <el-form-item label="成员">
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
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0;
}
.add-btn {
  background: var(--color-primary);
  border-color: var(--color-primary);
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
  padding: 20px;
  box-shadow: var(--shadow-card);
}
.stat-card.highlight {
  background: linear-gradient(135deg, #fff1ea, #fff8f3);
  border: 1px solid var(--color-primary);
}
.stat-label {
  color: var(--color-text-soft);
  font-size: 13px;
  margin-bottom: 8px;
}
.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}

.list-card {
  background: #fff;
  border-radius: 12px;
  padding: 8px 0;
  box-shadow: var(--shadow-card);
}
.list-head,
.list-row {
  display: grid;
  grid-template-columns: 1.1fr 0.7fr 1.1fr 0.9fr 1.4fr 1fr 0.7fr;
  align-items: center;
  padding: 12px 20px;
  font-size: 13px;
}
.list-head {
  color: var(--color-text-soft);
  font-weight: 500;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  padding: 12px 20px 8px;
}
.list-row {
  border-bottom: 1px solid #f0f1f2;
  transition: background 0.1s;
}
.list-row:hover {
  background: #fafbfc;
}
.list-row:last-child {
  border-bottom: none;
}
.cell-time {
  color: var(--color-text-soft);
  font-variant-numeric: tabular-nums;
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
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.cell-actions {
  text-align: right;
}
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  background: var(--color-primary-soft);
  border-radius: 12px;
  color: var(--color-primary);
  font-size: 12px;
}
.acc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  background: #ecf5ff;
  border-radius: 12px;
  color: #5b8ff9;
  font-size: 12px;
}
.acc-icon {
  font-size: 14px;
}
.cat-icon {
  font-size: 14px;
}
.img-icon {
  font-size: 16px;
  color: var(--color-primary);
}
.muted {
  color: #c0c4cc;
}
.empty {
  text-align: center;
  color: #c0c4cc;
  padding: 60px 0;
  font-size: 14px;
}

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
  transition: all 0.15s;
}
.cat-cell:hover {
  border-color: var(--color-primary);
}
.cat-cell.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.cat-icon-lg {
  font-size: 22px;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
</style>
