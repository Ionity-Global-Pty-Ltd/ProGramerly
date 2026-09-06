'use strict';
/* ProGramerly - renderer
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED */

const api = window.programerly;
const $ = (id) => document.getElementById(id);

let CATALOG = null;
let PLATFORM = 'win';
let SETTINGS = {};
let INFO = {};
let selected = new Set();
let activeProfile = null;
let queueOrder = [];
let tally = { ok: 0, partial: 0, failed: 0, skipped: 0 };
let activeTab = 'software';
let installing = false;

/* Rough download footprint, GB, per item id. Only used for the estimate line. */
const SIZE_GB = {
  'visual-studio': 22, 'android-studio': 9, 'android-sdk': 3.5, 'vs-buildtools': 6,
  docker: 3.5, dotnet: 2.4, java: 0.9, wsl: 1.6, 'ollama-models': 12, 'lm-studio': 0.6,
  'windows-sdk': 2.5, cpp: 1.2, pytorch: 2.6, tensorflow: 1.4, transformers: 1.1,
  'ml-toolkit': 1.2, 'agent-frameworks': 1.0, 'flutter-dart': 2.8, 'kotlin-gradle': 0.6,
  mongodb: 0.8, postgresql: 0.4, mysql: 0.5, sqlserver: 3.2, xampp: 0.6,
  'jetbrains-toolbox': 0.4, antigravity: 0.6, cursor: 0.5, windsurf: 0.5,
  arduino: 0.9, 'esp-embedded-extras': 0.4, 'react-native': 0.4, postman: 0.5,
};
const DEFAULT_GB = 0.18;

/* ======================================================================== *
 *  helpers
 * ======================================================================== */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bits(bps) {
  const b = (bps || 0) * 8;
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} Gb/s`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} Mb/s`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} kb/s`;
  return `${Math.round(b)} b/s`;
}

function size(n, digits = 1) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / (1024 ** i)).toFixed(i < 2 ? 0 : digits)} ${u[i]}`;
}

function duration(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d ? `${d}d ` : ''}${h}h ${m}m`;
}

function clock(ts) {
  return ts ? new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function colourFor(pct) {
  if (pct >= 90) return 'var(--err)';
  if (pct >= 75) return 'var(--warn)';
  return 'var(--cyan)';
}

function pushInto(el, { text, level }) {
  const line = document.createElement('div');
  line.className = `l ${level || ''}`;
  line.textContent = text;
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  el.appendChild(line);
  while (el.childElementCount > 3000) el.removeChild(el.firstChild);
  if (stick) el.scrollTop = el.scrollHeight;
}

/* ======================================================================== *
 *  tabs
 * ======================================================================== */

const VIEWS = {
  software: 'pickView',
  monitor: 'monitorView',
  network: 'networkView',
  maintenance: 'maintView',
  ai: 'aiView',
  projects: 'projectsView',
  terminals: 'terminalsView',
  hardware: 'hardwareView',
  doctor: 'doctorView',
  updates: 'updatesView',
  settings: 'settingsView',
};

function showTab(tab) {
  if (!VIEWS[tab]) return;
  activeTab = tab;
  for (const [key, id] of Object.entries(VIEWS)) {
    $(id).hidden = !(key === tab && !(key === 'software' && installing));
  }
  $('runView').hidden = !(tab === 'software' && installing);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));

  const softwareTab = tab === 'software';
  $('installBtn').hidden = !softwareTab || installing;
  $('cancelBtn').hidden = !(softwareTab && installing);
  $('selCount').parentElement.style.opacity = softwareTab ? '1' : '.45';

  if (tab === 'maintenance' && !maintLoaded) loadRegistry();
  if (tab === 'doctor' && !doctorLoaded) runDoctorScan();
  if (tab === 'ai' && !aiLoaded) loadAi();
  if (tab === 'projects' && !projLoaded) loadProjects();
  if (tab === 'terminals' && !termLoaded) loadTerminals();
  if (tab === 'hardware' && !hwLoaded) loadHardware();
  if (tab === 'network' && !linksLoaded) { loadLinks(); initNetwork(); }
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => showTab(t.dataset.tab));
});

/* ======================================================================== *
 *  SOFTWARE
 * ======================================================================== */

function applies(item) {
  if (Array.isArray(item.platforms) && item.platforms.length) return item.platforms.includes(PLATFORM);
  return Boolean(item[PLATFORM] || item.npm || item.steps);
}

function renderProfiles() {
  $('profiles').innerHTML = Object.entries(CATALOG.profiles).map(([key, p]) => `
    <button class="profile${activeProfile === key ? ' active' : ''}" data-profile="${key}">
      <h3>${esc(p.label)}${p.recommended ? '<span class="pill">RECOMMENDED</span>' : ''}</h3>
      <p>${esc(p.desc)}</p>
    </button>`).join('');
  $('profiles').querySelectorAll('.profile').forEach((el) => {
    el.addEventListener('click', () => pickProfile(el.dataset.profile));
  });
}

function pickProfile(key) {
  activeProfile = key;
  selected = new Set(
    key === 'custom' ? []
      : CATALOG.items.filter((i) => applies(i) && (i.profiles || []).includes(key)).map((i) => i.id),
  );
  if (window.nodeField) window.nodeField.setEnabled(SETTINGS.nodeBackdrop !== false);
  loadProfile().catch(() => { /* the profile card is not worth failing boot over */ });


  renderProfiles();
  renderItems();
  renderNav();
  updateFooter();
}

function renderNav() {
  $('groupNav').innerHTML = CATALOG.groups
    .filter((g) => CATALOG.items.some((i) => i.group === g.id && applies(i)))
    .map((g) => {
      const ids = CATALOG.items.filter((i) => i.group === g.id && applies(i));
      const on = ids.filter((i) => selected.has(i.id)).length;
      return `<button class="gnav" data-goto="${g.id}">
        <span>${esc(g.label)}</span><span class="n">${on}/${ids.length}</span></button>`;
    }).join('');

  $('groupNav').querySelectorAll('.gnav').forEach((el) => {
    el.addEventListener('click', () => {
      document.getElementById(`sec-${el.dataset.goto}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('groupNav').querySelectorAll('.gnav').forEach((n) => n.classList.remove('active'));
      el.classList.add('active');
    });
  });
}

function tagsFor(item) {
  const t = [];
  if (item.elevate) t.push('<span class="tag admin">admin</span>');
  if ((SIZE_GB[item.id] || 0) >= 3) t.push('<span class="tag big">large</span>');
  if (item.reboot) t.push('<span class="tag reboot">reboot</span>');
  return t.join('');
}

function renderItems() {
  $('items').innerHTML = CATALOG.groups.map((g) => {
    const items = CATALOG.items.filter((i) => i.group === g.id);
    if (!items.filter(applies).length) return '';
    return `
      <div class="gsection" id="sec-${g.id}">
        <div class="ghead">
          <h2>${esc(g.label)}</h2>
          <span class="gdesc">${esc(g.desc)}</span>
          <button class="gall" data-group="${g.id}">toggle all</button>
        </div>
        ${items.map((i) => {
          const na = !applies(i);
          const on = selected.has(i.id);
          return `<div class="row${on ? ' on' : ''}${na ? ' na' : ''}" data-id="${i.id}"${na ? ' aria-disabled="true"' : ''}>
            <span class="tick"></span>
            <div class="rmain">
              <div class="rname">${esc(i.name)}${na ? '<span class="tag na">not on this OS</span>' : tagsFor(i)}</div>
              <div class="rdesc">${esc(i.desc)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }).join('');

  $('items').querySelectorAll('.row:not(.na)').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      el.classList.toggle('on');
      activeProfile = 'custom';
      renderProfiles();
      renderNav();
      updateFooter();
    });
  });

  $('items').querySelectorAll('.gall').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const ids = CATALOG.items.filter((i) => i.group === el.dataset.group && applies(i)).map((i) => i.id);
      const allOn = ids.every((id) => selected.has(id));
      ids.forEach((id) => (allOn ? selected.delete(id) : selected.add(id)));
      activeProfile = 'custom';
      renderProfiles();
      renderItems();
      renderNav();
      updateFooter();
    });
  });
}

