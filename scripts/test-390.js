#!/usr/bin/env node
'use strict';
/* ProGramerly - 3.9.0 unit tests: macOS password session, AEDi assistant
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Runs in plain Node (no Electron): `electron` is stubbed with a userData
   folder in a scratch directory and a reversible fake safeStorage.

     node scripts/test-390.js
*/

const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pg390-'));
const fakeElectron = {
  app: { getPath: () => scratch, getVersion: () => '3.9.0', runningUnderARM64Translation: false },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
    decryptString: (b) => Buffer.from(String(b).slice(4), 'base64').toString(),
  },
  shell: { openExternal() {}, openPath() {} },
};
const origLoad = Module._load;
Module._load = function load(req, ...rest) { return req === 'electron' ? fakeElectron : origLoad.call(this, req, ...rest); };

const ROOT = path.join(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

let passed = 0; let failed = 0;
const check = (cond, name, detail = '') => {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
};

(async () => {
  /* ---------------------------------------------------- macOS sudo rewrite */
  const macAuth = req('src/main/services/macAuth.js');
  const s = macAuth.sudoizeMac;
  check(s('sudo installer -pkg x.pkg -target /') === 'sudo -A installer -pkg x.pkg -target /', 'leading sudo becomes sudo -A');
  check(s('brew update && sudo xcodebuild -license accept') === 'brew update && sudo -A xcodebuild -license accept', 'sudo after && is rewritten');
  check(s('if x; then sudo ln -s a b; fi') === 'if x; then sudo -A ln -s a b; fi', 'sudo after then is rewritten');
  check(s('sudo -A true') === 'sudo -A true', 'an existing -A is left alone');
  check(s('echo pseudo sudoers') === 'echo pseudo sudoers', 'words containing sudo are untouched');
  check(s('(sudo true)') === '(sudo -A true)', 'sudo inside a subshell is rewritten');
  check(macAuth.active() === false && JSON.stringify(macAuth.env()) === '{}', 'no session, no askpass env');
  if (process.platform !== 'darwin') {
    const r = await macAuth.begin();
    check(r.ok && JSON.stringify(r.env) === '{}', 'begin() is a no-op off macOS');
  }

  /* ------------------------------------------------------ runner PATH */
  const runner = req('src/main/installer/runner.js');
  if (process.platform !== 'win32') {
    const before = process.env.PATH;
    process.env.PATH = '/usr/bin:/bin';
    const p = runner.hydratePath();
    check(p.startsWith('/opt/homebrew/bin:'), 'hydratePath puts Homebrew first');
    check(p.includes(`${os.homedir()}/.local/bin`), 'hydratePath expands $HOME');
    check(p.endsWith('/usr/bin:/bin'), 'hydratePath keeps the original PATH after');
    runner.hydratePath();
    check(process.env.PATH === p, 'hydratePath is idempotent');
    process.env.PATH = before;
    runner.setSessionEnv({ SUDO_ASKPASS: '/tmp/x' });
    const out = await runner.run('printf %s "$SUDO_ASKPASS"');
    check(out.output === '/tmp/x', 'session env reaches child processes');
    runner.setSessionEnv({});
    const tty = await runner.run('tty || true');
    check(/not a tty/i.test(tty.output), 'children run without a controlling terminal', tty.output.trim());
  }

  /* -------------------------------------------------- engine mac route */
  const engine = req('src/main/installer/engine.js');
  check(typeof engine.installItem === 'function', 'engine loads with macAuth wired in');

  /* ------------------------------------------------------ assistant */
  const settings = req('src/main/services/settings.js');
  const assistant = req('src/main/services/assistant.js');
  const st = assistant.status();
  check(st.localEnabled === false, 'local AI is OFF by default');
  check(st.claudeEnabled === false, 'Claude is OFF by default');
  check(settings.DEFAULTS.aiAutoBrief === false, 'launch brief is OFF by default');
  check((await assistant.targets()).length === 0, 'no targets until a provider is turned on');
  const blocked = await assistant.chat({ endpointId: 'ollama', model: 'x', messages: [] });
  check(!blocked.ok && /Local AI is off/.test(blocked.error), 'local chat refuses while local AI is off');
  const blocked2 = await assistant.chat({ endpointId: 'anthropic', model: 'x', messages: [] });
  check(!blocked2.ok && /Claude is switched off/.test(blocked2.error), 'Claude chat refuses while Claude is off');

  check(!assistant.setKey('hello').ok, 'a malformed key is refused');
  check(assistant.setKey(`sk-ant-api03-${'a'.repeat(40)}`).ok && assistant.hasKey(), 'a well-formed key is stored');
  const onDisk = fs.readFileSync(path.join(scratch, 'anthropic.key.enc'), 'utf8');
  check(!onDisk.includes('sk-ant-'), 'the key is not stored in plain text');
  const settingsText = fs.existsSync(settings.file()) ? fs.readFileSync(settings.file(), 'utf8') : '';
  check(!settingsText.includes('sk-ant-'), 'the key never reaches settings.json');
  settings.save({ aiClaudeEnabled: true, aiClaudeModel: 'claude-test' });
  const t = await assistant.targets();
  check(t.length === 1 && t[0].endpointId === 'anthropic' && t[0].cloud && t[0].preferred, 'Claude becomes the preferred target when on');
  check(/leaves this machine/.test(t[0].endpoint), 'the Claude target says it leaves the machine');
  assistant.setKey('');
  check(!assistant.hasKey() && assistant.status().claudeEnabled === false, 'removing the key turns Claude off');

  const conv = assistant._toAnthropic([
    { role: 'system', content: 'S1' }, { role: 'assistant', content: 'orphan' },
    { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' },
  ]);
  check(conv.system === 'S1', 'system prompts move to the system field');
  check(conv.messages[0].role === 'user' && conv.messages[0].content === 'a\n\nb', 'leading assistant dropped, consecutive users merged');
  check(conv.messages.length === 2 && conv.messages[1].role === 'assistant', 'turns alternate');
  check(JSON.stringify(assistant._firstJsonArray('Because.\n["git","node"]')) === '["git","node"]', 'recommendation ids parse from the reply');
  check(assistant._firstJsonArray('no list here') === null, 'a reply without ids parses to null');

  /* recommend() keeps only ids that exist and apply here */
  settings.save({ aiLocalEnabled: true });
  const ai = req('src/main/services/ai.js');
  ai.chatTargets = async () => [{ endpointId: 'ollama', endpoint: 'Ollama', port: 11434, model: 'fake' }];
  ai.chat = async (_r, onToken) => { onToken({ token: 'x' }); return { ok: true, text: 'Git and Node for web work.\n["git","nodejs","not-a-real-item"]' }; };
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/main/catalog/catalog.json'), 'utf8'));
  const rec = await assistant.recommend({ text: 'web apps', catalog, applies: () => true });
  check(rec.ok && rec.ids.includes('git') && !rec.ids.includes('not-a-real-item'), 'recommend drops invented ids', JSON.stringify(rec.ids));
  check(/Git and Node/.test(rec.why), 'recommend returns the one-line reason');
  const run = await assistant.explainRun({ results: [{ id: 'git', status: 'ok' }], queue: [] });
  check(run.ok && /Nothing failed/.test(run.text), 'explainRun with no failures does not call a model');

  /* ------------------------------------------------- catalog: AI opt-in */
  const inDefault = catalog.items.filter((i) => /^ollama/.test(i.id) && (i.profiles || []).some((p) => p === 'full' || p === 'ai'));
  check(inDefault.length === 0, 'no profile preselects local AI', inDefault.map((i) => i.id).join(','));

  /* --------------------------------------------- mac packaging config */
  const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  check(/afterPack:\s*scripts\/after-pack\.js/.test(yml), 'afterPack ad-hoc signing hook is configured');
  check(/hardenedRuntime:\s*false/.test(yml), 'hardened runtime is off for ad-hoc builds');
  const hook = req('scripts/after-pack.js');
  await hook.default({ electronPlatformName: 'linux' });
  check(true, 'afterPack ignores non-mac targets');

  console.log(`\n${passed}/${passed + failed} checks passed`);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
