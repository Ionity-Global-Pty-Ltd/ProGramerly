'use strict';
/**
 * ProGramerly - Basic Coding Software for All
 * Electron main process
 *
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI
 * Author: Johan Wilhelm van Antwerp
 * Governance: Policy 986 AED  |  (c) 2018-2026  All rights reserved  TM2
 * https://www.ionity.today
 */

const {
  app, BrowserWindow, ipcMain, shell, dialog, Menu, Notification, powerMonitor,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const engine = require('./installer/engine');
const { run } = require('./installer/runner');
const { devRoot } = require('./installer/mcp-config');

const settings = require('./services/settings');
const metrics = require('./services/metrics');
const netprobe = require('./services/netprobe');
const updater = require('./services/updater');
const sync = require('./services/sync');
const registry = require('./services/registry');
const shortcut = require('./services/shortcut');
const publish = require('./services/publish');
const doctor = require('./services/doctor');
const ai = require('./services/ai');
const terminals = require('./services/terminals');
const hardware = require('./services/hardware');
const openrgb = require('./services/openrgb');
const projects = require('./services/projects');
const secrets = require('./services/secrets');
const tray = require('./tray');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const CATALOG_PATH = path.join(__dirname, 'catalog', 'catalog.json');
const LINKS_PATH = path.join(__dirname, 'data', 'links.json');

const START_MINIMISED = process.argv.includes('--minimised') || process.argv.includes('--hidden');

// Set on the copy of ourselves that we start with an administrator token, so
// that copy never tries to elevate again - a failed IsInRole check would
// otherwise spawn UAC prompts forever.
const ELEVATED_FLAG = '--elevated';
const RELAUNCHED_ELEVATED = process.argv.includes(ELEVATED_FLAG);

let win = null;
let intro = null;
let cancelRequested = false;
let running = false;
let logStream = null;
let logFile = null;
let sudoKeepAlive = null;
let quitting = false;
let pendingUpdate = null;
let metricsUnsub = null;
let introFinished = false;
let booting = true;

/* ---------------------------------------------------------------- logging -- */
function openLog() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, `programerly-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  logStream = fs.createWriteStream(logFile, { flags: 'a' });
  logStream.write([
    '========================================================================',
    ' ProGramerly - Basic Coding Software for All',
    ` Started ${new Date().toISOString()}`,
    ` Platform ${process.platform} ${process.arch} | Node ${process.versions.node}`,
    ' (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - Policy 986 AED',
    '========================================================================',
    '',
  ].join('\n'));

  // Trim to the newest 40 logs so this folder never becomes a problem.
  try {
    const old = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).sort().reverse();
    old.slice(40).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* locked */ } });
  } catch { /* first run */ }
}

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function logLine(text, level = 'info') {
  if (logStream) logStream.write(`${new Date().toISOString()} ${text}\n`);
  emit('install:log', { text, level, ts: Date.now() });
}

/* ------------------------------------------------------------- elevation -- */
async function isElevated() {
  if (IS_WIN) {
    const { code } = await run(
      '$id=[Security.Principal.WindowsIdentity]::GetCurrent();'
      + '$p=New-Object Security.Principal.WindowsPrincipal($id);'
      + 'if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }',
      { timeoutMs: 15000 },
    );
    return code === 0;
  }
  return true; // macOS never runs the GUI as root; we prime sudo instead.
}

/**
 * Relaunch ProGramerly holding an administrator token.
 *
 * One consent dialog for the entire session: every winget and Chocolatey
 * installer started afterwards inherits the elevated token and installs
 * silently instead of raising its own UAC prompt per package.
 *
 * Three things here are load bearing, and all three were wrong before:
 *
 *  - the single-instance lock is released BEFORE the new process starts.
 *    Without that the elevated copy loses the race, quits during startup,
 *    and the user has consented to a UAC prompt for nothing.
 *  - Start-Process is awaited and its failure honoured, so a declined UAC
 *    leaves this app running normally instead of quitting into thin air.
 *  - the original argv is forwarded (plus ELEVATED_FLAG) so the elevated
 *    copy starts exactly the way this one did, and can never loop.
 */
async function relaunchElevated() {
  if (!IS_WIN) return { ok: false, error: 'Windows only' };
  if (RELAUNCHED_ELEVATED) return { ok: false, error: 'already relaunched once this session' };

  const psq = (v) => `'${String(v).replace(/'/g, "''")}'`;   // single-quote for PowerShell
  const passthrough = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => a !== ELEVATED_FLAG);
  const argv = app.isPackaged
    ? [...passthrough, ELEVATED_FLAG]
    : [path.join(__dirname, '..', '..'), ...passthrough, ELEVATED_FLAG];

  const cmd = `try { Start-Process -FilePath ${psq(process.execPath)} `
    + `-ArgumentList @(${argv.map(psq).join(',')}) -Verb RunAs -ErrorAction Stop; exit 0 } `
    + 'catch { exit 1 }';

  try { app.releaseSingleInstanceLock(); } catch { /* older Electron: best effort */ }

  const { code } = await run(cmd, { timeoutMs: 180000 });
  if (code !== 0) {
    try { app.requestSingleInstanceLock(); } catch { /* best effort */ }
    return { ok: false, error: 'administrator access was declined' };
  }

  quitting = true;
  setTimeout(() => app.exit(0), 400);
  return { ok: true };
}

