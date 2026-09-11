'use strict';
/**
 * ProGramerly - bundled programs (main process)
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * The four Ionity utilities that ship inside the app are exposed here as
 * launchable "Programs" cards. On first run they are copied out of the
 * packaged resources into a writable managed folder under userData, then
 * launched in place with the OS shell. Nothing is redistributed outside the
 * app: the files live in the install and in the user's own profile only.
 *
 * Windows-only launch (these are .exe). On macOS/Linux the tab still lists them
 * but marks them as Windows programs rather than pretending to run them.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');

const IS_WIN = process.platform === 'win32';

/**
 * The catalogue of bundled programs. `file` is the basename as shipped in
 * "PROGRAMS TO REF AND USE" and packaged via electron-builder extraResources.
 */
const PROGRAMS = [
  {
    id: 'fanzi',
    name: 'Fanzi FanControl',
    file: 'Fanzi.FanControl.exe',
    desc: 'Fan curve and cooling control (Ionity build of FanControl).',
    tags: ['hardware', 'fans'],
  },
  {
    id: 'aios-demo',
    name: 'IONITY AiOS Demo',
    file: 'IONITY-AiOS-Demo-v1.6.0.exe',
    desc: 'IONITY AiOS demonstration environment, v1.6.0.',
    tags: ['ionity', 'demo'],
  },
  {
    id: 'cic',
    name: 'CiC',
    file: 'CiC.exe',
    desc: 'CiC utility.',
    tags: ['ionity', 'tools'],
  },
  {
    id: 'mcp-audit',
    name: 'MCP-AUDIT',
    file: 'MCP-AUDIT.Setup.1.15.0.exe',
    desc: 'MCP-AUDIT setup / auditor, v1.15.0.',
    tags: ['mcp', 'audit'],
  },
];

/** Where copied programs live so they are writable and launchable. */
function managedDir() {
  return path.join(app.getPath('userData'), 'programs');
}

/**
 * Candidate source locations for a bundled program file, most-preferred first:
 *  - packaged extraResources (process.resourcesPath/programs)
 *  - the dev-tree "PROGRAMS TO REF AND USE" folder (running from source)
 */
function sourceCandidates(file) {
  const c = [];
  try { c.push(path.join(process.resourcesPath || '', 'programs', file)); } catch { /* none */ }
  c.push(path.join(__dirname, '..', '..', '..', 'PROGRAMS TO REF AND USE', file));
  c.push(path.join(app.getAppPath ? app.getAppPath() : '.', 'PROGRAMS TO REF AND USE', file));
  return c;
}

function findSource(file) {
  for (const p of sourceCandidates(file)) {
    try { if (p && fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return null;
}

/** Copy a program into the managed dir if it is not already there + current. */
function ensureCopied(prog) {
  const src = findSource(prog.file);
  const destDir = managedDir();
  const dest = path.join(destDir, prog.file);
  if (!src) return { dest, installed: fs.existsSync(dest), source: null };
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const need = !fs.existsSync(dest)
      || fs.statSync(dest).size !== fs.statSync(src).size;
    if (need) fs.copyFileSync(src, dest);
    return { dest, installed: true, source: src };
  } catch (e) {
    return { dest, installed: fs.existsSync(dest), source: src, error: e.message };
  }
}

/** List programs with their availability and (for Windows) launch readiness. */
function list() {
  return PROGRAMS.map((p) => {
    const src = findSource(p.file);
    const dest = path.join(managedDir(), p.file);
    let sizeBytes = null;
    try { if (src) sizeBytes = fs.statSync(src).size; } catch { /* unknown */ }
    return {
      id: p.id,
      name: p.name,
      desc: p.desc,
      tags: p.tags,
      file: p.file,
      available: Boolean(src) || fs.existsSync(dest),
      installed: fs.existsSync(dest),
      launchable: IS_WIN && (Boolean(src) || fs.existsSync(dest)),
      sizeBytes,
      platform: 'win',
    };
  });
}

/** Copy every available program into the managed folder (first-run hydrate). */
function hydrate() {
  const results = [];
  for (const p of PROGRAMS) {
    results.push({ id: p.id, ...ensureCopied(p) });
  }
  return results;
}

/** Launch a program by id. Copies it out first if needed. */
async function launch(id) {
  const prog = PROGRAMS.find((p) => p.id === id);
  if (!prog) return { ok: false, error: `Unknown program: ${id}` };
  if (!IS_WIN) {
    return { ok: false, error: 'These are Windows programs and cannot be launched on this OS.' };
  }
  const { dest, installed, error } = ensureCopied(prog);
  if (!installed) {
    return { ok: false, error: error || `${prog.file} is not available in this build.` };
  }
  const err = await shell.openPath(dest);
  if (err) return { ok: false, error: err };
  return { ok: true, path: dest };
}

/** Open the managed programs folder in the OS file manager. */
function openFolder() {
  const dir = managedDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  return shell.openPath(dir);
}

module.exports = {
  list, hydrate, launch, openFolder, managedDir, PROGRAMS,
};
