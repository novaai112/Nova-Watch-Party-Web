const { URL } = require('url');
const { searchForMediaRequest } = require('./websearch');

function send(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  if (typeof req.body === 'string') return JSON.parse(req.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 8192) throw Object.assign(new Error('Search request is too large.'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function isAuthenticated(authorization) {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !anonKey) return { configured: false };

  let authUrl;
  try {
    const base = new URL(supabaseUrl);
    if (base.protocol !== 'https:' || base.username || base.password) return { configured: false };
    authUrl = new URL('/auth/v1/user', base);
  } catch (error) {
    return { configured: false };
  }

  const response = await fetch(authUrl, {
    headers: { apikey: anonKey, Authorization: authorization, Accept: 'application/json' },
    signal: AbortSignal.timeout(3000)
  });
  return { configured: true, authenticated: response.ok };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, { error: 'Use POST for media searches.' });
  }

  const authorization = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return send(res, 401, { error: 'Sign in to search chat media.' });
  }

  try {
    const auth = await isAuthenticated(authorization);
    if (!auth.configured) return send(res, 503, { error: 'Media search authentication is not configured.' });
    if (!auth.authenticated) return send(res, 401, { error: 'Your session is invalid. Sign in again.' });

    let input;
    try {
      input = await readJsonBody(req);
    } catch (error) {
      return send(res, error.status || 400, { error: error.status ? error.message : 'Search request must be valid JSON.' });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return send(res, 400, { error: 'Search request must be a JSON object.' });
    }

    const provider = typeof input.provider === 'string' ? input.provider.trim().toLowerCase() : '';
    const query = typeof input.query === 'string' ? input.query.trim().slice(0, 100) : '';
    const kind = typeof input.kind === 'string' ? input.kind.toLowerCase() : '';
    const page = typeof input.page === 'number' && Number.isInteger(input.page) ? input.page : 0;
    if (provider !== 'duckduckgo') return send(res, 400, { error: 'Unsupported media provider.' });
    if (!query) return send(res, 400, { error: 'Enter a search term for DuckDuckGo.' });
    if (kind !== 'image' && kind !== 'gif') return send(res, 400, { error: 'Media type must be image or gif.' });
    if (page < 0 || page > 20) return send(res, 400, { error: 'Page must be between 0 and 20.' });

    const data = await searchForMediaRequest(query, kind, page);
    return send(res, 200, data);
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 502;
    if (status === 429) {
      return send(res, status, { error: error.message }, { 'Retry-After': error.retryAfter || '60' });
    }
    console.error('Chat media search failed:', error.message);
    return send(res, status, { error: error.message || 'Media search failed. Try again shortly.' });
  }
};
