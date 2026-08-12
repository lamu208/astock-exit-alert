$ErrorActionPreference = 'Stop'
$python = 'C:\Users\lamu\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localVibeRoot = 'C:\Users\lamu\Documents\Codex\2026-08-09\https-github-com-hkuds-vibe-trading'
$env:EXIT_ALERT_HOST = '0.0.0.0'
$env:EXIT_ALERT_PORT = '8771'

if (-not (Test-Path -LiteralPath $python)) {
    throw "找不到 Python 运行时：$python"
}

Write-Host '正在启动 A 股离场纪律网页……'
$env:VIBE_TRADING_LOCAL_ROOT = $localVibeRoot
$vibe = Get-Command vibe-trading -ErrorAction SilentlyContinue
$vibePort = Get-NetTCPConnection -LocalPort 8899 -ErrorAction SilentlyContinue
if ($null -eq $vibePort -and $null -ne $vibe) {
    Write-Host '检测到 Vibe-Trading，正在启动本地数据服务……'
    Start-Process -FilePath $vibe.Source -ArgumentList 'serve --port 8899' -WindowStyle Hidden
    Start-Sleep -Seconds 2
} elseif ($null -eq $vibePort) {
    Write-Warning '未检测到 Vibe-Trading 服务。请先运行：pip install -r requirements.txt；然后重新运行本脚本。'
}
Start-Process -FilePath $python -ArgumentList 'app.py' -WorkingDirectory $appRoot -WindowStyle Hidden
Start-Sleep -Seconds 1
Start-Process 'http://127.0.0.1:8771/'
$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host '电脑网页地址：http://127.0.0.1:8771/'
foreach ($address in $addresses) { Write-Host "手机同一 Wi-Fi 访问：http://$address`:8771/" }
