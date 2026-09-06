'use strict';
/**
 * ProGramerly - live machine metrics
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * CPU load, CPU temperature, free space on every fixed and removable drive,
 * and live network throughput - with no native modules and no npm dependency.
 *
 * Windows pays a real cost to start PowerShell, so one long-lived PowerShell
 * process streams a JSON line per tick. macOS and Linux read /proc, df and
 * netstat directly, which is cheap enough to do per tick.
 */

const os = require('node:os');
const fs = require('node:fs');
const { spawn, exec } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let child = null;
let ticker = null;
let listeners = new Set();
let intervalSec = 2;

let prevCpu = null;
let prevNet = null;   // { at, rx, tx }
let latest = emptySnapshot();

/* ---------------------------------------------------------------- shape -- */

function emptySnapshot() {
  return {
    at: 0,
    cpu: { load: 0, cores: os.cpus().length, model: (os.cpus()[0] || {}).model || 'CPU', speedMHz: (os.cpus()[0] || {}).speed || 0 },
    temp: { c: null, source: null },
    mem: { total: os.totalmem(), free: os.freemem(), usedPct: 0 },
    disks: [],
    net: { rxBps: 0, txBps: 0, rxTotal: 0, txTotal: 0, iface: null },
    uptimeSec: Math.round(os.uptime()),
    host: os.hostname(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
  };
}

/* ------------------------------------------------------------------ cpu -- */

/** Aggregate CPU busy percentage between two calls. */
function cpuLoad() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  const snap = { idle, total };
  let load = 0;
  if (prevCpu) {
    const dt = total - prevCpu.total;
    const di = idle - prevCpu.idle;
    if (dt > 0) load = Math.max(0, Math.min(100, Math.round(((dt - di) / dt) * 1000) / 10));
  }
  prevCpu = snap;
  return load;
}

/* --------------------------------------------------------------- window -- */

function psScript(sec) {
  return [
    "$ErrorActionPreference='SilentlyContinue';",
    '$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new();',
    'while($true){',
    '  $t=$null; $src=$null;',
    '  try{ $tz=Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop;',
    '       if($tz){ $t=[math]::Round(((($tz|Measure-Object -Property CurrentTemperature -Maximum).Maximum)/10)-273.15,1); $src="ACPI" } }catch{}',
    '  if($null -eq $t){ try{ $s=Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop |',
    '       Where-Object { $_.SensorType -eq "Temperature" -and $_.Name -match "CPU" };',
    '       if($s){ $t=[math]::Round((($s|Measure-Object -Property Value -Maximum).Maximum),1); $src="LibreHardwareMonitor" } }catch{} }',
    '  if($null -eq $t){ try{ $s=Get-CimInstance -Namespace root/OpenHardwareMonitor -ClassName Sensor -ErrorAction Stop |',
    '       Where-Object { $_.SensorType -eq "Temperature" -and $_.Name -match "CPU" };',
    '       if($s){ $t=[math]::Round((($s|Measure-Object -Property Value -Maximum).Maximum),1); $src="OpenHardwareMonitor" } }catch{} }',
    '  $disks=@();',
    '  foreach($d in (Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2 or DriveType=3 or DriveType=4")){',
    '    if($d.Size -gt 0){ $disks+=[pscustomobject]@{ name=$d.DeviceID; label=$d.VolumeName; total=[int64]$d.Size; free=[int64]$d.FreeSpace; kind=[int]$d.DriveType; fs=$d.FileSystem } } }',
    '  $rx=0; $tx=0; $if=$null;',
    '  $st=Get-NetAdapterStatistics -ErrorAction SilentlyContinue;',
    '  if($st){ foreach($n in $st){ $rx+=[int64]$n.ReceivedBytes; $tx+=[int64]$n.SentBytes }; $if=($st | Sort-Object ReceivedBytes -Descending | Select-Object -First 1).Name }',
    '  else { foreach($n in (Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface)){ if($n.Name -notmatch "Loopback|isatap|Teredo"){ $rx+=[int64]$n.BytesReceivedPersec; $tx+=[int64]$n.BytesSentPersec } } }',
    '  $bat=$null; try{ $b=Get-CimInstance Win32_Battery -ErrorAction Stop; if($b){ $bat=[int]($b|Select-Object -First 1).EstimatedChargeRemaining } }catch{}',
    '  [pscustomobject]@{ temp=$t; tempSrc=$src; disks=$disks; rx=$rx; tx=$tx; iface=$if; battery=$bat } | ConvertTo-Json -Compress -Depth 4;',
    `  Start-Sleep -Seconds ${sec};`,
    '}',
  ].join(' ');
}

function startWindows() {
  child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', psScript(intervalSec),
  ], { windowsHide: true });

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const line of parts) {
      const s = line.trim();
      if (!s.startsWith('{')) continue;
      try { absorbWindows(JSON.parse(s)); } catch { /* partial frame */ }
    }
  });
  child.on('error', () => { child = null; });
  child.on('close', () => { child = null; });
}

