# 家庭支出记账软件 · 技术方案

> 阶段：MVP 技术方案 + 原型页面（不接后端）
> 文档状态：待用户审阅
> 最后更新：2026-08-24

---

## 1. 总体目标

- **Windows 桌面端**（Win10/11）家庭纯支出记账应用
- **极简**：无收入、无理财、无社交、无弹窗、无广告
- **多成员**：邮箱 OTP 登录 + 家庭群组 + 共享账单
- **MVP 范围**：登录、家庭初始化、记账 CRUD、列表筛选、基础统计

---

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | **Electron 31+** | 沿用 kid-course-tracker 栈，Windows 稳定 |
| 前端框架 | **Vue 3 + `<script setup>` + TypeScript** | 同上 |
| 构建 | **Vite 5** | 同上 |
| 状态管理 | **Pinia 2** | 同上 |
| 路由 | **vue-router 4** | 家庭初始化/登录/首页 3 大区 |
| UI 库 | **Element Plus** | 中文文档齐全、Windows 桌面观感一致 |
| 图表 | **ECharts 5** | 折线图/饼图/排行都能画 |
| HTTP 客户端 | `@supabase/supabase-js` v2 | 直接调 Supabase REST/Auth |
| 后端 BaaS | **Supabase**（免费版 / 新加坡区） | 替代自建后端，省运维 |
| 打包 | **electron-builder** | NSIS + portable 两种 |

### 关键偏好（沿用 kid-course-tracker 沉淀）

- `electron/main.ts` **生产模式默认不开 DevTools**
- `dev` 模式（`VITE_DEV_SERVER_URL` 存在）**自动开 DevTools**
- 想强制开：命令行加 `--open-devtools`

---

## 3. 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                Electron Main Process (Node 18)               │
│   · BrowserWindow 管理                                        │
│   · 启动模式分支（dev 自动开 DevTools / prod 默认不开）         │
│   · IPC: secureStorage（keytar 加密本地 token）                │
│   · 单实例锁 + 自动更新预留（暂不接）                           │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│              Electron Renderer (Vite + Vue3)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐    │
│  │ Vue Router  │  │ Pinia Store  │  │  Element Plus UI  │    │
│  │  /login     │  │ auth.ts      │  │  表单/列表/弹窗    │    │
│  │  /onboard   │  │ family.ts    │  │                   │    │
│  │  /home      │  │ expense.ts   │  │                   │    │
│  │  /stats     │  │ category.ts  │  │                   │    │
│  │  /settings  │  │ ui.ts        │  │                   │    │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬─────────┘    │
│         └────────────────┴────────────────────┘              │
│                            │                                  │
│                  ┌─────────▼──────────┐                       │
│                  │  supabase-js 客户端 │                       │
│                  └─────────┬──────────┘                       │
└────────────────────────────┼─────────────────────────────────┘
                             │ HTTPS（直连 Supabase）
                             ▼
┌──────────────────────────────────────────────────────────────┐
│            Supabase（免费版 / 区域: Singapore）               │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐    │
│  │ Auth        │  │ Postgres     │  │ Storage           │    │
│  │ 邮箱 OTP    │  │  业务表       │  │  账单图片 bucket   │    │
│  │ 邮箱+密码   │  │  RLS 策略     │  │                   │    │
│  └─────────────┘  └──────────────┘  └───────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 数据模型（Supabase Postgres）

> MVP 阶段 4 张业务表 + Supabase Auth 自带 `auth.users` 表。

### 4.1 字段约定

- 主键统一 `uuid` + `default uuid_generate_v4()`
- 时间统一 `timestamptz` + `default now()`
- 软删字段预留 `deleted_at timestamptz null`（回收站迭代用）

### 4.2 `profiles`（用户扩展信息）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | = `auth.users.id`（FK） |
| `email` | text | 冗余存储，避免 join |
| `family_id` | uuid null | 当前所属家庭（FK → `families.id`） |
| `display_name` | text | 记账时显示的成员名（默认取邮箱前缀） |
| `joined_at` | timestamptz | 加入家庭时间 |

