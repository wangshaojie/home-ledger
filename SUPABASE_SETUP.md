# Supabase 部署指引

> 适用版本：HomeLedger v1.2（含改密流程）
> 预计耗时：10-15 分钟

## 1. 创建 Supabase 项目

1. 打开 https://supabase.com/dashboard
2. **New Project**：
   - Name: `home-ledger`
   - Database Password: 选一个强的，**记下来**
   - Region: **Singapore (Southeast Asia)** ← 必须这个区域
   - Plan: **Free**
3. 等 1-2 分钟项目建好

## 2. 执行 SQL（按顺序，缺一不可）

打开 `SQL Editor` → `New query`，依次执行：

### 2.1 schema.sql
复制 `supabase/schema.sql` 全部内容粘贴进去 → Run

应看到 4 张表（profiles / families / categories / expenses）+ 2 个触发器 + 1 个函数创建成功。

### 2.2 rls.sql
复制 `supabase/rls.sql` 全部内容粘贴进去 → Run

应看到 RLS 启用 + 14 个策略创建成功（v2026-08-25：expenses INSERT/UPDATE/DELETE 都加了 family_id 校验）。

### 2.3 seed.sql
复制 `supabase/seed.sql` 全部内容粘贴进去 → Run

应看到 2 个 RPC 函数创建成功（`create_family_with_defaults`、`join_family_by_invite`）。

### 2.4 payment_accounts.sql（v1.2 新增）
复制 `supabase/payment_accounts.sql` 全部内容粘贴进去 → Run

应看到 payment_accounts 表 + 4 个 RLS 策略 + create_family_with_defaults 函数被 update（增加了 6 个默认账户）。

### 2.5 password_reset.sql（v1.2 新增 · 改密用）
复制 `supabase/password_reset.sql` 全部内容粘贴进去 → Run

应看到 `password_reset_codes` 表创建成功（含 `failed_attempts` 字段，防 OTP 暴力枚举）。

### 2.6 password_reset_rpc.sql（v1.2 新增 · 改密用）
复制 `supabase/password_reset_rpc.sql` 全部内容粘贴进去 → Run

应看到 3 个 RPC 函数创建成功（`request_password_reset` / `verify_password_reset_code` / `complete_password_reset`）。

> ⚠️ **v2026-08-25 安全加固**：这 3 个 RPC 都已经从 grant anon 改为只 grant authenticated，并在内部校验 `auth.uid()` 必须 = 目标 user。

### 2.7 fix_expenses_rls_member_delete.sql（v1.1.7 补丁 · 必须）

**v1.1.6 → v1.1.7 升级时必须跑这个补丁**，否则家庭其他成员点"删除账单"会报：

```
new row violates row-level security policy for table "expenses"
```

**原因**：旧 RLS 策略 `expenses: 创建者可改/可删` 限定 `creator_id = auth.uid()`，只允许创建者改/删。但 UI 上"删除"按钮对所有家庭成员都显示，导致非创建者被 RLS 拒绝。

**修法**：放宽 UPDATE / DELETE 策略到 `is_family_member(family_id)`，所有同家庭成员都能软删/修改。INSERT 仍要求 `creator_id = auth.uid()`（谁创建谁负责），不变。

复制 `supabase/fix_expenses_rls_member_delete.sql` 全部内容粘贴进去 → Run

应看到 2 条 `DROP POLICY` + 2 条 `CREATE POLICY` 成功（expenses UPDATE / DELETE 策略替换）。

**验证（可选）**：

```sql
select polname, polcmd from pg_policy
where polrelid = 'public.expenses'::regclass
order by polname;
```

应看到 4 条策略：SELECT / INSERT / UPDATE / DELETE，名字分别是：

- `expenses: 同家庭可见` (r)
- `expenses: 创建者可创建` (a)
- `expenses: 创建者可改` (w) ← 行为放宽
- `expenses: 创建者可删` (d) ← 行为放宽

> 注：策略名**仍是**"创建者可改/可删"（保留原名字以免和历史脚本冲突），但实际判断已经改成"同家庭可改/可删"。

### 2.8 mcp_device.sql（v1.3 新增 · AI agent 记账 · 必须）

**MCP server 接入**。让 AI agent（Codex / Mavis / WorkBuddy 等）通过短期 access_token 调 Supabase，而不是用 service_role。

安全模型：
- MCP server 永远拿不到 service_role，只能用用户授权的 32 字节 token
- token 存 bcrypt 哈希在 `mcp_device_tokens` 表
- 每用户最多 5 台活跃设备，30 天自动过期
- 每用户每分钟最多 30 次写、120 次读
- 所有调用进 `mcp_audit_log` 审计

复制 `supabase/mcp_device.sql` 全部内容粘贴进去 → Run

应看到 2 张表创建 + 7 个 RPC 创建（末尾 `do $$` 块会输出数量确认）。

### 2.9 mcp_device_views.sql（v1.3 新增 · 必须）

桌面端 Vue 用这两个 RPC 列"已连接设备"和"AI 记账历史"。

