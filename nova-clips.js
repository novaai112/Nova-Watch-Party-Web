/* nova-clips.js — "Nova Clips" section of the attachment picker (friends chat AND watch room).
   Needs nova-clips-data.js (window.NOVA_CLIPS = { base, files }) — built from the Cloudflare Pages folder by tools/build-clips-data.js.

   The panel is an 8-column grid. Every tile is ONLY a looping preview plus one transparent speaker icon.
   Tap a tile to attach it like a photo. Previews load lazily (only tiles in view, a few at a time) so 290+ videos stay light.
   Sound: on by default — one tile is audible at a time (the first one in view), tap another tile's speaker to move the sound there,
   tap the speaker of the audible tile to mute. */
(function () {
  'use strict';
  const D = window.NOVA_CLIPS;
  if (!D || !Array.isArray(D.files) || !D.files.length) return;

  const CONCURRENT = 6;         /* previews downloading at once */
  const PREVIEW_SECONDS = 6;    /* each preview loops its first N seconds (keeps downloads small) */

  const SVG_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.6l4.9 4V5.5l-4.9 4H4z" fill="currentColor"/><path d="M15.8 8.6a4.8 4.8 0 0 1 0 6.8M18.4 6a8.4 8.4 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const SVG_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.6l4.9 4V5.5l-4.9 4H4z" fill="currentColor"/><path d="M16 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const SVG_BACK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_X = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  const urlOf = i => D.base + encodeURIComponent(D.files[i]);
  const dateOf = i => (D.files[i].match(/\d{4}-\d{2}-\d{2}/) || [''])[0];

  /* ---- state of the one open grid ---- */
  let io = null, grid = null, ctxRoom = false;
  let queue = [], loading = new Set();
  let audible = null;          /* tile that currently has sound */
  let userMuted = false;       /* the person muted the audible tile on purpose: stay silent */
  let autoChosen = true;       /* sound was given automatically (not picked by the person): the earliest tile in view keeps it */
  let audioBlocked = false;    /* the browser refused sound: stay muted until a tap */

  const vid = t => t.querySelector('video');

  function paintSnd(t, on) {
    const b = t.querySelector('.nclip-snd');
    if (!b) return;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Mute clip' : 'Unmute clip');
    b.innerHTML = on ? SVG_ON : SVG_OFF;
  }

  function setAudio(t) {
    if (audible && audible !== t) { const pv = vid(audible); if (pv) pv.muted = true; paintSnd(audible, false); }
    audible = t || null;
    if (!t) return;
    const v = vid(t);
    v.muted = false; paintSnd(t, true);
    if (v.paused) v.play().catch(() => blocked(t));
    else setTimeout(() => { if (audible === t && v.paused) blocked(t); }, 250);
  }
  function blocked(t) {
    audioBlocked = true;
    const v = vid(t); v.muted = true; v.play().catch(() => {});
    if (audible === t) audible = null;
    paintSnd(t, false);
  }
  /* sound follows the person's scrolling: when the audible tile leaves, the first playing tile takes over */
  function autoPick() {
    if (userMuted || audioBlocked || audible) return;
    const next = grid && [...grid.querySelectorAll('.nclip.playing')][0];
    if (next) { autoChosen = true; setAudio(next); }
  }

  /* ---- lazy loading ---- */
  function enqueue(t) { if (t._s !== 'idle') return; t._s = 'queued'; queue.push(t); pump(); }
  function pump() {
    while (loading.size < CONCURRENT && queue.length) {
      const t = queue.shift();
      if (t.isConnected && t._s === 'queued') start(t);
    }
  }
  function start(t) {
    t._s = 'loading'; loading.add(t);
    const v = vid(t);
    v.muted = true; v.loop = true; v.preload = 'auto';
    v.src = urlOf(+t.dataset.clip);
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { if (loading.delete(t)) pump(); }, 10000);
  }
  function release(t) {
    queue = queue.filter(x => x !== t);
    clearTimeout(t._timer);
    if (t._s === 'loading' || t._s === 'playing') {
      const v = vid(t);
      try { v.pause(); } catch (_) {}
      v.removeAttribute('src'); try { v.load(); } catch (_) {}
    }
    loading.delete(t);
    t.classList.remove('ready', 'playing');
    if (t._s !== 'failed') t._s = 'idle';
    if (audible === t) { audible = null; paintSnd(t, false); }
    pump(); autoPick();
  }

  function onVideoEvent(e) {
    const v = e.target, t = v.closest && v.closest('.nclip');
    if (!t || !t.isConnected) return;
    if (e.type === 'loadeddata') {
      if (t._s !== 'loading') return;
      loading.delete(t); clearTimeout(t._timer); t.classList.add('ready');
      v.play().catch(() => {});
      pump();
    } else if (e.type === 'playing') {
      t._s = 'playing'; t.classList.add('playing');
      if (!audible) autoPick();
      else if (autoChosen && audible !== t && (t.compareDocumentPosition(audible) & Node.DOCUMENT_POSITION_FOLLOWING)) setAudio(t);
    } else if (e.type === 'timeupdate') {
      if (v.currentTime >= PREVIEW_SECONDS) v.currentTime = 0;
    } else if (e.type === 'error') {
      if (!v.getAttribute('src')) return;
      loading.delete(t); clearTimeout(t._timer); t._s = 'failed'; t.classList.add('fail'); t.classList.remove('ready', 'playing');
      if (audible === t) { audible = null; paintSnd(t, false); }
      pump(); autoPick();
    }
  }

  function teardown() {
    if (io) { io.disconnect(); io = null; }
    queue = []; loading = new Set(); audible = null; grid = null;
    userMuted = false; audioBlocked = false; autoChosen = true;
  }

  /* ---- build the panel ---- */
  function open(picker) {
    teardown();
    ctxRoom = !!picker.closest('#rm');
    picker.classList.add('provider-open');
    const menu = picker.querySelector('#mediaMenu'); if (menu) menu.hidden = true;
    const contact = picker.querySelector('#mediaContactPicker'); if (contact) contact.hidden = true;
    const panel = picker.querySelector('#mediaProviderPanel'); if (!panel) return;
    panel.hidden = false;
    const tiles = D.files.map((f, i) =>
      `<div class="nclip" data-clip="${i}" role="button" tabindex="0" aria-label="Attach Nova Clip ${esc(dateOf(i))}"><video muted loop playsinline disablepictureinpicture disableremoteplayback preload="none"></video><button type="button" class="nclip-snd" data-clip-snd>${SVG_OFF}</button><i class="nclip-ok" aria-hidden="true"></i></div>`).join('');
    panel.innerHTML = `<div class="media-provider-head"><button class="media-back" data-media-back aria-label="Back to attachments">${SVG_BACK}</button><b>Nova Clips</b><button class="media-close" data-close-media aria-label="Close attachment picker">${SVG_X}</button></div>
      <div id="novaClipsScroll" class="media-results-scroll nclips-scroll" role="region" aria-label="Nova Clips"><div class="nclips-grid">${tiles}</div></div>`;
    grid = panel.querySelector('.nclips-grid');
    grid.querySelectorAll('.nclip').forEach(t => { t._s = 'idle'; });
    ['loadeddata', 'playing', 'timeupdate', 'error'].forEach(ev => grid.addEventListener(ev, onVideoEvent, true));
    io = new IntersectionObserver(entries => {
      for (const en of entries) en.isIntersecting ? enqueue(en.target) : release(en.target);
    }, { root: panel.querySelector('#novaClipsScroll'), rootMargin: '60px 0px', threshold: 0.01 });
    grid.querySelectorAll('.nclip').forEach(t => io.observe(t));
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  /* ---- attach (same path as a photo from the picker) ---- */
  function attach(t) {
    const i = +t.dataset.clip, api = ctxRoom ? window.NovaRoomMedia : window.NovaChatPicker;
    if (!api || !api.addRemote) return;
    const before = api.count ? api.count() : (api.hooks ? api.hooks.count() : 0);
    api.addRemote(urlOf(i), 'video/mp4', `Nova Clip ${dateOf(i)}.mp4`, {});
    const after = api.count ? api.count() : (api.hooks ? api.hooks.count() : 0);
    if (after > before) t.classList.add('added');
  }

  /* ---- events ---- */
  document.addEventListener('click', e => {
    const openBtn = e.target.closest('[data-nova-clips]');
    if (openBtn) { const p = openBtn.closest('#chatMediaPicker'); if (p) { e.preventDefault(); open(p); } return; }
    const snd = e.target.closest('[data-clip-snd]');
    if (snd) {
      e.preventDefault(); e.stopPropagation();
      const t = snd.closest('.nclip');
      if (t === audible) { userMuted = true; const v = vid(t); v.muted = true; paintSnd(t, false); audible = null; }
      else { userMuted = false; audioBlocked = false; autoChosen = false; setAudio(t); }
      return;
    }
    const tile = e.target.closest('.nclip');
    if (tile && grid && grid.contains(tile)) attach(tile);
  }, true);

  /* ---- speaker on video bubbles (friends chat): tap = sound on / off, one video audible at a time, never opens the viewer ---- */
  const bubbleSnd = (btn, on) => {
    btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', on ? 'Mute video' : 'Unmute video');
    btn.innerHTML = on ? SVG_ON : SVG_OFF;
  };
  function toggleBubble(btn) {
    const tile = btn.closest('.nc-tile,.rm-tile'), v = tile && tile.querySelector('video');
    if (!v) return;
    if (v.muted) {
      document.querySelectorAll('.nc-tile .nc-snd[aria-pressed="true"],.rm-tile .nc-snd[aria-pressed="true"]').forEach(o => { const ov = o.closest('.nc-tile,.rm-tile').querySelector('video'); if (ov) ov.muted = true; bubbleSnd(o, false); });
      v.muted = false; bubbleSnd(btn, true);
      if (v.paused) v.play().catch(() => { v.muted = true; bubbleSnd(btn, false); v.play().catch(() => {}); });
      else setTimeout(() => { if (v.paused) { v.muted = true; bubbleSnd(btn, false); v.play().catch(() => {}); } }, 250);
    } else { v.muted = true; bubbleSnd(btn, false); }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-nc-snd]');
    if (b) { e.preventDefault(); e.stopPropagation(); toggleBubble(b); }
  }, true);
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-nc-snd]')) { e.preventDefault(); e.stopPropagation(); toggleBubble(e.target); }
  }, true);

  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('nclip')) { e.preventDefault(); attach(e.target); }
  });
  /* stop everything the moment the page is hidden */
  document.addEventListener('visibilitychange', () => {
    if (!grid) return;
    grid.querySelectorAll('.nclip.playing video').forEach(v => document.hidden ? v.pause() : v.play().catch(() => {}));
  });

  window.NovaClips = { count: D.files.length, open, urlOf };
})();
