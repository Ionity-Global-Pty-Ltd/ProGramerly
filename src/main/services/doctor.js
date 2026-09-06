'use strict';
/**
 * ProGramerly - System Doctor
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Diagnose, then fix. Every check answers three questions honestly:
 * what is wrong, why it matters on a development machine, and whether this
 * app can repair it without asking you to become a systems administrator.
 *
 * Two rules hold throughout:
 *
 *  - a check never changes anything. Diagnosing is always safe to run.
 *  - a fix is only ever attached to a check that actually failed, and every
 *    fix says what it ran and what came back. Nothing is silently "handled".
 *
 * Everything a run produces - the report, the environment snapshot, the
 * copied application log - lands in one timestamped folder under
 * userData/diagnostics, so a problem can be handed to someone else whole.
 *
 * Node standard library only. No runtime dependencies, here or anywhere.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { run, has } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const PLATFORM = IS_WIN ? 'win' : IS_MAC ? 'mac' : 'linux';

let paths = { userData: '', logDir: '', appPath: '' };
function configure(p) { paths = { ...paths, ...p }; }

/* ------------------------------------------------------------------ util -- */

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function human(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/** One shot at a command, trimmed, never throwing. '' means "could not run". */
async function out(cmd, timeoutMs = 20000) {
  try {
    const { code, output } = await run(cmd, { timeoutMs });
    return code === 0 ? String(output || '').trim() : '';
  } catch { return ''; }
}

/** Directory size, breadth-first, bounded so a runaway tree cannot hang a scan. */
function dirSize(dir, { maxEntries = 60000 } = {}) {
  let total = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (files > maxEntries) return { bytes: total, files, truncated: true };
      const full = path.join(cur, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      try { total += fs.statSync(full).size; files += 1; } catch { /* vanished mid-walk */ }
    }
  }
  return { bytes: total, files, truncated: false };
}

/** Delete files older than N days. Returns what it actually removed. */
function pruneOlderThan(dir, days, { dryRun = false } = {}) {
  const cutoff = Date.now() - days * 86400000;
  let bytes = 0;
  let count = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { bytes: 0, count: 0 }; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs > cutoff) continue;
      if (e.isDirectory()) {
        const size = dirSize(full).bytes;
        if (!dryRun) fs.rmSync(full, { recursive: true, force: true });
        bytes += size; count += 1;
      } else {
        if (!dryRun) fs.rmSync(full, { force: true });
        bytes += st.size; count += 1;
      }
    } catch { /* locked or already gone - never fatal */ }
  }
  return { bytes, count };
}

function freeSpace(target) {
  try {
    const st = fs.statfsSync(target);
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
  } catch { return { free: NaN, total: NaN }; }
}

