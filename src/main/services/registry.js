'use strict';
/**
 * ProGramerly - Windows registry repair
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Rules this module will not break:
 *   1. It only writes values Microsoft documents as the correct setting.
 *   2. It never deletes anything unless Microsoft's own guidance names that
 *      value as the fault, AND you have ticked the removals box.
 *   3. Every key it is about to touch is exported to a .reg file first.
 *   4. A value that already matches is reported and left alone.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');
const { run } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';
const DATA = path.join(__dirname, '..', 'data', 'registry-fixes.json');

function load() {
  return JSON.parse(fs.readFileSync(DATA, 'utf8'));
}

function backupDir() {
  const dir = path.join(app.getPath('userData'), 'registry-backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** HKLM:\SOFTWARE\... -> HKLM\SOFTWARE\...  (reg.exe spelling) */
function regExeKey(psPath) {
  return psPath.replace(/^HKLM:\\/i, 'HKEY_LOCAL_MACHINE\\')
    .replace(/^HKCU:\\/i, 'HKEY_CURRENT_USER\\')
    .replace(/^HKCR:\\/i, 'HKEY_CLASSES_ROOT\\')
    .replace(/^HKU:\\/i, 'HKEY_USERS\\');
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/* ----------------------------------------------------------------- scan -- */

/**
 * Read every value the fix set cares about in a single PowerShell round trip.
 * @returns {Promise<{ok:boolean, fixes:Array, error?:string}>}
 */
async function scan() {
  // CI screenshot mode - see scripts/ui-fixtures.js. Off unless asked for, and
  // scripts/ is not packaged into the app, so this can simply be absent.
  if (process.env.PROGRAMERLY_UI_FIXTURES === '1') {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require('../../../scripts/ui-fixtures').registryScan();
    } catch { /* not a source checkout - fall through to the real reader */ }
  }
  if (!IS_WIN) return { ok: false, error: 'Registry repair is Windows only.', fixes: [] };
  const data = load();

  const probes = [];
  for (const fix of data.fixes) {
    for (const v of fix.values) {
      probes.push({ fix: fix.id, path: v.path, name: v.name });
    }
  }

  const psList = probes.map((p) => `@{ fix=${psQuote(p.fix)}; path=${psQuote(p.path)}; name=${psQuote(p.name)} }`).join(',');
  const script = [
    "$ErrorActionPreference='SilentlyContinue';",
    `$probes=@(${psList});`,
    '$out=@();',
    'foreach($p in $probes){',
    '  $exists=$false; $val=$null;',
    '  if(Test-Path -LiteralPath $p.path){',
    '    if($p.name -eq "(Default)"){',
    '      $item=Get-Item -LiteralPath $p.path;',
    '      $val=$item.GetValue("");',
    '      $exists = ($null -ne $val -and $val -ne "");',
    '    } else {',
    '      $item=Get-ItemProperty -LiteralPath $p.path -Name $p.name -ErrorAction SilentlyContinue;',
    '      if($null -ne $item){ $val=$item.($p.name); $exists = ($null -ne $val) }',
    '    }',
    '  }',
    '  if($val -is [array]){ $val = ($val -join "|") }',
    '  $out += [pscustomobject]@{ fix=$p.fix; path=$p.path; name=$p.name; exists=$exists; value=$val };',
    '}',
    '$out | ConvertTo-Json -Compress -Depth 4',
  ].join(' ');

  const { output } = await run(script, { timeoutMs: 90000 });
  let rows = [];
  try {
    const start = output.indexOf('[') >= 0 && (output.indexOf('[') < output.indexOf('{') || output.indexOf('{') < 0)
      ? output.indexOf('[') : output.indexOf('{');
    const parsed = JSON.parse(output.slice(start));
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return { ok: false, error: 'could not read the registry - try running ProGramerly as Administrator', fixes: [] };
  }

  const byFix = new Map();
  for (const r of rows) {
    if (!byFix.has(r.fix)) byFix.set(r.fix, []);
    byFix.get(r.fix).push(r);
  }

  const fixes = data.fixes.map((fix) => {
    const found = byFix.get(fix.id) || [];
    const values = fix.values.map((v) => {
      const hit = found.find((f) => f.path === v.path && f.name === v.name) || {};
      const current = hit.exists ? hit.value : null;
      let state;
      if (fix.action === 'remove') {
        state = hit.exists ? 'present' : 'clean';
      } else if (!hit.exists) {
        state = 'missing';
      } else if (String(current) === String(v.data)) {
        state = 'correct';
      } else {
        state = 'wrong';
      }
      return { ...v, current, state };
    });

    let status;
    if (fix.action === 'remove') {
      status = values.some((v) => v.state === 'present') ? 'actionable' : 'clean';
    } else if (values.every((v) => v.state === 'correct')) {
      status = 'clean';
    } else if (fix.onlyIfEquals !== undefined
      && !values.some((v) => v.current !== null && Number(v.current) === Number(fix.onlyIfEquals))) {
      status = 'clean';
    } else {
      status = 'actionable';
    }

    return { ...fix, values, status };
  });

  return {
    ok: true,
    fixes,
    tools: data.tools,
    meta: data.meta,
    actionable: fixes.filter((f) => f.status === 'actionable').length,
  };
}

