#!/usr/bin/env node
'use strict';
/* ProGramerly - resolve a profile and print the exact plan without running it.
   Usage: node scripts/dry-run.js [profile] [win|mac]
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED */

const fs = require('node:fs');
const path = require('node:path');

const profile = process.argv[2] || 'full';
const plat = process.argv[3] || (process.platform === 'win32' ? 'win' : 'mac');
const cat = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'src', 'main', 'catalog', 'catalog.json'), 'utf8'));

const applies = (i) => (Array.isArray(i.platforms) && i.platforms.length
  ? i.platforms.includes(plat)
  : Boolean(i[plat] || i.npm || i.steps));

const byId = new Map(cat.items.map((i) => [i.id, i]));
const want = new Set(cat.items.filter((i) => applies(i) && (i.profiles || []).includes(profile)).map((i) => i.id));
let changed = true;
while (changed) {
  changed = false;
  for (const id of [...want]) {
    for (const d of byId.get(id)?.dependsOn || []) {
      if (byId.has(d) && !want.has(d) && applies(byId.get(d))) { want.add(d); changed = true; }
    }
  }
}
const queue = cat.items.filter((i) => want.has(i.id) && applies(i));

console.log(`\nProGramerly dry run  -  profile "${profile}"  platform "${plat}"  ${queue.length} items\n`);
let n = 0;
for (const item of queue) {
  n += 1;
  console.log(`[${String(n).padStart(2)}/${queue.length}] ${item.name}${item.elevate ? '   (needs admin)' : ''}`);
  const spec = item[plat] || {};
  for (const id of spec.winget || []) console.log(`        winget install --id ${id} --exact --silent${spec.wingetArgs ? ' …' : ''}`);
  const brew = spec.brew;
  for (const f of Array.isArray(brew) ? brew : (brew?.formula || [])) console.log(`        brew install ${f}`);
  for (const c of (brew && brew.cask) || spec.brewCask || []) console.log(`        brew install --cask ${c}`);
  const npm = spec.npm || item.npm;
  if (npm) console.log(`        npm install -g ${npm.join(' ')}`);
  for (const s of [...(spec.pre || []), ...(spec.steps || []), ...(item.steps || []), ...(spec.post || [])]) {
    const cmd = s.type === 'shell'
      ? (plat === 'mac' && s.macCmd ? s.macCmd : (plat === 'win' && s.winCmd ? s.winCmd : s.cmd))
      : `<${s.type}>${s.repo ? ` ${s.repo}` : ''}`
        + `${s.ids ? ` ${s.ids.length} item(s)` : ''}`
        + `${s.packages ? ` pip: ${s.packages.join(' ')}` : ''}`
        + `${s.kind ? ` ${s.kind} -> ${s.dest}` : ''}`;
    console.log(`        ${String(cmd).slice(0, 120)}${s.allowFail ? '   [non-fatal]' : ''}`);
  }
}
console.log(`\n${queue.length} items resolved. Nothing was executed.\n`);
