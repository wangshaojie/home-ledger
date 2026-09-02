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

// ---------- AI 记账（MCP） ----------
const mcpTab = ref('cursor')
const mcpOpen = ref(['config'])
const copiedKey = ref('')

const mcpClients = [
  {
    key: 'cursor',
    name: 'Cursor',
    file: 'Windows：%USERPROFILE%\\.cursor\\mcp.json　·　macOS：~/.cursor/mcp.json',
    tip: '已有其它 MCP 时把 home-ledger 节点合并进去，不要整文件覆盖。需要 Cursor 0.46+。',
    json: `{\n  "mcpServers": {\n    "home-ledger": {\n      "url": "https://mcp.240730.xyz/api/mcp",\n      "headers": {\n        "Authorization": "Bearer 你的token"\n      }\n    }\n  }\n}`
  },
  {
    key: 'claude',
    name: 'Claude Desktop',
    file: 'Windows：%APPDATA%\\Claude\\claude_desktop_config.json　·　macOS：~/Library/Application Support/Claude/claude_desktop_config.json',
    tip: '格式多一个 "type": "http"。需要 Claude Desktop 1.0.63+。',
    json: `{\n  "mcpServers": {\n    "home-ledger": {\n      "type": "http",\n      "url": "https://mcp.240730.xyz/api/mcp",\n      "headers": {\n        "Authorization": "Bearer 你的token"\n      }\n    }\n  }\n}`
  },
  {
    key: 'other',
    name: '其他客户端',
    file: 'Mavis / Codex 等支持远程 HTTP MCP 的客户端',
    tip: '在客户端里添加远程 MCP 服务器，填入以下端点与请求头。',
    json: '端点：https://mcp.240730.xyz/api/mcp\n传输方式：HTTP（Streamable HTTP）\n请求头：Authorization: Bearer 你的token'
  }
]

function openActivatePage() {
  window.open('https://mcp.240730.xyz/activate', '_blank')
}

