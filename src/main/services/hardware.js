'use strict';
/**
 * ProGramerly - hardware
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Fans, temperatures, memory pressure - and an honest account of what a
 * user-space application can and cannot do to any of them.
 *
 * WHAT IS REAL HERE
 *
 *  - Sensor telemetry (temperatures, fan RPM, controller duty, loads,
 *    voltages, power) is read live from LibreHardwareMonitor's WMI namespace
 *    when LHM is running. Those are the actual chip readings.
 *  - Memory: working sets really are trimmed through EmptyWorkingSet, and the
 *    standby list really is purged through NtSetSystemInformation - the same
 *    call RAMMap makes. Free memory is measured before and after, so the
 *    number reported is measured, not claimed.
 *  - The temporary cache really is deleted, and nothing else is touched.
 *
 * WHAT IS NOT, AND WHY
 *
 *  Setting a fan curve means writing to the Super IO or embedded controller.
 *  On Windows that needs a signed kernel-mode driver - which is exactly what
 *  FanControl and LibreHardwareMonitor ship and why they exist. ProGramerly
 *  does not ship a kernel driver, and an application that claimed to set your
 *  fan curve without one would be lying to you. So this detects those tools,
 *  installs them on request, launches them, and reads their sensors. The
 *  curve is set in the tool that owns the driver. That is the correct
 *  division of labour, not a limitation being dressed up.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { run } = require('../installer/runner');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const home = os.homedir();
const PF = process.env.ProgramFiles || 'C:\\Program Files';
const LOCAL = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

function firstExisting(list) {
  for (const p of list) { try { if (p && fs.existsSync(p)) return p; } catch { /* next */ } }
  return '';
}

async function ps(script, timeoutMs = 30000) {
  const { code, output } = await run(script, { timeoutMs });
  return { ok: code === 0, text: String(output || '').trim() };
}

/* --------------------------------------------------------------- sensors */

const SENSOR_NS = ['root/LibreHardwareMonitor', 'root/OpenHardwareMonitor'];

/**
 * Live sensors, grouped by hardware. Requires LibreHardwareMonitor (or the
 * older OpenHardwareMonitor) to be running - it is the thing holding the
 * driver that can read the chips.
 */
