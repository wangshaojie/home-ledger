# HomeLedger 发版流程

> **本文档目的**：明确"commit 和 tag 哪个会触发 CI 发版"、给出可重复的标准发版步骤、列出常见踩坑点。
> **配套文档**：
> - [auto-update.md](./auto-update.md) — 自动更新机制（客户端怎么拉到新版本）
> - [../TECH_PLAN.md](../TECH_PLAN.md) — 项目技术方案
> - [../SUPABASE_SETUP.md](../SUPABASE_SETUP.md) — Supabase 部署

---

## 一、commit 和 tag 的区别（先说清楚）

**只有推送 git tag 才会触发 release CI。普通 commit 不会。**

| 你做的命令 | 会不会触发 `.github/workflows/release.yml` |
|---|---|
| `git add` + `git commit` + `git push origin main` | ❌ **不会** |
| `git push origin v1.1.7`（推 tag） | ✅ **会**，跑完整 release 流水线 |
| 在 GitHub 网页上点 "Create release" | ✅ **会**（等价于 push tag + 创建 release） |

原因看 `release.yml` 第 4-7 行：

```yaml
on:
  push:
    tags:
      - '*'
```

触发条件写得很死：`push` 事件 + `tags` 限定。**没有 tag 永远不发版**。

---

## 二、标准发版流程（每次发版都走这套）

### 0. 起点：所有改动已经 commit 到 main

```powershell
git status          # 确认工作区干净
git log --oneline -5  # 确认最近几次 commit
```

### 1. bump 版本号

**必须改 `package.json` 的 `version` 字段**——CI 读这个，不读 git tag。

`package.json`：

```json
{
  "name": "HomeLedger",
  "version": "1.1.7"   // ← 改这里
}
```

> ⚠️ **踩坑 1**：tag 推到 `v1.1.7` 但 `package.json` 还是 `1.1.6` → CI 会按 1.1.6 打包 + 把 v1.1.6 修复版发布到 1.1.6 release，**新 tag 完全没被用上**。
>
> ⚠️ **踩坑 2**：tag 推到 v1.1.6 但 `package.json` 是 1.1.7 → CI 会按 1.1.7 打包，但发布到 v1.1.6 release（**覆盖式错误**——v1.1.6 老 release 资产被新版本覆盖）。

**两者必须一致**。

### 2. 本地验证

```powershell
pnpm type-check            # 必须 0 错
pnpm run build:no-pack     # vite build + 主进程 tsc 编译
```

只有本地能 build，再推 tag——避免 CI 跑 5 分钟后失败。

### 3. 提交 + 推送版本号变更

```powershell
git add package.json
git commit -m "chore: bump version to 1.1.7"
git push origin main
```

这步**不会**触发 release CI（只是普通 commit）。

### 4. 打 tag + 推送（这步才发版）

```powershell
git tag v1.1.7
git push origin v1.1.7
```

⚠️ 项目 `package.json` 里 `vPrefixedTagName: false`，所以**严格说不带 v 也可以**（如 `1.1.7`），但带 v 跟 GitHub 默认习惯一致，README 里也用 v 前缀（`v1.1.0`）。两种写法二选一，**保持一致就行**。

### 5. 观察 CI

打开 https://github.com/wangshaojie/home-ledger/actions

应该看到 **Release Windows Installer** workflow 自动开始跑。步骤：

1. Checkout
2. Setup Node.js 24
3. Setup pnpm via corepack
4. Install dependencies
5. Type check
6. Build renderer (Vite) ← **会读 GitHub Secrets 的 `VITE_SUPABASE_*`**
7. Build main process (electron)
8. Package with electron-builder (NSIS) ← 上传到 release
9. Package with electron-builder (Portable) ← 上传到 release
10. Upload artifacts (GitHub Actions artifact)

约 3-5 分钟。如果中间任意一步红了，去看 step 日志。

### 6. 验证产物

打开 https://github.com/wangshaojie/home-ledger/releases/latest

应该看到：

- `HomeLedger-1.1.7-x64.exe`（NSIS 安装版）
- `HomeLedger-1.1.7-portable-x64.exe`（便携版）
- `HomeLedger-1.1.7-x64.exe.blockmap`（差分更新用）
- `latest.yml`（**关键**，客户端读这个判断版本）

### 7. 在测试机验证自动更新（如果有 v1.1.x 老用户）

1. 装 v1.1.6 的机器上启动应用
2. 等 3 秒（启动后首次检查延迟）→ 应弹"发现新版本 v1.1.7"
3. 立即下载 → 完成后弹"立即重启"
4. 重启后看到 v1.1.7

---

## 三、版本号规则（SemVer 简化版）

```
MAJOR.MINOR.PATCH

v1.1.6 → v1.1.7   PATCH：bug 修复
v1.1.6 → v1.2.0   MINOR：新增功能（向下兼容）
v1.1.6 → v2.0.0   MAJOR：破坏性变更（数据库 schema 大改、UI 重做等）
```

预发布版本（如 `1.2.0-beta.1`）也支持，但 electron-builder 不会自动识别为 prerelease，要在 GitHub Release 页面勾 "This is a pre-release"。

---

## 四、紧急回滚

新版有严重 bug：

