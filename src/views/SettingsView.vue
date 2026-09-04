<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useFamilyStore } from '@/stores/family'
import { useCategoryStore } from '@/stores/category'
import { useExpenseStore } from '@/stores/expense'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { displayNameOf } from '@/lib/displayName'
import pkg from '@@/package.json'

// 当前版本号 — 直接从 package.json import，build 时 Vite 会把它打包进 chunk
// 单一来源：CI 发版时改 package.json version，UI 自动同步
const APP_VERSION: string = pkg.version

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

const resetSending = ref(false)
const resetSent = ref(false)
const otpCode = ref('')
const verifyToken = ref('')
const otpVerified = ref(false)
const newPwd = ref('')
const newPwd2 = ref('')
const changingPwd = ref(false)
const resendCountdown = ref(0)

const showAddCategory = ref(false)
const newCategoryName = ref('')
const newCategoryIcon = ref('📦')

const showJoinFamily = ref(false)
const inviteInput = ref('')

const showAddMember = ref(false)
const addMemberName = ref('')
const addMemberType = ref<'child' | 'pet'>('child')
const addingMember = ref(false)

const familyMembers = computed(() => familyStore.members)
const isCreator = computed(() =>
  familyStore.family?.created_by === (auth.user?.id || auth.profile?.id)
)

function typeIcon(t: string) {
  if (t === 'adult') return '👤'
  if (t === 'child') return '🧒'
  if (t === 'pet') return '🐾'
  return '·'
}

async function confirmAddMember() {
  const name = addMemberName.value.trim()
  if (!name) return
  addingMember.value = true
  const r = await familyStore.addMember(name, addMemberType.value)
  addingMember.value = false
  if (r.ok) {
    notify.success(r.message || '已添加')
    addMemberName.value = ''
    addMemberType.value = 'child'
    showAddMember.value = false
    // 强制从 DB 重新拉,保证其它页面(HomeView 消费成员下拉)立即看到
    await familyStore.load()
  } else {
    notify.error(r.message || '添加失败')
  }
}

