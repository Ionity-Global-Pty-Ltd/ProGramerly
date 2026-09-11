'use strict';
/**
 * ProGramerly - PKCE + JWT helpers (pure, dependency-free)
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Pulled out of firebaseAuth.js so it can be unit-tested with plain `node`,
 * without pulling in Electron. Uses only node:crypto.
 */

const crypto = require('node:crypto');

/** RFC 4648 base64url (no padding). */
function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Create a PKCE verifier + its S256 challenge. */
function createPkce() {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** A URL-safe random state / nonce token. */
function randomState(bytes = 24) {
  return base64url(crypto.randomBytes(bytes));
}

/** Decode a JWT payload without verifying it (the IdP re-verifies). */
function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(
      Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
  } catch { return {}; }
}

module.exports = { base64url, createPkce, randomState, decodeJwt };