/**
 * Make sure this process holds an administrator token before any installer
 * runs. Returns true when we are elevated, false when the user said no and
 * we are carrying on as a standard user.
 */
async function ensureElevated() {
  if (!IS_WIN) return true;
  if (await isElevated()) return true;
  if (RELAUNCHED_ELEVATED) return false;
  const res = await relaunchElevated();
  return res.ok;   // ok === true means this process is already on its way out
}

/** macOS: cache sudo credentials once so cask installers do not stall. */
async function primeSudo() {
  if (!IS_MAC) return true;
  const script = 'do shell script "echo primed" with administrator privileges '
    + 'with prompt "ProGramerly needs administrator access to install applications."';
  const { code } = await run(`osascript -e '${script}'`, { timeoutMs: 120000 });
  if (code !== 0) return false;
  sudoKeepAlive = setInterval(() => { run('sudo -n -v', { timeoutMs: 10000 }); }, 60000);
  return true;
}

function stopSudoKeepAlive() {
  if (sudoKeepAlive) { clearInterval(sudoKeepAlive); sudoKeepAlive = null; }
}

/* ----------------------------------------------------------------- intro -- */
function showIntro() {
  return new Promise((resolve) => {
    if (!settings.get('showIntro') || START_MINIMISED) { resolve(); return; }

    intro = new BrowserWindow({
      width: 900,
      height: 560,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      center: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    intro.loadFile(path.join(__dirname, '..', 'renderer', 'intro.html'));
    intro.once('ready-to-show', () => intro.show());

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (intro && !intro.isDestroyed()) intro.destroy();
      intro = null;
      resolve();
    };
    ipcMain.once('intro:done', finish);
    // Hard ceiling: the app must never be held hostage by an animation.
    setTimeout(finish, 12000);
    // If the intro window itself fails to load, do not strand the app.
    intro.webContents.on('did-fail-load', finish);
  });
}

/* ---------------------------------------------------------------- window -- */
function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#070d16',
    title: 'ProGramerly - Basic Coding Software for All',
    icon: path.join(__dirname, '..', '..', 'build', IS_WIN ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', revealWindow);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('minimize', (e) => {
    if (settings.get('minimizeToTray') && tray.exists()) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('close', (e) => {
    if (running) {
      e.preventDefault();
      dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Keep installing', 'Stop and quit'],
        defaultId: 0,
        cancelId: 0,
        message: 'An installation is still running.',
        detail: 'Quitting now leaves packages half-installed. Stop anyway?',
      }).then(({ response }) => {
        if (response === 1) { cancelRequested = true; running = false; quitting = true; win.destroy(); }
      });
      return;
    }
    if (!quitting && settings.get('closeToTray') && tray.exists()) {
      e.preventDefault();
      win.hide();
      tray.notify('ProGramerly is still running',
        'It keeps your code base in sync in the background. Right-click the tray icon to quit.');
    }
  });
}

