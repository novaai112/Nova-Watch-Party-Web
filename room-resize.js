/* Laptop / monitor only: drag the left wall of the chat card to resize video <-> chat.
   - drag left  : chat grows, video shrinks.  Video too small  -> the video hides (chat only) and the "Show player" icon brings it back.
   - drag right : chat shrinks.               Chat too small   -> the video goes full screen.
   - double-click / Home resets; arrow keys resize.  The size is remembered (as a share of the width, so it survives window resizes). */
(function () {
  'use strict';
  var KEY = 'nova.split', MIN_CHAT = 280, MIN_VIDEO = 280, ratio = null, dr = null, raf = 0, handle = null;
  var mq = window.matchMedia('(min-width:900px) and (hover:hover) and (pointer:fine)');
  try { var s = parseFloat(localStorage.getItem(KEY)); if (s > 0.1 && s < 0.9) ratio = s; } catch (e) {}
  var $ = function (q) { return document.querySelector(q); };
  var body = function () { return $('#rm .rbody'); };
  function on() { var rm = $('#rm'); return !!(rm && mq.matches && !rm.classList.contains('rm-compact') && !rm.classList.contains('pl-hidden')); }
  function metrics(b) {
    var cs = getComputedStyle(b), gap = parseFloat(cs.columnGap) || 16, pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
    return { gap: gap, pl: pl, pr: pr, A: b.clientWidth - pl - pr - gap };            /* A = video + chat */
  }
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  function setCols(b, w) { b.style.gridTemplateColumns = w == null ? '' : 'minmax(0,1fr) ' + Math.round(w) + 'px'; }
  function place() {
    var b = body(), h = handle; if (!b || !h) return;
    var sc = b.querySelector('.scol'); if (!on() || !sc) { h.hidden = true; return; }
    var m = metrics(b); h.hidden = false;
    h.style.left = Math.round(sc.offsetLeft - m.gap / 2 - h.offsetWidth / 2) + 'px';
    h.style.top = sc.offsetTop + 'px'; h.style.height = sc.offsetHeight + 'px';
    var w = sc.offsetWidth; h.setAttribute('aria-valuenow', String(Math.round(w))); h.setAttribute('aria-valuetext', 'Chat ' + Math.round(w) + ' pixels wide');
  }
  function apply() {
    var b = body(); if (!b) return;
    if (!on() || ratio == null) setCols(b, null);
    else { var m = metrics(b); setCols(b, clamp(m.A * ratio, MIN_CHAT, Math.max(MIN_CHAT, m.A - MIN_VIDEO))); }
    place(); refit();
  }
  function refit() { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }   /* the player re-fits itself to its new column */
  function save() { try { if (ratio == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(ratio)); } catch (e) {} }

  function mount() {
    var b = body(); if (!b) return;
    if (!b.querySelector('.rsz')) {
      var h = document.createElement('div'); h.className = 'rsz'; h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', 'vertical');
      h.setAttribute('aria-label', 'Resize video and chat'); h.setAttribute('tabindex', '0'); h.title = 'Drag to resize \u00b7 double-click to reset'; h.innerHTML = '<i></i>';
      b.appendChild(h); h.addEventListener('pointerdown', down); h.addEventListener('keydown', key); h.addEventListener('dblclick', reset);
    }
    handle = b.querySelector('.rsz');
    if (window.ResizeObserver && !b._rso) { b._rso = new ResizeObserver(function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); }); b._rso.observe(b); var sc = b.querySelector('.scol'); if (sc) b._rso.observe(sc); }
    apply();
  }
  function reset() { ratio = null; save(); apply(); }
  function down(e) {
    if (e.button !== 0 || !on()) return;
    var b = body(), m = metrics(b); e.preventDefault();
    dr = { b: b, m: m, rect: b.getBoundingClientRect(), id: e.pointerId, w: null, zone: '', prev: ratio };
    try { handle.setPointerCapture(e.pointerId); } catch (x) {}
    handle.classList.add('drag'); document.documentElement.classList.add('rsz-drag');
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  }
  function move(e) {
    var d = dr; if (!d || e.pointerId !== d.id) return;
    var right = d.rect.right - d.m.pr;                                   /* chat's right edge */
    var w = clamp(right - e.clientX - d.m.gap / 2, 120, d.m.A - 120);    /* the cursor sits in the middle of the gap */
    d.w = w; d.zone = w < MIN_CHAT ? 'full' : (d.m.A - w < MIN_VIDEO ? 'hide' : '');
    cancelAnimationFrame(raf); raf = requestAnimationFrame(function () {
      setCols(d.b, w); place();
      handle.dataset.hint = d.zone === 'full' ? 'Release for full screen video' : d.zone === 'hide' ? 'Release to hide the video' : '';
    });
  }
  function up(e) {
    var d = dr; if (!d || (e && e.pointerId !== d.id)) return; dr = null;
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
    try { handle.releasePointerCapture(d.id); } catch (x) {}
    handle.classList.remove('drag'); handle.dataset.hint = ''; document.documentElement.classList.remove('rsz-drag');
    cancelAnimationFrame(raf);
    if (e && e.type === 'pointercancel') { ratio = d.prev; apply(); return; }
    if (d.zone === 'full') { ratio = d.prev; apply(); if (window.NovaPlayer && NovaPlayer.enterFs) NovaPlayer.enterFs(); return; }
    if (d.zone === 'hide') { ratio = d.prev; apply(); if (window.NovaRoom && NovaRoom.hidePlayer) NovaRoom.hidePlayer(true); return; }
    if (d.w != null) { ratio = d.w / d.m.A; save(); }
    apply();
  }
  function key(e) {
    var b = body(); if (!b || !on()) return; var m = metrics(b), sc = b.querySelector('.scol'), cur = sc ? sc.offsetWidth : m.A * 0.4, step = Math.max(24, m.A * 0.03), w = null;
    if (e.key === 'ArrowLeft') w = cur + step; else if (e.key === 'ArrowRight') w = cur - step; else if (e.key === 'Home') { e.preventDefault(); return reset(); } else return;
    e.preventDefault(); w = clamp(w, MIN_CHAT, m.A - MIN_VIDEO); ratio = w / m.A; save(); apply();
  }
  window.addEventListener('resize', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { var b = body(); if (b && !dr) { if (!b.querySelector('.rsz')) mount(); else apply2(); } }); });
  function apply2() { var b = body(); if (!b) return; if (!on() || ratio == null) setCols(b, null); else { var m = metrics(b); setCols(b, clamp(m.A * ratio, MIN_CHAT, Math.max(MIN_CHAT, m.A - MIN_VIDEO))); } place(); }   /* no re-dispatch: avoids a resize loop */
  window.NovaSplit = { mount: mount, reset: reset, ratio: function () { return ratio; } };
})();
