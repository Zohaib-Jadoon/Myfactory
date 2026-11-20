# Windows 11 / PowerShell 5.1+ installer. No elevated privileges needed.
# Never closes, restarts, or modifies Antigravity IDE or Cursor IDE executables.
[CmdletBinding()]
param(
    [ValidateSet('Global','Workspace','Both')][string]$Scope='Global',
    [string]$ProjectPath='',
    [switch]$InstallPstack,
    [switch]$InstallPonytail,
    [switch]$InstallExternalSkills,
    [switch]$SkipExternalSkills,
    [switch]$UpdateFactory
)
$ErrorActionPreference='Stop'
$source=Split-Path -Parent $PSScriptRoot
$PstackRepo='https://github.com/backnotprop/pstack.git'
$PonytailRepo='https://github.com/DietrichGebert/ponytail.git'
if ($InstallExternalSkills) { $InstallPstack = $true; $InstallPonytail = $true }
if ($Scope -in @('Workspace','Both')) {
    if (-not $ProjectPath) { $ProjectPath=(Get-Location).Path }
    if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) { throw "Project directory not found: $ProjectPath" }
    $ProjectPath=(Resolve-Path -LiteralPath $ProjectPath).Path
}

function Copy-Tree([string]$from,[string]$dest,[bool]$overwrite=$false){
    if (-not (Test-Path $from)) { return }
    Get-ChildItem -LiteralPath $from -File -Recurse | ForEach-Object {
        $rel = $_.FullName.Substring($from.Length).TrimStart([char]'\',[char]'/')
        $out = Join-Path $dest $rel
        if ((Test-Path -LiteralPath $out) -and (-not $overwrite)) {
            Write-Host "Preserved: $out"
        } else {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $out) | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $out -Force
            Write-Host "Installed: $out"
        }
    }
}

function Copy-SkillDirs([string]$skillsRoot,[string]$destRoot,[bool]$overwrite=$false){
    if (-not (Test-Path $skillsRoot)) { return }
    Get-ChildItem -LiteralPath $skillsRoot -Directory | ForEach-Object {
        if (Test-Path (Join-Path $_.FullName 'SKILL.md')) {
            Copy-Tree $_.FullName (Join-Path $destRoot $_.Name) $overwrite
        }
    }
}

