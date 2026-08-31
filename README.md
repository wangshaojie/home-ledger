# 家庭记账 (HomeLedger)

<p align="center">
  <img src="build/icon-256.png" alt="家庭记账" width="128" />
</p>

<p align="center">
  <strong>Windows 桌面端家庭支出记账软件</strong><br/>
  共享账本 · 多人记账 · 自动统计
</p>

<p align="center">
  <a href="https://github.com/wangshaojie/home-ledger/releases/latest">
    <img alt="最新版本" src="https://img.shields.io/github/v/release/wangshaojie/home-ledger?style=flat-square&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC" />
  </a>
  <a href="https://github.com/wangshaojie/home-ledger/releases">
    <img alt="所有发布" src="https://img.shields.io/github/downloads/wangshaojie/home-ledger/total?style=flat-square&label=%E4%B8%8B%E8%BD%BD%E9%87%8F" />
  </a>
</p>

## 这是什么

一款**给家庭用的**记账软件——一台电脑记账，全家都能看到，账本永远在云端不会丢。

- 🏠 **多人共享** — 一家人共用一个账本，谁都能记谁都能看
- 📊 **自动统计** — 这个月花了多少、哪类花得多、谁花得多，一目了然
- 🔐 **隐私隔离** — 数据在云端按家庭隔离，别的家庭完全看不到你的账
- 💰 **支付账户管理** — 微信、支付宝、信用卡分开记

## 下载

> 系统要求：**Windows 10 / 11（64 位）**

👉 **去 [Releases 页面](https://github.com/wangshaojie/home-ledger/releases) 选最新版本下载**

每个 release 里都有两个文件：

| 文件 | 适合你 |
|---|---|
| `*-portable-x64.exe` 🟢 | 想直接用、不想装东西——双击即跑，不写注册表，U 盘也能带 |
| `*-setup-x64.exe` 🔵 | 长期用、想开机自启——自动更新，桌面有图标 |

> 不确定选哪个？**选 portable 那个**，文件名带 `portable-x64.exe` 的就是。

## 第一次使用

3 步搞定。

### 1️⃣ 下载并打开

到 [Releases 页面](https://github.com/wangshaojie/home-ledger/releases) 选最新版本，下 portable 或 setup 那个 .exe，然后双击。

> ⚠️ Windows 第一次打开可能会弹"未知发布者"警告，点"仍要运行"就行。

### 2️⃣ 注册账号 + 创建家庭

应用打开后是登录页：

1. 点 **"注册"** 标签
2. 填邮箱 + 设置密码
3. 去邮箱收 6 位验证码（5 分钟内有效）→ 输进去
4. 验证通过后会自动跳到"创建家庭"页
5. 填个家庭名（如"小明的家"）→ 创建

### 3️⃣ 开始记账

回到首页，点右上角 **"+ 记一笔"** ：

- 填金额 → 选分类（如"餐饮"）→ 选消费成员 → 选付款人 → 选支付账户 → 保存

首页能看到本月所有账单，统计页有图表。

> 勾"30 天免登录"后，下次打开应用不用再输密码。

## 邀请家人一起用

1. **设置 → 家庭设置 → 邀请码**（6 位大写字母）→ 点"复制"
2. 把邀请码发给家人
3. 家人下载 app → 注册 → 选"用邀请码加入家庭" → 输邀请码
4. 家庭成员可以共记共看同一份账本

## 常见问题

<details>
<summary><b>收不到验证邮件怎么办？</b></summary>

- 检查垃圾邮件箱
- 确认邮箱地址没填错
- 等 30 秒再点"重新发送验证码"（1 分钟 1 次）
- 实在收不到换个邮箱（QQ / 163 / Gmail 都行）
</details>

<details>
<summary><b>便携版怎么更新到新版本？</b></summary>

下新版 .exe 覆盖老的就行。**数据在云端**，本地只存登录态，覆盖不会丢数据。
</details>

<details>
<summary><b>安装版怎么更新？</b></summary>

应用启动时会自动检查更新，弹窗问"是否升级"→ 点"立即下载"→ 下完自动重启。
</details>

<details>
<summary><b>数据安全吗？丢了怎么办？</b></summary>

数据在 Supabase 云端（专业版数据库厂商），自动备份。**卸载 app 不会丢数据**；删除账号前会要你确认。
</details>

<details>
<summary><b>多设备能用吗？</b></summary>

能。同一账号在任意电脑登录，看到的是同一份账本。
</details>

<details>
<summary><b>登录状态怎么没了？</b></summary>

勾了"30 天免登录"的话应该能撑 30 天。如果 1 小时就掉（v1.1.0 旧版的 bug），升到最新版解决。
</details>

## 📝 更新日志

| 版本 | 日期 | 关键变更 |
|---|---|---|
| **最新版** | — | 去 [Releases](https://github.com/wangshaojie/home-ledger/releases) 看 |

所有历史版本见 [GitHub Releases](https://github.com/wangshaojie/home-ledger/releases)。

---

## 🛠️ 开发者 / 部署

- 想自己部署 Supabase / 改源码 / 跑 dev / 打新包 → 看 [CONTRIBUTING.md](./CONTRIBUTING.md)
- 技术方案 → [TECH_PLAN.md](./TECH_PLAN.md)
- Supabase 建表 SQL → [supabase/](./supabase/) 目录

## License

UNLICENSED（私有项目，作者保留所有权利）
