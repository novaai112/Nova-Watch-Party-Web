/* room-cards.js — Nova home room cards
   1. Laptop / desktop (mouse): hovering a card plays the room's live video inside the card, in sync with the room
      (muted, with a mute / unmute button that hides itself). Hovering the title opens a glass info panel
      (title, timeline, watching, room open time). Hovering an avatar shows the person's name above it.
   2. Phone / tablet long-press and laptop right-click: a sheet with the live preview, status, the member list and
      the actions Delete (or Cancel invite for invited rooms) and Report video.
   3. Keeps the floating + button in the same column as the People icon on wide screens.
   Needs room.js (window.NovaRoom.api), nova-core.js and room-cards.css. */
(function () {
'use strict';
if (!window.Nova) return;
const esc = Nova.esc;
const $ = (s, r) => (r || document).querySelector(s);
const api = () => (window.NovaRoom && NovaRoom.api) || null;
const canHover = () => window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches;
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;

/* ---------- icons ---------- */
const ST = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const I = {
  mute: '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>',
  vol: '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2.2.6 3.5 2.4 3.5 5.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  uncancel: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m2.5 7 9.5 6.5L21.5 7"/><path d="m15 15 5 5M20 15l-5 5" stroke-width="2.4"/>',
  flag: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.2v.1" stroke-width="2.4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" fill="currentColor"/>'
};
const ic = (n, s) => `<svg width="${s || 20}" height="${s || 20}" viewBox="0 0 24 24" ${ST} aria-hidden="true">${I[n] || ''}</svg>`;
const PRIV_ICON = { public: 'globe', nearby: 'pin', friends: 'users', invite: 'lock' };
const PRIV_PATH = {
  globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.8 2.7 4 5.9 4 9.5s-1.2 6.8-4 9.5c-2.8-2.7-4-5.9-4-9.5s1.2-6.8 4-9.5z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>',
  users: I.users,
  lock: '<rect x="4" y="10.500" width="16" height="10.500" rx="2"/><path d="M8 10.500V7.500a4 4 0 0 1 8 0v3"/>'
};
const privSvg = (p, s) => `<svg width="${s || 16}" height="${s || 16}" viewBox="0 0 24 24" ${ST} aria-hidden="true">${PRIV_PATH[PRIV_ICON[p] || 'globe']}</svg>`;

/* ---------- helpers ---------- */
const clock = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};
const openFor = r => {
  const t = r && r.created_at ? Date.parse(r.created_at) : NaN;
  if (!isFinite(t)) return '';
  const mins = Math.max(0, Math.floor((api().now() - t) / 60000));
  if (mins < 1) return 'Room open for less than a minute';
  const h = Math.floor(mins / 60), m = mins % 60;
  return 'Room open for ' + (h ? h + 'h ' + m + 'm' : m + 'm');
};
const roomTitle = r => (r.media && r.media.title) || r.title || 'Nova room';
const provider = r => {
  const p = (r.media && r.media.provider) || (r.media && r.media.kind) || '';
  const names = { youtube: 'YouTube', web: 'Web', drive: 'Google Drive', x: 'X', twitch: 'Twitch', video: 'Video', embed: 'Embed' };
  return names[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : '');
};
const duration = r => (r.media && Number(r.media.duration) > 0) ? Number(r.media.duration) : 0;
const timeline = (r, dur) => {
  const lp = api().livePos(r), d = dur || duration(r);
  const pos = d ? Math.min(lp.pos, d) : lp.pos;
  return { pos, dur: d, playing: lp.playing, live: !!(r.media && r.media.live), pct: d ? Math.max(0, Math.min(100, pos / d * 100)) : 0 };
};

/* ---------- live preview media (YouTube iframe or <video>) shared by the hover card and the sheet ---------- */
function mountMedia(host, r, opts) {
  const src = api().previewSource(r.media), lp = api().livePos(r);
  const h = { el: null, muted: true, dur: 0, destroy() {}, setMuted() {} };
  if (!src || !lp.playing) return h;       // embeds / paused rooms keep their thumbnail
  let dead = false;
  if (src.type === 'youtube') {
    const f = document.createElement('iframe');
    const q = new URLSearchParams({ autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, enablejsapi: 1, start: Math.floor(lp.pos) });
    if (/^https?:$/.test(location.protocol)) q.set('origin', location.origin);
    let url = 'https://www.youtube.com/embed/' + encodeURIComponent(src.id || '') + '?' + q;
    if (src.pl) url = src.id ? url + '&list=' + encodeURIComponent(src.pl) : 'https://www.youtube.com/embed/videoseries?' + q + '&list=' + encodeURIComponent(src.pl);
    f.src = url; f.title = 'Live preview'; f.tabIndex = -1; f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    f.referrerPolicy = 'strict-origin-when-cross-origin'; f.className = 'rc-yt';
    host.appendChild(f); h.el = f;
    const post = (func, args) => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), '*'); } catch (e) {} };
    let fixes = 0;
    const onMsg = ev => {
      if (ev.source !== f.contentWindow || typeof ev.data !== 'string') return;
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      const info = d && d.info; if (!info) return;
      if (info.duration > 0) { h.dur = info.duration; opts && opts.onDur && opts.onDur(info.duration); }
      /* an ended / paused frame would show YouTube's own "More videos" panel — keep the card's thumbnail instead */
      if (typeof info.playerState === 'number') f.style.visibility = (info.playerState === 0 || info.playerState === 2 || info.playerState === 5) ? 'hidden' : '';
      /* correct the start offset once the player really runs (load time makes it lag a little) */
      if (info.playerState === 1 && typeof info.currentTime === 'number' && fixes < 2) {
        const cur = api().byId(r.id), t = cur ? api().livePos(cur) : lp;
        if (t.playing && Math.abs(info.currentTime - t.pos) > 2.5) { fixes++; post('seekTo', [t.pos, true]); }
        else fixes = 9;
      }
    };
    window.addEventListener('message', onMsg);
    const listen = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'rc', channel: 'widget' }), '*'); } catch (e) {} };
    f.addEventListener('load', () => { listen(); setTimeout(listen, 800); setTimeout(listen, 2000); });
    h.setMuted = m => { h.muted = m; post(m ? 'mute' : 'unMute'); if (!m) post('setVolume', [70]); };
    h.destroy = () => { dead = true; window.removeEventListener('message', onMsg); f.src = 'about:blank'; f.remove(); };
  } else {
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.controls = false; v.className = 'rc-vd';
    host.appendChild(v); h.el = v;
    api().attachSrc(v, src.src, src.hls);
    v.addEventListener('loadedmetadata', () => {
      if (dead) return;
      if (isFinite(v.duration) && v.duration > 0) { h.dur = v.duration; opts && opts.onDur && opts.onDur(v.duration); }
      const cur = api().byId(r.id), t = cur ? api().livePos(cur) : lp;
      try { if (t.pos > 0.5 && (!h.dur || t.pos < h.dur)) v.currentTime = t.pos; } catch (e) {}
      v.play().catch(() => {});
    });
    v.addEventListener('error', () => { if (dead) return; h.destroy(); h.el = null; opts && opts.onFail && opts.onFail(); });
    h.setMuted = m => { h.muted = m; v.muted = m; if (!m) { v.volume = .7; v.play().catch(() => {}); } };
    h.destroy = () => { dead = true; try { v.pause(); if (v._hls) v._hls.destroy(); v.removeAttribute('src'); v.load(); } catch (e) {} v.remove(); };
  }
  return h;
}
/* a 16:9 YouTube frame is scaled so it fills the box like object-fit:cover */
function fitFrame(box, media) {
  if (!media || !media.el || !media.el.classList.contains('rc-yt')) return;
  const w = box.clientWidth, hgt = box.clientHeight; if (!w || !hgt) return;
  /* the frame is taller than the picture on purpose: YouTube's title bar, share / watch-later buttons, logo and
     "More videos" strip sit on the frame's top and bottom edges and are cropped away by the box */
  const CROP = 72, H = Math.max(hgt, w * 9 / 16), W = H * 16 / 9;
  Object.assign(media.el.style, { width: W + 'px', height: H + CROP * 2 + 'px', left: (w - W) / 2 + 'px', top: (hgt - H) / 2 - CROP + 'px' });
}

