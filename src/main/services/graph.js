'use strict';
/**
 * ProGramerly - Relations: the machine as a graph
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * One read that joins what the other services already measure into nodes
 * and edges the Relations surface can draw:
 *
 *   machine ─ stratum hubs ─ volumes, interfaces, GPU, processes, listening
 *   ports, services, Ollama + models, environments, repositories, tools.
 *
 * Every edge is a relation that exists on the machine right now: a process
 * owns a port, a model is served by Ollama, an environment lives inside a
 * repository, a repository sits on a volume, a service runs as a process.
 * Nothing is drawn that was not read. Where a source is unavailable the
 * response says so in `gaps`, and that part of the graph is simply absent.
 *
 * Node shape:  { id, kind, label, sub, hue, weight, group, data, actions[] }
 * Edge shape:  { from, to, kind }
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

let services = {};
let ctx = { devRoot: () => path.join(os.homedir(), 'Development'), catalogPath: () => null };
function configure(c) { services = c.services || services; ctx = { ...ctx, ...c }; }

const HUE = {
  machine: '#00c8f0', hardware: '#f0a03c', system: '#8b7cf5', storage: '#bdd631',
  toolchain: '#2f7ff0', intelligence: '#00c8f0', network: '#2f7ff0',
  process: '#8b7cf5', hidden: '#5d7181', port: '#2f7ff0', service: '#a9762d',
  volume: '#bdd631', model: '#00c8f0', env: '#8b7cf5', repo: '#2f7ff0', tool: '#3d8f63', gpu: '#f0a03c', iface: '#2f7ff0',
};

const norm = (p) => (p ? path.resolve(String(p)).toLowerCase() : '');
const inside = (child, parent) => { const c = norm(child); const p = norm(parent); return Boolean(c && p && (c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep))); };

const SYSTEM_MOUNT = norm(process.platform === 'win32' ? `${process.env.SystemDrive || 'C:'}\\` : '/');
const isSystemVolume = (v) => { const m = norm(v.data.mount || v.data.name); return m === SYSTEM_MOUNT || m === SYSTEM_MOUNT.replace(/[\\/]$/, ''); };

function volumeOf(p, volumes) {
  const n = norm(p);
  if (!n) return null;
  let best = null;
  for (const v of volumes) {
    const mount = norm(v.data.mount || v.data.name);
    if (mount && n.startsWith(mount) && (!best || mount.length > norm(best.data.mount || best.data.name).length)) best = v;
  }
  return best;
}

/**
 * @param {{processLimit?:number, includeMicrosoft?:boolean}} opts
 */
