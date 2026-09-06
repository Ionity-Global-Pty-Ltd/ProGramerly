'use strict';
/**
 * ProGramerly - encrypted token store
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Holds exactly one optional secret: a GitHub token, used only to create
 * the Ionity-Global-Pty-Ltd/ProGramerly repository if it does not exist yet and
 * neither the gh CLI nor an existing remote can do it. The git push itself
 * never touches this - it always goes through the system's own git
 * credential manager. Encrypted at rest with Electron's safeStorage, which
 * defers to the OS keychain (DPAPI on Windows, Keychain on macOS).
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

function file() {
  return path.join(app.getPath('userData'), 'publish.token.enc');
}

function hasToken() {
  try { return fs.existsSync(file()); } catch { return false; }
}

function clearToken() {
  try { fs.unlinkSync(file()); } catch { /* already gone */ }
  return true;
}

function setToken(token) {
  if (!token) return clearToken();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption is unavailable on this machine, so no token was stored.');
  }
  const enc = safeStorage.encryptString(token);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), enc);
  return true;
}

function getToken() {
  try {
    if (!hasToken()) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buf = fs.readFileSync(file());
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

module.exports = {
  hasToken, setToken, getToken, clearToken,
};
