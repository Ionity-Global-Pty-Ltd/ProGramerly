'use strict';
/**
 * ProGramerly - gradient node field
 * Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
 *
 * The backdrop behind the whole application: a small graph of soft gradient
 * nodes that drift, link to their neighbours, and breathe on one shared
 * oscillator - so the field inhales and exhales as a single thing rather than
 * as thirty independent animations.
 *
 * Restraint is the point. Few nodes, low alpha, no hard edges, nothing that
 * competes with the text in front of it. A backdrop you notice is a backdrop
 * that failed.
 *
 * It costs nothing when it is not being looked at: the loop stops on window
 * blur and on tab hide, it halves its own node count on a small window, and
 * `prefers-reduced-motion` gets one still frame and no loop at all.
 */

(function nodeField() {
  const canvas = document.getElementById('nodefield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });

  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Brand-led, deliberately narrow. Mostly cyan, with just enough variation
     that the links between nodes are gradients rather than flat lines. */
  const HUES = [
    [0, 198, 255],    // --cyan
    [10, 151, 196],   // --cyan-dim
    [51, 214, 159],   // --ok, the mint
    [77, 141, 255],   // a cooler blue, used sparingly
  ];

  const LINK_DIST = 210;     // px at which two nodes stop being neighbours
  const BREATH_MS = 11000;   // one full inhale + exhale
  const MAX_DPR = 2;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let nodes = [];
  let raf = 0;
  let running = false;
  let enabled = true;

  const pointer = { x: -9999, y: -9999, on: false };

  function makeNode(i, count) {
    const c = HUES[i % HUES.length];
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.16,
      vy: (Math.random() - 0.5) * 0.16,
      r: 46 + Math.random() * 78,          // blob radius, not a dot radius
      c,
      phase: (i / count) * Math.PI * 2,     // so nodes breathe slightly out of step
      weight: 0.55 + Math.random() * 0.45,
    };
  }

  function build() {
    // One node per ~62k px², clamped. A 1280x800 window lands around 26.
    const target = Math.max(10, Math.min(Math.round((W * H) / 62000), 30));
    nodes = [];
    for (let i = 0; i < target; i += 1) nodes.push(makeNode(i, target));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    // setTransform, never scale: scale compounds on every resize.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    if (REDUCED || !enabled) drawOnce();
  }

  function step(breath) {
    const drift = 0.72 + 0.5 * breath;
    for (const n of nodes) {
      n.x += n.vx * drift;
      n.y += n.vy * drift;

      // Wrap with a margin, so a node never pops in at the edge.
      const m = n.r;
      if (n.x < -m) n.x = W + m;
      if (n.x > W + m) n.x = -m;
      if (n.y < -m) n.y = H + m;
      if (n.y > H + m) n.y = -m;

      // The pointer leans the field toward itself. Gently: this is a
      // backdrop, and a backdrop that chases the cursor is a distraction.
      if (pointer.on) {
        const dx = pointer.x - n.x;
        const dy = pointer.y - n.y;
        const d = Math.hypot(dx, dy);
        if (d > 1 && d < 340) {
          const pull = (1 - d / 340) * 0.10;
          n.x += dx / d * pull;
          n.y += dy / d * pull;
        }
      }
    }
  }

  function drawLinks(breath) {
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > LINK_DIST) continue;

        const closeness = 1 - d / LINK_DIST;
        const alpha = closeness * closeness * (0.15 + 0.12 * breath);
        if (alpha < 0.004) continue;

        // A gradient between the two node colours - the link belongs to both.
        const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, `rgba(${a.c[0]},${a.c[1]},${a.c[2]},${alpha.toFixed(4)})`);
        g.addColorStop(1, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${alpha.toFixed(4)})`);
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  function drawNodes(breath, t) {
    for (const n of nodes) {
      // Each node breathes on the shared oscillator plus its own phase, so
      // the field is coherent without being metronomic.
      const own = 0.5 + 0.5 * Math.sin(t / BREATH_MS * Math.PI * 2 + n.phase);
      const r = n.r * (0.82 + 0.26 * (breath * 0.65 + own * 0.35));
      const peak = (0.085 + 0.065 * breath) * n.weight;

      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
      g.addColorStop(0, `rgba(${n.c[0]},${n.c[1]},${n.c[2]},${peak.toFixed(4)})`);
      g.addColorStop(0.55, `rgba(${n.c[0]},${n.c[1]},${n.c[2]},${(peak * 0.34).toFixed(4)})`);
      g.addColorStop(1, `rgba(${n.c[0]},${n.c[1]},${n.c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();

      // The core: a small bright dot so the graph reads as nodes, not fog.
      const core = (0.42 + 0.30 * own) * n.weight;
      ctx.fillStyle = `rgba(${n.c[0]},${n.c[1]},${n.c[2]},${core.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function paint(t) {
    const breath = 0.5 + 0.5 * Math.sin((t / BREATH_MS) * Math.PI * 2);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';   // additive: overlaps glow, never muddy
    drawLinks(breath);
    drawNodes(breath, t);
    ctx.globalCompositeOperation = 'source-over';
    return breath;
  }

  function drawOnce() {
    if (!W || !H) return;
    paint(BREATH_MS * 0.25);   // mid-inhale: the field at its most legible
  }

  function frame(t) {
    if (!running) return;
    const breath = paint(t);
    step(breath);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || REDUCED || !enabled) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /** Settings can switch the whole field off; then it costs literally nothing. */
  function setEnabled(on) {
    enabled = Boolean(on);
    canvas.hidden = !enabled;
    if (!enabled) { stop(); ctx.clearRect(0, 0, W, H); return; }
    if (REDUCED) drawOnce(); else start();
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('mousemove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = true; }, { passive: true });
  window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) pointer.on = false; }, { passive: true });
  window.addEventListener('blur', stop);
  window.addEventListener('focus', () => { if (!document.hidden) start(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

  resize();
  if (REDUCED) drawOnce(); else start();

  window.nodeField = { setEnabled, stop, start };
})();
