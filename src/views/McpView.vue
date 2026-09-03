<script setup lang="ts">
/**
 * v2026-09-02 从 SettingsView 抽出来
 * 之前 MCP 介绍（含三个客户端的配置模板、授权流程、FAQ）塞在设置页最后一节，
 * 内容偏多，跟设置混在一起不便查找。拆成独立路由 /mcp，侧边栏加"AI 接入"入口。
 */
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { notify } from '@/lib/notify'

const auth = useAuthStore()

const mcpTab = ref('workbuddy')
const mcpOpen = ref(['config'])
const copiedKey = ref('')

const mcpClients = [
  {
    key: 'cursor',
    name: 'Cursor',
    file: 'Windows：%USERPROFILE%\\.cursor\\mcp.json　·　macOS：~/.cursor/mcp.json',
    tip: '已有其它 MCP 时把 home-ledger 节点合并进去，不要整文件覆盖。需要 Cursor 0.46+。',
    json: `{\n  "mcpServers": {\n    "home-ledger": {\n      "url": "https://mcp.240730.xyz/api/mcp",\n      "headers": {\n        "Authorization": "Bearer 你的token"\n      }\n    }\n  }\n}`
  },
  {
    key: 'claude',
    name: 'Claude Desktop',
    file: 'Windows：%APPDATA%\\Claude\\claude_desktop_config.json　·　macOS：~/Library/Application Support/Claude/claude_desktop_config.json',
    tip: '格式多一个 "type": "http"。需要 Claude Desktop 1.0.63+。',
    json: `{\n  "mcpServers": {\n    "home-ledger": {\n      "type": "http",\n      "url": "https://mcp.240730.xyz/api/mcp",\n      "headers": {\n        "Authorization": "Bearer 你的token"\n      }\n    }\n  }\n}`
  },
  {
    key: 'workbuddy',
    name: '腾讯 WorkBuddy',
    file: '腾讯 WorkBuddy 客户端 MCP 配置',
    tip: '在 WorkBuddy 的 MCP 设置里添加远程服务器，填入以下端点与请求头。',
    json: '端点：https://mcp.240730.xyz/api/mcp\n传输方式：HTTP（Streamable HTTP）\n请求头：Authorization: Bearer 你的token'
  },
  {
    key: 'other',
    name: '其他客户端',
    file: 'Mavis / Codex 等支持远程 HTTP MCP 的客户端',
    tip: '在客户端里添加远程 MCP 服务器，填入以下端点与请求头。',
    json: '端点：https://mcp.240730.xyz/api/mcp\n传输方式：HTTP（Streamable HTTP）\n请求头：Authorization: Bearer 你的token'
  }
]

function openActivatePage() {
  window.open('https://mcp.240730.xyz/activate', '_blank')
}

async function copyMcpJson(key: string) {
  const c = mcpClients.find((x) => x.key === key)
  if (!c) return
  try {
    await navigator.clipboard.writeText(c.json)
    copiedKey.value = key
    notify.success('配置已复制，粘贴到对应文件即可（记得把「你的token」换成授权页拿到的 token）')
    setTimeout(() => {
      copiedKey.value = ''
    }, 2500)
  } catch {
    notify.error('复制失败，请手动选中复制')
  }
}

// v2026-09-02 让 AI 自己读授权页 + 写配置文件 + 重启
// 这段话贴给 AI agent，它会按里面的步骤自己完成配置
const autoConfigPrompt = `帮我配置 home-ledger MCP（家庭记账远程接入），按下面步骤：

1. 我刚在 https://mcp.240730.xyz/activate 拿到了 64 位 token，先问我 token 是什么
2. 拿到 token 后，判断你支持哪种 MCP 客户端（Cursor / Claude Desktop / WorkBuddy / 其他），按对应格式写配置文件：
   - Cursor / 通用 HTTP：~/.cursor/mcp.json（或客户端对应路径），格式：
     {"mcpServers":{"home-ledger":{"url":"https://mcp.240730.xyz/api/mcp","headers":{"Authorization":"Bearer <token>"}}}}
   - Claude Desktop：多一个 "type":"http"
   - WorkBuddy / 其他：在我客户端 MCP 设置里填远程端点 https://mcp.240730.xyz/api/mcp + Bearer <token>
3. 已有 mcpServers 时把 home-ledger 节点合并进去，不要整文件覆盖
4. 改完配置文件后提醒我**完全退出并重启**客户端（重启才生效）
5. 重启后让我说一句"用 home_ledger_whoami 看看连上没有"做验证

不要你自己去访问 mcp.240730.xyz，那个站是给人类用的授权页。你只负责写本地配置文件。`

const copiedPrompt = ref(false)

