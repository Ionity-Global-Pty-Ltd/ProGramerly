'use strict';
/* ProGramerly - Relations surface: the machine as a living graph
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   PGApps.relations mounts a canvas graph fed by graph:build - processes,
   ports, services, volumes, models, environments, repositories - joined by
   the relations that exist on the machine right now. Edges are gradients
   between the two node hues with flow particles running from source to
   target. Click a node: its facts, its actions, and Ask AEDi about it.

   Everything drawn comes from the read. A source that failed is listed in
   the gaps strip and is simply missing from the picture. */

(() => {
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const S = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    spark: S('<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z"/>'),
    refresh: S('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
    close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
    fit: S('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  };
  const KINDS = [
    ['process', 'Processes'], ['hidden', 'Unseen'], ['port', 'Ports'], ['service', 'Services'],
    ['volume', 'Volumes'], ['model', 'Models'], ['env', 'Environments'], ['repo', 'Repos'], ['tool', 'Tools'],
  ];
  const ALWAYS = new Set(['machine', 'hub', 'cpu', 'ram', 'gpu', 'iface', 'endpoint', 'folder', 'program']);

  function bytes(n) {
    const v = Number(n) || 0; if (!v) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), u.length - 1);
    const x = v / (1024 ** i); return `${x.toFixed(i < 2 || x >= 100 ? 0 : 1)} ${u[i]}`;
  }
  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return `rgba(0,200,240,${a})`;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  }

  const relations = {
    async mount(host, h) {
      const api = h.api;
      let graph = null;
      let nodes = [];          // laid-out copies
      let edges = [];
      let byId = new Map();
      let hidden = new Set();  // kinds toggled off
      let selected = null;
      let hover = null;
      let query = '';
      let raf = 0;
      let alive = true;
      let particles = [];
      let view = { x: 0, y: 0, k: 1 };
      let drag = null;
      let askSeq = 0;
      let offToken = null;

      host.innerHTML = `
        <div class="rel-app">
          <div class="rel-top">
            <div class="rel-title">${I.spark}<b>Relations</b><span class="rel-meta" id="relMeta">reading this machine…</span></div>
            <div class="rel-tools">
              <input class="rel-search" id="relSearch" type="search" placeholder="Find a process, port, model…" autocomplete="off" />
              <button class="btn ghost" data-act="fit" title="Fit to view">${I.fit}</button>
              <button class="btn ghost" data-act="refresh" title="Re-read">${I.refresh}</button>
              <button class="btn primary" data-act="ask-machine">${I.spark}Ask AEDi</button>
            </div>
          </div>
          <div class="rel-kinds" id="relKinds"></div>
          <div class="rel-gaps" id="relGaps" hidden></div>
          <div class="rel-body">
            <canvas class="rel-canvas" id="relCanvas"></canvas>
            <aside class="rel-side" id="relSide" hidden></aside>
          </div>
        </div>`;
      const root = host.querySelector('.rel-app');
      const canvas = root.querySelector('#relCanvas');
      const ctx = canvas.getContext('2d');
      const side = root.querySelector('#relSide');
      const $ = (sel) => root.querySelector(sel);

      /* ------------------------------------------------------- layout */

      function visible(n) { return !hidden.has(n.kind); }

      function seed() {
        const W = canvas.width, H = canvas.height;
        byId = new Map();
        nodes = graph.nodes.map((n) => {
          const hub = n.kind === 'hub' || n.kind === 'machine';
          const angle = { hardware: -2.2, system: -0.8, storage: 0.4, toolchain: 1.6, intelligence: 2.8 }[n.group] ?? 0;
          const r = n.kind === 'machine' ? 0 : hub ? Math.min(W, H) * 0.22 : Math.min(W, H) * (0.34 + ((n.id.length * 7919) % 100) / 400);
          const jitter = hub ? 0 : ((n.id.length * 31 + n.label.length * 17) % 100) / 100 - 0.5;
          const node = {
            ...n, x: W / 2 + Math.cos(angle + jitter) * r, y: H / 2 + Math.sin(angle + jitter) * r, vx: 0, vy: 0,
            r: 4 + 3.2 * (n.weight || 1), fixed: n.kind === 'machine',
          };
          if (node.fixed) { node.x = W / 2; node.y = H / 2; }
          byId.set(n.id, node);
          return node;
        });
        edges = graph.edges.map((e) => ({ ...e, a: byId.get(e.from), b: byId.get(e.to) })).filter((e) => e.a && e.b);
        particles = edges.map((e) => ({ e, t: ((e.a.id.length + e.b.id.length) % 10) / 10, speed: 0.0025 + (e.kind === 'listens' || e.kind === 'serves' ? 0.004 : 0) }));
        view = { x: 0, y: 0, k: 1 };
      }

      let cooling = 1;
      function step() {
        const vis = nodes.filter(visible);
        const W = canvas.width, H = canvas.height;
        // repulsion
        for (let i = 0; i < vis.length; i++) {
          const a = vis[i];
          for (let j = i + 1; j < vis.length; j++) {
            const b = vis[j];
            let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = 0.5; dy = 0.5; d2 = 0.5; }
            const min = (a.r + b.r) * 2.2;
            const f = Math.min(1.6, (900 + (d2 < min * min ? 2600 : 0)) / d2) * cooling;
            const d = Math.sqrt(d2); const fx = (dx / d) * f, fy = (dy / d) * f;
            if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
            if (!b.fixed) { b.vx += fx; b.vy += fy; }
          }
        }
        // springs
        for (const e of edges) {
          if (!visible(e.a) || !visible(e.b)) continue;
          const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y; const d = Math.max(1, Math.hypot(dx, dy));
          const want = e.a.kind === 'machine' ? 150 : e.a.kind === 'hub' ? 95 : 58;
          const f = ((d - want) / d) * 0.018 * cooling;
          if (!e.a.fixed) { e.a.vx += dx * f; e.a.vy += dy * f; }
          if (!e.b.fixed) { e.b.vx -= dx * f; e.b.vy -= dy * f; }
        }
        // gravity to centre + integrate
        for (const n of vis) {
          if (n.fixed || n === drag?.node) continue;
          n.vx += (W / 2 - n.x) * 0.0009 * cooling; n.vy += (H / 2 - n.y) * 0.0009 * cooling;
          n.vx *= 0.82; n.vy *= 0.82;
          n.x += n.vx; n.y += n.vy;
        }
        cooling = Math.max(0.12, cooling * 0.995);
      }

      /* ------------------------------------------------------ drawing */

      function toScreen(p) { return { x: p.x * view.k + view.x, y: p.y * view.k + view.y }; }
      function toWorld(p) { return { x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k }; }

      function draw(dt) {
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
        const q = query.toLowerCase();
        const focus = selected ? new Set([selected.id, ...edges.filter((e) => e.a === selected || e.b === selected).flatMap((e) => [e.a.id, e.b.id])]) : null;

        ctx.globalCompositeOperation = 'lighter';
        for (const e of edges) {
          if (!visible(e.a) || !visible(e.b)) continue;
          const dim = focus && !(focus.has(e.a.id) && focus.has(e.b.id));
          const g = ctx.createLinearGradient(e.a.x, e.a.y, e.b.x, e.b.y);
          g.addColorStop(0, rgba(e.a.hue, dim ? 0.05 : 0.42)); g.addColorStop(1, rgba(e.b.hue, dim ? 0.05 : 0.42));
          ctx.strokeStyle = g; ctx.lineWidth = dim ? 0.6 : (e.kind === 'contains' ? 1.6 : 1.1);
          ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y);
          const mx = (e.a.x + e.b.x) / 2 + (e.b.y - e.a.y) * 0.12, my = (e.a.y + e.b.y) / 2 - (e.b.x - e.a.x) * 0.12;
          ctx.quadraticCurveTo(mx, my, e.b.x, e.b.y); ctx.stroke();
        }
        for (const p of particles) {
          const e = p.e; if (!visible(e.a) || !visible(e.b)) continue;
          if (focus && !(focus.has(e.a.id) && focus.has(e.b.id))) continue;
          p.t = (p.t + p.speed * dt) % 1;
          const t = p.t, mx = (e.a.x + e.b.x) / 2 + (e.b.y - e.a.y) * 0.12, my = (e.a.y + e.b.y) / 2 - (e.b.x - e.a.x) * 0.12;
          const x = (1 - t) * (1 - t) * e.a.x + 2 * (1 - t) * t * mx + t * t * e.b.x;
          const y = (1 - t) * (1 - t) * e.a.y + 2 * (1 - t) * t * my + t * t * e.b.y;
          ctx.fillStyle = rgba(e.b.hue, 0.85); ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';

        for (const n of nodes) {
          if (!visible(n)) continue;
          const match = q && (n.label.toLowerCase().includes(q) || String(n.sub || '').toLowerCase().includes(q));
          const dim = (focus && !focus.has(n.id)) || (q && !match);
          const lit = n === selected || n === hover || match;
          const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * (lit ? 3.4 : 2.4));
          glow.addColorStop(0, rgba(n.hue, dim ? 0.08 : lit ? 0.55 : 0.32)); glow.addColorStop(1, rgba(n.hue, 0));
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (lit ? 3.4 : 2.4), 0, Math.PI * 2); ctx.fill();
          const core = ctx.createRadialGradient(n.x - n.r * 0.3, n.y - n.r * 0.3, 0, n.x, n.y, n.r);
          core.addColorStop(0, dim ? rgba('#ffffff', 0.25) : '#ffffff'); core.addColorStop(0.35, rgba(n.hue, dim ? 0.3 : 1)); core.addColorStop(1, rgba(n.hue, dim ? 0.15 : 0.55));
          ctx.fillStyle = core; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
          if (n.kind === 'hidden') { ctx.strokeStyle = rgba('#ffffff', dim ? 0.1 : 0.45); ctx.setLineDash([2, 2]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
          if (n.kind === 'hub' || n.kind === 'machine' || lit || n.r > 9 || view.k > 1.5) {
            ctx.font = `${n.kind === 'machine' ? 700 : 500} ${n.kind === 'machine' ? 13 : 10.5}px "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = dim ? 'rgba(157,176,189,.25)' : lit ? '#e9f1f6' : 'rgba(233,241,246,.78)';
            ctx.textAlign = 'center'; ctx.fillText(n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label, n.x, n.y + n.r + 12);
          }
        }
        ctx.restore();
      }

      let last = performance.now();
      function loop(now) {
        if (!alive) return;
        const dt = Math.min(3, (now - last) / 16.7); last = now;
        if (graph) { step(); draw(dt); }
        raf = requestAnimationFrame(loop);
      }

      function resize() {
        const r = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(300, Math.floor(r.width * dpr)); canvas.height = Math.max(300, Math.floor(r.height * dpr));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (graph) fit();
      }
      function fit() {
        const vis = nodes.filter(visible); if (!vis.length) return;
        const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
        const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40, minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
        const k = Math.min(canvas.width / (maxX - minX), canvas.height / (maxY - minY), 2.2);
        view = { k, x: canvas.width / 2 - ((minX + maxX) / 2) * k, y: canvas.height / 2 - ((minY + maxY) / 2) * k };
      }

      /* ------------------------------------------------------- pointer */

      function pick(ev) {
        const r = canvas.getBoundingClientRect(); const dpr = canvas.width / r.width;
        const p = toWorld({ x: (ev.clientX - r.left) * dpr, y: (ev.clientY - r.top) * dpr });
        let best = null, bd = 1e9;
        for (const n of nodes) { if (!visible(n)) continue; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < Math.max(12, n.r * 1.8) && d < bd) { best = n; bd = d; } }
        return { node: best, p, dpr };
      }
      canvas.addEventListener('pointerdown', (ev) => {
        const { node, p } = pick(ev);
        drag = { node, start: p, view: { ...view }, moved: false, sx: ev.clientX, sy: ev.clientY };
        canvas.setPointerCapture(ev.pointerId);
      });
      canvas.addEventListener('pointermove', (ev) => {
        if (drag) {
          const r = canvas.getBoundingClientRect(); const dpr = canvas.width / r.width;
          const dx = (ev.clientX - drag.sx) * dpr, dy = (ev.clientY - drag.sy) * dpr;
          if (Math.hypot(dx, dy) > 3) drag.moved = true;
          if (drag.node && !drag.node.fixed) { const w = toWorld({ x: (ev.clientX - r.left) * dpr, y: (ev.clientY - r.top) * dpr }); drag.node.x = w.x; drag.node.y = w.y; drag.node.vx = 0; drag.node.vy = 0; }
          else { view.x = drag.view.x + dx; view.y = drag.view.y + dy; }
          return;
        }
        const { node } = pick(ev); hover = node; canvas.style.cursor = node ? 'pointer' : 'grab';
      });
      canvas.addEventListener('pointerup', (ev) => {
        if (drag && !drag.moved) { const { node } = pick(ev); select(node); }
        drag = null;
      });
      canvas.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const r = canvas.getBoundingClientRect(); const dpr = canvas.width / r.width;
        const sx = (ev.clientX - r.left) * dpr, sy = (ev.clientY - r.top) * dpr;
        const k = Math.max(0.3, Math.min(4, view.k * (ev.deltaY < 0 ? 1.12 : 0.89)));
        view.x = sx - ((sx - view.x) / view.k) * k; view.y = sy - ((sy - view.y) / view.k) * k; view.k = k;
      }, { passive: false });

      /* ---------------------------------------------------- side panel */

      function factRows(n) {
        const d = n.data || {}; const rows = [];
        const add = (k, v) => { if (v != null && v !== '' && typeof v !== 'object') rows.push(`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`); };
        if (n.kind === 'process' || n.kind === 'hidden') { add('pid', d.pid); add('parent', d.ppid); add('memory', bytes(d.rss)); if (d.cpuSec != null) add('cpu time', `${d.cpuSec} s`); if (d.cpuPct != null) add('cpu', `${d.cpuPct}%`); add('user', d.user); add('company', d.company); add('started', d.started ? new Date(d.started).toLocaleString() : null); add('path', d.path); add('session', d.hidden ? 'system (unseen)' : 'yours'); }
        else if (n.kind === 'volume') { add('mount', d.mount || d.name); add('used', `${Math.round(d.usedPct)}%`); add('free', bytes(d.free)); add('total', bytes(d.total)); }
        else if (n.kind === 'model') { add('size', bytes(d.size)); add('resident', d.loaded ? 'yes' : 'no'); add('family', d.details && d.details.family); add('parameters', d.details && d.details.parameter_size); add('quantisation', d.details && d.details.quantization_level); }
        else if (n.kind === 'service') { add('name', d.name); add('state', d.state); add('start', d.start); add('pid', d.pid); add('account', d.account); add('path', d.path); add('about', d.desc); }
        else if (n.kind === 'port') { add('port', d.port); add('protocol', d.proto); add('bound to', d.address); add('owner pid', d.pid); }
        else if (n.kind === 'repo') { add('branch', d.branch); add('changes', d.changes); add('untracked', d.untracked); add('ahead', d.ahead); add('behind', d.behind); add('stack', Array.isArray(d.stack) ? d.stack.join(', ') : d.stack); add('path', d.dir); }
        else if (n.kind === 'env') { add('kind', d.kind); add('python', d.python); add('status', d.status); add('path', d.dir); add('marker', d.marker); }
        else if (n.kind === 'gpu') { add('VRAM total', `${(d.vramTotalMb / 1024).toFixed(1)} GB`); add('VRAM free', `${(d.vramFreeMb / 1024).toFixed(1)} GB`); add('utilisation', `${d.utilPct}%`); add('temperature', `${d.tempC} °C`); }
        else if (n.kind === 'tool') { add('items', (d.items || []).join(', ')); }
        else for (const [k, v] of Object.entries(d)) add(k, v);
        if (d.cmd) rows.push(`<div class="wide"><span>command</span><code>${esc(String(d.cmd).slice(0, 400))}</code></div>`);
        return rows.join('');
      }

      function select(n) {
        selected = n;
        if (!n) { side.hidden = true; return; }
        const rel = edges.filter((e) => e.a === n || e.b === n).slice(0, 30);
        side.hidden = false;
        side.innerHTML = `
          <div class="rs-head"><span class="rs-dot"></span><div><b>${esc(n.label)}</b><small>${esc(n.kind)} · ${esc(n.sub || '')}</small></div><button class="aw-close" data-act="close">${I.close}</button></div>
          <div class="rs-actions">
            <button class="btn primary" data-act="ask">${I.spark}Ask AEDi</button>
            ${(n.actions || []).map((a, i) => `<button class="btn ghost${a.act === 'kill' || a.action === 'stop' ? ' danger' : ''}" data-action="${i}">${esc(a.label)}</button>`).join('')}
          </div>
          <div class="rs-facts">${factRows(n)}</div>
          <div class="rs-rel"><small>${rel.length} relation${rel.length === 1 ? '' : 's'}</small>
            ${rel.map((e) => { const o = e.a === n ? e.b : e.a; return `<button class="rs-link" data-node="${esc(o.id)}"><i></i>${esc(e.a === n ? e.kind : `← ${e.kind}`)} <b>${esc(o.label)}</b></button>`; }).join('')}
          </div>
          <div class="dome-answer rs-answer" hidden></div>`;
        side.querySelector('.rs-dot').style.background = n.hue;
        side.querySelectorAll('.rs-link i').forEach((i, k) => { const o = rel[k] && (rel[k].a === n ? rel[k].b : rel[k].a); if (o) i.style.background = o.hue; });
        side.querySelector('[data-act="close"]').addEventListener('click', () => select(null));
        side.querySelector('[data-act="ask"]').addEventListener('click', () => ask(n));
        side.querySelectorAll('[data-node]').forEach((b) => b.addEventListener('click', () => { const o = byId.get(b.dataset.node); if (o) { select(o); centre(o); } }));
        side.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => act(n, n.actions[Number(b.dataset.action)], b)));
      }
      function centre(n) { view.x = canvas.width / 2 - n.x * view.k; view.y = canvas.height / 2 - n.y * view.k; }

      async function act(n, a, btn) {
        if (!a) return;
        const busy = (on) => { btn.disabled = on; };
        try {
          if (a.act === 'kill') {
            if (!window.confirm(`End ${n.label} (pid ${a.pid})? Unsaved work in it is lost.`)) return;
            busy(true); const r = await api.sys.kill(a.pid);
            h.toast(r.ok ? `${n.label} ended.` : `Could not end ${n.label}: ${r.error}`, r.ok ? 'good' : 'bad');
            if (r.ok) await load(true);
          } else if (a.act === 'service') {
            if (a.action === 'stop' && !window.confirm(`Stop the service ${n.label}?`)) return;
            busy(true); const r = await api.sys.service(a.name, a.action);
            h.toast(r.ok ? `${n.label}: ${r.state}` : `${n.label}: ${r.error}`, r.ok ? 'good' : 'bad');
            if (r.ok) await load(true);
          } else if (a.act === 'open') { await api.openPath(a.path); }
          else if (a.act === 'open-app') { h.openApp(a.app); }
          else if (a.act === 'port') { h.openApp('doctor'); setTimeout(() => { const i = document.getElementById('docPort'); if (i) { i.value = a.port; document.getElementById('docPortBtn')?.click(); } }, 300); }
          else if (a.act === 'chat') { h.openApp('ai'); }
          else if (a.act === 'launch') { const r = await api.programs.launch(a.id); h.toast(r.ok ? `${n.label} opened.` : r.error || 'could not launch', r.ok ? 'good' : 'bad'); }
        } catch (e) { h.toast(e.message || String(e), 'bad'); } finally { busy(false); }
      }

      async function ask(n) {
        const box = side.querySelector('.rs-answer'); if (!box) return;
        const mine = ++askSeq;
        box.hidden = false; box.classList.remove('err');
        box.innerHTML = `<div class="ans-head"><span class="ai-orb busy"></span><b>AEDi · reading ${esc(n.label)}…</b><span class="ans-meta"></span></div><div class="ans-body"></div>`;
        const body = box.querySelector('.ans-body'), meta = box.querySelector('.ans-meta'), head = box.querySelector('.ans-head b');
        if (offToken) offToken();
        offToken = api.dome.onToken((p) => {
          if (mine !== askSeq) return;
          if (p.start) { head.textContent = `AEDi · ${n.label}`; meta.textContent = `${p.model} · ${Math.round(p.chars / 1000)}k context`; }
          if (p.token) { body.textContent += p.token; body.scrollTop = body.scrollHeight; }
          if (p.error) { body.textContent += `\n${p.error}`; box.classList.add('err'); }
          if (p.done) { box.querySelector('.ai-orb').classList.remove('busy'); if (p.stats && p.stats.tokensPerSec) meta.textContent += ` · ${p.stats.tokensPerSec} tok/s`; }
        });
        try {
          const r = await api.graph.ask(n.id);
          if (!r.ok && r.error) { body.textContent = r.error; box.classList.add('err'); box.querySelector('.ai-orb').classList.remove('busy'); }
        } catch (e) { body.textContent = e.message || String(e); box.classList.add('err'); }
      }

      /* -------------------------------------------------------- chrome */

      function paintKinds() {
        const c = graph.counts || {};
        $('#relKinds').innerHTML = KINDS.filter(([k]) => c[k]).map(([k, label]) => `<button class="rel-kind${hidden.has(k) ? ' off' : ''}" data-kind="${k}"><i></i>${esc(label)}<b>${c[k]}</b></button>`).join('');
        $('#relKinds').querySelectorAll('[data-kind]').forEach((b) => {
          const sample = graph.nodes.find((n) => n.kind === b.dataset.kind); if (sample) b.querySelector('i').style.background = sample.hue;
          b.addEventListener('click', () => { const k = b.dataset.kind; if (hidden.has(k)) hidden.delete(k); else hidden.add(k); b.classList.toggle('off', hidden.has(k)); cooling = Math.max(cooling, 0.5); });
        });
      }

      async function load(keepView = false) {
        const meta = $('#relMeta'); meta.textContent = 'reading this machine…';
        try {
          const g = await api.graph.build({ processLimit: 40 });
          const oldPos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
          graph = g;
          if (!canvas.width) resize();
          seed();
          if (keepView) for (const n of nodes) { const o = oldPos.get(n.id); if (o) { n.x = o.x; n.y = o.y; } }
          cooling = keepView ? 0.4 : 1;
          const t = g.totals || {};
          meta.textContent = `${g.nodes.length} nodes · ${g.edges.length} relations · ${t.processes || 0} processes (${t.hidden || 0} unseen) · ${t.listeners || 0} listeners · ${t.servicesRunning || 0}/${t.services || 0} services`;
          paintKinds();
          const gaps = $('#relGaps'); gaps.hidden = !(g.gaps && g.gaps.length);
          gaps.innerHTML = (g.gaps || []).map((x) => `<span>${esc(x)}</span>`).join('');
          if (!keepView) setTimeout(fit, 900);
          if (selected) { const again = byId.get(selected.id); select(again || null); }
        } catch (e) {
          meta.textContent = `could not read the machine: ${e.message || e}`;
        }
      }

      root.querySelectorAll('.rel-tools [data-act]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.act === 'fit') fit();
        if (b.dataset.act === 'refresh') load(true);
        if (b.dataset.act === 'ask-machine') { const m = byId.get('machine'); if (m) { select(m); ask(m); } }
      }));
      $('#relSearch').addEventListener('input', (e) => { query = e.target.value.trim(); });
      $('#relSearch').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = query.toLowerCase(); const n = nodes.find((x) => visible(x) && (x.label.toLowerCase().includes(q) || String(x.sub || '').toLowerCase().includes(q)));
        if (n) { select(n); centre(n); }
      });

      const ro = new ResizeObserver(() => resize());
      ro.observe(canvas);
      resize();
      raf = requestAnimationFrame(loop);
      await load();

      return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); if (offToken) offToken(); };
    },
  };

  window.PGApps = Object.assign(window.PGApps || {}, { relations });
})();