/**
 * The window is built before the intro plays, so the renderer is warm by the
 * time the logo lands - but it only becomes visible once the intro is over.
 */
function revealWindow() {
  if (!introFinished) return;
  if (START_MINIMISED || settings.get('startMinimised')) return;
  if (win && !win.isDestroyed() && !win.isVisible()) win.show();
}

function showWindow(tab) {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (tab) emit('ui:tab', tab);
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) win.hide();
  else showWindow();
}

/* -------------------------------------------------------------- services -- */
function serviceEmit(channel, payload) {
  emit(channel, payload);
  if (channel === 'sync:log' && logStream) {
    logStream.write(`${new Date().toISOString()} [sync] ${payload.text}\n`);
  }
}

function notifyUpdate(info) {
  pendingUpdate = info;
  emit('update:available', info);
  tray.notify('ProGramerly update available', `Version ${info.latest} is ready. Open ProGramerly to install it.`);
  if (settings.get('notifyAppUpdate') && Notification.isSupported()) {
    const n = new Notification({
      title: `ProGramerly ${info.latest} is available`,
      body: 'You choose when to install it. Click to see what changed.',
      silent: false,
    });
    n.on('click', () => showWindow('updates'));
    n.show();
  }
}

function startServices() {
  metrics.start(settings.get('metricsInterval'));
  metricsUnsub = metrics.subscribe((snap) => {
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.webContents.send('metrics:tick', { metrics: snap, ping: netprobe.lastPingRef() });
    }
  });

  sync.init(serviceEmit);

  try {
    tray.create({
      show: (tab) => showWindow(tab),
      toggle: toggleWindow,
      quit: () => { quitting = true; app.quit(); },
      openLog: () => { if (logFile) shell.showItemInFolder(logFile); },
      syncNow: async () => { showWindow('updates'); await sync.runSync({ trigger: 'tray' }); },
      checkUpdate: async () => {
        const info = await updater.check();
        if (info.available) notifyUpdate(info);
        else tray.notify('ProGramerly', `You are on the newest build (${info.current}).`);
        showWindow('updates');
        emit('update:checked', info);
      },
      speedTest: () => { showWindow('network'); emit('ui:action', 'speedtest'); },
      setSync: (on) => { settings.save({ keepInSync: on }); sync.schedule(); tray.refreshMenu(); emit('settings:changed', settings.get()); },
      setAutoInstall: (on) => { settings.save({ autoInstallUpdates: on }); tray.refreshMenu(); emit('settings:changed', settings.get()); },
    });
  } catch (err) {
    // A desktop with no system tray (some Linux sessions, a locked-down VDI).
    // Everything else still runs; the window simply closes for real.
    logLine(`tray unavailable: ${err.message}`, 'warn');
  }

  // First app-update check, a little after launch so it never delays the UI.
  if (settings.get('checkAppUpdates')) {
    setTimeout(async () => {
      const info = await updater.check();
      emit('update:checked', info);
      if (info.available) notifyUpdate(info);
      updater.prune();
    }, 12000);
  }

  // Re-arm the schedule after the machine wakes: a laptop that slept through
  // 08:00 should sync when it comes back, not silently miss the day.
  try {
    powerMonitor.on('resume', () => sync.schedule());
  } catch { /* not supported everywhere */ }
}

/* -------------------------------------------------------------------- IPC -- */
ipcMain.handle('catalog:get', async () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return {
    catalog,
    platform: engine.PLATFORM,
    osLabel: `${os.type()} ${os.release()} (${os.arch()})`,
    elevated: await isElevated(),
    devRoot: devRoot(),
    appVersion: app.getVersion(),
    logFile,
    settings: settings.get(),
    sync: sync.status(),
    update: pendingUpdate,
    fixtures: process.env.PROGRAMERLY_UI_FIXTURES === '1',
  };
});