/* =====================================================================
   1. DESKTOP HOVER PREVIEW
   ===================================================================== */
let layer = null, cur = null, startT = 0, stopT = 0, tickT = 0, raf = 0, lastMove = null;
const getLayer = () => {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div'); layer.id = 'rcLayer'; document.body.appendChild(layer);
  layer.addEventListener('click', e => {
    const b = e.target.closest('.rc-mute'); if (!b || !cur) return;
    e.preventDefault(); e.stopPropagation(); toggleMute();
  });
  return layer;
};
const cardEl = code => document.querySelector('.room[data-code="' + (window.CSS && CSS.escape ? CSS.escape(code) : code) + '"]');

function activate(card) {
  const r = api().byId(card.dataset.rid); if (!r) return;
  deactivate();
  getLayer();
  const vid = document.createElement('div'); vid.className = 'rc-vid'; vid.hidden = true;
  vid.innerHTML = '<div class="rc-media"></div>' + (api().platBadge ? api().platBadge(r.media, 'card') : '') + '<button type="button" class="rc-mute" aria-label="Unmute" tabindex="-1"></button>';
  const panel = document.createElement('div'); panel.className = 'rc-info';
  panel.innerHTML = '<h4 class="rc-pt"></h4><div class="rc-time"><span class="rc-ico"></span><b class="rc-now"></b><span class="rc-sep"> / </span><span class="rc-tot"></span></div><div class="rc-bar"><i></i></div><div class="rc-meta rc-w"></div><div class="rc-meta rc-o"></div>';
  const tip = document.createElement('div'); tip.className = 'rc-tip';
  layer.append(vid, panel, tip);
  cur = { code: card.dataset.code, id: r.id, vid, panel, tip, media: null, hMute: 0, overVideo: false, titleHover: false, dur: 0 };
  cur.muteBtn = $('.rc-mute', vid); cur.mediaBox = $('.rc-media', vid);
  paintMute();
  place(); paintInfo();
  startT = setTimeout(mountPreview, 320);
  tickT = setInterval(tick, 500);
}
function mountPreview() {
  if (!cur) return;
  const r = api().byId(cur.id); if (!r) return deactivate();
  cur.media = mountMedia(cur.mediaBox, r, { onDur: d => { if (cur) cur.dur = d; }, onFail: () => { if (cur) cur.vid.hidden = true; } });
  if (!cur.media.el) return;
  cur.vid.hidden = false;
  cur.vid.classList.add('on');
  fitFrame(cur.mediaBox, cur.media);
  flashMute();
}
function deactivate() {
  clearTimeout(startT); clearTimeout(stopT); clearInterval(tickT); cancelAnimationFrame(raf);
  if (cur) {
    clearTimeout(cur.hMute);
    if (cur.media) cur.media.destroy();
    [cur.vid, cur.panel, cur.tip].forEach(n => n.remove());
  }
  cur = null;
}
function place() {
  if (!cur) return;
  const card = cardEl(cur.code), r = api().byId(cur.id);
  if (!card || !r) return deactivate();
  const cr = card.getBoundingClientRect(), cv = card.querySelector('.cover').getBoundingClientRect();
  if (cr.bottom < 0 || cr.top > innerHeight) return deactivate();
  Object.assign(cur.vid.style, { left: cv.left + 'px', top: cv.top + 'px', width: cv.width + 'px', height: cv.height + 'px' });
  fitFrame(cur.mediaBox, cur.media);
  const vw = document.documentElement.clientWidth;
  const pw = Math.min(430, Math.max(cr.right - cv.right, 330));
  let left = cv.right; if (left + pw > vw - 12) left = Math.max(12, vw - 12 - pw);
  cur.panel.style.cssText = 'left:' + left + 'px;width:' + pw + 'px;min-height:' + cr.height + 'px;top:' + cr.top + 'px';
  const ph = cur.panel.offsetHeight; if (cr.top + ph > innerHeight - 12) cur.panel.style.top = Math.max(12, innerHeight - 12 - ph) + 'px';
  placeTip();
}
function paintInfo() {
  if (!cur) return;
  const r = api().byId(cur.id); if (!r) return deactivate();
  const t = timeline(r, cur.dur), p = cur.panel;
  $('.rc-pt', p).textContent = roomTitle(r);
  $('.rc-ico', p).innerHTML = ic(t.playing ? 'play' : 'pause', 14);
  $('.rc-now', p).textContent = clock(t.pos);
  $('.rc-sep', p).hidden = $('.rc-tot', p).hidden = false;
  $('.rc-tot', p).textContent = t.live ? 'LIVE' : t.dur ? clock(t.dur) : '--:--';
  $('.rc-bar i', p).style.width = (t.live ? 100 : t.pct) + '%';
  p.classList.toggle('paused', !t.playing);
  const n = Number(r.count) || 0;
  $('.rc-w', p).innerHTML = ic('users', 15) + '<span>' + n + ' watching</span>';
  const o = openFor(r);
  $('.rc-o', p).innerHTML = o ? ic('clock', 15) + '<span>' + esc(o) + '</span>' : '';
  $('.rc-o', p).hidden = !o;
}
function tick() {
  if (!cur) return;
  if (document.hidden || (api().inRoom && api().inRoom())) return deactivate();
  paintInfo();
}
function setTitleHover(on) { if (!cur || cur.titleHover === on) return; cur.titleHover = on; cur.panel.classList.toggle('on', on); if (on) place(); }
function paintMute() {
  if (!cur) return;
  const muted = cur.media ? cur.media.muted : true;
  cur.muteBtn.innerHTML = ic(muted ? 'mute' : 'vol', 20);
  cur.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
}
function toggleMute() { if (!cur || !cur.media || !cur.media.el) return; cur.media.setMuted(!cur.media.muted); paintMute(); flashMute(); }
/* the speaker button shows while the cursor is on the video, then hides itself a moment after it leaves */
function flashMute() {
  if (!cur) return;
  cur.vid.classList.add('show'); clearTimeout(cur.hMute);
  if (!cur.overVideo) cur.hMute = setTimeout(() => { if (cur) cur.vid.classList.remove('show'); }, 1800);
}
function setOverVideo(on) {
  if (!cur || cur.overVideo === on) return;
  cur.overVideo = on;
  if (on) { cur.vid.classList.add('show'); clearTimeout(cur.hMute); } else flashMute();
}
/* name above an avatar */
let tipFor = null;
function placeTip() {
  if (!cur) return;
  if (!tipFor || !tipFor.isConnected) { cur.tip.classList.remove('on'); return; }
  const r = tipFor.getBoundingClientRect(), t = cur.tip;
  t.style.left = '0px'; t.style.top = '0px';
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  t.style.top = Math.max(8, r.top - h - 8) + 'px';
}
function setTip(av) {
  if (!cur) return;
  if (!av) { tipFor = null; cur.tip.classList.remove('on'); return; }
  if (tipFor === av) return;
  const rm = api().byId(cur.id), u = rm && (rm.members || []).find(x => x.id === av.dataset.userId);
  if (!u) { tipFor = null; cur.tip.classList.remove('on'); return; }
  tipFor = av;
  cur.tip.innerHTML = '<b>' + esc(u.full_name || u.username || 'Someone') + '</b>' + (u.username ? '<span>@' + esc(u.username) + '</span>' : '');
  cur.tip.classList.add('on'); placeTip();
}
function onMove(e) {
  if (e.pointerType !== 'mouse' || !canHover() || sheet) return;
  lastMove = e;
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; handleMove(lastMove); });
}
function handleMove(e) {
  const t = e.target; if (!t || !t.closest) return;
  const inLayer = !!t.closest('#rcLayer');
  const card = inLayer ? (cur && cardEl(cur.code)) : t.closest('.room[data-code]');
  if (!card) { if (cur && !stopT) stopT = setTimeout(() => { stopT = 0; deactivate(); }, 140); return; }
  clearTimeout(stopT); stopT = 0;
  if (!cur || cur.code !== card.dataset.code) {
    if (api().inRoom && api().inRoom()) return;
    activate(card);
  }
  if (!cur) return;
  setTitleHover(!!t.closest('.rt'));
  setTip(t.closest('.uav[data-user-id]'));
  setOverVideo(inLayer || !!t.closest('.cover'));
}
function afterRender() {
  document.querySelectorAll('.room .uav[title]').forEach(b => b.removeAttribute('title'));   // our own name tip replaces the native one
  if (cur) { if (!cardEl(cur.code) || !api().byId(cur.id)) deactivate(); else { place(); paintInfo(); } }
  if (sheet) refreshSheet();
}

