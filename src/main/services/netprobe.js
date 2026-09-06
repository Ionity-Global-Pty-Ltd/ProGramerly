'use strict';
/**
 * ProGramerly - global network probe
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * A five-second sweep per region against Cloudflare and Google endpoints, plus
 * a Cloudflare download/upload run.
 *
 * Honest about what it measures: this is TCP-handshake round trip to a real
 * service port, not ICMP, and Cloudflare/Google are anycast - a "Brazil" target
 * answers from the closest edge that serves that name. That still tells you
 * exactly what an app on this machine will feel when it talks to that service,
 * which is the number that matters.
 */

const { tcpPing, getBuffer, getText } = require('./http');
const settings = require('./settings');

const REGIONS = [
  {
    id: 'br',
    label: 'Brazil',
    cc: 'BR',
    targets: [
      { host: 'www.cloudflare.com', port: 443, provider: 'Cloudflare' },
      { host: 'www.google.com.br', port: 443, provider: 'Google' },
      { host: 'www.globo.com', port: 443, provider: 'Regional' },
    ],
  },
  {
    id: 'us',
    label: 'United States',
    cc: 'US',
    targets: [
      { host: 'www.cloudflare.com', port: 443, provider: 'Cloudflare' },
      { host: 'www.google.com', port: 443, provider: 'Google' },
      { host: 'speedtest-nyc1.digitalocean.com', port: 443, provider: 'Regional' },
    ],
  },
  {
    id: 'uk',
    label: 'United Kingdom',
    cc: 'GB',
    targets: [
      { host: 'one.one.one.one', port: 443, provider: 'Cloudflare' },
      { host: 'www.google.co.uk', port: 443, provider: 'Google' },
      { host: 'speedtest-lon1.digitalocean.com', port: 443, provider: 'Regional' },
    ],
  },
  {
    id: 'cn',
    label: 'China',
    cc: 'CN',
    targets: [
      { host: 'www.baidu.com', port: 443, provider: 'Regional' },
      { host: 'www.google.cn', port: 443, provider: 'Google' },
      { host: 'www.aliyun.com', port: 443, provider: 'Regional' },
    ],
  },
  {
    id: 'in',
    label: 'India',
    cc: 'IN',
    targets: [
      { host: 'www.google.co.in', port: 443, provider: 'Google' },
      { host: 'speedtest-blr1.digitalocean.com', port: 443, provider: 'Regional' },
      { host: 'www.cloudflare.com', port: 443, provider: 'Cloudflare' },
    ],
  },
  {
    id: 'nz',
    label: 'New Zealand',
    cc: 'NZ',
    targets: [
      { host: 'www.google.co.nz', port: 443, provider: 'Google' },
      { host: 'www.nzherald.co.nz', port: 443, provider: 'Regional' },
      { host: 'speedtest-syd1.digitalocean.com', port: 443, provider: 'Regional' },
    ],
  },
  {
    id: 'za',
    label: 'South Africa',
    cc: 'ZA',
    targets: [
      { host: 'www.google.co.za', port: 443, provider: 'Google' },
      { host: 'www.news24.com', port: 443, provider: 'Regional' },
      { host: 'one.one.one.one', port: 443, provider: 'Cloudflare' },
    ],
  },
];

let running = false;
let cancelled = false;
let lastSweep = null;
let lastPing = null;

/* ------------------------------------------------------------------ geo -- */

/** Where this machine actually sits, from Cloudflare's edge trace. */
async function geo() {
  try {
    const txt = await getText('https://www.cloudflare.com/cdn-cgi/trace', { timeoutMs: 8000 });
    const kv = Object.fromEntries(txt.split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }));
    return {
      ok: true,
      ip: kv.ip || null,
      country: (kv.loc || '').toUpperCase() || null,
      colo: kv.colo || null,
      http: kv.http || null,
      tls: kv.tls || null,
      warp: kv.warp || null,
      at: Date.now(),
    };
  } catch (err) {
    return { ok: false, error: err.message, at: Date.now() };
  }
}

/* ---------------------------------------------------------------- stats -- */

