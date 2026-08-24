<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useFamilyStore } from '@/stores/family'
import { useCategoryStore } from '@/stores/category'
import { useExpenseStore } from '@/stores/expense'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { isSupabaseConfigured } from '@/lib/supabase'
import { displayNameOf } from '@/lib/displayName'

const auth = useAuthStore()
const familyStore = useFamilyStore()
const categoryStore = useCategoryStore()
const expenseStore = useExpenseStore()
const router = useRouter()

const editFamilyName = ref(familyStore.family?.name || '')
const savingFamily = ref(false)

// 显示名（每个家庭成员自己的显示名）
const editDisplayName = ref(auth.profile?.display_name || '')
const savingDisplayName = ref(false)

const reauthCode = ref('')
const reauthSending = ref(false)
const reauthCountdown = ref(0)
const reauthVerified = ref(false)
const newPwd = ref('')
const newPwd2 = ref('')
const changingPwd = ref(false)

const showAddCategory = ref(false)
const newCategoryName = ref('')
const newCategoryIcon = ref('📦')

const showJoinFamily = ref(false)
const inviteInput = ref('')

const familyMembers = computed(() => familyStore.members)
const isCreator = computed(() =>
  familyStore.family?.created_by === (auth.user?.id || auth.profile?.id)
)

async function saveFamilyName() {
  if (!editFamilyName.value.trim()) {
    notify.warning('请输入家庭名称')
    return
  }
  savingFamily.value = true
  const r = await auth.renameFamily(editFamilyName.value.trim())
  savingFamily.value = false
  if (r.ok) {
    notify.success('家庭名称已更新')
    await familyStore.load()
  } else {
    notify.error(r.message)
  }
}

async function saveDisplayName() {
  if (!editDisplayName.value.trim()) {
    notify.warning('请输入显示名')
    return
  }
  if (editDisplayName.value.trim().length > 20) {
    notify.warning('显示名不超过 20 字')
    return
  }
  savingDisplayName.value = true
  const r = await auth.updateDisplayName(editDisplayName.value)
  savingDisplayName.value = false
  if (r.ok) {
    notify.success('显示名已更新')
  } else {
    notify.error(r.message)
  }
}

async function sendReauthCode() {
  if (reauthCountdown.value > 0) return
  reauthSending.value = true
  const r = await auth.sendReauthOtp()
  reauthSending.value = false
  if (r.ok) {
    notify.success(r.message)
    reauthCountdown.value = 60
    const t = setInterval(() => {
      reauthCountdown.value--
      if (reauthCountdown.value <= 0) clearInterval(t)
    }, 1000)
  } else {
    notify.error(r.message)
  }
}

async function verifyReauthCode() {
  if (reauthCode.value.length !== 6) {
    notify.error('请输入 6 位验证码')
    return
  }
  const r = await auth.verifyReauthOtp(reauthCode.value)
  if (r.ok) {
    notify.success(r.message)
    reauthVerified.value = true
  } else {
    notify.error(r.message)
  }
}

async function changePassword() {
  if (!reauthVerified.value) {
    notify.error('请先完成身份验证')
    return
  }
  if (newPwd.value.length < 6 || newPwd.value.length > 20) {
    notify.error('密码 6-20 位')
    return
  }
  if (newPwd.value !== newPwd2.value) {
    notify.error('两次密码不一致')
    return
  }
  changingPwd.value = true
  const r = await auth.setPassword(newPwd.value)
  changingPwd.value = false
  if (r.ok) {
    reauthCode.value = ''
    reauthVerified.value = false
    newPwd.value = newPwd2.value = ''
    notify.success(r.message)
  } else {
    notify.error(r.message)
  }
}

function copyInviteCode() {
  const code = familyStore.inviteCode
  if (!code) return
  navigator.clipboard.writeText(code)
  notify.success('邀请码已复制：' + code)
}

async function joinOtherFamily() {
  if (!inviteInput.value.trim()) return
  const r = await auth.joinFamilyByInvite(inviteInput.value.trim().toUpperCase())
  if (r.ok) {
    notify.success(r.message)
    showJoinFamily.value = false
    inviteInput.value = ''
    await familyStore.load()
  } else {
    notify.error(r.message)
  }
}

