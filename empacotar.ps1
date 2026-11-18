<#
  Gera o PACOTE PORTÁTIL do Portal RTC Unificado: uma pasta (e um .zip) que roda em
  qualquer Windows 10/11 x64 SEM instalar Git, Node ou Java.

  Pré-requisito: ter rodado o setup.ps1 nesta máquina (JARs, danfse.exe e banco prontos).

  Conteúdo do pacote:
    runtime\java\   Java 21 reduzido (jlink, só os módulos necessários)
    runtime\node\   node.exe portátil (o mesmo desta máquina)
    servicos\       os 2 JARs + danfse.exe + o banco oficial (um só, compartilhado)
    app\            gateway + portal web
    Iniciar Portal RTC.bat / Parar Portal RTC.bat

  Uso:  powershell -ExecutionPolicy Bypass -File .\empacotar.ps1 [-SemZip]
#>
param([switch]$SemZip)
$ErrorActionPreference = 'Stop'
$Root   = $PSScriptRoot
$Vendor = Join-Path $Root 'vendor'
$Nome   = 'portal-rtc-portatil'
$Dist   = Join-Path $Root 'dist'
$Pkg    = Join-Path $Dist $Nome
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# ---------- insumos ----------
Step 'Verificando insumos'
$jdk = Get-ChildItem (Join-Path $Root 'tools') -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk -and $env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\jlink.exe")) { $jdk = Get-Item $env:JAVA_HOME }
if (-not $jdk) { throw 'JDK 21 não encontrado (.\tools ou JAVA_HOME). Rode setup.ps1 -InstalarFerramentas.' }
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$jarRegular = Get-ChildItem "$Vendor\calculadora-rtc-regime-regular\target\*.jar" | Where-Object Name -notmatch 'original|sources' | Select-Object -First 1
$jarSimples = Get-ChildItem "$Vendor\calculadora-rtc-simples-nacional\target\*.jar" | Where-Object Name -notmatch 'original|sources' | Select-Object -First 1
$danfse = Join-Path $Root 'bin\danfse.exe'
$db = Join-Path $Vendor 'calculadora-rtc-regime-regular\calculadora\db\calculadora-pro.db'
foreach ($f in @($jarRegular, $jarSimples, $danfse, $db)) { if (-not $f -or -not (Test-Path $f)) { throw "Faltando: $f — rode setup.ps1 antes." } }
$nodeVer = (& $nodeExe --version)
Write-Host "  JDK  $($jdk.FullName)`n  Node $nodeVer ($nodeExe)"

if (Test-Path $Pkg) { Remove-Item $Pkg -Recurse -Force }
New-Item -ItemType Directory -Force "$Pkg\runtime\node", "$Pkg\servicos\calculadora\db", "$Pkg\app" | Out-Null

# ---------- Java reduzido ----------
Step 'Criando Java 21 reduzido (jlink)'
$mods = 'java.se,jdk.unsupported,jdk.crypto.ec,jdk.crypto.cryptoki,jdk.management,jdk.management.agent,jdk.naming.dns,jdk.zipfs,jdk.charsets,jdk.localedata,jdk.httpserver'
& "$($jdk.FullName)\bin\jlink.exe" --add-modules $mods --strip-debug --no-man-pages --no-header-files --compress=zip-6 --output "$Pkg\runtime\java"
if ($LASTEXITCODE) { throw 'jlink falhou' }

# ---------- arquivos ----------
Step 'Copiando serviços, banco, Node e portal'
Copy-Item $nodeExe "$Pkg\runtime\node\node.exe"
Copy-Item $jarRegular.FullName "$Pkg\servicos\api-regime-geral.jar"
Copy-Item $jarSimples.FullName "$Pkg\servicos\api-simples-nacional.jar"
Copy-Item $danfse "$Pkg\servicos\danfse.exe"
Copy-Item $db "$Pkg\servicos\calculadora\db\calculadora-pro.db"
Copy-Item (Join-Path $Root 'gateway'), (Join-Path $Root 'web') "$Pkg\app" -Recurse
Copy-Item (Join-Path $Root 'LICENSE') $Pkg
$versaoBase = (Get-Item $db).LastWriteTime.ToString('yyyy-MM-dd')

# ---------- lançadores ----------
Copy-Item (Join-Path $Root 'portatil\iniciar.ps1'), (Join-Path $Root 'portatil\parar.ps1') $Pkg
Set-Content "$Pkg\Iniciar Portal RTC.bat" -Encoding ASCII -Value "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0iniciar.ps1`"`r`nif errorlevel 1 pause"
Set-Content "$Pkg\Parar Portal RTC.bat"   -Encoding ASCII -Value "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0parar.ps1`"`r`nping -n 4 127.0.0.1 >nul"
(Get-Content (Join-Path $Root 'portatil\LEIA-ME.txt') -Raw).Replace('{{DATA_BASE}}', $versaoBase).Replace('{{NODE}}', $nodeVer) |
  Set-Content "$Pkg\LEIA-ME.txt" -Encoding UTF8

$mb = [math]::Round(((Get-ChildItem $Pkg -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
Write-Host "  pasta: $Pkg ($mb MB)"

# ---------- zip ----------
if (-not $SemZip) {
  Step 'Compactando'
  $zip = Join-Path $Dist "$Nome-$((Get-Date).ToString('yyyy-MM-dd')).zip"
  if (Test-Path $zip) { Remove-Item $zip }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($Pkg, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
  Write-Host ("  zip:   $zip ({0:N0} MB)" -f ((Get-Item $zip).Length / 1MB))
}
Step 'Pronto'