function Add-External([string]$repo,[string]$label,[string[]]$skillTargets,[string[]]$agentTargets=@()){
    if(-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is required to auto-install $label. Pass -SkipExternalSkills for offline installs." }
    $temp=Join-Path ([IO.Path]::GetTempPath()) ("factory-skills-"+[Guid]::NewGuid().ToString('N'))
    try {
        Write-Host "Cloning $label from $repo (review external code before use)" -ForegroundColor Yellow
        & git clone --quiet --depth 1 $repo $temp
        if($LASTEXITCODE -ne 0){throw "Git clone failed: $repo"}
        $skillsDir = Join-Path $temp 'skills'
        if (Test-Path $skillsDir) {
            foreach ($t in $skillTargets) { Copy-SkillDirs $skillsDir $t $false }
        }
        $agentsDir = Join-Path $temp 'agents'
        if (($agentTargets.Count -gt 0) -and (Test-Path $agentsDir)) {
            foreach ($a in $agentTargets) {
                New-Item -ItemType Directory -Force -Path $a | Out-Null
                Get-ChildItem -LiteralPath $agentsDir -Filter '*.md' -File | ForEach-Object {
                    $out = Join-Path $a $_.Name
                    if (-not (Test-Path -LiteralPath $out)) {
                        Copy-Item -LiteralPath $_.FullName -Destination $out -Force
                        Write-Host "Installed: $out"
                    } else {
                        Write-Host "Preserved: $out"
                    }
                }
            }
        }
        $revision=& git -C $temp rev-parse HEAD
        Write-Host "$label source commit: $revision"
    } finally {if(Test-Path $temp){Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue}}
}

$externalTargets=@()
$agentTargets=@()

if ($Scope -in @('Global','Both')) {
    $gSkills=Join-Path $HOME '.gemini\config\skills'
    $gRules=Join-Path $HOME '.gemini\config\rules'
    $gWorkflows=@((Join-Path $HOME '.gemini\workflows'), (Join-Path $HOME '.agents\workflows'))
    Copy-Tree (Join-Path $source '.agents\skills') $gSkills ([bool]$UpdateFactory)
    Copy-Tree (Join-Path $source '.agents\rules') $gRules ([bool]$UpdateFactory)
    foreach ($wf in $gWorkflows) { Copy-Tree (Join-Path $source '.agents\workflows') $wf ([bool]$UpdateFactory) }
    $externalTargets += $gSkills

    # Cursor global skills & rules (~/.cursor/skills and ~/.cursor/rules; never touch ~/.cursor/skills-cursor)
    $cSkills=Join-Path $HOME '.cursor\skills'
    $cRules=Join-Path $HOME '.cursor\rules'
    Copy-Tree (Join-Path $source '.agents\skills') $cSkills ([bool]$UpdateFactory)
    Copy-Tree (Join-Path $source '.cursor\rules') $cRules ([bool]$UpdateFactory)
    $externalTargets += $cSkills
    $agentTargets += (Join-Path $HOME '.cursor\agents')

    $cursorModels = Join-Path $cRules 'pstack-models.mdc'
    if (-not (Test-Path $cursorModels)) {
        New-Item -ItemType Directory -Force -Path $cRules | Out-Null
        [IO.File]::WriteAllText($cursorModels, "---`ndescription: pstack per-role model choices (overrides skill defaults)`nalwaysApply: true`n---`n# pstack model configuration`n# defaults: 2`n# budget: large (xhigh)`nfeature, refactoring: inherit-parent`nbug-fix: inherit-parent`nperf-issue: inherit-parent`nhillclimb: inherit-parent`njudgment and prose: inherit-parent`nhardest tasks: inherit-parent`nreflect tooling: inherit-parent`nreflect judgment, divergent, synthesizer: inherit-parent`narena runners: inherit-parent`narena cross-judge pool: inherit-parent`nswarm workers: inherit-parent`narchitect runners: inherit-parent`ninterrogate reviewers: inherit-parent`n")
        Write-Host "Installed: $cursorModels"
    }

    # Mirror existing local pstack and Ponytail skills from Antigravity global skills into Cursor ~/.cursor/skills if missing
    if (Test-Path $gSkills) {
        $mirrorList = @(
            'architect','arena','automate-me','benchmark-checklist','blast-radius','bro',
            'control-cli','control-ui','correct','create-formal-verification-skill',
            'create-verification-skill','deslop','figure-it-out','how','in-your-own-words',
            'interrogate','ketchup','ketchup-video','maintain-formal-verification-skill',
            'maintain-verification-skill','make-bot-ui','no-comments','poteto-help',
            'poteto-mode','recall','reflect','setup-pstack','sharpen','show-me-your-work',
            'statechart','swarm','tdd','teach','technical-writing',
            'typescript-best-practices','unslop','why',
            'ponytail','ponytail-audit','ponytail-debt','ponytail-gain','ponytail-help','ponytail-review'
        )
        Get-ChildItem -LiteralPath $gSkills -Directory -Filter 'principle-*' | ForEach-Object { $mirrorList += $_.Name }
        foreach ($skillName in ($mirrorList | Select-Object -Unique)) {
            $srcSkill = Join-Path $gSkills $skillName
            if (Test-Path (Join-Path $srcSkill 'SKILL.md')) {
                Copy-Tree $srcSkill (Join-Path $cSkills $skillName) $false
            }
        }
    }

    $factoryHome = Join-Path $HOME '.gemini\factory-home'
    New-Item -ItemType Directory -Force -Path $factoryHome | Out-Null
    foreach ($dirName in @('bin','src','.agents','.agent','.cursor')) {
        $srcDir = Join-Path $source $dirName
        $dstDir = Join-Path $factoryHome $dirName
        if (Test-Path $dstDir) { Remove-Item -LiteralPath $dstDir -Recurse -Force }
        if (Test-Path $srcDir) { Copy-Tree $srcDir $dstDir $true }
    }
    Copy-Item (Join-Path $source 'package.json') (Join-Path $factoryHome 'package.json') -Force
    $localBin = Join-Path $HOME '.local\bin'
    New-Item -ItemType Directory -Force -Path $localBin | Out-Null
    [IO.File]::WriteAllText((Join-Path $localBin 'factory.cmd'), "@echo off`r`nnode `"%USERPROFILE%\.gemini\factory-home\bin\factory.mjs`" %*`r`n")
    [IO.File]::WriteAllText((Join-Path $localBin 'factory'), "#!/bin/sh`nexec node `"`$HOME/.gemini/factory-home/bin/factory.mjs`" `"`$@`"`n")

    $geminiMd = Join-Path $HOME '.gemini\GEMINI.md'
    $skillRootPosix = ($gSkills -replace '\\','/')
    $marker = '## Universal AI Software Factory (Auto-Active Across All Projects)'
    $block = @"
$marker
- **Automatic Engineering Stack**: For every coding, debugging, refactoring, or architecture task in any project on this machine, automatically follow:
  1. **pstack (`/poteto-mode`)**: ``$skillRootPosix/poteto-mode/SKILL.md`` — understand flow and data shape first, separate concurrent state (Git worktrees), fix root causes, verify against real artifacts.
  2. **Ponytail (`/ponytail full`)**: ``$skillRootPosix/ponytail/SKILL.md`` — YAGNI, reuse existing helpers, stdlib-first, minimal dependencies, smallest complete diff.
- **Factory Workflows**: Use ``/factory-init``, ``/factory-plan``, ``/factory-build``, ``/factory-status``, ``/factory-test``, ``/factory-review``, ``/factory-fix``, ``/factory-release``, and ``/factory-resume``, backed by ``factory`` CLI.
- **Release & Safety Integrity**: Never fabricate test passes, never close/restart Antigravity IDE, and never auto-push or deploy without explicit human approval.
"@
    if (-not (Test-Path $geminiMd)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $geminiMd) | Out-Null
        [IO.File]::WriteAllText($geminiMd, "# Global Antigravity Instructions`n`n$block`n")
    } else {
        $existing = [IO.File]::ReadAllText($geminiMd)
        if ($existing -notlike "*$marker*") {
            [IO.File]::WriteAllText($geminiMd, ($existing.TrimEnd() + "`n`n$block`n"))
        }
    }

    $pstackModels = Join-Path $HOME '.agents\pstack-models.md'
    if (-not (Test-Path $pstackModels)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pstackModels) | Out-Null
        [IO.File]::WriteAllText($pstackModels, "# pstack model configuration`n# defaults: 2`n# budget: large (xhigh)`nfeature, refactoring: inherit-parent`nbug-fix: inherit-parent`nperf-issue: inherit-parent`nhillclimb: inherit-parent`njudgment and prose: inherit-parent`nhardest tasks: inherit-parent`nreflect tooling: inherit-parent`nreflect judgment, divergent, synthesizer: inherit-parent`narena runners: inherit-parent`narena cross-judge pool: inherit-parent`nswarm workers: inherit-parent`narchitect runners: inherit-parent`ninterrogate reviewers: inherit-parent`n")
    }
    Write-Host "Installed global CLI runtime: $factoryHome and shim: $(Join-Path $localBin 'factory.cmd')"
}