async function copyAutoConfigPrompt() {
  try {
    await navigator.clipboard.writeText(autoConfigPrompt)
    copiedPrompt.value = true
    notify.success('提示词已复制，去任意 AI 客户端粘贴即可')
    setTimeout(() => {
      copiedPrompt.value = false
    }, 2500)
  } catch {
    notify.error('复制失败，请手动选中复制')
  }
}
</script>

<template>
  <div class="mcp">
    <div class="page-header">
      <div>
        <h2 class="page-title">AI 记账接入（MCP）</h2>
        <p class="page-sub">把「家庭记账」接入 AI 助手，用对话代替打开应用</p>
      </div>
    </div>

    <div class="section">
      <p class="section-hint">
        把「家庭记账」接入 AI 助手（Cursor / Claude Desktop / Mavis 等）。之后不用打开本应用，
        直接对 AI 说一句「刚买了杯咖啡 28 块」，它就会自动帮你写入账本。
      </p>

      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px">
        <el-button type="primary" @click="openActivatePage">
          <el-icon><Promotion /></el-icon>
          <span style="margin-left: 4px">打开授权页</span>
        </el-button>
        <span class="hint" style="margin-left: 6px">在浏览器中打开 mcp.240730.xyz/activate，用你的登录邮箱完成授权</span>
      </div>

      <div class="step-list">
        <div class="step-item">
          <span class="step-no">1</span>
          <span>在授权页用 <b>{{ auth.profile?.email || '本应用登录邮箱' }}</b> 接收验证码，起个设备名（如「我的笔记本」）</span>
        </div>
        <div class="step-item">
          <span class="step-no">2</span>
          <span>授权成功生成 64 位 token，点「复制 token」</span>
        </div>
        <div class="step-item">
          <span class="step-no">3</span>
          <span>在下方选择你的 AI 客户端，复制配置、粘贴进配置文件并保存，然后<b>完全退出并重启</b>客户端</span>
        </div>
      </div>

      <el-collapse v-model="mcpOpen" style="margin-top: 4px">
        <el-collapse-item name="config" title="配置模板（复制后粘贴到对应文件）">
          <el-tabs v-model="mcpTab">
            <el-tab-pane v-for="c in mcpClients" :key="c.key" :label="c.name" :name="c.key">
              <div class="cfg-path">{{ c.file }}</div>
              <p class="section-hint">{{ c.tip }}</p>
              <el-button
                size="small"
                :type="copiedKey === c.key ? 'success' : 'primary'"
                plain
                @click="copyMcpJson(c.key)"
              >
                <el-icon><CopyDocument /></el-icon>
                <span style="margin-left: 4px">{{ copiedKey === c.key ? '已复制' : '复制配置' }}</span>
              </el-button>
              <pre class="cfg-pre">{{ c.json }}</pre>
            </el-tab-pane>
          </el-tabs>
        </el-collapse-item>

        <el-collapse-item name="auto" title="让 AI 帮你自动配置（不用自己改文件）">
          <p class="section-hint">
            不想自己改配置文件？把下面这段话直接贴给任意一个 AI 客户端（Cursor / Claude Desktop / Mavis / WorkBuddy 都行），
            它会按步骤问你 token、自己写配置文件、提醒你重启。
          </p>
          <el-button
            size="small"
            :type="copiedPrompt ? 'success' : 'primary'"
            plain
            @click="copyAutoConfigPrompt"
          >
            <el-icon><CopyDocument /></el-icon>
            <span style="margin-left: 4px">{{ copiedPrompt ? '已复制' : '复制提示词' }}</span>
          </el-button>
          <pre class="cfg-pre">{{ autoConfigPrompt }}</pre>
        </el-collapse-item>

        <el-collapse-item name="usage" title="试试对 AI 说">
          <ul class="mcp-usage-list">
            <li>「刚在瑞幸买了杯咖啡 28 块，帮我记上」</li>
            <li>「看看最近 5 笔账单」</li>
            <li>「删掉昨天那笔早餐」</li>
          </ul>
        </el-collapse-item>

        <el-collapse-item name="faq" title="常见问题与安全">
          <ul class="mcp-usage-list">
            <li>token 有效期 30 天。过期后调用会提示 401，回授权页重新签发即可</li>
            <li>每个 token 对应一个「设备」，可在授权页管理、吊销</li>
            <li>AI 只能操作你所在家庭的账单，无法读取或修改其他家庭的数据</li>
            <li>写操作有审计与限流（每分钟最多 30 笔），异常行为可追踪</li>
          </ul>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<style scoped>
