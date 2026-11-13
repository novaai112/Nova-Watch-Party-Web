/* POST /api/age-verify  — { action: 'start' | 'step' | 'finish', ... }  (Bearer = Supabase access token)
 * See lib/age-assurance.js for the trust model. Responses never reveal WHICH signal caused a rejection. */
const A = require('../lib/age-assurance.js');

const STATUS = { unauthorized: 401, bad_request: 400, rate_limited: 429, expired: 410, replayed: 409, invalid_session: 404 };
const MAX_BODY = 1.2 * 1024 * 1024;

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new A.ApiError(413, 'bad_request')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new A.ApiError(400, 'bad_request')); } });
    req.on('error', () => reject(new A.ApiError(400, 'bad_request')));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'bad_request' }); }
  try {
    const ctype = String(req.headers['content-type'] || '');
    if (!/^application\/json/i.test(ctype)) throw new A.ApiError(415, 'bad_request');
    const uid = await A.authUser(req);
    const body = await readJson(req);
    if (!body || typeof body !== 'object') throw new A.ApiError(400, 'bad_request');
    let out;
    if (body.action === 'start') out = await A.start(uid);
    else if (body.action === 'step') out = await A.step(uid, body);
    else if (body.action === 'finish') out = await A.finish(uid, body);
    else throw new A.ApiError(400, 'bad_request');
    return send(res, 200, Object.assign({ ok: true }, out));
  } catch (e) {
    if (e instanceof A.ApiError) return send(res, e.status, { ok: false, error: e.code });
    return send(res, 500, { ok: false, error: 'server_error' });      // details are never returned to the client
  }
};