/* =====================================================================
   2. LONG-PRESS (touch) / RIGHT-CLICK SHEET
   ===================================================================== */
let sheet = null, swallowUntil = 0, pressT = 0, pressXY = null, lastFocus = null;
const REASONS = [
  ['sexual', 'Sexual or adult content'], ['violent', 'Violent or graphic'], ['hateful', 'Hateful or harassing'],
  ['spam', 'Spam'], ['copyright', 'Copyright'], ['misleading', 'Misleading'], ['other', 'Something else']
];
function memberRow(u, r) {
  const host = u.id === r.admin_id;
  const flag = Nova.geo && Nova.geo.flag && u.country_code ? Nova.geo.flag(u.country_code, 22) : '';
  return `<li class="rc-m"><button type="button" class="uav${host ? ' host' : ''}" data-user-id="${esc(u.id)}" aria-label="Open ${esc(u.full_name || u.username || 'profile')}">${Nova.avatar(u, 44)}${host ? `<span class="rc-crown">${ic('crown', 17)}</span>` : ''}</button>
    <span class="rc-mn"><b>${esc(u.full_name || u.username || 'Someone')}</b>${u.username ? `<small>@${esc(u.username)}</small>` : ''}</span><span class="rc-mf">${flag}</span></li>`;
}
function openMenu(id, from) {
  const a = api(); if (!a) return;
  const r = a.byId(id); if (!r) return;
  if (sheet && sheet.id === id) return;
  closeMenu(true);
  deactivate();
  lastFocus = from || document.activeElement;
  const ov = document.createElement('div'); ov.className = 'rc-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = '<div class="rc-sheet"><button type="button" class="rc-close" aria-label="Close" data-a="close">' + ic('x', 20) + '</button><div class="rc-body"></div></div>';
  document.body.appendChild(ov);
  document.documentElement.classList.add('rc-lock');
  sheet = { id, ov, body: $('.rc-body', ov), mode: 'main', media: null, dur: 0, tick: 0, reason: 'sexual' };
  ov.addEventListener('click', onSheetClick);
  ov.addEventListener('change', e => { if (sheet && e.target.name === 'rcReason') sheet.reason = e.target.value; });
  buildSheet();
  requestAnimationFrame(() => ov.classList.add('on'));
  sheet.tick = setInterval(paintSheetStatus, 1000);
  const first = $('[data-a="dismiss"], [data-a="join"]', ov); if (first) first.focus({ preventScroll: true });
  try { if (Nova.S && Nova.S.haptic && navigator.vibrate) navigator.vibrate(12); } catch (e) {}
}
function closeMenu(silent) {
  if (!sheet) return;
  clearInterval(sheet.tick);
  if (sheet.media) sheet.media.destroy();
  const ov = sheet.ov; sheet = null;
  document.documentElement.classList.remove('rc-lock');
  if (silent || reduceMotion()) ov.remove(); else { ov.classList.remove('on'); setTimeout(() => ov.remove(), 200); }
  if (!silent && lastFocus && lastFocus.isConnected && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
}
function buildSheet() {
  const a = api(), r = a.byId(sheet.id); if (!r) return closeMenu();
  const invited = !!r.invited, hasMedia = !!r.media;
  /* Delete / Cancel invite only exists for Invited and Friends (or invite-only) rooms — never for public or nearby rooms */
  const canDelete = invited || r.privacy === 'friends' || r.privacy === 'invite';
  const members = r.members || [], more = Math.max(0, (Number(r.count) || 0) - members.length);
  const pv = ((a.PRIV || []).find(x => x[0] === r.privacy) || [])[2] || 'Public';
  sheet.body.innerHTML = `
    <div class="rc-box"><div class="rc-bg">${a.thumb(r.media) ? `<img src="${esc(a.thumb(r.media))}" alt="">` : ''}</div><div class="rc-media"></div>${a.platBadge ? a.platBadge(r.media, 'card') : ''}<button type="button" class="rc-mute rc-mute-s" data-a="mute" aria-label="Unmute"></button></div>
    <div class="rc-head">
      <div class="rc-tx"><div class="rc-t">${esc(roomTitle(r))}</div><div class="rc-s">${esc(provider(r))}</div><div class="rc-st"><span class="rc-state"></span><span class="rc-priv">${privSvg(r.privacy, 15)}<span>${esc(pv)}</span></span></div></div>
      <div class="rc-acts">
        ${canDelete ? `<button type="button" class="rc-act" data-a="dismiss" aria-label="${invited ? 'Cancel invite' : 'Delete room'}" title="${invited ? 'Cancel invite' : 'Delete'}">${ic(invited ? 'uncancel' : 'trash', 22)}</button>` : ''}
        <button type="button" class="rc-act" data-a="report" aria-label="Report video" title="Report video"${hasMedia ? '' : ' disabled'}>${ic('flag', 22)}</button>
      </div>
    </div>
    <div class="rc-panel" hidden></div>
    <ul class="rc-ml">${members.map(u => memberRow(u, r)).join('')}${more ? `<li class="rc-more">+${more} more watching</li>` : ''}</ul>
    <button type="button" class="rc-join" data-a="join">Join room</button>`;
  const box = $('.rc-media', sheet.body);
  sheet.media = mountMedia(box, r, { onDur: d => { sheet.dur = d; paintSheetStatus(); }, onFail: () => { $('.rc-box', sheet.body).classList.remove('live'); } });
  const live = !!sheet.media.el;
  $('.rc-box', sheet.body).classList.toggle('live', live);
  const mb = $('.rc-mute-s', sheet.body); mb.hidden = !live; paintSheetMute();
  fitFrame(box, sheet.media);
  paintSheetStatus();
  showPanel(sheet.mode);
}
function refreshSheet() {
  if (!sheet) return;
  const r = api().byId(sheet.id);
  if (!r) { closeMenu(); api().toast('This room has closed'); return; }
  paintSheetStatus();
}
function paintSheetStatus() {
  if (!sheet) return;
  const r = api().byId(sheet.id); if (!r) return;
  const t = timeline(r, sheet.dur), el = $('.rc-state', sheet.body); if (!el) return;
  el.textContent = (r.media ? (t.playing ? 'Playing' : 'Paused') : 'No video yet') + (r.media ? ' • ' + clock(t.pos) + (t.live ? ' • LIVE' : t.dur ? '/' + clock(t.dur) : '') : '') + ' • ';
}
function paintSheetMute() {
  const b = sheet && $('.rc-mute-s', sheet.body); if (!b) return;
  const muted = sheet.media ? sheet.media.muted : true;
  b.innerHTML = ic(muted ? 'mute' : 'vol', 22); b.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
}
function showPanel(mode) {
  sheet.mode = mode;
  const p = $('.rc-panel', sheet.body), r = api().byId(sheet.id); if (!p || !r) return;
  const acts = $('.rc-acts', sheet.body);
  if (acts) acts.classList.toggle('dim', mode !== 'main');
  if (mode === 'main') { p.hidden = true; p.innerHTML = ''; return; }
  p.hidden = false;
  if (mode === 'dismiss') {
    const inv = !!r.invited;
    p.innerHTML = `<h5>${inv ? 'Cancel this invite?' : 'Delete this room from your list?'}</h5>
      <p>${inv ? 'The room leaves your Invited list and will not come back unless someone invites you again.' : 'The room is hidden from your Nova home. It only returns if someone invites you to it again.'}</p>
      <div class="rc-row"><button type="button" class="rc-b" data-a="back">Back</button><button type="button" class="rc-b rc-danger" data-a="confirm-dismiss">${inv ? 'Cancel invite' : 'Delete'}</button></div>`;
  } else if (mode === 'report') {
    p.innerHTML = `<h5>Report this video</h5><p>Reports are private and reviewed by Nova moderators.</p>
      <div class="rc-rs" role="radiogroup" aria-label="Reason">${REASONS.map(x => `<label><input type="radio" name="rcReason" value="${x[0]}"${x[0] === sheet.reason ? ' checked' : ''}><span>${esc(x[1])}</span></label>`).join('')}</div>
      <textarea id="rcDetails" maxlength="1000" rows="2" placeholder="Add details (optional)"></textarea>
      <div class="rc-row"><button type="button" class="rc-b" data-a="back">Back</button><button type="button" class="rc-b rc-danger" data-a="send-report">Send report</button></div>`;
  }
  try { p.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (e) {}
}
async function onSheetClick(e) {
  if (!sheet) return;
  if (e.target === sheet.ov) return closeMenu();
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const act = b.dataset.a, a = api(), id = sheet.id;
  if (act === 'close') return closeMenu();
  if (act === 'mute') { if (sheet.media && sheet.media.el) { sheet.media.setMuted(!sheet.media.muted); paintSheetMute(); } return; }
  if (act === 'dismiss' || act === 'report') return showPanel(sheet.mode === act ? 'main' : act);
  if (act === 'back') return showPanel('main');
  if (act === 'join') { const r = a.byId(id); closeMenu(true); const c = r && cardEl(r.code); if (c) { swallowUntil = 0; c.click(); } return; }
  if (act === 'confirm-dismiss' || act === 'send-report') {
    b.disabled = true; const old = b.textContent; b.textContent = 'Please wait…';
    try {
      if (act === 'confirm-dismiss') {
        const inv = !!(a.byId(id) || {}).invited;
        await a.dismiss(id);
        const list = a.rooms(), i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1);
        closeMenu(); window.NovaRoom.renderHome();
        a.toast(inv ? 'Invite cancelled' : 'Room removed from your list');
        a.reload();
      } else {
        const d = $('#rcDetails', sheet.body);
        await a.reportVideo(id, sheet.reason, d ? d.value.trim() : '');
        closeMenu(); a.toast('Report sent. Thank you for helping keep Nova safe.');
      }
    } catch (err) {
      b.disabled = false; b.textContent = old;
      if (/function .*room_(dismiss|report_video)|schema cache|does not exist/i.test((err && err.message) || '')) a.toast('Run rooms-schema.sql in Supabase first.', 'err'); else a.oops(err);
    }
  }
}
document.addEventListener('keydown', e => {
  if (!sheet) return;
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  else if (e.key === 'Tab') {                                        // keep focus inside the dialog
    const f = [].slice.call(sheet.ov.querySelectorAll('button:not([disabled]),input,textarea')).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* long-press (touch / pen) and right-click */
function cancelPress() { clearTimeout(pressT); pressT = 0; pressXY = null; }
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' || e.button > 0 || sheet) return;
  const card = e.target.closest && e.target.closest('.room[data-code]'); if (!card) return;
  pressXY = [e.clientX, e.clientY];
  clearTimeout(pressT);
  pressT = setTimeout(() => {
    pressT = 0; swallowUntil = Date.now() + 900;
    openMenu(card.dataset.rid, card);
  }, 480);
}, { passive: true });
document.addEventListener('pointermove', e => {
  if (pressT && pressXY && Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) > 10) cancelPress();
}, { passive: true });
['pointerup', 'pointercancel'].forEach(n => document.addEventListener(n, () => { if (pressT) cancelPress(); }, { passive: true }));
document.addEventListener('scroll', () => { if (pressT) cancelPress(); }, { passive: true, capture: true });
document.addEventListener('contextmenu', e => {
  const card = e.target.closest && e.target.closest('.room[data-code]');
  if (card) { e.preventDefault(); swallowUntil = Date.now() + 900; cancelPress(); openMenu(card.dataset.rid, card); }
});
/* the click that follows a long-press must not join the room (or open a profile) */
document.addEventListener('click', e => {
  if (Date.now() < swallowUntil && e.target.closest && e.target.closest('.room[data-code]')) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

/* =====================================================================
   3. + button sits in the People icon's column on wide screens
   ===================================================================== */
function alignFab() {
  const fab = $('#fab'), ppl = $('#ppl'); if (!fab || !ppl) return;
  const home = $('#home');
  if (innerWidth < 900 || !home || home.hidden || !ppl.offsetWidth) { fab.style.removeProperty('right'); return; }
  const r = ppl.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  fab.style.right = Math.max(8, vw - (r.left + r.width / 2) - fab.offsetWidth / 2) + 'px';
}
addEventListener('resize', alignFab);
addEventListener('load', alignFab);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(alignFab);
new MutationObserver(alignFab).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });

/* ---------- wiring ---------- */
document.addEventListener('pointermove', onMove, { passive: true });
document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && cur && e.target.closest && !e.target.closest('.rc-mute')) { /* clicking opens the room; stop media first */ deactivate(); } }, true);
document.documentElement.addEventListener('pointerleave', () => { if (cur) { clearTimeout(stopT); stopT = setTimeout(() => { stopT = 0; deactivate(); }, 140); } });
addEventListener('blur', () => deactivate());
document.addEventListener('visibilitychange', () => { if (document.hidden) deactivate(); });
addEventListener('scroll', () => { if (cur) place(); }, { passive: true, capture: true });
addEventListener('resize', () => { if (cur) place(); });
document.addEventListener('DOMContentLoaded', () => { alignFab(); afterRender(); });

window.NovaCards = {
  openMenu, closeMenu, afterRender, alignFab,
  swallowClick: e => { if (Date.now() < swallowUntil) { e.preventDefault(); return true; } return false; }
};
})();
