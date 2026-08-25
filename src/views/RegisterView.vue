<script setup lang="ts">
/**
 * v2026-08-25 登录体系重构
 * 注册页：邮箱+密码，发验证邮件。
 * 验证邮件发出后跳 /verify-email?type=signup
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const confirm = ref('')
const agree = ref(false)
const submitting = ref(false)

const emailValid = computed(() => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email.value))

// 密码强度：8-20 位 + 至少含字母和数字
const passwordValid = computed(() => {
  const p = password.value
  return p.length >= 8 && p.length <= 20 && /[A-Za-z]/.test(p) && /\d/.test(p)
})
const passwordStrength = computed(() => {
  const p = password.value
  if (!p) return 0
  let score = 0
  if (p.length >= 8) score++
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p)) score++
  if (/[a-z]/.test(p)) score++
  if (/\d/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  if (score <= 2) return 1 // 弱
  if (score <= 4) return 2 // 中
  return 3 // 强
})
const strengthLabel = computed(() => ['', '弱', '中', '强'][passwordStrength.value])
const strengthColor = computed(() => ['', '#f56c6c', '#e6a23c', '#67c23a'][passwordStrength.value])

const confirmValid = computed(() => password.value === confirm.value && confirm.value.length > 0)
const canSubmit = computed(
  () => emailValid.value && passwordValid.value && confirmValid.value && agree.value && !submitting.value
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  const r = await auth.signUp(email.value, password.value)
  submitting.value = false
  if (r.ok) {
    notify.success(r.message)
    // 跳到验证页，让用户输入 6 位 OTP
    router.push({ name: 'verify-email', query: { type: 'signup', email: email.value } })
  } else {
    notify.error(r.message)
  }
}
</script>

<template>
  <div class="register-page">
    <div class="register-card">
      <div class="register-header">
        <div class="logo">🏠</div>
        <h1>创建账号</h1>
        <p class="subtitle">使用邮箱和密码注册，我们会发一封验证邮件</p>
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
            placeholder="8-20 位，含字母和数字"
            size="large"
            autocomplete="new-password"
          />
          <div v-if="password" class="strength-bar">
            <div
              class="strength-fill"
              :style="{
                width: ['0%', '33%', '66%', '100%'][passwordStrength],
                background: strengthColor
              }"
            />
            <span class="strength-label" :style="{ color: strengthColor }">{{ strengthLabel }}</span>
          </div>
          <div class="hint">8-20 位，必须同时包含字母和数字</div>
        </el-form-item>

        <el-form-item label="确认密码">
          <el-input
            v-model="confirm"
            type="password"
            show-password
            placeholder="再次输入"
            size="large"
            autocomplete="new-password"
          />
          <div v-if="confirm && !confirmValid" class="hint error">两次密码不一致</div>
        </el-form-item>

        <div class="agree-row">
          <el-checkbox v-model="agree">我同意《服务条款》和《隐私政策》</el-checkbox>
        </div>

        <el-button
          type="primary"
          size="large"
          class="submit-btn"
          :disabled="!canSubmit"
          :loading="submitting"
          @click="submit"
        >
          发送验证邮件
        </el-button>

        <div class="bottom-tip">
          已有账号？
          <el-link type="primary" :underline="false" @click="router.push({ name: 'login' })">
            返回登录
          </el-link>
        </div>

        <div v-if="!isSupabaseConfigured" class="prototype-tip">
          原型模式：邮箱填什么都能进，直接跳转到家庭创建页
        </div>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.register-page {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #fff1ea 0%, #f5f5f7 100%);
}
.register-card {
  width: 440px;
  padding: 40px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.06);
}
.register-header {
  text-align: center;
  margin-bottom: 24px;
}
.logo {
  font-size: 48px;
  margin-bottom: 8px;
}
.register-header h1 {
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
.strength-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.strength-fill {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  transition: all 0.2s;
}
.strength-label {
  font-size: 12px;
  min-width: 24px;
  text-align: right;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.hint.error {
  color: #f56c6c;
}
.agree-row {
  margin: 4px 0 20px;
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
.prototype-tip {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fdf6ec;
  color: #b88230;
  border-radius: 6px;
  font-size: 12px;
  text-align: center;
}
</style>
