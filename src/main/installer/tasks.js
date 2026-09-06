'use strict';
/**
 * ProGramerly - non-package task types
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 */

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./runner');
const { devRoot } = require('./mcp-config');

const IS_WIN = process.platform === 'win32';

/** Install a list of VS Code extensions, tolerating individual failures. */
async function vscodeExtensions(ids, log) {
  const bin = IS_WIN ? 'code.cmd' : 'code';
  let ok = 0;
  let failed = 0;
  for (const id of ids) {
    const { code } = await run(`${bin} --install-extension ${id} --force`, {
      onLine: (l) => log(`  ${l}`),
      timeoutMs: 4 * 60 * 1000,
    });
    if (code === 0) { ok += 1; } else { failed += 1; log(`  ! could not install ${id}`); }
  }
  log(`extensions installed: ${ok}, failed: ${failed}`);
  return failed === 0 ? 0 : (ok > 0 ? 0 : 1);
}

/** Clone a repo into the dev root, or pull if it is already there. */
async function gitClone(repo, dest, log) {
  const root = devRoot();
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, dest);

  if (fs.existsSync(path.join(target, '.git'))) {
    log(`${dest} already cloned - pulling latest`);
    const { code } = await run(`git -C "${target}" pull --ff-only`, { onLine: (l) => log(`  ${l}`) });
    return code;
  }

  log(`cloning ${repo} -> ${target}`);
  const { code, output } = await run(`git clone --depth 1 "${repo}" "${target}"`, {
    onLine: (l) => log(`  ${l}`),
    timeoutMs: 10 * 60 * 1000,
  });
  if (code !== 0 && /Authentication|could not read Username|403|not found/i.test(output)) {
    log('  repo is private or needs auth - run `gh auth login`, then re-run this item');
  }
  return code;
}

/** Standard Ionity dev tree + a Policy 986 AED marker at the root. */
async function workspace(log) {
  const root = devRoot();
  const dirs = [
    'Projects', 'Clients', 'POC', 'Scripts', 'Assets',
    'Hardware', 'Docs', 'Archive', 'Sandbox', '.mcp',
  ];
  for (const d of dirs) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  const readme = path.join(root, 'README-IONITY.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      '# Ionity Development Root',
      '',
      'Created by **ProGramerly - Basic Coding Software for All**.',
      '',
      '| Folder | Use |',
      '| --- | --- |',
      '| `Projects/` | Active internal builds |',
      '| `Clients/` | Client engagements |',
      '| `POC/` | Proofs of concept |',
      '| `Scripts/` | Automation, installers, one-offs |',
      '| `Assets/` | Brand and media assets |',
      '| `Hardware/` | Firmware, PCB, ESP32/RPi |',
      '| `Docs/` | Specifications and documentation |',
      '| `Archive/` | Closed work |',
      '| `Sandbox/` | Throwaway experiments |',
      '| `.mcp/` | MCP server state and memory |',
      '',
      '---',
      '',
      'Governance: **Policy 986 AED** · Licence: AED 900 / CC BY-NC-SA 4.0 where stated',
      '(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All rights reserved - TM',
      'Author: Johan Wilhelm van Antwerp · https://www.ionity.today',
      '',
      '_Building Tomorrow, Today._',
      '',
    ].join('\n'), 'utf8');
    log(`wrote ${readme}`);
  }
  log(`workspace ready at ${root}`);
  return 0;
}

/* ------------------------------------------------------------------------ *
 *  Step types added in 1.1.0
 * ------------------------------------------------------------------------ */

/** Path to the managed virtual environment ProGramerly owns. */
function venvPath() {
  return path.join(devRoot(), '.venvs', 'ionity');
}

/** The python inside that venv, spelled for this OS. */
function venvPython() {
  return IS_WIN
    ? path.join(venvPath(), 'Scripts', 'python.exe')
    : path.join(venvPath(), 'bin', 'python');
}

/**
 * Create (or repair) the managed virtual environment. Nothing else in
 * ProGramerly writes to the system Python - every AI, data and embedded item
 * installs in here, which is what makes the whole set removable in one folder.
 */
async function pythonVenv(log) {
  const target = venvPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (fs.existsSync(venvPython())) {
    log(`virtual environment already present at ${target}`);
    return 0;
  }

  const candidates = IS_WIN
    ? ['py -3 -m venv', 'python -m venv', 'python3 -m venv']
    : ['python3 -m venv', 'python -m venv'];

  for (const base of candidates) {
    log(`$ ${base} "${target}"`);
    // eslint-disable-next-line no-await-in-loop
    const { code } = await run(`${base} "${target}"`, { onLine: (l) => log(`  ${l}`), timeoutMs: 6 * 60 * 1000 });
    if (code === 0 && fs.existsSync(venvPython())) {
      log(`virtual environment ready at ${target}`);
      return 0;
    }
  }
  log('could not create the virtual environment - install Python first, then re-run this item');
  return 1;
}

