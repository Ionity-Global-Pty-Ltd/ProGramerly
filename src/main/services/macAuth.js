'use strict';
/**
 * ProGramerly - one administrator password per run on macOS
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * 3.9.1: the password session itself now lives in installer/askpass.js,
 * shared with Linux (zenity / kdialog / ssh-askpass). Over the 3.9.0 version
 * it adds:
 *   - a one-run token: the socket answers only the helper that carries it,
 *     not any process that finds the socket;
 *   - a Node helper run by the app's own binary, so it no longer depends on
 *     `nc` being present;
 *   - no dialog at all when sudo is already passwordless.
 * This module keeps the 3.9.0 API so the rest of the app is unchanged.
 */

const askpass = require('../installer/askpass');

const IS_MAC = process.platform === 'darwin';

/** Start a password session on macOS. Off macOS it is a no-op. */
async function begin(opts = {}) {
  if (!IS_MAC) return { ok: true, env: {} };
  return askpass.begin(opts.log || (() => {}));
}

function env() { return askpass.env(); }
function active() { return askpass.active(); }
function end() { askpass.end(); }

/**
 * Catalog authors write `sudo` the way a human would. With a session open,
 * `sudo` becomes `sudo -A` so it asks the helper, never a TTY.
 */
function sudoizeMac(cmd) {
  return String(cmd).replace(/(^|[;&|(]\s*|\bthen\s+|\belse\s+|\bdo\s+)sudo\s+(?!-A\b)/g, (_m, lead) => `${lead}sudo -A `);
}

module.exports = { begin, end, env, active, sudoizeMac };
