'use strict';
/**
 * ProGramerly - system service: what is running, seen and unseen
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Processes, services, startup entries and listening sockets - read from
 * the operating system's own tooling every time, never cached from a fixture.
 *
 *   processes()   Windows: Win32_Process (pid, parent, command line) joined to
 *                 Get-Process (working set, CPU seconds, path).
 *                 Linux/macOS: ps -eo.
 *   services()    Get-Service / systemctl / launchctl.
 *   startup()     Run keys + Startup folders + non-Microsoft scheduled tasks
 *                 (Windows); ~/.config/autostart + enabled user units (Linux);
 *                 LaunchAgents (macOS).
 *   listeners()   Get-NetTCPConnection -State Listen / ss -ltnp / lsof.
 *
 * Actions are deliberate and single: end one process, start/stop/restart one
 * service, disable/enable one startup entry. A disabled Run entry is written
 * to <userData>/startup-backups before it is removed, and restored from there.
 *
 * Every read returns { available, rows, reason?, source } so a caller can
 * always tell a failed read from an empty one.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, has } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let ctx = { userData: () => os.tmpdir(), isElevated: async () => false };
function configure(c) { ctx = { ...ctx, ...c }; }

const ok = (rows, source, extra = {}) => ({ available: true, rows, source, at: Date.now(), ...extra });
const gone = (reason, source) => ({ available: false, rows: [], reason, source, at: Date.now() });

async function psJson(script, timeoutMs = 30000) {
  const { code, output } = await run(script, { timeoutMs });
  const text = String(output || '');
  const start = Math.min(...['[', '{'].map((c) => text.indexOf(c)).filter((i) => i >= 0));
  if (code !== 0 && !Number.isFinite(start)) throw new Error(text.trim().split(/\r?\n/).pop() || `exit ${code}`);
  if (!Number.isFinite(start)) return [];
  const data = JSON.parse(text.slice(start));
  return Array.isArray(data) ? data : [data];
}

async function sh(cmd, timeoutMs = 30000) {
  const { code, output } = await run(cmd, { timeoutMs });
  return { code, text: String(output || '') };
}

/* ------------------------------------------------------------ processes */

const PROC_WIN = `
$ErrorActionPreference='SilentlyContinue'
$gp = @{}
Get-Process | ForEach-Object { $gp[$_.Id] = $_ }
Get-CimInstance Win32_Process | ForEach-Object {
  $p = $gp[[int]$_.ProcessId]
  [pscustomobject]@{
    pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = $_.Name
    path = $_.ExecutablePath; cmd = $_.CommandLine
    rss = if ($p) { [int64]$p.WorkingSet64 } else { [int64]$_.WorkingSetSize }
    cpuSec = if ($p -and $p.CPU) { [math]::Round($p.CPU, 1) } else { $null }
    threads = [int]$_.ThreadCount
    started = if ($p -and $p.StartTime) { $p.StartTime.ToString('o') } else { $null }
    company = if ($p) { $p.Company } else { $null }
    session = [int]$_.SessionId
  }
} | ConvertTo-Json -Compress -Depth 3
`;

async function processes() {
  try {
    if (IS_WIN) {
      const rows = await psJson(PROC_WIN, 45000);
      return ok(rows.map((r) => ({
        pid: r.pid, ppid: r.ppid, name: r.name, path: r.path || null, cmd: r.cmd || null,
        rss: Number(r.rss) || 0, cpuSec: r.cpuSec == null ? null : Number(r.cpuSec),
        threads: r.threads, started: r.started, company: r.company || null,
        hidden: r.session === 0,
        user: null,
      })), 'Win32_Process + Get-Process');
    }
    const r = await sh('ps -eo pid=,ppid=,pcpu=,rss=,user=,lstart=,comm=,args= -ww', 30000);
    if (r.code !== 0) return gone(r.text.trim() || `ps exited ${r.code}`, 'ps');
    const rows = [];
    for (const line of r.text.split(/\r?\n/)) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(\S+)\s+(.*)$/);
      if (!m) continue;
      rows.push({
        pid: Number(m[1]), ppid: Number(m[2]), cpuPct: Number(m[3]), rss: Number(m[4]) * 1024,
        user: m[5], started: new Date(m[6]).toISOString(), name: path.basename(m[7]), path: m[7], cmd: m[8],
        hidden: m[5] !== os.userInfo().username, cpuSec: null, threads: null, company: null,
      });
    }
    return ok(rows, 'ps -eo');
  } catch (e) {
    return gone(e.message || String(e), IS_WIN ? 'Win32_Process' : 'ps');
  }
}

