'use strict';
/**
 * ProGramerly - AI workspace
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Everything about the machine's AI side, discovered rather than assumed:
 *
 *  - which local inference servers are actually listening, and what each one
 *    says it is serving
 *  - which models Ollama holds on disk, and which are loaded in VRAM right now
 *  - pulling a new model, with real byte-level progress from Ollama's own
 *    streaming API
 *  - every Python virtual environment on the box, which interpreter each was
 *    built from, and which one this session is standing in
 *  - conda environments and Node version managers, the same way
 *
 * Node standard library only. Nothing here talks to the internet except
 * through the local Ollama daemon, which does its own downloading.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { run, has } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';

/* --------------------------------------------------------------- plumbing */

/** A localhost GET that returns parsed JSON, or null. Never throws. */
function getJson(port, urlPath, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** Is anything listening here at all? Cheap, and separates "down" from "odd". */
function portOpen(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, '127.0.0.1');
  });
}

function human(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/* ---------------------------------------------------------- AI endpoints */

/*
 * Every one of these is a service people actually run locally. The port is
 * the default; a moved service simply will not be found, which is honest -
 * better than claiming it is absent when it is merely elsewhere.
 */
const ENDPOINTS = [
  { id: 'ollama', name: 'Ollama', port: 11434, probe: '/api/tags', kind: 'ollama' },
  { id: 'lmstudio', name: 'LM Studio', port: 1234, probe: '/v1/models', kind: 'openai' },
  { id: 'llamacpp', name: 'llama.cpp server', port: 8080, probe: '/v1/models', kind: 'openai' },
  { id: 'vllm', name: 'vLLM', port: 8000, probe: '/v1/models', kind: 'openai' },
  { id: 'jan', name: 'Jan', port: 1337, probe: '/v1/models', kind: 'openai' },
  { id: 'tgwebui', name: 'Text generation WebUI', port: 5000, probe: '/v1/models', kind: 'openai' },
  { id: 'localai', name: 'LocalAI', port: 8081, probe: '/v1/models', kind: 'openai' },
  { id: 'openwebui', name: 'Open WebUI', port: 3000, probe: '/api/config', kind: 'plain' },
  { id: 'comfyui', name: 'ComfyUI', port: 8188, probe: '/system_stats', kind: 'plain' },
  { id: 'a1111', name: 'Stable Diffusion WebUI', port: 7860, probe: '/sdapi/v1/options', kind: 'plain' },
  { id: 'qdrant', name: 'Qdrant', port: 6333, probe: '/collections', kind: 'plain' },
  { id: 'chroma', name: 'Chroma', port: 8000, probe: '/api/v1/heartbeat', kind: 'plain' },
];

async function endpoints() {
  const rows = await Promise.all(ENDPOINTS.map(async (e) => {
    const open = await portOpen(e.port);
    if (!open) return { ...e, up: false, models: [], detail: 'not listening' };
    const data = await getJson(e.port, e.probe);
    let models = [];
    if (e.kind === 'ollama' && data && Array.isArray(data.models)) {
      models = data.models.map((m) => m.name || m.model).filter(Boolean);
    } else if (e.kind === 'openai' && data && Array.isArray(data.data)) {
      models = data.data.map((m) => m.id).filter(Boolean);
    }
    return {
      ...e,
      up: true,
      models,
      detail: models.length
        ? `${models.length} model${models.length === 1 ? '' : 's'} served`
        : data ? 'responding' : 'port open, API did not answer as expected',
    };
  }));
  // Two services share port 8000 by default; only report the one that answered.
  const byPort = new Map();
  for (const r of rows) {
    if (!r.up) continue;
    const prev = byPort.get(r.port);
    if (!prev || (r.models.length && !prev.models.length)) byPort.set(r.port, r);
  }
  return rows.filter((r) => !r.up || byPort.get(r.port) === r);
}

/* --------------------------------------------------------------- Ollama */

async function ollamaModels() {
  const data = await getJson(11434, '/api/tags', 6000);
  if (!data || !Array.isArray(data.models)) return { up: false, models: [] };
  return {
    up: true,
    models: data.models.map((m) => ({
      name: m.name || m.model,
      size: m.size,
      sizeHuman: human(m.size),
      family: m.details?.family || '',
      parameters: m.details?.parameter_size || '',
      quant: m.details?.quantization_level || '',
      modified: m.modified_at || '',
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** What is loaded in VRAM at this instant, and when it will be evicted. */
async function ollamaLoaded() {
  const data = await getJson(11434, '/api/ps', 4000);
  if (!data || !Array.isArray(data.models)) return [];
  return data.models.map((m) => ({
    name: m.name || m.model,
    sizeHuman: human(m.size),
    vramHuman: human(m.size_vram),
    onGpu: Number(m.size_vram) > 0,
    expiresAt: m.expires_at || '',
  }));
}

/**
 * Pull a model. Ollama streams newline-delimited JSON with real byte counts,
 * so the progress reported here is the download's own, not an estimate.
 */
function ollamaPull(model, onProgress) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ model, stream: true });
    const req = http.request({
      host: '127.0.0.1', port: 11434, path: '/api/pull', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let buf = '';
      let lastPct = -1;
      let lastStatus = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.error) { onProgress({ error: msg.error }); continue; }
          const total = Number(msg.total) || 0;
          const completed = Number(msg.completed) || 0;
          const pct = total ? Math.floor((completed / total) * 100) : null;
          // Only speak when something changed - a pull emits hundreds of these.
          if (msg.status !== lastStatus || (pct !== null && pct !== lastPct)) {
            lastStatus = msg.status || lastStatus;
            if (pct !== null) lastPct = pct;
            onProgress({
              status: msg.status || '',
              pct,
              completed, total,
              text: total
                ? `${msg.status}  ${pct}%  ${human(completed)} / ${human(total)}`
                : String(msg.status || ''),
            });
          }
        }
      });
      res.on('end', () => resolve({ ok: res.statusCode === 200, code: res.statusCode }));
    });
    req.on('error', (e) => {
      onProgress({ error: e.message });
      resolve({ ok: false, error: e.message });
    });
    req.write(payload);
    req.end();
  });
}

