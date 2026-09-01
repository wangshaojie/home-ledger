<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Download, CircleCheckFilled, WarningFilled } from '@element-plus/icons-vue'

type UpdateState = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'

const visible = ref(false)
const state = ref<UpdateState>('idle')
const version = ref('')
const percent = ref(0)
const transferred = ref(0)
const total = ref(0)
const bytesPerSecond = ref(0)
const errorMessage = ref('')
const starting = ref(false)
// 本次会话已忽略的版本（点"稍后"后同版本不再自动弹）
const dismissedVersion = ref('')

const transferredMB = computed(() => (transferred.value / 1024 / 1024).toFixed(1))
const totalMB = computed(() => (total.value / 1024 / 1024).toFixed(1))
const speedText = computed(() => {
  const bps = bytesPerSecond.value
  if (bps <= 0) return ''
  if (bps > 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
  return `${(bps / 1024).toFixed(0)} KB/s`
})

const title = computed(() => {
  switch (state.value) {
    case 'available':
      return '发现新版本'
    case 'downloading':
      return '正在下载更新'
    case 'downloaded':
      return '更新已就绪'
    case 'error':
      return '更新失败'
    default:
      return '软件更新'
  }
})

function show(payload: UpdateEventPayload) {
  switch (payload.type) {
    case 'update-available':
      version.value = payload.version
      if (dismissedVersion.value === payload.version) return // 本会话已忽略该版本
      state.value = 'available'
      visible.value = true
      break
    case 'download-progress':
      percent.value = Math.min(100, Math.round(payload.percent))
      transferred.value = payload.transferred
      total.value = payload.total
      bytesPerSecond.value = payload.bytesPerSecond
      if (state.value !== 'downloading') {
        // 首次进入下载状态时弹出；之后仅更新数值，不打断用户（后台下载）
        state.value = 'downloading'
        visible.value = true
      }
      break
    case 'update-downloaded':
      version.value = payload.version
      state.value = 'downloaded'
      visible.value = true
      break
    case 'update-not-available':
      break
    case 'update-error':
      errorMessage.value = payload.message
      state.value = 'error'
      visible.value = true
      break
  }
}

async function startDownload() {
  if (starting.value) return
  starting.value = true
  try {
    await window.electronAPI.downloadUpdate()
    // 成功：进度由 download-progress 事件驱动；若立即失败会走 update-error 事件
  } finally {
    starting.value = false
  }
}

function restart() {
  void window.electronAPI.quitAndInstall()
}

function dismiss() {
  if (state.value === 'available' || state.value === 'downloaded') {
    dismissedVersion.value = version.value
  }
  visible.value = false
}

let offUpdate: (() => void) | null = null
onMounted(() => {
  if (window.electronAPI?.onUpdateEvent) {
    offUpdate = window.electronAPI.onUpdateEvent((payload) => show(payload))
  }
})
onUnmounted(() => offUpdate?.())
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="420px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div class="update-body">
      <!-- 发现新版本 -->
      <template v-if="state === 'available'">
        <div class="icon"><el-icon :size="34"><Download /></el-icon></div>
        <p class="main">发现新版本 <b>v{{ version }}</b></p>
        <p class="hint">是否立即下载？下载完成后可一键重启完成更新。</p>
      </template>

      <!-- 下载中：进度条 -->
      <template v-else-if="state === 'downloading'">
        <el-progress
          :percentage="percent"
          :stroke-width="12"
          :text-inside="true"
          :status="percent >= 100 ? 'success' : undefined"
        />
        <p class="progress-text">
          {{ transferredMB }} MB / {{ totalMB }} MB
          <span v-if="speedText" class="speed">{{ speedText }}</span>
        </p>
        <p class="hint">下载可在后台进行，完成后再询问是否重启。</p>
      </template>

      <!-- 下载完成 -->
      <template v-else-if="state === 'downloaded'">
        <div class="icon success"><el-icon :size="34"><CircleCheckFilled /></el-icon></div>
        <p class="main">v{{ version }} 已下载完成</p>
        <p class="hint">是否立即重启应用完成更新？选择"稍后"将在下次启动时自动安装。</p>
      </template>

      <!-- 失败 -->
      <template v-else-if="state === 'error'">
        <div class="icon danger"><el-icon :size="34"><WarningFilled /></el-icon></div>
        <p class="main">更新失败</p>
        <p class="error-text">{{ errorMessage }}</p>
        <p class="hint">请稍后重试，或前往官网手动下载安装。</p>
      </template>
    </div>

    <template #footer>
      <template v-if="state === 'available'">
        <el-button @click="dismiss">稍后</el-button>
        <el-button type="primary" :loading="starting" @click="startDownload">立即下载</el-button>
      </template>
      <template v-else-if="state === 'downloading'">
        <el-button @click="dismiss">后台下载</el-button>
      </template>
      <template v-else-if="state === 'downloaded'">
        <el-button @click="dismiss">稍后</el-button>
        <el-button type="primary" @click="restart">立即重启</el-button>
      </template>
      <template v-else-if="state === 'error'">
        <el-button @click="visible = false">关闭</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.update-body {
  text-align: center;
  padding: 8px 4px 4px;
}
.icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 12px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.icon.success {
  background: var(--color-green-soft);
  color: var(--color-green);
}
.icon.danger {
  background: #fdecec;
  color: #e5484d;
}
.main {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--color-text);
}
.hint {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-soft);
  line-height: 1.6;
}
.error-text {
  margin: 0 0 8px;
  font-size: 13px;
  color: #e5484d;
  word-break: break-all;
  line-height: 1.6;
}
.progress-text {
  margin: 12px 0 8px;
  font-size: 13px;
  color: var(--color-text-soft);
  font-variant-numeric: tabular-nums;
}
.speed {
  margin-left: 8px;
  color: var(--color-text-muted);
}
</style>