function updateFooter() {
  const n = selected.size;
  $('selCount').textContent = `${n} selected`;
  const gb = [...selected].reduce((sum, id) => sum + (SIZE_GB[id] ?? DEFAULT_GB), 0);
  $('selSize').textContent = n ? `~${gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb.toFixed(1)} GB`} to download` : '—';
  $('installBtn').disabled = n === 0;
}

function paintTally() {
  $('tallyOk').textContent = tally.ok;
  $('tallyPartial').textContent = tally.partial;
  $('tallyFail').textContent = tally.failed;
  $('tallySkip').textContent = tally.skipped;
}

function iconFor(state) {
  switch (state) {
    case 'running': return '<span class="spin">◜</span>';
    case 'ok': return '✓';
    case 'partial': return '!';
    case 'failed': return '✕';
    case 'skipped': return '–';
    default: return '○';
  }
}

function paintQueue() {
  $('queue').innerHTML = queueOrder.map((q) => `
    <div class="qrow ${q.state || ''}" data-q="${q.id}">
      <span class="qicon">${iconFor(q.state)}</span>
      <span class="qname">${esc(q.name)}</span>
    </div>`).join('');
  $('queue').querySelector('.qrow.running')?.scrollIntoView({ block: 'nearest' });
}

/* ======================================================================== *
 *  MONITOR
 * ======================================================================== */

const history = { rx: [], tx: [] };
const HISTORY_LEN = 90;

function ring(el, valEl, pct, label) {
  el.style.setProperty('--pct', Math.max(0, Math.min(100, pct || 0)));
  el.style.setProperty('--col', colourFor(pct || 0));
  valEl.textContent = label;
}

function drawNetChart() {
  const c = $('netChart');
  if (!c || !c.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(c.clientWidth * dpr)) {
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(72 * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = c.clientWidth;
  const h = 72;
  g.clearRect(0, 0, w, h);

  const peak = Math.max(1, ...history.rx, ...history.tx);
  const line = (data, colour, fill) => {
    if (data.length < 2) return;
    g.beginPath();
    data.forEach((v, i) => {
      const x = (i / (HISTORY_LEN - 1)) * w;
      const y = h - 4 - (v / peak) * (h - 10);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.strokeStyle = colour;
    g.lineWidth = 1.6;
    g.stroke();
    g.lineTo(((data.length - 1) / (HISTORY_LEN - 1)) * w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  line(history.rx, '#00c6ff', 'rgba(0,198,255,.14)');
  line(history.tx, '#33d69f', 'rgba(51,214,159,.10)');
}

function paintMonitor(d) {
  const m = d.metrics || {};
  const cpu = m.cpu || {};
  const mem = m.mem || {};
  const net = m.net || {};
  const temp = (m.temp || {}).c;

  ring($('mCpuRing'), $('mCpuVal'), cpu.load || 0, `${Math.round(cpu.load || 0)}%`);
  $('mCpuModel').textContent = `${cpu.model || 'CPU'} · ${cpu.cores || '?'} threads`;

  const tPct = (temp === null || temp === undefined) ? 0 : Math.max(0, Math.min(100, ((temp - 25) / 70) * 100));
  ring($('mTempRing'), $('mTempVal'), tPct, (temp === null || temp === undefined) ? '—' : String(Math.round(temp)));
  $('mTempSrc').textContent = (m.temp && m.temp.source)
    ? `via ${m.temp.source}`
    : 'no sensor exposed to the OS — install LibreHardwareMonitor for a reading';

  ring($('mMemRing'), $('mMemVal'), mem.usedPct || 0, `${Math.round(mem.usedPct || 0)}%`);
  $('mMemNote').textContent = `${size(mem.total - mem.free)} of ${size(mem.total)} in use`;

  $('mRx').textContent = bits(net.rxBps);
  $('mTx').textContent = bits(net.txBps);
  $('mPing').textContent = d.ping ? `${Math.round(d.ping)} ms` : '—';
  $('mIface').textContent = net.iface ? `busiest adapter: ${net.iface}` : 'no adapter statistics yet';

  history.rx.push(net.rxBps || 0);
  history.tx.push(net.txBps || 0);
  while (history.rx.length > HISTORY_LEN) history.rx.shift();
  while (history.tx.length > HISTORY_LEN) history.tx.shift();
  if (activeTab === 'monitor') drawNetChart();

  $('driveList').innerHTML = (m.disks || []).map((dk) => {
    const cls = dk.usedPct >= 92 ? 'low' : dk.usedPct >= 80 ? 'mid' : '';
    return `<div class="dv ${cls}">
      <div class="dvtop">
        <span class="dvname">${esc((dk.name || '').replace(/\\$/, ''))}</span>
        <span class="dvlabel">${esc(dk.label || (dk.removable ? 'removable' : ''))}</span>
        <span class="dvpct">${dk.usedPct}%</span>
      </div>
      <div class="track"><i style="width:${Math.min(100, dk.usedPct)}%"></i></div>
      <div class="dvfoot">${size(dk.free)} free of ${size(dk.total)}</div>
    </div>`;
  }).join('') || '<p class="cardnote">reading drives…</p>';

  $('machineKv').innerHTML = [
    ['Host', m.host],
    ['Platform', m.platform],
    ['Uptime', duration(m.uptimeSec || 0)],
    ['Dev root', INFO.devRoot],
    ['Log file', INFO.logFile],
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('');
}

/* ======================================================================== *
 *  NETWORK
 * ======================================================================== */

let sweepRunning = false;
let linksLoaded = false;
const regionState = new Map();

function regionCard(r) {
  const cls = r.grade || (r.running ? 'running' : '');
  const targets = (r.targets || []).map((t) => `
    <div class="tgt"><span>${esc(t.host)}</span><b>${t.avg === null || t.avg === undefined ? '—' : `${Math.round(t.avg)}`}</b></div>`).join('');
  return `<div class="rg ${cls}${r.running ? ' running' : ''}">
    <div class="rgtop">
      <span class="rgname">${esc(r.label)}</span>
      <span class="rgcc">${esc(r.cc || '')}</span>
      ${r.isLocal ? '<span class="local">local</span>' : ''}
      <span class="rgavg">${r.avg === null || r.avg === undefined ? (r.running ? '…' : '—') : Math.round(r.avg)}<span class="rgunit">ms</span></span>
    </div>
    <div class="rgbars">${targets}</div>
    <div class="rgfoot">
      <span>loss ${r.loss === undefined ? '—' : `${r.loss}%`}</span>
      <span>jitter ${r.jitter === null || r.jitter === undefined ? '—' : `${Math.round(r.jitter)} ms`}</span>
      <span>${r.total ? `${r.reachable}/${r.total} reachable` : ''}</span>
      <span>${esc(r.grade || '')}</span>
    </div>
  </div>`;
}

function paintRegions() {
  $('regionGrid').innerHTML = [...regionState.values()].map(regionCard).join('')
    || '<p class="cardnote">Run a sweep to measure every region.</p>';
}

async function initNetwork() {
  paintRegions();
  const g = await api.geo();
  $('geoLine').textContent = g.ok
    ? `${g.ip} · ${g.country} · edge ${g.colo}`
    : 'could not reach the Cloudflare edge to locate this machine';
}

async function loadLinks() {
  linksLoaded = true;
  try {
    const data = await api.links();
    $('linkList').innerHTML = data.groups.flatMap((g) => g.links.map((l) => `
      <div class="lk" data-url="${esc(l.url)}">
        <span class="lkdot"></span>
        <span class="lkname">${esc(l.name)}</span>
        <span class="lkms">${esc(g.label)}</span>
      </div>`)).join('');
    $('linkList').querySelectorAll('.lk').forEach((el) => {
      el.addEventListener('click', () => api.openExternal(el.dataset.url));
    });
  } catch {
    $('linkList').innerHTML = '<p class="cardnote">could not read the link registry</p>';
  }
}

function paintLinkResults(results) {
  const byUrl = new Map(results.map((r) => [r.url, r]));
  $('linkList').querySelectorAll('.lk').forEach((el) => {
    const r = byUrl.get(el.dataset.url);
    if (!r) return;
    el.classList.toggle('ok', r.ok);
    el.classList.toggle('bad', !r.ok);
    el.querySelector('.lkms').textContent = r.ok ? `${r.ms} ms` : (r.status ? `HTTP ${r.status}` : 'unreachable');
  });
}

/* ======================================================================== *
 *  MAINTENANCE
 * ======================================================================== */

let maintLoaded = false;
let regFixes = [];
const regSelected = new Set();

async function loadRegistry() {
  maintLoaded = true;
  $('regList').innerHTML = '<p class="cardnote">scanning…</p>';
  const res = await api.registryScan();

  if (!res.ok) {
    $('regList').innerHTML = `<p class="cardnote">${esc(res.error)}</p>`;
    $('toolList').innerHTML = '';
    return;
  }

  regFixes = res.fixes;
  regSelected.clear();
  regFixes.filter((f) => f.status === 'actionable' && f.action !== 'remove').forEach((f) => regSelected.add(f.id));
  paintRegistry();

  $('toolList').innerHTML = res.tools.map((t) => `
    <div class="tl">
      <h4>${esc(t.name)}</h4>
      <p>${esc(t.desc)}</p>
      <div class="tlfoot">
        <span class="muted">~${t.minutes} min${t.admin ? ' · admin' : ''}${t.reboot ? ' · reboot' : ''}</span>
        <button class="btn ghost" data-tool="${esc(t.id)}">Run</button>
      </div>
    </div>`).join('');

  $('toolList').querySelectorAll('[data-tool]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Running…';
      await api.registryTool(b.dataset.tool);
      b.disabled = false;
      b.textContent = 'Run';
    });
  });
}

function paintRegistry() {
  const allowRemovals = $('allowRemovals').checked;
  $('regList').innerHTML = regFixes.map((f) => {
    const clean = f.status === 'clean';
    const on = regSelected.has(f.id);
    const blocked = f.action === 'remove' && !allowRemovals;
    const vals = f.values.map((v) => {
      const shown = (v.current === null || v.current === undefined || v.current === '') ? null : v.current;
      const suffix = v.state === 'wrong' && shown !== null ? ` — currently ${shown}`
        : v.state === 'missing' ? ' — not set'
        : v.state === 'present' ? ' — present' : '';
      return `${v.path}\\${v.name}${suffix}`;
    }).join('  ·  ');
    return `<div class="rf${on ? ' on' : ''}${clean ? ' clean' : ''}" data-fix="${esc(f.id)}">
      <span class="tick"></span>
      <div class="rfmain">
        <div class="rfname">${esc(f.name)}
          <span class="pill-state cat">${esc(f.category)}</span>
          <span class="pill-state ${clean ? 'clean' : 'actionable'}">${clean ? 'nothing to do' : (f.action === 'remove' ? 'value present' : 'needs fixing')}</span>
          ${f.flaggedByMicrosoft ? '<span class="pill-state flagged">removal · Microsoft-flagged</span>' : ''}
          ${f.reboot ? '<span class="tag reboot">reboot</span>' : ''}
        </div>
        <div class="rfdesc">${esc(f.desc)}${blocked && !clean ? ' <b>Tick the removals box above to allow this one.</b>' : ''}</div>
        <div class="rfval">${esc(vals)}</div>
        <a class="rfref" data-ref="${esc(f.msRef)}">Microsoft documentation →</a>
      </div>
    </div>`;
  }).join('');

  $('regList').querySelectorAll('.rf:not(.clean)').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (ev.target.dataset.ref) { api.openExternal(ev.target.dataset.ref); return; }
      const id = el.dataset.fix;
      if (regSelected.has(id)) regSelected.delete(id); else regSelected.add(id);
      el.classList.toggle('on');
      updateRegButton();
    });
  });
  $('regList').querySelectorAll('.rf.clean [data-ref]').forEach((a) => {
    a.addEventListener('click', () => api.openExternal(a.dataset.ref));
  });
  updateRegButton();
}

function updateRegButton() {
  const allowRemovals = $('allowRemovals').checked;
  const n = [...regSelected].filter((id) => {
    const f = regFixes.find((x) => x.id === id);
    return f && f.status === 'actionable' && (f.action !== 'remove' || allowRemovals);
  }).length;
  $('regApplyBtn').disabled = n === 0;
  $('regApplyBtn').textContent = n ? `Apply ${n} fix${n === 1 ? '' : 'es'}` : 'Apply selected';
}

/* ======================================================================== *
 *  UPDATES + SYNC
 * ======================================================================== */

const SCOPE_LABELS = {
  packages: 'winget / Chocolatey / Homebrew',
  npmGlobals: 'npm global packages',
  pythonTools: 'pipx and uv tools',
  vscodeExtensions: 'VS Code extensions',
  gitRepos: 'cloned git repositories',
  ollamaModels: 'Ollama models',
  links: 'official link registry',
};

function paintScope() {
  $('scopeGrid').innerHTML = Object.entries(SCOPE_LABELS).map(([k, label]) => `
    <label class="check">
      <input type="checkbox" data-scope="${k}" ${SETTINGS.syncScope[k] ? 'checked' : ''} />
      <span>${esc(label)}</span>
    </label>`).join('');
  $('scopeGrid').querySelectorAll('[data-scope]').forEach((el) => {
    el.addEventListener('change', async () => {
      SETTINGS = await api.setSettings({ syncScope: { [el.dataset.scope]: el.checked } });
    });
  });
}

function paintSyncStatus(s) {
  if (!s) return;
  $('syncNext').textContent = s.enabled
    ? `next run ${clock(s.nextRunAt)}${s.lastSyncAt ? ` · last ${clock(s.lastSyncAt)}` : ''}`
    : 'scheduled sync is off';
}

let updateInfo = null;
let downloadedFile = null;

function paintUpdate(info) {
  updateInfo = info;
  const state = $('updateState');
  $('updateDot').hidden = !(info && info.available);

  if (!info) { state.textContent = 'Not checked yet.'; return; }
  if (!info.ok) {
    state.textContent = `Could not reach GitHub: ${info.error}. ProGramerly ${info.current} keeps running as it is.`;
    return;
  }
  if (!info.available) {
    state.textContent = `ProGramerly ${info.current} is the newest build on the ${SETTINGS.updateChannel} channel.`;
    $('getUpdateBtn').hidden = true;
    $('installUpdateBtn').hidden = true;
    $('updateNotes').hidden = true;
    return;
  }
  state.textContent = `Version ${info.latest} was published ${clock(Date.parse(info.publishedAt))}. `
    + `You are on ${info.current}.${info.asset ? '' : ' No installer was published for this platform — open the release page to grab it.'}`;
  $('getUpdateBtn').hidden = !info.asset || Boolean(downloadedFile);
  $('installUpdateBtn').hidden = !downloadedFile;
  if (info.notes) {
    $('updateNotes').textContent = info.notes;
    $('updateNotes').hidden = false;
  }
}

/* ======================================================================== *
 *  publish (push & release — maintainer/developer feature)
 * ======================================================================== */

function pillState(ok, textOk, textBad) {
  return `<span class="pill-state ${ok ? 'clean' : 'flagged'}">${esc(ok ? textOk : textBad)}</span>`;
}

function paintPublishStatus(st) {
  const packaged = Boolean(st.packaged);
  $('publishRunBtn').hidden = packaged;
  $('publishRefreshBtn').hidden = packaged;
  $('publishSaveTokenBtn').hidden = packaged;
  $('publishClearTokenBtn').hidden = packaged;
  if (packaged) $('publishInstallGhBtn').hidden = true;
  $('publishOwner').disabled = packaged;
  $('publishRepo').disabled = packaged;
  $('publishToken').disabled = packaged;

  if (packaged) {
    $('publishNote').textContent = 'Developer feature — it needs the git source checkout, which a '
      + 'packaged install does not have. Run ProGramerly from source (npm start) to use it.';
    $('publishStatusKv').innerHTML = '';
    return;
  }

  $('publishStatusKv').innerHTML = [
    ['git', pillState(st.git, 'found', 'not found — install Git first')],
    ['gh CLI', st.gh ? pillState(st.ghAuthed, 'signed in', 'installed, not signed in') : pillState(false, '', 'not installed (optional)')],
    ['Stored token', pillState(st.tokenSet, 'saved', 'none (optional)')],
    ['Local repo', pillState(st.gitRepo, 'initialised', 'not yet — git init will run')],
    ['origin', st.remoteUrl ? `<code>${esc(st.remoteUrl)}</code>` : pillState(false, '', 'not set — will be added')],
    ['GitHub repo', pillState(st.repoExists, 'exists', "doesn't exist yet — will be created")],
    ['CI workflow', pillState(st.workflowPresent, 'present', 'will be written on next run')],
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');

  $('publishRunBtn').disabled = !st.git;
  $('publishRunBtn').textContent = `Push & Release v${st.appVersion}`;
  $('publishInstallGhBtn').hidden = Boolean(st.gh);
}

async function loadPublishStatus() {
  const st = await api.publishStatus();
  $('publishOwner').value = SETTINGS.publish?.repoOwner || 'Ionity-Global-Pty-Ltd';
  $('publishRepo').value = SETTINGS.publish?.repoName || 'ProGramerly';
  paintPublishStatus(st);
  return st;
}

/* ======================================================================== *
 *  AI WORKSPACE
 * ======================================================================== */

let aiLoaded = false;
let aiPulling = false;

function paintEndpoints(rows) {
  const up = rows.filter((r) => r.up);
  const down = rows.filter((r) => !r.up);
  const cell = (r) => `<div class="ep ${r.up ? 'up' : ''}">
      <span class="lamp"></span>
      <div><b>${esc(r.name)}</b><small>${esc(r.detail)}</small></div>
      <span class="port">:${r.port}</span>
    </div>`;
  $('aiEndpoints').innerHTML = up.length
    ? [...up, ...down].map(cell).join('')
    : `<p class="empty">Nothing is listening. Install Ollama from the Software tab, or start the service you use.</p>${down.map(cell).join('')}`;
}

function paintModels(res, loaded) {
  const strip = $('aiLoaded');
  if (loaded && loaded.length) {
    strip.innerHTML = '<b>In VRAM right now:</b>' + loaded.map((m) =>
      `<span>${esc(m.name)} · ${esc(m.vramHuman)} ${m.onGpu ? 'GPU' : 'CPU'}</span>`).join('');
    strip.hidden = false;
  } else strip.hidden = true;

  const list = $('aiModelList');
  if (!res.up) {
    list.innerHTML = '<p class="empty">Ollama is not running on 11434. Start it, or install it from the Software tab.</p>';
    return;
  }
  if (!res.models.length) {
    list.innerHTML = '<p class="empty">Ollama is running but holds no models yet. Pull one below.</p>';
    return;
  }
  list.innerHTML = res.models.map((m) => `<div class="modelrow">
      <div><b>${esc(m.name)}</b><small>${esc([m.parameters, m.quant, m.family].filter(Boolean).join(' · '))}</small></div>
      <span class="sz">${esc(m.sizeHuman)}</span>
      <button class="btn ghost" data-rm="${esc(m.name)}">Remove</button>
    </div>`).join('');
  list.querySelectorAll('[data-rm]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Removing…';
      await api.aiDelete(b.dataset.rm);
      loadModels();
    });
  });
}

async function loadModels() {
  const [res, loaded] = await Promise.all([api.aiModels(), api.aiLoaded()]);
  paintModels(res, loaded);
}

function paintEnvironments(env) {
  const list = $('aiEnvList');
  if (!env.venvs.length) {
    list.innerHTML = `<p class="empty">No virtual environments found under ${esc(env.roots.join(', '))}.</p>`;
  } else {
    list.innerHTML = env.venvs.map((v) => `<div class="envrow ${v.active ? 'active' : ''}">
        <span class="kindtag">${esc(v.kind)}</span>
        <div><b>${esc(v.name)}</b>${v.parent ? ` <span class="dim">in ${esc(v.parent)}</span>` : ''}
          <small>${esc(v.dir)}</small></div>
        <span class="state ${v.active ? 'on' : ''}">${v.active ? 'ACTIVE' : esc(v.version || (v.healthy ? '' : 'broken'))}</span>
      </div>`).join('');
  }
  const nodeBox = $('aiNodeList');
  if (env.node && env.node.length) {
    nodeBox.innerHTML = '<b>Node versions:</b> ' + env.node
      .map((n) => `${esc(n.version)}${n.current ? ' (current)' : ''} <span style="color:var(--text-faint)">${esc(n.manager)}</span>`)
      .join(' · ');
    nodeBox.hidden = false;
  } else nodeBox.hidden = true;
}

async function loadAi() {
  aiLoaded = true;
  $('aiEndpoints').innerHTML = '<p class="empty">Scanning…</p>';
  const curated = await api.aiCurated();
  const sel = $('aiCurated');
  sel.innerHTML = '<option value="">Pick a curated model…</option>'
    + curated.map((c) => `<option value="${esc(c.name)}" data-note="${esc(c.note)}">${esc(c.name)} — ${esc(c.size)}</option>`).join('');
  sel.addEventListener('change', () => {
    const opt = sel.selectedOptions[0];
    $('aiModelName').value = sel.value;
    $('aiCuratedNote').textContent = opt ? (opt.dataset.note || '') : '';
  });
  paintEndpoints(await api.aiEndpoints());
  await loadModels();
  await Promise.all([loadTargets(), loadGpu()]);
  paintEnvironments(await api.aiEnvironments());
}

$('aiRefreshBtn').addEventListener('click', async () => {
  $('aiEndpoints').innerHTML = '<p class="empty">Scanning…</p>';
  paintEndpoints(await api.aiEndpoints());
});
$('aiModelsBtn').addEventListener('click', loadModels);
$('aiEnvBtn').addEventListener('click', async () => {
  $('aiEnvList').innerHTML = '<p class="empty">Walking the development folders…</p>';
  paintEnvironments(await api.aiEnvironments());
});
$('aiClearBtn').addEventListener('click', () => { $('aiConsole').innerHTML = ''; });

$('aiPullBtn').addEventListener('click', async () => {
  const model = $('aiModelName').value.trim() || $('aiCurated').value;
  if (!model || aiPulling) return;
  aiPulling = true;
  const btn = $('aiPullBtn');
  btn.disabled = true; btn.textContent = 'Pulling…';
  $('aiPullBar').hidden = false;
  $('aiPullFill').style.width = '0%';
  $('aiPullText').textContent = `starting ${model}…`;
  const res = await api.aiPull(model);
  btn.disabled = false; btn.textContent = 'Pull';
  aiPulling = false;
  $('aiPullText').textContent = res.ok ? `${model} is on this machine.` : `failed: ${res.error || res.code}`;
  if (res.ok) { $('aiPullFill').style.width = '100%'; loadModels(); }
});

api.onAiLog((p) => pushInto($('aiConsole'), p));

/* ------------------------------------------------------------ LLM console */

let aiTargets = [];
let chatBusy = false;
let liveBubble = null;
let liveId = 0;
const transcript = [];   // {role, content} - kept per session, sent back as context

function currentTarget() {
  const i = Number($('aiTarget').value);
  return Number.isInteger(i) && aiTargets[i] ? aiTargets[i] : null;
}

function paintTargets(list) {
  aiTargets = list;
  const sel = $('aiTarget');
  sel.innerHTML = list.length
    ? list.map((t, i) => `<option value="${i}">${esc(t.model)} — ${esc(t.endpoint)}</option>`).join('')
    : '<option value="">No live model found — start Ollama or LM Studio</option>';
  const on = list.length > 0;
  ['aiSendBtn', 'aiExplainBtn', 'aiBenchBtn'].forEach((id) => { $(id).disabled = !on; });
}

async function loadTargets() { paintTargets(await api.aiTargets()); }

async function loadGpu() {
  const g = await api.aiGpu();
  const box = $('aiGpu');
  if (!g.available) { box.hidden = true; return; }
  box.innerHTML = g.gpus.map((x) =>
    `<div><b>${esc(x.name)}</b> · <span class="vram">${(x.vramFreeMb / 1024).toFixed(1)} GB free of ${(x.vramTotalMb / 1024).toFixed(0)} GB</span>`
    + ` · ${x.utilPct}% · ${x.tempC}°C<br><span class="fits">${esc(x.fits)}</span></div>`).join('');
  box.hidden = false;
}

function bubble(role, text, who) {
  const log = $('aiChatLog');
  const empty = log.querySelector('.empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `<span class="who">${esc(who)}</span><span class="body"></span>`;
  el.querySelector('.body').textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function beginModelBubble(id) {
  liveId = id;
  liveBubble = bubble('model', '', currentTarget() ? currentTarget().model : 'model');
  liveBubble.querySelector('.body').insertAdjacentHTML('afterend', '<span class="cursor"></span>');
}

api.onAiToken((p) => {
  if (!liveBubble || p.id !== liveId) return;
  const body = liveBubble.querySelector('.body');
  if (p.token) { body.textContent += p.token; $('aiChatLog').scrollTop = $('aiChatLog').scrollHeight; }
  if (p.error) { body.textContent += (body.textContent ? '\n' : '') + p.error; liveBubble.classList.add('err'); }
  if (p.done) {
    const c = liveBubble.querySelector('.cursor'); if (c) c.remove();
    if (p.ok && body.textContent) transcript.push({ role: 'assistant', content: body.textContent });
    if (p.stats) {
      const st = p.stats;
      $('aiStats').textContent = `${st.tokens ?? '?'} tokens`
        + (st.tokensPerSec != null ? ` · ${st.tokensPerSec} tok/s` : '')
        + (st.promptTokens ? ` · ${st.promptTokens} prompt tokens` : '')
        + (st.loadMs ? ` · model load ${st.loadMs} ms` : '')
        + (st.measured === false ? ' · estimate (server sent no usage)' : ' · server-measured');
    }
    liveBubble = null;
    chatBusy = false;
    $('aiSendBtn').disabled = false; $('aiExplainBtn').disabled = false; $('aiBenchBtn').disabled = false;
  }
});

async function send(explain) {
  const t = currentTarget();
  const text = $('aiPrompt').value.trim();
  if (!t || !text || chatBusy) return;
  chatBusy = true;
  $('aiSendBtn').disabled = true; $('aiExplainBtn').disabled = true; $('aiBenchBtn').disabled = true;
  $('aiPrompt').value = '';
  bubble('user', text, explain ? 'explain this' : 'you');
  // The id comes back from the handler, but tokens can start arriving first -
  // so the bubble is created against the next sequence number, which the main
  // process assigns monotonically. Simpler than a handshake, and correct.
  beginModelBubble(liveId + 1);
  let res;
  if (explain) {
    res = await api.aiExplain({ target: t, text, context: `${INFO.osLabel}` });
  } else {
    transcript.push({ role: 'user', content: text });
    res = await api.aiChat({ endpointId: t.endpointId, port: t.port, model: t.model, messages: transcript.slice(-12) });
  }
  if (res && res.id && res.id !== liveId && liveBubble) {
    // Sequence drifted (another chat ran in between) - re-key the live bubble so
    // any remaining tokens for this reply still land in it.
    liveId = res.id;
  }
  if (res && !res.ok && liveBubble) {
    liveBubble.querySelector('.body').textContent = res.error || 'no reply';
    liveBubble.classList.add('err');
    const c = liveBubble.querySelector('.cursor'); if (c) c.remove();
    liveBubble = null; chatBusy = false;
    $('aiSendBtn').disabled = false; $('aiExplainBtn').disabled = false; $('aiBenchBtn').disabled = false;
  }
}

$('aiSendBtn').addEventListener('click', () => send(false));
$('aiExplainBtn').addEventListener('click', () => send(true));
$('aiPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(false); } });
$('aiChatClearBtn').addEventListener('click', () => {
  transcript.length = 0;
  $('aiChatLog').innerHTML = '<p class="empty">Cleared. The model has no memory of the previous turns now.</p>';
  $('aiStats').textContent = '';
});
$('aiTargetsBtn').addEventListener('click', async () => { await loadTargets(); await loadGpu(); });
$('aiBenchBtn').addEventListener('click', async () => {
  const t = currentTarget();
  if (!t || chatBusy) return;
  const b = $('aiBenchBtn');
  b.disabled = true; b.textContent = 'Timing…';
  const r = await api.aiBenchmark(t);
  b.textContent = r.ok ? `${r.tokensPerSec ?? '?'} tok/s` : 'failed';
  $('aiStats').textContent = r.ok
    ? `Benchmark: ${r.tokens} tokens in ${(r.elapsedMs / 1000).toFixed(1)} s → ${r.tokensPerSec ?? '?'} tok/s`
      + (r.measured ? ' (server-measured)' : ' (chunk-counted estimate)') + (r.loadMs ? ` · load ${r.loadMs} ms` : '')
    : `Benchmark failed: ${r.error}`;
  setTimeout(() => { b.textContent = 'Benchmark'; b.disabled = false; }, 5000);
});

/* ======================================================================== *
 *  PROJECTS
 * ======================================================================== */

let projLoaded = false;

function ago(ms) {
  if (!ms) return 'no commits';
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 45) return `${d} d ago`;
  return `${Math.round(d / 30)} mo ago`;
}

function paintProjects(res) {
  const sum = $('projSummary');
  const list = $('projList');
  if (res.gitMissing) {
    list.innerHTML = '<p class="empty">git is not installed — install it from the Software tab, then rescan.</p>';
    sum.hidden = true; return;
  }
  if (!res.repos.length) {
    list.innerHTML = `<p class="empty">No git repositories under ${esc(res.root)} (two levels deep).</p>`;
    sum.hidden = true; return;
  }
  sum.innerHTML = `<span class="docpill ok"><b>${res.count}</b> repositories</span>`
    + (res.dirty ? `<span class="docpill warn"><b>${res.dirty}</b> with uncommitted work</span>` : '')
    + `<span class="docpill"><b>${esc(res.root)}</b></span>`;
  sum.hidden = false;

  list.innerHTML = res.repos.map((r) => {
    const meta = [];
    if (!r.ok) meta.push('<span class="warn">git could not read this repository</span>');
    if (r.changes) meta.push(`<span class="warn">${r.changes} modified</span>`);
    if (r.untracked) meta.push(`<span class="warn">${r.untracked} untracked</span>`);
    if (!r.dirty && r.ok) meta.push('<span class="ok">clean</span>');
    if (r.ahead) meta.push(`<span class="warn">↑${r.ahead} to push</span>`);
    if (r.behind) meta.push(`<span class="warn">↓${r.behind} to pull</span>`);
    if (r.lastHash) meta.push(`<span>${esc(r.lastHash)} · ${esc(ago(r.lastAt))} · ${esc(r.lastMsg.slice(0, 60))}</span>`);
    if (!r.remote) meta.push('<span>no remote</span>');
    return `<div class="proj ${r.dirty ? 'dirty' : ''}">
      <div>
        <b>${esc(r.name)}</b><span class="branch">${esc(r.branch || '?')}</span>
        ${r.stack.length ? `<span class="stack">${r.stack.map((x) => `<span>${esc(x)}</span>`).join('')}</span>` : ''}
        <div class="meta">${meta.join('')}</div>
        <small class="path">${esc(r.dir)}</small>
      </div>
      <div class="acts">
        <button class="btn ghost" data-open="${esc(r.dir)}" title="Open the folder">Folder</button>
        <button class="btn ghost" data-code="${esc(r.dir)}" title="Open in VS Code">Code</button>
        <button class="btn ghost" data-fetch="${esc(r.dir)}" title="git fetch --all --prune">Fetch</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => api.openPath(b.dataset.open)));
  list.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api.projOpenEditor(b.dataset.code);
    if (!r.ok) { b.textContent = 'no `code`'; setTimeout(() => { b.textContent = 'Code'; }, 2500); }
  }));
  list.querySelectorAll('[data-fetch]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Fetching…';
    await api.projFetch(b.dataset.fetch);
    loadProjects();
  }));
}

