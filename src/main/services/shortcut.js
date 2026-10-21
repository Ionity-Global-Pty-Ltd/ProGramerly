'use strict';
/**
 * ProGramerly - desktop shortcut + login item
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app } = require('electron');
const { run } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function desktopDir() {
  try { return app.getPath('desktop'); } catch { return path.join(os.homedir(), 'Desktop'); }
}

function target() {
  // In development the exe is Electron itself, so point the shortcut at the
  // project folder as an argument - it still launches the real app.
  // Linux AppImage: process.execPath is the temporary /tmp/.mount_* copy,
  // gone after exit. APPIMAGE is the real file on disk.
  const exe = (process.platform === 'linux' && process.env.APPIMAGE) ? process.env.APPIMAGE : process.execPath;
  return { exe, args: app.isPackaged ? '' : path.join(__dirname, '..', '..', '..') };
}

/** Linux: copy the icon out of app.asar, where no desktop can read it. */
function linuxIcon() {
  const src = path.join(__dirname, '..', '..', '..', 'build', 'icon.png');
  const dir = path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor', '256x256', 'apps');
  const dest = path.join(dir, 'programerly.png');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(src));
    return dest;
  } catch { return 'utilities-terminal'; }
}

function desktopEntry({ exe, args, minimised }) {
  const q = (v) => `"${String(v).replace(/(["`$\\])/g, '\\$1')}"`;
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ProGramerly',
    'Comment=Basic Coding Software for All - Ionity (Pty) Ltd',
    `Exec=${q(exe)}${args ? ` ${q(args)}` : ''}${minimised ? ' --minimised' : ''}`,
    `Icon=${linuxIcon()}`,
    'Terminal=false',
    'Categories=Development;',
    'StartupWMClass=ProGramerly',
    '',
  ].join('\n');
}

/**
 * Create (or refresh) a desktop shortcut.
 * Windows: a real .lnk with the app icon, minimised-to-tray flag optional.
 * macOS:   a symlink to the .app bundle.
 * Linux:   a .desktop launcher.
 */
async function createDesktopShortcut({ minimised = false } = {}) {
  const { exe, args } = target();
  const desktop = desktopDir();
  try { fs.mkdirSync(desktop, { recursive: true }); } catch { /* exists */ }

  if (IS_WIN) {
    const lnk = path.join(desktop, 'ProGramerly.lnk');
    const icon = app.isPackaged
      ? exe
      : path.join(__dirname, '..', '..', '..', 'build', 'icon.ico');
    const argList = [args ? `"${args}"` : '', minimised ? '--minimised' : ''].filter(Boolean).join(' ');
    const ps = [
      '$s=(New-Object -ComObject WScript.Shell).CreateShortcut(' + `'${lnk.replace(/'/g, "''")}'` + ');',
      `$s.TargetPath='${exe.replace(/'/g, "''")}';`,
      argList ? `$s.Arguments='${argList.replace(/'/g, "''")}';` : '',
      `$s.WorkingDirectory='${path.dirname(exe).replace(/'/g, "''")}';`,
      `$s.IconLocation='${icon.replace(/'/g, "''")}';`,
      "$s.Description='ProGramerly - Basic Coding Software for All | Ionity (Pty) Ltd';",
      '$s.Save();',
    ].filter(Boolean).join(' ');
    const { code } = await run(ps, { timeoutMs: 30000 });
    return code === 0 ? { ok: true, path: lnk } : { ok: false, error: `shortcut failed (exit ${code})` };
  }

  if (IS_MAC) {
    const appBundle = app.isPackaged ? path.resolve(process.execPath, '..', '..', '..') : null;
    if (!appBundle) return { ok: false, error: 'run the packaged app to create a Desktop alias' };
    const link = path.join(desktop, 'ProGramerly.app');
    try {
      if (fs.existsSync(link)) fs.unlinkSync(link);
      fs.symlinkSync(appBundle, link);
      return { ok: true, path: link };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  const file = path.join(desktop, 'programerly.desktop');
  const body = desktopEntry({ exe, args, minimised });
  try {
    fs.writeFileSync(file, body, 'utf8');
    fs.chmodSync(file, 0o755);
    return { ok: true, path: file };
  } catch (err) { return { ok: false, error: err.message }; }
}

function autostartFile() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'programerly.desktop');
}

function setLaunchAtLogin(enabled, { minimised = true } = {}) {
  // Electron's login items exist on Windows and macOS only; on Linux they
  // returned ok and did nothing. XDG autostart is the standard there.
  if (process.platform === 'linux') {
    const f = autostartFile();
    try {
      if (enabled) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const { exe, args } = target();
        fs.writeFileSync(f, desktopEntry({ exe, args, minimised }), 'utf8');
      } else if (fs.existsSync(f)) fs.unlinkSync(f);
      return { ok: true, enabled: Boolean(enabled) };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: Boolean(minimised),
      args: minimised ? ['--minimised'] : [],
    });
    return { ok: true, enabled: Boolean(enabled) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function loginState() {
  if (process.platform === 'linux') return { openAtLogin: fs.existsSync(autostartFile()) };
  try { return app.getLoginItemSettings(); } catch { return { openAtLogin: false }; }
}

module.exports = { createDesktopShortcut, setLaunchAtLogin, loginState, desktopDir };