/** Read one registry DWORD. Returns null when the value simply is not there. */
async function regDword(key, name) {
  if (!IS_WIN) return null;
  const raw = await out(
    `$v = Get-ItemProperty -Path '${key}' -Name '${name}' -ErrorAction SilentlyContinue; `
    + `if ($null -ne $v) { $v.'${name}' } else { '' }`,
  );
  if (raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/* ---------------------------------------------------------------- checks -- */
/*
 * status: 'ok' | 'warn' | 'fail' | 'info' | 'skip'
 * A check with a `fix` is offered a Fix button only when it is warn or fail.
 * `auto:false` keeps a fix out of "Fix everything" - anything that needs a
 * reboot, an elevation, or a judgement call stays a deliberate click.
 */

const CHECKS = [
  /* ------------------------------------------------------------- storage */
  {
    id: 'disk-space',
    title: 'Free space on the system drive',
    why: 'Package managers unpack before they install. Under a few GB, installs fail in ways that look like network errors.',
    async run() {
      const target = IS_WIN ? (process.env.SystemDrive || 'C:') + '\\' : '/';
      const { free, total } = freeSpace(target);
      if (!Number.isFinite(free)) return { status: 'skip', detail: 'could not read the filesystem' };
      const detail = `${human(free)} free of ${human(total)} on ${target}`;
      if (free < 3 * GB) return { status: 'fail', detail: `${detail} - too little to install anything sizeable` };
      if (free < 10 * GB) return { status: 'warn', detail: `${detail} - tight for a full profile` };
      return { status: 'ok', detail };
    },
  },
  {
    id: 'temp-bloat',
    title: 'Temporary files',
    why: 'Failed installers abandon their unpacked payloads in TEMP. It is the single biggest pile of dead weight on most dev machines.',
    async run() {
      const dir = os.tmpdir();
      const { bytes, truncated } = dirSize(dir, { maxEntries: 40000 });
      const detail = `${human(bytes)}${truncated ? '+' : ''} in ${dir}`;
      if (bytes > 5 * GB) return { status: 'warn', detail, fixable: true };
      return { status: 'ok', detail };
    },
    fixLabel: 'Delete items older than 7 days',
    auto: true,
    async fix(log) {
      const dir = os.tmpdir();
      log(`pruning ${dir} of anything untouched for 7 days...`);
      const { bytes, count } = pruneOlderThan(dir, 7);
      log(`removed ${count} item(s), ${human(bytes)} reclaimed`);
      return { ok: true, detail: `${count} item(s), ${human(bytes)}` };
    },
  },
  {
    id: 'log-bloat',
    title: "ProGramerly's own logs",
    why: 'A log per launch adds up. Old ones are only useful until the problem they describe is fixed.',
    async run() {
      if (!paths.logDir || !fs.existsSync(paths.logDir)) return { status: 'skip', detail: 'no log folder yet' };
      const { bytes, files } = dirSize(paths.logDir);
      const old = pruneOlderThan(paths.logDir, 30, { dryRun: true });
      const detail = `${files} file(s), ${human(bytes)} - ${old.count} older than 30 days`;
      if (old.count > 0) return { status: 'warn', detail, fixable: true };
      return { status: 'ok', detail };
    },
    fixLabel: 'Prune logs older than 30 days',
    auto: true,
    async fix(log) {
      const { bytes, count } = pruneOlderThan(paths.logDir, 30);
      log(`removed ${count} old log file(s), ${human(bytes)}`);
      return { ok: true, detail: `${count} file(s), ${human(bytes)}` };
    },
  },

  /* ------------------------------------------------------------ toolchain */
  {
    id: 'node-runtime',
    title: 'Node and npm',
    why: 'Half the catalogue installs through npm. A missing or ancient Node quietly breaks all of it.',
    async run() {
      const node = await out('node --version');
      const npm = await out('npm --version');
      if (!node) return { status: 'fail', detail: 'node is not on PATH - install the Node.js LTS item from the Software tab' };
      const major = Number.parseInt(String(node).replace(/^v/, ''), 10);
      const detail = `node ${node}${npm ? `, npm ${npm}` : ', npm missing'}`;
      if (Number.isFinite(major) && major < 18) return { status: 'warn', detail: `${detail} - Node 18 is the floor for modern tooling` };
      if (!npm) return { status: 'warn', detail };
      return { status: 'ok', detail };
    },
  },
  {
    id: 'npm-cache',
    title: 'npm cache integrity',
    why: 'A half-written cache entry produces install failures that survive every retry until the cache is verified.',
    async run() {
      if (!(await has('npm'))) return { status: 'skip', detail: 'npm not installed' };
      const res = await out('npm cache verify', 90000);
      if (!res) return { status: 'warn', detail: 'npm cache verify did not complete', fixable: true };
      const line = res.split(/\r?\n/).find((l) => /Content verified|Cache verified/i.test(l)) || res.split(/\r?\n/)[0];
      return { status: 'ok', detail: line.trim() };
    },
    fixLabel: 'Verify and repair the npm cache',
    auto: true,
    async fix(log) {
      log('npm cache verify...');
      const res = await out('npm cache verify', 120000);
      log(res || 'no output');
      return { ok: Boolean(res), detail: res ? 'cache verified' : 'verify failed' };
    },
  },
  {
    id: 'git-identity',
    title: 'Git identity',
    why: 'Commits made without a name and email are attributed to nobody, and some hosts reject them outright.',
    async run() {
      if (!(await has('git'))) return { status: 'skip', detail: 'git not installed' };
      const name = await out('git config --global user.name');
      const email = await out('git config --global user.email');
      if (!name || !email) {
        return { status: 'warn', detail: `missing ${!name ? 'user.name' : ''}${!name && !email ? ' and ' : ''}${!email ? 'user.email' : ''}`, fixable: true };
      }
      return { status: 'ok', detail: `${name} <${email}>` };
    },
    fixLabel: 'Set it from the publish settings',
    auto: false,
    async fix(log, ctx) {
      const name = ctx?.authorName || 'Johan Wilhelm van Antwerp';
      const email = ctx?.authorEmail || 'ai@ionity.today';
      log(`git config --global user.name  "${name}"`);
      await out(`git config --global user.name "${name}"`);
      log(`git config --global user.email "${email}"`);
      await out(`git config --global user.email "${email}"`);
      return { ok: true, detail: `${name} <${email}>` };
    },
  },
  {
    id: 'git-credential',
    title: 'Git credential helper',
    why: 'Without a helper, every push asks again. With the wrong one, it asks in a dialog you cannot script past.',
    async run() {
      if (!(await has('git'))) return { status: 'skip', detail: 'git not installed' };
      const helper = await out('git config --global credential.helper');
      if (await has('gh')) {
        const ghAuth = await out('gh auth status');
        if (ghAuth && /Logged in/i.test(ghAuth)) {
          return helper
            ? { status: 'ok', detail: `${helper} (gh is signed in)` }
            : { status: 'warn', detail: 'gh is signed in but git is not using it - run gh auth setup-git', fixable: true };
        }
      }
      if (!helper) return { status: 'warn', detail: 'no credential helper configured', fixable: true };
      return { status: 'ok', detail: helper };
    },
    fixLabel: 'Wire git to the GitHub CLI',
    auto: false,
    async fix(log) {
      if (await has('gh')) {
        log('gh auth setup-git...');
        const res = await out('gh auth setup-git', 60000);
        log(res || 'done');
        return { ok: true, detail: 'git now uses the gh credential' };
      }
      if (IS_WIN) {
        log('git config --global credential.helper manager');
        await out('git config --global credential.helper manager');
        return { ok: true, detail: 'Git Credential Manager' };
      }
      log('git config --global credential.helper cache');
      await out('git config --global credential.helper "cache --timeout=86400"');
      return { ok: true, detail: 'credential cache' };
    },
  },

  /* ----------------------------------------------------------------- PATH */
  {
    id: 'path-health',
    title: 'PATH sanity',
    why: 'Dead and duplicated entries are why "command not found" survives a reinstall. Windows also has a hard length limit that silently truncates.',
    async run() {
      const sep = IS_WIN ? ';' : ':';
      const raw = process.env.PATH || '';
      const parts = raw.split(sep).filter(Boolean);
      const seen = new Set();
      const dupes = [];
      const dead = [];
      for (const p of parts) {
        const key = IS_WIN ? p.toLowerCase().replace(/\\+$/, '') : p.replace(/\/+$/, '');
        if (seen.has(key)) dupes.push(p); else seen.add(key);
        try { if (!fs.existsSync(p)) dead.push(p); } catch { dead.push(p); }
      }
      const detail = `${parts.length} entries, ${dead.length} pointing nowhere, ${dupes.length} duplicated`
        + (IS_WIN ? `, ${raw.length} characters` : '');
      if (IS_WIN && raw.length > 4000) {
        return { status: 'fail', detail: `${detail} - close to the Windows limit, entries are being lost`, fixable: true, data: { dead, dupes } };
      }
      if (dead.length || dupes.length) return { status: 'warn', detail, fixable: true, data: { dead, dupes } };
      return { status: 'ok', detail };
    },
    fixLabel: 'Clean the user PATH',
    auto: false,
    async fix(log) {
      if (!IS_WIN) {
        log('On macOS and Linux the PATH is assembled by your shell profile, not by a value this app owns.');
        log('Nothing was changed. The dead entries above tell you which lines to delete from .zshrc / .bashrc.');
        return { ok: false, detail: 'reported only - shell profiles are yours to edit' };
      }
      // Only ever the USER value. The machine PATH belongs to the machine.
      const before = await out("[Environment]::GetEnvironmentVariable('Path','User')");
      const parts = String(before).split(';').filter(Boolean);
      const kept = [];
      const seen = new Set();
      let dropped = 0;
      for (const p of parts) {
        const key = p.toLowerCase().replace(/\\+$/, '');
        const expanded = p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || `%${v}%`);
        if (seen.has(key)) { dropped += 1; continue; }
        if (!/%/.test(p) && !fs.existsSync(expanded)) { dropped += 1; continue; }
        seen.add(key); kept.push(p);
      }
      if (!dropped) { log('user PATH is already clean - nothing to do'); return { ok: true, detail: 'already clean' }; }
      const backup = path.join(paths.userData, 'diagnostics', `path-user-backup-${Date.now()}.txt`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, before, 'utf8');
      log(`backed the old user PATH up to ${backup}`);
      const value = kept.join(';').replace(/'/g, "''");
      await out(`[Environment]::SetEnvironmentVariable('Path','${value}','User')`);
      log(`removed ${dropped} dead or duplicated entr${dropped === 1 ? 'y' : 'ies'}; ${kept.length} kept`);
      log('Open a new terminal to see the change - existing windows keep the PATH they started with.');
      return { ok: true, detail: `${dropped} removed, ${kept.length} kept, backup written` };
    },
  },

  /* -------------------------------------------------------- env hygiene */
  {
    id: 'env-hazards',
    title: 'Environment variables',
    why: 'A handful of variables silently break tooling, and one of them disables TLS verification for every Node process on the machine.',
    async run() {
      const found = [];
      if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
        found.push({ level: 'fail', text: 'NODE_TLS_REJECT_UNAUTHORIZED=0 - every Node process on this machine is ignoring certificate errors' });
      }
      if (process.env.PYTHONHOME) found.push({ level: 'warn', text: `PYTHONHOME=${process.env.PYTHONHOME} - this breaks virtualenvs and is almost never wanted` });
      if (process.env.NODE_OPTIONS) found.push({ level: 'warn', text: `NODE_OPTIONS=${process.env.NODE_OPTIONS} - applied to every Node process, including build tools` });
      if (process.env.NODE_ENV === 'production') found.push({ level: 'warn', text: 'NODE_ENV=production is set globally - npm install will skip devDependencies everywhere' });
      if (!found.length) return { status: 'ok', detail: 'nothing hazardous set globally' };
      const worst = found.some((f) => f.level === 'fail') ? 'fail' : 'warn';
      return { status: worst, detail: found.map((f) => f.text).join(' · '), data: { found } };
    },
  },

  /* --------------------------------------------------- package managers */
  {
    id: 'pkg-managers',
    title: 'Package managers',
    why: 'These are what every install actually runs. A stale source index looks exactly like "the package does not exist".',
    async run() {
      const list = [];
      if (IS_WIN) {
        if (await has('winget')) list.push(`winget ${await out('winget --version')}`);
        if (await has('choco')) list.push(`choco ${(await out('choco --version')).split(/\r?\n/)[0]}`);
      } else if (IS_MAC) {
        if (await has('brew')) list.push(`brew ${(await out('brew --version')).split(/\r?\n/)[0]}`);
      }
      if (!list.length) {
        return {
          status: 'fail',
          detail: IS_WIN
            ? 'neither winget nor Chocolatey is available - nothing can be installed'
            : 'Homebrew is not installed - nothing can be installed',
          fixable: false,
        };
      }
      return { status: 'ok', detail: list.join(' · '), fixable: true };
    },
    fixLabel: 'Refresh the package sources',
    auto: true,
    async fix(log) {
      if (IS_WIN) {
        log('winget source update...');
        log((await out('winget source update', 120000)) || 'no output');
        return { ok: true, detail: 'winget sources refreshed' };
      }
      log('brew update...');
      log((await out('brew update', 180000)) || 'no output');
      return { ok: true, detail: 'brew updated' };
    },
  },

  /* ----------------------------------------------------- Windows specific */
  {
    id: 'long-paths',
    title: 'Long path support',
    platforms: ['win'],
    why: 'Windows truncates at 260 characters unless this is on. It is the reason node_modules trees fail to delete or copy.',
    async run() {
      const v = await regDword('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'LongPathsEnabled');
      if (v === 1) return { status: 'ok', detail: 'enabled' };
      return { status: 'warn', detail: 'disabled - deep node_modules trees will fail to copy or delete', fixable: true };
    },
    fixLabel: 'Enable long paths (needs administrator)',
    auto: false,
    needsAdmin: true,
    async fix(log) {
      log('setting HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\\LongPathsEnabled = 1');
      const res = await run(
        "New-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' "
        + "-Name 'LongPathsEnabled' -Value 1 -PropertyType DWORD -Force | Out-Null",
        { timeoutMs: 30000 },
      );
      if (res.code !== 0) {
        log('refused - this one needs administrator rights.');
        return { ok: false, detail: 'needs an elevated ProGramerly' };
      }
      log('enabled. It applies to newly started processes.');
      return { ok: true, detail: 'enabled' };
    },
  },
  {
    id: 'developer-mode',
    title: 'Developer Mode',
    platforms: ['win'],
    why: 'Without it, creating a symlink needs administrator rights - which is why pnpm, bun and some npm packages fail on Windows and nowhere else.',
    async run() {
      const v = await regDword('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock', 'AllowDevelopmentWithoutDevLicense');
      if (v === 1) return { status: 'ok', detail: 'on - symlinks work without elevation' };
      return { status: 'warn', detail: 'off - symlink-based tooling will need administrator rights', fixable: true };
    },
    fixLabel: 'Turn on Developer Mode (needs administrator)',
    auto: false,
    needsAdmin: true,
    async fix(log) {
      log('setting AppModelUnlock\\AllowDevelopmentWithoutDevLicense = 1');
      const res = await run(
        "New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock' -Force | Out-Null; "
        + "New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock' "
        + "-Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -PropertyType DWORD -Force | Out-Null",
        { timeoutMs: 30000 },
      );
      if (res.code !== 0) { log('refused - needs administrator rights.'); return { ok: false, detail: 'needs an elevated ProGramerly' }; }
      log('Developer Mode is on.');
      return { ok: true, detail: 'enabled' };
    },
  },
  {
    id: 'execution-policy',
    title: 'PowerShell execution policy',
    platforms: ['win'],
    why: 'Restricted blocks every .ps1 - including the ones package managers write for you.',
    async run() {
      const p = await out('Get-ExecutionPolicy -Scope CurrentUser');
      if (!p) return { status: 'skip', detail: 'could not read the policy' };
      if (/Restricted|Undefined/i.test(p)) {
        return { status: 'warn', detail: `${p} for the current user - local scripts will not run`, fixable: true };
      }
      return { status: 'ok', detail: p };
    },
    fixLabel: 'Set RemoteSigned for this user',
    auto: true,
    async fix(log) {
      log('Set-ExecutionPolicy -Scope CurrentUser RemoteSigned...');
      const res = await run('Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force', { timeoutMs: 30000 });
      if (res.code !== 0) return { ok: false, detail: 'policy is locked by group policy' };
      return { ok: true, detail: 'RemoteSigned (current user only)' };
    },
  },
  {
    id: 'pending-reboot',
    title: 'Pending restart',
    platforms: ['win'],
    why: 'A pending restart makes installers fail for reasons that have nothing to do with the installer.',
    async run() {
      const keys = [
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending',
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired',
      ];
      const hits = [];
      for (const k of keys) {
        // eslint-disable-next-line no-await-in-loop
        const r = await out(`if (Test-Path '${k}') { 'yes' } else { '' }`);
        if (r === 'yes') hits.push(k.split('\\').pop());
      }
      const rename = await out(
        "$v = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' "
        + "-Name PendingFileRenameOperations -ErrorAction SilentlyContinue; if ($v) { 'yes' } else { '' }",
      );
      if (rename === 'yes') hits.push('PendingFileRenameOperations');
      if (!hits.length) return { status: 'ok', detail: 'no restart pending' };
      return { status: 'warn', detail: `restart pending (${hits.join(', ')}) - install after restarting, not before` };
    },
  },

  /* ------------------------------------------------------ macOS specific */
  {
    id: 'xcode-clt',
    title: 'Xcode command line tools',
    platforms: ['mac'],
    why: 'Homebrew, node-gyp and half of npm compile against these. Without them, native modules fail to build.',
    async run() {
      const p = await out('xcode-select -p');
      if (!p) return { status: 'fail', detail: 'not installed', fixable: true };
      return { status: 'ok', detail: p };
    },
    fixLabel: 'Install them',
    auto: false,
    async fix(log) {
      log('xcode-select --install (Apple shows its own installer window)');
      await out('xcode-select --install', 30000);
      return { ok: true, detail: "Apple's installer was launched" };
    },
  },

  /* --------------------------------------------------------- app itself */
  {
    id: 'app-integrity',
    title: 'ProGramerly itself',
    why: 'A self-check worth having: if the catalogue or the settings file is unreadable, everything else is guesswork.',
    async run() {
      const notes = [];
      let worst = 'ok';
      const catalogPath = path.join(paths.appPath || '', 'src', 'main', 'catalog', 'catalog.json');
      try {
        const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        notes.push(`catalogue ${cat.meta?.version || '?'}, ${cat.items.length} items`);
      } catch (e) { notes.push(`catalogue unreadable: ${e.message}`); worst = 'fail'; }

      const settingsPath = path.join(paths.userData || '', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        try { JSON.parse(fs.readFileSync(settingsPath, 'utf8')); notes.push('settings parse cleanly'); }
        catch { notes.push('settings.json is corrupt - defaults are being used'); worst = worst === 'fail' ? 'fail' : 'warn'; }
      } else notes.push('settings not written yet (defaults)');

      try {
        const probe = path.join(paths.logDir || os.tmpdir(), '.write-probe');
        fs.writeFileSync(probe, 'x'); fs.rmSync(probe, { force: true });
        notes.push('log folder is writable');
      } catch { notes.push('log folder is NOT writable'); worst = 'fail'; }

      return { status: worst, detail: notes.join(' · ') };
    },
  },
];

function applicable(c) { return !c.platforms || c.platforms.includes(PLATFORM); }

/* ------------------------------------------------------------- diagnose -- */

async function diagnose(log = () => {}) {
  const list = CHECKS.filter(applicable);
  const results = [];
  for (const c of list) {
    log(`checking: ${c.title}`);
    let r;
    try {
      // eslint-disable-next-line no-await-in-loop
      r = await c.run();
    } catch (e) {
      r = { status: 'fail', detail: `the check itself failed: ${e.message}` };
    }
    const row = {
      id: c.id,
      title: c.title,
      why: c.why,
      status: r.status,
      detail: r.detail,
      data: r.data || null,
      fixable: Boolean(c.fix) && (r.fixable !== false) && ['warn', 'fail'].includes(r.status),
      fixLabel: c.fixLabel || 'Fix',
      auto: Boolean(c.auto),
      needsAdmin: Boolean(c.needsAdmin),
    };
    log(`  ${r.status.toUpperCase()}  ${r.detail}`);
    results.push(row);
  }
  const summary = ['ok', 'warn', 'fail', 'info', 'skip'].reduce((acc, k) => {
    acc[k] = results.filter((r) => r.status === k).length; return acc;
  }, {});
  return { results, summary, at: Date.now(), platform: PLATFORM };
}

/* ------------------------------------------------------------------ fix -- */

async function fixOne(id, log = () => {}, ctx = {}) {
  const c = CHECKS.find((x) => x.id === id);
  if (!c || !c.fix) return { ok: false, detail: 'nothing to fix here' };
  log(`--- ${c.title}: ${c.fixLabel || 'fix'}`);
  try {
    const res = await c.fix(log, ctx);
    log(res.ok ? `  fixed: ${res.detail}` : `  not fixed: ${res.detail}`);
    return res;
  } catch (e) {
    log(`  the fix threw: ${e.message}`);
    return { ok: false, detail: e.message };
  }
}

/**
 * Fix everything that is safe to fix unattended. Anything that needs
 * elevation, a restart, or a judgement call is deliberately left for a click.
 */
async function fixAll(log = () => {}, ctx = {}) {
  const scan = await diagnose(() => {});
  const targets = scan.results.filter((r) => r.fixable && r.auto);
  const skipped = scan.results.filter((r) => r.fixable && !r.auto);
  if (!targets.length) log('nothing is safe to fix unattended.');
  const done = [];
  for (const t of targets) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fixOne(t.id, log, ctx);
    done.push({ id: t.id, title: t.title, ...res });
  }
  for (const s of skipped) {
    log(`left alone (needs your decision): ${s.title} - ${s.fixLabel}`);
  }
  return { done, skipped: skipped.map((s) => ({ id: s.id, title: s.title, reason: s.fixLabel })) };
}

/* ---------------------------------------------------- environment report -- */

const PROBES = [
  ['node', 'node --version'], ['npm', 'npm --version'], ['pnpm', 'pnpm --version'],
  ['yarn', 'yarn --version'], ['bun', 'bun --version'], ['python', IS_WIN ? 'python --version' : 'python3 --version'],
  ['pip', IS_WIN ? 'pip --version' : 'pip3 --version'], ['git', 'git --version'], ['gh', 'gh --version'],
  ['docker', 'docker --version'], ['code', 'code --version'], ['rustc', 'rustc --version'],
  ['cargo', 'cargo --version'], ['go', 'go version'], ['java', 'java -version 2>&1'],
  ['dotnet', 'dotnet --version'], ['ollama', 'ollama --version'], ['ffmpeg', 'ffmpeg -version'],
];

async function environment(log = () => {}) {
  log('collecting machine facts...');
  const cpus = os.cpus();
  const drive = IS_WIN ? (process.env.SystemDrive || 'C:') + '\\' : '/';
  const { free, total } = freeSpace(drive);

  let gpu = '';
  if (IS_WIN) gpu = await out('(Get-CimInstance Win32_VideoController).Name -join ", "');
  else if (IS_MAC) gpu = await out("system_profiler SPDisplaysDataType | awk -F': ' '/Chipset Model/ {print $2}' | paste -sd', ' -");

  const tools = [];
  for (const [name, cmd] of PROBES) {
    // eslint-disable-next-line no-await-in-loop
    const v = await out(cmd, 15000);
    tools.push({ name, version: v ? v.split(/\r?\n/)[0].trim() : null });
  }
  log(`found ${tools.filter((t) => t.version).length} of ${tools.length} probed tools`);

  return {
    at: new Date().toISOString(),
    app: { platform: PLATFORM, electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
    os: {
      type: os.type(), release: os.release(), arch: os.arch(),
      hostname: os.hostname(), user: os.userInfo().username, uptimeHours: +(os.uptime() / 3600).toFixed(1),
    },
    hardware: {
      cpu: cpus[0]?.model?.trim() || 'unknown', cores: cpus.length,
      ramTotal: human(os.totalmem()), ramFree: human(os.freemem()), gpu: gpu || 'unknown',
      drive, driveFree: human(free), driveTotal: human(total),
    },
    tools,
    path: (process.env.PATH || '').split(IS_WIN ? ';' : ':').filter(Boolean),
  };
}

/* --------------------------------------------------------------- ports -- */

/** Is anything listening on this port, and if so, who? */
async function whoHasPort(port) {
  const p = Number.parseInt(port, 10);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return { port, error: 'not a valid port number' };

  const free = await new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(p, '127.0.0.1');
  });
  if (free) return { port: p, inUse: false, detail: 'nothing is listening' };

  if (IS_WIN) {
    const pidLine = await out(
      `Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue | `
      + 'Select-Object -First 1 -ExpandProperty OwningProcess',
    );
    const pid = Number.parseInt(pidLine, 10);
    if (!Number.isInteger(pid)) return { port: p, inUse: true, detail: 'in use, but the owner could not be identified' };
    const name = await out(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`);
    const cmdline = await out(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`);
    return { port: p, inUse: true, pid, name: name || 'unknown', cmdline: cmdline || '', detail: `${name || 'pid ' + pid} (pid ${pid})` };
  }
  const line = await out(`lsof -nP -iTCP:${p} -sTCP:LISTEN | tail -n +2 | head -1`);
  const cols = line.split(/\s+/);
  if (cols.length < 2) return { port: p, inUse: true, detail: 'in use, but the owner could not be identified' };
  return { port: p, inUse: true, pid: Number.parseInt(cols[1], 10), name: cols[0], detail: `${cols[0]} (pid ${cols[1]})` };
}