async function kill(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'not a valid pid' };
  if (id === process.pid) return { ok: false, error: 'that is ProGramerly itself - use Quit' };
  const r = IS_WIN
    ? await sh(`Stop-Process -Id ${id} -Force -ErrorAction Stop; 'stopped'`, 15000)
    : await sh(`kill -9 ${id} && echo stopped`, 15000);
  const done = r.code === 0 && /stopped/.test(r.text);
  return { ok: done, pid: id, error: done ? null : (r.text.trim().split(/\r?\n/).pop() || `exit ${r.code}`) };
}

/* ------------------------------------------------------------- services */

async function services() {
  try {
    if (IS_WIN) {
      const rows = await psJson(`Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,ProcessId,PathName,StartName,Description | ConvertTo-Json -Compress`, 45000);
      return ok(rows.map((s) => ({
        name: s.Name, label: s.DisplayName || s.Name,
        state: String(s.State || '').toLowerCase(),               // running | stopped
        start: String(s.StartMode || '').toLowerCase(),            // auto | manual | disabled
        pid: Number(s.ProcessId) || null, path: s.PathName || null, account: s.StartName || null,
        desc: s.Description || null,
        microsoft: /\\windows\\|svchost|microsoft/i.test(String(s.PathName || '')),
      })), 'Win32_Service');
    }
    if (IS_MAC) {
      const r = await sh('launchctl list', 20000);
      if (r.code !== 0) return gone(r.text.trim(), 'launchctl');
      const rows = r.text.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3).map(([pid, status, name]) => ({
        name, label: name, state: pid !== '-' ? 'running' : 'stopped', start: 'launchd', pid: pid !== '-' ? Number(pid) : null,
        path: null, account: os.userInfo().username, desc: `exit status ${status}`, microsoft: /^com\.apple\./.test(name),
      }));
      return ok(rows, 'launchctl list (user domain)');
    }
    const r = await sh('systemctl list-units --type=service --all --no-pager --plain --no-legend', 20000);
    if (r.code !== 0) return gone(r.text.trim() || 'systemctl not available', 'systemctl');
    const rows = r.text.split(/\r?\n/).filter(Boolean).map((l) => {
      const p = l.trim().split(/\s+/);
      const [unit, load, active, sub, ...desc] = p;
      return {
        name: unit, label: unit.replace(/\.service$/, ''), state: active === 'active' ? 'running' : 'stopped',
        start: load, pid: null, path: null, account: null, desc: desc.join(' '), microsoft: false, sub,
      };
    });
    return ok(rows, 'systemctl list-units');
  } catch (e) {
    return gone(e.message || String(e), IS_WIN ? 'Win32_Service' : 'systemctl');
  }
}

async function serviceControl(name, action) {
  const safeName = String(name || '').replace(/[^\w.@\-]/g, '');
  if (!safeName) return { ok: false, error: 'no service name' };
  if (!['start', 'stop', 'restart'].includes(action)) return { ok: false, error: `unknown action ${action}` };
  let r;
  if (IS_WIN) {
    const verb = action === 'start' ? 'Start-Service' : action === 'stop' ? 'Stop-Service -Force' : 'Restart-Service -Force';
    r = await sh(`${verb} -Name '${safeName}' -ErrorAction Stop; (Get-Service -Name '${safeName}').Status`, 60000);
  } else if (IS_MAC) {
    r = await sh(`launchctl ${action === 'stop' ? 'stop' : 'start'} ${safeName} && echo done`, 30000);
  } else {
    r = await sh(`systemctl ${action} ${safeName} 2>&1 || systemctl --user ${action} ${safeName} 2>&1; systemctl is-active ${safeName} 2>/dev/null || systemctl --user is-active ${safeName}`, 60000);
  }
  const last = r.text.trim().split(/\r?\n/).pop() || '';
  const success = r.code === 0 && !/denied|cannot|failed|error/i.test(last);
  return {
    ok: success, name: safeName, action, state: last,
    error: success ? null : (/denied|access|privilege|elevat/i.test(r.text) ? `${last} - this needs administrator rights (Run as admin in the top bar)` : last || `exit ${r.code}`),
  };
}