ipcMain.handle('app:elevate', () => relaunchElevated());
ipcMain.handle('app:isElevated', () => isElevated());

ipcMain.handle('app:openLog', () => {
  if (logFile) shell.showItemInFolder(logFile);
  return logFile;
});

ipcMain.handle('app:openExternal', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('app:openDevRoot', () => {
  const root = devRoot();
  fs.mkdirSync(root, { recursive: true });
  shell.openPath(root);
  return root;
});

ipcMain.handle('app:openPath', (_e, p) => {
  if (typeof p === 'string' && p) shell.openPath(p);
  return p;
});

ipcMain.handle('app:minimiseToTray', () => {
  if (win && !win.isDestroyed()) win.hide();
  return true;
});

ipcMain.handle('app:quit', () => { quitting = true; app.quit(); return true; });

/* --- settings ----------------------------------------------------------- */
ipcMain.handle('settings:get', () => settings.get());

ipcMain.handle('settings:set', (_e, patch) => {
  const before = settings.get();
  const next = settings.save(patch || {});

  if (patch && (patch.keepInSync !== undefined || patch.syncTimes !== undefined)) sync.schedule();
  if (patch && patch.metricsInterval !== undefined && patch.metricsInterval !== before.metricsInterval) {
    metrics.start(next.metricsInterval);
  }
  if (patch && patch.launchAtLogin !== undefined) {
    shortcut.setLaunchAtLogin(next.launchAtLogin, { minimised: true });
  }
  tray.refreshMenu();
  emit('settings:changed', next);
  return next;
});

ipcMain.handle('settings:reset', () => {
  const next = settings.reset();
  sync.schedule();
  metrics.start(next.metricsInterval);
  tray.refreshMenu();
  emit('settings:changed', next);
  return next;
});

/* --- intro -------------------------------------------------------------- */
ipcMain.handle('intro:config', () => ({ sound: Boolean(settings.get('introSound')) }));
ipcMain.on('intro:done', () => { /* resolved by the once() handler in showIntro */ });

/* --- metrics ------------------------------------------------------------ */
ipcMain.handle('metrics:snapshot', () => ({
  metrics: metrics.snapshot(),
  ping: netprobe.lastPingRef(),
}));

/* --- network ------------------------------------------------------------ */
ipcMain.handle('net:geo', () => netprobe.geo());

ipcMain.handle('net:sweep', async () => {
  const res = await netprobe.sweep((p) => emit('net:progress', p));
  return res;
});

ipcMain.handle('net:cancel', () => netprobe.cancel());

ipcMain.handle('net:speedtest', async () => {
  const res = await netprobe.speedTest((p) => emit('net:speed', p));
  emit('net:speedDone', res);
  return res;
});

ipcMain.handle('net:checkLinks', async () => sync.scanLinks());

ipcMain.handle('net:links', async () => {
  const data = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
  return data;
});

/* --- sync + update ------------------------------------------------------ */
ipcMain.handle('sync:status', () => sync.status());
ipcMain.handle('sync:run', async (_e, opts) => sync.runSync({ trigger: 'manual', ...(opts || {}) }));

ipcMain.handle('update:check', async () => {
  const info = await updater.check();
  if (info.available) notifyUpdate(info);
  emit('update:checked', info);
  return info;
});

ipcMain.handle('update:download', async () => {
  if (!pendingUpdate || !pendingUpdate.available) return { ok: false, error: 'nothing to download' };
  const res = await updater.fetchUpdate(pendingUpdate, (p) => emit('update:progress', p));
  emit('update:downloaded', res);
  return res;
});

ipcMain.handle('update:install', async (_e, file) => {
  const res = updater.applyUpdate(file);
  return res;
});

/* --- registry ----------------------------------------------------------- */
ipcMain.handle('registry:scan', () => registry.scan());

ipcMain.handle('registry:apply', async (_e, ids) => registry.apply(
  ids || [],
  { allowRemovals: Boolean(settings.get('registryAllowFlaggedRemovals')) },
  (t, l) => { logLine(t, l); emit('maint:log', { text: t, level: l, ts: Date.now() }); },
));

ipcMain.handle('registry:tool', async (_e, id) => registry.runTool(
  id,
  (t, l) => { logLine(t, l); emit('maint:log', { text: t, level: l, ts: Date.now() }); },
));

ipcMain.handle('registry:openEditor', (_e, key) => registry.openEditor(key));
ipcMain.handle('registry:openBackups', () => registry.openBackups());

/* --- push & release (developer/maintainer feature) ----------------------- */
function publishLog(t, l) {
  logLine(`[publish] ${t}`, l);
  emit('publish:log', { text: t, level: l, ts: Date.now() });
}

/* --- AI workspace -------------------------------------------------------- */
function aiLog(text, level) {
  if (logStream) logStream.write(`${new Date().toISOString()} [ai] ${text}\n`);
  emit('ai:log', { text, level, ts: Date.now() });
}

ipcMain.handle('ai:endpoints', () => ai.endpoints());
ipcMain.handle('ai:models', () => ai.ollamaModels());
ipcMain.handle('ai:loaded', () => ai.ollamaLoaded());
ipcMain.handle('ai:curated', () => ai.CURATED);
ipcMain.handle('ai:environments', () => ai.environments(devRoot()));
ipcMain.handle('ai:delete', async (_e, model) => {
  aiLog(`removing ${model}...`);
  const res = await ai.ollamaDelete(model);
  aiLog(res.ok ? `${model} removed.` : `could not remove ${model} (HTTP ${res.code || '?'})`, res.ok ? 'ok' : 'err');
  return res;
});
ipcMain.handle('ai:pull', async (_e, model) => {
  if (!model) return { ok: false, error: 'no model named' };
  aiLog(`ollama pull ${model}`, 'head');
  const res = await ai.ollamaPull(model, (p) => {
    if (p.error) { aiLog(`  ${p.error}`, 'err'); return; }
    emit('ai:pull', { model, ...p });
    if (p.text) aiLog(`  ${p.text}`);
  });
  aiLog(res.ok ? `${model} is on this machine.` : `pull failed: ${res.error || res.code}`, res.ok ? 'ok' : 'err');
  return res;
});

/* --- talking to models ----------------------------------------------------- */
let chatSeq = 0;

ipcMain.handle('ai:targets', () => ai.chatTargets());
ipcMain.handle('ai:gpu', () => ai.gpu());

ipcMain.handle('ai:chat', async (_e, req) => {
  const id = ++chatSeq;
  const res = await ai.chat(req, (t) => emit('ai:token', { id, ...t }));
  emit('ai:token', { id, done: true, stats: res.stats || null, ok: res.ok, error: res.error || null });
  return { id, ...res };
});

ipcMain.handle('ai:benchmark', async (_e, target) => {
  aiLog(`benchmark: ${target.model} on ${target.endpoint}`, 'head');
  const res = await ai.benchmark(target, () => {});
  if (res.ok) {
    aiLog(`  ${res.tokens} tokens in ${res.elapsedMs} ms -> ${res.tokensPerSec ?? '?'} tok/s`
      + (res.measured ? ' (server-measured)' : ' (chunk-counted estimate)')
      + (res.loadMs ? `, model load ${res.loadMs} ms` : ''), 'ok');
  } else aiLog(`  failed: ${res.error}`, 'err');
  return res;
});

/*
 * "Explain this" - a paste box for an error, a log excerpt, a stack trace.
 * The system prompt keeps the model on the job: what it means, the likely
 * cause, the next thing to try. No poetry.
 */
ipcMain.handle('ai:explain', async (_e, { target, text, context }) => {
  const id = ++chatSeq;
  const system = 'You are a senior engineer helping on a developer workstation. '
    + 'The user pastes an error, log excerpt or stack trace. Answer in plain prose, under 200 words: '
    + '(1) what it means, (2) the most likely cause, (3) the single next thing to try. '
    + 'If a command would help, give it on its own line. Do not speculate beyond the evidence.'
    + (context ? ` Machine context: ${context}` : '');
  const res = await ai.chat({ ...target, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] },
    (t) => emit('ai:token', { id, ...t }));
  emit('ai:token', { id, done: true, stats: res.stats || null, ok: res.ok, error: res.error || null });
  return { id, ...res };
});

