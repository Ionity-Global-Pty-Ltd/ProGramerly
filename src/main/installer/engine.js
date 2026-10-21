'use strict';
/**
 * ProGramerly - install engine
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Turns a catalog item into an ordered list of attempts and runs them until
 * one succeeds. Windows: winget candidates -> Chocolatey fallback.
 * macOS: Homebrew formula/cask (sudo via one askpass dialog, 3.9.0). Linux: the native manager that is
 * present (apt / dnf / pacman / zypper) -> Flatpak -> snap. Then npm globals,
 * then custom steps.
 */

const { run, has } = require('./runner');
const macAuth = require('../services/macAuth');
const askpass = require('./askpass');
const tasks = require('./tasks');
const mcp = require('./mcp-config');

const IS_WIN = process.platform === 'win32';
const PLATFORM = IS_WIN ? 'win' : (process.platform === 'darwin' ? 'mac' : 'linux');

/* ----------------------------------------------------------------- Linux */
// Native managers in the order we trust them; the first one on PATH wins.
const LINUX_NATIVE = [
  { key: 'apt', bin: 'apt-get', install: (pkgs) => `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgs}` },
  { key: 'dnf', bin: 'dnf', install: (pkgs) => `dnf install -y ${pkgs}` },
  { key: 'pacman', bin: 'pacman', install: (pkgs) => `pacman -S --noconfirm --needed ${pkgs}` },
  { key: 'zypper', bin: 'zypper', install: (pkgs) => `zypper --non-interactive install ${pkgs}` },
];
let linuxFacts = null; // { native: {key,bin,install}|null, flatpak: bool, snap: bool, sudo: string }

/**
 * How to become root on this box without a TTY. Root itself needs nothing;
 * passwordless sudo is used when it works; otherwise pkexec, which raises the
 * desktop's own authentication dialog - the right thing for a GUI installer.
 */
async function sudoPrefix() {
  if (process.getuid && process.getuid() === 0) return '';
  // A run that asked for the password once serves it to sudo through
  // SUDO_ASKPASS - one dialog for the whole queue.
  if (askpass.active()) return 'sudo -A ';
  const { code } = await run('sudo -n true', { timeoutMs: 15000 });
  if (code === 0) return 'sudo ';
  // pkexec does not accept VAR=value before the program, so it always goes
  // through env(1): `pkexec env DEBIAN_FRONTEND=noninteractive apt-get ...`.
  if (await has('pkexec')) return 'pkexec env ';
  // Last resort: fail fast instead of waiting on a password nobody can type.
  return 'sudo -n ';
}

/** Forget cached facts - after "Linux package sources" adds Flatpak, say. */
function resetLinuxFacts() { linuxFacts = null; }

async function readLinuxFacts() {
  if (linuxFacts) {
    // A previous item may have installed flatpak or snapd since we looked.
    if (!linuxFacts.flatpak) linuxFacts.flatpak = await has('flatpak');
    if (!linuxFacts.snap) linuxFacts.snap = await has('snap');
    if (askpass.active()) linuxFacts.sudo = 'sudo -A ';
    return linuxFacts;
  }
  let native = null;
  for (const m of LINUX_NATIVE) {
    // eslint-disable-next-line no-await-in-loop
    if (await has(m.bin)) { native = m; break; }
  }
  linuxFacts = {
    native,
    flatpak: await has('flatpak'),
    snap: await has('snap'),
    sudo: await sudoPrefix(),
  };
  return linuxFacts;
}

/**
 * Catalog authors write `sudo` the way a human would. On a desktop with no
 * passwordless sudo that would hang forever, so every leading `sudo ` in a
 * Linux command is swapped for whatever actually works here.
 */