async function loadProjects() {
  projLoaded = true;
  $('projList').innerHTML = '<p class="empty">Reading repositories…</p>';
  paintProjects(await api.projScan());
}

$('projScanBtn').addEventListener('click', loadProjects);
$('projFolderBtn').addEventListener('click', () => api.openDevRoot());
$('projClearBtn').addEventListener('click', () => { $('projConsole').innerHTML = ''; });
$('projFetchAllBtn').addEventListener('click', async () => {
  const b = $('projFetchAllBtn');
  b.disabled = true; b.textContent = 'Fetching…';
  await api.projFetchAll();
  b.textContent = 'Fetch all'; b.disabled = false;
  loadProjects();
});
api.onProjLog((p) => pushInto($('projConsole'), p));

/* ======================================================================== *
 *  TERMINALS
 * ======================================================================== */

let termLoaded = false;

async function loadTerminals() {
  termLoaded = true;
  const rows = await api.termList();
  $('termList').innerHTML = rows.map((t) => `<div class="term ${t.available ? '' : 'missing'}">
      <b>${esc(t.name)}</b>
      <small>${esc(t.note || '')}</small>
      ${t.available
        ? `<button class="btn ghost" data-term="${esc(t.id)}">Open</button><code>${esc(t.path)}</code>`
        : '<span class="none">not installed</span>'}
    </div>`).join('');
  $('termList').querySelectorAll('[data-term]').forEach((b) => {
    b.addEventListener('click', async () => {
      const original = b.textContent;
      b.disabled = true; b.textContent = 'Opening…';
      const res = await api.termOpen(b.dataset.term);
      b.textContent = res.ok ? 'Opened' : (res.error || 'failed');
      setTimeout(() => { b.textContent = original; b.disabled = false; }, 2200);
    });
  });

  const distros = await api.termWsl();
  const box = $('termWsl');
  if (distros && distros.length) {
    box.innerHTML = '<b>WSL distributions:</b> '
      + distros.map((d) => `<a href="#" data-wsl="${esc(d)}">${esc(d)}</a>`).join(' · ');
    box.hidden = false;
    box.querySelectorAll('[data-wsl]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); api.termOpen('wsl', a.dataset.wsl); });
    });
  } else box.hidden = true;
}

