#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $env:SUPABASE_ACCESS_TOKEN) { throw "请先设置环境变量 SUPABASE_ACCESS_TOKEN" }
if (-not $env:SUPABASE_PROJECT_REF) { throw "请先设置环境变量 SUPABASE_PROJECT_REF" }
$token = $env:SUPABASE_ACCESS_TOKEN
$ref   = $env:SUPABASE_PROJECT_REF
$url   = "https://api.supabase.com/v1/projects/$ref/database/query"
$headers = @{
  'Authorization' = "Bearer $token"
  'Content-Type'  = 'application/json'
}

function Run-Step {
  param([string]$Name, [string]$SqlPath)
  Write-Host "==> $Name" -ForegroundColor Cyan
  $body = Get-Content -Raw -Path $SqlPath -Encoding UTF8
  $payload = @{ query = $body } | ConvertTo-Json -Depth 5 -Compress
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -TimeoutSec 60
    Write-Host "    OK" -ForegroundColor Green
  } catch {
    Write-Host "    FAIL: $($_.Exception.Message)" -ForegroundColor Red
    throw
  }
}

Run-Step -Name '创建者驱离成员:kick_family_member' -SqlPath (Join-Path $PSScriptRoot 'kick_member.sql')

# 刷新 PostgREST schema cache(否则前端 rpc 报 "Could not find the function ... in the schema cache")
Write-Host "==> 刷新 PostgREST schema cache" -ForegroundColor Cyan
$refreshSql = @"
NOTIFY pgrst, 'reload schema';
"@
$payload = @{ query = $refreshSql } | ConvertTo-Json -Depth 5 -Compress
Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -TimeoutSec 60 | Out-Null
Write-Host "    OK" -ForegroundColor Green

# 验证
$verifySql = @"
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('kick_family_member', 'mcp_list_members')
order by p.proname;
"@
$payload = @{ query = $verifySql } | ConvertTo-Json -Depth 5 -Compress
$r = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -TimeoutSec 60
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$json = $r | ConvertTo-Json -Depth 6
[Console]::WriteLine([System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::UTF8.GetBytes($json)))

Write-Host "`nDONE:若上方列出了 kick_family_member 即部署成功,前端重试「移出」即可" -ForegroundColor Green