async function copyMcpJson(key: string) {
  const c = mcpClients.find((x) => x.key === key)
  if (!c) return
  try {
    await navigator.clipboard.writeText(c.json)
    copiedKey.value = key
    notify.success('配置已复制，粘贴到对应文件即可（记得把「你的token」换成授权页拿到的 token）')
    setTimeout(() => {
      copiedKey.value = ''
    }, 2500)
  } catch {
    notify.error('复制失败，请手动选中复制')
  }
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

    <div class="section">
      <div class="section-title"><el-icon><Connection /></el-icon>AI 记账（MCP）</div>
      <p class="section-hint">
        把「家庭记账」接入 AI 助手（Cursor / Claude Desktop / Mavis 等）。之后不用打开本应用，
        直接对 AI 说一句「刚买了杯咖啡 28 块」，它就会自动帮你写入账本。
      </p>

      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px">
        <el-button type="primary" @click="openActivatePage">
          <el-icon><Promotion /></el-icon>
          <span style="margin-left: 4px">打开授权页</span>
        </el-button>
        <span class="hint" style="margin-left: 6px">在浏览器中打开 mcp.240730.xyz/activate，用你的登录邮箱完成授权</span>
      </div>

      <div class="step-list">
        <div class="step-item">
          <span class="step-no">1</span>
          <span>在授权页用 <b>{{ auth.profile?.email || '本应用登录邮箱' }}</b> 接收验证码，起个设备名（如「我的笔记本」）</span>
        </div>
        <div class="step-item">
          <span class="step-no">2</span>
          <span>授权成功生成 64 位 token，点「复制 token」</span>
        </div>
        <div class="step-item">
          <span class="step-no">3</span>
          <span>在下方选择你的 AI 客户端，复制配置、粘贴进配置文件并保存，然后<b>完全退出并重启</b>客户端</span>
        </div>
      </div>

      <el-collapse v-model="mcpOpen" style="margin-top: 4px">
        <el-collapse-item name="config" title="配置模板（复制后粘贴到对应文件）">
          <el-tabs v-model="mcpTab">
            <el-tab-pane v-for="c in mcpClients" :key="c.key" :label="c.name" :name="c.key">
              <div class="cfg-path">{{ c.file }}</div>
              <p class="section-hint">{{ c.tip }}</p>
              <el-button
                size="small"
                :type="copiedKey === c.key ? 'success' : 'primary'"
                plain
                @click="copyMcpJson(c.key)"
              >
                <el-icon><CopyDocument /></el-icon>
                <span style="margin-left: 4px">{{ copiedKey === c.key ? '已复制' : '复制配置' }}</span>
              </el-button>
              <pre class="cfg-pre">{{ c.json }}</pre>
            </el-tab-pane>
          </el-tabs>
        </el-collapse-item>

        <el-collapse-item name="usage" title="试试对 AI 说">
          <ul class="mcp-usage-list">
            <li>「刚在瑞幸买了杯咖啡 28 块，帮我记上」</li>
            <li>「看看最近 5 笔账单」</li>
            <li>「删掉昨天那笔早餐」</li>
          </ul>
        </el-collapse-item>

        <el-collapse-item name="faq" title="常见问题与安全">
          <ul class="mcp-usage-list">
            <li>token 有效期 30 天。过期后调用会提示 401，回授权页重新签发即可</li>
            <li>每个 token 对应一个「设备」，可在授权页管理、吊销</li>
            <li>AI 只能操作你所在家庭的账单，无法读取或修改其他家庭的数据</li>
            <li>写操作有审计与限流（每分钟最多 30 笔），异常行为可追踪</li>
          </ul>
        </el-collapse-item>
      </el-collapse>
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

.section {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 24px 28px;
  box-shadow: var(--shadow-card);
  margin-bottom: 16px;
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title .el-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 15px;
  flex-shrink: 0;
}
.section-sub {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin: 12px 0 8px;
}
.section-hint {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0 0 12px;
  line-height: 1.5;
}
.info-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-size: 14px;
}
.info-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--color-blue-soft);
  color: var(--color-blue);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  flex-shrink: 0;
}
.info-label {
  width: 90px;
  color: var(--color-text-soft);
}
.info-value {
  color: var(--color-text);
}
.pwd-form .code-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.hint {
  color: var(--color-text-soft);
  font-size: 12px;
  margin-top: 4px;
}
.invite-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.invite-code {
  font-family: ui-monospace, Cascadia Code, monospace;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 4px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  padding: 6px 14px;
  border-radius: 999px;
}
.member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  margin-bottom: 4px;
  transition: background 0.15s;
}
.member-row:last-child {
  margin-bottom: 0;
}
.member-row:hover {
  background: #fafbfc;
}
.member-actions {
  opacity: 0.35;
  transition: opacity 0.15s;
}
.member-row:hover .member-actions,
.cat-row:hover .member-actions {
  opacity: 1;
}
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
}
.member-type-icon {
  font-size: 16px;
}
.role-tag {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: 999px;
  background: #f1f2f4;
  color: var(--color-text-soft);
}
.role-tag.self {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.role-tag.child {
  background: var(--color-blue-soft);
  color: var(--color-blue);
}
.role-tag.pet {
  background: var(--color-green-soft);
  color: var(--color-green);
}
.member-email {
  color: var(--color-text-soft);
  font-size: 12px;
}
.empty-mini {
  text-align: center;
  color: #c0c4cc;
  padding: 20px 0;
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
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.cat-row:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-card-hover);
  border-color: rgba(245, 108, 44, 0.35);
}
.cat-row-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cat-row-icon.tone-orange { background: var(--color-primary-soft); }
.cat-row-icon.tone-blue { background: var(--color-blue-soft); }
.cat-row-icon.tone-green { background: var(--color-green-soft); }
.cat-row-icon.tone-purple { background: var(--color-purple-soft); }
.cat-row-icon.tone-yellow { background: var(--color-yellow-soft); }
.cat-row-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}
.sys-tag {
  font-size: 11px;
  color: var(--color-text-soft);
  background: #f1f2f4;
  padding: 2px 10px;
  border-radius: 999px;
}

/* ---------- AI 记账（MCP） ---------- */
.step-list {
  margin: 14px 0 2px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.step-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.6;
}
.step-no {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.cfg-path {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  color: var(--color-text-soft);
  margin: 0 0 6px;
}
.cfg-pre {
  background: #f6f8fa;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 14px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: #24292f;
  overflow-x: auto;
  margin: 10px 0 0;
  white-space: pre;
}
.mcp-usage-list {
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-soft);
  font-size: 13px;
  line-height: 2.1;
}
</style>