/* ------------------------------------------------------------- startup */

const RUN_KEYS = [
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKCU Run', 'user'],
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce', 'HKCU RunOnce', 'user'],
  ['HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM Run', 'machine'],
  ['HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM Run (32-bit)', 'machine'],
];

const STARTUP_WIN = `
$ErrorActionPreference='SilentlyContinue'
$rows = @()
${RUN_KEYS.map(([key, label, scope]) => `
$k = Get-Item -Path '${key}'
if ($k) { foreach ($n in $k.GetValueNames()) { if ($n) { $rows += [pscustomobject]@{ kind='registry'; source='${label}'; scope='${scope}'; key='${key}'; name=$n; command=[string]$k.GetValue($n); enabled=$true } } } }`).join('\n')}
foreach ($dir in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
  if ($dir -and (Test-Path $dir)) { Get-ChildItem -Path $dir -File | ForEach-Object {
    $rows += [pscustomobject]@{ kind='folder'; source=(Split-Path $dir -Leaf); scope= if ($dir -like '*ProgramData*') {'machine'} else {'user'}; key=$dir; name=$_.Name; command=$_.FullName; enabled=$true } } }
}
Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' } | ForEach-Object {
  $a = ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ; '
  $rows += [pscustomobject]@{ kind='task'; source='Task Scheduler'; scope='machine'; key=$_.TaskPath; name=$_.TaskName; command=$a; enabled=($_.State -ne 'Disabled'); state=[string]$_.State }
}
$rows | ConvertTo-Json -Compress -Depth 3
`;