### 4.3 `families`（家庭）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `name` | text unique | 家庭名称，全平台唯一 |
| `created_by` | uuid | FK → `auth.users.id`（创建者） |
| `created_at` | timestamptz | |
| `invite_code` | text unique | 6 位邀请码（用于成员加入） |

### 4.4 `categories`（支出分类，每家庭一套）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `family_id` | uuid | FK |
| `name` | text | 分类名 |
| `icon` | text | emoji 或 icon 名 |
| `is_default` | boolean | 系统默认分类不可删改 |
| `sort_order` | int | 排序 |
| `created_at` | timestamptz | |

唯一约束：`(family_id, name)`

### 4.5 `expenses`（支出账单）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `family_id` | uuid | FK（冗余，简化 RLS 性能） |
| `creator_id` | uuid | FK → `auth.users.id`（创建者，唯一可编辑/删除） |
| `member_id` | uuid | FK → `auth.users.id`（消费成员） |
| `category_id` | uuid | FK → `categories.id` |
| `amount` | numeric(10,2) | > 0，<= 999999.99 |
| `spent_at` | timestamptz | 消费时间（可过去，不可未来） |
| `note` | text | 备注，<= 200 字 |
| `image_urls` | text[] | 图片 URL 数组 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz null | 软删（回收站迭代用） |

索引：`(family_id, spent_at desc)`、`(family_id, member_id)`、`(family_id, category_id)`

### 4.6 Row Level Security（关键）

| 表 | 策略 | 行为 |
|---|---|---|
| `profiles` | `select/update` when `id = auth.uid()` | 自己看自己 |
| `families` | `select` when `id in (select family_id from profiles where id = auth.uid())` | 同家庭可见 |
| `categories` | `all` when `family_id in (...)` | 同家庭可 CRUD |
| `expenses` | `select` when `family_id in (...)` | 同家庭可见 |
| `expenses` | `insert/update/delete` when `creator_id = auth.uid()` AND `family_id in (...)` | 仅创建者可改 |

---

## 5. 核心流程时序

### 5.1 登录 / 自动注册

```
用户输入邮箱 → 点"获取验证码"
  → supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true }})
  → Supabase Auth 内部发邮件（自带 SMTP 配额 4/小时，够家庭记账用）
  → 用户在邮箱里收 6 位 OTP
  → supabase.auth.verifyOtp({ email, token, type: 'email' })
  → 自动登录 / 自动创建账号（shouldCreateUser:true）
  → 跳转路由守卫：检查 profiles.family_id
       - 空 → /onboarding/create-family
       - 非空 → /home
```

> **为什么不用 Resend/SendGrid？** Supabase Auth 自带邮件 OTP，免费版用 Supabase 域名发（`noreply@app.supabase.io`），到达率对国内邮箱略弱但 MVP 够用。后续要换 Resend，在 Supabase Dashboard → Auth → SMTP Settings 改 3 个环境变量即可。

### 5.2 创建家庭

```
输入家庭名 → supabase.from('families').insert({ name, created_by, invite_code: random6() })
  → supabase.from('profiles').update({ family_id }).eq('id', auth.uid())
  → 自动种入 10 个默认分类（一次性 SQL insert）
  → 跳 /home
```

### 5.3 记账 CRUD

```
新建：supabase.from('expenses').insert({...})  RLS 自动校验
列表：supabase.from('expenses').select('*, member:member_id(email, display_name), category:category_id(name, icon)').eq('family_id', x).order('spent_at', { ascending: false })
编辑：仅 creator_id == auth.uid() 可改
删除：软删（update deleted_at = now()），回收站迭代再用
```

### 5.4 统计

```
今日 / 本月 / 本年：select sum(amount) where spent_at 在区间 and family_id = x
分类占比：select category_id, sum(amount) from expenses group by category_id
成员排行：select member_id, sum(amount) from expenses group by member_id
折线图：date_trunc('day'/'month', spent_at) group by
```

前端用 ECharts 画，ECharts 配色硬编码暖色调（贴近家庭/温暖观感）。

---

## 6. 目录结构

