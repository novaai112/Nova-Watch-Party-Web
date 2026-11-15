/* Personal watch queue + YouTube playlist import.
   - panel #pq (inside the platform picker, only while you are in a room)
   - import screen for a playlist (all videos, add all / add one)
   - single-video chooser (play/add to room vs. add to my queue)
   Server: room-pqueue-schema.sql (pq_list / pq_add / pq_remove / pq_clear / pq_reorder / pq_submit). Private per member. */
(function () {
'use strict';
var st = { room: null, items: [], active: null, mode: '', busy: false, loaded: false, error: '', drag: null, hold: 0, holdMsg: '' }, poll = 0, imp = null;
var $ = function (s, r) { return (r || document).querySelector(s); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var NR = function () { return window.NovaRoom; };
var rpc = function (n, a) { return NR().rpc(n, a); };
var toast = function (t, k) { try { NR().api.toast(t, k); } catch (e) { try { Nova.toast(t, k); } catch (x) {} } };
var mkey = function (m) { return m ? (m.id ? 'y:' + m.id : m.pl ? 'p:' + m.pl : (m.url || '').split('#')[0]) : ''; };
var thumbOf = function (m) { return m.thumb || (m.id ? 'https://i.ytimg.com/vi/' + m.id + '/mqdefault.jpg' : ''); };
var ICON = {
  grip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  back: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  vote: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>'
};

/* ---------------- state / server ---------------- */
function active() { return !!(NR() && NR().ready && NR().active() && st.room); }
function apply(d) {
  d = d || {}; st.items = d.items || []; st.active = d.active || null; st.mode = d.mode || ''; st.loaded = true; st.error = '';
  clearTimeout(poll); if (st.room && (st.active || st.items.length)) poll = setTimeout(load, 7000);   /* notices when my vote round is over */
}
function load() {
  var rid = st.room; if (!rid) return Promise.resolve();
  return rpc('pq_list', { p_room: rid }).then(function (d) { if (st.room !== rid) return; apply(d); paint(); refreshImport(); autoSubmit(); })
    .catch(function (e) { if (st.room !== rid) return; st.loaded = true; st.error = fail(e); paint(); });
}
function fail(e) {
  var m = (e && e.message) || 'Something went wrong';
  return /schema cache|does not exist|Could not find the function/i.test(m) ? 'Run room-pqueue-schema.sql in Supabase first.' : m;
}
function run(fn, okMsg) {
  if (st.busy) return Promise.resolve(); st.busy = true; paint();
  return fn().then(function (r) { st.busy = false; if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return load().then(function () { return r; }); })
    .catch(function (e) { st.busy = false; toast(fail(e), 'err'); return load(); });
}
function addMany(list) {
  var rid = st.room; if (!rid || !list.length) return Promise.resolve(null);
  return rpc('pq_add', { p_room: rid, p_items: list.slice(0, 500) }).then(function (r) {
    toast(r.added ? ('Added ' + r.added + (r.added === 1 ? ' video' : ' videos') + (r.duplicates ? ' · ' + r.duplicates + ' already in your queue' : '')) : (r.duplicates ? 'Already in your queue' : 'Nothing could be added'), r.added ? '' : 'err');
    return load().then(function () { return r; });
  }).catch(function (e) { toast(fail(e), 'err'); return null; });
}
/* AUTOMATIC: when I have nothing in the room vote, my first pending video is sent (one at a time, in my order).
   The server refuses a second one while the first is still in the vote, so two tabs / quick reloads cannot double-submit. */
function autoSubmit() {
  var rid = st.room;
  if (!rid || !st.loaded || st.busy || st.active || !st.items.length || Date.now() < st.hold || !active()) return;
  st.busy = true; paint();
  rpc('pq_submit', { p_room: rid }).then(function (r) {
    if (st.room !== rid) return; st.busy = false; st.holdMsg = '';
    toast(r && r.action === 'played' ? 'Playing now: ' + (r.title || 'your video') : 'Sent to the vote: ' + (r && r.title ? r.title : 'your video'));
    try { NR().refreshQueue && NR().refreshQueue(); } catch (e) {}
    return load();
  }).catch(function (e) {
    if (st.room !== rid) return; st.busy = false; st.hold = Date.now() + 30000; st.holdMsg = fail(e);   /* try again in 30 s, no toast spam */
    clearTimeout(poll); poll = setTimeout(load, 30500); paint();
  });
}

/* ---------------- panel ---------------- */
function panel() { return document.getElementById('pq'); }
function paint() {
  var el = panel(); if (!el) return;
  if (!active()) { el.hidden = true; el.innerHTML = ''; return; }
  /* no pending videos (and nothing to report): the whole box stays hidden */
  if (!st.items.length && !(st.error || (Date.now() < st.hold && st.holdMsg)) && !st.busy) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  var n = st.items.length, a = st.active, first = st.items[0];
  var h = '<div class="pq-card" role="region" aria-label="My queue"><div class="pq-head"><h2>My queue <span class="pq-n" aria-live="polite">' + n + '</span></h2>' +
    '<button class="pq-ic" type="button" data-a="clear" aria-label="Clear all" title="Clear all"' + (n && !st.busy ? '' : ' disabled') + '>' + ICON.trash + '<span>Clear all</span></button></div>' +
    '<p class="pq-sub">Only you can see this list. Your videos go to the room vote one at a time, in this order, automatically.</p>';
  if (a) h += '<div class="pq-live" role="status"><i></i><span>In the room vote: <b>' + esc((a.media || {}).title || 'your video') + '</b>. Your next video can go in when this round ends.</span></div>';
  var em = st.error || (Date.now() < st.hold ? st.holdMsg : ''); if (em) h += '<p class="pq-err" role="alert">' + esc(em) + '</p>';
  if (n) {
    h += '<div class="pq-bar"><span class="pq-hint">' + (a ? 'Your next video is sent to the vote automatically when this round ends.' : st.busy ? 'Sending your next video to the vote…' : 'Next: ' + esc((first.media || {}).title || '')) + '</span></div>';
    h += '<ul class="pq-list" id="pqList">' + st.items.map(function (it, i) { return row(it, i); }).join('') + '</ul>';
  }
  h += '</div>';
  var keep = el.querySelector('.pq-list'), top = keep ? keep.scrollTop : 0;
  el.innerHTML = h;
  var nl = el.querySelector('.pq-list'); if (nl) nl.scrollTop = top;
}
function row(it, i) {
  var m = it.media || {}, t = thumbOf(m), meta = [m.ch, m.d].filter(Boolean).map(esc).join(' · ');
  return '<li class="pq-item" data-id="' + esc(it.id) + '" data-i="' + i + '"><button class="pq-grip" type="button" aria-label="Reorder ' + esc(m.title) + '. Drag, or use the up and down arrow keys" title="Drag to reorder">' + ICON.grip + '</button>' +
    '<span class="pq-pos">' + (i + 1) + '</span>' +
    '<span class="pq-th"' + (t ? ' style="background-image:url(' + esc(t) + ')"' : '') + '>' + (m.d ? '<em>' + esc(m.d) + '</em>' : '') + '</span>' +
    '<span class="pq-tx"><b>' + esc(m.title || 'Video') + '</b>' + (meta ? '<small>' + meta + '</small>' : '') + '</span>' +
    '<button class="pq-rm" type="button" data-a="rm" data-id="' + esc(it.id) + '" aria-label="Remove ' + esc(m.title) + '" title="Remove">' + ICON.x + '</button></li>';
}
function persist(ids) {
  var rid = st.room, before = st.items.slice();
  var map = {}; st.items.forEach(function (x) { map[x.id] = x; });
  st.items = ids.map(function (id) { return map[id]; }).filter(Boolean); paint();
  rpc('pq_reorder', { p_room: rid, p_ids: ids }).then(function () { return load(); }).catch(function (e) { st.items = before; paint(); toast(fail(e), 'err'); });
}
function moveBy(id, d) {
  var ids = st.items.map(function (x) { return x.id; }), i = ids.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) return;
  ids.splice(j, 0, ids.splice(i, 1)[0]); persist(ids);
  setTimeout(function () { var g = document.querySelector('.pq-item[data-id="' + id + '"] .pq-grip'); if (g) g.focus(); }, 0);
}

/* drag & drop (mouse, pen and touch) - started from the grip only, so the list still scrolls normally */
function dragStart(ev) {
  var g = ev.target.closest('.pq-grip'); if (!g || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
  var li = g.closest('.pq-item'), ul = li.parentNode, rows = [].slice.call(ul.children);
  ev.preventDefault();
  st.drag = { li: li, ul: ul, rows: rows, from: rows.indexOf(li), to: rows.indexOf(li), y0: ev.clientY, sc: ul.scrollTop, pid: ev.pointerId,
    h: li.getBoundingClientRect().height, tops: rows.map(function (r) { var b = r.getBoundingClientRect(); return b.top + b.height / 2; }) };
  li.classList.add('drag'); ul.classList.add('dragging');
  try { g.setPointerCapture(ev.pointerId); } catch (e) {}
}
function dragMove(ev) {
  var d = st.drag; if (!d || ev.pointerId !== d.pid) return;
  var dy = ev.clientY - d.y0 + (d.ul.scrollTop - d.sc), r = d.ul.getBoundingClientRect();
  if (ev.clientY < r.top + 36) d.ul.scrollTop -= 12; else if (ev.clientY > r.bottom - 36) d.ul.scrollTop += 12;
  d.li.style.transform = 'translateY(' + dy + 'px)';
  var mid = d.tops[d.from] + dy - (d.ul.scrollTop - d.sc), to = 0;
  d.tops.forEach(function (t, i) { if (i !== d.from && t < mid) to++; });
  d.to = to;
  d.rows.forEach(function (row, i) {
    if (row === d.li) return;
    var sh = (d.from < to && i > d.from && i <= to) ? -d.h : (d.from > to && i < d.from && i >= to) ? d.h : 0;
    row.style.transform = sh ? 'translateY(' + sh + 'px)' : '';
  });
}
function dragEnd(ev) {
  var d = st.drag; if (!d || (ev && ev.pointerId !== d.pid)) return; st.drag = null;
  d.li.classList.remove('drag'); d.ul.classList.remove('dragging');
  d.rows.forEach(function (r) { r.style.transform = ''; });
  if (ev && ev.type === 'pointercancel') return;
  if (d.to !== d.from) { var ids = st.items.map(function (x) { return x.id; }); ids.splice(d.to, 0, ids.splice(d.from, 1)[0]); persist(ids); }
}

function onClick(ev) {
  var b = ev.target.closest('[data-a]'); if (!b || !panel() || !panel().contains(b) || b.disabled) return;
  var a = b.dataset.a;
  if (a === 'rm') run(function () { return rpc('pq_remove', { p_room: st.room, p_id: b.dataset.id }); });
  else if (a === 'clear') {
    if (!st.items.length) return;
    if (window.confirm('Remove all ' + st.items.length + ' videos from your queue?')) run(function () { return rpc('pq_clear', { p_room: st.room }); }, 'Queue cleared');
  }
}
function onKey(ev) {
  var g = ev.target.closest && ev.target.closest('.pq-grip'); if (!g) return;
  var id = g.closest('.pq-item').dataset.id;
  if (ev.key === 'ArrowUp') { ev.preventDefault(); moveBy(id, -1); } else if (ev.key === 'ArrowDown') { ev.preventDefault(); moveBy(id, 1); }
}

/* ---------------- playlist import screen ---------------- */
function importPlaylist(m) {
  closeImport();
  var o = document.createElement('div'); o.id = 'pqi'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Import playlist');
  o.innerHTML = '<div class="pqi-bar"><button class="pqi-back" type="button" data-i="close" aria-label="Back">' + ICON.back + '</button><h2>Import playlist</h2><span></span></div>' +
    '<div class="pqi-sc"><div class="pqi-top"><span class="pqi-cover"></span><div><h3></h3><p class="pqi-by"></p><p class="pqi-ct" aria-live="polite">Loading videos…</p></div></div>' +
    '<div class="pqi-act"><button class="pqi-all" type="button" data-i="all" disabled>' + ICON.plus + '<span>Add all to my queue</span></button></div><ul class="pqi-list"></ul><p class="pqi-msg"></p></div>';
  document.body.appendChild(o);
  imp = { el: o, pl: m.pl, media: m, list: [], seen: {}, token: '', done: false, loading: false, gen: Date.now(), err: '' };
  $('h3', o).textContent = m.title || 'YouTube playlist';
  if (m.thumb) $('.pqi-cover', o).style.backgroundImage = 'url(' + m.thumb + ')';
  o.addEventListener('click', onImportClick); document.addEventListener('keydown', impKey, true);
  document.documentElement.classList.add('pqi-open');
  if (window.NovaAdd && NovaAdd.ytInfo) NovaAdd.ytInfo('', m.pl).then(function (v) { if (!imp || imp.pl !== m.pl) return; if (v.title) $('h3', o).textContent = v.title; $('.pqi-by', o).textContent = v.channel || ''; if (v.thumb) $('.pqi-cover', o).style.backgroundImage = 'url(' + v.thumb + ')'; }).catch(function () {});
  $('.pqi-back', o).focus(); pageMore();
}
function impKey(ev) { if (ev.key === 'Escape' && imp) { ev.stopImmediatePropagation(); closeImport(); } }
function closeImport() { if (!imp) return; document.removeEventListener('keydown', impKey, true); imp.el.remove(); imp = null; document.documentElement.classList.remove('pqi-open'); }
function pageMore() {
  var s = imp; if (!s || s.loading || s.done) return; s.loading = true;
  NovaAdd.ytPlaylistItems(s.pl, s.token).then(function (j) {
    if (imp !== s) return; s.loading = false;
    (j.items || []).forEach(function (x) { if (x.id && !s.seen[x.id]) { s.seen[x.id] = 1; s.list.push(x); } });
    s.token = j.next || ''; s.done = !s.token || s.list.length >= 500;
    refreshImport(); if (!s.done) pageMore();
  }).catch(function (e) { if (imp !== s) return; s.loading = false; s.done = true; s.err = (e && e.message) || 'Could not load this playlist'; refreshImport(); });
}
function have() { var h = {}; st.items.forEach(function (x) { h[mkey(x.media)] = 1; }); if (st.active) h[mkey(st.active.media)] = 1; return h; }
function toMedia(x) { return { kind: 'youtube', id: x.id, title: x.title, provider: 'youtube', thumb: x.thumb || '', ch: x.channel || '', d: x.dur || '' }; }
function refreshImport() {
  var s = imp; if (!s) return; var h = have(), o = s.el, left = s.list.filter(function (x) { return !h['y:' + x.id]; }).length;
  $('.pqi-ct', o).textContent = s.list.length + (s.list.length === 1 ? ' video' : ' videos') + (s.loading ? ' · loading more…' : '') + (s.list.length && left === 0 ? ' · all in your queue' : '');
  var all = $('.pqi-all', o); all.disabled = !left || st.busy; $('span', all).textContent = left ? 'Add all ' + left + ' to my queue' : 'All added';
  $('.pqi-msg', o).textContent = s.err || (!s.list.length && !s.loading ? 'No playable videos found in this playlist.' : '');
  var ul = $('.pqi-list', o), cur = ul.children.length;
  if (cur > s.list.length) { ul.innerHTML = ''; cur = 0; }
  var html = ''; for (var i = cur; i < s.list.length; i++) html += impRow(s.list[i], i);
  if (html) ul.insertAdjacentHTML('beforeend', html);
  [].forEach.call(ul.children, function (li) { var inq = !!h['y:' + li.dataset.vid], b = li.querySelector('button'); li.classList.toggle('in', inq); b.disabled = inq; b.innerHTML = inq ? ICON.check : ICON.plus; b.setAttribute('aria-label', (inq ? 'In your queue: ' : 'Add to my queue: ') + li.dataset.t); });
}
function impRow(x, i) {
  return '<li class="pqi-row" data-vid="' + esc(x.id) + '" data-i="' + i + '" data-t="' + esc(x.title) + '"><span class="pqi-th" style="background-image:url(' + esc(x.thumb || 'https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg') + ')">' + (x.dur ? '<em>' + esc(x.dur) + '</em>' : '') + '</span>' +
    '<span class="pqi-tx"><b>' + esc(x.title) + '</b><small>' + esc(x.channel || '') + '</small></span><button type="button" data-i="one"></button></li>';
}
function onImportClick(ev) {
  var b = ev.target.closest('[data-i]'); if (!b || !imp) return; var a = b.dataset.i, s = imp;
  if (a === 'close') closeImport();
  else if (a === 'one') { var li = b.closest('.pqi-row'), x = s.list[+li.dataset.i]; if (x) addMany([toMedia(x)]); }
  else if (a === 'all') { var h = have(); addMany(s.list.filter(function (x) { return !h['y:' + x.id]; }).map(toMedia)); }

}


/* not in a room yet: the playlist's first video starts the room (synced, as any single video) and the rest land in my queue */
function startFromPlaylist(m, fallback) {
  var all = [], seen = {}, tok = '';
  toast('Loading playlist…');
  (function page() {
    NovaAdd.ytPlaylistItems(m.pl, tok).then(function (j) {
      (j.items || []).forEach(function (x) { if (x.id && !seen[x.id]) { seen[x.id] = 1; all.push(x); } });
      tok = j.next || ''; if (tok && all.length < 500) return page(); finish();
    }).catch(function (e) { toast((e && e.message) || 'Could not load this playlist', 'err'); });
  })();
  function finish() {
    if (!all.length) { toast('No playable videos in this playlist', 'err'); return; }
    var f = all[0];
    NR().handle(NovaAdd.ytMedia({ id: f.id, title: f.title, thumb: f.thumb }), { now: true }).then(function (ok) {
      if (!ok || all.length < 2) return;
      return addMany(all.slice(1).map(toMedia)).then(function (r) { if (r && r.added) toast('Playing the first video. ' + r.added + ' more are in My queue.'); });
    });
  }
}

/* ---------------- single video chooser ---------------- */
function chooseSingle(m, onRoom, opt) {
  var busy = false; try { busy = !!NR().ctx().busy; } catch (e) {}
  var o = document.createElement('div'); o.className = 'pqc'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
  var t = thumbOf(m), meta = opt && (opt.channel || opt.dur) ? [opt.channel, opt.dur].filter(Boolean).map(esc).join(' · ') : '';
  o.innerHTML = '<div class="pqc-card"><div class="pqc-v"><span class="pqc-th"' + (t ? ' style="background-image:url(' + esc(t) + ')"' : '') + '></span><div><b>' + esc(m.title || 'Video') + '</b>' + (meta ? '<small>' + meta + '</small>' : '') + '</div></div>' +
    '<button class="pqc-p" data-c="room" type="button">' + (busy ? 'Add to room vote' : 'Play now') + '</button>' +
    (m.id ? '<button class="pqc-s" data-c="mine" type="button">' + ICON.plus + ' Add to my queue</button>' : '') + '<button class="pqc-x" data-c="no" type="button">Cancel</button></div>';
  function done() { document.removeEventListener('keydown', key, true); o.remove(); }
  function key(ev) { if (ev.key === 'Escape') { ev.stopImmediatePropagation(); done(); } }
  o.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-c]'); if (ev.target === o) return done(); if (!b) return;
    var c = b.dataset.c; done();
    if (c === 'room') onRoom(!busy);
    else if (c === 'mine') addMany([{ kind: 'youtube', id: m.id, title: m.title, provider: 'youtube', thumb: m.thumb || '', ch: (opt && opt.channel) || '', d: (opt && opt.dur) || '' }]);
  });
  document.addEventListener('keydown', key, true); document.body.appendChild(o); $('.pqc-p', o).focus();
}

/* ---------------- lifecycle ---------------- */
function onRoom(ev) {
  var id = ev && ev.detail && ev.detail.id || null;
  clearTimeout(poll); closeImport();
  if (id === st.room && id) { load(); return; }
  st = { room: id, items: [], active: null, mode: '', busy: false, loaded: false, error: '', drag: null, hold: 0, holdMsg: '' };
  paint(); if (id) load();
}
function init() {
  var el = panel(); if (!el) return;
  el.addEventListener('click', onClick); el.addEventListener('keydown', onKey);
  el.addEventListener('pointerdown', dragStart); el.addEventListener('pointermove', dragMove);
  el.addEventListener('pointerup', dragEnd); el.addEventListener('pointercancel', dragEnd);
  document.addEventListener('nova:room', onRoom);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && st.room) load(); });
  try { if (NR() && NR().active()) onRoom({ detail: { id: NR().roomId() } }); } catch (e) {}
}
window.NovaPQ = { active: active, importPlaylist: importPlaylist, startFromPlaylist: startFromPlaylist, chooseSingle: chooseSingle, add: addMany, reload: load, _mkey: mkey };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
