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
    if ($resp) {
      $json = $resp | ConvertTo-Json -Depth 6
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      [Console]::WriteLine([System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::UTF8.GetBytes($json)))
    }
  } catch {
    Write-Host "    FAIL: $($_.Exception.Message)" -ForegroundColor Red
    throw
  }
}

Run-Step -Name '加固迁移' -SqlPath (Join-Path $PSScriptRoot 'hardening_2026_08_25.sql')

Write-Host "`nDONE" -ForegroundColor Green
