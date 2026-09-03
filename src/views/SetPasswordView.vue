<script setup lang="ts">
/**
 * v2026-09-02 注册流程改版
 * v2026-09-03 视觉对齐 dark-page 设计系统
 * 验证完邮箱后让用户设置密码。要求：
 *   - 已登录态（verifyOtp 通过后自动登录）
 *   - 8-20 位 + 字母 + 数字
 *   - 两次输入一致
 * 设完密码 → updateUser（auth.setPassword） → markEmailVerified → 进 Onboarding 建家庭
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const password = ref('')
const confirm = ref('')
const submitting = ref(false)
const cardVisible = ref(false)
const shake = ref(false)

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
const strengthWidth = computed(() => ['0%', '33%', '66%', '100%'][passwordStrength.value])

const confirmValid = computed(() => password.value === confirm.value && confirm.value.length > 0)
const canSubmit = computed(
  () => passwordValid.value && confirmValid.value && !submitting.value
)

const reduceMotion = ref(false)
let mq: MediaQueryList | null = null
function onMqChange(e: MediaQueryListEvent) {
  reduceMotion.value = e.matches
}
onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduceMotion.value = mq.matches
    mq.addEventListener('change', onMqChange)
  }
  requestAnimationFrame(() => {
    cardVisible.value = true
  })
})
onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMqChange)
})

function triggerShake() {
  if (reduceMotion.value) return
  shake.value = false
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      shake.value = true
    })
  })
  setTimeout(() => {
    shake.value = false
  }, 600)
}

async function submit() {
  if (!canSubmit.value) {
    triggerShake()
    return
  }
  submitting.value = true
  const r = await auth.setPassword(password.value)
  submitting.value = false
  if (!r.ok) {
    notify.error(r.message)
    triggerShake()
    return
  }
  const mv = await auth.markEmailVerified()
  if (!mv.ok) {
    notify.warning(mv.message || '密码已设置，但验证状态更新失败，请稍后在「设置」中重试')
  } else {
    notify.success('密码设置成功，请创建或加入家庭')
  }
  router.replace({ name: 'onboarding' })
}
</script>

<template>
  <div class="dark-page setpwd-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-grid"></div>
      <div class="bg-orb bg-orb--orange"></div>
      <div class="bg-orb bg-orb--purple"></div>
      <div class="bg-orb bg-orb--cyan"></div>
      <div class="bg-noise"></div>
    </div>

    <main
      class="glass-card"
      :class="{ 'is-visible': cardVisible, 'is-shake': shake }"
      role="main"
    >
      <div class="card-border" aria-hidden="true"></div>
      <div class="card-glow" aria-hidden="true"></div>

      <div class="page-header">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="30" height="30" fill="none">
            <defs>
              <linearGradient id="setpwd-logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#fff" stop-opacity="0.95" />
                <stop offset="1" stop-color="#fff" stop-opacity="0.7" />
              </linearGradient>
            </defs>
            <path
              d="M10 14 L10 11 C10 7.7 12.7 5 16 5 C19.3 5 22 7.7 22 11 L22 14"
              stroke="url(#setpwd-logo-grad)"
              stroke-width="2.2"
              stroke-linecap="round"
              fill="none"
            />
            <rect
              x="6" y="14" width="20" height="14" rx="2.5"
              fill="url(#setpwd-logo-grad)"
            />
            <circle cx="16" cy="21" r="1.8" fill="rgba(245,108,44,0.85)" />
            <path
              d="M16 22.5 L16 25"
              stroke="rgba(245,108,44,0.85)"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
          <div class="logo-shine-bar" aria-hidden="true"></div>
        </div>
        <h1 class="title">
          <span class="title-cn">设置登录密码</span>
          <span class="title-en">SET PASSWORD</span>
        </h1>
        <p class="subtitle">邮箱已验证，请为账号设置一个登录密码</p>
      </div>

      <form class="page-form" @submit.prevent="submit" novalidate>
        <div class="field" :class="{ 'is-filled': password }">
          <label for="set-pwd" class="field-label">新密码</label>
          <div class="field-input-wrap">
            <span class="field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 1 1 8 0v3" />
              </svg>
            </span>
            <input
              id="set-pwd"
              v-model="password"
              type="password"
              class="field-input"
              placeholder="8-20 位，含字母和数字"
              autocomplete="new-password"
              :disabled="submitting"
            />
          </div>
          <div v-if="password" class="strength-bar">
            <div class="strength-track">
              <div
                class="strength-fill"
                :style="{
                  width: strengthWidth,
                  background: strengthColor,
                  boxShadow: `0 0 8px ${strengthColor}66`
                }"
              />
            </div>
            <span class="strength-label" :style="{ color: strengthColor }">{{ strengthLabel }}</span>
          </div>
          <div class="field-hint">8-20 位，必须同时包含字母和数字</div>
        </div>

        <div class="field" :class="{ 'is-filled': confirm }">
          <label for="set-pwd-confirm" class="field-label">确认密码</label>
          <div class="field-input-wrap">
            <span class="field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.5l4 4L19 7" />
              </svg>
            </span>
            <input
              id="set-pwd-confirm"
              v-model="confirm"
              type="password"
              class="field-input"
              placeholder="再次输入"
              autocomplete="new-password"
              :disabled="submitting"
              @keyup.enter="submit"
            />
          </div>
          <div
            v-if="confirm"
            class="field-hint"
            :class="{ 'is-error': !confirmValid, 'is-success': confirmValid }"
          >
            {{ confirmValid ? '两次密码一致' : '两次密码不一致' }}
          </div>
        </div>

        <button
          type="submit"
          class="submit-btn"
          :class="{ 'is-loading': submitting, 'is-disabled': !canSubmit }"
          :disabled="!canSubmit"
          :aria-busy="submitting"
        >
          <span class="submit-shine" aria-hidden="true"></span>
          <span class="submit-text">
            <template v-if="submitting">
              <span class="spinner" aria-hidden="true"></span>
              设置中…
            </template>
            <template v-else>设置密码并继续</template>
          </span>
        </button>
      </form>
    </main>
  </div>
</template>
