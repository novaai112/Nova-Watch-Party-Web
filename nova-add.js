/* nova-add.js — "add a video to the room" helpers used by nova-home.html
   - talks to the server functions /api/youtube, /api/extract, /api/websearch (visitors never see an API key)
   - understands pasted YouTube links, direct video files (.mp4 .m3u8 …) and any web page
   - confirm popup (Add / Cancel) and a chooser for pages that contain several videos
   Load AFTER nova-core.js.  Exposes window.NovaAdd. */
(function () {
  'use strict';

  /* ---------------- server calls ---------------- */
  function api(path, params) {
    var u = path + '?' + Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(u, { headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var message = j.error || (r.status === 429 ? 'Too many searches — wait a moment and try again.' : 'Something went wrong. Please try again.');
          if (r.status === 404) message = 'Nova video services are not available on this host. Deploy the /api functions or run node dev-server.js locally.';
          var e = new Error(message);
          e.status = r.status; throw e;
        }
        return j;
      });
    }, function () {
      if (location.protocol === 'file:') throw new Error('Nova was opened as a local file, so its video services cannot load. Run node dev-server.js or open the deployed site.');
      if (navigator.onLine === false) throw new Error('You appear to be offline. Check your internet connection and try again.');
      throw new Error('Could not reach Nova video services. Check that the /api functions are deployed and the server is reachable.');
    });
  }
  function ytSearch(o) {
    return api('/api/youtube', { q: o.q, type: o.type === 'playlist' ? 'playlist' : '', eventType: o.eventType, pageToken: o.pageToken, safe: o.safe })
      .then(function (j) { return { items: j.items || [], next: j.next || '' }; });
  }
  function ytInfo(id, pl) { return api('/api/youtube', id ? { id: id } : { pl: pl }); }
  function extract(url) { return api('/api/extract', { url: url }); }
  function webSearch(q) { return api('/api/websearch', { q: q }); }

  /* ---------------- helpers ---------------- */
  function ytMedia(x) {
    var m = { kind: 'youtube', title: x.title || (x.pl && !x.id ? 'YouTube playlist' : 'YouTube video'), provider: 'youtube' };
    if (x.id) m.id = x.id; else m.pl = x.pl;
    if (x.thumb) m.thumb = x.thumb;
    if (x.live) m.live = true;
    return m;
  }
  var MEDIA_RE = /\.(mp4|m4v|webm|ogv|mov|m3u8)(?:$|[?#])/i;
  /* what did the visitor type or paste? -> {t:'yt'|'ytpl'|'file'|'url'|'text', id, pl, url} */
  function parseInput(raw) {
    var s = String(raw || '').trim();
    if (!s) return { t: 'text' };
    var url = null;
    if (/^https?:\/\//i.test(s)) url = s;
    else if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(s) && !/\s/.test(s)) url = 'https://' + s;
    if (!url) return { t: 'text' };
    var u; try { u = new URL(url); } catch (e) { return { t: 'text' }; }
    var h = u.hostname.replace(/^www\.|^m\.|^music\./i, '').toLowerCase(), id = '', pl = u.searchParams.get('list') || '';
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      var p = u.pathname.split('/').filter(Boolean);
      if (p[0] === 'watch') id = u.searchParams.get('v') || '';
      else if (/^(shorts|live|embed|v)$/.test(p[0] || '')) id = p[1] || '';
      if (id === 'videoseries') id = '';
    }
    if (/^[\w-]{11}$/.test(id)) return { t: 'yt', id: id, url: url };
    if (pl && /^[\w-]{10,}$/.test(pl) && (h === 'youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com')) return { t: 'ytpl', pl: pl, url: url };
    if (MEDIA_RE.test(u.pathname + u.search)) return { t: 'file', url: url };
    return { t: 'url', url: url };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function thumbOf(m) {
    if (m.thumb) return m.thumb;
    if (m.kind === 'youtube' && m.id) return 'https://i.ytimg.com/vi/' + m.id + '/mqdefault.jpg';
    return '';
  }

  /* ---------------- popups ---------------- */
  var open = null;
  function close(res) { if (open) { var o = open; open = null; o.el.remove(); document.removeEventListener('keydown', o.key, true); if (o.prev && o.prev.focus) try { o.prev.focus(); } catch (e) {} if (o.done) o.done(res); } }
  function overlay(html, done, label) {
    close();
    var el = document.createElement('div');
    el.className = 'nv-ov'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', label || 'Add video');
    el.innerHTML = html;
    var o = { el: el, done: done, prev: document.activeElement };
    o.key = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close('cancel'); } };
    document.addEventListener('keydown', o.key, true);
    el.addEventListener('mousedown', function (e) { if (e.target === el) close('cancel'); });
    document.body.appendChild(el); open = o;
    var f = el.querySelector('.nv-b.main') || el.querySelector('button'); if (f) f.focus();
    return el;
  }

  /* confirm: show what is about to be added, then Add / Cancel.  cb(now) is only called on Add. */
  function confirm(m, cb, opt) {
    opt = opt || {};
    var th = thumbOf(m), sub = [opt.channel || (m.provider && m.provider !== 'youtube' && m.provider !== 'link' ? m.provider : ''), opt.dur || (m.live ? 'LIVE' : '')].filter(Boolean).join(' · ');
    var busy = false, admin = false;
    try { var c = window.NovaRoom && NovaRoom.ctx && NovaRoom.ctx(); busy = !!(c && c.busy); admin = !!(c && c.admin); } catch (e) {}
    var el = overlay(
      '<div class="nv-card">' +
        '<div class="nv-th">' + (th ? '<img alt="" src="' + esc(th) + '" referrerpolicy="no-referrer">' : '<span class="nv-ph" aria-hidden="true">▶</span>') + '</div>' +
        '<div class="nv-bd"><p class="nv-k">Add this video?</p><h2 class="nv-t">' + esc(m.title || 'Video') + '</h2>' + (sub ? '<p class="nv-s">' + esc(sub) + '</p>' : '') + '</div>' +
        '<div class="nv-ac">' +
          '<button type="button" class="nv-b ghost">Cancel</button>' +
          (busy && admin ? '<button type="button" class="nv-b alt">Play now</button>' : '') +
          '<button type="button" class="nv-b main">Add to room</button>' +
        '</div>' +
      '</div>', null, 'Add this video to the room');
    var img = el.querySelector('img'); if (img) img.onerror = function () { img.replaceWith(Object.assign(document.createElement('span'), { className: 'nv-ph', textContent: '▶' })); };
    el.querySelector('.ghost').onclick = function () { close('cancel'); };
    el.querySelector('.main').onclick = function () { close('add'); try { cb(false); } catch (e) { console.error(e); } };
    var alt = el.querySelector('.alt'); if (alt) alt.onclick = function () { close('add'); try { cb(true); } catch (e) { console.error(e); } };
  }

  /* choose: a page with several videos -> pick one, then go(video) (which opens the confirm popup) */
  function choose(site, title, videos, go) {
    var rows = videos.map(function (v, i) {
      var t = thumbOf(v);
      return '<button type="button" class="nv-li" data-i="' + i + '"><span class="nv-lt">' + (t ? '<img alt="" src="' + esc(t) + '" referrerpolicy="no-referrer">' : '<span class="nv-ph" aria-hidden="true">▶</span>') + '</span>' +
        '<span class="nv-lx"><b>' + esc(v.title || title || 'Video') + '</b><small>' + esc(v.provider || site || '') + '</small></span></button>';
    }).join('');
    var el = overlay('<div class="nv-card nv-wide"><div class="nv-bd"><p class="nv-k">' + videos.length + ' videos found' + (site ? ' on ' + esc(site) : '') + '</p><h2 class="nv-t">Choose one to add</h2></div><div class="nv-list">' + rows + '</div><div class="nv-ac"><button type="button" class="nv-b ghost">Cancel</button></div></div>', null, 'Choose a video');
    el.querySelector('.ghost').onclick = function () { close('cancel'); };
    el.querySelector('.nv-list').onclick = function (e) {
      var b = e.target.closest('.nv-li'); if (!b) return;
      var v = videos[+b.dataset.i]; close('pick'); go(v);
    };
  }


  /* ---------------- in-app browser (the Web tab) ----------------
     Search the web or type an address; pages open inside Nova via /api/browse (script-free, sandboxed).
     Tapping any video on a page reports it here -> confirm popup -> only that video goes to the room. */
  function toast(t) {
    var el = document.createElement('div'); el.className = 'nv-toast'; el.setAttribute('role', 'status'); el.textContent = t;
    document.body.appendChild(el); setTimeout(function () { el.classList.add('out'); }, 2600); setTimeout(function () { el.remove(); }, 3000);
  }
  function fileName(u) { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()).replace(/\.[a-z0-9]+$/i, '') || 'Video'; } catch (e) { return 'Video'; } }
  /* a tapped video URL -> room media (null when it is not a playable video URL) */
  function mediaFromUrl(u, title, thumb) {
    var p = parseInput(u), m;
    if (p.t === 'yt') return ytMedia({ id: p.id, title: title, thumb: thumb });
    if (p.t === 'ytpl') return ytMedia({ pl: p.pl, title: title, thumb: thumb });
    if ((m = /player\.vimeo\.com\/video\/(\d+)/.exec(u) || /^https?:\/\/vimeo\.com\/(\d+)/.exec(u)))
      return { kind: 'embed', url: 'https://player.vimeo.com/video/' + m[1] + '?autoplay=1', title: title || 'Vimeo video', thumb: thumb || '', provider: 'vimeo' };
    if ((m = /dailymotion\.com\/(?:embed\/)?video\/([a-z0-9]+)/i.exec(u)))
      return { kind: 'embed', url: 'https://www.dailymotion.com/embed/video/' + m[1] + '?autoplay=1', title: title || 'Dailymotion video', thumb: thumb || '', provider: 'dailymotion' };
    if (p.t === 'file') {
      var t = (title || '').trim(); if (!t || t.length > 120 || /^(download|play|watch)$/i.test(t)) t = fileName(u);
      return { kind: 'video', url: p.url, title: t, thumb: /^https:/.test(thumb || '') ? thumb : '', provider: 'link' };
    }
    return null;
  }
  function shortUrl(u) { try { var x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname) + x.search; } catch (e) { return u; } }

  var SEARCH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  var BACK_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  var FIND_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>';
  var OPEN_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>';

  /* o: { importUrl(url) -> opens a YouTube/file link or reads a page for videos (Add/Cancel);  launch(media, opt) -> confirm popup } */
  function browser(host, o) {
    var hist = [], cur = null, gen = 0, lastVid = '', lastT = 0;
    host.innerHTML =
      '<div class="nv-br">' +
        '<form class="nv-bar" autocomplete="off" role="search">' +
          '<button type="button" class="nv-ib nv-back" aria-label="Back" disabled>' + BACK_SVG + '</button>' +
          '<label class="nv-addr">' + SEARCH_SVG + '<input id="nvq" type="text" inputmode="url" enterkeyhint="go" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Search the web or type a web address" aria-label="Search the web or type a web address"></label>' +
          '<button type="button" class="nv-ib nv-open" aria-label="Open original website" title="Open original website" hidden>' + OPEN_SVG + '</button>' +
          '<button type="button" class="nv-ib nv-find" aria-label="Find video on this page" title="Find video on this page" hidden>' + FIND_SVG + '</button>' +
        '</form>' +
        '<div class="nv-main"><div class="nv-pane"></div><div class="nv-status" id="sres"></div></div>' +
      '</div>';
    var form = host.querySelector('.nv-bar'), input = host.querySelector('#nvq'), back = host.querySelector('.nv-back'), open = host.querySelector('.nv-open'), find = host.querySelector('.nv-find'), main = host.querySelector('.nv-pane'), over = host.querySelector('#sres');
    over.addEventListener('click', function (ev) { if (!ev.target.closest('button')) over.innerHTML = ''; });   // tap a status message to dismiss it
    function status(t, kind, retry) {
      main.innerHTML = '<div class="nv-msg' + (kind ? ' ' + kind : '') + '">' + (kind === 'wait' ? '<i class="nv-spin"></i>' : '') + '<span>' + esc(t) + '</span>' + (retry ? '<button class="nv-retry" type="button">Try again</button>' : '') + '</div>';
      if (retry) main.querySelector('.nv-retry').onclick = retry;
    }
    function sync() { back.disabled = hist.length < 2; open.hidden = find.hidden = !(cur && cur.k === 'page'); }
    function hint() {
      main.innerHTML = '<div class="nv-hint"><b>Search the web, then tap any video</b><span>Open a page, tap a supported video and Nova asks whether to add it to the room. You can also paste an official video link.</span><span class="nv-fine">Some sites block this safe preview. Use Open original website to view them normally; Nova can only add video links the site publicly exposes or officially allows to embed. Protected players cannot be imported.</span></div>';
    }
    function results(q) {
      var my = ++gen; status('Searching the web…', 'wait');
      webSearch(q).then(function (j) {
        if (my !== gen) return;
        var l = j.results || [];
        if (!l.length) { status('No results. Try other words, or paste a link to a page with a video.', ''); return; }
        main.innerHTML = '<div class="nv-wr">' + l.map(function (x, i) {
          return '<button type="button" class="nv-wi" data-u="' + esc(x.url) + '"><small>' + esc(x.host) + '</small><b>' + esc(x.title) + '</b><span>' + esc(x.snippet) + '</span></button>';
        }).join('') + '</div>';
        main.scrollTop = 0;
      }).catch(function (err) { if (my === gen) status(err.message || 'Web search failed', 'err', function () { results(q); }); });
    }
    function page(url) {
      var my = ++gen;
      main.innerHTML = '<div class="nv-load"><i class="nv-spin"></i></div><iframe class="nv-frame" title="Web page" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" allow="" src="/api/browse?url=' + encodeURIComponent(url) + '"></iframe>';
      var fr = main.querySelector('iframe'); fr.dataset.g = my;
      fr.addEventListener('load', function () { var l = main.querySelector('.nv-load'); if (l) l.remove(); });
    }
    function show(e, push) {
      cur = e; if (push !== false) hist.push(e);
      input.value = e.k === 'results' ? e.q : e.url;
      sync();
      if (e.k === 'results') results(e.q); else page(e.url);
    }
    function go(raw) {
      raw = String(raw || '').trim(); if (!raw) return;
      var p = parseInput(raw);
      if (p.t === 'yt' || p.t === 'ytpl' || p.t === 'file') return o.importUrl(p.url);
      if (p.t === 'url') return show({ k: 'page', url: p.url });
      show({ k: 'results', q: raw });
    }
    form.onsubmit = function (ev) { ev.preventDefault(); input.blur(); go(input.value); };
    input.addEventListener('focus', function () { try { input.select(); } catch (e) {} });
    back.onclick = function () { if (hist.length > 1) { hist.pop(); show(hist[hist.length - 1], false); } };
    open.onclick = function () {
      if (!cur || cur.k !== 'page') return;
      var a = document.createElement('a'); a.href = cur.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
    };
    find.onclick = function () { if (cur && cur.k === 'page') o.importUrl(cur.url); };
    main.addEventListener('click', function (ev) {
      var b = ev.target.closest('.nv-wi'); if (!b) return;
      var p = parseInput(b.dataset.u);
      if (p.t === 'yt' || p.t === 'ytpl' || p.t === 'file') return o.importUrl(p.url);   // a video result: straight to Add / Cancel
      show({ k: 'page', url: b.dataset.u });
    });
    /* messages from the page the visitor is looking at */
    function onMsg(ev) {
      if (!document.body.contains(host)) { window.removeEventListener('message', onMsg); return; }
      var fr = main.querySelector('iframe'), d = ev.data;
      if (!fr || ev.source !== fr.contentWindow || !d || d.nova !== 1) return;
      if (d.t === 'nav') {
        if (typeof d.url !== 'string') return;
        var l = main.querySelector('.nv-load'); if (l) l.remove();
        if (!cur || cur.k !== 'page') return;
        if (d.url !== cur.url) { cur = { k: 'page', url: d.url }; hist.push(cur); }
        input.value = cur.url; sync(); return;
      }
      if (d.t !== 'video' && d.t !== 'page') return;
      var u = String(d.url || ''), now = Date.now();
      if (u === lastVid && now - lastT < 350) return; lastVid = u; lastT = now;
      if (d.t === 'page') return o.importUrl(cur ? cur.url : String(d.page || ''));
      if (!/^https?:/i.test(u)) return toast('This video cannot be added.');
      var m = mediaFromUrl(u, String(d.title || ''), String(d.thumb || ''));
      if (!m) return o.importUrl(String(d.page || (cur && cur.url) || u));
      if (m.kind === 'youtube') return o.importUrl(u);                    // looks the video up (real title, embeddable check)
      if (m.kind === 'video' && !/^https:/i.test(m.url)) return toast('Only secure (https) videos can be added.');
      o.launch(m, { channel: shortUrl(cur ? cur.url : u).split('/')[0] });
    }
    window.addEventListener('message', onMsg);
    hint(); sync();
    if (o.init) go(o.init); else setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
    return { go: go };
  }

  /* ---------------- styles ---------------- */
  var css = '' +
    '.nv-ov{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(10,16,28,.38);-webkit-backdrop-filter:blur(10px) saturate(1.1);backdrop-filter:blur(10px) saturate(1.1);animation:nvf .16s ease-out;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.nv-card{width:min(420px,100%);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:#fff;color:#0b1220;border-radius:20px;overflow:hidden;box-shadow:0 24px 70px rgba(5,10,25,.35),0 0 0 1px rgba(255,255,255,.4);animation:nvu .2s cubic-bezier(.2,.8,.2,1)}' +
    '.nv-card.nv-wide{width:min(520px,100%)}' +
    '.nv-th{aspect-ratio:16/9;background:#0b1220;display:grid;place-items:center;overflow:hidden}.nv-th img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.nv-ph{display:grid;place-items:center;width:100%;height:100%;color:#fff9;font-size:30px;background:linear-gradient(135deg,#1c2a44,#0b1220)}' +
    '.nv-bd{padding:16px 20px 6px;min-width:0}.nv-k{margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#667085}' +
    '.nv-t{margin:0;font-size:18px;line-height:1.3;font-weight:700;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
    '.nv-s{margin:6px 0 0;font-size:14px;color:#667085}' +
    '.nv-ac{display:flex;gap:10px;justify-content:flex-end;padding:16px 20px 20px}' +
    '.nv-b{white-space:nowrap;appearance:none;border:0;border-radius:12px;padding:12px 20px;min-height:44px;font:inherit;font-size:15px;font-weight:700;cursor:pointer;transition:transform .08s,background .15s}' +
    '.nv-b:active{transform:scale(.97)}.nv-b:focus-visible{outline:3px solid #2563eb55;outline-offset:2px}' +
    '.nv-b.main{background:#0b1220;color:#fff}.nv-b.main:hover{background:#1c2a44}' +
    '.nv-b.ghost{background:#eef2f7;color:#0b1220}.nv-b.ghost:hover{background:#e3e9f1}' +
    '.nv-b.alt{background:#e7f0ff;color:#1d4ed8}' +
    '.nv-list{overflow:auto;padding:8px 12px;display:flex;flex-direction:column;gap:6px;max-height:50dvh}' +
    '.nv-li{display:flex;gap:12px;align-items:center;width:100%;text-align:left;border:0;background:#f3f6fa;border-radius:14px;padding:8px;cursor:pointer;font:inherit;color:inherit}.nv-li:hover{background:#e9eff6}' +
    '.nv-lt{flex:0 0 96px;aspect-ratio:16/9;border-radius:9px;overflow:hidden;background:#0b1220;display:block}.nv-lt img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.nv-lx{min-width:0;display:flex;flex-direction:column;gap:2px}.nv-lx b{font-size:15px;line-height:1.25;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.nv-lx small{color:#667085;font-size:13px}' +
    /* inside the dark search screen */
    '.nv-msg{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;padding:48px 24px;text-align:center;font-size:17px;line-height:1.5;color:#e8edf5}.nv-msg.err{color:#ffb4ab}' +
    '.nv-spin{width:22px;height:22px;border-radius:50%;border:3px solid #ffffff33;border-top-color:#fff;display:inline-block;animation:nvr .8s linear infinite}' +
    '.nv-foot{display:flex;justify-content:center;padding:18px 0 28px;min-height:60px}' +
    '.nv-retry{border:0;border-radius:10px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer;background:#fff;color:#0b1220}' +
    '.nv-hint{display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center;padding:56px 28px;color:#cfd8e6}.nv-hint b{font-size:22px;color:#fff}.nv-hint span{font-size:16px;line-height:1.5;max-width:520px}' +
    '.nv-wr{display:flex;flex-direction:column;gap:8px;padding:12px 14px 28px}' +
    '.nv-wi{display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;width:100%;border:0;border-radius:14px;padding:14px 16px;background:#ffffff14;color:#fff;font:inherit;cursor:pointer}.nv-wi:hover{background:#ffffff22}' +
    '.nv-wi b{font-size:17px;line-height:1.3}.nv-wi small{color:#9fd0ff;font-size:13px}.nv-wi span{color:#cfd8e6;font-size:14px;line-height:1.4}' +
    '.vc .ti .ch{display:block;font-style:normal;font-size:12px;opacity:.85;margin-top:2px}' +
    /* in-app browser */
    '.nv-br{position:absolute;inset:0;display:flex;flex-direction:column}' +
    '.nv-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;flex:0 0 auto}' +
    '.nv-ib{flex:0 0 44px;height:44px;border:0;border-radius:12px;background:#ffffff1a;color:#fff;display:grid;place-items:center;cursor:pointer}.nv-ib:hover:not(:disabled){background:#ffffff2e}.nv-ib:disabled{opacity:.35;cursor:default}.nv-ib[hidden]{display:none}' +
    '.nv-addr{flex:1;min-width:0;display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border-radius:14px;background:#fff;color:#667085}' +
    '.nv-addr input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:#0b1220}.nv-addr input::placeholder{color:#8a94a6}' +
    '.nv-addr:focus-within{box-shadow:0 0 0 3px #60a5fa88}' +
    '.nv-main{position:relative;flex:1;min-height:0}.nv-pane{position:absolute;inset:0;overflow:auto;-webkit-overflow-scrolling:touch}' +
    '.nv-status{position:absolute;inset:0;z-index:3;overflow:auto;background:rgba(14,18,28,.96)}.nv-status:empty{display:none}' +
    '.nv-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}' +
    '.nv-load{position:absolute;inset:0;display:grid;place-items:center;background:#fff;z-index:1;pointer-events:none}.nv-load .nv-spin{border-color:#0b122033;border-top-color:#0b1220}' +
    '.nv-toast{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483100;max-width:calc(100vw - 32px);padding:12px 18px;border-radius:999px;background:#0b1220;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 10px 30px #0006;transition:opacity .3s}.nv-toast.out{opacity:0}' +
    '.nv-fine{font-size:13px!important;opacity:.7}' +
    '@keyframes nvf{from{opacity:0}to{opacity:1}}@keyframes nvu{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}@keyframes nvr{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){.nv-ov,.nv-card,.nv-spin{animation:none}}' +
    '@media (max-width:520px){.nv-ov{align-items:end;padding:12px}.nv-ac .nv-b{flex:1}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  window.NovaAdd = { ytSearch: ytSearch, ytInfo: ytInfo, ytMedia: ytMedia, extract: extract, webSearch: webSearch, parseInput: parseInput, mediaFromUrl: mediaFromUrl, browser: browser, toast: toast, confirm: confirm, choose: choose, close: close };
})();