function summarise(samples) {
  const good = samples.filter((s) => typeof s === 'number');
  const loss = samples.length ? Math.round(((samples.length - good.length) / samples.length) * 1000) / 10 : 100;
  if (!good.length) return { sent: samples.length, recv: 0, loss: 100, min: null, avg: null, max: null, jitter: null };
  good.sort((a, b) => a - b);
  const avg = good.reduce((a, b) => a + b, 0) / good.length;
  let jitter = 0;
  for (let i = 1; i < good.length; i += 1) jitter += Math.abs(good[i] - good[i - 1]);
  jitter = good.length > 1 ? jitter / (good.length - 1) : 0;
  return {
    sent: samples.length,
    recv: good.length,
    loss,
    min: Math.round(good[0] * 100) / 100,
    avg: Math.round(avg * 100) / 100,
    max: Math.round(good[good.length - 1] * 100) / 100,
    jitter: Math.round(jitter * 100) / 100,
    p95: Math.round(good[Math.min(good.length - 1, Math.floor(good.length * 0.95))] * 100) / 100,
  };
}

/**
 * A target that never answers at all is blocked or unresolvable from here -
 * that is not packet loss, and letting it drag the grade down would call a
 * 20 ms region "poor". Loss is measured only across targets that answered.
 */
function grade(avg, loss, reachable) {
  if (avg === null) return 'down';
  if (!reachable) return 'down';
  if (loss > 10) return 'poor';
  if (avg < 40) return 'excellent';
  if (avg < 100) return 'good';
  if (avg < 200) return 'fair';
  return 'poor';
}

/* ---------------------------------------------------------------- probe -- */

/**
 * Hammer one region's targets round-robin for `seconds`, then summarise.
 */
async function probeRegion(region, seconds, onSample = () => {}) {
  const deadline = Date.now() + seconds * 1000;
  const byTarget = new Map(region.targets.map((t) => [t.host, []]));
  let i = 0;
  while (Date.now() < deadline && !cancelled) {
    const target = region.targets[i % region.targets.length];
    i += 1;
    // eslint-disable-next-line no-await-in-loop
    const res = await tcpPing(target.host, target.port, Math.min(3000, Math.max(600, deadline - Date.now())));
    const list = byTarget.get(target.host);
    list.push(typeof res.ms === 'number' ? res.ms : null);
    onSample({ region: region.id, host: target.host, ms: res.ms ?? null, error: res.error || null });
    // A short breather keeps this from looking like a flood to the far end.
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 120); });
  }

  const targets = region.targets.map((t) => ({
    host: t.host,
    provider: t.provider,
    ...summarise(byTarget.get(t.host) || []),
  }));
  const reachable = targets.filter((t) => t.avg !== null);
  const best = reachable.length ? reachable.reduce((a, b) => (a.avg <= b.avg ? a : b)) : null;
  const avg = reachable.length ? Math.round((reachable.reduce((s, t) => s + t.avg, 0) / reachable.length) * 100) / 100 : null;
  const loss = reachable.length
    ? Math.round((reachable.reduce((s, t) => s + t.loss, 0) / reachable.length) * 10) / 10
    : 100;
  const jitter = best ? best.jitter : null;

  return {
    id: region.id,
    label: region.label,
    cc: region.cc,
    seconds,
    targets,
    best: best ? { host: best.host, avg: best.avg, provider: best.provider } : null,
    avg,
    loss,
    jitter,
    reachable: reachable.length,
    total: targets.length,
    grade: grade(avg, loss, reachable.length),
    at: Date.now(),
  };
}

/**
 * Full sweep: every region in the list, five seconds each by default, plus the
 * local region resolved from the Cloudflare edge trace when it is not already
 * one of the seven.
 */
