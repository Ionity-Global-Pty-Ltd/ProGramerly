'use strict';
/**
 * ProGramerly - OpenRGB SDK client
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * A complete, dependency-free implementation of the OpenRGB network protocol,
 * spoken over a plain TCP socket to a running OpenRGB server (default
 * 127.0.0.1:6742, enabled in OpenRGB under Settings > General > "Start server").
 *
 * Why this and not a vendor SDK: OpenRGB already carries the per-device
 * reverse engineering for motherboard 12 V RGB headers and 5 V addressable
 * headers, GPUs, RAM, AIO pumps, fan controllers, keyboards and mice, across
 * every major vendor. Reimplementing any of that would be worse in every way.
 * ProGramerly talks to it as a first-class client instead.
 *
 * The protocol negotiation deliberately caps at version 3. Version 4 adds
 * zone segments and version 5 adds controller flags, neither of which this
 * client needs; asking for 3 means the server serialises the layout below and
 * nothing else, which removes an entire class of parsing bug.
 *
 * Wire format, for anyone reading this later:
 *   header  : "ORGB" | u32 device index | u32 packet id | u32 payload size
 *   string  : u16 length (INCLUDING the null terminator) | bytes | 0x00
 *   colour  : u32 little-endian, laid out as bytes R, G, B, 0
 */

const net = require('node:net');

const MAGIC = Buffer.from('ORGB', 'ascii');
const PROTOCOL = 3;                 // see the note above - deliberately capped

const PKT = {
  REQUEST_CONTROLLER_COUNT: 0,
  REQUEST_CONTROLLER_DATA: 1,
  REQUEST_PROTOCOL_VERSION: 40,
  SET_CLIENT_NAME: 50,
  DEVICE_LIST_UPDATED: 100,
  RGBCONTROLLER_UPDATELEDS: 1050,
  RGBCONTROLLER_UPDATEZONELEDS: 1051,
  RGBCONTROLLER_UPDATESINGLELED: 1052,
  RGBCONTROLLER_SETCUSTOMMODE: 1100,
  RGBCONTROLLER_UPDATEMODE: 1101,
};

const DEVICE_TYPE = [
  'Motherboard', 'DRAM', 'GPU', 'Cooler', 'LED strip', 'Keyboard', 'Mouse',
  'Mousemat', 'Headset', 'Headset stand', 'Gamepad', 'Light', 'Speaker',
  'Virtual', 'Storage', 'Case', 'Microphone', 'Accessory', 'Keypad', 'Unknown',
];

const ZONE_TYPE = ['Single', 'Linear', 'Matrix'];

/* ------------------------------------------------------------- readers -- */

