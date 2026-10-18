'use strict';
/* Main-process test: dome.js + fans.js against mocked services. */
const Module = require('node:module');
const path = require('node:path');
const assert = require('node:assert');
const root = '/home/claude/pg';

const sensorGroups = [
  { id: '/amdcpu/0', label: 'AMD CPU', sensors: [
    { name: 'Core (Tctl/Tdie)', type: 'Temperature', value: 71.2, unit: '°C', id: '/amdcpu/0/temperature/0' },
    { name: 'Package', type: 'Power', value: 88.4, unit: 'W', id: '/amdcpu/0/power/0' },
    { name: 'Core #1', type: 'Load', value: 44, unit: '%', id: '/amdcpu/0/load/1' },
  ] },
  { id: '/lpc/nct6798d/0', label: 'Motherboard (Super IO)', sensors: [
    { name: 'Fan #1', type: 'Fan', value: 1180, unit: 'RPM', id: '/lpc/fan/0' },
    { name: 'Fan Control #1', type: 'Control', value: 42, unit: '%', id: '/lpc/control/0' },
    { name: 'Fan #2', type: 'Fan', value: 0, unit: 'RPM', id: '/lpc/fan/1' },
    { name: 'Fan Control #2', type: 'Control', value: 0, unit: '%', id: '/lpc/control/1' },
    { name: 'Fan #3', type: 'Fan', value: 880, unit: 'RPM', id: '/lpc/fan/2' },
    { name: 'CPU Core', type: 'Voltage', value: 1.23, unit: 'V', id: '/lpc/voltage/0' },
    { name: 'System', type: 'Temperature', value: 38, unit: '°C', id: '/lpc/temperature/0' },
  ] },
  { id: '/nvidiagpu/0', label: 'NVIDIA GPU', sensors: [
    { name: 'GPU Core', type: 'Temperature', value: 63, unit: '°C', id: '/gpu/temperature/0' },
    { name: 'GPU Fan', type: 'Fan', value: 1500, unit: 'RPM', id: '/gpu/fan/0' },
    { name: 'GPU Fan', type: 'Control', value: 55, unit: '%', id: '/gpu/control/0' },
  ] },
];

