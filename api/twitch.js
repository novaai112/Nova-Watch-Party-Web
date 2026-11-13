/*  /api/twitch?url=<link | channel name>   -> what is this?  live channel / past video / clip
 *  /api/twitch?top=1                        -> the most-watched live channels right now
 *  /api/twitch?channel=<name|link>          -> that channel: live status + recent videos + top clips
 *
 *  No API key needed: it uses the same public web endpoint twitch.tv itself uses (gql.twitch.tv).
 *  If Twitch changes it, links are still accepted (detected from the link alone) and play in
 *  Twitch's official embedded player; only the extra details (title, thumbnail, live badge) go missing.
 *
 *  Detect response:
 *   { ok, hasVideo, kind:'live'|'offline'|'video'|'clip', channel, title, thumbnail, duration,
 *     viewers, game, embedUrl:'https://player.twitch.tv/?...&parent=PLACEHOLDER', verified }
 *  The browser swaps `parent=` for its own host name (Twitch only plays on the page named in `parent`).
 */
const https = require('https');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TW_HOSTS = /^(?:www\.|m\.|go\.|player\.|clips\.)?twitch\.tv$/i;
const RESERVED = new Set(['videos', 'directory', 'downloads', 'jobs', 'turbo', 'settings', 'subscriptions', 'wallet', 'friends', 'inventory', 'drops', 'p', 'search', 'popout', 'embed', 'u', 'moderator', 'dashboard', 'login', 'signup', 'store', 'prime', 'team']);

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache ? 'public, s-maxage=60, stale-while-revalidate=120' : 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

/* any Twitch link shape (or a bare channel name) -> { type:'channel'|'video'|'clip', id } */
function parseTwitch(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^\d{6,12}$/.test(raw)) return { type: 'video', id: raw };
  if (/^@?\w{3,25}$/.test(raw) && !/[./]/.test(raw)) return { type: 'channel', id: raw.replace(/^@/, '').toLowerCase() };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
  if (!TW_HOSTS.test(u.hostname)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'clips.twitch.tv') {
    if (parts[0] === 'embed') { const c = u.searchParams.get('clip'); return c ? { type: 'clip', id: c } : null; }
    return parts[0] ? { type: 'clip', id: parts[0] } : null;
  }
  if (host === 'player.twitch.tv') {
    if (u.searchParams.get('video')) return { type: 'video', id: u.searchParams.get('video').replace(/^v/i, '') };
    if (u.searchParams.get('channel')) return { type: 'channel', id: u.searchParams.get('channel').toLowerCase() };
    return null;
  }
  if (parts[0] === 'videos' && /^v?\d{6,12}$/i.test(parts[1] || '')) return { type: 'video', id: parts[1].replace(/^v/i, '') };
  if (parts[1] === 'clip' && parts[2]) return { type: 'clip', id: parts[2] };
  if (parts[0] === 'popout' && parts[1]) return { type: 'channel', id: parts[1].toLowerCase() };
  if (parts[0] && !RESERVED.has(parts[0].toLowerCase()) && /^\w{3,25}$/.test(parts[0])) {
    if (parts[1] === 'videos' && /^\d{6,12}$/.test(parts[2] || '')) return { type: 'video', id: parts[2] };
    return { type: 'channel', id: parts[0].toLowerCase() };
  }
  return null;
}

