'use strict';
/* ProGramerly - the Ai-OS shell (renderer)
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Layout lifted from IONITY Ai-OS 1.6.0: top bar, hero with the ask box, a
   lower deck (workstation dome + four stats + module tiles), a dock, and an
   app window that every workspace opens into. This file is the shell only.
   The workspaces themselves are the existing ProGramerly views: they are
   parked in #apps-store and moved into #aw-content when opened, so all of
   renderer.js keeps working unchanged - showTab() is wrapped, not replaced.

   Loaded by renderer.js after its own definitions, so every top-level
   binding of renderer.js (api, $, VIEWS, showTab, boot, INFO, SETTINGS,
   CATALOG, aiTargets, send, loadTargets, ...) is in scope here. */

(() => {
  /* ------------------------------------------------------------ registry */
  const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const GLYPH = {
    software: SVG('<path d="M12 3v18M3 12h18"/><rect x="4" y="4" width="16" height="16" rx="4"/>'),
    ai: SVG('<path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z"/>'),
    projects: SVG('<path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
    monitor: SVG('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
    network: SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    hardware: SVG('<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6"/>'),
    doctor: SVG('<path d="M12 21s-7-4.5-7-11a7 7 0 0 1 14 0c0 6.5-7 11-7 11z"/><path d="M12 8v6M9 11h6"/>'),
    terminals: SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>'),
    maintenance: SVG('<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2 2 0 0 1-2.8-2.8l9.4-9.4z"/>'),
    updates: SVG('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
    settings: SVG('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
    fans: SVG('<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 2-7 5-7 1.5 0 2 1.5 1 3-1.2 1.8-3.5 3-6 4M14 12c4 0 7 2 7 5 0 1.5-1.5 2-3 1-1.8-1.2-3-3.5-4-6M12 14c0 4-2 7-5 7-1.5 0-2-1.5-1-3 1.2-1.8 3.5-3 6-4M10 12c-4 0-7-2-7-5 0-1.5 1.5-2 3-1 1.8 1.2 3 3.5 4 6"/>'),
    cic: SVG('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/>'),
    mcp: SVG('<path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    about: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    dome: SVG('<path d="M3 17a9 9 0 0 1 18 0"/><path d="M2 17h20"/><path d="M6.5 17a5.5 5.5 0 0 1 11 0"/><path d="M12 8V5"/>'),
  };
  /* Segment icons live with the DOME surface so both use the same set. */
  const SEG = () => (window.PGApps && window.PGApps.GLYPHS) || {};

  /* One entry per dock button / tile. `tab` is the renderer.js VIEWS key the
     app shows (fans reuses the Hardware workspace); `tool` is a programs.json
     id; `launch` means the app is the tool itself and opens no window. */
  const APPS = {
    software: { name: 'Software', sub: 'Provision a complete toolchain', view: 'softwareApp', tab: 'software', hue: '#2f7ff0', scope: 'toolchain', desc: 'Profiles, catalogue, one elevated install run.' },
    ai: { name: 'Local AI', sub: 'Models, chat, GPU and environments', view: 'aiView', tab: 'ai', hue: '#00c8f0', scope: 'intelligence', desc: 'Ollama on this machine. Nothing leaves it.' },
    projects: { name: 'Projects', sub: 'Git state across every workspace', view: 'projectsView', tab: 'projects', hue: '#8b7cf5', scope: 'repos', desc: 'Every repository under the dev root, live.' },
    monitor: { name: 'Monitor', sub: 'Telemetry, disks and network history', view: 'monitorView', tab: 'monitor', hue: '#bdd631', scope: 'all', desc: 'The gauges behind the dome, in detail.' },
    network: { name: 'Network', sub: 'Sweep, throughput and official links', view: 'networkView', tab: 'network', hue: '#2f7ff0', scope: 'services-ports', desc: 'Regions, speed test, link registry.' },
    hardware: { name: 'Hardware', sub: 'Sensors, cooling, RGB and memory', view: 'hardwareView', tab: 'hardware', hue: '#f0a03c', scope: 'hardware', desc: 'Sensors, fans, RGB and RAM.' },
    doctor: { name: 'Doctor', sub: 'Diagnostics, cleanup and ports', view: 'doctorView', tab: 'doctor', hue: '#f0686a', scope: 'health-scan', desc: 'Scan, then fix - with a report folder.' },
    terminals: { name: 'Terminals', sub: 'Open a real installed shell', view: 'terminalsView', tab: 'terminals', hue: '#5d7181', scope: 'env-path', desc: 'PowerShell, cmd, Git Bash, WSL, Nushell.' },
    maintenance: { name: 'Maintenance', sub: 'Registry repair and system tools', view: 'maintView', tab: 'maintenance', hue: '#a9762d', scope: 'registry', desc: 'Documented registry fixes, exported first.' },
    updates: { name: 'Operations', sub: 'Updates, sync and releases', view: 'updatesView', tab: 'updates', hue: '#3d8f63', scope: 'toolchain', desc: 'Update checks, scheduled sync, push & release.' },
    settings: { name: 'Settings', sub: 'Profile, startup and application controls', view: 'settingsView', tab: 'settings', hue: '#5d7181', desc: 'Startup, tray, kiosk, profile.' },
    // Ionity tools - capabilities of ProGramerly, laid out the Ai-OS way
    dome: { name: 'The Ionity DOME', sub: 'Five strata · 24 segments · the sets behind them', builtin: 'dome', hue: '#00c8f0', scope: 'all', desc: 'The workstation as structure, drillable, with the local model reporting from the real sets.' },
    fans: { name: 'Fan control', sub: 'Channels · curves · thermal sources', builtin: 'fans', tool: 'fanzi', hue: '#00c8f0', scope: 'thermal', desc: 'Every fan channel, the curves that drive them, and what each would command right now.' },
    cic: { name: 'CiC', sub: 'Central Ionity Control', tool: 'cic', launch: true, hue: '#0e9ab8', desc: 'The IONITY CiC workstation utility.' },
    mcp: { name: 'MCP audit', sub: 'Internal side tool · maintainers', tool: 'mcp-audit', launch: true, side: true, hue: '#8b7cf5', desc: 'Internal. Asks before it runs.' },
    about: { name: 'About ProGramerly', sub: 'Ionity (Pty) Ltd · AEDI', about: true, hue: '#00c8f0', desc: '' },
  };
  const TILE_ORDER = ['dome', 'software', 'ai', 'projects', 'fans', 'cic', 'monitor', 'doctor'];

  /* One hue per stratum. The dome, its legend and every segment icon carry it,
     so the deck reads as five subjects rather than five grey rings. */
  const STRATUM_HUE = {
    hardware: '#f0a03c', system: '#8b7cf5', storage: '#bdd631',
    toolchain: '#2f7ff0', intelligence: '#00c8f0',
  };
  const STAT_HUE = { cpu: '#00c8f0', mem: '#8b7cf5', disk: '#bdd631', net: '#2f7ff0' };

  /* The five shell accents. Chosen in Settings; applied to the ambient field,
     the orb, the ask box and every primary control through one variable. */
  const ACCENTS = {
    cyan: '#00c8f0', blue: '#2f7ff0', violet: '#8b7cf5', lime: '#bdd631', amber: '#f0a03c',
  };

  let tools = [];                 // programs.list()
  let mounted = null;             // { id, el } currently in the app window
  let shellSettings = {};
  let lastMetrics = null;
  let aiSetup = null;             // null | 'install' | 'pull' | 'busy'
  let aiPulling = false;
  let preferredTarget = null;
  let aiList = [];                // api.aiTargets() - the models on this machine
  let domePresets = [];           // the analysis presets in the registry
  let domeTimer = null;           // the re-read interval, rebuilt when it changes
  let briefBusy = false;
  let askSeq = 0;

  const safe = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, Number(v) || 0));
  const setText = (id, t) => { const e = $(id); if (e) e.textContent = t; };
  const store = () => $('apps-store');

  function humanBytes(n) {
    n = Number(n) || 0; if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
    const v = n / (1024 ** i); return `${v.toFixed(i < 2 || v >= 100 ? 0 : 1)} ${u[i]}`;
  }
  function humanBits(bps) {
    const v = (Number(bps) || 0) * 8;
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} Gb/s`; if (v >= 1e6) return `${(v / 1e6).toFixed(1)} Mb/s`;
    if (v >= 1e3) return `${Math.round(v / 1e3)} kb/s`; return `${Math.round(v)} b/s`;
  }
  function humanDuration(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return `${d ? `${d}d ` : ''}${h}h ${m}m`;
  }

  let toastTimer = null;
  function toast(text, kind = '') {
    const t = $('toast'); setText('toast-text', text);
    t.className = kind; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3400);
  }

  /* ------------------------------------------------------ window manager */
  const coreShowTab = showTab;

  function tabOf(id) { const a = APPS[id]; return a && a.tab ? a.tab : id; }

  function closeApp() {
    if (teardown) { try { teardown(); } catch { /* best effort */ } teardown = null; }
    detachAwAnswer();
    if (mounted) {
      // Park the workspace again; renderer.js state inside it is untouched.
      store().appendChild(mounted.el);
      mounted = null;
    }
    $('overlay').classList.remove('on');
    $('overlay').setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.dock-btn.active').forEach((b) => b.classList.remove('active'));
    activeTab = 'home';
  }

  function paintAppHead(id, app) {
    $('aw-glyph').innerHTML = GLYPH[id] || GLYPH.about;
    $('aw-name').innerHTML = `${safe(app.name)}<span id="aw-sub">${safe(app.sub || '')}</span>`;
    const extra = $('aw-extra'); extra.innerHTML = '';
    if (app.tool) {
      const tool = tools.find((t) => t.id === app.tool);
      const b = document.createElement('button');
      b.className = 'btn primary'; b.id = 'aw-tool-btn';
      b.textContent = tool && tool.available ? `Open ${tool.product || app.name}` : `${app.name} · not in this build`;
      b.disabled = !(tool && tool.launchable);
      b.addEventListener('click', () => launchTool(app.tool, b));
      extra.appendChild(b);
    }
    addAskControl(id, app, extra);
  }

  /* Built-in surfaces (the DOME, fan control) are mounted into their own
     element rather than being one of renderer.js's views. Each may return a
     teardown, which runs when the window closes. */
  const builtinEls = new Map();
  let teardown = null;

  /* The window is shown first and the surface loads inside it. A built-in
     surface reads this machine to draw itself; making the operator wait on a
     blank deck for that read would be the wrong way round. */
  function mountBuiltin(id, kind, opts = {}) {
    if (!window.PGApps || !window.PGApps[kind]) {
      toast(`The ${APPS[id].name} surface did not load.`, 'bad');
      return false;
    }
    let el = builtinEls.get(id);
    if (!el) {
      el = document.createElement('main');
      el.id = `${id}App`;
      el.className = 'view pad';
      builtinEls.set(id, el);
      store().appendChild(el);
    }
    $('aw-content').appendChild(el);
    mounted = { id, el, builtin: true };
    activeTab = id;
    Promise.resolve()
      .then(() => window.PGApps[kind].mount(el, { api, toast, openApp, focus: opts.focus, safe }))
      .then((fn) => { if (mounted && mounted.id === id) teardown = fn || null; })
      .catch((error) => {
        if (!mounted || mounted.id !== id) return;
        el.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = `This surface failed to open: ${error.message || error}`;
        el.appendChild(p);
      });
    return true;
  }

  async function openApp(id, opts = {}) {
    const app = APPS[id]; if (!app) return;
    if (id === '_ask') { $('ask-input').focus(); return; }
    if (app.launch) { await launchTool(app.tool); return; }
    if (mounted && mounted.id !== id) closeApp();
    if (app.builtin) {
      const done = mountBuiltin(id, app.builtin, opts);
      if (!done) return;
    } else if (app.about) {
      mountAbout();
    } else {
      coreShowTab(tabOf(id));              // renderer.js: visibility, lazy loaders, activeTab
      const el = $(app.view);
      if (!el) return;
      if (!mounted || mounted.el !== el) { $('aw-content').appendChild(el); mounted = { id, el }; }
    }
    paintAppHead(id, app);
    $('overlay').classList.add('on');
    $('overlay').setAttribute('aria-hidden', 'false');
    document.querySelectorAll('.dock-btn').forEach((b) => b.classList.toggle('active', b.dataset.app === id));
    if (app.tool === 'fanzi') toast('Fan control: the sensors are live below - open Fanzi for the curves.', 'good');
  }

  function mountAbout() {
    let el = $('aboutApp');
    if (!el) {
      el = document.createElement('main'); el.id = 'aboutApp'; el.className = 'view pad';
      el.innerHTML = `<section class="card">
        <h3>ProGramerly · Basic Coding Software for All</h3>
        <p class="muted">One combined Ionity workstation: the Ai-OS operator layout, a complete toolchain installer, live telemetry, local AI through Ollama, and the Ionity tools - fan control, CiC - built in and verified against their SHA-256 pins before they run.</p>
        <p class="muted" id="aboutVersionLine"></p>
        <p class="muted">Governance: Policy 986 AED · Licence AED 900 · © 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All rights reserved - TM<br>Author: Johan Wilhelm van Antwerp · <a href="https://www.ionity.today">ionity.today</a> · <a href="https://www.ionity.co.za">ionity.co.za</a><br><i>Building Tomorrow, Today.</i></p>
      </section>`;
      store().appendChild(el);
    }
    el.hidden = false;
    setText('aboutVersionLine', `Version ${INFO.appVersion} · ${INFO.osLabel || ''} · ${INFO.elevated ? 'Administrator' : 'Standard user'}`);
    $('aw-content').appendChild(el); mounted = { id: 'about', el };
  }

  // Wrap renderer.js navigation: any showTab() from a button inside a
  // workspace now lands in the app window too.
  showTab = function shellShowTab(tab) {
    if (!VIEWS[tab]) return;
    openApp(tab);
  };

  async function launchTool(toolId, button) {
    const tool = tools.find((t) => t.id === toolId);
    const app = Object.values(APPS).find((a) => a.tool === toolId) || { name: toolId };
    if (!tool) { toast(`${app.name} is not part of this build.`, 'bad'); return; }
    if (!tool.launchable) {
      toast(tool.available ? `${app.name} runs on Windows only.` : `${app.name} is not in this build - install the full Windows release.`, 'bad');
      return;
    }
    if (tool.requiresConfirmation && !window.confirm(`${tool.product || app.name} is a setup program. Verify and start it now?`)) return;
    const label = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Verifying…'; }
    toast(`Hash-checking ${tool.product || app.name}…`);
    try {
      const r = await api.programs.launch(toolId);
      toast(r.ok ? `${tool.product || app.name} opened from its verified copy.` : `${app.name}: ${r.error || 'could not launch'}`, r.ok ? 'good' : 'bad');
    } catch (e) { toast(`${app.name}: ${e.message || e}`, 'bad'); }
    await loadTools();
    if (button) { button.textContent = label; button.disabled = !tool.launchable; }
  }

  /* -------------------------------------------------------------- tiles */
  function tileLive(id) {
    const app = APPS[id];
    if (!app.tool) return 1;
    const t = tools.find((x) => x.id === app.tool);
    if (!t) return 0;
    if (t.integrity === 'invalid') return 2;
    return t.available ? 1 : 0;
  }
  function buildTiles() {
    const host = $('modules'); host.innerHTML = '';
    TILE_ORDER.forEach((id) => {
      const app = APPS[id];
      const b = document.createElement('button');
      b.className = 'tile'; b.dataset.app = id; b.dataset.live = String(tileLive(id));
      if (app.side) b.dataset.side = '1';
      b.style.setProperty('--hue', hexToRgba(app.hue, 0.18));
      const live = b.dataset.live;
      b.innerHTML = `<span class="tile-glyph">${GLYPH[id]}</span>
        <span><b>${safe(app.name)}</b><p>${safe(app.desc)}</p></span>
        <span class="st"><i></i>${live === '1' ? 'Live' : live === '2' ? 'Check' : app.tool ? 'Not in build' : 'Ready'}</span>`;
      b.addEventListener('click', () => openApp(id));
      host.appendChild(b);
    });
    host.addEventListener('pointermove', (e) => {
      const t = e.target.closest('.tile'); if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
      t.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    });
  }
  const hueFill = (hex, a) => hexToRgba(hex, a);

  function hexToRgba(hex, a) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return `rgba(0,200,240,${a})`;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  }

  async function loadTools() {
    try { tools = await api.programs.list(); } catch { tools = []; }
    document.querySelectorAll('#modules .tile').forEach((t) => {
      const id = t.dataset.app; if (!APPS[id] || !APPS[id].tool) return;
      const live = String(tileLive(id)); t.dataset.live = live;
      const st = t.querySelector('.st'); if (st) st.innerHTML = `<i></i>${live === '1' ? 'Live' : live === '2' ? 'Check' : 'Not in build'}`;
    });
    if (mounted && APPS[mounted.id] && APPS[mounted.id].tool) paintAppHead(mounted.id, APPS[mounted.id]);
  }

  /* --------------------------------------------------- dome + stats + bar */
  /* The card on the deck is the DOME's own overview, not a second opinion:
     five strata scored by services/dome.js from the registered sets, painted
     here, and drillable into the full surface. */

  let domeData = null;
  let domeBusy = false;

  const W = 360;
  const H = 200;
  const CX = 180;
  const CY = 190;

  function ringPath(ro, ri) {
    return `M${CX - ro},${CY} A${ro},${ro} 0 0 1 ${CX + ro},${CY} L${CX + ri},${CY} A${ri},${ri} 0 0 0 ${CX - ri},${CY} Z`;
  }

  function buildDome(strata) {
    const svg = $('dome-svg');
    const outer = 168;
    const step = Math.floor((outer - 18) / strata.length);
    let html = '<line class="base" x1="6" y1="190" x2="354" y2="190"/>';
    strata.forEach((st, i) => {
      const ro = outer - i * step;
      const ri = ro - step + 4;
      html += `<path class="band" data-stratum="${safe(st.id)}" d="${ringPath(ro, ri)}"><title>${safe(st.label)} — ${safe(st.strap)}</title></path>`;
      html += `<text class="lbl" x="${CX}" y="${CY - (ro + ri) / 2 + 3}" text-anchor="middle">${safe(st.label.toUpperCase())}</text>`;
    });
    html += `<circle class="apex" cx="${CX}" cy="${CY - (outer - (strata.length - 1) * step) + 6}" r="3"/>`;
    svg.innerHTML = html;
    // Each band is stroked in its stratum's colour through the CSSOM.
    svg.querySelectorAll('.band').forEach((b) => {
      const hue = STRATUM_HUE[b.dataset.stratum];
      if (hue) { b.style.stroke = hue; b.style.fill = hueFill(hue, 0.1); }
    });
    svg.querySelectorAll('.band').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openApp('dome', { focus: b.dataset.stratum });
    }));

    const legend = $('dome-legend');
    legend.innerHTML = strata.map((st) => `
      <button data-stratum="${safe(st.id)}" title="${safe(st.summary)}">
        <i data-hue="${safe(st.id)}"></i>
        <span><b>${safe(st.label)}</b><small>reading…</small></span>
        <em>—</em>
      </button>`).join('');
    legend.querySelectorAll('i[data-hue]').forEach((i) => {
      const hue = STRATUM_HUE[i.dataset.hue];
      if (hue) { i.style.background = hue; i.style.boxShadow = `0 0 9px ${hueFill(hue, 0.75)}`; }
    });
    legend.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openApp('dome', { focus: b.dataset.stratum });
    }));
  }

  function paintDome(data) {
    if (!data) return;
    if (!$('dome-svg').querySelector('.band')) buildDome(data.strata);
    data.strata.forEach((st) => {
      const band = document.querySelector(`#dome-svg .band[data-stratum="${st.id}"]`);
      if (band) {
        band.classList.remove('warn', 'err');
        const hue = STRATUM_HUE[st.id] || '#00c8f0';
        if (st.level === 'warn' || st.level === 'err') {
          band.classList.add(st.level);
          band.style.stroke = st.level === 'err' ? '#f0686a' : '#f0a03c';
          band.style.fill = hueFill(st.level === 'err' ? '#f0686a' : '#f0a03c', 0.13);
        } else {
          band.style.stroke = hue;
          band.style.fill = hueFill(hue, st.value != null && st.value >= 70 ? 0.16 : 0.08);
        }
      }
      const row = document.querySelector(`#dome-legend button[data-stratum="${st.id}"]`);
      if (row) {
        row.classList.remove('warn', 'err');
        if (st.level === 'warn' || st.level === 'err') row.classList.add(st.level);
        row.querySelector('em').textContent = st.value == null ? '—' : `${st.value}%`;
        const worst = st.segments.filter((x) => x.level === 'err' || x.level === 'warn')[0];
        row.querySelector('small').textContent = worst
          ? `${worst.name.toLowerCase()} · ${worst.label}`
          : st.strap.toLowerCase();
      }
    });
    const worst = data.strata.reduce((a, s) => (s.level === 'err' ? 'err' : s.level === 'warn' && a !== 'err' ? 'warn' : a), 'ok');
    const pill = $('dome-pill');
    pill.className = `live-pill${worst === 'ok' ? '' : ' warn'}`;
    pill.innerHTML = `<i></i>${worst === 'ok' ? 'Live' : worst === 'warn' ? 'Attention' : 'Critical'}`;
    setText('dome-read', `${data.counts.segments} segments`);
    setText('dome-note', `${data.counts.datasets} data sets in reach · ${data.counts.presets} presets`);
  }

  /* A quick pass skips any scan-cost set that is not already cached, so the
     dome is on the deck immediately; the full pass follows and fills in the
     segments that needed a scan. */
  async function refreshDome(opts = {}) {
    if (domeBusy) return null;
    domeBusy = true;
    try {
      const data = await api.dome.overview(opts);
      domeData = data;
      paintDome(data);
      if (data.deferred && data.deferred.length) {
        setText('dome-note', `${data.counts.datasets} sets in reach · scanning ${data.deferred.length} more…`);
      }
      return data;
    } catch {
      setText('dome-note', 'the dome could not be read');
      return null;
    } finally {
      domeBusy = false;
    }
  }

  function setStat(id, k, t, pct, level) {
    setText(`st-${id}-k`, k); setText(`st-${id}-t`, t);
    const bar = $(`st-${id}-b`);
    if (bar) {
      bar.style.width = `${clamp(pct)}%`;
      const hue = level === 'err' ? '#f0686a' : level === 'warn' ? '#f0a03c' : STAT_HUE[id] || '#00c8f0';
      bar.style.background = `linear-gradient(90deg, ${hueFill(hue, 0.55)}, ${hue})`;
    }
    const box = $(`st-${id}`);
    if (box) {
      box.classList.remove('warn', 'err');
      if (level && level !== 'ok') box.classList.add(level);
      box.style.setProperty('--hue', hueFill(STAT_HUE[id] || '#00c8f0', 0.13));
    }
  }
  const lvl = (v, w, e) => (v >= e ? 'err' : v >= w ? 'warn' : 'ok');

  function paintMetrics(packet) {
    const m = (packet && packet.metrics) || {}; lastMetrics = m;
    const cpu = m.cpu || {}, mem = m.mem || {}, net = m.net || {};
    const temp = m.temp && typeof m.temp.c === 'number' ? m.temp.c : null;
    const disks = Array.isArray(m.disks) ? m.disks : [];
    const sys = disks.find((d) => /^c:?/i.test(String(d.name || ''))) || disks[0] || null;
    const cpuPct = Number(cpu.load) || 0, memPct = Number(mem.usedPct) || 0, diskPct = sys ? Number(sys.usedPct) || 0 : 0;

    setStat('cpu', `${Math.round(cpuPct)}%`, `${cpu.cores || '?'} threads${cpu.speedMHz ? ` · ${Math.round(cpu.speedMHz)} MHz` : ''}${temp != null ? ` · ${Math.round(temp)}°C` : ''}`, cpuPct, lvl(cpuPct, 75, 90));
    setStat('mem', `${Math.round(memPct)}%`, `${humanBytes((mem.total || 0) - (mem.free || 0))} of ${humanBytes(mem.total)}`, memPct, lvl(memPct, 80, 92));
    setStat('disk', sys ? `${Math.round(diskPct)}%` : '—', sys ? `${String(sys.name || 'disk').replace(/\\$/, '')} · ${humanBytes(sys.free)} free` : 'waiting for drive data', diskPct, lvl(diskPct, 82, 92));
    const rx = Number(net.rxBps) || 0, tx = Number(net.txBps) || 0;
    setStat('net', `↓${humanBits(rx).replace(/\s/, '')}`, `↑ ${humanBits(tx)}${packet && packet.ping ? ` · ${Math.round(packet.ping)} ms` : ''}`, clamp(((rx + tx) * 8) / 1e6), 'ok');


    const pressure = []; let severity = 'ok';
    const flag = (c, level, label) => { if (!c) return; pressure.push(label); if (level === 'err' || severity === 'ok') severity = level; };
    flag(cpuPct >= 90, 'err', 'CPU saturated'); flag(cpuPct >= 75 && cpuPct < 90, 'warn', 'CPU busy');
    flag(memPct >= 92, 'err', 'memory critical'); flag(memPct >= 80 && memPct < 92, 'warn', 'memory pressure');
    flag(diskPct >= 92, 'err', 'disk nearly full'); flag(diskPct >= 82 && diskPct < 92, 'warn', 'disk space low');
    flag(temp != null && temp >= 88, 'err', 'temperature critical'); flag(temp != null && temp >= 75 && temp < 88, 'warn', 'temperature elevated');
    const cap = $('status-capsule'); cap.className = severity === 'ok' ? '' : severity;
    setText('status-text', pressure.length ? pressure.join(' · ') : (m.at ? 'System nominal · live telemetry' : 'Warming up…'));
    setText('homeMachineLine', [m.host, m.platform, m.uptimeSec != null ? `uptime ${humanDuration(m.uptimeSec)}` : ''].filter(Boolean).join(' · ') || 'Reading this machine…');
  }

  function updateClock() {
    const now = new Date();
    setText('clock', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    setText('date', now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }));
    const h = now.getHours();
    const name = shellSettings.profile && shellSettings.profile.name ? `, ${String(shellSettings.profile.name).split(' ')[0]}` : '';
    setText('greeting', h < 5 ? `Night shift${name}` : h < 12 ? `Good morning${name}` : h < 18 ? `Good afternoon${name}` : `Good evening${name}`);
  }

  function paintUser() {
    const p = shellSettings.profile || {};
    const name = p.name || 'Operator';
    setText('who-name', name); setText('who-initial', name.trim().charAt(0).toUpperCase() || 'P');
    setText('who-role', p.role || p.org || 'Ionity workstation');
  }

  /* ----------------------------------------------------------- local AI */
  const defaultModel = () => (shellSettings && shellSettings.aiDefaultModel) || 'llama3.2:1b';

  function showAiSetup(mode, label) {
    aiSetup = mode; const chip = $('ai-setup-chip');
    chip.hidden = !mode; if (label) chip.textContent = label; chip.disabled = mode === 'busy';
  }
  function pickTarget(list) {
    const base = defaultModel().split(':')[0];
    return list.find((t) => String(t.model || '').startsWith(defaultModel())) || list.find((t) => String(t.model || '').startsWith(base)) || list[0] || null;
  }
  async function refreshAi() {
    if (aiPulling) return;
    try {
      const [endpoints, list] = await Promise.all([api.aiEndpoints(), api.aiTargets()]);
      aiList = Array.isArray(list) ? list : [];
      paintTargets(list);                                  // renderer.js keeps its own select in sync
      const ollama = (endpoints || []).find((e) => e.id === 'ollama');
      preferredTarget = pickTarget(list);
      if (preferredTarget) {
        const idx = list.indexOf(preferredTarget); if (idx >= 0) $('aiTarget').value = String(idx);
        $('engine-chip').className = ''; setText('engine-label', `Local core · ${preferredTarget.model}`);
        $('ask-orb').classList.remove('off'); $('ask-send').disabled = false;
        $('ask-input').placeholder = `Ask ${preferredTarget.model}, or type a workspace name… (Ctrl+K)`;
        showAiSetup(String(preferredTarget.model || '').startsWith(defaultModel().split(':')[0]) ? null : 'pull', `Add ${defaultModel()}`);
      } else if (ollama && ollama.up) {
        $('engine-chip').className = 'off'; setText('engine-label', 'Local core · no model');
        $('ask-orb').classList.add('off'); $('ask-send').disabled = true;
        $('ask-input').placeholder = `Ollama is running - get ${defaultModel()} to ask here (Ctrl+K opens a workspace)`;
        showAiSetup('pull', `Get ${defaultModel()} (~1.3 GB)`);
      } else {
        $('engine-chip').className = 'off'; setText('engine-label', 'Local core · offline');
        $('ask-orb').classList.add('off'); $('ask-send').disabled = true;
        $('ask-input').placeholder = 'Type a workspace name, or set up local AI to ask questions here';
        showAiSetup('install', 'Set up local AI');
      }
    } catch {
      $('engine-chip').className = 'off'; setText('engine-label', 'Local core · unavailable'); showAiSetup(null);
    }
    // Every surface that needs a model follows the same answer.
    const ready = Boolean(preferredTarget);
    const askBtn = $('aw-ask-btn'); if (askBtn) askBtn.disabled = !ready;
    document.querySelectorAll('#suggest .preset-chip').forEach((b) => { b.disabled = !ready; });
    setText('om-model', ready ? `${preferredTarget.model} · on this machine` : 'no local model yet');
    paintOptions();
  }
  async function runAiSetup() {
    const model = defaultModel();
    if (aiSetup === 'install') {
      ['ollama', 'ollama-small'].forEach((id) => { if (CATALOG.items.some((i) => i.id === id)) selected.add(id); });
      renderItems();
      openApp('software');
      toast('Ollama and the starter model are ticked - press Install.', 'good');
      return;
    }
    if (aiSetup === 'pull') {
      aiPulling = true; showAiSetup('busy', `Pulling ${model}…`); $('ask-orb').classList.add('busy');
      toast(`Pulling ${model} - progress is in the Local AI log.`);
      try {
        const r = await api.aiPull(model);
        toast(r && r.ok ? `${model} is on this machine.` : `Pull failed: ${(r && (r.error || r.code)) || 'unknown'}`, r && r.ok ? 'good' : 'bad');
      } catch (e) { toast(`Pull failed: ${e.message || e}`, 'bad'); }
      aiPulling = false; $('ask-orb').classList.remove('busy'); showAiSetup(null); refreshAi();
    }
  }

  /* The hero thread mirrors the Local AI workspace log, so streaming,
     transcript and stats all live in one place (renderer.js send()). */
  function mirrorThread() {
    const log = $('aiChatLog'); const thread = $('thread'); if (!log || !thread) return;
    const msgs = [...log.querySelectorAll('.msg')].slice(-8);
    thread.innerHTML = '';
    msgs.forEach((m) => {
      const c = document.createElement('div'); c.className = m.className;
      const who = m.querySelector('.who'), body = m.querySelector('.body'), cur = m.querySelector('.cursor');
      c.innerHTML = `<span class="who">${safe(who ? who.textContent : '')}</span><span class="body"></span>${cur ? '<span class="cursor"></span>' : ''}`;
      c.querySelector('.body').textContent = body ? body.textContent : '';
      thread.appendChild(c);
    });
    thread.classList.toggle('on', msgs.length > 0);
    thread.scrollTop = thread.scrollHeight;
    $('ask-orb').classList.toggle('busy', Boolean(chatBusy));
  }

  function findAppByName(text) {
    const q = text.trim().toLowerCase(); if (!q || q.length > 24) return null;
    return Object.keys(APPS).find((id) => id === q || APPS[id].name.toLowerCase() === q) || null;
  }
  async function ask() {
    const text = $('ask-input').value.trim(); if (!text) return;
    const appId = findAppByName(text);
    if (appId) { $('ask-input').value = ''; openApp(appId); return; }
    if (!preferredTarget) { toast(aiSetup ? 'Set up local AI first - one click on the chip below.' : 'No local model is online.', 'bad'); return; }
    if (chatBusy) { toast('The model is still answering.'); return; }
    $('ask-input').value = '';
    $('aiPrompt').value = text;
    await send(false);                                     // renderer.js - streams into aiChatLog, mirrored here
  }

  /* ------------------------------------------ the local core, everywhere */
  /* One streaming helper serves the launch brief, the orb menu and the Ask
     control in every workspace. Each goes through dome:ask, so the answer is
     built from registered sets only and the Local AI transcript is untouched. */

  function answerShell(box, title) {
    box.innerHTML = `<div class="ans-head"><span class="ai-orb busy"></span><b></b><span class="ans-meta"></span></div><div class="ans-body"></div>`;
    const ui = {
      head: box.querySelector('.ans-head b'),
      meta: box.querySelector('.ans-meta'),
      body: box.querySelector('.ans-body'),
      orb: box.querySelector('.ai-orb'),
    };
    ui.head.textContent = title || 'Reading the sets…';
    return ui;
  }

  async function askStream({ scope, presetId, question, box, ui, title }) {
    const t = ui || (box ? answerShell(box, title) : null);
    if (!t) return null;
    if (ui) {
      t.head.textContent = title || 'Reading the sets…';
      t.meta.textContent = '';
      t.body.textContent = '';
      t.orb.classList.add('busy');
    }
    if (box) { box.hidden = false; box.classList.remove('err'); }
    const mine = ++askSeq;
    const off = api.dome.onToken((p) => {
      if (mine !== askSeq) return;
      if (p.start) {
        if (p.preset) t.head.textContent = p.preset.name;
        t.meta.textContent = `${p.model} · ${p.sets.filter((s) => s.available).length}/${p.sets.length} sets`;
      }
      if (p.token) { t.body.textContent += p.token; t.body.scrollTop = t.body.scrollHeight; }
      if (p.error) { t.body.textContent += `\n${p.error}`; if (box) box.classList.add('err'); }
      if (p.done) {
        t.orb.classList.remove('busy');
        if (p.stats && p.stats.tokensPerSec) t.meta.textContent += ` · ${p.stats.tokensPerSec} tok/s`;
        t.body.scrollTop = 0;              // the answer is read from the top
      }
    });
    try {
      const res = await api.dome.ask({ scope, presetId, question });
      if (res && !res.ok && res.error) {
        t.body.textContent = res.error; t.orb.classList.remove('busy');
        if (box) box.classList.add('err');
      }
      return res;
    } catch (e) {
      t.body.textContent = e.message || String(e); t.orb.classList.remove('busy');
      if (box) box.classList.add('err');
      return null;
    } finally { setTimeout(off, 600); }
  }

  /* ------------------------------------------------------- launch brief */
  /* On launch - and from any preset chip - the local model reads the machine
     once and reports on the deck. Nothing is asked of the network. */

  async function runBrief(presetId) {
    const panel = $('brief');
    if (!panel) return;
    if (!preferredTarget) {
      toast(aiSetup === 'install' ? 'Set up local AI first - one click on the chip below.' : `Get ${defaultModel()} to have the machine read itself.`, 'bad');
      return;
    }
    if (briefBusy) { toast('The local core is still reporting.'); return; }
    briefBusy = true;
    const id = presetId || shellSettings.aiBriefPreset || 'state-of-machine';
    const preset = domePresets.find((p) => p.id === id);
    panel.hidden = false;
    document.body.classList.add('brief-on');
    requestAnimationFrame(() => panel.classList.add('on'));
    await askStream({
      presetId: id,
      title: preset ? preset.name : 'State of the machine',
      ui: { head: $('brief-title'), meta: $('brief-meta'), body: $('brief-body'), orb: $('brief-orb') },
    });
    briefBusy = false;
  }

  function hideBrief() {
    const panel = $('brief');
    panel.classList.remove('on');
    panel.hidden = true;
    document.body.classList.remove('brief-on');
    askSeq += 1;                       // any stream still running stops painting
  }

  /* Hero chips are the registry's own presets, not a hard-coded list: add a
     preset to datasets.json and it appears here. */
  function buildHeroChips() {
    const host = $('suggest'); if (!host) return;
    host.querySelectorAll('.preset-chip').forEach((b) => b.remove());
    const setup = $('ai-setup-chip');
    domePresets.slice(0, 4).forEach((p) => {
      const b = document.createElement('button');
      b.className = 'preset-chip';
      b.dataset.preset = p.id;
      b.title = p.question || '';
      b.textContent = p.name;
      b.addEventListener('click', () => runBrief(p.id));
      host.insertBefore(b, setup);
    });
  }

  /* ------------------------------------------------------------ orb menu */
  function buildOrbMenu() {
    const list = $('om-list'); if (!list) return;
    list.innerHTML = '';
    domePresets.forEach((p) => {
      const b = document.createElement('button');
      b.innerHTML = `<b>${safe(p.name)}</b><small>${safe(p.question || '')}</small>`;
      b.addEventListener('click', () => { closeOrbMenu(); runBrief(p.id); });
      list.appendChild(b);
    });
  }
  function openOrbMenu() {
    const m = $('orbmenu'); if (!m) return;
    setText('om-model', preferredTarget ? `${preferredTarget.model} · on this machine` : 'no local model yet');
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('on'));
  }
  function closeOrbMenu() {
    const m = $('orbmenu'); if (!m) return;
    m.classList.remove('on');
    setTimeout(() => { if (!m.classList.contains('on')) m.hidden = true; }, 220);
  }

  /* -------------------------------------------- Ask inside every workspace */
  /* When the option is on, each workspace window carries an Ask control that
     is scoped to what that workspace covers: Hardware asks about thermal,
     Projects about repositories, Doctor about the last scan. */
  let awAnswerEl = null;
  function awAnswer() {
    if (!awAnswerEl) {
      awAnswerEl = document.createElement('div');
      awAnswerEl.className = 'dome-answer aw-answer';
      awAnswerEl.hidden = true;
    }
    return awAnswerEl;
  }
  function detachAwAnswer() {
    if (awAnswerEl && awAnswerEl.parentNode) awAnswerEl.parentNode.removeChild(awAnswerEl);
    if (awAnswerEl) { awAnswerEl.hidden = true; awAnswerEl.innerHTML = ''; }
  }
  function addAskControl(id, app, extra) {
    if (!app.scope || app.builtin === 'dome') return;
    if (shellSettings.aiAskEverywhere === false) return;
    const b = document.createElement('button');
    b.className = 'btn ghost aw-ask-btn';
    b.id = 'aw-ask-btn';
    b.textContent = `Ask about ${app.name.toLowerCase()}`;
    b.disabled = !preferredTarget;
    if (!preferredTarget) b.title = 'No local model is online yet.';
    b.addEventListener('click', () => {
      const box = awAnswer();
      const content = $('aw-content');
      if (box.parentNode !== content) content.insertBefore(box, content.firstChild);
      box.scrollIntoView({ block: 'start' });
      const preset = domePresets.find((p) => p.scope === app.scope);
      askStream({
        scope: app.scope,
        presetId: preset ? preset.id : undefined,
        box,
        title: `${app.name} · local core`,
      });
    });
    extra.appendChild(b);
  }

  /* ------------------------------------------------------ shell settings */
  async function saveSetting(patch) {
    try { shellSettings = await api.setSettings(patch) || shellSettings; }
    catch (e) { toast(`Could not save that: ${e.message || e}`, 'bad'); }
    return shellSettings;
  }

  function applyAccent(name) {
    const hex = ACCENTS[name] || ACCENTS.cyan;
    document.body.style.setProperty('--sh-accent', hex);
    document.body.style.setProperty('--sh-accent-soft', hueFill(hex, 0.16));
    document.body.style.setProperty('--sh-accent-line', hueFill(hex, 0.42));
    document.body.style.setProperty('--sh-grad', `linear-gradient(120deg, ${hueFill(hex, 0.85)}, ${hex})`);
  }
  function applyWatermark(on) {
    const m = $('shellMark');
    if (m) m.hidden = on === false;
  }

  function scheduleDome() {
    if (domeTimer) { clearInterval(domeTimer); domeTimer = null; }
    const secs = Number(shellSettings.domeInterval);
    if (!secs || secs < 5) return;                       // 0 = only when asked
    domeTimer = setInterval(() => {
      if (!$('overlay').classList.contains('on')) refreshDome();
    }, secs * 1000);
  }

  /* ------------------------------------------------- the options card */
  function fillSelect(sel, rows, value) {
    if (!sel) return;
    const want = rows.map((r) => `${r.value}\u0000${r.label}`).join('|');
    if (sel.dataset.rows !== want) {
      sel.innerHTML = rows.map((r) => `<option value="${safe(r.value)}">${safe(r.label)}</option>`).join('');
      sel.dataset.rows = want;
    }
    if (value != null && sel.value !== String(value)) sel.value = String(value);
  }

  function paintOptions() {
    const card = $('domeOptions'); if (!card) return;
    const set = (id, on) => { const e = $(id); if (e) e.checked = on !== false; };
    set('optAutoBrief', shellSettings.aiAutoBrief);
    set('optAskEverywhere', shellSettings.aiAskEverywhere);
    set('optWatermark', shellSettings.watermark);
    const k = $('optKiosk'); if (k) k.checked = Boolean(shellSettings.kioskMode);

    fillSelect($('optBriefPreset'), domePresets.map((p) => ({ value: p.id, label: p.name })),
      shellSettings.aiBriefPreset || 'state-of-machine');
    fillSelect($('optModel'), aiList.length
      ? aiList.map((t) => ({ value: t.model, label: `${t.model} · ${t.endpoint || t.endpointId || 'local'}` }))
      : [{ value: defaultModel(), label: `${defaultModel()} · not pulled yet` }],
      (preferredTarget && preferredTarget.model) || defaultModel());
    const iv = $('optInterval'); if (iv) iv.value = String(shellSettings.domeInterval == null ? 45 : shellSettings.domeInterval);
    const ac = $('optAccent'); if (ac) ac.value = shellSettings.accent || 'cyan';

    if (domeData) {
      setText('optMeta', `${domeData.counts.strata} strata · ${domeData.counts.segments} segments · ${domeData.counts.datasets} sets · ${domeData.counts.presets} presets`);
    }
  }

  function wireOptions() {
    const card = $('domeOptions'); if (!card) return;
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };

    on('optAutoBrief', 'change', (e) => saveSetting({ aiAutoBrief: e.target.checked }));
    on('optAskEverywhere', 'change', async (e) => {
      await saveSetting({ aiAskEverywhere: e.target.checked });
      if (mounted && APPS[mounted.id]) paintAppHead(mounted.id, APPS[mounted.id]);
    });
    on('optWatermark', 'change', async (e) => { await saveSetting({ watermark: e.target.checked }); applyWatermark(e.target.checked); });
    on('optKiosk', 'change', (e) => setKiosk(e.target.checked));
    on('optBriefPreset', 'change', (e) => saveSetting({ aiBriefPreset: e.target.value }));
    on('optModel', 'change', async (e) => { await saveSetting({ aiDefaultModel: e.target.value }); await refreshAi(); });
    on('optInterval', 'change', async (e) => { await saveSetting({ domeInterval: Number(e.target.value) }); scheduleDome(); });
    on('optAccent', 'change', async (e) => { await saveSetting({ accent: e.target.value }); applyAccent(e.target.value); });

    on('optReread', 'click', async () => {
      await api.dome.refresh();
      toast('Re-reading every set…');
      await refreshDome();
      paintOptions();
      toast('The dome is current.', 'good');
    });
    on('optReport', 'click', async (e) => {
      const b = e.currentTarget; const label = b.textContent;
      b.disabled = true; b.textContent = 'Writing…';
      try {
        const r = await api.dome.report();
        const name = r && r.file ? String(r.file).split(/[\\/]/).pop() : '';
        toast(r && r.ok
          ? `${name} written · ${r.segments} segments, ${r.datasets} sets - open the report folder`
          : `Report failed: ${(r && r.error) || 'unknown'}`, r && r.ok ? 'good' : 'bad');
      } catch (err) { toast(`Report failed: ${err.message || err}`, 'bad'); }
      b.textContent = label; b.disabled = false;
    });
    on('optReports', 'click', () => api.dome.openReports());
    on('optFanFolder', 'click', () => api.fans.openFolder());
    on('optDatasets', 'click', () => openApp('dome', { focus: 'datasets' }));
  }

  /* ---------------------------------------------------------- kiosk etc */
  function applyKioskUi(on) {
    document.body.classList.toggle('kiosk-shell', Boolean(on));
    $('kioskExitBtn').hidden = !on;
  }
  let kioskBusy = false;
  async function setKiosk(on) {
    if (kioskBusy) return; kioskBusy = true;
    try { shellSettings = await api.setSettings({ kioskMode: Boolean(on) }); applyKioskUi(shellSettings.kioskMode); }
    finally { kioskBusy = false; }
  }

  function bind() {
    document.querySelectorAll('[data-app]').forEach((b) => {
      if (b.id === 'dock-orb') return;   // the orb opens the preset menu, below
      b.addEventListener('click', () => openApp(b.dataset.app));
    });
    $('aw-close').addEventListener('click', closeApp);
    $('overlay').addEventListener('click', (e) => { if (e.target === $('overlay')) closeApp(); });
    $('dome-card').addEventListener('click', () => openApp('monitor'));
    $('userChip').addEventListener('click', () => openApp('settings'));
    $('engine-chip').addEventListener('click', (e) => {
      e.stopPropagation();
      if (aiSetup && aiSetup !== 'busy') { runAiSetup(); return; }
      openOrbMenu();                       // the chip is the model picker as well
    });
    $('dock-orb').addEventListener('click', (e) => { e.stopPropagation(); openOrbMenu(); });
    $('om-open-ai').addEventListener('click', () => { closeOrbMenu(); openApp('ai'); });
    $('om-open-dome').addEventListener('click', () => { closeOrbMenu(); openApp('dome'); });
    document.addEventListener('click', (e) => { if (!$('orbmenu').contains(e.target)) closeOrbMenu(); });

    $('brief-close').addEventListener('click', hideBrief);
    $('brief-more').addEventListener('click', () => openApp('dome'));
    $('brief-orb').addEventListener('click', () => runBrief());
    $('ai-setup-chip').addEventListener('click', runAiSetup);
    $('ask-send').addEventListener('click', ask);
    $('ask-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } if (e.key === 'Escape') $('ask-input').blur(); });
    document.querySelectorAll('#suggest [data-say]').forEach((b) => b.addEventListener('click', () => { $('ask-input').value = b.dataset.say; ask(); }));
    document.querySelectorAll('#suggest [data-open]').forEach((b) => b.addEventListener('click', () => openApp(b.dataset.open)));

    $('kiosk-ic').addEventListener('click', () => setKiosk(!shellSettings.kioskMode));
    $('kioskExitBtn').addEventListener('click', () => setKiosk(false));
    const pm = $('powermenu');
    $('power-btn').addEventListener('click', (e) => { e.stopPropagation(); pm.hidden = false; requestAnimationFrame(() => pm.classList.toggle('on')); });
    document.addEventListener('click', (e) => { if (!pm.contains(e.target)) pm.classList.remove('on'); });
    $('pm-about').addEventListener('click', () => { pm.classList.remove('on'); openApp('about'); });
    $('pm-kiosk').addEventListener('click', () => { pm.classList.remove('on'); setKiosk(!shellSettings.kioskMode); });
    $('pm-log').addEventListener('click', () => { pm.classList.remove('on'); api.openLog(); });
    $('pm-quit').addEventListener('click', () => api.quit());

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setKiosk(!shellSettings.kioskMode); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); closeApp(); $('ask-input').focus(); $('ask-input').select(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); runBrief(); return; }
      if (e.key === 'Escape' && !$('orbmenu').hidden) { closeOrbMenu(); return; }
      if (e.key === 'Escape' && $('overlay').classList.contains('on') && $('summarySheet').hidden) closeApp();
    });

    api.onMetrics(paintMetrics);
    api.onSettingsChanged((next) => {
      shellSettings = next || {};
      applyKioskUi(shellSettings.kioskMode);
      applyAccent(shellSettings.accent);
      applyWatermark(shellSettings.watermark);
      paintUser(); paintOptions(); scheduleDome();
    });
    api.onUpdateAvailable((u) => { const on = Boolean(u && u.available); $('updateDot').hidden = !on; $('dockUpdateDot').hidden = !on; if (on) toast(`ProGramerly ${u.latest} is available - open Operations.`, 'good'); });
    api.onUpdateChecked((u) => { const on = Boolean(u && u.available); $('updateDot').hidden = !on; $('dockUpdateDot').hidden = !on; });
    api.programs.onProgress((p) => { if (p && p.phase === 'ready') loadTools(); if (p && p.phase === 'failed') toast(`${p.file}: ${p.error || 'failed'}`, 'bad'); });

    const log = $('aiChatLog');
    if (log) new MutationObserver(mirrorThread).observe(log, { childList: true, subtree: true, characterData: true });
  }

  async function initShell() {
    shellSettings = SETTINGS || {};
    buildTiles(); bind(); paintUser(); wireOptions();
    applyAccent(shellSettings.accent);
    applyWatermark(shellSettings.watermark);
    updateClock(); setInterval(updateClock, 1000);
    setText('build-label', `v${INFO.appVersion} · Policy 986 AED`);
    $('shell').classList.add('on');
    // The fast surfaces first. The dome's first read walks the development
    // root, which on a large one takes real time - nothing the operator can
    // already use is allowed to wait behind it.
    await Promise.allSettled([
      api.metrics().then(paintMetrics),
      loadTools(),
      api.dome.presets('all').then((rows) => { domePresets = Array.isArray(rows) ? rows : []; }),
    ]);
    buildHeroChips(); buildOrbMenu();
    await refreshAi();                       // enables the chips it can answer
    paintOptions();
    if (shellSettings.kioskMode) await setKiosk(true);
    setInterval(refreshAi, 30000);

    // The machine reads itself once, on the deck, as soon as a model is there.
    if (shellSettings.aiAutoBrief !== false && preferredTarget) setTimeout(() => runBrief(), 900);

    // The dome paints twice: once from what can be read without a scan, so the
    // deck is complete immediately, and once in full - walking the drives, the
    // listening ports and every repository under the development root - which
    // lands when it lands and repaints the card on arrival.
    await refreshDome({ quick: true });
    paintOptions();
    refreshDome().then(() => { paintOptions(); scheduleDome(); });
  }

  const coreBoot = boot;
  boot = async function bootWithShell() {
    await coreBoot();
    // renderer.js ends its boot on the software tab; the shell starts closed.
    closeApp();
    await initShell();
  };
})();
