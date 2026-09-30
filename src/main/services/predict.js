'use strict';
/**
 * ProGramerly - AEDi Predict
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * A forecast engine that runs on this machine and nowhere else. It answers
 * four questions before an install run starts and keeps learning after it:
 *
 *   1. Will each ticked item install cleanly here?      -> likelihood per item
 *   2. How long will the run take, how much disk?       -> minutes and GB
 *   3. What is the machine heading towards?             -> disk days-to-full, memory
 *   4. What belongs next to what is already here?       -> stated relations, not statistics
 *
 * Every number carries the class of the thing it was derived from, the way
 * the DOME does:
 *   measured  - read off this machine right now (free disk, engines on PATH, a
 *               port that answered)
 *   learned   - taken from previous runs on this machine (history.json)
 *   computed  - arithmetic over measured/learned/assumed inputs
 *   assumed   - the shipped prior in predict-priors.json, used until a run on
 *               this machine replaces it
 *
 * The likelihood is a Beta-style posterior: the prior is shrunk toward what
 * this machine has actually done. Three real outcomes outweigh the prior.
 *
 * No account, no cloud, no telemetry. The only network activity is a TCP
 * connect to the package hosts an item will need, so "offline" is measured,
 * not guessed.
 */

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const { has } = require('../installer/runner');
const { applies, orderSelection, PLATFORM } = require('../installer/engine');

const PRIORS = require('../data/predict-priors.json');

const IS_WIN = process.platform === 'win32';
const PRIOR_WEIGHT = 3;             // outcomes it takes to outweigh the shipped prior
const HISTORY_KEEP = 12;            // durations kept per item
const SAMPLE_EVERY_MS = 5 * 60 * 1000;
const SAMPLE_KEEP = 8640;           // 30 days at one sample per 5 minutes
const FACTS_TTL_MS = 60 * 1000;
const RESERVE_GB = 8;               // disk we refuse to plan into
const PROBE_TIMEOUT = 2500;

let dir = null;
let facts = null;                   // { at, engines, hosts }
let factsPromise = null;
let lastSampleAt = 0;

/* ------------------------------------------------------------------ paths */
function configure({ userData }) {
  dir = path.join(userData, 'predict');
  fs.mkdirSync(dir, { recursive: true });
}
const historyFile = () => path.join(dir, 'history.json');
const samplesFile = () => path.join(dir, 'samples.jsonl');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function history() {
  if (!dir) return { version: 1, items: {}, runs: [], speedFactor: 1, speedSamples: 0 };
  const h = readJson(historyFile(), null);
  return h && h.items ? h : { version: 1, items: {}, runs: [], speedFactor: 1, speedSamples: 0 };
}

/* ------------------------------------------------------------- the priors */
function priorFor(item) {
  const g = PRIORS.groupDefaults[item.group] || { min: 3, gb: 0.2, p: 0.85 };
  const i = PRIORS.items[item.id] || {};
  return {
    min: i.min != null ? i.min : g.min,
    gb: i.gb != null ? i.gb : g.gb,
    p: i.p != null ? i.p : g.p,
    itemSpecific: Boolean(PRIORS.items[item.id]),
  };
}

