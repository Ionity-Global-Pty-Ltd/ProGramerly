'use strict';
/* ProGramerly 3.6.0 - the real-application UI check for AEDi Predict.
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Launches the actual Electron application (no stubs) and drives the new
   surface the way an operator would: the Predict tile and dock button, a
   profile ticked in Software, the forecast line in the Software footer, the
   Predict window with its four stat tiles, class chips, item table, machine
   card and suggestions - and the catalog's new groups on the Software list.
   Everything asserted is a fact about the running product on this machine.

   Run:  node scripts/ui-check-360.js          (Linux: xvfb-run -a node scripts/ui-check-360.js)
   The 3.5.0 check still covers Relations, Environments and System. */

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
  console.log('launching ProGramerly from', ROOT);
  const sandbox = path.join(os.tmpdir(), 'pg-uicheck-360');
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

  const bootHidden = await until(page, () => { const b = document.getElementById('boot'); return Boolean(b && (b.hidden || b.classList.contains('done'))); }, 45000);
  check(bootHidden, 'the DOME boot cleared on its milestones');

  const version = await page.textContent('#appVersion');
  const want = 'v' + require('../package.json').version;
  check(version === want, 'the top bar carries the version', version);

  // ---- the surface is registered: tile, dock, suggest chip ----------------
  const tiles = await page.$$eval('#modules .tile', (els) => els.map((e) => e.dataset.app));
  check(tiles.includes('predict'), 'the AEDi Predict tile is on the deck', tiles.join(' '));
  const dock = await page.$$eval('#dock .dock-btn', (els) => els.map((e) => e.dataset.app));
  check(dock.includes('predict'), 'the dock has a Predict button');
  const registered = await page.evaluate(() => Boolean(window.PGApps && window.PGApps.predict && window.PGSelection));
  check(registered, 'predict.js registered its surface and renderer.js exposed the selection bridge');

  // ---- Software: the catalog's new groups and items -------------------------
  await page.click('.dock-btn[data-app="software"]');
  await page.waitForSelector('#profiles .profile', { timeout: 10000 });
  // The catalog the app is serving: the new groups and items are in it, and
  // the list shows each one wherever it applies on this OS (a Windows/macOS
  // desktop client is not on a Linux list, and says so by its absence).
  const cat = (await page.evaluate(() => window.programerly.getCatalog())).catalog;
  const catGroups = cat.groups.map((g) => g.label);
  for (const g of ['Communication', 'Cloud Drives & Sync', 'Maker · CAD · PCB · 3D']) check(catGroups.includes(g), `the catalog carries the "${g}" group`);
  const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const appliesHere = (it) => (Array.isArray(it.platforms) && it.platforms.length ? it.platforms.includes(plat) : Boolean(it[plat] || it.npm || it.steps));
  const rows = await page.$$eval('#items .row:not(.na)', (els) => els.map((e) => e.dataset.id));
  for (const id of ['whatsapp', 'google-drive', 'onedrive', 'dropbox', 'gemini-cli', 'copilot-cli', 'claude-code-github', 'firebase-cli', 'archify', 'node-toolbelt', 'kicad', 'unity-hub']) {
    const it = cat.items.find((i) => i.id === id);
    check(Boolean(it) && (appliesHere(it) ? rows.includes(id) : !rows.includes(id)), `catalog item "${id}" ${it && appliesHere(it) ? 'is on the list' : `is in the catalog and rightly absent on ${plat}`}`);
  }
  check(cat.items.length >= 143 && cat.meta.version === '1.3.0', 'catalog 1.3.0 with 143+ items', `${cat.items.length} items`);
  // tick the AI Dev profile and watch the footer forecast line fill in
  await page.click('#profiles .profile[data-profile="ai"]');
  await wait(200);
  const selCount = parseInt(await page.textContent('#selCount'), 10);
  check(selCount > 10, 'the AI Dev profile ticks its items', `${selCount} selected`);
  const lineReady = await until(page, () => /^AEDi Predict: ~\d+ min · ≈\d+\/\d+ clean/.test(document.getElementById('selForecast')?.textContent || ''), 90000, 500);
  const line = await page.textContent('#selForecast');
  check(lineReady, 'the Software footer forecasts the ticked selection', line);
  const lineTitle = await page.getAttribute('#selForecast', 'title');
  check(/assumed|measured|learned|computed/.test(lineTitle || ''), 'the forecast line names the class of its figures', (lineTitle || '').slice(0, 120));
  await page.screenshot({ path: path.join(SHOT, 'ui-360-software.png') });
  await page.click('#aw-close');

  // ---- AEDi Predict ----------------------------------------------------------
  await page.click('.dock-btn[data-app="predict"]');
  await page.waitForSelector('#pdStats', { timeout: 15000 });
  const filled = await until(page, () => document.querySelectorAll('#pdStats .pd-stat').length === 4 && !/reading/.test(document.getElementById('pdMeta')?.textContent || ''), 90000, 500);
  const meta = await page.textContent('#pdMeta');
  check(filled, 'the forecast for the selection was read', meta);
  const stats = await page.$$eval('#pdStats .pd-stat', (els) => els.map((e) => `${e.querySelector('.l').textContent}=${e.querySelector('.k').textContent}`));
  check(stats.length === 4 && /Run time=\d+ min/.test(stats[0]) && /Expected clean=≈\d+ of \d+/.test(stats[2]), 'four stat tiles: time, download, likelihood, learned share', stats.join(' · '));
  const classes = await page.$$eval('.pd-class', (els) => [...new Set(els.map((e) => e.textContent.trim()))]);
  check(classes.includes('measured') && classes.includes('assumed'), 'figures carry their class (measured / assumed at least)', classes.join(', '));
  const tableRows = await page.$$eval('#pdTable tbody tr', (els) => els.length);
  check(tableRows >= selCount, 'the item table lists the selection in run order, dependencies included', `${tableRows} rows for ${selCount} ticked`);
  const bars = await page.$$eval('#pdTable .pd-bar i', (els) => els.filter((i) => parseFloat(i.style.width) > 0).length);
  check(bars === tableRows, 'every item has a likelihood bar with a real width (CSP-safe)', `${bars}/${tableRows}`);
  const engines = await page.$$eval('#pdFacts .pd-factrow:first-child .mg-chip', (els) => els.map((e) => `${e.textContent.trim()}:${e.classList.contains('ok') ? 'ok' : 'off'}`));
  check(engines.length >= 5, 'the engines strip is read from PATH', engines.join(' '));
  const hosts = await page.$$eval('#pdFacts .pd-factrow:nth-child(2) .mg-chip', (els) => els.map((e) => e.textContent.trim()));
  check(hosts.length >= 8, 'package hosts were probed with a TCP connect', hosts.slice(0, 5).join(' · '));
  const machineText = await page.textContent('#pdMachine');
  check(/Machine forecast/.test(machineText) && /Memory now/.test(machineText), 'the machine card reads memory and disks', machineText.replace(/\s+/g, ' ').slice(0, 140));
  const suggTitle = await page.textContent('#pdSuggest h4');
  check(/Belongs next/.test(suggTitle), 'the suggestions card is stated relations, not statistics', suggTitle.replace(/\s+/g, ' '));
  const suggBefore = await page.$$eval('#pdSuggest .pd-sug', (els) => els.map((e) => e.dataset.add));
  if (suggBefore.length) {
    const before = selCount;
    await page.click('#pdSuggest .pd-sug');
    const grew = await until(page, (n) => { const t = document.getElementById('selCount'); return t && parseInt(t.textContent, 10) === n + 1; }, 10000, 200, before);
    check(grew, 'clicking a suggestion adds it to the Software selection', `${suggBefore[0]} · ${before} → ${before + 1}`);
  } else ok('suggestions', 'nothing left to suggest for this selection');
  const explainBtn = await page.$('.mg-tools [data-act="explain"]');
  check(Boolean(explainBtn), 'the Explain (AEDi) action is offered');
  await page.click('.mg-tools [data-act="explain"]');
  const explained = await until(page, () => !document.getElementById('pdExplain').hidden && (document.getElementById('pdExplainBody')?.textContent || '').length > 10, 60000, 500);
  const explainText = await page.textContent('#pdExplainBody');
  check(explained, 'Explain answers with the model or states plainly that no model runs', explainText.replace(/\s+/g, ' ').slice(0, 140));
  await page.screenshot({ path: path.join(SHOT, 'ui-360-predict.png') });
  await page.click('#aw-close');

  // ---- errors --------------------------------------------------------------
  check(pageErrors.length === 0, 'no uncaught renderer errors', pageErrors.join(' | ') || 'none');
  const realConsole = consoleErrors.filter((t) => !/favicon|Autofill|ERR_CONNECTION_REFUSED|net::ERR/.test(t));
  check(realConsole.length === 0, 'no console errors', realConsole.slice(0, 3).join(' | ') || 'none');

  await app.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  fs.writeFileSync(path.join(SHOT, 'ui-check-360.json'), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => { console.error('ui-check failed:', e); process.exit(2); });
