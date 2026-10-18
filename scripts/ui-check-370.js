#!/usr/bin/env node
'use strict';
/* ProGramerly - 3.7.0 UI check: the IDE Lab, Maker & Embedded, Linux installs
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Launches the real Electron app under Playwright and checks what 3.7.0 added
   to the Software list: the fifth profile, the new IDE / embedded / WSL items,
   the Linux engines on the Predict strip, and that nothing regressed in the
   renderer. Run after `npm install --include=dev`:

     node scripts/ui-check-370.js
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
const SHOT = path.join(ROOT, 'docs', 'screenshots', '3.7.0');

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

const NEW_ITEMS = [
  'kiro', 'kiro-cli', 'visual-studio', 'visual-studio-2022', 'vscode-insiders',
  'intellij-idea', 'pycharm', 'webstorm', 'rider', 'clion', 'eclipse', 'sublime-text',
  'notepad-plus-plus', 'helix-lapce', 'github-desktop', 'mcp-config-ides',
  'arduino', 'esp-idf', 'embedded-vscode', 'serial-tools', 'pi-imager', 'stm32-tools',
  'processing', 'wsl', 'wsl-devtools', 'wsl-distros', 'linux-pkg',
];

async function run() {
  if (!fs.existsSync(EXE)) throw new Error(`electron is not installed at ${EXE}`);
  fs.mkdirSync(SHOT, { recursive: true });
  console.log('launching ProGramerly from', ROOT);
  const sandbox = path.join(os.tmpdir(), 'pg-uicheck-370');
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
  check(version === `v${require('../package.json').version}`, 'the top bar carries the version', version);

  // ---- Software: profiles ---------------------------------------------------
  await page.click('.dock-btn[data-app="software"]');
  await page.waitForSelector('#profiles .profile', { timeout: 10000 });
  const profiles = await page.$$eval('#profiles .profile', (els) => els.map((e) => e.dataset.profile));
  check(profiles.join(',') === 'full,ai,minimal,embedded,custom', 'five profiles, Custom last', profiles.join(' '));
  const embLabel = await page.textContent('#profiles .profile[data-profile="embedded"]');
  check(/Maker\s*&\s*Embedded/.test(embLabel || ''), 'the fifth profile is Maker & Embedded', (embLabel || '').trim().split('\n')[0]);

  const cat = (await page.evaluate(() => window.programerly.getCatalog())).catalog;
  check(cat.meta.version >= '1.4.0' && cat.items.length >= 166, 'catalog 1.4.0+ with 166+ items', `${cat.meta.version} · ${cat.items.length} items`);
  check(Object.keys(cat.profiles).length === 5 && cat.profiles.embedded, 'the catalog declares the embedded profile');

  const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const appliesHere = (it) => (Array.isArray(it.platforms) && it.platforms.length ? it.platforms.includes(plat) : Boolean(it[plat] || it.npm || it.steps));
  const rows = await page.$$eval('#items .row:not(.na)', (els) => els.map((e) => e.dataset.id));
  let present = 0; let absentRight = 0; const wrong = [];
  for (const id of NEW_ITEMS) {
    const it = cat.items.find((i) => i.id === id);
    if (!it) { wrong.push(`${id} missing from catalog`); continue; }
    const shown = rows.includes(id);
    if (appliesHere(it) && shown) present += 1;
    else if (!appliesHere(it) && !shown) absentRight += 1;
    else wrong.push(`${id} ${shown ? 'shown' : 'hidden'} on ${plat}`);
  }
  check(!wrong.length, `every 3.7.0 item is on the list where it applies (${present} shown, ${absentRight} rightly absent on ${plat})`, wrong.join('; '));

  // Linux coverage: on Linux the list must carry native-manager items, not just npm/steps ones.
  const linuxCovered = cat.items.filter((i) => i.linux && (i.linux.apt || i.linux.dnf || i.linux.pacman || i.linux.flatpak || i.linux.snap)).length;
  const linuxApplies = cat.items.filter((i) => (Array.isArray(i.platforms) && i.platforms.length ? i.platforms.includes('linux') : Boolean(i.linux || i.npm || i.steps))).length;
  check(linuxCovered >= 60 && linuxApplies >= 120, 'Linux is a real target: 60+ items with a native/Flatpak/snap route, 120+ applicable', `${linuxCovered} package routes · ${linuxApplies} applicable`);

  // Kiro CLI: the Windows step is the vendor's own one-liner, verbatim.
  const kc = cat.items.find((i) => i.id === 'kiro-cli');
  check(kc && kc.win.steps[0].cmd === "irm 'https://cli.kiro.dev/install.ps1' | iex", 'Kiro CLI installs with the vendor one-liner on Windows', kc && kc.win.steps[0].cmd);
  check(kc && /cli\.kiro\.dev\/install \| bash/.test(kc.linux.steps[0].cmd) && /cli\.kiro\.dev\/install \| bash/.test(kc.mac.steps[0].cmd), '...and with the curl script on macOS and Linux');

  // Visual Studio: 2026 first, 2022 as the fallback, first hit wins.
  const vs = cat.items.find((i) => i.id === 'visual-studio');
  check(vs.win.winget[0] === 'Microsoft.VisualStudio.Community' && vs.win.winget[1] === 'Microsoft.VisualStudio.2022.Community' && vs.win.stopOnFirstSuccess === true, 'Visual Studio 2026 with the 2022 fallback, first hit wins');
  check(/Workload\.Python/.test(vs.win.wingetArgs) && /Workload\.ManagedGame/.test(vs.win.wingetArgs), 'Visual Studio adds the Python and Unity workloads');

  // Arduino: six cores and the library set.
  const ard = cat.items.find((i) => i.id === 'arduino');
  const cores = ard.steps.filter((s) => /core install/.test(s.cmd)).map((s) => s.cmd.split('core install ')[1]);
  check(cores.length === 6 && cores.includes('esp32:esp32') && cores.includes('rp2040:rp2040'), 'Arduino installs six board cores', cores.join(' '));
  check(ard.steps.some((s) => /lib install/.test(s.cmd)), 'Arduino installs the starter library set');

  // MCP config fan-out.
  const mi = cat.items.find((i) => i.id === 'mcp-config-ides');
  check(mi.steps.map((s) => s.target).join(',') === 'kiro,cursor,windsurf,claude-code', 'MCP config is written for Kiro, Cursor, Windsurf and Claude Code');

  // Tick the embedded profile; the selection count and footer forecast follow.
  await page.click('#profiles .profile[data-profile="embedded"]');
  await wait(300);
  const selCount = parseInt(await page.textContent('#selCount'), 10);
  const expected = cat.items.filter((i) => appliesHere(i) && (i.profiles || []).includes('embedded')).length;
  check(selCount === expected, 'the Maker & Embedded profile ticks exactly its items', `${selCount} selected, ${expected} expected`);
  const lineReady = await until(page, () => /^AEDi Predict: ~\d+ min · ≈\d+\/\d+ clean/.test(document.getElementById('selForecast')?.textContent || ''), 90000, 500);
  check(lineReady, 'the footer forecasts the embedded selection', await page.textContent('#selForecast'));
  await page.screenshot({ path: path.join(SHOT, 'ui-370-embedded.png') });

  // The IDE group lists the new editors.
  const ideRows = await page.$$eval('#items .row', (els) => els.filter((e) => !e.classList.contains('na')).map((e) => e.dataset.id));
  const ideIds = cat.items.filter((i) => i.group === 'ide' && appliesHere(i)).map((i) => i.id);
  check(ideIds.every((id) => ideRows.includes(id)), `every IDE item renders on ${plat}`, `${ideIds.length} IDE items`);
  await page.click('#aw-close');

  // ---- AEDi Predict: the engines strip knows the Linux managers -------------
  await page.click('.dock-btn[data-app="predict"]');
  await page.waitForSelector('#pdStats', { timeout: 15000 });
  await until(page, () => document.querySelectorAll('#pdStats .pd-stat').length === 4 && !/reading/.test(document.getElementById('pdMeta')?.textContent || ''), 90000, 500);
  const engines = await page.textContent('#pdFacts').catch(() => '');
  if (plat === 'linux') check(/linuxpkg|flatpak|snap/.test(engines || ''), 'the engines strip reads the Linux package managers', (engines || '').trim().slice(0, 140));
  else check(!/linuxpkg/.test(engines || ''), 'the engines strip leaves the Linux managers off this OS', (engines || '').trim().slice(0, 140));
  await page.screenshot({ path: path.join(SHOT, 'ui-370-predict.png') });

  check(!pageErrors.length, 'no uncaught renderer errors', pageErrors.join(' | ') || 'none');
  check(!consoleErrors.length, 'no console errors', consoleErrors.slice(0, 3).join(' | ') || 'none');

  await app.close();
  console.log(`\n${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('ui-check-370 failed:', e.message); process.exit(2); });