function absorbWindows(raw) {
  const now = Date.now();
  const snap = emptySnapshot();
  snap.at = now;
  snap.cpu.load = cpuLoad();
  snap.temp = { c: typeof raw.temp === 'number' ? raw.temp : null, source: raw.tempSrc || null };
  snap.mem.free = os.freemem();
  snap.mem.total = os.totalmem();
  snap.mem.usedPct = Math.round(((snap.mem.total - snap.mem.free) / snap.mem.total) * 1000) / 10;
  snap.uptimeSec = Math.round(os.uptime());
  snap.battery = typeof raw.battery === 'number' ? raw.battery : null;

  const disksRaw = Array.isArray(raw.disks) ? raw.disks : (raw.disks ? [raw.disks] : []);
  snap.disks = disksRaw.map((d) => ({
    name: d.name,
    label: d.label || '',
    total: Number(d.total) || 0,
    free: Number(d.free) || 0,
    usedPct: d.total ? Math.round(((d.total - d.free) / d.total) * 1000) / 10 : 0,
    removable: d.kind === 2,
    fs: d.fs || '',
  })).filter((d) => d.total > 0);

  applyNet(Number(raw.rx) || 0, Number(raw.tx) || 0, raw.iface || null, snap, now);
  publish(snap);
}

/* ------------------------------------------------------------ unix side -- */

function shOut(cmd, timeout = 4000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(stdout || ''));
  });
}

async function unixDisks() {
  const out = await shOut('df -k -P 2>/dev/null');
  const rows = out.split('\n').slice(1).filter(Boolean);
  const seen = new Set();
  const disks = [];
  for (const row of rows) {
    const p = row.trim().split(/\s+/);
    if (p.length < 6) continue;
    const [fsName, blocks, , avail] = p;
    const mount = p.slice(5).join(' ');
    if (!/^\/dev\//.test(fsName)) continue;
    if (/^\/(System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)|dev|proc|sys|run)/.test(mount)) continue;
    if (seen.has(fsName)) continue;
    seen.add(fsName);
    const total = Number(blocks) * 1024;
    const free = Number(avail) * 1024;
    if (!total) continue;
    disks.push({
      name: mount,
      label: fsName.replace('/dev/', ''),
      total,
      free,
      usedPct: Math.round(((total - free) / total) * 1000) / 10,
      removable: false,
      fs: '',
    });
  }
  return disks;
}

async function unixNet() {
  if (IS_MAC) {
    const out = await shOut('netstat -ibn 2>/dev/null');
    const lines = out.split('\n').slice(1);
    const perIface = new Map();
    for (const l of lines) {
      const p = l.trim().split(/\s+/);
      if (p.length < 10) continue;
      const name = p[0];
      if (name === 'lo0' || perIface.has(name)) continue;
      const rx = Number(p[6]);
      const tx = Number(p[9]);
      if (Number.isFinite(rx) && Number.isFinite(tx)) perIface.set(name, { rx, tx });
    }
    let rx = 0; let tx = 0; let best = null; let bestRx = -1;
    for (const [name, v] of perIface) {
      rx += v.rx; tx += v.tx;
      if (v.rx > bestRx) { bestRx = v.rx; best = name; }
    }
    return { rx, tx, iface: best };
  }
  try {
    const txt = fs.readFileSync('/proc/net/dev', 'utf8');
    let rx = 0; let tx = 0; let best = null; let bestRx = -1;
    for (const line of txt.split('\n').slice(2)) {
      const [nameRaw, rest] = line.split(':');
      if (!rest) continue;
      const name = nameRaw.trim();
      if (name === 'lo') continue;
      const f = rest.trim().split(/\s+/);
      const r = Number(f[0]);
      const t = Number(f[8]);
      rx += r; tx += t;
      if (r > bestRx) { bestRx = r; best = name; }
    }
    return { rx, tx, iface: best };
  } catch { return { rx: 0, tx: 0, iface: null }; }
}

async function unixTemp() {
  if (IS_MAC) {
    const out = await shOut('osx-cpu-temp 2>/dev/null');
    const m = /([\d.]+)\s*°?C/.exec(out);
    if (m) return { c: Number(m[1]), source: 'osx-cpu-temp' };
    return { c: null, source: null };
  }
  try {
    const zones = fs.readdirSync('/sys/class/thermal').filter((d) => d.startsWith('thermal_zone'));
    let best = null;
    for (const z of zones) {
      const type = fs.readFileSync(`/sys/class/thermal/${z}/type`, 'utf8').trim();
      const val = Number(fs.readFileSync(`/sys/class/thermal/${z}/temp`, 'utf8').trim()) / 1000;
      if (!Number.isFinite(val) || val <= 0 || val > 150) continue;
      if (/x86_pkg_temp|cpu|coretemp|k10temp|soc/i.test(type) || best === null) {
        if (best === null || val > best.c) best = { c: Math.round(val * 10) / 10, source: type };
      }
    }
    return best || { c: null, source: null };
  } catch { return { c: null, source: null }; }
}