$('termRefreshBtn').addEventListener('click', loadTerminals);
$('termFolderBtn').addEventListener('click', () => api.openDevRoot());

/* ======================================================================== *
 *  HARDWARE - sensors, fans, RGB, memory
 * ======================================================================== */

let hwLoaded = false;
let hwTimer = null;
let rgbDevices = [];

const SWATCHES = ['#00c6ff', '#33d69f', '#7c4dff', '#ff4d6d', '#ffb340', '#ffffff', '#ff00d0', '#000000'];

function paintSensors(res) {
  const box = $('hwSensors');
  if (!res.available) {
    box.innerHTML = `<p class="empty">${esc(res.reason)}</p>`;
    return;
  }
  box.innerHTML = res.groups.map((g) => `<div class="sensorgroup">
      <h5>${esc(g.label)}</h5>
      <div class="sensorgrid">${g.sensors.filter((s) => s.value !== null).map((s) => {
    const hot = s.type === 'Temperature' && s.value >= 80;
    const fan = s.type === 'Fan' || s.type === 'Control';
    return `<div class="sens ${hot ? 'hot' : ''} ${fan ? 'fan' : ''}" title="${esc(s.name)}">
            <span>${esc(s.name)}</span><b>${s.value}<small> ${esc(s.unit)}</small></b>
          </div>`;
  }).join('')}</div>
    </div>`).join('') + `<p class="cardnote">${res.count} sensors via ${esc(res.source)}.</p>`;
}

