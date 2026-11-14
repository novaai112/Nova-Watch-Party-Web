/* room-dock.js — Nova Home beside (or above) the Watch room, without leaving the room.
   The dock button in the room header (left of the Leave X) slides the whole room over and shows Nova Home
   (the same one-column page as on a phone: rooms, search, hover / right-click preview, tap to join) in the freed space.
   Its Settings and People buttons open the real Settings / Friends pages inside the panel (profile.html?embed=1),
   so chat, friends, recent and blocked all work while the room keeps playing.
   Laptop / monitor: Home column on the left, room on the right.  Tablet: two halves side by side.
   Phone (portrait): Home on the top half, room on the bottom half.
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
  refit();
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
  body.classList.remove('nv-dock', 'nv-dock-stack', 'nv-dock-anim');
  /* the platform picker belongs to the Home column only while docked */
  paintButton(); refit();
  if (window.NovaCards) setTimeout(NovaCards.alignFab, 0);
}

/* ---------- Settings / Friends inside the panel ---------- */
const SECTIONS = { settings: '#settings', friends: '#friends' };
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
  el.hidden = false; panelName = name; body.classList.add('nv-dock-panel');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.className = 'nvdp-frame'; frame.title = name === 'friends' ? 'Friends' : 'Settings';
    frame.setAttribute('allow', 'camera; microphone; geolocation; clipboard-write; autoplay');
    frame.addEventListener('load', () => { el.classList.add('ready'); });
    frame.src = 'profile.html?embed=1' + hash;
    el.appendChild(frame);
  } else {
    frame.title = name === 'friends' ? 'Friends' : 'Settings';
    try { frame.contentWindow.postMessage({ nova: 'dock-go', hash }, location.origin); } catch (e) {}
  }
}
function closePanel() {
  if (!panelEl || panelEl.hidden) return;
  panelEl.hidden = true; panelName = ''; body.classList.remove('nv-dock-panel');
}
addEventListener('message', e => {
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
  const d = e.data; if (!d || d.nova !== 'dock') return;
  if (d.type === 'close') closePanel();
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
