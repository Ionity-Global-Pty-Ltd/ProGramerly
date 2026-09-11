#!/usr/bin/env node
'use strict';
/* ProGramerly - Firebase rules + auth-allowlist tests
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Two layers:
   1. ALWAYS runs: pure-logic tests of the domain allowlist + quota maths from
      src/shared/firebase.config.js. No network, no emulator, safe in CI.
   2. OPTIONAL: full Firestore/Storage security-rule tests against the Firebase
      emulator, using @firebase/rules-unit-testing. Skipped (exit 0) when the
      dependency is not installed or the emulator is not reachable, so CI never
      hard-fails on an environment that does not provision Java + the emulator.

   Run the full suite locally with:
     firebase emulators:exec "node scripts/test-rules.js"                       */

const path = require('node:path');

const cfg = require(path.join(__dirname, '..', 'src', 'shared', 'firebase.config.js'));
const pkce = require(path.join(__dirname, '..', 'src', 'shared', 'pkce.js'));

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.error(`  FAIL ${name}`);
    failures += 1;
  }
}

/* ----------------------------------------------------------- layer 1 ---- */
console.log('Allowlist + quota logic (always runs)');

check('ionity.today email is internal', cfg.isAllowedEmail('jo@ionity.today'));
check('ionity.digital email is internal', cfg.isAllowedEmail('sam@ionity.digital'));
check('mixed case domain is internal', cfg.isAllowedEmail('JO@IONITY.TODAY'));
check('gmail is rejected', !cfg.isAllowedEmail('someone@gmail.com'));
check('lookalike domain is rejected', !cfg.isAllowedEmail('x@ionity.today.evil.com'));
check('empty email is rejected', !cfg.isAllowedEmail(''));
check('null email is rejected', !cfg.isAllowedEmail(null));
check('no-at email is rejected', !cfg.isAllowedEmail('notanemail'));
check('domainOf extracts host', cfg.domainOf('a@b.com') === 'b.com');

check('pool is exactly 1 GiB', cfg.STORAGE_POOL_BYTES === 1073741824);

// PKCE + JWT helpers (shared/pkce.js)
const p1 = pkce.createPkce();
const p2 = pkce.createPkce();
check('pkce verifier is url-safe', /^[A-Za-z0-9_-]+$/.test(p1.verifier));
check('pkce challenge is url-safe', /^[A-Za-z0-9_-]+$/.test(p1.challenge));
check('pkce verifier differs from challenge', p1.verifier !== p1.challenge);
check('pkce pairs are random each call', p1.verifier !== p2.verifier);
check('randomState is url-safe + non-empty', /^[A-Za-z0-9_-]{8,}$/.test(pkce.randomState()));
check('decodeJwt reads email claim', (() => {
  const payload = Buffer.from(JSON.stringify({ email: 'x@ionity.today', email_verified: true }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const claims = pkce.decodeJwt(`h.${payload}.sig`);
  return claims.email === 'x@ionity.today' && claims.email_verified === true;
})());
check('decodeJwt is safe on garbage', Object.keys(pkce.decodeJwt('not-a-jwt')).length === 0);
check('placeholder is reported unconfigured', cfg.isConfigured() === false);
check('a filled config reports configured', cfg.isConfigured({
  apiKey: 'AIzaLooksReal', projectId: 'ionity-progr',
}) === true);

/* ----------------------------------------------------------- layer 2 ---- */
async function rulesTests() {
  let testing;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    testing = require('@firebase/rules-unit-testing');
  } catch {
    console.log('\nSecurity-rule tests SKIPPED - @firebase/rules-unit-testing not installed.');
    console.log('Install it and run under the emulator to exercise the full rules:');
    console.log('  npm i -D @firebase/rules-unit-testing firebase');
    console.log('  firebase emulators:exec "node scripts/test-rules.js"');
    return;
  }

  const fs = require('node:fs');
  const {
    initializeTestEnvironment, assertFails, assertSucceeds,
  } = testing;

  let env;
  try {
    env = await initializeTestEnvironment({
      projectId: 'programerly-rules-test',
      firestore: {
        rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      },
      storage: {
        rules: fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8'),
      },
    });
  } catch (e) {
    console.log(`\nSecurity-rule tests SKIPPED - emulator not reachable (${e.message}).`);
    return;
  }

  console.log('\nFirestore/Storage security rules (emulator)');

  const internal = env.authenticatedContext('u-internal', {
    email: 'dev@ionity.today', email_verified: true,
  });
  const internal2 = env.authenticatedContext('u-internal2', {
    email: 'ops@ionity.digital', email_verified: true,
  });
  const outsider = env.authenticatedContext('u-outsider', {
    email: 'nope@gmail.com', email_verified: true,
  });
  const anon = env.unauthenticatedContext();

  const doc = (ctx, p) => ctx.firestore().doc(p);

  // activity: internal can create own, outsider cannot, nobody can create for
  // another uid.
  await assertSucceeds(doc(internal, 'activity/e1').set({
    uid: 'u-internal', type: 'login', ts: Date.now(),
  }));
  console.log('  ok   internal user writes own activity');

  await assertFails(doc(outsider, 'activity/e2').set({
    uid: 'u-outsider', type: 'login', ts: Date.now(),
  }));
  console.log('  ok   outsider (gmail) cannot write activity');

  await assertFails(doc(internal, 'activity/e3').set({
    uid: 'someone-else', type: 'login', ts: Date.now(),
  }));
  console.log('  ok   internal user cannot forge another uid');

  await assertSucceeds(doc(internal2, 'activity/e1').get());
  console.log('  ok   internal user reads team activity');

  await assertFails(doc(anon, 'activity/e1').get());
  console.log('  ok   anonymous cannot read activity');

  // org pool counter: cap enforced.
  await assertSucceeds(doc(internal, 'org/shared').set({ usedBytes: 500 }));
  console.log('  ok   internal user updates pool counter within cap');

  await assertFails(doc(internal, 'org/shared').set({ usedBytes: 1073741825 }));
  console.log('  ok   pool counter cannot exceed 1 GiB');

  await env.cleanup();
}

rulesTests()
  .catch((e) => { console.error(e); failures += 1; })
  .finally(() => {
    if (failures) {
      console.error(`\n${failures} check(s) failed`);
      process.exit(1);
    }
    console.log('\nrules + allowlist OK');
  });
