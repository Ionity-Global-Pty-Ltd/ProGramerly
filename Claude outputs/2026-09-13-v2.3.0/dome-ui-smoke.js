const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { dome, fans } = require('/tmp/pgtest/dome-mocks.js');
const root = '/home/claude/pg';
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/main/catalog/catalog.json'), 'utf8'));

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // The REAL dome + fans services, running in node, reachable from the page.
  await p.exposeFunction('__domeOverview', () => dome.overview());
  await p.exposeFunction('__domeStratum', (id) => dome.stratum(id));
  await p.exposeFunction('__domeSegment', (id) => dome.segment(id));
  await p.exposeFunction('__domeDatasets', () => dome.datasets());
  await p.exposeFunction('__domePresets', (s) => dome.presets(s));
  await p.exposeFunction('__domeBrief', (o) => dome.brief(o));
  await p.exposeFunction('__fansChannels', () => fans.channels());
  await p.exposeFunction('__fansProfiles', () => fans.profiles());
  await p.exposeFunction('__fansSave', (x) => fans.saveProfile(x));
  await p.exposeFunction('__fansDelete', (id) => fans.deleteProfile(id));
  await p.exposeFunction('__fansPresets', () => fans.PRESETS);
  await p.exposeFunction('__fansExport', (id) => fans.exportProfile(id));

  const settings = { ...require(path.join(root, 'src/main/services/settings.js')).DEFAULTS, installedIds: ['git', 'node'], profile: { name: 'Johan van Antwerp', role: 'Founder' } };
  const metrics = { metrics: { at: Date.now(), host: 'VAN-ANTWERP-JW', platform: 'win32', uptimeSec: 190000, cpu: { load: 44, cores: 16, speedMHz: 3600 }, mem: { total: 32e9, free: 11e9, usedPct: 65 }, temp: { c: 71, source: 'CPU package' }, disks: [{ name: 'C:', usedPct: 88, free: 90e9 }], net: { rxBps: 2.5e6, txBps: 4e5 } }, ping: 18 };

  await p.addInitScript(({ catalog, settings, metrics }) => {
    const L = {};
    const on = (ch) => (cb) => { (L[ch] = L[ch] || []).push(cb); return () => {}; };
    window.__emit = (ch, x) => (L[ch] || []).forEach((cb) => cb(x));
    const launched = []; window.__launched = launched;
    const real = {
      getCatalog: async () => ({ catalog, platform: 'win', osLabel: 'Windows_NT 10.0.26100 (x64)', elevated: false, devRoot: 'C:/Development', appVersion: '3.2.0', logFile: 'x.log', settings, sync: { enabled: true }, update: null, fixtures: true }),
      metrics: async () => metrics,
      aiTargets: async () => ([{ endpointId: 'ollama', endpoint: 'Ollama', port: 11434, model: 'llama3.2:1b' }]),
      aiEndpoints: async () => ([{ id: 'ollama', kind: 'ollama', up: true, models: ['llama3.2:1b'] }]),
      aiChat: async () => ({ id: 1, ok: true }),
      setSettings: async (patch) => Object.assign(settings, patch),
      syncStatus: async () => ({ enabled: true }),
      programs: { list: async () => ([{ id: 'fanzi', name: 'Fan control', product: 'Fanzi FanControl', available: true, launchable: true, integrity: 'pending', public: true }, { id: 'cic', name: 'CiC', available: false, launchable: false, integrity: 'missing' }, { id: 'mcp-audit', name: 'MCP audit', available: true, launchable: true, requiresConfirmation: true, public: false }]), launch: async (id) => { launched.push(id); return { ok: true, origin: 'bundled' }; }, openFolder: async () => '', onProgress: on('programs:progress') },
      dome: {
        overview: () => window.__domeOverview(),
        stratum: (id) => window.__domeStratum(id),
        segment: (id) => window.__domeSegment(id),
        datasets: () => window.__domeDatasets(),
        presets: (s) => window.__domePresets(s),
        dataset: async () => ({}),
        refresh: async () => true,
        onToken: on('dome:token'),
        ask: async (req) => {
          const pack = await window.__domeBrief(req);
          window.__emit('dome:token', { id: 1, start: true, model: 'llama3.2:1b', sets: pack.sets, chars: pack.chars, preset: pack.preset });
          const text = `Thermals are the binding constraint. The hottest source is 71.2 °C on the AMD CPU (sensors.tree), with three fans spinning of four (fans.channels). The stored curve would command 68% where 42% is measured (fans.profiles, computed vs measured).`;
          for (const w of text.split(' ')) window.__emit('dome:token', { id: 1, token: w + ' ' });
          window.__emit('dome:token', { id: 1, done: true, ok: true, stats: { tokensPerSec: 41 } });
          return { id: 1, ok: true, sets: pack.sets };
        },
      },
      fans: {
        channels: () => window.__fansChannels(),
        profiles: () => window.__fansProfiles(),
        save: (x) => window.__fansSave(x),
        remove: (id) => window.__fansDelete(id),
        presets: () => window.__fansPresets(),
        exportProfile: (id) => window.__fansExport(id),
        openFolder: async () => '',
        summary: async () => ({}),
      },
      links: async () => ({ groups: [] }), hwSensors: async () => ({}), hwTools: async () => [], rgbStatus: async () => ({}), termList: async () => [], projScan: async () => [], doctorScan: async () => ({ items: [] }), publishStatus: async () => ({}), loginState: async () => ({ signedIn: false }), profileGet: async () => settings.profile, aiGpu: async () => ({ available: false }), aiModels: async () => [], aiLoaded: async () => [], aiCurated: async () => [], aiEnvironments: async () => ({}), registryScan: async () => [], geo: async () => ({}),
    };
    real.onAiToken = (cb) => on('ai:token')(cb);
    real.onMetrics = (cb) => on('metrics:tick')(cb);
    window.programerly = new Proxy(real, { get(t, k) { if (k in t) return t[k]; if (String(k).startsWith('on')) return on(String(k)); return async () => ({}); } });
  }, { catalog, settings, metrics });

  await p.goto('file://' + path.join(root, 'src/renderer/index.html'));
  await p.waitForTimeout(2500);

  console.log('HOME:', JSON.stringify(await p.evaluate(() => ({
    shellOn: document.getElementById('shell').classList.contains('on'),
    bands: document.querySelectorAll('#dome-svg .band').length,
    legend: [...document.querySelectorAll('#dome-legend button')].map((b) => `${b.querySelector('b').textContent}=${b.querySelector('em').textContent}`),
    note: document.getElementById('dome-note').textContent,
    pill: document.getElementById('dome-pill').textContent.trim(),
    tiles: [...document.querySelectorAll('#modules .tile')].map((t) => t.dataset.app),
  })), null, 1));
  await p.screenshot({ path: '/tmp/pgtest/v32-home.png' });

  // dome band -> DOME app focused on that stratum
  // A half-ring's bbox centre lies in its hole, so click the arc itself, not the centre.
  const band = await p.locator('#dome-svg .band[data-stratum="storage"]').boundingBox();
  await p.mouse.click(band.x + 14, band.y + band.height - 12);
  await p.waitForTimeout(900);
  console.log('STRATUM:', JSON.stringify(await p.evaluate(() => ({
    title: document.getElementById('aw-name').textContent,
    h3: document.querySelector('.dome-head h3') && document.querySelector('.dome-head h3').textContent,
    segs: [...document.querySelectorAll('.dome-seg')].map((s) => s.dataset.seg),
    icons: [...document.querySelectorAll('.dome-seg .seg-ico svg')].length,
    presets: [...document.querySelectorAll('[data-preset]')].map((b) => b.textContent),
  }))));
  await p.screenshot({ path: '/tmp/pgtest/v32-stratum.png' });

  // segment detail with its data sets
  await p.click('.dome-seg[data-seg="volumes"]'); await p.waitForTimeout(900);
  console.log('SEGMENT:', JSON.stringify(await p.evaluate(() => ({
    name: document.querySelector('.dome-head h3').textContent,
    prose: document.querySelectorAll('.seg-prose p').length,
    sets: [...document.querySelectorAll('.set-card')].map((c) => c.querySelector('.set-name code').textContent + ':' + c.querySelector('.set-class').textContent),
    tableRows: document.querySelectorAll('.set-table tbody tr').length,
    cols: [...document.querySelectorAll('.set-table th')].map((t) => t.textContent),
  }))));
  await p.screenshot({ path: '/tmp/pgtest/v32-segment.png' });

  // ask a preset -> real brief built by dome.js, streamed answer
  await p.click('[data-preset="disk-pressure"]'); await p.waitForTimeout(1200);
  console.log('ANSWER:', JSON.stringify(await p.evaluate(() => ({
    shown: !document.querySelector('.dome-answer').hidden,
    head: document.querySelector('.ans-head b').textContent,
    meta: document.querySelector('.ans-meta').textContent,
    body: document.querySelector('.ans-body').textContent.slice(0, 120),
  }))));
  await p.screenshot({ path: '/tmp/pgtest/v32-answer.png' });

  // back up, then the data set registry
  await p.click('[data-act="up"]'); await p.waitForTimeout(700);
  await p.click('[data-act="up"]'); await p.waitForTimeout(900);
  await p.click('[data-act="datasets"]'); await p.waitForTimeout(1500);
  console.log('DATASETS:', JSON.stringify(await p.evaluate(() => ({
    cards: document.querySelectorAll('.ds-card').length,
    off: document.querySelectorAll('.ds-card.off').length,
    classes: [...document.querySelectorAll('.sets-title .set-class')].map((c) => c.textContent),
  }))));
  await p.screenshot({ path: '/tmp/pgtest/v32-datasets.png' });

  // FAN CONTROL
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.click('.dock-btn[data-app="fans"]'); await p.waitForTimeout(1500);
  console.log('FANS:', JSON.stringify(await p.evaluate(() => ({
    title: document.getElementById('aw-name').textContent,
    toolBtn: document.getElementById('aw-tool-btn') && document.getElementById('aw-tool-btn').textContent,
    stats: [...document.querySelectorAll('.fan-stats .stat')].map((s) => s.querySelector('.k').textContent + ' ' + s.querySelector('.l').textContent),
    rows: [...document.querySelectorAll('.fan-table tbody tr')].map((r) => r.querySelector('b').textContent),
    dutyBars: [...document.querySelectorAll('.duty-bar i')].map((i) => i.style.width),
    temps: document.querySelectorAll('.temp-chip').length,
    profiles: document.querySelectorAll('.fan-profile').length,
    curves: document.querySelectorAll('.curve-svg').length,
  }))));
  await p.screenshot({ path: '/tmp/pgtest/v32-fans.png' });

  // open the editor from a channel, add a point by clicking the plot, save
  await p.click('[data-curve-for="/lpc/fan/0"]'); await p.waitForTimeout(1200);
  const before = await p.evaluate(() => document.querySelectorAll('.pt-chip').length);
  await p.locator('.ed-curve .curve-svg').scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  const box = await p.locator('.ed-curve .curve-svg').boundingBox();
  await p.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.35);
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => document.querySelectorAll('.pt-chip').length);
  console.log('EDITOR: points', before, '->', after, '| commanded line:', await p.evaluate(() => { const el = document.querySelector('.ed-side .muted'); return el ? el.textContent.slice(0, 90) : null; }));
  await p.fill('#edName', 'CPU quiet build');
  await p.click('[data-ed="save"]'); await p.waitForTimeout(1200);
  console.log('SAVED:', JSON.stringify(await p.evaluate(() => ({
    profiles: [...document.querySelectorAll('.fan-profile')].map((c) => c.querySelector('b').textContent),
    meta: [...document.querySelectorAll('.fan-profile .fp-meta dd')].map((d) => d.textContent.trim()).slice(0, 6),
    drift: document.querySelector('.fp-drift') && document.querySelector('.fp-drift').textContent.slice(0, 90),
  }))));
  await p.screenshot({ path: '/tmp/pgtest/v32-fan-saved.png' });

  console.log('ERRORS:', errors.length ? errors : 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