/* ---------------------------------------------------- what an item needs */
/** Engines and hosts an item will lean on, read from its spec. */
function needsOf(item) {
  const spec = item[PLATFORM] || {};
  const engines = new Set();
  const hosts = new Set();
  const steps = [...(spec.pre || []), ...(spec.steps || []), ...(item.steps || []), ...(spec.post || [])];

  if (PLATFORM === 'win' && Array.isArray(spec.winget) && spec.winget.length) { engines.add('winget'); hosts.add('winget'); }
  if (PLATFORM === 'win' && Array.isArray(spec.choco) && spec.choco.length) hosts.add('choco');
  if (PLATFORM === 'mac' && (spec.brew || spec.brewCask)) { engines.add('brew'); hosts.add('brew'); }
  if ((spec.npm || item.npm || []).length) { engines.add('npm'); hosts.add('npm'); }
  for (const s of steps) {
    const cmd = `${s.cmd || ''} ${s.winCmd || ''} ${s.macCmd || ''}`;
    switch (s.type) {
      case 'gitClone': engines.add('git'); hosts.add('github'); break;
      case 'venv': case 'venvPip': engines.add('python'); hosts.add('pypi'); break;
      case 'vscodeExt': engines.add('code'); hosts.add('vscode'); break;
      case 'scaffold': engines.add('npm'); hosts.add('npm'); break;
      case 'shell':
        if (/\buvx?\b/.test(cmd)) { engines.add('uv'); hosts.add('pypi'); }
        if (/\bpip\b|py -3|python3?\b/.test(cmd)) { engines.add('python'); hosts.add('pypi'); }
        if (/\bollama\b/.test(cmd)) { engines.add('ollama'); hosts.add('ollama'); }
        if (/\bnpx?\b|\bnpm\b/.test(cmd)) { engines.add('npm'); hosts.add('npm'); }
        if (/\bgit\b/.test(cmd)) engines.add('git');
        if (/\bfirebase\b/.test(cmd)) hosts.add('firebase');
        if (/\bfnm\b/.test(cmd)) hosts.add('node');
        if (/\bbrew\b/.test(cmd)) { engines.add('brew'); hosts.add('brew'); }
        break;
      default: break;
    }
  }
  return { engines: [...engines], hosts: [...hosts] };
}

/** Which catalog item makes an engine appear, so a queue can satisfy itself. */
const ENGINE_PROVIDERS = {
  winget: ['winget'], brew: ['homebrew'], npm: ['node-system', 'node'], git: ['git'],
  python: ['python'], uv: ['python-tooling'], code: ['vscode'], ollama: ['ollama'],
  java: ['java'],
};
const ENGINE_BINS = {
  winget: 'winget', brew: 'brew', npm: IS_WIN ? 'npm.cmd' : 'npm', git: 'git',
  python: IS_WIN ? 'py' : 'python3', uv: 'uvx', code: 'code', ollama: 'ollama', java: 'java',
  choco: 'choco',
};
const HOSTS = {
  winget: { host: 'cdn.winget.microsoft.com', port: 443, label: 'winget CDN' },
  choco: { host: 'community.chocolatey.org', port: 443, label: 'Chocolatey' },
  brew: { host: 'formulae.brew.sh', port: 443, label: 'Homebrew' },
  npm: { host: 'registry.npmjs.org', port: 443, label: 'npm registry' },
  github: { host: 'github.com', port: 443, label: 'GitHub' },
  pypi: { host: 'pypi.org', port: 443, label: 'PyPI' },
  ollama: { host: 'ollama.com', port: 443, label: 'Ollama library' },
  vscode: { host: 'marketplace.visualstudio.com', port: 443, label: 'VS Code Marketplace' },
  firebase: { host: 'firebase.googleapis.com', port: 443, label: 'Firebase' },
  node: { host: 'nodejs.org', port: 443, label: 'nodejs.org' },
};

function tcpReach({ host, port }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { sock.destroy(); } catch { /* gone */ } resolve({ ok, ms: Date.now() - started }); };
    sock.setTimeout(PROBE_TIMEOUT, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
}

/** Engines on PATH and package hosts that answer - measured, cached a minute. */
async function readFacts(force = false) {
  if (!force && facts && Date.now() - facts.at < FACTS_TTL_MS) return facts;
  if (factsPromise) return factsPromise;
  factsPromise = (async () => {
    const engineKeys = Object.keys(ENGINE_BINS).filter((k) => !(k === 'winget' && !IS_WIN) && !(k === 'choco' && !IS_WIN) && !(k === 'brew' && IS_WIN));
    const [engineResults, hostResults] = await Promise.all([
      Promise.all(engineKeys.map((k) => has(ENGINE_BINS[k]).catch(() => false))),
      Promise.all(Object.entries(HOSTS).map(([k, h]) => tcpReach(h).then((r) => [k, r]))),
    ]);
    const engines = {};
    engineKeys.forEach((k, i) => { engines[k] = Boolean(engineResults[i]); });
    const hosts = {};
    for (const [k, r] of hostResults) hosts[k] = r;
    const online = Object.values(hosts).some((h) => h.ok);
    facts = { at: Date.now(), engines, hosts, online, class: 'measured' };
    factsPromise = null;
    return facts;
  })();
  return factsPromise;
}

