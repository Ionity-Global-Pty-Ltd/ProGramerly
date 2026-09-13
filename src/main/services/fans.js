'use strict';
/**
 * ProGramerly - fan control model
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * The full fan surface, built on the sensor tree hardware.js already reads
 * through LibreHardwareMonitor: every fan channel with its live RPM, the
 * controller duty driving it, and the temperature source it should follow.
 *
 * On top of that sits a real curve model - points, hysteresis, minimum duty
 * and a stop-below threshold - persisted per machine, evaluated live so you
 * can see exactly what duty a curve WOULD command at the temperature the
 * machine is at right now.
 *
 * What this module does NOT do is write the curve to the chip. That needs a
 * signed kernel-mode driver, which is what Fanzi FanControl ships and why it
 * exists. ProGramerly designs, previews, stores and exports the curve, and
 * hands the apply to the tool that owns the driver. Every number below that
 * came off a sensor is marked source:'measured'; everything the curve says
 * is marked source:'computed'. Nothing pretends to be the other.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const hardware = require('./hardware');
const settings = require('./settings');

const IS_WIN = process.platform === 'win32';

/* ---------------------------------------------------------------- presets */

/** Starting curves. Points are [temperature °C, duty %], ascending. */
const PRESETS = [
  {
    id: 'silent',
    name: 'Silent',
    desc: 'Inaudible until the package is genuinely warm. For a machine on a desk you sit at.',
    points: [[30, 0], [45, 20], [60, 35], [72, 55], [82, 85], [90, 100]],
    minDuty: 0, stopBelow: 40, hysteresis: 4,
  },
  {
    id: 'balanced',
    name: 'Balanced',
    desc: 'The default. Keeps a floor of airflow and ramps evenly - no surprises either way.',
    points: [[30, 25], [45, 32], [58, 45], [70, 65], [80, 88], [88, 100]],
    minDuty: 20, stopBelow: 0, hysteresis: 3,
  },
  {
    id: 'cooling',
    name: 'Cooling',
    desc: 'Sustained loads - compiles, renders, training runs. Loud, and keeps the silicon cold.',
    points: [[30, 40], [45, 55], [55, 70], [65, 85], [75, 100]],
    minDuty: 40, stopBelow: 0, hysteresis: 2,
  },
  {
    id: 'flat-max',
    name: 'Full speed',
    desc: 'Everything at 100%. A diagnostic setting, not a daily one.',
    points: [[0, 100], [100, 100]],
    minDuty: 100, stopBelow: 0, hysteresis: 0,
  },
];

