# 家庭记账 (Home Ledger)

Windows 桌面端家庭支出记账软件。
技术栈：Electron 32 + Vite 5 + Vue 3.5 + Pinia 2.3 + TypeScript 5.9 + Element Plus + ECharts + Supabase。

## 当前状态

- ✅ v1.1 代码完成（接 Supabase）
- ⏳ 待 Supabase 项目创建 + SQL 执行
- ⏳ 待用户跑 `pnpm exec vue-tsc --noEmit` 验证类型

## 开发

```bash
# 安装依赖
pnpm install

# 启动 dev（Vite + Electron，dev 模式自动开 DevTools）
pnpm dev

# 仅类型检查（无需启动 dev server）
pnpm exec vue-tsc --noEmit
```

## 两种模式

项目根据 `.env` 是否配置 `VITE_SUPABASE_URL` 自动切换：

| 模式 | 触发 | 行为 |
|---|---|---|
| **原型模式** | 没填 env | 前端 mock 数据，验证码恒为 `888888`，密码 `888888`，所有数据前端 localStorage |
| **生产模式** | env 已填 | 直连 Supabase Auth + Postgres + RLS 隔离 |

> dev/原型模式不需要任何后端服务，开箱即用。

## Supabase 部署

详见 [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)（10-15 分钟完成）。

## 目录

```
electron/        Electron 主进程 + preload（生产模式默认不开 DevTools）
src/
  views/         5 个核心页面
  components/    AppLayout 等
  stores/        auth / family / category / expense / ui
  lib/           supabase client / notify / resetBusinessState
  router/        路由 + 守卫
  types/db.ts    数据库行类型
supabase/        schema / rls / seed SQL
TECH_PLAN.md     技术方案
SUPABASE_SETUP.md  部署指引
```

## 关键设计决策

- **生产模式不自动开 DevTools**：dev 自动开，prod 默认关，需强制开加 `--open-devtools`
- **账号切换重置业务 store**：避免 A→B 数据残留（App.vue watch uid + resetBusinessState 工具）
- **mock 模式兼容**：所有 store 在没 supabase 时走前端假数据，方便本地开发
- **RLS 隔离**：同家庭可见，跨家庭完全不可见
- **软删账单**：`expenses.deleted_at` 字段预留，回收站迭代用
- **图片上传** v1.1 暂未做（disabled），v1.2 接 Supabase Storage

## 后续迭代 (v1.2+)

- 图片上传（Supabase Storage）
- Excel 导出
- 回收站
- 邮件验证码发原密码找回
- 自动更新（electron-updater）
