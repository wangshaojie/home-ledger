# 家庭记账 (Home Ledger)

<p align="center">
  <img src="build/icon-256.png" alt="家庭记账" width="128" />
</p>

<p align="center">
  <strong>Windows 桌面端家庭支出记账软件</strong><br/>
  Electron 32 · Vite 5 · Vue 3.5 · Pinia · TypeScript · Element Plus · ECharts · Supabase
</p>

<p align="center">
  <a href="https://github.com/wangshaojie/home-ledger/releases/latest">
    <img alt="最新版本" src="https://img.shields.io/github/v/release/wangshaojie/home-ledger?style=flat-square&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC" />
  </a>
  <a href="https://github.com/wangshaojie/home-ledger/releases">
    <img alt="所有发布" src="https://img.shields.io/github/downloads/wangshaojie/home-ledger/total?style=flat-square&label=%E4%B8%8B%E8%BD%BD%E9%87%8F" />
  </a>
  <a href="https://github.com/wangshaojie/home-ledger/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-UNLICENSED-lightgrey?style=flat-square" />
  </a>
</p>

## 简介

家庭记账是一款**云端多成员**的家庭支出记账桌面应用：

- 🏠 **多成员家庭** — 邀请配偶、子女、父母一起记，所有人共享一份账本
- 📊 **可视化统计** — 月度趋势、分类占比、成员贡献，ECharts 图表一目了然
- 👥 **成员支出分析** — 按"付款人"和"消费归属"两个维度看每个人花了多少、钱算谁头上
- 🔐 **隐私可控** — 家庭数据走 Supabase Row Level Security 隔离，跨家庭完全不可见
- 💰 **多支付账户** — 微信、支付宝、银行卡、现金分别管理
- 🏷️ **智能分类** — 常用分类 + 自定义分类 + 最近使用快速选择
- 📧 **邮箱注册 + 验证** — 注册后通过邮件 OTP 激活，密码登录

> 详细介绍与架构见 [TECH_PLAN.md](./TECH_PLAN.md)。

## ⬇️ 下载

> 最新稳定版：[Releases 页面](https://github.com/wangshaojie/home-ledger/releases/latest)
> 系统要求：**Windows 10 / 11 (x64)**

### 安装包

| 类型 | 说明 | 推荐场景 | 直链下载 |
|---|---|---|---|
| 🟢 **便携版** (Portable) | 单个 `.exe`，免安装，双击即用，不写注册表 | 临时使用、U 盘携带、不想留痕迹 | [家庭记账-1.1.0-portable-x64.exe](https://github.com/wangshaojie/home-ledger/releases/latest/download/%E5%AE%B6%E5%BA%AD%E8%AE%B0%E8%B4%A6-1.1.0-portable-x64.exe) |
| 🔵 **安装版** (NSIS) | 标准安装流程，带桌面/开始菜单快捷方式 | 长期使用、需要自动更新 | [家庭记账-1.1.0-x64.exe](https://github.com/wangshaojie/home-ledger/releases/latest/download/%E5%AE%B6%E5%BA%AD%E8%AE%B0%E8%B4%A6-1.1.0-x64.exe) |

### 校验

每个 Release 资产页都附带 SHA256 校验码。验证方法：

```powershell
# Windows PowerShell
Get-FileHash .\家庭记账-1.1.0-portable-x64.exe -Algorithm SHA256
```

对比哈希值是否与 [Release 资产页](https://github.com/wangshaojie/home-ledger/releases/latest) 一致。

### 第一次使用

1. **创建 Supabase 项目**：按 [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) 10-15 分钟搞定（建项目 + 跑 SQL）
2. 下载并运行安装包
3. 注册账号（邮箱 + 密码）→ 收验证邮件 → 输入 6 位 OTP 激活
4. 第一个账号会被引导创建家庭、邀请其他成员
5. 登录后即可记账、查统计

> **不再支持原型模式**。所有数据存 Supabase，本地不存业务数据（仅缓存 session 用于免登录）。

## 📝 更新日志

所有版本更新记录见 [GitHub Releases](https://github.com/wangshaojie/home-ledger/releases)。

### 最近版本

| 版本 | 状态 | 关键变更 |
|---|---|---|
| v1.1.0 | 2026-08-25 | **线上模式**：移除原型模式，强制要求 Supabase；新增按"付款人 / 消费归属"双维度的成员支出统计；Windows 安装包文件名规范化 |
| v1.0.0 | 2026-08-25 (已废弃) | 首发：带原型模式的 demo 版，**已删除 release**，请使用 v1.1.0 |

> 版本号跟随 `package.json` 的 `version` 字段。推送形如 `v1.0.0` 的 tag 即可触发 [`.github/workflows/release.yml`](./.github/workflows/release.yml) 自动打包并发版。

## 🔄 自动更新

v1.2 起，应用启动时自动检查新版本并提示升级。配置方法见 [docs/auto-update.md](./docs/auto-update.md)。

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
