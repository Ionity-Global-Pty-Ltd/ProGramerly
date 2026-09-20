'use strict';
/**
 * ProGramerly - the Ionity DOME
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Binds the framework in data/dome.json to the readers that actually exist on
 * this machine, and serves the data sets listed in data/datasets.json to the
 * local model.
 *
 * Three rules hold everywhere below:
 *
 *  1. A set is only servable if it is in the registry. There is no path from
 *     a question to a file that datasets.json does not name.
 *  2. Every figure carries the class of the set it came from - measured,
 *     catalogue, manifest, state or computed - and the brief handed to the
 *     model repeats those classes, so an answer can cite honestly.
 *  3. Readiness is computed here, now, from live readers. It is never stored,
 *     never carried between runs and never presented as a measurement when it
 *     is an assessment.
 *
 * Scans are expensive, so readers declare a cost and results are cached with a
 * short TTL. Nothing here ever throws at the caller: a reader that fails
 * returns unavailable with the reason, because "the sensor driver is not
 * running" is a finding, not an error.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REGISTRY = require('../data/datasets.json');
const FRAMEWORK = require('../data/dome.json');

/* ------------------------------------------------------------ wiring in */

// Injected by main.js so this module never reaches for Electron or for state
// it has no business owning (the dev root, the catalogue path, elevation).
let ctx = {
  devRoot: () => '',
  catalogPath: () => '',
  isElevated: async () => false,
  osLabel: () => `${os.type()} ${os.release()} (${os.arch()})`,
};
function configure(next) { ctx = { ...ctx, ...(next || {}) }; }

const services = {
  get metrics() { return require('./metrics'); },
  get hardware() { return require('./hardware'); },
  get fans() { return require('./fans'); },
  get doctor() { return require('./doctor'); },
  get registry() { return require('./registry'); },
  get projects() { return require('./projects'); },
  get ai() { return require('./ai'); },
  get ocr() { return require('./ocr'); },
  get programs() { return require('./programs'); },
  get settings() { return require('./settings'); },
  get system() { return require('./system'); },
  get envs() { return require('./envs'); },
  get sync() { return require('./sync'); },
  get openrgb() { return require('./openrgb'); },
};

/* --------------------------------------------------------------- cache */

const cache = new Map();
const TTL_LIVE = 3000;
const TTL_SCAN = 90000;

// A read already in flight is joined rather than started again: the deck, the
// DOME surface and a question from the model can all want the same set within
// the same second, and a registry scan or a repository sweep must run once.
const inflight = new Map();

async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    let value;
    try {
      value = await fn();
    } catch (error) {
      value = { available: false, reason: error.message || String(error) };
    }
    cache.set(key, { at: Date.now(), value });
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
function invalidate(prefix) {
  for (const k of [...cache.keys()]) if (!prefix || k.startsWith(prefix)) cache.delete(k);
}

const ok = (rows, extra = {}) => ({ available: true, rows, ...extra });
const gone = (reason) => ({ available: false, reason, rows: [] });
const WIN = process.platform === 'win32';

/* -------------------------------------------------------------- readers */

