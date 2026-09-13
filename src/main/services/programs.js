'use strict';
/**
 * ProGramerly - bundled programs (main process)
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * Windows utilities are shipped as explicit extraResources. They are staged
 * into userData asynchronously, verified against release-pinned SHA-256
 * digests, and only then handed to the OS shell. Renderer input is always a
 * catalogue id; it can never provide a path or executable name.
 *
 * Where a build ships without the payload (the portable .exe, a source
 * checkout, or a CI installer built while the payload release was still a
 * draft) the same pinned manifest drives a download from the dedicated
 * `programs-v1` GitHub Release. The download lands in a temporary file, is
 * byte-counted and SHA-256 checked, and only then renamed into the managed
 * folder. Nothing that fails the pin is ever launched or kept.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');

const { download } = require('./http');

const IS_WIN = process.platform === 'win32';
const verificationCache = new Map();
const stagingJobs = new Map();
const downloadProgress = new Map();
let progressSink = () => {};

const MANIFEST = require('../data/programs.json');
const PAYLOAD = MANIFEST.payload;
const PROGRAMS = MANIFEST.programs;

function payloadUrl(file) {
  return `https://github.com/${PAYLOAD.repo}/releases/download/${PAYLOAD.tag}/${encodeURIComponent(file)}`;
}

/** Main registers a sink once; progress packets are forwarded to the renderer. */
function setProgressSink(fn) {
  progressSink = typeof fn === 'function' ? fn : () => {};
}

function report(program, phase, extra = {}) {
  const packet = { id: program.id, file: program.file, phase, ...extra };
  if (phase === 'download') downloadProgress.set(program.id, packet);
  else downloadProgress.delete(program.id);
  try { progressSink(packet); } catch { /* renderer gone */ }
}

function managedDir() {
  return path.join(app.getPath('userData'), 'programs');
}

function sourceCandidates(file) {
  const candidates = [];
  try { candidates.push(path.join(process.resourcesPath || '', PAYLOAD.resourceFolder, file)); } catch { /* unavailable */ }
  candidates.push(path.join(__dirname, '..', '..', '..', PAYLOAD.localFolder, file));
  candidates.push(path.join(app.getAppPath ? app.getAppPath() : '.', PAYLOAD.localFolder, file));
  return candidates;
}