function ollamaDelete(model) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ model });
    const req = http.request({
      host: '127.0.0.1', port: 11434, path: '/api/delete', method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ok: res.statusCode === 200, code: res.statusCode }));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

/** A short, opinionated list so the download box is not an empty text field. */
const CURATED = [
  { name: 'llama3.2:3b', note: 'Small, fast, genuinely useful. Good first model.', size: '~2 GB' },
  { name: 'llama3.1:8b', note: 'The general-purpose workhorse.', size: '~4.7 GB' },
  { name: 'qwen2.5-coder:7b', note: 'Code completion and review.', size: '~4.7 GB' },
  { name: 'qwen2.5-coder:14b', note: 'Noticeably better code, needs the VRAM.', size: '~9 GB' },
  { name: 'deepseek-r1:8b', note: 'Reasoning traces, shows its working.', size: '~4.9 GB' },
  { name: 'mistral:7b', note: 'Fast, permissive licence.', size: '~4.1 GB' },
  { name: 'phi4:14b', note: "Microsoft's small model, strong at maths.", size: '~9 GB' },
  { name: 'gemma2:9b', note: 'Google, good instruction following.', size: '~5.4 GB' },
  { name: 'nomic-embed-text', note: 'Embeddings, not chat. For RAG.', size: '~275 MB' },
  { name: 'llava:7b', note: 'Vision - describe and read images.', size: '~4.7 GB' },
];

/* ------------------------------------------------------ Python and Node */

/**
 * Find virtual environments by their marker file. A venv is exactly a folder
 * containing pyvenv.cfg, so this finds every one of them and nothing else -
 * no guessing from folder names.
 */
