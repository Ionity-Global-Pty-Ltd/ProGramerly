'use strict';
const Module = require('node:module');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.env.PG_ROOT || 'G:/.Development/ProGramerly-Basic Software for All';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Fake payload: two small "executables"
const good = Buffer.from('GOOD-PROGRAM-'.repeat(1000));
const remote = Buffer.from('REMOTE-PROGRAM-'.repeat(2000));
fs.writeFileSync('/tmp/pgtest/payload/good.exe', good);           // bundled
// remote.exe is NOT bundled -> must be downloaded

const manifest = { payload: { repo: 'x/y', tag: 'programs-v1', checksums: 'S.txt', localFolder: 'PAYLOAD', resourceFolder: 'programs' },
  programs: [
    { id: 'good', name: 'Good', file: 'good.exe', desc: '', tags: [], kind: 'utility', version: null, expectedBytes: good.length, sha256: sha(good) },
    { id: 'remote', name: 'Remote', file: 'remote.exe', desc: '', tags: [], kind: 'utility', version: null, expectedBytes: remote.length, sha256: sha(remote) },
    { id: 'bad', name: 'Bad', file: 'bad.exe', desc: '', tags: [], kind: 'utility', version: null, expectedBytes: 10, sha256: sha(Buffer.from('0123456789')) },
  ] };
require.cache[path.join(root, 'src/main/data/programs.json')] = { id: 'm', filename: 'm', loaded: true, exports: manifest };

let opened = [];
const fakeElectron = { app: { getPath: () => '/tmp/pgtest/userData', getAppPath: () => '/tmp/pgtest' }, shell: { openPath: async (p) => { opened.push(p); return ''; } } };
let downloads = [];
let offline = false;
const fakeHttp = { download: async (url, dest, onProgress) => {
  if (offline) throw new Error('offline');
  downloads.push(url);
  const body = url.endsWith('remote.exe') ? remote : url.endsWith('bad.exe') ? Buffer.from('WRONGBYTES') : null;
  if (!body) throw new Error('HTTP 404 for ' + url);
  onProgress({ received: body.length >> 1, total: body.length, pct: 50 });
  fs.writeFileSync(dest, body);
  onProgress({ received: body.length, total: body.length, pct: 100 });
  return { path: dest, bytes: body.length };
} };
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'electron') return fakeElectron;
  if (req === './http' && parent && parent.filename.endsWith('programs.js')) return fakeHttp;
  return origLoad.call(this, req, parent, ...rest);
};
// make sourceCandidates find /tmp/pgtest/PAYLOAD via app.getAppPath()
fs.rmSync('/tmp/pgtest/PAYLOAD', { recursive: true, force: true }); fs.renameSync('/tmp/pgtest/payload', '/tmp/pgtest/PAYLOAD');
Object.defineProperty(process, 'platform', { value: 'win32' });

const programs = require(path.join(root, 'src/main/services/programs.js'));
const packets = []; programs.setProgressSink((p) => packets.push(p.phase + (p.pct != null ? ':' + p.pct : '')));

(async () => {
  const assert = require('node:assert');
  let l = programs.list();
  const by = (id) => l.find((x) => x.id === id);
  assert.strictEqual(by('good').available, true); assert.strictEqual(by('good').downloadable, false); assert.strictEqual(by('good').launchable, true);
  assert.strictEqual(by('remote').available, false); assert.strictEqual(by('remote').downloadable, true); assert.strictEqual(by('remote').integrity, 'remote'); assert.strictEqual(by('remote').launchable, true);
  assert.ok(by('remote').downloadUrl.endsWith('/releases/download/programs-v1/remote.exe'));

  let r = await programs.launch('good');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.origin, 'bundled'); assert.ok(fs.existsSync('/tmp/pgtest/userData/programs/good.exe'));
  console.log('bundled launch ok ->', r.path);

  r = await programs.launch('remote');
  assert.strictEqual(r.ok, true, r.error); assert.strictEqual(r.origin, 'downloaded');
  assert.strictEqual(fs.readFileSync('/tmp/pgtest/userData/programs/remote.exe').equals(remote), true);
  console.log('download launch ok ->', r.path, 'packets:', packets.join(' '));
  assert.ok(packets.includes('download:50') && packets.includes('verify:100') && packets.includes('ready:100'));

  // second launch: already verified managed copy, no download
  const n = downloads.length; r = await programs.launch('remote'); assert.strictEqual(r.ok, true); assert.strictEqual(downloads.length, n); assert.strictEqual(r.origin, 'managed');
  console.log('cached relaunch ok (no re-download)');

  // bad payload: wrong bytes must be discarded and never launched
  packets.length = 0; r = await programs.launch('bad');
  assert.strictEqual(r.ok, false); assert.ok(/downloaded 10 bytes|could not be downloaded/.test(r.error), r.error);
  assert.ok(!fs.existsSync('/tmp/pgtest/userData/programs/bad.exe'));
  assert.strictEqual(fs.readdirSync('/tmp/pgtest/userData/programs').filter((f) => f.startsWith('.')).length, 0, 'no temp files left');
  console.log('bad payload rejected ->', r.error);

  // tampered managed copy must not launch
  fs.appendFileSync('/tmp/pgtest/userData/programs/remote.exe', 'X');
  fs.rmSync('/tmp/pgtest/PAYLOAD/good.exe'); // and simulate size-mismatched remote re-download
  offline = true;
  r = await programs.launch('remote'); assert.strictEqual(r.ok, false); console.log('tampered copy + offline ->', r.error);
  l = programs.list(); assert.strictEqual(by('remote').integrity, 'invalid');
  assert.strictEqual(opened.length, 3);
  console.log('ALL PROGRAMS.JS CHECKS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