async function build(opts = {}) {
  const limit = Number(opts.processLimit) || 40;
  const gaps = [];
  const nodes = new Map();
  const edges = [];
  const node = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, { weight: 1, actions: [], data: {}, ...n }); return nodes.get(n.id); };
  const edge = (from, to, kind) => { if (nodes.has(from) && nodes.has(to) && from !== to) edges.push({ from, to, kind }); };

  const host = os.hostname();
  node({ id: 'machine', kind: 'machine', label: host, sub: `${os.type()} ${os.release()} · ${os.arch()}`, hue: HUE.machine, weight: 6, group: 'machine' });
  for (const [id, label, sub] of [
    ['hardware', 'Hardware', 'CPU · memory · GPU'], ['system', 'System', 'processes · services · ports'],
    ['storage', 'Storage', 'volumes · repositories'], ['toolchain', 'Toolchain', 'installed tools · environments'],
    ['intelligence', 'Intelligence', 'AEDi · Ollama · models'],
  ]) { node({ id: `hub:${id}`, kind: 'hub', label, sub, hue: HUE[id], weight: 3.4, group: id }); edge('machine', `hub:${id}`, 'contains'); }

  /* ------------------------------------------------------------ hardware */
  const m = services.metrics && services.metrics.snapshot();
  if (m && m.at) {
    node({ id: 'cpu', kind: 'cpu', label: m.cpu.model || 'CPU', sub: `${m.cpu.cores} threads · ${Math.round(m.cpu.load)}% load`, hue: HUE.hardware, weight: 2.4, group: 'hardware', data: { load: m.cpu.load, cores: m.cpu.cores, mhz: m.cpu.speedMHz } });
    edge('hub:hardware', 'cpu', 'has');
    node({ id: 'ram', kind: 'ram', label: 'Memory', sub: `${(m.mem.total / 1024 ** 3).toFixed(0)} GB · ${Math.round(m.mem.usedPct)}% in use`, hue: HUE.hardware, weight: 2.2, group: 'hardware', data: { total: m.mem.total, free: m.mem.free, usedPct: m.mem.usedPct } });
    edge('hub:hardware', 'ram', 'has');
    for (const d of m.disks || []) {
      const id = `vol:${d.name}`;
      node({ id, kind: 'volume', label: d.name, sub: `${Math.round(d.usedPct)}% used · ${(d.free / 1024 ** 3).toFixed(0)} GB free`, hue: HUE.volume, weight: 1.6 + (d.total || 0) / 2e12, group: 'storage', data: { ...d, mount: d.mount || d.name }, actions: [{ act: 'open', path: d.mount || d.name, label: 'Open' }] });
      edge('hub:storage', id, 'mounts');
    }
    if (m.net && m.net.iface) {
      node({ id: `iface:${m.net.iface}`, kind: 'iface', label: m.net.iface, sub: `↓ ${(m.net.rxBps * 8 / 1e6).toFixed(1)} Mb/s · ↑ ${(m.net.txBps * 8 / 1e6).toFixed(1)} Mb/s`, hue: HUE.iface, weight: 1.8, group: 'system', data: m.net });
      edge('hub:system', `iface:${m.net.iface}`, 'has');
    }
  } else gaps.push('metrics: no sample yet');

  const ifs = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifs)) {
    const v4 = (addrs || []).find((a) => a.family === 'IPv4' && !a.internal);
    if (!v4) continue;
    const id = `iface:${name}`;
    if (!nodes.has(id)) { node({ id, kind: 'iface', label: name, sub: v4.address, hue: HUE.iface, weight: 1.4, group: 'system', data: { address: v4.address, mac: v4.mac } }); edge('hub:system', id, 'has'); } else nodes.get(id).data.address = v4.address;
  }

  try {
    const g = services.ai && await services.ai.gpu();
    if (g && g.available) for (const x of g.gpus || []) {
      const id = `gpu:${x.name}`;
      node({ id, kind: 'gpu', label: x.name, sub: `${((x.vramTotalMb - x.vramFreeMb) / 1024).toFixed(1)}/${(x.vramTotalMb / 1024).toFixed(0)} GB VRAM · ${x.utilPct}%`, hue: HUE.gpu, weight: 2.2, group: 'hardware', data: x });
      edge('hub:hardware', id, 'has');
    } else if (g && g.reason) gaps.push(`gpu: ${g.reason}`);
  } catch (e) { gaps.push(`gpu: ${e.message}`); }

  /* -------------------------------------------------------------- system */
  const volumes = [...nodes.values()].filter((n) => n.kind === 'volume');
  let procs = [];
  let procRead = null;
  try {
    procRead = await services.system.processes();
    if (!procRead.available) gaps.push(`processes: ${procRead.reason}`);
    procs = procRead.rows || [];
  } catch (e) { gaps.push(`processes: ${e.message}`); }

  let listen = [];
  try {
    const l = await services.system.listeners();
    if (!l.available) gaps.push(`listeners: ${l.reason}`); else listen = l.rows;
  } catch (e) { gaps.push(`listeners: ${e.message}`); }

  let svc = [];
  try {
    const s = await services.system.services();
    if (!s.available) gaps.push(`services: ${s.reason}`); else svc = s.rows;
  } catch (e) { gaps.push(`services: ${e.message}`); }

  // The processes worth a node: the heaviest by memory, everything that owns
  // a port, everything a running service points at, and their parents.
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const pick = new Set(procs.slice().sort((a, b) => (b.rss || 0) - (a.rss || 0)).slice(0, limit).map((p) => p.pid));
  for (const l of listen) if (l.pid && byPid.has(l.pid)) pick.add(l.pid);
  const runningSvc = svc.filter((s) => s.state === 'running' && s.pid && byPid.has(s.pid) && (opts.includeMicrosoft || !s.microsoft));
  for (const s of runningSvc) pick.add(s.pid);
  for (const pid of [...pick]) { const p = byPid.get(pid); if (p && p.ppid && byPid.has(p.ppid)) pick.add(p.ppid); }

  const maxRss = Math.max(1, ...procs.map((p) => p.rss || 0));
  for (const pid of pick) {
    const p = byPid.get(pid); if (!p) continue;
    node({
      id: `pid:${pid}`, kind: p.hidden ? 'hidden' : 'process', label: p.name, sub: `pid ${pid} · ${(p.rss / 1024 ** 2).toFixed(0)} MB${p.cpuSec != null ? ` · ${p.cpuSec}s cpu` : p.cpuPct != null ? ` · ${p.cpuPct}% cpu` : ''}`,
      hue: p.hidden ? HUE.hidden : HUE.process, weight: 1 + 2.2 * Math.sqrt((p.rss || 0) / maxRss), group: 'system',
      data: { pid, ppid: p.ppid, path: p.path, cmd: p.cmd, rss: p.rss, cpuSec: p.cpuSec, cpuPct: p.cpuPct, started: p.started, company: p.company, user: p.user, hidden: p.hidden },
      actions: [{ act: 'kill', pid, label: 'End process' }, ...(p.path ? [{ act: 'open', path: path.dirname(p.path), label: 'Open location' }] : [])],
    });
  }
  for (const pid of pick) {
    const p = byPid.get(pid); if (!p) continue;
    if (p.ppid && nodes.has(`pid:${p.ppid}`)) edge(`pid:${p.ppid}`, `pid:${pid}`, 'spawned');
    else edge('hub:system', `pid:${pid}`, 'runs');
    // A process on a non-system volume is worth an edge; every process being
    // on the system drive is not information, so that edge is left out.
    if (p.path) { const v = volumeOf(p.path, volumes); if (v && !isSystemVolume(v)) edge(v.id, `pid:${pid}`, 'stored-on'); }
  }

  for (const l of listen.filter((x) => x.proto === 'tcp' || x.proto === 'tcp6')) {
    const id = `port:${l.port}`;
    node({ id, kind: 'port', label: `:${l.port}`, sub: l.address === '0.0.0.0' || l.address === '::' ? 'all interfaces' : l.address, hue: HUE.port, weight: 1.2, group: 'system', data: l, actions: [{ act: 'port', port: l.port, label: 'Inspect port' }] });
    if (l.pid && nodes.has(`pid:${l.pid}`)) edge(`pid:${l.pid}`, id, 'listens'); else edge('hub:system', id, 'listens');
  }

  for (const s of runningSvc.slice(0, 60)) {
    const id = `svc:${s.name}`;
    node({ id, kind: 'service', label: s.label, sub: `${s.state} · ${s.start}`, hue: HUE.service, weight: 1.4, group: 'system', data: s, actions: [{ act: 'service', name: s.name, action: 'restart', label: 'Restart' }, { act: 'service', name: s.name, action: 'stop', label: 'Stop' }] });
    if (s.pid && nodes.has(`pid:${s.pid}`)) edge(id, `pid:${s.pid}`, 'runs-as'); else edge('hub:system', id, 'hosts');
  }

  /* -------------------------------------------------------- intelligence */
  let ollamaUp = false;
  try {
    const eps = services.ai ? await services.ai.endpoints() : [];
    for (const e of eps.filter((x) => x.up)) {
      const id = `ep:${e.id}`;
      node({ id, kind: 'endpoint', label: e.id === 'ollama' ? 'AEDi core · Ollama' : e.name, sub: `:${e.port} · ${(e.models || []).length} model(s)`, hue: HUE.model, weight: 2.6, group: 'intelligence', data: e, actions: [{ act: 'open-app', app: 'ai', label: 'Open Local AI' }] });
      edge('hub:intelligence', id, 'serves');
      const portNode = `port:${e.port}`; if (nodes.has(portNode)) edge(id, portNode, 'listens');
      const owner = listen.find((l) => l.port === e.port && l.pid); if (owner && nodes.has(`pid:${owner.pid}`)) edge(`pid:${owner.pid}`, id, 'is');
      if (e.id === 'ollama') ollamaUp = true;
    }
    if (ollamaUp) {
      const models = await services.ai.ollamaModels();
      const rows = (Array.isArray(models) ? models : (models && models.models)) || [];
      let loaded = new Set();
      try { const l = await services.ai.ollamaLoaded(); loaded = new Set(((Array.isArray(l) ? l : (l && l.models)) || []).map((x) => x.name || x.model)); } catch { /* none */ }
      for (const x of rows) {
        const name = x.name || x.model; const id = `model:${name}`;
        node({ id, kind: 'model', label: name, sub: `${((x.size || 0) / 1024 ** 3).toFixed(1)} GB${loaded.has(name) ? ' · resident' : ''}`, hue: HUE.model, weight: 1.3 + Math.min(2, (x.size || 0) / 8e9), group: 'intelligence', data: { ...x, loaded: loaded.has(name) }, actions: [{ act: 'chat', model: name, label: 'Ask this model' }] });
        edge('ep:ollama', id, 'holds');
      }
    } else gaps.push('ollama: not running - AEDi has no model to answer with');
  } catch (e) { gaps.push(`ai: ${e.message}`); }

  /* --------------------------------------------------- storage & toolchain */
  const devRoot = ctx.devRoot();
  node({ id: 'devroot', kind: 'folder', label: path.basename(devRoot) || devRoot, sub: fs.existsSync(devRoot) ? devRoot : 'not created yet', hue: HUE.storage, weight: 2, group: 'storage', data: { path: devRoot }, actions: [{ act: 'open', path: devRoot, label: 'Open' }] });
  { const v = volumeOf(devRoot, volumes); edge(v ? v.id : 'hub:storage', 'devroot', 'contains'); }

  let repos = [];
  try {
    const r = services.projects ? await services.projects.scan(devRoot) : { repos: [] };
    repos = r.repos || [];
    for (const x of repos) {
      const id = `repo:${x.dir}`;
      node({ id, kind: 'repo', label: x.name, sub: `${x.branch || '—'}${x.dirty ? ' · uncommitted' : ''}${Number(x.behind) > 0 ? ` · ${x.behind} behind` : ''}`, hue: HUE.repo, weight: 1.5 + (x.dirty ? 0.4 : 0), group: 'storage', data: x, actions: [{ act: 'open', path: x.dir, label: 'Open folder' }, { act: 'open-app', app: 'projects', label: 'Projects' }] });
      edge('devroot', id, 'contains');
    }
  } catch (e) { gaps.push(`repos: ${e.message}`); }

  try {
    const e = services.envs ? await services.envs.list() : { rows: [] };
    for (const x of e.rows || []) {
      const id = `env:${x.kind}:${x.dir || x.name}`;
      node({ id, kind: 'env', label: x.name, sub: `${x.kind}${x.python ? ` · ${x.python}` : ''}${x.status ? ` · ${x.status}` : ''}`, hue: HUE.env, weight: 1.4, group: 'toolchain', data: x, actions: [{ act: 'open-app', app: 'envs', label: 'Environments' }, ...(x.dir ? [{ act: 'open', path: x.dir, label: 'Open folder' }] : [])] });
      const repo = repos.find((r) => x.dir && inside(x.dir, r.dir) && norm(x.dir) !== norm(r.dir));
      edge(repo ? `repo:${repo.dir}` : 'hub:toolchain', id, repo ? 'inside' : 'has');
    }
  } catch (e) { gaps.push(`environments: ${e.message}`); }

  try {
    const cat = ctx.catalogPath() ? JSON.parse(fs.readFileSync(ctx.catalogPath(), 'utf8')) : null;
    const installed = new Set((services.settings && services.settings.get('installedIds')) || []);
    if (cat && installed.size) {
      const groups = new Map();
      for (const i of cat.items || []) if (installed.has(i.id)) { if (!groups.has(i.group)) groups.set(i.group, []); groups.get(i.group).push(i); }
      for (const [gid, items] of groups) {
        const g = (cat.groups || []).find((x) => x.id === gid) || { label: gid };
        const id = `tools:${gid}`;
        node({ id, kind: 'tool', label: g.label || gid, sub: `${items.length} installed by ProGramerly`, hue: HUE.tool, weight: 1.2 + items.length * 0.15, group: 'toolchain', data: { items: items.map((i) => i.name) }, actions: [{ act: 'open-app', app: 'software', label: 'Software' }] });
        edge('hub:toolchain', id, 'installed');
      }
    } else if (cat) gaps.push('tools: this install has not recorded any installs yet');
  } catch (e) { gaps.push(`catalogue: ${e.message}`); }

  try {
    const pins = services.programs ? services.programs.list() : [];
    for (const p of pins.filter((x) => x.public !== false)) {
      const id = `program:${p.id}`;
      node({ id, kind: 'program', label: p.product || p.name, sub: p.available ? (p.integrity === 'verified' ? 'verified' : 'in this build') : 'not in this build', hue: HUE.toolchain, weight: 1.3, group: 'toolchain', data: p, actions: p.launchable ? [{ act: 'launch', id: p.id, label: 'Open' }] : [] });
      edge('hub:toolchain', id, 'bundles');
    }
  } catch (e) { gaps.push(`programs: ${e.message}`); }

  const list = [...nodes.values()];
  const counts = list.reduce((a, n) => { a[n.kind] = (a[n.kind] || 0) + 1; return a; }, {});
  return {
    at: Date.now(), host, nodes: list, edges, gaps, counts,
    totals: { processes: procs.length, listeners: listen.length, services: svc.length, servicesRunning: svc.filter((s) => s.state === 'running').length, hidden: procs.filter((p) => p.hidden).length },
    sources: { processes: procRead && procRead.source },
  };
}

/** A compact text rendering of one node and its neighbours for the model. */
function describe(graph, nodeId) {
  const n = graph.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const out = [`# NODE ${n.id}`, `kind: ${n.kind}`, `label: ${n.label}`, `sub: ${n.sub || ''}`];
  const skip = new Set(['cmd']);
  for (const [k, v] of Object.entries(n.data || {})) if (!skip.has(k) && v != null && typeof v !== 'object') out.push(`${k}: ${v}`);
  if (n.data && n.data.cmd) out.push(`cmd: ${String(n.data.cmd).slice(0, 300)}`);
  const rel = graph.edges.filter((e) => e.from === n.id || e.to === n.id).slice(0, 40);
  out.push('', '# RELATIONS');
  for (const e of rel) {
    const other = graph.nodes.find((x) => x.id === (e.from === n.id ? e.to : e.from));
    if (other) out.push(`${e.from === n.id ? '→' : '←'} ${e.kind} ${other.kind} "${other.label}" (${other.sub || ''})`);
  }
  return out.join('\n');
}

module.exports = { configure, build, describe, HUE };
