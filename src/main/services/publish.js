'use strict';
/**
 * ProGramerly - Push & Release
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * The in-app answer to "push this to GitHub and cut a release" - one
 * button instead of a doc of manual commands. Git does the real work:
 * this shells out to the git (and, opportunistically, gh) already on the
 * machine, writes the one CI file GitHub needs, and pushes a tag. GitHub's
 * own windows-latest/macos-latest runners then build the real installer
 * and the real Mac launcher and publish both as a Release - nothing here
 * pretends to build a macOS binary on a machine that cannot.
 *
 * This is a developer/maintainer feature. It needs a git working tree
 * (the source checkout), so it is only offered when the app is running
 * unpackaged (`npm start` from source) - a packaged install has no .git
 * to push. main.js gates that with `configure()` + `status().packaged`.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const secrets = require('./secrets');

const WORKFLOW_TEMPLATE = path.join(__dirname, '..', 'data', 'ci-workflow.yml');

let PROJECT_ROOT = process.cwd();

/** Called once from main.js with app.getAppPath() - the real source root in dev. */
function configure(root) {
  if (root) PROJECT_ROOT = root;
}

/* ------------------------------------------------------------- process -- */
function exec(cmd, args, { cwd = PROJECT_ROOT, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, shell: false, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, out: '', err: e.message });
      return;
    }
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch { /* already gone */ }
      resolve({ code: -1, out, err: `${err}\ntimed out after ${timeoutMs}ms`.trim() });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out: out.trim(), err: err.trim() });
    });
    if (child.stdin) child.stdin.end();
  });
}

async function which(cmd) {
  const probe = process.platform === 'win32' ? await exec('where', [cmd], { timeoutMs: 10000 }) : await exec('which', [cmd], { timeoutMs: 10000 });
  return probe.code === 0;
}

const hasGit = () => which('git');
const hasGh = () => which('gh');

async function ghAuthed() {
  if (!(await hasGh())) return false;
  const r = await exec('gh', ['auth', 'status'], { timeoutMs: 15000 });
  return r.code === 0;
}

/**
 * Installs the GitHub CLI directly, without sending anyone to the Software
 * tab first. This is what's actually behind "why isn't gh just there" - the
 * catalog already listed it, but that only helps if you ran the catalog.
 */
async function installGh(log) {
  if (await hasGh()) { log('gh is already installed.'); return { ok: true, already: true }; }

  if (process.platform === 'win32') {
    log('Installing GitHub CLI via winget (GitHub.cli)...');
    const r = await exec('winget', [
      'install', '--id', 'GitHub.cli', '--exact', '--silent',
      '--accept-package-agreements', '--accept-source-agreements',
    ], { timeoutMs: 300000 });
    if (r.code !== 0) {
      log(`winget install failed (${r.err || r.out}) - trying choco...`, 'warn');
      const r2 = await exec('choco', ['install', 'gh', '-y'], { timeoutMs: 300000 });
      if (r2.code !== 0) {
        log(`Could not install GitHub CLI automatically: ${r2.err || r.err || r.out}`, 'err');
        return { ok: false, error: r2.err || r.err || r.out };
      }
    }
  } else if (process.platform === 'darwin') {
    log('Installing GitHub CLI via Homebrew (brew install gh)...');
    const r = await exec('brew', ['install', 'gh'], { timeoutMs: 300000 });
    if (r.code !== 0) { log(`brew install gh failed: ${r.err || r.out}`, 'err'); return { ok: false, error: r.err || r.out }; }
  } else {
    return { ok: false, error: 'Install gh from https://cli.github.com for this platform.' };
  }

  const now = await hasGh();
  if (now) {
    log('GitHub CLI installed. Restart ProGramerly (this window\'s PATH was read at launch, before the install) so it can see it, then run "gh auth login" once.', 'ok');
    return { ok: true };
  }
  log('The installer finished but gh still is not on PATH in this window - restart ProGramerly and check again.', 'warn');
  return { ok: false, error: 'gh not found after install - restart ProGramerly to pick up the new PATH' };
}

/* --------------------------------------------------------------- github -- */
function githubApi(pathName, { method = 'GET', token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: pathName,
      method,
      headers: {
        'User-Agent': 'ProGramerly-Publisher',
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      timeout: 15000,
    }, (res) => {
      let raw = '';
      res.on('data', (d) => { raw += d; });
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* not json */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (data) req.write(data);
    req.end();
  });
}

async function remoteRepoExists({ owner, repo }) {
  const r = await githubApi(`/repos/${owner}/${repo}`);
  return r.status === 200;
}