if ($Scope -in @('Workspace','Both')) {
    Copy-Tree (Join-Path $source '.agent') (Join-Path $ProjectPath '.agent') $false
    Copy-Tree (Join-Path $source '.agents') (Join-Path $ProjectPath '.agents') ([bool]$UpdateFactory)
    Copy-Tree (Join-Path $source '.cursor\rules') (Join-Path $ProjectPath '.cursor\rules') ([bool]$UpdateFactory)
    Copy-Tree (Join-Path $source '.agents\skills') (Join-Path $ProjectPath '.cursor\skills') ([bool]$UpdateFactory)
    $externalTargets += (Join-Path $ProjectPath '.agents\skills')
    $externalTargets += (Join-Path $ProjectPath '.cursor\skills')
    if (Get-Command node -ErrorAction SilentlyContinue) {
        & node (Join-Path $source 'bin\factory.mjs') init $ProjectPath --skip-external | Out-Null
        Write-Host "Initialized .factory in $ProjectPath"
    }
}

$missingPstack = @($externalTargets | Where-Object { -not (Test-Path (Join-Path $_ 'poteto-mode\SKILL.md')) })
$missingPstackAgents = @($agentTargets | Where-Object { -not (Test-Path (Join-Path $_ 'poteto-agent.md')) })
$missingPonytail = @($externalTargets | Where-Object { -not (Test-Path (Join-Path $_ 'ponytail\SKILL.md')) })

if ($InstallPstack -or ((-not $SkipExternalSkills) -and (($missingPstack.Count -gt 0) -or ($missingPstackAgents.Count -gt 0)))) {
    $targets = if ($InstallPstack) { $externalTargets } else { $missingPstack }
    $aTargets = if ($InstallPstack) { $agentTargets } else { $missingPstackAgents }
    Add-External $PstackRepo 'pstack' $targets $aTargets
}
if ($InstallPonytail -or ((-not $SkipExternalSkills) -and ($missingPonytail.Count -gt 0))) {
    $targets = if ($InstallPonytail) { $externalTargets } else { $missingPonytail }
    Add-External $PonytailRepo 'Ponytail' $targets
}

Write-Host "Installation complete. Scope: $Scope" -ForegroundColor Green
Write-Host 'Antigravity IDE and Cursor IDE remain open. If newly added UI slash commands are not visible yet, mark PENDING MANUAL RESTART.'