const READERS = {
  async sensors() {
    if (!WIN) return gone('Sensor telemetry is implemented for Windows.');
    const s = await services.hardware.sensors();
    if (!s.available) return gone(s.reason);
    const rows = [];
    for (const g of s.groups || []) {
      for (const x of g.sensors || []) {
        rows.push({ chip: g.label, name: x.name, type: x.type, value: x.value, unit: x.unit });
      }
    }
    return ok(rows, { reader: s.source });
  },

  async fanChannels() {
    const c = await services.fans.channels();
    if (!c.available) return gone(c.reason);
    return ok(c.channels, { temps: c.temps, counts: c.counts, reader: c.reader });
  },

  async fanProfiles() {
    const p = await services.fans.profiles();
    return ok(p.profiles, { active: p.active });
  },

  async metrics() {
    const m = services.metrics.snapshot();
    if (!m || !m.at) return gone('No metrics sample has been taken yet.');
    return ok([{
      host: m.host, platform: m.platform, uptimeSec: m.uptimeSec,
      cpuLoadPct: m.cpu && m.cpu.load, cpuCores: m.cpu && m.cpu.cores, cpuMHz: m.cpu && m.cpu.speedMHz,
      memUsedPct: m.mem && m.mem.usedPct, memTotal: m.mem && m.mem.total, memFree: m.mem && m.mem.free,
      packageTempC: m.temp && m.temp.c, tempSource: m.temp && m.temp.source,
      rxBps: m.net && m.net.rxBps, txBps: m.net && m.net.txBps,
    }]);
  },

  async disks() {
    const m = services.metrics.snapshot();
    const rows = (m && m.at && Array.isArray(m.disks) ? m.disks : [])
      .map((d) => ({ name: d.name, usedPct: d.usedPct, freeBytes: d.free, totalBytes: d.total }));
    return rows.length ? ok(rows) : gone('No volume data in the current sample.');
  },

  async memory() {
    if (!WIN) return gone('Standby-list detail is a Windows reader.');
    const m = await services.hardware.memoryState();
    if (!m || m.error) return gone((m && m.error) || 'Memory state unavailable.');
    return ok([m]);
  },

  async rgb() {
    const s = await services.openrgb.status();
    if (!s || !s.connected) return gone((s && s.error) || 'The OpenRGB server is not listening on 127.0.0.1:6742.');
    return ok((s.devices || []).map((d) => ({ name: d.name, type: d.type, zones: (d.zones || []).length, leds: d.ledCount })));
  },

  async privilege() {
    return ok([{ elevated: await ctx.isElevated(), platform: process.platform, os: ctx.osLabel() }]);
  },

  async registryFixes() {
    if (!WIN) return gone('The registry fix set applies to Windows.');
    const r = await services.registry.scan();
    const rows = (Array.isArray(r) ? r : (r && r.fixes) || []).map((f) => ({
      id: f.id, name: f.name, status: f.status, action: f.action, symptom: f.symptom || f.desc,
    }));
    return rows.length ? ok(rows) : gone('The fix set returned nothing.');
  },

  async ports() {
    const r = await services.doctor.scanCommonPorts();
    const rows = (r && (r.ports || r.rows || r)) || [];
    return Array.isArray(rows) && rows.length ? ok(rows) : gone('No listeners reported on the scanned ports.');
  },

  async environment() {
    const r = await services.doctor.environment();
    const rows = (r && (r.tools || r.rows || r.items)) || [];
    return Array.isArray(rows) && rows.length ? ok(rows) : gone('The environment probe returned nothing.');
  },

  async doctorFindings() {
    const r = await services.doctor.diagnose();
    const rows = (r && (r.results || r.items || r.findings || r.rows)) || [];
    return Array.isArray(rows) && rows.length ? ok(rows.map((x) => ({
      id: x.id, title: x.title || x.name, status: x.status || x.state, detail: x.detail || x.desc, fix: x.fix || x.action,
    }))) : gone('The diagnostic pass returned no items.');
  },

  async reclaim() {
    const r = await services.doctor.cleanupPreview();
    const rows = (Array.isArray(r) ? r : (r && (r.items || r.candidates || r.rows))) || [];
    return Array.isArray(rows) && rows.length ? ok(rows.map((x) => ({
      label: x.label || x.name, path: x.path, bytes: x.bytes ?? x.size,
    }))) : gone('Nothing measurable to reclaim was found.');
  },

  async catalogItems() {
    const cat = readCatalog();
    if (!cat) return gone('The catalogue could not be read.');
    return ok((cat.items || []).map((i) => ({
      id: i.id, name: i.name, group: i.group, profiles: i.profiles || [],
      dependsOn: i.dependsOn || [], win: Boolean(i.win), mac: Boolean(i.mac), desc: i.desc,
    })));
  },

  async catalogGroups() {
    const cat = readCatalog();
    if (!cat) return gone('The catalogue could not be read.');
    const counts = new Map();
    for (const i of cat.items || []) counts.set(i.group, (counts.get(i.group) || 0) + 1);
    return ok((cat.groups || []).map((g) => ({ id: g.id, name: g.name, items: counts.get(g.id) || 0 })));
  },

  async installed() {
    const ids = services.settings.get('installedIds') || [];
    return ok(ids.map((id) => ({ id })));
  },

  async programs() {
    const rows = services.programs.list().map((p) => ({
      id: p.id, name: p.product || p.name, file: p.file, expectedBytes: p.sizeBytes,
      sha256: p.sha256, available: p.available, integrity: p.integrity, public: p.public !== false,
    }));
    return ok(rows);
  },

  async repos() {
    const r = await services.projects.scan(ctx.devRoot());
    const rows = (Array.isArray(r) ? r : (r && r.repos)) || [];
    return rows.length ? ok(rows.map((x) => ({
      name: x.name, path: x.path, branch: x.branch, ahead: x.ahead, behind: x.behind,
      dirty: x.dirty, stack: x.stack,
    }))) : gone('No git working copies under the development root.');
  },

  async devroot() {
    const root = ctx.devRoot();
    let entries = null;
    let exists = false;
    try { entries = fs.readdirSync(root).length; exists = true; } catch { /* absent */ }
    return ok([{ path: root, exists, entries }]);
  },

  async models() {
    const m = await services.ai.ollamaModels();
    const rows = (Array.isArray(m) ? m : (m && m.models)) || [];
    if (!rows.length) return gone('Ollama holds no models, or is not running.');
    let loaded = [];
    try { const l = await services.ai.ollamaLoaded(); loaded = (Array.isArray(l) ? l : (l && l.models)) || []; } catch { /* none */ }
    const isLoaded = new Set(loaded.map((x) => x.name || x.model));
    return ok(rows.map((x) => ({
      name: x.name || x.model, sizeBytes: x.size ?? x.sizeBytes, family: x.family || (x.details && x.details.family),
      parameters: x.parameters || (x.details && x.details.parameter_size), loaded: isLoaded.has(x.name || x.model),
    })));
  },

  async ocrEngines() {
    const r = await services.ocr.engines();
    const rows = (r && r.engines) || [];
    if (!rows.length) return gone('No reader could be probed on this machine.');
    return ok(rows.map((x) => ({
      id: x.id, kind: x.kind, name: x.name, detail: x.detail,
      available: x.available, reason: x.reason || null,
    })));
  },

  async endpoints() {
    const e = await services.ai.endpoints();
    const rows = (e || []).filter((x) => x.up).map((x) => ({ id: x.id, name: x.name, port: x.port, models: (x.models || []).length, detail: x.detail }));
    return rows.length ? ok(rows) : gone('No local inference service is listening.');
  },

  async gpu() {
    const g = await services.ai.gpu();
    if (!g || !g.available) return gone((g && g.reason) || 'No accelerator reported.');
    return ok((g.gpus || []).map((x) => ({
      name: x.name, vramTotalMb: x.vramTotalMb, vramFreeMb: x.vramFreeMb,
      utilPct: x.utilPct, tempC: x.tempC, fits: x.fits,
    })));
  },

  async envs() {
    const e = await services.ai.environments(ctx.devRoot());
    const rows = [];
    for (const v of (e && e.venvs) || []) rows.push({ kind: v.kind || 'venv', name: v.name, path: v.dir || v.path, python: v.python || v.version || null });
    for (const c of (e && e.conda) || []) rows.push({ kind: 'conda', name: c.name, path: c.dir || c.path, python: c.python || null });
    for (const n of (e && e.node) || []) rows.push({ kind: 'node', name: `${n.manager || 'node'} ${n.version || ''}`.trim(), path: n.path || null, current: n.current });
    return rows.length ? ok(rows) : gone('No environments found under the development root.');
  },

  async links() {
    const file = path.join(__dirname, '..', 'data', 'links.json');
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rows = [];
      for (const g of data.groups || []) for (const l of g.links || []) rows.push({ group: g.label, name: l.name, url: l.url });
      return rows.length ? ok(rows) : gone('The link registry is empty.');
    } catch {
      return gone('links.json is not readable in this build.');
    }
  },

  async sync() {
    const s = services.sync.status();
    return ok([{ enabled: s.enabled, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, scope: Object.keys(s.scope || services.settings.get('syncScope') || {}).join(', ') }]);
  },

  async mcpConfig() {
    // The catalogue knows which MCP servers exist; the written config is the
    // client's, so absence here means "not configured", never "not installed".
    const cat = readCatalog();
    const items = ((cat && cat.items) || []).filter((i) => i.group === 'mcp' || /mcp/i.test(i.id));
    const installed = new Set(services.settings.get('installedIds') || []);
    if (!items.length) return gone('No MCP entries in the catalogue.');
    return ok(items.map((i) => ({ id: i.id, name: i.name, installed: installed.has(i.id) })), { reader: 'catalogue + installedIds - the client config files themselves are not read' });
  },

  async processes() {
    const r = await services.system.processes();
    if (!r.available) return gone(r.reason);
    return ok(r.rows.map((p) => ({ pid: p.pid, ppid: p.ppid, name: p.name, path: p.path, rss: p.rss, cpuSec: p.cpuSec, cpuPct: p.cpuPct, hidden: p.hidden, user: p.user, company: p.company })), { reader: r.source });
  },

  async services() {
    const r = await services.system.services();
    if (!r.available) return gone(r.reason);
    return ok(r.rows.map((x) => ({ name: x.name, label: x.label, state: x.state, start: x.start, pid: x.pid, path: x.path, account: x.account, os: x.microsoft })), { reader: r.source });
  },

  async startup() {
    const r = await services.system.startup();
    if (!r.available) return gone(r.reason);
    return ok(r.rows.map((x) => ({ kind: x.kind, source: x.source, scope: x.scope, name: x.name, command: x.command, enabled: x.enabled })), { reader: r.source });
  },

  async listeners() {
    const r = await services.system.listeners();
    if (!r.available) return gone(r.reason);
    return ok(r.rows, { reader: r.source });
  },

  async envsAll() {
    const r = await services.envs.list();
    const rows = (r && r.rows) || [];
    return rows.length ? ok(rows.map((x) => ({ kind: x.kind, name: x.name, dir: x.dir, python: x.python, status: x.status, deps: x.deps })), { roots: r.roots })
      : gone('No environments under the development root.');
  },

  async selfDatasets() {
    const rows = [];
    for (const d of REGISTRY.datasets) {
      if (d.id === 'dome.datasets' || d.id === 'dome.presets') { rows.push({ id: d.id, name: d.name, class: d.class, available: true, about: d.about }); continue; }
      const state = await peek(d);
      rows.push({ id: d.id, name: d.name, class: d.class, available: state.available, rows: state.available ? (state.rows || []).length : 0, reason: state.reason, about: d.about });
    }
    return ok(rows);
  },

  async selfPresets() {
    return ok(REGISTRY.presets.map((p) => ({ id: p.id, name: p.name, scope: p.scope, reads: p.reads, question: p.question })));
  },
};

