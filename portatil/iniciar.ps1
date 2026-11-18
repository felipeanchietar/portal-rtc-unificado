# Portal RTC Unificado — versão portátil. Sobe os 3 serviços + portal e abre o navegador.
# Não instala nada: usa o Java e o Node que vêm dentro desta pasta.
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Svc  = Join-Path $Root 'servicos'
$Logs = Join-Path $Root 'logs'
$PidFile = Join-Path $Root '.pids'
$Java = Join-Path $Root 'runtime\java\bin\java.exe'
$Node = Join-Path $Root 'runtime\node\node.exe'
$Url  = 'http://localhost:8090'

Write-Host '=== Portal RTC Unificado (portátil) ===' -ForegroundColor Cyan

# a pasta precisa ser gravável (logs e controle dos processos)
try { New-Item -ItemType Directory -Force $Logs | Out-Null; [IO.File]::WriteAllText((Join-Path $Logs '.teste'), 'ok') }
catch { Write-Host 'Esta pasta não permite gravação. Copie o portal para Documentos ou Área de Trabalho e rode de lá.' -ForegroundColor Red; exit 1 }

# já está rodando?
try { if ((Invoke-WebRequest "$Url/status" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Write-Host 'Já está rodando. Abrindo o navegador...'; Start-Process $Url; exit 0 } } catch {}

# portas ocupadas por outro programa?
$ocupadas = foreach ($p in 8080, 8081, 8082, 8090) { if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { $p } }
if ($ocupadas) { Write-Host "As portas $($ocupadas -join ', ') já estão em uso por outro programa. Feche-o (ou rode 'Parar Portal RTC') e tente de novo." -ForegroundColor Red; exit 1 }

function Sobe($nome, $exe, $argumentos, $envs = @{}) {
  foreach ($k in $envs.Keys) { Set-Item "env:$k" $envs[$k] }
  $sp = @{ FilePath = $exe; WorkingDirectory = $Svc; WindowStyle = 'Hidden'; PassThru = $true
           RedirectStandardOutput = (Join-Path $Logs "$nome.out.log"); RedirectStandardError = (Join-Path $Logs "$nome.err.log") }
  if ($argumentos.Count) { $sp.ArgumentList = $argumentos }
  $p = Start-Process @sp
  foreach ($k in $envs.Keys) { Remove-Item "env:$k" }
  Add-Content $PidFile $p.Id
}
if (Test-Path $PidFile) { Remove-Item $PidFile }
$jvm = @('-Xms64m', '-Xmx384m', '-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1', '-Dspring.profiles.active=offline')
Sobe 'regular' $Java ($jvm + @('-jar', 'api-regime-geral.jar'))
Sobe 'simples' $Java ($jvm + @('-jar', 'api-simples-nacional.jar'))
Sobe 'danfse'  (Join-Path $Svc 'danfse.exe') @() @{ SERVER_PORT = '8081' }
Sobe 'gateway' $Node @("`"$(Join-Path $Root 'app\gateway\server.js')`"") @{ GATEWAY_PORT = '8090'; RTC_DB = (Join-Path $Svc 'calculadora\db\calculadora-pro.db'); NODE_NO_WARNINGS = '1' }

Write-Host 'Iniciando os serviços (leva de 20 a 60 segundos na primeira vez)...'
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  try { $s = Invoke-RestMethod "$Url/status" -TimeoutSec 5 } catch { continue }
  $on = @($s.PSObject.Properties | Where-Object { $_.Value.online }).Count
  Write-Host "`r  $on de 3 serviços prontos " -NoNewline
  if ($on -eq 3) { $ok = $true; break }
}
Write-Host ''
if ($ok) { Write-Host "Pronto! Portal em $Url" -ForegroundColor Green }
else { Write-Host "Algum serviço demorou ou falhou. Veja a pasta 'logs'. Abrindo o portal mesmo assim." -ForegroundColor Yellow }
Start-Process $Url
Write-Host "Para encerrar, use 'Parar Portal RTC'."
Start-Sleep -Seconds 4