/** pip install into the managed venv. */
async function venvPip(packages, args, log) {
  if (!packages.length) return 0;
  const py = venvPython();
  if (!fs.existsSync(py)) {
    log('managed virtual environment is missing - creating it now');
    const made = await pythonVenv(log);
    if (made !== 0) return 1;
  }
  const cmd = `"${py}" -m pip install --upgrade ${args ? `${args} ` : ''}${packages.join(' ')}`;
  log(`$ ${cmd}`);
  const { code } = await run(cmd, { onLine: (l) => log(`  ${l}`), timeoutMs: 60 * 60 * 1000 });
  if (code !== 0) log(`  pip exited ${code}`);
  return code;
}

/**
 * Chrome extensions.
 *
 * With administrator rights on Windows this writes Chrome's documented
 * ExtensionInstallForcelist policy, and Chrome installs both extensions the
 * next time it starts. Without those rights - and on macOS and Linux - the
 * Web Store page for each extension is opened so it is one click away.
 */
async function chromeExtensions(list, log) {
  if (!list.length) return 0;
  const UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
  let policyOk = false;

  if (IS_WIN) {
    const key = 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist';
    const sets = list.map((e, i) => `New-ItemProperty -LiteralPath '${key}' -Name '${i + 1}' `
      + `-PropertyType String -Value '${e.id};${UPDATE_URL}' -Force | Out-Null`).join('; ');
    const script = `if(-not (Test-Path -LiteralPath '${key}')){ New-Item -Path '${key}' -Force | Out-Null }; ${sets}; 'policy-written'`;
    const { code, output } = await run(script, { timeoutMs: 30000 });
    policyOk = code === 0 && /policy-written/.test(output);
    if (policyOk) {
      log('Chrome policy updated - both extensions install themselves the next time Chrome starts:');
      for (const e of list) log(`  ${e.name} (${e.id})`);
    } else {
      log('could not write the Chrome policy (that needs Administrator) - opening the Web Store instead');
    }
  }

  if (!policyOk) {
    for (const e of list) {
      log(`opening the Web Store page for ${e.name}`);
      const cmd = IS_WIN ? `Start-Process '${e.url}'`
        : (process.platform === 'darwin' ? `open "${e.url}"` : `xdg-open "${e.url}"`);
      // eslint-disable-next-line no-await-in-loop
      await run(cmd, { timeoutMs: 20000 });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 700); });
    }
    log('click "Add to Chrome" on each tab to finish');
  }
  return 0;
}

/* ------------------------------------------------------------ scaffolds -- */

