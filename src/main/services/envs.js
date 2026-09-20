'use strict';
/**
 * ProGramerly - Environments: make, inspect and remove real environments
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Kinds:
 *   venv    python -m venv <dir>            (+ pip install, requirements.txt)
 *   uv      uv venv <dir>                    (+ uv pip install)
 *   conda   conda create -y -n <name>        (+ packages)
 *   node    npm init -y in <dir>             (+ npm install deps, .gitignore)
 *   docker  docker-compose.yml written from the service list, optionally
 *           `docker compose up -d`
 *
 * Every command is the real one, streamed to the caller line by line.
 * Nothing is reported as created until the marker the kind leaves behind
 * (pyvenv.cfg, package.json, compose file, conda env list) is actually there.
 *
 * Removal only touches a directory that carries such a marker AND sits under
 * one of the roots this service scans, so it can never be pointed at a
 * random folder.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, has } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';
let ctx = { devRoot: () => path.join(os.homedir(), 'Development'), ai: null };
function configure(c) { ctx = { ...ctx, ...c }; }

const PY = IS_WIN ? 'python' : 'python3';
const q = (s) => (IS_WIN ? `'${String(s).replace(/'/g, "''")}'` : `'${String(s).replace(/'/g, "'\\''")}'`);

function pyIn(dir) {
  return IS_WIN ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python');
}

async function version(cmd) {
  const { code, output } = await run(cmd, { timeoutMs: 15000 });
  return code === 0 ? String(output || '').trim().split(/\r?\n/)[0] : null;
}

/** Which builders this machine actually has. */
async function tools() {
  const [python, uv, conda, node, npm, docker, compose, git] = await Promise.all([
    version(`${PY} --version`), version('uv --version'), version('conda --version'),
    version('node --version'), version('npm --version'), version('docker --version'),
    version('docker compose version'), version('git --version'),
  ]);
  let dockerUp = false;
  if (docker) { const r = await run('docker info --format "{{.ServerVersion}}"', { timeoutMs: 15000 }); dockerUp = r.code === 0 && /\d/.test(r.output || ''); }
  return {
    python: { ok: Boolean(python), version: python, installs: 'python' },
    uv: { ok: Boolean(uv), version: uv, installs: 'uv' },
    conda: { ok: Boolean(conda), version: conda, installs: 'miniconda' },
    node: { ok: Boolean(node && npm), version: node ? `${node} · npm ${npm}` : null, installs: 'node' },
    docker: { ok: Boolean(docker), daemon: dockerUp, version: docker, compose: Boolean(compose), installs: 'docker' },
    git: { ok: Boolean(git), version: git, installs: 'git' },
    devRoot: ctx.devRoot(),
  };
}

/* ------------------------------------------------------------- listing */

function walk(root, depth, cb) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  cb(root, entries);
  if (depth <= 0) return;
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'site-packages') continue;
    walk(path.join(root, e.name), depth - 1, cb);
  }
}

async function composeStacks() {
  const r = await run('docker compose ls --all --format json', { timeoutMs: 15000 });
  if (r.code !== 0) return [];
  try {
    const text = String(r.output || '');
    const data = JSON.parse(text.slice(text.indexOf('[')));
    return (Array.isArray(data) ? data : []).map((s) => ({ name: s.Name, status: s.Status, files: s.ConfigFiles }));
  } catch { return []; }
}

async function list() {
  const root = ctx.devRoot();
  const roots = [root].filter((r) => fs.existsSync(r));
  const py = ctx.ai ? await ctx.ai.environments(root) : { venvs: [], node: [] };
  const rows = [];
  for (const v of py.venvs || []) {
    rows.push({ kind: v.kind || 'venv', name: v.name, dir: v.dir, python: v.version || null, active: Boolean(v.active), healthy: v.healthy !== false, marker: v.kind === 'conda' ? 'conda env list' : 'pyvenv.cfg' });
  }
  const nodeProjects = [];
  const composeFiles = [];
  for (const r of roots) {
    walk(r, 2, (dir, entries) => {
      const names = new Set(entries.map((e) => e.name));
      if (names.has('package.json') && !dir.includes(`${path.sep}node_modules${path.sep}`)) {
        let pkg = {};
        try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* unreadable */ }
        nodeProjects.push({
          kind: 'node', name: pkg.name || path.basename(dir), dir,
          deps: Object.keys(pkg.dependencies || {}).length, devDeps: Object.keys(pkg.devDependencies || {}).length,
          installed: names.has('node_modules'), healthy: true, marker: 'package.json',
        });
      }
      for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
        if (names.has(f)) composeFiles.push({ kind: 'docker', name: path.basename(dir), dir, file: path.join(dir, f), marker: f, healthy: true });
      }
    });
  }
  const stacks = await composeStacks().catch(() => []);
  for (const c of composeFiles) {
    const running = stacks.find((s) => String(s.files || '').split(',').some((f) => path.resolve(f.trim()) === path.resolve(c.file)));
    rows.push({ ...c, status: running ? running.status : 'not running' });
  }
  rows.push(...nodeProjects);
  return { roots: [root], rows, nodeManagers: py.node || [], at: Date.now() };
}