/* ------------------------------------------------------------- the model */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "Fan #2" / "Fan Control #2" / "CPU Fan" -> a comparable key. */
function pairKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\bfan\s*control\b/g, '')
    .replace(/\bcontrol\b/g, '')
    .replace(/\bfan\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function roleOf(label, parent) {
  const s = `${label} ${parent}`.toLowerCase();
  if (/pump|aio/.test(s)) return 'pump';
  if (/gpu/.test(s)) return 'gpu';
  if (/cpu/.test(s)) return 'cpu';
  if (/rear|exhaust/.test(s)) return 'exhaust';
  if (/front|intake/.test(s)) return 'intake';
  if (/psu|power/.test(s)) return 'psu';
  return 'case';
}

/**
 * Fold the sensor tree into fan channels, controls and temperature sources.
 * @returns {Promise<{available:boolean, reason?:string, source:string,
 *   channels:Array, temps:Array, counts:object}>}
 */
async function channels() {
  const snap = await hardware.sensors();
  if (!snap.available) {
    return {
      available: false,
      reason: snap.reason,
      source: 'measured',
      channels: [],
      temps: [],
      counts: { fans: 0, controls: 0, temps: 0 },
    };
  }

  const fans = [];
  const controls = [];
  const temps = [];
  for (const group of snap.groups || []) {
    for (const s of group.sensors || []) {
      const row = {
        id: s.id, name: s.name, value: num(s.value), unit: s.unit,
        parent: group.label, parentId: group.id,
      };
      if (s.type === 'Fan') fans.push(row);
      else if (s.type === 'Control') controls.push(row);
      else if (s.type === 'Temperature') temps.push(row);
    }
  }

  // Pair each tachometer with the controller that drives it: same parent and
  // the same trailing index once "fan"/"control" is stripped out. Anything
  // unpaired still appears - a fan with no controller is exactly the thing a
  // user needs to be told about, not hidden.
  const usedControls = new Set();
  const list = fans.map((fan) => {
    const key = pairKey(fan.name);
    const match = controls.find((c) => !usedControls.has(c.id)
      && c.parentId === fan.parentId && pairKey(c.name) === key);
    if (match) usedControls.add(match.id);
    return {
      id: fan.id,
      label: fan.name,
      parent: fan.parent,
      role: roleOf(fan.name, fan.parent),
      rpm: fan.value,
      duty: match ? match.value : null,
      controlId: match ? match.id : null,
      controlName: match ? match.name : null,
      controllable: Boolean(match),
      spinning: fan.value != null ? fan.value > 0 : null,
      source: 'measured',
    };
  });

  // A controller with no tachometer (common on AIO pumps and splitters).
  for (const c of controls) {
    if (usedControls.has(c.id)) continue;
    list.push({
      id: c.id,
      label: c.name,
      parent: c.parent,
      role: roleOf(c.name, c.parent),
      rpm: null,
      duty: c.value,
      controlId: c.id,
      controlName: c.name,
      controllable: true,
      spinning: null,
      noTacho: true,
      source: 'measured',
    });
  }

  return {
    available: true,
    source: 'measured',
    reader: snap.source || 'LibreHardwareMonitor',
    channels: list.sort((a, b) => a.parent.localeCompare(b.parent) || a.label.localeCompare(b.label)),
    temps: temps.sort((a, b) => a.parent.localeCompare(b.parent) || a.name.localeCompare(b.name)),
    counts: { fans: fans.length, controls: controls.length, temps: temps.length },
  };
}

/* --------------------------------------------------------------- curves */

function clampPct(v) { return Math.max(0, Math.min(100, Math.round(Number(v) || 0))); }

function normalisePoints(points) {
  const rows = (Array.isArray(points) ? points : [])
    .map((p) => (Array.isArray(p) ? { t: Number(p[0]), pct: Number(p[1]) } : { t: Number(p.t), pct: Number(p.pct) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.pct))
    .map((p) => ({ t: Math.max(0, Math.min(120, Math.round(p.t))), pct: clampPct(p.pct) }))
    .sort((a, b) => a.t - b.t);
  // Collapse duplicate temperatures - the last one written wins.
  const out = [];
  for (const p of rows) {
    if (out.length && out[out.length - 1].t === p.t) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * The duty this curve commands at a temperature. Linear between points,
 * flat outside them, with the minimum-duty floor and the stop-below cut-out
 * applied in that order - which is the order every fan controller applies them.
 */
function evaluate(curve, tempC) {
  const points = normalisePoints(curve && curve.points);
  const t = Number(tempC);
  if (!points.length || !Number.isFinite(t)) return null;

  let pct;
  if (t <= points[0].t) pct = points[0].pct;
  else if (t >= points[points.length - 1].t) pct = points[points.length - 1].pct;
  else {
    let i = 0;
    while (i < points.length - 1 && points[i + 1].t < t) i += 1;
    const a = points[i];
    const b = points[i + 1];
    const span = b.t - a.t;
    pct = span === 0 ? b.pct : a.pct + ((t - a.t) / span) * (b.pct - a.pct);
  }

  const min = clampPct(curve.minDuty || 0);
  pct = Math.max(pct, min);
  const stop = Number(curve.stopBelow || 0);
  if (stop > 0 && t < stop) pct = 0;
  return clampPct(pct);
}

/* ------------------------------------------------------------- profiles */

function readProfiles() {
  const rows = settings.get('fanProfiles');
  return Array.isArray(rows) ? rows : [];
}

function writeProfiles(rows) {
  settings.save({ fanProfiles: rows });
  return rows;
}

function newId() {
  return `fp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Every stored profile, each evaluated against the live sensor tree so the
 * UI can show the commanded duty beside the measured one.
 */
async function profiles() {
  const rows = readProfiles();
  const live = await channels();
  const tempById = new Map((live.temps || []).map((t) => [t.id, t]));
  const chanById = new Map((live.channels || []).map((c) => [c.id, c]));

  return {
    active: settings.get('fanActiveProfile') || null,
    sensorsAvailable: live.available,
    profiles: rows.map((p) => {
      const src = tempById.get(p.sourceSensorId) || null;
      const chan = chanById.get(p.channelId) || null;
      const commanded = src ? evaluate(p, src.value) : null;
      return {
        ...p,
        points: normalisePoints(p.points),
        sourceLabel: src ? `${src.parent} · ${src.name}` : null,
        sourceTemp: src ? src.value : null,
        sourceMissing: Boolean(p.sourceSensorId && !src),
        channelLabel: chan ? `${chan.parent} · ${chan.label}` : null,
        channelMissing: Boolean(p.channelId && !chan),
        measuredDuty: chan ? chan.duty : null,
        measuredRpm: chan ? chan.rpm : null,
        commandedDuty: commanded,          // what the curve WOULD ask for
        commandedSource: 'computed',
        drift: commanded != null && chan && chan.duty != null ? Math.round(commanded - chan.duty) : null,
      };
    }),
  };
}

function saveProfile(patch) {
  const rows = readProfiles();
  const now = Date.now();
  const clean = {
    id: patch && patch.id ? String(patch.id) : newId(),
    name: String((patch && patch.name) || 'Curve').slice(0, 60),
    channelId: (patch && patch.channelId) || null,
    sourceSensorId: (patch && patch.sourceSensorId) || null,
    points: normalisePoints(patch && patch.points),
    minDuty: clampPct(patch && patch.minDuty),
    stopBelow: Math.max(0, Math.min(120, Math.round(Number(patch && patch.stopBelow) || 0))),
    hysteresis: Math.max(0, Math.min(20, Math.round(Number(patch && patch.hysteresis) || 0))),
    basedOn: (patch && patch.basedOn) || null,
    updatedAt: now,
  };
  if (!clean.points.length) return { ok: false, error: 'A curve needs at least one point.' };

  const i = rows.findIndex((r) => r.id === clean.id);
  if (i >= 0) rows[i] = { ...rows[i], ...clean };
  else rows.push({ ...clean, createdAt: now });
  writeProfiles(rows);
  return { ok: true, id: clean.id, count: rows.length };
}

function deleteProfile(id) {
  const rows = readProfiles();
  const next = rows.filter((r) => r.id !== id);
  writeProfiles(next);
  if (settings.get('fanActiveProfile') === id) settings.save({ fanActiveProfile: null });
  return { ok: true, count: next.length };
}

function setActive(id) {
  const exists = !id || readProfiles().some((r) => r.id === id);
  if (!exists) return { ok: false, error: 'No such profile.' };
  settings.save({ fanActiveProfile: id || null });
  return { ok: true, active: id || null };
}

/** Seed a profile from a preset, bound to one channel and one temperature. */
function fromPreset(presetId, { channelId, sourceSensorId, name } = {}) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ok: false, error: `Unknown preset "${presetId}".` };
  return saveProfile({
    name: name || preset.name,
    channelId: channelId || null,
    sourceSensorId: sourceSensorId || null,
    points: preset.points,
    minDuty: preset.minDuty,
    stopBelow: preset.stopBelow,
    hysteresis: preset.hysteresis,
    basedOn: preset.id,
  });
}

/* --------------------------------------------------------------- export */

function exportDir() {
  const dir = path.join(app.getPath('userData'), 'fan-profiles');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write the curve to disk as JSON. This is the handoff format: the file names
 * the channel, the temperature source and every point, so the tool that owns
 * the driver (or a future ProGramerly driver) has everything it needs.
 */
async function exportProfile(id) {
  const rows = readProfiles();
  const p = rows.find((r) => r.id === id);
  if (!p) return { ok: false, error: 'No such profile.' };
  const live = await channels();
  const src = (live.temps || []).find((t) => t.id === p.sourceSensorId) || null;
  const chan = (live.channels || []).find((c) => c.id === p.channelId) || null;

  const payload = {
    _comment: 'ProGramerly fan curve. Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED.',
    exportedAt: new Date().toISOString(),
    machine: require('node:os').hostname(),
    profile: {
      name: p.name,
      channel: chan ? { id: chan.id, label: chan.label, parent: chan.parent, role: chan.role } : { id: p.channelId },
      source: src ? { id: src.id, name: src.name, parent: src.parent } : { id: p.sourceSensorId },
      points: normalisePoints(p.points).map((pt) => [pt.t, pt.pct]),
      minDuty: p.minDuty,
      stopBelow: p.stopBelow,
      hysteresis: p.hysteresis,
    },
    note: 'Curves are applied by the tool that holds the kernel driver (Fanzi FanControl). ProGramerly designs, previews and stores them.',
  };
  const file = path.join(exportDir(), `${p.name.replace(/[^\w.-]+/g, '-').toLowerCase()}-${p.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { ok: true, file };
}

/* --------------------------------------------------------------- summary */

/** One compact object for the dome, the tray and the AI brief. */
async function summary() {
  const live = await channels();
  if (!live.available) {
    return {
      available: false, reason: live.reason, source: 'measured',
      fans: 0, spinning: 0, controllable: 0, profiles: readProfiles().length,
    };
  }
  const rpms = live.channels.map((c) => c.rpm).filter((v) => v != null);
  const duties = live.channels.map((c) => c.duty).filter((v) => v != null);
  const tempVals = live.temps.map((t) => t.value).filter((v) => v != null);
  return {
    available: true,
    source: 'measured',
    reader: live.reader,
    fans: live.counts.fans,
    controls: live.counts.controls,
    tempSensors: live.counts.temps,
    spinning: live.channels.filter((c) => c.spinning === true).length,
    stopped: live.channels.filter((c) => c.spinning === false).length,
    controllable: live.channels.filter((c) => c.controllable).length,
    maxRpm: rpms.length ? Math.max(...rpms) : null,
    meanDuty: duties.length ? Math.round(duties.reduce((a, b) => a + b, 0) / duties.length) : null,
    hottestC: tempVals.length ? Math.max(...tempVals) : null,
    profiles: readProfiles().length,
    activeProfile: settings.get('fanActiveProfile') || null,
    writeOwner: IS_WIN ? 'Fanzi FanControl (kernel driver)' : 'not applicable on this OS',
  };
}

module.exports = {
  channels, profiles, saveProfile, deleteProfile, setActive,
  fromPreset, exportProfile, exportDir, evaluate, normalisePoints, summary,
  PRESETS,
};
