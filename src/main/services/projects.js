'use strict';
/**
 * ProGramerly - projects
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Every git repository under the development folder, with the four things
 * you actually want to know before you open one: which branch it is on,
 * whether it has uncommitted work, whether it is ahead of or behind its
 * remote, and when it was last touched. Plus what it is built with, read from
 * the marker files a stack leaves behind rather than guessed from the name.
 *
 * Read-only by default. The one write is `git fetch`, which changes nothing
 * in the working tree.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { run, has } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';

const STACKS = [
  ['package.json', 'Node'], ['pnpm-lock.yaml', 'pnpm'], ['bun.lockb', 'Bun'],
  ['tsconfig.json', 'TypeScript'], ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'],
  ['Cargo.toml', 'Rust'], ['go.mod', 'Go'], ['pom.xml', 'Java'], ['build.gradle', 'Gradle'],
  ['CMakeLists.txt', 'CMake'], ['platformio.ini', 'PlatformIO'], ['sdkconfig', 'ESP-IDF'],
  ['Dockerfile', 'Docker'], ['docker-compose.yml', 'Compose'], ['compose.yaml', 'Compose'],
  ['*.csproj', '.NET'], ['*.sln', '.NET'], ['*.kicad_pro', 'KiCad'], ['pubspec.yaml', 'Flutter'],
  ['next.config.js', 'Next.js'], ['next.config.mjs', 'Next.js'], ['vite.config.ts', 'Vite'],
  ['vite.config.js', 'Vite'], ['angular.json', 'Angular'], ['electron-builder.yml', 'Electron'],
];

function detectStack(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const found = new Set();
  for (const [marker, label] of STACKS) {
    if (marker.startsWith('*.')) {
      const ext = marker.slice(1);
      if (names.some((n) => n.endsWith(ext))) found.add(label);
    } else if (names.includes(marker)) found.add(label);
  }
  return [...found];
}

/** Repositories under `root`, two levels deep - enough for root/org/repo layouts. */
function findRepos(root, maxDepth = 2) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__']);
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === '.git')) { out.push(dir); return; }
    for (const e of entries) {
      if (!e.isDirectory() || skip.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  if (root && fs.existsSync(root)) walk(root, 0);
  return out;
}

async function git(dir, args, timeoutMs = 15000) {
  const q = (s) => (IS_WIN ? `"${s}"` : `'${s.replace(/'/g, "'\\''")}'`);
  const { code, output } = await run(`git -C ${q(dir)} ${args}`, { timeoutMs });
  return code === 0 ? String(output || '').trim() : null;
}

async function describe(dir) {
  const [statusRaw, last, remote] = await Promise.all([
    git(dir, 'status --porcelain=v1 -b'),
    git(dir, 'log -1 "--format=%h|%ct|%s"'),
    git(dir, 'remote get-url origin'),
  ]);

  let branch = '';
  let ahead = 0;
  let behind = 0;
  let changes = 0;
  let untracked = 0;
  if (statusRaw !== null) {
    const lines = statusRaw.split(/\r?\n/);
    const head = lines.shift() || '';
    // "## main...origin/main [ahead 2, behind 1]"
    const m = head.match(/^## (\S+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/);
    if (m) {
      branch = m[1] === 'HEAD' ? '(detached)' : m[1];
      const flags = m[3] || '';
      ahead = Number((flags.match(/ahead (\d+)/) || [])[1] || 0);
      behind = Number((flags.match(/behind (\d+)/) || [])[1] || 0);
    }
    for (const l of lines) {
      if (!l) continue;
      if (l.startsWith('??')) untracked += 1; else changes += 1;
    }
  }

  let lastHash = ''; let lastAt = 0; let lastMsg = '';
  if (last) {
    const [h, t, ...rest] = last.split('|');
    lastHash = h; lastAt = Number(t) * 1000; lastMsg = rest.join('|');
  }

  return {
    dir,
    name: path.basename(dir),
    branch,
    ahead, behind,
    changes, untracked,
    dirty: changes + untracked > 0,
    lastHash, lastAt, lastMsg,
    remote: remote || '',
    stack: detectStack(dir),
    ok: statusRaw !== null,
  };
}

async function scan(root) {
  if (!(await has('git'))) return { root, gitMissing: true, repos: [] };
  const dirs = findRepos(root);
  const repos = [];
  // Sequential on purpose: forty parallel git processes on a laptop disk is
  // slower than forty in a row, and far less polite.
  for (const d of dirs) {
    // eslint-disable-next-line no-await-in-loop
    repos.push(await describe(d));
  }
  repos.sort((a, b) => Number(b.dirty) - Number(a.dirty) || (b.lastAt - a.lastAt));
  return { root, repos, count: repos.length, dirty: repos.filter((r) => r.dirty).length };
}

async function fetch(dir, log = () => {}) {
  log(`git fetch --all --prune  (${path.basename(dir)})`);
  const res = await git(dir, 'fetch --all --prune', 120000);
  if (res === null) { log('  fetch failed - no remote, or no credentials for it'); return { ok: false }; }
  log(res ? `  ${res.split(/\r?\n/).length} line(s) of output` : '  up to date');
  return { ok: true, repo: await describe(dir) };
}

async function fetchAll(root, log = () => {}) {
  const dirs = findRepos(root);
  let ok = 0;
  for (const d of dirs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await fetch(d, log);
    if (r.ok) ok += 1;
  }
  log(`fetched ${ok} of ${dirs.length} repositories`);
  return { ok: true, fetched: ok, total: dirs.length };
}

/** Open in VS Code if it is on PATH; otherwise say so instead of silently doing nothing. */
async function openInEditor(dir) {
  if (!(await has('code'))) return { ok: false, error: 'VS Code (`code`) is not on PATH - install it from the Software tab' };
  try {
    const child = spawn(IS_WIN ? 'cmd.exe' : 'code', IS_WIN ? ['/c', 'code', dir] : [dir], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { scan, fetch, fetchAll, openInEditor, findRepos, detectStack };
