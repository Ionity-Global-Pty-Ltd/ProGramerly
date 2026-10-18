'use strict';
/**
 * ProGramerly - AEDi assistant: one front door to every model
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Two providers, both OFF until the user turns them on:
 *
 *   local   Ollama / LM Studio / llama.cpp on this machine (services/ai.js).
 *           Nothing leaves the box. Off by default since 3.9.0 - a fresh
 *           install never starts a model, never runs a launch brief.
 *   claude  The Anthropic Messages API. Needs the user's own API key, which is
 *           stored encrypted with Electron safeStorage (DPAPI / Keychain /
 *           libsecret) and never written to settings.json. Prompts - and any
 *           machine context a feature attaches - are sent to Anthropic, and
 *           every surface that uses it says so.
 *
 * Every caller in main.js goes through targets() and chat(); a target is the
 * same { endpointId, endpoint, port, model } shape ai.js has always used, so
 * the chat console, the DOME, the launch brief and "Explain this" pick Claude
 * up without knowing it exists.
 *
 * On top of chat, three task helpers that make the assistant useful rather
 * than decorative:
 *   recommend()     a sentence about what you are building -> catalog ids
 *   explainRun()    a finished install run -> why the failures failed
 *   explainDoctor() a Doctor scan -> what matters and what to click first
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { app, safeStorage } = require('electron');

const ai = require('./ai');
const settings = require('./settings');

const ANTHROPIC_HOST = 'api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_ID = 'anthropic';
// Used only until the key has listed the account's real models.
const CLAUDE_FALLBACK_MODEL = 'claude-sonnet-5-5';

/* ------------------------------------------------------------- the key */
function keyFile() { return path.join(app.getPath('userData'), 'anthropic.key.enc'); }

function hasKey() { try { return fs.existsSync(keyFile()); } catch { return false; } }

function getKey() {
  try {
    if (!hasKey() || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(keyFile()));
  } catch { return null; }
}

function setKey(key) {
  const k = String(key || '').trim();
  if (!k) { try { fs.unlinkSync(keyFile()); } catch { /* gone */ } return { ok: true, cleared: true }; }
  if (!/^sk-ant-[\w-]{20,}$/.test(k)) return { ok: false, error: 'That does not look like an Anthropic API key (it starts with sk-ant-).' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'OS-level encryption is unavailable here, so the key was not stored.' };
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
  fs.writeFileSync(keyFile(), safeStorage.encryptString(k), { mode: 0o600 });
  return { ok: true };
}

/* ---------------------------------------------------------- Anthropic I/O */
function anthropicRequest(method, urlPath, body, onData) {
  const key = getKey();
  if (!key) return Promise.resolve({ ok: false, error: 'No Claude API key is stored. Add one in AEDi > Providers.' });
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: ANTHROPIC_HOST,
      path: urlPath,
      method,
      timeout: 120000,
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (onData && res.statusCode === 200) onData(c); else raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let msg = `HTTP ${res.statusCode}`;
          try { const j = JSON.parse(raw); msg = j.error?.message || msg; } catch { /* not JSON */ }
          resolve({ ok: false, status: res.statusCode, error: msg });
          return;
        }
        let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        resolve({ ok: true, json });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Anthropic did not answer within 2 minutes')); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