function gql(query, variables) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, variables: variables || {} });
    const req = https.request({
      hostname: 'gql.twitch.tv', path: '/gql', method: 'POST', timeout: 9000,
      headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': UA, 'Accept': 'application/json' }
    }, (r) => {
      const chunks = []; let n = 0;
      r.on('data', (c) => { n += c.length; if (n < 2 * 1024 * 1024) chunks.push(c); });
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) return reject(new Error('HTTP ' + r.statusCode));
        try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (j && j.data) return resolve(j.data); reject(new Error('no data')); } catch (e) { reject(new Error('Bad JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

const PARENT = 'PLACEHOLDER';
const embedFor = (type, id) =>
  type === 'video' ? 'https://player.twitch.tv/?video=v' + encodeURIComponent(id) + '&parent=' + PARENT + '&autoplay=true' :
  type === 'clip' ? 'https://clips.twitch.tv/embed?clip=' + encodeURIComponent(id) + '&parent=' + PARENT + '&autoplay=true' :
  'https://player.twitch.tv/?channel=' + encodeURIComponent(id) + '&parent=' + PARENT + '&autoplay=true';
const https_ = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');

async function detect(p) {
  const base = { ok: true, hasVideo: true, id: p.id, kind: p.type === 'channel' ? 'live' : p.type, channel: p.type === 'channel' ? p.id : '', embedUrl: embedFor(p.type, p.id), verified: false };
  try {
    if (p.type === 'channel') {
      const d = await gql('query($l:String!){user(login:$l){displayName login profileImageURL(width:150) stream{id title viewersCount game{displayName} previewImageURL(width:640,height:360)}}}', { l: p.id });
      const u = d.user;
      if (!u) return { ok: true, hasVideo: false, reason: 'That Twitch channel was not found.' };
      const s = u.stream;
      return Object.assign(base, {
        verified: true, kind: s ? 'live' : 'offline', channel: u.login, name: u.displayName, title: s ? s.title : u.displayName + ' is offline',
        thumbnail: s ? https_(s.previewImageURL) : https_(u.profileImageURL), viewers: s ? s.viewersCount : 0, game: s && s.game ? s.game.displayName : '',
        hasVideo: true, reason: s ? '' : u.displayName + ' is offline right now. The room will show their channel and start when they go live.'
      });
    }
    if (p.type === 'video') {
      const d = await gql('query($i:ID!){video(id:$i){title lengthSeconds previewThumbnailURL(width:640,height:360) owner{displayName login} game{displayName}}}', { i: p.id });
      const v = d.video;
      if (!v) return { ok: true, hasVideo: false, reason: 'This Twitch video was not found. It may be deleted, sub-only or expired.' };
      return Object.assign(base, { verified: true, channel: v.owner ? v.owner.login : '', name: v.owner ? v.owner.displayName : '', title: v.title || 'Twitch video', thumbnail: https_(v.previewThumbnailURL), duration: v.lengthSeconds || 0, game: v.game ? v.game.displayName : '' });
    }
    const d = await gql('query($s:ID!){clip(slug:$s){title durationSeconds thumbnailURL broadcaster{displayName login} game{displayName}}}', { s: p.id });
    const c = d.clip;
    if (!c) return { ok: true, hasVideo: false, reason: 'This Twitch clip was not found. It may have been deleted.' };
    return Object.assign(base, { verified: true, channel: c.broadcaster ? c.broadcaster.login : '', name: c.broadcaster ? c.broadcaster.displayName : '', title: c.title || 'Twitch clip', thumbnail: https_(c.thumbnailURL), duration: Math.round(c.durationSeconds || 0), game: c.game ? c.game.displayName : '' });
  } catch (e) {
    /* Twitch's lookup is down: the link itself is still valid, the official player can open it */
    return Object.assign(base, { title: p.type === 'channel' ? p.id + ' on Twitch' : 'Twitch ' + p.type, thumbnail: '', note: 'Could not read details from Twitch, but the link looks valid.' });
  }
}

async function top() {
  const d = await gql('{streams(first:24){edges{node{title viewersCount previewImageURL(width:480,height:270) game{displayName} broadcaster{login displayName}}}}}');
  return ((d.streams && d.streams.edges) || []).map((e) => e.node).filter((n) => n && n.broadcaster).map((n) => ({
    kind: 'live', channel: n.broadcaster.login, name: n.broadcaster.displayName, title: n.title || '', thumbnail: https_(n.previewImageURL), viewers: n.viewersCount || 0, game: n.game ? n.game.displayName : ''
  }));
}

async function channel(login) {
  const items = [];
  const d = await gql('query($l:String!){user(login:$l){displayName login profileImageURL(width:150) stream{title viewersCount game{displayName} previewImageURL(width:480,height:270)} ' +
    'videos(first:12,type:ARCHIVE,sort:TIME){edges{node{id title lengthSeconds previewThumbnailURL(width:480,height:270) viewCount}}} ' +
    'clips(first:12,criteria:{period:ALL_TIME,sort:VIEWS_DESC}){edges{node{slug title durationSeconds thumbnailURL viewCount}}}}}', { l: login });
  const u = d.user;
  if (!u) return { found: false, items };
  if (u.stream) items.push({ kind: 'live', channel: u.login, name: u.displayName, title: u.stream.title || '', thumbnail: https_(u.stream.previewImageURL), viewers: u.stream.viewersCount || 0, game: u.stream.game ? u.stream.game.displayName : '' });
  ((u.videos && u.videos.edges) || []).forEach((e) => { const n = e.node; if (n) items.push({ kind: 'video', id: n.id, channel: u.login, name: u.displayName, title: n.title || 'Twitch video', thumbnail: https_(n.previewThumbnailURL), duration: n.lengthSeconds || 0, viewers: n.viewCount || 0 }); });
  ((u.clips && u.clips.edges) || []).forEach((e) => { const n = e.node; if (n) items.push({ kind: 'clip', id: n.slug, channel: u.login, name: u.displayName, title: n.title || 'Twitch clip', thumbnail: https_(n.thumbnailURL), duration: Math.round(n.durationSeconds || 0), viewers: n.viewCount || 0 }); });
  return { found: true, name: u.displayName, login: u.login, live: !!u.stream, items };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 200; return res.end(); }
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    if (q.get('top')) {
      try { return send(res, 200, { ok: true, items: await top() }, true); }
      catch (e) { return send(res, 200, { ok: false, error: 'Twitch did not answer right now. Type a channel name above or paste a Twitch link.' }); }
    }
    if (q.get('channel')) {
      const p = parseTwitch(q.get('channel'));
      if (!p || p.type !== 'channel') return send(res, 400, { ok: false, error: 'Type a Twitch channel name, like shroud.' });
      try {
        const r = await channel(p.id);
        if (!r.found) return send(res, 200, { ok: true, found: false, items: [], reason: 'That Twitch channel was not found.' });
        return send(res, 200, Object.assign({ ok: true }, r), true);
      } catch (e) { return send(res, 200, { ok: false, error: 'Twitch did not answer right now. Try again, or paste a Twitch link.' }); }
    }
    const p = parseTwitch(q.get('url'));
    if (!p) return send(res, 400, { ok: false, error: 'That is not a Twitch link. It should look like twitch.tv/channel, twitch.tv/videos/123 or a clip link.' });
    return send(res, 200, await detect(p), false);
  } catch (err) {
    return send(res, 502, { ok: false, error: 'Could not reach Twitch right now. Try again in a moment.' });
  }
};
module.exports._parseTwitch = parseTwitch;
