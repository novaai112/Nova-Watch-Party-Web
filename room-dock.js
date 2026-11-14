/* room-dock.js — Nova Home beside (or above) the Watch room, without leaving the room.
   The dock button in the room header (left of the Leave X) slides the whole room over and shows Nova Home
   (the same one-column page as on a phone: rooms, search, hover / right-click preview, tap to join) in the freed space.
   Its Settings and People buttons open the real Settings / Friends pages inside the panel (profile.html?embed=1),
   so chat, friends, recent and blocked all work while the room keeps playing.
   Laptop / monitor: Home column on the left, room on the right.  Tablet: two halves side by side.
   Phone (portrait): Home on the top half, room on the bottom half.
   The line between the two halves can be dragged (mouse, touch or arrow keys) to make either side bigger; double-click / double-tap resets it.
   Needs room.js (calls attach / close / toggle) and room-dock.css. */
(function () {
'use strict';
const KEY = 'nova_dock';
const body = document.body;
const stackMq = matchMedia('(max-width:599px)');
let open = false, rm = null, ro = null, frame = null, panelEl = null, panelName = '', animT = 0;

const $ = (s, r) => (r || document).querySelector(s);
const store = v => { try { v == null ? sessionStorage.removeItem(KEY) : sessionStorage.setItem(KEY, v); } catch (e) {} };
const stored = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const room = () => $('#rm');

function paintButton() {
  const b = $('#rm .rdock'); if (!b) return;
  b.setAttribute('aria-pressed', open ? 'true' : 'false');
  const t = open ? 'Hide Nova Home' : 'Show Nova Home';
  b.setAttribute('aria-label', t); b.title = t;
}
function refit() { const r = room(); if (r && r._fit) r._fit(); }
function syncStack() {
  body.classList.toggle('nv-dock-stack', open && stackMq.matches);
  paintResizer(); applySize();
}
/* the room switches to its one-column (phone) layout whenever it is narrower than 900px, docked or not */
function watchWidth(r) {
  if (ro) ro.disconnect();
  const apply = () => r.classList.toggle('rm-compact', r.clientWidth < 900);
  apply();
  if (window.ResizeObserver) { ro = new ResizeObserver(apply); ro.observe(r); }
}

function openDock(opts) {
  if (open || !room()) return;
  open = true; store('1');
  body.classList.add('nv-dock');
  if (!(opts && opts.instant)) {
    body.classList.add('nv-dock-anim'); clearTimeout(animT);
    animT = setTimeout(() => body.classList.remove('nv-dock-anim'), 360);
  }
  ensureResizer(); applySize(); paintResizer();
  syncStack(); paintButton();
  const w = $('.wrap'); if (w) w.scrollTop = 0;
  if (window.NovaRoom && NovaRoom.api) NovaRoom.api.reload();      // fresh room list the moment the Home column appears
  if (window.NovaCards) setTimeout(NovaCards.alignFab, 0);
}
function closeDock(silent) {
  closePanel();
  if (!open) return;
  open = false;
  if (silent) store(null); else store('0');
  body.classList.remove('nv-dock', 'nv-dock-stack', 'nv-dock-anim', 'nv-dock-drag'); dragging = false;
  applySize();
  /* the platform picker belongs to the Home column only while docked */
  paintButton(); refit();
  if (window.NovaCards) setTimeout(NovaCards.alignFab, 0);
}

/* ---------- resizable split ---------- */
const SIZE_KEY = 'nova_dock_size';                 // { w: share of the screen width, h: share of the screen height }
let size = {}, rz = null, dragging = false, moved = false, sx = 0, sy = 0, raf = 0;
try { const v = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null'); if (v && typeof v === 'object') size = v; } catch (e) {}
const saveSize = () => { try { localStorage.setItem(SIZE_KEY, JSON.stringify(size)); } catch (e) {} };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const VW = () => document.documentElement.clientWidth, VH = () => window.innerHeight;
function limits() {
  if (stackMq.matches) { const max = Math.max(150, VH() - 260); return { min: Math.min(130, max), max }; }   // phone: Home on top, room below
  const max = Math.max(300, VW() - 340); return { min: Math.min(280, max), max };                         // side by side
}
function applySize() {
  body.style.removeProperty('--dk-w'); body.style.removeProperty('--dk-h');
  if (!open) return;
  const L = limits();
  if (stackMq.matches) { if (size.h) body.style.setProperty('--dk-h', Math.round(clamp(size.h * VH(), L.min, L.max)) + 'px'); }
  else if (size.w) body.style.setProperty('--dk-w', Math.round(clamp(size.w * VW(), L.min, L.max)) + 'px');
  refit();
}
function ensureResizer() {
  if (rz) return rz;
  rz = document.createElement('div');
  rz.id = 'nvDockResize'; rz.tabIndex = 0;
  rz.setAttribute('role', 'separator'); rz.setAttribute('title', 'Drag to resize · double-click to reset');
  rz.innerHTML = '<i aria-hidden="true"></i>';
  rz.addEventListener('pointerdown', e => {
    if (!open || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); dragging = true; moved = false; sx = e.clientX; sy = e.clientY; body.classList.add('nv-dock-drag');
    try { rz.setPointerCapture(e.pointerId); } catch (err) {}
  });
  rz.addEventListener('pointermove', e => {
    if (!dragging) return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) moved = true;
    const L = limits();
    if (stackMq.matches) size.h = clamp(e.clientY, L.min, L.max) / VH(); else size.w = clamp(e.clientX, L.min, L.max) / VW();
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; applySize(); });
  });
  const end = e => {
    if (!dragging) return; dragging = false; body.classList.remove('nv-dock-drag');
    try { rz.releasePointerCapture(e.pointerId); } catch (err) {}
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    applySize(); saveSize();
  };
  rz.addEventListener('pointerup', end); rz.addEventListener('pointercancel', end);
  rz.addEventListener('lostpointercapture', end);
  rz.addEventListener('dblclick', resetSize);
  let tap = 0;                                                  // double-tap on touch screens
  rz.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') return; if (moved) { tap = 0; return; } const n = Date.now(); if (n - tap < 320) { tap = 0; resetSize(); } else tap = n; });
  rz.addEventListener('keydown', e => {
    const k = e.key, st = stackMq.matches, step = e.shiftKey ? 64 : 16;
    const dec = st ? 'ArrowUp' : 'ArrowLeft', inc = st ? 'ArrowDown' : 'ArrowRight';
    if (k !== dec && k !== inc && k !== 'Home') return;
    e.preventDefault();
    if (k === 'Home') return resetSize();
    const L = limits(), cur = st ? (parseFloat(getComputedStyle(body).getPropertyValue('--dk-h')) || $('.wrap').getBoundingClientRect().height)
                                 : (parseFloat(getComputedStyle(body).getPropertyValue('--dk-w')) || $('.wrap').getBoundingClientRect().width);
    const next = clamp(cur + (k === inc ? step : -step), L.min, L.max);
    if (st) size.h = next / VH(); else size.w = next / VW();
    applySize(); saveSize();
  });
  body.appendChild(rz);
  return rz;
}
function paintResizer() {
  if (!rz) return;
  const st = stackMq.matches;
  rz.setAttribute('aria-orientation', st ? 'horizontal' : 'vertical');
  rz.setAttribute('aria-label', 'Resize Nova Home and the room');
}
function resetSize() { size = {}; saveSize(); applySize(); }
addEventListener('resize', () => { if (open) { applySize(); } });

