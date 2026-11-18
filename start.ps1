<#
  Sobe os 3 servicos da Receita + o gateway/portal e abre o navegador.
    Regime Regular   -> http://localhost:8080/api   (Java)
    Simples Nacional -> http://localhost:8082/api   (Java)
    Gerador DANFSe   -> http://localhost:8081       (Go)
    Portal unificado -> http://localhost:8090       (Node)
  Para parar:  .\stop.ps1
#>
param([switch]$SemNavegador)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Vendor = Join-Path $Root 'vendor'
$Logs = Join-Path $Root 'logs'; New-Item -ItemType Directory -Force $Logs | Out-Null
$PidFile = Join-Path $Root '.pids'

# JDK 21: JAVA_HOME, .\tools ou PATH
$java = $null
foreach ($c in @($env:JAVA_HOME) + (Get-ChildItem (Join-Path $Root 'tools') -Directory -Filter 'jdk*' -ErrorAction SilentlyContinue | ForEach-Object FullName)) {
  # le o arquivo 'release' do JDK (evita o stderr do java -version, que o PS 5.1 trata como erro)
  if ($c -and (Test-Path "$c\bin\java.exe") -and (Test-Path "$c\release") -and ((Get-Content "$c\release" -Raw) -match 'JAVA_VERSION="(2\d|[3-9]\d)')) { $java = "$c\bin\java.exe"; break }
}
if (-not $java) { $java = 'java' }

function Jar($repo) {
  $j = Get-ChildItem (Join-Path $Vendor "$repo\target") -Filter *.jar -ErrorAction SilentlyContinue | Where-Object Name -notmatch 'original|sources' | Select-Object -First 1
  if (-not $j) { throw "JAR de $repo nao encontrado. Rode .\setup.ps1 primeiro." }
  $j.FullName
}
function Sobe($nome, $exe, $argumentos, $dir, $envs = @{}) {
  foreach ($k in $envs.Keys) { Set-Item "env:$k" $envs[$k] }
  $sp = @{ FilePath = $exe; WorkingDirectory = $dir; WindowStyle = 'Hidden'; PassThru = $true
           RedirectStandardOutput = (Join-Path $Logs "$nome.out.log"); RedirectStandardError = (Join-Path $Logs "$nome.err.log") }
  if ($argumentos.Count) { $sp.ArgumentList = $argumentos }
  $p = Start-Process @sp
  foreach ($k in $envs.Keys) { Remove-Item "env:$k" }
  Add-Content $PidFile $p.Id
  Write-Host ("  {0,-8} pid {1}" -f $nome, $p.Id)
}

if (Test-Path $PidFile) { & (Join-Path $Root 'stop.ps1') | Out-Null }
Write-Host 'Subindo servicos...' -ForegroundColor Cyan
$cors = 'http://localhost:8090'
Sobe 'regular' $java @('-Dspring.profiles.active=offline', '-jar', "`"$(Jar 'calculadora-rtc-regime-regular')`"") (Join-Path $Vendor 'calculadora-rtc-regime-regular') @{ APP_CORS_ALLOWED_ORIGINS = $cors }
Sobe 'simples' $java @('-Dspring.profiles.active=offline', '-jar', "`"$(Jar 'calculadora-rtc-simples-nacional')`"") (Join-Path $Vendor 'calculadora-rtc-simples-nacional') @{ APP_CORS_ALLOWED_ORIGINS = $cors }
Sobe 'danfse'  (Join-Path $Root 'bin\danfse.exe') @() (Join-Path $Vendor 'calculadora-rtc-gerador-danfse') @{ SERVER_PORT = '8081' }
Sobe 'gateway' 'node' @("`"$(Join-Path $Root 'gateway\server.js')`"") $Root @{ GATEWAY_PORT = '8090' }

Write-Host 'Aguardando os servicos ficarem prontos (Spring Boot leva ~15-30 s)...'
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  try { $s = Invoke-RestMethod 'http://localhost:8090/status' -TimeoutSec 5 } catch { continue }
  $on = @($s.PSObject.Properties | Where-Object { $_.Value.online }).Count
  Write-Host "`r  $on/3 online" -NoNewline
  if ($on -eq 3) { $ok = $true; break }
}
Write-Host ''
if ($ok) { Write-Host 'Tudo no ar: http://localhost:8090' -ForegroundColor Green }
else { Write-Host 'Algum servico nao respondeu; veja .\logs\*.err.log. O portal abre mesmo assim.' -ForegroundColor Yellow }
if (-not $SemNavegador) { Start-Process 'http://localhost:8090' }
