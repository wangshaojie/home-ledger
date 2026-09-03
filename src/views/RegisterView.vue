<script setup lang="ts">
/**
 * v2026-09-02 注册流程改版
 *   注册页只填邮箱 → 发验证邮件 → 验证完进 /set-password 设密码 → Onboarding
 * v2026-09-03 视觉对齐 dark-page 设计系统
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const agree = ref(false)
const submitting = ref(false)
const cardVisible = ref(false)
const shake = ref(false)

const emailValid = computed(() => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email.value))
const canSubmit = computed(() => emailValid.value && agree.value && !submitting.value)

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
  const r = await auth.signUp(email.value)
  submitting.value = false
  if (r.ok) {
    notify.success(r.message)
    router.push({ name: 'verify-email', query: { type: 'signup', email: email.value } })
  } else {
    notify.error(r.message)
    triggerShake()
  }
}
</script>

<template>
  <div class="dark-page register-page">
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
              <linearGradient id="register-logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#fff" stop-opacity="0.95" />
                <stop offset="1" stop-color="#fff" stop-opacity="0.75" />
              </linearGradient>
            </defs>
            <path
              d="M5 9 L27 9 C28.1 9 29 9.9 29 11 L29 23 C29 24.1 28.1 25 27 25 L5 25 C3.9 25 3 24.1 3 23 L3 11 C3 9.9 3.9 9 5 9 Z"
              fill="url(#register-logo-grad)"
            />
            <path
              d="M5 11 L16 19 L27 11"
              stroke="rgba(245,108,44,0.55)"
              stroke-width="2"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <div class="logo-shine-bar" aria-hidden="true"></div>
        </div>
        <h1 class="title">
          <span class="title-cn">创建账号</span>
          <span class="title-en">SIGN UP</span>
        </h1>
        <p class="subtitle">填邮箱 → 验证邮箱 → 设置密码，三步完成注册</p>
      </div>

      <form class="page-form" @submit.prevent="submit" novalidate>
        <div class="field" :class="{ 'is-filled': email, 'is-valid': emailValid && email }">
          <label for="register-email" class="field-label">邮箱</label>
          <div class="field-input-wrap">
            <span class="field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </span>
            <input
              id="register-email"
              v-model="email"
              type="email"
              class="field-input"
              placeholder="you@example.com"
              autocomplete="email"
              spellcheck="false"
              :disabled="submitting"
            />
            <span v-if="emailValid" class="field-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.5l4 4L19 7" />
              </svg>
            </span>
          </div>
        </div>

        <label class="remember-row">
          <input v-model="agree" type="checkbox" class="remember-input" />
          <span class="remember-box" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12.5l4 4L19 7" />
            </svg>
          </span>
          <span class="remember-text">我同意《服务条款》和《隐私政策》</span>
        </label>

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
              发送中…
            </template>
            <template v-else>发送验证邮件</template>
          </span>
        </button>

        <div class="bottom-tip">
          已有账号？
          <a class="link" href="#" tabindex="0" @click.prevent="router.push({ name: 'login' })">返回登录</a>
        </div>
      </form>
    </main>
  </div>
</template>
