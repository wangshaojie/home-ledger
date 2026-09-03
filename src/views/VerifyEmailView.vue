<script setup lang="ts">
/**
 * v2026-08-25 登录体系重构
 * v2026-09-02 注册流程改版
 * v2026-09-03 视觉对齐 dark-page 设计系统
 *
 * 邮箱验证页：输入 6 位 OTP
 *  根据 query.type 决定后续跳转：
 *   - signup  → 验证通过后自动登录 → /set-password（设密码）→ /onboarding（建家庭）
 *   - forgot  → 验证通过后自动登录 → 提示去「设置」改密
 *   - login   → 验证通过后自动登录 → 主页
 *
 * forgot 实现说明：复用 signInWithOtp / verifyOtp（Supabase 自带流程，未登录态合法）。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

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
const cardVisible = ref(false)
const shake = ref(false)

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
  return '请输入发送到邮箱的 6 位验证码，验证后设置密码即可激活账号'
})

// forgot 场景下 signup 阶段用户已填过邮箱，不让改（防填错）
const emailEditable = computed(() => type === 'forgot')

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
  if (countdownTimer) clearInterval(countdownTimer)
})

let countdownTimer: ReturnType<typeof setInterval> | null = null

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

async function startCountdown() {
  countdown.value = 60
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0 && countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
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
    triggerShake()
  }
}

async function verify() {
  if (!canVerify.value) {
    triggerShake()
    return
  }
  verifying.value = true
  const r = await auth.verifyOtp(email.value, code.value)
  verifying.value = false
  if (r.ok) {
    if (type === 'signup') {
      router.replace({ name: 'set-password' })
      return
    }
    const p = await auth.ensureProfile()
    if (type === 'forgot') {
      notify.success('验证通过，请到「设置」修改密码')
      try {
        await ElMessageBox.alert(
          '你已通过邮箱验证登录成功。\n\n请到「设置」→「修改登录密码」设置新密码。',
          '找回密码',
          { type: 'success', confirmButtonText: '去设置' }
        )
        router.replace({ name: 'settings' })
      } catch {
        if (p?.family_id) router.replace({ name: 'home' })
        else router.replace({ name: 'onboarding' })
      }
    } else {
      if (p?.family_id) router.replace({ name: 'home' })
      else router.replace({ name: 'onboarding' })
    }
  } else {
    notify.error(r.message)
    triggerShake()
  }
}

function back() {
  if (type === 'signup') router.replace({ name: 'register' })
  else router.replace({ name: 'login' })
}
</script>

<template>
  <div class="dark-page verify-page">
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
              <linearGradient id="verify-logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#fff" stop-opacity="0.95" />
                <stop offset="1" stop-color="#fff" stop-opacity="0.75" />
              </linearGradient>
            </defs>
            <path
              d="M5 9 L27 9 C28.1 9 29 9.9 29 11 L29 23 C29 24.1 28.1 25 27 25 L5 25 C3.9 25 3 24.1 3 23 L3 11 C3 9.9 3.9 9 5 9 Z"
              fill="url(#verify-logo-grad)"
            />
            <path
              d="M5 11 L16 19 L27 11"
              stroke="rgba(245,108,44,0.55)"
              stroke-width="2"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle cx="16" cy="17" r="2.4" fill="#fff" stroke="rgba(245,108,44,0.7)" stroke-width="1.4" />
          </svg>
          <div class="logo-shine-bar" aria-hidden="true"></div>
        </div>
        <h1 class="title">
          <span class="title-cn">{{ title }}</span>
          <span class="title-en">VERIFY EMAIL</span>
        </h1>
        <p class="subtitle">{{ subtitle }}</p>
      </div>

      <form class="page-form" @submit.prevent="verify" novalidate>
        <div class="field" :class="{ 'is-filled': email }">
          <label for="verify-email" class="field-label">邮箱</label>
          <div class="field-input-wrap">
            <span class="field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </span>
            <input
              id="verify-email"
              v-model="email"
              type="email"
              class="field-input"
              placeholder="you@example.com"
              autocomplete="email"
              spellcheck="false"
              :disabled="submitting || !emailEditable"
            />
          </div>
        </div>

        <div class="field" :class="{ 'is-filled': code }">
          <label for="verify-code" class="field-label">验证码</label>
          <div class="code-row">
            <div class="field-input-wrap">
              <span class="field-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3 L19 7 L19 12 C19 16.4 15.9 20 12 21 C8.1 20 5 16.4 5 12 L5 7 Z" />
                  <path d="M9 12.5 L11 14.5 L15.5 10" />
                </svg>
              </span>
              <input
                id="verify-code"
                v-model="code"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                class="field-input"
                placeholder="6 位数字"
                maxlength="6"
                autocomplete="one-time-code"
                :disabled="verifying"
                @keyup.enter="verify"
              />
            </div>
            <button
              type="button"
              class="code-send-btn"
              :disabled="!canSend"
              @click="sendCode"
            >
              <span v-if="sending" class="spinner" aria-hidden="true"></span>
              <template v-else>
                {{ countdown > 0 ? `${countdown}s 后重发` : codeSent ? '重新发送' : '发送验证码' }}
              </template>
            </button>
          </div>
          <div v-if="codeSent" class="info-banner">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>验证码已发到 <b>{{ email }}</b>（10 分钟内有效，请检查垃圾邮件夹）</span>
          </div>
        </div>

        <button
          type="submit"
          class="submit-btn"
          :class="{ 'is-loading': verifying, 'is-disabled': !canVerify }"
          :disabled="!canVerify"
          :aria-busy="verifying"
        >
          <span class="submit-shine" aria-hidden="true"></span>
          <span class="submit-text">
            <template v-if="verifying">
              <span class="spinner" aria-hidden="true"></span>
              验证中…
            </template>
            <template v-else>验 证</template>
          </span>
        </button>

        <div class="bottom-tip">
          <a class="link" href="#" tabindex="0" @click.prevent="back">返回上一步</a>
        </div>
      </form>
    </main>
  </div>
</template>
