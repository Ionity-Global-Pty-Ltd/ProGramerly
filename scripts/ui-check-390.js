#!/usr/bin/env node
'use strict';
/* ProGramerly - 3.9.0 UI check: AEDi providers (off by default), Suggest with AEDi, macOS layout
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Launches the real Electron app under Playwright on a fresh profile and
   checks what 3.9.0 changed: AI starts OFF everywhere, the providers card,
   the recommend bar, the Doctor and run-summary explain buttons, and that
   nothing regressed in the renderer. Run after `npm install --include=dev`:

     node scripts/ui-check-390.js
*/

const path = require('path');
const fs = require('fs');
const os = require('os');

function loadPlaywright() {
  try { return require('playwright-core'); } catch { throw new Error('playwright-core is not installed. Run: npm install --include=dev'); }
}
const { _electron: electron } = loadPlaywright();

const ROOT = path.join(__dirname, '..');
const EXE = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  : (process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'));
const SHOT = path.join(ROOT, 'docs', 'screenshots', '3.9.0');

let passed = 0;
let failed = 0;
const ok = (name, detail) => { passed += 1; console.log(`  ok   ${name}${detail ? ` - ${detail}` : ''}`); };
const bad = (name, detail) => { failed += 1; console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function until(page, fn, timeoutMs = 30000, every = 300, arg) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    let v = false;
    try { v = await page.evaluate(fn, arg); } catch { v = false; }
    if (v) return true;
    await wait(every);
  }
  return false;
}

async function mainWindow(app, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const w of app.windows()) {
      let url = ''; try { url = w.url(); } catch { url = ''; }
      if (url.includes('index.html')) return w;
    }
    await wait(400);
  }
  throw new Error('the shell window never appeared');
}


