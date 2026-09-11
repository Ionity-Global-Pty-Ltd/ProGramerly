'use strict';
/**
 * ProGramerly - internal Google sign-in (main process)
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Desktop OAuth done the safe way: the system browser drives Google's consent
 * screen, a short-lived loopback HTTP server on 127.0.0.1 catches the redirect,
 * and the authorization code is exchanged for tokens using PKCE - so no client
 * secret ever has to live in the client for the security to hold. The email
 * that comes back is checked against the internal Ionity allowlist before any
 * session is considered valid; anything else is rejected and signed out.
 *
 * The refresh token is persisted encrypted at rest through Electron's
 * safeStorage (DPAPI on Windows, Keychain on macOS) - the same mechanism
 * secrets.js already uses for the GitHub token. Nothing here talks to Firebase
 * directly: the renderer (cloud.js) takes the Google credential this produces
 * and completes signInWithCredential() against Firebase Auth, so Firestore and
 * Storage see a real Firebase user and the security rules apply.
 *
 * No new runtime dependencies: node:http, node:https, node:crypto, node:url,
 * plus Electron's shell + safeStorage.
 */

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { URL, URLSearchParams } = require('node:url');
const { app, shell, safeStorage } = require('electron');

const cfg = require('../../shared/firebase.config');
const {
  base64url, createPkce, randomState, decodeJwt,
} = require('../../shared/pkce');

/* ------------------------------------------------------------------ state -- */
let current = null;          // { email, name, picture, uid, sub } or null
let listeners = new Set();   // fns called on every auth state change

function sessionFile() {
  return path.join(app.getPath('userData'), 'auth.session.enc');
}

/* --------------------------------------------------------------- listeners -- */
function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function fire() {
  const snap = state();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* a bad listener must not break auth */ }
  }
}

/* ------------------------------------------------------------------- state -- */
function state() {
  return {
    signedIn: Boolean(current),
    user: current ? { ...current } : null,
    configured: cfg.isConfigured(cfg.FIREBASE_WEB_CONFIG),
  };
}
function currentUser() {
  return current ? { ...current } : null;
}

/* ------------------------------------------------------- token persistence -- */
function persist(tokens) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const payload = JSON.stringify({
      refresh_token: tokens.refresh_token || null,
      email: current?.email || null,
      savedAt: Date.now(),
    });
    fs.mkdirSync(path.dirname(sessionFile()), { recursive: true });
    fs.writeFileSync(sessionFile(), safeStorage.encryptString(payload));
  } catch { /* persistence is best-effort */ }
}
function readPersisted() {
  try {
    if (!fs.existsSync(sessionFile())) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile())));
  } catch { return null; }
}
function clearPersisted() {
  try { fs.unlinkSync(sessionFile()); } catch { /* already gone */ }
}

/* --------------------------------------------------------------- HTTP POST -- */
function postForm(endpoint, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const u = new URL(endpoint);
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data || '{}');
          if (res.statusCode >= 400) {
            reject(new Error(json.error_description || json.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(json);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ------------------------------------------------------------ google creds -- */
function clientId() {
  return process.env.PROGRAMERLY_GOOGLE_CLIENT_ID || cfg.GOOGLE_OAUTH.clientId;
}
function clientSecret() {
  return process.env.PROGRAMERLY_GOOGLE_CLIENT_SECRET || cfg.GOOGLE_OAUTH.clientSecret || '';
}

/* --------------------------------------------------------------- loopback -- */
/**
 * Start a one-shot loopback server. Returns { redirectUri, waitFor(), close() }.
 * Port 0 lets the OS pick a free port; Google's "Desktop app" client type
 * accepts any 127.0.0.1 port as a redirect target.
 */
function startLoopback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let resolveReq;
    let rejectReq;
    const reqPromise = new Promise((rs, rj) => { resolveReq = rs; rejectReq = rj; });
    const timer = setTimeout(() => {
      rejectReq(new Error('Timed out waiting for the browser sign-in to complete.'));
      try { server.close(); } catch { /* closing */ }
    }, 5 * 60 * 1000);

    server.on('request', (req, res) => {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SIGNIN_DONE_HTML);
      clearTimeout(timer);
      resolveReq({ code: q.get('code'), state: q.get('state'), error: q.get('error') });
      setTimeout(() => { try { server.close(); } catch { /* closing */ } }, 200);
    });
    server.on('error', (e) => { clearTimeout(timer); reject(e); });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        redirectUri: `http://127.0.0.1:${port}`,
        waitFor: () => reqPromise,
        close: () => { clearTimeout(timer); try { server.close(); } catch { /* closing */ } },
      });
    });
  });
}

