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

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    cache = deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    cache = deepMerge(DEFAULTS, {});
  }
  return cache;
}

function save(patch) {
  cache = deepMerge(load(), patch || {});
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
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