function sudoize(cmd, prefix) {
  if (PLATFORM !== 'linux' || prefix === 'sudo ') return cmd;
  if (prefix === 'sudo -A ') return cmd.replace(/(^|[;&|(]\s*|\bthen\s+|\belse\s+|\bdo\s+)sudo\s+(?!-A\b)/g, (_m, lead) => `${lead}sudo -A `);
  return cmd.replace(/(^|[;&|(]\s*|\bthen\s+|\belse\s+|\bdo\s+)sudo\s+(-E\s+)?/g, (_m, lead) => `${lead}${prefix}`);
}

// winget exit codes that mean "nothing to do", not "failed".
const WINGET_OK = new Set([
  0,
  -1978335189, // 0x8A15002B  no applicable update found
  -1978335135, // 0x8A15006F  package already installed
  -1978335212, // 0x8A150014  already installed (older client)
  -1978334967, // 0x8A150089  no applicable installer, but present
]);
const ALREADY_RE = /already installed|no applicable upgrade|no available upgrade|no newer package/i;

function wingetOk(code, output) {
  return WINGET_OK.has(code) || ALREADY_RE.test(output || '');
}

function brewOk(code, output) {
  return code === 0 || /already installed|is already installed/i.test(output || '');
}

/** Does this item apply to the current OS? */
function applies(item) {
  if (Array.isArray(item.platforms) && item.platforms.length) {
    return item.platforms.includes(PLATFORM);
  }
  // No explicit platform list: applies if it has something to do here.
  return Boolean(item[PLATFORM] || item.npm || item.steps);
}

/** Items a profile preselects. */
function itemsForProfile(catalog, profile) {
  if (profile === 'custom') return [];
  return catalog.items
    .filter((i) => applies(i) && Array.isArray(i.profiles) && i.profiles.includes(profile))
    .map((i) => i.id);
}

/** Topologically order selected ids so dependsOn runs first. */
function orderSelection(catalog, ids) {
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const want = new Set(ids);
  // Pull in dependencies even if the user did not tick them.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...want]) {
      for (const dep of byId.get(id)?.dependsOn || []) {
        if (byId.has(dep) && !want.has(dep) && applies(byId.get(dep))) {
          want.add(dep);
          changed = true;
        }
      }
    }
  }
  const out = [];
  const seen = new Set();
  const visit = (id, stack = new Set()) => {
    if (seen.has(id) || stack.has(id)) return;
    stack.add(id);
    for (const dep of byId.get(id)?.dependsOn || []) {
      if (want.has(dep)) visit(dep, stack);
    }
    stack.delete(id);
    seen.add(id);
    out.push(id);
  };
  // Keep catalog order as the tiebreaker so bootstrap runs first.
  for (const item of catalog.items) if (want.has(item.id)) visit(item.id);
  return out.map((id) => byId.get(id)).filter(Boolean);
}

function quoteArgs(extra) {
  return extra ? ` ${extra}` : '';
}

/**
 * Run one catalog item.
 * @returns {Promise<{status:'ok'|'partial'|'failed'|'skipped', detail:string}>}
 */
