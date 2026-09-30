#!/usr/bin/env node
'use strict';
/* ProGramerly - AEDi Predict harness (no Electron, no network)
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Exercises the forecast engine against the real catalog with injected
   facts, then teaches it outcomes and checks that the posterior, the speed
   factor and the machine trend move the way they must. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const predict = require('../src/main/services/predict');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'catalog', 'catalog.json'), 'utf8'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-predict-'));
predict.configure({ userData: tmp });

const IS_WIN = process.platform === 'win32';
const allOk = (v) => Object.fromEntries(['winget', 'choco', 'brew', 'npm', 'git', 'python', 'uv', 'code', 'ollama', 'java'].map((k) => [k, v]));
const hostsOk = (ok) => Object.fromEntries(['winget', 'choco', 'brew', 'npm', 'github', 'pypi', 'ollama', 'vscode', 'firebase', 'node'].map((k) => [k, { ok, ms: ok ? 40 : 2500 }]));
const facts = (engines, hostsUp) => ({ at: Date.now(), engines, hosts: hostsOk(hostsUp), online: hostsUp, class: 'measured' });
const snapshot = (freeGb) => ({ at: Date.now(), mem: { usedPct: 55 }, cpu: { load: 12 }, disks: [{ name: IS_WIN ? 'C:' : '/', free: freeGb * 1e9, total: 500e9, usedPct: 50, removable: false }] });

let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

(async () => {
  console.log('AEDi Predict harness');

  ok('needsOf reads engines and hosts from a spec', () => {
    const n = predict.needsOf(catalog.items.find((i) => i.id === 'firebase-cli'));
    assert(n.engines.includes('npm'), 'npm engine'); assert(n.hosts.includes('npm'), 'npm host'); assert(n.hosts.includes('firebase'), 'firebase host');
    const g = predict.needsOf(catalog.items.find((i) => i.id === 'archify'));
    assert(g.engines.includes('git') && g.hosts.includes('github'), 'git clone needs git + github');
  });

  ok('every catalog item has a prior', () => {
    for (const it of catalog.items) { const p = predict.priorFor(it); assert(p.min > 0 && p.p > 0 && p.p < 1, it.id); }
  });

  const ids = ['git', 'node-system', 'claude-code', 'firebase-cli', 'whatsapp', 'google-drive', 'archify', 'kicad'];
  const healthy = await predict.forecast(catalog, ids, { snapshot: snapshot(200), elevated: true, facts: facts(allOk(true), true) });
  ok('healthy machine: a forecast with every class assumed and no risk', () => {
    assert(healthy.count >= ids.filter((id) => predict.needsOf(catalog.items.find((i) => i.id === id)) && true).length, 'dependencies pulled in');
    assert(healthy.items.every((i) => i.pClass === 'assumed'), 'no history yet');
    assert(healthy.risks.length === 0, `no risks: ${JSON.stringify(healthy.risks)}`);
    assert(healthy.likelihood.allOk > 0.2 && healthy.likelihood.allOk < 1, 'product of priors');
    assert(healthy.minutes.expected > 0 && healthy.minutes.low < healthy.minutes.high, 'range');
    assert(healthy.disk.afterGb < healthy.disk.freeGb, 'disk after');
  });

  const offline = await predict.forecast(catalog, ids, { snapshot: snapshot(200), elevated: true, facts: facts(allOk(true), false) });
  ok('offline: every downloading item collapses and a high risk is stated', () => {
    assert(offline.risks.some((r) => r.level === 'high' && /offline/.test(r.text)), 'offline risk');
    assert(offline.likelihood.allOk < 0.01, 'near zero');
    assert(offline.items.every((i) => i.p <= healthy.items.find((x) => x.id === i.id).p), 'never better than online');
  });

  const noNpm = await predict.forecast(catalog, ['firebase-cli'], { snapshot: snapshot(200), elevated: true, facts: facts({ ...allOk(true), npm: false }, true) });
  ok('a missing engine is a stated risk unless the queue provides it', () => {
    assert(noNpm.risks.some((r) => /needs npm/.test(r.text)), 'npm risk');
    const fb = noNpm.items.find((i) => i.id === 'firebase-cli');
    assert(fb.p < healthy.items.find((i) => i.id === 'firebase-cli').p, 'lower');
  });
  const provided = await predict.forecast(catalog, ['node-system', 'firebase-cli'], { snapshot: snapshot(200), elevated: true, facts: facts({ ...allOk(true), npm: false }, true) });
  ok('...and the queue providing node-system first removes that risk', () => {
    assert(!provided.risks.some((r) => /firebase.*needs npm/i.test(r.text)), JSON.stringify(provided.risks));
  });

  const cramped = await predict.forecast(catalog, ['visual-studio', 'android-studio'], { snapshot: snapshot(20), elevated: true, facts: facts(allOk(true), true) });
  ok('low disk is measured against the reserve', () => {
    assert(cramped.risks.some((r) => r.level === 'high' && /GB free/.test(r.text)), JSON.stringify(cramped.risks));
    assert(cramped.items.some((i) => i.p < 0.3), 'collapsed');
  });

  // Teach it.
  const before = healthy.items.find((i) => i.id === 'whatsapp').p;
  predict.record({ results: healthy.items.map((i) => ({ id: i.id, status: i.id === 'whatsapp' ? 'failed' : 'ok', ms: i.minutes * 60000 * 2 })), totalMs: healthy.minutes.expected * 60000 * 2, predicted: healthy });
  const after = await predict.forecast(catalog, ids, { snapshot: snapshot(200), elevated: true, facts: facts(allOk(true), true) });
  ok('a failure here lowers the posterior and marks it learned', () => {
    const w = after.items.find((i) => i.id === 'whatsapp');
    assert(w.pClass === 'learned' && w.p < before, `${w.p} < ${before}`);
    const g = after.items.find((i) => i.id === 'git');
    assert(g.pClass === 'learned' && g.p >= healthy.items.find((i) => i.id === 'git').p - 0.05, 'ok raises or holds');
  });
  ok('twice-as-slow runs double the speed factor', () => {
    const h = predict.history();
    assert(h.speedSamples === 1, 'one sample');
    assert(h.speedFactor > 1.6 && h.speedFactor < 2.4, `factor ${h.speedFactor}`);
    assert(after.minutes.expected > healthy.minutes.expected, 'slower forecast now');
    assert(after.minutes.class === 'computed', 'class moved off assumed');
  });
  predict.record({ results: healthy.items.map((i) => ({ id: i.id, status: 'ok', ms: i.minutes * 60000 })), totalMs: 1, predicted: after });
  const third = await predict.forecast(catalog, ids, { snapshot: snapshot(200), elevated: true, facts: facts(allOk(true), true) });
  ok('two timings per item switch minutes to the learned median', () => {
    assert(third.items.every((i) => i.minClass === 'learned'), 'learned minutes');
  });

  // Machine trend from synthetic samples: a disk losing 2 GB a day.
  const lines = [];
  const now = Date.now();
  for (let k = 48; k >= 0; k -= 1) lines.push(JSON.stringify({ t: now - k * 3600000, mem: 50 + (k % 7), cpu: 10 + (k % 5), disks: [{ n: IS_WIN ? 'C:' : '/', f: 100e9 - (48 - k) * (2e9 / 24), s: 500e9 }] }));
  fs.writeFileSync(path.join(tmp, 'predict', 'samples.jsonl'), `${lines.join('\n')}\n`);
  const m = predict.machine(snapshot(96));
  ok('machine(): regression finds ~2 GB/day and days-to-full', () => {
    assert(m.enough, 'enough samples');
    const d = m.disks[0];
    assert(d.trendGbPerDay < -1.7 && d.trendGbPerDay > -2.3, `trend ${d.trendGbPerDay}`);
    assert(d.daysToFull > 40 && d.daysToFull < 56, `days ${d.daysToFull}`);
    assert(m.memory.avg24h > 49 && m.memory.avg24h < 58, 'memory avg');
    assert(m.installBudget && m.installBudget.gb === 88, `budget ${JSON.stringify(m.installBudget)}`);
  });

  ok('suggest(): stated relations, profile completion, dependencies', () => {
    const s = predict.suggest(catalog, ['claude-desktop', 'firebase-cli'], []);
    assert(s.some((x) => x.id === 'mcp-config' && x.kind === 'relation'), 'claude-desktop -> mcp-config');
    const javaApplies = Boolean(catalog.items.find((i) => i.id === 'java')[IS_WIN ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux']);
    if (javaApplies) assert(s.some((x) => x.id === 'java'), 'firebase -> java (dependency or relation)');
    assert(s.some((x) => x.id === 'mcp-servers'), 'claude-desktop -> mcp-servers');
    assert(s.every((x) => x.class === 'stated'), 'all stated');
    assert(s.length <= 12, 'capped');
    const s2 = predict.suggest(catalog, ['claude-desktop', 'mcp-config'], []);
    assert(!s2.some((x) => x.id === 'mcp-config'), 'already selected is not suggested');
  });

  ok('explainMessages() restates figures and forbids invention', () => {
    const msgs = predict.explainMessages(third, m);
    assert(msgs[0].role === 'system' && /never invent/i.test(msgs[0].content));
    assert(msgs[1].content.includes(`${third.minutes.expected} min`), 'quotes the minutes');
  });

  ok('reset() returns to priors', () => {
    predict.reset();
    assert(predict.history().runs.length === 0);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} checks passed`);
})().catch((err) => { console.error('\nFAILED:', err.stack || err); process.exit(1); });
