# 贡献指南（开发者文档）

> 本文件面向**开发者**——本机跑 dev、修改源码、部署 Supabase、打新包 CI。
> 普通用户请看 [README.md](./README.md)。

---

## 1. 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 32 + vite-plugin-electron |
| 前端 | Vue 3.5 (`<script setup>`) + TypeScript + Vite 5 |
| 状态管理 | Pinia 2 |
| 路由 | vue-router 4 |
| UI | Element Plus 2.8 |
| 图表 | ECharts 5 + vue-echarts |
| 后端 | Supabase（Postgres + Auth + RLS） |
| 打包 | electron-builder 25（NSIS + Portable 双 target） |

详细架构见 [TECH_PLAN.md](./TECH_PLAN.md)。

---

## 2. 本地开发

### 2.1 环境要求

- **Node.js 24+**（用 corepack 自带 pnpm 9）
- **pnpm 9**（自动启用：`corepack enable && corepack prepare pnpm@9 --activate`）

### 2.2 跑起来

```bash
# 安装依赖
pnpm install

# 启动 dev（Vite + Electron，dev 模式自动开 DevTools）
pnpm dev

# 仅类型检查（无需启动 dev server）
pnpm exec vue-tsc --noEmit
```

dev 启动后：
- **dev 模式**：`VITE_DEV_SERVER_URL` 存在 → DevTools 自动开（生产模式默认关）
- 想在生产模式强制开 DevTools：命令行加 `--open-devtools` flag

### 2.3 环境变量

复制 `.env.example` 为 `.env.local`，填入 Supabase 凭据（**v1.1 起强制线上模式**）：

```bash
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
# 旧版 Supabase 兼容 VITE_SUPABASE_ANON_KEY（任选其一）
```

**没有 env 启动会白屏**——主进程会捕获异常并显示引导页（见 `src/main.ts`）。

### 2.4 目录结构

```
home-ledger/
├── electron/                Electron 主进程
│   ├── main.ts              BrowserWindow + DevTools 开关 + auto-update + IPC
│   ├── preload.ts           contextBridge（暴露 password-reset IPC）
│   └── loadEnv.ts           主进程 .env 加载（仅 main.ts 用）
├── src/
│   ├── views/               6 个核心页面
│   │   ├── LoginView.vue            邮箱密码登录
│   │   ├── RegisterView.vue         注册
│   │   ├── VerifyEmailView.vue      6 位 OTP 验证
│   │   ├── OnboardingFamilyView.vue 创建/加入家庭
│   │   ├── HomeView.vue             记账 + 列表（核心）
│   │   ├── StatsView.vue            统计 + 图表
│   │   ├── SettingsView.vue         个人 + 家庭设置
│   │   └── AccountsView.vue         支付账户管理
│   ├── components/
│   │   ├── AppLayout.vue            侧栏 + 顶部导航
│   │   └── MemberStatsPanel.vue     成员双维度图
│   ├── stores/              Pinia
│   │   ├── auth.ts          session + 登录 + 注册 + 改密
│   │   ├── family.ts        家庭 + 成员 CRUD
│   │   ├── expense.ts       账单 CRUD + 聚合
│   │   ├── category.ts      分类
│   │   ├── paymentAccount.ts 支付账户
│   │   └── ui.ts            加载/提示
│   ├── lib/
│   │   ├── supabase.ts            supabase-js client 工厂
│   │   ├── supabaseStorage.ts     30 天免登录标记工具
│   │   ├── notify.ts              统一 toast
│   │   ├── displayName.ts         成员名展示规则
│   │   ├── recentCategories.ts    最近使用分类（localStorage）
│   │   └── resetBusinessState.ts  账号切换时重置所有业务 store
│   ├── router/index.ts      路由 + 守卫
│   ├── types/db.ts          数据库行类型
│   └── main.ts              Vite 入口
├── supabase/                SQL 脚本（按依赖顺序跑）
│   ├── schema.sql           建表 + 索引
│   ├── family_members.sql   family_members 表 + member_id FK 迁移
│   ├── expense_payer.sql    payer_id 字段 + 触发器
│   ├── payment_accounts.sql 支付账户表
│   ├── rls.sql              Row Level Security 策略
│   ├── password_reset.sql   改密 RPC + 邮件模板
│   ├── password_reset_rpc.sql 改密 RPC
│   ├── add_email_verified.sql
│   ├── hardening_2026_08_25.sql 安全加固
│   ├── fix_expenses_*.sql   RLS 修复脚本
│   ├── diag_*.sql           诊断用
│   └── seed.sql             默认分类
├── docs/                    辅助文档
│   ├── RELEASE_NOTES_v1.1.7.md
│   ├── RELEASE.md
│   ├── auto-update.md
│   └── diag_console_snippet.md
├── .github/workflows/
│   └── release.yml          tag 触发 → Windows CI 跑 NSIS + Portable
├── README.md                用户文档
├── CONTRIBUTING.md          ← 你正在看
├── TECH_PLAN.md             技术方案
├── SUPABASE_SETUP.md        Supabase 部署指引
├── package.json
└── vite.config.ts
```

---

## 3. Supabase 部署