```
home-ledger/
├── electron/
│   ├── main.ts              # 入口 + BrowserWindow + DevTools 分支
│   ├── preload.ts           # contextBridge 暴露安全 API（keytar 等）
│   └── tsconfig.json
├── src/
│   ├── main.ts              # Vite 入口
│   ├── App.vue
│   ├── router/
│   │   └── index.ts         # 路由守卫：未登录→/login，无家庭→/onboarding
│   ├── stores/
│   │   ├── auth.ts          # supabase.auth.session + 监听
│   │   ├── family.ts
│   │   ├── expense.ts
│   │   ├── category.ts
│   │   └── ui.ts            # 加载态、提示
│   ├── lib/
│   │   └── supabase.ts      # 创建 supabase-js 客户端
│   ├── views/
│   │   ├── LoginView.vue            # 邮箱 OTP 登录
│   │   ├── OnboardingFamilyView.vue # 创建家庭
│   │   ├── HomeView.vue             # 记账 + 列表
│   │   ├── StatsView.vue            # 统计
│   │   └── SettingsView.vue         # 个人/家庭
│   ├── components/
│   │   ├── AppLayout.vue
│   │   ├── ExpenseForm.vue
│   │   ├── ExpenseListItem.vue
│   │   ├── FilterBar.vue
│   │   ├── StatCard.vue
│   │   └── CategoryPicker.vue
│   ├── types/
│   │   └── db.ts            # 数据库行类型
│   └── styles/
│       └── main.css
├── supabase/
│   ├── schema.sql           # 建表 + 索引 + 默认分类种子
│   ├── rls.sql              # Row Level Security 策略
│   └── seed.sql             # 10 个默认分类
├── public/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── .env.example             # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
├── .gitignore
└── TECH_PLAN.md
```

---

## 7. 原型页面清单（本次交付）

| # | 页面 | 状态 | 数据 |
|---|---|---|---|
| 1 | `/login` 登录 | 静态 + 假 OTP 流程 | 假验证码 `888888` 永远通过 |
| 2 | `/onboarding/create-family` 创建家庭 | 静态 + 假提交 | 假跳转 |
| 3 | `/home` 首页（记账 + 列表） | 静态假数据 20 条 | 假分类/假成员 |
| 4 | `/stats` 统计 | 假数据 + ECharts 渲染 | 假数据源 |
| 5 | `/settings` 个人/家庭 | 静态 | |

> 原型阶段不接 Supabase，所有数据走前端 mock。Supabase 真接入留给 v1.1。

---

## 8. 分期与下一步

| 阶段 | 内容 | 状态 |
|---|---|---|
| **本期** | 技术方案 + 项目脚手架 + 5 个原型页面 | 正在做 |
| v1.1 | 接入 Supabase（建表 + RLS + Auth OTP） | 后续 |
| v1.2 | Excel 导出 / 回收站 / 邀请码 | 后续 |
| v1.3 | 打包 electron-builder NSIS | 后续 |

---

## 9. 已知风险与缓解

| 风险 | 缓解 |
|---|---|
| Supabase 免费项目 7 天无活动自动 pause | 加个 GitHub Actions / 本地 cron，每天 ping 一次 `select 1`（仅 v1.1+ 阶段） |
| Supabase 默认邮件到达率一般 | v1.1 后接 Resend 替换 SMTP（Dashboard 改 env） |
| 500MB 数据库上限 | 家庭记账数据极小，预估 100 家庭/10 年也只用 < 50MB |
| Electron 打包体积大 | 用 electron-builder + 分包 + 后续考虑 Tauri（如果用户觉得大） |
| 国内访问 Supabase 时延 | 选 Singapore 区，端到端 80-150ms 可接受 |

---

## 10. 待用户确认

- [ ] 技术栈：Electron + Vite + Vue3 + Pinia + TS ✅ 已确认
- [ ] 后端：Supabase 免费版 / 新加坡区 ✅ 已确认
- [ ] 范围：先出技术方案 + 原型页面 ✅ 已确认
- [ ] 邮件：Supabase Auth 自带 OTP（先不接 Resend）✅ 已确认
- [ ] **数据库表结构是否符合预期？**（重点看 4.2-4.5）
- [ ] **RLS 策略是否符合家庭隐私预期？**（重点看 4.6）
- [ ] **原型页面清单是否够？**（7 节列了 5 个，缺哪个告诉我）
