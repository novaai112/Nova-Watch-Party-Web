/* /api/extract?url=https://…  — finds the playable video(s) on a web page.
   Nova imports ONLY the video into the room (like Rave); it never embeds the whole website.
   Looks for: direct files (.mp4 .webm .m3u8), <video>/<source>, og:video, JSON-LD VideoObject,
   YouTube / Vimeo / Dailymotion embeds.  DRM services (Netflix, Prime…) cannot be imported.
   -> { ok, title, thumb, site, videos:[{kind:'youtube'|'video'|'embed', id|url, title, thumb, provider}] } */
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (compatible; NovaWatchParty/1.0; +https://nova-watch-party.vercel.app)';
const MEDIA_RE = /\.(mp4|m4v|webm|ogv|mov|m3u8)(?:$|[?#])/i;
const MAX_BYTES = 1500000;

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', code === 200 ? 'public, s-maxage=300' : 'no-store');
  res.end(JSON.stringify(body));
};
const dec = s => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2F;/gi, '/').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).trim();

/* ---------- SSRF guard: never fetch internal addresses ---------- */
function privateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l); return m ? privateIp(m[1]) : false;
  }
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
async function check(u) {
  let url; try { url = new URL(u); } catch (e) { throw new Error('That is not a valid link.'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) links are supported.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('This port is not allowed.');
  const h = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) throw new Error('This address is not allowed.');
  if (net.isIP(h)) { if (privateIp(h)) throw new Error('This address is not allowed.'); return url; }
  const addrs = await dns.lookup(h, { all: true }).catch(() => { throw new Error('Could not find that website.'); });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error('This address is not allowed.');
  return url;
}
async function get(u) {
  let cur = u;
  for (let i = 0; i < 5; i++) {
    const url = await check(cur);
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 9000);
    let r;
    try {
      r = await fetch(url, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,video/*;q=0.9,*/*;q=0.5', 'Accept-Language': 'en' } });
    } catch (e) { clearTimeout(t); throw new Error('The website did not respond.'); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { clearTimeout(t); cur = new URL(r.headers.get('location'), url).href; continue; }
    const type = (r.headers.get('content-type') || '').toLowerCase();
    if (/^(video|audio)\/|mpegurl/.test(type)) { clearTimeout(t); try { r.body && r.body.cancel(); } catch (e) {} return { url: url.href, type, direct: true, html: '' }; }
    let html = '', n = 0;
    try {
      const rd = r.body.getReader(), td = new TextDecoder('utf-8', { fatal: false });
      for (;;) { const c = await rd.read(); if (c.done) break; n += c.value.length; html += td.decode(c.value, { stream: true }); if (n > MAX_BYTES) { try { rd.cancel(); } catch (e) {} break; } }
    } catch (e) {}
    clearTimeout(t);
    if (!r.ok && !html) throw new Error('The website returned an error (' + r.status + ').');
    return { url: url.href, type, direct: false, html };
  }
  throw new Error('Too many redirects.');
}

/* ---------- parsing ---------- */
const meta = (html, names) => {
  for (const n of names) {
    const re1 = new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + n + '["\'][^>]*content=["\']([^"\']+)["\']', 'i');
    const re2 = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name|itemprop)=["\']' + n + '["\']', 'i');
    const m = re1.exec(html) || re2.exec(html); if (m) return dec(m[1]);
  }
  return '';
};
const metaAll = (html, n) => {
  const out = [], re = new RegExp('<meta[^>]+(?:property|name)=["\']' + n + '["\'][^>]*content=["\']([^"\']+)["\']', 'gi'); let m;
  while ((m = re.exec(html))) out.push(dec(m[1]));
  return out;
};
const abs = (u, base) => { try { return new URL(dec(u).replace(/\\\//g, '/'), base).href; } catch (e) { return ''; } };
const ytId = u => { const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:.*&)?v=|shorts\/|live\/))([\w-]{11})/.exec(u); return m ? m[1] : ''; };

function classify(u, title, thumb) {
  if (!u) return null;
  const y = ytId(u);
  if (y) return { kind: 'youtube', id: y, title, thumb: thumb || 'https://i.ytimg.com/vi/' + y + '/mqdefault.jpg', provider: 'youtube' };
  let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return null; }
  let m;
  if ((m = /player\.vimeo\.com\/video\/(\d+)/.exec(u)) || (m = /^https?:\/\/vimeo\.com\/(\d+)/.exec(u)))
    return { kind: 'embed', url: 'https://player.vimeo.com/video/' + m[1] + '?autoplay=1', title, thumb, provider: 'vimeo' };
  if ((m = /dailymotion\.com\/(?:embed\/)?video\/([a-z0-9]+)/i.exec(u)))
    return { kind: 'embed', url: 'https://www.dailymotion.com/embed/video/' + m[1] + '?autoplay=1', title, thumb, provider: 'dailymotion' };
  if (MEDIA_RE.test(u)) return { kind: 'video', url: u, title, thumb, provider: host.split('.')[0].slice(0, 20) };
  return null;
}

