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
        `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Continue'; ${cmd}`,
      ],
    };
  }
  return { file: '/bin/bash', args: ['-lc', cmd] };
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

    const child = spawn(file, args, {
      cwd: cwd || os.homedir(),
      env: { ...process.env, ...(env || {}) },
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
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

module.exports = { run, has, shellFor, IS_WIN };
