'use strict';
/* ProGramerly - intro sequence
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   The IONITY LOADER v3.2 console intro, beat for beat: the charging beam with
   its rising tone, the 6 kHz impact and quadruple flash, the block logo, the
   typed subtitle, the loader bar with its status lines, then six pulses with
   scattered stars at 4 kHz. Console.Beep was a square wave, so the audio here
   is a square oscillator with a short envelope - same instrument. */

const api = window.programerly;
const $ = (id) => document.getElementById(id);

/* The wordmark is drawn from blocks rather than typed with box-drawing
   characters: the console original relied on a font that is not on every
   machine, and a missing glyph turns the logo into rubble. Same shape, drawn
   with rectangles, identical on every OS. */
const GLYPHS = {
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};
const WORD = 'IONITY';
const CELL = 11;
const GAP = 1.4;
const LETTER_GAP = 2;

function buildLogo() {
  const cols = WORD.length * 5 + (WORD.length - 1) * LETTER_GAP;
  const w = cols * CELL;
  const h = 7 * CELL;
  const rects = [];
  let cursor = 0;
  for (const ch of WORD) {
    const rows = GLYPHS[ch];
    rows.forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit !== '1') return;
        rects.push(`<rect x="${((cursor + x) * CELL).toFixed(1)}" y="${(y * CELL).toFixed(1)}" `
          + `width="${(CELL - GAP).toFixed(1)}" height="${(CELL - GAP).toFixed(1)}" rx="1" />`);
      });
    });
    cursor += 5 + LETTER_GAP;
  }
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rects.join('')}</svg>`;
}

const SUBTITLE = 'ANYTHING IS POSSIBLE | BY CREATOR FOR CREATION';
const STATUS = [
  '  Initializing Core',
  '  ...Allocating RAM...',
  '  ...Injecting DLLs...',
  '.......3......',
  '.......2......',
  '......1......',
  '<......READY.....>',
];

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
  const colours = ['#ffffff', '#00c6ff', '#087f9e', '#03070d'];
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
  const el = $('logo');
  el.innerHTML = buildLogo();
  el.classList.add('on');
  await wait(150);
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
}

async function loaderBar() {
  $('barwrap').classList.add('on');
  const fill = $('fill');
  const status = $('status');
  const steps = 40;
  for (let p = 0; p <= steps; p += 1) {
    if (finished) break;
    fill.style.width = `${Math.round((p / steps) * 100)}%`;
    if (p % 6 === 0) {
      const idx = Math.min(STATUS.length - 1, Math.floor((p / steps) * (STATUS.length - 1)));
      status.textContent = STATUS[idx];
      beep(520 + idx * 90, 18, 0.02);
    }
    // eslint-disable-next-line no-await-in-loop
    await wait(28);
  }
  status.textContent = STATUS[STATUS.length - 1];
}

async function finalPulse() {
  const logo = $('logo');
  $('colophon').classList.add('on');
  for (let p = 0; p < 6; p += 1) {
    if (finished) break;
    logo.classList.toggle('pulse-white', p % 2 === 0);
    sprinkle(15);
    beep(4000, 50, 0.03);
    // eslint-disable-next-line no-await-in-loop
    await wait(125);
  }
  logo.classList.remove('pulse-white');
}

async function play() {
  try {
    const cfg = await api.introConfig();
    sound = cfg && cfg.sound !== false;
  } catch { sound = true; }

  await chargingBeam();
  if (!finished) await impact();
  if (!finished) await revealLogo();
  if (!finished) await typeSubtitle();
  if (!finished) await loaderBar();
  if (!finished) await finalPulse();
  if (!finished) await wait(280);
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
