'use strict';
/**
 * ProGramerly - system tray
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * The tray icon carries the machine's vitals. Hovering shows a live panel -
 * CPU load, CPU temperature, free space on every drive, and network throughput
 * with the current ping - because the OS tooltip caps out at 127 characters
 * and that is not enough room to tell the truth about six drives.
 */

const path = require('node:path');
const { Tray, Menu, nativeImage, screen, BrowserWindow } = require('electron');

const metrics = require('./services/metrics');
const netprobe = require('./services/netprobe');
const settings = require('./services/settings');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let tray = null;
let hud = null;
let unsubscribe = null;
let pingTimer = null;
let hideTimer = null;
let actions = {};

function iconPath() {
  const build = path.join(__dirname, '..', '..', 'build');
  if (IS_WIN) return path.join(build, 'icon.ico');
  return path.join(build, 'icon.png');
}

function trayImage() {
  const img = nativeImage.createFromPath(iconPath());
  if (img.isEmpty()) return img;
  const size = IS_MAC ? 18 : 16;
  const resized = img.resize({ width: size, height: size, quality: 'best' });
  if (IS_MAC) resized.setTemplateImage(false);
  return resized;
}

/* ------------------------------------------------------------------ hud -- */

function createHud() {
  hud = new BrowserWindow({
    width: 330,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  hud.setAlwaysOnTop(true, 'screen-saver');
  hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hud.loadFile(path.join(__dirname, '..', 'renderer', 'hud.html'));
  hud.on('closed', () => { hud = null; });
}

function positionHud(bounds) {
  if (!hud) return;
  const [w, h] = hud.getSize();
  const display = screen.getDisplayNearestPoint(
    bounds && bounds.x ? { x: bounds.x, y: bounds.y } : screen.getCursorScreenPoint(),
  );
  const area = display.workArea;
  const anchor = bounds && bounds.width
    ? { x: Math.round(bounds.x + bounds.width / 2), y: bounds.y }
    : screen.getCursorScreenPoint();

  let x = Math.round(anchor.x - w / 2);
  let y = anchor.y > area.y + area.height / 2 ? area.y + area.height - h - 12 : area.y + 12;
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - w - 8));
  hud.setPosition(x, y, false);
}

function showHud(bounds) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (!hud) createHud();
  positionHud(bounds);
  pushHud();
  hud.showInactive();
}

function hideHud(delay = 320) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (hud && !hud.isDestroyed()) hud.hide();
    hideTimer = null;
  }, delay);
}

function pushHud() {
  if (!hud || hud.isDestroyed() || !hud.webContents) return;
  hud.webContents.send('hud:data', {
    metrics: metrics.snapshot(),
    ping: netprobe.lastPingRef(),
    sync: safeSyncStatus(),
  });
}

function safeSyncStatus() {
  try { return require('./services/sync').status(); } catch { return null; }
}

/* ----------------------------------------------------------------- menu -- */

function buildMenu() {
  const s = settings.get();
  return Menu.buildFromTemplate([
    { label: 'ProGramerly - Basic Coding Software for All', enabled: false },
    { type: 'separator' },
    { label: 'Open ProGramerly', click: () => actions.show && actions.show() },
    { label: 'Live monitor', click: () => actions.show && actions.show('monitor') },
    { label: 'Network sweep', click: () => actions.show && actions.show('network') },
    { type: 'separator' },
    {
      label: s.keepInSync ? 'Keep everything in sync  ✓' : 'Keep everything in sync',
      type: 'checkbox',
      checked: Boolean(s.keepInSync),
      click: (item) => actions.setSync && actions.setSync(item.checked),
    },
    {
      label: 'Install updates automatically',
      type: 'checkbox',
      checked: Boolean(s.autoInstallUpdates),
      click: (item) => actions.setAutoInstall && actions.setAutoInstall(item.checked),
    },
    { label: 'Sync now', click: () => actions.syncNow && actions.syncNow() },
    { label: 'Check for a new ProGramerly', click: () => actions.checkUpdate && actions.checkUpdate() },
    { type: 'separator' },
    { label: 'Run speed test', click: () => actions.speedTest && actions.speedTest() },
    { label: 'Open log', click: () => actions.openLog && actions.openLog() },
    { type: 'separator' },
    { label: 'Quit ProGramerly', click: () => actions.quit && actions.quit() },
  ]);
}

function refreshMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
}

/* ------------------------------------------------------------ lifecycle -- */

function create(handlers = {}) {
  actions = handlers;
  if (tray && !tray.isDestroyed()) return tray;

  tray = new Tray(trayImage());
  tray.setToolTip('ProGramerly - starting…');
  tray.setContextMenu(buildMenu());

  tray.on('click', () => {
    if (IS_MAC) { tray.popUpContextMenu(); return; }
    if (actions.toggle) actions.toggle();
  });
  tray.on('double-click', () => actions.show && actions.show());
  tray.on('mouse-enter', () => showHud(tray.getBounds()));
  tray.on('mouse-move', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
  tray.on('mouse-leave', () => hideHud());

  unsubscribe = metrics.subscribe(() => {
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(metrics.tooltip({ pingMs: netprobe.lastPingRef() }));
    }
    pushHud();
  });

  // A cheap ping every 15 s keeps the tooltip's latency figure honest.
  netprobe.quickPing();
  pingTimer = setInterval(() => netprobe.quickPing(), 15000);
  if (pingTimer.unref) pingTimer.unref();

  createHud();
  return tray;
}

function destroy() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (hud && !hud.isDestroyed()) { hud.destroy(); hud = null; }
  if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null; }
}

function notify(title, body) {
  if (!tray || tray.isDestroyed()) return;
  try { tray.displayBalloon({ title, content: body, iconType: 'info' }); } catch { /* macOS/Linux */ }
}

module.exports = { create, destroy, refreshMenu, notify, exists: () => Boolean(tray && !tray.isDestroyed()) };
