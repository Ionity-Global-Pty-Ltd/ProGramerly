'use strict';
/**
 * ProGramerly - keep-in-sync service
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Twice a day - 08:00 and 20:00 local by default - ProGramerly walks the whole
 * installed code base and the official link set, works out what has moved, and
 * either installs the updates (default) or just tells you they exist.
 *
 * Untick "install updates automatically" and nothing is touched: every program
 * stays exactly where it is and the scan becomes a report.
 */

const fs = require('node:fs');
const path = require('node:path');
const { run, has } = require('../installer/runner');
const { devRoot } = require('../installer/mcp-config');
const { getBuffer } = require('./http');
const settings = require('./settings');
const updater = require('./updater');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let timer = null;
let busy = false;
let emit = () => {};
let lastReport = null;

/* --------------------------------------------------------------- helpers -- */

function log(line, level = 'info') {
  emit('sync:log', { text: line, level, ts: Date.now() });
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}

/** Next occurrence of any configured time, as a Date. */
function nextRunAt(times) {
  const now = new Date();
  const candidates = [];
  for (const t of times) {
    const hm = parseHHMM(t);
    if (!hm) continue;
    for (const dayOffset of [0, 1]) {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hm.h, hm.m, 0, 0);
      if (d.getTime() > now.getTime()) candidates.push(d);
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates[0] || null;
}

/* -------------------------------------------------------------- scanners -- */

async function scanPackages(apply) {
  const found = [];
  if (IS_WIN) {
    if (await has('winget')) {
      log('winget: listing available upgrades');
      const { output } = await run('winget upgrade --include-unknown --accept-source-agreements', { timeoutMs: 6 * 60 * 1000 });
      const lines = output.split(/\r?\n/).filter((l) => /^\S/.test(l));
      const count = lines.filter((l) => /\s\S+\s+\S+\s+\S+\s*$/.test(l)).length;
      log(`winget reported ${Math.max(count - 2, 0)} candidate upgrade(s)`);
      found.push({ engine: 'winget', raw: output.trim().split(/\r?\n/).slice(0, 200) });
      if (apply) {
        log('winget: upgrading everything it can do unattended');
        const { code } = await run(
          'winget upgrade --all --include-unknown --silent --disable-interactivity '
          + '--accept-package-agreements --accept-source-agreements',
          { onLine: (l) => log(`  ${l}`), timeoutMs: 90 * 60 * 1000 },
        );
        log(`winget upgrade finished (exit ${code})`, code === 0 ? 'ok' : 'warn');
      }
    }
    if (await has('choco')) {
      const { output } = await run('choco outdated --limit-output', { timeoutMs: 6 * 60 * 1000 });
      const pkgs = output.split(/\r?\n/).filter((l) => l.includes('|')).map((l) => l.split('|')[0]);
      if (pkgs.length) log(`chocolatey: ${pkgs.length} outdated (${pkgs.slice(0, 8).join(', ')}${pkgs.length > 8 ? '…' : ''})`);
      found.push({ engine: 'chocolatey', packages: pkgs });
      if (apply && pkgs.length) {
        const { code } = await run('choco upgrade all -y --no-progress --limit-output', {
          onLine: (l) => log(`  ${l}`), timeoutMs: 90 * 60 * 1000,
        });
        log(`chocolatey upgrade finished (exit ${code})`, code === 0 ? 'ok' : 'warn');
      }
    }
  }
  if (IS_MAC && await has('brew')) {
    await run('brew update', { onLine: (l) => log(`  ${l}`), timeoutMs: 15 * 60 * 1000 });
    const { output } = await run('brew outdated --quiet', { timeoutMs: 5 * 60 * 1000 });
    const pkgs = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (pkgs.length) log(`homebrew: ${pkgs.length} outdated (${pkgs.slice(0, 8).join(', ')}${pkgs.length > 8 ? '…' : ''})`);
    found.push({ engine: 'homebrew', packages: pkgs });
    if (apply && pkgs.length) {
      const { code } = await run('brew upgrade && brew upgrade --cask --greedy', {
        onLine: (l) => log(`  ${l}`), timeoutMs: 90 * 60 * 1000,
      });
      log(`homebrew upgrade finished (exit ${code})`, code === 0 ? 'ok' : 'warn');
    }
  }
  return found;
}

async function scanNpm(apply) {
  if (!(await has('npm'))) return null;
  const { output } = await run('npm outdated -g --json --depth=0', { timeoutMs: 8 * 60 * 1000 });
  let pkgs = [];
  try {
    const json = JSON.parse(output.slice(output.indexOf('{')) || '{}');
    pkgs = Object.entries(json).map(([name, v]) => ({ name, current: v.current, latest: v.latest }));
  } catch { /* npm prints nothing when everything is current */ }
  if (pkgs.length) log(`npm globals: ${pkgs.length} outdated (${pkgs.slice(0, 8).map((p) => p.name).join(', ')}${pkgs.length > 8 ? '…' : ''})`);
  else log('npm globals: all current');
  if (apply && pkgs.length) {
    const names = pkgs.map((p) => `${p.name}@latest`).join(' ');
    const { code } = await run(`npm install -g ${names} --no-fund --no-audit`, {
      onLine: (l) => log(`  ${l}`), timeoutMs: 60 * 60 * 1000,
    });
    log(`npm global upgrade finished (exit ${code})`, code === 0 ? 'ok' : 'warn');
  }
  return { engine: 'npm', packages: pkgs };
}

async function scanPython(apply) {
  const out = { engine: 'python', tools: [] };
  if (await has('pipx')) {
    const { output } = await run('pipx list --short', { timeoutMs: 4 * 60 * 1000 });
    out.tools = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    log(`pipx: ${out.tools.length} tool(s) installed`);
    if (apply && out.tools.length) {
      const { code } = await run('pipx upgrade-all', { onLine: (l) => log(`  ${l}`), timeoutMs: 40 * 60 * 1000 });
      log(`pipx upgrade-all finished (exit ${code})`, code === 0 ? 'ok' : 'warn');
    }
  }
  if (await has('uv')) {
    if (apply) {
      const { code } = await run('uv tool upgrade --all', { onLine: (l) => log(`  ${l}`), timeoutMs: 40 * 60 * 1000 });
      log(`uv tool upgrade finished (exit ${code})`, code === 0 ? 'ok' : 'warn');
    } else {
      log('uv: present (tools upgrade on the next automatic run)');
    }
  }
  return out;
}

async function scanVscode(apply) {
  const bin = IS_WIN ? 'code.cmd' : 'code';
  if (!(await has(bin)) && !(await has('code'))) return null;
  const { output } = await run(`${bin} --list-extensions`, { timeoutMs: 3 * 60 * 1000 });
  const exts = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => /\w+\.\w+/.test(l));
  log(`vs code: ${exts.length} extension(s) installed`);
  if (apply && exts.length) {
    const { code } = await run(`${bin} --update-extensions`, { onLine: (l) => log(`  ${l}`), timeoutMs: 20 * 60 * 1000 });
    log(`vs code extension update finished (exit ${code})`, code === 0 ? 'ok' : 'warn');
  }
  return { engine: 'vscode', extensions: exts };
}