async function createRemoteRepo({ owner, repo, description }, log) {
  if (await ghAuthed()) {
    log(`Creating ${owner}/${repo} on GitHub via gh...`);
    const r = await exec('gh', ['repo', 'create', `${owner}/${repo}`, '--public', '--description', description], { timeoutMs: 30000 });
    if (r.code === 0) { log('Repository created.', 'ok'); return { ok: true }; }
    log(`gh repo create failed: ${r.err || r.out}`, 'err');
    return { ok: false, error: r.err || r.out };
  }
  const token = secrets.getToken();
  if (!token) {
    return {
      ok: false,
      error: 'No gh CLI login and no GitHub token stored. Run "gh auth login", or add a token below, or create the repo by hand.',
    };
  }
  log(`Creating ${owner}/${repo} on GitHub via the API (stored token)...`);
  const r = await githubApi(`/orgs/${owner}/repos`, { method: 'POST', token, body: { name: repo, description, private: false } });
  if (r.status === 201) { log('Repository created.', 'ok'); return { ok: true }; }
  const msg = (r.json && r.json.message) || r.error || `HTTP ${r.status}`;
  log(`Repository creation failed: ${msg}`, 'err');
  return { ok: false, error: msg };
}

/* ------------------------------------------------------------------- ci -- */
function workflowDest() {
  return path.join(PROJECT_ROOT, '.github', 'workflows', 'build.yml');
}

function ensureWorkflowFile(log) {
  const dest = workflowDest();
  const template = fs.readFileSync(WORKFLOW_TEMPLATE, 'utf8');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const existing = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (existing === template) { log('.github/workflows/build.yml is already current.'); return { changed: false }; }
  fs.writeFileSync(dest, template, 'utf8');
  log(existing ? 'Updated .github/workflows/build.yml.' : 'Wrote .github/workflows/build.yml.', 'ok');
  return { changed: true };
}

/* ------------------------------------------------------------------ git -- */
async function ensureGitRepo(log) {
  const check = await exec('git', ['rev-parse', '--is-inside-work-tree']);
  if (check.code === 0) return { ok: true };
  log('Initialising git repository (git init -b main)...');
  const r = await exec('git', ['init', '-b', 'main']);
  if (r.code !== 0) { log(`git init failed: ${r.err}`, 'err'); return { ok: false, error: r.err }; }
  log('Repository initialised.', 'ok');
  return { ok: true };
}

async function ensureRemote(remoteUrl, log) {
  const cur = await exec('git', ['remote', 'get-url', 'origin']);
  if (cur.code !== 0) {
    log(`Adding remote origin -> ${remoteUrl}`);
    const r = await exec('git', ['remote', 'add', 'origin', remoteUrl]);
    if (r.code !== 0) { log(`git remote add failed: ${r.err}`, 'err'); return { ok: false, error: r.err }; }
    return { ok: true };
  }
  if (cur.out.trim() !== remoteUrl) {
    log(`Repointing origin -> ${remoteUrl}`);
    const r = await exec('git', ['remote', 'set-url', 'origin', remoteUrl]);
    if (r.code !== 0) { log(`git remote set-url failed: ${r.err}`, 'err'); return { ok: false, error: r.err }; }
  }
  return { ok: true };
}

async function currentBranch() {
  const r = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.code === 0 && r.out.trim() && r.out.trim() !== 'HEAD' ? r.out.trim() : 'main';
}

async function commitAll(message, author, log) {
  await exec('git', ['add', '-A']);
  const st = await exec('git', ['status', '--porcelain']);
  if (!st.out) { log('Nothing new to commit.'); return { ok: true, committed: false }; }
  const pre = [];
  if (author && author.name) pre.push('-c', `user.name=${author.name}`);
  if (author && author.email) pre.push('-c', `user.email=${author.email}`);
  const r = await exec('git', [...pre, 'commit', '-m', message], { timeoutMs: 30000 });
  if (r.code !== 0) { log(`git commit failed: ${r.err || r.out}`, 'err'); return { ok: false, error: r.err || r.out }; }
  log('Committed.', 'ok');
  return { ok: true, committed: true };
}

async function push(branch, log) {
  log(`Pushing ${branch} to origin (your system's git credential manager may prompt for sign-in)...`);
  const r = await exec('git', ['push', '-u', 'origin', branch], { timeoutMs: 180000 });
  if (r.code !== 0) { log(`git push failed: ${r.err || r.out}`, 'err'); return { ok: false, error: r.err || r.out }; }
  log('Pushed.', 'ok');
  return { ok: true };
}

