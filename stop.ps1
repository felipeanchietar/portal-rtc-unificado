# Para os servicos iniciados pelo start.ps1
$PidFile = Join-Path $PSScriptRoot '.pids'
if (-not (Test-Path $PidFile)) { Write-Host 'Nada para parar.'; return }
foreach ($id in Get-Content $PidFile) {
  try { Stop-Process -Id ([int]$id) -Force -ErrorAction Stop; Write-Host "  parado pid $id" } catch {}
}
Remove-Item $PidFile
