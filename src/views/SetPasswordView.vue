<script setup lang="ts">
/**
 * v2026-09-02 注册流程改版
 * 验证完邮箱后让用户设置密码。要求：
 *   - 已登录态（verifyOtp 通过后自动登录）
 *   - 8-20 位 + 字母 + 数字
 *   - 两次输入一致
 * 设完密码 → updateUser（auth.setPassword） → markEmailVerified → 进 Onboarding 建家庭
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const password = ref('')
const confirm = ref('')
const submitting = ref(false)

// 8-20 位 + 至少含字母和数字
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
  if (score <= 2) return 1
  if (score <= 4) return 2
  return 3
})
const strengthLabel = computed(() => ['', '弱', '中', '强'][passwordStrength.value])
const strengthColor = computed(() => ['', '#f56c6c', '#e6a23c', '#67c23a'][passwordStrength.value])

const confirmValid = computed(() => password.value === confirm.value && confirm.value.length > 0)
const canSubmit = computed(
  () => passwordValid.value && confirmValid.value && !submitting.value
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  const r = await auth.setPassword(password.value)
  submitting.value = false
  if (!r.ok) {
    notify.error(r.message)
    return
  }
  // 标记邮箱已验证（注册流程到这里才算真正完成）
  const mv = await auth.markEmailVerified()
  if (!mv.ok) {
    // 不阻断流程：密码已经设好；只是 verified 标志没更新成功,提示但不阻塞
    notify.warning(mv.message || '密码已设置，但验证状态更新失败，请稍后在「设置」中重试')
  } else {
    notify.success('密码设置成功，请创建或加入家庭')
  }
  // 设完密码保持登录态,进 Onboarding 建家庭
  router.replace({ name: 'onboarding' })
}
</script>

<template>
  <div class="setpwd-page">
    <div class="setpwd-card">
      <div class="setpwd-header">
        <div class="logo">🔑</div>
        <h1>设置登录密码</h1>
        <p class="subtitle">邮箱已验证，请为账号设置一个登录密码</p>
      </div>

      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="新密码">
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

        <el-button
          type="primary"
          size="large"
          class="submit-btn"
          :disabled="!canSubmit"
          :loading="submitting"
          @click="submit"
        >
          设置密码并继续
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.setpwd-page {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #fff3ec 0%, #f5f5f7 100%);
}
.setpwd-card {
  width: 440px;
  padding: 40px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.06);
}
.setpwd-header {
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
.setpwd-header h1 {
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
</style>