const store = { fanProfiles: [], fanActiveProfile: null, installedIds: ['git', 'node', 'vscode'], aiDefaultModel: 'llama3.2:1b', syncScope: { packages: true, npmGlobals: true } };
const mocks = {
  './hardware': { sensors: async () => ({ available: true, source: 'LibreHardwareMonitor', groups: sensorGroups }), memoryState: async () => ({ totalBytes: 32e9, freeBytes: 11e9, standbyBytes: 6e9, usedPct: 65 }) },
  './metrics': { snapshot: () => ({ host: 'VAN-ANTWERP-JW', platform: 'win32', uptimeSec: 190000, cpu: { load: 44, cores: 16, speedMHz: 3600 }, mem: { total: 32e9, free: 11e9, usedPct: 65 }, temp: { c: 71, source: 'CPU package' }, net: { rxBps: 2.5e6, txBps: 4e5 }, disks: [{ name: 'C:', usedPct: 88, free: 90e9, total: 1e12 }, { name: 'G:', usedPct: 99, free: 7e9, total: 1e12 }] }) },
  './doctor': {
    scanCommonPorts: async () => ({ ports: [{ port: 3000, pid: 9120, process: 'node.exe', state: 'LISTEN' }] }),
    environment: async () => ({ tools: [{ name: 'winget', found: true, version: '1.9' }, { name: 'choco', found: true, version: '2.2' }, { name: 'npm', found: true, version: '10.8' }, { name: 'pip', found: false }] }),
    diagnose: async () => ({ items: [{ id: 'defender', title: 'Defender exclusions', status: 'warn', detail: 'Dev root not excluded', fix: 'Add exclusion' }, { id: 'longpath', title: 'Long paths', status: 'ok' }] }),
    cleanupPreview: async () => ({ items: [{ label: 'npm cache', path: 'C:/npm-cache', bytes: 4.2e9 }, { label: 'pip cache', path: 'C:/pip', bytes: 1.1e9 }] }),
  },
  './registry': { scan: async () => ([{ id: 'r1', name: 'Restore right-click menu', status: 'actionable', action: 'apply' }, { id: 'r2', name: 'Disable telemetry', status: 'clean', action: 'none' }]) },
  './projects': { scan: async () => ([{ name: 'ProGramerly', path: 'G:/dev/pg', branch: 'main', ahead: 0, behind: 0, dirty: true, stack: 'node' }]) },
  './ai': {
    ollamaModels: async () => ([{ name: 'llama3.2:1b', size: 1.3e9, details: { family: 'llama' } }, { name: 'qwen2.5-coder:7b', size: 4.7e9 }]),
    ollamaLoaded: async () => ([{ name: 'llama3.2:1b' }]),
    endpoints: async () => ([{ id: 'ollama', name: 'Ollama', port: 11434, up: true, models: ['llama3.2:1b'], detail: '2 models served' }, { id: 'lmstudio', name: 'LM Studio', port: 1234, up: false }]),
    gpu: async () => ({ available: true, gpus: [{ name: 'RTX 4070', vramTotalMb: 12288, vramFreeMb: 9000, utilPct: 12, tempC: 45, fits: 'up to 13B at Q4' }] }),
    environments: async () => ({ venvs: [{ name: 'ionity', path: 'G:/dev/.venvs/ionity', python: '3.13' }], conda: [], node: [{ version: '22.11', current: true }] }),
    chat: async (req, onToken) => { onToken({ token: 'Reporting. ' }); onToken({ token: `Saw ${req.messages[0].content.length} chars of brief.` }); return { ok: true, stats: { tokens: 8, tokensPerSec: 40 } }; },
    chatTargets: async () => ([{ endpointId: 'ollama', endpoint: 'Ollama', port: 11434, model: 'llama3.2:1b' }]),
  },
  './programs': { list: () => ([{ id: 'fanzi', name: 'Fan control', product: 'Fanzi FanControl', file: 'Fanzi.FanControl.exe', sizeBytes: 146727885, sha256: 'eb3c', available: true, integrity: 'pending', public: true }, { id: 'cic', name: 'CiC', file: 'CiC.exe', sizeBytes: 32174678, sha256: 'f536', available: false, integrity: 'missing', public: true }]) },
  './sync': { status: () => ({ enabled: true, nextRunAt: Date.now() + 3.6e6, lastRunAt: Date.now() - 8e6, scope: store.syncScope }) },
  './openrgb': { status: async () => ({ connected: false, error: 'ECONNREFUSED 127.0.0.1:6742' }) },
  './settings': { get: (k) => (k ? store[k] : store), save: (p) => Object.assign(store, p) },
};

const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'electron') return { app: { getPath: () => '/tmp/pgtest/ud' }, shell: { openPath: async () => '' } };
  if (parent && /services[\\/](dome|fans)\.js$/.test(parent.filename) && mocks[req]) return mocks[req];
  return origLoad.call(this, req, parent, ...rest);
};
Object.defineProperty(process, 'platform', { value: 'win32' });

const dome = require(path.join(root, 'src/main/services/dome.js'));
const fans = require(path.join(root, 'src/main/services/fans.js'));
dome.configure({ devRoot: () => '/tmp/pgtest/dev', catalogPath: () => path.join(root, 'src/main/catalog/catalog.json'), isElevated: async () => false, osLabel: () => 'Windows_NT 10.0.26100 (x64)' });