let modelCache = null;
/** The models this key can use, newest first, as the API reports them. */
async function claudeModels({ force = false } = {}) {
  if (modelCache && !force) return modelCache;
  const res = await anthropicRequest('GET', '/v1/models?limit=50');
  if (!res.ok) return { ok: false, error: res.error, models: [] };
  const models = (res.json?.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
  modelCache = { ok: true, models };
  return modelCache;
}

/** Anthropic wants alternating user/assistant turns with the system apart. */
function toAnthropic(messages) {
  const system = [];
  const turns = [];
  for (const m of messages || []) {
    const content = String(m.content ?? '');
    if (m.role === 'system') { system.push(content); continue; }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length) turns.push({ role: 'user', content: 'Hello.' });
  return { system: system.join('\n\n'), messages: turns };
}

async function claudeChat({ model, messages, maxTokens = 2048 }, onToken) {
  const started = Date.now();
  const { system, messages: turns } = toAnthropic(messages);
  let text = '';
  let usage = { input: 0, output: 0 };
  let buf = '';
  const res = await anthropicRequest('POST', '/v1/messages', {
    model: model || settings.get('aiClaudeModel') || CLAUDE_FALLBACK_MODEL,
    max_tokens: maxTokens,
    stream: true,
    ...(system ? { system } : {}),
    messages: turns,
  }, (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        text += ev.delta.text; onToken({ token: ev.delta.text });
      } else if (ev.type === 'message_start') {
        usage.input = ev.message?.usage?.input_tokens || 0;
      } else if (ev.type === 'message_delta') {
        usage.output = ev.usage?.output_tokens || usage.output;
      } else if (ev.type === 'error') {
        onToken({ error: ev.error?.message || 'stream error' });
      }
    }
  });
  if (!res.ok && !text) return { ok: false, error: res.error };
  const elapsedMs = Date.now() - started;
  return {
    ok: true,
    text,
    elapsedMs,
    stats: {
      promptTokens: usage.input,
      tokens: usage.output,
      tokensPerSec: elapsedMs > 0 && usage.output ? +((usage.output / elapsedMs) * 1000).toFixed(1) : null,
      measured: true,
      cloud: true,
    },
  };
}

/* ----------------------------------------------------------- routing */
function status() {
  const s = settings.get();
  return {
    localEnabled: Boolean(s.aiLocalEnabled),
    claudeEnabled: Boolean(s.aiClaudeEnabled) && hasKey(),
    claudeKey: hasKey(),
    claudeModel: s.aiClaudeModel || CLAUDE_FALLBACK_MODEL,
    provider: s.aiProvider || 'auto',
    encryption: (() => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } })(),
  };
}

function claudeTarget() {
  const st = status();
  return { endpointId: CLAUDE_ID, endpoint: 'Claude (Anthropic API) - leaves this machine', port: null, model: st.claudeModel, cloud: true };
}

/**
 * Every (provider, model) pair the assistant may use right now, preferred
 * first. Local models appear only when local AI is switched on.
 */
async function targets() {
  const st = status();
  const local = st.localEnabled ? await ai.chatTargets().catch(() => []) : [];
  const cloud = st.claudeEnabled ? [claudeTarget()] : [];
  const list = st.provider === 'local' ? [...local, ...cloud] : st.provider === 'claude' ? [...cloud, ...local]
    : [...cloud, ...local];                // auto: the configured cloud model answers first
  if (list[0]) list[0] = { ...list[0], preferred: true };
  return list;
}

/** One chat turn against whatever the target names. Streams through onToken. */
async function chat(req, onToken = () => {}) {
  const st = status();
  if (req && req.endpointId === CLAUDE_ID) {
    if (!st.claudeEnabled) return { ok: false, error: 'Claude is switched off. Turn it on in AEDi > Providers.' };
    return claudeChat({ model: req.model, messages: req.messages, maxTokens: req.maxTokens }, onToken);
  }
  if (!st.localEnabled) {
    return { ok: false, error: 'Local AI is off. Turn it on in AEDi > Providers (it stays on this machine).' };
  }
  return ai.chat(req, onToken);
}

/** The target a background feature should use, or null. */
async function preferred() {
  const list = await targets();
  return list[0] || null;
}

/* --------------------------------------------------------- task helpers */
function machineLine() {
  const plat = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform;
  return `${plat} ${os.release()} ${os.arch()}, ${Math.round(os.totalmem() / 1024 ** 3)} GB RAM, ${os.cpus().length} logical CPUs`;
}

function firstJsonArray(text) {
  const m = String(text || '').match(/\[[\s\S]*?\]/);
  if (!m) return null;
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : null; } catch { return null; }
}

