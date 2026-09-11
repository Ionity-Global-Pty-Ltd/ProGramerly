'use strict';
/**
 * ProGramerly - Firebase web configuration (built-in Ionity project)
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * ---------------------------------------------------------------------------
 * THIS IS A PLACEHOLDER. Fill it in with your Firebase project's web config.
 * ---------------------------------------------------------------------------
 *
 * A Firebase *web* config is NOT a secret. It only identifies which project a
 * client talks to. All actual security is enforced by:
 *   - Firebase Authentication (Google provider), and
 *   - the Firestore/Storage security rules in this repo
 *     (firestore.rules / storage.rules), which restrict every read and write
 *     to authenticated users whose email domain is on the internal allowlist.
 *
 * How to get these values:
 *   Firebase console -> Project settings -> General -> "Your apps" -> Web app
 *   -> SDK setup and configuration -> Config.
 * See docs/FIREBASE-SETUP.md for the full walkthrough.
 *
 * A non-Ionity user can override every field of this at runtime from
 * Settings -> Cloud (stored encrypted via the OS keychain), so they can point
 * ProGramerly at their own free Firebase project without editing this file.
 */

/**
 * The internal Ionity allowlist. Only these email domains may sign in and
 * touch cloud data. Enforced client-side AND in the security rules.
 * Keep this in sync with firestore.rules / storage.rules.
 * @type {string[]}
 */
const ALLOWED_DOMAINS = ['ionity.today', 'ionity.digital'];

/**
 * The shared organisation storage pool, in bytes. 1 GiB.
 * Enforced client-side before upload AND in storage.rules.
 */
const STORAGE_POOL_BYTES = 1 * 1024 * 1024 * 1024;

/**
 * Google OAuth 2.0 Desktop client ID + the loopback PKCE flow settings used by
 * the main process (src/main/services/firebaseAuth.js). This is a "Desktop
 * app" OAuth client created in the Google Cloud console for the SAME project.
 * The client secret for a Desktop client is not confidential in the classic
 * sense, but we still keep it out of the committed placeholder - paste it into
 * Settings -> Cloud, or set PROGRAMERLY_GOOGLE_CLIENT_SECRET in the environment
 * for local development.
 */
const GOOGLE_OAUTH = {
  // Google Cloud console -> APIs & Services -> Credentials
  // -> Create credentials -> OAuth client ID -> Application type: Desktop app
  clientId: 'REPLACE_WITH_GOOGLE_DESKTOP_OAUTH_CLIENT_ID.apps.googleusercontent.com',
  // Left blank on purpose - supplied at runtime (Settings or env var).
  clientSecret: '',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  // Requested so we can read the email + verify its domain.
  scopes: ['openid', 'email', 'profile'],
};

/**
 * The Firebase web config. Replace every REPLACE_WITH_* value.
 * @type {{
 *   apiKey: string, authDomain: string, projectId: string,
 *   storageBucket: string, messagingSenderId: string, appId: string
 * }}
 */
const FIREBASE_WEB_CONFIG = {
  apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
  authDomain: 'REPLACE_WITH_PROJECT.firebaseapp.com',
  projectId: 'REPLACE_WITH_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_PROJECT.appspot.com',
  messagingSenderId: 'REPLACE_WITH_SENDER_ID',
  appId: 'REPLACE_WITH_APP_ID',
};

/** True when the placeholder has not been filled in yet. */
function isConfigured(cfg = FIREBASE_WEB_CONFIG) {
  return Boolean(
    cfg
    && cfg.apiKey
    && !String(cfg.apiKey).startsWith('REPLACE_WITH')
    && cfg.projectId
    && !String(cfg.projectId).startsWith('REPLACE_WITH'),
  );
}

/** Returns the domain (lower-cased) of an email, or '' if malformed. */
function domainOf(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

/** True when an email belongs to an internal Ionity domain. */
function isAllowedEmail(email, domains = ALLOWED_DOMAINS) {
  const d = domainOf(email);
  return Boolean(d) && domains.includes(d);
}

const api = {
  ALLOWED_DOMAINS,
  STORAGE_POOL_BYTES,
  GOOGLE_OAUTH,
  FIREBASE_WEB_CONFIG,
  isConfigured,
  domainOf,
  isAllowedEmail,
};

// Usable from the Electron main process (CommonJS) and, via a small shim in
// cloud.js, from the renderer.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