async function sensors() {
  if (!IS_WIN) {
    if (IS_MAC) {
      // macOS exposes nothing comparable without a kext; powermetrics needs root.
      return { available: false, reason: 'macOS has no user-space sensor API; a signed kernel extension would be required.', groups: [] };
    }
    return { available: false, reason: 'Sensor telemetry is implemented for Windows via LibreHardwareMonitor.', groups: [] };
  }

  for (const ns of SENSOR_NS) {
    // eslint-disable-next-line no-await-in-loop
    const res = await ps(
      `$ErrorActionPreference='Stop'; `
      + `Get-CimInstance -Namespace '${ns}' -ClassName Sensor | `
      + 'Select-Object Name,SensorType,Value,Identifier,Parent | ConvertTo-Json -Compress -Depth 3',
      25000,
    );
    if (!res.ok || !res.text || res.text === 'null') continue;
    let rows;
    try { rows = JSON.parse(res.text); } catch { continue; }
    if (!Array.isArray(rows)) rows = [rows];
    if (!rows.length) continue;

    // Parent identifiers look like /amdcpu/0 or /nvidiagpu/0 - use them to group.
    const groups = new Map();
    for (const r of rows) {
      const key = String(r.Parent || 'unknown');
      if (!groups.has(key)) groups.set(key, { id: key, label: prettyParent(key), sensors: [] });
      groups.get(key).sensors.push({
        name: r.Name,
        type: r.SensorType,
        value: typeof r.Value === 'number' ? Math.round(r.Value * 10) / 10 : null,
        unit: unitFor(r.SensorType),
        id: r.Identifier,
      });
    }
    const list = [...groups.values()]
      .map((g) => ({ ...g, sensors: g.sensors.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { available: true, source: ns.split('/').pop(), groups: list, count: rows.length };
  }

  return {
    available: false,
    reason: 'LibreHardwareMonitor is not running. It is what holds the driver that can read the chips - install it below, start it, then refresh.',
    groups: [],
  };
}

function prettyParent(id) {
  const s = String(id).replace(/^\//, '').split('/');
  const map = {
    amdcpu: 'AMD CPU', intelcpu: 'Intel CPU', nvidiagpu: 'NVIDIA GPU', amdgpu: 'AMD GPU',
    intelgpu: 'Intel GPU', lpc: 'Motherboard (Super IO)', ram: 'Memory', hdd: 'Storage',
    nvme: 'NVMe', nic: 'Network', battery: 'Battery', psu: 'Power supply',
  };
  const head = map[s[0]] || (s[0] ? s[0].toUpperCase() : 'Unknown');
  return s.length > 1 && /^\d+$/.test(s[1]) && s[1] !== '0' ? `${head} #${Number(s[1]) + 1}` : head;
}

function unitFor(type) {
  return ({
    Temperature: '°C', Fan: 'RPM', Control: '%', Load: '%', Voltage: 'V',
    Power: 'W', Clock: 'MHz', Data: 'GB', SmallData: 'MB', Throughput: 'B/s', Level: '%',
  })[type] || '';
}

/* ------------------------------------------------- fan control handoff -- */

const FAN_TOOLS = [
  {
    id: 'fancontrol',
    name: 'FanControl',
    what: 'Curves for every fan header, GPU and AIO pump. The one most people end up using.',
    winget: 'Rem0o.FanControl',
    find: () => firstExisting([
      path.join(PF, 'FanControl', 'FanControl.exe'),
      path.join(LOCAL, 'FanControl', 'FanControl.exe'),
      path.join(LOCAL, 'Programs', 'FanControl', 'FanControl.exe'),
      path.join(home, 'FanControl', 'FanControl.exe'),
    ]),
    proc: 'FanControl',
  },
  {
    id: 'lhm',
    name: 'LibreHardwareMonitor',
    what: 'The sensor source above. Run it and every reading on this page fills in.',
    winget: 'LibreHardwareMonitor.LibreHardwareMonitor',
    find: () => firstExisting([
      path.join(PF, 'LibreHardwareMonitor', 'LibreHardwareMonitor.exe'),
      path.join(LOCAL, 'Programs', 'LibreHardwareMonitor', 'LibreHardwareMonitor.exe'),
      path.join(home, 'LibreHardwareMonitor', 'LibreHardwareMonitor.exe'),
    ]),
    proc: 'LibreHardwareMonitor',
  },
  {
    id: 'openrgb',
    name: 'OpenRGB',
    what: 'The lighting server the RGB panel talks to. Enable its SDK server in Settings.',
    winget: 'CalcProgrammer1.OpenRGB',
    find: () => firstExisting([
      path.join(PF, 'OpenRGB', 'OpenRGB.exe'),
      path.join(LOCAL, 'Programs', 'OpenRGB', 'OpenRGB.exe'),
      path.join(home, 'OpenRGB', 'OpenRGB.exe'),
    ]),
    proc: 'OpenRGB',
  },
];

async function toolStatus() {
  if (!IS_WIN) return { platform: process.platform, tools: [] };
  const running = await ps(
    "(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName) -join ','", 20000,
  );
  const names = new Set(String(running.text || '').split(',').map((s) => s.trim().toLowerCase()));
  return {
    platform: 'win32',
    tools: FAN_TOOLS.map((t) => {
      const exe = t.find();
      return {
        id: t.id, name: t.name, what: t.what, winget: t.winget,
        installed: Boolean(exe), path: exe,
        running: names.has(t.proc.toLowerCase()),
      };
    }),
  };
}

async function installTool(id, log = () => {}) {
  const t = FAN_TOOLS.find((x) => x.id === id);
  if (!t) return { ok: false, error: 'unknown tool' };
  if (!IS_WIN) return { ok: false, error: 'Windows only' };
  log(`winget install --id ${t.winget}`);
  const { code, output } = await run(
    `winget install --id ${t.winget} --exact --silent --disable-interactivity `
    + '--accept-package-agreements --accept-source-agreements',
    { onLine: (l) => log(`  ${l}`), timeoutMs: 15 * 60 * 1000 },
  );
  const ok = code === 0 || /already installed/i.test(output || '');
  log(ok ? `${t.name} installed.` : `winget returned ${code}.`);
  return { ok, detail: ok ? `${t.name} installed` : `winget exit ${code}` };
}

function launchTool(id) {
  const t = FAN_TOOLS.find((x) => x.id === id);
  if (!t) return { ok: false, error: 'unknown tool' };
  const exe = t.find();
  if (!exe) return { ok: false, error: `${t.name} is not installed` };
  try {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, detail: `${t.name} launched` };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ---------------------------------------------------------- memory ------ */

/*
 * EmptyWorkingSet asks Windows to page a process's working set out to the
 * standby list. It is documented, it needs no driver, and it is what every
 * "RAM cleaner" is doing underneath - the difference is that this one tells
 * you it moved pages to standby rather than pretending it freed them.
 */
const TRIM_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Name PGMem -Namespace PG -MemberDefinition @'
[DllImport("psapi.dll", SetLastError=true)]
public static extern bool EmptyWorkingSet(IntPtr hProcess);
'@
$os = Get-CimInstance Win32_OperatingSystem
$before = [int64]$os.FreePhysicalMemory * 1024
$trimmed = 0; $refused = 0
foreach ($p in Get-Process) {
  try { if ([PG.PGMem]::EmptyWorkingSet($p.Handle)) { $trimmed++ } else { $refused++ } } catch { $refused++ }
}
Start-Sleep -Milliseconds 700
$os2 = Get-CimInstance Win32_OperatingSystem
$after = [int64]$os2.FreePhysicalMemory * 1024
Write-Output "$before|$after|$trimmed|$refused"
`;

/*
 * Purging the standby list is what actually returns cached pages to the free
 * list. It needs SeProfileSingleProcessPrivilege and an administrator token;
 * without them the call returns STATUS_PRIVILEGE_NOT_HELD and we say so.
 */
const STANDBY_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Name PGStandby -Namespace PG -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
[StructLayout(LayoutKind.Sequential)] public struct TP { public uint Count; public LUID Luid; public uint Attr; }
[DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr h, uint acc, out IntPtr tok);
[DllImport("advapi32.dll", SetLastError=true)] public static extern bool LookupPrivilegeValue(string sys, string name, out LUID luid);
[DllImport("advapi32.dll", SetLastError=true)] public static extern bool AdjustTokenPrivileges(IntPtr tok, bool dis, ref TP np, uint len, IntPtr prev, IntPtr rl);
[DllImport("ntdll.dll")] public static extern int NtSetSystemInformation(int cls, IntPtr info, int len);
[DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
'@
$tok = [IntPtr]::Zero
[void][PG.PGStandby]::OpenProcessToken([PG.PGStandby]::GetCurrentProcess(), 0x20 -bor 0x8, [ref]$tok)
$luid = New-Object PG.PGStandby+LUID
[void][PG.PGStandby]::LookupPrivilegeValue($null, 'SeProfileSingleProcessPrivilege', [ref]$luid)
$tp = New-Object PG.PGStandby+TP
$tp.Count = 1; $tp.Luid = $luid; $tp.Attr = 2
[void][PG.PGStandby]::AdjustTokenPrivileges($tok, $false, [ref]$tp, 0, [IntPtr]::Zero, [IntPtr]::Zero)
$os = Get-CimInstance Win32_OperatingSystem
$before = [int64]$os.FreePhysicalMemory * 1024
$buf = [Runtime.InteropServices.Marshal]::AllocHGlobal(4)
[Runtime.InteropServices.Marshal]::WriteInt32($buf, 4)     # MemoryPurgeStandbyList
$rc = [PG.PGStandby]::NtSetSystemInformation(0x50, $buf, 4) # SystemMemoryListInformation
[Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
Start-Sleep -Milliseconds 700
$os2 = Get-CimInstance Win32_OperatingSystem
$after = [int64]$os2.FreePhysicalMemory * 1024
Write-Output "$before|$after|$rc"
`;

function humanBytes(b) {
  const GB = 1024 ** 3; const MB = 1024 ** 2;
  if (!Number.isFinite(b)) return '?';
  if (Math.abs(b) >= GB) return `${(b / GB).toFixed(2)} GB`;
  return `${(b / MB).toFixed(0)} MB`;
}

async function memoryState() {
  return {
    total: os.totalmem(), totalHuman: humanBytes(os.totalmem()),
    free: os.freemem(), freeHuman: humanBytes(os.freemem()),
    usedPct: Math.round((1 - os.freemem() / os.totalmem()) * 100),
  };
}

/** Trim every reachable process's working set. Measured, not claimed. */
async function ramFlush(log = () => {}) {
  if (IS_MAC) {
    log('macOS: `sudo purge` is the equivalent, and it needs your password in a terminal.');
    log('Nothing was run. Opening a terminal and typing it is one command.');
    return { ok: false, detail: 'macOS needs `sudo purge`, which must be run by you' };
  }
  if (!IS_WIN) return { ok: false, detail: 'Windows only' };

  log('Trimming working sets (EmptyWorkingSet on every reachable process)...');
  const res = await ps(TRIM_SCRIPT, 120000);
  const [b, a, trimmed, refused] = String(res.text).split('|').map((x) => Number(x));
  if (!Number.isFinite(b) || !Number.isFinite(a)) {
    log('the trim did not report back cleanly.');
    return { ok: false, detail: 'no measurement returned' };
  }
  const delta = a - b;
  log(`  ${trimmed} process(es) trimmed, ${refused} refused (protected or already minimal)`);
  log(`  free memory ${humanBytes(b)} -> ${humanBytes(a)}  (${delta >= 0 ? '+' : ''}${humanBytes(delta)})`);
  log('Pages went to the standby list, where Windows can still reuse them.');
  log('"Purge standby list" below is what actually returns them to free.');
  return { ok: true, before: b, after: a, delta, deltaHuman: humanBytes(delta), trimmed, refused };
}

/** Return standby pages to the free list. Administrator only. */
async function purgeStandby(log = () => {}) {
  if (!IS_WIN) return { ok: false, detail: 'Windows only' };
  log('Purging the standby list (NtSetSystemInformation, the RAMMap call)...');
  const res = await ps(STANDBY_SCRIPT, 90000);
  const [b, a, rc] = String(res.text).split('|').map((x) => Number(x));
  if (!Number.isFinite(b)) {
    log('the call could not be made - almost always missing administrator rights.');
    return { ok: false, detail: 'needs an elevated ProGramerly' };
  }
  if (rc !== 0) {
    log(`NtSetSystemInformation returned 0x${(rc >>> 0).toString(16)} - privilege not held.`);
    log('Restart ProGramerly as administrator and try again.');
    return { ok: false, detail: 'privilege not held - restart as administrator' };
  }
  const delta = a - b;
  log(`  free memory ${humanBytes(b)} -> ${humanBytes(a)}  (${delta >= 0 ? '+' : ''}${humanBytes(delta)})`);
  return { ok: true, before: b, after: a, delta, deltaHuman: humanBytes(delta) };
}

/* ------------------------------------------------------ temp cache only -- */

/**
 * The temporary cache and nothing else. Not the browser cache, not the
 * package caches, not anything in a project folder - the OS temp directory,
 * and only files it can actually let go of.
 */
async function clearTempCache(log = () => {}) {
  const dir = os.tmpdir();
  log(`clearing ${dir}`);
  let removed = 0;
  let bytes = 0;
  let locked = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {
    return { ok: false, detail: `cannot read ${dir}: ${e.message}` };
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      const st = fs.statSync(full);
      const size = e.isDirectory() ? dirBytes(full) : st.size;
      fs.rmSync(full, { recursive: true, force: true });
      // rmSync is not atomic across a tree; only count it if it really went.
      if (!fs.existsSync(full)) { removed += 1; bytes += size; } else locked += 1;
    } catch { locked += 1; }
  }
  log(`  removed ${removed} item(s), ${humanBytes(bytes)} reclaimed`);
  if (locked) log(`  ${locked} item(s) are in use by a running program and were left alone`);
  return { ok: true, removed, locked, bytes, bytesHuman: humanBytes(bytes), dir };
}

function dirBytes(dir) {
  let total = 0;
  const stack = [dir];
  let guard = 0;
  while (stack.length && guard < 20000) {
    const cur = stack.pop();
    let list;
    try { list = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      guard += 1;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else { try { total += fs.statSync(full).size; } catch { /* gone */ } }
    }
  }
  return total;
}

module.exports = {
  sensors, toolStatus, installTool, launchTool,
  memoryState, ramFlush, purgeStandby, clearTempCache, humanBytes,
};