async function addCategory() {
  const name = newCategoryName.value.trim()
  if (!name) {
    notify.warning('请输入分类名')
    return
  }
  if (categoryStore.items.some((c) => c.name === name)) {
    notify.error('分类名已存在')
    return
  }
  const r = await categoryStore.add(name, newCategoryIcon.value)
  if (r.ok) {
    newCategoryName.value = ''
    showAddCategory.value = false
    notify.success(r.message)
  } else {
    notify.error(r.message)
  }
}

async function removeCategory(id: string) {
  try {
    await ElMessageBox.confirm('确定删除此分类？', '提示', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    const r = await categoryStore.remove(id)
    if (r.ok) notify.success(r.message)
    else notify.error(r.message)
  } catch {}
}

function openAddCategoryDialog() {
  showAddCategory.value = true
}

function fmtDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10)
}

async function logout() {
  await auth.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="settings">
    <h2 class="page-title">设置</h2>

    <div class="section">
      <div class="section-title">个人账号</div>
      <div class="info-row">
        <span class="info-label">绑定邮箱</span>
        <span class="info-value">{{ auth.profile?.email }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">所属家庭</span>
        <span class="info-value">{{ familyStore.family?.name || '-' }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">加入时间</span>
        <span class="info-value">
          {{ auth.profile?.joined_at ? fmtDate(auth.profile.joined_at) : '-' }}
        </span>
      </div>

      <el-divider />

      <div class="section-sub">我的显示名</div>
      <p class="section-hint">家庭成员记账时会用这个名字。默认取邮箱前缀。</p>
      <div style="display: flex; gap: 10px; align-items: center; max-width: 480px">
        <el-input
          v-model="editDisplayName"
          placeholder="如：小明 / 爸爸 / 主厨"
          maxlength="20"
          show-word-limit
        />
        <el-button type="primary" :loading="savingDisplayName" @click="saveDisplayName">
          保存
        </el-button>
      </div>

      <el-divider />

      <div class="section-sub">修改登录密码</div>
      <p class="section-hint">为了安全，先用邮箱验证身份，再设置新密码。</p>

      <el-form label-position="top" :inline="false" class="pwd-form">
        <el-form-item label="第 1 步：邮箱验证">
          <div class="code-row">
            <el-input
              v-model="reauthCode"
              placeholder="6 位验证码"
              maxlength="6"
              :disabled="reauthVerified"
            />
            <el-button
              :disabled="reauthCountdown > 0 || reauthVerified"
              :loading="reauthSending"
              @click="sendReauthCode"
            >
              {{ reauthCountdown > 0 ? `${reauthCountdown}s 后重发` : (reauthVerified ? '已验证 ✓' : '发送验证码') }}
            </el-button>
            <el-button
              v-if="!reauthVerified"
              type="primary"
              :disabled="reauthCode.length !== 6"
              @click="verifyReauthCode"
            >
              验证
            </el-button>
          </div>
          <div class="hint">验证码会发到你的邮箱 <b>{{ auth.profile?.email }}</b>（5 分钟内有效）</div>
        </el-form-item>

        <el-form-item label="第 2 步：新密码" :disabled="!reauthVerified">
          <el-input v-model="newPwd" type="password" show-password placeholder="6-20 位" :disabled="!reauthVerified" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="newPwd2" type="password" show-password placeholder="再次输入" :disabled="!reauthVerified" />
        </el-form-item>
        <el-button
          type="primary"
          :loading="changingPwd"
          :disabled="!reauthVerified"
          @click="changePassword"
        >
          修改密码
        </el-button>
      </el-form>

      <el-divider />

      <el-button type="danger" plain @click="logout">
        <el-icon><SwitchButton /></el-icon>
        <span style="margin-left: 4px">退出登录</span>
      </el-button>
    </div>

    <div class="section">
      <div class="section-title">家庭设置</div>

      <div class="section-sub">家庭名称</div>
      <div style="display: flex; gap: 10px; align-items: center">
        <el-input
          v-model="editFamilyName"
          placeholder="家庭名称"
          maxlength="20"
          show-word-limit
        />
        <el-button type="primary" :loading="savingFamily" @click="saveFamilyName">
          保存
        </el-button>
      </div>

      <el-divider />

      <div class="section-sub">邀请码</div>
      <div class="invite-row">
        <span class="invite-code">{{ familyStore.inviteCode || '————' }}</span>
        <el-button :disabled="!familyStore.inviteCode" @click="copyInviteCode">复制</el-button>
        <span class="hint">家人可在「创建家庭」或登录后用此码加入</span>
      </div>

      <el-divider />

      <div class="section-sub">家庭成员（{{ familyMembers.length }}）</div>
      <div v-for="m in familyMembers" :key="m.id" class="member-row">
        <div class="member-info">
          <div class="member-name">
            {{ displayNameOf(m) }}
            <span v-if="m.id === familyStore.family?.created_by" class="role-tag">创建者</span>
            <span v-else-if="m.id === auth.user?.id" class="role-tag self">我</span>
          </div>
          <div class="member-email">{{ m.email }} · {{ fmtDate(m.joined_at) }} 加入</div>
        </div>
        <el-button v-if="m.id !== familyStore.family?.created_by" text type="danger" size="small" disabled>
          移出
        </el-button>
      </div>
      <div v-if="familyMembers.length === 0" class="empty-mini">暂无成员</div>

      <el-button
        type="warning"
        plain
        style="margin-top: 16px"
        @click="showJoinFamily = true"
      >
        切换 / 加入其他家庭
      </el-button>
    </div>

    <div class="section">
      <div class="section-title">分类管理</div>
      <div class="cat-list">
        <div v-for="c in categoryStore.items" :key="c.id" class="cat-row">
          <span class="cat-row-icon">{{ c.icon }}</span>
          <span class="cat-row-name">{{ c.name }}</span>
          <span v-if="c.is_default" class="default-tag">系统</span>
          <el-button v-else text type="danger" size="small" @click="removeCategory(c.id)">
            删除
          </el-button>
        </div>
      </div>
      <el-button
        type="primary"
        plain
        style="margin-top: 12px"
        @click="showAddCategory = true"
      >
        <el-icon><Plus /></el-icon>
        <span style="margin-left: 4px">新增分类</span>
      </el-button>
    </div>

    <el-dialog v-model="showAddCategory" title="新增分类" width="400px">
      <el-form label-position="top">
        <el-form-item label="分类名">
          <el-input v-model="newCategoryName" placeholder="如：宠物 / 旅行" maxlength="10" />
        </el-form-item>
        <el-form-item label="图标 (emoji)">
          <el-input v-model="newCategoryIcon" maxlength="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddCategory = false">取消</el-button>
        <el-button type="primary" @click="addCategory">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showJoinFamily" title="加入其他家庭" width="400px">
      <el-form label-position="top">
        <el-form-item label="邀请码">
          <el-input v-model="inviteInput" placeholder="6 位大写字母" maxlength="6" />
        </el-form-item>
        <div class="hint">注意：加入新家庭会覆盖当前家庭，请确认</div>
      </el-form>
      <template #footer>
        <el-button @click="showJoinFamily = false">取消</el-button>
        <el-button type="primary" :disabled="!inviteInput.trim()" @click="joinOtherFamily">
          加入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings {
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
  margin-bottom: 16px;
  box-shadow: var(--shadow-card);
}
.section-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}
.section-sub {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 12px;
}

.info-row {
  display: flex;
  padding: 10px 0;
  font-size: 14px;
}
.section-hint {
  color: var(--color-text-soft);
  font-size: 12px;
  margin: 0 0 12px;
}
.info-label {
  width: 120px;
  color: var(--color-text-soft);
}
.info-value {
  color: var(--color-text);
}

.pwd-form {
  max-width: 480px;
}

.invite-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.invite-code {
  font-family: 'Menlo', 'Monaco', monospace;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 4px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  padding: 8px 16px;
  border-radius: 6px;
}
.hint {
  color: var(--color-text-soft);
  font-size: 12px;
}

.member-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f0f1f2;
}
.member-row:last-child {
  border-bottom: none;
}
.member-name {
  font-size: 14px;
  font-weight: 500;
}
.role-tag {
  margin-left: 6px;
  font-size: 11px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: normal;
}
.role-tag.self {
  background: #ecf5ff;
  color: #5b8ff9;
}
.member-email {
  font-size: 12px;
  color: var(--color-text-soft);
  margin-top: 2px;
}

.cat-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #fafbfc;
  border-radius: 8px;
}
.cat-row-icon {
  font-size: 18px;
}
.cat-row-name {
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
.empty-mini {
  text-align: center;
  color: #c0c4cc;
  padding: 16px 0;
  font-size: 13px;
}
</style>
