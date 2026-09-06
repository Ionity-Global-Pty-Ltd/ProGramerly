#!/usr/bin/env node
'use strict';
/* ProGramerly - parse every shipped source file
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   electron-builder will happily package a file with a syntax error in it.
   This walks src/ and scripts/, parses each .js as a module or script, and
   parses each .json - so a broken build fails here rather than on a user's
   machine. */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const roots = ['src', 'scripts'];
const errors = [];
let checked = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (entry.name.endsWith('.js')) {
      checked += 1;
      try {
        // eslint-disable-next-line no-new
        new vm.Script(fs.readFileSync(full, 'utf8'), { filename: full });
      } catch (err) {
        errors.push(`${path.relative(root, full)}: ${err.message}`);
      }
    } else if (entry.name.endsWith('.json')) {
      checked += 1;
      try { JSON.parse(fs.readFileSync(full, 'utf8')); }
      catch (err) { errors.push(`${path.relative(root, full)}: ${err.message}`); }
    }
  }
}

for (const r of roots) walk(path.join(root, r));

console.log(`parsed ${checked} files`);
if (errors.length) {
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}
console.log('all sources parse cleanly');
