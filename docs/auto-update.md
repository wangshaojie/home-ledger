# 家庭记账 - 自动更新操作文档

> **适用范围**：`home-ledger` Windows 桌面端（Electron + electron-builder + GitHub Releases）
> **更新机制**：客户端 `electron-updater` 自动拉取 GitHub Release 上的 `latest.yml` 判断版本
> **首发版本**：v1.0.0 → 之后所有版本走本流程

---

## 一、架构概览

```
┌─────────────────────┐         ┌──────────────────────┐
│  开发者本地          │  git push tag 1.0.1  │   GitHub Actions      │
│  (你)                │ ───────────────────────▶ │  (windows-latest)     │
│                      │                         │  - pnpm install       │
│                      │                         │  - vite build         │
│                      │                         │  - electron-builder   │
└─────────────────────┘                         │  - 发布到 Releases     │
                                                └──────────┬───────────────┘
                                                           │
                                                           │ 创建 Release v1.0.1
                                                           │ 上传 .exe / .yml / .blockmap
                                                           ▼
┌─────────────────────┐         ┌──────────────────────┐
│  用户电脑            │  ←───── │  GitHub Releases      │
│  (家庭记账 v1.0.0)   │  下载新  │  com/homeledger/      │
│  - 启动后 3 秒检查   │   版本   │  home-ledger          │
│  - 每 4 小时轮询     │         │  releases/tag/1.0.1   │
│  - 弹窗提示用户      │         └──────────────────────┘
└─────────────────────┘
```

---

## 二、前提条件（一次性配置）

### 1. GitHub 仓库可见性

**自动更新要求 GitHub 仓库是 public 的**（或用 PAT，但配置复杂）。

- 仓库 → Settings → General → Danger Zone → Change repository visibility → **Make public**

### 2. 修改 `package.json` 里的 owner

编辑 `package.json` 第 91 行：

```json
"build": {
  ...
  "publish": {
    "provider": "github",
    "owner": "你的GitHub用户名",     // ← 改这里！
    "repo": "home-ledger",
    "releaseType": "release",
    "vPrefixedTagName": false,        // tag 不带 v 前缀
    "publishAutoUpdate": true
  }
}
```

### 3. 安装依赖

```powershell
cd D:\test\home-ledger
pnpm install
```

新增依赖：`electron-updater@^6.3.9`

### 4. 验证类型

```powershell
pnpm type-check
```

应该 0 错误。如果有错，检查 `electron/main.ts` 里 `autoUpdater` 的 import 和 IPC 写法。

---

## 三、首发 v1.0.0（已经做过的版本）

如果你已经发过 v1.0.0 的安装包给用户，跳过此步。

### 1. 确认版本号

`package.json` 第 3 行：

```json
"version": "1.0.0"
```

### 2. 本地构建 NSIS 安装包

```powershell
pnpm run build:win:nsis
```

产出位置：`release/1.0.0/家庭记账-1.0.0-x64.exe`

### 3. 手动上传到 GitHub Release（首发必须手动）

> ⚠️ **首发 v1.0.0 必须用手动上传**，不能用 GitHub Actions 自动发。
> 原因是：自动发版需要先有 1 个 release 作为锚点，workflow 才能 `--publish always`。

步骤：

1. 浏览器打开 `https://github.com/你的用户名/home-ledger/releases/new`
2. **Tag** 填：`1.0.0`（不带 v）
3. **Title** 填：`v1.0.0 首发`
4. 把 `release/1.0.0/` 下的所有文件拖进上传区：
   - `家庭记账-1.0.0-x64.exe`（主安装包）
   - `家庭记账-1.0.0-x64.exe.blockmap`（差分更新用）
   - `latest.yml`（**关键文件，客户端读这个判断版本**）
5. 勾选 **Set as the latest release**
6. 点 **Publish release**

> 💡 也可以先不打 release，只把 `latest.yml` 放上去让 v1.0.0 老用户能升上来——但 v1.0.0 是首发，所以必须有这个 release。

### 4. 验证

