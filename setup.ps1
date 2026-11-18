<#
  Prepara as 3 ferramentas da Receita para rodar juntas no Portal RTC Unificado.

  O que faz:
    1. Garante os 3 repositorios em .\vendor (clona se faltar; -Atualizar faz git pull)
    2. Localiza JDK 21+ e Go 1.27+ (ou baixa versoes portateis para .\tools com -InstalarFerramentas)
    3. Gera UMA vez o banco SQLite oficial (Flyway do regime-regular) e copia para o Simples Nacional
       (o README do Simples manda usar os scripts do outro repositorio; o banco e o mesmo)
    4. Compila os 2 JARs (Spring Boot) e o binario Go do DANFSe em .\bin

  Uso:
    powershell -ExecutionPolicy Bypass -File .\setup.ps1 [-InstalarFerramentas] [-Atualizar]
#>
param([switch]$InstalarFerramentas, [switch]$Atualizar)
$ErrorActionPreference = 'Stop'
$Root   = $PSScriptRoot
$Vendor = Join-Path $Root 'vendor'
$Tools  = Join-Path $Root 'tools'
$Bin    = Join-Path $Root 'bin'
New-Item -ItemType Directory -Force $Vendor, $Tools, $Bin | Out-Null

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# ---------- 1. repositorios ----------
Step 'Repositorios da Receita Federal'
$repos = 'calculadora-rtc-regime-regular', 'calculadora-rtc-simples-nacional', 'calculadora-rtc-gerador-danfse'
foreach ($r in $repos) {
  $dir = Join-Path $Vendor $r
  if (-not (Test-Path $dir)) { git clone --depth 1 "https://github.com/ReceitaFederal/$r.git" $dir }
  elseif ($Atualizar) { git -C $dir pull --ff-only }
  Write-Host "  ok  $r"
}
$Regular = Join-Path $Vendor 'calculadora-rtc-regime-regular'
$Simples = Join-Path $Vendor 'calculadora-rtc-simples-nacional'
$Danfse  = Join-Path $Vendor 'calculadora-rtc-gerador-danfse'

# ---------- 2. ferramentas ----------
Step 'JDK 21+ e Go 1.27+'
function JavaMajor($javaExe) {
  # le o arquivo 'release' do JDK (evita o stderr do java -version, que o PS 5.1 trata como erro)
  $rel = Join-Path (Split-Path (Split-Path $javaExe)) 'release'
  if ((Test-Path $rel) -and ((Get-Content $rel -Raw) -match 'JAVA_VERSION="(\d+)')) { return [int]$Matches[1] }
  return 0
}
$JavaHome = $null
$candidatos = @()
if ($env:JAVA_HOME) { $candidatos += $env:JAVA_HOME }
$candidatos += Get-ChildItem $Tools -Directory -Filter 'jdk*' -ErrorAction SilentlyContinue | ForEach-Object FullName
$candidatos += Get-ChildItem 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Java', 'C:\Program Files\Microsoft' -Directory -ErrorAction SilentlyContinue | Where-Object Name -match 'jdk' | ForEach-Object FullName
foreach ($c in $candidatos) { $j = Join-Path $c 'bin\java.exe'; if ((Test-Path $j) -and (JavaMajor $j) -ge 21) { $JavaHome = $c; break } }
if (-not $JavaHome -and $InstalarFerramentas) {
  Write-Host '  baixando Eclipse Temurin JDK 21 (portatil, ~190 MB) para .\tools ...'
  $zip = Join-Path $Tools 'jdk21.zip'
  Invoke-WebRequest 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' -OutFile $zip
  Expand-Archive $zip $Tools -Force; Remove-Item $zip
  $JavaHome = (Get-ChildItem $Tools -Directory -Filter 'jdk-21*' | Select-Object -First 1).FullName
}
if (-not $JavaHome) { throw 'JDK 21+ nao encontrado. Instale (winget install EclipseAdoptium.Temurin.21.JDK) ou rode com -InstalarFerramentas.' }
$env:JAVA_HOME = $JavaHome; $env:Path = "$JavaHome\bin;$env:Path"
Write-Host "  JDK: $JavaHome"

$GoExe = (Get-Command go -ErrorAction SilentlyContinue).Source
if (-not $GoExe -and (Test-Path "$Tools\go\bin\go.exe")) { $GoExe = "$Tools\go\bin\go.exe" }
if (-not $GoExe -and $InstalarFerramentas) {
  $ver = ((Invoke-WebRequest 'https://go.dev/VERSION?m=text' -UseBasicParsing).Content -split "`n")[0].Trim()
  Write-Host "  baixando $ver (portatil, ~80 MB) para .\tools ..."
  $zip = Join-Path $Tools 'go.zip'
  Invoke-WebRequest "https://go.dev/dl/$ver.windows-amd64.zip" -OutFile $zip
  Expand-Archive $zip $Tools -Force; Remove-Item $zip
  $GoExe = "$Tools\go\bin\go.exe"
}
if (-not $GoExe) { throw 'Go nao encontrado. Instale (winget install GoLang.Go) ou rode com -InstalarFerramentas.' }
Write-Host "  Go:  $(& $GoExe version)"

# ---------- 3. banco de dados ----------
Step 'Banco SQLite oficial (Flyway)'
$db = Join-Path $Regular 'calculadora\db\calculadora-pro.db'
if ($Atualizar -or -not (Test-Path $db)) {
  New-Item -ItemType Directory -Force (Split-Path $db) | Out-Null
  if (Test-Path $db) { Remove-Item $db }
  Push-Location $Regular
  try { & .\mvnw.cmd flyway:migrate '-Dflyway.configFiles=flyway\flyway-pro.conf' --batch-mode --errors -q; if ($LASTEXITCODE) { throw 'flyway falhou' } }
  finally { Pop-Location }
}
New-Item -ItemType Directory -Force (Join-Path $Simples 'calculadora\db') | Out-Null
Copy-Item $db (Join-Path $Simples 'calculadora\db\calculadora-pro.db') -Force
Write-Host ("  ok  {0:N1} MB, compartilhado pelas duas calculadoras" -f ((Get-Item $db).Length / 1MB))

# ---------- 4. build ----------
foreach ($p in @($Regular, $Simples)) {
  Step "Compilando $(Split-Path $p -Leaf)"
  Push-Location $p
  try { & .\mvnw.cmd clean package -DskipTests --batch-mode -q; if ($LASTEXITCODE) { throw "build falhou em $p" } }
  finally { Pop-Location }
  Get-ChildItem (Join-Path $p 'target') -Filter *.jar | Where-Object Name -notmatch 'original|sources' | ForEach-Object { Write-Host "  ok  $($_.Name)" }
}
Step 'Compilando gerador-danfse (Go)'
Push-Location $Danfse
try { & $GoExe build -ldflags='-s -w' -o (Join-Path $Bin 'danfse.exe') ./cmd/danfse; if ($LASTEXITCODE) { throw 'go build falhou' } }
finally { Pop-Location }
Write-Host '  ok  bin\danfse.exe'

Step 'Pronto. Agora rode:  powershell -ExecutionPolicy Bypass -File .\start.ps1'