function readCatalog() {
  try { return JSON.parse(fs.readFileSync(ctx.catalogPath(), 'utf8')); } catch { return null; }
}

/** Availability without paying for a scan: cheap sets are read, scans are reported by cache state. */
async function peek(def) {
  if (def.platform && def.platform !== (WIN ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux')) {
    return { available: false, reason: `This set is a ${def.platform} reader.` };
  }
  if (def.cost === 'scan') {
    const hit = cache.get(`ds:${def.id}`);
    if (hit) return hit.value;
    return { available: true, rows: [], deferred: true, reason: 'Not scanned yet - reading it runs a scan.' };
  }
  return dataset(def.id);
}

/* ------------------------------------------------------------- the sets */

function datasetDef(id) { return REGISTRY.datasets.find((d) => d.id === id) || null; }

/** Serve one registered set. Unregistered ids are refused, by design. */
async function dataset(id) {
  const def = datasetDef(id);
  if (!def) return { available: false, id, reason: `"${id}" is not in the data registry. Only registered sets can be read.` };
  const fn = READERS[def.reader];
  if (typeof fn !== 'function') return { available: false, id, reason: `No reader is wired for "${def.reader}".` };
  const ttl = def.cost === 'scan' ? TTL_SCAN : TTL_LIVE;
  const value = await cached(`ds:${id}`, ttl, fn);
  return { id, name: def.name, class: def.class, about: def.about, source: def.source, ...value };
}

async function datasets() {
  const listed = await dataset('dome.datasets');
  return { classes: REGISTRY.classes, datasets: listed.rows || [] };
}

function presets(scope) {
  const rows = REGISTRY.presets.filter((p) => !scope || scope === 'all' || p.scope === scope || p.scope === 'all');
  return rows.map((p) => ({ ...p }));
}

/* ----------------------------------------------------------- readiness */

/* Score sources - the word next to every percentage on the dome:
     measured   = a raw reading rescaled (free memory, VRAM, disk headroom)
     computed   = derived from real readings by a stated formula
     assessment = a judgement bucket (present / absent / both)
     state      = what this install recorded
     manifest   = pinned digests
     catalogue  = shipped data
   A percentage is only ever 'measured' when the underlying set is. */
const pct = (v) => (v == null ? null : Math.max(0, Math.min(100, Math.round(v))));
const scoreOf = (value, level, label, source, detail) => ({ value: pct(value), level, label, source, detail: detail || null });
const IDLE = (label, source = 'measured', detail = null) => ({ value: null, level: 'idle', label, source, detail });

/** One scorer per segment. Each reads only the sets its segment declares. */
const SCORERS = {
  async thermal(get) {
    const s = await get('sensors.tree');
    const m = await get('metrics.live');
    const temps = (s.rows || []).filter((r) => r.type === 'Temperature' && r.value != null);
    const pkg = (m.rows && m.rows[0] && m.rows[0].packageTempC) || null;
    const hottest = temps.length ? Math.max(...temps.map((t) => t.value)) : pkg;
    if (hottest == null) return IDLE('no sensor reading', 'measured', s.reason || 'No temperature source answered.');
    // Headroom against a 95 °C ceiling, floored at 30.
    const headroom = ((95 - hottest) / (95 - 30)) * 100;
    const level = hottest >= 88 ? 'err' : hottest >= 75 ? 'warn' : 'ok';
    return scoreOf(headroom, level, `${Math.round(hottest)} °C hottest`, 'computed', `${temps.length || 1} temperature source(s) · headroom to a 95 °C ceiling`);
  },

  async airflow(get) {
    const c = await get('fans.channels');
    if (!c.available) return IDLE('no fan data', 'measured', c.reason);
    const chans = c.rows || [];
    if (!chans.length) return IDLE('no fan channels', 'measured');
    const spinning = chans.filter((x) => x.spinning === true).length;
    const controllable = chans.filter((x) => x.controllable).length;
    const value = (controllable / chans.length) * 100;
    const level = spinning === 0 ? 'err' : controllable === 0 ? 'warn' : 'ok';
    return scoreOf(value, level, `${spinning}/${chans.length} spinning`, 'computed', `${controllable} controllable · share of channels with a curve`);
  },

  async power(get) {
    const s = await get('sensors.tree');
    const rows = (s.rows || []).filter((r) => (r.type === 'Voltage' || r.type === 'Power') && r.value != null);
    if (!rows.length) return IDLE('no rail data', 'measured', s.reason || 'The board exposes no voltage or power sensors.');
    return scoreOf(100, 'ok', `${rows.length} rails reported`, 'computed', 'present/absent only - a rail count is not a health reading');
  },

  async lighting(get) {
    const r = await get('rgb.devices');
    if (!r.available) return IDLE('not connected', 'measured', r.reason);
    return scoreOf(100, 'ok', `${(r.rows || []).length} device(s)`, 'computed', 'connected/not connected only');
  },

  async 'memory-phys'(get) {
    const m = await get('metrics.live');
    const row = (m.rows || [])[0];
    if (!row || row.memUsedPct == null) return IDLE('no sample', 'measured');
    const level = row.memUsedPct >= 92 ? 'err' : row.memUsedPct >= 80 ? 'warn' : 'ok';
    return scoreOf(100 - row.memUsedPct, level, `${Math.round(row.memUsedPct)}% in use`, 'measured', 'free share of installed memory, from the live sample');
  },

  async privilege(get) {
    const p = await get('system.privilege');
    const row = (p.rows || [])[0] || {};
    if (row.platform !== 'win32') return scoreOf(100, 'ok', 'prompts when needed', 'state');
    return row.elevated
      ? scoreOf(100, 'ok', 'administrator', 'state', 'installers inherit this token')
      : scoreOf(50, 'warn', 'standard user', 'state', 'admin items will prompt or skip');
  },

  async registry(get) {
    const r = await get('registry.fixes');
    if (!r.available) return IDLE('not scanned', 'measured', r.reason);
    const rows = r.rows || [];
    const actionable = rows.filter((x) => x.status === 'actionable').length;
    const level = actionable > 6 ? 'warn' : 'ok';
    return scoreOf(rows.length ? ((rows.length - actionable) / rows.length) * 100 : 100, level,
      `${actionable} actionable`, 'computed', `${rows.length} documented fixes · share already correct`);
  },

  async 'services-ports'(get) {
    const p = await get('ports.listeners');
    if (!p.available) return IDLE(p.rows && p.rows.length === 0 && !p.reason ? 'clear' : 'not scanned', 'measured', p.reason);
    return scoreOf(100, 'ok', `${(p.rows || []).length} listener(s)`, 'computed', 'scan completed - listener count is information, not a score');
  },

  async 'env-path'(get) {
    const e = await get('env.resolved');
    if (!e.available) return IDLE('not scanned', 'measured', e.reason);
    const rows = e.rows || [];
    const found = rows.filter((t) => t.found || t.version || t.path).length;
    return scoreOf(rows.length ? (found / rows.length) * 100 : null, found === rows.length ? 'ok' : 'warn',
      `${found}/${rows.length} resolved`, 'computed', 'share of probed tools on PATH');
  },

  async 'health-scan'(get) {
    const d = await get('doctor.findings');
    if (!d.available) return IDLE('not scanned', 'measured', d.reason);
    const rows = d.rows || [];
    const bad = rows.filter((x) => /fail|error|bad|missing/i.test(String(x.status || ''))).length;
    const warn = rows.filter((x) => /warn|attention/i.test(String(x.status || ''))).length;
    const level = bad ? 'err' : warn ? 'warn' : 'ok';
    return scoreOf(rows.length ? ((rows.length - bad - warn) / rows.length) * 100 : 100, level,
      bad || warn ? `${bad} failed · ${warn} warned` : `${rows.length} clean`, 'computed', 'share of checks that passed');
  },

  async processes(get) {
    const p = await get('system.processes');
    if (!p.available) return IDLE('not read', 'measured', p.reason);
    const s = await get('system.services');
    const st = await get('system.startup');
    const procs = p.rows || [];
    const hidden = procs.filter((x) => x.hidden).length;
    const running = (s.rows || []).filter((x) => x.state === 'running');
    const nonOs = running.filter((x) => !x.os).length;
    const starts = (st.rows || []).filter((x) => x.enabled).length;
    const level = starts > 12 ? 'warn' : 'ok';
    // Information, not a health figure: the value is the share of running
    // processes that are visible to the operator, so "unseen" is one glance.
    return scoreOf(procs.length ? ((procs.length - hidden) / procs.length) * 100 : null, level,
      `${procs.length} processes · ${hidden} unseen`, 'computed',
      `${running.length} services running (${nonOs} not OS) · ${starts} startup entries · visible share of processes`);
  },

  async volumes(get) {
    const d = await get('disks.volumes');
    const rows = d.rows || [];
    if (!rows.length) return IDLE('no volumes', 'measured', d.reason);
    const worst = Math.max(...rows.map((x) => Number(x.usedPct) || 0));
    const level = worst >= 92 ? 'err' : worst >= 82 ? 'warn' : 'ok';
    return scoreOf(100 - worst, level, `${Math.round(worst)}% on the fullest`, 'measured', `${rows.length} volume(s) · free share of the fullest`);
  },

  async devroot(get) {
    const d = await get('storage.devroot');
    const row = (d.rows || [])[0] || {};
    if (!row.exists) return scoreOf(0, 'warn', 'not created yet', 'state', row.path);
    return scoreOf(100, 'ok', `${row.entries} entries`, 'state', row.path);
  },

  async reclaim(get) {
    const r = await get('doctor.reclaim');
    if (!r.available) return IDLE('not scanned', 'measured', r.reason);
    const bytes = (r.rows || []).reduce((a, x) => a + (Number(x.bytes) || 0), 0);
    const gb = bytes / 1e9;
    const level = gb >= 20 ? 'warn' : 'ok';
    return scoreOf(Math.max(0, 100 - gb * 2), level, `${gb.toFixed(1)} GB reclaimable`, 'computed', `${(r.rows || []).length} candidates · 2 points per GB`);
  },

  async payload(get) {
    const p = await get('programs.pins');
    const rows = p.rows || [];
    if (!rows.length) return IDLE('no payload', 'manifest');
    const bad = rows.filter((x) => x.integrity === 'invalid').length;
    const verified = rows.filter((x) => x.integrity === 'verified').length;
    const here = rows.filter((x) => x.available).length;
    const level = bad ? 'err' : here === rows.length ? 'ok' : 'warn';
    const detail = bad ? `${bad} failed their pin`
      : verified === rows.length ? 'all pins hashed and matched'
        : `${verified} hashed · ${here - verified} size-matched, hashed on first launch`;
    return scoreOf((here / rows.length) * 100, level, `${here}/${rows.length} in this build`, 'manifest', detail);
  },

  async catalogue(get) {
    const c = await get('catalog.items');
    const rows = c.rows || [];
    if (!rows.length) return IDLE('unreadable', 'catalogue', c.reason);
    const key = WIN ? 'win' : 'mac';
    const usable = rows.filter((i) => i[key] || (i.dependsOn || []).length).length;
    return scoreOf((usable / rows.length) * 100, 'ok', `${rows.length} items`, 'catalogue',
      `${usable} resolve on this platform`);
  },

  async installed(get) {
    const i = await get('installed.ids');
    const c = await get('catalog.items');
    const have = new Set((i.rows || []).map((x) => x.id));
    const items = c.rows || [];
    if (!items.length) return IDLE('catalogue unreadable', 'catalogue');
    // Share of the smallest profile satisfied - a percentage of the whole
    // catalogue would read as 3% on a perfectly equipped machine.
    const minimal = items.filter((x) => (x.profiles || []).includes('minimal'));
    const base = minimal.length ? minimal : items;
    const done = base.filter((x) => have.has(x.id)).length;
    const level = have.size === 0 ? 'warn' : done === base.length ? 'ok' : 'warn';
    return scoreOf((done / base.length) * 100, level, `${have.size} installed`,
      'state', `${done}/${base.length} of the minimal profile`);
  },

  async resolvers(get) {
    const e = await get('env.resolved');
    if (!e.available) return IDLE('not scanned', 'measured', e.reason);
    const want = WIN ? ['winget', 'choco', 'npm', 'pip'] : process.platform === 'darwin' ? ['brew', 'npm', 'pip'] : ['apt|dnf|pacman', 'npm', 'pip'];
    const rows = e.rows || [];
    const have = want.filter((w) => rows.some((t) => new RegExp(w, 'i').test(String(t.name || '')) && (t.found || t.version || t.path)));
    return scoreOf((have.length / want.length) * 100, have.length === want.length ? 'ok' : 'warn',
      `${have.length}/${want.length} engines`, 'computed', have.join(', ') || 'none resolved');
  },

  async mcp(get) {
    const m = await get('mcp.config');
    if (!m.available) return IDLE('none in catalogue', 'catalogue', m.reason);
    const rows = m.rows || [];
    const on = rows.filter((x) => x.installed).length;
    return scoreOf((on / rows.length) * 100, on ? 'ok' : 'warn', `${on}/${rows.length} installed`, 'state');
  },

  async repos(get) {
    const r = await get('projects.repos');
    if (!r.available) return IDLE('none found', 'measured', r.reason);
    const rows = r.rows || [];
    const dirty = rows.filter((x) => x.dirty).length;
    const behind = rows.filter((x) => Number(x.behind) > 0).length;
    // Uncommitted work is normal on a working machine; being behind a remote
    // is the thing that bites. Neither is a failure, so neither zeroes this.
    const value = 100 - (dirty / rows.length) * 25 - (behind / rows.length) * 35;
    const level = behind ? 'warn' : 'ok';
    return scoreOf(value, level, `${rows.length} repositor${rows.length === 1 ? 'y' : 'ies'}`,
      'computed', `${dirty} with uncommitted work · ${behind} behind · weighted share`);
  },

  /* Reading a page locally needs one of two things, and they are not equal:
     an OCR engine returns characters, a vision model returns its reading of
     them. Having both is the healthy state; having neither means a scan
     cannot be read at all without sending it somewhere. */
  async vision(get) {
    const r = await get('ocr.engines');
    if (!r.available) return IDLE('no reader probed', 'measured', r.reason);
    const rows = r.rows || [];
    const engines = rows.filter((x) => x.kind === 'engine' && x.available);
    const models = rows.filter((x) => x.kind === 'vision' && x.available);
    if (!engines.length && !models.length) {
      return scoreOf(0, 'err', 'nothing can read a page', 'assessment',
        'Install the Tesseract engine or a tiny vision model from the Software workspace.');
    }
    const label = [
      engines.length ? `${engines.map((e) => e.name).join(', ')}` : 'no OCR engine',
      models.length ? `${models.length} vision model${models.length === 1 ? '' : 's'}` : 'no vision model',
    ].join(' · ');
    if (engines.length && models.length) return scoreOf(100, 'ok', label, 'assessment', 'both kinds of reader present');
    return scoreOf(55, 'warn', label, 'assessment',
      engines.length ? 'No vision model: handwriting and awkward layouts will not read well.'
        : 'No OCR engine: every page goes through a model, which is slower and less literal.');
  },

  async models(get) {
    const m = await get('ollama.models');
    if (!m.available) return IDLE('no models', 'measured', m.reason);
    const rows = m.rows || [];
    const loaded = rows.filter((x) => x.loaded).length;
    return scoreOf(Math.min(100, rows.length * 25), 'ok', `${rows.length} model(s)`, 'computed',
      `${loaded ? `${loaded} resident` : 'none resident'} · 25 points per model, capped`);
  },

  async accel(get) {
    const g = await get('gpu.devices');
    if (!g.available) return IDLE('no accelerator', 'measured', g.reason);
    const rows = g.rows || [];
    const free = rows.reduce((a, x) => a + (Number(x.vramFreeMb) || 0), 0);
    const total = rows.reduce((a, x) => a + (Number(x.vramTotalMb) || 0), 0);
    return scoreOf(total ? (free / total) * 100 : null, 'ok', `${(free / 1024).toFixed(1)} GB free`, 'measured',
      `${rows.map((x) => x.name).join(', ')} · free share of VRAM`);
  },

  async pyenv(get) {
    const e = await get('python.envs');
    if (!e.available) return IDLE('not scanned', 'measured', e.reason);
    return scoreOf(Math.min(100, (e.rows || []).length * 20), 'ok', `${(e.rows || []).length} environment(s)`, 'computed', '20 points per environment, capped');
  },

  async datasets(get) {
    const d = await get('dome.datasets');
    const rows = d.rows || [];
    const live = rows.filter((x) => x.available).length;
    return scoreOf((live / rows.length) * 100, 'ok', `${live}/${rows.length} readable`, 'catalogue',
      'sets the model may read');
  },

  async presets(get) {
    const p = await get('dome.presets');
    return scoreOf(null, 'ok', `${(p.rows || []).length} presets`, 'catalogue', 'standing questions - a count, not a score');
  },
};

/* ------------------------------------------------------------- surfaces */

/**
 * One reader per set per pass, memoised.
 *
 * In `quick` mode a scan-cost set that is not already cached is not run: it
 * comes back deferred, so the deck can paint the dome the instant the shell
 * is up while the full read - which walks the development root, the drives
 * and the listening ports - runs behind it. Nothing is invented for a
 * deferred set; its segment simply reports that it has not been read yet.
 */
function getter(opts = {}) {
  const seen = new Map();
  const quick = opts.quick === true;
  const deferred = new Set();
  const get = async (id) => {
    if (!seen.has(id)) {
      const def = datasetDef(id);
      if (quick && def && def.cost === 'scan' && !cache.get(`ds:${id}`)) {
        deferred.add(id);
        seen.set(id, {
          id, name: def.name, class: def.class, about: def.about, source: def.source,
          available: false, rows: [], deferred: true,
          reason: 'Not scanned yet - the full read is still running.',
        });
      } else {
        seen.set(id, await dataset(id));
      }
    }
    return seen.get(id);
  };
  get.deferred = deferred;
  return get;
}

async function scoreSegment(seg, get) {
  const fn = SCORERS[seg.id];
  if (typeof fn !== 'function') return IDLE('no scorer', 'assessment');
  try {
    // A segment whose sets have not been scanned yet says so. Scoring it from
    // an empty read would turn "not looked at" into "nothing there", which is
    // exactly the kind of claim this module exists to avoid.
    const reads = await Promise.all((seg.reads || []).map((id) => get(id)));
    if (reads.some((r) => r && r.deferred)) return IDLE('not scanned yet', 'measured');
    return await fn(get);
  } catch (e) { return IDLE('reader failed', 'measured', e.message); }
}

const WORST = { err: 3, warn: 2, ok: 1, idle: 0 };

/** The whole dome: five strata, each scored from its segments. */
async function overview(opts = {}) {
  const get = getter(opts);

  // Every set the 24 segments declare, read once and in parallel. Scoring then
  // runs against memoised results, so a pass costs the slowest reader rather
  // than the sum of all of them.
  const wanted = [...new Set(FRAMEWORK.strata.flatMap((s) => s.segments.flatMap((g) => g.reads || [])))];
  await Promise.all(wanted.map((id) => get(id).catch(() => null)));

  const strata = [];
  for (const s of FRAMEWORK.strata) {
    const segments = [];
    for (const seg of s.segments) {
      // eslint-disable-next-line no-await-in-loop
      const score = await scoreSegment(seg, get);
      segments.push({
        id: seg.id, code: seg.code, glyph: seg.glyph, name: seg.name, blurb: seg.blurb,
        reads: seg.reads, ...score,
      });
    }
    const scored = segments.filter((x) => x.value != null);
    const level = segments.reduce((a, x) => (WORST[x.level] > WORST[a] ? x.level : a), 'idle');
    strata.push({
      id: s.id, order: s.order, label: s.label, strap: s.strap, summary: s.summary,
      value: scored.length ? Math.round(scored.reduce((a, x) => a + x.value, 0) / scored.length) : null,
      level: level === 'idle' && scored.length ? 'ok' : level,
      read: `${scored.length}/${segments.length} read`,
      segments,
    });
  }
  return {
    version: FRAMEWORK.version,
    sourceNote: FRAMEWORK.sourceNote,
    at: Date.now(),
    host: os.hostname(),
    strata,
    quick: opts.quick === true,
    deferred: [...get.deferred],
    counts: {
      strata: strata.length,
      segments: strata.reduce((a, s) => a + s.segments.length, 0),
      datasets: REGISTRY.datasets.length,
      presets: REGISTRY.presets.length,
    },
  };
}

async function stratum(id) {
  const s = FRAMEWORK.strata.find((x) => x.id === id || String(x.order) === String(id));
  if (!s) throw new Error(`Unknown stratum "${id}".`);
  const get = getter();
  const segments = [];
  for (const seg of s.segments) {
    // eslint-disable-next-line no-await-in-loop
    segments.push({ ...seg, ...await scoreSegment(seg, get) });
  }
  return { ...s, segments, presets: presets(s.id) };
}

async function segment(id) {
  for (const s of FRAMEWORK.strata) {
    const seg = s.segments.find((x) => x.id === id || x.code.toLowerCase() === String(id).toLowerCase());
    if (!seg) continue;
    const get = getter();
    const score = await scoreSegment(seg, get);
    const sets = [];
    for (const dsId of seg.reads) {
      // eslint-disable-next-line no-await-in-loop
      const d = await get(dsId);
      sets.push({
        id: dsId, name: d.name, class: d.class, about: d.about, source: d.source,
        available: d.available, reason: d.reason, count: (d.rows || []).length,
        sample: (d.rows || []).slice(0, 12),
      });
    }
    return { ...seg, stratum: { id: s.id, label: s.label }, ...score, sets, presets: presets(s.id) };
  }
  throw new Error(`Unknown segment "${id}".`);
}

/* ---------------------------------------------------------- the brief */

function fmt(v) {
  if (v == null) return '-';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v).replace(/\s+/g, ' ').slice(0, 120);
}