const SCAFFOLDS = {
  mern: {
    label: 'MERN starter (MongoDB + Express + React + Node)',
    files: {
      'package.json': JSON.stringify({
        name: 'mern-starter',
        private: true,
        version: '0.1.0',
        description: 'MERN starter generated by ProGramerly - Ionity (Pty) Ltd',
        scripts: {
          dev: 'concurrently -n server,client -c cyan,green "npm --prefix server run dev" "npm --prefix client run dev"',
          install: 'npm --prefix server install && npm --prefix client install',
          start: 'npm --prefix server start',
        },
        devDependencies: { concurrently: '^9.1.0' },
      }, null, 2),
      'README.md': [
        '# MERN starter',
        '',
        'Generated by **ProGramerly - Basic Coding Software for All**.',
        '',
        '```bash',
        'npm install          # root tooling',
        'npm run install      # server + client dependencies',
        'npm run dev          # API on :4000, React on :5173',
        '```',
        '',
        'The API falls back to an in-memory store when `MONGODB_URI` is not set,',
        'so `npm run dev` works before MongoDB is running.',
        '',
        '---',
        'Policy 986 AED · (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd',
        '',
      ].join('\n'),
      '.gitignore': 'node_modules/\ndist/\n.env\n',
      'server/package.json': JSON.stringify({
        name: 'mern-starter-server',
        version: '0.1.0',
        type: 'module',
        main: 'index.js',
        scripts: { dev: 'nodemon index.js', start: 'node index.js' },
        dependencies: { express: '^4.21.0', cors: '^2.8.5', mongoose: '^8.8.0', dotenv: '^16.4.5' },
        devDependencies: { nodemon: '^3.1.7' },
      }, null, 2),
      'server/.env.example': 'PORT=4000\nMONGODB_URI=mongodb://127.0.0.1:27017/mern_starter\n',
      'server/index.js': [
        "import express from 'express';",
        "import cors from 'cors';",
        "import mongoose from 'mongoose';",
        "import 'dotenv/config';",
        '',
        'const app = express();',
        'app.use(cors());',
        'app.use(express.json());',
        '',
        'const memory = [];',
        'let connected = false;',
        '',
        'const NoteSchema = new mongoose.Schema(',
        '  { text: { type: String, required: true } },',
        '  { timestamps: true },',
        ');',
        "const Note = mongoose.model('Note', NoteSchema);",
        '',
        'if (process.env.MONGODB_URI) {',
        '  mongoose.connect(process.env.MONGODB_URI)',
        "    .then(() => { connected = true; console.log('mongo connected'); })",
        "    .catch((e) => console.warn('mongo unavailable, using memory store:', e.message));",
        '}',
        '',
        "app.get('/api/health', (_req, res) => res.json({ ok: true, store: connected ? 'mongodb' : 'memory' }));",
        '',
        "app.get('/api/notes', async (_req, res) => {",
        '  if (connected) return res.json(await Note.find().sort({ createdAt: -1 }));',
        '  return res.json(memory);',
        '});',
        '',
        "app.post('/api/notes', async (req, res) => {",
        "  const text = String(req.body.text || '').trim();",
        "  if (!text) return res.status(400).json({ error: 'text is required' });",
        '  if (connected) return res.status(201).json(await Note.create({ text }));',
        '  const note = { _id: String(Date.now()), text, createdAt: new Date().toISOString() };',
        '  memory.unshift(note);',
        '  return res.status(201).json(note);',
        '});',
        '',
        'const port = process.env.PORT || 4000;',
        'app.listen(port, () => console.log(`API on http://localhost:${port}`));',
        '',
      ].join('\n'),
      'client/package.json': JSON.stringify({
        name: 'mern-starter-client',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
        devDependencies: { '@vitejs/plugin-react': '^4.3.3', vite: '^5.4.10' },
      }, null, 2),
      'client/vite.config.js': [
        "import { defineConfig } from 'vite';",
        "import react from '@vitejs/plugin-react';",
        '',
        'export default defineConfig({',
        '  plugins: [react()],',
        "  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },",
        '});',
        '',
      ].join('\n'),
      'client/index.html': [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        '    <meta charset="utf-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
        '    <title>MERN starter</title>',
        '  </head>',
        '  <body>',
        '    <div id="root"></div>',
        '    <script type="module" src="/src/main.jsx"></script>',
        '  </body>',
        '</html>',
        '',
      ].join('\n'),
      'client/src/main.jsx': [
        "import React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import App from './App.jsx';",
        '',
        "createRoot(document.getElementById('root')).render(<App />);",
        '',
      ].join('\n'),
      'client/src/App.jsx': [
        "import React, { useEffect, useState } from 'react';",
        '',
        'export default function App() {',
        '  const [notes, setNotes] = useState([]);',
        "  const [text, setText] = useState('');",
        "  const [store, setStore] = useState('…');",
        '',
        '  const load = () => fetch(\'/api/notes\').then((r) => r.json()).then(setNotes);',
        '',
        '  useEffect(() => {',
        "    fetch('/api/health').then((r) => r.json()).then((h) => setStore(h.store));",
        '    load();',
        '  }, []);',
        '',
        '  const add = async (e) => {',
        '    e.preventDefault();',
        '    if (!text.trim()) return;',
        "    await fetch('/api/notes', {",
        "      method: 'POST',",
        "      headers: { 'Content-Type': 'application/json' },",
        '      body: JSON.stringify({ text }),',
        '    });',
        "    setText('');",
        '    load();',
        '  };',
        '',
        '  return (',
        '    <main style={{ fontFamily: \'system-ui, sans-serif\', maxWidth: 620, margin: \'48px auto\', padding: 16 }}>',
        '      <h1 style={{ marginBottom: 4 }}>MERN starter</h1>',
        '      <p style={{ color: \'#667\', marginTop: 0 }}>store: {store}</p>',
        '      <form onSubmit={add} style={{ display: \'flex\', gap: 8, margin: \'20px 0\' }}>',
        '        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note"',
        '               style={{ flex: 1, padding: 10, borderRadius: 8, border: \'1px solid #ccd\' }} />',
        '        <button type="submit" style={{ padding: \'10px 18px\', borderRadius: 8 }}>Add</button>',
        '      </form>',
        '      <ul style={{ paddingLeft: 18 }}>',
        '        {notes.map((n) => <li key={n._id} style={{ marginBottom: 6 }}>{n.text}</li>)}',
        '      </ul>',
        '    </main>',
        '  );',
        '}',
        '',
      ].join('\n'),
    },
  },
};

/** Write a starter project into the dev root without ever overwriting work. */
async function scaffold(kind, dest, log) {
  const spec = SCAFFOLDS[kind];
  if (!spec) { log(`unknown scaffold "${kind}" - skipped`); return 0; }
  const root = path.join(devRoot(), dest);

  if (fs.existsSync(root) && fs.readdirSync(root).length) {
    log(`${root} already exists and is not empty - left exactly as it is`);
    return 0;
  }

  for (const [rel, body] of Object.entries(spec.files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
  }
  log(`${spec.label} written to ${root}`);
  log('  next: npm install && npm run install && npm run dev');
  return 0;
}

module.exports = {
  vscodeExtensions,
  gitClone,
  workspace,
  pythonVenv,
  venvPip,
  chromeExtensions,
  scaffold,
  venvPath,
  venvPython,
};
