<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { usePaymentAccountStore } from '@/stores/paymentAccount'
import { useExpenseStore } from '@/stores/expense'
import { notify } from '@/lib/notify'

const accountStore = usePaymentAccountStore()
const expenseStore = useExpenseStore()

onMounted(async () => {
  // 确保账单数据已加载，用于展示每个账户的累计支出
  await expenseStore.load()
})

/** 常用支付图标快捷选择 */
const ICON_CHOICES = ['💳', '💰', '📱', '🏦', '🧾', '🛒', '🐱', '✈️', '🎫', '🍔']

/** 金额格式化：千分位 + 两位小数 */
function fmtMoney(n: number) {
  const v = Number(n) || 0
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 该账户累计支出（基于已加载账单） */
function accountSpent(id: string) {
  return expenseStore.items.reduce(
    (s, e) => (e.account_id === id ? s + Number(e.amount) : s),
    0
  )
}

const showAddAccount = ref(false)
const editingAccountId = ref<string | null>(null)
const newAccountName = ref('')
const newAccountIcon = ref('💳')

function openAddAccount() {
  editingAccountId.value = null
  newAccountName.value = ''
  newAccountIcon.value = '💳'
  showAddAccount.value = true
}

function openEditAccount(a: { id: string; name: string; icon: string }) {
  editingAccountId.value = a.id
  newAccountName.value = a.name
  newAccountIcon.value = a.icon
  showAddAccount.value = true
}

function closeAccountDialog() {
  showAddAccount.value = false
  editingAccountId.value = null
  newAccountName.value = ''
  newAccountIcon.value = '💳'
}

async function saveAccount() {
  const name = newAccountName.value.trim()
  if (!name) {
    notify.warning('请输入支付账户名')
    return
  }
  if (accountStore.items.some((a) => a.name === name && a.id !== editingAccountId.value)) {
    notify.error('支付账户名已存在')
    return
  }
  let r
  if (editingAccountId.value) {
    r = await accountStore.update(editingAccountId.value, name, newAccountIcon.value)
  } else {
    r = await accountStore.add(name, newAccountIcon.value)
  }
  if (r.ok) {
    notify.success(r.message)
    closeAccountDialog()
  } else {
    notify.error(r.message)
  }
}

async function removeAccount(id: string) {
  try {
    await ElMessageBox.confirm('确定删除此支付账户？', '提示', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    const r = await accountStore.remove(id)
    if (r.ok) notify.success(r.message)
    else notify.error(r.message)
  } catch {}
}

// ===== 拖拽排序（系统账户与自定义账户均可移动）=====
const dragId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
const dragOverPos = ref<'before' | 'after'>('after')
const savingSort = ref(false)

function onDragStart(e: DragEvent, id: string) {
  if (savingSort.value) return
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(e: DragEvent, targetId: string) {
  if (savingSort.value) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dragOverPos.value = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  dragOverId.value = targetId
}

async function onDrop(e: DragEvent, targetId: string) {
  const from = dragId.value
  dragId.value = null
  dragOverId.value = null
  if (!from || from === targetId || savingSort.value) return
  const ids = accountStore.items.map((a) => a.id)
  const fromIdx = ids.indexOf(from)
  const toIdx = ids.indexOf(targetId)
  if (fromIdx < 0 || toIdx < 0) return
  ids.splice(fromIdx, 1)
  const insertAt = ids.indexOf(targetId) + (dragOverPos.value === 'after' ? 1 : 0)
  ids.splice(insertAt, 0, from)
  savingSort.value = true
  const r = await accountStore.reorder(ids)
  savingSort.value = false
  if (r.ok) notify.success(r.message)
  else notify.error(r.message)
}

function onDragEnd() {
  dragId.value = null
  dragOverId.value = null
}
</script>

<template>
  <div class="accounts">
    <div class="page-header">
      <div>
        <h2 class="page-title">支付账户管理</h2>
        <p class="page-sub">记账时选择用哪个支付账户，如花呗、招行信用卡等</p>
      </div>
      <el-button type="primary" size="large" class="add-btn" @click="openAddAccount">
        <el-icon><Plus /></el-icon>
        <span style="margin-left: 4px">新增支付账户</span>
      </el-button>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">
          <span class="section-icon"><el-icon><Wallet /></el-icon></span>
          全部账户
          <span class="section-count">{{ accountStore.items.length }}</span>
        </div>
        <p class="sort-hint">拖动左侧手柄调整顺序，所有账户均可移动</p>
      </div>
      <div class="acc-list">
        <div
          v-for="a in accountStore.items"
          :key="a.id"
          class="acc-row"
          :class="{
            dragging: dragId === a.id,
            'drag-over-before': dragOverId === a.id && dragOverPos === 'before',
            'drag-over-after': dragOverId === a.id && dragOverPos === 'after'
          }"
          @dragover.prevent="onDragOver($event, a.id)"
          @drop.prevent="onDrop($event, a.id)"
          @dragend="onDragEnd"
        >
          <span
            class="drag-handle"
            draggable="true"
            :title="savingSort ? '正在保存排序…' : '拖动排序'"
            @dragstart="onDragStart($event, a.id)"
          >
            <el-icon><Rank /></el-icon>
          </span>
          <span class="acc-row-icon" :class="{ 'is-default': a.is_default }">{{ a.icon }}</span>
          <span class="acc-row-info">
            <span class="acc-row-name">
              {{ a.name }}
              <span v-if="a.is_default" class="sys-tag">系统</span>
            </span>
            <span class="acc-row-spent">{{ fmtMoney(accountSpent(a.id)) }}</span>
          </span>
          <span v-if="!a.is_default" class="acc-actions">
            <el-button text type="primary" size="small" @click="openEditAccount(a)">编辑</el-button>
            <el-button text type="danger" size="small" @click="removeAccount(a.id)">删除</el-button>
          </span>
        </div>
        <div v-if="accountStore.items.length === 0" class="empty-mini">
          <div class="empty-icon">💳</div>
          <p>还没有支付账户，点击右上角「新增支付账户」创建</p>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="showAddAccount"
      :title="editingAccountId ? '编辑支付账户' : '新增支付账户'"
      width="420px"
      class="acc-dialog"
    >
      <el-form label-position="top">
        <el-form-item label="支付账户名">
          <el-input
            v-model="newAccountName"
            placeholder="如：招行信用卡 / 京东白条"
            maxlength="10"
            @keyup.enter="saveAccount"
          />
        </el-form-item>
        <el-form-item label="图标">
          <div class="icon-choices">
            <span
              v-for="ic in ICON_CHOICES"
              :key="ic"
              class="icon-choice"
              :class="{ active: newAccountIcon === ic }"
              @click="newAccountIcon = ic"
            >{{ ic }}</span>
          </div>
          <el-input v-model="newAccountIcon" maxlength="4" class="icon-input" placeholder="或自定义 emoji" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeAccountDialog">取消</el-button>
        <el-button type="primary" @click="saveAccount">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.accounts {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 20px;
}
.page-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 4px;
  letter-spacing: -0.3px;
}
.page-sub {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0;
}
.add-btn {
  background-image: linear-gradient(135deg, #ff8f4d, #f56c2c);
  border: none;
  box-shadow: var(--shadow-btn);
  border-radius: 12px;
  padding: 12px 22px;
  transition: transform 0.15s, box-shadow 0.15s;
}
.add-btn:hover,
.add-btn:focus {
  background-image: linear-gradient(135deg, #ff9d61, #f5753a);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(245, 108, 44, 0.4);
}
.add-btn:active {
  transform: translateY(0);
}
.section {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 28px 32px;
  box-shadow: var(--shadow-card);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 18px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text);
}
.section-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.section-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-soft);
  background: #f1f2f4;
  padding: 1px 8px;
  border-radius: 999px;
}
.sort-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-soft);
}
.acc-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.acc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.acc-row:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover);
  border-color: rgba(245, 108, 44, 0.35);
}
/* 拖拽中：半透明 + 虚线 + 轻微上浮 */
.acc-row.dragging {
  opacity: 0.45;
  border-style: dashed;
  transform: translateY(-2px) scale(0.98);
}
/* 插入位置指示线 */
.acc-row.drag-over-before {
  box-shadow: inset 0 3px 0 0 var(--color-primary);
}
.acc-row.drag-over-after {
  box-shadow: inset 0 -3px 0 0 var(--color-primary);
}
.drag-handle {
  display: flex;
  align-items: center;
  cursor: grab;
  color: var(--color-text-muted);
  opacity: 0.3;
  transition: opacity 0.15s, color 0.15s;
  user-select: none;
}
.acc-row:hover .drag-handle {
  opacity: 1;
}
.drag-handle:hover {
  color: var(--color-primary);
}
.drag-handle:active {
  cursor: grabbing;
}