/** One set rendered as a compact table the model can quote from. */
function renderSet(d, maxRows = 30) {
  const head = `## ${d.id} — ${d.name} [${d.class}]`;
  if (!d.available) return `${head}\nUNAVAILABLE: ${d.reason || 'no reason given'}\n`;
  const rows = d.rows || [];
  if (!rows.length) return `${head}\n(empty)\n`;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 8);
  const lines = [head, `about: ${d.about}`, `source: ${d.source}`, cols.join(' | ')];
  for (const r of rows.slice(0, maxRows)) lines.push(cols.map((c) => fmt(r[c])).join(' | '));
  if (rows.length > maxRows) lines.push(`… ${rows.length - maxRows} more rows not shown`);
  return `${lines.join('\n')}\n`;
}

const PREAMBLE = [
  'You are the local analyst inside ProGramerly, the Ionity workstation application.',
  'You run on this machine. Nothing you are shown leaves it.',
  '',
  'You are given DATA SETS read from this machine just now. Rules:',
  '- Answer ONLY from the sets below. If a set does not cover something, say so plainly.',
  '- Quote real figures, and name the set id you took each from, like (metrics.live).',
  '- Each set is tagged with a class. measured = read from a sensor, the OS or a live scan.',
  '  catalogue = curated data shipped with the app. manifest = pinned sizes and digests.',
  '  state = what this install recorded. computed = derived, never a reading.',
  '  Never present a catalogue, state or computed figure as a measurement.',
  '- A set marked UNAVAILABLE was not readable. Report the gap; never estimate around it.',
  '- Be concise and concrete. No preamble, no apology, no invented numbers.',
].join('\n');