/* --------------------------------------------------------------- backup -- */

async function backup(fixes, log = () => {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backupDir(), stamp);
  fs.mkdirSync(dir, { recursive: true });

  const keys = [...new Set(fixes.flatMap((f) => f.values.map((v) => v.path)))];
  const written = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = regExeKey(keys[i]);
    const out = path.join(dir, `${String(i).padStart(2, '0')}-${key.replace(/[\\:{}]/g, '_').slice(-90)}.reg`);
    // eslint-disable-next-line no-await-in-loop
    const { code } = await run(`reg export "${key}" "${out}" /y`, { timeoutMs: 60000 });
    if (code === 0) { written.push(out); log(`backed up ${key}`); }
    else log(`could not export ${key} (it may not exist yet) - nothing to restore there`, 'warn');
  }

  fs.writeFileSync(path.join(dir, 'MANIFEST.json'), `${JSON.stringify({
    at: Date.now(),
    stamp,
    governance: 'Policy 986 AED',
    fixes: fixes.map((f) => f.id),
    keys,
    restore: 'Double-click any .reg file in this folder, or run: reg import "<file>"',
  }, null, 2)}\n`, 'utf8');

  return { dir, written };
}

/* ---------------------------------------------------------------- apply -- */

/**
 * @param {string[]} ids            fix ids to apply
 * @param {{allowRemovals:boolean}} opts
 * @param {(line:string,level?:string)=>void} log
 */
