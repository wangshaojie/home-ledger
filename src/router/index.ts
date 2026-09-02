import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { layout: 'blank' }
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { layout: 'blank' }
  },
  {
    path: '/verify-email',
    name: 'verify-email',
    component: () => import('@/views/VerifyEmailView.vue'),
    meta: { layout: 'blank' }
  },
  {
    // v2026-09-02 注册流程改版：验证完邮箱进入,设完密码后跳 /onboarding
    // 不挂 requiresVerified: 必须在 verified=true 之前进入(email_verified 在
    // setPassword 完成后才置为 true)
    // 不挂 requiresFamily: 设密码时还没有家庭
    path: '/set-password',
    name: 'set-password',
    component: () => import('@/views/SetPasswordView.vue'),
    meta: { layout: 'blank', requiresAuth: true }
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/views/OnboardingFamilyView.vue'),
    meta: { layout: 'blank', requiresAuth: true, requiresVerified: true }
  },
  {
    path: '/',
    component: () => import('@/components/AppLayout.vue'),
    meta: { requiresAuth: true, requiresFamily: true, requiresVerified: true },
    children: [
      { path: '', redirect: '/home' },
      { path: 'home', name: 'home', component: () => import('@/views/HomeView.vue') },
      { path: 'stats', name: 'stats', component: () => import('@/views/StatsView.vue') },
      { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
      { path: 'accounts', name: 'accounts', component: () => import('@/views/AccountsView.vue') },
      {
        // v2026-09-02 从 SettingsView 拆出来
        path: 'mcp',
        name: 'mcp',
        component: () => import('@/views/McpView.vue')
      }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/home' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.initialized) await auth.init()

  // 已登录但 profile 还没拉到 → 兜底拉一次（防 hasFamily 误判跳到 onboarding）
  if (auth.isAuthenticated && !auth.profile?.family_id) {
    await auth.ensureProfile()
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' }
  }
  if (to.meta.requiresVerified && auth.isAuthenticated) {
    // 已登录但邮箱未验证 → 强跳 verify-email（兜底：如果 profile 还没拉到或字段缺失，当作已验证，避免死循环）
    const verified = auth.profile?.email_verified !== false
    if (!verified) {
      // 排除 verify-email / register / login 自身（避免在 verify 页面被重定向）
      if (to.name !== 'verify-email' && to.name !== 'register' && to.name !== 'login') {
        return {
          name: 'verify-email',
          query: { type: 'login', email: auth.user?.email || '' }
        }
      }
    }
  }
  if (to.meta.requiresFamily && !auth.hasFamily) {
    return { name: 'onboarding' }
  }
  if (to.name === 'login' && auth.isAuthenticated && auth.hasFamily) {
    return { name: 'home' }
  }
})

export default router