- 打开 `https://github.com/你的用户名/home-ledger/releases/latest`
- 应该看到 `家庭记账-1.0.0-x64.exe` 和 `latest.yml`

---

## 四、发新版（v1.0.0 → v1.0.1 标准流程）

**这是核心流程，以后每次发版都走这套**。

### 1. 改版本号

`package.json` 第 3 行：

```json
"version": "1.0.1"      // ← 改成新版本号
```

### 2. 提交代码

```powershell
git add -A
git commit -m "release: v1.0.1 - 一句话描述本次改了什么"
```

### 3. 推送 tag（关键一步）

```powershell
git tag 1.0.1            # 注意不带 v 前缀
git push origin main --tags
```

### 4. GitHub Actions 自动构建

推完 tag 后：

1. 打开 `https://github.com/你的用户名/home-ledger/actions`
2. 应该看到 **Release Windows Installer** workflow 自动开始跑
3. 等待 3-5 分钟（包含 `pnpm install` + `vite build` + `electron-builder`）

**如果 workflow 没跑**：检查 `.github/workflows/release.yml` 是否提交了。

### 5. 检查 Release 是否生成

打开 `https://github.com/你的用户名/home-ledger/releases/latest`

应该看到：
- `家庭记账-1.0.1-x64.exe`
- `家庭记账-1.0.1-portable-x64.exe`
- `家庭记账-1.0.1-x64.exe.blockmap`
- `latest.yml`（已被新版本覆盖）

### 6. 验证老用户能收到更新

在任何装了 v1.0.0 的电脑上：

1. 启动应用
2. 等待 3 秒（启动后首次检查延迟）
3. 应该弹窗："发现新版本 v1.0.1，是否立即下载？"
4. 点 **立即下载** → 看到下载进度（主进程 console 输出）
5. 下载完成 → 弹窗："v1.0.1 已下载完成，是否立即重启？"
6. 点 **立即重启** → 应用退出 → NSIS 安装器运行 → 自动启动新版本

---

## 五、客户端行为详解（给前端开发者参考）

### 1. 什么时候检查更新？

- **启动后 3 秒**首次检查（避开启动慢的窗口）
- **每 4 小时**轮询一次（长开会话也能收到）
- **dev 模式跳过**（`VITE_DEV_SERVER_URL` 存在时不检查）
- **portable 版本跳过**（`PORTABLE_EXECUTABLE_DIR` 存在时，因为 portable 不能在原位升级）
- **正在下载时跳过轮询**（避免重复下载）

### 2. 弹窗时序

| 事件 | 用户看到 | 用户选项 |
|------|---------|---------|
| `update-available` | 弹窗"发现新版本 v1.0.1" | [立即下载] [稍后再说] |
| 下载中 | 无 UI（仅主进程 console 打印进度） | - |
| `update-downloaded` | 弹窗"v1.0.1 已下载完成" | [立即重启] [稍后] |
| 用户点稍后 | 下次启动时自动安装 | - |

### 3. IPC 手动检查更新

设置页可以加按钮：

```ts
async function checkUpdate() {
  const r = await window.electronAPI.checkForUpdates()
  if (r.message) {
    ElMessage.warning(r.message)         // "开发模式不检查更新" 等
  } else if (r.available) {
    ElMessage.success(`发现新版本 v${r.version}`)
  } else {
    ElMessage.info(`当前 v${r.currentVersion}，已是最新`)
  }
}
```

`preload.ts` 已暴露 `checkForUpdates()`。

---

## 六、版本号规则（SemVer 简化版）

```
MAJOR.MINOR.PATCH

v1.0.0 → v1.0.1  修复 bug
v1.0.0 → v1.1.0  新功能（向下兼容）
v1.0.0 → v2.0.0  破坏性变更（数据库 schema 大改、UI 重做等）
```

每次发版前在 `package.json` 改版本号 → 推 tag → GitHub Actions 自动发布。

---

## 七、紧急回滚流程

新版有严重 bug，需要紧急回到旧版本：

### 方案 A：发补丁版本（推荐）

