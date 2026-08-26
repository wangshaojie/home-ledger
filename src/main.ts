import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElIcons from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import './styles/main.css'

/**
 * v1.1 启动引导：如果 supabase 客户端初始化失败（env 缺失），渲染一个友好的引导页，
 * 而不是让 import 异常把整个白屏挂掉。
 *
 * 安全:整个页面骨架是 hardcoded HTML,只把动态 e.message 用 textContent 注入,
 * 避免 XSS（异常消息可能含用户态输入）。
 */
function showBootstrapError(message: string) {
  const root = document.getElementById('app')
  if (!root) return
  root.replaceChildren()
  root.appendChild(buildBootstrapShell(message))
}

function buildBootstrapShell(message: string): HTMLElement {
  // 1) 外层容器
  const wrapper = el('div', {
    style: 'box-sizing:border-box;height:100vh;width:100vw;display:flex;align-items:center;justify-content:center;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif;padding:24px'
  })
  // 2) 卡片
  const card = el('div', {
    style: 'max-width:560px;background:white;border-radius:8px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.08);border-left:4px solid #e6a23c'
  })
  // 3) 标题
  card.appendChild(el('h2', { style: 'margin:0 0 12px 0;color:#303133;font-size:20px' }, '⚠️ 需要先配置 Supabase'))
  // 4) 引导说明
  const p1 = el('p', { style: 'margin:0 0 16px 0;color:#606266;line-height:1.6' })
  p1.appendChild(text('家庭记账 v1.1 起只支持线上模式。请在项目根目录创建 '))
  p1.appendChild(code('.env.local'))
  p1.appendChild(text(' 文件,填入以下两行后重启应用:'))
  card.appendChild(p1)
  // 5) env 模板
  const pre = el('pre', {
    style: 'background:#f5f7fa;border:1px solid #e4e7ed;border-radius:4px;padding:12px 16px;margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#303133;font-family:ui-monospace,Cascadia Code,monospace;overflow-x:auto'
  })
  pre.textContent = 'VITE_SUPABASE_URL=https://你的项目.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx'
  card.appendChild(pre)
  // 6) 旧版兼容说明
  const p2 = el('p', { style: 'margin:0 0 8px 0;color:#606266;font-size:13px;line-height:1.6' })
  const strong = el('strong', {}, '旧版 Supabase')
  p2.appendChild(strong)
  p2.appendChild(text(' 兼容:'))
  p2.appendChild(code('VITE_SUPABASE_ANON_KEY'))
  p2.appendChild(text(' 也可作为 publishable key 的替代。'))
  card.appendChild(p2)
  // 7) 错误详情(动态 + 安全注入)
  const p3 = el('p', { style: 'margin:8px 0 0 0;color:#c45656;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word' })
  p3.textContent = '错误信息:' + message
  card.appendChild(p3)
  // 8) 收尾
  const p4 = el('p', { style: 'margin:8px 0 0 0;color:#909399;font-size:12px;line-height:1.6' })
  p4.appendChild(text('在 Supabase Dashboard → Project Settings → API 复制这两个值。配置完成后请重启应用。'))
  card.appendChild(p4)
  wrapper.appendChild(card)
  return wrapper
}

function el(tag: string, attrs: Record<string, string>, textContent?: string): HTMLElement {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (textContent != null) node.textContent = textContent
  return node
}
function text(s: string): Text {
  return document.createTextNode(s)
}
function code(s: string): HTMLElement {
  return el('code', { style: "background:#f0f2f5;padding:2px 6px;border-radius:3px;font-family:ui-monospace,'Cascadia Code',monospace" }, s)
}

try {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)
  app.use(ElementPlus, { locale: zhCn })

  // 全局注册 Element Plus 图标
  for (const [name, comp] of Object.entries(ElIcons)) {
    app.component(name, comp as any)
  }

  app.mount('#app')
} catch (e: any) {
  // 极可能：supabase 模块构造时 throw（env 缺失）
  // 也兜底任何其他 mount 期异常
  console.error('[HomeLedger] 启动失败：', e)
  if (e?.message?.includes('未配置 Supabase') || e?.message?.includes('HomeLedger')) {
    showBootstrapError(e.message)
  } else {
    showBootstrapError(
      '应用启动失败：' + (e?.message || String(e)) + '\n\n请查看开发者控制台获取详情。'
    )
  }
}
