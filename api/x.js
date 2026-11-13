/*  /api/x?url=<X post link>   (also accepts ?id=<status id>)
 *
 *  Detects whether a public X (Twitter) post contains a video / GIF and returns a
 *  directly playable MP4 (or HLS) address. Only the VIDEO is returned, never the page.
 *
 *  Sources, in order (the first one that answers wins):
 *   1. X's own embed endpoint   cdn.syndication.twimg.com/tweet-result
 *   2. fxtwitter public API     api.fxtwitter.com
 *   3. vxtwitter public API     api.vxtwitter.com
 *
 *  Response: { ok, hasVideo, id, author, text, thumbnail, title, duration,
 *              streamUrl, streamType, variants:[{url,type,bitrate,height}], source }
 *  Posts that are private, deleted, age-restricted or have no video give
 *  { ok:true, hasVideo:false, reason } or { ok:false, error }.
 */
const https = require('https');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const X_HOSTS = /^(?:www\.|mobile\.|m\.)?(?:x\.com|twitter\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com|fixvx\.com)$/i;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function getJson(target, timeout = 9000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(target); } catch (e) { return reject(e); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET', timeout,
      headers: { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', 'Origin': 'https://platform.twitter.com', 'Referer': 'https://platform.twitter.com/' }
    }, (r) => {
      const chunks = []; let n = 0;
      r.on('data', (c) => { n += c.length; if (n < 2 * 1024 * 1024) chunks.push(c); });
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (r.statusCode === 404) return resolve({ status: 404, data: null });
        if (r.statusCode < 200 || r.statusCode >= 300) return reject(new Error('HTTP ' + r.statusCode));
        try { resolve({ status: r.statusCode, data: JSON.parse(text) }); } catch (e) { reject(new Error('Bad JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/* accepts x.com / twitter.com / mobile / fx / vx links, or a bare numeric id */
function parsePost(input) {
  const raw = String(input || '').trim();
  if (/^\d{5,25}$/.test(raw)) return { id: raw, user: '' };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
  if (!X_HOSTS.test(u.hostname)) return null;
  const m = /^\/(?:([\w]{1,30})\/)?status(?:es)?\/(\d{5,25})/i.exec(u.pathname) || /^\/i\/(?:web\/)?status\/(\d{5,25})/i.exec(u.pathname);
  if (!m) return null;
  return m.length === 3 ? { id: m[2], user: m[1] && m[1] !== 'i' ? m[1] : '' } : { id: m[1], user: '' };
}

/* same token X's own embeds compute */
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
}

function pickVariants(list) {
  const out = [];
  (list || []).forEach((v) => {
    if (!v || !v.url || !/^https:\/\//i.test(v.url)) return;
    const type = /mpegurl|\.m3u8/i.test((v.content_type || v.type || '') + v.url) ? 'hls' : /mp4/i.test((v.content_type || v.type || '') + v.url) ? 'mp4' : '';
    if (!type) return;
    const h = /\/(\d{3,4})x(\d{3,4})\//.exec(v.url);
    out.push({ url: v.url, type, bitrate: Number(v.bitrate) || 0, height: h ? Math.min(Number(h[1]), Number(h[2])) : 0 });
  });
  /* MP4 first (works in every <video>), highest bitrate that is still reasonable for a synced room */
  const mp4 = out.filter((v) => v.type === 'mp4').sort((a, b) => b.bitrate - a.bitrate);
  const hls = out.filter((v) => v.type === 'hls');
  return { mp4, hls, all: mp4.concat(hls) };
}

/* choose ~720p-class file when there is one: smooth for everyone, still sharp */
function bestOf(v) {
  if (v.mp4.length) {
    const ok = v.mp4.filter((x) => !x.height || x.height <= 1080);
    return (ok[0] || v.mp4[0]);
  }
  return v.hls[0] || null;
}

function fromSyndication(d, id) {
  if (!d || d.__typename === 'TweetTombstone' || (!d.id_str && !d.text && !d.mediaDetails)) return null;
  /* look in the post itself, then in a quoted post */
  const posts = [d].concat(d.quoted_tweet ? [d.quoted_tweet] : []);
  for (const p of posts) {
    const media = (p.mediaDetails || []).filter((m) => m && (m.type === 'video' || m.type === 'animated_gif') && m.video_info);
    if (media.length) {
      const m = media[0];
      const v = pickVariants(m.video_info.variants);
      const best = bestOf(v);
      if (!best) continue;
      return {
        hasVideo: true, id, source: 'x-embed', quoted: p !== d,
        author: p.user ? (p.user.name || '') + (p.user.screen_name ? ' (@' + p.user.screen_name + ')' : '') : '',
        text: String(p.text || '').replace(/https:\/\/t\.co\/\w+/g, '').trim(),
        thumbnail: m.media_url_https || (p.video && p.video.poster) || '',
        duration: m.video_info.duration_millis ? Math.round(m.video_info.duration_millis / 1000) : 0,
        gif: m.type === 'animated_gif', variants: v.all, best
      };
    }
    if (p.video && Array.isArray(p.video.variants)) {
      const v = pickVariants(p.video.variants.map((x) => ({ url: x.src, content_type: x.type })));
      const best = bestOf(v);
      if (best) return { hasVideo: true, id, source: 'x-embed', author: p.user ? (p.user.name || '') : '', text: String(p.text || '').replace(/https:\/\/t\.co\/\w+/g, '').trim(), thumbnail: p.video.poster || '', duration: 0, gif: false, variants: v.all, best };
    }
  }
  /* post exists but has no video */
  return { hasVideo: false, id, source: 'x-embed', author: d.user ? (d.user.name || '') : '', text: String(d.text || '').replace(/https:\/\/t\.co\/\w+/g, '').trim(), thumbnail: (d.mediaDetails && d.mediaDetails[0] && d.mediaDetails[0].media_url_https) || '' };
}

function fromFx(d, id) {
  const t = d && d.tweet;
  if (!t) return null;
  const posts = [t].concat(t.quote ? [t.quote] : []);
  for (const p of posts) {
    const vids = (p.media && p.media.videos) || (p.media && p.media.all || []).filter((m) => m.type === 'video' || m.type === 'gif');
    if (vids && vids.length) {
      const v0 = vids[0];
      const list = (v0.variants && v0.variants.length ? v0.variants : [{ url: v0.url, content_type: /m3u8/.test(v0.url) ? 'application/x-mpegURL' : 'video/mp4' }]);
      const v = pickVariants(list);
      const best = bestOf(v);
      if (!best) continue;
      return { hasVideo: true, id, source: 'fxtwitter', quoted: p !== t, author: p.author ? (p.author.name || '') + (p.author.screen_name ? ' (@' + p.author.screen_name + ')' : '') : '', text: String(p.text || '').trim(), thumbnail: v0.thumbnail_url || '', duration: Math.round(v0.duration || 0), gif: v0.type === 'gif', variants: v.all, best };
    }
  }
  return { hasVideo: false, id, source: 'fxtwitter', author: t.author ? (t.author.name || '') : '', text: String(t.text || '').trim(), thumbnail: '' };
}

function fromVx(d, id) {
  if (!d) return null;
  const vids = (d.media_extended || []).filter((m) => m.type === 'video' || m.type === 'gif');
  if (vids.length) {
    const m = vids[0];
    const v = pickVariants([{ url: m.url, content_type: /m3u8/.test(m.url) ? 'application/x-mpegURL' : 'video/mp4' }]);
    const best = bestOf(v);
    if (best) return { hasVideo: true, id, source: 'vxtwitter', author: (d.user_name || '') + (d.user_screen_name ? ' (@' + d.user_screen_name + ')' : ''), text: String(d.text || '').trim(), thumbnail: m.thumbnail_url || '', duration: Math.round((m.duration_millis || 0) / 1000), gif: m.type === 'gif', variants: v.all, best };
  }
  return { hasVideo: false, id, source: 'vxtwitter', author: d.user_name || '', text: String(d.text || '').trim(), thumbnail: '' };
}

async function resolvePost(post) {
  const errors = [];
  let noVideoResult = null;
  const tries = [
    async () => { const r = await getJson('https://cdn.syndication.twimg.com/tweet-result?id=' + post.id + '&lang=en&token=' + syndicationToken(post.id)); return r.status === 404 ? { gone: true } : fromSyndication(r.data, post.id); },
    async () => { const r = await getJson('https://api.fxtwitter.com/' + (post.user || 'i') + '/status/' + post.id); return r.status === 404 ? { gone: true } : fromFx(r.data, post.id); },
    async () => { const r = await getJson('https://api.vxtwitter.com/' + (post.user || 'i') + '/status/' + post.id); return r.status === 404 ? { gone: true } : fromVx(r.data, post.id); }
  ];
  let gone = 0;
  for (const t of tries) {
    try {
      const out = await t();
      if (out && out.gone) { gone++; continue; }
      if (out && out.hasVideo) return out;
      if (out && !noVideoResult) noVideoResult = out;
    } catch (e) { errors.push(e.message || 'failed'); }
  }
  if (noVideoResult) return noVideoResult;
  if (gone) return { notFound: true };
  throw new Error('Could not reach X right now (' + (errors[0] || 'unknown') + '). Try again in a moment.');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.statusCode = 200; return res.end(); }
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const post = parsePost(q.get('url') || q.get('id'));
    if (!post) return json(res, 400, { ok: false, error: 'That is not an X post link. It should look like x.com/name/status/123…' });
    const r = await resolvePost(post);
    if (r.notFound) return json(res, 200, { ok: true, hasVideo: false, id: post.id, reason: 'This post was not found. It may be deleted, private, or from a protected account.' });
    if (!r.hasVideo) return json(res, 200, { ok: true, hasVideo: false, id: post.id, author: r.author, text: r.text, thumbnail: r.thumbnail, reason: 'This post has no video.' });
    const best = r.best;
    const title = (r.text ? r.text.replace(/\s+/g, ' ').slice(0, 90) : '') || ('Video by ' + (r.author || 'X'));
    return json(res, 200, {
      ok: true, hasVideo: true, id: post.id, author: r.author, text: r.text, title,
      thumbnail: r.thumbnail, duration: r.duration, gif: !!r.gif, quoted: !!r.quoted,
      streamUrl: best.url, streamType: best.type, variants: r.variants, source: r.source,
      postUrl: 'https://x.com/' + (post.user || 'i') + '/status/' + post.id
    });
  } catch (err) {
    return json(res, 502, { ok: false, error: (err && err.message) || 'X lookup failed' });
  }
};

module.exports._parsePost = parsePost;
module.exports._syndicationToken = syndicationToken;
module.exports._fromSyndication = fromSyndication;
module.exports._fromFx = fromFx;
