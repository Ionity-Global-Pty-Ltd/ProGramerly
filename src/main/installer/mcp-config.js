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

function configPath() {
  if (IS_WIN) {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
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
  };
}

/**
 * @param {(msg:string)=>void} log
 * @returns {{ok:boolean, path:string, added:string[], kept:string[], backup?:string, error?:string}}
 */
function writeConfig(log = () => {}) {
  const target = configPath();
  const added = [];
  const kept = [];

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

module.exports = { writeConfig, configPath, devRoot, serverDefs };