/* ------------------------------------------------------------- create */

function safeName(name) {
  const n = String(name || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!n || n === '.' || n === '..') throw new Error('give the environment a name');
  return n;
}

function targetDir(spec) {
  const root = spec.dir && path.isAbsolute(spec.dir) ? spec.dir : ctx.devRoot();
  return spec.kind === 'conda' ? null : path.join(root, safeName(spec.name));
}

function writeCompose(dir, services) {
  const lines = ['# Written by ProGramerly - Ionity (Pty) Ltd - edit freely', 'services:'];
  for (const s of services) {
    const name = safeName(s.name || s.image.split(/[:/]/).pop());
    lines.push(`  ${name}:`, `    image: ${s.image}`, `    restart: unless-stopped`);
    if (s.ports && s.ports.length) { lines.push('    ports:'); for (const p of s.ports) lines.push(`      - "${p}"`); }
    if (s.env && Object.keys(s.env).length) { lines.push('    environment:'); for (const [k, v] of Object.entries(s.env)) lines.push(`      ${k}: "${String(v).replace(/"/g, '\\"')}"`); }
    if (s.volumes && s.volumes.length) { lines.push('    volumes:'); for (const v of s.volumes) lines.push(`      - ${v}`); }
  }
  const named = services.flatMap((s) => (s.volumes || []).map((v) => v.split(':')[0]).filter((v) => !v.startsWith('.') && !v.startsWith('/') && !/^[A-Za-z]:/.test(v)));
  if (named.length) { lines.push('volumes:'); for (const v of [...new Set(named)]) lines.push(`  ${v}:`); }
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), `${lines.join('\n')}\n`);
}

/**
 * @param {object} spec {kind, name, dir?, python?, packages?, deps?, devDeps?, services?, start?, git?}
 * @param {(line:string)=>void} log
 */
