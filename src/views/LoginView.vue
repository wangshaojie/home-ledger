<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'

const router = useRouter()
const auth = useAuthStore()

const mode = ref<'otp' | 'password'>('otp')
const email = ref('')
const code = ref('')
const password = ref('')
const sending = ref(false)
const verifying = ref(false)
const countdown = ref(0)
const remember = ref(true)

const emailValid = computed(() => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email.value))
const canSend = computed(() => emailValid.value && countdown.value === 0 && !sending.value)
const canVerify = computed(() => {
  if (!emailValid.value) return false
  if (mode.value === 'otp') return code.value.length === 6
  return password.value.length >= 6
})

async function sendOtp() {
  if (!canSend.value) return
  sending.value = true
  const r = await auth.sendOtp(email.value)
  sending.value = false
  if (r.ok) {
    notify.success(r.message)
    countdown.value = 60
    const t = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) clearInterval(t)
    }, 1000)
  } else {
    notify.error(r.message)
  }
}

async function submit() {
  if (!canVerify.value) return
  verifying.value = true
  const r =
    mode.value === 'otp'
      ? await auth.verifyOtp(email.value, code.value)
      : await auth.signInWithPassword(email.value, password.value)
  verifying.value = false
  if (r.ok) {
    notify.success(r.message)
    if (auth.hasFamily) router.push({ name: 'home' })
    else router.push({ name: 'onboarding' })
  } else {
    notify.error(r.message)
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <div class="logo">🏠</div>
        <h1>家庭记账</h1>
        <p class="subtitle">邮箱验证码登录，新用户自动注册</p>
      </div>

      <el-tabs v-model="mode" class="login-tabs">
        <el-tab-pane label="验证码登录" name="otp" />
        <el-tab-pane label="密码登录" name="password" />
      </el-tabs>

      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="邮箱">
          <el-input v-model="email" placeholder="请输入邮箱" clearable size="large" />
        </el-form-item>

        <el-form-item v-if="mode === 'otp'" label="验证码">
          <div class="code-row">
            <el-input v-model="code" placeholder="6 位数字" maxlength="6" size="large" />
            <el-button size="large" :disabled="!canSend" :loading="sending" @click="sendOtp">
              {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
            </el-button>
          </div>
          <div class="hint">
            <template v-if="!isSupabaseConfigured">
              原型模式：任何邮箱 + 验证码 <b>888888</b> 即可通过
            </template>
            <template v-else>
              验证码会发送到你的邮箱（请检查垃圾邮件夹）
            </template>
          </div>
        </el-form-item>

        <el-form-item v-else label="密码">
          <el-input v-model="password" type="password" show-password placeholder="6-20 位" size="large" />
          <div class="hint">
            <template v-if="!isSupabaseConfigured">原型模式：密码 <b>888888</b></template>
            <template v-else>未设置密码的账号请用「验证码登录」</template>
          </div>
        </el-form-item>

        <div class="remember-row">
          <el-checkbox v-model="remember">记住登录状态</el-checkbox>
        </div>

        <el-button
          type="primary"
          size="large"
          class="submit-btn"
          :disabled="!canVerify"
          :loading="verifying"
          @click="submit"
        >
          登录 / 注册
        </el-button>
      </el-form>

      <div class="footer-tip">本产品仅记录家庭支出，不含收入统计、理财、社交功能</div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #fff1ea 0%, #f5f5f7 100%);
}
.login-card {
  width: 440px;
  padding: 40px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.06);
}
.login-header {
  text-align: center;
  margin-bottom: 24px;
}
.logo {
  font-size: 48px;
  margin-bottom: 8px;
}
.login-header h1 {
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
.login-tabs {
  margin-bottom: 16px;
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
.remember-row {
  margin: 8px 0 20px;
}
.submit-btn {
  width: 100%;
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.footer-tip {
  text-align: center;
  font-size: 12px;
  color: #909399;
  margin-top: 24px;
}
</style>