.acc-row-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--color-blue-soft);
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.2s;
}
.acc-row:hover .acc-row-icon {
  transform: scale(1.06);
}
.acc-row-icon.is-default {
  background: var(--color-primary-soft);
}
.acc-row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.acc-row-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}
.acc-row-spent {
  font-size: 12px;
  color: var(--color-text-soft);
  font-variant-numeric: tabular-nums;
}
.acc-row-spent::before {
  content: '累计支出 ';
  color: var(--color-text-muted);
}
.sys-tag {
  font-size: 10px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 600;
}
.acc-actions {
  display: inline-flex;
  gap: 2px;
  opacity: 0.35;
  transition: opacity 0.15s;
}
.acc-row:hover .acc-actions {
  opacity: 1;
}
.empty-mini {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--color-text-muted);
  padding: 40px 0;
  font-size: 13px;
}
.empty-mini .empty-icon {
  font-size: 40px;
  margin-bottom: 10px;
}
.empty-mini p {
  margin: 0;
}
/* 图标快捷选择 */
.icon-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.icon-choice {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.icon-choice:hover {
  border-color: var(--color-primary);
  transform: translateY(-1px);
}
.icon-choice.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  box-shadow: 0 0 0 2px rgba(245, 108, 44, 0.15);
}
.icon-input {
  width: 140px;
}
</style>
