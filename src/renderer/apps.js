'use strict';
/* ProGramerly - DOME and Fan Control surfaces
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Two built-in app windows for the Ai-OS shell, kept out of shell.js because
   they are workspaces in their own right:

     PGApps.dome  - the Ionity DOME. Five strata, twenty-four segments, each
                    bound to registered data sets, each drillable, with the
                    local model answering from those sets and citing them.
     PGApps.fans  - the full fan surface: channels, temperature sources, a
                    curve editor with live commanded-versus-measured duty,
                    stored profiles, presets and export.

   Both are handed a helper bag by shell.js rather than reaching for globals,
   so they can be mounted and tested on their own. No style="" anywhere: this
   renderer runs under style-src 'self', which silently drops parsed style
   attributes - everything visual is a class or a property set after insert. */

(() => {
  const S = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

  /* One icon per segment - drawn from what the segment actually reads, so a
     glance at the grid tells you the subject before you read the label. */
  const GLYPHS = {
    thermal: S('<path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 9v5"/>'),
    fan: S('<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 2-7 5-7 1.5 0 2 1.5 1 3-1.2 1.8-3.5 3-6 4M14 12c4 0 7 2 7 5 0 1.5-1.5 2-3 1-1.8-1.2-3-3.5-4-6M12 14c0 4-2 7-5 7-1.5 0-2-1.5-1-3 1.2-1.8 3.5-3 6-4M10 12c-4 0-7-2-7-5 0-1.5 1.5-2 3-1 1.8 1.2 3 3.5 4 6"/>'),
    power: S('<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>'),
    rgb: S('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16"/><path d="M12 4a8 8 0 0 0 0 16"/><circle cx="12" cy="12" r="2.5"/>'),
    memory: S('<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3"/>'),
    shield: S('<path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z"/><path d="M9.5 12l2 2 3.5-4"/>'),
    registry: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/><path d="M11 13h6M11 16h4"/>'),
    port: S('<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/><circle cx="12" cy="14.5" r="1.4"/>'),
    path: S('<path d="M4 6h4l2 3h10"/><path d="M4 18h6l2-3h8"/><circle cx="4" cy="6" r="1.4"/><circle cx="4" cy="18" r="1.4"/>'),
    stethoscope: S('<path d="M6 3v5a4 4 0 0 0 8 0V3"/><path d="M6 3H4.5M14 3h1.5"/><path d="M10 12v2a5 5 0 0 0 5 5h1"/><circle cx="18" cy="18" r="2.4"/>'),
    disk: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M14.5 14.5L19 19"/>'),
    folder: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.4h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    broom: S('<path d="M15 3l-7 7"/><path d="M6 11l7-7 4 4-7 7z"/><path d="M10 15l-4 6h12l-4-6z"/>'),
    seal: S('<circle cx="12" cy="9.5" r="6"/><path d="M9.5 9.5l2 2 3.5-4"/><path d="M8.5 14.5L7 22l5-2.5L17 22l-1.5-7.5"/>'),
    catalogue: S('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/><path d="M8 7h7M8 10h5"/>'),
    check: S('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 9.5"/>'),
    engine: S('<rect x="3" y="8" width="14" height="9" rx="2"/><path d="M17 11h2l2 3v3h-4"/><path d="M6 8V5h6v3"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="15" cy="17.5" r="1.6"/>'),
    plug: S('<path d="M9 3v6M15 3v6"/><path d="M6 9h12v2a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>'),
    branch: S('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M8.5 6H14a4 4 0 0 1 0 8H8.5"/>'),
    model: S('<circle cx="12" cy="6" r="2.4"/><circle cx="5.5" cy="17" r="2.4"/><circle cx="18.5" cy="17" r="2.4"/><path d="M10.4 7.8L7 14.8M13.6 7.8L17 14.8M8 17h8"/>'),
    chip: S('<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>'),
    flask: S('<path d="M10 3v6L4.6 18A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-3L14 9V3"/><path d="M9 3h6"/><path d="M7.5 15h9"/>'),
    dataset: S('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'),
    preset: S('<path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h10M18 17h2"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="17" r="2"/>'),
    /* shell-side */
    dome: S('<path d="M3 17a9 9 0 0 1 18 0"/><path d="M2 17h20"/><path d="M6.5 17a5.5 5.5 0 0 1 11 0"/><path d="M12 8V5"/>'),
    back: S('<path d="M15 5l-7 7 7 7"/>'),
    spark: S('<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>'),
    curve: S('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M5 17c4 0 5-9 9-9 3 0 4 3 5 5"/>'),
    gauge: S('<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/><circle cx="12" cy="18" r="1.4"/>'),
    save: S('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
    trash: S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    download: S('<path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M4 20h16"/>'),
  };

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function bytes(n) {
    const v = Number(n) || 0;
    if (!v) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), u.length - 1);
    const x = v / (1024 ** i);
    return `${x.toFixed(i < 2 || x >= 100 ? 0 : 1)} ${u[i]}`;
  }

  const cell = (v) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
    return String(v);
  };

  /* ====================================================================== *
   *  THE DOME
   * ====================================================================== */

  const dome = {
    /**
     * @param {HTMLElement} host
     * @param {{api:object, toast:Function, openApp:Function, focus?:string}} h
     */
    async mount(host, h) {
      const api = h.api;
      let view = { level: 'overview', id: null };
      let data = null;
      let answerAbort = 0;

      host.innerHTML = '<div class="dome-app"><div class="dome-loading">Reading this machine…</div></div>';
      const root = host.querySelector('.dome-app');

      /* ------------------------------------------------------ rendering */

      function levelClass(l) { return l === 'err' ? 'err' : l === 'warn' ? 'warn' : l === 'idle' ? 'idle' : 'ok'; }

      function segmentCard(seg, stratumId) {
        return `<button class="dome-seg ${levelClass(seg.level)}" data-seg="${esc(seg.id)}" data-stratum="${esc(stratumId)}">
          <span class="seg-ico">${GLYPHS[seg.glyph] || GLYPHS.dataset}</span>
          <span class="seg-body">
            <span class="seg-head"><b>${esc(seg.name)}</b><i class="seg-code">${esc(seg.code)}</i></span>
            <span class="seg-blurb">${esc(seg.blurb)}</span>
            <span class="seg-foot"><i class="dot"></i>${esc(seg.label || 'unread')}${seg.detail ? ` · ${esc(seg.detail)}` : ''}</span>
          </span>
          <span class="seg-val">${seg.value == null ? '—' : `${seg.value}<small>%</small>`}</span>
        </button>`;
      }

      function overview() {
        const s = data;
        root.innerHTML = `
          <header class="dome-head">
            <div>
              <h3>${GLYPHS.dome}The Ionity DOME</h3>
              <p class="muted">${esc(s.host)} · ${s.counts.strata} strata · ${s.counts.segments} segments · ${s.counts.datasets} data sets · ${s.counts.presets} presets</p>
            </div>
            <div class="dome-actions">
              <button class="btn ghost" data-act="datasets">${GLYPHS.dataset}Data sets</button>
              <button class="btn ghost" data-act="refresh">Re-read</button>
              <button class="btn primary" data-act="ask" data-scope="all">${GLYPHS.spark}Ask the model</button>
            </div>
          </header>
          <p class="dome-note">${esc(s.sourceNote)}</p>
          <div class="dome-strata">
            ${s.strata.map((st) => `
              <section class="dome-stratum ${levelClass(st.level)}">
                <button class="stratum-bar" data-stratum="${esc(st.id)}">
                  <span class="st-order">${st.order}</span>
                  <span class="st-name"><b>${esc(st.label)}</b><small>${esc(st.strap)}</small></span>
                  <span class="st-meter"><i class="fill"></i></span>
                  <span class="st-val">${st.value == null ? '—' : `${st.value}%`}</span>
                  <span class="st-read">${esc(st.read)}</span>
                </button>
                <div class="dome-segs">${st.segments.map((x) => segmentCard(x, st.id)).join('')}</div>
              </section>`).join('')}
          </div>
          <div class="dome-answer" hidden></div>`;
        // Meters are painted through the CSSOM: a parsed style attribute is
        // dropped by this renderer's CSP and the bar would sit at zero.
        s.strata.forEach((st, i) => {
          const fill = root.querySelectorAll('.st-meter .fill')[i];
          if (fill) fill.style.width = `${st.value == null ? 0 : st.value}%`;
        });
        wire();
      }

      async function stratum(id) {
        root.innerHTML = '<div class="dome-loading">Reading the stratum…</div>';
        const st = await api.dome.stratum(id);
        root.innerHTML = `
          <header class="dome-head">
            <div class="dome-back">
              <button class="aw-close" data-act="up" title="Back to the dome">${GLYPHS.back}</button>
              <div><h3>${esc(st.label)}</h3><p class="muted">${esc(st.strap)} · ${st.segments.length} segments</p></div>
            </div>
            <div class="dome-actions">
              <button class="btn ghost" data-act="refresh">Re-read</button>
              <button class="btn primary" data-act="ask" data-scope="${esc(st.id)}">${GLYPHS.spark}Ask about ${esc(st.label)}</button>
            </div>
          </header>
          <p class="dome-note">${esc(st.summary)}</p>
          <div class="dome-segs wide">${st.segments.map((x) => segmentCard(x, st.id)).join('')}</div>
          ${st.presets.length ? `<div class="preset-row"><span class="preset-label">${GLYPHS.preset}Presets</span>${st.presets.map((p) => `<button class="chip-btn" data-preset="${esc(p.id)}" title="${esc(p.question)}">${esc(p.name)}</button>`).join('')}</div>` : ''}
          <div class="dome-answer" hidden></div>`;
        view = { level: 'stratum', id };
        wire();
      }

      async function segment(id) {
        root.innerHTML = '<div class="dome-loading">Reading the segment…</div>';
        const sg = await api.dome.segment(id);
        root.innerHTML = `
          <header class="dome-head">
            <div class="dome-back">
              <button class="aw-close" data-act="up" data-stratum="${esc(sg.stratum.id)}" title="Back to ${esc(sg.stratum.label)}">${GLYPHS.back}</button>
              <div>
                <h3>${GLYPHS[sg.glyph] || ''}${esc(sg.name)}</h3>
                <p class="muted">${esc(sg.stratum.label)} · ${esc(sg.code)} · <span class="lvl ${levelClass(sg.level)}">${esc(sg.label || 'unread')}</span>${sg.detail ? ` · ${esc(sg.detail)}` : ''}</p>
              </div>
            </div>
            <div class="dome-actions">
              <button class="btn ghost" data-act="refresh">Re-read</button>
              <button class="btn primary" data-act="ask" data-scope="${esc(sg.id)}">${GLYPHS.spark}Ask about this</button>
            </div>
          </header>
          <div class="seg-prose">
            <p><b>Purpose.</b> ${esc(sg.purpose)}</p>
            <p class="watch"><b>Watch for.</b> ${esc(sg.watch)}</p>
          </div>
          <h4 class="sets-title">Data sets behind this segment</h4>
          ${sg.sets.map(setBlock).join('')}
          ${sg.presets.length ? `<div class="preset-row"><span class="preset-label">${GLYPHS.preset}Presets</span>${sg.presets.map((p) => `<button class="chip-btn" data-preset="${esc(p.id)}" title="${esc(p.question)}">${esc(p.name)}</button>`).join('')}</div>` : ''}
          <div class="dome-answer" hidden></div>`;
        view = { level: 'segment', id };
        wire();
      }

      function setBlock(d) {
        const head = `<div class="set-head">
            <span class="set-name">${esc(d.name)}<code>${esc(d.id)}</code></span>
            <span class="set-class ${esc(d.class)}">${esc(d.class)}</span>
            <span class="set-count">${d.available ? `${d.count} row${d.count === 1 ? '' : 's'}` : 'unavailable'}</span>
          </div>`;
        if (!d.available) {
          return `<section class="set-card off">${head}<p class="set-about">${esc(d.about)}</p><p class="set-reason">${esc(d.reason || 'No reason given.')}</p></section>`;
        }
        if (!d.sample.length) {
          return `<section class="set-card">${head}<p class="set-about">${esc(d.about)}</p><p class="set-reason">Readable, but empty right now.</p></section>`;
        }
        const cols = [...new Set(d.sample.flatMap((r) => Object.keys(r)))].slice(0, 7);
        return `<section class="set-card">${head}
          <p class="set-about">${esc(d.about)} <span class="muted">· ${esc(d.source)}</span></p>
          <div class="set-scroll"><table class="set-table">
            <thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${d.sample.map((r) => `<tr>${cols.map((c) => `<td>${esc(cell(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          ${d.count > d.sample.length ? `<p class="set-reason">Showing ${d.sample.length} of ${d.count}. The model is given up to 30 rows.</p>` : ''}
        </section>`;
      }

      async function datasets() {
        root.innerHTML = '<div class="dome-loading">Checking every set…</div>';
        const reg = await api.dome.datasets();
        const byClass = {};
        for (const d of reg.datasets) (byClass[d.class] = byClass[d.class] || []).push(d);
        root.innerHTML = `
          <header class="dome-head">
            <div class="dome-back">
              <button class="aw-close" data-act="up" title="Back to the dome">${GLYPHS.back}</button>
              <div><h3>${GLYPHS.dataset}Data sets in reach</h3><p class="muted">${reg.datasets.length} registered · ${reg.datasets.filter((d) => d.available).length} readable now</p></div>
            </div>
            <div class="dome-actions"><button class="btn primary" data-preset="data-inventory">${GLYPHS.spark}Ask what it can see</button></div>
          </header>
          <p class="dome-note">The model may read these sets and nothing else. Every figure it quotes carries the class of the set it came from.</p>
          ${Object.entries(byClass).map(([cls, rows]) => `
            <h4 class="sets-title"><span class="set-class ${esc(cls)}">${esc(cls)}</span> ${esc(reg.classes[cls] || '')}</h4>
            <div class="ds-grid">${rows.map((d) => `
              <div class="ds-card ${d.available ? '' : 'off'}">
                <div class="ds-head"><b>${esc(d.name)}</b><code>${esc(d.id)}</code></div>
                <p>${esc(d.about)}</p>
                <div class="ds-foot"><i class="dot"></i>${d.available ? `${d.rows} row${d.rows === 1 ? '' : 's'}` : esc(d.reason || 'unavailable')}</div>
              </div>`).join('')}</div>`).join('')}
          <div class="dome-answer" hidden></div>`;
        view = { level: 'datasets', id: null };
        wire();
      }

      /* ---------------------------------------------------------- asking */

      function answerBox() {
        const box = root.querySelector('.dome-answer');
        if (box) box.hidden = false;
        return box;
      }

      async function ask({ scope, presetId, question }) {
        const box = answerBox();
        if (!box) return;
        const mine = ++answerAbort;
        box.innerHTML = `<div class="ans-head"><span class="ai-orb busy"></span><b>Reading the sets…</b><span class="ans-meta"></span></div><div class="ans-body"></div>`;
        const body = box.querySelector('.ans-body');
        const meta = box.querySelector('.ans-meta');
        const head = box.querySelector('.ans-head b');
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        const off = api.dome.onToken((p) => {
          if (mine !== answerAbort) return;
          if (p.start) {
            head.textContent = p.preset ? p.preset.name : 'Reporting';
            meta.textContent = `${p.model} · ${p.sets.filter((s) => s.available).length}/${p.sets.length} sets · ${Math.round(p.chars / 1000)}k of context`;
          }
          if (p.token) { body.textContent += p.token; body.scrollTop = body.scrollHeight; }
          if (p.error) { body.textContent += `\n${p.error}`; box.classList.add('err'); }
          if (p.done) {
            box.querySelector('.ai-orb').classList.remove('busy');
            if (p.stats && p.stats.tokensPerSec) meta.textContent += ` · ${p.stats.tokensPerSec} tok/s`;
          }
        });

        try {
          const res = await api.dome.ask({ scope, presetId, question });
          if (!res.ok && res.error) {
            body.textContent = res.error;
            box.classList.add('err');
            box.querySelector('.ai-orb').classList.remove('busy');
          }
        } catch (e) {
          body.textContent = e.message || String(e);
          box.classList.add('err');
        } finally {
          setTimeout(off, 500);
        }
      }

      /* ----------------------------------------------------------- wiring */

      function wire() {
        root.querySelectorAll('[data-stratum]').forEach((b) => {
          if (b.dataset.seg) return;
          b.addEventListener('click', (e) => {
            if (b.dataset.act === 'up') { e.stopPropagation(); return; }
            e.stopPropagation(); stratum(b.dataset.stratum);
          });
        });
        root.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); segment(b.dataset.seg); }));
        root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async (e) => {
          e.stopPropagation();
          const act = b.dataset.act;
          if (act === 'up') { if (b.dataset.stratum) stratum(b.dataset.stratum); else load(); return; }
          if (act === 'refresh') { await api.dome.refresh(); h.toast('Re-reading every set…'); load(); return; }
          if (act === 'datasets') { datasets(); return; }
          if (act === 'ask') ask({ scope: b.dataset.scope });
        }));
        root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ask({ presetId: b.dataset.preset }); }));
      }

      async function load() {
        root.innerHTML = '<div class="dome-loading">Reading this machine…</div>';
        try {
          data = await api.dome.overview();
          view = { level: 'overview', id: null };
          overview();
        } catch (e) {
          root.innerHTML = `<div class="dome-loading err">The dome could not be read: ${esc(e.message || e)}</div>`;
        }
      }

      if (h.focus) {
        try { await stratum(h.focus); return; } catch { /* fall through to the overview */ }
      }
      await load();
    },
  };

  /* ====================================================================== *
   *  FAN CONTROL
   * ====================================================================== */

  const fans = {
    async mount(host, h) {
      const api = h.api;
      let live = null;          // channels + temps
      let store = null;         // profiles
      let presets = [];
      let editing = null;       // the profile being edited
      let revealEditor = false; // the editor opens below the fold - bring it up
      let timer = null;

      host.innerHTML = '<div class="fan-app"><div class="dome-loading">Reading the sensor tree…</div></div>';
      const root = host.querySelector('.fan-app');

      const roleLabel = {
        cpu: 'CPU', gpu: 'GPU', pump: 'Pump', intake: 'Intake', exhaust: 'Exhaust', psu: 'PSU', case: 'Case',
      };

      /* ------------------------------------------------------- the curve */

      const W = 520;
      const H = 200;
      const PAD = { l: 34, r: 12, t: 12, b: 24 };
      const xOf = (t) => PAD.l + (Math.max(0, Math.min(100, t)) / 100) * (W - PAD.l - PAD.r);
      const yOf = (p) => H - PAD.b - (Math.max(0, Math.min(100, p)) / 100) * (H - PAD.t - PAD.b);

      function curveSvg(profile, liveTemp) {
        const pts = (profile.points || []).slice().sort((a, b) => a.t - b.t);
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.t).toFixed(1)},${yOf(p.pct).toFixed(1)}`).join(' ');
        const area = pts.length ? `${line} L${xOf(pts[pts.length - 1].t).toFixed(1)},${yOf(0)} L${xOf(pts[0].t).toFixed(1)},${yOf(0)} Z` : '';
        const grid = [0, 25, 50, 75, 100].map((v) => `
          <line class="g" x1="${xOf(0)}" y1="${yOf(v)}" x2="${xOf(100)}" y2="${yOf(v)}"/>
          <text class="ax" x="${PAD.l - 6}" y="${yOf(v) + 3}" text-anchor="end">${v}</text>`).join('')
          + [0, 25, 50, 75, 100].map((v) => `
          <line class="g v" x1="${xOf(v)}" y1="${yOf(0)}" x2="${xOf(v)}" y2="${yOf(100)}"/>
          <text class="ax" x="${xOf(v)}" y="${H - 8}" text-anchor="middle">${v}°</text>`).join('');
        const now = liveTemp == null ? '' : `
          <line class="now" x1="${xOf(liveTemp)}" y1="${yOf(0)}" x2="${xOf(liveTemp)}" y2="${yOf(100)}"/>
          <text class="now-t" x="${xOf(liveTemp)}" y="${PAD.t + 9}" text-anchor="middle">${Math.round(liveTemp)}°</text>`;
        const stop = profile.stopBelow > 0 ? `<rect class="stop" x="${xOf(0)}" y="${yOf(100)}" width="${xOf(profile.stopBelow) - xOf(0)}" height="${yOf(0) - yOf(100)}"/>` : '';
        const min = profile.minDuty > 0 ? `<line class="min" x1="${xOf(0)}" y1="${yOf(profile.minDuty)}" x2="${xOf(100)}" y2="${yOf(profile.minDuty)}"/>` : '';
        return `<svg class="curve-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          ${grid}${stop}${min}
          ${area ? `<path class="area" d="${area}"/>` : ''}
          ${line ? `<path class="line" d="${line}"/>` : ''}
          ${pts.map((p, i) => `<circle class="pt" data-i="${i}" cx="${xOf(p.t)}" cy="${yOf(p.pct)}" r="5"><title>${p.t}° → ${p.pct}%</title></circle>`).join('')}
          ${now}
        </svg>`;
      }

      /* --------------------------------------------------------- render */

      function channelRow(c) {
        const dutyPct = c.duty == null ? null : Math.round(c.duty);
        return `<tr class="${c.spinning === false ? 'stopped' : ''}">
          <td><b>${esc(c.label)}</b><small>${esc(c.parent)}</small></td>
          <td><span class="role ${esc(c.role)}">${esc(roleLabel[c.role] || c.role)}</span></td>
          <td class="num">${c.rpm == null ? (c.noTacho ? 'no tacho' : '—') : `${c.rpm}<small> RPM</small>`}</td>
          <td class="duty">${dutyPct == null ? '—' : `<span class="duty-bar"><i></i></span><b>${dutyPct}%</b>`}</td>
          <td>${c.controllable ? '<span class="yes">controllable</span>' : '<span class="no">read only</span>'}</td>
          <td><button class="btn ghost sm" data-curve-for="${esc(c.id)}">${GLYPHS.curve}Curve</button></td>
        </tr>`;
      }

      function profileCard(p) {
        const drift = p.drift == null ? null : p.drift;
        const state = p.sourceMissing || p.channelMissing ? 'off' : (drift != null && Math.abs(drift) > 12 ? 'warn' : 'ok');
        return `<article class="fan-profile ${state}" data-profile="${esc(p.id)}">
          <div class="fp-head">
            <b>${esc(p.name)}</b>
            ${p.basedOn ? `<span class="fp-base">${esc(p.basedOn)}</span>` : ''}
            <div class="fp-tools">
              <button class="btn ghost sm" data-edit="${esc(p.id)}">Edit</button>
              <button class="btn ghost sm" data-export="${esc(p.id)}" title="Write this curve to disk as JSON">${GLYPHS.download}</button>
              <button class="btn ghost sm danger" data-del="${esc(p.id)}" title="Delete">${GLYPHS.trash}</button>
            </div>
          </div>
          <div class="fp-body">
            ${curveSvg(p, p.sourceTemp)}
            <dl class="fp-meta">
              <dt>Channel</dt><dd>${p.channelLabel ? esc(p.channelLabel) : `<span class="no">${p.channelMissing ? 'missing on this machine' : 'not bound'}</span>`}</dd>
              <dt>Source</dt><dd>${p.sourceLabel ? esc(p.sourceLabel) : `<span class="no">${p.sourceMissing ? 'missing on this machine' : 'not bound'}</span>`}</dd>
              <dt>Now</dt><dd>${p.sourceTemp == null ? '—' : `${Math.round(p.sourceTemp)} °C`}</dd>
              <dt>Commanded</dt><dd>${p.commandedDuty == null ? '—' : `<b>${p.commandedDuty}%</b> <span class="tagx">computed</span>`}</dd>
              <dt>Measured</dt><dd>${p.measuredDuty == null ? '—' : `${Math.round(p.measuredDuty)}% <span class="tagx measured">measured</span>`}</dd>
              <dt>Floor</dt><dd>${p.minDuty}%${p.stopBelow ? ` · stops below ${p.stopBelow}°` : ''}${p.hysteresis ? ` · ${p.hysteresis}° hysteresis` : ''}</dd>
            </dl>
          </div>
          ${drift != null && Math.abs(drift) > 12 ? `<p class="fp-drift">This curve would command ${drift > 0 ? 'more' : 'less'} duty than the ${Math.round(p.measuredDuty)}% measured — by ${Math.abs(drift)} points. Apply it in the tool that holds the driver to close the gap.</p>` : ''}
        </article>`;
      }

      function editor() {
        if (!editing) return '';
        const chans = (live && live.channels) || [];
        const temps = (live && live.temps) || [];
        const src = temps.find((t) => t.id === editing.sourceSensorId);
        const commanded = src && src.value != null ? evaluateLocal(editing, src.value) : null;
        return `<section class="card fan-editor">
          <div class="cardhead">
            <h3>${GLYPHS.curve}${editing.id ? 'Edit curve' : 'New curve'}</h3>
            <div class="cardactions">
              <button class="btn ghost" data-ed="cancel">Cancel</button>
              <button class="btn primary" data-ed="save">${GLYPHS.save}Save curve</button>
            </div>
          </div>
          <div class="ed-grid">
            <label>Name<input id="edName" type="text" value="${esc(editing.name)}" maxlength="60" /></label>
            <label>Channel<select id="edChan">
              <option value="">— not bound —</option>
              ${chans.filter((c) => c.controllable).map((c) => `<option value="${esc(c.id)}" ${c.id === editing.channelId ? 'selected' : ''}>${esc(c.parent)} · ${esc(c.label)}</option>`).join('')}
            </select></label>
            <label>Temperature source<select id="edSrc">
              <option value="">— not bound —</option>
              ${temps.map((t) => `<option value="${esc(t.id)}" ${t.id === editing.sourceSensorId ? 'selected' : ''}>${esc(t.parent)} · ${esc(t.name)}${t.value == null ? '' : ` (${Math.round(t.value)}°)`}</option>`).join('')}
            </select></label>
            <label>Minimum duty<input id="edMin" type="number" min="0" max="100" value="${editing.minDuty}" /></label>
            <label>Stop below °C<input id="edStop" type="number" min="0" max="120" value="${editing.stopBelow}" /></label>
            <label>Hysteresis °C<input id="edHys" type="number" min="0" max="20" value="${editing.hysteresis}" /></label>
          </div>
          <div class="ed-curve">
            ${curveSvg(editing, src ? src.value : null)}
            <div class="ed-side">
              <p class="muted">Click the plot to add a point. Click a point to remove it.${commanded == null ? '' : ` At <b>${Math.round(src.value)}°</b> this curve commands <b>${commanded}%</b>.`}</p>
              <div class="ed-points">
                ${editing.points.map((p, i) => `<span class="pt-chip">${p.t}° → ${p.pct}%<button data-rm="${i}" title="Remove">×</button></span>`).join('')}
              </div>
              <div class="ed-presets">
                ${presets.map((pr) => `<button class="chip-btn" data-shape="${esc(pr.id)}" title="${esc(pr.desc)}">${esc(pr.name)}</button>`).join('')}
              </div>
            </div>
          </div>
        </section>`;
      }

      function evaluateLocal(curve, t) {
        const pts = (curve.points || []).slice().sort((a, b) => a.t - b.t);
        if (!pts.length || t == null) return null;
        let pct;
        if (t <= pts[0].t) pct = pts[0].pct;
        else if (t >= pts[pts.length - 1].t) pct = pts[pts.length - 1].pct;
        else {
          let i = 0;
          while (i < pts.length - 1 && pts[i + 1].t < t) i += 1;
          const a = pts[i];
          const b = pts[i + 1];
          pct = b.t === a.t ? b.pct : a.pct + ((t - a.t) / (b.t - a.t)) * (b.pct - a.pct);
        }
        pct = Math.max(pct, curve.minDuty || 0);
        if (curve.stopBelow > 0 && t < curve.stopBelow) pct = 0;
        return Math.round(Math.max(0, Math.min(100, pct)));
      }

      function render() {
        if (!live) return;
        const sum = live.available ? {
          fans: live.counts.fans, controls: live.counts.controls, temps: live.counts.temps,
          spinning: live.channels.filter((c) => c.spinning === true).length,
          controllable: live.channels.filter((c) => c.controllable).length,
        } : null;
        const hottest = live.available && live.temps.length
          ? live.temps.reduce((a, b) => ((b.value || 0) > (a.value || 0) ? b : a)) : null;

        root.innerHTML = `
          ${live.available ? `
          <section class="fan-stats">
            <div class="stat"><div class="k">${sum.fans}</div><div class="l">Fan channels</div><div class="t">${sum.spinning} spinning</div></div>
            <div class="stat"><div class="k">${sum.controllable}</div><div class="l">Controllable</div><div class="t">of ${sum.fans} channels</div></div>
            <div class="stat"><div class="k">${sum.temps}</div><div class="l">Temp sources</div><div class="t">${hottest ? `${Math.round(hottest.value)}° hottest` : '—'}</div></div>
            <div class="stat"><div class="k">${(store && store.profiles.length) || 0}</div><div class="l">Curves stored</div><div class="t">designed here</div></div>
          </section>` : `
          <section class="card fan-unavailable">
            <h3>${GLYPHS.fan}No sensor driver</h3>
            <p class="muted">${esc(live.reason || 'The sensor tree could not be read.')}</p>
            <p class="muted">Fan channels come from LibreHardwareMonitor's driver. Install and start it from the Hardware workspace, then re-read. Everything below still works once it answers.</p>
            <div class="cardactions"><button class="btn ghost" data-act="hardware">Open Hardware</button><button class="btn ghost" data-act="refresh">Re-read</button></div>
          </section>`}

          ${live.available ? `
          <section class="card">
            <div class="cardhead">
              <h3>${GLYPHS.gauge}Channels</h3>
              <div class="cardactions">
                <span class="muted">read by ${esc(live.reader || 'the sensor driver')}</span>
                <button class="btn ghost" data-act="refresh">Re-read</button>
              </div>
            </div>
            <div class="set-scroll"><table class="fan-table">
              <thead><tr><th>Channel</th><th>Role</th><th>Speed</th><th>Duty</th><th>Control</th><th></th></tr></thead>
              <tbody>${live.channels.map(channelRow).join('')}</tbody>
            </table></div>
          </section>

          <section class="card">
            <div class="cardhead"><h3>${GLYPHS.thermal}Temperature sources</h3><span class="muted">any of these can drive a curve</span></div>
            <div class="temp-grid">
              ${live.temps.map((t) => `<div class="temp-chip ${t.value >= 80 ? 'hot' : t.value >= 65 ? 'warm' : ''}"><b>${t.value == null ? '—' : `${Math.round(t.value)}°`}</b><span>${esc(t.name)}</span><small>${esc(t.parent)}</small></div>`).join('') || '<p class="muted">No temperature sensors reported.</p>'}
            </div>
          </section>` : ''}

          ${editor()}

          <section class="card">
            <div class="cardhead">
              <h3>${GLYPHS.curve}Curves</h3>
              <div class="cardactions">
                <button class="btn ghost" data-act="folder">Export folder</button>
                <button class="btn primary" data-act="new">New curve</button>
              </div>
            </div>
            ${store && store.profiles.length
              ? `<div class="fp-grid">${store.profiles.map(profileCard).join('')}</div>`
              : `<p class="muted">No curves yet. Start from a preset:</p>
                 <div class="ed-presets">${presets.map((pr) => `<button class="chip-btn" data-seed="${esc(pr.id)}" title="${esc(pr.desc)}">${esc(pr.name)}</button>`).join('')}</div>`}
          </section>

          <section class="card fan-honest">
            <h3>Who writes the curve</h3>
            <p class="muted">Setting a fan curve means writing to the Super IO or embedded controller, and on Windows that needs a signed kernel-mode driver. ProGramerly does not ship one. It reads every channel, designs and stores the curve, shows you exactly what that curve would command at the temperature the machine is at right now, and exports it — then hands the apply to the tool that owns the driver. That is the correct division of labour, and it is why Fanzi FanControl is part of this build.</p>
          </section>`;

        // Duty bars through the CSSOM - a parsed style attribute would be dropped.
        if (live.available) {
          const bars = root.querySelectorAll('.duty-bar i');
          let k = 0;
          live.channels.forEach((c) => {
            if (c.duty == null) return;
            const el = bars[k]; k += 1;
            if (el) el.style.width = `${Math.max(0, Math.min(100, c.duty))}%`;
          });
        }
        wire();
        if (revealEditor) {
          revealEditor = false;
          const ed = root.querySelector('.fan-editor');
          if (ed) ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }

      /* ---------------------------------------------------------- wiring */

      function blank() {
        return {
          id: null, name: 'New curve', channelId: null, sourceSensorId: null,
          points: [{ t: 30, pct: 25 }, { t: 50, pct: 40 }, { t: 70, pct: 70 }, { t: 85, pct: 100 }],
          minDuty: 20, stopBelow: 0, hysteresis: 3, basedOn: null,
        };
      }

      function readEditor() {
        editing.name = root.querySelector('#edName').value.trim() || 'Curve';
        editing.channelId = root.querySelector('#edChan').value || null;
        editing.sourceSensorId = root.querySelector('#edSrc').value || null;
        editing.minDuty = Number(root.querySelector('#edMin').value) || 0;
        editing.stopBelow = Number(root.querySelector('#edStop').value) || 0;
        editing.hysteresis = Number(root.querySelector('#edHys').value) || 0;
      }

      function wire() {
        root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
          const act = b.dataset.act;
          if (act === 'refresh') { await reload(); h.toast('Sensor tree re-read.', 'good'); }
          if (act === 'hardware') h.openApp('hardware');
          if (act === 'folder') api.fans.openFolder();
          if (act === 'new') { editing = blank(); revealEditor = true; render(); }
        }));
        root.querySelectorAll('[data-curve-for]').forEach((b) => b.addEventListener('click', () => {
          editing = { ...blank(), channelId: b.dataset.curveFor, name: 'Curve for this channel' };
          const c = live.channels.find((x) => x.id === b.dataset.curveFor);
          const t = live.temps.find((x) => new RegExp(c && c.role === 'gpu' ? 'gpu' : 'cpu', 'i').test(`${x.parent} ${x.name}`)) || live.temps[0];
          if (t) editing.sourceSensorId = t.id;
          revealEditor = true;
          render();
        }));
        root.querySelectorAll('[data-seed]').forEach((b) => b.addEventListener('click', async () => {
          const pr = presets.find((p) => p.id === b.dataset.seed);
          editing = { ...blank(), name: pr.name, points: pr.points.map(([t, pct]) => ({ t, pct })), minDuty: pr.minDuty, stopBelow: pr.stopBelow, hysteresis: pr.hysteresis, basedOn: pr.id };
          const cpu = (live.channels || []).find((c) => c.role === 'cpu' && c.controllable);
          const t = (live.temps || []).find((x) => /cpu|package/i.test(`${x.parent} ${x.name}`)) || (live.temps || [])[0];
          if (cpu) editing.channelId = cpu.id;
          if (t) editing.sourceSensorId = t.id;
          revealEditor = true;
          render();
        }));
        root.querySelectorAll('[data-shape]').forEach((b) => b.addEventListener('click', () => {
          const pr = presets.find((p) => p.id === b.dataset.shape);
          readEditor();
          editing.points = pr.points.map(([t, pct]) => ({ t, pct }));
          editing.minDuty = pr.minDuty; editing.stopBelow = pr.stopBelow; editing.hysteresis = pr.hysteresis;
          editing.basedOn = pr.id;
          render();
        }));
        root.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', async () => {
          if (b.dataset.ed === 'cancel') { editing = null; render(); return; }
          readEditor();
          const res = await api.fans.save(editing);
          if (!res.ok) { h.toast(res.error || 'The curve could not be saved.', 'bad'); return; }
          editing = null;
          await reload();
          h.toast('Curve saved.', 'good');
        }));
        root.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
          readEditor();
          editing.points.splice(Number(b.dataset.rm), 1);
          render();
        }));
        root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
          const p = store.profiles.find((x) => x.id === b.dataset.edit);
          editing = { ...p, points: p.points.map((q) => ({ ...q })) };
          revealEditor = true;
          render();
        }));
        root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
          if (!window.confirm('Delete this curve?')) return;
          await api.fans.remove(b.dataset.del);
          await reload();
          h.toast('Curve deleted.');
        }));
        root.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', async () => {
          const res = await api.fans.exportProfile(b.dataset.export);
          h.toast(res.ok ? `Written to ${res.file}` : (res.error || 'Export failed.'), res.ok ? 'good' : 'bad');
        }));

        // Click the plot to add a point; click a point to remove it.
        const svg = root.querySelector('.ed-curve .curve-svg');
        if (svg) {
          svg.addEventListener('click', (e) => {
            const pt = e.target.closest('.pt');
            readEditor();
            if (pt) {
              editing.points.splice(Number(pt.dataset.i), 1);
            } else {
              const r = svg.getBoundingClientRect();
              const vx = ((e.clientX - r.left) / r.width) * W;
              const vy = ((e.clientY - r.top) / r.height) * H;
              const t = Math.round(((vx - PAD.l) / (W - PAD.l - PAD.r)) * 100);
              const pctv = Math.round(((H - PAD.b - vy) / (H - PAD.t - PAD.b)) * 100);
              if (t < 0 || t > 100 || pctv < -2 || pctv > 102) return;
              editing.points = editing.points.filter((p) => p.t !== t);
              editing.points.push({ t: Math.max(0, Math.min(100, t)), pct: Math.max(0, Math.min(100, pctv)) });
              editing.points.sort((a, b2) => a.t - b2.t);
            }
            render();
          });
        }
      }

      async function reload() {
        const [c, p] = await Promise.all([api.fans.channels(), api.fans.profiles()]);
        live = c; store = p;
        render();
      }

      presets = await api.fans.presets();
      await reload();
      // Fans move. Re-read while this window is open, and stop when it closes.
      timer = setInterval(async () => {
        if (!document.body.contains(root)) { clearInterval(timer); return; }
        if (editing) return;                       // never redraw under the cursor mid-edit
        try { await reload(); } catch { /* transient */ }
      }, 5000);
      return () => clearInterval(timer);
    },
  };

  window.PGApps = { GLYPHS, dome, fans, esc, bytes };
})();
