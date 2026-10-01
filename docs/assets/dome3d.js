'use strict';
/* ProGramerly - the Ionity DOME, in three dimensions
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   One renderer for every place the DOME appears - the intro, the deck card and
   the download page. No library: a shaded hemisphere on a 2D canvas, built
   from latitude bands (one per stratum, base to apex) and longitude sectors,
   lit, depth-sorted and perspective-projected every frame.

   What it draws is what it is given. A stratum's band fills around its
   circumference to the stratum's score; each segment is a node on its band,
   coloured by its own level. A stratum with no score is drawn as glass, a
   segment with no reading as a dim node - nothing is filled in for effect.

   Drag to turn it, hover a node for its reading, click to open it.

   Dome3D.create(canvas, {
     strata: [{ id, label, hue, value, level, segments: [{ id, name, value, level, label }] }],
     autoRotate: 0.12,      // radians per second, 0 to hold still
     interactive: true,     // drag, hover, click
     labels: true,          // stratum names on the face toward the viewer
     onPick(hit) {},        // { stratum, segment|null }
     tooltip: true,
   }) -> { setStrata(strata), setReveal(x), destroy() } */

(function (root) {
  const TAU = Math.PI * 2;
  const LEVEL_HUE = { warn: '#f0a03c', err: '#f0686a' };
  const DEFAULT_HUE = ['#f0a03c', '#8b7cf5', '#bdd631', '#2f7ff0', '#00c8f0'];
  const SECTORS = 40;
  const CAP = (82 / 180) * Math.PI;          // the top band stops short of the pole; the apex beacon sits there
  const LIGHT = norm([-0.45, 0.78, -0.55]);  // camera space, upper left, in front
  /* Band edges are spaced by height, not by angle: equal angles crush the top
     strata into slivers near the pole, equal heights give every stratum the
     same presence on the dome. */
  const edge = (i, n) => Math.asin(Math.min(1, (i / n) * Math.sin(CAP)));

  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function rgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 200, 240];
  }
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function create(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const o = {
      autoRotate: reduce ? 0 : (opts.autoRotate == null ? 0.12 : opts.autoRotate),
      interactive: opts.interactive !== false,
      labels: opts.labels !== false,
      tooltip: opts.tooltip !== false,
      onPick: opts.onPick || null,
      ground: opts.ground !== false,
      particles: opts.particles !== false && !reduce,
      glow: opts.glow == null ? 1 : opts.glow,
    };
    let strata = [];
    let reveal = Infinity;              // bands drawn: 2.4 = two whole bands and 40% of the third
    let yaw = opts.yaw == null ? -0.6 : opts.yaw;
    let pitch = opts.pitch == null ? 0.3 : opts.pitch;
    let W = 0; let H = 0; let dpr = 1;
    let raf = 0; let last = 0; let alive = true; let visible = true;
    let drag = null; let hover = null; let mouse = null; let justDragged = false;
    let nodes = [];                     // projected segment nodes this frame
    const sparks = [];

    /* ---- tooltip: a DOM element so it is crisp and selectable */
    let tip = null;
    if (o.tooltip && canvas.parentElement) {
      tip = document.createElement('div');
      tip.className = 'dome3d-tip';
      tip.hidden = true;
      canvas.parentElement.appendChild(tip);
    }

    function setStrata(list) {
      strata = (list || []).map((s, i) => ({
        ...s,
        hue: rgb(s.hue || DEFAULT_HUE[i % DEFAULT_HUE.length]),
        segments: Array.isArray(s.segments) ? s.segments
          : Array.from({ length: Number(s.segments) || 0 }, (_, k) => ({ id: `${s.id}-${k}`, name: '', value: null, level: 'idle' })),
      }));
    }
    setStrata(opts.strata);

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(root.devicePixelRatio || 1, 2);
      W = Math.max(10, r.width); H = Math.max(10, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const ro = root.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas); else root.addEventListener('resize', resize);
    resize();

    /* ---- camera */
    function view(x, y, z) {
      const cy = Math.cos(yaw); const sy = Math.sin(yaw);
      const x1 = x * cy - z * sy; const z1 = x * sy + z * cy;
      const cp = Math.cos(pitch); const sp = Math.sin(pitch);
      // Pitch tips the near side down, so the camera looks down onto the apex.
      const y2 = y * cp + z1 * sp; const z2 = -y * sp + z1 * cp;
      return [x1, y2, z2];
    }
    function layout() {
      // Fit the hemisphere (radius 1, sitting on y = 0) into the canvas.
      // Fit exactly what the camera sees: the apex rises cos(p)·D/(D - sin p)
      // above the base centre, the near rim drops sin(p)·D/(D - cos p) below
      // it, and perspective widens the near side.
      const D = 3.4;
      const cp = Math.cos(pitch); const sp = Math.sin(pitch);
      const rise = (cp * D) / (D - sp) + 0.08;              // + the beacon's glow
      const drop = (sp * D) / (D - cp) + 0.06;
      const wide = D / (D - cp * 0.7) + 0.05;
      const R = Math.max(10, Math.min((W * 0.94) / (2 * wide), (H * 0.94) / (rise + drop)));
      return { R, cx: W / 2, cy: (H - (rise + drop) * R) / 2 + rise * R, D };
    }
    function project(v, L) {
      const p = L.D / (L.D + v[2]);
      return [L.cx + v[0] * L.R * p, L.cy - v[1] * L.R * p, p];
    }
    const onSphere = (lat, lon, r = 1) => [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)];

    /* ---- one frame */
    function frame(now) {
      if (!alive) return;
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (!drag && o.autoRotate) yaw += o.autoRotate * dt;
      draw(now / 1000);
      if (visible) raf = requestAnimationFrame(frame);
    }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      const L = layout();
      const n = strata.length;
      if (!n) return;

      /* floor: reflection pool and rings */
      if (o.ground) {
        const g = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.R * 1.25);
        g.addColorStop(0, `rgba(0,200,240,${0.16 * o.glow})`);
        g.addColorStop(0.55, `rgba(47,127,240,${0.06 * o.glow})`);
        g.addColorStop(1, 'rgba(47,127,240,0)');
        ctx.save();
        ctx.translate(L.cx, L.cy);
        ctx.scale(1, Math.max(0.12, Math.sin(pitch) * 0.62));
        ctx.translate(-L.cx, -L.cy);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(L.cx, L.cy, L.R * 1.25, 0, TAU); ctx.fill();
        ctx.restore();
        for (let k = 1; k <= 3; k += 1) {
          ctx.beginPath();
          for (let j = 0; j <= 72; j += 1) {
            const a = (j / 72) * TAU;
            const r = 1 + k * 0.12;
            const p = project(view(r * Math.cos(a), 0, r * Math.sin(a)), L);
            if (j === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
          }
          ctx.strokeStyle = `rgba(0,200,240,${(0.11 - k * 0.025) * o.glow})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      /* bands as lit quads, far first */
      const quads = [];
      for (let i = 0; i < n; i += 1) {
        const st = strata[i];
        const shown = Math.max(0, Math.min(1, reveal - i));
        if (shown <= 0) continue;
        const lat0 = edge(i, n); const lat1 = edge(i + 1, n);
        const level = st.level === 'err' || st.level === 'warn' ? st.level : null;
        const hue = level ? rgb(LEVEL_HUE[level]) : st.hue;
        const fill = st.value == null ? 0 : Math.max(0, Math.min(1, st.value / 100));
        const sweep = SECTORS * shown;
        for (let j = 0; j < Math.ceil(sweep); j += 1) {
          const lon0 = (j / SECTORS) * TAU;
          const lon1 = (Math.min(sweep, j + 1) / SECTORS) * TAU;
          const corners = [onSphere(lat0, lon0), onSphere(lat0, lon1), onSphere(lat1, lon1), onSphere(lat1, lon0)].map((c) => view(c[0], c[1], c[2]));
          const mid = view(...onSphere((lat0 + lat1) / 2, (lon0 + lon1) / 2));
          const front = mid[2] < 0.05;      // the outward normal of a sphere point is the point itself
          const lit = Math.max(0, mid[0] * LIGHT[0] + mid[1] * LIGHT[1] + mid[2] * LIGHT[2]);
          const filled = j / SECTORS < fill;
          quads.push({ corners, z: mid[2], front, lit, hue, filled, ring: i });
        }
      }
      quads.sort((a, b) => b.z - a.z);
      for (const q of quads) {
        const pts = q.corners.map((c) => project(c, L));
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < 4; k += 1) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.closePath();
        const shade = 0.35 + 0.65 * q.lit;
        const c = mix([8, 16, 24], q.hue, q.filled ? 0.55 + 0.45 * shade : 0.18 + 0.2 * shade);
        const a = q.front ? (q.filled ? 0.62 + 0.3 * shade : 0.14) : (q.filled ? 0.16 : 0.05);
        ctx.fillStyle = rgba(c, a);
        ctx.fill();
        ctx.strokeStyle = rgba(q.hue, q.front ? (q.filled ? 0.55 : 0.22) : 0.07);
        ctx.lineWidth = q.front ? 0.8 : 0.5;
        ctx.stroke();
      }

      /* latitude rims - a bright edge on the near side of every band */
      for (let i = 0; i < n; i += 1) {
        const shown = Math.max(0, Math.min(1, reveal - i));
        if (shown <= 0) continue;
        const st = strata[i];
        const level = st.level === 'err' || st.level === 'warn' ? st.level : null;
        const hue = level ? rgb(LEVEL_HUE[level]) : st.hue;
        const lat = edge(i + 1, n);
        let prev = null;
        for (let j = 0; j <= Math.ceil(SECTORS * 2 * shown); j += 1) {
          const lon = (j / (SECTORS * 2)) * TAU;
          const v = view(...onSphere(lat, lon, 1.004));
          const p = project(v, L);
          if (prev) {
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]);
            ctx.strokeStyle = rgba(hue, v[2] < 0 ? 0.9 : 0.18);
            ctx.lineWidth = v[2] < 0 ? 1.6 : 0.8;
            ctx.stroke();
          }
          prev = p;
        }
      }

      /* particles climbing the meridians */
      if (o.particles && reveal >= n) {
        if (sparks.length < 26 && Math.random() < 0.3) sparks.push({ lon: Math.random() * TAU, lat: 0, v: 0.18 + Math.random() * 0.3 });
        for (let k = sparks.length - 1; k >= 0; k -= 1) {
          const s = sparks[k];
          s.lat += s.v * 0.016;
          if (s.lat > CAP) { sparks.splice(k, 1); continue; }
          const v = view(...onSphere(s.lat, s.lon, 1.012));
          if (v[2] > 0.1) continue;
          const p = project(v, L);
          let band = 0; while (band < n - 1 && s.lat > edge(band + 1, n)) band += 1;
          ctx.fillStyle = rgba(strata[band].hue, 0.85);
          ctx.beginPath(); ctx.arc(p[0], p[1], 1.6 * p[2], 0, TAU); ctx.fill();
        }
      }

      /* segment nodes, one per segment on its band */
      nodes = [];
      for (let i = 0; i < n; i += 1) {
        const st = strata[i];
        const shown = Math.max(0, Math.min(1, reveal - i));
        if (shown <= 0) continue;
        const segs = st.segments;
        const lat = (edge(i, n) + edge(i + 1, n)) / 2;
        const count = Math.max(1, Math.round(segs.length * shown));
        for (let k = 0; k < count; k += 1) {
          const seg = segs[k];
          const lon = (k / segs.length) * TAU + i * 0.37;
          const v = view(...onSphere(lat, lon, 1.03));
          const p = project(v, L);
          nodes.push({ x: p[0], y: p[1], z: v[2], s: p[2], stratum: st, segment: seg });
        }
      }
      nodes.sort((a, b) => b.z - a.z);
      for (const nd of nodes) {
        const seg = nd.segment;
        const lvl = seg.level === 'err' || seg.level === 'warn' ? LEVEL_HUE[seg.level] : null;
        const c = lvl ? rgb(lvl) : nd.stratum.hue;
        const scored = seg.value != null;
        const front = nd.z < 0;
        const isHover = hover && hover.segment === seg;
        const r = (isHover ? 5.4 : scored ? 3.6 : 2.6) * nd.s;
        const pulse = 0.75 + 0.25 * Math.sin(t * 2.2 + nd.x * 0.05);
        if (front) {
          const g = ctx.createRadialGradient(nd.x, nd.y, 0, nd.x, nd.y, r * 4.2);
          g.addColorStop(0, rgba(c, (scored ? 0.55 : 0.25) * pulse * o.glow));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(nd.x, nd.y, r * 4.2, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = front ? (scored ? rgba(mix(c, [255, 255, 255], 0.35), 1) : rgba(c, 0.55)) : rgba(c, 0.18);
        ctx.beginPath(); ctx.arc(nd.x, nd.y, r, 0, TAU); ctx.fill();
        if (isHover) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.4; ctx.stroke(); }
      }

      /* apex beacon */
      if (reveal >= n) {
        const v = view(...onSphere(Math.PI / 2, 0, 1));
        const p = project(v, L);
        const pr = (10 + 3 * Math.sin(t * 2)) * p[2];
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], pr * 3.2);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * o.glow})`);
        g.addColorStop(0.25, `rgba(255,122,0,${0.75 * o.glow})`);
        g.addColorStop(1, 'rgba(255,122,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p[0], p[1], pr * 3.2, 0, TAU); ctx.fill();
      }

      /* stratum names on the face toward the viewer */
      if (o.labels && W > 260) {
        ctx.font = '600 9.5px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lon = -Math.PI / 2 - yaw;
        let lastY = Infinity;
        for (let i = 0; i < n; i += 1) {
          if (reveal - i < 1) continue;
          const st = strata[i];
          const v = view(...onSphere((edge(i, n) + edge(i + 1, n)) / 2, lon, 1.0));
          const p = project(v, L);
          if (lastY - p[1] < 15) continue;          // never stack two labels on one line
          lastY = p[1];
          const label = String(st.label || '').toUpperCase().split('').join(String.fromCharCode(8202));
          ctx.fillStyle = 'rgba(4,10,16,.55)';
          const w = ctx.measureText(label).width + 10;
          ctx.fillRect(p[0] - w / 2, p[1] - 7, w, 14);
          ctx.fillStyle = 'rgba(232,244,252,.92)';
          ctx.fillText(label, p[0], p[1]);
        }
      }
      paintTip();
    }

    /* ---- interaction */
    function hitAt(x, y) {
      let best = null; let bd = 14;
      for (const nd of nodes) {
        if (nd.z > 0.15) continue;
        const d = Math.hypot(nd.x - x, nd.y - y);
        if (d < bd) { bd = d; best = nd; }
      }
      return best;
    }
    function paintTip() {
      if (!tip) return;
      if (!hover || !mouse) { tip.hidden = true; return; }
      const seg = hover.segment; const st = hover.stratum;
      const val = seg.value != null ? `${seg.value}%` : (seg.label || 'not read');
      tip.innerHTML = '';
      const b = document.createElement('b'); b.textContent = seg.name || st.label;
      const s = document.createElement('span'); s.textContent = `${st.label} · ${val}`;
      tip.append(b, s);
      if (seg.label && seg.value != null) { const e = document.createElement('em'); e.textContent = seg.label; tip.append(e); }
      tip.hidden = false;
      const pr = canvas.getBoundingClientRect(); const par = canvas.parentElement.getBoundingClientRect();
      tip.style.left = `${Math.min(par.width - 170, Math.max(4, hover.x + (pr.left - par.left) + 12))}px`;
      tip.style.top = `${Math.max(4, hover.y + (pr.top - par.top) - 18)}px`;
    }
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function onDown(e) {
      const [x, y] = pos(e);
      drag = { x, y, yaw, pitch, moved: false };
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    }
    function onMove(e) {
      const [x, y] = pos(e);
      mouse = [x, y];
      if (drag) {
        const dx = x - drag.x; const dy = y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        yaw = drag.yaw + dx * 0.012;
        pitch = Math.max(0.08, Math.min(1.1, drag.pitch + dy * 0.006));
      }
      hover = hitAt(x, y);
      canvas.style.cursor = hover ? 'pointer' : (drag ? 'grabbing' : 'grab');
      if (!raf && !visible) draw(performance.now() / 1000);
    }
    function onUp(e) {
      const wasDrag = drag && drag.moved;
      drag = null;
      if (wasDrag) { justDragged = true; return; }
      const [x, y] = pos(e);
      const hit = hitAt(x, y);
      if (o.onPick) {
        e.stopPropagation();
        o.onPick(hit ? { stratum: hit.stratum, segment: hit.segment } : { stratum: null, segment: null });
      }
    }
    function onLeave() { hover = null; mouse = null; if (tip) tip.hidden = true; }
    if (o.interactive) {
      canvas.style.touchAction = 'none';
      canvas.style.cursor = 'grab';
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointerleave', onLeave);
      // A drag must not become a click on whatever the canvas sits inside.
      canvas.addEventListener('click', (e) => {
        if (o.onPick || justDragged) { e.stopPropagation(); e.preventDefault(); }
        justDragged = false;
      });
    }

    /* Only animate while on screen; a hidden DOME costs nothing. */
    const io = root.IntersectionObserver ? new IntersectionObserver((es) => {
      visible = es.some((x) => x.isIntersecting);
      if (visible && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    }) : null;
    if (io) io.observe(canvas);
    raf = requestAnimationFrame(frame);

    return {
      setStrata(list) { setStrata(list); },
      setReveal(x) { reveal = x; if (!visible) draw(performance.now() / 1000); },
      drawNow() { draw(performance.now() / 1000); },
      destroy() {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        if (tip) tip.remove();
      },
    };
  }

  root.Dome3D = { create };
}(typeof window !== 'undefined' ? window : globalThis));