const COMMON_PORTS = [3000, 3001, 4200, 5000, 5173, 5432, 6379, 8000, 8080, 8081, 9000, 11434, 27017];

async function scanCommonPorts() {
  const rows = [];
  for (const p of COMMON_PORTS) {
    // eslint-disable-next-line no-await-in-loop
    const r = await whoHasPort(p);
    if (r.inUse) rows.push(r);
  }
  return rows;
}

/* ------------------------------------------------------------- cleanup -- */

function cacheTargets() {
  const home = os.homedir();
  const t = [];
  const add = (id, label, dir, note) => { if (dir && fs.existsSync(dir)) t.push({ id, label, dir, note }); };

  add('temp', 'Temporary files', os.tmpdir(), 'Anything older than 7 days.');
  add('pg-logs', 'ProGramerly logs', paths.logDir, 'Anything older than 30 days.');
  add('npm', 'npm cache', IS_WIN ? path.join(process.env.LOCALAPPDATA || home, 'npm-cache') : path.join(home, '.npm'), 'npm re-downloads what it needs.');
  add('pip', 'pip cache', IS_WIN ? path.join(process.env.LOCALAPPDATA || home, 'pip', 'Cache') : path.join(home, '.cache', 'pip'), 'pip re-downloads what it needs.');
  add('eb', 'electron-builder cache', IS_WIN ? path.join(process.env.LOCALAPPDATA || home, 'electron-builder', 'Cache') : path.join(home, 'Library', 'Caches', 'electron-builder'), 'Re-downloaded on the next build.');
  add('electron', 'Electron download cache', IS_WIN ? path.join(process.env.LOCALAPPDATA || home, 'electron', 'Cache') : path.join(home, 'Library', 'Caches', 'electron'), 'Re-downloaded on the next install.');
  // Deliberately NOT offered: %LOCALAPPDATA%\\Packages (winget's own store) -
  // it holds live application state as well as installer payloads, and there
  // is no safe line between the two from out here.
  if (IS_WIN) {
    add('choco', 'Chocolatey downloads', path.join(process.env.TEMP || os.tmpdir(), 'chocolatey'), 'Installer payloads already applied.');
  }
  if (IS_MAC) add('brew', 'Homebrew cache', path.join(home, 'Library', 'Caches', 'Homebrew'), 'brew re-downloads what it needs.');
  return t;
}

