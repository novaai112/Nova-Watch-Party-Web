/* /api/link-preview?url=<https link>  ->  { url, title, description, image, siteName }
   Used by Nova Chat for automatic link previews. Requires a signed-in Supabase user
   (Authorization: Bearer <access token>) and refuses private / internal addresses (SSRF). */
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const MAX_BYTES = 600 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const cache = new Map();           // url -> { at, data }
const CACHE_MS = 30 * 60 * 1000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'private, max-age=600' : 'no-store');
  res.end(JSON.stringify(body));
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  return true;
}

async function verifyUser(req) {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!supabaseUrl || !anonKey) return { error: 'Server is not configured.', status: 503 };
  if (!token) return { error: 'Sign in required.', status: 401 };
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000)
    });
    return response.ok ? { ok: true } : { error: 'Sign in required.', status: 401 };
  } catch {
    return { error: 'Could not verify sign-in.', status: 503 };
  }
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('blocked');
    return hostname;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(hostname)) throw new Error('blocked');
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length || records.some(record => isPrivateIp(record.address))) throw new Error('blocked');
  return records[0].address;
}

function fetchHtml(urlString, redirects = 0) {
  return new Promise(async (resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch { return reject(new Error('invalid')); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return reject(new Error('invalid'));
    if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) return reject(new Error('invalid'));
    let address;
    try { address = await assertPublicHost(url.hostname); } catch { return reject(new Error('blocked')); }
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get({
      protocol: url.protocol, hostname: address, port: url.port || undefined, path: url.pathname + url.search,
      servername: url.hostname, timeout: TIMEOUT_MS,
      headers: {
        Host: url.host, 'User-Agent': 'Mozilla/5.0 (compatible; NovaLinkPreview/1.0)',
        Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en'
      }
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('redirects'));
        try { return resolve(fetchHtml(new URL(response.headers.location, url).href, redirects + 1)); }
        catch { return reject(new Error('invalid')); }
      }
      const type = String(response.headers['content-type'] || '');
      if (status >= 400 || !/text\/html|application\/xhtml/i.test(type)) { response.resume(); return reject(new Error('unsupported')); }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(); return resolve({ html: Buffer.concat(chunks).toString('utf8'), url: url.href }); }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), url: url.href }));
      response.on('error', reject);
    });
    request.on('timeout', () => { request.destroy(); reject(new Error('timeout')); });
    request.on('error', reject);
  });
}

const decode = value => String(value || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[n]))
  .replace(/\s+/g, ' ').trim();

function metaContent(html, keys) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!name || !keys.includes(name.toLowerCase())) continue;
    const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (content) return decode(content);
  }
  return '';
}

function parsePreview(html, pageUrl) {
  const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : 200000);
  const title = metaContent(head, ['og:title', 'twitter:title']) || decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const description = metaContent(head, ['og:description', 'twitter:description', 'description']);
  let image = metaContent(head, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
  const siteName = metaContent(head, ['og:site_name']) || new URL(pageUrl).hostname.replace(/^www\./, '');
  if (image) {
    try {
      const resolved = new URL(image, pageUrl);
      image = resolved.protocol === 'https:' && !resolved.username ? resolved.href : '';
    } catch { image = ''; }
  }
  return { url: pageUrl, title: title.slice(0, 200), description: description.slice(0, 300), image, siteName: siteName.slice(0, 80) };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Method not allowed' }); }
  const auth = await verifyUser(req);
  if (!auth.ok) return send(res, auth.status, { error: auth.error });
  let target;
  try { target = new URL(new URL(req.url, 'http://x').searchParams.get('url') || ''); }
  catch { return send(res, 400, { error: 'Invalid link.' }); }
  if (!/^https?:$/.test(target.protocol)) return send(res, 400, { error: 'Invalid link.' });
  const cached = cache.get(target.href);
  if (cached && Date.now() - cached.at < CACHE_MS) return send(res, 200, cached.data);
  try {
    const { html, url } = await fetchHtml(target.href);
    const data = parsePreview(html, url);
    if (!data.title && !data.description && !data.image) return send(res, 404, { error: 'No preview available.' });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    cache.set(target.href, { at: Date.now(), data });
    return send(res, 200, data);
  } catch (error) {
    const blocked = error && error.message === 'blocked';
    return send(res, blocked ? 400 : 502, { error: blocked ? 'This link cannot be previewed.' : 'No preview available.' });
  }
};
module.exports._test = { isPrivateIp, parsePreview };
