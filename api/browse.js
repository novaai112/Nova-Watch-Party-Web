/* /api/browse?url=https://… — the in-app browser's page renderer.
   Website scripts run in an opaque-origin sandbox, separate from Nova's login and storage. Video taps are
   reported to Nova, which asks "Add / Cancel" and imports only that video.
   Safety: same SSRF guard as /api/extract; the response is sandboxed and may only be framed by Nova. */
const extract = require('./extract.js');
const get = extract._get, classify = extract._classify;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dec = s => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const MEDIA_RE = /\.(mp4|m4v|webm|ogv|mov|m3u8)(?:$|[?#])/i;
const abs = (u, base) => { try { const x = new URL(dec(u).trim(), base); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };
const isVideoUrl = u => !!u && !!(classify(u, '', ''));

/* ---------- attribute helpers ---------- */
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
function parseTag(tag) {
  const m = /^<([a-z][a-z0-9-]*)([\s\S]*?)(\/?)>$/i.exec(tag); if (!m) return null;
  const attrs = []; let a; ATTR.lastIndex = 0;
  while ((a = ATTR.exec(m[2]))) attrs.push([a[1].toLowerCase(), a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : null]);
  return { name: m[1].toLowerCase(), attrs, selfClose: m[3] };
}
const build = t => '<' + t.name + t.attrs.map(([k, v]) => v == null ? ' ' + k : ' ' + k + '="' + String(v).replace(/"/g, '&quot;') + '"').join('') + (t.selfClose ? ' /' : '') + '>';
const getA = (t, n) => { const x = t.attrs.find(a => a[0] === n); return x ? x[1] : null; };
const setA = (t, n, v) => { const x = t.attrs.find(a => a[0] === n); if (x) x[1] = v; else t.attrs.push([n, v]); };
const delA = (t, n) => { t.attrs = t.attrs.filter(a => a[0] !== n); };

/* ---------- rewrite ---------- */
function rewrite(html, base, self) {
  const proxy = u => self + '/api/browse?url=' + encodeURIComponent(u);
  let out = String(html || '');
  out = out.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(object|applet)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<embed\b[^>]*>/gi, '');
  /* embedded video players become add-video tiles; other frames stay inside their own sandbox */
  const tiles = [];
  out = out.replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe\s*>|<iframe\b([^>]*)\/>/gi, (all, a1, a2) => {
    const t = parseTag('<iframe' + (a1 || a2 || '') + '>'); if (!t) return '';
    const u = abs(getA(t, 'src') || getA(t, 'data-src') || '', base);
    const c = u && classify(u, '', '');
    if (c) {
      const th = c.kind === 'youtube' ? 'https://i.ytimg.com/vi/' + c.id + '/hqdefault.jpg' : '';
      tiles.push('<a class="nv-emb" href="#" data-nv-video="' + esc(u) + '" title="' + esc(getA(t, 'title') || '') + '">' + (th ? '<img alt="" src="' + th + '">' : '') + '<span>▶ Tap to add this video</span></a>');
      return '\u0000NVTILE' + (tiles.length - 1) + '\u0000';
    }
    if (!u) return '';
    setA(t, 'src', u);
    setA(t, 'sandbox', 'allow-scripts allow-forms');
    return build(t) + '</iframe>';
  });
  /* tags */
  out = out.replace(/<(?:meta|base)\b[^>]*>/gi, tag => /http-equiv|<base/i.test(tag) ? '' : tag);
  out = out.replace(/<[a-z][a-z0-9-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, tag => {
    const t = parseTag(tag); if (!t) return tag;
    t.attrs = t.attrs.filter(([k, v]) => k !== 'srcdoc' && k !== 'ping' && !(v && /^\s*javascript:/i.test(v)) && !/^data-nv-/.test(k));
    let after = '';
    if (t.name === 'a' || t.name === 'area') {
      const h = getA(t, 'href');
      if (h != null) {
        const u = abs(h, base);
        delA(t, 'target'); delA(t, 'download');
        if (!u) setA(t, 'href', '#');
        else if (isVideoUrl(u)) { setA(t, 'href', '#'); setA(t, 'data-nv-video', u); }
        else setA(t, 'href', proxy(u));
      }
    } else if (t.name === 'form') {
      const act = abs(getA(t, 'action') || base, base);
      setA(t, 'action', self + '/api/browse'); setA(t, 'method', 'get'); delA(t, 'target'); delA(t, 'enctype');
      after = '<input type="hidden" name="__nv_action" value="' + esc(act) + '">';
    } else if (t.name === 'img') {
      const lazy = getA(t, 'data-src') || getA(t, 'data-original') || getA(t, 'data-lazy-src');
      const s = getA(t, 'src');
      if (lazy && (!s || /^data:|placeholder|blank|spacer|1x1/i.test(s))) setA(t, 'src', lazy);
      delA(t, 'loading');
    } else if (t.name === 'video') {
      delA(t, 'autoplay'); delA(t, 'loop'); if (!t.attrs.some(a => a[0] === 'controls')) t.attrs.push(['controls', null]);
      setA(t, 'preload', 'none'); setA(t, 'playsinline', '');
    } else if (t.name === 'source') {
      const d = getA(t, 'data-src'); if (d && !getA(t, 'src')) setA(t, 'src', d);
    }
    return build(t) + after;
  });
  out = out.replace(/\u0000NVTILE(\d+)\u0000/g, (m, i) => tiles[+i] || '');
  /* head additions + our tap detector */
  const title = dec((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(out) || [])[1] || '').trim().slice(0, 160);
  const head = '<base href="' + esc(base) + '"><meta name="referrer" content="no-referrer">' +
    (/<meta[^>]+name=["']?viewport/i.test(out) ? '' : '<meta name="viewport" content="width=device-width,initial-scale=1">') + STYLE;
  out = /<head\b[^>]*>/i.test(out) ? out.replace(/<head\b[^>]*>/i, m => m + head) : head + out;
  const script = '<script>' + DETECT.replace('%PAGE%', () => JSON.stringify(base).replace(/</g, '\\u003c')).replace('%TITLE%', () => JSON.stringify(title).replace(/</g, '\\u003c')) + '</script>';
  out = /<\/body\s*>/i.test(out) ? out.replace(/<\/body\s*>/i, script + '</body>') : out + script;
  return out;
}

const STYLE = '<style>.nv-emb{position:relative;display:flex;align-items:center;justify-content:center;min-height:180px;aspect-ratio:16/9;max-width:100%;background:#0b1220;color:#fff;border-radius:10px;overflow:hidden;text-decoration:none;font:700 16px system-ui,sans-serif}.nv-emb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.75}.nv-emb span{position:relative;background:#000a;border-radius:999px;padding:10px 18px}video{max-width:100%;background:#000;cursor:pointer}</style>';
const DETECT = `(function(){var PAGE=%PAGE%,TITLE=%TITLE%,last='',lt=0;
function post(o){try{o.nova=1;parent.postMessage(o,'*')}catch(e){}}
post({t:'nav',url:PAGE,title:document.title||TITLE});
function once(u){var n=Date.now();if(u===last&&n-lt<350)return false;last=u;lt=n;return true}
function tell(el,u,kind){if(!once(u||PAGE))return;var t=(el.getAttribute&&(el.getAttribute('title')||el.getAttribute('aria-label')))||(el.textContent||'').trim()||document.title||TITLE;
 var im=el.querySelector&&el.querySelector('img');post({t:kind,url:u||PAGE,page:PAGE,title:t.replace(/\\s+/g,' ').slice(0,160),thumb:el.poster||(im&&im.src)||''})}
function vsrc(v){var s=v.currentSrc||v.getAttribute('src')||'';if(!s){var c=v.querySelector('source[src]');s=c?c.src:''}return s}
document.addEventListener('click',function(e){var x=e.target;if(!x||!x.closest)return;
 var a=x.closest('[data-nv-video]');if(a){e.preventDefault();e.stopPropagation();tell(a,a.getAttribute('data-nv-video'),'video');return}
 var v=x.closest('video');if(v){e.preventDefault();try{v.pause()}catch(z){}var s=vsrc(v);tell(v,s&&!/^blob:/.test(s)?s:'',s&&!/^blob:/.test(s)?'video':'page')}},true);
document.addEventListener('play',function(e){var v=e.target;if(v&&v.tagName==='VIDEO'){try{v.pause()}catch(z){}var s=vsrc(v);tell(v,s&&!/^blob:/.test(s)?s:'',s&&!/^blob:/.test(s)?'video':'page')}},true);
})();`;

/* ---------- response ---------- */
function headers(self) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src 'none'; script-src https: 'unsafe-inline' 'unsafe-eval'; connect-src https: wss:; child-src https: blob:; frame-src https:; worker-src https: blob:; img-src * data: blob:; media-src * data: blob:; style-src * 'unsafe-inline'; font-src * data:; form-action " + self + "; frame-ancestors 'self'",
    'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'
  };
}
const notice = (title, text) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f3f6fa;color:#0b1220"><div style="max-width:420px;padding:28px;text-align:center"><h2 style="margin:0 0 8px">' + esc(title) + '</h2><p style="margin:0;color:#667085">' + esc(text) + '</p></div></body>';
const selfOf = req => {
  const h = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost');
  const p = String((req.headers && req.headers['x-forwarded-proto']) || (/^(localhost|127\.|\[::1\])/.test(h) ? 'http' : 'https')).split(',')[0];
  return p + '://' + h;
};

module.exports = async (req, res) => {
  const self = selfOf(req);
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  let target = String(q.url || '').trim().slice(0, 2000);
  if (q.__nv_action) {                                    // a search box / form on the page
    try {
      const u = new URL(String(q.__nv_action)); const sp = new URLSearchParams(u.search);
      Object.keys(q).forEach(k => { if (k !== 'url' && k !== '__nv_action') [].concat(q[k]).forEach(v => { sp.set(k, v); }); });
      u.search = sp.toString(); target = u.href;
    } catch (e) { target = ''; }
  }
  const out = (code, body, cache) => { res.statusCode = code; const h = headers(self); Object.keys(h).forEach(k => res.setHeader(k, h[k])); res.setHeader('Cache-Control', cache || 'no-store'); res.end(body); };
  if (!target) return out(400, notice('Nothing to open', 'Type a web address or a search.'));
  try {
    const page = await get(target);
    if (page.direct) {
      const t = esc((decodeURIComponent((new URL(page.url).pathname.split('/').pop() || '')).replace(/\.[a-z0-9]+$/i, '')) || 'Video');
      return out(200, rewrite('<!doctype html><html><head><title>' + t + '</title></head><body style="margin:0;background:#000"><video controls playsinline preload="none" src="' + esc(page.url) + '" style="width:100%;max-height:100vh"></video></body></html>', page.url, self), 'public, s-maxage=60');
    }
    if (!page.html.trim()) return out(200, notice('Empty page', 'This page has no content that can be shown here. Try “Find video on this page”.'));
    return out(200, rewrite(page.html, page.url, self), 'public, s-maxage=120');
  } catch (e) {
    return out(200, notice('Could not open this page', (e && e.message) || 'The website did not respond.'));
  }
};
module.exports._rewrite = rewrite;
module.exports._headers = headers;
