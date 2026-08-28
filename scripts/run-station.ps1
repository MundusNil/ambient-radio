# 梦可电台守护脚本（Windows 登录自启 + 崩溃自愈）
# 注册：schtasks /create /tn "MengkeRadio" /tr "powershell -ExecutionPolicy Bypass -File <本文件绝对路径>" /sc onlogon /rl highest

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

while ($true) {
    Write-Output "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] station 启动…"
    try {
        & pnpm start 2>&1 | Out-File -Append -Encoding utf8 "$repoRoot\data\station.log"
    } catch {
        Write-Output "[$(Get-Date -Format 'HH:mm:ss')] station 崩溃：$($_.Exception.Message)" | Out-File -Append -Encoding utf8 "$repoRoot\data\station.log"
    }
    Start-Sleep -Seconds 3
}