async function create(spec, log = () => {}) {
  const kind = String(spec.kind || '').toLowerCase();
  const t = await tools();
  const dir = targetDir(spec);
  const step = async (cmd, opts = {}) => {
    log(`$ ${cmd}`);
    const r = await run(cmd, { onLine: (l) => log(`  ${l}`), timeoutMs: opts.timeoutMs || 20 * 60 * 1000, cwd: opts.cwd });
    if (r.code !== 0) throw new Error(`${cmd.split(' ')[0]} exited ${r.code}`);
    return r;
  };
  const pkgs = (spec.packages || []).map((p) => String(p).trim()).filter((p) => /^[\w.\-\[\]=<>!,~ ]+$/.test(p));
  const deps = (spec.deps || []).map((p) => String(p).trim()).filter((p) => /^[@\w./\-^~<>=]+$/.test(p));
  const devDeps = (spec.devDeps || []).map((p) => String(p).trim()).filter((p) => /^[@\w./\-^~<>=]+$/.test(p));

  if (dir && fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} already exists and is not empty`);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  log(`creating a ${kind} environment${dir ? ` at ${dir}` : ` named ${safeName(spec.name)}`}`);

  try {
    if (kind === 'venv' || kind === 'uv') {
      if (kind === 'uv' && !t.uv.ok) throw new Error('uv is not installed - install it from the Software workspace, or choose venv');
      if (kind === 'venv' && !t.python.ok) throw new Error('Python is not on PATH - install it from the Software workspace');
      if (kind === 'uv') await step(`uv venv ${q(dir)}${spec.python ? ` --python ${q(spec.python)}` : ''}`);
      else await step(`${PY} -m venv ${q(dir)}`);
      if (!fs.existsSync(path.join(dir, 'pyvenv.cfg'))) throw new Error('pyvenv.cfg did not appear - the venv was not created');
      const py = pyIn(dir);
      if (pkgs.length) {
        if (kind === 'uv') await step(`uv pip install --python ${q(py)} ${pkgs.map(q).join(' ')}`);
        else await step(`${q(py)} -m pip install --upgrade pip ${pkgs.map(q).join(' ')}`);
      }
      fs.writeFileSync(path.join(dir, 'requirements.txt'), `${pkgs.join('\n')}${pkgs.length ? '\n' : ''}`);
      if (spec.git && t.git.ok) { fs.writeFileSync(path.join(dir, '.gitignore'), 'Scripts/\nbin/\nLib/\nlib/\nInclude/\ninclude/\npyvenv.cfg\n__pycache__/\n'); await step('git init', { cwd: dir }); }
      return { ok: true, kind, dir, python: py, marker: 'pyvenv.cfg' };
    }
    if (kind === 'conda') {
      if (!t.conda.ok) throw new Error('conda is not installed - install Miniconda from the Software workspace');
      const name = safeName(spec.name);
      await step(`conda create -y -n ${q(name)} ${spec.python ? `python=${spec.python}` : 'python'} ${pkgs.map(q).join(' ')}`);
      const r = await run('conda env list --json', { timeoutMs: 20000 });
      const envs = (() => { try { return JSON.parse(r.output).envs || []; } catch { return []; } })();
      const made = envs.find((e) => path.basename(e) === name);
      if (!made) throw new Error('conda did not list the new environment');
      return { ok: true, kind, name, dir: made, marker: 'conda env list' };
    }
    if (kind === 'node') {
      if (!t.node.ok) throw new Error('Node.js and npm are not on PATH - install them from the Software workspace');
      await step('npm init -y', { cwd: dir });
      if (!fs.existsSync(path.join(dir, 'package.json'))) throw new Error('package.json did not appear');
      if (deps.length) await step(`npm install ${deps.map(q).join(' ')} --no-fund --no-audit`, { cwd: dir });
      if (devDeps.length) await step(`npm install -D ${devDeps.map(q).join(' ')} --no-fund --no-audit`, { cwd: dir });
      fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ndist/\n.env\n');
      if (!fs.existsSync(path.join(dir, 'index.js'))) fs.writeFileSync(path.join(dir, 'index.js'), `'use strict';\nconsole.log('${safeName(spec.name)} is ready');\n`);
      if (spec.git && t.git.ok) await step('git init', { cwd: dir });
      return { ok: true, kind, dir, marker: 'package.json' };
    }
    if (kind === 'docker') {
      if (!t.docker.ok) throw new Error('Docker is not installed - install Docker Desktop from the Software workspace');
      const services = (spec.services || []).filter((s) => s && s.image && /^[\w.\-/:@]+$/.test(s.image));
      if (!services.length) throw new Error('a docker environment needs at least one service with an image');
      writeCompose(dir, services);
      log(`wrote ${path.join(dir, 'docker-compose.yml')} with ${services.length} service(s)`);
      if (spec.start) {
        if (!t.docker.daemon) throw new Error('compose file written, but the Docker daemon is not running - start Docker Desktop and press Up');
        await step('docker compose up -d', { cwd: dir, timeoutMs: 30 * 60 * 1000 });
      }
      return { ok: true, kind, dir, marker: 'docker-compose.yml', started: Boolean(spec.start) };
    }
    throw new Error(`unknown environment kind "${kind}"`);
  } catch (e) {
    log(`failed: ${e.message}`);
    // A half-made directory is removed so the next attempt starts clean.
    if (dir && kind !== 'docker') { try { fs.rmSync(dir, { recursive: true, force: true }); log(`removed the partial ${dir}`); } catch { /* leave it */ } }
    return { ok: false, kind, dir, error: e.message };
  }
}

/* -------------------------------------------------------------- inspect */

async function packages(dir) {
  const py = pyIn(dir);
  if (!fs.existsSync(py)) return { ok: false, error: 'no interpreter in that environment' };
  const r = await run(`${q(py)} -m pip list --format json --disable-pip-version-check`, { timeoutMs: 60000 });
  try {
    const text = String(r.output || ''); const rows = JSON.parse(text.slice(text.indexOf('[')));
    return { ok: true, rows: rows.map((x) => ({ name: x.name, version: x.version })) };
  } catch { return { ok: false, error: r.output.trim().split(/\r?\n/).pop() || `pip exited ${r.code}` }; }
}

async function install(dir, pkgs, log = () => {}) {
  const py = pyIn(dir);
  if (!fs.existsSync(py)) return { ok: false, error: 'no interpreter in that environment' };
  const list = (pkgs || []).map((p) => String(p).trim()).filter((p) => /^[\w.\-\[\]=<>!,~ ]+$/.test(p));
  if (!list.length) return { ok: false, error: 'nothing to install' };
  log(`$ pip install ${list.join(' ')}`);
  const r = await run(`${q(py)} -m pip install ${list.map(q).join(' ')}`, { onLine: (l) => log(`  ${l}`), timeoutMs: 20 * 60 * 1000 });
  return { ok: r.code === 0, error: r.code === 0 ? null : `pip exited ${r.code}` };
}

async function freeze(dir, log = () => {}) {
  const py = pyIn(dir);
  if (!fs.existsSync(py)) return { ok: false, error: 'no interpreter in that environment' };
  const r = await run(`${q(py)} -m pip freeze`, { timeoutMs: 60000 });
  if (r.code !== 0) return { ok: false, error: `pip exited ${r.code}` };
  const file = path.join(dir, 'requirements.txt');
  fs.writeFileSync(file, String(r.output || ''));
  log(`wrote ${file}`);
  return { ok: true, file, count: String(r.output || '').split(/\r?\n/).filter(Boolean).length };
}

async function compose(dir, action, log = () => {}) {
  if (!['up', 'down', 'restart', 'ps'].includes(action)) return { ok: false, error: `unknown compose action ${action}` };
  const cmd = action === 'up' ? 'docker compose up -d' : action === 'ps' ? 'docker compose ps' : `docker compose ${action}`;
  log(`$ ${cmd}  (in ${dir})`);
  const r = await run(cmd, { cwd: dir, onLine: (l) => log(`  ${l}`), timeoutMs: 30 * 60 * 1000 });
  return { ok: r.code === 0, error: r.code === 0 ? null : (r.output.trim().split(/\r?\n/).pop() || `exit ${r.code}`) };
}

/* -------------------------------------------------------------- remove */

async function remove(entry, log = () => {}) {
  if (!entry) return { ok: false, error: 'nothing selected' };
  if (entry.kind === 'conda') {
    log(`$ conda env remove -y -n ${entry.name}`);
    const r = await run(`conda env remove -y -n ${q(entry.name)}`, { onLine: (l) => log(`  ${l}`), timeoutMs: 10 * 60 * 1000 });
    return { ok: r.code === 0, error: r.code === 0 ? null : `conda exited ${r.code}` };
  }
  const dir = path.resolve(String(entry.dir || ''));
  const root = path.resolve(ctx.devRoot());
  const under = dir.startsWith(root + path.sep) || [path.join(os.homedir(), '.virtualenvs')].some((r) => dir.startsWith(path.resolve(r) + path.sep));
  if (!under) return { ok: false, error: `${dir} is outside the roots this workspace manages - remove it by hand` };
  const marker = ['pyvenv.cfg', 'package.json', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].find((m) => fs.existsSync(path.join(dir, m)));
  if (!marker) return { ok: false, error: 'no environment marker in that folder - refusing to delete it' };
  if (marker.startsWith('docker') || marker.startsWith('compose')) {
    log('$ docker compose down -v');
    await run('docker compose down -v', { cwd: dir, onLine: (l) => log(`  ${l}`), timeoutMs: 10 * 60 * 1000 });
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    log(`removed ${dir}`);
    return { ok: true, dir };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ---------------------------------------------------------- AI recipe */

const RECIPE_SYSTEM = [
  'You design development environments. Reply with ONE JSON object and nothing else.',
  'Schema: {"kind":"venv|uv|conda|node|docker","name":"short-kebab-name","python":"3.12"|null,',
  '"packages":["python package specs"],"deps":["npm packages"],"devDeps":["npm dev packages"],',
  '"services":[{"name":"svc","image":"image:tag","ports":["host:container"],"env":{"K":"V"},"volumes":["name:/path"]}],',
  '"start":true|false,"git":true|false,"why":"one sentence"}.',
  'Choose kind from what the request needs. Only fill the arrays that apply to that kind. No markdown, no prose outside the JSON.',
].join(' ');

function parseRecipe(text) {
  const s = String(text || '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('the model did not return JSON');
  const o = JSON.parse(s.slice(a, b + 1));
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  return {
    kind: String(o.kind || 'venv').toLowerCase(), name: safeName(o.name || 'new-env'),
    python: o.python ? String(o.python) : null, packages: arr(o.packages), deps: arr(o.deps), devDeps: arr(o.devDeps),
    services: Array.isArray(o.services) ? o.services.filter((x) => x && x.image).map((x) => ({
      name: x.name ? String(x.name) : undefined, image: String(x.image), ports: arr(x.ports), env: (x.env && typeof x.env === 'object') ? x.env : {}, volumes: arr(x.volumes),
    })) : [],
    start: Boolean(o.start), git: o.git !== false, why: o.why ? String(o.why) : '',
  };
}

module.exports = {
  configure, tools, list, create, packages, install, freeze, compose, remove,
  RECIPE_SYSTEM, parseRecipe, pyIn,
};