/* --- projects ------------------------------------------------------------- */
function projLog(text, level) {
  if (logStream) logStream.write(`${new Date().toISOString()} [proj] ${text}\n`);
  emit('proj:log', { text, level, ts: Date.now() });
}
ipcMain.handle('proj:scan', () => projects.scan(settings.get('devRoot') || devRoot()));
ipcMain.handle('proj:fetch', (_e, dir) => projects.fetch(dir, projLog));
ipcMain.handle('proj:fetchAll', () => projects.fetchAll(settings.get('devRoot') || devRoot(), projLog));
ipcMain.handle('proj:openEditor', (_e, dir) => projects.openInEditor(dir));

/* --- terminals ----------------------------------------------------------- */
ipcMain.handle('term:list', () => terminals.list());
ipcMain.handle('term:wsl', () => terminals.wslDistros());
ipcMain.handle('term:open', (_e, { id, extra }) => terminals.open(id, devRoot(), extra));

/* --- hardware ------------------------------------------------------------ */
function hwLog(text, level) {
  if (logStream) logStream.write(`${new Date().toISOString()} [hw] ${text}\n`);
  emit('hw:log', { text, level, ts: Date.now() });
}

ipcMain.handle('hw:sensors', () => hardware.sensors());
ipcMain.handle('hw:tools', () => hardware.toolStatus());
ipcMain.handle('hw:installTool', (_e, id) => hardware.installTool(id, hwLog));
ipcMain.handle('hw:launchTool', (_e, id) => {
  const res = hardware.launchTool(id);
  hwLog(res.ok ? res.detail : `could not launch: ${res.error}`, res.ok ? 'ok' : 'err');
  return res;
});
ipcMain.handle('hw:memory', () => hardware.memoryState());
ipcMain.handle('hw:ramFlush', () => hardware.ramFlush(hwLog));
ipcMain.handle('hw:purgeStandby', () => hardware.purgeStandby(hwLog));
ipcMain.handle('hw:clearTemp', () => hardware.clearTempCache(hwLog));

