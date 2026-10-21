'use strict';
/**
 * ProGramerly - Claude Desktop MCP configuration writer
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Merges ProGramerly's MCP servers into claude_desktop_config.json without
 * destroying anything the user already configured. A timestamped .bak is
 * written before every change.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const IS_WIN = process.platform === 'win32';

/**
 * Where each MCP client keeps its server list. Every one of them uses the
 * same `mcpServers: { name: { command, args } }` shape, so one merge routine
 * serves them all.
 *
 *   claude       Claude Desktop            claude_desktop_config.json
 *   claude-code  Claude Code, user scope   ~/.claude.json
 *   kiro         Kiro IDE, user level      ~/.kiro/settings/mcp.json
 *   cursor       Cursor, global            ~/.cursor/mcp.json
 *   windsurf     Windsurf (Cascade)        ~/.codeium/windsurf/mcp_config.json
 */
const TARGETS = {
  claude: {
    label: 'Claude Desktop',
    path: () => (IS_WIN
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      : (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude', 'claude_desktop_config.json'))),
  },
  'claude-code': { label: 'Claude Code (user scope)', path: () => path.join(os.homedir(), '.claude.json') },
  kiro: { label: 'Kiro', path: () => path.join(os.homedir(), '.kiro', 'settings', 'mcp.json') },
  cursor: { label: 'Cursor', path: () => path.join(os.homedir(), '.cursor', 'mcp.json') },
  windsurf: { label: 'Windsurf', path: () => path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json') },
};

function configPath(target = 'claude') {
  return (TARGETS[target] || TARGETS.claude).path();
}

/** Where we let filesystem MCP roam. Dev root only - not the whole disk. */
function devRoot() {
  return process.env.PROGRAMERLY_DEV_ROOT || path.join(os.homedir(), 'Development');
}

/** The machine's own IANA zone, so the time server is right outside SA too. */
function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function serverDefs() {
  const root = devRoot();
  // Windows: MCP clients spawn without a shell, and Node refuses to spawn a
  // .cmd file that way (EINVAL since the 2024 CVE fix), so `npx.cmd` servers
  // never start. Going through cmd /c is the form every client accepts.
  const npxDef = (args) => (IS_WIN ? { command: 'cmd', args: ['/c', 'npx', ...args] } : { command: 'npx', args });
  const uvx = IS_WIN ? 'uvx.exe' : 'uvx';

  return {
    filesystem: npxDef(['-y', '@modelcontextprotocol/server-filesystem', root]),
    memory: npxDef(['-y', '@modelcontextprotocol/server-memory']),
    'sequential-thinking': npxDef(['-y', '@modelcontextprotocol/server-sequential-thinking']),
    playwright: npxDef(['-y', '@playwright/mcp@latest']),
    context7: npxDef(['-y', '@upstash/context7-mcp']),
    git: {
      command: uvx,
      args: ['--from', 'mcp-server-git', 'mcp-server-git', '--repository', root],
    },
    fetch: {
      command: uvx,
      args: ['mcp-server-fetch'],
    },
    time: {
      command: uvx,
      args: ['mcp-server-time', '--local-timezone', localZone()],
    },
    // Firebase's own MCP server, served by firebase-tools. It talks to
    // whatever project the user has selected with `firebase use`; nothing is
    // signed in or selected by ProGramerly.
    firebase: npxDef(['-y', 'firebase-tools@latest', 'experimental:mcp']),
    // Terminal + file access for Claude Desktop, scoped to the dev root.
    'desktop-commander': npxDef(['-y', '@wonderwhy-er/desktop-commander@latest']),
  };
}

/**
 * @param {(msg:string)=>void} log
 * @returns {{ok:boolean, path:string, added:string[], kept:string[], backup?:string, error?:string}}
 */
function writeConfig(log = () => {}, which = 'claude') {
  const t = TARGETS[which] || TARGETS.claude;
  const target = t.path();
  const added = [];
  const kept = [];
  log(`${t.label}: ${target}`);

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(devRoot(), { recursive: true });

    let existing = {};
    let raw = null;
    if (fs.existsSync(target)) {
      raw = fs.readFileSync(target, 'utf8');
      try {
        existing = raw.trim() ? JSON.parse(raw) : {};
      } catch (err) {
        // Never replace a file we cannot read: ~/.claude.json carries all of
        // Claude Code's state. Report and leave it exactly as it is.
        return { ok: false, path: target, added, kept, error: `existing file is not valid JSON (${err.message}) - left untouched` };
      }
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        return { ok: false, path: target, added, kept, error: 'existing file is not a JSON object - left untouched' };
      }
    }

    const servers = { ...(existing.mcpServers || {}) };
    for (const [name, def] of Object.entries(serverDefs())) {
      if (servers[name]) {
        kept.push(name);
        continue;
      }
      servers[name] = def;
      added.push(name);
    }

    let backup;
    if (!added.length) {
      log(`nothing to add - all ${kept.length} servers already configured`);
      return { ok: true, path: target, added, kept };
    }
    if (raw !== null) {
      backup = `${target}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      fs.writeFileSync(backup, raw, 'utf8');
      log(`backed up existing config -> ${path.basename(backup)}`);
    }

    // Write beside the target, then rename: a crash mid-write can never
    // leave a half-written config behind.
    const next = { ...existing, mcpServers: servers };
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);

    log(`wrote ${target}`);
    if (added.length) log(`added: ${added.join(', ')}`);
    if (kept.length) log(`left untouched (already configured): ${kept.join(', ')}`);

    return { ok: true, path: target, added, kept, backup };
  } catch (err) {
    return { ok: false, path: target, added, kept, error: err.message };
  }
}

module.exports = { writeConfig, configPath, devRoot, serverDefs, TARGETS };