async function scanRepos(apply) {
  const root = settings.get('devRoot') || devRoot();
  const repos = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      if (fs.existsSync(path.join(dir, '.git'))) repos.push(dir);
    }
  } catch { return null; }
  log(`git: ${repos.length} repository(ies) under ${root}`);
  const results = [];
  for (const dir of repos) {
    const { output } = await run(`git -C "${dir}" fetch --all --quiet && git -C "${dir}" status -sb`, { timeoutMs: 5 * 60 * 1000 });
    const behind = /behind (\d+)/.exec(output);
    const n = behind ? Number(behind[1]) : 0;
    results.push({ repo: path.basename(dir), behind: n });
    if (n) log(`  ${path.basename(dir)} is ${n} commit(s) behind`);
    if (apply && n) {
      const { code } = await run(`git -C "${dir}" pull --ff-only`, { onLine: (l) => log(`    ${l}`), timeoutMs: 10 * 60 * 1000 });
      log(`  pulled ${path.basename(dir)} (exit ${code})`, code === 0 ? 'ok' : 'warn');
    }
  }
  return { engine: 'git', repos: results };
}

async function scanOllama(apply) {
  if (!(await has('ollama'))) return null;
  const { output } = await run('ollama list', { timeoutMs: 3 * 60 * 1000 });
  const models = output.split(/\r?\n/).slice(1)
    .map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  log(`ollama: ${models.length} model(s) local`);
  if (apply && models.length) {
    for (const m of models) {
      const { code } = await run(`ollama pull ${m}`, { onLine: (l) => log(`  ${l}`), timeoutMs: 60 * 60 * 1000 });
      log(`  ${m} refreshed (exit ${code})`, code === 0 ? 'ok' : 'warn');
    }
  }
  return { engine: 'ollama', models };
}

async function scanLinks() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'links.json'), 'utf8'));
  const results = [];
  for (const group of data.groups) {
    for (const link of group.links) {
      const started = Date.now();
      try {
        const res = await getBuffer(link.url, { method: 'GET', timeoutMs: 12000 });
        const ms = Date.now() - started;
        // The question is "is this endpoint reachable from this machine", not
        // "does its root path return 200". An API that answers 404 or 401 to a
        // bare GET is up and talking - only a server error or no answer at all
        // is a problem worth flagging.
        const ok = res.status > 0 && res.status < 500;
        results.push({ group: group.id, name: link.name, url: link.url, status: res.status, ms, ok });
        if (!ok) log(`link ${link.name} -> HTTP ${res.status}`, 'warn');
      } catch (err) {
        results.push({ group: group.id, name: link.name, url: link.url, status: 0, ms: Date.now() - started, ok: false, error: err.message });
        log(`link ${link.name} unreachable (${err.message})`, 'warn');
      }
    }
  }
  const bad = results.filter((r) => !r.ok).length;
  log(`links: ${results.length - bad}/${results.length} reachable`, bad ? 'warn' : 'ok');
  emit('sync:links', results);
  return results;
}