async function removeMember(id: string, name: string) {
  try {
    await ElMessageBox.confirm(
      `确定要删除「${name}」吗？关联的账单不会被删除，但成员统计里会看不到 ta。`,
      '删除成员',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const r = await familyStore.removeMember(id)
  if (r.ok) notify.success(r.message || '已删除')
  else notify.error(r.message || '删除失败')
}

/**
 * v2026-09-04 创建者强制移出已关联账号的成员（如通过邀请码加入的家人）
 */
async function kickMember(id: string, name: string) {
  try {
    await ElMessageBox.confirm(
      `确定要将「${name}」移出家庭吗？\n\nta 将无法再查看本家庭的任何账单；ta 名下已有的历史账单仍保留在家庭中。\n\nta 之后如想回来，可用原邀请码重新加入。`,
      '移出成员',
      {
        type: 'warning',
        confirmButtonText: '移出',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  const r = await familyStore.kickMember(id)
  if (r.ok) {
    notify.success(r.message || '已移出')
    // 重新拉取,保证 HomeView 等页面的成员下拉立即同步
    await familyStore.load()
  } else {
    notify.error(r.message || '移出失败')
  }
}

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

async function sendResetCode() {
  if (resendCountdown.value > 0) return
  resetSending.value = true
  const r = await auth.startPasswordReset()
  resetSending.value = false
  if (r.ok) {
    notify.success(r.message)
    resetSent.value = true
    otpVerified.value = false
    otpCode.value = ''
    verifyToken.value = ''
    resendCountdown.value = 60
    const t = setInterval(() => {
      resendCountdown.value--
      if (resendCountdown.value <= 0) clearInterval(t)
    }, 1000)
  } else {
    notify.error(r.message)
  }
}

async function verifyOtp() {
  if (otpCode.value.length !== 6) {
    notify.error('请输入 6 位验证码')
    return
  }
  const r = await auth.verifyPasswordResetCode(otpCode.value)
  if (r.ok && r.verifyToken) {
    notify.success(r.message)
    verifyToken.value = r.verifyToken
    otpVerified.value = true
  } else {
    notify.error(r.message)
    otpVerified.value = false
  }
}

async function changePassword() {
  if (!otpVerified.value || !verifyToken.value) {
    notify.error('请先完成邮箱验证码验证')
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
  const r = await auth.completePasswordReset(verifyToken.value, newPwd.value)
  changingPwd.value = false
  if (r.ok) {
    notify.success('密码已更新，正在退出登录...')
    // 清状态
    resetSent.value = false
    otpVerified.value = false
    otpCode.value = ''
    verifyToken.value = ''
    newPwd.value = newPwd2.value = ''
    // 强制退出让用户用新密码重登
    setTimeout(async () => {
      await auth.logout()
      router.push({ name: 'login' })
    }, 1500)
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
  // v2026-08-25 加确认：当前已有家庭时换家庭，原家庭数据将被 RLS 隔离（数据没删但你看不到）
  // v1.2 没有"主动离开"流程，所以这一步必须让用户明确意识到
  try {
    await ElMessageBox.confirm(
      `将加入邀请码为 ${inviteInput.value.trim().toUpperCase()} 的家庭。\n\n你将离开当前家庭（原家庭账单将不再可见，但数据仍保留在云端）。\n\n确认继续吗？`,
      '切换家庭',
      {
        type: 'warning',
        confirmButtonText: '确认切换',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
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
  try {
    await ElMessageBox.confirm(
      '确定要退出当前账号吗？\n\n本地已开启「30 天免登录」时，退出后再次打开应用可免输入验证码。\n如需立即清除本机数据，请使用下方「清除本地数据」按钮。',
      '退出登录',
      {
        type: 'warning',
        confirmButtonText: '退出',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  await auth.logout()
  router.push({ name: 'login' })
}

async function checkForUpdate() {
  // electron-updater 暴露在 window.electronAPI（preload.ts 注入）
  if (!window.electronAPI?.checkForUpdates) {
    notify.warning('当前环境不支持更新检查（仅桌面端可用）')
    return
  }
  notify.info('正在检查更新...')
  const r = await window.electronAPI.checkForUpdates()
  if (!r.ok) {
    notify.error(r.message || '检查更新失败')
    return
  }
  if (r.available) {
    notify.success(`发现新版本 v${r.version}，稍后会弹出更新窗口`)
  } else {
    notify.success(`当前已是最新版本 v${r.currentVersion || APP_VERSION}`)
  }
}

async function wipeLocalData() {
  try {
    await ElMessageBox.confirm(
      '将清除本机所有数据，包括登录信息、缓存的最近使用分类等。\n\n云端数据（账本/家庭/分类）不受影响，重新登录后仍可访问。\n\n确定要继续吗？',
      '清除本地数据',
      {
        type: 'warning',
        confirmButtonText: '清除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  const r = await auth.wipeAllLocalData()
  if (r.ok) {
    notify.success('本地数据已清除，3 秒后退出应用...')
    setTimeout(() => {
      window.close()
    }, 3000)
  } else {
    notify.error(r.message)
  }
}
</script>

<template>
  <div class="settings">
    <div class="page-header">
      <div>
        <h2 class="page-title">设置</h2>
        <p class="page-sub">管理个人账号、家庭、成员与消费分类</p>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><el-icon><User /></el-icon>个人账号</div>
      <div class="info-row">
        <span class="info-icon"><el-icon><Message /></el-icon></span>
        <span class="info-label">绑定邮箱</span>
        <span class="info-value">{{ auth.profile?.email }}</span>
      </div>
      <div class="info-row">
        <span class="info-icon"><el-icon><OfficeBuilding /></el-icon></span>
        <span class="info-label">所属家庭</span>
        <span class="info-value">{{ familyStore.family?.name || '-' }}</span>
      </div>
      <div class="info-row">
        <span class="info-icon"><el-icon><Calendar /></el-icon></span>
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
      <p class="section-hint">通过邮箱 6 位验证码验证身份（桌面端 OTP 流程）。</p>

      <el-form label-position="top" :inline="false" class="pwd-form">
        <el-form-item label="第 1 步：发送验证码到邮箱">
          <div class="code-row">
            <el-button
              type="primary"
              :loading="resetSending"
              :disabled="resendCountdown > 0"
              @click="sendResetCode"
            >
              {{ resendCountdown > 0 ? `${resendCountdown}s 后重发` : (resetSent ? '重新发送验证码' : '发送验证码') }}
            </el-button>
          </div>
          <div class="hint" v-if="resetSent">
            验证码已发到 <b>{{ auth.profile?.email }}</b>（5 分钟内有效）
          </div>
        </el-form-item>

        <el-form-item label="第 2 步：输入 6 位验证码" v-if="resetSent">
          <div class="code-row">
            <el-input
              v-model="otpCode"
              placeholder="6 位数字"
              maxlength="6"
              :disabled="otpVerified"
            />
            <el-button
              v-if="!otpVerified"
              type="primary"
              :disabled="otpCode.length !== 6"
              @click="verifyOtp"
            >
              验证
            </el-button>
            <el-button v-else disabled>已验证 ✓</el-button>
          </div>
        </el-form-item>

        <template v-if="otpVerified">
          <el-form-item label="第 3 步：新密码">
            <el-input v-model="newPwd" type="password" show-password placeholder="6-20 位" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="newPwd2" type="password" show-password placeholder="再次输入" />
          </el-form-item>
          <el-button
            type="primary"
            :loading="changingPwd"
            :disabled="!newPwd || newPwd !== newPwd2"
            @click="changePassword"
          >
            修改密码
          </el-button>
        </template>
      </el-form>

      <el-divider />

      <el-button type="danger" plain @click="logout">
        <el-icon><SwitchButton /></el-icon>
        <span style="margin-left: 4px">退出登录</span>
      </el-button>

      <el-divider />

      <div class="section-sub">本机数据</div>
      <p class="section-hint">
        清除本机所有数据，包括登录会话、显示名缓存、最近使用分类等。
        <br />云端账本和家庭数据不受影响，重新登录后可继续访问。
      </p>
      <el-button type="danger" @click="wipeLocalData">
        <el-icon><Delete /></el-icon>
        <span style="margin-left: 4px">清除本地数据</span>
      </el-button>
    </div>

    <div class="section">
      <div class="section-title"><el-icon><House /></el-icon>家庭设置</div>

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
            <span class="member-type-icon">{{ typeIcon(m.type) }}</span>
            {{ m.name }}
            <span v-if="m.linked_profile_id && m.linked_profile_id === familyStore.family?.created_by" class="role-tag">创建者</span>
            <span v-else-if="m.linked_profile_id === auth.user?.id" class="role-tag self">我</span>
            <span v-else-if="m.type === 'child'" class="role-tag child">小孩</span>
            <span v-else-if="m.type === 'pet'" class="role-tag pet">宠物</span>
          </div>
          <div class="member-email">
            <span v-if="m.linked_profile_id">已关联账号 · {{ fmtDate(m.created_at) }} 加入</span>
            <span v-else>未关联账号 · 父母代记账</span>
          </div>
        </div>
        <span v-if="!m.linked_profile_id" class="member-actions">
          <el-button text type="danger" size="small" @click="removeMember(m.id, m.name)">
            删除
          </el-button>
        </span>
        <!-- v2026-09-04 创建者可移出通过邀请码加入的成员(linked 账号、非自己) -->
        <span
          v-else-if="isCreator && m.linked_profile_id !== auth.user?.id"
          class="member-actions"
        >
          <el-button text type="danger" size="small" @click="kickMember(m.id, m.name)">
            移出
          </el-button>
        </span>
      </div>
      <div v-if="familyMembers.length === 0" class="empty-mini">暂无成员</div>

      <el-button
        type="primary"
        plain
        style="margin-top: 12px"
        @click="showAddMember = true"
      >
        添加成员（小孩 / 宠物）
      </el-button>

      <el-button
        type="warning"
        plain
        style="margin-top: 16px; margin-left: 8px"
        @click="showJoinFamily = true"
      >
        切换 / 加入其他家庭
      </el-button>
    </div>

    <el-dialog v-model="showAddMember" title="添加成员" width="400px">
      <el-form label-position="top">
        <el-form-item label="类型">
          <el-radio-group v-model="addMemberType">
            <el-radio-button value="child">小孩</el-radio-button>
            <el-radio-button value="pet">宠物</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名字">
          <el-input v-model="addMemberName" :placeholder="addMemberType === 'pet' ? '如：旺财' : '如：小明'" maxlength="20" show-word-limit />
          <div class="hint">未关联账号。记账时选择该成员作为"消费成员"，钱算 ta 头上（也支持你付钱给 ta 买东西）</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddMember = false">取消</el-button>
        <el-button type="primary" :disabled="!addMemberName.trim() || addingMember" :loading="addingMember" @click="confirmAddMember">
          添加
        </el-button>
      </template>
    </el-dialog>

    <div class="section">
      <div class="section-title"><el-icon><InfoFilled /></el-icon>关于</div>

      <div class="about-brand">
        <div class="about-logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="22" height="22" fill="none">
            <path
              d="M16 4 L28 13 L28 27 C28 28.1 27.1 29 26 29 L19 29 L19 20 C19 19.4 18.6 19 18 19 L14 19 C13.4 19 13 19.4 13 20 L13 29 L6 29 C4.9 29 4 28.1 4 27 L4 13 Z"
              fill="#fff"
              fill-opacity="0.95"
            />
          </svg>
        </div>
        <div class="about-text">
          <div class="about-name">家庭记账</div>
          <div class="about-version">
            v{{ APP_VERSION }}
            <span class="version-tag">桌面端</span>
          </div>
        </div>
      </div>

      <p class="section-hint" style="margin-top: 14px">
        一个本地优先的轻量家庭账本：账目云端同步、家人协作、统计可视化，
        支持通过 MCP 把 AI 助手接入你的账本。
      </p>

      <div class="about-meta">
        <div class="meta-row">
          <span class="meta-label">当前版本</span>
          <span class="meta-value">v{{ APP_VERSION }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">运行平台</span>
          <span class="meta-value">Windows · 桌面端</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">数据存储</span>
          <span class="meta-value">Supabase 云端 · 本地 IndexedDB 缓存</span>
        </div>
      </div>

      <el-divider />

      <div class="section-sub">检查更新</div>
      <p class="section-hint">
        新版本会通过 GitHub Releases 发布，点击下方按钮手动检查。
        也可以在主程序收到更新提示时一键安装。
      </p>
      <el-button type="primary" plain @click="checkForUpdate">
        <el-icon><Refresh /></el-icon>
        <span style="margin-left: 4px">检查更新</span>
      </el-button>
    </div>

    <div class="section">
      <div class="section-title"><el-icon><Collection /></el-icon>分类管理</div>
      <div class="cat-list">
        <div v-for="(c, i) in categoryStore.items" :key="c.id" class="cat-row">
          <span class="cat-row-icon" :class="`tone-${['orange', 'blue', 'green', 'purple', 'yellow'][i % 5]}`">{{ c.icon }}</span>
          <span class="cat-row-name">{{ c.name }}</span>
          <span v-if="c.is_default" class="sys-tag">系统</span>
          <span v-else class="member-actions">
            <el-button text type="danger" size="small" @click="removeCategory(c.id)">删除</el-button>
          </span>
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
/* v2026-09-03 质感升级 */
.settings {
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

.about-brand {
  display: flex;
  align-items: center;
  gap: 14px;
}
.about-logo {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  background: linear-gradient(135deg, #ff8f4d, #f56c2c);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 4px 12px rgba(245, 108, 44, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}
.about-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.about-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: 0.3px;
}
.about-version {
  font-size: 13px;
  color: var(--color-text-soft);
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.version-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
}

.about-meta {
  margin-top: 6px;
  background: var(--color-bg);
  border-radius: 10px;
  padding: 4px 14px;
}
.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--color-border);
}
.meta-row:last-child { border-bottom: none; }
.meta-label { color: var(--color-text-soft); }
.meta-value {
  color: var(--color-text);
  font-weight: 500;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}

.section {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 28px 32px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.05);
  margin-bottom: 16px;
  transition: box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.section:hover {
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 14px 32px rgba(16, 24, 40, 0.08);
}
.section-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.section-title::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--color-primary), var(--color-yellow));
}
.section-title .el-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 15px;
  flex-shrink: 0;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.section:hover .section-title .el-icon { transform: scale(1.1) rotate(-6deg); }
.section-sub {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin: 16px 0 10px;
  letter-spacing: 0.2px;
}
.section-hint {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0 0 12px;
  line-height: 1.6;
}
.info-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-size: 14px;
}
.info-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--color-blue-soft);
  color: var(--color-blue);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  flex-shrink: 0;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.info-row:hover .info-icon { transform: scale(1.08); }
.info-label { width: 90px; color: var(--color-text-soft); }
.info-value { color: var(--color-text); font-weight: 500; }
.pwd-form .code-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.hint { color: var(--color-text-soft); font-size: 12px; margin-top: 4px; }
.invite-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.invite-code {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--color-primary);
  background: linear-gradient(135deg, var(--color-primary-soft) 0%, #ffe2d0 100%);
  padding: 8px 18px;
  border-radius: 999px;
  border: 1px solid rgba(245, 108, 44, 0.18);
  box-shadow: 0 4px 12px -4px rgba(245, 108, 44, 0.3);
}

.member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 10px;
  margin-bottom: 6px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  border: 1px solid transparent;
}
.member-row:last-child { margin-bottom: 0; }
.member-row:hover {
  background: linear-gradient(90deg, rgba(245, 108, 44, 0.04) 0%, transparent 100%);
  border-color: rgba(245, 108, 44, 0.12);
  transform: translateX(2px);
}
.member-actions {
  opacity: 0.35;
  transition: opacity 0.15s;
}
.member-row:hover .member-actions,
.cat-row:hover .member-actions { opacity: 1; }
.member-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.member-name {
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text);
  font-weight: 500;
}
.member-type-icon {
  font-size: 18px;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--color-primary-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.role-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--color-bg);
  color: var(--color-text-soft);
  border: 1px solid var(--color-border);
}
.role-tag.self {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  border-color: rgba(245, 108, 44, 0.18);
}
.role-tag.child {
  background: var(--color-blue-soft);
  color: var(--color-blue);
  border-color: rgba(79, 124, 255, 0.18);
}
.role-tag.pet {
  background: var(--color-green-soft);
  color: var(--color-green);
  border-color: rgba(47, 181, 95, 0.18);
}
.member-email { color: var(--color-text-soft); font-size: 12px; }
.empty-mini {
  text-align: center;
  color: #c0c4cc;
  padding: 30px 0;
  font-size: 13px;
}

.cat-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.cat-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}
.cat-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 0 2px 2px 0;
  opacity: 0;
  transform: scaleY(0.4);
  transform-origin: center;
  transition: all 0.2s;
}
.cat-row:hover {
  transform: translateY(-2px);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 12px 28px rgba(16, 24, 40, 0.08);
  border-color: rgba(245, 108, 44, 0.25);
}
.cat-row:hover::before {
  opacity: 1;
  transform: scaleY(1);
}
.cat-row.tone-orange::before, .cat-row-icon.tone-orange ~ * { /* noop selector placeholder */ }
.cat-row:has(.cat-row-icon.tone-orange)::before { background: linear-gradient(180deg, var(--color-primary), var(--color-yellow)); }
.cat-row:has(.cat-row-icon.tone-blue)::before { background: linear-gradient(180deg, var(--color-blue), #4fd1c5); }
.cat-row:has(.cat-row-icon.tone-green)::before { background: linear-gradient(180deg, var(--color-green), #7ad7c8); }
.cat-row:has(.cat-row-icon.tone-purple)::before { background: linear-gradient(180deg, var(--color-purple), var(--color-pink)); }
.cat-row:has(.cat-row-icon.tone-yellow)::before { background: linear-gradient(180deg, var(--color-yellow), var(--color-primary)); }

.cat-row-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.cat-row:hover .cat-row-icon { transform: scale(1.1) rotate(-6deg); }
.cat-row-icon.tone-orange { background: var(--color-primary-soft); }
.cat-row-icon.tone-blue { background: var(--color-blue-soft); }
.cat-row-icon.tone-green { background: var(--color-green-soft); }
.cat-row-icon.tone-purple { background: var(--color-purple-soft); }
.cat-row-icon.tone-yellow { background: var(--color-yellow-soft); }
.cat-row-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}
.sys-tag {
  font-size: 11px;
  color: var(--color-text-soft);
  background: var(--color-bg);
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
}

/* 全局按钮升级(主色按钮渐变橙) */
.settings :deep(.el-button--primary) {
  background: linear-gradient(135deg, #ff8f4d, #f56c2c) !important;
  border: none !important;
  box-shadow: 0 4px 12px -2px rgba(245, 108, 44, 0.4) !important;
  border-radius: 10px !important;
  padding: 9px 18px !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.settings :deep(.el-button--primary:hover) {
  transform: translateY(-1px) !important;
  box-shadow: 0 8px 18px -2px rgba(245, 108, 44, 0.5) !important;
}
.settings :deep(.el-button--primary.is-plain) {
  background: rgba(255, 255, 255, 0.6) !important;
  border: 1px solid var(--color-border-strong) !important;
  color: var(--color-primary) !important;
  box-shadow: none !important;
}
.settings :deep(.el-button--primary.is-plain:hover) {
  background: var(--color-primary-soft) !important;
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 3px rgba(245, 108, 44, 0.08) !important;
}
.settings :deep(.el-button--warning.is-plain) {
  background: var(--color-yellow-soft) !important;
  border-color: var(--color-yellow) !important;
  color: var(--color-yellow) !important;
}
.settings :deep(.el-button--warning.is-plain:hover) {
  background: var(--color-yellow) !important;
  color: #fff !important;
}
.settings :deep(.el-button--danger.plain),
.settings :deep(.el-button--danger.is-plain) {
  background: rgba(245, 108, 44, 0.04) !important;
  border: 1px solid rgba(245, 108, 44, 0.3) !important;
  color: var(--color-primary) !important;
}
.settings :deep(.el-button--danger.plain:hover),
.settings :deep(.el-button--danger.is-plain:hover) {
  background: var(--color-primary-soft) !important;
}

.settings :deep(.el-divider--horizontal) {
  margin: 20px 0 !important;
  border-color: var(--color-border) !important;
}
.settings :deep(.el-divider__text) {
  background: #fff !important;
  color: var(--color-text-muted) !important;
  font-size: 12px;
}

.settings :deep(.el-dialog) {
  border-radius: 16px !important;
  overflow: hidden;
  box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.25) !important;
}
.settings :deep(.el-dialog__header) {
  background: linear-gradient(135deg, rgba(245, 108, 44, 0.04) 0%, transparent 100%);
  padding: 20px 24px 16px !important;
  margin-right: 0 !important;
}
.settings :deep(.el-dialog__title) {
  font-size: 17px;
  font-weight: 700;
}
.settings :deep(.el-dialog__footer) {
  padding: 8px 24px 20px !important;
  border-top: 1px solid var(--color-border);
}

/* 可访问性 */
@media (prefers-reduced-motion: reduce) {
  .section,
  .section-title .el-icon,
  .info-icon,
  .member-row,
  .cat-row,
  .cat-row::before,
  .cat-row-icon,
  .settings :deep(.el-button--primary) {
    animation: none !important;
    transition: none !important;
  }
  .member-row:hover,
  .cat-row:hover,
  .cat-row:hover .cat-row-icon,
  .settings :deep(.el-button--primary:hover) {
    transform: none;
  }
}
</style>
