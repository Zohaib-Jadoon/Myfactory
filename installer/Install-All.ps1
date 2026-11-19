# Convenience starter: installs factory + pstack + Ponytail globally.
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'Install-Factory.ps1') -Scope Global -InstallPstack -InstallPonytail
if(-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Warning 'Node.js 20+ is needed for the CLI/dashboard.' }
else {& node (Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\factory.mjs') doctor}
