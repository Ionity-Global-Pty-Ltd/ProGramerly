'use strict';
/* ProGramerly - intro sequence
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   The IONITY LOADER beats - the charging beam with its rising tone, the
   impact and flash, the wordmark, the typed line, the DOME assembling from
   real facts, then the pulses - in Ionity Global branding. Console.Beep was a
   square wave, so the audio here is a square oscillator with a short
   envelope - same instrument, quieter. */

const api = window.programerly;
const $ = (id) => document.getElementById(id);

/* The wordmark is the IONITY GLOBAL mark itself (assets/ionity-mark.png),
   revealed with a light sweep - the brand, not a console approximation of it. */
const SUBTITLE = 'Building Tomorrow, Today.';

/* The colour each stratum draws in. The dome is the first thing anyone sees,
   so it arrives in the palette the shell keeps using - not in grey. */
const STRATUM_HUE = {
  hardware: '#f0a03c',
  system: '#8b7cf5',
  storage: '#bdd631',
  toolchain: '#2f7ff0',
  intelligence: '#00c8f0',
};

/** Facts are read from the machine this is starting on - see intro:config. */
let CFG = {};

function factFor(st) {
  switch (st.id) {
    // Only facts that were actually read are spoken. A missing read is an
    // empty line, never a "0" dressed up as a count.
    case 'hardware': return CFG.cores ? `${CFG.cores} threads · ${CFG.memGb} GB · ${CFG.disks ?? '–'} volumes` : '';
    case 'system': return CFG.os || '';
    case 'storage': return CFG.toolsTotal ? `${CFG.tools}/${CFG.toolsTotal} tools present` : '';
    case 'toolchain': return CFG.catalogue ? `${CFG.catalogue} catalogue items · ${CFG.installed || 0} installed` : '';
    case 'intelligence': return CFG.datasets ? `${CFG.datasets} data sets · ${CFG.presets} presets` : '';
    default: return st.segments ? `${st.segments} segments` : '';
  }
}

let sound = true;
let ctx = null;
let finished = false;

/* ----------------------------------------------------------------- audio -- */

function audio() {
  if (!sound) return null;
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** One Console.Beep: square wave, given frequency, given milliseconds. */
function beep(freq, ms, gain = 0.055) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(Math.max(40, Math.min(12000, freq)), t);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.004);
  amp.gain.setValueAtTime(gain, t + ms / 1000 - 0.008);
  amp.gain.linearRampToValueAtTime(0, t + ms / 1000);
  osc.connect(amp).connect(c.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

/** A low sub-thump under the impact, so it lands in the chest not the ear. */
function impactThump() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.42);
  amp.gain.setValueAtTime(0.24, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  osc.connect(amp).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.55);
}

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** A timer-driven ease-out tween: apply(t) with t from 0 to 1 over ms. */
function tween(ms, apply) {
  const t0 = performance.now();
  const ease = (x) => 1 - (1 - x) ** 3;
  return new Promise((resolve) => {
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      apply(ease(t));
      if (t < 1 && !finished) setTimeout(tick, 16); else { apply(1); resolve(); }
    };
    tick();
  });
}

/* ----------------------------------------------------------------- stars -- */

const canvas = $('stars');
const g = canvas.getContext('2d');
let stars = [];

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas);

function sprinkle(count) {
  const chars = ['.', '+', '*', '·'];
  const midTop = window.innerHeight / 2 - 96;
  const midBottom = window.innerHeight / 2 + 96;
  for (let i = 0; i < count; i += 1) {
    const y = Math.random() * window.innerHeight;
    if (y > midTop && y < midBottom) continue;   // keep the logo band clear
    stars.push({
      x: Math.random() * window.innerWidth,
      y,
      ch: chars[Math.floor(Math.random() * chars.length)],
      life: 1,
    });
  }
}

