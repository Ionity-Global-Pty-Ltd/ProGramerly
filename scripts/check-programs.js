#!/usr/bin/env node
'use strict';
/* ProGramerly - verify the bundled-utilities payload against its manifest
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   src/main/data/programs.json pins every Windows utility by byte size and
   SHA-256. This script checks that manifest for shape, then - when the payload
   folder is present - hashes each file and refuses to let a mismatched or
   truncated executable into an installer.

     node scripts/check-programs.js            manifest + payload if present
     node scripts/check-programs.js --strict   payload folder is REQUIRED
     node scripts/check-programs.js --write-sums
                                               also write SHA256-programs.txt
                                               into the payload folder

   Exit code is non-zero on any defect. No dependencies. */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'src', 'main', 'data', 'programs.json');
const strict = process.argv.includes('--strict');
const writeSums = process.argv.includes('--write-sums');

const problems = [];
const say = (line) => console.log(line);

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const payload = manifest.payload || {};
  const programs = Array.isArray(manifest.programs) ? manifest.programs : [];

  for (const key of ['repo', 'tag', 'checksums', 'localFolder', 'resourceFolder']) {
    if (!payload[key] || typeof payload[key] !== 'string') problems.push(`payload.${key} is missing`);
  }
  if (!programs.length) problems.push('manifest lists no programs');

  const ids = new Set();
  const files = new Set();
  for (const p of programs) {
    const where = `program "${p.id || '?'}"`;
    if (!p.id || ids.has(p.id)) problems.push(`${where}: id missing or duplicated`);
    ids.add(p.id);
    if (!p.file || files.has(p.file) || /[\\/]/.test(p.file)) problems.push(`${where}: file missing, duplicated or contains a path separator`);
    files.add(p.file);
    if (!p.name) problems.push(`${where}: name missing`);
    if (!Number.isInteger(p.expectedBytes) || p.expectedBytes <= 0) problems.push(`${where}: expectedBytes must be a positive integer`);
    if (!/^[0-9a-f]{64}$/.test(String(p.sha256 || ''))) problems.push(`${where}: sha256 must be 64 lowercase hex characters`);
    if (!['utility', 'application', 'installer'].includes(p.kind)) problems.push(`${where}: kind must be utility | application | installer`);
  }
  say(`manifest: ${programs.length} programs pinned for release ${payload.repo}@${payload.tag}`);

  const folder = path.join(root, payload.localFolder || 'PROGRAMS TO REF AND USE');
  if (!fs.existsSync(folder)) {
    if (strict) problems.push(`payload folder is missing: ${folder}`);
    else say(`payload folder not present (${payload.localFolder}) - installers built from this tree ship without the integrated Ionity tools`);
  } else {
    const sums = [];
    for (const p of programs) {
      const file = path.join(folder, p.file);
      if (!fs.existsSync(file)) {
        (strict ? problems : []).push(`${p.file} is missing from the payload folder`);
        say(`  - ${p.file}: absent${strict ? '' : ' (not in this build)'}`);
        continue;
      }
      const size = fs.statSync(file).size;
      if (size !== p.expectedBytes) {
        problems.push(`${p.file}: ${size} bytes on disk, manifest pins ${p.expectedBytes}`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const digest = await sha256(file);
      if (digest !== p.sha256) {
        problems.push(`${p.file}: SHA-256 ${digest} does not match the manifest pin ${p.sha256}`);
        continue;
      }
      sums.push(`${digest}  *${p.file}`);
      say(`  ok ${p.file}  ${size} bytes  ${digest}`);
    }
    if (writeSums && sums.length) {
      const out = path.join(folder, payload.checksums || 'SHA256-programs.txt');
      fs.writeFileSync(out, `${sums.join('\n')}\n`);
      say(`wrote ${path.relative(root, out)}`);
    }
    // Anything else in the folder is not part of the pinned payload and must
    // not ride along into resources/programs.
    for (const entry of fs.readdirSync(folder)) {
      if (entry === (payload.checksums || 'SHA256-programs.txt')) continue;
      if (!files.has(entry) && /\.(exe|msi|dll)$/i.test(entry)) problems.push(`unpinned executable in payload folder: ${entry}`);
    }
  }

  if (problems.length) {
    for (const problem of problems) console.error(`  x ${problem}`);
    process.exit(1);
  }
  say('programs payload OK');
}

main().catch((error) => {
  console.error(`  x ${error.message}`);
  process.exit(1);
});
