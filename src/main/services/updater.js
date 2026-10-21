'use strict';
/**
 * ProGramerly - GitHub self-updater
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * No app store, no vendor updater service. ProGramerly asks GitHub Releases
 * directly, tells you a new build exists, and installs it only when you say so.
 * The download is verified against the release's SHA256.txt when one is
 * published, and the installer is launched with the same silent switches
 * electron-builder's NSIS target understands.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app, shell } = require('electron');

const { getJson, download } = require('./http');
const settings = require('./settings');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/* ------------------------------------------------------------- versions -- */

/** Compare two semver-ish strings. Returns 1 if a > b, -1 if a < b, 0 equal. */
function cmpVersion(a, b) {
  // SemVer 2.0: build metadata (+...) never affects order; a release outranks
  // its pre-releases; pre-release identifiers compare numerically when both
  // are numbers, and rc10 > rc2 (letter/digit runs are split apart).
  const parse = (v) => {
    const s = String(v || '0').trim().replace(/^v/i, '').split('+')[0];
    const dash = s.indexOf('-');
    const core = (dash < 0 ? s : s.slice(0, dash)).split('.').map((n) => Number(n) || 0);
    const pre = dash < 0 ? [] : s.slice(dash + 1).split('.')
      .flatMap((id) => id.match(/\d+|\D+/g) || [id]);
    return { core, pre };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < Math.max(A.core.length, B.core.length, 3); i += 1) {
    const x = A.core[i] || 0;
    const y = B.core[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (!A.pre.length || !B.pre.length) {
    if (A.pre.length === B.pre.length) return 0;
    return A.pre.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i += 1) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) { if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1; }
    else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/* --------------------------------------------------------------- assets -- */

let familyCache = null;
/** debian | rpm | other, from /etc/os-release. */
function linuxFamily() {
  if (familyCache) return familyCache;
  let txt = '';
  try { txt = fs.readFileSync('/etc/os-release', 'utf8').toLowerCase(); } catch { txt = ''; }
  const like = `${(txt.match(/^id=(.*)$/m) || [])[1] || ''} ${(txt.match(/^id_like=(.*)$/m) || [])[1] || ''}`;
  familyCache = /debian|ubuntu|mint|pop/.test(like) ? 'debian' : /fedora|rhel|centos|suse|rocky|alma/.test(like) ? 'rpm' : 'other';
  return familyCache;
}

function assetScore(name) {
  const n = name.toLowerCase();
  // An x64 build running under Rosetta still sits on an Apple Silicon Mac:
  // the update should move it onto the native arm64 build.
  const arm = process.arch === 'arm64' || app.runningUnderARM64Translation === true;
  if (IS_WIN) {
    if (!/\.exe$/.test(n)) return -1;
    let s = 10;
    if (n.includes('setup')) s += 6;
    if (n.includes('portable')) s -= 2;
    if (arm ? n.includes('arm64') : n.includes('x64')) s += 4;
    if (!arm && n.includes('arm64')) s -= 8;
    return s;
  }
  if (IS_MAC) {
    if (!/\.(dmg|zip)$/.test(n)) return -1;
    let s = 10;
    if (n.endsWith('.dmg')) s += 4;
    if (arm ? n.includes('arm64') : (!n.includes('arm64'))) s += 4;
    return s;
  }
  // Linux: match how this copy was installed. An AppImage sets APPIMAGE;
  // otherwise the distro family decides between .deb and .rpm. Never offer
  // an arm64 package to x64 or the other way round.
  if (!/\.(appimage|deb|rpm)$/.test(n)) return -1;
  const archOk = arm ? /(arm64|aarch64)/.test(n) : !/(arm64|aarch64|armv7)/.test(n);
  if (!archOk) return -1;
  if (process.env.APPIMAGE) return n.endsWith('.appimage') ? 14 : 6;
  const fam = linuxFamily();
  if (n.endsWith('.deb')) return fam === 'debian' ? 14 : 6;
  if (n.endsWith('.rpm')) return fam === 'rpm' ? 14 : 4;
  return 12;   // AppImage runs anywhere
}

function pickAsset(release) {
  const scored = (release.assets || [])
    .map((a) => ({ a, s: assetScore(a.name) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);
  return scored.length ? scored[0].a : null;
}

/* ---------------------------------------------------------------- check -- */

/**
 * @returns {Promise<{ok:boolean, available:boolean, current:string, latest?:string,
 *                     notes?:string, url?:string, asset?:object, publishedAt?:string,
 *                     error?:string}>}
 */
async function check() {
  const s = settings.get();
  const repo = s.updateRepo;
  const current = app.getVersion();
  try {
    const list = await getJson(
      `https://api.github.com/repos/${repo}/releases?per_page=20`,
      { headers: { Accept: 'application/vnd.github+json' }, timeoutMs: 20000 },
    );
    const usable = (Array.isArray(list) ? list : [])
      .filter((r) => !r.draft)
      // Only application releases carry a version tag. The `programs-v1`
      // payload release (bundled utilities) lives in the same repository and
      // must never be mistaken for a newer ProGramerly.
      .filter((r) => /^v?\d+(\.\d+)*/.test(String(r.tag_name || '')))
      .filter((r) => (s.updateChannel === 'prerelease' ? true : !r.prerelease))
      .sort((a, b) => cmpVersion(b.tag_name, a.tag_name));

    settings.save({ lastAppCheckAt: Date.now() });
    if (!usable.length) {
      return { ok: true, available: false, current, reason: 'no releases published yet' };
    }
    const latest = usable[0];
    const newer = cmpVersion(latest.tag_name, current) > 0;
    return {
      ok: true,
      available: newer,
      current,
      latest: String(latest.tag_name || '').replace(/^v/i, ''),
      notes: latest.body || '',
      url: latest.html_url,
      publishedAt: latest.published_at,
      prerelease: Boolean(latest.prerelease),
      asset: newer ? pickAsset(latest) : null,
      shaAsset: (latest.assets || []).find((a) => /^sha256(sums)?\.txt$/i.test(a.name)) || null,
    };
  } catch (err) {
    return { ok: false, available: false, current, error: err.message };
  }
}

/* ------------------------------------------------------------- download -- */

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

function updatesDir() {
  const dir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Download the picked asset and verify it when the release ships a SHA256 list.
 * @returns {Promise<{ok:boolean, file?:string, verified?:boolean, error?:string}>}
 */
async function fetchUpdate(info, onProgress = () => {}) {
  if (!info || !info.asset) return { ok: false, error: 'no installer asset for this platform' };
  const dest = path.join(updatesDir(), info.asset.name);
  try {
    onProgress({ phase: 'download', pct: 0, name: info.asset.name });
    await download(info.asset.browser_download_url, dest, (p) => onProgress({ phase: 'download', ...p, name: info.asset.name }));

    let verified = null;
    if (info.shaAsset) {
      onProgress({ phase: 'verify', pct: 100, name: info.asset.name });
      const { getText } = require('./http');
      const list = await getText(info.shaAsset.browser_download_url);
      const want = list.split(/\r?\n/)
        .map((l) => l.trim().split(/\s+/))
        .find((p) => p[1] && p[1].replace(/^\*/, '') === info.asset.name);
      if (want) {
        const got = await sha256(dest);
        verified = got.toLowerCase() === want[0].toLowerCase();
        if (!verified) {
          fs.unlinkSync(dest);
          return { ok: false, error: 'checksum mismatch - download discarded' };
        }
      }
    }
    return { ok: true, file: dest, verified };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Launch the downloaded installer and quit so it can replace the running app.
 * Windows NSIS accepts /S for a silent per-user upgrade; macOS and Linux hand
 * the file to the OS because a .dmg/.AppImage swap is a user action.
 */
function applyUpdate(file, { silent = true } = {}) {
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'installer is missing' };
  try {
    if (IS_WIN && file.toLowerCase().endsWith('.exe')) {
      const child = spawn(file, silent ? ['/S', '--updated'] : ['--updated'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.once('error', () => { /* reported by the exists check above in practice */ });
      child.unref();
      setTimeout(() => app.quit(), 900);
      return { ok: true, launched: true };
    }
    // Linux AppImage: a download has no exec bit; without it the file
    // manager refuses to run it.
    if (/\.appimage$/i.test(file)) { try { fs.chmodSync(file, 0o755); } catch { /* read-only */ } }
    return shell.openPath(file).then((err) => (err
      ? { ok: false, error: `could not open the installer: ${err}`, file }
      : { ok: true, launched: false, manual: true, file }));
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Housekeeping - keep only the newest three downloaded installers. */
function prune() {
  try {
    const dir = updatesDir();
    const files = fs.readdirSync(dir)
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(3).forEach(({ f }) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* locked */ } });
  } catch { /* nothing downloaded yet */ }
}

module.exports = { check, fetchUpdate, applyUpdate, cmpVersion, prune, updatesDir, platformTag: `${process.platform}-${process.arch}-${os.release()}` };