async function unixTick() {
  const now = Date.now();
  const snap = emptySnapshot();
  snap.at = now;
  snap.cpu.load = cpuLoad();
  const [temp, disks, netRaw] = await Promise.all([unixTemp(), unixDisks(), unixNet()]);
  snap.temp = temp;
  snap.disks = disks;
  snap.mem.free = os.freemem();
  snap.mem.total = os.totalmem();
  snap.mem.usedPct = Math.round(((snap.mem.total - snap.mem.free) / snap.mem.total) * 1000) / 10;
  snap.uptimeSec = Math.round(os.uptime());
  applyNet(netRaw.rx, netRaw.tx, netRaw.iface, snap, now);
  publish(snap);
}

/* -------------------------------------------------------------- shared -- */

function applyNet(rx, tx, iface, snap, now) {
  snap.net.rxTotal = rx;
  snap.net.txTotal = tx;
  snap.net.iface = iface;
  if (prevNet && now > prevNet.at) {
    const dt = (now - prevNet.at) / 1000;
    // counters reset when an adapter restarts - treat a negative delta as zero
    snap.net.rxBps = Math.max(0, Math.round((rx - prevNet.rx) / dt));
    snap.net.txBps = Math.max(0, Math.round((tx - prevNet.tx) / dt));
  }
  prevNet = { at: now, rx, tx };
}

function publish(snap) {
  latest = snap;
  for (const fn of listeners) {
    try { fn(snap); } catch { /* a dead window */ }
  }
}

/* ----------------------------------------------------------- formatting -- */

function bytes(n, digits = 1) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  const v = n / (1024 ** i);
  return `${v.toFixed(i === 0 ? 0 : (v >= 100 ? 0 : digits))} ${u[i]}`;
}

function bits(bytesPerSec) {
  const b = bytesPerSec * 8;
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} Gb/s`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} Mb/s`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} kb/s`;
  return `${b.toFixed(0)} b/s`;
}

function shortSize(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1)}T`;
  if (n >= 1024 ** 3) return `${Math.round(n / 1024 ** 3)}G`;
  return `${Math.round(n / 1024 ** 2)}M`;
}

/** Compact tray tooltip. Windows truncates at 127 characters, so stay under it. */
function tooltip(extra = {}) {
  const s = latest;
  const t = s.temp.c === null ? '--' : `${Math.round(s.temp.c)}°C`;
  const drives = s.disks
    .slice(0, 4)
    .map((d) => `${(d.name || '').replace(/[:\\/]+$/, '').slice(0, 6)} ${shortSize(d.free)}`)
    .join('  ');
  const more = s.disks.length > 4 ? ` +${s.disks.length - 4}` : '';
  const ping = extra.pingMs ? `  ping ${Math.round(extra.pingMs)}ms` : '';
  const line = [
    `ProGramerly  CPU ${s.cpu.load}%  ${t}  RAM ${s.mem.usedPct}%`,
    `${drives}${more} free`,
    `↓ ${bits(s.net.rxBps)}  ↑ ${bits(s.net.txBps)}${ping}`,
  ].join('\n');
  return line.length > 126 ? `${line.slice(0, 123)}...` : line;
}

/* ------------------------------------------------------------ lifecycle -- */

function start(sec) {
  stop();
  intervalSec = Math.max(1, Math.min(60, Number(sec) || 2));
  cpuLoad(); // prime the delta
  if (IS_WIN) {
    startWindows();
    // A safety net: if PowerShell never comes up, still publish CPU/RAM.
    ticker = setInterval(() => {
      if (!child) {
        const snap = emptySnapshot();
        snap.at = Date.now();
        snap.cpu.load = cpuLoad();
        snap.mem.free = os.freemem();
        snap.mem.usedPct = Math.round(((snap.mem.total - snap.mem.free) / snap.mem.total) * 1000) / 10;
        publish(snap);
      }
    }, intervalSec * 1000);
  } else {
    unixTick();
    ticker = setInterval(unixTick, intervalSec * 1000);
  }
  if (ticker && ticker.unref) ticker.unref();
}

function stop() {
  if (ticker) { clearInterval(ticker); ticker = null; }
  if (child) { try { child.kill(); } catch { /* gone */ } child = null; }
}

function subscribe(fn) {
  listeners.add(fn);
  if (latest.at) fn(latest);
  return () => listeners.delete(fn);
}

function snapshot() { return latest; }

module.exports = { start, stop, subscribe, snapshot, tooltip, bytes, bits, shortSize };
