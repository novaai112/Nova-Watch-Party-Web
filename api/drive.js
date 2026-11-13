/*  /api/drive?url=<Drive link>         -> is this a playable video?  (file link)
 *  /api/drive?folder=<folder id|link>  -> list the videos + sub-folders of a shared folder
 *
 *  Works for files/folders shared as "Anyone with the link" — the only kind every room member can
 *  open. Detection does not need an API key: it asks Google's download endpoint for the first byte
 *  and reads the content type. If a Drive API key is set (DRIVE_API_KEY, else GOOGLE_API_KEY, else
 *  YOUTUBE_API_KEY — Drive API must be enabled on it) the name, length and folder listing are richer.
 *
 *  File response: { ok, hasVideo, id, name, size, duration, thumbnail, mime,
 *                   streamUrl, playMode:'direct'|'embed', embedUrl, reason }
 */
const https = require('https');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PLAYABLE = /^video\/(mp4|webm|ogg|quicktime|x-m4v|mpeg)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|mov|mkv|avi|wmv|flv|3gp|mpg|mpeg|ts|m2ts)$/i;
const DIRECT_EXT = /\.(mp4|m4v|webm|ogv|mov)$/i;

function key() {
  const k = process.env.DRIVE_API_KEY || process.env.GOOGLE_API_KEY || process.env.YOUTUBE_API_KEY || '';
  return String(k).split(',')[0].trim();
}
function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache ? 'public, s-maxage=120, stale-while-revalidate=300' : 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

/* file id / folder id from every common Drive link shape */
function parseDrive(input) {
  const raw = String(input || '').trim();
  if (/^[\w-]{20,}$/.test(raw)) return { type: 'file', id: raw };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
  if (!/^(?:drive|docs|drive\.usercontent)\.google\.com$/i.test(u.hostname)) return null;
  let m = /\/folders\/([\w-]{10,})/.exec(u.pathname);
  if (m) return { type: 'folder', id: m[1] };
  m = /\/file\/d\/([\w-]{10,})/.exec(u.pathname) || /\/d\/([\w-]{10,})/.exec(u.pathname);
  if (m) return { type: 'file', id: m[1] };
  const id = u.searchParams.get('id');
  if (id && /^[\w-]{10,}$/.test(id)) return { type: /folderview|embeddedfolderview/.test(u.pathname) ? 'folder' : 'file', id };
  return null;
}

function request(target, headers, timeout, redirects, onHead) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Too many redirects'));
    let u;
    try { u = new URL(target); } catch (e) { return reject(e); }
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: Object.assign({ 'User-Agent': UA, 'Accept': '*/*' }, headers), timeout }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
        r.resume();
        return resolve(request(new URL(r.headers.location, target).toString(), headers, timeout, redirects - 1, onHead));
      }
      if (onHead) { const out = { status: r.statusCode, headers: r.headers }; r.destroy(); return resolve(out); }
      const chunks = []; let n = 0;
      r.on('data', (c) => { n += c.length; if (n < 1024 * 1024) chunks.push(c); });
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const dlUrl = (id) => 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(id) + '&export=download&confirm=t';

/* ask for the first byte only: tells us if the file is public and what it is */
async function probe(id) {
  const r = await request(dlUrl(id), { Range: 'bytes=0-0' }, 9000, 5, true);
  const ct = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const cd = String(r.headers['content-disposition'] || '');
  const fn = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  let name = '';
  try { name = fn ? decodeURIComponent(fn[1]) : ''; } catch (e) { name = fn ? fn[1] : ''; }
  const range = /\/(\d+)$/.exec(String(r.headers['content-range'] || ''));
  return { status: r.status, type: ct, name, size: range ? Number(range[1]) : Number(r.headers['content-length']) || 0, html: /text\/html/.test(ct) };
}

async function meta(id, k) {
  if (!k) return null;
  const u = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=' +
    encodeURIComponent('id,name,mimeType,size,videoMediaMetadata(durationMillis,width,height),shortcutDetails(targetId,targetMimeType)') + '&key=' + encodeURIComponent(k);
  try {
    const r = await request(u, { Accept: 'application/json' }, 8000, 2, false);
    const j = JSON.parse(r.body || '{}');
    if (j.error) return { error: j.error.code || r.status };
    return j;
  } catch (e) { return null; }
}