/**
 * "I'm building a Flutter app with a Firebase backend" -> the catalog items
 * for it, chosen only from what applies on this OS. The model is shown the
 * catalog as id/name/group lines and must answer with a JSON array of ids;
 * anything it invents is dropped, so a hallucinated id can never be ticked.
 */
async function recommend({ text, catalog, applies }, onToken = () => {}) {
  const target = await preferred();
  if (!target) return { ok: false, error: 'No AI provider is on. Turn on local AI or add a Claude key in AEDi > Providers.' };
  const items = catalog.items.filter(applies);
  const lines = items.map((i) => `${i.id} | ${i.name} | ${i.group}`).join('\n');
  const system = 'You pick developer tools from a fixed catalog. Reply with ONE line of prose (max 30 words) explaining the choice, '
    + 'then a JSON array of catalog ids on the next line. Only use ids from the catalog. Include the package manager, '
    + 'git and the editor the stack needs. Prefer fewer, correct items over many. Never include items the user did not need.\n\n'
    + `Machine: ${machineLine()}\n\nCatalog (id | name | group):\n${lines}`;
  const res = await chat({ ...target, messages: [{ role: 'system', content: system }, { role: 'user', content: String(text || '').slice(0, 2000) }] }, onToken);
  if (!res.ok) return res;
  const known = new Set(items.map((i) => i.id));
  const ids = (firstJsonArray(res.text) || []).map(String).filter((id) => known.has(id));
  const why = String(res.text || '').split('\n')[0].replace(/\[.*$/, '').trim();
  return { ok: true, ids: [...new Set(ids)], why, model: target.model, cloud: Boolean(target.cloud) };
}

/** A finished install run -> what went wrong and what to do, per failed item. */
async function explainRun({ results, queue }, onToken = () => {}) {
  const target = await preferred();
  if (!target) return { ok: false, error: 'No AI provider is on. Turn on local AI or add a Claude key in AEDi > Providers.' };
  const bad = (results || []).filter((r) => r.status === 'failed' || r.status === 'partial');
  if (!bad.length) return { ok: true, text: 'Nothing failed in the last run.' };
  const byId = new Map((queue || []).map((i) => [i.id, i]));
  const blocks = bad.slice(0, 8).map((r) => {
    const name = byId.get(r.id)?.name || r.id;
    return `### ${name} (${r.status}: ${r.detail || ''})\n${(r.logTail || []).slice(-30).join('\n')}`;
  }).join('\n\n');
  const system = 'You are a senior build engineer reading a package-installer log from ProGramerly. '
    + 'For each failed item give: the cause in one sentence, then the exact command or click that fixes it, on its own line. '
    + 'Be specific to the evidence. No preamble. Under 250 words total.'
    + `\nMachine: ${machineLine()}`;
  return chat({ ...target, messages: [{ role: 'system', content: system }, { role: 'user', content: blocks }] }, onToken);
}

/** A Doctor scan -> the three things that matter, in order. */
async function explainDoctor({ results }, onToken = () => {}) {
  const target = await preferred();
  if (!target) return { ok: false, error: 'No AI provider is on. Turn on local AI or add a Claude key in AEDi > Providers.' };
  const rows = (results || []).filter((r) => r.status && r.status !== 'ok').slice(0, 40)
    .map((r) => `- [${r.status}] ${r.title || r.name || r.id}: ${r.detail || ''}`).join('\n');
  if (!rows) return { ok: true, text: 'Doctor found nothing that needs attention.' };
  const system = 'You read a developer-workstation health scan. Name the three findings that matter most, in order, '
    + 'each with why it matters and the fix (a command on its own line where one exists). Under 200 words. '
    + `Machine: ${machineLine()}`;
  return chat({ ...target, messages: [{ role: 'system', content: system }, { role: 'user', content: rows }] }, onToken);
}

module.exports = {
  CLAUDE_ID,
  status, targets, chat, preferred,
  hasKey, setKey, claudeModels,
  recommend, explainRun, explainDoctor,
  _toAnthropic: toAnthropic, _firstJsonArray: firstJsonArray,
};