class Reader {
  constructor(buf) { this.b = buf; this.o = 0; }
  u8() { const v = this.b.readUInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  str() {
    const len = this.u16();
    if (len === 0) return '';
    const s = this.b.toString('utf8', this.o, this.o + len - 1);  // drop the NUL
    this.o += len;
    return s;
  }
  color() {
    const r = this.u8(); const g = this.u8(); const b = this.u8(); this.u8();
    return { r, g, b };
  }
  get left() { return this.b.length - this.o; }
}

function wString(s) {
  const body = Buffer.from(String(s), 'utf8');
  const out = Buffer.alloc(2 + body.length + 1);
  out.writeUInt16LE(body.length + 1, 0);
  body.copy(out, 2);
  out.writeUInt8(0, 2 + body.length);
  return out;
}

function wColor(c) {
  const out = Buffer.alloc(4);
  out.writeUInt8(c.r & 0xff, 0);
  out.writeUInt8(c.g & 0xff, 1);
  out.writeUInt8(c.b & 0xff, 2);
  out.writeUInt8(0, 3);
  return out;
}

function header(devIdx, pktId, size) {
  const h = Buffer.alloc(16);
  MAGIC.copy(h, 0);
  h.writeUInt32LE(devIdx >>> 0, 4);
  h.writeUInt32LE(pktId >>> 0, 8);
  h.writeUInt32LE(size >>> 0, 12);
  return h;
}

/* ------------------------------------------------- controller data parse -- */

function parseMode(r) {
  const m = {};
  m.name = r.str();
  m.value = r.i32();
  m.flags = r.u32();
  m.speedMin = r.u32();
  m.speedMax = r.u32();
  if (PROTOCOL >= 3) { m.brightnessMin = r.u32(); m.brightnessMax = r.u32(); }
  m.colorsMin = r.u32();
  m.colorsMax = r.u32();
  m.speed = r.u32();
  if (PROTOCOL >= 3) m.brightness = r.u32();
  m.direction = r.u32();
  m.colorMode = r.u32();
  const n = r.u16();
  m.colors = [];
  for (let i = 0; i < n; i += 1) m.colors.push(r.color());
  // Flag bit 6 (0x40) is MODE_FLAG_HAS_PER_LED_COLOR - the "direct" modes.
  m.perLed = Boolean(m.flags & 0x40);
  return m;
}

function parseController(buf) {
  const r = new Reader(buf);
  r.u32();                       // data_size, already implied by the frame
  const d = {};
  d.type = r.u32();
  d.typeName = DEVICE_TYPE[d.type] || 'Unknown';
  d.name = r.str();
  d.vendor = r.str();
  d.description = r.str();
  d.version = r.str();
  d.serial = r.str();
  d.location = r.str();

  const numModes = r.u16();
  d.activeMode = r.u32();
  d.modes = [];
  for (let i = 0; i < numModes; i += 1) d.modes.push(parseMode(r));

  const numZones = r.u16();
  d.zones = [];
  for (let i = 0; i < numZones; i += 1) {
    const z = {};
    z.name = r.str();
    z.type = r.u32();
    z.typeName = ZONE_TYPE[z.type] || 'Unknown';
    z.ledsMin = r.u32();
    z.ledsMax = r.u32();
    z.ledsCount = r.u32();
    const matrixLen = r.u16();
    if (matrixLen > 0) {
      z.matrixHeight = r.u32();
      z.matrixWidth = r.u32();
      const cells = z.matrixHeight * z.matrixWidth;
      for (let k = 0; k < cells; k += 1) r.u32();     // the map itself is not used here
    }
    d.zones.push(z);
  }

  const numLeds = r.u16();
  d.leds = [];
  for (let i = 0; i < numLeds; i += 1) d.leds.push({ name: r.str(), value: r.u32() });

  const numColors = r.u16();
  d.colors = [];
  for (let i = 0; i < numColors; i += 1) d.colors.push(r.color());

  d.ledCount = d.leds.length;
  return d;
}

/* -------------------------------------------------------------- client -- */

class OpenRGB {
  constructor({ host = '127.0.0.1', port = 6742, name = 'ProGramerly' } = {}) {
    this.host = host; this.port = port; this.name = name;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.waiters = [];              // { pktId, resolve, reject, timer }
    this.serverProtocol = PROTOCOL;
  }

  connect(timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const s = new net.Socket();
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; try { s.destroy(); } catch { /* gone */ } reject(e); } };

      s.setTimeout(timeoutMs);
      s.once('timeout', () => fail(new Error('OpenRGB did not answer on '
        + `${this.host}:${this.port} - is the SDK server switched on?`)));
      s.once('error', (e) => fail(new Error(
        e.code === 'ECONNREFUSED'
          ? `Nothing is listening on ${this.host}:${this.port}. Start OpenRGB and enable its server in Settings > General.`
          : e.message,
      )));

      s.once('connect', async () => {
        settled = true;
        s.setTimeout(0);
        this.sock = s;
        s.on('data', (chunk) => this._onData(chunk));
        s.on('close', () => { this.sock = null; this._rejectAll(new Error('OpenRGB closed the connection')); });
        try {
          this._send(0, PKT.SET_CLIENT_NAME, wString(this.name));
          const v = await this._request(0, PKT.REQUEST_PROTOCOL_VERSION,
            (() => { const b = Buffer.alloc(4); b.writeUInt32LE(PROTOCOL, 0); return b; })(),
            PKT.REQUEST_PROTOCOL_VERSION);
          this.serverProtocol = Math.min(v.readUInt32LE(0), PROTOCOL);
          resolve(this);
        } catch (e) { reject(e); }
      });

