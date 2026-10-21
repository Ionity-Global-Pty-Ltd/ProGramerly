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
const IS_MAC = process.platform === 'darwin';

// Keep only the tail of a step's output in memory. ESP-IDF clones and model
// pulls print megabytes; the engine only ever inspects the end for verdicts.
const OUTPUT_CAP = 512 * 1024;

// Every child that is still running, so Cancel can stop the current item
// instead of only the ones after it.
const live = new Set();


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
  // With SUDO_ASKPASS set (macOS or Linux password session), a plain `sudo`
  // anywhere in the command - including scripts it pipes into bash - becomes
  // `sudo -A`, so it asks the helper and never a terminal.
  const askpassFn = 'if [ -n "$SUDO_ASKPASS" ]; then sudo() { command sudo -A "$@"; }; export -f sudo 2>/dev/null; fi; ';
  return { file: '/bin/bash', args: ['-lc', `export PATH="${EXTRA_PATH}:$PATH"; export HOMEBREW_NO_AUTO_UPDATE=1 NONINTERACTIVE=1; ${askpassFn}${cmd}`] };
}

/** Every place a dev tool lands on macOS / Linux before any rc file knows. */
const EXTRA_PATH = [
  '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin',
  '$HOME/.local/bin', '$HOME/.cargo/bin', '$HOME/.npm-global/bin', '$HOME/.bun/bin', '$HOME/.deno/bin',
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

    let child;
    try {
      child = spawn(file, args, {
        cwd: cwd || os.homedir(),
        env: { ...process.env, ...extraEnv(), ...(env || {}) },
        windowsHide: true,
        // POSIX: own session + process group. No controlling terminal means
        // sudo always uses the askpass dialog, and a timeout or Cancel can
        // stop the whole tree (brew -> installer -> pkgutil), not just bash.
        detached: !IS_WIN,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      onLine(`spawn failed: ${err.message}`, 'err');
      resolve({ code: 127, timedOut: false, output: '' });
      return;
    }
    live.add(child);

    const timer = setTimeout(() => {
      timedOut = true;
      onLine(`timed out after ${Math.round(timeoutMs / 60000)} min - stopping`, 'err');
      killTree(child);
    }, timeoutMs);

    const pump = (stream, tag) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        output += chunk;
        if (output.length > OUTPUT_CAP * 2) output = output.slice(-OUTPUT_CAP);
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
      live.delete(child);
      resolve({ code: typeof code === 'number' ? code : 1, timedOut, output });
    };

    child.on('error', (err) => {
      onLine(`spawn failed: ${err.message}`, 'err');
      finish(127);
    });
    child.on('close', finish);
  });
}

/** Stop a child and everything it started. */
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) {
    try {
      spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        .on('error', () => { try { child.kill(); } catch { /* gone */ } });
    } catch { try { child.kill(); } catch { /* gone */ } }
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group gone */ }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group gone */ }
  }, 3000).unref?.();
}

/** Cancel: stop every running step. Returns how many were stopped. */
function killAll() {
  const n = live.size;
  for (const c of [...live]) killTree(c);
  return n;
}

/** True if a command exists on PATH. */
async function has(bin) {
  if (!/^[\w.+-]+$/.test(String(bin))) return false;
  const probe = IS_WIN
    ? `if (Get-Command ${bin} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`
    : `command -v ${bin} >/dev/null 2>&1`;
  const { code } = await run(probe, { timeoutMs: 20000 });
  return code === 0;
}

module.exports = {
  run, has, shellFor, hydratePath, setSessionEnv, setBaseEnv: setSessionEnv, killAll, killTree, EXTRA_PATH, IS_WIN,
};