/* -------------------------------------------------------------- forecast */
function systemDisk(snapshot) {
  const disks = (snapshot && snapshot.disks) || [];
  if (!disks.length) return null;
  const sys = IS_WIN
    ? disks.find((d) => /^c:/i.test(d.name || ''))
    : disks.find((d) => d.name === '/');
  return sys || disks[0];
}

/**
 * Forecast an install run for the given selection.
 * @param {object} catalog  the catalog
 * @param {string[]} ids    ticked item ids
 * @param {object} ctx      { snapshot, elevated, facts? }
 */
async function forecast(catalog, ids, ctx = {}) {
  const f = ctx.facts || await readFacts();      // ctx.facts: the test harness injects a read
  const h = history();
  const queue = orderSelection(catalog, ids || []);
  const disk = systemDisk(ctx.snapshot);
  const freeGb = disk ? disk.free / 1e9 : null;
  const elevated = ctx.elevated !== false;

  const willProvide = new Set();       // engines the queue installs before they are needed
  const items = [];
  let cumGb = 0;
  let cumMin = 0;
  const risks = [];
  const risk = (level, text, cls, itemId) => risks.push({ level, text, class: cls, item: itemId || null });

  if (!f.online) risk('high', 'No package host answered a TCP connect - the machine looks offline. Nothing that downloads will succeed.', 'measured');
  if (freeGb != null && freeGb < RESERVE_GB) risk('high', `System disk has ${freeGb.toFixed(1)} GB free - below the ${RESERVE_GB} GB reserve.`, 'measured');
  if (PLATFORM === 'win' && !elevated && queue.some((i) => i.elevate)) {
    risk('med', 'Not running as administrator - items marked admin will each ask for consent, and silent installs may stall.', 'measured');
  }

  for (const item of queue) {
    const prior = priorFor(item);
    const hist = h.items[item.id] || { ok: 0, partial: 0, failed: 0, skipped: 0, ms: [] };
    const n = hist.ok + hist.partial + hist.failed;
    const need = needsOf(item);
    const notes = [];
    let p = prior.p;
    let pClass = 'assumed';

    // Learned outcome on this machine, shrunk toward the prior.
    if (n > 0) {
      p = (prior.p * PRIOR_WEIGHT + hist.ok + 0.5 * hist.partial) / (PRIOR_WEIGHT + n);
      pClass = 'learned';
      notes.push(`${hist.ok} ok / ${hist.partial} partial / ${hist.failed} failed here before`);
    }

    // Engines: on PATH now, provided earlier in this queue, or missing.
    for (const e of need.engines) {
      const present = f.engines[e];
      const providedByQueue = willProvide.has(e);
      const isSelfProvider = (ENGINE_PROVIDERS[e] || []).includes(item.id);
      if (present || providedByQueue || isSelfProvider) continue;
      const fallback = e === 'winget' && f.engines.choco;
      if (fallback) { p *= 0.85; notes.push('winget missing - Chocolatey fallback'); continue; }
      if (e === 'winget' && !f.engines.choco) { p *= 0.3; risk('high', `${item.name}: neither winget nor Chocolatey is on PATH.`, 'measured', item.id); continue; }
      p *= 0.35;
      risk('med', `${item.name} needs ${e} and it is not on PATH${ENGINE_PROVIDERS[e] ? ` - tick "${ENGINE_PROVIDERS[e][0]}" first` : ''}.`, 'measured', item.id);
    }
    for (const [eng, providers] of Object.entries(ENGINE_PROVIDERS)) if (providers.includes(item.id)) willProvide.add(eng);

    // Hosts: a package source that did not answer.
    for (const hkey of need.hosts) {
      const r = f.hosts[hkey];
      if (r && !r.ok) { p *= f.online ? 0.15 : 0.03; risk(f.online ? 'med' : 'low', `${HOSTS[hkey].label} did not answer - ${item.name} downloads from it.`, 'measured', item.id); }
    }

    // Disk: cumulative footprint against what is free, minus the reserve.
    cumGb += prior.gb;
    if (freeGb != null && cumGb > freeGb - RESERVE_GB) {
      p *= 0.2;
      risk('high', `By ${item.name} the run would have used ~${cumGb.toFixed(1)} GB of ${freeGb.toFixed(1)} GB free (reserve ${RESERVE_GB} GB).`, 'computed', item.id);
    }

    // Elevation on Windows.
    if (PLATFORM === 'win' && item.elevate && !elevated) p *= 0.6;

    p = Math.max(0.01, Math.min(0.99, p));

    // Minutes: learned median for this item if it has run here, else prior x the machine's speed factor.
    let minutes;
    let minClass;
    if (hist.ms && hist.ms.length >= 2) {
      const sorted = [...hist.ms].sort((a, b) => a - b);
      minutes = sorted[Math.floor(sorted.length / 2)] / 60000;
      minClass = 'learned';
    } else {
      minutes = prior.min * (h.speedFactor || 1);
      minClass = h.speedSamples > 0 ? 'computed' : 'assumed';
    }
    minutes = Math.max(0.1, minutes);
    cumMin += minutes;

    items.push({
      id: item.id, name: item.name, group: item.group,
      p: Math.round(p * 100) / 100, pClass,
      minutes: Math.round(minutes * 10) / 10, minClass,
      gb: prior.gb, gbClass: prior.itemSpecific ? 'assumed' : 'assumed',
      needs: need, notes, runs: n,
      elevate: Boolean(item.elevate), reboot: Boolean(item.reboot),
    });
  }

  const pAll = items.reduce((acc, i) => acc * i.p, 1);
  const expectedFailures = items.reduce((acc, i) => acc + (1 - i.p), 0);
  const learnedShare = items.length ? items.filter((i) => i.pClass === 'learned').length / items.length : 0;
  const overheadMin = items.length * 0.3;
  const total = cumMin + overheadMin;
  const spread = learnedShare > 0.6 ? [0.8, 1.35] : [0.65, 1.7];
  const shaky = items.filter((i) => i.p < 0.6).sort((a, b) => a.p - b.p);

  return {
    at: Date.now(),
    platform: PLATFORM,
    count: items.length,
    items,
    minutes: {
      expected: Math.round(total), low: Math.round(total * spread[0]), high: Math.round(total * spread[1]),
      class: learnedShare > 0 ? 'computed' : 'assumed',
      speedFactor: Math.round((h.speedFactor || 1) * 100) / 100, speedSamples: h.speedSamples || 0,
    },
    disk: {
      gb: Math.round(cumGb * 10) / 10, gbClass: 'assumed',
      freeGb: freeGb != null ? Math.round(freeGb * 10) / 10 : null, freeClass: 'measured',
      afterGb: freeGb != null ? Math.round((freeGb - cumGb) * 10) / 10 : null, afterClass: 'computed',
      reserveGb: RESERVE_GB, disk: disk ? disk.name : null,
    },
    likelihood: {
      allOk: Math.round(pAll * 100) / 100,
      expectedFailures: Math.round(expectedFailures * 10) / 10,
      class: 'computed', learnedShare: Math.round(learnedShare * 100) / 100,
    },
    shaky: shaky.slice(0, 6).map((i) => ({ id: i.id, name: i.name, p: i.p })),
    risks: risks.sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.level] - { high: 0, med: 1, low: 2 }[b.level])),
    facts: {
      online: f.online, engines: f.engines,
      hosts: Object.fromEntries(Object.entries(f.hosts).map(([k, r]) => [k, { label: HOSTS[k].label, ok: r.ok, ms: r.ms }])),
      elevated, at: f.at, class: 'measured',
    },
    runsRecorded: (h.runs || []).length,
  };
}

