const tlsTrust = require('./tls-trust');
tlsTrust.configureSystemCa();

/* /api/youtube — server-side YouTube Data API proxy.
   The key lives in the Vercel env var YOUTUBE_API_KEY, so visitors never see or enter a key.

   GET /api/youtube?q=text[&type=video|playlist][&eventType=live][&pageToken=..][&safe=1]
       -> { items:[{id,pl,title,channel,thumb,dur,live}], next }
   GET /api/youtube?id=VIDEO_ID   -> { id,title,channel,thumb,dur,embeddable,live }
   GET /api/youtube?pl=PLAYLIST   -> { pl,title,channel,thumb }
*/
const API = 'https://www.googleapis.com/youtube/v3';

const decode = s => String(s || '')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

function dur(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return '';
  const s = (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  if (!s) return '';
  const h = Math.floor(s / 3600), mi = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + String(mi).padStart(2, '0') : mi) + ':' + String(x).padStart(2, '0');
}
const thumbOf = t => ((t && (t.medium || t.high || t.default || t.standard)) || {}).url || '';

async function g(path, params, key) {
  const u = new URL(API + path);
  Object.keys(params).forEach(k => { if (params[k] !== undefined && params[k] !== '') u.searchParams.set(k, params[k]); });
  u.searchParams.set('key', key);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new Error((j.error && j.error.message) || 'YouTube request failed');
    const reason = j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
    e.status = r.status; e.reason = reason;
    throw e;
  }
  return j;
}
const send = (res, code, body, cache) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
};

module.exports = async (req, res) => {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return send(res, 500, { error: 'YOUTUBE_API_KEY is not set on the server.' });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  try {
    if (q.id) {
      const j = await g('/videos', { part: 'snippet,contentDetails,status', id: String(q.id).slice(0, 20) }, key);
      const v = (j.items || [])[0];
      if (!v) return send(res, 404, { error: 'Video not found or private.' });
      return send(res, 200, {
        id: v.id, title: decode(v.snippet.title), channel: decode(v.snippet.channelTitle),
        thumb: thumbOf(v.snippet.thumbnails), dur: dur(v.contentDetails && v.contentDetails.duration),
        embeddable: !(v.status && v.status.embeddable === false), live: v.snippet.liveBroadcastContent === 'live'
      }, 'public, s-maxage=3600');
    }
    if (q.pl) {
      const j = await g('/playlists', { part: 'snippet', id: String(q.pl).slice(0, 64) }, key);
      const p = (j.items || [])[0];
      if (!p) return send(res, 404, { error: 'Playlist not found or private.' });
      return send(res, 200, { pl: p.id, title: decode(p.snippet.title), channel: decode(p.snippet.channelTitle), thumb: thumbOf(p.snippet.thumbnails) }, 'public, s-maxage=3600');
    }
    const text = String(q.q || '').trim().slice(0, 200);
    if (!text) return send(res, 400, { error: 'Type something to search.' });
    const type = q.type === 'playlist' ? 'playlist' : 'video';
    const params = { part: 'snippet', maxResults: 24, type, q: text, pageToken: q.pageToken || '' };
    if (type === 'video') { params.videoEmbeddable = 'true'; params.videoSyndicated = 'true'; }
    if (type === 'video' && q.eventType === 'live') params.eventType = 'live';
    if (q.safe === '1') params.safeSearch = 'strict';
    const j = await g('/search', params, key);
    let items = (j.items || []).map(x => ({
      id: (x.id && x.id.videoId) || '', pl: (x.id && x.id.playlistId) || '',
      title: decode(x.snippet.title), channel: decode(x.snippet.channelTitle),
      thumb: thumbOf(x.snippet.thumbnails), live: x.snippet.liveBroadcastContent === 'live', dur: ''
    })).filter(i => i.id || i.pl);
    const ids = items.filter(i => i.id).map(i => i.id);
    if (ids.length) {                       // 1 extra quota unit: durations for the whole page
      try {
        const d = await g('/videos', { part: 'contentDetails', id: ids.join(',') }, key);
        const map = {}; (d.items || []).forEach(v => { map[v.id] = dur(v.contentDetails.duration); });
        items.forEach(i => { if (i.id) i.dur = map[i.id] || ''; });
      } catch (e) {}
    }
    return send(res, 200, { items, next: j.nextPageToken || '' }, 'public, s-maxage=600, stale-while-revalidate=3600');
  } catch (e) {
    const quota = e.reason === 'quotaExceeded' || e.reason === 'dailyLimitExceeded' || e.reason === 'rateLimitExceeded';
    return send(res, quota ? 429 : (e.status && e.status < 600 ? e.status : 502), {
      error: quota ? 'YouTube search is busy right now. Please try again in a little while.' : tlsTrust.errorMessage(e, 'YouTube request failed'),
      reason: e.reason || ''
    });
  }
};
