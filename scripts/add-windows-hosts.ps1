# 让 Windows / 微信走家里的 API，避免解析到公网 IP 后被 NAT 环回拒绝。
$hosts = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$line = '192.168.1.2 armbian.caojian.shop'
$cur = Get-Content $hosts -ErrorAction Stop
if ($cur -match 'armbian\.caojian\.shop') {
    Write-Output 'hosts already has armbian.caojian.shop'
    exit 0
}
Add-Content -Path $hosts -Value "`r`n$line"
Write-Output "added $line"
ipconfig /flushdns | Out-Null
