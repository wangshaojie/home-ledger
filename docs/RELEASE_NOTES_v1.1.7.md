# v1.1.7 Release Notes

> 给 GitHub Release → Edit release → "Describe this release" 直接粘贴。
> 修好 GitHub PAT 后我用 `gh release edit v1.1.7 --notes-file docs/RELEASE_NOTES_v1.1.7.md` 一键更新。

---

## ✨ 新增 / 改进

- **产品名规范化**：`home-ledger` 改为 `HomeLedger`（npm 包名 / 产物文件名 / GitHub Actions artifact 名 / 错误日志 prefix / localStorage key 前缀）。GitHub 仓库名仍为 `wangshaojie/home-ledger`（不动线上 URL）。
- **登录页回车提交**：密码输入框加 `@keyup.enter` 监听，按回车直接提交（之前只能点按钮）。
- **新增 `docs/RELEASE.md`**：明确"commit vs tag 区别"+ 标准发版流程 + 6 个常见踩坑。

## 🐛 Bug 修复

- **登录页回车不提交**：Element Plus `<el-input>` 不是原生 form 控件，不会自动 proxy 回车到 form.submit，需要显式 `@keyup.enter` 监听。

## ⚠️ 数据库 hotfix（必须执行）

v1.1.7 升级后必须跑这个 SQL 补丁，否则家庭其他成员点"删除账单"会报：

```
new row violates row-level security policy for table "expenses"
```

**原因**：v1.1.6 之前的 RLS 策略 `expenses: 创建者可改/可删` 限定 `creator_id = auth.uid()`，只允许创建者改/删。但 UI 上"删除"按钮对所有家庭成员都显示，导致非创建者被 RLS 拒绝。

**修法**：

1. 打开 Supabase Dashboard → 你的项目 → **SQL Editor** → **New query**
2. 复制 `supabase/fix_expenses_rls_member_delete.sql` 全部内容粘贴 → **Run**
3. 看到 2 条 `DROP POLICY` + 2 条 `CREATE POLICY` 成功即可

**验证（可选）**：

```sql
select polname, polcmd from pg_policy
where polrelid = 'public.expenses'::regclass
order by polname;
```

应看到 4 行（已验证 ✅）：

| polname | polcmd |
|---|---|
| expenses: 创建者可创建 | a |
| expenses: 创建者可删 | d |
| expenses: 创建者可改 | w |
| expenses: 同家庭可见 | r |

跑完后不需要 reload schema（RLS 策略修改会立刻生效），回到应用再点删除按钮应该就成功了。

## 📦 资产

- `HomeLedger-1.1.7-x64.exe`（NSIS 安装版）
- `HomeLedger-1.1.7-portable-x64.exe`（便携版）
- `HomeLedger-1.1.7-x64.exe.blockmap`（差分更新用）
- `latest.yml`（客户端自动更新读这个）

**SHA256 校验**：

```powershell
Get-FileHash .\HomeLedger-1.1.7-x64.exe -Algorithm SHA256
Get-FileHash .\HomeLedger-1.1.7-portable-x64.exe -Algorithm SHA256
```

## 🔄 自动更新

老用户（v1.1.0+）启动应用后会收到更新提示，下载 + 重启即可。**必须先跑上面那个 SQL 补丁**再升 v1.1.7，否则删除功能仍然报 RLS 错（虽然本地能升级成 1.1.7 代码，但 RLS 是后端策略，代码版本不影响）。

## 📝 完整变更

- `e239480` feat: home-ledger → HomeLedger 大驼峰改造 + 登录页回车提交 + RELEASE.md
- `31279c5` chore: bump version to 1.1.7
- `（hotfix commit）` docs: RLS 补丁说明 + supabase/fix_expenses_rls_member_delete.sql + SUPABASE_SETUP.md
