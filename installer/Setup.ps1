# Unified Myfactory / Universal Software Factory Windows Setup.
# Never closes, restarts, or reloads Antigravity IDE.
[CmdletBinding()]
param(
    [string]$ProjectPath = '',
    [ValidateSet('Workspace','Global','Both')][string]$Scope = 'Both',
    [switch]$InstallExternalSkills,
    [switch]$UpdateFactory
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Install-Factory.ps1') -Scope $Scope -ProjectPath $ProjectPath -InstallExternalSkills:$InstallExternalSkills -UpdateFactory:$UpdateFactory
if (Get-Command node -ErrorAction SilentlyContinue) {
    $doctorTarget = if ($ProjectPath) { $ProjectPath } else { (Get-Location).Path }
    & node (Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\factory.mjs') doctor $doctorTarget
}
