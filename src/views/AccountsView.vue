<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { usePaymentAccountStore } from '@/stores/paymentAccount'
import { useExpenseStore } from '@/stores/expense'
import { notify } from '@/lib/notify'

const accountStore = usePaymentAccountStore()
const expenseStore = useExpenseStore()

onMounted(async () => {
  // 全量聚合各账户累计支出（不受首页时间筛选影响）
  accountSpentMap.value = await expenseStore.aggregateByAccount()
})

/** 常用支付图标快捷选择 */
const ICON_CHOICES = ['💳', '💰', '📱', '🏦', '🧾', '🛒', '🐱', '✈️', '🎫', '🍔']

/** 金额格式化：千分位 + 两位小数 */
function fmtMoney(n: number) {
  const v = Number(n) || 0
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 该账户累计支出（全量 SQL 聚合结果，与首页时间筛选无关） */
const accountSpentMap = ref(new Map<string, number>())
function accountSpent(id: string) {
  return accountSpentMap.value.get(id) || 0
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
/* v2026-09-03 质感升级 */
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
.page-sub { color: var(--color-text-soft); font-size: 13px; margin: 0; }
.add-btn {
  background: linear-gradient(135deg, #ff8f4d, #f56c2c) !important;
  border: none !important;
  box-shadow: 0 6px 18px -4px rgba(245, 108, 44, 0.45) !important;
  border-radius: 12px !important;
  padding: 12px 22px !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
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
.add-btn:hover::after { left: 130%; }
.add-btn:active { transform: translateY(0) !important; }

.section {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 28px 32px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.05);
  transition: box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.section:hover {
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 14px 32px rgba(16, 24, 40, 0.08);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 20px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text);
}
.section-title::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--color-primary), var(--color-yellow));
  margin-right: 4px;
  align-self: center;
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
  background: var(--color-bg);
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
}
.sort-hint { margin: 0; font-size: 12px; color: var(--color-text-soft); }
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
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s;
  position: relative;
}
.acc-row::before {
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
  transition: opacity 0.2s, transform 0.2s;
}
.acc-row:hover {
  transform: translateY(-2px);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 12px 28px rgba(16, 24, 40, 0.08), 0 0 0 1px rgba(245, 108, 44, 0.25);
  border-color: rgba(245, 108, 44, 0.35);
}
.acc-row:hover::before {
  opacity: 1;
  transform: scaleY(1);
}
.acc-row.dragging {
  opacity: 0.45;
  border-style: dashed;
  transform: translateY(-2px) scale(0.98);
}
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
.acc-row:hover .drag-handle { opacity: 1; }
.drag-handle:hover { color: var(--color-primary); }
.drag-handle:active { cursor: grabbing; }

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
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.acc-row:hover .acc-row-icon { transform: scale(1.08) rotate(-4deg); }
.acc-row-icon.is-default {
  background: var(--color-primary-soft);
  box-shadow: 0 4px 10px -2px rgba(245, 108, 44, 0.3);
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
  border: 1px solid rgba(245, 108, 44, 0.18);
}
.acc-actions {
  display: inline-flex;
  gap: 2px;
  opacity: 0.35;
  transition: opacity 0.15s;
}
.acc-row:hover .acc-actions { opacity: 1; }

.empty-mini {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--color-text-muted);
  padding: 50px 0;
  font-size: 13px;
}
.empty-mini .empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  width: 80px;
  height: 80px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-soft);
  border-radius: 50%;
  opacity: 0.6;
}
.empty-mini p { margin: 0; }

.icon-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.icon-choice {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  cursor: pointer;
  background: #fff;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.icon-choice:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 10px -2px rgba(245, 108, 44, 0.25);
}
.icon-choice.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  box-shadow: 0 0 0 2px rgba(245, 108, 44, 0.18), 0 4px 10px -2px rgba(245, 108, 44, 0.3);
  color: var(--color-primary);
}
.icon-input { width: 140px; }

.accounts :deep(.el-dialog) {
  border-radius: 16px !important;
  overflow: hidden;
  box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.25) !important;
}
.accounts :deep(.el-dialog__header) {
  background: linear-gradient(135deg, rgba(245, 108, 44, 0.04) 0%, transparent 100%);
  padding: 20px 24px 16px !important;
  margin-right: 0 !important;
}
.accounts :deep(.el-dialog__title) {
  font-size: 17px;
  font-weight: 700;
}
.accounts :deep(.el-dialog__footer) {
  padding: 8px 24px 20px !important;
  border-top: 1px solid var(--color-border);
}
.accounts :deep(.el-dialog__footer .el-button--primary) {
  background: linear-gradient(135deg, #ff8f4d, #f56c2c) !important;
  border: none !important;
  box-shadow: 0 4px 12px -2px rgba(245, 108, 44, 0.4) !important;
  border-radius: 10px !important;
  padding: 10px 22px !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.accounts :deep(.el-dialog__footer .el-button--primary:hover) {
  transform: translateY(-1px) !important;
  box-shadow: 0 8px 18px -2px rgba(245, 108, 44, 0.5) !important;
}

/* 可访问性 */
@media (prefers-reduced-motion: reduce) {
  .acc-row,
  .acc-row::before,
  .acc-row-icon,
  .add-btn,
  .add-btn::after,
  .icon-choice {
    animation: none !important;
    transition: none !important;
  }
  .acc-row:hover,
  .acc-row:hover .acc-row-icon,
  .add-btn:hover {
    transform: none;
  }
}
</style>
