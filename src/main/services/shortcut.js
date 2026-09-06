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
  return { exe: process.execPath, args: app.isPackaged ? '' : path.join(__dirname, '..', '..', '..') };
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
  const body = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ProGramerly',
    'Comment=Basic Coding Software for All - Ionity (Pty) Ltd',
    `Exec="${exe}"${args ? ` "${args}"` : ''}${minimised ? ' --minimised' : ''}`,
    `Icon=${path.join(__dirname, '..', '..', '..', 'build', 'icon.png')}`,
    'Terminal=false',
    'Categories=Development;',
    '',
  ].join('\n');
  try {
    fs.writeFileSync(file, body, 'utf8');
    fs.chmodSync(file, 0o755);
    return { ok: true, path: file };
  } catch (err) { return { ok: false, error: err.message }; }
}

function setLaunchAtLogin(enabled, { minimised = true } = {}) {
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
  try { return app.getLoginItemSettings(); } catch { return { openAtLogin: false }; }
}

module.exports = { createDesktopShortcut, setLaunchAtLogin, loginState, desktopDir };
