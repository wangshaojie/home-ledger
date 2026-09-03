<script setup lang="ts">
/**
 * v2026-09-03 登录页重设计
 * - 深色科技感 + 流光动画 + 玻璃拟态
 * - 样式复用 main.css 的 .dark-page 公共设计系统
 * - 保留全部功能(邮箱/密码/记住/忘密/注册/免责)
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const remember = ref(true)
const shake = ref(false)
const cardVisible = ref(false)

const emailValid = computed(() => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email.value))
const canSubmit = computed(
  () => emailValid.value && password.value.length >= 6 && !submitting.value
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
  const r = await auth.signInWithPassword(email.value, password.value, remember.value)
  submitting.value = false
  if (r.ok) {
    notify.success(r.message)
    const p = await auth.ensureProfile()
    if (p?.family_id) router.push({ name: 'home' })
    else router.push({ name: 'onboarding' })
  } else {
    notify.error(r.message)
    triggerShake()
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
  <div class="dark-page login-page">
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
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none">
            <defs>
              <linearGradient id="logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#fff" stop-opacity="0.95" />
                <stop offset="1" stop-color="#fff" stop-opacity="0.7" />
              </linearGradient>
            </defs>
            <path
              d="M16 4 L28 13 L28 27 C28 28.1 27.1 29 26 29 L19 29 L19 20 C19 19.4 18.6 19 18 19 L14 19 C13.4 19 13 19.4 13 20 L13 29 L6 29 C4.9 29 4 28.1 4 27 L4 13 Z"
              fill="url(#logo-grad)"
            />
          </svg>
          <div class="logo-shine-bar" aria-hidden="true"></div>
        </div>
        <h1 class="title">
          <span class="title-cn">家庭记账</span>
          <span class="title-en">HOME LEDGER</span>
        </h1>
        <p class="subtitle">邮箱 + 密码登录</p>
      </div>

      <form class="login-form" @submit.prevent="submit" novalidate>
        <div class="field" :class="{ 'is-filled': email, 'is-valid': emailValid && email }">
          <label for="login-email" class="field-label">邮箱</label>
          <div class="field-input-wrap">
            <span class="field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </span>
            <input
              id="login-email"
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

        <div class="field" :class="{ 'is-filled': password }">
          <label for="login-password" class="field-label">
            <span>密码</span>
            <a class="field-link" href="#" tabindex="0" @click.prevent="goForgot">忘记密码？</a>
          </label>
          <div class="field-input-wrap">
            <span class="field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 1 1 8 0v3" />
                <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <input
              id="login-password"
              v-model="password"
              type="password"
              class="field-input"
              placeholder="8-20 位"
              autocomplete="current-password"
              :disabled="submitting"
              @keyup.enter="submit"
            />
          </div>
        </div>

        <label class="remember-row">
          <input v-model="remember" type="checkbox" class="remember-input" />
          <span class="remember-box" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12.5l4 4L19 7" />
            </svg>
          </span>
          <span class="remember-text">30 天免登录（关闭后下次需重新登录）</span>
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
              登录中…
            </template>
            <template v-else>登 录</template>
          </span>
        </button>

        <div class="bottom-tip">
          没账号？
          <a class="link" href="#" tabindex="0" @click.prevent="goRegister">立即注册</a>
        </div>
      </form>

      <div class="footer-tip">本产品仅记录家庭支出，不含收入统计、理财、社交功能</div>
    </main>
  </div>
</template>
