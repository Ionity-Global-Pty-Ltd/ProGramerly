<#
    ProGramerly - write an MCP server config (Windows)
    Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
    Merges ProGramerly's MCP servers in without clobbering existing entries.

    -Target claude       Claude Desktop   %APPDATA%\Claude\claude_desktop_config.json   (default)
    -Target claude-code  Claude Code      ~\.claude.json (user scope)
    -Target kiro         Kiro IDE         ~\.kiro\settings\mcp.json
    -Target cursor       Cursor           ~\.cursor\mcp.json
    -Target windsurf     Windsurf         ~\.codeium\windsurf\mcp_config.json
#>
[CmdletBinding()]
param(
    [ValidateSet('claude','claude-code','kiro','cursor','windsurf')]
    [string]$Target = 'claude',
    [switch]$WhatIf
)

$root = if ($env:PROGRAMERLY_DEV_ROOT) { $env:PROGRAMERLY_DEV_ROOT } else { Join-Path $HOME 'Development' }
$cfg = switch ($Target) {
    'claude'      { Join-Path (Join-Path $env:APPDATA 'Claude') 'claude_desktop_config.json' }
    'claude-code' { Join-Path $HOME '.claude.json' }
    'kiro'        { Join-Path $HOME '.kiro\settings\mcp.json' }
    'cursor'      { Join-Path $HOME '.cursor\mcp.json' }
    'windsurf'    { Join-Path $HOME '.codeium\windsurf\mcp_config.json' }
}
$cfgDir = Split-Path $cfg
Write-Host "     $Target -> $cfg" -ForegroundColor DarkGray

# Claude Desktop and the IDEs spawn without a shell; Node refuses .cmd files
# that way, so npx runs through cmd /c. The time server gets this PC's zone.
$tz = try { $z = (& node -e "process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone)" 2>$null); if ($z) { $z } else { 'UTC' } } catch { 'UTC' }
$servers = [ordered]@{
    filesystem            = @{ command = 'cmd'; args = @('/c','npx','-y','@modelcontextprotocol/server-filesystem', $root) }
    memory                = @{ command = 'cmd'; args = @('/c','npx','-y','@modelcontextprotocol/server-memory') }
    'sequential-thinking' = @{ command = 'cmd'; args = @('/c','npx','-y','@modelcontextprotocol/server-sequential-thinking') }
    playwright            = @{ command = 'cmd'; args = @('/c','npx','-y','@playwright/mcp@latest') }
    context7              = @{ command = 'cmd'; args = @('/c','npx','-y','@upstash/context7-mcp') }
    git                   = @{ command = 'uvx.exe'; args = @('--from','mcp-server-git','mcp-server-git','--repository', $root) }
    fetch                 = @{ command = 'uvx.exe'; args = @('mcp-server-fetch') }
    time                  = @{ command = 'uvx.exe'; args = @('mcp-server-time','--local-timezone',$tz) }
    firebase              = @{ command = 'cmd'; args = @('/c','npx','-y','firebase-tools@latest','experimental:mcp') }
    'desktop-commander'   = @{ command = 'cmd'; args = @('/c','npx','-y','@wonderwhy-er/desktop-commander@latest') }
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