/* --------------------------------------------------------------- learning */
/**
 * After a run: fold each outcome and duration into history, and update the
 * machine's speed factor from predicted vs actual minutes.
 */
function record({ results = [], totalMs = 0, predicted = null } = {}) {
  if (!dir) return { ok: false, error: 'not configured' };
  const h = history();
  for (const r of results) {
    const e = h.items[r.id] || { ok: 0, partial: 0, failed: 0, skipped: 0, ms: [] };
    if (r.status === 'ok') e.ok += 1;
    else if (r.status === 'partial') e.partial += 1;
    else if (r.status === 'failed') e.failed += 1;
    else e.skipped += 1;
    if (r.status !== 'skipped' && r.ms > 0) { e.ms.push(Math.round(r.ms)); e.ms = e.ms.slice(-HISTORY_KEEP); }
    e.lastAt = Date.now();
    e.lastStatus = r.status;
    h.items[r.id] = e;
  }
  const ran = results.filter((r) => r.status !== 'skipped');
  if (predicted && predicted.minutes && ran.length && totalMs > 0) {
    // Compare only the items that actually ran, on their assumed minutes.
    const assumed = predicted.items
      .filter((i) => ran.some((r) => r.id === i.id) && i.minClass !== 'learned')
      .reduce((acc, i) => acc + i.minutes / (predicted.minutes.speedFactor || 1), 0);
    if (assumed > 0.5) {
      const actualMin = ran.reduce((acc, r) => acc + (r.ms || 0), 0) / 60000;
      const ratio = Math.max(0.2, Math.min(5, actualMin / assumed));
      const a = h.speedSamples > 0 ? 0.35 : 1;         // EMA, first sample takes the value whole
      h.speedFactor = Math.round(((h.speedFactor || 1) * (1 - a) + ratio * a) * 100) / 100;
      h.speedSamples = (h.speedSamples || 0) + 1;
    }
  }
  h.runs = [...(h.runs || []), {
    at: Date.now(), count: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    partial: results.filter((r) => r.status === 'partial').length,
    totalMs: Math.round(totalMs),
    predictedMin: predicted && predicted.minutes ? predicted.minutes.expected : null,
    predictedAllOk: predicted && predicted.likelihood ? predicted.likelihood.allOk : null,
  }].slice(-60);
  writeJson(historyFile(), h);
  return { ok: true, runs: h.runs.length, speedFactor: h.speedFactor };
}

