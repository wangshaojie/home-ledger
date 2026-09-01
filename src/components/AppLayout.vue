<script setup lang="ts">
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
  { name: 'settings', label: '设置', icon: 'Setting' }
]

const active = computed(() => {
  if (route.name === 'home') return 'home'
  if (route.name === 'stats') return 'stats'
  if (route.name === 'accounts') return 'accounts'
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
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-icon">🏠</span>
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
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-email" :title="userEmail">{{ userEmail }}</div>
          <div class="user-family" :title="familyName">家庭：{{ familyName }}</div>
        </div>
        <el-button text @click="logout">
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
  background: var(--color-bg);
}

.sidebar {
  width: 220px;
  background: linear-gradient(180deg, #1f2329 0%, #171a1f 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
  flex-shrink: 0;
}

.brand {
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
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(245, 108, 44, 0.35);
  flex-shrink: 0;
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
  transition: all 0.18s;
  position: relative;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}
.nav-item.active {
  background: linear-gradient(135deg, #ff8f4d, #f56c2c);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(245, 108, 44, 0.32);
}
.nav-icon {
  font-size: 18px;
}

.sidebar-footer {
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
}
.sidebar-footer :deep(.el-button:hover) {
  color: #fff;
  background: rgba(255, 255, 255, 0.07);
}

.main-area {
  flex: 1;
  overflow: auto;
  padding: 32px 20px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
