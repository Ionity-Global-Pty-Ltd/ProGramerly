'use strict';
/**
 * ProGramerly - one password prompt per run (macOS + Linux)
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Why this exists: a GUI app has no terminal, so `sudo` inside an installer
 * (Homebrew casks, apt, snap) either dies with "a terminal is required" or
 * waits forever. `osascript ... with administrator privileges` does NOT prime
 * sudo, and sudo's timestamp is per-terminal, so priming would not survive
 * the next spawned shell anyway.
 *
 * The fix: the user is asked once, with the platform's own password dialog.
 * The password is checked with `sudo -S -v`, then held in this process's
 * memory only, for the length of the run. Every child gets SUDO_ASKPASS
 * pointing at a tiny helper that fetches it over a private Unix socket
 * (0700 directory, random one-run token). Nothing is ever written to disk,
 * put in an environment variable, or logged. `end()` wipes it.
 */

const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

let state = null; // { dir, sock, token, server, password, env }

function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

/** Run argv (no shell), feed stdin, collect stdout. */
function exec(file, args, { input, timeoutMs = 120000, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(file, args, { env: { ...process.env, ...(env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) { resolve({ code: 127, out: '', err: err.message }); return; }
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    child.on('error', (err) => { clearTimeout(t); resolve({ code: 127, out: '', err: err.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
    if (input !== undefined) { child.stdin.end(input); } else { child.stdin.end(); }
  });
}

function which(bin) {
  for (const d of (process.env.PATH || '/usr/bin:/bin').split(':').concat(['/usr/bin', '/bin', '/usr/local/bin'])) {
    try { const p = path.join(d, bin); fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

/** The desktop's own password dialog. Resolves the typed text, or null on cancel / no dialog tool. */
async function askUser(message) {
  if (IS_MAC) {
    const script = `display dialog ${JSON.stringify(message)} default answer "" with hidden answer `
      + 'with title "ProGramerly" with icon caution buttons {"Cancel", "OK"} default button "OK"';
    const r = await exec('/usr/bin/osascript', ['-e', script, '-e', 'text returned of result'], { timeoutMs: 300000 });
    return r.code === 0 ? r.out.replace(/\r?\n$/, '') : null;
  }
  if (IS_LINUX) {
    const zen = which('zenity');
    if (zen) {
      const r = await exec(zen, ['--password', '--title=ProGramerly'], { timeoutMs: 300000 });
      return r.code === 0 ? r.out.replace(/\r?\n$/, '') : null;
    }
    const kd = which('kdialog');
    if (kd) {
      const r = await exec(kd, ['--title', 'ProGramerly', '--password', message], { timeoutMs: 300000 });
      return r.code === 0 ? r.out.replace(/\r?\n$/, '') : null;
    }
    for (const b of ['ssh-askpass', 'ksshaskpass', 'lxqt-openssh-askpass']) {
      const p = which(b) || (fs.existsSync(`/usr/lib/ssh/${b}`) ? `/usr/lib/ssh/${b}` : null);
      if (p) {
        const r = await exec(p, [message], { timeoutMs: 300000 });
        return r.code === 0 ? r.out.replace(/\r?\n$/, '') : null;
      }
    }
  }
  return null;
}

/** True when this user can sudo without a password (or is root). */
async function sudoFree() {
  if (process.getuid && process.getuid() === 0) return true;
  const r = await exec('sudo', ['-n', 'true'], { timeoutMs: 15000 });
  return r.code === 0;
}

/** Check a password without leaving a cached timestamp behind. */
async function verify(password) {
  const r = await exec('sudo', ['-S', '-k', '-p', '', '-v'], { input: `${password}\n`, timeoutMs: 30000 });
  return r.code === 0;
}

function writeHelper(dir, sock, token) {
  // The helper runs under the Electron binary in Node mode, so it works the
  // same inside the packaged app as from source. It prints the password and
  // nothing else - exactly what sudo expects from an askpass program.
  const js = path.join(dir, 'askpass.js');
  fs.writeFileSync(js, [
    "'use strict';",
    "const s = require('net').createConnection(process.env.PROGRAMERLY_ASKPASS_SOCK);",
    "let b = '';",
    "s.on('connect', () => s.write(process.env.PROGRAMERLY_ASKPASS_TOKEN + '\\n'));",
    "s.on('data', (d) => { b += d; });",
    "s.on('end', () => { if (b) { process.stdout.write(b + '\\n'); process.exit(0); } process.exit(1); });",
    "s.on('error', () => process.exit(1));",
    '',
  ].join('\n'), { mode: 0o600 });
  const sh = path.join(dir, 'askpass.sh');
  fs.writeFileSync(sh, [
    '#!/bin/sh',
    `PROGRAMERLY_ASKPASS_SOCK=${shq(sock)} PROGRAMERLY_ASKPASS_TOKEN=${shq(token)} ELECTRON_RUN_AS_NODE=1 exec ${shq(process.execPath)} ${shq(js)}`,
    '',
  ].join('\n'), { mode: 0o700 });
  return sh;
}

/**
 * Ask once, verify, and start serving the password to sudo for this run.
 * @returns {Promise<{ok:boolean, env:object, mode:'root'|'nopasswd'|'askpass'|'none', error?:string}>}
 */
async function begin(log = () => {}) {
  if (!(IS_MAC || IS_LINUX)) return { ok: true, env: {}, mode: 'none' };
  if (state) return { ok: true, env: state.env, mode: 'askpass' };
  if (await sudoFree()) return { ok: true, env: {}, mode: process.getuid && process.getuid() === 0 ? 'root' : 'nopasswd' };

  let password = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const typed = await askUser(attempt === 1
      ? 'ProGramerly needs your password once to install software. It is kept in memory for this run only.'
      : 'That password was not accepted. Try again.');
    if (typed === null) {
      return { ok: false, env: {}, mode: 'none', error: 'no password given (or no password dialog available on this desktop)' };
    }
    // eslint-disable-next-line no-await-in-loop
    if (await verify(typed)) { password = typed; break; }
    log('password not accepted');
  }
  if (!password) return { ok: false, env: {}, mode: 'none', error: 'password was not accepted three times' };

  return serve(password);
}

/** Start serving a verified password (split out so tests can drive it). */
async function serve(password) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programerly-'));
  fs.chmodSync(dir, 0o700);
  const sock = path.join(dir, 's');
  const token = crypto.randomBytes(24).toString('hex');
  const server = net.createServer((c) => {
    let buf = '';
    c.setEncoding('utf8');
    c.on('data', (d) => {
      buf += d;
      if (!buf.includes('\n')) return;
      const got = Buffer.from(buf.trim());
      const want = Buffer.from(token);
      if (state && state.password && got.length === want.length && crypto.timingSafeEqual(got, want)) c.end(state.password);
      else c.end();
    });
    c.on('error', () => {});
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(sock, res); });
  try { fs.chmodSync(sock, 0o600); } catch { /* best effort */ }
  const helper = writeHelper(dir, sock, token);
  state = { dir, sock, token, server, password, env: { SUDO_ASKPASS: helper } };
  return { ok: true, env: state.env, mode: 'askpass' };
}

/** Environment every child should get while a run is active. */
function env() { return state ? state.env : {}; }
function active() { return Boolean(state); }

/** Forget the password and remove the helper. Safe to call twice. */
function end() {
  if (!state) return;
  const s = state;
  state = null;
  s.password = null;
  try { s.server.close(); } catch { /* closed */ }
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch { /* gone */ }
}

process.once('exit', end);

module.exports = { begin, end, env, active, askUser, sudoFree, _serve: serve };
