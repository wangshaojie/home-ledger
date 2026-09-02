<script setup lang="ts">
/**
 * v2026-09-02 注册流程改版
 *   注册页只填邮箱 → 发验证邮件 → 验证完进 /set-password 设密码 → Onboarding
 *   旧版（邮箱+密码+确认密码+强度条）已删。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const agree = ref(false)
const submitting = ref(false)

const emailValid = computed(() => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email.value))
const canSubmit = computed(() => emailValid.value && agree.value && !submitting.value)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  const r = await auth.signUp(email.value)
  submitting.value = false
  if (r.ok) {
    notify.success(r.message)
    // 跳到验证页，让用户输入 6 位 OTP；验证通过后跳 /set-password
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
        <p class="subtitle">填邮箱 → 验证邮箱 → 设置密码，三步完成注册</p>
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
          <el-link type="primary" :underline="'never'" @click="router.push({ name: 'login' })">
            返回登录
          </el-link>
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
  background: linear-gradient(135deg, #fff3ec 0%, #f5f5f7 100%);
}
.register-card {
  width: 440px;
  padding: 40px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.06);
}
.register-header {
  text-align: center;
  margin-bottom: 24px;
}
.logo {
  width: 64px;
  height: 64px;
  margin: 0 auto 14px;
  border-radius: 18px;
  background: linear-gradient(135deg, #ff8f4d 0%, #f56c2c 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  box-shadow: 0 8px 20px rgba(245, 108, 44, 0.35);
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
  background-image: linear-gradient(135deg, #ff8f4d 0%, #f56c2c 100%);
  border: none;
  border-radius: 12px;
  box-shadow: var(--shadow-btn);
  transition: transform 0.15s, box-shadow 0.15s;
}
.submit-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(245, 108, 44, 0.4);
}
.submit-btn.is-disabled {
  background-image: none;
  background-color: var(--el-color-primary-light-7);
  color: var(--el-color-primary);
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
