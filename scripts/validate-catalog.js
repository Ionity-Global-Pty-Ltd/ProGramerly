#!/usr/bin/env node
'use strict';
/* ProGramerly - catalog validator (run in CI)
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'src', 'main', 'catalog', 'catalog.json');
const cat = JSON.parse(fs.readFileSync(file, 'utf8'));

const errors = [];
const warnings = [];

const groupIds = new Set(cat.groups.map((g) => g.id));
const itemIds = new Set();
const profileKeys = new Set(Object.keys(cat.profiles));
const STEP_TYPES = new Set([
  'shell', 'vscodeExt', 'gitClone', 'workspace', 'mcpConfig',
  'chromeExt', 'venv', 'venvPip', 'scaffold',
]);
const SCAFFOLDS = new Set(['mern']);
const MCP_TARGETS = new Set(['claude', 'claude-code', 'kiro', 'cursor', 'windsurf']);
const LINUX_KEYS = new Set(['pre', 'steps', 'post', 'apt', 'dnf', 'pacman', 'zypper', 'flatpak', 'snap', 'npm', 'allowPartial']);
const WIN_KEYS = new Set(['pre', 'steps', 'post', 'winget', 'wingetArgs', 'choco', 'npm', 'allowPartial', 'stopOnFirstSuccess']);
const MAC_KEYS = new Set(['pre', 'steps', 'post', 'brew', 'brewCask', 'npm', 'allowPartial']);

for (const item of cat.items) {
  const at = `item "${item.id}"`;
  if (!item.id) errors.push('an item has no id');
  if (itemIds.has(item.id)) errors.push(`duplicate id: ${item.id}`);
  itemIds.add(item.id);
  if (!item.name) errors.push(`${at}: missing name`);
  if (!item.desc) warnings.push(`${at}: no description (the GUI will look empty)`);
  if (!groupIds.has(item.group)) errors.push(`${at}: unknown group "${item.group}"`);

  for (const p of item.profiles || []) {
    if (!profileKeys.has(p)) errors.push(`${at}: unknown profile "${p}"`);
  }
  for (const p of item.platforms || []) {
    if (!['win', 'mac', 'linux'].includes(p)) errors.push(`${at}: unknown platform "${p}"`);
  }

  const allSteps = [
    ...(item.steps || []),
    ...(item.win?.pre || []), ...(item.win?.steps || []), ...(item.win?.post || []),
    ...(item.mac?.pre || []), ...(item.mac?.steps || []), ...(item.mac?.post || []),
    ...(item.linux?.pre || []), ...(item.linux?.steps || []), ...(item.linux?.post || []),
  ];
  for (const [plat, keys] of [['win', WIN_KEYS], ['mac', MAC_KEYS], ['linux', LINUX_KEYS]]) {
    for (const k of Object.keys(item[plat] || {})) {
      if (!keys.has(k)) errors.push(`${at}: unknown key "${k}" in ${plat} spec`);
    }
  }
  for (const k of ['apt', 'dnf', 'pacman', 'zypper', 'flatpak', 'snap']) {
    const v = item.linux?.[k];
    if (v !== undefined && (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string' || !x.trim()))) {
      errors.push(`${at}: linux.${k} must be a non-empty list of package names`);
    }
  }
  for (const ref of item.linux?.flatpak || []) {
    if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+){2,}$/.test(ref)) errors.push(`${at}: "${ref}" is not a Flatpak application id`);
  }
  if (item.win?.stopOnFirstSuccess && !(item.win.winget || []).length) errors.push(`${at}: stopOnFirstSuccess without winget candidates`);
  if (item.linux && !(item.linux.apt || item.linux.dnf || item.linux.pacman || item.linux.zypper || item.linux.flatpak || item.linux.snap || item.linux.steps || item.linux.post || item.linux.npm)) {
    errors.push(`${at}: linux spec installs nothing`);
  }
  for (const s of allSteps) {
    if (!STEP_TYPES.has(s.type)) errors.push(`${at}: unknown step type "${s.type}"`);
    if (s.type === 'shell' && !s.cmd && !s.winCmd && !s.macCmd) {
      errors.push(`${at}: shell step with no command`);
    }
    if (s.type === 'gitClone' && (!s.repo || !s.dest)) errors.push(`${at}: gitClone needs repo + dest`);
    if (s.type === 'venvPip' && !(s.packages || []).length) errors.push(`${at}: venvPip with no packages`);
    if (s.type === 'chromeExt') {
      for (const e of s.ids || []) {
        if (!/^[a-p]{32}$/.test(e.id || '')) errors.push(`${at}: "${e.id}" is not a Chrome extension id`);
        if (!/^https:\/\//.test(e.url || '')) errors.push(`${at}: chromeExt "${e.id}" needs a store url`);
      }
    }
    if (s.type === 'scaffold' && !SCAFFOLDS.has(s.kind)) errors.push(`${at}: unknown scaffold "${s.kind}"`);
    if (s.type === 'mcpConfig' && s.target && !MCP_TARGETS.has(s.target)) errors.push(`${at}: unknown mcpConfig target "${s.target}"`);
    if (s.type === 'gitClone' && s.branch && !/^[\w.\/-]+$/.test(s.branch)) errors.push(`${at}: gitClone branch "${s.branch}" looks wrong`);
  }

  const hasWork = item.win || item.mac || item.linux || item.npm || item.steps;
  if (!hasWork) errors.push(`${at}: nothing to install on any platform`);
}

// Dependencies must exist and must not cycle.
const byId = new Map(cat.items.map((i) => [i.id, i]));
for (const item of cat.items) {
  for (const dep of item.dependsOn || []) {
    if (!byId.has(dep)) errors.push(`item "${item.id}": dependsOn unknown item "${dep}"`);
  }
}
const state = new Map();
const cycle = (id, trail = []) => {
  if (state.get(id) === 'done') return;
  if (state.get(id) === 'open') { errors.push(`dependency cycle: ${[...trail, id].join(' -> ')}`); return; }
  state.set(id, 'open');
  for (const dep of byId.get(id)?.dependsOn || []) cycle(dep, [...trail, id]);
  state.set(id, 'done');
};
for (const id of byId.keys()) cycle(id);

// Report -------------------------------------------------------------------
const counts = {};
for (const i of cat.items) counts[i.group] = (counts[i.group] || 0) + 1;
console.log(`ProGramerly catalog v${cat.meta.version} - ${cat.items.length} items in ${cat.groups.length} groups`);
for (const g of cat.groups) console.log(`  ${g.id.padEnd(11)} ${String(counts[g.id] || 0).padStart(2)}  ${g.label}`);
const cover = { win: 0, mac: 0, linux: 0 };
for (const i of cat.items) {
  for (const p of Object.keys(cover)) {
    const listed = Array.isArray(i.platforms) && i.platforms.length ? i.platforms.includes(p) : Boolean(i[p] || i.npm || i.steps);
    if (listed) cover[p] += 1;
  }
}
console.log(`  platforms   win ${cover.win}  mac ${cover.mac}  linux ${cover.linux}`);
for (const p of Object.keys(cat.profiles)) {
  const n = cat.items.filter((i) => (i.profiles || []).includes(p)).length;
  console.log(`  profile ${p.padEnd(8)} ${String(n).padStart(2)} items`);
}

if (warnings.length) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.error('\nErrors:');
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}
console.log('\ncatalog OK');