/* --- RGB (OpenRGB SDK) --------------------------------------------------- */
ipcMain.handle('rgb:status', () => openrgb.status());
ipcMain.handle('rgb:setColor', async (_e, { hex, device }) => {
  const res = await openrgb.setColor(hex, device === null || device === undefined ? null : Number(device));
  hwLog(res.ok
    ? `RGB ${hex} -> ${res.applied.filter((a) => a.ok).length} device(s)`
    : `RGB failed: ${res.error}`, res.ok ? 'ok' : 'err');
  return res;
});
ipcMain.handle('rgb:applyMode', async (_e, { device, mode }) => {
  const res = await openrgb.applyMode(device, mode);
  hwLog(res.ok ? `RGB mode: ${res.detail}` : `RGB mode failed: ${res.error}`, res.ok ? 'ok' : 'err');
  return res;
});

/* --- profile ------------------------------------------------------------- */
ipcMain.handle('profile:get', async () => {
  const env = await doctor.environment(() => {});
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const installed = settings.get('installedIds') || [];
  return {
    profile: settings.get('profile') || {},
    identity: catalog.meta || {},
    machine: env,
    installedCount: installed.length,
    installedNames: catalog.items.filter((i) => installed.includes(i.id)).map((i) => i.name),
    appVersion: app.getVersion(),
    elevated: await isElevated(),
    devRoot: devRoot(),
  };
});
ipcMain.handle('profile:save', (_e, patch) => {
  const next = { ...(settings.get('profile') || {}), ...(patch || {}) };
  settings.save({ profile: next });
  return next;
});