function paintStars() {
  g.clearRect(0, 0, window.innerWidth, window.innerHeight);
  g.font = '12px "Cascadia Code", Consolas, monospace';
  g.textBaseline = 'middle';
  for (const s of stars) {
    g.globalAlpha = Math.max(0, s.life);
    g.fillStyle = '#ffd54a';
    g.fillText(s.ch, s.x, s.y);
    s.life -= 0.022;
  }
  g.globalAlpha = 1;
  stars = stars.filter((s) => s.life > 0);
  requestAnimationFrame(paintStars);
}
requestAnimationFrame(paintStars);

/* ------------------------------------------------------------- sequence -- */

async function chargingBeam() {
  const lane = $('beamlane');
  const beam = $('beam');
  lane.classList.add('on');

  const target = window.innerWidth / 2 - 120;
  let x = -140;
  let step = 9;
  let freq = 1000;
  let i = 0;

  while (x < target && !finished) {
    x += step;
    beam.style.transform = `translateX(${x}px)`;
    if (i % 4 === 0) { beep(freq, 26, 0.035); freq += 150; }
    if (step < 34) step += 1.35;             // the original shortened its sleep
    i += 1;
    // eslint-disable-next-line no-await-in-loop
    await wait(16);
  }
  lane.classList.remove('on');
}

async function impact() {
  beep(6000, 150, 0.07);
  impactThump();
  const flash = $('flash');
  const colours = ['#ffffff', '#1a6ee6', '#ff7a00', '#07080d'];
  for (const c of colours) {
    flash.style.background = c;
    flash.style.opacity = '0.92';
    // eslint-disable-next-line no-await-in-loop
    await wait(38);
    flash.style.opacity = '0';
    // eslint-disable-next-line no-await-in-loop
    await wait(14);
  }
}

async function revealLogo() {
  $('logo').classList.add('on');
  await wait(420);
}

async function typeSubtitle() {
  const el = $('subtitle');
  for (const ch of SUBTITLE) {
    if (finished) break;
    el.textContent += ch;
    // eslint-disable-next-line no-await-in-loop
    await wait(9);
  }
  el.classList.add('done');
  $('strap').classList.add('on');
  await wait(220);
}


/* ------------------------------------------------------- the DOME, drawn -- */

const CX = 260;
const CY = 232;

function arcPath(r) {
  return `M${CX - r},${CY} A${r},${r} 0 0 1 ${CX + r},${CY}`;
}

/**
 * Draw the dome one stratum at a time, base first, narrating each with a fact
 * read off this machine. Each arc is stroked in by animating its dash offset
 * through the CSSOM - a parsed style attribute would be dropped by the CSP.
 */
