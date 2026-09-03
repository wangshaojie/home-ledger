# 家庭记账 · MCP

让 AI agent(Cursor / Claude Desktop / Mavis / WorkBuddy 等)通过自然语言直接给「家庭记账」记账。

**零安装、远程接入**:不需要装任何东西,浏览器里激活一次,把配置粘贴进 AI 客户端即可。

- 激活页:https://mcp.240730.xyz/activate
- MCP 端点:https://mcp.240730.xyz/api/mcp

## 快速开始(3 步,约 2 分钟)

1. **浏览器打开激活页** https://mcp.240730.xyz/activate
2. **用你的家庭记账邮箱登录**:输入邮箱 → 收邮件填 6 位验证码 → 起个设备名(例「我的笔记本」)→ 点「授权并生成 token」
3. **复制配置粘贴进 AI 客户端**:在页面上选你的客户端(Cursor / Claude Desktop / 其他),点「复制配置」,粘贴到配置文件里,**完全退出并重启客户端**

> 必须使用**注册过家庭记账的邮箱**,激活成功后此设备即可操作你家庭内的账单。

## 配置文件位置与格式

### Cursor(Windows / macOS)

文件:`%USERPROFILE%\.cursor\mcp.json`(Windows)或 `~/.cursor/mcp.json`(macOS)

```json
{
  "mcpServers": {
    "home-ledger": {
      "url": "https://mcp.240730.xyz/api/mcp",
      "headers": {
        "Authorization": "Bearer 你的token"
      }
    }
  }
}
```

- 如果文件里已有其它 MCP,把 `home-ledger` 节点**合并**进去,别整文件覆盖
- 重启后打开左侧 MCP 面板,看到 `home-ledger` 绿色 enabled 即成功;要求 Cursor **0.46+**

### Claude Desktop(Windows / macOS)

文件:`%APPDATA%\Claude\claude_desktop_config.json`(Windows)或 `~/Library/Application Support/Claude/claude_desktop_config.json`(macOS),格式多一个 `"type": "http"`:

```json
{
  "mcpServers": {
    "home-ledger": {
      "type": "http",
      "url": "https://mcp.240730.xyz/api/mcp",
      "headers": {
        "Authorization": "Bearer 你的token"
      }
    }
  }
}
```

重启后点输入框旁的插头图标确认已连接;要求 Claude Desktop **1.0.63+**。

### 其他客户端(Mavis / WorkBuddy / Codex 等)

在激活页选「其他」tab 复制配置,粘贴位置参考各客户端文档:

```json
{
  "mcpServers": {
    "home-ledger": {
      "url": "https://mcp.240730.xyz/api/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer 你的token"
      }
    }
  }
}
```

## 验证成功

对 AI agent 说一句:

> 用 home_ledger_whoami 看看我连上了吗

能返回你的用户/设备信息,就说明接好了。接着就能让它记账、查账、删账。

## 可用工具

| 工具 | 用途 |
|------|------|
| `home_ledger_add_expense` | 记一笔支出(必传 amount,分类/账户/日期可选) |
| `home_ledger_list_recent` | 看最近 N 笔(1-100,默认 10) |
| `home_ledger_delete_expense` | 软删一笔(需要 expense_id) |
| `home_ledger_whoami` | 查当前 token 绑定的用户/设备 |

## 使用示例

对 AI agent 说:

> 「我刚在瑞幸买了杯咖啡 28 块,记上」

AI 会调 `home_ledger_add_expense({ amount: 28, note: '瑞幸咖啡' })`。

> 「最近 5 笔是什么?」

AI 会调 `home_ledger_list_recent({ limit: 5 })`。

> 「把刚才那笔 28 块的删了」

AI 会先 list_recent 拿 expense_id,再调 `home_ledger_delete_expense({ expense_id: '...' })`。

## 安全模型

- token 是激活页签发的 64 位随机串,**30 天过期**,过期后回激活页重新签发即可
- token 只能操作**你账号所属家庭**的账单,跨家庭无效
- 所有写操作有审计日志 + 限流(写 30 次/分钟,读 120 次/分钟)
- 一个账号可激活多个设备,可在主应用的设备管理里吊销任意设备(吊销后 token 立即失效)

## 故障排查

| 现象 | 原因 | 修法 |
|------|------|------|
| 客户端显示连接失败/无法连接 | 配置后没重启客户端 | 完全退出(含托盘)再重启 |
| 401 / token 验证失败 | token 过期(30 天)/被吊销/粘贴损坏 | 回激活页重新签发新 token |
| 能列工具但调用报错 | 多为服务端偶发 | 稍后重试;仍不行可反馈报错原文 |
| 请求过于频繁 | 触发限流(写 30 次/分钟) | 等 1 分钟 |
| 激活页收不到邮件 | 邮箱没注册过家庭记账,或看垃圾箱 | 用注册邮箱,5 分钟内查收;超时重新发送 |

## 架构(远程 HTTP 模式)

```
AI agent (Cursor / Claude Desktop / Mavis)
   │  HTTPS + JSON-RPC + Authorization: Bearer <token>
   ▼
https://mcp.240730.xyz/api/mcp (Vercel Serverless)
   │  每次调用先 verify_mcp_token 验签
   ▼
Supabase Postgres
   ├─ mcp_device_tokens  (验签 + 设备管理)
   ├─ mcp_audit_log      (审计)
   └─ mcp_* RPC          (add_expense / list_recent / delete_expense)
```

## 进阶:本地 stdio 模式(开发者用)

远程 HTTP 模式对普通用户足够且推荐。本目录同时也包含一个本地 stdio server 实现,适合开发者本机调试:

```bash
cd mcp-server
npm install
npm run build
```

需要额外配置 Supabase 连接(环境变量)并在 AI 客户端用 `command` 方式接入,配置指引见本目录源码注释。

## License

UNLICENSED — 家庭记账项目专用
