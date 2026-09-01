<script setup lang="ts">
/**
 * v2026-08-25 登录体系重构
 * 密码登录页，邮箱用于验证（注册/改密/忘密）。
 * - 默认展示：邮箱 + 密码登录
 * - 底部入口：注册、忘密（→ 跳 /verify-email）
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const remember = ref(true)

const emailValid = computed(() => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email.value))
const canSubmit = computed(
  () => emailValid.value && password.value.length >= 6 && !submitting.value
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  const r = await auth.signInWithPassword(email.value, password.value, remember.value)
  submitting.value = false
  if (r.ok) {
    notify.success(r.message)
    const p = await auth.ensureProfile()
    if (p?.family_id) router.push({ name: 'home' })
    else router.push({ name: 'onboarding' })
  } else {
    notify.error(r.message)
    // 邮箱未验证：跳到验证页（让用户重发验证码）
    if ((r as any).code === 'email_not_verified') {
      setTimeout(() => {
        router.push({
          name: 'verify-email',
          query: { type: 'login', email: email.value }
        })
      }, 1200)
    }
  }
}

function goRegister() {
  router.push({ name: 'register' })
}

function goForgot() {
  router.push({ name: 'verify-email', query: { type: 'forgot', email: email.value } })
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <div class="logo">🏠</div>
        <h1>家庭记账</h1>
        <p class="subtitle">邮箱 + 密码登录</p>
      </div>

      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="邮箱">
          <el-input
            v-model="email"
            placeholder="请输入邮箱"
            clearable
            size="large"
            type="email"
            autocomplete="email"
          />
        </el-form-item>

        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            show-password
            placeholder="8-20 位"
            size="large"
            autocomplete="current-password"
            @keyup.enter="submit"
          />
          <div class="hint">
            <el-link type="primary" :underline="false" @click="goForgot">忘记密码？</el-link>
          </div>
        </el-form-item>

        <div class="remember-row">
          <el-checkbox v-model="remember">30 天免登录（关闭后下次需重新登录）</el-checkbox>
        </div>

        <el-button
          type="primary"
          size="large"
          class="submit-btn"
          :disabled="!canSubmit"
          :loading="submitting"
          @click="submit"
        >
          登录
        </el-button>

        <div class="bottom-tip">
          没账号？
          <el-link type="primary" :underline="false" @click="goRegister">立即注册</el-link>
        </div>
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
.bottom-tip {
  text-align: center;
  font-size: 13px;
  color: #909399;
  margin-top: 16px;
}
.footer-tip {
  text-align: center;
  font-size: 12px;
  color: #909399;
  margin-top: 24px;
}
</style>