**方案 A（推荐）：发补丁**——不要回滚。改 `package.json` 到 1.1.8、推 `v1.1.8` tag，1.1.7 用户启动后自动收到 1.1.8 更新。

**方案 B（紧急）：手动降级 release**——GitHub → Releases → 找到 v1.0.0 → Edit → 勾 "Set as the latest release" → Update。客户端下次检查发现 latest 是 1.0.0 自动降级。

> ⚠️ 方案 B 不推荐：NSIS 安装器会全量重装覆盖，丢失 1.1.7 用户的本地缓存（虽然本项目只缓存 session，损失不大）。

---

## 五、常见踩坑（按踩过频率排序）

### 1. 推了 tag 但 CI 没跑

按顺序查：

- [ ] tag 是不是真的推上去了？`git ls-remote --tags origin | grep v1.1.7`
- [ ] `.github/workflows/release.yml` 是不是提交到 main 分支了？（不是 PR branch）
- [ ] 仓库 Settings → Actions → General → Actions permissions 是不是 "Allow all actions"
- [ ] tag 格式：必须 `v1.1.7` 或 `1.1.7`，不能带其他字符

### 2. 装上新版本登录报 "Invalid API key"

GitHub Secrets 里的 `VITE_SUPABASE_PUBLISHABLE_KEY` 是空字符串 / `''` / 拼错。Vite build 时 `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` 被替换成那个空值，bundle 里 apikey 是空字符串，Supabase server 返 401。

**修法**：

1. Settings → Secrets and variables → Actions → 改 secret 值为完整 key（以 `sb_publishable_` 开头）
2. bump 版本号重新发版

**诊断**：下载 release 资产 → 解 NSIS / portable 找 `app.asar` → 用 `npx asar extract` 解压 → 找 `dist/assets/index-*.js` → 搜 createClient 附近的字符串赋值（terser 后变量名是 `qS` / `GS`）→ 看 key 是不是完整 40+ 字符。

### 3. NSIS 和 Portable 的产物 hash 不一致

如果两次 electron-builder 打出来的 `app.asar` 字节级不一致（chunk hash 不同），说明某次 build 拿不到 env。

**根因**：`vite-plugin-electron/simple` 在 electron-builder 跑的时候可能重 build renderer + main，重 build 时只继承当前 step 的 env，**不会**继承前面 `Build renderer` step 的 env。

**修法**：`release.yml` 给所有需要 VITE_* env 的 step 都加 env 块：

```yaml
- name: Package with electron-builder (NSIS)
  run: pnpm exec electron-builder --win nsis --x64 --publish always
  env:
    VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
    VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
    VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 4. 自动更新后白屏 / 启动崩溃

99% 是 `electron-updater` 没有被打进 asar：

- **检查**：`dependencies` 里有没有 `electron-updater`（不是 `devDependencies`）—— electron-builder 不会把 devDeps 打进 asar
- **动态 import 解构**：`const { autoUpdater } = (await import('electron-updater')).default ?? ...`（CJS 包 named import 拿不到值）

### 5. tag 推上去了但产物文件名还是老格式

`portable.artifactName` / `nsis.artifactName` 是 `package.json` 里 `build` 字段控制的，**不会被 git tag 影响**。如果产物名不对，去改 `package.json`，**重新 bump 版本 + 重新推 tag**。

### 6. 老用户自动更新到 v1.1.7 后卡住

最新版的 `latest.yml` 必须能被匿名访问。仓库必须是 **public**（private repo electron-updater 匿名拉 release 直接 404）。

---

## 六、发版前 Checklist（贴墙）

```
□ 1. 改 package.json version 到 X.Y.Z
□ 2. pnpm type-check (0 errors)
□ 3. pnpm run build:no-pack (成功)
□ 4. git add + commit + push origin main
□ 5. git tag vX.Y.Z
□ 6. git push origin vX.Y.Z  ← 这步才发版
□ 7. GitHub Actions workflow 跑完（约 3-5 min）
□ 8. Releases 页面看到 4 个资产（2 exe + blockmap + latest.yml）
□ 9. 测试机启动老版本 → 弹更新 → 下载 → 重启 → 验证新版本
```

---

## 七、命名约定速查（v1.1.7 起统一）

| 字段 | 值 | 备注 |
|---|---|---|
| npm 包名 (`package.json#name`) | `HomeLedger` | 大驼峰 |
| 应用展示名 (中文) | 家庭记账 | 不动 |
| Windows 窗口标题 | 家庭记账 | 不动（中文优先） |
| NSIS 产物文件名 | `HomeLedger-setup-${version}-${arch}.${ext}` | |
| Portable 产物文件名 | `HomeLedger-${version}-portable-${arch}.${ext}` | |
| GitHub Actions artifact 名 | `HomeLedger-windows-${ref_name}` | |
| GitHub 仓库名 | `wangshaojie/home-ledger` | **不动**（线上已存在） |
| appId | `com.homeledger.app` | **不动**（避免影响已装用户） |
| localStorage key 前缀 | `HomeLedger:` | 改后老用户最近分类会丢，不影响功能 |
| 错误日志 prefix | `[HomeLedger]` | |
| 邮件 from 字段 | `家庭记账 <noreply@240730.xyz>` | 中文产品名 |