(async () => {
  console.log('=== FANS ===');
  const ch = await fans.channels();
  assert.strictEqual(ch.available, true);
  console.log('channels:', ch.channels.map((c) => `${c.label}[${c.role}] rpm=${c.rpm} duty=${c.duty} ctl=${c.controllable}`).join(' | '));
  assert.strictEqual(ch.channels.length, 4, 'three board fans + gpu fan');
  const f1 = ch.channels.find((c) => c.label === 'Fan #1');
  assert.strictEqual(f1.duty, 42, 'paired with its controller');
  const f3 = ch.channels.find((c) => c.label === 'Fan #3');
  assert.strictEqual(f3.controllable, false, 'no controller for fan 3');
  console.log('temps:', ch.temps.length, '| counts', JSON.stringify(ch.counts));

  const seeded = fans.fromPreset('balanced', { channelId: '/lpc/fan/0', sourceSensorId: '/amdcpu/0/temperature/0', name: 'CPU balanced' });
  assert.strictEqual(seeded.ok, true);
  const profs = await fans.profiles();
  const p = profs.profiles[0];
  console.log(`profile "${p.name}": src=${p.sourceTemp}° commanded=${p.commandedDuty}% measured=${p.measuredDuty}% drift=${p.drift}`);
  assert.strictEqual(p.sourceTemp, 71.2);
  assert.ok(p.commandedDuty > 60 && p.commandedDuty < 75, `interpolated duty sane, got ${p.commandedDuty}`);
  assert.strictEqual(p.channelLabel, 'Motherboard (Super IO) · Fan #1');
  assert.strictEqual(fans.evaluate({ points: [[30, 20], [70, 60]], minDuty: 0, stopBelow: 0 }, 50), 40, 'linear midpoint');
  assert.strictEqual(fans.evaluate({ points: [[30, 20], [70, 60]], minDuty: 50, stopBelow: 0 }, 50), 50, 'floor applies');
  assert.strictEqual(fans.evaluate({ points: [[30, 20], [70, 60]], minDuty: 50, stopBelow: 45 }, 40), 0, 'stop-below wins over floor');
  const sum = await fans.summary();
  console.log('summary:', JSON.stringify({ fans: sum.fans, spinning: sum.spinning, stopped: sum.stopped, controllable: sum.controllable, hottestC: sum.hottestC }));
  const ex = await fans.exportProfile(p.id);
  assert.ok(ex.ok && require('node:fs').existsSync(ex.file));
  console.log('exported ->', ex.file.split('/').pop());

  console.log('\n=== DOME OVERVIEW ===');
  const ov = await dome.overview();
  assert.strictEqual(ov.strata.length, 5);
  assert.strictEqual(ov.counts.segments, 24);
  for (const st of ov.strata) {
    console.log(`${st.order}. ${st.label.padEnd(13)} ${String(st.value ?? '—').padStart(4)}%  ${st.level.padEnd(5)} ${st.read}`);
    for (const sg of st.segments) console.log(`     ${sg.code.padEnd(5)} ${sg.name.padEnd(24)} ${String(sg.value ?? '—').padStart(4)} ${sg.level.padEnd(5)} ${sg.label}${sg.detail ? ' · ' + sg.detail : ''}`);
  }
  const storageStratum = ov.strata.find((s) => s.id === 'storage');
  assert.ok(['warn', 'err'].includes(storageStratum.level), 'a 99% volume must not read as ok');

  console.log('\n=== SEGMENT ===');
  const seg = await dome.segment('airflow');
  console.log(seg.name, '|', seg.label, '|', seg.detail);
  console.log('sets:', seg.sets.map((s) => `${s.id}(${s.class}, ${s.available ? s.count + ' rows' : 'unavailable'})`).join(', '));
  assert.ok(seg.sets.every((s) => s.sample.length <= 12));

  console.log('\n=== DATASETS ===');
  const ds = await dome.datasets();
  const avail = ds.datasets.filter((d) => d.available).length;
  console.log(`${avail}/${ds.datasets.length} readable`);
  console.log(ds.datasets.filter((d) => !d.available).map((d) => `${d.id}: ${d.reason}`).join('\n') || '(all readable)');

  console.log('\n=== BRIEF ===');
  const b = await dome.brief({ presetId: 'thermal-brief' });
  console.log('preset:', b.preset.name, '| sets:', b.sets.map((s) => s.id).join(', '), '| chars:', b.chars);
  assert.ok(b.system.includes('sensors.tree'), 'brief carries the set');
  assert.ok(b.system.includes('[measured]'), 'class tags present');
  assert.ok(b.question.length > 20);
  console.log('--- first 700 chars of the pack ---');
  console.log(b.system.slice(0, 700));

  // The boundary: an unregistered id is refused.
  const bad = await dome.dataset('etc.passwd');
  assert.strictEqual(bad.available, false);
  assert.ok(/not in the data registry/.test(bad.reason));
  console.log('\nunregistered set refused ->', bad.reason);

  const scoped = await dome.brief({ scope: 'intelligence' });
  console.log('scope=intelligence sets:', scoped.sets.map((s) => s.id).join(', '));
  assert.ok(scoped.sets.length >= 4);

  console.log('\nALL DOME + FAN CHECKS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