async function assembleDome() {
  // The strata come from the main process (dome.FRAMEWORK). If that read did
  // not arrive there is nothing real to draw, so the dome is skipped rather
  // than sketched from a stand-in.
  const strata = Array.isArray(CFG.strata) && CFG.strata.length ? CFG.strata : [];
  if (!strata.length) return;

  const wrap = $('domewrap');
  const arcs = $('arcs');
  const list = $('strata');
  const outer = 196;
  const step = Math.floor((outer - 42) / strata.length);

  arcs.innerHTML = '';
  list.innerHTML = '';
  strata.forEach((st, i) => {
    const r = outer - i * step;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', arcPath(r));
    path.setAttribute('class', i === 0 ? 'arc outer' : 'arc');
    path.dataset.stratum = st.id;
    arcs.appendChild(path);

    const li = document.createElement('li');
    li.dataset.stratum = st.id;
    li.innerHTML = `<i></i><b>${st.label}</b><span>${st.strap}</span><em></em>`;
    li.querySelector('i').style.background = STRATUM_HUE[st.id] || '#00c8f0';
    list.appendChild(li);
  });

  wrap.classList.add('on');
  wrap.style.opacity = '1'; wrap.style.transform = 'none';
  await wait(140);

  /* Each arc is stroked in by a timer-driven tween rather than a CSS
     transition: a window that is not being composited (a headless check, a
     driver hiccup, a VM without a compositor) does not advance CSS
     transitions, and the dome must still end up drawn. */
  for (let i = 0; i < strata.length; i += 1) {
    if (finished) break;
    const st = strata[i];
    const path = arcs.children[i];
    const li = list.children[i];
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    path.style.opacity = '0.96';
    path.classList.add('on');
    li.classList.add('on');
    li.style.opacity = '1'; li.style.transform = 'none';
    li.querySelector('em').textContent = factFor(st);
    $('status').textContent = `${st.label.toUpperCase()} · ${st.segments} segments · ${factFor(st)}`;
    beep(420 + i * 130, 42, 0.03);
    tween(560, (t) => { path.style.strokeDashoffset = `${len * (1 - t)}`; });
    // eslint-disable-next-line no-await-in-loop
    await wait(380);
  }

  // The segment ring: one dot per segment, sweeping the apex arc.
  if (!finished) {
    const dots = $('segdots');
    const total = strata.reduce((a, st) => a + st.segments, 0);
    dots.innerHTML = '';
    for (let i = 0; i < total; i += 1) {
      const a = Math.PI - (i / (total - 1)) * Math.PI;
      const r = outer + 14;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', (CX + Math.cos(a) * r).toFixed(1));
      c.setAttribute('cy', (CY - Math.sin(a) * r).toFixed(1));
      c.setAttribute('r', '2.2');
      c.setAttribute('class', 'segdot');
      dots.appendChild(c);
      // eslint-disable-next-line no-await-in-loop
      if (i % 3 === 0) await wait(16);
      c.classList.add('on');
      c.style.opacity = '0.9';
    }
    beep(2600, 60, 0.035);
    // The apex sits on the innermost arc, not at a guessed height.
    const apex = $('apex');
    apex.setAttribute('cx', String(CX));
    apex.setAttribute('cy', String(CY - (outer - (strata.length - 1) * step)));
    apex.setAttribute('r', '7');
    apex.classList.add('on');
    apex.style.opacity = '1';
    $('status').textContent = `${total} SEGMENTS BOUND · ${CFG.datasets || 0} DATA SETS IN REACH`;
  }
}

async function finalPulse() {
  const logo = $('logo');
  $('colophon').classList.add('on');
  const mark = $('watermark'); if (mark) mark.classList.add('on');
  if (CFG.version) {
    $('colo-meta').textContent = `v${CFG.version} · ${CFG.host || ''} · Policy 986 AED · © 2018–2026 Antwerp Designs | Ionity (Pty) Ltd`;
  }
  for (let p = 0; p < 6; p += 1) {
    if (finished) break;
    logo.classList.toggle('pulse-white', p % 2 === 0);
    sprinkle(15);
    beep(4000, 50, 0.03);
    // eslint-disable-next-line no-await-in-loop
    await wait(125);
  }
  logo.classList.remove('pulse-white');
  $('status').textContent = 'AEDi · READY';
  $('status').classList.add('ready');
}

async function play() {
  try {
    CFG = await api.introConfig() || {};
    sound = CFG.sound !== false;
  } catch { sound = true; CFG = {}; }
  if (CFG.watermark === false) { const w = $('watermark'); if (w) w.remove(); }

  await chargingBeam();
  if (!finished) await impact();
  if (!finished) await revealLogo();
  if (!finished) await typeSubtitle();
  if (!finished) await assembleDome();
  if (!finished) await finalPulse();
  if (!finished) await wait(650);
  done();
}

function done() {
  if (finished) return;
  finished = true;
  document.body.style.transition = 'opacity .35s ease';
  document.body.style.opacity = '0';
  setTimeout(() => api.introDone(), 340);
}

$('skip').addEventListener('click', done);
window.addEventListener('keydown', done);
window.addEventListener('click', (e) => { if (e.target.id !== 'skip') done(); });

play();