function findVenvs(roots, { maxDepth = 4, limit = 200 } = {}) {
  const out = [];
  const active = process.env.VIRTUAL_ENV ? path.resolve(process.env.VIRTUAL_ENV) : '';
  const skip = new Set(['node_modules', '.git', '.cache', 'AppData', 'Library', 'dist', 'build', '__pycache__', '.next']);

  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    const cfg = entries.find((e) => e.isFile() && e.name === 'pyvenv.cfg');
    if (cfg) {
      let version = '';
      let base = '';
      try {
        const text = fs.readFileSync(path.join(dir, 'pyvenv.cfg'), 'utf8');
        version = (text.match(/^version\s*=\s*(.+)$/mi) || [])[1]?.trim()
               || (text.match(/^version_info\s*=\s*(.+)$/mi) || [])[1]?.trim() || '';
        base = (text.match(/^home\s*=\s*(.+)$/mi) || [])[1]?.trim() || '';
      } catch { /* unreadable - still a venv */ }
      const exe = IS_WIN ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python');
      let size = 0;
      try { size = fs.statSync(exe).isFile() ? 1 : 0; } catch { size = 0; }
      out.push({
        kind: 'venv',
        name: path.basename(dir),
        dir,
        parent: path.basename(path.dirname(dir)),
        version,
        base,
        healthy: Boolean(size),
        active: active && path.resolve(dir) === active,
      });
      return;   // a venv contains no other venvs worth finding
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (skip.has(e.name)) continue;
      if (e.name.startsWith('.') && !['.venv', '.virtualenvs', '.conda'].includes(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };

  for (const r of roots) { if (r && fs.existsSync(r)) walk(r, 0); }
  return out;
}

async function condaEnvs() {
  if (!(await has('conda'))) return [];
  const { code, output } = await run('conda env list --json', { timeoutMs: 20000 });
  if (code !== 0) return [];
  try {
    const data = JSON.parse(output);
    const active = process.env.CONDA_PREFIX ? path.resolve(process.env.CONDA_PREFIX) : '';
    return (data.envs || []).map((d) => ({
      kind: 'conda',
      name: path.basename(d) || 'base',
      dir: d,
      parent: path.basename(path.dirname(d)),
      version: '',
      healthy: true,
      active: active && path.resolve(d) === active,
    }));
  } catch { return []; }
}

async function nodeVersions() {
  const rows = [];
  if (await has('fnm')) {
    const { output } = await run('fnm list', { timeoutMs: 15000 });
    String(output || '').split(/\r?\n/).filter(Boolean).forEach((l) => {
      const m = l.match(/(v\d+\.\d+\.\d+)/);
      if (m) rows.push({ manager: 'fnm', version: m[1], current: /default|current|\*/.test(l) });
    });
  }
  if (await has('nvm')) {
    const { output } = await run('nvm list', { timeoutMs: 15000 });
    String(output || '').split(/\r?\n/).filter(Boolean).forEach((l) => {
      const m = l.match(/(\d+\.\d+\.\d+)/);
      if (m) rows.push({ manager: 'nvm', version: `v${m[1]}`, current: /\*|->/.test(l) });
    });
  }
  return rows;
}

async function environments(devRoot) {
  const home = os.homedir();
  const roots = [devRoot, path.join(home, 'Development'), path.join(home, 'projects'),
    path.join(home, 'source'), path.join(home, '.virtualenvs')].filter(Boolean);
  const seen = new Set();
  const uniqueRoots = roots.filter((r) => { const k = path.resolve(r); if (seen.has(k)) return false; seen.add(k); return true; });
  const venvs = findVenvs(uniqueRoots);
  const conda = await condaEnvs();
  const node = await nodeVersions();
  return {
    roots: uniqueRoots,
    venvs: [...venvs, ...conda].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    node,
    activeVenv: process.env.VIRTUAL_ENV || process.env.CONDA_PREFIX || '',
  };
}

module.exports = {
  endpoints,
  ollamaModels,
  ollamaLoaded,
  ollamaPull,
  ollamaDelete,
  environments,
  CURATED,
  human,
};

/* ======================================================================== *
 *  Talking to the models - chat, benchmark, GPU
 * ======================================================================== */

/** A localhost POST that streams the body back line by line. Never throws. */
function streamPost(port, urlPath, payload, onLine) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) if (l.trim()) onLine(l.trim());
      });
      res.on('end', () => { if (buf.trim()) onLine(buf.trim()); resolve({ ok: res.statusCode === 200, code: res.statusCode }); });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

/**
 * One chat turn against a local model, streamed token by token.
 * Ollama's native API when the endpoint is Ollama; the OpenAI-compatible
 * /v1/chat/completions everywhere else (LM Studio, llama.cpp, vLLM, Jan...).
 * Returns the real generation statistics when the server provides them.
 */