function parse(html, base) {
  const out = [], seen = new Set();
  const title = meta(html, ['og:title', 'twitter:title']) || dec((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  const thumb = abs(meta(html, ['og:image', 'twitter:image', 'thumbnailUrl']), base);
  const add = (u, t, th) => {
    const full = abs(u, base); if (!full || !/^https:/i.test(full)) return;   // rooms require https media
    const c = classify(full, (t || title || '').slice(0, 160), th || thumb && thumb.startsWith('https:') ? (th || thumb) : '');
    if (!c) return;
    const k = c.kind + '|' + (c.id || c.url.split('?')[0]);
    if (seen.has(k)) return; seen.add(k); out.push(c);
  };
  /* JSON-LD VideoObject */
  const ld = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m;
  const walk = (o, d) => {
    if (!o || d > 6) return;
    if (Array.isArray(o)) return o.forEach(x => walk(x, d + 1));
    if (typeof o !== 'object') return;
    const ty = [].concat(o['@type'] || []).join(',');
    if (/VideoObject/i.test(ty)) { const th = [].concat(o.thumbnailUrl || [])[0]; add(o.contentUrl, o.name, typeof th === 'string' ? th : ''); add(o.embedUrl, o.name, typeof th === 'string' ? th : ''); }
    Object.keys(o).forEach(k => { if (typeof o[k] === 'object') walk(o[k], d + 1); });
  };
  while ((m = ld.exec(html))) { try { walk(JSON.parse(m[1]), 0); } catch (e) {} }
  /* Open Graph / Twitter */
  ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream', 'twitter:player', 'contentUrl', 'embedUrl'].forEach(n => metaAll(html, n).forEach(u => add(u)));
  /* <video>, <source> */
  const vt = /<(?:video|source)\b[^>]*?\b(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  while ((m = vt.exec(html))) add(m[1]);
  /* iframes: YouTube / Vimeo / Dailymotion */
  const fr = /<iframe\b[^>]*?\b(?:src|data-src)=["']([^"']+)["']/gi;
  while ((m = fr.exec(html))) add(m[1]);
  /* any direct media URL mentioned in the page (players often keep it in inline JSON) */
  const raw = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const rx = /https?:\/\/[^"'\s<>\\)]+?\.(?:mp4|m4v|webm|m3u8)(?:\?[^"'\s<>\\)]*)?/gi;
  let c = 0; while ((m = rx.exec(raw)) && c++ < 30) add(m[0]);
  /* anchors straight to a media file */
  const an = /<a\b[^>]*?href=["']([^"']+\.(?:mp4|m4v|webm|m3u8)(?:\?[^"']*)?)["']/gi;
  while ((m = an.exec(html))) add(m[1]);

  const rank = v => v.kind === 'youtube' ? 0 : v.kind === 'video' ? (/\.m3u8/i.test(v.url) ? 2 : 1) : 3;
  out.sort((a, b) => rank(a) - rank(b));
  return { title, thumb, videos: out.slice(0, 12) };
}

async function oembed(url) {
  const eps = [];
  if (/vimeo\.com/.test(url)) eps.push('https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(url));
  if (/dailymotion\.com/.test(url)) eps.push('https://www.dailymotion.com/services/oembed?format=json&url=' + encodeURIComponent(url));
  for (const e of eps) {
    try { const r = await fetch(e, { headers: { 'User-Agent': UA } }); if (r.ok) { const j = await r.json(); return { title: j.title || '', thumb: j.thumbnail_url || '' }; } } catch (x) {}
  }
  return {};
}

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const target = String(q.url || '').trim().slice(0, 1500);
  if (!target) return send(res, 400, { ok: false, error: 'Paste a link first.' });
  try {
    const page = await get(target);
    const host = new URL(page.url).hostname.replace(/^www\./, '');
    if (page.direct) {
      const name = decodeURIComponent((new URL(page.url).pathname.split('/').pop() || '')).replace(/\.[a-z0-9]+$/i, '') || host;
      if (!/^https:/i.test(page.url)) return send(res, 200, { ok: true, site: host, title: name, thumb: '', videos: [] });
      return send(res, 200, { ok: true, site: host, title: name, thumb: '', videos: [{ kind: 'video', url: page.url, title: name.slice(0, 160), thumb: '', provider: host.split('.')[0].slice(0, 20) }] });
    }
    const r = parse(page.html, page.url);
    /* the page itself may be a Vimeo / Dailymotion watch page */
    const self = classify(page.url, r.title, r.thumb);
    if (self && !r.videos.some(v => (v.id || v.url) === (self.id || self.url))) {
      const o = await oembed(page.url);
      if (o.title) self.title = o.title.slice(0, 160);
      if (o.thumb && /^https:/.test(o.thumb)) self.thumb = o.thumb;
      r.videos.unshift(self);
    }
    return send(res, 200, { ok: true, site: host, title: (r.title || host).slice(0, 160), thumb: r.thumb && /^https:/.test(r.thumb) ? r.thumb : '', videos: r.videos });
  } catch (e) {
    return send(res, 200, { ok: false, error: e.message || 'Could not read that page.', videos: [] });
  }
};
module.exports._parse = parse;   // for tests