async function installItem(item, log) {
  if (!applies(item)) return { status: 'skipped', detail: `not applicable on ${PLATFORM}` };

  const spec = item[PLATFORM] || {};
  let anySuccess = false;
  let anyFailure = false;

  // ---- 0. Pre-steps: taps, repos, anything a package manager needs first ---
  for (const step of spec.pre || []) {
    const res = await runStep(step, log);
    if (res !== 0 && !step.allowFail) anyFailure = true;
  }

  // ---- 1. Windows: winget candidates, then Chocolatey -------------------
  // With `stopOnFirstSuccess` the list is a chain of alternatives (2026, then
  // 2022) and the first hit ends it; without it every id is a wanted package
  // (Python 3.13 and 3.12 both install).
  if (PLATFORM === 'win' && Array.isArray(spec.winget) && spec.winget.length) {
    let altFailures = 0;
    for (const id of spec.winget) {
      log(`winget install ${id}`);
      const cmd = `winget install --id ${id} --exact --silent --disable-interactivity `
        + `--accept-package-agreements --accept-source-agreements${quoteArgs(spec.wingetArgs)}`;
      const { code, output } = await run(cmd, { onLine: (l) => log(`  ${l}`) });
      if (wingetOk(code, output)) {
        anySuccess = true;
        log(`  ok: ${id}`);
        if (spec.stopOnFirstSuccess) break;
      } else if (spec.stopOnFirstSuccess) {
        altFailures += 1;
        log(`  ${id} not available here (exit ${code}) - trying the next candidate`);
      } else {
        anyFailure = true;
        log(`  winget failed for ${id} (exit ${code})`);
      }
    }
    if (spec.stopOnFirstSuccess && !anySuccess && altFailures) anyFailure = true;
    if (!anySuccess && Array.isArray(spec.choco) && spec.choco.length) {
      log('falling back to Chocolatey');
      for (const pkg of spec.choco) {
        const { code } = await run(`choco install ${pkg} -y --no-progress --limit-output`, {
          onLine: (l) => log(`  ${l}`),
        });
        if (code === 0 || code === 1641 || code === 3010) { anySuccess = true; log(`  ok: ${pkg}`); }
        else { anyFailure = true; log(`  choco failed for ${pkg} (exit ${code})`); }
      }
    }
  }

  // ---- 2. macOS: Homebrew ------------------------------------------------
  if (PLATFORM === 'mac') {
    const formulae = Array.isArray(spec.brew) ? spec.brew : (spec.brew?.formula || []);
    const casks = (spec.brew && spec.brew.cask) ? spec.brew.cask : (spec.brewCask || []);
    for (const f of formulae) {
      log(`brew install ${f}`);
      const { code, output } = await run(`brew install ${f}`, { onLine: (l) => log(`  ${l}`) });
      if (brewOk(code, output)) { anySuccess = true; log(`  ok: ${f}`); }
      else { anyFailure = true; log(`  brew failed for ${f} (exit ${code})`); }
    }
    for (const c of casks) {
      log(`brew install --cask ${c}`);
      const { code, output } = await run(`brew install --cask ${c}`, { onLine: (l) => log(`  ${l}`) });
      if (brewOk(code, output)) { anySuccess = true; log(`  ok: ${c}`); }
      else { anyFailure = true; log(`  brew cask failed for ${c} (exit ${code})`); }
    }
  }

  // ---- 2b. Linux: native manager, then Flatpak, then snap ----------------
  // Native packages are the first choice. Flatpak and snap only run when the
  // native list did not deliver (or there is none), so a distro package is
  // never shadowed by a sandboxed copy of the same app.
  if (PLATFORM === 'linux') {
    const lf = await readLinuxFacts();
    const nativeList = lf.native ? spec[lf.native.key] : null;
    const wantsNative = Object.keys(spec).some((k) => LINUX_NATIVE.some((m) => m.key === k));
    let linuxOk = false;      // something in this block delivered
    let linuxTried = false;   // something in this block was attempted
    if (lf.native && Array.isArray(nativeList) && nativeList.length) {
      linuxTried = true;
      const cmd = sudoize(`sudo ${lf.native.install(nativeList.join(' '))}`, lf.sudo);
      log(`${lf.native.key}: ${nativeList.join(' ')}`);
      const { code, output } = await run(cmd, { onLine: (l) => log(`  ${l}`) });
      if (code === 0 || /already (the newest|installed)|is up to date|nothing to do/i.test(output || '')) {
        linuxOk = true; log('  ok');
      } else {
        log(`  ${lf.native.key} failed (exit ${code})${(spec.flatpak || spec.snap) ? ' - trying Flatpak / snap' : ''}`);
      }
    } else if (!lf.native && wantsNative) {
      log('no supported native package manager found (apt, dnf, pacman, zypper) - trying Flatpak / snap');
    }
    if (!linuxOk && Array.isArray(spec.flatpak) && spec.flatpak.length) {
      linuxTried = true;
      if (!lf.flatpak) {
        log('flatpak is not installed - run "Linux package sources" first');
      } else {
        for (const ref of spec.flatpak) {
          log(`flatpak install ${ref}`);
          // eslint-disable-next-line no-await-in-loop
          const { code, output } = await run(`flatpak install -y --noninteractive --or-update flathub ${ref}`, { onLine: (l) => log(`  ${l}`) });
          if (code === 0 || /already installed/i.test(output || '')) { linuxOk = true; log(`  ok: ${ref}`); }
          else log(`  flatpak failed for ${ref} (exit ${code})`);
        }
      }
    }
    if (!linuxOk && Array.isArray(spec.snap) && spec.snap.length) {
      linuxTried = true;
      if (!lf.snap) {
        log('snap is not installed on this distro - skipped');
      } else {
        for (const entry of spec.snap) {
          log(`snap install ${entry}`);
          // eslint-disable-next-line no-await-in-loop
          const { code, output } = await run(sudoize(`sudo snap install ${entry}`, lf.sudo), { onLine: (l) => log(`  ${l}`) });
          if (code === 0 || /already installed/i.test(output || '')) { linuxOk = true; log(`  ok: ${entry}`); }
          else log(`  snap failed for ${entry} (exit ${code})`);
        }
      }
    }
    if (linuxOk) anySuccess = true;
    else if (linuxTried) anyFailure = true;
  }

  // ---- 3. npm globals (platform-specific list wins, else top level) ------
  const npmPkgs = spec.npm || item.npm;
  if (Array.isArray(npmPkgs) && npmPkgs.length) {
    if (!(await has(IS_WIN ? 'npm.cmd' : 'npm')) && !(await has('npm'))) {
      log('npm is not on PATH yet - open a new terminal after Node installs and re-run this item');
      anyFailure = true;
    } else {
      log(`npm install -g ${npmPkgs.join(' ')}`);
      let { code, output } = await run(`npm install -g ${npmPkgs.join(' ')} --no-fund --no-audit`, {
        onLine: (l) => log(`  ${l}`),
        timeoutMs: 20 * 60 * 1000,
      });
      // A distro or root-owned Node puts globals in /usr/lib - not writable
      // without root. Install to ~/.npm-global instead (on the runner's PATH)
      // rather than running npm as root.
      if (code !== 0 && !IS_WIN && /EACCES|permission denied/i.test(output || '')) {
        log('  global folder is not writable - installing to ~/.npm-global instead');
        ({ code, output } = await run('mkdir -p "$HOME/.npm-global" && npm config set prefix "$HOME/.npm-global" && '
          + `npm install -g ${npmPkgs.join(' ')} --no-fund --no-audit`, {
          onLine: (l) => log(`  ${l}`),
          timeoutMs: 20 * 60 * 1000,
        }));
        if (code === 0) log('  add  export PATH="$HOME/.npm-global/bin:$PATH"  to your shell profile to use these in a terminal');
      }
      if (code === 0) { anySuccess = true; log('  ok'); }
      else { anyFailure = true; log(`  npm failed (exit ${code})`); }
    }
  }

  // ---- 4. Explicit steps (platform spec first, then item level) ----------
  const steps = [...(spec.steps || []), ...(item.steps || []), ...(spec.post || [])];
  let softFailures = 0;
  let ranSteps = 0;
  for (const step of steps) {
    const res = await runStep(step, log);
    ranSteps += 1;
    if (res === 0) anySuccess = true;
    else if (!step.allowFail) anyFailure = true;
    else { softFailures += 1; log('  (non-fatal)'); }
  }

  // An item whose only work was optional steps that ALL failed did not do
  // nothing - it failed. Reporting that as "skipped" would hide a model pull
  // that never downloaded anything.
  if (!anySuccess && !anyFailure && softFailures > 0 && softFailures === ranSteps) {
    return { status: 'failed', detail: `every step failed (${softFailures} of ${ranSteps}) - see the log` };
  }
  if (!anySuccess && !anyFailure) return { status: 'skipped', detail: 'nothing to do on this platform' };
  if (anySuccess && anyFailure) {
    return item.allowPartial || spec.allowPartial
      ? { status: 'ok', detail: 'installed (some optional parts skipped)' }
      : { status: 'partial', detail: 'some parts failed' };
  }
  return anySuccess ? { status: 'ok', detail: 'installed' } : { status: 'failed', detail: 'all attempts failed' };
}