/* --- system doctor ------------------------------------------------------- */
function doctorLog(text) {
  if (logStream) logStream.write(`${new Date().toISOString()} [doctor] ${text}\n`);
  emit('doctor:log', { text, ts: Date.now() });
}

let lastReportDir = '';

ipcMain.handle('doctor:scan', () => doctor.diagnose(doctorLog));
ipcMain.handle('doctor:fix', (_e, id) => {
  const pub = settings.get('publish') || {};
  return doctor.fixOne(id, doctorLog, { authorName: pub.authorName, authorEmail: pub.authorEmail });
});
ipcMain.handle('doctor:fixAll', () => {
  const pub = settings.get('publish') || {};
  return doctor.fixAll(doctorLog, { authorName: pub.authorName, authorEmail: pub.authorEmail });
});
ipcMain.handle('doctor:report', async () => {
  const res = await doctor.fullReport(doctorLog);
  lastReportDir = res.dir;
  return { dir: res.dir, summary: res.diagnostics.summary, results: res.diagnostics.results };
});
ipcMain.handle('doctor:openFolder', async () => {
  const dir = lastReportDir || path.join(app.getPath('userData'), 'diagnostics');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* already there */ }
  await shell.openPath(dir);
  return dir;
});
ipcMain.handle('doctor:environment', () => doctor.environment(doctorLog));
ipcMain.handle('doctor:cleanScan', () => doctor.cleanupPreview());
ipcMain.handle('doctor:cleanRun', (_e, ids) => doctor.cleanupRun(ids || [], doctorLog));
ipcMain.handle('doctor:port', (_e, port) => doctor.whoHasPort(port));
ipcMain.handle('doctor:portScan', () => doctor.scanCommonPorts());

ipcMain.handle('publish:status', async () => {
  const p = settings.get('publish') || {};
  const st = await publish.status({ owner: p.repoOwner, repo: p.repoName });
  return { ...st, packaged: app.isPackaged, appVersion: app.getVersion() };
});

ipcMain.handle('publish:setRepo', (_e, patch) => {
  const next = settings.save({ publish: patch || {} });
  return next.publish;
});