async function chat({ endpointId, port, model, messages }, onToken) {
  const ep = ENDPOINTS.find((e) => e.id === endpointId) || { kind: 'openai', port };
  const p = port || ep.port;
  const started = Date.now();
  let text = '';
  let stats = null;

  if (ep.kind === 'ollama') {
    const res = await streamPost(p, '/api/chat', { model, messages, stream: true }, (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.error) { onToken({ error: msg.error }); return; }
      const t = msg.message?.content || '';
      if (t) { text += t; onToken({ token: t }); }
      if (msg.done) {
        const evalS = (msg.eval_duration || 0) / 1e9;
        stats = {
          promptTokens: msg.prompt_eval_count || 0,
          tokens: msg.eval_count || 0,
          tokensPerSec: evalS > 0 ? +((msg.eval_count || 0) / evalS).toFixed(1) : null,
          loadMs: Math.round((msg.load_duration || 0) / 1e6),
          totalMs: Math.round((msg.total_duration || 0) / 1e6),
          measured: true,
        };
      }
    });
    if (!res.ok && !text) return { ok: false, error: res.error || `HTTP ${res.code}` };
    return { ok: true, text, stats, elapsedMs: Date.now() - started };
  }

  // OpenAI-compatible SSE. Token counts are the server's if it sends usage,
  // otherwise chunk-counted and marked as such - an estimate must say so.
  let chunks = 0;
  const res = await streamPost(p, '/v1/chat/completions', { model, messages, stream: true }, (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return;
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.error) { onToken({ error: msg.error.message || String(msg.error) }); return; }
    const t = msg.choices?.[0]?.delta?.content || '';
    if (t) { text += t; chunks += 1; onToken({ token: t }); }
    if (msg.usage) stats = { promptTokens: msg.usage.prompt_tokens, tokens: msg.usage.completion_tokens, measured: true };
  });
  if (!res.ok && !text) return { ok: false, error: res.error || `HTTP ${res.code}` };
  const elapsedMs = Date.now() - started;
  if (!stats) stats = { tokens: chunks, tokensPerSec: elapsedMs > 0 ? +((chunks / elapsedMs) * 1000).toFixed(1) : null, measured: false };
  else if (stats.tokensPerSec == null && elapsedMs > 0) stats.tokensPerSec = +((stats.tokens / elapsedMs) * 1000).toFixed(1);
  return { ok: true, text, stats, elapsedMs };
}

/** Everything the console can talk to: (endpoint, model) pairs that are live. */
async function chatTargets() {
  const eps = await endpoints();
  const out = [];
  for (const e of eps) {
    if (!e.up || (e.kind !== 'ollama' && e.kind !== 'openai')) continue;
    for (const m of e.models) out.push({ endpointId: e.id, endpoint: e.name, port: e.port, model: m });
  }
  return out;
}

const BENCH_PROMPT = 'Explain, in about 120 words, why a hash map has O(1) average lookup but O(n) worst case.';

/**
 * Time a model. For Ollama the tokens-per-second figure is computed from the
 * server's own eval_count / eval_duration, which is the honest number; for
 * OpenAI-compatible servers without a usage block it is chunk-counted and
 * labelled as an estimate.
 */
async function benchmark(target, onToken = () => {}) {
  const res = await chat({ ...target, messages: [{ role: 'user', content: BENCH_PROMPT }] }, onToken);
  if (!res.ok) return res;
  return { ok: true, model: target.model, endpoint: target.endpoint, ...res.stats, elapsedMs: res.elapsedMs, chars: res.text.length };
}

/** NVIDIA only, via nvidia-smi. Anything else reports itself absent. */
async function gpu() {
  if (!(await has('nvidia-smi'))) return { available: false, reason: 'nvidia-smi not found - VRAM readout needs an NVIDIA GPU with drivers' };
  const { code, output } = await run(
    'nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,driver_version --format=csv,noheader,nounits',
    { timeoutMs: 15000 },
  );
  if (code !== 0) return { available: false, reason: 'nvidia-smi did not answer' };
  const gpus = String(output || '').trim().split(/\r?\n/).filter(Boolean).map((l) => {
    const [name, total, used, util, temp, driver] = l.split(',').map((s) => s.trim());
    return {
      name, driver,
      vramTotalMb: Number(total), vramUsedMb: Number(used),
      vramFreeMb: Number(total) - Number(used),
      utilPct: Number(util), tempC: Number(temp),
      fits: fitsNote(Number(total) - Number(used)),
    };
  });
  return { available: true, gpus };
}

/** What a given amount of free VRAM comfortably runs, as a sentence, not a promise. */
function fitsNote(freeMb) {
  if (freeMb >= 22000) return 'room for 32B models at Q4, or 14B at higher precision';
  if (freeMb >= 14000) return 'room for 14B models at Q4, 7-8B comfortably';
  if (freeMb >= 9000) return 'room for 7-8B models at Q4';
  if (freeMb >= 5000) return 'room for 3-4B models; 7-8B will spill to CPU';
  return 'small models only - larger ones will run mostly on CPU';
}

module.exports.chat = chat;
module.exports.chatTargets = chatTargets;
module.exports.benchmark = benchmark;
module.exports.gpu = gpu;