async function readSensors() { paintSensors(await api.hwSensors()); }

function paintTools(res) {
  $('hwTools').innerHTML = (res.tools || []).map((t) => `<div class="tbx">
      <h4>${esc(t.name)}${t.running ? ' <span class="run">running</span>' : ''}</h4>
      <p>${esc(t.what)}</p>
      ${t.installed
        ? `<button class="btn ghost" data-launch="${esc(t.id)}">Launch</button>`
        : `<button class="btn ghost" data-install="${esc(t.id)}">Install</button>`}
    </div>`).join('') || '<p class="empty">Fan tooling integration is Windows-only.</p>';

  $('hwTools').querySelectorAll('[data-launch]').forEach((b) => {
    b.addEventListener('click', async () => { await api.hwLaunchTool(b.dataset.launch); setTimeout(loadTools, 1500); });
  });
  $('hwTools').querySelectorAll('[data-install]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Installing…';
      await api.hwInstallTool(b.dataset.install);
      loadTools();
    });
  });
}

async function loadTools() { paintTools(await api.hwTools()); }

function paintRgb(st) {
  const box = $('rgbDevices');
  $('rgbApplyAllBtn').disabled = !st.connected;
  if (!st.connected) {
    box.innerHTML = `<p class="empty">${esc(st.error || 'not connected')}</p>`;
    return;
  }
  rgbDevices = st.devices;
  if (!st.devices.length) {
    box.innerHTML = '<p class="empty">OpenRGB answered but reports no devices. It may need to be run as administrator to see your hardware.</p>';
    return;
  }
  box.innerHTML = st.devices.map((d) => `<div class="rgbdev">
      <div><b>${esc(d.name)}</b>
        <small>${esc(d.type)}${d.vendor ? ` · ${esc(d.vendor)}` : ''} · ${d.ledCount} LEDs · ${d.zones.length} zone(s)${d.zones.length ? ': ' + esc(d.zones.map((z) => `${z.name} (${z.leds})`).join(', ')) : ''}</small></div>
      <select data-mode="${d.index}">
        ${d.modes.map((m) => `<option value="${m.index}" ${m.active ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select>
      <button class="btn ghost" data-dev="${d.index}">Set colour</button>
    </div>`).join('')
    + `<p class="cardnote">OpenRGB protocol ${st.protocol} on ${esc(st.host)}:${st.port}.</p>`;

  box.querySelectorAll('[data-dev]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      await api.rgbSetColor($('rgbColor').value, Number(b.dataset.dev));
      b.disabled = false;
    });
  });
  box.querySelectorAll('[data-mode]').forEach((sel) => {
    sel.addEventListener('change', () => api.rgbApplyMode(Number(sel.dataset.mode), Number(sel.value)));
  });
}

async function loadRgb() {
  $('rgbDevices').innerHTML = '<p class="empty">Talking to OpenRGB…</p>';
  paintRgb(await api.rgbStatus());
}

async function loadMemory() {
  const m = await api.hwMemory();
  $('hwMemFill').style.width = `${m.usedPct}%`;
  $('hwMemFill').classList.toggle('high', m.usedPct >= 85);
  $('hwMemText').textContent = `${m.freeHuman} free of ${m.totalHuman} — ${m.usedPct}% in use.`;
}

async function loadHardware() {
  hwLoaded = true;
  // Painted through the CSSOM rather than a style="" attribute in the markup:
  // the attribute did not survive into the rendered swatches, and setting the
  // property on the element afterwards does. Verified on screen, not assumed.
  $('rgbSwatches').innerHTML = SWATCHES.map((c) =>
    `<span class="sw" data-sw="${c}" title="${c}"></span>`).join('');
  $('rgbSwatches').querySelectorAll('[data-sw]').forEach((sw) => {
    sw.style.background = sw.dataset.sw;
    sw.addEventListener('click', () => { $('rgbColor').value = sw.dataset.sw; });
  });
  await Promise.all([readSensors(), loadTools(), loadMemory()]);
}

$('hwSensorsBtn').addEventListener('click', readSensors);
$('hwMemBtn').addEventListener('click', loadMemory);
$('hwClearBtn').addEventListener('click', () => { $('hwConsole').innerHTML = ''; });
$('rgbRefreshBtn').addEventListener('click', loadRgb);
$('rgbApplyAllBtn').addEventListener('click', async () => {
  const b = $('rgbApplyAllBtn');
  b.disabled = true; b.textContent = 'Applying…';
  await api.rgbSetColor($('rgbColor').value, null);
  b.textContent = 'Apply to everything'; b.disabled = false;
});

$('hwAuto').addEventListener('change', (e) => {
  if (hwTimer) { clearInterval(hwTimer); hwTimer = null; }
  if (e.target.checked) { readSensors(); hwTimer = setInterval(readSensors, 3000); }
});

async function hwAction(btnId, call, label) {
  const b = $(btnId);
  const original = b.textContent;
  b.disabled = true; b.textContent = `${label}…`;
  const res = await call();
  b.textContent = res && res.ok
    ? (res.deltaHuman ? `freed ${res.deltaHuman}` : (res.bytesHuman ? `cleared ${res.bytesHuman}` : 'done'))
    : (res && res.detail ? res.detail : 'not done');
  await loadMemory();
  setTimeout(() => { b.textContent = original; b.disabled = false; }, 4500);
}

$('hwFlushBtn').addEventListener('click', () => hwAction('hwFlushBtn', () => api.hwRamFlush(), 'Trimming'));
$('hwStandbyBtn').addEventListener('click', () => hwAction('hwStandbyBtn', () => api.hwPurgeStandby(), 'Purging'));
$('hwTempBtn').addEventListener('click', () => hwAction('hwTempBtn', () => api.hwClearTemp(), 'Clearing'));

api.onHwLog((p) => pushInto($('hwConsole'), p));

/* ======================================================================== *
 *  PROFILE
 * ======================================================================== */

async function loadProfile() {
  const p = await api.profileGet();
  const pr = p.profile || {};
  $('profName').value = pr.name || p.identity.author || '';
  $('profEmail').value = pr.email || '';
  $('profRole').value = pr.role || '';
  $('profOrg').value = pr.org || p.identity.organisation || '';
  $('profDefaultProfile').value = pr.defaultProfile || 'full';
  $('profileKv').innerHTML = [
    ['Machine', `${p.machine.os.hostname} · ${p.machine.os.user}`],
    ['System', `${p.machine.os.type} ${p.machine.os.release} (${p.machine.os.arch})`],
    ['Processor', `${p.machine.hardware.cpu} · ${p.machine.hardware.cores} cores`],
    ['Memory', p.machine.hardware.ramTotal],
    ['Graphics', p.machine.hardware.gpu],
    ['Storage', `${p.machine.hardware.driveFree} free of ${p.machine.hardware.driveTotal}`],
    ['Privileges', p.elevated ? 'Administrator' : 'Standard user'],
    ['Dev folder', p.devRoot],
    ['Installed by ProGramerly', `${p.installedCount} item(s)`],
    ['ProGramerly', `v${p.appVersion}`],
    ['Governance', p.identity.governance || 'Policy 986 AED'],
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

$('profileSaveBtn').addEventListener('click', async () => {
  const b = $('profileSaveBtn');
  b.disabled = true; b.textContent = 'Saved';
  await api.profileSave({
    name: $('profName').value.trim(),
    email: $('profEmail').value.trim(),
    role: $('profRole').value.trim(),
    org: $('profOrg').value.trim(),
    defaultProfile: $('profDefaultProfile').value,
  });
  setTimeout(() => { b.textContent = 'Save'; b.disabled = false; }, 1800);
});

/* ======================================================================== *
 *  DOCTOR
 * ======================================================================== */

let doctorLoaded = false;
let doctorBusy = false;
let lastClean = [];

const LAMP_WORD = { ok: 'Healthy', warn: 'Worth a look', fail: 'Broken', info: 'Note', skip: 'Not applicable' };

function doctorBusyState(on, label) {
  doctorBusy = on;
  ['docScanBtn', 'docFixAllBtn', 'docReportBtn', 'docEnvBtn', 'docCleanScanBtn', 'docPortBtn', 'docPortScanBtn']
    .forEach((id) => { const b = $(id); if (b) b.disabled = on; });
  const scan = $('docScanBtn');
  if (scan) scan.textContent = on ? (label || 'Working…') : 'Run diagnostics';
}

function paintDoctorSummary(sum) {
  const box = $('docSummary');
  const order = [['fail', 'failing'], ['warn', 'warnings'], ['ok', 'healthy'], ['skip', 'skipped']];
  box.innerHTML = order
    .filter(([k]) => sum[k])
    .map(([k, word]) => `<span class="docpill ${k}"><b>${sum[k]}</b> ${word}</span>`)
    .join('');
  box.hidden = !box.innerHTML;
}

function paintDoctor(scan) {
  paintDoctorSummary(scan.summary);
  const list = $('docList');
  if (!scan.results.length) {
    list.innerHTML = '<p class="empty">No checks apply on this platform.</p>';
    return;
  }
  const weight = { fail: 0, warn: 1, info: 2, ok: 3, skip: 4 };
  const rows = [...scan.results].sort((a, b) => (weight[a.status] ?? 9) - (weight[b.status] ?? 9));
  list.innerHTML = rows.map((r) => {
    const btn = r.fixable
      ? `<button class="btn ghost" data-fix="${esc(r.id)}">${esc(r.fixLabel)}</button>`
      : '';
    const admin = r.needsAdmin ? '<span class="adminflag">admin</span>' : '';
    const why = (r.status === 'warn' || r.status === 'fail') ? `<em>${esc(r.why)}</em>` : '';
    return `<div class="dcheck ${esc(r.status)}">
      <span class="lamp" title="${esc(LAMP_WORD[r.status] || r.status)}"></span>
      <div><h5>${esc(r.title)}${admin}</h5><p>${esc(r.detail)}</p>${why}</div>
      <div>${btn}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-fix]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (doctorBusy) return;
      b.disabled = true;
      const original = b.textContent;
      b.textContent = 'Fixing…';
      const res = await api.doctorFix(b.dataset.fix);
      b.textContent = res && res.ok ? 'Fixed — rechecking…' : 'Did not fix';
      // A fix that worked should be reflected by the check itself, not by a
      // green button. Rescan so the row tells the truth.
      setTimeout(() => runDoctorScan(), res && res.ok ? 400 : 2500);
      if (!res || !res.ok) setTimeout(() => { b.textContent = original; b.disabled = false; }, 2500);
    });
  });
}