/* ------------------------------------------------------------------ signIn -- */
/**
 * Run the whole loopback PKCE dance. Resolves with:
 *   { user, credential: { idToken, accessToken } }
 * where `credential` is what the renderer feeds Firebase's
 * GoogleAuthProvider.credential(idToken, accessToken).
 */
async function signIn() {
  if (String(clientId()).startsWith('REPLACE_WITH')) {
    throw new Error(
      'Google OAuth client ID is not configured. Add it in Settings -> Cloud '
      + 'or set PROGRAMERLY_GOOGLE_CLIENT_ID. See docs/FIREBASE-SETUP.md.',
    );
  }

  const { verifier, challenge } = createPkce();
  const stateTok = randomState();
  const lb = await startLoopback();

  const authUrl = new URL(cfg.GOOGLE_OAUTH.authEndpoint);
  authUrl.search = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: lb.redirectUri,
    response_type: 'code',
    scope: cfg.GOOGLE_OAUTH.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: stateTok,
    access_type: 'offline',
    prompt: 'select_account',
    // Nudge Google's account chooser toward Workspace accounts.
    hd: '*',
  }).toString();

  await shell.openExternal(authUrl.toString());

  let result;
  try {
    result = await lb.waitFor();
  } finally {
    lb.close();
  }

  if (result.error) throw new Error(`Google reported: ${result.error}`);
  if (!result.code) throw new Error('No authorization code was returned.');
  if (result.state !== stateTok) throw new Error('State mismatch - sign-in aborted for safety.');

  const tokenReq = {
    client_id: clientId(),
    code: result.code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: lb.redirectUri,
  };
  const secret = clientSecret();
  if (secret) tokenReq.client_secret = secret;

  const tokens = await postForm(cfg.GOOGLE_OAUTH.tokenEndpoint, tokenReq);
  if (!tokens.id_token) throw new Error('Google returned no id_token.');

  const claims = decodeJwt(tokens.id_token);
  const email = claims.email || '';

  if (!cfg.isAllowedEmail(email)) {
    clearPersisted();
    current = null;
    fire();
    throw new Error(
      `${email || 'that account'} is not an internal Ionity account. `
      + `Sign in with an @${cfg.ALLOWED_DOMAINS.join(' or @')} address.`,
    );
  }
  if (claims.email_verified === false) {
    throw new Error('That Google account has not verified its email address.');
  }

  current = {
    email,
    name: claims.name || email,
    picture: claims.picture || null,
    sub: claims.sub || null,
    domain: cfg.domainOf(email),
  };
  persist(tokens);
  fire();

  return {
    user: currentUser(),
    credential: { idToken: tokens.id_token, accessToken: tokens.access_token || null },
  };
}

/* ----------------------------------------------------------------- signOut -- */
function signOut() {
  clearPersisted();
  current = null;
  fire();
  return true;
}

/* -------------------------------------------------- restore previous login -- */
/**
 * Best-effort restore on launch. We only restore the *identity* (so the UI can
 * show a signed-in chip immediately); the renderer silently re-authenticates
 * Firebase using persisted Firebase state, and if that fails the user just
 * clicks sign in again. We do not silently exchange the refresh token here to
 * avoid holding long-lived Google access without a user action.
 */
function restore() {
  const saved = readPersisted();
  if (saved && saved.email && cfg.isAllowedEmail(saved.email)) {
    current = {
      email: saved.email,
      name: saved.email,
      picture: null,
      sub: null,
      domain: cfg.domainOf(saved.email),
      restored: true,
    };
    fire();
  }
  return state();
}

/* --------------------------------------------------------- signin-done page -- */
const SIGNIN_DONE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>ProGramerly</title>
<style>
  html,body{height:100%;margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;
    background:#0d1b2a;color:#e8eef5;display:grid;place-items:center;text-align:center}
  .card{max-width:440px;padding:40px}
  h1{font-size:20px;margin:0 0 8px;color:#00c6ff}
  p{opacity:.8;margin:6px 0}
</style></head><body>
<div class="card">
  <h1>Signed in to ProGramerly</h1>
  <p>You can close this tab and return to the app.</p>
  <p style="font-size:12px;opacity:.5">Antwerp Designs | Ionity (Pty) Ltd - Policy 986 AED</p>
</div>
<script>setTimeout(function(){window.close();},1200);</script>
</body></html>`;

module.exports = {
  signIn,
  signOut,
  restore,
  state,
  currentUser,
  onChange,
  // exported for unit testing (pure helpers live in shared/pkce.js)
  _internal: { createPkce, base64url, randomState, decodeJwt },
};