async function sweep(onProgress = () => {}) {
  if (running) return { ok: false, error: 'a sweep is already running' };
  running = true;
  cancelled = false;
  const seconds = Math.max(1, Math.min(30, Number(settings.get('probeSeconds')) || 5));
  const where = await geo();
  onProgress({ phase: 'geo', geo: where });

  const list = [...REGIONS];
  if (where.ok && where.country && !list.some((r) => r.cc === where.country)) {
    list.push({
      id: 'local',
      label: `Local (${where.country}${where.colo ? ` · ${where.colo}` : ''})`,
      cc: where.country,
      targets: [
        { host: 'one.one.one.one', port: 443, provider: 'Cloudflare' },
        { host: 'www.google.com', port: 443, provider: 'Google' },
        { host: 'speed.cloudflare.com', port: 443, provider: 'Cloudflare' },
      ],
    });
  } else if (where.ok && where.country) {
    // Mark the region we are actually sitting in.
    const own = list.find((r) => r.cc === where.country);
    if (own) own.isLocal = true;
  }

  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    if (cancelled) break;
    const region = list[i];
    onProgress({ phase: 'region:start', region: region.id, label: region.label, index: i, total: list.length });
    // eslint-disable-next-line no-await-in-loop
    const res = await probeRegion(region, seconds, (s) => onProgress({ phase: 'sample', ...s }));
    res.isLocal = Boolean(region.isLocal || region.id === 'local');
    results.push(res);
    onProgress({ phase: 'region:done', index: i, total: list.length, result: res });
  }

  lastSweep = {
    at: Date.now(),
    geo: where,
    seconds,
    regions: results,
    cancelled,
    note: 'TCP handshake round trip to each service port. Cloudflare and Google are anycast, so a country target answers from the nearest edge that serves it.',
  };
  running = false;
  onProgress({ phase: 'done', sweep: lastSweep });
  return { ok: true, sweep: lastSweep };
}

function cancel() { cancelled = true; return true; }

/** One quick ping used by the tray tooltip. */
async function quickPing() {
  const res = await tcpPing('one.one.one.one', 443, 2500);
  lastPing = typeof res.ms === 'number' ? res.ms : null;
  return lastPing;
}

/* ------------------------------------------------------------ speedtest -- */

async function speedTest(onProgress = () => {}) {
  const bytesWanted = Math.max(2 * 1024 * 1024, Number(settings.get('speedTestBytes')) || 25 * 1024 * 1024);
  const out = { at: Date.now(), downMbps: null, upMbps: null, latencyMs: null, jitterMs: null, server: null };

  // Latency + jitter first: 12 handshakes to the speed endpoint.
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await tcpPing('speed.cloudflare.com', 443, 3000);
    samples.push(typeof r.ms === 'number' ? r.ms : null);
    onProgress({ phase: 'latency', pct: Math.round(((i + 1) / 12) * 100) });
  }
  const lat = summarise(samples);
  out.latencyMs = lat.min;
  out.jitterMs = lat.jitter;

  try {
    const where = await geo();
    out.server = where.colo ? `Cloudflare ${where.colo}` : 'Cloudflare';
  } catch { out.server = 'Cloudflare'; }

  // Download.
  try {
    onProgress({ phase: 'download', pct: 0 });
    const t0 = process.hrtime.bigint();
    const res = await getBuffer(`https://speed.cloudflare.com/__down?bytes=${bytesWanted}`, { timeoutMs: 120000 });
    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    if (res.status === 200 && secs > 0) {
      out.downMbps = Math.round(((res.body.length * 8) / secs / 1e6) * 100) / 100;
      out.downBytes = res.body.length;
      out.downSecs = Math.round(secs * 100) / 100;
    }
    onProgress({ phase: 'download', pct: 100, mbps: out.downMbps });
  } catch (err) { out.downError = err.message; }

  // Upload.
  try {
    onProgress({ phase: 'upload', pct: 0 });
    const payload = Buffer.alloc(Math.min(bytesWanted, 12 * 1024 * 1024), 0x41);
    const t0 = process.hrtime.bigint();
    const res = await getBuffer('https://speed.cloudflare.com/__up', {
      method: 'POST',
      body: payload,
      timeoutMs: 120000,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(payload.length) },
    });
    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    if (res.status >= 200 && res.status < 400 && secs > 0) {
      out.upMbps = Math.round(((payload.length * 8) / secs / 1e6) * 100) / 100;
      out.upBytes = payload.length;
      out.upSecs = Math.round(secs * 100) / 100;
    }
    onProgress({ phase: 'upload', pct: 100, mbps: out.upMbps });
  } catch (err) { out.upError = err.message; }

  onProgress({ phase: 'done', result: out });
  return out;
}

module.exports = { REGIONS, geo, sweep, cancel, probeRegion, speedTest, quickPing, lastSweepRef: () => lastSweep, lastPingRef: () => lastPing };