详见 [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)（10-15 分钟完成）。

**关键点**：
- 跑 SQL 顺序：`schema.sql` → `family_members.sql` → `expense_payer.sql` → `payment_accounts.sql` → `rls.sql` → `password_reset.sql`
- 每跑完一段等 30 秒 PostgREST 缓存刷新，或手动 `NOTIFY pgrst, 'reload schema'`
- v1.1.0+ 必须关掉 Auth 的 "Auto Confirm Email"，否则 signUp 后不发验证邮件
- 改密邮件走 Resend（不走 Supabase 默认 SMTP，国内邮箱到达率高）

---

## 4. 关键设计决策

### 4.1 字段命名约定

- 数据库 / TS 类型用 snake_case（`payer_id` / `creator_id`）
- Vue 组件 / 用户可见文案用中文 4 字短语（"消费成员" / "付款人" / "支付账户"）
- 文案统一原则：同一字段在所有页面文案完全一致（见 v1.1.9 commit 历史）

### 4.2 双维度成员统计

`expenses` 表三个相关 ID：
- `creator_id` — 谁记的账（永远是登录用户）
- `member_id` — 钱算谁头上（"消费成员"）
- `payer_id` — 谁掏的钱（"付款人"）

三者在 UI 上必须分清，不能混用。

### 4.3 30 天免登录

- supabase-js 默认行为：access_token 1h 过期 + refresh_token 30d 有效，**autoRefreshToken 链自己续**
- 不在 supabaseStorage 适配器里拦截（v1.1.0 用自定义 adapter，结果破坏 autoRefreshToken 链 → 1h 冷启动就掉登录。v1.1.9 改为不动）
- 30 天免登录是 UI 层的"开关"：登录成功后写 `homeledger_session_expires_at = now + 30d`；`auth.init()` 入口检查这个标记，过期就 `signOut()`

### 4.4 账号切换重置业务 store

`App.vue` 的 watch 监听 `auth.user?.id`，uid 变化时：
1. 调 `resetBusinessState()` 清空所有业务 Pinia store
2. 重新 `family.load()` / `category.load()` / `paymentAccount.load()` / `expense.load()`

避免 A 账号的数据残留到 B 账号。

### 4.5 生产模式不自动开 DevTools

```ts
// electron/main.ts
const OPEN_DEVTOOLS_IN_DEV = true
const FORCE_OPEN_DEVTOOLS = process.argv.includes('--open-devtools')
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const shouldOpenDevTools =
  (VITE_DEV_SERVER_URL && OPEN_DEVTOOLS_IN_DEV) || FORCE_OPEN_DEVTOOLS
```

dev 自动开 / prod 默认关 / 想强制开加 `--open-devtools`。

### 4.6 RLS 策略

所有业务表用 `is_family_member(family_id)` SQL 函数判断当前用户是否属于该家庭。详细 SQL 见 `supabase/rls.sql`。

---

## 5. 打包发布流程

### 5.1 本地打

```bash
# 仅 portable
pnpm run build:win:portable

# 仅 NSIS
pnpm run build:win:nsis

# 两个都打（默认）
pnpm run build:win
```

产物在 `release/1.1.9/` 下（版本号来自 `package.json`）。

### 5.2 CI 发版

CI 流程在 `.github/workflows/release.yml`：

1. `git tag v1.1.9 && git push origin v1.1.9` 触发
2. CI 跑 `pnpm install` → `type-check` → `vite build` → `tsc -p tsconfig.electron.json`
3. CI 跑两次 `electron-builder --win --publish always`（先 NSIS 后 Portable）
4. 产物 + `latest.yml` 自动上传到 GitHub Release

**关键**：所有需要 `VITE_*` env 的 step（build renderer + electron-builder NSIS + electron-builder Portable）都要在 `env:` 块里**列全** GitHub Secrets。否则 NSIS 包会白屏报 "Invalid API key"（v1.1.5 翻车教训）。

### 5.3 GitHub Secrets 必须有

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`（或 `VITE_SUPABASE_ANON_KEY` 兼容）
- `RESEND_API_KEY`（主进程的 `electron/main.ts` 改密邮件用）

---

## 6. 后续迭代 (v1.2+)

- [ ] 图片上传（Supabase Storage）
- [ ] Excel 导出
- [ ] 回收站（已用 `deleted_at` 字段预留）
- [ ] 自动更新（electron-updater 已接，但 auto check 还没接）
- [ ] 多语言（先 zh-CN）

## 7. 已知问题与排错

| 症状 | 原因 | 修法 |
|---|---|---|
| 装上 NSIS 包白屏报 "Invalid API key" | CI 漏 `VITE_*` secret | 检查 release.yml 三个 env 块 |
| 登录后 1 小时掉登录 | v1.1.0 旧版的 supabaseStorage 拦截 bug | 升 v1.1.9 |
| 第一次跑 dev 报 "未配置 Supabase" | 没建 `.env.local` | 复制 `.env.example` 填值 |
| 改密邮件收不到 | Resend API key 没配 或 没加 verified domain | Dashboard 看 send log |
| Type-check 红 | 类型错 | `pnpm exec vue-tsc --noEmit` 看具体行 |
