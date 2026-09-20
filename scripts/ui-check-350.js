'use strict';
/* ProGramerly 3.5.0 - the real-application UI check.
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Launches the actual Electron application (no stubs, no fixtures) on
   Windows, macOS or Linux (under Xvfb where there is no display) and drives
   the shell the way an operator would: AEDi chip, the Relations graph, the
   Environments maker, the System tables, the AEDi tick in Software, and the
   honesty of every DOME score source. Everything asserted is a fact about the
   running product on this machine.

   Run:  node scripts/ui-check-350.js          (Linux: xvfb-run -a node scripts/ui-check-350.js) */

const path = require('path');
const fs = require('fs');
const os = require('os');

function loadPlaywright() {
  try { return require('playwright-core'); } catch { throw new Error('playwright-core is not installed. Run: npm install --include=dev'); }
}
const { _electron: electron } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
const SHOT = path.join(ROOT, 'Claude outputs');
const EXE = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  : process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

const results = [];
const ok = (name, detail) => { results.push({ pass: true, name, detail }); console.log(`  ok   ${name}${detail ? ` - ${detail}` : ''}`); };
const bad = (name, detail) => { results.push({ pass: false, name, detail }); console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Polled through page.evaluate rather than waitForFunction: the renderer runs
   under script-src 'self', which blocks the in-page eval waitForFunction uses. */
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
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
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
  console.log('launching ProGramerly from', ROOT);
  const sandbox = path.join(os.tmpdir(), 'pg-uicheck-350');
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
  ok('the shell window is up', page.url().split('/').pop());

  // ---- boot: the DOME boot clears on real milestones ----------------------
  const bootHidden = await until(page, () => { const b = document.getElementById('boot'); return Boolean(b && (b.hidden || b.classList.contains('done'))); }, 45000);
  check(bootHidden, 'the DOME boot cleared on its milestones');
  await page.screenshot({ path: path.join(SHOT, 'ui-350-deck.png') });

  // ---- AEDi branding is real: the chip names AEDi and states the model or the gap ----
  const chip = await page.textContent('#engine-label');
  check(/^AEDi ·/.test(chip || ''), 'the engine chip is AEDi', chip);
  const chipTitle = await page.getAttribute('#engine-chip', 'title');
  check(/Ollama/.test(chipTitle || ''), 'the chip says AEDi is powered by Ollama', chipTitle);
  const ph = await page.getAttribute('#ask-input', 'placeholder');
  check(/AEDi/.test(ph || ''), 'the ask box asks AEDi', ph);

  // ---- tiles: the new surfaces are on the deck -----------------------------
  const tiles = await page.$$eval('#modules .tile', (els) => els.map((e) => e.dataset.app));
  for (const id of ['relations', 'envs', 'system']) check(tiles.includes(id), `tile "${id}" is on the deck`);

  // ---- the DOME: 26 segments, no constant scored as 'measured' -------------
  const ov = await page.evaluate(() => window.programerly.dome.overview());
  check(ov.counts.segments === 26, 'the dome has 26 segments', String(ov.counts.segments));
  check(ov.counts.datasets === 34 && ov.counts.presets === 14, 'registry: 34 sets · 14 presets', `${ov.counts.datasets} / ${ov.counts.presets}`);
  const segs = ov.strata.flatMap((s) => s.segments);
  const constantMeasured = segs.filter((g) => g.value === 100 && g.source === 'measured' && !/free share|VRAM/i.test(g.detail || ''));
  check(constantMeasured.length === 0, 'no constant 100% is labelled "measured"', constantMeasured.map((g) => g.id).join(', ') || 'clean');
  const prc = segs.find((g) => g.id === 'processes');
  check(Boolean(prc), 'the Processes and services segment exists', prc && `${prc.label} · ${prc.source}`);
  const pay = segs.find((g) => g.id === 'payload');
  check(!/all pins match/.test((pay && pay.detail) || '') || (pay && pay.detail.includes('hashed and matched')), 'payload never claims a hash check that did not run', pay && pay.detail);
  const sources = [...new Set(segs.map((g) => g.source))];
  ok('score sources in use', sources.join(', '));

  // ---- Relations -----------------------------------------------------------
  await page.click('.dock-btn[data-app="relations"]');
  await page.waitForSelector('#relCanvas', { timeout: 15000 });
  await until(page, () => /nodes|could not/.test(document.getElementById('relMeta')?.textContent || ''), 90000);
  const relMeta = await page.textContent('#relMeta');
  check(/\d+ nodes · \d+ relations/.test(relMeta), 'the Relations graph is built from this machine', relMeta);
  const kinds = await page.$$eval('#relKinds .rel-kind', (els) => els.map((e) => e.textContent.trim()));
  check(kinds.some((k) => /Processes/.test(k)), 'the graph carries real processes', kinds.join(' · '));
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT, 'ui-350-relations.png') });
  // find the machine node by its hostname and open its panel
  await page.fill('#relSearch', os.hostname());
  await page.press('#relSearch', 'Enter');
  await wait(400);
  const sideShown = await page.evaluate(() => !document.getElementById('relSide').hidden);
  check(sideShown, 'searching the hostname opens the machine node panel', (await page.textContent('#relSide .rs-head').catch(() => '')).trim().slice(0, 120));
  const actions = await page.$$eval('#relSide .rs-actions .btn', (els) => els.map((e) => e.textContent.trim()));
  check(actions.includes('Ask AEDi'), 'the node panel offers Ask AEDi', actions.join(' · '));
  const relCount = await page.$$eval('#relSide .rs-link', (els) => els.length);
  check(relCount >= 5, 'the machine node lists its relations', `${relCount} links`);
  await page.screenshot({ path: path.join(SHOT, 'ui-350-relations-node.png') });
  await page.click('#aw-close');

  // ---- Environments --------------------------------------------------------
  await page.click('.dock-btn[data-app="envs"]');
  await page.waitForSelector('#envTools .mg-chip', { timeout: 30000 });
  const builders = await page.$$eval('#envTools .mg-chip', (els) => els.map((e) => `${e.textContent.trim()}:${e.classList.contains('ok') ? 'ok' : e.classList.contains('warn') ? 'warn' : 'off'}`));
  check(builders.length >= 5, 'the builders strip reads real tool availability', builders.join(' '));
  await page.click('.mg-tools [data-act="new"]');
  await page.waitForSelector('#envNew:not([hidden]) .mg-kind', { timeout: 5000 });
  const kindsN = await page.$$eval('#envNew .mg-kind', (els) => els.length);
  check(kindsN === 5, 'five environment kinds are offered', String(kindsN));
  await page.screenshot({ path: path.join(SHOT, 'ui-350-envs.png') });
  // make a real venv through the surface, see it appear, remove it again
  const pythonOk = builders.some((b) => /^Python.*:ok$/.test(b));
  if (pythonOk) {
    const envName = `pg-check-${Date.now().toString(36)}`;
    await page.fill('#envName', envName);
    await page.fill('#envPackages', 'six');
    await page.evaluate(() => { const g = document.getElementById('envGit'); if (g && g.checked) g.click(); });
    await page.click('#envCreateBtn');
    const made = await until(page, (name) => [...document.querySelectorAll('#envList .mg-card b')].some((b) => b.textContent === name), 240000, 500, envName);
    const cards = await page.$$eval('#envList .mg-card b', (els) => els.map((e) => e.textContent));
    check(made || cards.includes(envName), 'a real venv was created through the surface and listed', cards.join(', '));
    if (cards.includes(envName)) {
      const idx = cards.indexOf(envName);
      const cardEls = await page.$$('#envList .mg-card');
      const el = cardEls[idx];
      await el.$eval('[data-do="packages"]', (b) => b.click());
      const pk = await until(page, () => /packages/.test(document.querySelector('#envList .mg-card-out:not([hidden]) small')?.textContent || ''), 60000);
      check(pk, 'pip list read from the new venv', await page.$eval('#envList .mg-card-out:not([hidden]) small', (e) => e.textContent).catch(() => ''));
      page.once('dialog', (d) => d.accept());
      await el.$eval('[data-do="remove"]', (b) => b.click());
      const gone = await until(page, () => ![...document.querySelectorAll('#envList .mg-card b')].some((b) => /^pg-check-/.test(b.textContent)), 60000);
      check(gone, 'the venv was removed again through the surface');
    }
  } else ok('venv round-trip skipped', 'Python is not on this machine');
  await page.click('#aw-close');

  // ---- System --------------------------------------------------------------
  await page.click('.dock-btn[data-app="system"]');
  await until(page, () => /from/.test(document.getElementById('sysMeta')?.textContent || '') && document.querySelectorAll('#sysTable tbody tr').length > 0, 60000);
  const sysMeta = await page.textContent('#sysMeta');
  const procRows = await page.$$eval('#sysTable tbody tr', (els) => els.length);
  check(procRows > 5, 'the Processes table lists this machine\'s processes', `${procRows} rows · ${sysMeta}`);
  const endBtns = await page.$$eval('#sysTable [data-do="kill"]', (els) => els.length);
  check(endBtns === procRows, 'every process has an End action', String(endBtns));
  for (const tab of ['services', 'startup', 'listeners']) {
    await page.click(`#sysTabs [data-tab="${tab}"]`);
    await until(page, () => { const t = document.querySelector('#sysTable tbody tr'); return t && !/reading…/.test(t.textContent); }, 90000);
    const first = await page.$eval('#sysTable tbody tr', (tr) => tr.textContent.trim().replace(/\s+/g, ' ').slice(0, 140)).catch(() => '');
    const rows = await page.$$eval('#sysTable tbody tr:not(.none)', (els) => els.length);
    // A read that returns nothing is reported as such - a stated empty is a pass, a blank table is not.
    check(first && !/reading…/.test(first), `System · ${tab} read`, `${rows} row(s) · ${first}`);
  }
  await page.screenshot({ path: path.join(SHOT, 'ui-350-system.png') });
  await page.click('#aw-close');

  // ---- Software: the AEDi tick adds Ollama + a model to the selection --------
  await page.click('.dock-btn[data-app="software"]');
  await page.waitForSelector('#aediTick', { timeout: 10000 });
  await page.evaluate(() => { const t = document.getElementById('aediTick'); if (!t.checked) t.click(); });
  await wait(200);
  const state = await page.textContent('#aediState');
  check(/Ollama/.test(state), 'the AEDi tick reads whether Ollama is really running', state);
  await page.evaluate(() => { const t = document.getElementById('aediTick'); if (t.checked) t.click(); });
  await wait(150);
  const before = await page.textContent('#selCount');
  await page.evaluate(() => document.getElementById('aediTick').click());
  await wait(150);
  const after = await page.textContent('#selCount');
  check(parseInt(after, 10) === parseInt(before, 10) + 2, 'ticking AEDi adds Ollama + the starter model to the install', `${before} → ${after}`);
  await page.click('#aw-close');

  // ---- errors --------------------------------------------------------------
  check(pageErrors.length === 0, 'no uncaught renderer errors', pageErrors.join(' | ') || 'none');
  const realConsole = consoleErrors.filter((t) => !/favicon|Autofill|ERR_CONNECTION_REFUSED|net::ERR/.test(t));
  check(realConsole.length === 0, 'no console errors', realConsole.slice(0, 3).join(' | ') || 'none');

  await app.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  fs.writeFileSync(path.join(SHOT, 'ui-check-350.json'), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => { console.error('ui-check failed:', e); process.exit(2); });