      s.connect(this.port, this.host);
    });
  }

  disconnect() {
    if (this.sock) { try { this.sock.destroy(); } catch { /* already gone */ } this.sock = null; }
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    // Frames arrive back to back; drain every complete one before returning.
    for (;;) {
      if (this.buf.length < 16) return;
      if (this.buf.subarray(0, 4).compare(MAGIC) !== 0) {
        // Desynchronised. Find the next magic rather than throwing the socket away.
        const at = this.buf.indexOf(MAGIC, 1);
        if (at < 0) { this.buf = Buffer.alloc(0); return; }
        this.buf = this.buf.subarray(at);
        continue;
      }
      const pktId = this.buf.readUInt32LE(8);
      const size = this.buf.readUInt32LE(12);
      if (this.buf.length < 16 + size) return;
      const payload = this.buf.subarray(16, 16 + size);
      this.buf = this.buf.subarray(16 + size);

      if (pktId === PKT.DEVICE_LIST_UPDATED) continue;   // unsolicited, ignore
      const idx = this.waiters.findIndex((w) => w.pktId === pktId);
      if (idx >= 0) {
        const w = this.waiters.splice(idx, 1)[0];
        clearTimeout(w.timer);
        w.resolve(Buffer.from(payload));
      }
    }
  }

  _rejectAll(err) {
    const list = this.waiters.splice(0);
    list.forEach((w) => { clearTimeout(w.timer); w.reject(err); });
  }

  _send(devIdx, pktId, payload) {
    if (!this.sock) throw new Error('not connected to OpenRGB');
    const body = payload || Buffer.alloc(0);
    this.sock.write(Buffer.concat([header(devIdx, pktId, body.length), body]));
  }

  _request(devIdx, pktId, payload, expectId, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`OpenRGB did not reply to packet ${pktId}`));
      }, timeoutMs);
      this.waiters.push({ pktId: expectId, resolve, reject, timer });
      try { this._send(devIdx, pktId, payload); } catch (e) { clearTimeout(timer); reject(e); }
    });
  }

  async controllerCount() {
    const b = await this._request(0, PKT.REQUEST_CONTROLLER_COUNT, null, PKT.REQUEST_CONTROLLER_COUNT);
    return b.readUInt32LE(0);
  }

  async controller(index) {
    const ver = Buffer.alloc(4);
    ver.writeUInt32LE(this.serverProtocol, 0);
    const b = await this._request(index, PKT.REQUEST_CONTROLLER_DATA, ver, PKT.REQUEST_CONTROLLER_DATA, 10000);
    const d = parseController(b);
    d.index = index;
    return d;
  }

  async devices() {
    const n = await this.controllerCount();
    const out = [];
    for (let i = 0; i < n; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        out.push(await this.controller(i));
      } catch (e) {
        // One unreadable controller must not cost you the other eleven.
        out.push({ index: i, name: `Device ${i}`, typeName: 'Unknown', vendor: '', ledCount: 0,
          zones: [], modes: [], leds: [], colors: [], unreadable: e.message });
      }
    }
    return out;
  }

  /** Put a device into its per-LED mode so direct colours take effect. */
  setCustomMode(index) { this._send(index, PKT.RGBCONTROLLER_SETCUSTOMMODE, null); }

  /** Write one colour per LED. `colors` must be exactly ledCount long. */
  updateLeds(index, colors) {
    const n = colors.length;
    const body = Buffer.alloc(4 + 2 + n * 4);
    body.writeUInt32LE(body.length, 0);
    body.writeUInt16LE(n, 4);
    colors.forEach((c, i) => wColor(c).copy(body, 6 + i * 4));
    this._send(index, PKT.RGBCONTROLLER_UPDATELEDS, body);
  }

  updateZoneLeds(index, zoneIndex, colors) {
    const n = colors.length;
    const body = Buffer.alloc(4 + 4 + 2 + n * 4);
    body.writeUInt32LE(body.length, 0);
    body.writeUInt32LE(zoneIndex, 4);
    body.writeUInt16LE(n, 8);
    colors.forEach((c, i) => wColor(c).copy(body, 10 + i * 4));
    this._send(index, PKT.RGBCONTROLLER_UPDATEZONELEDS, body);
  }

  /** Re-serialise a mode (optionally with new speed/brightness/colours) and apply it. */
  updateMode(index, modeIndex, mode) {
    const parts = [];
    parts.push(wString(mode.name));
    const nums = Buffer.alloc(4 * (PROTOCOL >= 3 ? 12 : 9));
    let o = 0;
    const wi = (v) => { nums.writeInt32LE(v | 0, o); o += 4; };
    const wu = (v) => { nums.writeUInt32LE(v >>> 0, o); o += 4; };
    wi(mode.value);
    wu(mode.flags);
    wu(mode.speedMin); wu(mode.speedMax);
    if (PROTOCOL >= 3) { wu(mode.brightnessMin || 0); wu(mode.brightnessMax || 0); }
    wu(mode.colorsMin); wu(mode.colorsMax);
    wu(mode.speed);
    if (PROTOCOL >= 3) wu(mode.brightness || 0);
    wu(mode.direction); wu(mode.colorMode);
    parts.push(nums.subarray(0, o));
    const nc = Buffer.alloc(2);
    nc.writeUInt16LE(mode.colors.length, 0);
    parts.push(nc, ...mode.colors.map(wColor));

    const tail = Buffer.concat(parts);
    const body = Buffer.alloc(4 + 4 + tail.length);
    body.writeUInt32LE(body.length, 0);
    body.writeUInt32LE(modeIndex, 4);
    tail.copy(body, 8);
    this._send(index, PKT.RGBCONTROLLER_UPDATEMODE, body);
  }
}