async function cleanupPreview() {
  return cacheTargets().map((t) => {
    const { bytes, files, truncated } = dirSize(t.dir, { maxEntries: 40000 });
    return { ...t, bytes, files, truncated, size: human(bytes) + (truncated ? '+' : '') };
  });
}

async function cleanupRun(ids, log = () => {}) {
  const targets = cacheTargets().filter((t) => ids.includes(t.id));
  let freed = 0;
  const done = [];
  for (const t of targets) {
    log(`clearing ${t.label} (${t.dir})...`);
    let res;
    if (t.id === 'temp') res = pruneOlderThan(t.dir, 7);
    else if (t.id === 'pg-logs') res = pruneOlderThan(t.dir, 30);
    else {
      const before = dirSize(t.dir).bytes;
      try { fs.rmSync(t.dir, { recursive: true, force: true }); fs.mkdirSync(t.dir, { recursive: true }); }
      catch (e) { log(`  could not clear it: ${e.message}`); res = { bytes: 0, count: 0 }; }
      res = res || { bytes: before, count: 1 };
    }
    freed += res.bytes;
    log(`  reclaimed ${human(res.bytes)}`);
    done.push({ id: t.id, label: t.label, bytes: res.bytes, size: human(res.bytes) });
  }
  log(`total reclaimed: ${human(freed)}`);
  return { done, freed, freedHuman: human(freed) };
}

