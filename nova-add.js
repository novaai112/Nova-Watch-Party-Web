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
          var e = new Error(j.error || (r.status === 429 ? 'Too many searches — wait a moment and try again.' : 'Something went wrong. Please try again.'));
          e.status = r.status; throw e;
        }
        return j;
      });
    }, function () { throw new Error('No connection. Check your internet and try again.'); });
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
    '@keyframes nvf{from{opacity:0}to{opacity:1}}@keyframes nvu{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}@keyframes nvr{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){.nv-ov,.nv-card,.nv-spin{animation:none}}' +
    '@media (max-width:520px){.nv-ov{align-items:end;padding:12px}.nv-ac .nv-b{flex:1}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  window.NovaAdd = { ytSearch: ytSearch, ytInfo: ytInfo, ytMedia: ytMedia, extract: extract, webSearch: webSearch, parseInput: parseInput, confirm: confirm, choose: choose, close: close };
})();
