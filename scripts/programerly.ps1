<#
.SYNOPSIS
    ProGramerly - Basic Coding Software for All (Windows bootstrap)

.DESCRIPTION
    Runs the same catalog the desktop app uses, with no build step and no
    Electron. winget first, Chocolatey as fallback.

.PARAMETER Profile
    full | ai | minimal | custom      (default: full)

.PARAMETER Only
    Comma-separated catalog item ids. Overrides -Profile.

.PARAMETER List
    Print the catalog and exit.

.PARAMETER WhatIf
    Print every command that would run, without running any of them.

.EXAMPLE
    irm https://raw.githubusercontent.com/Ionity-Global-Pty-Ltd/ProGramerly/main/scripts/programerly.ps1 | iex

.NOTES
    Author     : Johan Wilhelm van Antwerp
    Company    : Antwerp Designs | Ionity (Pty) Ltd | AEDI
    Governance : Policy 986 AED
    Copyright  : (c) 2018-2026 - All rights reserved - TM2
    Web        : https://www.ionity.today
#>
[CmdletBinding()]
param(
    [ValidateSet('full','ai','minimal','custom')]
    [string]$Profile = 'full',
    [string]$Only = '',
    [switch]$List,
    [switch]$WhatIf,
    [string]$CatalogPath
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# ------------------------------------------------------------------ banner --
function Write-Banner {
    $c = 'Cyan'
    Write-Host ''
    Write-Host '  ############################################################' -ForegroundColor $c
    Write-Host '  #                                                          #' -ForegroundColor $c
    Write-Host '  #   P R O G R A M E R L Y                                  #' -ForegroundColor $c
    Write-Host '  #   Basic Coding Software for All                          #' -ForegroundColor $c
    Write-Host '  #                                                          #' -ForegroundColor $c
    Write-Host '  #   Antwerp Designs | Ionity (Pty) Ltd | AEDI              #' -ForegroundColor $c
    Write-Host '  #   Policy 986 AED  -  Building Tomorrow, Today.           #' -ForegroundColor $c
    Write-Host '  #                                                          #' -ForegroundColor $c
    Write-Host '  ############################################################' -ForegroundColor $c
    Write-Host ''
}

function Say([string]$m, [string]$c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }
function Head([string]$m) { Write-Host ''; Write-Host "  == $m" -ForegroundColor Cyan }
function Good([string]$m) { Write-Host "     [ok]   $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "     [warn] $m" -ForegroundColor Yellow }
function Bad ([string]$m) { Write-Host "     [fail] $m" -ForegroundColor Red }

# ------------------------------------------------------------------- setup --
Write-Banner

$script:IsAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $script:IsAdmin) {
    Warn 'Not running as Administrator. Machine-wide installs will fail.'
    Warn 'Re-run from an elevated PowerShell for the full set.'
    Write-Host ''
}

if (-not $CatalogPath) {
    $local = Join-Path $PSScriptRoot '..\src\main\catalog\catalog.json'
    if (Test-Path $local) {
        $CatalogPath = (Resolve-Path $local).Path
    } else {
        $CatalogPath = Join-Path $env:TEMP 'programerly-catalog.json'
        $url = 'https://raw.githubusercontent.com/Ionity-Global-Pty-Ltd/ProGramerly/main/src/main/catalog/catalog.json'
        Say "Downloading catalog from $url"
        Invoke-WebRequest -Uri $url -OutFile $CatalogPath -UseBasicParsing
    }
}

$catalog = Get-Content -Raw -LiteralPath $CatalogPath | ConvertFrom-Json
Say "Catalog v$($catalog.meta.version) - $($catalog.items.Count) items" 'DarkGray'

# -------------------------------------------------------------- selection --
function Test-Applies($item) {
    if ($item.platforms -and $item.platforms.Count -gt 0) { return $item.platforms -contains 'win' }
    return ($null -ne $item.win) -or ($null -ne $item.npm) -or ($null -ne $item.steps)
}

if ($List) {
    foreach ($g in $catalog.groups) {
        Head $g.label
        foreach ($i in $catalog.items | Where-Object { $_.group -eq $g.id -and (Test-Applies $_) }) {
            '{0,-24} {1}' -f $i.id, $i.name | ForEach-Object { Say $_ }
        }
    }
    Write-Host ''
    exit 0
}

if ($Only) {
    $wanted = $Only.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
} else {
    $wanted = ($catalog.items | Where-Object { (Test-Applies $_) -and ($_.profiles -contains $Profile) }).id
}

# Pull in dependencies.
$byId = @{}; foreach ($i in $catalog.items) { $byId[$i.id] = $i }
$set = [System.Collections.Generic.HashSet[string]]::new()
foreach ($w in $wanted) { [void]$set.Add($w) }
$changed = $true
while ($changed) {
    $changed = $false
    foreach ($id in @($set)) {
        foreach ($dep in @($byId[$id].dependsOn)) {
            if ($dep -and -not $set.Contains($dep)) { [void]$set.Add($dep); $changed = $true }
        }
    }
}
# Keep catalog order (bootstrap first).
$queue = $catalog.items | Where-Object { $set.Contains($_.id) -and (Test-Applies $_) }

Say "Profile: $Profile" 'White'
Say "Queue:   $($queue.Count) items" 'White'
Write-Host ''

# ---------------------------------------------------------------- helpers --
$WingetOk = @(0, -1978335189, -1978335135, -1978335212, -1978334967)

function Invoke-Step([string]$cmd) {
    if ($WhatIf) { Say "WHATIF> $cmd" 'DarkGray'; return 0 }
    Say "> $cmd" 'DarkGray'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmd 2>&1 |
        ForEach-Object { Say "  $_" 'DarkGray' }
    return $LASTEXITCODE
}

function Install-Winget([string]$id, [string]$extra) {
    $cmd = "winget install --id $id --exact --silent --disable-interactivity " +
           "--accept-package-agreements --accept-source-agreements $extra"
    if ($WhatIf) { Say "WHATIF> $cmd" 'DarkGray'; return $true }
    Say "> winget $id" 'DarkGray'
    $out = & cmd /c "$cmd 2>&1"
    $code = $LASTEXITCODE
    if ($WingetOk -contains $code -or ($out -match 'already installed')) { return $true }
    Say ("  " + (($out | Select-Object -Last 3) -join ' | ')) 'DarkGray'
    return $false
}

function Install-Choco([string]$pkg) {
    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) { return $false }
    $cmd = "choco install $pkg -y --no-progress --limit-output"
    if ($WhatIf) { Say "WHATIF> $cmd" 'DarkGray'; return $true }
    Say "> choco $pkg" 'DarkGray'
    & cmd /c "$cmd 2>&1" | ForEach-Object { Say "  $_" 'DarkGray' }
    return ($LASTEXITCODE -in @(0,1641,3010))
}

