'use strict';
/**
 * ProGramerly - cloud (Firebase) configuration resolver
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Resolves the effective Firebase web config the renderer should use. The
 * built-in Ionity project ships in src/shared/firebase.config.js. A non-Ionity
 * user can paste their own project's config (Settings -> Cloud); it is stored
 * encrypted at rest via safeStorage (the secrets.js pattern) and takes
 * precedence when present. The Google OAuth client id/secret can be overridden
 * the same way.
 *
 * A Firebase *web* config is not a secret; the OAuth client secret for a
 * desktop client is low-sensitivity but still kept out of plaintext here.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const builtin = require('../../shared/firebase.config');

function file() {
  return path.join(app.getPath('userData'), 'cloud.config.enc');
}

function readOverride() {
  try {
    if (!fs.existsSync(file())) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
  } catch { return null; }
}

function writeOverride(obj) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption is unavailable, so the custom Firebase config was not stored.');
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify(obj)));
}

function clearOverride() {
  try { fs.unlinkSync(file()); } catch { /* already gone */ }
  return true;
}

/** Shallow validation of a pasted Firebase web config. */
function validate(cfg) {
  const missing = [];
  for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (!cfg || !cfg[k] || String(cfg[k]).startsWith('REPLACE_WITH')) missing.push(k);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * The effective config the renderer should use:
 *   { firebase, oauth, allowedDomains, poolBytes, source, configured }
 */
function effective() {
  const override = readOverride();
  const firebase = (override && override.firebase) || builtin.FIREBASE_WEB_CONFIG;
  const oauth = {
    ...builtin.GOOGLE_OAUTH,
    clientId: process.env.PROGRAMERLY_GOOGLE_CLIENT_ID
      || (override && override.oauth && override.oauth.clientId)
      || builtin.GOOGLE_OAUTH.clientId,
    // Never send the secret to the renderer.
    clientSecret: undefined,
  };
  return {
    firebase,
    oauth: { clientId: oauth.clientId, authEndpoint: oauth.authEndpoint, scopes: oauth.scopes },
    allowedDomains: builtin.ALLOWED_DOMAINS,
    poolBytes: builtin.STORAGE_POOL_BYTES,
    source: override && override.firebase ? 'custom' : 'builtin',
    configured: builtin.isConfigured(firebase),
  };
}

/**
 * Store a BYO config patch. Accepts { firebase?, oauth? }.
 */
function setConfig(patch) {
  const cur = readOverride() || {};
  const next = { ...cur };
  if (patch && patch.firebase) {
    const v = validate(patch.firebase);
    if (!v.ok) return { ok: false, error: `Missing/placeholder fields: ${v.missing.join(', ')}` };
    next.firebase = patch.firebase;
  }
  if (patch && patch.oauth) next.oauth = { ...(cur.oauth || {}), ...patch.oauth };
  writeOverride(next);
  return { ok: true, config: effective() };
}

module.exports = {
  effective, setConfig, clearConfig: () => { clearOverride(); return { ok: true, config: effective() }; },
  validate,
};
