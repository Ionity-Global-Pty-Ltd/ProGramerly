'use strict';
/**
 * ProGramerly - install engine
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Turns a catalog item into an ordered list of attempts and runs them until
 * one succeeds. Windows: winget candidates -> Chocolatey fallback.
 * macOS: Homebrew formula/cask. Then npm globals, then custom steps.
 */

const { run, has } = require('./runner');
const tasks = require('./tasks');
const mcp = require('./mcp-config');

const IS_WIN = process.platform === 'win32';
const PLATFORM = IS_WIN ? 'win' : (process.platform === 'darwin' ? 'mac' : 'linux');

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
  if (PLATFORM === 'win' && Array.isArray(spec.winget) && spec.winget.length) {
    for (const id of spec.winget) {
      log(`winget install ${id}`);
      const cmd = `winget install --id ${id} --exact --silent --disable-interactivity `
        + `--accept-package-agreements --accept-source-agreements${quoteArgs(spec.wingetArgs)}`;
      const { code, output } = await run(cmd, { onLine: (l) => log(`  ${l}`) });
      if (wingetOk(code, output)) {
        anySuccess = true;
        log(`  ok: ${id}`);
      } else {
        anyFailure = true;
        log(`  winget failed for ${id} (exit ${code})`);
      }
    }
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

  // ---- 3. npm globals (platform-specific list wins, else top level) ------
  const npmPkgs = spec.npm || item.npm;
  if (Array.isArray(npmPkgs) && npmPkgs.length) {
    if (!(await has(IS_WIN ? 'npm.cmd' : 'npm')) && !(await has('npm'))) {
      log('npm is not on PATH yet - open a new terminal after Node installs and re-run this item');
      anyFailure = true;
    } else {
      log(`npm install -g ${npmPkgs.join(' ')}`);
      const { code } = await run(`npm install -g ${npmPkgs.join(' ')} --no-fund --no-audit`, {
        onLine: (l) => log(`  ${l}`),
        timeoutMs: 20 * 60 * 1000,
      });
      if (code === 0) { anySuccess = true; log('  ok'); }
      else { anyFailure = true; log(`  npm failed (exit ${code})`); }
    }
  }

  // ---- 4. Explicit steps (platform spec first, then item level) ----------
  const steps = [...(spec.steps || []), ...(item.steps || []), ...(spec.post || [])];
  for (const step of steps) {
    const res = await runStep(step, log);
    if (res === 0) anySuccess = true;
    else if (!step.allowFail) anyFailure = true;
    else log('  (non-fatal)');
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
        : step.cmd;
      if (!cmd) return 0;
      log(`$ ${cmd}`);
      const { code } = await run(cmd, { onLine: (l) => log(`  ${l}`) });
      if (code !== 0) log(`  exit ${code}`);
      return code;
    }
    case 'vscodeExt':
      return tasks.vscodeExtensions(step.ids || [], log);
    case 'gitClone':
      return tasks.gitClone(step.repo, step.dest, log);
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
      const res = mcp.writeConfig(log);
      if (!res.ok) log(`  failed: ${res.error}`);
      return res.ok ? 0 : 1;
    }
    default:
      log(`unknown step type "${step.type}" - skipped`);
      return 0;
  }
}

module.exports = { installItem, itemsForProfile, orderSelection, applies, PLATFORM };
