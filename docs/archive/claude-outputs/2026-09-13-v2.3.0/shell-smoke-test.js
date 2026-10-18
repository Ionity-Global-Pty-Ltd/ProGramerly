// Real-DOM smoke test of the Ai-OS shell: index.html + renderer.js + shell.js in Chromium,
// with window.programerly mocked the way preload.js would expose it.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = '/home/claude/pg';
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/main/catalog/catalog.json'), 'utf8'));
const Module = require('module'); const _load = Module._load;
Module._load = function (r, ...a) { if (r === 'electron') return { app: { getPath: () => '/tmp/pgtest' } }; return _load.call(this, r, ...a); };
const settings = { ...require(path.join(root, 'src/main/services/settings.js')).DEFAULTS, installedIds: ['git', 'node'], profile: { name: 'Johan van Antwerp', role: 'Founder' } };
Module._load = _load;
const metrics = { metrics: { at: Date.now(), host: 'VAN-ANTWERP-JW', platform: 'win32', uptimeSec: 86400 * 2 + 3600 * 5, cpu: { load: 37, cores: 16, speedMHz: 3600 }, mem: { total: 32e9, free: 12e9, usedPct: 62 }, temp: { c: 61, source: 'CPU package' }, disks: [{ name: 'C:', usedPct: 83, free: 120e9 }], net: { rxBps: 2.5e6, txBps: 4e5 } }, ping: 18 };
const targets = [{ endpointId: 'ollama', endpoint: 'Ollama', port: 11434, model: 'llama3.2:1b' }, { endpointId: 'ollama', endpoint: 'Ollama', port: 11434, model: 'qwen2.5-coder:7b' }];
const programs = [
  { id: 'fanzi', name: 'Fan control', product: 'Fanzi FanControl', available: true, launchable: true, integrity: 'pending', public: true, sizeBytes: 1, requiresConfirmation: false },
  { id: 'aios-demo', name: 'AiOS layout', available: true, launchable: true, integrity: 'pending', public: true },
  { id: 'cic', name: 'CiC', product: 'IONITY CiC', available: false, launchable: false, integrity: 'missing', public: true },
  { id: 'mcp-audit', name: 'MCP audit', available: true, launchable: true, integrity: 'pending', public: false, requiresConfirmation: true },
];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; p.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' @ ' + (e.stack||'').split('\n').slice(0,3).join(' | '))); p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.addInitScript(({ catalog, settings, metrics, targets, programs }) => {
    const listeners = {};
    const on = (ch) => (cb) => { (listeners[ch] = listeners[ch] || []).push(cb); return () => {}; };
    window.__emit = (ch, payload) => (listeners[ch] || []).forEach((cb) => cb(payload));
    const launched = []; window.__launched = launched;
    const real = {
      getCatalog: async () => ({ catalog, platform: 'win', osLabel: 'Windows_NT 10.0.26100 (x64)', elevated: false, devRoot: 'C:/Development', appVersion: '3.1.0', logFile: 'x.log', settings, sync: { enabled: true, nextRunAt: Date.now() + 3.6e6 }, update: null, fixtures: true }),
      metrics: async () => metrics,
      aiTargets: async () => targets,
      aiEndpoints: async () => [{ id: 'ollama', kind: 'ollama', up: true, models: ['llama3.2:1b'] }],
      aiChat: async () => { const id = 1; setTimeout(() => { window.__emit('ai:token', { id, token: 'The workstation ' }); window.__emit('ai:token', { id, token: 'is nominal.' }); window.__emit('ai:token', { id, done: true, ok: true, stats: { tokens: 4 } }); }, 30); return { id, ok: true }; },
      setSettings: async (patch) => Object.assign(settings, patch),
      syncStatus: async () => ({ enabled: true }),
      programs: { list: async () => programs, launch: async (id) => { launched.push(id); return { ok: true, origin: 'bundled' }; }, hydrate: async () => [], openFolder: async () => '', onProgress: on('programs:progress') },
      links: async () => ({ groups: [] }), hwSensors: async () => ({}), hwTools: async () => [], rgbStatus: async () => ({}), termList: async () => [], projScan: async () => [], doctorScan: async () => ({ items: [] }), publishStatus: async () => ({}), loginState: async () => ({ signedIn: false }), profileGet: async () => settings.profile, aiGpu: async () => ({ available: false }), aiModels: async () => [], aiLoaded: async () => [], aiCurated: async () => [], aiEnvironments: async () => ({}), registryScan: async () => [], geo: async () => ({}),
    };
    window.programerly = new Proxy(real, { get(t, k) { if (k in t) return t[k]; if (String(k).startsWith('on')) return on(String(k)); return async () => ({}); } });
    // renderer.js listens on 'ai:token' via api.onAiToken -> map that channel name
    const origOn = on; window.__map = { onAiToken: 'ai:token', onMetrics: 'metrics:tick' };
    real.onAiToken = (cb) => origOn('ai:token')(cb); real.onMetrics = (cb) => origOn('metrics:tick')(cb);
  }, { catalog, settings, metrics, targets, programs });
  await p.goto('file://' + path.join(root, 'src/renderer/index.html'));
  await p.waitForTimeout(1800); console.log('EARLY ERRORS:', errors); console.log('bootfail:', await p.evaluate(() => (document.querySelector('.bootfail')||{}).textContent || null));
  const s1 = await p.evaluate(() => ({
    shellOn: document.getElementById('shell').classList.contains('on'),
    greeting: document.getElementById('greeting').textContent,
    status: document.getElementById('status-text').textContent,
    machine: document.getElementById('homeMachineLine').textContent,
    engine: document.getElementById('engine-label').textContent,
    cpu: document.getElementById('st-cpu-k').textContent, disk: document.getElementById('st-disk-k').textContent,
    diskBar: document.getElementById('st-disk-b').style.width,
    tiles: [...document.querySelectorAll('#modules .tile')].map((t) => t.dataset.app + ':' + t.dataset.live),
    legend: [...document.querySelectorAll('#dome-legend button')].map((b) => b.querySelector('b').textContent + '=' + b.querySelector('em').textContent),
    bands: document.querySelectorAll('#dome-svg .band').length,
    overlayOn: document.getElementById('overlay').classList.contains('on'),
    who: document.getElementById('who-name').textContent,
    version: document.getElementById('appVersion').textContent,
    dockBtns: document.querySelectorAll('.dock-btn').length,
  }));
  console.log(JSON.stringify(s1, null, 1));
  await p.screenshot({ path: '/tmp/pgtest/shell-home.png' });

  // open Software from the dock -> app window must contain pickView + bottombar
  await p.click('.dock-btn[data-app="software"]'); await p.waitForTimeout(500);
  const s2 = await p.evaluate(() => ({ overlayOn: document.getElementById('overlay').classList.contains('on'), title: document.getElementById('aw-name').textContent, hasPick: !!document.querySelector('#aw-content #pickView'), pickHidden: document.getElementById('pickView').hidden, items: document.querySelectorAll('#aw-content #items .item, #aw-content #items > *').length, hasInstallBtn: !!document.querySelector('#aw-content #installBtn') }));
  console.log('software app', JSON.stringify(s2));
  await p.screenshot({ path: '/tmp/pgtest/shell-software.png' });
  // Esc closes and parks the view back
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  console.log('closed ->', await p.evaluate(() => ({ overlayOn: document.getElementById('overlay').classList.contains('on'), parked: !!document.querySelector('#apps-store #pickView') })));
  // Fan control tile -> hardware view + "Open Fanzi" button; click it -> programs.launch('fanzi')
  await p.click('#modules .tile[data-app="fans"]'); await p.waitForTimeout(500);
  const s3 = await p.evaluate(() => ({ title: document.getElementById('aw-name').textContent, hasHw: !!document.querySelector('#aw-content #hardwareView'), toolBtn: document.getElementById('aw-tool-btn') && document.getElementById('aw-tool-btn').textContent }));
  console.log('fans app', JSON.stringify(s3));
  await p.click('#aw-tool-btn'); await p.waitForTimeout(300);
  console.log('launched:', await p.evaluate(() => window.__launched));
  await p.screenshot({ path: '/tmp/pgtest/shell-fans.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // CiC not in build -> toast, no crash
  await p.click('.dock-btn[data-app="cic"]'); await p.waitForTimeout(300);
  console.log('cic toast:', await p.evaluate(() => document.getElementById('toast-text').textContent));
  // Ask -> streams into aiChatLog and mirrors into #thread
  await p.fill('#ask-input', 'How healthy is this workstation?'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  console.log('thread:', await p.evaluate(() => ({ on: document.getElementById('thread').classList.contains('on'), msgs: [...document.querySelectorAll('#thread .msg')].map((m) => m.className + ': ' + m.querySelector('.body').textContent) })));
  // ask with a workspace name opens it
  await p.fill('#ask-input', 'projects'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  console.log('ask->projects:', await p.evaluate(() => document.getElementById('aw-name').textContent.slice(0, 8)));
  await p.keyboard.press('Escape');
  // kiosk toggle
  await p.keyboard.press('Control+Shift+K'); await p.waitForTimeout(200);
  console.log('kiosk:', await p.evaluate(() => ({ cls: document.body.classList.contains('kiosk-shell'), exit: !document.getElementById('kioskExitBtn').hidden })));
  await p.keyboard.press('Control+Shift+K');
  await p.screenshot({ path: '/tmp/pgtest/shell-thread.png' });
  console.log('ERRORS:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