async function runDoctorScan() {
  if (doctorBusy) return;
  doctorLoaded = true;
  doctorBusyState(true, 'Checking…');
  try {
    paintDoctor(await api.doctorScan());
  } finally {
    doctorBusyState(false);
  }
}

$('docScanBtn').addEventListener('click', runDoctorScan);

$('docFixAllBtn').addEventListener('click', async () => {
  if (doctorBusy) return;
  doctorBusyState(true, 'Fixing…');
  try {
    await api.doctorFixAll();
    paintDoctor(await api.doctorScan());
  } finally {
    doctorBusyState(false);
  }
});

$('docReportBtn').addEventListener('click', async () => {
  if (doctorBusy) return;
  doctorBusyState(true, 'Reporting…');
  try {
    const res = await api.doctorReport();
    paintDoctor({ results: res.results, summary: res.summary });
    pushInto($('docConsole'), { text: `report folder: ${res.dir}`, level: 'ok' });
  } finally {
    doctorBusyState(false);
  }
});

$('docOpenFolderBtn').addEventListener('click', () => api.doctorOpenFolder());
$('docClearBtn').addEventListener('click', () => { $('docConsole').innerHTML = ''; });

$('docEnvBtn').addEventListener('click', async () => {
  if (doctorBusy) return;
  doctorBusyState(true, 'Collecting…');
  try {
    const e = await api.doctorEnvironment();
    const found = e.tools.filter((t) => t.version);
    const out = $('docEnvOut');
    out.innerHTML = [
      `<b>${esc(e.os.type)} ${esc(e.os.release)}</b> ${esc(e.os.arch)}`,
      `${esc(e.hardware.cpu)} · ${e.hardware.cores} cores`,
      `${esc(e.hardware.ramTotal)} RAM, ${esc(e.hardware.ramFree)} free`,
      `${esc(e.hardware.gpu)}`,
      `${esc(e.hardware.drive)} ${esc(e.hardware.driveFree)} free of ${esc(e.hardware.driveTotal)}`,
      `<b>${found.length}</b> of ${e.tools.length} tools found: ${esc(found.map((t) => t.name).join(', '))}`,
    ].join('<br>');
    out.hidden = false;
  } finally {
    doctorBusyState(false);
  }
});

$('docCleanScanBtn').addEventListener('click', async () => {
  if (doctorBusy) return;
  doctorBusyState(true, 'Measuring…');
  try {
    lastClean = await api.doctorCleanScan();
    const list = $('docCleanList');
    list.innerHTML = lastClean.map((t) => `
      <label class="cleanrow">
        <input type="checkbox" data-clean="${esc(t.id)}" ${t.bytes > 50 * 1024 * 1024 ? 'checked' : ''} />
        <span>${esc(t.label)}${t.note ? `<small>${esc(t.note)}</small>` : ''}</span>
        <span class="size">${esc(t.size)}</span>
      </label>`).join('') || '<p class="empty">Nothing cacheable found on this machine.</p>';
    const run = $('docCleanRunBtn');
    run.hidden = !lastClean.length;
    run.disabled = !lastClean.length;
  } finally {
    doctorBusyState(false);
  }
});

$('docCleanRunBtn').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('[data-clean]:checked')].map((c) => c.dataset.clean);
  if (!ids.length) return;
  const btn = $('docCleanRunBtn');
  btn.disabled = true;
  btn.textContent = 'Reclaiming…';
  const res = await api.doctorCleanRun(ids);
  btn.textContent = `Reclaimed ${res.freedHuman}`;
  setTimeout(() => { btn.textContent = 'Reclaim selected'; btn.disabled = false; }, 4000);
  $('docCleanScanBtn').click();
});

async function showPort(res) {
  const out = $('docPortOut');
  if (res.error) out.innerHTML = esc(res.error);
  else if (!res.inUse) out.innerHTML = `Port <b>${res.port}</b> is free.`;
  else {
    out.innerHTML = `Port <b>${res.port}</b> is held by <b>${esc(res.name || 'something')}</b>`
      + (res.pid ? ` (pid ${res.pid})` : '')
      + (res.cmdline ? `<br>${esc(res.cmdline)}` : '');
  }
  out.hidden = false;
}

$('docPortBtn').addEventListener('click', async () => {
  const v = $('docPort').value.trim();
  if (!v) return;
  showPort(await api.doctorPort(Number(v)));
});
$('docPort').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('docPortBtn').click(); });

$('docPortScanBtn').addEventListener('click', async () => {
  if (doctorBusy) return;
  doctorBusyState(true, 'Scanning…');
  try {
    const rows = await api.doctorPortScan();
    const out = $('docPortOut');
    out.innerHTML = rows.length
      ? rows.map((r) => `<b>${r.port}</b> — ${esc(r.detail)}`).join('<br>')
      : 'None of the usual development ports are occupied.';
    out.hidden = false;
  } finally {
    doctorBusyState(false);
  }
});

api.onDoctorLog((p) => pushInto($('docConsole'), p));

/* ======================================================================== *
 *  SETTINGS
 * ======================================================================== */

const UI_SWITCHES = [
  ['showIntro', 'Play the IONITY intro on launch', 'The charging beam, the impact and the loader.'],
  ['introSound', 'Intro sound', 'The square-wave beeps from the original console loader.'],
  ['nodeBackdrop', 'Animated node backdrop', 'The gradient node field behind the app. Turn it off and it stops drawing entirely.'],
  ['autoElevate', 'Run as administrator automatically', 'One consent dialog when ProGramerly starts, then every installer runs silently under it - instead of a UAC prompt per package.'],
  ['minimizeToTray', 'Minimise to the tray', 'Hover the tray icon for CPU, temperature, drives and network.'],
  ['closeToTray', 'Closing the window keeps it running', 'The scheduled sync needs the app alive to run at 08:00 and 20:00.'],
  ['launchAtLogin', 'Start with Windows / macOS', 'Starts minimised, straight into the tray.'],
  ['startMinimised', 'Start minimised', 'Skips the window and the intro on launch.'],
  ['checkAppUpdates', 'Check GitHub for new ProGramerly builds', 'A check, never an automatic install.'],
  ['notifyAppUpdate', 'Notify me when a new build exists', ''],
  ['syncOnLaunch', 'Also sync shortly after launch', 'On top of the scheduled runs.'],
  ['registryAllowFlaggedRemovals', 'Allow Microsoft-flagged registry removals', 'Off by default. Nothing is ever deleted while this is off.'],
];

