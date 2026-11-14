/* room-player.js — Nova watch-room video player (controls drawn over the video frame).
 *
 * What it adds on top of room.js (which keeps owning playback + sync):
 *   · top-right glass buttons: Full screen / Like / ⋮ menu
 *   · ⋮ menu (one glass card): Hide Player · Video Details · Playback Speed · Video Quality · Subtitles
 *   · centre ⟲15 ▶/❚❚ 15⟳ + timeline + "playing / total" time  — interactive for the ROOM ADMIN only
 *   · double-tap left / right side = −15 s / +15 s (admin only)
 *   · the video name is shown above the timeline only while full screen is on
 *
 * room.js hands this file a small bridge object through NovaPlayer.init(host); everything here is UI.
 */
(function () {
'use strict';
let H = null, wrap = null, ui = null, gz = null, ro = null, loop = 0;
const S = { menu: '', vis: true, act: 0, fs: false, pfs: false, drag: false, key: '',
  tapT: 0, last: null, chain: 0, seekAt: 0, seekDir: 0, seekAcc: 0, seekBase: 0,
  qsel: 'auto', subSel: 'off', subTried: false, toastT: 0 };
const $ = (s, r) => (r || document).querySelector(s);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const SEEK = 15, HIDE_AFTER = 3200, DBL = 280;

/* ---------- icons (24 × 24, drawn with the current colour) ---------- */
const svg = (body, o) => `<svg viewBox="0 0 24 24" width="${(o && o.s) || 24}" height="${(o && o.s) || 24}" fill="${(o && o.fill) || 'none'}" stroke="currentColor" stroke-width="${(o && o.w) || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const NUM = '<text x="12" y="15.4" text-anchor="middle" font-size="8.2" font-weight="700" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" fill="currentColor" stroke="none">15</text>';
const I = {
  fs: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  fsx: svg('<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M16 21v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>'),
  like: svg('<path d="M7 10v12"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"/>'),
  more: svg('<circle cx="12" cy="5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="19" r="1.7" fill="currentColor"/>'),
  play: svg('<path d="M8.2 4.9v14.2a1 1 0 0 0 1.5.86l11.6-7.1a1 1 0 0 0 0-1.72L9.7 4.04a1 1 0 0 0-1.5.86z" fill="currentColor" stroke-width="1.2"/>'),
  pause: svg('<rect x="5.5" y="4" width="4.6" height="16" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.4" fill="currentColor" stroke="none"/>'),
  back: svg('<path d="M5.5 7.5A8.5 8.5 0 1 0 12 4.5"/><path d="M15.3 1.9 12 4.5l3.3 2.6"/>' + NUM, { w: 1.9 }),
  fwd: svg('<path d="M18.5 7.5A8.5 8.5 0 1 1 12 4.5"/><path d="M8.7 1.9 12 4.5 8.7 7.1"/>' + NUM, { w: 1.9 }),
  hide: svg('<path d="M9.9 4.2A10.1 10.1 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.3M6.6 6.6A17.1 17.1 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>', { s: 22 }),
  info: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5v-5M12 7.9h.01"/>', { s: 22 }),
  gauge: svg('<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>', { s: 22 }),
  qual: svg('<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>', { s: 22 }),
  subs: svg('<rect width="18" height="14" x="3" y="5" rx="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>', { s: 22 }),
  chev: svg('<path d="m9 6 6 6-6 6"/>', { s: 18 }),
  left: svg('<path d="m15 6-6 6 6 6"/>', { s: 22 }),
  minus: svg('<path d="M5 12h14"/>', { s: 20 }),
  plus: svg('<path d="M12 5v14M5 12h14"/>', { s: 20 }),
  check: svg('<path d="M20 6 9 17l-5-5"/>', { s: 18 }),
  ext: svg('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', { s: 18 }),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', { s: 18 })
};
const rateTxt = r => (Math.round(r * 100) / 100) + 'x';
const YTQ = { tiny: '144p', small: '240p', medium: '360p', large: '480p', hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '2160p', highres: '4320p' };

/* ---------- helpers on the room (through the bridge) ---------- */
const media = () => { const R = H && H.R(); return R && R.media; };
const isEmbed = () => { const m = media(); return !!m && m.kind === 'embed'; };
const P = () => H.P();

/* =====================================================================
   mount / unmount
   ===================================================================== */
function mount() {
  const w = $('#vwrap'), m = media();
  if (!H || !w || !m) return unmount();
  const key = [m.kind, m.id, m.pl, m.url, H.R().media_ver].join('|');
  if (ui && ui.isConnected && wrap === w) {
    if (key !== S.key) { S.key = key; resetPer(); }
    ui.dataset.k = isEmbed() ? 'embed' : 'media';
    if (gz) gz.hidden = isEmbed();
    renderTop(); update(); layout(); return;
  }
  unmount(true);
  wrap = w; S.key = key; resetPer();
  gz = document.createElement('div'); gz.id = 'pgz'; gz.className = 'pgz'; gz.hidden = isEmbed();
  ui = document.createElement('div'); ui.id = 'pui'; ui.className = 'pui'; ui.dataset.vis = '1';
  ui.dataset.k = isEmbed() ? 'embed' : 'media';
  ui.innerHTML = `<div class="pshade t"></div><div class="pshade b"></div>
    <div class="prip l" aria-hidden="true"></div><div class="prip r" aria-hidden="true"></div>
    <div class="ptop"></div>
    <div class="pmid">
      <button type="button" class="pb sk" data-p="back" aria-label="Back 15 seconds" title="Back 15 seconds">${I.back}</button>
      <button type="button" class="pb big" data-p="toggle" aria-label="Play or pause"><span class="i-play">${I.play}</span><span class="i-pause">${I.pause}</span></button>
      <button type="button" class="pb sk" data-p="fwd" aria-label="Forward 15 seconds" title="Forward 15 seconds">${I.fwd}</button>
    </div>
    <div class="pbot">
      <div class="prow"><div class="pinfo"><b class="ptt"></b><span class="pts"></span></div><div class="ptm" aria-live="off"><span class="pc">0:00</span> / <span class="pd">0:00</span></div></div>
      <div class="ptw" data-p="track" role="slider" aria-label="Timeline" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-disabled="true"><div class="ptrack"><i class="pbuf"></i><i class="pfill"></i><i class="pthumb"></i></div></div>
    </div>
    <div class="pmenu" role="menu" hidden></div>
    <div class="ptoast" role="status" hidden></div>`;
  w.appendChild(gz); w.appendChild(ui);
  ui.addEventListener('click', onClick);
  ui.addEventListener('input', onInput);
  ui.addEventListener('keydown', onKey);
  ui.addEventListener('focusin', wake);
  const tw = $('.ptw', ui);
  tw.addEventListener('pointerdown', trackDown); tw.addEventListener('pointermove', trackMove);
  tw.addEventListener('pointerup', trackUp); tw.addEventListener('pointercancel', trackUp);
  gz.addEventListener('pointerup', gesture);
  gz.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') wake(); });
  w.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') wake(); });
  gz.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);
  document.addEventListener('keydown', docKey, true);
  if (window.ResizeObserver) { ro = new ResizeObserver(layout); ro.observe(w); }
  window.addEventListener('resize', layout);
  clearInterval(loop); loop = setInterval(tick, 250);
  renderTop(); layout(); update();
}
function unmount(keep) {
  clearInterval(loop); loop = 0;
  if (ro) { ro.disconnect(); ro = null; }
  window.removeEventListener('resize', layout);
  document.removeEventListener('fullscreenchange', syncFs);
  document.removeEventListener('webkitfullscreenchange', syncFs);
  document.removeEventListener('keydown', docKey, true);
  if (S.fs || S.pfs) exitFs();
  if (ui) ui.remove(); if (gz) gz.remove();
  if (wrap) wrap.classList.remove('padm', 'pfs');
  ui = gz = null; if (!keep) wrap = null;
  S.menu = '';
}
/* a different video started: forget per-video choices */
function resetPer() {
  S.menu = ''; S.qsel = 'auto'; S.subSel = 'off'; S.subTried = false; S.last = null; clearTimeout(S.tapT);
  if (ui) renderMenu();
}

/* =====================================================================
   top buttons · centre · timeline
   ===================================================================== */
function renderTop() {
  const t = $('.ptop', ui); if (!t) return;
  const m = media(), likeable = H.like.can(m), liked = likeable && H.like.is(m);
  t.innerHTML = `<button type="button" class="pb" data-p="fs" aria-label="${S.fs || S.pfs ? 'Exit full screen' : 'Full screen'}" title="${S.fs || S.pfs ? 'Exit full screen' : 'Full screen'}">${S.fs || S.pfs ? I.fsx : I.fs}</button>
    ${likeable ? `<button type="button" class="pb${liked ? ' on' : ''}" data-p="like" aria-pressed="${liked}" aria-label="${liked ? 'Unlike video' : 'Like video'}" title="${liked ? 'Unlike' : 'Like'}">${liked ? I.like.replace('fill="none"', 'fill="currentColor"') : I.like}</button>` : ''}
    <button type="button" class="pb mo${S.menu ? ' on' : ''}" data-p="more" aria-haspopup="menu" aria-expanded="${S.menu ? 'true' : 'false'}" aria-label="More options" title="More options">${I.more}</button>`;
}
function update() {
  if (!ui || !H) return;
  const R = H.R(), m = media(); if (!R || !m) return;
  const adm = H.isAdmin(), embed = isEmbed();
  if (ui.dataset.adm !== (adm ? '1' : '0')) { ui.dataset.adm = adm ? '1' : '0'; renderMenuSoft(); }
  if (wrap) wrap.classList.toggle('padm', adm && !embed);
  const likeBtn = $('[data-p=like]', ui), likeable = H.like.can(m);
  if (!!likeBtn !== likeable || (likeBtn && likeBtn.classList.contains('on') !== H.like.is(m))) renderTop();
  const tt = $('.ptt', ui), ts = $('.pts', ui);
  if (tt.textContent !== (m.title || 'Video')) tt.textContent = m.title || 'Video';
  const sub = H.platName(m) + (m.live ? ' · LIVE' : '');
  if (ts.textContent !== sub) ts.textContent = sub;
  if (embed) return;
  const cur = H.pl.time(), dur = H.pl.dur(), playing = H.pl.playing();
  ui.dataset.pl = playing ? '1' : '0';
  const live = !dur && P().ready;
  const pc = $('.pc', ui), pd = $('.pd', ui);
  const showCur = S.drag && S.dragT != null ? S.dragT : cur;
  const a = H.fmt(showCur), b = dur ? H.fmt(dur) : (P().ready ? 'LIVE' : '0:00');
  if (pc.textContent !== a) pc.textContent = a;
  if (pd.textContent !== b) pd.textContent = b;
  const frac = S.drag && S.dragF != null ? S.dragF : (dur ? clamp(cur / dur, 0, 1) : 0);
  const tw = $('.ptw', ui);
  tw.style.setProperty('--f', (frac * 100).toFixed(2) + '%');
  tw.style.setProperty('--bf', (bufFrac() * 100).toFixed(2) + '%');
  tw.setAttribute('aria-valuenow', Math.round(frac * 100));
  tw.setAttribute('aria-valuetext', a + ' of ' + b);
  const dis = !adm || live;
  tw.setAttribute('aria-disabled', dis ? 'true' : 'false'); tw.tabIndex = dis ? -1 : 0; tw.classList.toggle('adm', !dis);
}
function bufFrac() {
  try {
    const p = P();
    if (p.yt) return p.yt.getVideoLoadedFraction() || 0;
    const v = p.video; if (v && v.buffered && v.buffered.length && isFinite(v.duration) && v.duration > 0) return v.buffered.end(v.buffered.length - 1) / v.duration;
  } catch (e) {}
  return 0;
}
/* sizes scale with the frame: tiny phone frame → compact, laptop → roomy, full screen → large */
function layout() {
  if (!ui || !wrap) return;
  const W = wrap.clientWidth, Hh = wrap.clientHeight; if (!W || !Hh) return;
  const k = clamp(W / 1000, .36, 1.9);
  const b = Math.round(clamp(60 * k, 34, 96)), pad = Math.round(clamp(24 * k, 10, 40));
  const mr = Math.round(clamp(46 * k, 34, 62)), rows = isEmbed() ? 2 : 5;
  const set = (n, v) => ui.style.setProperty(n, v);
  set('--b', b + 'px'); set('--pad', pad + 'px');
  set('--big', Math.round(clamp(120 * k, 54, 168)) + 'px'); set('--sk', Math.round(clamp(84 * k, 44, 118)) + 'px');
  set('--tt', Math.round(clamp(40 * k, 15, 60)) + 'px'); set('--ts', Math.round(clamp(22 * k, 12, 28)) + 'px');
  set('--tm', Math.round(clamp(22 * k, 12, 30)) + 'px'); set('--th', Math.round(clamp(6 * k, 4, 8)) + 'px');
  set('--mw', Math.round(clamp(330 * k, 252, 460)) + 'px'); set('--mr', mr + 'px'); set('--mf', Math.round(clamp(17 * k, 13, 24)) + 'px');
  /* the card sits under the three buttons when there is room, otherwise it covers them (tap outside closes it) */
  const need = rows * mr + 22, below = pad + b + 8;
  const top = Hh - below - pad >= need ? below : pad;
  set('--mt', top + 'px'); ui.dataset.sm = Hh < 300 ? '1' : '0';
}

/* =====================================================================
   controls visibility (auto-hide while playing)
   ===================================================================== */
function setVis(v) { S.vis = v; if (ui) ui.dataset.vis = v ? '1' : '0'; }
function wake() { S.act = Date.now(); if (!S.vis) setVis(true); }
function tick() {
  if (!ui || !H.R()) return;
  update();
  const playing = H.pl.playing(), started = P().started || isEmbed();
  const busy = S.menu || S.drag || !playing || !started || ui.contains(document.activeElement) && document.activeElement.matches('.ptw:focus-visible');
  if (busy) { if (!S.vis) setVis(true); S.act = Date.now(); return; }
  if (S.vis && Date.now() - S.act > HIDE_AFTER) setVis(false);
}

/* =====================================================================
   gestures: tap = show / hide controls (mouse click = play / pause for the admin),
             double tap left / right = −15 s / +15 s (admin), double tap centre = full screen
   ===================================================================== */
function zoneOf(e) { const r = gz.getBoundingClientRect(), f = (e.clientX - r.left) / Math.max(1, r.width); return f < .4 ? -1 : f > .6 ? 1 : 0; }
function gesture(e) {
  if (e.button > 0) return;
  const zone = zoneOf(e), now = performance.now(), L = S.last;
  if (S.menu) { closeMenu(); S.last = null; return; }
  /* a chain of quick taps on the same side keeps seeking */
  if (L && now - L.t < (L.chain ? 450 : DBL) && L.zone === zone && zone !== 0) {
    clearTimeout(S.tapT); S.last = { t: now, zone, chain: true };
    if (H.isAdmin()) seekBy(zone); else say('Only the admin can skip');
    wake(); return;
  }
  if (L && now - L.t < DBL && L.zone === 0 && zone === 0) { clearTimeout(S.tapT); S.last = null; toggleFs(); return; }
  S.last = { t: now, zone, chain: false };
  clearTimeout(S.tapT);
  S.tapT = setTimeout(() => single(e.pointerType), DBL);
}
function single(type) {
  S.last = null;
  if (type === 'mouse') { if (H.isAdmin() && S.vis !== false) { H.toggle(); } wake(); return; }
  if (!H.pl.playing()) { wake(); return; }
  if (S.vis) setVis(false); else wake();
}
function seekBy(dir) {
  if (!H.isAdmin()) return false;
  const now = Date.now();
  if (now - S.seekAt > 900 || S.seekDir !== dir) { S.seekBase = H.pl.time(); S.seekAcc = 0; }
  S.seekAt = now; S.seekDir = dir; S.seekAcc += SEEK;
  const dur = H.pl.dur();
  let t = S.seekBase + dir * S.seekAcc;
  t = dur ? clamp(t, 0, Math.max(0, dur - .5)) : Math.max(0, t);
  H.pl.seek(t); H.publish(H.pl.playing(), t);
  const r = $(dir < 0 ? '.prip.l' : '.prip.r', ui);
  if (r) { r.innerHTML = `<span>${dir < 0 ? '‹‹' : '››'}<b>${S.seekAcc} s</b></span>`; r.classList.remove('on'); void r.offsetWidth; r.classList.add('on'); clearTimeout(r._t); r._t = setTimeout(() => r.classList.remove('on'), 650); }
  update(); return true;
}
function say(msg) {
  const t = $('.ptoast', ui); if (!t) return;
  t.textContent = msg; t.hidden = false; clearTimeout(S.toastT); S.toastT = setTimeout(() => { t.hidden = true; }, 1700);
}

/* =====================================================================
   timeline (admin only)
   ===================================================================== */
function fracAt(e) { const r = $('.ptrack', ui).getBoundingClientRect(); return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1); }
function trackOK() { const tw = $('.ptw', ui); return H.isAdmin() && tw && tw.getAttribute('aria-disabled') !== 'true'; }
function trackDown(e) {
  wake(); if (e.button > 0) return;
  if (!trackOK()) { if (!H.isAdmin()) say('Only the admin can use the timeline'); return; }
  e.currentTarget.setPointerCapture(e.pointerId);
  S.drag = true; P().drag = true; trackMove(e);
}
function trackMove(e) {
  if (!S.drag) return;
  const dur = H.pl.dur(); S.dragF = fracAt(e); S.dragT = S.dragF * dur; update();
}
function trackUp(e) {
  if (!S.drag) return;
  const dur = H.pl.dur(), t = (S.dragF == null ? 0 : S.dragF) * dur;
  S.drag = false; S.dragF = S.dragT = null;
  if (e.type === 'pointerup' && dur) { H.pl.seek(t); H.publish(H.pl.playing(), t); }
  setTimeout(() => { P().drag = false; }, 60); update();
}

/* =====================================================================
   ⋮ menu — one glass card, panels inside it
   ===================================================================== */
const row = (p, icon, label, val, chev, extra) => `<button type="button" class="pr" role="menuitem" data-p="${p}" ${extra || ''}><span class="pi">${icon}</span><span class="pl">${label}</span>${val ? `<span class="pv">${val}</span>` : ''}${chev ? `<span class="pch">${I.chev}</span>` : ''}</button>`;
const head = title => `<div class="ph"><button type="button" class="pback" data-p="mback" aria-label="Back">${I.left}</button><b>${title}</b></div>`;
const row2 = (k, v) => `<div class="pk"><span>${H.esc(k)}</span><b>${H.esc(v)}</b></div>`;

function openMenu(name) { S.menu = name || 'main'; wake(); renderTop(); renderMenu(); if (ui) ui.dataset.menu = '1'; }
function closeMenu() { S.menu = ''; renderTop(); renderMenu(); if (ui) ui.dataset.menu = '0'; }
function qLabel() {
  const q = quality(); if (!q) return '';
  if (q.single) return 'Original' + (q.cur ? ' (' + q.cur + ')' : '');
  if (q.sel === 'auto') return 'Auto' + (q.cur ? ' (' + q.cur + ')' : '');
  const o = q.opts.find(x => x.id === q.sel); return o ? o.label : 'Auto';
}
function sLabel() {
  const s = subs(); if (!s || S.subSel === 'off') return 'Off';
  const o = s.opts.find(x => x.id === S.subSel); return o ? o.label : 'Off';
}
function renderMenu() {
  const mn = $('.pmenu', ui); if (!mn) return;
  const btn = $('[data-p=more]', ui); if (btn) btn.setAttribute('aria-expanded', S.menu ? 'true' : 'false');
  if (!S.menu) { mn.hidden = true; mn.innerHTML = ''; mn.dataset.panel = ''; return; }
  const adm = H.isAdmin(), embed = isEmbed(), m = media(), was = mn.dataset.panel;
  let h = '';
  if (S.menu === 'main') {
    h = row('hide', I.hide, 'Hide Player') + row('details', I.info, 'Video Details', '', true);
    if (!embed) h += row('speed', I.gauge, 'Playback Speed', rateTxt(H.rate.get()), true) + row('quality', I.qual, 'Video Quality', H.esc(qLabel()), true) + row('subs', I.subs, 'Subtitles', H.esc(sLabel()), true);
  } else if (S.menu === 'details') {
    const q = quality(), dur = H.pl.dur(), v = P().video;
    const res = v && v.videoWidth ? v.videoWidth + ' × ' + v.videoHeight : (q && q.cur) || '';
    const link = H.sourceUrl(m), th = H.thumb(m);
    h = head('Video Details') + `<div class="pdet">${th ? `<div class="pth" style="background-image:url('${H.esc(th)}')"></div>` : ''}<h4>${H.esc(m.title || 'Video')}</h4>
      ${row2('Platform', H.platName(m))}${row2('Length', m.live || (!dur && P().ready && !isEmbed()) ? 'Live' : dur ? H.fmt(dur) : '—')}${res ? row2('Resolution', res) : ''}${embed ? '' : row2('Speed', rateTxt(H.rate.get()))}${row2('Room admin', H.adminName())}
      <div class="pact">${link ? `<a class="pbtn" href="${H.esc(link)}" target="_blank" rel="noopener noreferrer">${I.ext}<span>Open original</span></a><button type="button" class="pbtn" data-p="copylink">${I.copy}<span>Copy link</span></button>` : ''}</div></div>`;
  } else if (S.menu === 'speed') {
    const r = H.rate.get(), dis = adm ? '' : 'disabled';
    h = head('Playback Speed') + `<div class="psp"><output class="psv" id="prout">${rateTxt(r)}</output>
      <div class="psl"><button type="button" class="pstep" data-p="rate-" aria-label="Slower" ${dis}>${I.minus}</button><input type="range" id="prate" min="0.25" max="2" step="0.05" value="${r}" aria-label="Playback speed" ${dis}><button type="button" class="pstep" data-p="rate+" aria-label="Faster" ${dis}>${I.plus}</button></div>
      <div class="pchips">${[1, 1.25, 1.5, 2].map(x => `<button type="button" class="pchip${Math.abs(x - r) < .005 ? ' on' : ''}" data-p="rate" data-v="${x}" ${dis}>${x === 2 ? '2.0x' : x + 'x'}</button>`).join('')}</div>
      ${adm ? '' : '<p class="pnote">The room admin sets the speed for everyone.</p>'}</div>`;
  } else if (S.menu === 'quality') {
    const q = quality();
    h = head('Video Quality') + '<div class="plist">';
    if (!q) h += '<p class="pnote">Quality is not available for this video.</p>';
    else if (q.single) h += `<button type="button" class="pr on" role="menuitemradio" aria-checked="true" data-p="q" data-v="auto"><span class="pl">Original${q.cur ? ' (' + q.cur + ')' : ''}</span><span class="pck">${I.check}</span></button><p class="pnote">This video has one quality.</p>`;
    else {
      h += `<button type="button" class="pr${q.sel === 'auto' ? ' on' : ''}" role="menuitemradio" aria-checked="${q.sel === 'auto'}" data-p="q" data-v="auto"><span class="pl">Auto${q.cur && q.sel === 'auto' ? ' (' + q.cur + ')' : ''}</span><span class="pck">${q.sel === 'auto' ? I.check : ''}</span></button>`;
      h += q.opts.map(o => `<button type="button" class="pr${q.sel === o.id ? ' on' : ''}" role="menuitemradio" aria-checked="${q.sel === o.id}" data-p="q" data-v="${H.esc(o.id)}"><span class="pl">${H.esc(o.label)}</span><span class="pck">${q.sel === o.id ? I.check : ''}</span></button>`).join('');
      if (q.kind === 'yt' && !q.opts.length) h += '<p class="pnote">More sizes appear once the video has started.</p>';
    }
    h += '</div>';
  } else if (S.menu === 'subs') {
    const s = subs();
    h = head('Subtitles') + '<div class="plist">' + `<button type="button" class="pr${S.subSel === 'off' ? ' on' : ''}" role="menuitemradio" aria-checked="${S.subSel === 'off'}" data-p="s" data-v="off"><span class="pl">Off</span><span class="pck">${S.subSel === 'off' ? I.check : ''}</span></button>`;
    if (s) h += s.opts.map(o => `<button type="button" class="pr${S.subSel === o.id ? ' on' : ''}" role="menuitemradio" aria-checked="${S.subSel === o.id}" data-p="s" data-v="${H.esc(o.id)}"><span class="pl">${H.esc(o.label)}</span><span class="pck">${S.subSel === o.id ? I.check : ''}</span></button>`).join('');
    if (!s || !s.opts.length) h += `<p class="pnote">${s && s.wait ? 'Looking for subtitles…' : 'This video has no subtitles.'}</p>`;
    h += '</div>';
  }
  mn.hidden = false; mn.dataset.panel = S.menu; mn.innerHTML = h;
  mn.scrollTop = 0;
  if (was !== S.menu && S.kbd) { const f = $('.pr,.pback', mn); if (f) { try { f.focus({ preventScroll: true }); } catch (e) {} } }
}
/* the menu content depends on admin rights: repaint it in place when that changes */
function renderMenuSoft() { if (S.menu) renderMenu(); }
function paintSpeed() {
  const r = H.rate.get(), o = $('#prout', ui); if (!o) return;
  o.textContent = rateTxt(r);
  const sl = $('#prate', ui); if (sl && document.activeElement !== sl) sl.value = r;
  ui.querySelectorAll('.pchip').forEach(c => c.classList.toggle('on', Math.abs(+c.dataset.v - r) < .005));
}
function setRate(r) {
  if (!H.isAdmin()) return say('Only the admin can change the speed');
  H.rate.set(clamp(Math.round(r * 100) / 100, .25, 2));
  paintSpeed();
}

/* ---- quality ---- */
function quality() {
  const p = P();
  try {
    if (p.yt) {
      let lv = []; try { lv = (p.yt.getAvailableQualityLevels() || []).filter(x => YTQ[x]); } catch (e) {}
      let cur = ''; try { cur = YTQ[p.yt.getPlaybackQuality()] || ''; } catch (e) {}
      return { kind: 'yt', opts: lv.map(id => ({ id, label: YTQ[id] })), cur, sel: S.qsel };
    }
    if (p.video) {
      const h = p.video._hls;
      if (h && h.levels && h.levels.length) {
        const seen = new Set(), opts = [];
        h.levels.map((l, i) => ({ id: String(i), h: l.height || 0, label: l.height ? l.height + 'p' : Math.round((l.bitrate || 0) / 1000) + ' kbps' })).sort((a, b) => b.h - a.h)
          .forEach(o => { if (!seen.has(o.label)) { seen.add(o.label); opts.push(o); } });
        const lvl = h.levels[h.currentLevel >= 0 ? h.currentLevel : h.loadLevel];
        return { kind: 'hls', opts, cur: lvl && lvl.height ? lvl.height + 'p' : '', sel: h.autoLevelEnabled ? 'auto' : String(h.currentLevel) };
      }
      const vh = p.video.videoHeight;
      return { kind: 'file', opts: [], single: true, cur: vh ? vh + 'p' : '', sel: 'auto' };
    }
  } catch (e) {}
  return null;
}
function setQuality(id) {
  const p = P();
  try {
    if (p.yt) {
      S.qsel = id;
      if (id === 'auto') { p.yt.setPlaybackQuality('default'); } else { p.yt.setPlaybackQuality(id); if (p.yt.setPlaybackQualityRange) p.yt.setPlaybackQualityRange(id, id); }
    } else if (p.video && p.video._hls) {
      p.video._hls.currentLevel = id === 'auto' ? -1 : +id;
    }
  } catch (e) {}
}

/* ---- subtitles ---- */
function subs() {
  const p = P();
  try {
    if (p.yt) {
      let list = []; try { list = p.yt.getOption('captions', 'tracklist') || []; } catch (e) {}
      const seen = new Set(), opts = [];
      list.forEach(t => { const id = t.languageCode + (t.kind ? '|' + t.kind : ''); if (!t.languageCode || seen.has(id)) return; seen.add(id); opts.push({ id, code: t.languageCode, label: t.displayName || t.languageName || t.languageCode }); });
      return { kind: 'yt', opts, wait: !opts.length && S.subTried && Date.now() - S.subTried < 2500 };
    }
    if (p.video) {
      const h = p.video._hls;
      if (h && h.subtitleTracks && h.subtitleTracks.length) return { kind: 'hls', opts: h.subtitleTracks.map((t, i) => ({ id: String(i), label: t.name || t.lang || 'Track ' + (i + 1) })) };
      const tl = [...(p.video.textTracks || [])].filter(t => t.kind === 'subtitles' || t.kind === 'captions');
      return { kind: 'native', opts: tl.map((t, i) => ({ id: String(i), label: t.label || t.language || 'Track ' + (i + 1) })) };
    }
  } catch (e) {}
  return null;
}
function setSub(id) {
  const p = P(), s = subs(); if (!s) return;
  try {
    if (s.kind === 'yt') {
      if (id === 'off') { p.yt.setOption('captions', 'track', {}); try { p.yt.unloadModule('captions'); } catch (e) {} }
      else { const o = s.opts.find(x => x.id === id); p.yt.loadModule('captions'); p.yt.setOption('captions', 'track', { languageCode: o ? o.code : id.split('|')[0] }); }
    } else if (s.kind === 'hls') {
      const h = p.video._hls; if (id === 'off') { h.subtitleTrack = -1; } else { h.subtitleTrack = +id; h.subtitleDisplay = true; }
    } else {
      [...p.video.textTracks].filter(t => t.kind === 'subtitles' || t.kind === 'captions').forEach((t, i) => { t.mode = id !== 'off' && String(i) === id ? 'showing' : 'disabled'; });
    }
    S.subSel = id;
  } catch (e) {}
}
function openSubs() {
  const p = P();
  if (p.yt && !S.subTried) { S.subTried = Date.now(); try { p.yt.loadModule('captions'); } catch (e) {} setTimeout(() => { if (S.menu === 'subs') renderMenu(); }, 600); setTimeout(() => { if (S.menu === 'subs') renderMenu(); }, 1800); }
  openMenu('subs');
}

/* ---- full screen ---- */
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function syncFs() {
  const on = fsEl() === wrap || S.pfs;
  S.fs = fsEl() === wrap;
  if (ui) { ui.dataset.fs = on ? '1' : '0'; renderTop(); layout(); }
  if (H && H.fit) { H.fit(); setTimeout(H.fit, 120); }
  if (!on) { try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {} }
}
async function enterFs() {
  const rq = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
  let done = false;
  if (rq) { try { const pr = rq.call(wrap); if (pr && pr.then) await pr; done = true; } catch (e) {} }
  if (!done) { S.pfs = true; wrap.classList.add('pfs'); document.body.classList.add('pl-pfs'); }
  syncFs();
  try { if (matchMedia('(pointer:coarse)').matches && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) {}
}
function exitFs() {
  if (S.pfs) { S.pfs = false; if (wrap) wrap.classList.remove('pfs'); document.body.classList.remove('pl-pfs'); }
  if (fsEl()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
  syncFs();
}
function toggleFs() { if (!wrap) return; if (S.fs || S.pfs) exitFs(); else enterFs(); }

/* =====================================================================
   events
   ===================================================================== */
function onClick(e) {
  const el = e.target.closest('[data-p]'); if (!el || !ui.contains(el)) return;
  wake(); S.kbd = e.detail === 0;
  const p = el.dataset.p, adm = H.isAdmin();
  if (p === 'fs') toggleFs();
  else if (p === 'like') { H.like.toggle(media()); renderTop(); }
  else if (p === 'more') { S.menu ? closeMenu() : openMenu('main'); }
  else if (p === 'mback') openMenu('main');
  else if (p === 'back') seekBy(-1) || say('Only the admin can skip');
  else if (p === 'fwd') seekBy(1) || say('Only the admin can skip');
  else if (p === 'toggle') { if (adm) { H.toggle(); setTimeout(update, 30); } }
  else if (p === 'hide') { closeMenu(); H.hidden.set(true); }
  else if (p === 'details') openMenu('details');
  else if (p === 'speed') openMenu('speed');
  else if (p === 'quality') openMenu('quality');
  else if (p === 'subs') openSubs();
  else if (p === 'rate') setRate(+el.dataset.v);
  else if (p === 'rate-') setRate(H.rate.get() - .25);
  else if (p === 'rate+') setRate(H.rate.get() + .25);
  else if (p === 'q') { setQuality(el.dataset.v); renderMenu(); }
  else if (p === 's') { setSub(el.dataset.v); renderMenu(); }
  else if (p === 'copylink') { const l = H.sourceUrl(media()); try { navigator.clipboard.writeText(l).then(() => say('Link copied')); } catch (er) { say('Could not copy'); } }
}
function onInput(e) { if (e.target.id === 'prate') setRate(+e.target.value); }
function onKey(e) {
  if (e.target.classList && e.target.classList.contains('ptw') && trackOK()) {
    const dur = H.pl.dur(), cur = H.pl.time(); let t = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = cur - 5; else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = cur + 5;
    else if (e.key === 'Home') t = 0; else if (e.key === 'End') t = dur - .5;
    if (t != null) { e.preventDefault(); t = clamp(t, 0, Math.max(0, dur - .5)); H.pl.seek(t); H.publish(H.pl.playing(), t); update(); }
  }
}
function docKey(e) {
  if (e.key !== 'Escape') return;
  if (S.menu) { e.stopPropagation(); closeMenu(); return; }
  if (S.pfs) { e.stopPropagation(); exitFs(); }
}

/* =====================================================================
   public
   ===================================================================== */
window.NovaPlayer = {
  init(host) { H = host; },
  mount, unmount, update, layout,
  menuOpen: () => !!S.menu,
  closeMenu: () => { if (ui && S.menu) closeMenu(); },
  repaintRate() { paintSpeed(); if (S.menu === 'main') renderMenu(); if (S.menu === 'details') renderMenu(); },
  exitFs: () => { if (S.fs || S.pfs) exitFs(); },
  wake
};
})();
