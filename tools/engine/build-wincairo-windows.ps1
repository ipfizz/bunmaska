<#
.SYNOPSIS
  Build a RELOCATABLE WinCairo WebKit engine directory for the Bunmaska engine
  store: the Windows peer of `build-webkitgtk-linux.sh`.

.DESCRIPTION
  WinCairo is already a self-contained closure: `WebKit2.dll`, its dependency DLLs
  (ICU, libcurl, ANGLE, ...) and the helper processes (`WebKit*Process.exe`) all sit
  in one directory and resolve each other from it. Windows has no `$ORIGIN`/rpath;
  the runtime calls `SetDllDirectoryW(<engineLibDir>)` before loading `WebKit2.dll`
  (see `webkit2-ffi.ts`), so relocating is a plain copy into `<OutDir>/<EngineId>/lib/`.

.PARAMETER Source
  Directory of a WinCairo build/extract containing WebKit2.dll and its closure.

.PARAMETER OutDir
  The engine-store root to write into.

.PARAMETER EngineId
  The engine id, e.g. webkit-2-2.52.4-bunmaska1-windows-x64.

.OUTPUTS
  <OutDir>/<EngineId>/lib/        the DLL closure + helper exes + resources
  <OutDir>/<EngineId>/engine.json the manifest (id + soname)
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$EngineId
)
$ErrorActionPreference = 'Stop'

function Log($m) { Write-Host "  - $m" }

$webkit2 = Join-Path $Source 'WebKit2.dll'
if (-not (Test-Path $webkit2)) {
  throw "WinCairo source has no WebKit2.dll: $Source"
}

$engineDir = Join-Path $OutDir $EngineId
$libDir = Join-Path $engineDir 'lib'
New-Item -ItemType Directory -Force -Path $libDir | Out-Null

Log "Source:   $Source"
Log "EngineId: $EngineId"
Log "Bundling the WinCairo closure into $libDir ..."

# Of the executables, only WebKit*Process.exe: skip non-engine cruft like a vendor launcher.
$copied = 0
foreach ($dll in Get-ChildItem -Path $Source -Filter '*.dll' -File) {
  Copy-Item -Path $dll.FullName -Destination (Join-Path $libDir $dll.Name) -Force
  $copied++
}
foreach ($exe in Get-ChildItem -Path $Source -Filter 'WebKit*Process.exe' -File) {
  Copy-Item -Path $exe.FullName -Destination (Join-Path $libDir $exe.Name) -Force
  $copied++
}
foreach ($res in Get-ChildItem -Path $Source -Directory) {
  # WebKit.resources (and any *.resources): fonts/localisations the engine reads.
  if ($res.Name -like '*.resources') {
    Copy-Item -Path $res.FullName -Destination (Join-Path $libDir $res.Name) -Recurse -Force
  }
}

$dllCount = (Get-ChildItem -Path $libDir -Filter '*.dll' -File).Count
$exeCount = (Get-ChildItem -Path $libDir -Filter '*.exe' -File).Count
Log "Bundled $dllCount DLLs + $exeCount helper exes ($copied files)"

# The Windows "soname" is the load entry point the resolver opens; helper exes
# resolve next to it via GetModuleFileName.
$manifest = @{
  id     = $EngineId
  soname = 'WebKit2.dll'
  note   = 'relocatable WinCairo WebKit; the DLL closure resolves from one dir via SetDllDirectoryW'
} | ConvertTo-Json
Set-Content -Path (Join-Path $engineDir 'engine.json') -Value $manifest -Encoding utf8

Log "Engine built at $engineDir ($dllCount DLLs)"
