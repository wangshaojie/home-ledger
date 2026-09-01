#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# 用法：先设置两个环境变量再运行
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_你的access_token"   (https://supabase.com/dashboard/account/tokens)
#   $env:SUPABASE_PROJECT_REF  = "你的项目ref"            (项目首页 URL 里的那串，如 https://xxx.supabase.co)
if (-not $env:SUPABASE_ACCESS_TOKEN) { throw "请先设置环境变量 SUPABASE_ACCESS_TOKEN" }
if (-not $env:SUPABASE_PROJECT_REF) { throw "请先设置环境变量 SUPABASE_PROJECT_REF" }
$token = $env:SUPABASE_ACCESS_TOKEN
$ref   = $env:SUPABASE_PROJECT_REF
$url   = "https://api.supabase.com/v1/projects/$ref/database/query"
$headers = @{
  'Authorization' = "Bearer $token"
  'Content-Type'  = 'application/json'
}

Write-Host "==> 添加 group_id 字段（多人分摊）" -ForegroundColor Cyan
$body = Get-Content -Raw -Path (Join-Path $PSScriptRoot 'expense_group.sql') -Encoding UTF8
$payload = @{ query = $body } | ConvertTo-Json -Depth 5 -Compress
try {
  $resp = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -TimeoutSec 60
  Write-Host "    OK" -ForegroundColor Green
} catch {
  Write-Host "    FAIL: $($_.Exception.Message)" -ForegroundColor Red
  throw
}

# 验证
$verifySql = @"
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='group_id') as group_col,
  (select count(*) from pg_indexes where schemaname='public' and tablename='expenses' and indexname='idx_expenses_group') as has_index;
"@
$payload = @{ query = $verifySql } | ConvertTo-Json -Depth 5 -Compress
$r = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -TimeoutSec 60
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$json = $r | ConvertTo-Json -Depth 6
[Console]::WriteLine([System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::UTF8.GetBytes($json)))

Write-Host "`nDONE（group_col 为 1 即成功）" -ForegroundColor Green
