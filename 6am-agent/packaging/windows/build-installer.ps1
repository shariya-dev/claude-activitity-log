<#
.SYNOPSIS
  Builds the per-user 6AM Agent installer (6amAgent-<version>-<arch>.exe) with Inno Setup 6.

.DESCRIPTION
  Consumes the H18 build payload (dist\win-x64 or dist\win-arm64):
    runtime\node.exe, app\agent.cjs, app\build-config.json, VERSION (optional)
  and compiles 6amAgent.iss with ISCC.exe. Authenticode signing is optional and is skipped
  entirely unless both -SignToolPath and -CertificateThumbprint are given.
  Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-installer.ps1 -PayloadDir dist\win-x64 -Version 1.0.0
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PayloadDir,

    [Parameter(Mandatory = $true)]
    [string]$Version,

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [string]$OutputDir,

    [string]$SignToolPath,

    [string]$CertificateThumbprint,

    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
$issPath = Join-Path $scriptDir '6amAgent.iss'

# --- 1. Validate inputs (before looking for ISCC, so this is testable anywhere) ---

if ($Version -notmatch '^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$') {
    throw "Invalid -Version '$Version'. Expected semver like 1.0.0 or 1.0.0-rc.1."
}

if (-not (Test-Path -LiteralPath $PayloadDir -PathType Container)) {
    throw "Payload directory not found: '$PayloadDir'. Run 'npm run build -- --target win-$Arch' first (produces dist\win-$Arch)."
}
$payload = (Resolve-Path -LiteralPath $PayloadDir).ProviderPath.TrimEnd('\', '/')

$required = @(@('runtime', 'node.exe'), @('app', 'agent.cjs'), @('app', 'build-config.json'))
$missing = @()
foreach ($parts in $required) {
    $candidate = Join-Path (Join-Path $payload $parts[0]) $parts[1]
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $missing += ($parts -join '\')
    }
}
if ($missing.Count -gt 0) {
    throw ("Payload '$payload' is not a valid H18 build output. Missing: " + ($missing -join ', ') + '. Expected runtime\node.exe, app\agent.cjs, app\build-config.json.')
}

if (-not (Test-Path -LiteralPath $issPath -PathType Leaf)) {
    throw "Inno Setup script not found: '$issPath'."
}

$signEnabled = $false
if ($SignToolPath -or $CertificateThumbprint) {
    if (-not ($SignToolPath -and $CertificateThumbprint)) {
        throw 'Signing needs both -SignToolPath and -CertificateThumbprint (omit both to build unsigned).'
    }
    if (-not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) {
        throw "signtool.exe not found: '$SignToolPath'."
    }
    if ($CertificateThumbprint -notmatch '^[0-9A-Fa-f]{40}$') {
        throw 'Invalid -CertificateThumbprint (expected 40 hex characters, SHA-1 thumbprint).'
    }
    $signEnabled = $true
}

# --- 2. Locate ISCC.exe ---

function Find-Iscc {
    $cmd = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @()
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe') }
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe') }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe') }
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c -PathType Leaf) { return $c }
    }
    return $null
}

$iscc = Find-Iscc
if (-not $iscc) {
    throw 'ISCC.exe (Inno Setup 6) not found on PATH or in the standard install locations. Install Inno Setup 6.3+ on the build host (https://jrsoftware.org/isdl.php).'
}

# --- 3. Compile ---

if (-not $OutputDir) {
    $OutputDir = Join-Path $scriptDir 'Output'
}
if (-not (Test-Path -LiteralPath $OutputDir -PathType Container)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
$outDir = (Resolve-Path -LiteralPath $OutputDir).ProviderPath.TrimEnd('\', '/')

# Arguments containing spaces are quoted by PowerShell; none contain embedded double quotes
# (signtool uses Inno's $q/$f placeholders instead), which keeps Windows PowerShell 5.1 quoting safe.
$isccArgs = @(
    "/DPayloadDir=$payload",
    "/DAppVersion=$Version",
    "/DAppArch=$Arch",
    "/O$outDir"
)

if ($signEnabled) {
    $signCmd = '$q' + $SignToolPath + '$q sign /sha1 ' + $CertificateThumbprint + ' /fd sha256 /tr ' + $TimestampUrl + ' /td sha256 $f'
    $isccArgs += '/DSignEnabled=1'
    $isccArgs += "/Ssigntool6am=$signCmd"
    Write-Host "Signing enabled (thumbprint $CertificateThumbprint, timestamp $TimestampUrl)."
} else {
    Write-Host 'Signing skipped (no -SignToolPath/-CertificateThumbprint).'
}

$isccArgs += $issPath

Write-Host "ISCC: $iscc"
Write-Host "Payload: $payload"
Write-Host "Version: $Version  Arch: $Arch  Output: $outDir"

& $iscc @isccArgs
if ($LASTEXITCODE -ne 0) {
    throw "ISCC.exe failed with exit code $LASTEXITCODE."
}

$outFile = Join-Path $outDir ("6amAgent-$Version-$Arch.exe")
if (-not (Test-Path -LiteralPath $outFile -PathType Leaf)) {
    throw "ISCC reported success but '$outFile' was not produced."
}
Write-Host "Built: $outFile"
