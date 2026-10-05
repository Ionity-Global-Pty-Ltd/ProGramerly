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

function serverDefs() {
  const npx = IS_WIN ? 'npx.cmd' : 'npx';
  const uvx = IS_WIN ? 'uvx.exe' : 'uvx';
  const root = devRoot();

  return {
    filesystem: {
      command: npx,
      args: ['-y', '@modelcontextprotocol/server-filesystem', root],
    },
    memory: {
      command: npx,
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    'sequential-thinking': {
      command: npx,
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
    playwright: {
      command: npx,
      args: ['-y', '@playwright/mcp@latest'],
    },
    context7: {
      command: npx,
      args: ['-y', '@upstash/context7-mcp'],
    },
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
      args: ['mcp-server-time', '--local-timezone', 'Africa/Johannesburg'],
    },
    // Firebase's own MCP server, served by firebase-tools. It talks to
    // whatever project the user has selected with `firebase use`; nothing is
    // signed in or selected by ProGramerly.
    firebase: {
      command: npx,
      args: ['-y', 'firebase-tools@latest', 'experimental:mcp'],
    },
    // Terminal + file access for Claude Desktop, scoped to the dev root.
    'desktop-commander': {
      command: npx,
      args: ['-y', '@wonderwhy-er/desktop-commander@latest'],
    },
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
    let backup;
    if (fs.existsSync(target)) {
      const raw = fs.readFileSync(target, 'utf8');
      backup = `${target}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      fs.writeFileSync(backup, raw, 'utf8');
      log(`backed up existing config -> ${path.basename(backup)}`);
      try {
        existing = JSON.parse(raw);
      } catch {
        log('existing config was not valid JSON; starting from a clean object (backup kept)');
        existing = {};
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

    const next = { ...existing, mcpServers: servers };
    fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

    log(`wrote ${target}`);
    if (added.length) log(`added: ${added.join(', ')}`);
    if (kept.length) log(`left untouched (already configured): ${kept.join(', ')}`);

    return { ok: true, path: target, added, kept, backup };
  } catch (err) {
    return { ok: false, path: target, added, kept, error: err.message };
  }
}

module.exports = { writeConfig, configPath, devRoot, serverDefs, TARGETS };