复制 `supabase/mcp_device_views.sql` 全部内容粘贴进去 → Run

应看到 2 个 RPC 创建成功（`mcp_list_my_devices`、`mcp_list_my_audit_log`）。

### 2.10 verify_mcp_device.sql（v1.3 新增 · 验证用）

可选。跑完上面两个 SQL 后执行，确认表、RPC、RLS、grant 都对。

复制 `supabase/verify_mcp_device.sql` 全部内容粘贴进去 → Run

应看到 4 个 ✅ PASS（表数、RPC 数、RLS 启用、grant 配置）。

## 3. 配置 Auth

### 3.1 开启邮箱 OTP

`Authentication` → `Providers` → `Email`：
- 确认 **Email** provider 已开启
- **Confirm email**: 关掉（开发体验更好，正式上线再开）
- **Enable signups**: 开

### 3.2（可选）SMTP 频率

免费版 SMTP 限制 4 封/小时（防滥用）。改密流程不走 Supabase SMTP（走 Resend），4 封/小时是登录注册用的。

## 4. 拿环境变量

`Project Settings` → `API`：

- **Project URL** → `VITE_SUPABASE_URL`
- **anon public key** → `VITE_SUPABASE_ANON_KEY`

填到项目根目录 `.env`（复制 `.env.example` 改名）：

```env
# 前端用（VITE_ 前缀会进渲染进程 bundle，anon key 设计上就是公开的）
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...

# 主进程用（不带 VITE_ 前缀，永不进 bundle）
# Resend API key 在 https://resend.com/api-keys 创建
# ⚠️ 不要用 VITE_ 前缀，否则会泄露到 dist-electron/main.js
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 5. 配置 Resend 域名（改密邮件用）

1. 打开 https://resend.com/domains
2. **Add Domain** → 输入你拥有的域名（如 240730.xyz）
3. 按提示加 DNS 记录（MX / TXT / DKIM）
4. 验证通过后，`from: '家庭记账 <noreply@240730.xyz>'` 才能发件
5. 在 `electron/main.ts` 改 `from` 字段为你验证过的域名

> ⚠️ 用 Resend 沙盒 `onboarding@resend.dev` 只能发到 Resend 账号注册邮箱。要发到任意用户必须用 verified 域名。

## 6. 跑起来

```bash
pnpm install
pnpm dev
```

Electron 窗口起来后：
- 登录页输入真实邮箱 → 查收 6 位验证码（Supabase SMTP）
- 登录后进「创建家庭」→ 填名 → 提交
- 跳转首页 → 记一笔 → 列表显示
- 到 Supabase Dashboard → `expenses` 表里能直接看到新插入的记录
- 进设置 → 改密码 → 收 Resend 邮件（6 位 OTP）→ 验证 → 改密成功

## 7. 验证 RLS 生效

到 `Authentication` → `Policies`，确认每张表都有策略（应该有 14+ 个）。

或用 SQL Editor 跑：

```sql
-- 模拟匿名用户查 expenses
SET ROLE anon;
SELECT count(*) FROM expenses;  -- 应该报错或返回 0
RESET ROLE;

-- 模拟 RPC grant（确保 anon 没拿到 complete_password_reset）
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('request_password_reset', 'verify_password_reset_code', 'complete_password_reset');
-- 应只看到 authenticated，看不到 anon
```

## 8. 防止 7 天自动暂停

免费项目 7 天无活动会被 pause。加个 ping：

**方式 A：GitHub Actions**（推荐，零成本）

在项目 `.github/workflows/keep-supabase-alive.yml`：

```yaml
name: keep-supabase-alive
on:
  schedule:
    - cron: '0 */5 * * *'   # 每 5 小时
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase
        run: |
          curl -s -o /dev/null -w "%{http_code}" \
            "${{ secrets.SUPABASE_URL }}/rest/v1/"
```

把 `SUPABASE_URL` 加到 repo secrets。

**方式 B：本地 cron / 任务计划程序**

```bash
curl -s "https://xxxxx.supabase.co/rest/v1/" -H "apikey: <anon-key>"
```

Windows 任务计划程序每 5 天跑一次。

## 9. 数据模型速查

| 表 | 用途 | 关键字段 |
|---|---|---|
| `profiles` | 用户扩展 | id(=auth.users.id), family_id, display_name |
| `families` | 家庭 | name(unique), invite_code, created_by |
| `categories` | 每家庭的分类 | family_id, name, is_default |
| `expenses` | 账单 | family_id, creator_id, amount, spent_at |
| `payment_accounts` | 支付账户（v1.2） | family_id, name, is_default |
| `password_reset_codes` | 改密 OTP（v1.2） | user_id, code, expires_at, failed_attempts |

**RLS 一句话总结**：
- 同家庭成员 → 互相可见
- 创建者 → 可改/删自己的账单（且必须仍在自己家庭）
- 系统分类 → 不可删改
- 自定义分类 → 创建者家庭内可删改
- 改密 RPC → 只 authenticated 角色可调，且必须为自己邮箱
