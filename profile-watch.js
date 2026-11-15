/* Watch activity rows for the profile "Watch Activity" section (own profile).
   Most watched / History / Likes: each one a horizontally scrollable row (scrollbar hidden, arrows on desktop).
   Data = the same device lists the History and Likes screens use (localStorage nova.h / nova.likes).
   Tap a video -> it is played to the watch room (through the dock when embedded, else nova-home opens and plays it). */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var H = 'nova.h', L = 'nova.likes';
  var key = function (v) { return v.id || v.pl || v.url || v.t; };
  function read(k) {
    var seen = {}, out = [];
    try { var a = JSON.parse(localStorage.getItem(k) || '[]'); (Array.isArray(a) ? a : []).forEach(function (v) { if (v && typeof v === 'object' && key(v) && !seen[key(v)]) { seen[key(v)] = 1; out.push(v); } }); } catch (e) {}
    return out;
  }
  /* the account copy (what other people may see, per the visibility settings); the device lists stay the source here */
  var itemUrl = function (v) { return v.url || (v.id ? 'https://www.youtube.com/watch?v=' + v.id : v.pl ? 'https://www.youtube.com/playlist?list=' + v.pl : ''); };
  function srv(name, args) { try { var sb = window.Nova && Nova.sb; if (sb && sb.rpc) { var r = sb.rpc(name, args); if (r && r.then) r.then(function () {}, function () {}); } } catch (e) {} }
  var syncT = 0;
  function syncUp() { clearTimeout(syncT); syncT = setTimeout(function () { srv('sync_watch_activity', { p_history: read(H).slice(0, 200), p_likes: read(L).slice(0, 200) }); }, 400); }
  function write(k, a) { try { localStorage.setItem(k, JSON.stringify(a)); return true; } catch (e) { return false; } }
  var thumb = function (v) { return v.th && /^https:/.test(v.th) ? v.th : v.id ? 'https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/mqdefault.jpg' : ''; };
  var ICO = {
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    heart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/></svg>',
    l: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>',
    r: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>'
  };
  function card(v, kind) {
    var th = thumb(v), k = esc(key(v)), meta = [v.ch, kind === 'top' ? 'Watched ' + (v.n || 1) + '\u00d7' : ''].filter(Boolean).map(esc).join(' · ');
    return '<div class="wa-c" data-k="' + k + '"><button class="wa-p" type="button" data-wplay="' + kind + '" data-k="' + k + '" aria-label="Play ' + esc(v.t || 'video') + ' in the room">' +
      '<span class="wa-th"' + (th ? ' style="background-image:url(' + esc(th) + ')"' : '') + '>' + (v.d ? '<em>' + esc(v.d) + '</em>' : '') + (kind === 'top' ? '<i>' + (v.n || 1) + '\u00d7</i>' : '') + '</span>' +
      '<b>' + esc(v.t || 'Video') + '</b>' + (meta ? '<small>' + meta + '</small>' : '') + '</button>' +
      (kind === 'hist' ? '<button class="wa-x" type="button" data-wdel="' + k + '" aria-label="Remove ' + esc(v.t || 'video') + ' from history" title="Remove from history">' + ICO.x + '</button>' : '') +
      (kind === 'like' ? '<button class="wa-x wa-h" type="button" data-wunlike="' + k + '" aria-label="Remove ' + esc(v.t || 'video') + ' from likes" title="Unlike">' + ICO.heart + '</button>' : '') + '</div>';
  }
  function row(id, title, items, kind, empty, extra, ctl) {
    return '<section class="wa-sec" aria-label="' + esc(title) + '"><div class="wa-h"><h4>' + esc(title) + ' <span>' + items.length + '</span></h4>' + (extra || '') + (ctl || '') +
      '<span class="wa-nav"><button type="button" data-wnav="-1" data-for="' + id + '" aria-label="Scroll left">' + ICO.l + '</button><button type="button" data-wnav="1" data-for="' + id + '" aria-label="Scroll right">' + ICO.r + '</button></span></div>' +
      (items.length ? '<div class="wa-row" id="' + id + '" tabindex="0" role="list">' + items.map(function (v) { return card(v, kind); }).join('') + '</div>' : '<p class="wa-em">' + empty + '</p>') + '</section>';
  }
  var CTL = null;                                               /* (kind) => html of the Public / Friends / Hidden control, own profile only */
  function inner() {
    var hist = read(H), likes = read(L), c = function (k) { return CTL ? CTL(k) : ''; };
    var top = hist.filter(function (v) { return (v.n || 1) >= 2; }).sort(function (a, b) { return (b.n || 1) - (a.n || 1) || (b.at || 0) - (a.at || 0); }).slice(0, 15);
    return row('waTop', 'Most watched', top, 'top', 'Videos you watch more than once show up here.', '', c('top')) +
      row('waHist', 'History', hist, 'hist', 'Nothing watched yet. Videos you play in a room appear here.', hist.length ? '<button class="wa-clr" type="button" data-wclear>' + ICO.trash + '<span>Clear all</span></button>' : '', c('history')) +
      row('waLike', 'Likes', likes, 'like', 'Tap the heart on a video to like it.', '', c('likes'));
  }
  function refresh() { var r = document.getElementById('waRoot'); if (!r) return; var sc = {}; r.querySelectorAll('.wa-row').forEach(function (e) { sc[e.id] = e.scrollLeft; }); r.innerHTML = inner(); r.querySelectorAll('.wa-row').forEach(function (e) { if (sc[e.id]) e.scrollLeft = sc[e.id]; }); }
  function find(list, k) { for (var i = 0; i < list.length; i++) if (String(key(list[i])) === k) return list[i]; return null; }
  function play(v) {
    var item = { t: v.t, id: v.id, pl: v.pl, url: v.url, kind: v.kind, provider: v.provider, d: v.d, th: v.th, ch: v.ch, n: v.n };
    var embedded = false; try { embedded = !!(window.NovaEmbed && NovaEmbed.active); } catch (e) {}
    if (embedded) { try { parent.postMessage({ nova: 'dock', type: 'play', item: item }, location.origin); return; } catch (e) {} }
    try { localStorage.setItem('nova.play', JSON.stringify(item)); } catch (e) {}
    var home = ''; try { home = (typeof HOME !== 'undefined' && HOME) || ''; } catch (e) {}
    location.href = home || 'nova-home.html';
  }
  document.addEventListener('click', function (e) {
    var root = document.getElementById('waRoot'); if (!root || !root.contains(e.target)) return;
    var b;
    if ((b = e.target.closest('[data-wnav]'))) { var r = document.getElementById(b.dataset.for); if (r) r.scrollBy({ left: +b.dataset.wnav * r.clientWidth * 0.8, behavior: 'smooth' }); return; }
    if ((b = e.target.closest('[data-wdel]'))) { var dv = find(read(H), b.dataset.wdel); if (dv && itemUrl(dv)) srv('remove_watch', { p_url: itemUrl(dv) }); write(H, read(H).filter(function (v) { return String(key(v)) !== b.dataset.wdel; })); refresh(); return; }
    if ((b = e.target.closest('[data-wunlike]'))) { var uv = find(read(L), b.dataset.wunlike); if (uv && itemUrl(uv)) srv('set_like', { p_url: itemUrl(uv), p_liked: false }); write(L, read(L).filter(function (v) { return String(key(v)) !== b.dataset.wunlike; })); refresh(); return; }
    if (e.target.closest('[data-wclear]')) {
      var n = read(H).length; if (!n) return;
      var go = function () { srv('clear_watch_history', {}); write(H, []); refresh(); try { Nova.toast('History cleared'); } catch (x) {} };
      if (typeof ask === 'function') ask('Clear all history?', 'This removes all ' + n + ' videos from your watch history on this device. Your likes are not affected.', 'Clear history').then(function (ok) { if (ok) go(); });
      else if (window.confirm('Clear all ' + n + ' videos from your history?')) go();
      return;
    }
    if ((b = e.target.closest('[data-wplay]'))) { var v = find(b.dataset.wplay === 'like' ? read(L) : read(H), b.dataset.k) || find(read(H).concat(read(L)), b.dataset.k); if (v) play(v); }
  });
  window.addEventListener('storage', function (e) { if (e.key === H || e.key === L) refresh(); });
  window.addEventListener('focus', refresh);
  window.NovaWatch = { html: function (ctl) { CTL = typeof ctl === 'function' ? ctl : null; syncUp(); return '<div class="wa" id="waRoot">' + inner() + '</div>'; }, refresh: refresh, _read: read };
})();