async function runStep(step, log) {
  switch (step.type) {
    case 'shell': {
      const cmd = (PLATFORM === 'mac' && step.macCmd) ? step.macCmd
        : (PLATFORM === 'win' && step.winCmd) ? step.winCmd
        : (PLATFORM === 'linux' && step.linuxCmd) ? step.linuxCmd
        : step.cmd;
      if (!cmd) return 0;
      // `check`: a command that exits 0 when this step is already satisfied.
      // (`check: true` marks the step itself as the verification.)
      if (typeof step.check === 'string' && step.check.trim()) {
        const probe = await run(step.check, { timeoutMs: 60000 });
        if (probe.code === 0) { log(`already satisfied: ${step.check}`); return 0; }
      }
      const real = PLATFORM === 'linux' ? sudoize(cmd, (await readLinuxFacts()).sudo)
        : PLATFORM === 'mac' ? macAuth.sudoizeMac(cmd)
        : cmd;
      log(`$ ${real}`);
      const { code } = await run(real, { onLine: (l) => log(`  ${l}`) });
      if (code !== 0) log(`  exit ${code}`);
      return code;
    }
    case 'vscodeExt':
      return tasks.vscodeExtensions(step.ids || [], log);
    case 'gitClone':
      return tasks.gitClone(step.repo, step.dest, log, { branch: step.branch, recursive: step.recursive });
    case 'workspace':
      return tasks.workspace(log);
    case 'chromeExt':
      return tasks.chromeExtensions(step.ids || [], log);
    case 'venv':
      return tasks.pythonVenv(log);
    case 'venvPip':
      return tasks.venvPip(step.packages || [], step.args || '', log);
    case 'scaffold':
      return tasks.scaffold(step.kind, step.dest, log);
    case 'mcpConfig': {
      const res = mcp.writeConfig(log, step.target || 'claude');
      if (!res.ok) log(`  failed: ${res.error}`);
      return res.ok ? 0 : 1;
    }
    default:
      log(`unknown step type "${step.type}" - skipped`);
      return 0;
  }
}

module.exports = { installItem, itemsForProfile, orderSelection, applies, PLATFORM, LINUX_NATIVE, readLinuxFacts, resetLinuxFacts, sudoize };