async function run() {
  if (!fs.existsSync(EXE)) throw new Error(`electron is not installed at ${EXE}`);
  fs.mkdirSync(SHOT, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-uicheck-390-'));
  const app = await electron.launch({
    executablePath: EXE,
    args: [ROOT, '--elevated', `--user-data-dir=${sandbox}`, '--no-sandbox'],
    cwd: ROOT,
  });
  const consoleErrors = [];
  const pageErrors = [];
  const page = await mainWindow(app);
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  ok('the shell window is up', page.url().split('/').pop());

  check(await until(page, () => { const b = document.getElementById('boot'); return Boolean(b && (b.hidden || b.classList.contains('done'))); }, 45000), 'the DOME boot cleared');
  const version = await page.textContent('#appVersion');
  check(version === 'v3.9.0', 'the top bar carries v3.9.0', version);

  const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  check(await page.evaluate((p) => document.body.classList.contains(`os-${p}`), plat), `the body carries os-${plat} before first paint`);

  // ---- AI is off on a fresh profile ------------------------------------
  const st = await page.evaluate(() => window.programerly.assistant.status());
  check(!st.localEnabled && !st.claudeEnabled && !st.claudeKey, 'fresh profile: local AI off, Claude off, no key', JSON.stringify(st));
  const settings = await page.evaluate(() => window.programerly.getSettings());
  check(settings.aiAutoBrief === false, 'fresh profile: no launch brief');
  check(await until(page, () => /AEDi · off/.test(document.getElementById('engine-label')?.textContent || ''), 30000), 'the engine chip says AEDi is off', await page.textContent('#engine-label'));
  check(await page.evaluate(() => document.getElementById('ask-send').disabled), 'the ask box is disabled while AI is off');
  check(await page.evaluate(() => !document.getElementById('brief') || document.getElementById('brief').hidden || !document.body.classList.contains('brief-on')), 'no brief panel opened at launch');
  check((await page.evaluate(() => window.programerly.aiTargets())).length === 0, 'no chat targets while both providers are off');
  await page.screenshot({ path: path.join(SHOT, 'ui-390-home.png') });

  // ---- Providers card ---------------------------------------------------
  await page.click('.dock-btn[data-app="ai"]');
  await page.waitForSelector('#aiProviders', { state: 'visible', timeout: 15000 });
  check(!(await page.isChecked('#aiLocalOn')) && !(await page.isChecked('#aiClaudeOn')), 'both provider boxes start unticked');
  check(await page.isDisabled('#aiClaudeOn'), 'Claude cannot be ticked before a key is stored');
  await page.fill('#aiClaudeKey', 'not-a-key');
  await page.click('#aiClaudeSave');
  check(await until(page, () => /does not look like an Anthropic API key/.test(document.getElementById('aiClaudeNote')?.textContent || ''), 10000), 'a malformed key is refused with a reason');
  check(await page.inputValue('#aiClaudeKey') === '', 'the key field is cleared after a save attempt');

  await page.check('#aiLocalOn');
  check(await until(page, () => /On: local AI/.test(document.getElementById('aiProvState')?.textContent || ''), 10000), 'turning local AI on is reflected', await page.textContent('#aiProvState'));
  const st2 = await page.evaluate(() => window.programerly.assistant.status());
  check(st2.localEnabled === true, 'the setting persisted in the main process');
  await page.screenshot({ path: path.join(SHOT, 'ui-390-providers.png') });
  await page.uncheck('#aiLocalOn');
  check(await until(page, () => /Both off/.test(document.getElementById('aiProvState')?.textContent || ''), 10000), 'and off again');
  await page.click('#aw-close');

  // ---- Software: profiles no longer tick local AI; recommend bar --------
  await page.click('.dock-btn[data-app="software"]');
  await page.waitForSelector('#profiles .profile', { timeout: 10000 });
  await page.click('#profiles .profile[data-profile="full"]');
  await wait(300);
  check(!(await page.isChecked('#aediTick')), 'Full Stack leaves the AEDi local core unticked');
  const ticked = await page.evaluate(() => window.PGSelection.get());
  check(!ticked.some((id) => /^ollama/.test(id)), 'no Ollama item in the Full Stack selection');
  check(await page.isVisible('#recText') && await page.isDisabled('#recBtn'), 'Suggest with AEDi is visible and disabled while AI is off');
  await page.screenshot({ path: path.join(SHOT, 'ui-390-software.png') });

  // Every profile card still fits at the minimum width.
  await page.setViewportSize({ width: 980, height: 680 }).catch(() => {});
  await wait(400);
  const overflow = await page.evaluate(() => {
    const p = document.getElementById('profiles'); if (!p) return 'no profiles';
    return [...p.querySelectorAll('.profile')].filter((e) => e.getBoundingClientRect().right > p.getBoundingClientRect().right + 1).length;
  });
  check(overflow === 0, 'all profile cards fit at 980 px', String(overflow));
  const recFits = await page.evaluate(() => { const r = document.getElementById('aediRecommend'); return r && r.scrollWidth <= r.clientWidth + 1; });
  check(recFits, 'the recommend bar does not overflow at 980 px');
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await page.click('#aw-close');

  // ---- Doctor: explain button waits for a scan ---------------------------
  await page.click('.dock-btn[data-app="doctor"]');
  await page.waitForSelector('#docAiBtn', { state: 'visible', timeout: 10000 });
  check(await page.isDisabled('#docAiBtn'), 'Explain with AEDi is disabled before a scan');
  await page.click('#docScanBtn');
  check(await until(page, () => document.querySelectorAll('#docList .dcheck').length > 3, 90000, 500), 'Doctor scan completes');
  check(!(await page.isDisabled('#docAiBtn')), 'Explain with AEDi enables after the scan');
  await page.click('#docAiBtn');
  check(await until(page, () => /Turn on an AI provider/.test(document.getElementById('docAi')?.textContent || ''), 10000), 'with AI off it says how to turn it on');
  await page.click('#aw-close');

  // ---- Assistant IPC guards -------------------------------------------
  const rec = await page.evaluate(() => window.programerly.assistant.recommend('python data'));
  check(!rec.ok && /No AI provider is on/.test(rec.error), 'recommend refuses with no provider', rec.error);
  const er = await page.evaluate(() => window.programerly.assistant.explainRun());
  check(!er.ok && /No install has run/.test(er.error), 'explainRun refuses before any run', er.error);
  const dm = await page.evaluate(() => window.programerly.dome.ask({ question: 'hi' }));
  check(!dm.ok && /No AI provider is on/.test(dm.error || ''), 'the DOME ask refuses with no provider', dm.error);

  check(!pageErrors.length, 'no uncaught renderer errors', pageErrors.join(' | ') || 'none');
  check(!consoleErrors.length, 'no console errors', consoleErrors.slice(0, 3).join(' | ') || 'none');

  await app.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
  console.log(`\n${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('ui-check-390 failed:', e.message); process.exit(2); });
