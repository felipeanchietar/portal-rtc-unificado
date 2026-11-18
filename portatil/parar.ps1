# Encerra os processos iniciados pelo "Iniciar Portal RTC"
$PidFile = Join-Path $PSScriptRoot '.pids'
if (-not (Test-Path $PidFile)) { Write-Host 'O portal não está rodando.'; return }
foreach ($id in Get-Content $PidFile) {
  try { Stop-Process -Id ([int]$id) -Force -ErrorAction Stop } catch {}
}
Remove-Item $PidFile
Write-Host 'Portal RTC encerrado.'
