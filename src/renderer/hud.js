'use strict';
/* ProGramerly - tray hover panel
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED */

const api = window.programerly;
const $ = (id) => document.getElementById(id);

function bits(bps) {
  const b = (bps || 0) * 8;
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} Gb/s`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} Mb/s`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} kb/s`;
  return `${Math.round(b)} b/s`;
}

function size(n) {
  if (!n) return '0';
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1)} TB`;
  if (n >= 1024 ** 3) return `${Math.round(n / 1024 ** 3)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

function colourFor(pct, invert = false) {
  const v = invert ? 100 - pct : pct;
  if (v >= 90) return 'var(--err)';
  if (v >= 75) return 'var(--warn)';
  return 'var(--cyan)';
}

function ring(el, valEl, pct, label, colour) {
  el.style.setProperty('--pct', Math.max(0, Math.min(100, pct || 0)));
  el.style.setProperty('--col', colour);
  valEl.textContent = label;
}

api.onHud((d) => {
  const m = d.metrics || {};
  const cpu = m.cpu || {};
  const mem = m.mem || {};
  const net = m.net || {};
  const temp = (m.temp || {}).c;

  $('host').textContent = m.host || '';

  ring($('cpuRing'), $('cpuVal'), cpu.load || 0, `${Math.round(cpu.load || 0)}%`, colourFor(cpu.load || 0));
  const tPct = temp === null || temp === undefined ? 0 : Math.max(0, Math.min(100, ((temp - 25) / 70) * 100));
  ring($('tempRing'), $('tempVal'), tPct, temp === null || temp === undefined ? '—' : `${Math.round(temp)}°`, colourFor(tPct));
  ring($('memRing'), $('memVal'), mem.usedPct || 0, `${Math.round(mem.usedPct || 0)}%`, colourFor(mem.usedPct || 0));

  $('rx').textContent = bits(net.rxBps);
  $('tx').textContent = bits(net.txBps);
  $('ping').textContent = d.ping ? `${Math.round(d.ping)} ms` : '—';

  const disks = (m.disks || []).slice(0, 5);
  $('drives').innerHTML = disks.map((dk) => {
    const cls = dk.usedPct >= 92 ? 'low' : dk.usedPct >= 80 ? 'mid' : '';
    const nm = (dk.name || '').replace(/\\$/, '');
    return `<div class="drive ${cls}">
      <span class="nm" title="${dk.label || ''}">${nm}</span>
      <span class="track"><i style="width:${Math.min(100, dk.usedPct)}%"></i></span>
      <span class="free">${size(dk.free)}</span>
    </div>`;
  }).join('') || '<div class="drive"><span class="nm">—</span><span class="track"></span><span class="free">reading…</span></div>';

  const sync = d.sync;
  $('foot').textContent = sync && sync.enabled
    ? `In sync · next ${sync.nextRunAt ? new Date(sync.nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}${sync.autoInstall ? ' · auto-install on' : ' · report only'}`
    : 'Sync off · Policy 986 AED';
});