function paintSettingsSwitches() {
  $('uiSwitches').innerHTML = UI_SWITCHES.map(([key, label, note]) => `
    <label class="check">
      <input type="checkbox" data-set="${key}" ${SETTINGS[key] ? 'checked' : ''} />
      <span><b>${esc(label)}</b>${note ? `<em>${esc(note)}</em>` : ''}</span>
    </label>`).join('');
  $('uiSwitches').querySelectorAll('[data-set]').forEach((el) => {
    el.addEventListener('change', async () => {
      SETTINGS = await api.setSettings({ [el.dataset.set]: el.checked });
      if (el.dataset.set === 'nodeBackdrop' && window.nodeField) {
        window.nodeField.setEnabled(el.checked);
      }
      syncControlsFromSettings();
    });
  });
}

function syncControlsFromSettings() {
  $('keepInSync').checked = Boolean(SETTINGS.keepInSync);
  $('autoInstallUpdates').checked = Boolean(SETTINGS.autoInstallUpdates);
  $('allowRemovals').checked = Boolean(SETTINGS.registryAllowFlaggedRemovals);
  $('syncTimes').value = (SETTINGS.syncTimes || []).join(', ');
  $('metricsInterval').value = SETTINGS.metricsInterval;
  $('probeSeconds').value = SETTINGS.probeSeconds;
  $('updateChannel').value = SETTINGS.updateChannel;
  $('updateRepo').value = SETTINGS.updateRepo;
  document.querySelectorAll('[data-set]').forEach((el) => { el.checked = Boolean(SETTINGS[el.dataset.set]); });
}