/* ------------------------------------------------------- machine forecast */
/** Called on every metrics tick; keeps one sample per five minutes. */
function observe(snapshot) {
  if (!dir || !snapshot || !snapshot.at) return;
  const now = Date.now();
  if (now - lastSampleAt < SAMPLE_EVERY_MS) return;
  lastSampleAt = now;
  const line = JSON.stringify({
    t: now,
    mem: snapshot.mem ? Math.round(snapshot.mem.usedPct * 10) / 10 : null,
    cpu: snapshot.cpu ? Math.round(snapshot.cpu.load) : null,
    disks: (snapshot.disks || []).filter((d) => !d.removable).map((d) => ({ n: d.name, f: d.free, s: d.total })),
  });
  try {
    fs.appendFileSync(samplesFile(), `${line}\n`);
    // Trim occasionally - cheap enough at this cadence.
    if (Math.random() < 0.02) {
      const lines = fs.readFileSync(samplesFile(), 'utf8').split('\n').filter(Boolean);
      if (lines.length > SAMPLE_KEEP) fs.writeFileSync(samplesFile(), `${lines.slice(-SAMPLE_KEEP).join('\n')}\n`);
    }
  } catch { /* disk full is its own forecast */ }
}

function samples() {
  if (!dir) return [];
  try {
    return fs.readFileSync(samplesFile(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** Least-squares slope of y over x (ms). Returns per-day rate. */
function slopePerDay(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0; let den = 0;
  for (const p of points) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  if (!den) return null;
  return (num / den) * 86400000;
}

function machine(snapshot) {
  const all = samples();
  const now = Date.now();
  const week = all.filter((s) => now - s.t <= 7 * 86400000);
  const day = all.filter((s) => now - s.t <= 86400000);
  const spanH = week.length ? (week[week.length - 1].t - week[0].t) / 3600000 : 0;
  const enough = week.length >= 6 && spanH >= 2;

  const disks = [];
  const names = new Set();
  for (const s of week) for (const d of s.disks || []) names.add(d.n);
  const live = (snapshot && snapshot.disks) || [];
  for (const name of names) {
    const pts = week.filter((s) => (s.disks || []).some((d) => d.n === name)).map((s) => ({ x: s.t, y: (s.disks.find((d) => d.n === name) || {}).f }));
    const cur = live.find((d) => d.name === name) || null;
    const free = cur ? cur.free : (pts.length ? pts[pts.length - 1].y : null);
    const total = cur ? cur.total : ((week[week.length - 1].disks.find((d) => d.n === name) || {}).s || null);
    const slope = enough ? slopePerDay(pts) : null;          // bytes/day, negative = filling
    let daysToFull = null;
    if (slope != null && slope < -1e6 && free != null) daysToFull = Math.round(free / -slope);
    disks.push({
      name, free, total,
      usedPct: total ? Math.round(((total - free) / total) * 1000) / 10 : null,
      trendGbPerDay: slope != null ? Math.round((slope / 1e9) * 100) / 100 : null,
      daysToFull, daysClass: daysToFull != null ? 'computed' : null,
      class: cur ? 'measured' : 'learned',
      samples: pts.length,
    });
  }
  if (!disks.length && live.length) {
    for (const d of live.filter((x) => !x.removable)) disks.push({ name: d.name, free: d.free, total: d.total, usedPct: d.usedPct, trendGbPerDay: null, daysToFull: null, class: 'measured', samples: 0 });
  }

  const memVals = day.map((s) => s.mem).filter((v) => v != null);
  const cpuVals = day.map((s) => s.cpu).filter((v) => v != null);
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const max = (a) => (a.length ? Math.max(...a) : null);
  const memNow = snapshot && snapshot.mem ? Math.round(snapshot.mem.usedPct * 10) / 10 : null;

  const budget = (() => {
    const sys = disks.find((d) => (IS_WIN ? /^c:/i.test(d.name) : d.name === '/')) || disks[0];
    if (!sys || sys.free == null) return null;
    return { disk: sys.name, gb: Math.round(((sys.free / 1e9) - RESERVE_GB) * 10) / 10, reserveGb: RESERVE_GB, class: 'computed' };
  })();

  return {
    at: now,
    enough, samples: all.length, spanHours: Math.round(spanH * 10) / 10,
    note: enough ? null : 'Trend lines need at least six samples over two hours of use; ProGramerly keeps one every five minutes while it runs.',
    disks,
    memory: { now: memNow, nowClass: 'measured', avg24h: avg(memVals), peak24h: max(memVals), class: memVals.length ? 'learned' : null, samples: memVals.length },
    cpu: { avg24h: avg(cpuVals), peak24h: max(cpuVals), class: cpuVals.length ? 'learned' : null },
    installBudget: budget,
  };
}

/* ------------------------------------------------------------ suggestions */
function suggest(catalog, ids = [], installedIds = []) {
  const have = new Set([...ids, ...installedIds]);
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const out = [];
  const seen = new Set();
  const push = (id, reason, because, kind) => {
    if (seen.has(id) || have.has(id)) return;
    const item = byId.get(id);
    if (!item || !applies(item)) return;
    seen.add(id);
    out.push({ id, name: item.name, group: item.group, reason, because, kind, class: 'stated' });
  };
  for (const [a, b, why] of PRIORS.affinity.pairs) if (have.has(a)) push(b, why, a, 'relation');

  // Profile completion: mostly-covered profiles get their missing items named.
  for (const key of Object.keys(catalog.profiles)) {
    if (key === 'custom') continue;
    const members = catalog.items.filter((i) => applies(i) && (i.profiles || []).includes(key)).map((i) => i.id);
    if (!members.length) continue;
    const covered = members.filter((m) => have.has(m)).length / members.length;
    if (covered >= 0.6 && covered < 1) {
      for (const m of members.filter((x) => !have.has(x)).slice(0, 4)) push(m, `${Math.round(covered * 100)}% of the ${catalog.profiles[key].label} profile is here already`, key, 'profile');
    }
  }
  // Dependencies the queue will pull in anyway are worth showing as such.
  for (const id of ids) for (const dep of (byId.get(id) || {}).dependsOn || []) if (!have.has(dep)) push(dep, `${byId.get(id).name} depends on it - the run adds it for you`, id, 'dependency');
  return out.slice(0, 12);
}

/* ------------------------------------------------------------ explaining */
/** Chat messages for the local model: restate the pack, never invent a figure. */
function explainMessages(pack, machineInfo) {
  const lines = [];
  lines.push(`Selection: ${pack.count} items. Expected ${pack.minutes.expected} min (range ${pack.minutes.low}-${pack.minutes.high}, class ${pack.minutes.class}).`);
  lines.push(`Download ~${pack.disk.gb} GB (assumed); free now ${pack.disk.freeGb ?? 'unknown'} GB (measured); after ${pack.disk.afterGb ?? 'unknown'} GB (computed); reserve ${pack.disk.reserveGb} GB.`);
  lines.push(`Likelihood every item installs cleanly: ${Math.round(pack.likelihood.allOk * 100)}% (computed). Expected failures: ${pack.likelihood.expectedFailures}. Learned share: ${Math.round(pack.likelihood.learnedShare * 100)}%.`);
  lines.push(`Online: ${pack.facts.online}. Engines on PATH: ${Object.entries(pack.facts.engines).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}. Missing: ${Object.entries(pack.facts.engines).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'none'}.`);
  if (pack.shaky.length) lines.push(`Least likely: ${pack.shaky.map((s) => `${s.name} ${Math.round(s.p * 100)}%`).join('; ')}.`);
  if (pack.risks.length) lines.push(`Risks: ${pack.risks.slice(0, 6).map((r) => `[${r.level}] ${r.text}`).join(' ')}`);
  if (machineInfo && machineInfo.disks && machineInfo.disks.length) {
    lines.push(`Disks: ${machineInfo.disks.map((d) => `${d.name} ${d.free != null ? `${(d.free / 1e9).toFixed(1)} GB free` : ''}${d.daysToFull != null ? `, ~${d.daysToFull} days to full at ${d.trendGbPerDay} GB/day` : ''}`).join('; ')}.`);
  }
  return [
    {
      role: 'system',
      content: 'You are AEDi, the Ionity local core inside ProGramerly. You explain an install forecast to the person about to run it. Use ONLY the figures given; never invent a number, never round a class up (assumed stays assumed). Six sentences at most, plain language, no bullet points. End with the single most useful action.',
    },
    { role: 'user', content: `Forecast pack:\n${lines.join('\n')}\n\nExplain it.` },
  ];
}

function reset() {
  if (!dir) return { ok: false };
  try { fs.unlinkSync(historyFile()); } catch { /* none */ }
  try { fs.unlinkSync(samplesFile()); } catch { /* none */ }
  facts = null;
  return { ok: true };
}

module.exports = {
  configure, forecast, record, observe, machine, suggest, history, explainMessages, reset, readFacts,
  needsOf, priorFor, // exported for the test harness
};
