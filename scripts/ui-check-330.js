'use strict';
/* ProGramerly 3.3.0 - the real-application UI check.
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   This launches the actual Electron application (no stubs, no mocks) and
   drives the shell the way an operator would: it waits for the intro, opens
   the orb menu, reads the options card, opens a workspace, and asks the real
   local model to read the machine. Everything it asserts is a fact about the
   running product. */

const path = require('path');
const fs = require('fs');
const os = require('os');

const PWC = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules',
  '@playwright', 'mcp', 'node_modules', 'playwright-core');
const { _electron: electron } = require(PWC);

const ROOT = path.resolve(__dirname, '..');
const SHOT = path.join(ROOT, 'Claude outputs');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const results = [];
const ok = (name, detail) => { results.push({ pass: true, name, detail }); console.log(`  ok   ${name}${detail ? ` - ${detail}` : ''}`); };
const bad = (name, detail) => { results.push({ pass: false, name, detail }); console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The shell window is the one serving index.html; the intro is its own. */
async function mainWindow(app, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const w of app.windows()) {
      let url = '';
      try { url = w.url(); } catch { url = ''; }
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

  // Its own userData directory, so the check never disturbs - or is blocked by -
  // the copy of ProGramerly the operator already has running.
  const sandbox = path.join(os.tmpdir(), 'pg-uicheck-330');
  const app = await electron.launch({
    executablePath: EXE,
    // --elevated: do not relaunch under UAC for the check. The shell is
    // identical either way; only the privilege badge differs.
    args: [ROOT, '--elevated', `--user-data-dir=${sandbox}`],
    cwd: ROOT,
  });
  const consoleErrors = [];
  const pageErrors = [];

  // The tray HUD and the intro both open early and the order is not fixed;
  // what matters is that the intro is one of them.
  await app.firstWindow();
  let introSeen = false;
  const introBy = Date.now() + 20000;
  while (!introSeen && Date.now() < introBy) {
    for (const w of app.windows()) {
      try { if (w.url().includes('intro.html')) introSeen = true; } catch { /* closing */ }
    }
    if (!introSeen) await wait(300);
  }
  check(introSeen, 'the intro plays on launch');

  const win = await mainWindow(app);
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  win.on('pageerror', (e) => pageErrors.push(e.message));

  await win.waitForSelector('#shell.on', { timeout: 90000 });
  ok('the shell comes up');

  /* ------------------------------------------------------- the Ionity mark */
  const mark = await win.evaluate(() => {
    const m = document.getElementById('shellMark');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const cs = getComputedStyle(m);
    return {
      loaded: m.complete && m.naturalWidth > 0,
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), bottom: Math.round(window.innerHeight - r.bottom),
      opacity: cs.opacity, hidden: m.hidden,
    };
  });
  check(mark && mark.loaded, 'the transparent Ionity wordmark loads', mark && `${mark.w}x${mark.h}px`);
  check(mark && !mark.hidden && mark.left < 120 && mark.bottom < 120,
    'it sits in the bottom left corner', mark && `left ${mark.left}px, bottom ${mark.bottom}px, opacity ${mark.opacity}`);

  /* ------------------------------------------------------------- the accent */
  const accent = await win.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sh-accent').trim());
  check(/^#[0-9a-f]{6}$/i.test(accent), 'the shell accent is set from settings', accent);

  /* -------------------------------------------------- presets on the deck */
  const chips = await win.evaluate(() => [...document.querySelectorAll('#suggest .preset-chip')]
    .map((b) => ({ id: b.dataset.preset, name: b.textContent, disabled: b.disabled })));
  check(chips.length >= 3, 'the hero carries preset chips from the registry',
    chips.map((c) => c.name).join(', '));

  /* -------------------------------------------------------- the orb menu */
  await win.click('#dock-orb');
  await win.waitForSelector('#orbmenu.on', { timeout: 8000 });
  const orb = await win.evaluate(() => ({
    presets: [...document.querySelectorAll('#om-list button b')].map((b) => b.textContent),
    model: document.getElementById('om-model').textContent,
  }));
  check(orb.presets.length >= 8, 'every analysis preset is one click from the dock orb',
    `${orb.presets.length} presets`);
  check(/:/.test(orb.model), 'the orb menu names the model that will answer', orb.model);
  await win.screenshot({ path: path.join(SHOT, 'v33-orbmenu.png') });
  await win.keyboard.press('Escape');
  await win.waitForSelector('#orbmenu:not(.on)', { timeout: 5000 });
  ok('Escape closes it');

  /* ------------------------------------------- Ask inside every workspace */
  await win.click('.dock-btn[data-app="hardware"]');
  await win.waitForSelector('#overlay.on', { timeout: 10000 });
  const askBtn = await win.evaluate(() => {
    const b = document.getElementById('aw-ask-btn');
    return b ? { text: b.textContent, disabled: b.disabled } : null;
  });
  check(Boolean(askBtn), 'the Hardware workspace carries its own Ask control', askBtn && askBtn.text);
  check(askBtn && !askBtn.disabled, 'it is live because a local model is running');
  await win.click('#aw-close');
  await win.waitForSelector('#overlay:not(.on)', { timeout: 5000 });

  /* ------------------------------------------------------ the options card */
  await win.click('.dock-btn[data-app="settings"]');
  await win.waitForSelector('#domeOptions', { timeout: 10000 });
  const opts = await win.evaluate(() => ({
    briefs: document.getElementById('optBriefPreset').options.length,
    models: [...document.getElementById('optModel').options].map((o) => o.value),
    interval: document.getElementById('optInterval').value,
    accent: document.getElementById('optAccent').value,
    meta: document.getElementById('optMeta').textContent,
    rows: document.querySelectorAll('#domeOptions .opt-row').length,
    actions: document.querySelectorAll('#domeOptions .cardactions button').length,
  }));
  check(opts.briefs >= 8, 'the launch brief can be any registered preset', `${opts.briefs} choices`);
  check(opts.models.some((m) => m.includes(':')), 'the model picker lists the models on this machine',
    opts.models.join(', '));
  check(/strata/.test(opts.meta), 'the card reports what the dome can see', opts.meta);
  check(opts.rows >= 4 && opts.actions >= 5, 'the card carries its switches and its actions',
    `${opts.rows} switches, ${opts.actions} actions`);

  /* the accent must actually change the shell, and stick */
  await win.selectOption('#optAccent', 'violet');
  await wait(700);
  const violet = await win.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sh-accent').trim());
  check(violet.toLowerCase() === '#8b7cf5', 'changing the accent repaints the shell', violet);
  await win.selectOption('#optAccent', 'cyan');
  await wait(500);
  await win.screenshot({ path: path.join(SHOT, 'v33-options.png') });
  await win.click('#aw-close');
  await win.waitForSelector('#overlay:not(.on)', { timeout: 8000 });

  /* ------------------------------- the machine reading itself, for real */
  await win.waitForSelector('#brief:not([hidden])', { timeout: 60000 }).catch(() => {});
  let brief = await win.evaluate(() => {
    const p = document.getElementById('brief');
    return { hidden: p.hidden, title: document.getElementById('brief-title').textContent,
      meta: document.getElementById('brief-meta').textContent,
      chars: document.getElementById('brief-body').textContent.length };
  });
  const until = Date.now() + 180000;
  while (brief.chars < 120 && Date.now() < until) {
    await wait(2500);
    brief = await win.evaluate(() => ({
      hidden: document.getElementById('brief').hidden,
      title: document.getElementById('brief-title').textContent,
      meta: document.getElementById('brief-meta').textContent,
      chars: document.getElementById('brief-body').textContent.length }));
  }
  check(!brief.hidden, 'the launch brief opens on the deck', brief.title);
  check(/sets/.test(brief.meta), 'it says which model answered and how many sets it read', brief.meta);
  check(brief.chars > 120, 'the local model actually reported', `${brief.chars} characters`);
  const quote = await win.evaluate(() => document.getElementById('brief-body').textContent.slice(0, 260));
  console.log(`\n  --- the machine, in its own words -------------------------------\n  ${quote.replace(/\n/g, '\n  ')}\n  ----------------------------------------------------------------\n`);
  await win.screenshot({ path: path.join(SHOT, 'v33-brief.png'), fullPage: false });

  /* --------------------------------------------- the deck stays whole */
  /* With the brief open the hero gives up room; no tile may end up under the
     dock or off the bottom of the shell. */
  const deck = await win.evaluate(() => {
    const main = document.getElementById('main');
    main.scrollTop = main.scrollHeight;            // the operator scrolls to the deck
    const dockTop = document.getElementById('dockwrap').getBoundingClientRect().top;
    const tiles = [...document.querySelectorAll('#modules .tile')].map((t) => {
      const r = t.getBoundingClientRect();
      return { id: t.dataset.app, bottom: Math.round(r.bottom), clipped: r.bottom > dockTop + 1 || r.height < 24 };
    });
    return { dockTop: Math.round(dockTop), tiles, clipped: tiles.filter((t) => t.clipped).map((t) => t.id) };
  });
  check(deck.clipped.length === 0, 'every deck tile stays clear of the dock',
    deck.clipped.length ? `clipped: ${deck.clipped.join(', ')}` : `${deck.tiles.length} tiles above ${deck.dockTop}px`);

  /* --------------------------------------------------------- the DOME app */
  await win.click('#brief-more');          // "Open the DOME", in the brief head
  try {
    await win.waitForSelector('#domeApp .dome-head', { timeout: 25000 });
  } catch (e) {
    const state = await win.evaluate(() => ({
      overlay: document.getElementById('overlay').className,
      head: (document.getElementById('aw-name') || {}).textContent,
      app: document.getElementById('domeApp') ? document.getElementById('domeApp').innerHTML.slice(0, 400) : 'no #domeApp',
    }));
    bad('the DOME opens on its strata', JSON.stringify(state));
    await win.screenshot({ path: path.join(SHOT, 'v33-dome-fail.png') });
    throw e;
  }
  const domeCounts = await win.evaluate(() => ({
    segs: document.querySelectorAll('#domeApp .dome-seg').length,
    icons: new Set([...document.querySelectorAll('#domeApp .dome-seg svg path')].map((p) => p.getAttribute('d'))).size,
  }));
  check(domeCounts.segs >= 5, 'the DOME opens on its strata', `${domeCounts.segs} rows`);
  await win.screenshot({ path: path.join(SHOT, 'v33-dome.png') });
  await win.click('#aw-close');

  /* --------------------------------------------------------------- errors */
  await wait(1200);
  check(pageErrors.length === 0, 'no uncaught errors in the renderer', pageErrors.join(' | ') || 'clean');
  const realErrors = consoleErrors.filter((t) => !/favicon|devtools|Autofill/i.test(t));
  check(realErrors.length === 0, 'no console errors', realErrors.slice(0, 3).join(' | ') || 'clean');

  await win.screenshot({ path: path.join(SHOT, 'v33-deck.png') });
  await app.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail || ''}`)); process.exit(1); }
  console.log('ProGramerly 3.3.0 behaves as built.');
}

run().catch((e) => { console.error('\nharness error:', e && e.stack ? e.stack : e); process.exit(2); });