/**
 * Build the context pack for a question.
 * @param {{scope?:string, setIds?:string[], presetId?:string}} opts
 */
async function brief(opts = {}) {
  const preset = opts.presetId ? REGISTRY.presets.find((p) => p.id === opts.presetId) : null;
  let setIds = opts.setIds && opts.setIds.length ? opts.setIds : null;

  if (!setIds && preset) setIds = preset.reads;
  if (!setIds && opts.scope && opts.scope !== 'all') {
    const s = FRAMEWORK.strata.find((x) => x.id === opts.scope);
    const seg = !s && FRAMEWORK.strata.flatMap((x) => x.segments).find((x) => x.id === opts.scope);
    if (s) setIds = [...new Set(s.segments.flatMap((x) => x.reads))];
    else if (seg) setIds = seg.reads;
  }
  if (!setIds) setIds = ['metrics.live', 'disks.volumes', 'sensors.tree', 'installed.ids', 'programs.pins'];

  // Only registered ids survive.
  setIds = setIds.filter((id) => datasetDef(id));

  const parts = [];
  const used = [];
  for (const id of setIds) {
    // eslint-disable-next-line no-await-in-loop
    const d = await dataset(id);
    used.push({ id, available: d.available, rows: (d.rows || []).length });
    parts.push(renderSet(d));
  }

  const header = [
    `# MACHINE: ${os.hostname()} — ${ctx.osLabel()}`,
    `# READ AT: ${new Date().toISOString()}`,
    `# SETS: ${used.map((u) => u.id).join(', ') || 'none'}`,
  ].join('\n');

  return {
    system: `${PREAMBLE}\n\n${header}\n\n${parts.join('\n')}`,
    question: preset ? preset.question : null,
    preset: preset ? { id: preset.id, name: preset.name, scope: preset.scope } : null,
    sets: used,
    chars: parts.reduce((a, p) => a + p.length, 0),
  };
}

module.exports = {
  configure, overview, stratum, segment, dataset, datasets, presets, brief,
  invalidate, FRAMEWORK, REGISTRY,
};
