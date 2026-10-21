#!/usr/bin/env node
'use strict';
/* ProGramerly 3.9.0 - engine + platform unit tests (no network, no root).
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
   Run: node scripts/test-engine.js */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
// The askpass server lives in this process, so the helper must run async.
const runAsync = (f) => new Promise((res) => { execFile(f, { encoding: 'utf8' }, (err, out) => res({ code: err ? (err.code || 1) : 0, out })); });

// Electron is not loaded in unit tests; give services the few calls they make.
const Module = require('node:module');
const realLoad = Module._load;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-'));
Module._load = function load(req, ...rest) {
  if (req === 'electron') {
    return {
      app: { getPath: () => scratch, getVersion: () => '3.9.0', isPackaged: false, quit() {}, setLoginItemSettings() {}, getLoginItemSettings: () => ({}) },
      shell: { openPath: async () => '' },
    };
  }
  return realLoad.call(this, req, ...rest);
};

let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`  ok   ${name}`); } catch (e) { fail += 1; console.log(`  FAIL ${name} - ${e.message}`); }
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };

(async () => {
  const runner = require('../src/main/installer/runner');
  const engine = require('../src/main/installer/engine');
  const { cmpVersion } = require('../src/main/services/updater');

  console.log('\nupdater.cmpVersion');
  for (const [a, b, w] of [['3.10.0', '3.9.0', 1], ['3.9.0+7', '3.9.0', 0], ['3.9.0-rc10', '3.9.0-rc2', 1],
    ['3.9.0', '3.9.0-rc1', 1], ['v3.8', '3.8.0', 0], ['3.7.0', '3.9.0', -1], ['1.0.0-alpha', '1.0.0-alpha.1', -1]]) {
    // eslint-disable-next-line no-await-in-loop
    await t(`${a} vs ${b} = ${w}`, () => eq(cmpVersion(a, b), w));
  }

  if (process.platform === 'linux') {
    console.log('\nengine.sudoize (Linux)');
    await t('pkexec goes through env(1) so VAR=value works', () => eq(
      engine.sudoize('sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git', 'pkexec env '),
      'pkexec env DEBIAN_FRONTEND=noninteractive apt-get install -y git'));
    await t('chained sudo all rewritten', () => eq(
      engine.sudoize('sudo apt-get update && sudo -E apt-get install -y x; if true; then sudo snap install y; fi', 'pkexec env '),
      'pkexec env apt-get update && pkexec env apt-get install -y x; if true; then pkexec env snap install y; fi'));
    await t('askpass mode adds -A once', () => eq(
      engine.sudoize('sudo apt-get update && sudo -A true', 'sudo -A '), 'sudo -A apt-get update && sudo -A true'));
    await t('root drops sudo', () => eq(engine.sudoize('sudo apt-get install -y x', ''), 'apt-get install -y x'));
    await t('no usable sudo fails fast (-n)', () => eq(engine.sudoize('sudo dnf install -y x', 'sudo -n '), 'sudo -n dnf install -y x'));
    await t('pseudo/sudoku words untouched', () => eq(engine.sudoize('echo pseudo sudoku', 'pkexec env '), 'echo pseudo sudoku'));
  }

  if (process.platform !== 'win32') {
    console.log('\nrunner');
    await t('runs and streams lines', async () => {
      const lines = [];
      const r = await runner.run('echo one; echo two 1>&2', { onLine: (l) => lines.push(l) });
      eq(r.code, 0); eq(lines.sort(), ['one', 'two']);
    });
    await t('no controlling terminal (own session)', async () => {
      const r = await runner.run('tty || true');
      if (!/not a tty/i.test(r.output)) throw new Error(r.output.trim());
    });
    await t('killAll stops the step and its children', async () => {
      const started = Date.now();
      const p = runner.run('sleep 30 & sleep 30; echo never');
      setTimeout(() => runner.killAll(), 400);
      const r = await p;
      if (Date.now() - started > 8000) throw new Error('took too long');
      if (/never/.test(r.output)) throw new Error('kept running');
    });
    await t('timeout kills the tree', async () => {
      const r = await runner.run('sleep 20', { timeoutMs: 500 });
      eq(r.timedOut, true);
    });
    await t('output kept bounded', async () => {
      const r = await runner.run('head -c 3000000 /dev/zero | tr "\\0" "x"; echo; echo END');
      if (r.output.length > 1100000) throw new Error(`kept ${r.output.length} bytes`);
      if (!/END/.test(r.output)) throw new Error('lost the tail');
    });
    await t('has() rejects shell metacharacters', async () => eq(await runner.has('ls; rm -rf /'), false));
    await t('base env reaches children', async () => {
      runner.setBaseEnv({ PG_TEST_VAR: 'yes' });
      const r = await runner.run('echo $PG_TEST_VAR');
      runner.setBaseEnv({});
      eq(r.output.trim(), 'yes');
    });

    console.log('\naskpass');
    const askpass = require('../src/main/installer/askpass');
    await t('helper returns the password through the socket, then forgets it', async () => {
      const res = await askpass._serve('s3cr3t pw');
      eq(res.ok, true);
      const helper = askpass.env().SUDO_ASKPASS;
      const st = fs.statSync(path.dirname(helper));
      eq((st.mode & 0o777).toString(8), '700');
      // run the helper the way sudo would, with plain node standing in for Electron
      const text = fs.readFileSync(helper, 'utf8').replace(/ELECTRON_RUN_AS_NODE=1 exec '[^']+'/, `exec '${process.execPath}'`);
      const shim = `${helper}.test.sh`;
      fs.writeFileSync(shim, text, { mode: 0o700 });
      eq((await runAsync(shim)).out, 's3cr3t pw\n');
      const env = fs.readFileSync(helper, 'utf8');
      if (env.includes('s3cr3t')) throw new Error('password written to disk');
      askpass.end();
      eq(askpass.active(), false);
      eq(fs.existsSync(helper), false);
    });
    await t('wrong token gets nothing', async () => {
      await askpass._serve('pw');
      const helper = askpass.env().SUDO_ASKPASS;
      const text = fs.readFileSync(helper, 'utf8')
        .replace(/PROGRAMERLY_ASKPASS_TOKEN='[^']+'/, "PROGRAMERLY_ASKPASS_TOKEN='nope'")
        .replace(/ELECTRON_RUN_AS_NODE=1 exec '[^']+'/, `exec '${process.execPath}'`);
      const shim = `${helper}.bad.sh`;
      fs.writeFileSync(shim, text, { mode: 0o700 });
      const { code } = await runAsync(shim);
      askpass.end();
      eq(code, 1);
    });
  }

  console.log('\nmcp-config');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.APPDATA = path.join(home, 'AppData');
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  process.env.PROGRAMERLY_DEV_ROOT = path.join(home, 'Development');
  delete require.cache[require.resolve('../src/main/installer/mcp-config')];
  const mcp = require('../src/main/installer/mcp-config');
  for (const target of Object.keys(mcp.TARGETS)) {
    // eslint-disable-next-line no-await-in-loop
    await t(`${target}: merge keeps user entries, second run is a no-op`, () => {
      const f = mcp.configPath(target);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ other: 1, mcpServers: { memory: { command: 'mine' } } }));
      const r1 = mcp.writeConfig(() => {}, target);
      eq(r1.ok, true);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      eq(j.other, 1); eq(j.mcpServers.memory.command, 'mine');
      if (!j.mcpServers.filesystem) throw new Error('filesystem not added');
      if (!r1.backup || !fs.existsSync(r1.backup)) throw new Error('no backup');
      const r2 = mcp.writeConfig(() => {}, target);
      eq(r2.added.length, 0); eq(r2.backup, undefined);
    });
  }
  await t('invalid JSON is never overwritten', () => {
    const f = mcp.configPath('claude-code');
    fs.writeFileSync(f, '{ broken');
    const r = mcp.writeConfig(() => {}, 'claude-code');
    eq(r.ok, false); eq(fs.readFileSync(f, 'utf8'), '{ broken');
  });
  await t('time server uses this machine\'s zone', () => {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    eq(mcp.serverDefs().time.args.slice(-1)[0], z);
  });
  await t('Windows npx servers go through cmd /c', () => {
    const d = mcp.serverDefs().memory;
    if (process.platform === 'win32') eq([d.command, d.args[0], d.args[1]], ['cmd', '/c', 'npx']);
    else eq(d.command, 'npx');
  });

  console.log('\ntasks.gitClone');
  await t('a clone pinned to a tag is left alone on re-run (no failing pull)', async () => {
    const tasks = require('../src/main/installer/tasks');
    const src = path.join(home, 'src-repo');
    fs.mkdirSync(src);
    const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'ignore' });
    g('init', '-q'); fs.writeFileSync(path.join(src, 'a'), '1');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'); g('tag', 'v1.0');
    const url = src;
    eq(await tasks.gitClone(url, 'Hardware/pinned', () => {}, { branch: 'v1.0' }), 0);
    eq(await tasks.gitClone(url, 'Hardware/pinned', () => {}, { branch: 'v1.0' }), 0);
  });

  console.log('\nsettings');
  await t('torn write falls back to the .bak copy', () => {
    const settings = require('../src/main/services/settings');
    settings.save({ installedIds: ['git', 'node'] });
    settings.save({ installedIds: ['git', 'node', 'python'] });
    fs.writeFileSync(settings.file(), '{"installedIds": ["git"');
    delete require.cache[require.resolve('../src/main/services/settings')];
    const fresh = require('../src/main/services/settings');
    eq(fresh.get('installedIds'), ['git', 'node']);
  });
  await t('devRoot setting reaches the installer', () => {
    delete require.cache[require.resolve('../src/main/services/settings')];
    const settings = require('../src/main/services/settings');
    settings.save({ devRoot: path.join(home, 'Code') });
    eq(mcp.devRoot(), path.join(home, 'Code'));
    settings.save({ devRoot: '' });
  });

  console.log('\nsync.lastSlotBefore');
  await t('missed 08:00 slot is found at 09:00', () => {
    const sync = require('../src/main/services/sync');
    const now = new Date(2026, 9, 16, 9, 0, 0);
    const s = sync.lastSlotBefore(['08:00', '20:00'], now);
    eq([s.getHours(), s.getDate()], [8, 16]);
    const s2 = sync.lastSlotBefore(['08:00', '20:00'], new Date(2026, 9, 16, 7, 0, 0));
    eq([s2.getHours(), s2.getDate()], [20, 15]);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  try { fs.rmSync(scratch, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); } catch { /* tmp */ }
  process.exit(fail ? 1 : 0);
})();
