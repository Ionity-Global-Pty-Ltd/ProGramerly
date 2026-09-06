'use strict';
/**
 * ProGramerly - terminals
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Every shell this machine can actually open, found by looking for it rather
 * than by assuming it exists - then opened, in the folder you are working in,
 * from a button.
 *
 * Nothing is emulated in the window. A terminal emulator inside an Electron
 * app is a worse terminal than the one already installed; this opens the real
 * thing, detached, and lets go of it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { run } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const home = os.homedir();

const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

function firstExisting(list) {
  for (const p of list) { try { if (p && fs.existsSync(p)) return p; } catch { /* keep looking */ } }
  return '';
}

/**
 * The candidate list. `find` returns a path or '', `args` builds the argv for
 * a given working directory. Everything here opens a window and returns.
 */
function candidates() {
  if (IS_WIN) {
    return [
      {
        id: 'wt', name: 'Windows Terminal', note: 'Tabs, panes, and every profile below in one window.',
        find: () => firstExisting([
          path.join(LOCAL, 'Microsoft', 'WindowsApps', 'wt.exe'),
        ]),
        args: (cwd) => ['-d', cwd],
      },
      {
        id: 'pwsh', name: 'PowerShell 7', note: 'The cross-platform one. pwsh.',
        find: () => firstExisting([
          path.join(PF, 'PowerShell', '7', 'pwsh.exe'),
          path.join(PF, 'PowerShell', '7-preview', 'pwsh.exe'),
          path.join(LOCAL, 'Microsoft', 'WindowsApps', 'pwsh.exe'),
        ]),
        args: (cwd) => ['-NoExit', '-WorkingDirectory', cwd],
        console: true,
      },
      {
        id: 'powershell', name: 'Windows PowerShell', note: 'The 5.1 that ships with Windows.',
        find: () => firstExisting([path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')]),
        args: (cwd) => ['-NoExit', '-Command', `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'`],
        console: true,
      },
      {
        id: 'cmd', name: 'Command Prompt', note: 'cmd.exe. Still the fastest thing on the machine.',
        find: () => firstExisting([path.join(SYS32, 'cmd.exe')]),
        args: (cwd) => ['/K', `cd /d "${cwd}"`],
        console: true,
      },
      {
        id: 'gitbash', name: 'Git Bash', note: 'The bash that comes with Git for Windows.',
        find: () => firstExisting([
          path.join(PF, 'Git', 'git-bash.exe'),
          path.join(PF86, 'Git', 'git-bash.exe'),
          path.join(LOCAL, 'Programs', 'Git', 'git-bash.exe'),
        ]),
        args: (cwd) => [`--cd=${cwd}`],
      },
      {
        id: 'gitcmd', name: 'Git CMD', note: 'cmd with the Git tools on PATH.',
        find: () => firstExisting([path.join(PF, 'Git', 'git-cmd.exe'), path.join(PF86, 'Git', 'git-cmd.exe')]),
        args: (cwd) => [`--cd=${cwd}`],
      },
      {
        id: 'wsl', name: 'WSL', note: 'Your default Linux distribution.',
        find: () => firstExisting([path.join(SYS32, 'wsl.exe')]),
        args: () => ['--cd', '~'],
        console: true,
      },
      {
        id: 'nushell', name: 'Nushell', note: 'Structured data in the pipe.',
        find: () => firstExisting([
          path.join(PF, 'nu', 'bin', 'nu.exe'),
          path.join(LOCAL, 'Programs', 'nu', 'bin', 'nu.exe'),
        ]),
        args: () => [],
        console: true,
      },
      {
        id: 'anaconda', name: 'Anaconda Prompt', note: 'cmd with conda already activated.',
        find: () => firstExisting([
          path.join(home, 'anaconda3', 'Scripts', 'activate.bat'),
          path.join(home, 'miniconda3', 'Scripts', 'activate.bat'),
          path.join('C:\\', 'ProgramData', 'anaconda3', 'Scripts', 'activate.bat'),
        ]),
        wrapCmd: true,
        console: true,
      },
      {
        id: 'vsdev', name: 'Developer Command Prompt', note: 'MSVC toolchain on PATH.',
        find: () => firstExisting([
          path.join(PF, 'Microsoft Visual Studio', '2022', 'Community', 'Common7', 'Tools', 'VsDevCmd.bat'),
          path.join(PF, 'Microsoft Visual Studio', '2022', 'Professional', 'Common7', 'Tools', 'VsDevCmd.bat'),
          path.join(PF86, 'Microsoft Visual Studio', '2019', 'Community', 'Common7', 'Tools', 'VsDevCmd.bat'),
        ]),
        wrapCmd: true,
        console: true,
      },
    ];
  }

  if (IS_MAC) {
    return [
      { id: 'terminal', name: 'Terminal', note: "Apple's own.", find: () => firstExisting(['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app']), open: true },
      { id: 'iterm', name: 'iTerm2', note: 'Panes, profiles, search.', find: () => firstExisting(['/Applications/iTerm.app']), open: true },
      { id: 'warp', name: 'Warp', note: 'Blocks and completions.', find: () => firstExisting(['/Applications/Warp.app']), open: true },
      { id: 'kitty', name: 'kitty', note: 'GPU-drawn, fast.', find: () => firstExisting(['/Applications/kitty.app']), open: true },
      { id: 'alacritty', name: 'Alacritty', note: 'Minimal and quick.', find: () => firstExisting(['/Applications/Alacritty.app']), open: true },
    ];
  }

  return [
    { id: 'gnome', name: 'GNOME Terminal', find: () => firstExisting(['/usr/bin/gnome-terminal']), args: (cwd) => [`--working-directory=${cwd}`] },
    { id: 'konsole', name: 'Konsole', find: () => firstExisting(['/usr/bin/konsole']), args: (cwd) => ['--workdir', cwd] },
    { id: 'xterm', name: 'xterm', find: () => firstExisting(['/usr/bin/xterm']), args: () => [] },
  ];
}

/** Which of them are actually here. */
function list() {
  return candidates().map((c) => {
    const exe = c.find();
    return { id: c.id, name: c.name, note: c.note || '', path: exe, available: Boolean(exe) };
  });
}

/** WSL is one entry above, but a machine can hold several distributions. */
async function wslDistros() {
  if (!IS_WIN) return [];
  const { code, output } = await run('wsl.exe --list --quiet', { timeoutMs: 15000 });
  if (code !== 0) return [];
  // wsl.exe writes UTF-16; the runner decodes as UTF-8, so strip the NULs.
  return String(output || '')
    .replace(/\u0000/g, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Open one. Detached and unref'd: the terminal outlives ProGramerly, which is
 * the only sane relationship between an app and a shell it launched.
 */
function open(id, cwd, extra) {
  const c = candidates().find((x) => x.id === id);
  if (!c) return { ok: false, error: 'unknown terminal' };
  const exe = c.find();
  if (!exe) return { ok: false, error: `${c.name} is not installed on this machine` };

  const dir = cwd && fs.existsSync(cwd) ? cwd : home;

  try {
    if (c.open) {
      // macOS: hand the folder to the app and let LaunchServices place it.
      const child = spawn('/usr/bin/open', ['-a', exe, dir], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, detail: `${c.name} opened in ${dir}` };
    }

    if (c.wrapCmd) {
      // A .bat that must be sourced, then left interactive.
      const child = spawn(path.join(SYS32, 'cmd.exe'), ['/K', `"${exe}" && cd /d "${dir}"`], {
        detached: true, stdio: 'ignore', windowsVerbatimArguments: true,
      });
      child.unref();
      return { ok: true, detail: `${c.name} opened in ${dir}` };
    }

    let args = c.args ? c.args(dir) : [];
    if (id === 'wsl' && extra) args = ['-d', extra, '--cd', '~'];

    // A console program needs a console. Windows Terminal, if present, is a
    // far better one than conhost - so use it as the host when it exists.
    if (IS_WIN && c.console) {
      const wt = firstExisting([path.join(LOCAL, 'Microsoft', 'WindowsApps', 'wt.exe')]);
      if (wt) {
        const child = spawn(wt, ['-d', dir, exe, ...args], { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, detail: `${c.name} opened in Windows Terminal, in ${dir}` };
      }
      const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: dir, shell: false, windowsHide: false });
      child.unref();
      return { ok: true, detail: `${c.name} opened in ${dir}` };
    }

    const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: dir });
    child.unref();
    return { ok: true, detail: `${c.name} opened in ${dir}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { list, open, wslDistros };
