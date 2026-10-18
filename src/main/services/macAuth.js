'use strict';
/**
 * ProGramerly - one administrator password per run on macOS
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Why this exists. `osascript ... with administrator privileges` raises the
 * native dialog, but it does NOT prime `sudo`: the two keep separate
 * credentials. Every Homebrew cask that calls `sudo` afterwards then dies
 * with "a terminal is required to read the password", and Homebrew's own
 * NONINTERACTIVE bootstrap refuses to start at all.
 *
 * What we do instead:
 *   1. Ask once, with a native macOS dialog (hidden answer).
 *   2. Verify the password with `sudo -A -k -v` before trusting it.
 *   3. Keep it in this process's memory only, behind a Unix socket that
 *      lives in a fresh 0700 directory.
 *   4. Write a tiny askpass helper next to it and point SUDO_ASKPASS at it.
 *      Every installer underneath - brew, cask .pkg installers, catalog
 *      `sudo` lines rewritten to `sudo -A` - asks the helper, the helper
 *      asks the socket, and nobody sees a second dialog.
 *   5. `end()` closes the socket, deletes the folder and forgets the password.
 *
 * Nothing is written to disk except the helper script, which contains no
 * secret. The password never appears in an environment variable or argv.
 */

const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const IS_MAC = process.platform === 'darwin';

let session = null; // { dir, sock, server, helper, password }

/** Run a command with a fixed argv and optional stdin. Never throws. */
function exec(file, args, { input, env, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(file, args, { env: { ...process.env, ...(env || {}) }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { resolve({ code: 127, out: '', err: e.message }); return; }
    const t = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: 127, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, out, err }); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

/** The native password dialog. Resolves with the text, or null on Cancel. */
async function askPassword(message) {
  // The prompt text is ours, never user input, so quoting is static.
  const script = [
    'set r to display dialog "' + message.replace(/"/g, '\\"') + '" ',
    'default answer "" with hidden answer with title "ProGramerly" ',
    'with icon caution buttons {"Cancel", "OK"} default button "OK"',
    '\nreturn text returned of r',
  ].join('');
  const res = await exec('/usr/bin/osascript', ['-e', script], { timeoutMs: 300000 });
  if (res.code !== 0) return null;
  return res.out.replace(/\r?\n$/, '');
}

/** Is this the right password? `sudo -S` reads it from stdin, once. */
async function verify(password) {
  await exec('/usr/bin/sudo', ['-k']);
  const res = await exec('/usr/bin/sudo', ['-S', '-p', '', '-v'], { input: `${password}\n`, timeoutMs: 30000 });
  return res.code === 0;
}

function writeHelper(dir, sock) {
  const helper = path.join(dir, 'askpass.sh');
  // nc ships with macOS. If it is somehow missing, fall back to asking again
  // with the dialog rather than failing the install outright.
  const body = `#!/bin/bash
# ProGramerly askpass helper - contains no secret.
if command -v /usr/bin/nc >/dev/null 2>&1; then
  /usr/bin/nc -U ${JSON.stringify(sock)} </dev/null && exit 0
fi
/usr/bin/osascript -e 'text returned of (display dialog "ProGramerly needs your password" default answer "" with hidden answer with title "ProGramerly")'
`;
  fs.writeFileSync(helper, body, { mode: 0o700 });
  return helper;
}

/**
 * Start a password session. Resolves { ok, env, error }. `env` is what every
 * child process should carry: SUDO_ASKPASS, nothing else.
 */
async function begin({ reason = 'ProGramerly needs your Mac password once to install applications. It is kept in memory for this run only.' } = {}) {
  if (!IS_MAC) return { ok: true, env: {} };
  if (session) return { ok: true, env: { SUDO_ASKPASS: session.helper } };

  let password = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const p = await askPassword(attempt === 0 ? reason : 'That password was not accepted. Try again.');
    if (p == null) return { ok: false, error: 'the password dialog was cancelled' };
    // eslint-disable-next-line no-await-in-loop
    if (await verify(p)) { password = p; break; }
  }
  if (!password) return { ok: false, error: 'the password was not accepted three times' };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programerly-auth-'));
  fs.chmodSync(dir, 0o700);
  const sock = path.join(dir, 's');
  const server = net.createServer((c) => { c.end(`${password}\n`); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sock, () => { try { fs.chmodSync(sock, 0o600); } catch { /* best effort */ } resolve(); });
  });
  const helper = writeHelper(dir, sock);
  session = { dir, sock, server, helper, password };
  return { ok: true, env: { SUDO_ASKPASS: helper } };
}

/** The env to merge into child processes, or {} when no session is open. */
function env() {
  return session ? { SUDO_ASKPASS: session.helper } : {};
}

function active() { return Boolean(session); }

/** Close the socket, delete the folder, forget the password. */
function end() {
  if (!session) return;
  const s = session;
  session = null;
  try { s.server.close(); } catch { /* closed */ }
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch { /* gone */ }
  s.password = null;
  exec('/usr/bin/sudo', ['-k']);
}

/**
 * Catalog authors write `sudo` the way a human would. On a Mac with an open
 * session, `sudo` becomes `sudo -A` so it asks the helper, never a TTY.
 * Exposed for tests; the engine calls it for every macOS command.
 */
function sudoizeMac(cmd) {
  return String(cmd).replace(/(^|[;&|(]\s*|\bthen\s+|\belse\s+|\bdo\s+)sudo\s+(?!-A\b)/g, (_m, lead) => `${lead}sudo -A `);
}

module.exports = { begin, end, env, active, sudoizeMac, _verify: verify };