function paintAbout() {
  $('aboutKv').innerHTML = [
    ['Version', `v${INFO.appVersion}`],
    ['Catalog', `v${CATALOG.meta.version} · ${CATALOG.items.length} items in ${CATALOG.groups.length} groups`],
    ['Document', CATALOG.meta.documentId],
    ['Governance', CATALOG.meta.governance],
    ['Author', CATALOG.meta.author],
    ['Organisation', CATALOG.meta.organisation],
    ['Update source', `GitHub Releases · ${SETTINGS.updateRepo}`],
    ['Settings file', 'userData/settings.json'],
    ['Web', 'https://www.ionity.co.za · https://www.ionity.today'],
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

/* ======================================================================== *
 *  boot
 * ======================================================================== */

async function boot() {
  INFO = await api.getCatalog();
  CATALOG = INFO.catalog;
  PLATFORM = INFO.platform;
  SETTINGS = INFO.settings;

  $('appVersion').textContent = `v${INFO.appVersion}`;
  $('osBadge').textContent = INFO.osLabel;

  const priv = $('privBadge');
  if (PLATFORM === 'win') {
    priv.textContent = INFO.elevated ? 'Administrator' : 'Standard user';
    priv.className = `badge ${INFO.elevated ? 'admin' : 'limited'}`;
    $('elevateBtn').hidden = INFO.elevated;
  } else {
    priv.textContent = 'Will prompt for admin';
    priv.className = 'badge admin';
  }

  renderProfiles();
  pickProfile('full');
  document.querySelector('.gnav')?.classList.add('active');

  paintScope();
  paintSettingsSwitches();
  syncControlsFromSettings();
  paintAbout();
  paintSyncStatus(INFO.sync);
  if (INFO.update) paintUpdate(INFO.update);

  if (PLATFORM !== 'win' && !INFO.fixtures) {
    $('regList').innerHTML = '<p class="cardnote">Registry repair is a Windows feature. The system tools below are Windows-only too.</p>';
    $('toolList').innerHTML = '';
    maintLoaded = true;
  }

  const st = await api.loginState();
  if (st && typeof st.openAtLogin === 'boolean' && st.openAtLogin !== SETTINGS.launchAtLogin) {
    SETTINGS = await api.setSettings({ launchAtLogin: st.openAtLogin });
    syncControlsFromSettings();
  }

  showTab('software');
  loadPublishStatus().catch(() => { /* developer feature — safe to skip on any platform quirk */ });
}

/* ======================================================================== *
 *  wires
 * ======================================================================== */

$('installBtn').addEventListener('click', async () => {
  const ids = [...selected];
  installing = true;
  tally = { ok: 0, partial: 0, failed: 0, skipped: 0 };
  paintTally();
  $('console').innerHTML = '';
  showTab('software');
  $('runCurrent').textContent = 'Resolving dependencies…';
  await api.start(ids);
});

$('cancelBtn').addEventListener('click', () => {
  $('cancelBtn').disabled = true;
  $('runCurrent').textContent = 'Stopping after the current step…';
  api.cancel();
});

$('elevateBtn').addEventListener('click', async () => {
  const btn = $('elevateBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Waiting for consent…';
  const res = await api.elevate();
  // On success this window is already going away, so only the failure path
  // ever repaints - a declined UAC must not leave a dead "waiting" button.
  if (!res || res.ok === false) {
    btn.textContent = res && res.error ? `Declined - ${res.error}` : 'Could not elevate';
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 4000);
  }
});
$('logBtn').addEventListener('click', () => api.openLog());
$('openRootBtn').addEventListener('click', () => api.openDevRoot());
$('summaryLog').addEventListener('click', () => api.openLog());
$('summaryRoot').addEventListener('click', () => api.openDevRoot());
$('summaryClose').addEventListener('click', () => {
  $('summarySheet').hidden = true;
  $('cancelBtn').disabled = false;
  installing = false;
  showTab('software');
  $('installBtn').disabled = selected.size === 0;
});

/* ---- network ----------------------------------------------------------- */
$('sweepBtn').addEventListener('click', async () => {
  if (sweepRunning) return;
  sweepRunning = true;
  regionState.clear();
  paintRegions();
  $('sweepBtn').disabled = true;
  $('sweepCancel').hidden = false;
  const res = await api.sweep();
  sweepRunning = false;
  $('sweepBtn').disabled = false;
  $('sweepCancel').hidden = true;
  if (res && res.sweep && res.sweep.geo && res.sweep.geo.ok) {
    $('geoLine').textContent = `${res.sweep.geo.ip} · ${res.sweep.geo.country} · edge ${res.sweep.geo.colo}`;
  }
});

$('sweepCancel').addEventListener('click', () => api.cancelSweep());

$('linksCheckBtn').addEventListener('click', async () => {
  $('linksCheckBtn').disabled = true;
  $('linksCheckBtn').textContent = 'Checking…';
  if (!linksLoaded) await loadLinks();
  paintLinkResults(await api.checkLinks());
  $('linksCheckBtn').disabled = false;
  $('linksCheckBtn').textContent = 'Check now';
});

$('speedBtn').addEventListener('click', async () => {
  $('speedBtn').disabled = true;
  $('speedPhase').textContent = 'measuring latency…';
  await api.speedTest();
  $('speedBtn').disabled = false;
});

/* ---- maintenance ------------------------------------------------------- */
$('regScanBtn').addEventListener('click', loadRegistry);
$('regEditorBtn').addEventListener('click', () => api.registryOpenEditor());
$('regBackupsBtn').addEventListener('click', () => api.registryOpenBackups());
$('allowRemovals').addEventListener('change', async () => {
  SETTINGS = await api.setSettings({ registryAllowFlaggedRemovals: $('allowRemovals').checked });
  paintRegistry();
});
$('regApplyBtn').addEventListener('click', async () => {
  $('regApplyBtn').disabled = true;
  $('regApplyBtn').textContent = 'Applying…';
  await api.registryApply([...regSelected]);
  await loadRegistry();
});

/* ---- updates + sync ---------------------------------------------------- */
$('keepInSync').addEventListener('change', async () => {
  SETTINGS = await api.setSettings({ keepInSync: $('keepInSync').checked });
  paintSyncStatus(await api.syncStatus());
});
$('autoInstallUpdates').addEventListener('change', async () => {
  SETTINGS = await api.setSettings({ autoInstallUpdates: $('autoInstallUpdates').checked });
});
$('syncNowBtn').addEventListener('click', async () => {
  $('syncNowBtn').disabled = true;
  $('syncConsole').innerHTML = '';
  await api.syncRun({});
  $('syncNowBtn').disabled = false;
});
$('syncReportBtn').addEventListener('click', async () => {
  $('syncReportBtn').disabled = true;
  $('syncConsole').innerHTML = '';
  const before = SETTINGS.autoInstallUpdates;
  await api.setSettings({ autoInstallUpdates: false });
  await api.syncRun({});
  SETTINGS = await api.setSettings({ autoInstallUpdates: before });
  syncControlsFromSettings();
  $('syncReportBtn').disabled = false;
});

/* ---- publish ------------------------------------------------------------ */
$('publishRefreshBtn').addEventListener('click', () => {
  $('publishRefreshBtn').disabled = true;
  loadPublishStatus().finally(() => { $('publishRefreshBtn').disabled = false; });
});

const savePublishRepo = async () => {
  const repoOwner = $('publishOwner').value.trim() || 'Ionity-Global-Pty-Ltd';
  const repoName = $('publishRepo').value.trim() || 'ProGramerly';
  const patch = { repoOwner, repoName, remoteUrl: `https://github.com/${repoOwner}/${repoName}.git` };
  SETTINGS = { ...SETTINGS, publish: await api.publishSetRepo(patch) };
  await loadPublishStatus();
};
$('publishOwner').addEventListener('change', savePublishRepo);
$('publishRepo').addEventListener('change', savePublishRepo);

$('publishInstallGhBtn').addEventListener('click', async () => {
  $('publishInstallGhBtn').disabled = true;
  $('publishConsole').innerHTML = '';
  $('publishResult').hidden = true;
  const res = await api.publishInstallGh();
  $('publishInstallGhBtn').disabled = false;
  $('publishResult').hidden = false;
  $('publishResult').textContent = res.ok
    ? (res.already ? 'GitHub CLI is already installed.' : 'GitHub CLI installed — restart ProGramerly, then "gh auth login" once.')
    : `Could not install it automatically: ${res.error}`;
  loadPublishStatus();
});

$('publishSaveTokenBtn').addEventListener('click', async () => {
  const token = $('publishToken').value.trim();
  const result = $('publishResult');
  result.hidden = false;
  if (!token) { result.textContent = 'Paste a token first, then Save.'; return; }
  $('publishSaveTokenBtn').disabled = true;
  const res = await api.publishSetToken(token);
  $('publishSaveTokenBtn').disabled = false;
  $('publishToken').value = '';
  result.textContent = res.ok ? 'Token saved, encrypted at rest.' : `Could not save the token: ${res.error}`;
  loadPublishStatus();
});

$('publishClearTokenBtn').addEventListener('click', async () => {
  await api.publishClearToken();
  $('publishResult').hidden = false;
  $('publishResult').textContent = 'Stored token cleared.';
  loadPublishStatus();
});

$('publishResult').addEventListener('click', (e) => {
  const a = e.target.closest('[data-open]');
  if (a) { e.preventDefault(); api.openExternal(a.dataset.open); }
});

$('publishRunBtn').addEventListener('click', async () => {
  $('publishRunBtn').disabled = true;
  $('publishRefreshBtn').disabled = true;
  $('publishConsole').innerHTML = '';
  $('publishResult').hidden = true;
  const res = await api.publishRun();
  $('publishRefreshBtn').disabled = false;
  $('publishResult').hidden = false;
  $('publishResult').innerHTML = res.ok
    ? `Pushed and tagged ${esc(res.tag)}. Once GitHub finishes building (about 10–15 minutes): `
      + `<a href="#" data-open="${esc(res.releaseUrl)}">${esc(res.releaseUrl)}</a> — or watch it build now at `
      + `<a href="#" data-open="${esc(res.actionsUrl)}">${esc(res.actionsUrl)}</a>.`
    : `Stopped: ${esc(res.error || 'see the log above.')}`;
  await loadPublishStatus();
});

$('checkUpdateBtn').addEventListener('click', async () => {
  $('checkUpdateBtn').disabled = true;
  $('updateState').textContent = 'asking GitHub…';
  paintUpdate(await api.checkUpdate());
  $('checkUpdateBtn').disabled = false;
});

$('getUpdateBtn').addEventListener('click', async () => {
  $('getUpdateBtn').disabled = true;
  $('updateBarWrap').hidden = false;
  const res = await api.downloadUpdate();
  $('getUpdateBtn').disabled = false;
  if (res.ok) {
    downloadedFile = res.file;
    $('getUpdateBtn').hidden = true;
    $('installUpdateBtn').hidden = false;
    $('updateState').textContent = `Downloaded${res.verified ? ' and checksum-verified' : ''}. Installing closes ProGramerly and reopens the new build.`;
  } else {
    $('updateState').textContent = `Download failed: ${res.error}`;
  }
});

$('installUpdateBtn').addEventListener('click', async () => {
  $('installUpdateBtn').disabled = true;
  const res = await api.installUpdate(downloadedFile);
  if (!res.ok) {
    $('updateState').textContent = `Could not launch the installer: ${res.error}`;
    $('installUpdateBtn').disabled = false;
  } else if (res.manual) {
    $('updateState').textContent = 'The installer was handed to the system — finish it there.';
    $('installUpdateBtn').disabled = false;
  }
});

/* ---- settings ---------------------------------------------------------- */
$('shortcutBtn').addEventListener('click', async () => {
  const res = await api.createShortcut();
  $('shortcutNote').textContent = res.ok
    ? `Shortcut created at ${res.path}`
    : `Could not create the shortcut: ${res.error}`;
});
$('trayBtn').addEventListener('click', () => api.minimiseToTray());
$('resetBtn').addEventListener('click', async () => {
  SETTINGS = await api.resetSettings();
  syncControlsFromSettings();
  paintScope();
  paintSettingsSwitches();
});

const bindField = (id, key, transform) => {
  $(id).addEventListener('change', async () => {
    const raw = $(id).value;
    SETTINGS = await api.setSettings({ [key]: transform ? transform(raw) : raw });
    syncControlsFromSettings();
    if (key === 'syncTimes' || key === 'keepInSync') paintSyncStatus(await api.syncStatus());
  });
};
bindField('syncTimes', 'syncTimes', (v) => v.split(',').map((s) => s.trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s)));
bindField('metricsInterval', 'metricsInterval', (v) => Math.max(1, Math.min(60, Number(v) || 2)));
bindField('probeSeconds', 'probeSeconds', (v) => Math.max(1, Math.min(30, Number(v) || 5)));
bindField('updateChannel', 'updateChannel');
bindField('updateRepo', 'updateRepo', (v) => v.trim());

/* ======================================================================== *
 *  events from main
 * ======================================================================== */

api.onLog((p) => pushInto($('console'), p));
api.onMaintLog((p) => pushInto($('maintConsole'), p));
api.onSyncLog((p) => pushInto($('syncConsole'), p));
api.onPublishLog((p) => pushInto($('publishConsole'), p));

api.onQueue((q) => {
  queueOrder = q.map((x) => ({ ...x, state: 'pending' }));
  paintQueue();
  $('runCounter').textContent = `0 of ${q.length}`;
});

api.onItem((p) => {
  const row = queueOrder.find((q) => q.id === p.id);
  if (row) row.state = p.status;
  if (p.status === 'running') {
    $('runCurrent').textContent = row ? row.name : p.id;
    $('runCounter').textContent = `${(p.index ?? 0) + 1} of ${p.total ?? queueOrder.length}`;
  } else if (tally[p.status] !== undefined) {
    tally[p.status] += 1;
    paintTally();
    const done = tally.ok + tally.partial + tally.failed + tally.skipped;
    $('barFill').style.width = `${Math.round((done / Math.max(queueOrder.length, 1)) * 100)}%`;
  }
  paintQueue();
});

api.onDone((s) => {
  $('runCurrent').textContent = 'Finished';
  $('barFill').style.width = '100%';
  $('summaryTitle').textContent = s.failed ? 'Finished with issues' : 'All done';
  $('summaryBody').textContent =
    `${s.ok} installed, ${s.partial} partial, ${s.failed} failed, ${s.skipped} skipped. `
    + (s.failed
      ? 'Open the log to see which ones and why — most failures are a package ID that moved, and re-running just that item usually fixes it.'
      : 'Open a fresh terminal so the new PATH entries take effect.');
  $('rebootNote').hidden = !s.needsReboot;
  $('summarySheet').hidden = false;
});

api.onMetrics(paintMonitor);

api.onNetProgress((p) => {
  if (p.phase === 'geo' && p.geo && p.geo.ok) {
    $('geoLine').textContent = `${p.geo.ip} · ${p.geo.country} · edge ${p.geo.colo}`;
  }
  if (p.phase === 'region:start') {
    regionState.set(p.region, { id: p.region, label: p.label, cc: '', running: true, targets: [] });
    paintRegions();
  }
  if (p.phase === 'region:done') {
    regionState.set(p.result.id, { ...p.result, running: false });
    paintRegions();
  }
});

api.onSpeed((p) => {
  const bar = $('speedBar');
  if (p.phase === 'latency') { $('speedPhase').textContent = `latency ${p.pct}%`; bar.style.width = `${p.pct / 3}%`; }
  if (p.phase === 'download') {
    $('speedPhase').textContent = p.pct === 100 ? 'download done' : 'downloading…';
    bar.style.width = `${33 + (p.pct / 3)}%`;
    if (p.mbps) $('spDown').textContent = p.mbps;
  }
  if (p.phase === 'upload') {
    $('speedPhase').textContent = p.pct === 100 ? 'upload done' : 'uploading…';
    bar.style.width = `${66 + (p.pct / 3)}%`;
    if (p.mbps) $('spUp').textContent = p.mbps;
  }
});

api.onSpeedDone((r) => {
  $('spDown').textContent = r.downMbps ?? '—';
  $('spUp').textContent = r.upMbps ?? '—';
  $('spLat').textContent = r.latencyMs ?? '—';
  $('spJit').textContent = r.jitterMs ?? '—';
  $('speedServer').textContent = r.server || '';
  $('speedBar').style.width = '100%';
  $('speedPhase').textContent = `finished ${clock(r.at)}`;
});

api.onSyncStart((s) => {
  $('syncNext').textContent = s.apply ? 'syncing and installing…' : 'scanning, nothing will be touched…';
});

api.onSyncDone(async () => { paintSyncStatus(await api.syncStatus()); });
api.onSyncLinks(paintLinkResults);

api.onSyncSchedule((s) => paintSyncStatus({ enabled: s.enabled, nextRunAt: s.nextRunAt, lastSyncAt: SETTINGS.lastSyncAt }));
api.onUpdateAvailable(paintUpdate);
api.onUpdateChecked(paintUpdate);
api.onUpdateProgress((p) => {
  $('updateBarWrap').hidden = false;
  $('updateBar').style.width = `${p.pct || 0}%`;
  $('updateState').textContent = p.phase === 'verify'
    ? 'verifying checksum…'
    : `downloading ${p.name}… ${p.pct || 0}%`;
});

api.onSettingsChanged((s) => { SETTINGS = s; syncControlsFromSettings(); });
api.onTab((t) => showTab(t));
api.onAction((a) => { if (a === 'speedtest') $('speedBtn').click(); });

window.addEventListener('resize', () => { if (activeTab === 'monitor') drawNetChart(); });

boot().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin',
    `<pre style="padding:20px;color:#ff5d6c">Failed to start: ${e.message}</pre>`);
});