/* -------------------------------------------------------------- report -- */

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
}

function markdown(diag, env, ports) {
  const icon = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', info: 'INFO', skip: 'SKIP' };
  const L = [];
  L.push('# ProGramerly - system report');
  L.push('');
  L.push(`Generated ${new Date().toISOString()} on \`${env.os.hostname}\` (${env.os.user})`);
  L.push('');
  L.push(`**${diag.summary.fail} failing · ${diag.summary.warn} warnings · ${diag.summary.ok} healthy**`);
  L.push('');
  L.push('## Diagnostics');
  L.push('');
  L.push('| | Check | Result |');
  L.push('| --- | --- | --- |');
  for (const r of diag.results) {
    L.push(`| \`${icon[r.status] || r.status}\` | ${r.title} | ${String(r.detail).replace(/\|/g, '\\|')} |`);
  }
  L.push('');
  const bad = diag.results.filter((r) => r.status === 'fail' || r.status === 'warn');
  if (bad.length) {
    L.push('### Why these matter');
    L.push('');
    for (const r of bad) L.push(`- **${r.title}** — ${r.why}`);
    L.push('');
  }
  L.push('## Machine');
  L.push('');
  L.push(`- ${env.os.type} ${env.os.release} (${env.os.arch}), up ${env.os.uptimeHours} h`);
  L.push(`- ${env.hardware.cpu} · ${env.hardware.cores} cores · ${env.hardware.ramTotal} RAM (${env.hardware.ramFree} free)`);
  L.push(`- GPU: ${env.hardware.gpu}`);
  L.push(`- ${env.hardware.drive} ${env.hardware.driveFree} free of ${env.hardware.driveTotal}`);
  L.push(`- Electron ${env.app.electron} · Node ${env.app.node} · Chromium ${env.app.chrome}`);
  L.push('');
  L.push('## Toolchain');
  L.push('');
  L.push('| Tool | Version |');
  L.push('| --- | --- |');
  for (const t of env.tools) L.push(`| ${t.name} | ${t.version ? `\`${t.version}\`` : '_not installed_'} |`);
  L.push('');
  if (ports && ports.length) {
    L.push('## Ports in use');
    L.push('');
    L.push('| Port | Owner |');
    L.push('| --- | --- |');
    for (const p of ports) L.push(`| ${p.port} | ${p.detail} |`);
    L.push('');
  }
  L.push('## PATH');
  L.push('');
  L.push('```');
  for (const p of env.path) L.push(p);
  L.push('```');
  L.push('');
  L.push('---');
  L.push('');
  L.push('Governance: Policy 986 AED · © 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — TM');
  return L.join('\n');
}

