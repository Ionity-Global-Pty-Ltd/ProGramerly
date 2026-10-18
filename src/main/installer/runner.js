'use strict';
/**
 * ProGramerly - command runner
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * One job: run a shell command, stream its output line by line, resolve with
 * an exit code. Never throws on a non-zero exit - the engine decides what a
 * failure means.
 */

const { spawn } = require('node:child_process');
const os = require('node:os');

const IS_WIN = process.platform === 'win32';

/* Extra environment every child gets - set by the macOS password session
   (SUDO_ASKPASS) and cleared when it ends. Kept here so the engine, Doctor
   and services all inherit it without threading it through every call. */
let sessionEnv = {};
function setSessionEnv(e) { sessionEnv = { ...(e || {}) }; }
function extraEnv() { return sessionEnv; }

/** Wrap a command so it runs in the right shell for this OS. */
function shellFor(cmd) {
  if (IS_WIN) {
    // pwsh if available is nicer, but powershell.exe is guaranteed present.
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        // Re-read PATH from the registry first: a package installed one step
        // earlier (arduino-cli, gh, kiro-cli) is otherwise invisible until the
        // user opens a new terminal, and every post-step that calls it fails.
        "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); "
        + `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Continue'; ${cmd}`,
      ],
    };
  }
  // Same idea on macOS / Linux. An app opened from Finder or a desktop
  // launcher starts with PATH=/usr/bin:/bin:/usr/sbin:/sbin, and a login bash
  // does not read ~/.zprofile - which is exactly where Homebrew registers
  // itself. So every known tool location is put first, explicitly.
  return { file: '/bin/bash', args: ['-lc', `export PATH="${EXTRA_PATH}:$PATH"; ${cmd}`] };
}

/** Every place a dev tool lands on macOS / Linux before any rc file knows. */
const EXTRA_PATH = [
  '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin',
  '$HOME/.local/bin', '$HOME/.cargo/bin', '$HOME/.bun/bin', '$HOME/.deno/bin',
  '/Library/Frameworks/Python.framework/Versions/Current/bin',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin',
  '/snap/bin', '/var/lib/flatpak/exports/bin',
].join(':');

/**
 * Give this process the same PATH a login shell would have, once, at start.
 * Node's own spawn/execFile calls (has(), the services) then see Homebrew,
 * VS Code's CLI and user-level bins too. No-op on Windows.
 */
function hydratePath() {
  if (IS_WIN) return process.env.PATH;
  const home = os.homedir();
  const want = EXTRA_PATH.replace(/\$HOME/g, home).split(':');
  const have = String(process.env.PATH || '').split(':').filter(Boolean);
  process.env.PATH = [...want.filter((p) => !have.includes(p)), ...have].join(':');
  return process.env.PATH;
}

/**
 * @param {string} cmd            command line to run
 * @param {object} opts
 * @param {(line:string, stream:'out'|'err')=>void} opts.onLine
 * @param {number} [opts.timeoutMs]
 * @param {object} [opts.env]
 * @param {string} [opts.cwd]
 * @returns {Promise<{code:number, timedOut:boolean, output:string}>}
 */
function run(cmd, opts = {}) {
  const { onLine = () => {}, timeoutMs = 45 * 60 * 1000, env, cwd } = opts;
  const { file, args } = shellFor(cmd);

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;

    // macOS / Linux: each step runs in its own session (setsid via
    // `detached`). With no controlling terminal, `sudo` can never wait on a
    // hidden TTY - it goes to SUDO_ASKPASS or fails fast, never hangs.
    const child = spawn(file, args, {
      cwd: cwd || os.homedir(),
      env: { ...process.env, ...extraEnv(), ...(env || {}) },
      windowsHide: true,
      detached: !IS_WIN,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (!IS_WIN && child.pid) process.kill(-child.pid, 'SIGKILL');   // the whole group
        else child.kill('SIGKILL');
      } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    }, timeoutMs);

    const pump = (stream, tag) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        output += chunk;
        buf += chunk;
        const parts = buf.split(/\r?\n/);
        buf = parts.pop();
        for (const line of parts) {
          const t = line.replace(/\r/g, '').trimEnd();
          if (t.length) onLine(t, tag);
        }
      });
      stream.on('end', () => {
        const t = buf.replace(/\r/g, '').trimEnd();
        if (t.length) onLine(t, tag);
      });
    };

    pump(child.stdout, 'out');
    pump(child.stderr, 'err');

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: typeof code === 'number' ? code : 1, timedOut, output });
    };

    child.on('error', (err) => {
      onLine(`spawn failed: ${err.message}`, 'err');
      finish(127);
    });
    child.on('close', finish);
  });
}

/** True if a command exists on PATH. */
async function has(bin) {
  const probe = IS_WIN
    ? `if (Get-Command ${bin} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`
    : `command -v ${bin} >/dev/null 2>&1`;
  const { code } = await run(probe, { timeoutMs: 20000 });
  return code === 0;
}

module.exports = {
  run, has, shellFor, hydratePath, setSessionEnv, EXTRA_PATH, IS_WIN,
};