ipcMain.handle('publish:setToken', (_e, token) => {
  try {
    secrets.setToken(token);
    const next = settings.save({ publish: { hasToken: secrets.hasToken() } });
    return { ok: true, publish: next.publish };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('publish:clearToken', () => {
  secrets.clearToken();
  const next = settings.save({ publish: { hasToken: false } });
  return { ok: true, publish: next.publish };
});

ipcMain.handle('publish:installGh', async () => publish.installGh(publishLog));

ipcMain.handle('publish:run', async () => {
  const p = settings.get('publish') || {};
  const owner = p.repoOwner || 'Ionity-Global-Pty-Ltd';
  const repo = p.repoName || 'ProGramerly';
  const cfg = {
    owner,
    repo,
    remoteUrl: p.remoteUrl || `https://github.com/${owner}/${repo}.git`,
    version: app.getVersion(),
    description: 'Basic Coding Software for All. One free desktop app that installs a complete development environment.',
    author: { name: p.authorName, email: p.authorEmail },
  };
  publishLog(`Starting push & release for v${cfg.version} -> ${owner}/${repo}`, 'head');
  return publish.publishRelease(cfg, publishLog);
});

/* --- shortcuts ---------------------------------------------------------- */
ipcMain.handle('app:createShortcut', async () => shortcut.createDesktopShortcut({
  minimised: Boolean(settings.get('startMinimised')),
}));
ipcMain.handle('app:loginState', () => shortcut.loginState());

/* --- installer ---------------------------------------------------------- */
ipcMain.handle('install:cancel', () => { cancelRequested = true; return true; });

ipcMain.handle('install:start', async (_e, ids) => {
  if (running) return { ok: false, error: 'already running' };
  running = true;
  cancelRequested = false;

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const queue = engine.orderSelection(catalog, ids || []);

  if (IS_WIN && !(await isElevated())) {
    // Last line of defence: autoElevate is normally handled at launch, but if
    // it was switched off (or UAC was declined then) say so once, here, rather
    // than letting every package in the queue raise its own dialog.
    logLine('Not running as administrator - each installer will ask for consent on its own.', 'warn');
    logLine('Settings > "Run as administrator automatically" removes those prompts.', 'warn');
    emit('install:needsElevation', true);
  }

  if (IS_MAC) {
    logLine('Requesting administrator access (macOS)...');
    const primed = await primeSudo();
    logLine(primed ? 'Administrator access granted.' : 'No admin access - cask installs may fail.',
      primed ? 'ok' : 'warn');
  }

  emit('install:queue', queue.map((i) => ({ id: i.id, name: i.name })));

  const results = [];
  for (let idx = 0; idx < queue.length; idx += 1) {
    const item = queue[idx];
    if (cancelRequested) {
      emit('install:item', { id: item.id, status: 'skipped', detail: 'cancelled' });
      results.push({ id: item.id, status: 'skipped' });
      continue;
    }
    emit('install:item', { id: item.id, status: 'running', index: idx, total: queue.length });
    logLine('');
    logLine(`--- [${idx + 1}/${queue.length}] ${item.name} -------------------------`, 'head');

    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await engine.installItem(item, (l) => logLine(l));
    } catch (err) {
      res = { status: 'failed', detail: err.message };
      logLine(`unhandled error: ${err.message}`, 'err');
    }

    logLine(`=> ${item.name}: ${res.status} (${res.detail})`,
      res.status === 'ok' ? 'ok' : res.status === 'failed' ? 'err' : 'warn');
    emit('install:item', { id: item.id, ...res, index: idx, total: queue.length });
    results.push({ id: item.id, ...res });
  }

  stopSudoKeepAlive();
  running = false;

  // Remember what this machine now has, so the sync run knows what to watch.
  const installed = new Set(settings.get('installedIds') || []);
  results.filter((r) => r.status === 'ok').forEach((r) => installed.add(r.id));
  settings.save({ installedIds: [...installed] });

  const summary = {
    ok: results.filter((r) => r.status === 'ok').length,
    partial: results.filter((r) => r.status === 'partial').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    needsReboot: queue.some((i) => i.reboot),
    logFile,
  };
  logLine('');
  logLine(`DONE  ok=${summary.ok} partial=${summary.partial} failed=${summary.failed} skipped=${summary.skipped}`, 'head');
  emit('install:done', summary);
  return { ok: true, summary, results };
});

/* ---------------------------------------------------------------- lifecycle -- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    openLog();

    // One prompt, at the very start, before a window is ever drawn. Everything
    // the installer does afterwards runs silently underneath it.
    if (IS_WIN && !RELAUNCHED_ELEVATED && settings.get('autoElevate')) {
      if (!(await isElevated())) {
        const res = await relaunchElevated();
        if (res.ok) return;    // the elevated copy takes over; this one exits
        logLine(`Continuing as a standard user: ${res.error}.`, 'warn');
      }
    }
    publish.configure(app.getAppPath());
    doctor.configure({
      userData: app.getPath('userData'),
      logDir: path.join(app.getPath('userData'), 'logs'),
      appPath: app.getAppPath(),
    });
    Menu.setApplicationMenu(IS_MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null);

    createWindow();      // hidden - warms up while the intro plays
    startServices();
    await showIntro();
    introFinished = true;
    booting = false;
    revealWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('before-quit', () => { quitting = true; });

  app.on('window-all-closed', () => {
    // The intro closes before the main window is shown - do not read that as
    // "the user closed everything". The tray also keeps the sync service
    // alive; only a real quit tears it down.
    if (booting) return;
    if (!IS_MAC && !tray.exists()) app.quit();
  });

  app.on('will-quit', () => {
    stopSudoKeepAlive();
    if (metricsUnsub) metricsUnsub();
    metrics.stop();
    sync.stop();
    tray.destroy();
    if (logStream) { try { logStream.end(); } catch { /* already closed */ } }
  });
}