/* ---------- the + button while Settings / Friends / Profile cover the Home column ---------- */
let fabEl = null, panelHash = '';
function paintFab() {
  const show = open && panelEl && !panelEl.hidden && !/^#(friends|chat)/.test(panelHash);   // those pages have their own bottom bar
  if (!show) { if (fabEl) fabEl.hidden = true; return; }
  if (!fabEl) {
    fabEl = document.createElement('button');
    fabEl.id = 'nvDockFab'; fabEl.type = 'button'; fabEl.setAttribute('aria-label', 'Start a watch party'); fabEl.title = 'Start a watch party';
    fabEl.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>';
    fabEl.addEventListener('click', () => { closePanel(); const f = document.getElementById('fab'); if (f) f.click(); });
    body.appendChild(fabEl);
  }
  fabEl.hidden = false;
}

/* ---------- Settings / Friends inside the panel ---------- */
const SECTIONS = { profile: '#home', settings: '#settings', friends: '#friends' };
const TITLES = { profile: 'Profile', settings: 'Settings', friends: 'Friends' };
function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = 'nvDockPanel'; panelEl.hidden = true;
  panelEl.setAttribute('role', 'region'); panelEl.setAttribute('aria-label', 'Nova');
  panelEl.innerHTML = '<div class="nvdp-load" aria-live="polite"><i class="spin" aria-hidden="true"></i><span>Loading…</span></div>';
  body.appendChild(panelEl);
  return panelEl;
}
function openPanel(name) {
  if (!open || !SECTIONS[name]) return;
  const el = ensurePanel(), hash = SECTIONS[name];
  el.hidden = false; panelName = name; panelHash = hash; body.classList.add('nv-dock-panel'); paintFab();
  if (!frame) {
    frame = document.createElement('iframe');
    frame.className = 'nvdp-frame'; frame.title = TITLES[name];
    frame.setAttribute('allow', 'camera; microphone; geolocation; clipboard-write; autoplay');
    frame.addEventListener('load', () => { el.classList.add('ready'); });
    frame.src = 'profile.html?embed=1' + hash;
    el.appendChild(frame);
  } else {
    frame.title = TITLES[name];
    try { frame.contentWindow.postMessage({ nova: 'dock-go', hash }, location.origin); } catch (e) {}
  }
}
function closePanel() {
  if (!panelEl || panelEl.hidden) return;
  panelEl.hidden = true; panelName = ''; panelHash = ''; body.classList.remove('nv-dock-panel'); paintFab();
}
addEventListener('message', e => {
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
  const d = e.data; if (!d || d.nova !== 'dock') return;
  if (d.type === 'close') closePanel();
  else if (d.type === 'route' && typeof d.hash === 'string') { panelHash = d.hash.slice(0, 80); paintFab(); }
  else if (d.type === 'join' && typeof d.code === 'string' && /^[A-Za-z0-9]{6,16}$/.test(d.code) && window.NovaRoom && NovaRoom.join) {
    NovaRoom.join(d.code).then(() => { if (room()) closePanel(); });
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && panelEl && !panelEl.hidden && !document.getElementById('nvg')) { e.stopPropagation(); closePanel(); }
}, true);

stackMq.addEventListener ? stackMq.addEventListener('change', syncStack) : stackMq.addListener(syncStack);

window.NovaDock = {
  isOpen: () => open,
  toggle: () => (open ? closeDock() : openDock()),
  open: openDock, close: closeDock,
  panel: openPanel, closePanel, panelName: () => panelName,
  /* called by room.js each time the room screen is (re)built */
  attach(r) {
    rm = r; watchWidth(r);
    if (open && !body.classList.contains('nv-dock')) body.classList.add('nv-dock');
    if (!open && stored()) openDock({ instant: true });       // a reload while docked comes back docked
    else { syncStack(); paintButton(); }
  }
};
})();
