<script setup lang="ts">
/**
 * v2026-09-03 视觉对齐 dark-page 设计系统
 * 创建/加入家庭:必须先加入家庭才能记账
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useFamilyStore } from '@/stores/family'

const router = useRouter()
const auth = useAuthStore()
const familyStore = useFamilyStore()

const familyName = ref('')
const displayName = ref(auth.profile?.display_name || (auth.profile?.email?.split('@')[0] ?? ''))
const submitting = ref(false)
const cardVisible = ref(false)
const shake = ref(false)

// 邀请码加入家庭：electron 默认禁用 window.prompt（Chromium 行为），
// 用 inline 表单 + dialog 状态自己渲染
const inviteDialogOpen = ref(false)
const inviteCode = ref('')
const inviteInputRef = ref<HTMLInputElement | null>(null)
async function openInviteDialog() {
  inviteCode.value = ''
  inviteDialogOpen.value = true
  // nextTick 后 focus 输入框（dom 还没渲染前 ref 是 null）
  await nextTick()
  inviteInputRef.value?.focus()
}

const familyNameValid = computed(() => {
  const n = familyName.value.trim()
  return n.length >= 2 && n.length <= 20
})
const displayNameValid = computed(() => displayName.value.trim().length > 0)
const canCreate = computed(
  () => familyNameValid.value && displayNameValid.value && !submitting.value
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
  if (!canCreate.value) {
    triggerShake()
    return
  }
  const name = familyName.value.trim()
  if (!name) {
    notify.warning('请输入家庭名称')
    triggerShake()
    return
  }
  if (name.length < 2 || name.length > 20) {
    notify.warning('家庭名称 2-20 字')
    triggerShake()
    return
  }
  submitting.value = true
  const dn = displayName.value.trim()
  if (dn && dn !== auth.profile?.display_name) {
    await auth.updateDisplayName(dn)
  }
  const r = await auth.createFamily(name)
  if (!r.ok) {
    submitting.value = false
    notify.error(r.message)
    triggerShake()
    return
  }
  await familyStore.load()
  submitting.value = false
  notify.success(r.message)
  router.push({ name: 'home' })
}

async function joinByInvite() {
  // electron 默认 window.prompt 返回 null（Chromium 行为），改用自渲染 inline 对话框
  await openInviteDialog()
}

async function confirmJoinByInvite() {
  const code = inviteCode.value.trim().toUpperCase()
  if (!code) {
    notify.warning('请输入邀请码')
    return
  }
  inviteDialogOpen.value = false
  try {
    await ElMessageBox.confirm(
      `将加入邀请码为 ${code} 的家庭。确认继续吗？`,
      '加入家庭',
      {
        type: 'info',
        confirmButtonText: '加入',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  submitting.value = true
  const r = await auth.joinFamilyByInvite(code)
  if (!r.ok) {
    submitting.value = false
    notify.error(r.message)
    return
  }
  await familyStore.load()
  submitting.value = false
  notify.success(r.message)
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="dark-page onboard-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-grid"></div>
      <div class="bg-orb bg-orb--orange"></div>
      <div class="bg-orb bg-orb--purple"></div>
      <div class="bg-orb bg-orb--cyan"></div>
      <div class="bg-noise"></div>
    </div>

    <main
      class="glass-card is-wide"
      :class="{ 'is-visible': cardVisible, 'is-shake': shake }"
      role="main"
    >
      <div class="card-border" aria-hidden="true"></div>
      <div class="card-glow" aria-hidden="true"></div>

      <div class="page-header">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="30" height="30" fill="none">
            <defs>
              <linearGradient id="onboard-logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#fff" stop-opacity="0.95" />
                <stop offset="1" stop-color="#fff" stop-opacity="0.7" />
              </linearGradient>
            </defs>
            <path
              d="M16 4 L28 13 L28 27 C28 28.1 27.1 29 26 29 L19 29 L19 20 C19 19.4 18.6 19 18 19 L14 19 C13.4 19 13 19.4 13 20 L13 29 L6 29 C4.9 29 4 28.1 4 27 L4 13 Z"
              fill="url(#onboard-logo-grad)"
            />
            <circle cx="22" cy="11" r="3" fill="rgba(245,108,44,0.9)" stroke="#fff" stroke-width="1.2" />
            <path
              d="M20.8 11 L21.6 11.8 L23.2 10.2"
              stroke="#fff"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
          <div class="logo-shine-bar" aria-hidden="true"></div>
        </div>
        <h1 class="title">
          <span class="title-cn">加入 / 创建家庭</span>
          <span class="title-en">FAMILY SETUP</span>
        </h1>
        <p class="subtitle">
          为了保护家庭账单隐私，每个账号必须先加入一个家庭才能开始记账
        </p>
      </div>

      <form class="page-form" @submit.prevent="submit" novalidate>
        <div class="field" :class="{ 'is-filled': familyName, 'is-valid': familyNameValid }">
          <label for="onboard-family" class="field-label">家庭名称</label>
          <div class="field-input-wrap">
            <span class="field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 11 L12 4 L21 11" />
                <path d="M5 10 L5 20 L19 20 L19 10" />
                <path d="M10 20 L10 14 L14 14 L14 20" />
              </svg>
            </span>
            <input
              id="onboard-family"
              v-model="familyName"
              class="field-input"
              placeholder="如：温馨之家 / 快乐小家"
              maxlength="20"
              autocomplete="off"
              :disabled="submitting"
            />
            <span v-if="familyNameValid" class="field-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.5l4 4L19 7" />
              </svg>
            </span>
          </div>
          <div class="field-hint">2-20 字，创建后可在「设置」中修改</div>
        </div>

        <div class="field" :class="{ 'is-filled': displayName, 'is-valid': displayNameValid }">
          <label for="onboard-display" class="field-label">
            <span>你的显示名</span>
            <span style="color: var(--text-muted); font-weight: 400;">家庭成员中显示</span>
          </label>
          <div class="field-input-wrap">
            <span class="field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21 C4 16.6 7.6 13 12 13 C16.4 13 20 16.6 20 21" />
              </svg>
            </span>
            <input
              id="onboard-display"
              v-model="displayName"
              class="field-input"
              placeholder="如：小明 / 爸爸 / 主厨"
              maxlength="20"
              autocomplete="off"
              :disabled="submitting"
            />
            <span v-if="displayNameValid" class="field-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.5l4 4L19 7" />
              </svg>
            </span>
          </div>
          <div class="field-hint">默认取邮箱前缀，记账时其他成员会看到这个名字</div>
        </div>

        <button
          type="submit"
          class="submit-btn"
          :class="{ 'is-loading': submitting, 'is-disabled': !canCreate }"
          :disabled="!canCreate"
          :aria-busy="submitting"
        >
          <span class="submit-shine" aria-hidden="true"></span>
          <span class="submit-text">
            <template v-if="submitting">
              <span class="spinner" aria-hidden="true"></span>
              创建中…
            </template>
            <template v-else>创建家庭并开始记账</template>
          </span>
        </button>
      </form>

      <div class="divider">
        <span>OR</span>
      </div>

      <button
        type="button"
        class="secondary-btn"
        :disabled="submitting"
        @click="joinByInvite"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
          <path d="M16 11 L16 7 C16 4.8 14.2 3 12 3 C9.8 3 8 4.8 8 7 L8 11" />
          <rect x="5" y="11" width="14" height="10" rx="2" />
        </svg>
        输入邀请码加入家庭
      </button>

      <ul class="tip-list">
        <li>家庭名称创建后可在「设置」中修改</li>
        <li>不同家庭账单数据相互隔离，无法互通</li>
        <li>家庭成员可在「设置」中查看邀请码</li>
      </ul>
    </main>

    <!-- 邀请码输入对话框（Electron 默认禁用 window.prompt，自渲染） -->
    <div v-if="inviteDialogOpen" class="invite-overlay" @click.self="inviteDialogOpen = false">
      <div class="invite-dialog" role="dialog" aria-modal="true" aria-label="输入邀请码">
        <h3 class="invite-title">输入邀请码</h3>
        <p class="invite-sub">向家庭管理员索取 6 位邀请码</p>
        <input
          ref="inviteInputRef"
          v-model="inviteCode"
          class="invite-input"
          type="text"
          inputmode="text"
          maxlength="6"
          placeholder="6 位邀请码"
          autocomplete="off"
          autofocus
          @keyup.enter="confirmJoinByInvite"
          @keyup.escape="inviteDialogOpen = false"
        />
        <div class="invite-actions">
          <button type="button" class="invite-btn invite-btn--ghost" @click="inviteDialogOpen = false">取消</button>
          <button
            type="button"
            class="invite-btn invite-btn--primary"
            :disabled="!inviteCode.trim()"
            @click="confirmJoinByInvite"
          >加入</button>
        </div>
      </div>
    </div>
  </div>
</template>