async function checkFile(id, depth) {
  const k = key();
  const [p, m] = await Promise.all([probe(id).catch(() => null), meta(id, k)]);
  /* a shortcut points at another file */
  if (m && m.shortcutDetails && m.shortcutDetails.targetId && !depth) return checkFile(m.shortcutDetails.targetId, 1);
  const name = (m && m.name) || (p && p.name) || 'Drive video';
  const mime = (m && m.mimeType) || (p && !p.html ? p.type : '') || '';
  const base = { ok: true, id, name, mime, size: Number((m && m.size) || (p && p.size) || 0) };
  if (m && m.videoMediaMetadata && m.videoMediaMetadata.durationMillis) base.duration = Math.round(m.videoMediaMetadata.durationMillis / 1000);
  base.thumbnail = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w640';
  base.embedUrl = 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview';

  const looksVideo = /^video\//i.test(mime) || (p && /^video\//i.test(p.type)) || ((!mime || /octet-stream/.test(mime)) && VIDEO_EXT.test(name));
  const notPublic = (m && m.error && (m.error === 404 || m.error === 403)) && (!p || p.html || p.status >= 400);
  if (notPublic || (!m && p && p.html && p.status !== 200 && p.status !== 206)) {
    return { ok: true, id, hasVideo: false, needsShare: true, name, reason: 'This file is private or was not found. In Google Drive tap Share → General access → “Anyone with the link”, then try again.' };
  }
  if (!looksVideo) {
    if (p && p.html && !m) return { ok: true, id, hasVideo: false, needsShare: true, name, reason: 'Drive did not give access to this file. Set Share → General access → “Anyone with the link”, then try again.' };
    return Object.assign(base, { hasVideo: false, reason: 'This Drive file is not a video' + (mime ? ' (' + mime + ')' : '') + '.' });
  }
  const direct = p && !p.html && (p.status === 200 || p.status === 206) && (PLAYABLE.test(p.type) || /octet-stream/.test(p.type)) && (PLAYABLE.test(mime) || DIRECT_EXT.test(name) || PLAYABLE.test(p.type));
  if (direct) return Object.assign(base, { hasVideo: true, playMode: 'direct', streamUrl: dlUrl(id) });
  /* video, but a format browsers can't play (mkv/avi/…) or download is switched off: use Drive's own player */
  return Object.assign(base, { hasVideo: true, playMode: 'embed', reason: p && p.html ? 'The owner turned off downloading, so Drive’s own player is used (it cannot be time-synced).' : 'This format cannot play directly in browsers, so Drive’s own player is used (it cannot be time-synced).' });
}

async function listFolder(id, token) {
  const k = key();
  if (!k) return { ok: false, error: 'Folder browsing needs a Google API key with the Drive API enabled. Add DRIVE_API_KEY in your Vercel environment variables, or paste a link to one video.' };
  const q = "'" + id + "' in parents and trashed=false and (mimeType contains 'video/' or mimeType='application/vnd.google-apps.folder')";
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.searchParams.set('q', q);
  u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,videoMediaMetadata(durationMillis))');
  u.searchParams.set('pageSize', '100');
  u.searchParams.set('orderBy', 'folder,name');
  u.searchParams.set('supportsAllDrives', 'true');
  u.searchParams.set('includeItemsFromAllDrives', 'true');
  u.searchParams.set('key', k);
  if (token) u.searchParams.set('pageToken', token);
  const r = await request(u.toString(), { Accept: 'application/json' }, 9000, 2, false);
  const j = JSON.parse(r.body || '{}');
  if (j.error) {
    const c = j.error.code;
    return { ok: false, error: c === 404 || c === 403 ? 'This folder is private or the Drive API is not enabled for the key. Share the folder with “Anyone with the link”.' : (j.error.message || 'Drive error') };
  }
  return {
    ok: true, id, next: j.nextPageToken || '',
    items: (j.files || []).map((f) => ({
      id: f.id, name: f.name, folder: f.mimeType === 'application/vnd.google-apps.folder',
      duration: f.videoMediaMetadata && f.videoMediaMetadata.durationMillis ? Math.round(f.videoMediaMetadata.durationMillis / 1000) : 0,
      thumbnail: f.mimeType === 'application/vnd.google-apps.folder' ? '' : 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(f.id) + '&sz=w400'
    }))
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 200; return res.end(); }
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    if (q.get('folder')) {
      const p = parseDrive(q.get('folder'));
      if (!p) return send(res, 400, { ok: false, error: 'That is not a Google Drive folder link.' });
      return send(res, 200, await listFolder(p.id, q.get('page') || ''), true);
    }
    const p = parseDrive(q.get('url') || q.get('id'));
    if (!p) return send(res, 400, { ok: false, error: 'That is not a Google Drive link. It should look like drive.google.com/file/d/…' });
    if (p.type === 'folder') return send(res, 200, { ok: true, folder: true, id: p.id });
    return send(res, 200, await checkFile(p.id, 0), false);
  } catch (err) {
    return send(res, 502, { ok: false, error: 'Could not reach Google Drive right now. Try again in a moment.' });
  }
};
module.exports._parseDrive = parseDrive;