/* v2026-09-03 质感升级 */
.mcp {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 24px;
}
.page-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 4px;
  letter-spacing: -0.3px;
  background: linear-gradient(135deg, #1f2329 0%, #4a5160 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.page-sub { color: var(--color-text-soft); font-size: 13px; margin: 0; }

.section {
  position: relative;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 28px 32px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.05);
  margin-bottom: 16px;
  transition: box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.section:hover {
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 14px 32px rgba(16, 24, 40, 0.08);
}
.section-hint {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0 0 14px;
  line-height: 1.6;
}
.hint { color: var(--color-text-soft); font-size: 12px; margin-top: 4px; }

.mcp :deep(.el-button--primary) {
  background: linear-gradient(135deg, #ff8f4d, #f56c2c) !important;
  border: none !important;
  box-shadow: 0 4px 12px -2px rgba(245, 108, 44, 0.4) !important;
  border-radius: 10px !important;
  padding: 10px 18px !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.mcp :deep(.el-button--primary:hover) {
  transform: translateY(-1px) !important;
  box-shadow: 0 8px 18px -2px rgba(245, 108, 44, 0.5) !important;
}
.mcp :deep(.el-button--primary.is-plain) {
  background: rgba(255, 255, 255, 0.6) !important;
  border: 1px solid var(--color-border-strong) !important;
  color: var(--color-primary) !important;
  box-shadow: none !important;
}
.mcp :deep(.el-button--primary.is-plain:hover) {
  background: var(--color-primary-soft) !important;
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 3px rgba(245, 108, 44, 0.08) !important;
}

.step-list {
  margin: 18px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.step-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.6;
  padding: 12px 14px;
  background: linear-gradient(90deg, rgba(245, 108, 44, 0.04) 0%, transparent 100%);
  border-radius: 10px;
  border: 1px solid rgba(245, 108, 44, 0.1);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.step-item:hover {
  background: linear-gradient(90deg, rgba(245, 108, 44, 0.08) 0%, rgba(245, 108, 44, 0.02) 100%);
  border-color: rgba(245, 108, 44, 0.2);
  transform: translateX(2px);
}
.step-no {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary-soft) 0%, #ffe2d0 100%);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
  box-shadow: inset 0 0 0 1px rgba(245, 108, 44, 0.18), 0 2px 6px -1px rgba(245, 108, 44, 0.25);
}
.cfg-path {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  color: var(--color-text-soft);
  margin: 0 0 6px;
  padding: 6px 10px;
  background: rgba(79, 124, 255, 0.05);
  border-left: 3px solid var(--color-blue);
  border-radius: 4px;
}
.cfg-pre {
  background: linear-gradient(180deg, #f6f8fa 0%, #eef0f3 100%);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 14px 16px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: #24292f;
  overflow-x: auto;
  margin: 12px 0 0;
  white-space: pre;
  position: relative;
}
.cfg-pre::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(245, 108, 44, 0.3) 50%, transparent 100%);
}
.mcp-usage-list {
  margin: 0;
  padding-left: 22px;
  color: var(--color-text-soft);
  font-size: 13px;
  line-height: 2.1;
}
.mcp-usage-list li {
  position: relative;
  padding-left: 4px;
}
.mcp-usage-list li::marker {
  color: var(--color-primary);
  font-weight: 700;
}

.mcp :deep(.el-collapse) {
  border: none !important;
  margin-top: 8px;
}
.mcp :deep(.el-collapse-item__header) {
  background: rgba(245, 108, 44, 0.03) !important;
  border: 1px solid rgba(245, 108, 44, 0.1) !important;
  border-radius: 10px !important;
  margin-bottom: 8px !important;
  padding: 0 16px !important;
  height: 48px !important;
  font-weight: 600 !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.mcp :deep(.el-collapse-item__header:hover) {
  background: rgba(245, 108, 44, 0.06) !important;
  border-color: rgba(245, 108, 44, 0.2) !important;
}
.mcp :deep(.el-collapse-item__wrap) {
  border: none !important;
}
.mcp :deep(.el-collapse-item__content) {
  padding: 4px 4px 16px !important;
}

.mcp :deep(.el-tabs__nav-wrap)::after { background: var(--color-border) !important; }
.mcp :deep(.el-tabs__item) {
  font-weight: 500 !important;
  color: var(--color-text-soft) !important;
  transition: all 0.2s !important;
}
.mcp :deep(.el-tabs__item:hover) { color: var(--color-primary) !important; }
.mcp :deep(.el-tabs__item.is-active) {
  color: var(--color-primary) !important;
  font-weight: 700 !important;
}
.mcp :deep(.el-tabs__active-bar) {
  background: linear-gradient(90deg, var(--color-primary), var(--color-yellow)) !important;
  height: 3px !important;
  border-radius: 2px !important;
}

/* 可访问性 */
@media (prefers-reduced-motion: reduce) {
  .section,
  .step-item,
  .mcp :deep(.el-collapse-item__header),
  .mcp :deep(.el-button--primary) {
    animation: none !important;
    transition: none !important;
  }
  .step-item:hover { transform: none; }
}
</style>
