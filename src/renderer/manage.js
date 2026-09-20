'use strict';
/* ProGramerly - Environments and System surfaces
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   PGApps.envs    make, inspect and remove real environments: venv, uv,
                  conda, node, docker compose. AEDi drafts a recipe from a
                  sentence; the operator confirms; the real commands run and
                  stream back.
   PGApps.system  what is running, seen and unseen: processes, services,
                  startup entries, listening ports - with the single actions
                  that manage them.

   Every table is a read from the machine at the moment it was opened, with
   its source named. An empty read says why. */

(() => {
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const S = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    spark: S('<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    refresh: S('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
    folder: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.4h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    term: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>'),
    trash: S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    box: S('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
    py: S('<path d="M9 3h6v4H9zM9 17h6v4H9z"/><path d="M5 9h14v6H5z"/>'),
    node: S('<path d="M12 2l9 5v10l-9 5-9-5V7z"/>'),
  };
  const bytes = (n) => { const v = Number(n) || 0; if (!v) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), u.length - 1); const x = v / (1024 ** i); return `${x.toFixed(i < 2 || x >= 100 ? 0 : 1)} ${u[i]}`; };
  const consoleLine = (host, text, level) => {
    if (!host) return;
    const d = document.createElement('div'); d.className = `line ${level || ''}`; d.textContent = text;
    host.appendChild(d); host.scrollTop = host.scrollHeight;
    while (host.children.length > 400) host.removeChild(host.firstChild);
  };

  /* ====================================================================== *
   *  ENVIRONMENTS
   * ====================================================================== */

  const KIND_META = {
    venv: { label: 'Python venv', glyph: 'py', hint: 'python -m venv', fields: ['packages'] },
    uv: { label: 'uv venv', glyph: 'py', hint: 'uv venv · fast', fields: ['packages', 'python'] },
    conda: { label: 'Conda', glyph: 'py', hint: 'conda create', fields: ['packages', 'python'] },
    node: { label: 'Node project', glyph: 'node', hint: 'npm init', fields: ['deps', 'devDeps'] },
    docker: { label: 'Docker stack', glyph: 'box', hint: 'compose file', fields: ['services'] },
  };

  const envs = {
    async mount(host, h) {
      const api = h.api;
      let tools = null;
      let data = null;
      let busy = false;
      let spec = { kind: 'venv', name: '', python: '', packages: [], deps: [], devDeps: [], services: [{ image: '', ports: [] }], start: true, git: true };

      host.innerHTML = `
        <div class="mg-app">
          <div class="mg-top">
            <div class="mg-title">${I.box}<b>Environments</b><span class="mg-meta" id="envMeta">reading…</span></div>
            <div class="mg-tools">
              <button class="btn ghost" data-act="folder">${I.folder}Dev folder</button>
              <button class="btn ghost" data-act="refresh">${I.refresh}</button>
              <button class="btn primary" data-act="new">${I.plus}New environment</button>
            </div>
          </div>
          <div class="mg-builders" id="envTools"></div>
          <section class="mg-new" id="envNew" hidden></section>
          <div class="mg-grid" id="envList"><p class="empty">Reading the development root…</p></div>
          <div class="console short mg-console" id="envConsole"></div>
        </div>`;
      const root = host.querySelector('.mg-app');
      const $ = (s) => root.querySelector(s);
      const con = $('#envConsole');
      const offLog = api.envs.onLog((p) => consoleLine(con, p.text, p.level));

      function paintTools() {
        const t = tools; if (!t) return;
        const chip = (k, label) => `<span class="mg-chip ${t[k].ok ? 'ok' : 'off'}" title="${esc(t[k].version || `not installed - install "${t[k].installs}" from Software`)}"><i></i>${label}${t[k].ok ? '' : ' · install'}</span>`;
        $('#envTools').innerHTML = [chip('python', 'Python'), chip('uv', 'uv'), chip('conda', 'conda'), chip('node', 'Node'),
          `<span class="mg-chip ${t.docker.ok ? (t.docker.daemon ? 'ok' : 'warn') : 'off'}" title="${esc(t.docker.version || 'not installed')}"><i></i>Docker${t.docker.ok ? (t.docker.daemon ? '' : ' · daemon off') : ' · install'}</span>`,
          chip('git', 'git')].join('');
        $('#envTools').querySelectorAll('.mg-chip.off').forEach((c) => c.addEventListener('click', () => h.openApp('software')));
      }

      function card(e) {
        const meta = KIND_META[e.kind] || { glyph: 'box', label: e.kind };
        const actions = [];
        if (e.dir) actions.push(`<button class="btn ghost" data-do="open" title="Open folder">${I.folder}</button>`, `<button class="btn ghost" data-do="term" title="Terminal here">${I.term}</button>`);
        if (e.kind === 'venv' || e.kind === 'uv') actions.push('<button class="btn ghost" data-do="packages">Packages</button>', '<button class="btn ghost" data-do="freeze">Freeze</button>', '<button class="btn ghost" data-do="add">Add…</button>');
        if (e.kind === 'docker') actions.push('<button class="btn ghost" data-do="up">Up</button>', '<button class="btn ghost" data-do="down">Down</button>', '<button class="btn ghost" data-do="ps">Status</button>');
        actions.push(`<button class="btn ghost danger" data-do="remove" title="Remove">${I.trash}</button>`);
        return `<article class="mg-card" data-key="${esc(`${e.kind}:${e.dir || e.name}`)}">
          <div class="mg-card-head"><span class="mg-glyph">${I[meta.glyph]}</span><div><b>${esc(e.name)}</b><small>${esc(meta.label)}${e.python ? ` · ${esc(e.python)}` : ''}${e.status ? ` · ${esc(e.status)}` : ''}${e.deps != null ? ` · ${e.deps} deps${e.installed ? '' : ' · not installed'}` : ''}${e.active ? ' · active' : ''}</small></div></div>
          ${e.dir ? `<code class="mg-path" title="${esc(e.dir)}">${esc(e.dir)}</code>` : ''}
          <div class="mg-card-actions">${actions.join('')}</div>
          <div class="mg-card-out" hidden></div>
        </article>`;
      }

      function paintList() {
        const rows = (data && data.rows) || [];
        $('#envMeta').textContent = data ? `${rows.length} found under ${data.roots.join(', ')}` : '';
        $('#envList').innerHTML = rows.length ? rows.map(card).join('') : '<p class="empty">No environments under the development root yet. <b>New environment</b> makes one.</p>';
        $('#envList').querySelectorAll('.mg-card').forEach((el) => {
          const e = rows.find((x) => `${x.kind}:${x.dir || x.name}` === el.dataset.key);
          el.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => doAction(e, b.dataset.do, el)));
        });
      }

      async function doAction(e, what, el) {
        const out = el.querySelector('.mg-card-out');
        const show = (html) => { out.hidden = false; out.innerHTML = html; };
        try {
          if (what === 'open') return api.openPath(e.dir);
          if (what === 'term') { const r = await api.envs.terminal(e.dir); return h.toast(r.ok ? r.detail : r.error, r.ok ? 'good' : 'bad'); }
          if (what === 'packages') {
            show('<small>reading pip list…</small>');
            const r = await api.envs.packages(e.dir);
            return show(r.ok ? `<small>${r.rows.length} packages</small><div class="mg-pkgs">${r.rows.map((p) => `<span>${esc(p.name)} <i>${esc(p.version)}</i></span>`).join('')}</div>` : `<small class="bad">${esc(r.error)}</small>`);
          }
          if (what === 'freeze') { const r = await api.envs.freeze(e.dir); return h.toast(r.ok ? `requirements.txt written · ${r.count} lines` : r.error, r.ok ? 'good' : 'bad'); }
          if (what === 'add') {
            show(`<div class="row2"><input type="text" placeholder="packages, space separated - e.g. numpy pandas" /><button class="btn">Install</button></div>`);
            const input = out.querySelector('input'); const btn = out.querySelector('button');
            btn.addEventListener('click', async () => {
              const pkgs = input.value.trim().split(/\s+/).filter(Boolean); if (!pkgs.length) return;
              btn.disabled = true; const r = await api.envs.install(e.dir, pkgs); btn.disabled = false;
              h.toast(r.ok ? `Installed into ${e.name}.` : r.error, r.ok ? 'good' : 'bad');
            });
            return input.focus();
          }
          if (what === 'up' || what === 'down' || what === 'ps') { const r = await api.envs.compose(e.dir, what); return h.toast(r.ok ? `${e.name}: ${what} done - see the log` : r.error, r.ok ? 'good' : 'bad'); }
          if (what === 'remove') {
            if (!window.confirm(`Remove ${e.name}?\n${e.dir || e.name}\nThis deletes the environment${e.kind === 'docker' ? ' and its containers and volumes' : ''}.`)) return;
            const r = await api.envs.remove(e);
            h.toast(r.ok ? `${e.name} removed.` : r.error, r.ok ? 'good' : 'bad');
            if (r.ok) await load();
          }
        } catch (err) { h.toast(err.message || String(err), 'bad'); }
      }

      /* ------------------------------------------------------ the maker */

      function paintNew() {
        const sec = $('#envNew'); sec.hidden = false;
        const m = KIND_META[spec.kind];
        sec.innerHTML = `
          <div class="mg-new-head">
            <div class="mg-kinds">${Object.entries(KIND_META).map(([k, v]) => `<button class="mg-kind${spec.kind === k ? ' on' : ''}" data-kind="${k}">${I[v.glyph]}<b>${esc(v.label)}</b><small>${esc(v.hint)}</small></button>`).join('')}</div>
            <button class="aw-close" data-act="close-new">✕</button>
          </div>
          <div class="mg-ai">
            <span class="ai-orb"></span>
            <input type="text" id="envPrompt" placeholder="Tell AEDi what you need - e.g. FastAPI + Postgres for a sensor API" />
            <button class="btn" id="envRecipeBtn">${I.spark}Draft it</button>
            <small id="envRecipeNote"></small>
          </div>
          <div class="mg-form">
            <label><span>Name</span><input type="text" id="envName" value="${esc(spec.name)}" placeholder="my-project" /></label>
            ${m.fields.includes('python') ? `<label><span>Python</span><input type="text" id="envPython" value="${esc(spec.python || '')}" placeholder="3.12 (optional)" /></label>` : ''}
            ${m.fields.includes('packages') ? `<label class="wide"><span>Python packages</span><input type="text" id="envPackages" value="${esc(spec.packages.join(' '))}" placeholder="numpy pandas fastapi (space separated)" /></label>` : ''}
            ${m.fields.includes('deps') ? `<label class="wide"><span>Dependencies</span><input type="text" id="envDeps" value="${esc(spec.deps.join(' '))}" placeholder="express zod" /></label><label class="wide"><span>Dev dependencies</span><input type="text" id="envDevDeps" value="${esc(spec.devDeps.join(' '))}" placeholder="typescript vitest" /></label>` : ''}
            ${m.fields.includes('services') ? `<div class="wide mg-services" id="envServices">${spec.services.map((s, i) => `
              <div class="mg-svc" data-i="${i}"><input type="text" class="svc-name" value="${esc(s.name || '')}" placeholder="name" /><input type="text" class="svc-image" value="${esc(s.image || '')}" placeholder="image:tag e.g. postgres:16" /><input type="text" class="svc-ports" value="${esc((s.ports || []).join(' '))}" placeholder="ports 5432:5432" /><input type="text" class="svc-env" value="${esc(Object.entries(s.env || {}).map(([k, v]) => `${k}=${v}`).join(' '))}" placeholder="ENV=value" /><button class="btn ghost" data-rm="${i}">✕</button></div>`).join('')}
              <button class="btn ghost" id="envAddSvc">${I.plus}Service</button></div>
              <label class="check inline"><input type="checkbox" id="envStart" ${spec.start ? 'checked' : ''} /><span>docker compose up after writing</span></label>` : ''}
            ${spec.kind !== 'conda' && spec.kind !== 'docker' ? `<label class="check inline"><input type="checkbox" id="envGit" ${spec.git ? 'checked' : ''} /><span>git init</span></label>` : ''}
          </div>
          <div class="mg-new-actions"><small id="envWhy">${esc(spec.why || '')}</small><button class="btn primary" id="envCreateBtn">${I.plus}Create</button></div>`;

        sec.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { readForm(); spec.kind = b.dataset.kind; paintNew(); }));
        sec.querySelector('[data-act="close-new"]').addEventListener('click', () => { sec.hidden = true; });
        sec.querySelector('#envRecipeBtn').addEventListener('click', recipe);
        sec.querySelector('#envPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') recipe(); });
        sec.querySelector('#envCreateBtn').addEventListener('click', create);
        const add = sec.querySelector('#envAddSvc'); if (add) add.addEventListener('click', () => { readForm(); spec.services.push({ image: '', ports: [] }); paintNew(); });
        sec.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { readForm(); spec.services.splice(Number(b.dataset.rm), 1); if (!spec.services.length) spec.services.push({ image: '', ports: [] }); paintNew(); }));
      }

      function readForm() {
        const v = (id) => { const el = $(`#${id}`); return el ? el.value.trim() : null; };
        const words = (id) => { const s = v(id); return s == null ? null : s.split(/[\s,]+/).filter(Boolean); };
        if (v('envName') != null) spec.name = v('envName');
        if (v('envPython') != null) spec.python = v('envPython');
        if (words('envPackages')) spec.packages = words('envPackages');
        if (words('envDeps')) spec.deps = words('envDeps');
        if (words('envDevDeps')) spec.devDeps = words('envDevDeps');
        const start = $('#envStart'); if (start) spec.start = start.checked;
        const git = $('#envGit'); if (git) spec.git = git.checked;
        const svcs = $('#envServices');
        if (svcs) {
          spec.services = [...svcs.querySelectorAll('.mg-svc')].map((row) => ({
            name: row.querySelector('.svc-name').value.trim() || undefined,
            image: row.querySelector('.svc-image').value.trim(),
            ports: row.querySelector('.svc-ports').value.trim().split(/[\s,]+/).filter(Boolean),
            env: Object.fromEntries(row.querySelector('.svc-env').value.trim().split(/\s+/).filter((x) => x.includes('=')).map((x) => x.split('='))),
          }));
        }
      }

      async function recipe() {
        const prompt = $('#envPrompt').value.trim(); if (!prompt) return;
        const note = $('#envRecipeNote'); const btn = $('#envRecipeBtn'); const orb = root.querySelector('.mg-ai .ai-orb');
        btn.disabled = true; orb.classList.add('busy'); note.textContent = 'AEDi is drafting…';
        try {
          const r = await api.envs.recipe(prompt);
          if (!r.ok) { note.textContent = r.error; return; }
          spec = { ...spec, ...r.spec, services: r.spec.services.length ? r.spec.services : [{ image: '', ports: [] }] };
          paintNew();
          $('#envPrompt').value = prompt;
          $('#envRecipeNote').textContent = `${r.model} drafted a ${r.spec.kind}. Check it, then Create.`;
          h.toast('Recipe drafted - nothing has been created yet.', 'good');
        } catch (e) { note.textContent = e.message || String(e); } finally { btn.disabled = false; orb.classList.remove('busy'); }
      }

      async function create() {
        if (busy) return;
        readForm();
        if (!spec.name) { h.toast('Give it a name.', 'bad'); $('#envName').focus(); return; }
        busy = true; const btn = $('#envCreateBtn'); btn.disabled = true; btn.textContent = 'Creating…';
        consoleLine(con, `— creating ${spec.kind} "${spec.name}" —`);
        try {
          const r = await api.envs.create(spec);
          h.toast(r.ok ? `${spec.name} is ready${r.dir ? ` at ${r.dir}` : ''}.` : `Not created: ${r.error}`, r.ok ? 'good' : 'bad');
          if (r.ok) { $('#envNew').hidden = true; spec = { ...spec, name: '', packages: [], deps: [], devDeps: [], services: [{ image: '', ports: [] }], why: '' }; await load(); }
        } catch (e) { h.toast(e.message || String(e), 'bad'); } finally { busy = false; btn.disabled = false; btn.innerHTML = `${I.plus}Create`; }
      }

      async function load() {
        try { [tools, data] = await Promise.all([api.envs.tools(), api.envs.list()]); paintTools(); paintList(); } catch (e) { $('#envList').innerHTML = `<p class="empty bad">${esc(e.message || e)}</p>`; }
      }

      root.querySelectorAll('.mg-tools [data-act]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.act === 'folder') api.openDevRoot();
        if (b.dataset.act === 'refresh') load();
        if (b.dataset.act === 'new') { if ($('#envNew').hidden) paintNew(); else $('#envNew').hidden = true; }
      }));

      await load();
      if (h.focus === 'new') paintNew();
      return () => offLog();
    },
  };

  /* ====================================================================== *
   *  SYSTEM - processes, services, startup, ports
   * ====================================================================== */

  const system = {
    async mount(host, h) {
      const api = h.api;
      let tab = h.focus || 'processes';
      let rows = { processes: null, services: null, startup: null, listeners: null };
      let q = '';
      let sort = { processes: 'rss', services: 'state', startup: 'source', listeners: 'port' };
      let showMs = false;
      let auto = null;

      host.innerHTML = `
        <div class="mg-app">
          <div class="mg-top">
            <div class="mg-title">${I.box}<b>System</b><span class="mg-meta" id="sysMeta">reading…</span></div>
            <div class="mg-tools">
              <input class="rel-search" id="sysSearch" type="search" placeholder="Filter…" autocomplete="off" />
              <label class="check inline"><input type="checkbox" id="sysAuto" /><span>Live</span></label>
              <button class="btn ghost" data-act="refresh">${I.refresh}</button>
            </div>
          </div>
          <div class="mg-tabs" id="sysTabs">
            <button data-tab="processes">Processes<b></b></button>
            <button data-tab="services">Services<b></b></button>
            <button data-tab="startup">Startup<b></b></button>
            <button data-tab="listeners">Ports<b></b></button>
          </div>
          <div class="mg-table-wrap"><table class="mg-table" id="sysTable"></table></div>
          <div class="console short mg-console" id="sysConsole"></div>
        </div>`;
      const root = host.querySelector('.mg-app');
      const $ = (s) => root.querySelector(s);
      const con = $('#sysConsole');
      const offLog = api.sys.onLog((p) => consoleLine(con, p.text, p.level));

      const filt = (list, keys) => { const s = q.toLowerCase(); return s ? list.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(s))) : list; };
      const by = (key, desc) => (a, b) => { const x = a[key] ?? '', y = b[key] ?? ''; const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return desc ? -r : r; };

      function head(cols) {
        return `<thead><tr>${cols.map(([k, label]) => `<th data-sort="${k}" class="${sort[tab] === k ? 'on' : ''}">${label}</th>`).join('')}<th></th></tr></thead>`;
      }

      function paint() {
        const d = rows[tab];
        const t = $('#sysTable');
        root.querySelectorAll('#sysTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
        for (const k of Object.keys(rows)) { const b = root.querySelector(`#sysTabs [data-tab="${k}"] b`); if (b) b.textContent = rows[k] && rows[k].available ? rows[k].rows.length : ''; }
        if (!d) { t.innerHTML = '<tbody><tr><td class="empty">reading…</td></tr></tbody>'; return; }
        if (!d.available) { t.innerHTML = `<tbody><tr><td class="empty bad">${esc(d.reason)} <small>(${esc(d.source)})</small></td></tr></tbody>`; return; }
        $('#sysMeta').textContent = `${d.rows.length} from ${d.source} · ${new Date(d.at).toLocaleTimeString()}`;
        let list; let html;
        if (tab === 'processes') {
          list = filt(d.rows, ['name', 'pid', 'path', 'cmd', 'company', 'user']).sort(by(sort.processes, sort.processes === 'rss' || sort.processes === 'cpuSec' || sort.processes === 'cpuPct'));
          const cpuKey = d.rows.some((r) => r.cpuPct != null) ? 'cpuPct' : 'cpuSec';
          html = head([['name', 'Process'], ['pid', 'PID'], ['rss', 'Memory'], [cpuKey, cpuKey === 'cpuPct' ? 'CPU %' : 'CPU s'], ['hidden', 'Session'], ['path', 'Path']])
            + `<tbody>${list.slice(0, 400).map((r) => `<tr class="${r.hidden ? 'unseen' : ''}"><td><b>${esc(r.name)}</b>${r.company ? `<small>${esc(r.company)}</small>` : ''}</td><td>${r.pid}</td><td>${bytes(r.rss)}</td><td>${r[cpuKey] == null ? '—' : r[cpuKey]}</td><td>${r.hidden ? 'system' : 'yours'}</td><td class="path" title="${esc(r.path || r.cmd || '')}">${esc(r.path || r.cmd || '—')}</td>
              <td class="acts">${r.path ? `<button class="btn ghost" data-do="open" data-pid="${r.pid}" title="Open location">${I.folder}</button>` : ''}<button class="btn ghost danger" data-do="kill" data-pid="${r.pid}">End</button></td></tr>`).join('')}</tbody>`;
        } else if (tab === 'services') {
          const base = showMs ? d.rows : d.rows.filter((r) => !r.microsoft);
          list = filt(base, ['name', 'label', 'state', 'start', 'desc', 'path']).sort(by(sort.services));
          html = `<caption><label class="check inline"><input type="checkbox" id="sysMs" ${showMs ? 'checked' : ''} /><span>Show Microsoft / system services (${d.rows.length - base.length + (showMs ? 0 : 0)} hidden)</span></label></caption>`
            + head([['label', 'Service'], ['state', 'State'], ['start', 'Start'], ['pid', 'PID'], ['path', 'Path']])
            + `<tbody>${list.slice(0, 500).map((r) => `<tr><td><b>${esc(r.label)}</b><small>${esc(r.name)}${r.desc ? ` · ${esc(String(r.desc).slice(0, 90))}` : ''}</small></td><td><i class="st ${esc(r.state)}"></i>${esc(r.state)}</td><td>${esc(r.start)}</td><td>${r.pid || '—'}</td><td class="path" title="${esc(r.path || '')}">${esc(r.path || '—')}</td>
              <td class="acts">${r.state === 'running' ? `<button class="btn ghost" data-do="svc" data-name="${esc(r.name)}" data-action="restart">Restart</button><button class="btn ghost danger" data-do="svc" data-name="${esc(r.name)}" data-action="stop">Stop</button>` : `<button class="btn ghost" data-do="svc" data-name="${esc(r.name)}" data-action="start">Start</button>`}</td></tr>`).join('')}</tbody>`;
        } else if (tab === 'startup') {
          list = filt(d.rows, ['name', 'command', 'source', 'kind']).sort(by(sort.startup));
          html = `<caption>${d.rows.length} entries · disabled entries are backed up first <button class="btn ghost" id="sysBackups">Backups</button>${d.elevated === false ? ' · machine-wide entries need <b>Run as admin</b>' : ''}</caption>`
            + head([['name', 'Entry'], ['source', 'Where'], ['scope', 'Scope'], ['command', 'Command']])
            + `<tbody>${list.map((r, i) => `<tr class="${r.enabled ? '' : 'off'}"><td><b>${esc(r.name)}</b><small>${esc(r.kind)}${r.state ? ` · ${esc(r.state)}` : ''}${r.disabledAt ? ` · disabled ${new Date(r.disabledAt).toLocaleDateString()}` : ''}</small></td><td>${esc(r.source)}</td><td>${esc(r.scope)}</td><td class="path" title="${esc(r.command || '')}">${esc(r.command || '—')}</td>
              <td class="acts">${r.enabled ? `<button class="btn ghost danger" data-do="disable" data-i="${i}">Disable</button>` : `<button class="btn ghost" data-do="enable" data-i="${i}">Enable</button>`}</td></tr>`).join('')}</tbody>`;
          list.forEach((r, i) => { r._i = i; });
        } else {
          const procs = (rows.processes && rows.processes.rows) || [];
          const name = (pid) => { const p = procs.find((x) => x.pid === pid); return p ? p.name : ''; };
          list = filt(d.rows.map((r) => ({ ...r, owner: name(r.pid) })), ['port', 'address', 'pid', 'owner', 'proto']).sort(by(sort.listeners));
          html = head([['port', 'Port'], ['proto', 'Proto'], ['address', 'Bound to'], ['pid', 'PID'], ['owner', 'Process']])
            + `<tbody>${list.map((r) => `<tr><td><b>${r.port}</b></td><td>${esc(r.proto)}</td><td>${esc(r.address)}</td><td>${r.pid || '—'}</td><td>${esc(r.owner || r.name || '—')}</td>
              <td class="acts"><button class="btn ghost" data-do="port" data-port="${r.port}">Inspect</button>${r.pid ? `<button class="btn ghost danger" data-do="kill" data-pid="${r.pid}">End owner</button>` : ''}</td></tr>`).join('')}</tbody>`;
        }
        t.innerHTML = html;
        t.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => { sort[tab] = th.dataset.sort; paint(); }));
        const ms = t.querySelector('#sysMs'); if (ms) ms.addEventListener('change', () => { showMs = ms.checked; paint(); });
        const bk = t.querySelector('#sysBackups'); if (bk) bk.addEventListener('click', () => api.sys.openBackups());
        t.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => act(b, list)));
      }

      async function act(b, list) {
        const what = b.dataset.do;
        try {
          if (what === 'kill') {
            const pid = Number(b.dataset.pid); const p = ((rows.processes && rows.processes.rows) || []).find((x) => x.pid === pid);
            if (!window.confirm(`End ${p ? p.name : `pid ${pid}`} (pid ${pid})?`)) return;
            b.disabled = true; const r = await api.sys.kill(pid);
            h.toast(r.ok ? `Ended pid ${pid}.` : r.error, r.ok ? 'good' : 'bad'); await load(tab === 'listeners' ? ['processes', 'listeners'] : ['processes']);
          } else if (what === 'open') {
            const p = ((rows.processes && rows.processes.rows) || []).find((x) => x.pid === Number(b.dataset.pid));
            if (p && p.path) api.openPath(p.path.replace(/[\\/][^\\/]+$/, ''));
          } else if (what === 'svc') {
            if (b.dataset.action === 'stop' && !window.confirm(`Stop ${b.dataset.name}?`)) return;
            b.disabled = true; const r = await api.sys.service(b.dataset.name, b.dataset.action);
            h.toast(r.ok ? `${b.dataset.name}: ${r.state}` : r.error, r.ok ? 'good' : 'bad'); await load(['services']);
          } else if (what === 'disable' || what === 'enable') {
            const entry = list[Number(b.dataset.i)]; if (!entry) return;
            if (what === 'disable' && !window.confirm(`Disable "${entry.name}" at startup? It is backed up first and can be re-enabled here.`)) return;
            b.disabled = true; const r = what === 'disable' ? await api.sys.startupDisable(entry) : await api.sys.startupEnable(entry);
            h.toast(r.ok ? `${entry.name} ${what}d.` : r.error, r.ok ? 'good' : 'bad'); await load(['startup']);
          } else if (what === 'port') {
            h.openApp('doctor'); setTimeout(() => { const i = document.getElementById('docPort'); if (i) { i.value = b.dataset.port; document.getElementById('docPortBtn')?.click(); } }, 300);
          }
        } catch (e) { h.toast(e.message || String(e), 'bad'); }
      }

      async function load(which) {
        const want = which || [tab, ...(tab === 'listeners' ? ['processes'] : [])];
        const calls = { processes: api.sys.processes, services: api.sys.services, startup: api.sys.startup, listeners: api.sys.listeners };
        await Promise.all(want.map(async (k) => { try { rows[k] = await calls[k](); } catch (e) { rows[k] = { available: false, reason: e.message || String(e), rows: [], source: k }; } }));
        paint();
      }

      root.querySelectorAll('#sysTabs [data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); if (!rows[tab]) load(); }));
      $('#sysSearch').addEventListener('input', (e) => { q = e.target.value.trim(); paint(); });
      root.querySelector('[data-act="refresh"]').addEventListener('click', () => load());
      $('#sysAuto').addEventListener('change', (e) => { clearInterval(auto); auto = e.target.checked ? setInterval(() => load(), 5000) : null; });

      paint();
      await load();
      return () => { clearInterval(auto); offLog(); };
    },
  };

  window.PGApps = Object.assign(window.PGApps || {}, { envs, system });
})();
