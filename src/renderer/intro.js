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

/* The Ionity node burst. The film is the brand's own intro, cut to its first
   4.5 s (before it turns white) - the wordmark arrives as the nodes settle,
   so the logo is revealed over the last of it rather than after it. A missing
   or unplayable file simply skips the step. */
async function playBurst() {
  const v = $('burst');
  if (!v) return;
  try {
    v.currentTime = 0;
    await v.play();
  } catch { return; }
  v.classList.add('on');
  await new Promise((resolve) => {
    let done = false;
    const end = () => { if (!done) { done = true; resolve(); } };
    const tick = () => { if (finished || v.ended || v.currentTime >= 3.55) end(); else setTimeout(tick, 40); };
    tick();
    setTimeout(end, 5200);
  });
}

async function revealLogo() {
  $('logo').classList.add('on');
  const v = $('burst');
  if (v) { v.classList.add('out'); setTimeout(() => { try { v.pause(); } catch { /* gone */ } }, 900); }
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

/**
 * The DOME assembles in three dimensions, base first: each stratum's band
 * sweeps around the hemisphere while its fact - read off this machine - is
 * narrated beside it. The intro knows the structure (strata and their segment
 * counts), not the scores, so every band is glass and every node neutral: it
 * shows what will be measured, never a measurement it has not taken.
 */
let dome = null;
async function assembleDome() {
  const strata = Array.isArray(CFG.strata) && CFG.strata.length ? CFG.strata : [];
  if (!strata.length) return;

  const wrap = $('domewrap');
  const list = $('strata');
  list.innerHTML = '';
  strata.forEach((st) => {
    const li = document.createElement('li');
    li.dataset.stratum = st.id;
    li.innerHTML = `<i></i><b>${st.label}</b><span>${st.strap}</span><em></em>`;
    li.querySelector('i').style.background = STRATUM_HUE[st.id] || '#00c8f0';
    li.querySelector('i').style.color = STRATUM_HUE[st.id] || '#00c8f0';
    list.appendChild(li);
  });

  wrap.classList.add('on');
  wrap.style.opacity = '1'; wrap.style.transform = 'none';

  if (window.Dome3D) {
    dome = window.Dome3D.create($('dome3d'), {
      strata: strata.map((st) => ({ id: st.id, label: st.label, hue: STRATUM_HUE[st.id], value: null, level: 'idle', segments: st.segments })),
      autoRotate: 0.55, interactive: false, labels: false, tooltip: false, glow: 1.15, yaw: -1.2,
    });
    dome.setReveal(0);
  }
  await wait(120);

  /* Timer-driven, not CSS: a window that is not being composited must still
     end up with the whole dome drawn. */
  for (let i = 0; i < strata.length; i += 1) {
    if (finished) break;
    const st = strata[i];
    const li = list.children[i];
    li.classList.add('on');
    li.style.opacity = '1'; li.style.transform = 'none';
    li.querySelector('em').textContent = factFor(st);
    $('status').textContent = `${st.label.toUpperCase()} · ${st.segments} segments · ${factFor(st)}`;
    beep(420 + i * 130, 42, 0.03);
    if (dome) tween(520, (t) => dome.setReveal(i + t));
    // eslint-disable-next-line no-await-in-loop
    await wait(400);
  }
  if (!finished) {
    if (dome) dome.setReveal(Infinity);
    beep(2600, 60, 0.035);
    const total = strata.reduce((a, st) => a + st.segments, 0);
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
  if (!finished) await playBurst();
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
  setTimeout(() => { if (dome) dome.destroy(); api.introDone(); }, 340);
}

$('skip').addEventListener('click', done);
window.addEventListener('keydown', done);
window.addEventListener('click', (e) => { if (e.target.id !== 'skip') done(); });

play();
