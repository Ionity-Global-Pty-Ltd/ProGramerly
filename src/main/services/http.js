'use strict';
/**
 * ProGramerly - tiny HTTPS helpers
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * No dependencies. Redirect-following GET, JSON GET, streamed download with
 * progress, TCP connect timing and a raw POST used by the speed test.
 */

const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const { URL } = require('node:url');

const UA = 'ProGramerly/AEDI (+https://www.ionity.today)';

function pick(u) {
  return u.protocol === 'http:' ? http : https;
}

/** GET a URL, following up to 5 redirects, resolving to a Buffer. */
function getBuffer(url, opts = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }

    const req = pick(u).request(u, {
      method: opts.method || 'GET',
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
      timeout: opts.timeoutMs || 30000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(getBuffer(new URL(res.headers.location, u).toString(), opts, depth + 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });

    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getJson(url, opts = {}) {
  const res = await getBuffer(url, opts);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return JSON.parse(res.body.toString('utf8'));
}

async function getText(url, opts = {}) {
  const res = await getBuffer(url, opts);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.body.toString('utf8');
}

/** Stream a URL to disk. onProgress({received,total,pct}). */
function download(url, dest, onProgress = () => {}, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    const u = new URL(url);
    const req = pick(u).get(u, {
      headers: { 'User-Agent': UA, Accept: 'application/octet-stream' },
      timeout: 60000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, u).toString(), dest, onProgress, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => {
        received += c.length;
        onProgress({ received, total, pct: total ? Math.round((received / total) * 100) : 0 });
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ path: dest, bytes: received })));
      out.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/**
 * One TCP connect round trip, in milliseconds.
 * Not ICMP - a real handshake to the service port, which is what an app
 * actually feels. Resolves { ms } or { error }.
 */
function tcpPing(host, port = 443, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const sock = new net.Socket();
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* already closed */ }
      resolve(payload);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      finish({ ms: Math.round(ms * 100) / 100 });
    });
    sock.once('timeout', () => finish({ error: 'timeout' }));
    sock.once('error', (e) => finish({ error: e.code || e.message }));
    sock.connect(port, host);
  });
}

module.exports = { getBuffer, getJson, getText, download, tcpPing, UA };
