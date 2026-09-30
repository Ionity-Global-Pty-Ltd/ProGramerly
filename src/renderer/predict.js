'use strict';
/* ProGramerly - AEDi Predict surface
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   PGApps.predict  the forecast for the current Software selection (how long,
                   how much disk, how likely each item is to install cleanly
                   on THIS machine), the machine's own trend (disk days-to-
                   full, memory), and what belongs next to what is here.

   Every figure shows its class - measured, learned, computed, assumed - the
   same four words the DOME uses. The local model can explain a forecast; it
   never adds a number to it. Nothing here leaves the machine. */

(() => {
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const S = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    crystal: S('<path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 3v18M5 7l7 4 7-4"/>'),
    refresh: S('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
    spark: S('<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z"/>'),
    play: S('<path d="M7 4l12 8-12 8z"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    trash: S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  };
  const gb = (n) => (n == null ? '—' : `${Number(n).toFixed(1)} GB`);
  const pct = (p) => `${Math.round((Number(p) || 0) * 100)}%`;
  const cls = (c) => (c ? `<span class="pd-class ${esc(c)}" title="${esc(CLASS_TIP[c] || c)}">${esc(c)}</span>` : '');
  const CLASS_TIP = {
    measured: 'read off this machine just now',
    learned: 'taken from previous runs on this machine',
    computed: 'arithmetic over measured, learned and assumed inputs',
    assumed: 'the shipped prior - replaced by a learned value once this item has run here',
    stated: 'a relation stated in the catalog, not a statistic',
  };
  const selection = () => (window.PGSelection ? window.PGSelection.get() : []);

  const predict = {
    async mount(host, h) {
      const api = h.api;
      let pack = null;
      let mach = null;
      let sugg = [];
      let busy = false;
      let explaining = false;

      host.innerHTML = `
        <div class="mg-app pd-app">
          <div class="mg-top">
            <div class="mg-title">${I.crystal}<b>AEDi Predict</b><span class="mg-meta" id="pdMeta">reading…</span></div>
            <div class="mg-tools">
              <button class="btn ghost" data-act="facts" title="Re-probe engines on PATH and package hosts">${I.refresh}Re-read</button>
              <button class="btn ghost" data-act="explain" title="The local model explains this forecast - it never adds a number">${I.spark}Explain</button>
              <button class="btn primary" data-act="install" title="Open Software and start this selection">${I.play}Install selection</button>
            </div>
          </div>
          <div class="pd-stats" id="pdStats"></div>
          <div class="pd-facts" id="pdFacts"></div>
          <section class="pd-explain" id="pdExplain" hidden><div class="pd-explain-head"><span class="ai-orb"></span><b>AEDi</b><small id="pdExplainMeta"></small></div><div class="pd-explain-body" id="pdExplainBody"></div></section>
          <section class="pd-risks" id="pdRisks"></section>
          <div class="pd-cols">
            <section class="pd-items"><div class="mg-table-wrap pd-table-wrap"><table class="mg-table" id="pdTable"></table></div></section>
            <aside class="pd-side">
              <section class="pd-card" id="pdMachine"></section>
              <section class="pd-card" id="pdSuggest"></section>
              <section class="pd-card pd-learn" id="pdLearn"></section>
            </aside>
          </div>
        </div>`;
      const root = host.querySelector('.pd-app');
      const $ = (s) => root.querySelector(s);

      const offToken = api.predict.onToken((t) => {
        const body = $('#pdExplainBody'); if (!body) return;
        if (t.start) { $('#pdExplain').hidden = false; body.textContent = ''; $('#pdExplainMeta').textContent = `AEDi · ${t.model} · restating the forecast, adding nothing`; }
        if (t.token) body.textContent += t.token;
        if (t.error) body.textContent += `\n[${t.error}]`;
        if (t.done) { explaining = false; if (t.stats && t.stats.tokensPerSec) $('#pdExplainMeta').textContent += ` · ${t.stats.tokensPerSec} tok/s`; }
      });

      function paintStats() {
        const el = $('#pdStats'); if (!pack) { el.innerHTML = ''; return; }
        const m = pack.minutes; const d = pack.disk; const l = pack.likelihood;
        const tile = (k, label, sub, c, tone) => `<div class="pd-stat ${tone || ''}"><div class="k">${k}</div><div class="l">${label}</div><div class="t">${sub}</div>${cls(c)}</div>`;
        el.innerHTML = [
          tile(pack.count ? `${m.expected} min` : '—', 'Run time', pack.count ? `${m.low}–${m.high} min · speed factor ${m.speedFactor} (${m.speedSamples} run${m.speedSamples === 1 ? '' : 's'})` : 'nothing selected', m.class),
          tile(pack.count ? gb(d.gb) : '—', 'Download', d.freeGb != null ? `${gb(d.freeGb)} free on ${esc(d.disk || 'system disk')} → ${gb(d.afterGb)} after · reserve ${d.reserveGb} GB` : 'free space not read yet', d.afterGb != null && d.afterGb < d.reserveGb ? 'computed' : d.gbClass, d.afterGb != null && d.afterGb < d.reserveGb ? 'bad' : ''),
          tile(pack.count ? `≈${Math.max(0, Math.round(pack.count - l.expectedFailures))} of ${pack.count}` : '—', 'Expected clean', pack.count ? `${l.expectedFailures} expected failure${l.expectedFailures === 1 ? '' : 's'} · every item clean ${pct(l.allOk)}` : 'nothing selected', l.class, l.expectedFailures >= Math.max(1, pack.count * 0.25) ? 'warn' : ''),
          tile(pct(l.learnedShare), 'Learned share', `${pack.runsRecorded} run${pack.runsRecorded === 1 ? '' : 's'} on record - the rest is the shipped prior`, l.learnedShare > 0 ? 'learned' : 'assumed'),
        ].join('');
      }

      function paintFacts() {
        const el = $('#pdFacts'); if (!pack) { el.innerHTML = ''; return; }
        const f = pack.facts;
        const eng = Object.entries(f.engines).map(([k, ok]) => `<span class="mg-chip ${ok ? 'ok' : 'off'}" title="${ok ? 'on PATH' : 'not on PATH'}"><i></i>${esc(k)}</span>`).join('');
        const hosts = Object.entries(f.hosts).map(([k, r]) => `<span class="mg-chip ${r.ok ? 'ok' : 'warn'}" title="${esc(r.label)} · TCP connect ${r.ok ? `${r.ms} ms` : 'failed'}"><i></i>${esc(r.label)}${r.ok ? ` ${r.ms}ms` : ' ✕'}</span>`).join('');
        el.innerHTML = `<div class="pd-factrow"><span class="pd-factlabel">Engines ${cls('measured')}</span>${eng}<span class="mg-chip ${f.elevated ? 'ok' : 'warn'}"><i></i>${f.elevated ? 'administrator' : 'standard user'}</span></div>
          <div class="pd-factrow"><span class="pd-factlabel">Package hosts ${cls('measured')}</span>${hosts}<span class="pd-factage">read ${Math.max(0, Math.round((Date.now() - f.at) / 1000))} s ago</span></div>`;
      }

      function paintRisks() {
        const el = $('#pdRisks'); if (!pack) { el.innerHTML = ''; return; }
        if (!pack.risks.length) { el.innerHTML = pack.count ? '<p class="pd-ok">No risk found in the facts read. What remains is the prior - assumed until this machine has run these items.</p>' : ''; return; }
        el.innerHTML = pack.risks.map((r) => `<div class="pd-risk ${esc(r.level)}"><i></i><span>${esc(r.text)}</span>${cls(r.class)}</div>`).join('');
      }

      function paintTable() {
        const t = $('#pdTable');
        if (!pack || !pack.count) {
          t.innerHTML = '<caption>Selection</caption><tbody><tr><td class="empty">Nothing is ticked in Software. Tick items there, or pick a profile, and the forecast appears here.</td></tr></tbody>';
          return;
        }
        t.innerHTML = `<caption>${pack.count} item${pack.count === 1 ? '' : 's'} in run order, dependencies included</caption>
          <thead><tr><th>Item</th><th>Likely</th><th>Minutes</th><th>GB</th><th>Needs</th><th>Basis</th></tr></thead>
          <tbody>${pack.items.map((i) => `<tr class="${i.p < 0.5 ? 'off' : ''}">
            <td><b>${esc(i.name)}</b><small>${esc(i.group)}${i.elevate ? ' · admin' : ''}${i.reboot ? ' · reboot' : ''}${i.notes.length ? ` · ${esc(i.notes.join(' · '))}` : ''}</small></td>
            <td><div class="pd-bar" title="${pct(i.p)}"><i data-w="${Math.round(i.p * 100)}" class="${i.p >= 0.8 ? 'good' : i.p >= 0.5 ? 'mid' : 'bad'}"></i></div><small>${pct(i.p)} ${cls(i.pClass)}</small></td>
            <td>${i.minutes} ${cls(i.minClass)}</td>
            <td>${i.gb ? i.gb.toFixed(2) : '—'} ${cls(i.gbClass)}</td>
            <td><small>${esc([...i.needs.engines].join(', ') || '—')}</small></td>
            <td><small>${i.runs ? `${i.runs} run${i.runs === 1 ? '' : 's'} here` : 'prior'}</small></td>
          </tr>`).join('')}</tbody>`;
      }

      function paintMachine() {
        const el = $('#pdMachine'); if (!mach) { el.innerHTML = '<h4>Machine forecast</h4><p class="muted">reading…</p>'; return; }
        const disks = mach.disks.map((d) => `<div class="pd-disk"><div class="pd-disk-head"><b>${esc(d.name)}</b><span>${d.free != null ? `${(d.free / 1e9).toFixed(1)} GB free` : '—'} ${cls(d.class)}</span></div>
          <div class="pd-bar wide"><i data-w="${Math.round(d.usedPct || 0)}" class="${(d.usedPct || 0) >= 90 ? 'bad' : (d.usedPct || 0) >= 75 ? 'mid' : 'good'}"></i></div>
          <small>${d.daysToFull != null ? `filling at ${Math.abs(d.trendGbPerDay)} GB/day → full in ~${d.daysToFull} days ${cls('computed')}` : d.trendGbPerDay != null ? `${d.trendGbPerDay >= 0 ? 'freeing' : 'filling'} at ${Math.abs(d.trendGbPerDay)} GB/day over ${d.samples} samples ${cls('computed')}` : `${d.samples} sample${d.samples === 1 ? '' : 's'} - no trend yet`}</small></div>`).join('');
        el.innerHTML = `<h4>Machine forecast <small>${mach.samples} samples · ${mach.spanHours} h</small></h4>
          ${mach.note ? `<p class="muted">${esc(mach.note)}</p>` : ''}
          ${disks || '<p class="muted">No fixed disk reported yet.</p>'}
          <div class="pd-kv">
            <span>Memory now</span><b>${mach.memory.now != null ? `${mach.memory.now}%` : '—'} ${cls(mach.memory.nowClass)}</b>
            <span>Memory 24 h</span><b>${mach.memory.avg24h != null ? `avg ${mach.memory.avg24h}% · peak ${mach.memory.peak24h}%` : '—'} ${cls(mach.memory.class)}</b>
            <span>CPU 24 h</span><b>${mach.cpu.avg24h != null ? `avg ${mach.cpu.avg24h}% · peak ${mach.cpu.peak24h}%` : '—'} ${cls(mach.cpu.class)}</b>
            <span>Install budget</span><b>${mach.installBudget ? `${mach.installBudget.gb} GB on ${esc(mach.installBudget.disk)} (after the ${mach.installBudget.reserveGb} GB reserve)` : '—'} ${cls(mach.installBudget ? 'computed' : null)}</b>
          </div>`;
      }

      function paintSuggest() {
        const el = $('#pdSuggest');
        el.innerHTML = `<h4>Belongs next <small>stated relations, not statistics</small></h4>
          ${sugg.length ? `<div class="pd-sugg">${sugg.map((s) => `<button class="pd-sug" data-add="${esc(s.id)}" title="${esc(s.reason)}"><b>${I.plus}${esc(s.name)}</b><small>${esc(s.reason)}</small></button>`).join('')}</div>` : '<p class="muted">Nothing to add: every stated relation of the selection is already covered.</p>'}`;
        el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
          const s = sugg.find((x) => x.id === b.dataset.add);
          if (window.PGSelection) window.PGSelection.add(b.dataset.add);
          h.toast(`Added ${s ? s.name : b.dataset.add} to the selection.`, 'good');
          await refresh();
        }));
      }

      function paintLearn() {
        const el = $('#pdLearn');
        el.innerHTML = `<h4>What it has learned</h4>
          <p class="muted">Every run teaches this machine's own outcomes and timings into <code>predict/history.json</code>; the speed factor scales the shipped minutes to this line and disk. Three real outcomes outweigh the prior.</p>
          <div class="mg-card-actions"><button class="btn ghost danger" data-act="reset">${I.trash}Forget the history</button></div>`;
      }

      async function refresh(force) {
        if (busy) return; busy = true;
        $('#pdMeta').textContent = 'reading the machine…';
        try {
          const ids = selection();
          if (force) await api.predict.facts(true);
          [pack, mach, sugg] = await Promise.all([api.predict.forecast(ids), api.predict.machine(), api.predict.suggest(ids)]);
          $('#pdMeta').textContent = `${ids.length} selected · ${pack.facts.online ? 'online' : 'offline'} · ${new Date(pack.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          paintStats(); paintFacts(); paintRisks(); paintTable(); paintMachine(); paintSuggest(); paintLearn();
          // Strict CSP drops style="" attributes; widths go on through the CSSOM.
          root.querySelectorAll('.pd-bar i[data-w]').forEach((i) => { i.style.width = `${i.dataset.w}%`; });
          root.querySelector('[data-act="reset"]').addEventListener('click', async () => {
            await api.predict.reset(); h.toast('Forecast history forgotten - back to the shipped priors.', 'good'); await refresh();
          });
        } catch (err) {
          $('#pdMeta').textContent = `could not forecast: ${err.message || err}`;
        } finally { busy = false; }
      }

      root.querySelector('[data-act="facts"]').addEventListener('click', () => refresh(true));
      root.querySelector('[data-act="install"]').addEventListener('click', () => {
        if (!selection().length) { h.toast('Nothing selected - tick items in Software first.', 'bad'); return; }
        h.openApp('software');
      });
      root.querySelector('[data-act="explain"]').addEventListener('click', async () => {
        if (explaining || !pack) return;
        explaining = true;
        const res = await api.predict.explain({ pack });
        if (!res.ok) { explaining = false; $('#pdExplain').hidden = false; $('#pdExplainBody').textContent = res.error || 'The model did not answer.'; $('#pdExplainMeta').textContent = ''; }
      });

      await refresh();
      const timer = setInterval(() => { if (!busy && !explaining) refresh(); }, 90 * 1000);
      return () => { clearInterval(timer); offToken(); };
    },
  };

  window.PGApps = Object.assign(window.PGApps || {}, { predict });
})();