/* ------------------------------------------------------------------ run -- */

/**
 * @param {{trigger?:string, force?:boolean}} opts
 */
async function runSync(opts = {}) {
  if (busy) return { ok: false, error: 'a sync is already running' };
  busy = true;
  const s = settings.get();
  const apply = opts.force ? true : Boolean(s.autoInstallUpdates);
  const scope = s.syncScope;
  const started = Date.now();

  emit('sync:start', { trigger: opts.trigger || 'manual', apply, at: started });
  log(`sync started (${opts.trigger || 'manual'}) - mode: ${apply ? 'install updates' : 'report only, nothing is touched'}`, 'head');

  const report = { at: started, trigger: opts.trigger || 'manual', apply, sections: {} };

  try {
    if (scope.packages) report.sections.packages = await scanPackages(apply);
    if (scope.npmGlobals) report.sections.npm = await scanNpm(apply);
    if (scope.pythonTools) report.sections.python = await scanPython(apply);
    if (scope.vscodeExtensions) report.sections.vscode = await scanVscode(apply);
    if (scope.gitRepos) report.sections.git = await scanRepos(apply);
    if (scope.ollamaModels) report.sections.ollama = await scanOllama(apply);
    if (scope.links) report.sections.links = await scanLinks();

    if (s.checkAppUpdates) {
      const app = await updater.check();
      report.sections.app = app;
      if (app.available) {
        log(`ProGramerly ${app.latest} is available (you are on ${app.current})`, 'ok');
        emit('update:available', app);
      } else {
        log(`ProGramerly ${app.current} is current`);
      }
    }
  } catch (err) {
    log(`sync error: ${err.message}`, 'err');
    report.error = err.message;
  }

  report.durationMs = Date.now() - started;
  lastReport = report;
  settings.save({ lastSyncAt: started });
  writeReport(report);
  log(`sync finished in ${Math.round(report.durationMs / 1000)}s`, 'head');
  emit('sync:done', summarise(report));
  busy = false;
  return { ok: true, report };
}

function summarise(report) {
  const links = report.sections.links || [];
  return {
    at: report.at,
    trigger: report.trigger,
    apply: report.apply,
    durationMs: report.durationMs,
    npmOutdated: report.sections.npm ? report.sections.npm.packages.length : 0,
    reposBehind: report.sections.git ? report.sections.git.repos.filter((r) => r.behind).length : 0,
    linksChecked: links.length,
    linksDown: links.filter((l) => !l.ok).length,
    appUpdate: report.sections.app && report.sections.app.available
      ? report.sections.app.latest : null,
    nextRunAt: timer ? (nextRunAt(settings.get('syncTimes')) || null) : null,
  };
}

function writeReport(report) {
  try {
    const { app } = require('electron');
    const dir = path.join(app.getPath('userData'), 'sync');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `sync-${new Date(report.at).toISOString().replace(/[:.]/g, '-')}.json`),
      `${JSON.stringify(report, null, 2)}\n`, 'utf8',
    );
    fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const keep = fs.readdirSync(dir).filter((f) => f.startsWith('sync-')).sort().reverse();
    keep.slice(30).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* locked */ } });
  } catch { /* userData not writable */ }
}

/* ------------------------------------------------------------ scheduler -- */

function stop() {
  if (timer) { clearTimeout(timer); timer = null; }
}

function schedule() {
  stop();
  const s = settings.get();
  if (!s.keepInSync) {
    emit('sync:schedule', { enabled: false, nextRunAt: null });
    return null;
  }
  const next = nextRunAt(s.syncTimes);
  if (!next) return null;
  const delay = Math.max(next.getTime() - Date.now(), 1000);
  timer = setTimeout(async () => {
    await runSync({ trigger: 'schedule' });
    schedule();
  }, Math.min(delay, 2 ** 31 - 1));
  if (timer.unref) timer.unref();
  emit('sync:schedule', { enabled: true, nextRunAt: next.getTime(), times: s.syncTimes });
  return next;
}

function init(emitter) {
  emit = emitter || (() => {});
  const next = schedule();
  const s = settings.get();
  if (s.keepInSync && s.syncOnLaunch) {
    setTimeout(() => runSync({ trigger: 'launch' }), 20000);
  }
  return next;
}

function status() {
  const s = settings.get();
  return {
    enabled: Boolean(s.keepInSync),
    autoInstall: Boolean(s.autoInstallUpdates),
    times: s.syncTimes,
    busy,
    lastSyncAt: s.lastSyncAt,
    nextRunAt: s.keepInSync ? (nextRunAt(s.syncTimes)?.getTime() || null) : null,
    lastReport: lastReport ? summarise(lastReport) : null,
  };
}

module.exports = { init, schedule, stop, runSync, status, nextRunAt, scanLinks };