# ------------------------------------------------------------------- main --
$stats = @{ ok = 0; partial = 0; failed = 0; skipped = 0 }
$n = 0

foreach ($item in $queue) {
    $n++
    Head "[$n/$($queue.Count)] $($item.name)"
    $spec = $item.win
    $any = $false; $bad = $false

    foreach ($id in @($spec.winget)) {
        if (-not $id) { continue }
        if (Install-Winget $id $spec.wingetArgs) { $any = $true; Good $id } else { $bad = $true; Warn "winget: $id" }
    }
    if (-not $any -and $spec.choco) {
        foreach ($p in @($spec.choco)) {
            if (Install-Choco $p) { $any = $true; Good "choco: $p" } else { $bad = $true; Warn "choco: $p" }
        }
    }

    $npm = if ($spec.npm) { $spec.npm } else { $item.npm }
    if ($npm) {
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            $c = Invoke-Step "npm install -g $($npm -join ' ') --no-fund --no-audit"
            if ($c -eq 0) { $any = $true; Good "npm: $($npm -join ', ')" } else { $bad = $true; Warn 'npm install failed' }
        } else { Warn 'npm not on PATH yet - re-run this item in a new shell'; $bad = $true }
    }

    $steps = @()
    if ($spec.pre)   { $steps += $spec.pre }
    if ($spec.steps) { $steps += $spec.steps }
    if ($item.steps) { $steps += $item.steps }
    if ($spec.post)  { $steps += $spec.post }

    foreach ($s in $steps) {
        switch ($s.type) {
            'shell' {
                $cmd = if ($s.winCmd) { $s.winCmd } else { $s.cmd }
                if ($cmd) {
                    $c = Invoke-Step $cmd
                    if ($c -eq 0) { $any = $true } elseif (-not $s.allowFail) { $bad = $true }
                }
            }
            'vscodeExt' {
                foreach ($ext in @($s.ids)) { Invoke-Step "code --install-extension $ext --force" | Out-Null }
                $any = $true
            }
            'gitClone' {
                $root = if ($env:PROGRAMERLY_DEV_ROOT) { $env:PROGRAMERLY_DEV_ROOT } else { Join-Path $HOME 'Development' }
                New-Item -ItemType Directory -Force -Path $root | Out-Null
                $dest = Join-Path $root $s.dest
                if (Test-Path (Join-Path $dest '.git')) { Invoke-Step "git -C `"$dest`" pull --ff-only" | Out-Null }
                else { Invoke-Step "git clone --depth 1 `"$($s.repo)`" `"$dest`"" | Out-Null }
                $any = $true
            }
            'workspace' {
                $root = if ($env:PROGRAMERLY_DEV_ROOT) { $env:PROGRAMERLY_DEV_ROOT } else { Join-Path $HOME 'Development' }
                foreach ($d in 'Projects','Clients','POC','Scripts','Assets','Hardware','Docs','Archive','Sandbox','.mcp') {
                    New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null
                }
                Good "workspace ready at $root"
                $any = $true
            }
            'mcpConfig' {
                & (Join-Path $PSScriptRoot 'write-mcp-config.ps1') -WhatIf:$WhatIf
                $any = $true
            }
            'venv' {
                $root = if ($env:PROGRAMERLY_DEV_ROOT) { $env:PROGRAMERLY_DEV_ROOT } else { Join-Path $HOME 'Development' }
                $venv = Join-Path $root '.venvs\ionity'
                if (Test-Path (Join-Path $venv 'Scripts\python.exe')) {
                    Good "virtual environment already at $venv"
                } else {
                    New-Item -ItemType Directory -Force -Path (Split-Path $venv) | Out-Null
                    $made = $false
                    foreach ($base in 'py -3 -m venv', 'python -m venv', 'python3 -m venv') {
                        if ((Invoke-Step "$base `"$venv`"") -eq 0) { $made = $true; break }
                    }
                    if ($made) { Good "virtual environment ready at $venv" } else { Warn 'could not create the virtual environment'; $bad = $true }
                }
                $any = $true
            }
            'venvPip' {
                $root = if ($env:PROGRAMERLY_DEV_ROOT) { $env:PROGRAMERLY_DEV_ROOT } else { Join-Path $HOME 'Development' }
                $py = Join-Path $root '.venvs\ionity\Scripts\python.exe'
                $pipArgs = if ($s.args) { "$($s.args) " } else { '' }
                $c = Invoke-Step "& `"$py`" -m pip install --upgrade $pipArgs$($s.packages -join ' ')"
                if ($c -eq 0) { $any = $true } elseif (-not $s.allowFail) { $bad = $true }
            }
            'chromeExt' {
                $key = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist'
                $i = 1
                $written = $true
                foreach ($e in @($s.ids)) {
                    $c = Invoke-Step ("if(-not (Test-Path -LiteralPath '$key')){ New-Item -Path '$key' -Force | Out-Null }; " +
                        "New-ItemProperty -LiteralPath '$key' -Name '$i' -PropertyType String " +
                        "-Value '$($e.id);https://clients2.google.com/service/update2/crx' -Force | Out-Null")
                    if ($c -ne 0) { $written = $false }
                    $i++
                }
                if ($written) { Good 'Chrome extensions queued by policy - they install on the next Chrome start' }
                else {
                    Warn 'Chrome policy needs Administrator - opening the Web Store pages instead'
                    foreach ($e in @($s.ids)) { Invoke-Step "Start-Process '$($e.url)'" | Out-Null }
                }
                $any = $true
            }
            'scaffold' {
                Warn "scaffold `"$($s.kind)`" is written by the desktop app - skipped in the script"
            }
            default { Warn "unknown step type: $($s.type)" }
        }
    }

    if     (-not $any -and -not $bad) { $stats.skipped++; Say '     nothing to do here' 'DarkGray' }
    elseif ($any -and $bad)           { if ($item.allowPartial -or $spec.allowPartial) { $stats.ok++ } else { $stats.partial++ } }
    elseif ($any)                     { $stats.ok++ }
    else                              { $stats.failed++; Bad $item.name }
}

Write-Host ''
Write-Host '  ------------------------------------------------------------' -ForegroundColor Cyan
Write-Host ("   ok {0}   partial {1}   failed {2}   skipped {3}" -f $stats.ok,$stats.partial,$stats.failed,$stats.skipped) -ForegroundColor White
Write-Host '  ------------------------------------------------------------' -ForegroundColor Cyan
Say 'Open a NEW terminal so the updated PATH takes effect.' 'Yellow'
if ($queue.id -contains 'wsl') { Say 'WSL was installed - restart Windows to finish.' 'Yellow' }
Write-Host ''
Say '(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - Policy 986 AED' 'DarkGray'
Say 'Anything is Possible with God.' 'DarkGray'
Write-Host ''