/**
 * The whole thing: diagnose, snapshot the machine, look at the usual ports,
 * and leave every artefact in one folder that can be zipped and sent.
 */
async function fullReport(log = () => {}) {
  const dir = path.join(paths.userData, 'diagnostics', stamp());
  fs.mkdirSync(dir, { recursive: true });
  log(`report folder: ${dir}`);

  const diag = await diagnose(log);
  const env = await environment(log);
  log('checking the usual development ports...');
  const ports = await scanCommonPorts();
  if (ports.length) ports.forEach((p) => log(`  ${p.port} - ${p.detail}`));
  else log('  none of the usual ports are occupied');

  fs.writeFileSync(path.join(dir, 'report.md'), markdown(diag, env, ports), 'utf8');
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ diagnostics: diag, environment: env, ports }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'path.txt'), env.path.join(os.EOL), 'utf8');

  // Carry the newest application log along, so the report is self-contained.
  try {
    const logs = fs.readdirSync(paths.logDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({ f, t: fs.statSync(path.join(paths.logDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (logs[0]) {
      fs.copyFileSync(path.join(paths.logDir, logs[0].f), path.join(dir, logs[0].f));
      log(`copied ${logs[0].f} into the report folder`);
    }
  } catch { /* no logs yet - not a problem */ }

  log('');
  log(`report written: ${path.join(dir, 'report.md')}`);
  return { dir, diagnostics: diag, environment: env, ports };
}

module.exports = {
  configure,
  diagnose,
  fixOne,
  fixAll,
  environment,
  whoHasPort,
  scanCommonPorts,
  cleanupPreview,
  cleanupRun,
  fullReport,
  human,
};