function backupDir() {
  const d = path.join(ctx.userData(), 'startup-backups');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function disabledEntries() {
  const d = backupDir();
  const out = [];
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    try { out.push({ ...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')), backup: f }); } catch { /* skip */ }
  }
  return out;
}

async function startup() {
  try {
    if (IS_WIN) {
      const rows = await psJson(STARTUP_WIN, 60000);
      const disabled = disabledEntries().map((e) => ({
        kind: e.kind, source: e.source, scope: e.scope, key: e.key, name: e.name, command: e.command,
        enabled: false, backup: e.backup, disabledAt: e.at,
      }));
      return ok([...rows.map((r) => ({ ...r, backup: null })), ...disabled], 'Run keys · Startup folders · Task Scheduler', { elevated: await ctx.isElevated() });
    }
    const rows = [];
    if (IS_MAC) {
      for (const dir of [path.join(os.homedir(), 'Library', 'LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons']) {
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.plist')) continue;
          rows.push({ kind: 'launchd', source: path.basename(dir), scope: dir.startsWith('/Library') ? 'machine' : 'user', key: dir, name: f.replace(/\.plist$/, ''), command: path.join(dir, f), enabled: true, backup: null });
        }
      }
      return ok(rows, 'LaunchAgents · LaunchDaemons');
    }
    const auto = path.join(os.homedir(), '.config', 'autostart');
    if (fs.existsSync(auto)) {
      for (const f of fs.readdirSync(auto)) {
        if (!f.endsWith('.desktop')) continue;
        const text = fs.readFileSync(path.join(auto, f), 'utf8');
        const exec = (text.match(/^Exec=(.*)$/m) || [])[1] || '';
        const hidden = /^Hidden=true$/m.test(text) || /^X-GNOME-Autostart-enabled=false$/m.test(text);
        rows.push({ kind: 'autostart', source: '~/.config/autostart', scope: 'user', key: auto, name: f.replace(/\.desktop$/, ''), command: exec, enabled: !hidden, backup: null });
      }
    }
    const r = await sh('systemctl --user list-unit-files --type=service --state=enabled --no-pager --plain --no-legend', 15000);
    if (r.code === 0) {
      for (const l of r.text.split(/\r?\n/).filter(Boolean)) {
        const [unit] = l.trim().split(/\s+/);
        rows.push({ kind: 'systemd-user', source: 'systemctl --user', scope: 'user', key: 'user', name: unit, command: `systemctl --user start ${unit}`, enabled: true, backup: null });
      }
    }
    return ok(rows, 'autostart · systemd user units');
  } catch (e) {
    return gone(e.message || String(e), 'startup');
  }
}

/** Disable one startup entry. Registry values are backed up first. */
async function startupDisable(entry) {
  if (!entry || !entry.name) return { ok: false, error: 'no entry' };
  if (IS_WIN) {
    if (entry.kind === 'registry') {
      if (entry.scope === 'machine' && !(await ctx.isElevated())) return { ok: false, error: 'a machine-wide Run entry needs administrator rights' };
      const backup = { ...entry, at: new Date().toISOString() };
      const file = path.join(backupDir(), `${Date.now()}-${entry.name.replace(/[^\w.-]/g, '_')}.json`);
      fs.writeFileSync(file, JSON.stringify(backup, null, 2));
      const r = await sh(`Remove-ItemProperty -Path '${entry.key}' -Name '${entry.name.replace(/'/g, "''")}' -ErrorAction Stop; 'removed'`, 20000);
      if (r.code !== 0 || !/removed/.test(r.text)) { try { fs.unlinkSync(file); } catch { /* keep going */ } return { ok: false, error: r.text.trim().split(/\r?\n/).pop() }; }
      return { ok: true, backup: path.basename(file) };
    }
    if (entry.kind === 'task') {
      const r = await sh(`Disable-ScheduledTask -TaskPath '${entry.key}' -TaskName '${entry.name.replace(/'/g, "''")}' -ErrorAction Stop | Out-Null; 'disabled'`, 20000);
      return r.code === 0 && /disabled/.test(r.text) ? { ok: true } : { ok: false, error: r.text.trim().split(/\r?\n/).pop() };
    }
    if (entry.kind === 'folder') {
      // Move the shortcut into the backup folder rather than deleting it.
      const dest = path.join(backupDir(), `${Date.now()}-${entry.name}`);
      try { fs.renameSync(entry.command, dest); fs.writeFileSync(`${dest}.json`, JSON.stringify({ ...entry, moved: dest, at: new Date().toISOString() }, null, 2)); return { ok: true, backup: path.basename(dest) }; } catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: false, error: `cannot disable a ${entry.kind} entry` };
  }
  if (entry.kind === 'systemd-user') {
    const r = await sh(`systemctl --user disable ${entry.name} 2>&1 && echo disabled`, 20000);
    return r.code === 0 ? { ok: true } : { ok: false, error: r.text.trim() };
  }
  if (entry.kind === 'autostart') {
    const file = path.join(entry.key, `${entry.name}.desktop`);
    try {
      let text = fs.readFileSync(file, 'utf8');
      text = /^Hidden=/m.test(text) ? text.replace(/^Hidden=.*$/m, 'Hidden=true') : `${text.trimEnd()}\nHidden=true\n`;
      fs.writeFileSync(file, text); return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok: false, error: `cannot disable a ${entry.kind} entry on this platform` };
}

/** Put a disabled entry back. */
async function startupEnable(entry) {
  if (!entry || !entry.name) return { ok: false, error: 'no entry' };
  if (IS_WIN) {
    if (entry.kind === 'registry' && entry.backup) {
      const file = path.join(backupDir(), entry.backup);
      const b = JSON.parse(fs.readFileSync(file, 'utf8'));
      const r = await sh(`New-ItemProperty -Path '${b.key}' -Name '${b.name.replace(/'/g, "''")}' -Value '${String(b.command).replace(/'/g, "''")}' -PropertyType String -Force -ErrorAction Stop | Out-Null; 'restored'`, 20000);
      if (r.code === 0 && /restored/.test(r.text)) { fs.unlinkSync(file); return { ok: true }; }
      return { ok: false, error: r.text.trim().split(/\r?\n/).pop() };
    }
    if (entry.kind === 'task') {
      const r = await sh(`Enable-ScheduledTask -TaskPath '${entry.key}' -TaskName '${entry.name.replace(/'/g, "''")}' -ErrorAction Stop | Out-Null; 'enabled'`, 20000);
      return r.code === 0 && /enabled/.test(r.text) ? { ok: true } : { ok: false, error: r.text.trim().split(/\r?\n/).pop() };
    }
    if (entry.kind === 'folder' && entry.backup) {
      const src = path.join(backupDir(), entry.backup);
      const meta = `${src}.json`;
      try {
        const b = JSON.parse(fs.readFileSync(meta, 'utf8'));
        fs.renameSync(src, b.command); fs.unlinkSync(meta); return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: false, error: 'nothing to restore' };
  }
  if (entry.kind === 'systemd-user') {
    const r = await sh(`systemctl --user enable ${entry.name} 2>&1 && echo enabled`, 20000);
    return r.code === 0 ? { ok: true } : { ok: false, error: r.text.trim() };
  }
  if (entry.kind === 'autostart') {
    const file = path.join(entry.key, `${entry.name}.desktop`);
    try { fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^Hidden=.*$/m, 'Hidden=false')); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok: false, error: 'nothing to restore' };
}

/* ------------------------------------------------------------ listeners */

async function listeners() {
  try {
    if (IS_WIN) {
      const rows = await psJson(`Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress`, 30000);
      const udp = await psJson(`Get-NetUDPEndpoint | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress`, 30000).catch(() => []);
      const map = (r, proto) => ({ proto, address: r.LocalAddress, port: Number(r.LocalPort), pid: Number(r.OwningProcess) || null });
      return ok([...rows.map((r) => map(r, 'tcp')), ...udp.map((r) => map(r, 'udp'))], 'Get-NetTCPConnection · Get-NetUDPEndpoint');
    }
    if (IS_MAC) {
      const r = await sh('lsof -nP -iTCP -sTCP:LISTEN', 20000);
      const rows = r.text.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 9).map((p) => {
        const m = p[8].match(/^(.*):(\d+)$/);
        return { proto: 'tcp', address: m ? m[1] : p[8], port: m ? Number(m[2]) : null, pid: Number(p[1]), name: p[0] };
      });
      return ok(rows, 'lsof');
    }
    const r = await sh('ss -ltunpH', 20000);
    if (r.code !== 0) return procNetListeners();
    const rows = r.text.split(/\r?\n/).filter(Boolean).map((l) => {
      const p = l.trim().split(/\s+/);
      const addr = p[4] || ''; const i = addr.lastIndexOf(':');
      const pidm = l.match(/pid=(\d+)/);
      return { proto: p[0], address: addr.slice(0, i), port: Number(addr.slice(i + 1)), pid: pidm ? Number(pidm[1]) : null };
    });
    return ok(rows, 'ss -ltunp');
  } catch (e) {
    return gone(e.message || String(e), 'listeners');
  }
}

/* Linux without iproute2: read /proc/net/tcp{,6} and /proc/net/udp{,6}
   directly and map each socket inode to its owning pid through /proc/<pid>/fd. */
function procNetListeners() {
  const inodeOwner = new Map();
  try {
    for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      let fds = [];
      try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
      for (const fd of fds) {
        try { const m = fs.readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/); if (m) inodeOwner.set(m[1], Number(pid)); } catch { /* gone */ }
      }
    }
  } catch { /* no /proc */ }
  const rows = [];
  const hexAddr = (h, v6) => {
    const [addr, port] = h.split(':');
    if (!v6) { const b = Buffer.from(addr, 'hex'); return { address: `${b[3]}.${b[2]}.${b[1]}.${b[0]}`, port: parseInt(port, 16) }; }
    return { address: addr === '00000000000000000000000000000000' ? '::' : 'ipv6', port: parseInt(port, 16) };
  };
  for (const [file, proto, v6] of [['/proc/net/tcp', 'tcp', false], ['/proc/net/tcp6', 'tcp6', true], ['/proc/net/udp', 'udp', false], ['/proc/net/udp6', 'udp6', true]]) {
    let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/); if (p.length < 10) continue;
      const state = p[3];
      if (proto.startsWith('tcp') && state !== '0A') continue;        // 0A = LISTEN
      if (proto.startsWith('udp') && state !== '07') continue;        // 07 = unconnected (bound)
      const { address, port } = hexAddr(p[1], v6);
      rows.push({ proto, address, port, pid: inodeOwner.get(p[9]) || null });
    }
  }
  return rows.length ? ok(rows, '/proc/net') : gone('neither ss nor /proc/net gave a socket list', '/proc/net');
}

module.exports = {
  configure, processes, kill, services, serviceControl, startup, startupDisable, startupEnable, listeners,
  IS_WIN,
};
