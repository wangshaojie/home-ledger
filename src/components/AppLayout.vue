<script setup lang="ts">
/**
 * v2026-09-03 视觉升级
 * - 侧边栏：毛玻璃 + 发光描边 + 活动项流光
 * - 主区：暖色径向背景 + 柔光光斑
 */
import { useRouter, useRoute, RouterView } from 'vue-router'
import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useFamilyStore } from '@/stores/family'

const auth = useAuthStore()
const familyStore = useFamilyStore()
const router = useRouter()
const route = useRoute()

const navItems = [
  { name: 'home', label: '记账', icon: 'Notebook' },
  { name: 'stats', label: '统计', icon: 'DataLine' },
  { name: 'accounts', label: '支付账户', icon: 'CreditCard' },
  { name: 'mcp', label: 'AI 接入', icon: 'Connection' },
  { name: 'settings', label: '设置', icon: 'Setting' }
]

const active = computed(() => {
  if (route.name === 'home') return 'home'
  if (route.name === 'stats') return 'stats'
  if (route.name === 'accounts') return 'accounts'
  if (route.name === 'mcp') return 'mcp'
  if (route.name === 'settings') return 'settings'
  return ''
})

function go(name: string) {
  router.push({ name })
}

async function logout() {
  try {
    await ElMessageBox.confirm(
      '确定要退出当前账号吗？',
      '退出登录',
      {
        type: 'warning',
        confirmButtonText: '退出',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  await auth.logout()
  router.push({ name: 'login' })
}

const userEmail = computed(() => auth.profile?.email || '')
const familyName = computed(() => familyStore.family?.name || '未命名家庭')
</script>

<template>
  <div class="app-shell app-main-bg">
    <aside class="sidebar">
      <div class="sidebar-glow" aria-hidden="true"></div>

      <div class="brand">
        <span class="brand-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="20" height="20" fill="none">
            <path
              d="M16 4 L28 13 L28 27 C28 28.1 27.1 29 26 29 L19 29 L19 20 C19 19.4 18.6 19 18 19 L14 19 C13.4 19 13 19.4 13 20 L13 29 L6 29 C4.9 29 4 28.1 4 27 L4 13 Z"
              fill="#fff"
              fill-opacity="0.95"
            />
          </svg>
        </span>
        <span class="brand-text">{{ familyStore.family?.name || '家庭记账' }}</span>
      </div>

      <nav class="nav-list">
        <button
          v-for="item in navItems"
          :key="item.name"
          class="nav-item"
          :class="{ active: active === item.name }"
          @click="go(item.name)"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
          <span v-if="active === item.name" class="nav-active-glow" aria-hidden="true"></span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-email" :title="userEmail">{{ userEmail }}</div>
          <div class="user-family" :title="familyName">家庭：{{ familyName }}</div>
        </div>
        <el-button text class="logout-btn" @click="logout">
          <el-icon><SwitchButton /></el-icon>
          <span style="margin-left: 4px">退出</span>
        </el-button>
      </div>
    </aside>

    <main class="main-area">
      <RouterView v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
}

.sidebar {
  position: relative;
  width: 220px;
  background: linear-gradient(180deg, #1f2329 0%, #131419 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
  flex-shrink: 0;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
/* 侧边栏右上角橙色光晕 */
.sidebar-glow {
  position: absolute;
  top: -80px;
  right: -80px;
  width: 220px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(245, 108, 44, 0.35) 0%, transparent 70%);
  filter: blur(40px);
  pointer-events: none;
  animation: sidebar-glow-float 12s ease-in-out infinite;
}
@keyframes sidebar-glow-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-30px, 20px) scale(1.1); }
}

.brand {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 16px;
}
.brand-icon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: linear-gradient(135deg, #ff8f4d, #f56c2c);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 4px 12px rgba(245, 108, 44, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.brand-icon::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 60%;
  height: 100%;
  background: linear-gradient(100deg, transparent 0%, rgba(255, 255, 255, 0.45) 50%, transparent 100%);
  animation: brand-shine 4s ease-in-out infinite;
}
@keyframes brand-shine {
  0%, 100% { left: -100%; }
  50%, 80% { left: 150%; }
}
.brand-text {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-list {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 12px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border: none;
  background: transparent;
  color: #9aa0ab;
  border-radius: 10px;
  cursor: pointer;
  font-size: 15px;
  text-align: left;
  transition: all 0.2s var(--app-ease, cubic-bezier(0.16, 1, 0.3, 1));
  position: relative;
  overflow: hidden;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
  transform: translateX(2px);
}
.nav-item.active {
  background: linear-gradient(135deg, #ff8f4d, #f56c2c);
  color: #fff;
  font-weight: 600;
  box-shadow:
    0 4px 14px rgba(245, 108, 44, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.nav-item.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 3px;
  background: #fff;
  border-radius: 0 2px 2px 0;
}
/* 活动项上的微光扫过 */
.nav-active-glow {
  position: absolute;
  top: 0;
  left: -100%;
  width: 50%;
  height: 100%;
  background: linear-gradient(100deg, transparent 0%, rgba(255, 255, 255, 0.3) 50%, transparent 100%);
  animation: nav-shine 3s ease-in-out infinite;
  pointer-events: none;
}
@keyframes nav-shine {
  0%, 100% { left: -100%; }
  60%, 90% { left: 150%; }
}
.nav-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.sidebar-footer {
  position: relative;
  z-index: 1;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.user-info {
  font-size: 12px;
  color: #7c828d;
}
.user-email {
  color: #d4d6da;
  font-size: 13px;
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.sidebar-footer :deep(.el-button) {
  color: #9aa0ab;
  border-radius: 8px;
  padding: 6px 10px;
  transition: all 0.18s;
  justify-content: flex-start;
}
.sidebar-footer :deep(.el-button:hover) {
  color: #fff;
  background: rgba(255, 255, 255, 0.07);
}
.logout-btn :deep(.el-icon) {
  transition: transform 0.2s;
}
.logout-btn:hover :deep(.el-icon) {
  transform: translateX(2px);
}

.main-area {
  flex: 1;
  overflow: auto;
  padding: 32px 20px;
  position: relative;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-glow,
  .brand-icon::after,
  .nav-active-glow,
  .nav-item {
    animation: none !important;
    transition: none !important;
  }
  .nav-item:hover {
    transform: none;
  }
}
</style>