/* ------------------------------------------------------- friendly layer -- */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { r: 0, g: 198, b: 255 };            // fall back to Ionity cyan
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

async function withClient(fn, opts) {
  const c = new OpenRGB(opts);
  try {
    await c.connect();
    return await fn(c);
  } finally {
    c.disconnect();
  }
}

/** Everything the UI needs in one call: server state plus every device. */
async function status(opts) {
  try {
    return await withClient(async (c) => {
      const devices = await c.devices();
      return {
        connected: true,
        protocol: c.serverProtocol,
        host: c.host, port: c.port,
        devices: devices.map((d) => ({
          index: d.index,
          name: d.name,
          vendor: d.vendor,
          type: d.typeName,
          description: d.description,
          location: d.location,
          ledCount: d.ledCount,
          zones: d.zones.map((z) => ({ name: z.name, type: z.typeName, leds: z.ledsCount })),
          modes: d.modes.map((m, i) => ({ index: i, name: m.name, perLed: m.perLed, active: i === d.activeMode })),
          activeMode: d.activeMode,
          unreadable: d.unreadable || null,
        })),
      };
    }, opts);
  } catch (e) {
    return { connected: false, error: e.message, devices: [] };
  }
}

/** One colour, applied to every LED of one device or of all of them. */
async function setColor(hex, deviceIndex, opts) {
  const rgb = hexToRgb(hex);
  try {
    return await withClient(async (c) => {
      const devices = await c.devices();
      const targets = deviceIndex === null || deviceIndex === undefined
        ? devices
        : devices.filter((d) => d.index === Number(deviceIndex));
      const done = [];
      for (const d of targets) {
        if (!d.ledCount) { done.push({ name: d.name, ok: false, why: 'no addressable LEDs' }); continue; }
        c.setCustomMode(d.index);
        c.updateLeds(d.index, new Array(d.ledCount).fill(rgb));
        done.push({ name: d.name, ok: true, leds: d.ledCount });
      }
      // Give the socket a moment to flush before the finally-block closes it.
      await new Promise((r) => setTimeout(r, 120));
      return { ok: true, applied: done, color: hex };
    }, opts);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Apply one of a device's own built-in effects. */
async function applyMode(deviceIndex, modeIndex, opts) {
  try {
    return await withClient(async (c) => {
      const d = await c.controller(Number(deviceIndex));
      const m = d.modes[Number(modeIndex)];
      if (!m) return { ok: false, error: 'that mode does not exist on this device' };
      c.updateMode(d.index, Number(modeIndex), m);
      await new Promise((r) => setTimeout(r, 120));
      return { ok: true, detail: `${d.name}: ${m.name}` };
    }, opts);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { OpenRGB, status, setColor, applyMode, hexToRgb, parseController, PKT, PROTOCOL };