async function apply(ids, opts, log = () => {}) {
  if (!IS_WIN) return { ok: false, error: 'Registry repair is Windows only.' };
  const scanned = await scan();
  if (!scanned.ok) return scanned;

  const chosen = scanned.fixes.filter((f) => ids.includes(f.id) && f.status === 'actionable');
  if (!chosen.length) return { ok: true, applied: [], skipped: [], note: 'nothing needed changing' };

  const removals = chosen.filter((f) => f.action === 'remove');
  const allowed = opts && opts.allowRemovals;
  const blocked = allowed ? [] : removals;
  const toRun = allowed ? chosen : chosen.filter((f) => f.action !== 'remove');

  for (const f of blocked) {
    log(`skipped "${f.name}" - it removes a value, and the removals box is not ticked`, 'warn');
  }
  if (!toRun.length) return { ok: true, applied: [], skipped: blocked.map((f) => f.id) };

  log('exporting a .reg backup of every key about to be touched', 'head');
  const bk = await backup(toRun, log);
  log(`backup written to ${bk.dir}`, 'ok');

  const applied = [];
  const failed = [];

  for (const fix of toRun) {
    log('');
    log(`--- ${fix.name} ---`, 'head');
    let allOk = true;
    for (const v of fix.values) {
      if (fix.action === 'remove') {
        if (v.state !== 'present') { log(`  ${v.name}: already clean`); continue; }
        const script = `if(Test-Path -LiteralPath ${psQuote(v.path)}){ Remove-ItemProperty -LiteralPath ${psQuote(v.path)} -Name ${psQuote(v.name)} -Force -ErrorAction Stop; 'removed' }`;
        // eslint-disable-next-line no-await-in-loop
        const { code, output } = await run(script, { timeoutMs: 30000 });
        if (code === 0) log(`  removed ${v.name} from ${v.path}`, 'ok');
        else { allOk = false; log(`  could not remove ${v.name}: ${output.trim().split('\n').pop()}`, 'err'); }
      } else {
        if (v.state === 'correct') { log(`  ${v.name}: already correct`); continue; }
        const nameArg = v.name === '(Default)' ? "'(Default)'" : psQuote(v.name);
        const dataArg = typeof v.data === 'number' ? String(v.data) : psQuote(v.data);
        const script = [
          `if(-not (Test-Path -LiteralPath ${psQuote(v.path)})){ New-Item -Path ${psQuote(v.path)} -Force | Out-Null }`,
          `New-ItemProperty -LiteralPath ${psQuote(v.path)} -Name ${nameArg} -PropertyType ${v.type} -Value ${dataArg} -Force -ErrorAction Stop | Out-Null`,
          "'set'",
        ].join('; ');
        // eslint-disable-next-line no-await-in-loop
        const { code, output } = await run(script, { timeoutMs: 30000 });
        if (code === 0) log(`  ${v.path}\\${v.name} = ${v.data}`, 'ok');
        else { allOk = false; log(`  could not write ${v.name}: ${output.trim().split('\n').pop()}`, 'err'); }
      }
    }
    (allOk ? applied : failed).push(fix.id);
  }

  const needsReboot = toRun.some((f) => f.reboot);
  log('');
  log(`registry repair finished - ${applied.length} applied, ${failed.length} failed`, failed.length ? 'warn' : 'ok');
  if (needsReboot) log('one of these takes effect after a restart', 'warn');

  return { ok: true, applied, failed, skipped: blocked.map((f) => f.id), backup: bk.dir, needsReboot };
}

/* ---------------------------------------------------------------- tools -- */

async function runTool(id, log = () => {}) {
  if (!IS_WIN) return { ok: false, error: 'Windows only.' };
  const tool = load().tools.find((t) => t.id === id);
  if (!tool) return { ok: false, error: `unknown tool "${id}"` };
  log(`--- ${tool.name} ---`, 'head');
  log(`$ ${tool.cmd}`);
  const { code } = await run(tool.cmd, {
    onLine: (l) => log(`  ${l}`),
    timeoutMs: Math.max(5, tool.minutes || 10) * 60 * 1000 * 2,
  });
  log(`${tool.name} finished (exit ${code})`, code === 0 ? 'ok' : 'warn');
  return { ok: code === 0, code, reboot: Boolean(tool.reboot) };
}

/** Open regedit, positioned on a key when one is given. */
async function openEditor(key) {
  if (!IS_WIN) return { ok: false, error: 'Windows only.' };
  if (key) {
    const last = regExeKey(key).replace(/^HKEY_LOCAL_MACHINE/, 'Computer\\HKEY_LOCAL_MACHINE')
      .replace(/^HKEY_CURRENT_USER/, 'Computer\\HKEY_CURRENT_USER')
      .replace(/^HKEY_CLASSES_ROOT/, 'Computer\\HKEY_CLASSES_ROOT');
    await run(
      'New-Item -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Applets\\Regedit" -Force | Out-Null; '
      + `Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Applets\\Regedit" -Name "LastKey" -Value ${psQuote(last)}`,
      { timeoutMs: 20000 },
    );
  }
  await run('Start-Process regedit.exe', { timeoutMs: 20000 });
  return { ok: true };
}

function openBackups() {
  const dir = backupDir();
  shell.openPath(dir);
  return dir;
}

module.exports = { scan, apply, runTool, openEditor, openBackups, backupDir, load };