function findSource(file) {
  for (const candidate of sourceCandidates(file)) {
    try { if (candidate && fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  return null;
}

function fileState(file, program) {
  if (!file) return { exists: false, sizeMatches: false, verified: false, size: null };
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { exists: false, sizeMatches: false, verified: false, size: null };
    const signature = `${stat.size}:${stat.mtimeMs}`;
    const cached = verificationCache.get(file);
    return {
      exists: true,
      size: stat.size,
      sizeMatches: stat.size === program.expectedBytes,
      verified: Boolean(cached && cached.signature === signature && cached.ok),
      signature,
    };
  } catch {
    return { exists: false, sizeMatches: false, verified: false, size: null };
  }
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyFile(file, program) {
  const before = fileState(file, program);
  if (!before.exists || !before.sizeMatches) {
    if (file) verificationCache.delete(file);
    return false;
  }
  if (before.verified) return true;
  try {
    const digest = await hashFile(file);
    const after = fileState(file, program);
    const unchanged = after.exists && after.signature === before.signature;
    const ok = unchanged && digest.toLowerCase() === program.sha256;
    verificationCache.set(file, { signature: after.signature, ok, digest });
    return ok;
  } catch {
    verificationCache.delete(file);
    return false;
  }
}

/**
 * Fetch one program from the payload release into a temporary file inside the
 * managed folder. Resolves the temporary path only when the byte count and the
 * SHA-256 both match the manifest; anything else is deleted and rejected.
 */
async function downloadProgram(program, destinationDir) {
  const temporary = path.join(destinationDir, `.${program.file}.${process.pid}.download`);
  const url = payloadUrl(program.file);
  await fs.promises.mkdir(destinationDir, { recursive: true });
  await fs.promises.rm(temporary, { force: true });
  report(program, 'download', { pct: 0, received: 0, total: program.expectedBytes, url });
  try {
    const result = await download(url, temporary, (p) => {
      report(program, 'download', {
        pct: p.total ? p.pct : Math.round((p.received / program.expectedBytes) * 100),
        received: p.received,
        total: p.total || program.expectedBytes,
        url,
      });
    });
    if (result.bytes !== program.expectedBytes) {
      throw new Error(`downloaded ${result.bytes} bytes, expected ${program.expectedBytes}`);
    }
    report(program, 'verify', { pct: 100 });
    if (!(await verifyFile(temporary, program))) {
      throw new Error('SHA-256 mismatch - the download was discarded');
    }
    return temporary;
  } catch (error) {
    try { await fs.promises.rm(temporary, { force: true }); } catch { /* best effort */ }
    report(program, 'failed', { error: error.message });
    throw new Error(`${program.file} could not be downloaded from ${PAYLOAD.tag}: ${error.message}`);
  }
}

async function stageProgram(program) {
  const destinationDir = managedDir();
  const destination = path.join(destinationDir, program.file);

  if (await verifyFile(destination, program)) {
    return { dest: destination, installed: true, verified: true, source: findSource(program.file), copied: false };
  }

  const source = findSource(program.file);
  let temporary = path.join(destinationDir, `.${program.file}.${process.pid}.staging`);
  let origin = 'bundled';

  try {
    if (source) {
      if (!(await verifyFile(source, program))) {
        return { dest: destination, installed: false, verified: false, source, error: `${program.file} failed its release SHA-256 check.` };
      }
      report(program, 'copy', { pct: 0 });
      await fs.promises.mkdir(destinationDir, { recursive: true });
      await fs.promises.rm(temporary, { force: true });
      await fs.promises.copyFile(source, temporary);
      if (!(await verifyFile(temporary, program))) {
        await fs.promises.rm(temporary, { force: true });
        return { dest: destination, installed: false, verified: false, source, error: `The staged copy of ${program.file} failed verification.` };
      }
    } else {
      // Not in this build: fetch the pinned payload from the programs release.
      origin = 'downloaded';
      temporary = await downloadProgram(program, destinationDir);
    }

    // The temporary copy is complete and verified before the previous managed
    // copy is removed. rename() is atomic inside this directory.
    await fs.promises.rm(destination, { force: true });
    await fs.promises.rename(temporary, destination);
    const verified = await verifyFile(destination, program);
    report(program, verified ? 'ready' : 'failed', { pct: 100 });
    return {
      dest: destination,
      installed: verified,
      verified,
      source,
      origin,
      copied: true,
      error: verified ? null : `The managed copy of ${program.file} could not be verified after staging.`,
    };
  } catch (error) {
    try { await fs.promises.rm(temporary, { force: true }); } catch { /* best effort */ }
    const verified = await verifyFile(destination, program);
    report(program, verified ? 'ready' : 'failed', { error: error.message });
    return {
      dest: destination,
      installed: verified,
      verified,
      source,
      origin,
      copied: false,
      error: error.message,
    };
  }
}

function ensureCopied(program) {
  if (stagingJobs.has(program.id)) return stagingJobs.get(program.id);
  const job = stageProgram(program).finally(() => stagingJobs.delete(program.id));
  stagingJobs.set(program.id, job);
  return job;
}

function list() {
  return PROGRAMS.map((program) => {
    const source = findSource(program.file);
    const destination = path.join(managedDir(), program.file);
    const sourceState = fileState(source, program);
    const destinationState = fileState(destination, program);
    const available = sourceState.sizeMatches || destinationState.sizeMatches;
    const verified = sourceState.verified || destinationState.verified;
    const malformed = !available && (sourceState.exists || destinationState.exists);
    const progress = downloadProgress.get(program.id) || null;
    return {
      id: program.id,
      name: program.name,
      desc: program.desc,
      tags: program.tags,
      kind: program.kind,
      version: program.version,
      requiresConfirmation: Boolean(program.requiresConfirmation),
      file: program.file,
      available,
      sourceAvailable: sourceState.sizeMatches,
      staged: destinationState.exists,
      installed: destinationState.exists,
      verified,
      // Not bundled in this build, but fetchable from the pinned payload release.
      downloadable: IS_WIN && !available,
      downloadUrl: payloadUrl(program.file),
      downloading: Boolean(progress),
      progress,
      integrity: malformed ? 'invalid' : verified ? 'verified' : available ? 'pending' : 'remote',
      launchable: IS_WIN && !malformed,
      sizeBytes: program.expectedBytes,
      sha256: program.sha256,
      platform: 'win',
    };
  });
}

async function hydrate() {
  const results = [];
  // Sequential staging avoids four half-gigabyte disk streams competing on a
  // first launch. It remains asynchronous, so the Electron UI stays responsive.
  for (const program of PROGRAMS) {
    // eslint-disable-next-line no-await-in-loop
    results.push({ id: program.id, ...await ensureCopied(program) });
  }
  return results;
}

async function launch(id) {
  const program = PROGRAMS.find((item) => item.id === id);
  if (!program) return { ok: false, error: `Unknown program: ${id}` };
  if (!IS_WIN) return { ok: false, error: 'These utilities are Windows programs and cannot run on this OS.' };

  const staged = await ensureCopied(program);
  if (!staged.installed || !staged.verified) {
    return { ok: false, error: staged.error || `${program.file} is not available in this build.` };
  }
  if (!(await verifyFile(staged.dest, program))) {
    return { ok: false, error: `${program.file} changed after staging and was not launched.` };
  }

  const error = await shell.openPath(staged.dest);
  if (error) return { ok: false, error };
  return { ok: true, path: staged.dest, verified: true, kind: program.kind, origin: staged.origin || 'managed' };
}

async function openFolder() {
  const directory = managedDir();
  try { await fs.promises.mkdir(directory, { recursive: true }); } catch { /* already exists */ }
  return shell.openPath(directory);
}

module.exports = {
  list,
  hydrate,
  launch,
  openFolder,
  managedDir,
  setProgressSink,
  payloadUrl,
  PAYLOAD,
  PROGRAMS,
};
