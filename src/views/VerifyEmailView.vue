<script setup lang="ts">
/**
 * v2026-08-25 登录体系重构
 * 邮箱验证页：输入 6 位 OTP
 *  根据 query.type 决定后续跳转：
 *   - signup  → 验证通过后自动登录 → /onboarding（建家庭）
 *   - forgot  → 验证通过后自动登录 → 提示去「设置」改密
 *   - login   → 验证通过后自动登录 → 主页
 *
 * forgot 实现说明：复用 signInWithOtp / verifyOtp（Supabase 自带流程，未登录态合法）。
 * 不用 password_reset_rpc 那套是因为 RPC 强制要求已登录（auth.uid() 校验），
 * 未登录态进 forgot 流程就是死循环。验证后用户在「设置」里走 OTP 改密流程改密即可。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const type = (route.query.type as string) || 'signup'
const initialEmail = (route.query.email as string) || auth.user?.email || auth.profile?.email || ''
const email = ref(initialEmail)
const code = ref('')
const sending = ref(false)
const verifying = ref(false)
const countdown = ref(0)
const codeSent = ref(false)

const emailValid = computed(() => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email.value))
const canSend = computed(() => emailValid.value && countdown.value === 0 && !sending.value)
const canVerify = computed(() => emailValid.value && code.value.length === 6 && !verifying.value)

const title = computed(() => {
  if (type === 'forgot') return '找回密码'
  if (type === 'login') return '验证你的邮箱'
  return '验证邮箱'
})
const subtitle = computed(() => {
  if (type === 'forgot') return '请输入发送到邮箱的 6 位验证码，验证后请到「设置」修改密码'
  if (type === 'login') return '请输入发送到邮箱的 6 位验证码以完成登录'
  return '请输入发送到邮箱的 6 位验证码以激活账号'
})

// forgot 场景下 signup 阶段用户已填过邮箱，不让改（防填错）
const emailEditable = computed(() => {
  if (isSupabaseConfigured) return type === 'forgot' // forgot 必须登录态下不应让改，但实际 forgot 是未登录；可改
  return true
})

onMounted(() => {
  // 任何 type 都允许未登录进入
})

async function startCountdown() {
  countdown.value = 60
  const t = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) clearInterval(t)
  }, 1000)
}

async function sendCode() {
  if (!canSend.value) return
  sending.value = true
  const r = await auth.resendVerification(email.value)
  sending.value = false
  if (r.ok) {
    notify.success(r.message || '验证码已发送')
    codeSent.value = true
    startCountdown()
  } else {
    notify.error(r.message)
  }
}

async function verify() {
  if (!canVerify.value) return
  verifying.value = true
  const r = await auth.verifyOtp(email.value, code.value)
  verifying.value = false
  if (r.ok) {
    // 三个 type 都走同一条路：验证通过自动登录
    const p = await auth.ensureProfile()
    if (type === 'forgot') {
      // forgot：登录成功 → 弹窗提示去设置改密
      notify.success('验证通过，请到「设置」修改密码')
      try {
        await ElMessageBox.alert(
          '你已通过邮箱验证登录成功。\n\n请到「设置」→「修改登录密码」设置新密码。',
          '找回密码',
          { type: 'success', confirmButtonText: '去设置' }
        )
        router.replace({ name: 'settings' })
      } catch {
        // 用户关掉弹窗
        if (p?.family_id) router.replace({ name: 'home' })
        else router.replace({ name: 'onboarding' })
      }
    } else {
      // signup / login：按家庭状态分流
      if (p?.family_id) router.replace({ name: 'home' })
      else router.replace({ name: 'onboarding' })
    }
  } else {
    notify.error(r.message)
  }
}

function back() {
  if (type === 'signup') router.replace({ name: 'register' })
  else router.replace({ name: 'login' })
}
</script>

<template>
  <div class="verify-page">
    <div class="verify-card">
      <div class="verify-header">
        <div class="logo">✉️</div>
        <h1>{{ title }}</h1>
        <p class="subtitle">{{ subtitle }}</p>
      </div>

      <el-form @submit.prevent="verify" label-position="top">
        <el-form-item label="邮箱">
          <el-input
            v-model="email"
            :disabled="!emailEditable && isSupabaseConfigured"
            placeholder="请输入邮箱"
            size="large"
          />
        </el-form-item>

        <el-form-item label="验证码">
          <div class="code-row">
            <el-input v-model="code" placeholder="6 位数字" maxlength="6" size="large" />
            <el-button size="large" :disabled="!canSend" :loading="sending" @click="sendCode">
              {{ countdown > 0 ? `${countdown}s 后重发` : codeSent ? '重新发送' : '发送验证码' }}
            </el-button>
          </div>
          <div v-if="codeSent" class="hint">
            验证码已发到 <b>{{ email }}</b>
            <span v-if="!isSupabaseConfigured">（原型模式：验证码 <b>888888</b>）</span>
            <span v-else>（10 分钟内有效，请检查垃圾邮件夹）</span>
          </div>
          <div v-else-if="type === 'forgot' && !isSupabaseConfigured" class="hint">
            原型模式：直接输入验证码 <b>888888</b> 即可（不发邮件）
          </div>
        </el-form-item>

        <el-button
          type="primary"
          size="large"
          class="submit-btn"
          :disabled="!canVerify"
          :loading="verifying"
          @click="verify"
        >
          验证
        </el-button>

        <div class="bottom-tip">
          <el-link type="primary" :underline="false" @click="back">返回上一步</el-link>
        </div>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.verify-page {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #fff1ea 0%, #f5f5f7 100%);
}
.verify-card {
  width: 440px;
  padding: 40px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.06);
}
.verify-header {
  text-align: center;
  margin-bottom: 24px;
}
.logo {
  font-size: 48px;
  margin-bottom: 8px;
}
.verify-header h1 {
  font-size: 24px;
  margin: 0 0 4px;
  color: var(--color-text);
  letter-spacing: 1px;
}
.subtitle {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0;
}
.code-row {
  display: flex;
  gap: 10px;
  width: 100%;
}
.code-row .el-input {
  flex: 1;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.submit-btn {
  width: 100%;
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.bottom-tip {
  text-align: center;
  font-size: 13px;
  color: #909399;
  margin-top: 16px;
}
</style>
