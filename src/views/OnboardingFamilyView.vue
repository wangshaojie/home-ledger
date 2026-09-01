<script setup lang="ts">
import { ref } from 'vue'
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

async function submit() {
  const name = familyName.value.trim()
  if (!name) {
    notify.warning('请输入家庭名称')
    return
  }
  if (name.length < 2 || name.length > 20) {
    notify.warning('家庭名称 2-20 字')
    return
  }
  submitting.value = true
  // 先把显示名也设了（如果用户改了）
  const dn = displayName.value.trim()
  if (dn && dn !== auth.profile?.display_name) {
    await auth.updateDisplayName(dn)
  }
  const r = await auth.createFamily(name)
  if (!r.ok) {
    submitting.value = false
    notify.error(r.message)
    return
  }
  // v1.1：刷新 family store，让 SQL trigger 创建的"自己"的 family_member 行拉到前端
  await familyStore.load()
  submitting.value = false
  notify.success(r.message)
  router.push({ name: 'home' })
}

async function joinByInvite() {
  const code = (window.prompt('请输入 6 位邀请码') || '').trim().toUpperCase()
  if (!code) return
  // v2026-08-25 加确认：误输入邀请码会直接换家庭，原始家庭数据不可见
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
  <div class="onboard-page">
    <div class="onboard-card">
      <h1 class="title">加入 / 创建家庭</h1>
      <p class="subtitle">
        为了保护家庭账单隐私，每个账号必须先加入一个家庭才能开始记账
      </p>

      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="家庭名称">
          <el-input
            v-model="familyName"
            placeholder="如：温馨之家 / 快乐小家"
            size="large"
            maxlength="20"
            show-word-limit
            clearable
          />
        </el-form-item>

        <el-form-item label="你的显示名（家庭成员中显示）">
          <el-input
            v-model="displayName"
            placeholder="如：小明 / 爸爸 / 主厨"
            size="large"
            maxlength="20"
            show-word-limit
            clearable
          />
          <div class="hint">默认取邮箱前缀，记账时其他成员会看到这个名字</div>
        </el-form-item>

        <el-button
          type="primary"
          size="large"
          class="submit-btn"
          :loading="submitting"
          :disabled="!familyName.trim() || !displayName.trim()"
          @click="submit"
        >
          创建家庭并开始记账
        </el-button>
      </el-form>

      <el-divider>
        <span class="div-text">或者</span>
      </el-divider>

      <el-button size="large" class="join-btn" :loading="submitting" @click="joinByInvite">
        输入邀请码加入家庭
      </el-button>

      <div class="divider">
        <span>提示</span>
      </div>
      <ul class="tips">
        <li>家庭名称创建后可在「设置」中修改</li>
        <li>不同家庭账单数据相互隔离，无法互通</li>
        <li>家庭成员可在「设置」中查看邀请码</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.onboard-page {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #fff3ec 0%, #f5f5f7 100%);
}
.onboard-card {
  width: 520px;
  padding: 44px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.06);
}
.title {
  font-size: 24px;
  margin: 0 0 8px;
  text-align: center;
}
.subtitle {
  text-align: center;
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0 0 28px;
  line-height: 1.6;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.submit-btn,
.join-btn {
  width: 100%;
  border-radius: 12px;
}
.submit-btn {
  background-image: linear-gradient(135deg, #ff8f4d 0%, #f56c2c 100%);
  border: none;
  box-shadow: var(--shadow-btn);
  transition: transform 0.15s, box-shadow 0.15s;
}
.submit-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(245, 108, 44, 0.4);
}
.submit-btn.is-disabled {
  background-image: none;
  background-color: var(--el-disabled-bg-color);
}
.join-btn {
  border: 1px solid var(--color-border);
  color: var(--color-text);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.join-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(245, 108, 44, 0.15);
}
.div-text {
  font-size: 12px;
  color: #c0c4cc;
}
.divider {
  display: flex;
  align-items: center;
  margin: 28px 0 16px;
  color: #c0c4cc;
  font-size: 12px;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #ebeef5;
}
.divider span {
  padding: 0 12px;
}
.tips {
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-soft);
  font-size: 13px;
  line-height: 1.9;
}
</style>
