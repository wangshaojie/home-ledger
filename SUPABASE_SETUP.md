# Supabase 部署指引

> 适用版本：home-ledger v1.1
> 预计耗时：10-15 分钟

## 1. 创建 Supabase 项目

1. 打开 https://supabase.com/dashboard
2. **New Project**：
   - Name: `home-ledger`
   - Database Password: 选一个强的，**记下来**
   - Region: **Singapore (Southeast Asia)** ← 必须这个区域
   - Plan: **Free**
3. 等 1-2 分钟项目建好

## 2. 执行 SQL（顺序执行）

打开 `SQL Editor` → `New query`，依次执行：

### 2.1 schema.sql
复制 `supabase/schema.sql` 全部内容粘贴进去 → Run

应看到 4 张表 + 2 个触发器 + 1 个函数创建成功。

### 2.2 rls.sql
复制 `supabase/rls.sql` 全部内容粘贴进去 → Run

应看到 RLS 启用 + 10 个策略创建成功。

### 2.3 seed.sql
复制 `supabase/seed.sql` 全部内容粘贴进去 → Run

应看到 2 个 RPC 函数创建成功（`create_family_with_defaults`、`join_family_by_invite`）。

## 3. 配置 Auth

### 3.1 开启邮箱 OTP

`Authentication` → `Providers` → `Email`：
- 确认 **Email** provider 已开启
- **Confirm email**: 关掉（开发体验更好，正式上线再开）
- **Enable signups**: 开

### 3.2（可选）SMTP 频率

免费版 SMTP 限制 4 封/小时（防滥用）。家庭记账场景够用。后续要换 Resend/SendGrid：

`Authentication` → `SMTP Settings` → 填你第三方服务的 SMTP 凭据。

## 4. 拿环境变量

`Project Settings` → `API`：

- **Project URL** → `VITE_SUPABASE_URL`
- **anon public key** → `VITE_SUPABASE_ANON_KEY`

填到项目根目录 `.env`：

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

## 5. 跑起来

```bash
pnpm dev
```

Electron 窗口起来后：
- 登录页输入真实邮箱 → 查收 6 位验证码
- 登录后进「创建家庭」→ 填名 → 提交
- 跳转首页 → 记一笔 → 列表显示
- 改 Supabase Dashboard → `expenses` 表里能直接看到新插入的记录

## 6. 验证 RLS 生效

到 `Authentication` → `Policies`，确认每张表都有策略。

或用 SQL Editor 跑：

```sql
-- 模拟匿名用户查 expenses
SET ROLE anon;
SELECT count(*) FROM expenses;  -- 应该报错或返回 0
RESET ROLE;
```

## 7. 防止 7 天自动暂停

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

## 8. 数据模型速查

| 表 | 用途 | 关键字段 |
|---|---|---|
| `profiles` | 用户扩展 | id(=auth.users.id), family_id, display_name |
| `families` | 家庭 | name(unique), invite_code, created_by |
| `categories` | 每家庭的分类 | family_id, name, is_default |
| `expenses` | 账单 | family_id, creator_id, amount, spent_at |

**RLS 一句话总结**：
- 同家庭成员 → 互相可见
- 创建者 → 可改/删自己的账单
- 系统分类 → 不可删改
- 自定义分类 → 创建者家庭内可删改
