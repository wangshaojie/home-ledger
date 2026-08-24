<script setup lang="ts">
import { useRouter, useRoute, RouterView } from 'vue-router'
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFamilyStore } from '@/stores/family'

const auth = useAuthStore()
const familyStore = useFamilyStore()
const router = useRouter()
const route = useRoute()

const navItems = [
  { name: 'home', label: '记账', icon: 'Notebook' },
  { name: 'stats', label: '统计', icon: 'DataLine' },
  { name: 'accounts', label: '账户', icon: 'CreditCard' },
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
        <span class="brand-text">家庭记账</span>
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
  background: #1f2329;
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 24px 24px;
  border-bottom: 1px solid #2a2f37;
  margin-bottom: 16px;
}
.brand-icon {
  font-size: 26px;
}
.brand-text {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 1px;
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
  color: #b8bcc4;
  border-radius: 8px;
  cursor: pointer;
  font-size: 15px;
  text-align: left;
  transition: all 0.15s;
}
.nav-item:hover {
  background: #2a2f37;
  color: #fff;
}
.nav-item.active {
  background: var(--color-primary);
  color: #fff;
}
.nav-icon {
  font-size: 18px;
}

.sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid #2a2f37;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.user-info {
  font-size: 12px;
  color: #8a8f99;
}
.user-email {
  color: #d4d6da;
  font-size: 13px;
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.main-area {
  flex: 1;
  overflow: auto;
  padding: 32px 40px;
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