async function tagExists(tag) {
  const r = await exec('git', ['tag', '-l', tag]);
  return r.code === 0 && r.out.trim() === tag;
}

async function tagAndPush(tag, log) {
  if (await tagExists(tag)) {
    log(`Tag ${tag} already exists locally.`);
  } else {
    const r = await exec('git', ['tag', tag]);
    if (r.code !== 0) { log(`git tag failed: ${r.err}`, 'err'); return { ok: false, error: r.err }; }
    log(`Tagged ${tag}.`, 'ok');
  }
  const r2 = await exec('git', ['push', 'origin', tag], { timeoutMs: 180000 });
  if (r2.code !== 0) {
    if (/already exists/i.test(r2.err)) { log(`Tag ${tag} is already on GitHub.`); return { ok: true }; }
    log(`git push tag failed: ${r2.err || r2.out}`, 'err');
    return { ok: false, error: r2.err || r2.out };
  }
  log(`Pushed tag ${tag} - this fires the build + release workflow on GitHub.`, 'ok');
  return { ok: true };
}

/* --------------------------------------------------------------- status -- */
async function status({ owner, repo }) {
  const git = await hasGit();
  const gh = await hasGh();
  const ghOk = gh ? await ghAuthed() : false;
  const tokenSet = secrets.hasToken();
  const gitRepo = fs.existsSync(path.join(PROJECT_ROOT, '.git'));
  let remoteUrl = null;
  if (gitRepo) {
    const r = await exec('git', ['remote', 'get-url', 'origin']);
    if (r.code === 0) remoteUrl = r.out.trim();
  }
  const repoExists = git ? await remoteRepoExists({ owner, repo }).catch(() => false) : false;
  return {
    git,
    gh,
    ghAuthed: ghOk,
    tokenSet,
    gitRepo,
    remoteUrl,
    repoExists,
    workflowPresent: fs.existsSync(workflowDest()),
    projectRoot: PROJECT_ROOT,
  };
}

/* ---------------------------------------------------------- orchestrator -- */
async function publishRelease(cfg, log) {
  const {
    owner, repo, version, description, remoteUrl, author,
  } = cfg;
  const steps = [];
  const step = async (name, fn) => {
    log(`→ ${name}`, 'head');
    let res;
    try {
      res = await fn();
    } catch (err) {
      log(`${name} threw: ${err.message}`, 'err');
      res = { ok: false, error: err.message };
    }
    steps.push({ name, ok: res && res.ok !== false, ...res });
    return res;
  };

  if (!(await hasGit())) {
    log('git is not on PATH. Install Git for Windows (or Xcode command line tools on a Mac) first.', 'err');
    return { ok: false, steps, error: 'git not found' };
  }

  await step('Write CI workflow', () => ensureWorkflowFile(log));

  const gitOk = await step('Initialise repository', () => ensureGitRepo(log));
  if (!gitOk.ok) return { ok: false, steps };

  const remoteOk = await step('Set remote origin', () => ensureRemote(remoteUrl, log));
  if (!remoteOk.ok) return { ok: false, steps };

  const exists = await remoteRepoExists({ owner, repo });
  if (!exists) {
    const created = await step('Create GitHub repository', () => createRemoteRepo({ owner, repo, description }, log));
    if (!created.ok) {
      log('Create the repository by hand (public, empty, no README/licence/gitignore) and run this again.', 'err');
      return { ok: false, steps };
    }
  } else {
    log(`${owner}/${repo} already exists on GitHub.`);
  }

  await step('Stage and commit', () => commitAll(`ProGramerly v${version} - ${description}`, author, log));

  const branch = await currentBranch();
  const pushed = await step('Push to origin', () => push(branch, log));
  if (!pushed.ok) return { ok: false, steps };

  const tag = `v${version}`;
  const tagged = await step('Tag and push (fires the release build)', () => tagAndPush(tag, log));
  if (!tagged.ok) return { ok: false, steps };

  const releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${tag}`;
  const actionsUrl = `https://github.com/${owner}/${repo}/actions`;
  log(`Done. GitHub is now building the Windows installer and the macOS launcher on its own `
    + `runners and will publish them together at ${releaseUrl} in about 10-15 minutes.`, 'ok');
  return {
    ok: true, steps, releaseUrl, actionsUrl, tag,
  };
}

module.exports = {
  configure, status, publishRelease, remoteRepoExists, installGh,
};