直接发个 hotfix，**不要回滚**：

1. 改 `package.json` → `1.0.2`
2. 修复 bug
3. 推 tag `1.0.2` → 走标准流程
4. 1.0.1 用户启动后会自动收到 1.0.2 更新

### 方案 B：手动降级 release（紧急情况）

1. GitHub → Releases → 找到 v1.0.0
2. 点 **Edit**
3. 勾选 **Set as the latest release** → **Update release**
4. 客户端下次检查会发现 latest 是 1.0.0，自动降级

> ⚠️ 方案 B 不推荐，因为 NSIS 安装器会全量重装覆盖，丢失 1.0.1 用户的本地缓存。

---

## 八、常见问题排查

### Q1: 推了 tag 但 GitHub Actions 没跑

检查：
- `.github/workflows/release.yml` 是否提交到 main 分支
- 仓库的 Actions 是否被禁用：Settings → Actions → General
- Tag 格式：必须纯数字加点（如 `1.0.1`），不能有 v

### Q2: 用户启动后没弹"发现新版本"

排查顺序：

1. **看主进程 console**（应用启动后右键任务栏图标 → 检查 console，或看 dev tools）
   - 应该看到 `[autoUpdater] 已是最新版本` 或 `[autoUpdater] checkForUpdates error: ...`
2. **检查 `latest.yml` 是否被覆盖**：
   - 打开 `https://github.com/你的用户名/home-ledger/releases/latest/download/latest.yml`
   - 看 `version: 1.0.1` 是否正确
3. **看网络**：应用能否访问 `https://api.github.com`（国内可能慢但能通）
4. **看版本对比**：客户端的 `package.json` version 是 1.0.0，latest.yml 是 1.0.1，应该弹

### Q3: 报 404

**原因 99%：仓库是 private**

- electron-updater 匿名拉 release，private repo 直接 404
- 解决：仓库 → Settings → General → Change repository visibility → Make public

### Q4: 报 "ENOTFOUND api.github.com"

**网络问题**，国内访问 GitHub 偶尔抽风。

- 多试几次
- 或用代理（设置 `ELECTRON_GET_USE_PROXY` 环境变量）

### Q5: 下载完成但安装失败

**原因**：用户电脑之前装过 portable 版，或装在 Program Files 没管理员权限。

- 提示用户右键安装包 → "以管理员身份运行"
- 或用 `pnpm run build:win` 同时打 NSIS + Portable，让用户选

### Q6: 弹窗后点"稍后"，什么时候会自动装？

`autoUpdater.autoInstallOnAppQuit = true` —— **下次正常退出应用时**自动装。

- 点右上角 X 退出 → 自动装
- 任务管理器结束进程 → **不会**自动装

---

## 九、关键文件清单

| 文件 | 作用 | 改动时机 |
|------|------|---------|
| `package.json` | 版本号 + publish 配置 | 每次发版改 version；owner 一次改完 |
| `electron/main.ts` | 更新逻辑（轮询、弹窗） | 几乎不改 |
| `electron/preload.ts` | 暴露给渲染进程 | 几乎不改 |
| `.github/workflows/release.yml` | CI 自动发版 | 几乎不改 |
| `release/${version}/` | 构建产物 | 每次 `pnpm run build:win` 重生成 |

---

## 十、完整发版 Checklist（打印贴墙）

```
□ 1. 改 package.json version: "X.Y.Z"
□ 2. git add -A
□ 3. git commit -m "release: vX.Y.Z - 描述"
□ 4. git tag X.Y.Z
□ 5. git push origin main --tags
□ 6. 打开 GitHub Actions 确认 workflow 跑完（约 3-5 min）
□ 7. 打开 Releases 确认新版本 + latest.yml 在
□ 8. 在测试机（装老版本）启动应用，确认弹窗
□ 9. 弹窗 → 立即下载 → 下载完成 → 立即重启
□ 10. 确认新版本号在 关于 页/启动屏正确显示
```

**完成！** 以后每次发版按这个清单走就行。
