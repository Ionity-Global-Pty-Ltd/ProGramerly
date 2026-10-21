'use strict';
/**
 * ProGramerly - persisted settings
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * One JSON file in userData. Every setting has a default here, so a missing or
 * corrupt file never stops the app - it just falls back and rewrites itself.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = Object.freeze({
  /* ---------------------------------------------------------- app update */
  updateChannel: 'stable',          // stable | prerelease
  updateSource: 'github',           // GitHub Releases only - never a store
  updateRepo: 'Ionity-Global-Pty-Ltd/ProGramerly',
  checkAppUpdates: true,            // look for a new ProGramerly build
  autoDownloadAppUpdate: false,     // you always CHOOSE to install the app itself
  notifyAppUpdate: true,

  /* ------------------------------------------------------- codebase sync */
  keepInSync: true,                 // DEFAULT ON - the whole installed code base
  syncTimes: ['08:00', '20:00'],    // local clock, twice a day
  syncOnLaunch: false,
  autoInstallUpdates: true,         // DEFAULT ON - untick and everything stays put
  syncScope: {
    packages: true,                 // winget / choco / brew
    npmGlobals: true,
    pythonTools: true,              // pipx / uv tools
    vscodeExtensions: true,
    gitRepos: true,                 // cloned repos under the dev root
    ollamaModels: true,
    links: true,                    // catalog + brand links reachability scan
  },

  /* ---------------------------------------------------------- elevation */
  // ONE UAC consent at launch. Every winget/Chocolatey installer afterwards
  // inherits that administrator token and never raises its own dialog, which
  // is the whole difference between "press go and walk away" and clicking
  // Yes a hundred times. Untick it and the app runs as a standard user.
  autoElevate: true,

  /* ------------------------------------------------------------ tray/UI */
  minimizeToTray: true,
  closeToTray: true,
  startMinimised: false,
  kioskMode: false,                 // opt-in full-screen operator shell; Ctrl+Shift+K exits
  aiDefaultModel: 'llama3.2:1b',    // small local Ollama model the Command Center sets up and prefers (~1.3 GB, runs on CPU)
  aiAutoBrief: false,               // on launch, have the assistant read the machine and report once (opt-in since 3.9.0)
  /* AI providers - BOTH OFF until the user turns one on (3.9.0). */
  aiLocalEnabled: false,            // Ollama / LM Studio on this machine; nothing leaves it
  aiClaudeEnabled: false,           // Anthropic API with the user's own key (stored encrypted, never here)
  aiClaudeModel: '',                // '' = the default; filled from the key's /v1/models list
  aiProvider: 'auto',               // auto | local | claude - who answers first when both are on
  aiBriefPreset: 'state-of-machine',// which standing question the launch brief asks
  aiAskEverywhere: true,            // an Ask button in every workspace window
  domeInterval: 45,                 // seconds between dome re-reads while the deck is showing
  accent: 'cyan',                   // cyan | violet | lime | amber | blue - the shell's colour
  watermark: true,                  // the Ionity mark, bottom left
  launchAtLogin: false,
  profile: {},                     // name/email/role/org + preferred install profile
  nodeBackdrop: true,              // the gradient node field behind the app
  showIntro: true,
  introSound: true,
  metricsInterval: 2,               // seconds
  tempUnit: 'C',

  /* -------------------------------------------------------------- network */
  netAutoProbe: false,              // run the global sweep on opening Network
  probeSeconds: 5,                  // per region, as specified
  speedTestBytes: 25 * 1024 * 1024,

  /* ---------------------------------------------------------- maintenance */
  registryAllowFlaggedRemovals: false, // removals only when Microsoft flags them
  registryAutoOnSync: false,

  /* ------------------------------------------------------------ workspace */
  devRoot: '',                      // '' = default (home/Development)
  lastSyncAt: 0,
  lastAppCheckAt: 0,
  installedIds: [],                 // what ProGramerly has installed on this box

  /* ---------------------------------------------- push & release (dev only) */
  publish: {
    repoOwner: 'Ionity-Global-Pty-Ltd',
    repoName: 'ProGramerly',
    remoteUrl: 'https://github.com/Ionity-Global-Pty-Ltd/ProGramerly.git',
    authorName: 'Johan Wilhelm van Antwerp',
    authorEmail: 'ai@ionity.today',
    hasToken: false,               // the token itself lives encrypted, never here
  },
});

let cache = null;
let filePath = null;

function file() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'settings.json');
  return filePath;
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * One dev root for the whole app. The installer, MCP writer, terminals and
 * "Open dev root" all read PROGRAMERLY_DEV_ROOT through mcp-config.devRoot(),
 * so the setting is mirrored there whenever it is loaded or changed.
 */
function applyDevRoot(c) {
  const v = c && typeof c.devRoot === 'string' ? c.devRoot.trim() : '';
  if (v) process.env.PROGRAMERLY_DEV_ROOT = v;
  else if (process.env.PROGRAMERLY_DEV_ROOT_FROM_SETTINGS) delete process.env.PROGRAMERLY_DEV_ROOT;
  if (v) process.env.PROGRAMERLY_DEV_ROOT_FROM_SETTINGS = '1';
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load() {
  if (cache) return cache;
  try {
    cache = deepMerge(DEFAULTS, readJson(file()));
  } catch {
    // A torn write must not silently reset installedIds, publish config and
    // sync times: fall back to the last good copy before using defaults.
    try { cache = deepMerge(DEFAULTS, readJson(`${file()}.bak`)); } catch { cache = deepMerge(DEFAULTS, {}); }
  }
  applyDevRoot(cache);
  return cache;
}

function save(patch) {
  cache = deepMerge(load(), patch || {});
  applyDevRoot(cache);
  try {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    try { if (fs.existsSync(f)) fs.copyFileSync(f, `${f}.bak`); } catch { /* best effort */ }
    fs.renameSync(tmp, f);
  } catch { /* read-only profile - keep the in-memory copy */ }
  return cache;
}

function get(key) {
  return key ? load()[key] : load();
}

function reset() {
  cache = deepMerge(DEFAULTS, {});
  save({});
  return cache;
}

module.exports = { get, save, load, reset, DEFAULTS, file };
