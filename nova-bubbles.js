/* Nova floating bubbles
   - Channels and Friends: circles that float, bounce off each other and the walls, can be
     dragged / flung, and are pushed away by the pointer.
   - Interests: animated donut rings (Genres, Sites) with leader-line labels.
   Mounts itself on any  .nbx-stage[data-nb]  that appears in the page (profile re-renders
   replace the HTML, so a MutationObserver picks the new stages up). No dependencies. */
(() => {
  'use strict';
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hueOf = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h ^ (h >>> 13)) % 360; };
  const isUrl = u => /^https?:\/\//i.test(u || '');

  /* ================================================================ physics stage */
  function mount(stage, items, o) {
    o = o || {};
    if (stage._nb) stage._nb.destroy();
    const n = items.length;
    let W = stage.clientWidth || 320, H = 300, raf = 0, last = 0, visible = true, dead = false;
    const heightFn = o.height || ((w, c) => clamp(w < 520 ? w * (1.05 + c / 90) : w * (0.5 + c / 120), 300, 640));
    const bodies = items.map((it, i) => ({
      it, i, x: 0, y: 0, vx: 0, vy: 0, r: 20, s0: 20, ph: Math.random() * 6.283, el: null, drag: false
    }));
    stage.classList.add('nbx-live');
    stage.innerHTML = '';
    const tip = document.createElement('div'); tip.className = 'nb-tip'; tip.hidden = true; stage.append(tip);
    let tipBody = null, pinned = null, pointer = null, grab = null;

    function sizeAll(keepPos) {
      H = Math.round(heightFn(W, n)); stage.style.height = H + 'px';
      const ws = bodies.map(b => Math.max(0.0001, b.it.w || 1)), sum = ws.reduce((a, b) => a + b, 0);
      const minR = o.minR || (W < 520 ? 14 : 17), maxR = Math.min(W, H) * (o.maxFrac || 0.38);
      let k = Math.sqrt((o.fill || 0.58) * W * H / (Math.PI * sum));
      for (let it = 0; it < 4; it++) {
        let area = 0;
        bodies.forEach((b, i) => { b.r = clamp(k * Math.sqrt(ws[i]), minR, maxR); area += Math.PI * b.r * b.r; });
        const want = (o.fill || 0.58) * W * H;
        k *= Math.sqrt(want / area);
      }
      bodies.forEach(b => {
        b.s0 = clamp(26 * Math.sqrt(30 / b.r), 8, 34);
        if (b.el) { b.el.style.width = b.el.style.height = (b.r * 2) + 'px'; b.el.firstChild.innerHTML = (o.inner ? o.inner(b.it, b.r) : ''); }
      });
      if (!keepPos) bodies.forEach(b => {
        b.x = b.r + Math.random() * Math.max(1, W - 2 * b.r); b.y = b.r + Math.random() * Math.max(1, H - 2 * b.r);
        b.vx = 0; b.vy = 0;
      });
      relax(keepPos ? 30 : 260);
    }

    /* push overlapping circles apart (used for the first layout and after resizes) */
    function relax(iter) {
      for (let k = 0; k < iter; k++) {
        let moved = false;
        for (let i = 0; i < n; i++) {
          const a = bodies[i];
          a.x = clamp(a.x, a.r, Math.max(a.r, W - a.r)); a.y = clamp(a.y, a.r, Math.max(a.r, H - a.r));
          for (let j = i + 1; j < n; j++) {
            const b = bodies[j], dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r + 2, d2 = dx * dx + dy * dy;
            if (d2 < min * min) {
              const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d, ov = (min - d) * 0.5, ma = a.r * a.r, mb = b.r * b.r, t = ma + mb;
              a.x -= nx * ov * 2 * mb / t; a.y -= ny * ov * 2 * mb / t; b.x += nx * ov * 2 * ma / t; b.y += ny * ov * 2 * ma / t; moved = true;
            }
          }
        }
        if (!moved && k > 8) break;
      }
    }

    /* DOM */
    bodies.forEach(b => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'nb-b'; el.dataset.i = b.i;
      el.setAttribute('aria-label', b.it.aria || b.it.label || 'bubble');
      el.innerHTML = '<span class="nb-i"></span>';
      el.firstChild.style.setProperty('--d', Math.min(b.i * 22, 700) + 'ms');
      stage.append(el); b.el = el;
    });
    sizeAll(false);
    bodies.forEach(b => { b.el.firstChild.innerHTML = o.inner ? o.inner(b.it, b.r) : ''; });
    draw();

    function draw() {
      for (const b of bodies) b.el.style.transform = 'translate3d(' + (b.x - b.r).toFixed(2) + 'px,' + (b.y - b.r).toFixed(2) + 'px,0)';
      if (tipBody) placeTip(tipBody);
    }

    /* ------------------------------------------------ step */
    function step(dt, t) {
      /* no idle drift: bubbles only move when the user moves them, then glide to a stop */
      const damp = Math.exp(-1.7 * dt);
      for (const b of bodies) {
        if (b.drag) continue;
        b.vx *= damp; b.vy *= damp;
        const sp = Math.hypot(b.vx, b.vy); if (sp > 700) { b.vx *= 700 / sp; b.vy *= 700 / sp; }
      }
      /* the pointer gently pushes bubbles aside */
      if (pointer && !grab && performance.now() - pointer.t < 120) for (const b of bodies) {
        const dx = b.x - pointer.x, dy = b.y - pointer.y, d = Math.hypot(dx, dy) || 1, gap = d - b.r;
        if (gap < 46) { const f = (1 - Math.max(0, gap) / 46) * 520 * dt; b.vx += dx / d * f; b.vy += dy / d * f; }
      }
      for (const b of bodies) {
        if (b.drag) {
          const tx = clamp(grab.x - grab.ox, b.r, W - b.r), ty = clamp(grab.y - grab.oy, b.r, H - b.r), k = Math.min(1, dt * 22);
          const nx = b.x + (tx - b.x) * k, ny = b.y + (ty - b.y) * k;
          b.vx = b.vx * 0.6 + ((nx - b.x) / Math.max(dt, 0.001)) * 0.4; b.vy = b.vy * 0.6 + ((ny - b.y) / Math.max(dt, 0.001)) * 0.4;
          b.x = nx; b.y = ny; continue;
        }
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.9; } else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.9; }
        if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.9; } else if (b.y + b.r > H) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.9; }
      }
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
        const a = bodies[i];
        for (let j = i + 1; j < n; j++) {
          const b = bodies[j], dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r + 1.5, d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d, ov = min - d;
          const ma = a.drag ? 1e9 : a.r * a.r, mb = b.drag ? 1e9 : b.r * b.r, t = ma + mb;
          a.x -= nx * ov * mb / t; a.y -= ny * ov * mb / t; b.x += nx * ov * ma / t; b.y += ny * ov * ma / t;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) {
            const imp = -(1 + 0.86) * vn / (1 / ma + 1 / mb);
            if (!a.drag) { a.vx -= imp * nx / ma; a.vy -= imp * ny / ma; }
            if (!b.drag) { b.vx += imp * nx / mb; b.vy += imp * ny / mb; }
          }
        }
      }
    }

    let awake = false;
    function loop(ts) {
      raf = 0;
      if (dead) return;
      if (!stage.isConnected) { destroy(); return; }
      const dt = Math.min(0.034, (ts - last) / 1000 || 0.016); last = ts;
      step(dt, ts / 1000); draw();
      let maxSp = 0; for (const b of bodies) { const sp = Math.hypot(b.vx, b.vy); if (sp > maxSp) maxSp = sp; }
      const active = grab || (pointer && performance.now() - pointer.t < 150);
      if (!active && maxSp < 3) { bodies.forEach(b => { b.vx = b.vy = 0; }); awake = false; return; }   /* everything is still: sleep */
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf && !dead && awake && !RM.matches && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } }
    function wake() { awake = true; start(); }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

    /* ------------------------------------------------ tooltip / popover */
    function placeTip(b) {
      const w = tip.offsetWidth || 120, h = tip.offsetHeight || 30;
      let x = clamp(b.x - w / 2, 6, W - w - 6), y = b.y - b.r - h - 8;
      if (y < 6) y = Math.min(H - h - 6, b.y + b.r + 8);
      tip.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
    }
    function showTip(b, pin) {
      if (!o.tip) return;
      tipBody = b; tip.innerHTML = o.tip(b.it); tip.hidden = false; tip.classList.toggle('pin', !!pin); tip.style.pointerEvents = pin ? 'auto' : 'none';
      bodies.forEach(x => x.el.classList.toggle('sel', pin && x === b)); if (pin) pinned = b; placeTip(b);
    }
    function hideTip(force) {
      if (pinned && !force) return;
      pinned = null; tipBody = null; tip.hidden = true; bodies.forEach(x => x.el.classList.remove('sel'));
    }

    /* ------------------------------------------------ pointer: drag, fling, repel, tap */
    const local = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function onDown(e) {
      if (e.target.closest('.nb-tip')) return;
      const p = local(e), bEl = e.target.closest('.nb-b'), b = bEl && bodies[+bEl.dataset.i];
      pointer = { x: p.x, y: p.y, t: performance.now() };
      wake();
      if (!b) { if (e.pointerType !== 'mouse') for (const x of bodies) { const dx = x.x - p.x, dy = x.y - p.y, d = Math.hypot(dx, dy) || 1; if (d < 130) { const f = (1 - d / 130) * 220; x.vx += dx / d * f; x.vy += dy / d * f; } } hideTip(true); return; }
      if (RM.matches) { grab = { b, t0: performance.now(), sx: p.x, sy: p.y, moved: false, still: true }; return; }
      grab = { b, x: p.x, y: p.y, ox: p.x - b.x, oy: p.y - b.y, t0: performance.now(), sx: p.x, sy: p.y, moved: false };
      b.drag = true; try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      stage.classList.add('nbx-grabbing');
    }
    function onMove(e) {
      const p = local(e);
      if (grab) pointer = null; else if (e.pointerType === 'mouse') { pointer = { x: p.x, y: p.y, t: performance.now() }; wake(); }
      if (grab) {
        if (grab.still) return;
        grab.x = p.x; grab.y = p.y; wake();
        if (Math.hypot(p.x - grab.sx, p.y - grab.sy) > 6) grab.moved = true;
        return;
      }
      if (e.pointerType === 'mouse' && o.tip && o.tipOn !== 'tap' && !pinned) {
        const bEl = e.target.closest && e.target.closest('.nb-b'), b = bEl && bodies[+bEl.dataset.i];
        if (b) { if (tipBody !== b) showTip(b, false); } else hideTip(false);
      }
    }
    function onUp(e) {
      if (!grab) return;
      const g = grab, b = g.b; grab = null; b.drag = false; stage.classList.remove('nbx-grabbing');
      try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
      const tap = !g.moved && performance.now() - g.t0 < 450;
      if (tap) {
        if (o.onTap && o.onTap(b.it) === true) return;
        if (pinned === b) hideTip(true); else showTip(b, true);
        /* a tap also gives the bubble a little nudge */
        if (!RM.matches) { const a = Math.random() * 6.283; b.vx += Math.cos(a) * 60; b.vy += Math.sin(a) * 60; wake(); }
      } else if (!g.still) { const sp = Math.hypot(b.vx, b.vy); if (sp > 700) { b.vx *= 700 / sp; b.vy *= 700 / sp; } wake(); }
    }
    function onCancel() { if (grab) { grab.b.drag = false; grab = null; stage.classList.remove('nbx-grabbing'); } pointer = null; }
    function onLeave(e) { if (e.pointerType === 'mouse') { pointer = null; if (!pinned) hideTip(false); } }
    function onKey(e) {
      const bEl = e.target.closest && e.target.closest('.nb-b'); if (!bEl || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); const b = bodies[+bEl.dataset.i]; if (o.onTap && o.onTap(b.it) === true) return; pinned === b ? hideTip(true) : showTip(b, true);
    }
    const outside = e => { if (pinned && !stage.contains(e.target)) hideTip(true); };
    stage.addEventListener('pointerdown', onDown); stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onCancel); stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('keydown', onKey); stage.addEventListener('dragstart', e => e.preventDefault());
    document.addEventListener('pointerdown', outside, true);
    /* scrolling the page makes the bubbles sway (they lag behind the page a little) */
    const lastScroll = new WeakMap();
    if (document.scrollingElement) lastScroll.set(document.scrollingElement, document.scrollingElement.scrollTop);
    const onScroll = e => {
      if (RM.matches || !visible) return;
      const t = e.target === document ? document.scrollingElement : e.target; if (!t || t.scrollTop == null) return;
      const prev = lastScroll.get(t), cur = t.scrollTop; lastScroll.set(t, cur);
      if (prev == null) return;
      const dy = clamp(cur - prev, -60, 60); if (Math.abs(dy) < 1) return;
      bodies.forEach(b => { if (!b.drag) b.vy += dy * 0.45 * (28 / b.r + 0.4); });
      wake();
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });

    /* ------------------------------------------------ lifecycle */
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { visible = es[0].isIntersecting; visible ? (awake && start()) : stop(); }, { rootMargin: '80px' }) : null;
    io && io.observe(stage);
    let rw = W;
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => {
      const nw = stage.clientWidth; if (!nw || Math.abs(nw - rw) < 2) return;
      const sx = nw / rw; rw = nw; W = nw; bodies.forEach(b => { b.x *= sx; }); sizeAll(true); draw(); if (awake) start();
    }) : null;
    ro && ro.observe(stage);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', vis);

    function destroy() {
      if (dead) return; dead = true; stop(); io && io.disconnect(); ro && ro.disconnect();
      document.removeEventListener('visibilitychange', vis); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', onScroll, true);
      stage._nb = null;
    }
    stage._nb = { destroy };
    return stage._nb;
  }

  /* ================================================================ bubble content */
  const GRAD = h => 'linear-gradient(145deg,hsl(' + h + ' 72% 58%),hsl(' + ((h + 38) % 360) + ' 70% 40%))';
  const initials = s => { const w = String(s || '?').trim().split(/\s+/).filter(Boolean); return ((w[0] || '?')[0] + (w.length > 1 ? w[1][0] : '')).toUpperCase(); };

  function channelInner(it, r) {
    const h = hueOf(it.label), bg = isUrl(it.img) ? '' : 'background:' + GRAD(h);
    const img = isUrl(it.img) ? '<img src="' + esc(it.img) + '" alt="" draggable="false" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">' : '';
    let txt = '';
    if (r >= 38) txt = '<span class="nb-name" style="font-size:' + clamp(r * 0.27, 10, 19).toFixed(1) + 'px">' + esc(it.label) + '</span>';
    else if (r >= 17) txt = '<span class="nb-ini" style="font-size:' + clamp(r * 0.62, 9, 15).toFixed(1) + 'px">' + esc(initials(it.label)) + '</span>';
    return '<span class="nb-fill" style="' + bg + '">' + img + (img && txt ? '<span class="nb-shade"></span>' : '') + txt + '</span>';
  }
  function friendInner(it, r) {
    const h = hueOf(it.label);
    if (isUrl(it.img)) return '<span class="nb-fill"><img src="' + esc(it.img) + '" alt="" draggable="false" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()"></span>';
    return '<span class="nb-fill" style="background:' + GRAD(h) + '"><span class="nb-ini" style="font-size:' + clamp(r * 0.7, 10, 34).toFixed(1) + 'px">' + esc(initials(it.label)) + '</span></span>';
  }

  /* ================================================================ stage builders */
  function initStage(el) {
    el.setAttribute('data-nb-on', '1');
    let data = [];
    try { data = JSON.parse(el.getAttribute('data-nb-items') || '[]'); } catch (_) {}
    if (!data.length) return;
    const kind = el.getAttribute('data-nb');
    if (kind === 'channels') {
      const items = data.map(c => ({ label: c.name, img: c.thumb, w: Math.pow(Math.max(1, +c.n || 1), 0.72), n: +c.n || 1, aria: c.name }));
      mount(el, items, {
        inner: channelInner, fill: 0.6, tipOn: 'both',
        tip: it => '<b>' + esc(it.label) + '</b><small>' + it.n + (it.n === 1 ? ' watch' : ' watches') + '</small>'
      });
    } else if (kind === 'friends') {
      const visitor = el.hasAttribute('data-nb-visitor');
      const items = data.map((u, i) => ({ id: u.id, label: u.name, username: u.username, img: u.avatar, w: Math.max(0.1, 1 - i * 0.085), aria: u.name }));
      mount(el, items, {
        inner: friendInner, fill: 0.56, tipOn: 'tap', maxFrac: 0.3, minR: 22,
        tip: it => '<b>' + esc(it.label) + '</b>' + (it.username ? '<small>@' + esc(it.username) + '</small>' : '') +
          '<span class="nb-tip-acts">' + (visitor ? '' : '<button type="button" class="nb-tip-btn pri" data-open-friend="' + esc(it.id) + '">Message</button>') + '<button type="button" class="nb-tip-btn" data-go="user/' + esc(it.id) + '"' + (visitor ? '' : '') + '>Profile</button></span>'
      });
    }
  }
  let pending = 0;
  function scan() {
    pending = 0;
    document.querySelectorAll('.nbx-stage[data-nb]:not([data-nb-on])').forEach(initStage);
  }
  const queue = () => { if (!pending) pending = requestAnimationFrame(scan); };
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', scan) : scan();

  /* ================================================================ rings (Interests) */
  const GENRE_ICON = { Music: '🎵', Drama: '🎭', Comedy: '😄', Entertainment: '🎭', Horror: '👻', Thriller: '🔪', Fantasy: '✨', Action: '💥', Animation: '🎞', 'Sci-Fi': '🚀', Romance: '💗', Crime: '🕵', 'People & Blogs': '🎥' };
  const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  function ringHTML(title, list, o) {
    o = o || {};
    list = (list || []).filter(x => x && x.n > 0);
    if (!list.length) return '';
    const total = list.reduce((a, b) => a + b.n, 0) || 1;
    const W = 480, H = 340, cx = 240, cy = 170, R = 100, r = 62;
    let ang = -Math.PI / 2;
    const segs = list.map((x, i) => {
      const sweep = x.n / total * Math.PI * 2, a0 = ang, a1 = ang + sweep; ang = a1;
      return { x, i, a0, a1, mid: (a0 + a1) / 2, pct: Math.round(x.n / total * 100) };
    });
    const path = s => {
      const sw = Math.min(s.a1 - s.a0, Math.PI * 2 - 0.0001), big = sw > Math.PI ? 1 : 0;
      const [x0, y0] = polar(cx, cy, R, s.a0), [x1, y1] = polar(cx, cy, R, s.a0 + sw), [x2, y2] = polar(cx, cy, r, s.a0 + sw), [x3, y3] = polar(cx, cy, r, s.a0);
      return 'M' + x0 + ' ' + y0 + 'A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + 'A' + r + ' ' + r + ' 0 ' + big + ' 0 ' + x3 + ' ' + y3 + 'Z';
    };
    /* label columns, pushed apart so they never overlap */
    const side = { 1: [], '-1': [] };
    segs.forEach(s => { s.side = Math.cos(s.mid) >= 0 ? 1 : -1; s.ly = polar(cx, cy, R + 18, s.mid)[1]; side[s.side].push(s); });
    [1, -1].forEach(k => {
      const col = side[k].sort((a, b) => a.ly - b.ly), gap = 21;
      for (let i = col.length - 1; i >= 0; i--) col[i].ly = Math.min(col[i].ly, i === col.length - 1 ? H - 12 : col[i + 1].ly - gap);
      for (let i = 0; i < col.length; i++) col[i].ly = Math.max(col[i].ly, i ? col[i - 1].ly + gap : 12);
    });
    const hue0 = o.hue == null ? 176 : o.hue;
    const fill = i => 'hsl(' + (hue0 + (i * 17) % 44) + ' ' + (30 + (i % 3) * 7) + '% ' + (48 + ((i * 11) % 30)) + '%)';
    let out = '<svg class="nb-ring" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + ' breakdown">';
    out += '<g class="nb-ring-g">';
    segs.forEach(s => {
      out += '<path class="nb-seg" d="' + path(s) + '" fill="' + fill(s.i) + '" style="--d:' + (s.i * 55) + 'ms;transform-origin:' + cx + 'px ' + cy + 'px"><title>' + esc(s.x.name) + ' — ' + s.pct + '%</title></path>';
    });
    out += '</g>';
    segs.forEach(s => {
      const [ax, ay] = polar(cx, cy, R + 1, s.mid), [ex, ey] = polar(cx, cy, R + 16, s.mid), lx = cx + s.side * (R + 46);
      out += '<g class="nb-lab" style="--d:' + (500 + s.i * 55) + 'ms"><polyline points="' + ax.toFixed(1) + ',' + ay.toFixed(1) + ' ' + ex.toFixed(1) + ',' + ey.toFixed(1) + ' ' + (lx - s.side * 6) + ',' + s.ly.toFixed(1) + '"/>' +
        '<text x="' + lx + '" y="' + (s.ly + 4.5).toFixed(1) + '" text-anchor="' + (s.side > 0 ? 'start' : 'end') + '">' + esc(s.x.name) + '</text></g>';
      if (s.a1 - s.a0 > 0.38 && (o.icons || GENRE_ICON)[s.x.name]) {
        const [tx, ty] = polar(cx, cy, (R + r) / 2, s.mid);
        out += '<text class="nb-ico" x="' + tx.toFixed(1) + '" y="' + (ty + 6).toFixed(1) + '" text-anchor="middle">' + (o.icons || GENRE_ICON)[s.x.name] + '</text>';
      }
    });
    out += '<text class="nb-ring-title" x="' + cx + '" y="' + (cy + 8) + '" text-anchor="middle">' + esc(title) + '</text></svg>';
    return out;
  }

  window.NovaBubbles = { mount, ringHTML, scan };
})();
