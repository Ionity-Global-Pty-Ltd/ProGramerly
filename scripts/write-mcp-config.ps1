<#
    ProGramerly - write claude_desktop_config.json (Windows)
    Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
    Merges ProGramerly's MCP servers in without clobbering existing entries.
#>
[CmdletBinding()]
param([switch]$WhatIf)

$root = if ($env:PROGRAMERLY_DEV_ROOT) { $env:PROGRAMERLY_DEV_ROOT } else { Join-Path $HOME 'Development' }
$cfgDir = Join-Path $env:APPDATA 'Claude'
$cfg = Join-Path $cfgDir 'claude_desktop_config.json'

$servers = [ordered]@{
    filesystem            = @{ command = 'npx.cmd'; args = @('-y','@modelcontextprotocol/server-filesystem', $root) }
    memory                = @{ command = 'npx.cmd'; args = @('-y','@modelcontextprotocol/server-memory') }
    'sequential-thinking' = @{ command = 'npx.cmd'; args = @('-y','@modelcontextprotocol/server-sequential-thinking') }
    playwright            = @{ command = 'npx.cmd'; args = @('-y','@playwright/mcp@latest') }
    context7              = @{ command = 'npx.cmd'; args = @('-y','@upstash/context7-mcp') }
    git                   = @{ command = 'uvx.exe'; args = @('--from','mcp-server-git','mcp-server-git','--repository', $root) }
    fetch                 = @{ command = 'uvx.exe'; args = @('mcp-server-fetch') }
    time                  = @{ command = 'uvx.exe'; args = @('mcp-server-time','--local-timezone','Africa/Johannesburg') }
}

if ($WhatIf) {
    Write-Host "  WHATIF> would write $cfg with $($servers.Count) MCP servers" -ForegroundColor DarkGray
    return
}

New-Item -ItemType Directory -Force -Path $cfgDir, $root | Out-Null

$existing = @{}
if (Test-Path $cfg) {
    $bak = "$cfg.$((Get-Date).ToString('yyyyMMdd-HHmmss')).bak"
    Copy-Item $cfg $bak
    Write-Host "     backed up -> $(Split-Path -Leaf $bak)" -ForegroundColor DarkGray
    try { $existing = Get-Content -Raw $cfg | ConvertFrom-Json -AsHashtable } catch { $existing = @{} }
}

if (-not $existing.mcpServers) { $existing.mcpServers = @{} }
$added = @()
foreach ($k in $servers.Keys) {
    if ($existing.mcpServers.ContainsKey($k)) { continue }
    $existing.mcpServers[$k] = $servers[$k]
    $added += $k
}

$existing | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $cfg -Encoding UTF8
Write-Host "     wrote $cfg" -ForegroundColor Green
if ($added.Count) { Write-Host "     added: $($added -join ', ')" -ForegroundColor Green }
