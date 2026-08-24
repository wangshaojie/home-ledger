<script setup lang="ts">
import { ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { usePaymentAccountStore } from '@/stores/paymentAccount'
import { notify } from '@/lib/notify'

const accountStore = usePaymentAccountStore()

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
    notify.warning('请输入账户名')
    return
  }
  if (accountStore.items.some((a) => a.name === name && a.id !== editingAccountId.value)) {
    notify.error('账户名已存在')
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
    await ElMessageBox.confirm('确定删除此账户？', '提示', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    const r = await accountStore.remove(id)
    if (r.ok) notify.success(r.message)
    else notify.error(r.message)
  } catch {}
}
</script>

<template>
  <div class="accounts">
    <h2 class="page-title">账户管理</h2>

    <div class="section">
      <p class="hint">记账时选择用什么付的（如：花呗、招行信用卡）。系统默认账户不可删，自定义可增删改。</p>

      <div class="acc-list">
        <div v-for="a in accountStore.items" :key="a.id" class="acc-row">
          <span class="acc-row-icon">{{ a.icon }}</span>
          <span class="acc-row-name">{{ a.name }}</span>
          <span v-if="a.is_default" class="default-tag">系统</span>
          <template v-else>
            <el-button text type="primary" size="small" @click="openEditAccount(a)">
              编辑
            </el-button>
            <el-button text type="danger" size="small" @click="removeAccount(a.id)">
              删除
            </el-button>
          </template>
        </div>
      </div>

      <el-button type="primary" plain style="margin-top: 12px" @click="openAddAccount">
        <el-icon><Plus /></el-icon>
        <span style="margin-left: 4px">新增账户</span>
      </el-button>
    </div>

    <el-dialog v-model="showAddAccount" :title="editingAccountId ? '编辑账户' : '新增账户'" width="400px">
      <el-form label-position="top">
        <el-form-item label="账户名">
          <el-input v-model="newAccountName" placeholder="如：招行信用卡 / 京东白条" maxlength="10" />
        </el-form-item>
        <el-form-item label="图标 (emoji)">
          <el-input v-model="newAccountIcon" maxlength="2" />
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
  max-width: 880px;
  margin: 0 auto;
}
.page-title {
  font-size: 24px;
  margin: 0 0 20px;
}
.section {
  background: #fff;
  border-radius: 12px;
  padding: 28px 32px;
  box-shadow: var(--shadow-card);
}
.hint {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0 0 20px;
}
.acc-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.acc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #fafbfc;
  border-radius: 8px;
}
.acc-row-icon {
  font-size: 18px;
}
.acc-row-name {
  flex: 1;
  font-size: 14px;
}
.default-tag {
  font-size: 11px;
  color: #909399;
  background: #ebeef5;
  padding: 1px 6px;
  border-radius: 3px;
}
</style>
