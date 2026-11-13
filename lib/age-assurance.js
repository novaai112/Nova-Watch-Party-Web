/* lib/age-assurance.js — server-side logic for the 18+ face-liveness + age check.
 *
 * Trust model (read this): everything the browser sends is attacker-controlled. This module therefore
 *  (1) issues the random challenge order and a single-use nonce itself,
 *  (2) accepts each step exactly once, in order, inside a server-measured time window,
 *  (3) never decides "adult" itself — an age-assurance PROVIDER must say so, and its answer must carry a valid
 *      HMAC signature, and
 *  (4) fails CLOSED: no provider configured → no verification (except an explicit, non-production dev stub).
 * Browser-side movement analysis cannot, on its own, stop camera-injection / deepfake attacks. Use a provider whose
 * presentation-attack detection has been independently tested to ISO/IEC 30107-3 for the final decision.
 */
'use strict';
const crypto = require('crypto');
const E = require('../liveness-engine.js');

const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_STARTS_PER_15MIN = 6;
const GATE_GRACE_MS = E.CFG.gateCapMs + E.CFG.maxBlockedMs;   // time before the clock of a step even starts
const NET_GRACE_MS = 4000;

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const secureRng = () => crypto.randomBytes(4).readUInt32BE(0) / 4294967296;
const newNonce = () => crypto.randomBytes(24).toString('base64url');

class ApiError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

/* ---------------------------------------------------------------- Supabase (service role) */
function env() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return { url, anon: process.env.SUPABASE_ANON_KEY || '', svc: process.env.SUPABASE_SERVICE_ROLE_KEY || '' };
}
async function http(url, opts = {}, ms = 8000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, Object.assign({}, opts, { signal: ac.signal })); }
  catch (e) { throw new ApiError(503, 'network'); }
  finally { clearTimeout(t); }
}
async function authUser(req) {
  const m = /^Bearer\s+([\w\-.~+/=]+)$/i.exec(req.headers['authorization'] || '');
  const { url, anon } = env();
  if (!m || !url || !anon) throw new ApiError(401, 'unauthorized');
  const r = await http(url + '/auth/v1/user', { headers: { apikey: anon, Authorization: 'Bearer ' + m[1] } });
  if (r.status === 401 || r.status === 403) throw new ApiError(401, 'unauthorized');
  if (!r.ok) throw new ApiError(503, 'network');
  const u = await r.json();
  if (!u || !u.id) throw new ApiError(401, 'unauthorized');
  return u.id;
}
async function rest(method, path, body, prefer) {
  const { url, svc } = env();
  if (!url || !svc) throw new ApiError(503, 'not_configured');
  const h = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };
  if (prefer) h.Prefer = prefer;
  const r = await http(url + '/rest/v1/' + path, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
  if (!r.ok) { if (r.status === 404 || r.status === 400) throw new ApiError(503, 'not_configured'); throw new ApiError(503, 'network'); }
  const txt = await r.text(); return txt ? JSON.parse(txt) : null;
}
const iso = ms => new Date(ms).toISOString();

/* ---------------------------------------------------------------- age provider (adapter) */
/* Contract for AGE_PROVIDER=http (wrap Yoti / Persona / Veriff / iProov / AuthenticID … in a tiny adapter that speaks this):
 *   POST AGE_PROVIDER_URL  {ref, ts, minAge, image}      image = base64 JPEG of ONE frame captured at the end of the session
 *   ← 200 {ref, ts, result:'adult'|'minor'|'uncertain', signature}
 *   signature = hex HMAC-SHA256(AGE_PROVIDER_SECRET, `${ref}.${result}.${ts}`)   ts = unix seconds, ±120 s, ref must echo ours. */
async function assessAge({ image, ref }) {
  const mode = String(process.env.AGE_PROVIDER || '').toLowerCase();
  if (mode === 'dev') {
    if (process.env.VERCEL_ENV === 'production') throw new ApiError(503, 'provider_unavailable');
    return 'adult';                    // DEVELOPMENT STUB — approves everyone who passes the liveness steps
  }
  const url = process.env.AGE_PROVIDER_URL, secret = process.env.AGE_PROVIDER_SECRET;
  if (mode !== 'http' || !url || !secret) throw new ApiError(503, 'provider_unavailable');
  if (!image) throw new ApiError(422, 'liveness_failed');
  const ts = Math.floor(Date.now() / 1000);
  let r;
  try { r = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, ts, minAge: 18, image }) }, 15000); }
  catch (e) { throw new ApiError(503, 'provider_unavailable'); }
  if (!r.ok) throw new ApiError(503, 'provider_unavailable');
  let j; try { j = await r.json(); } catch { throw new ApiError(502, 'invalid_signature'); }
  const want = crypto.createHmac('sha256', secret).update(`${j && j.ref}.${j && j.result}.${j && j.ts}`).digest('hex');
  const got = String((j && j.signature) || '');
  const okSig = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!okSig || j.ref !== ref || Math.abs(Date.now() / 1000 - Number(j.ts)) > 120) throw new ApiError(502, 'invalid_signature');
  if (j.result === 'adult' || j.result === 'minor' || j.result === 'uncertain') return j.result;
  throw new ApiError(502, 'invalid_signature');
}

/* ---------------------------------------------------------------- evidence checks (pure, unit-tested) */
function checkStep(sess, index, ev, nowMs) {
  const id = sess.challenges[index], def = E.CATALOG[id];
  if (!def || !ev || ev.id !== id || ev.ok !== true) return 'challenge_failed';
  const issued = Date.parse(sess.step_issued_at), elapsed = nowMs - issued;
  const limit = def.limitMs + GATE_GRACE_MS + NET_GRACE_MS;
  if (elapsed > limit) return 'expired';
  if (elapsed < def.minMs + E.CFG.gateMs - 150) return 'suspicious';              // done faster than a person can
  if (!(ev.ms >= def.minMs) || ev.ms > elapsed + 1500) return 'suspicious';     // client clock must fit the server's
  if (!(ev.frames >= 6)) return 'suspicious';
  if (id === 'blink_both' && ev.blinks < 1) return 'challenge_failed';
  if (id === 'blink_twice' && ev.blinks < 2) return 'challenge_failed';
  if (id === 'close_reopen' && ev.blinks < 1) return 'challenge_failed';
  if (id.startsWith('blink') || id === 'close_reopen') {
    if (!Array.isArray(ev.blinkDurs) || !ev.blinkDurs.length) return 'suspicious';
    if (ev.blinkDurs.some(d => !(d >= 20 && d <= 5000))) return 'suspicious';
  }
  return null;
}
function checkSignals(sig, nowMs) {
  if (!sig || typeof sig !== 'object') return 'liveness_failed';
  const flags = Array.isArray(sig.flags) ? sig.flags.map(String) : [];
  const HARD = ['virtual_camera_label', 'frozen_or_still_image', 'track_not_live'];
  if (flags.some(f => HARD.includes(f))) return 'suspicious';
  if (!(sig.frames >= 60)) return 'liveness_failed';
  if (sig.multiFaceFrames > 20) return 'multiple_faces';
  let risk = 0;
  for (const f of flags) if (['perfectly_regular_frames', 'low_frame_rate', 'tiny_resolution', 'track_muted'].includes(f)) risk++;
  if (risk >= 2) return 'suspicious';
  return null;
}

/* ---------------------------------------------------------------- actions */
const publicStep = (sess, i) => { const d = E.CATALOG[sess.challenges[i]]; return { index: i, id: sess.challenges[i], text: d.text, follow: d.follow, label: d.label, limitMs: d.limitMs }; };

async function start(uid) {
  const prof = await rest('GET', `profiles?id=eq.${uid}&select=maturity_verified`);
  if (prof && prof[0] && prof[0].maturity_verified) return { already: true };
  const since = iso(Date.now() - 15 * 60 * 1000);
  const recent = await rest('GET', `age_sessions?user_id=eq.${uid}&created_at=gte.${encodeURIComponent(since)}&select=nonce_hash`);
  if (recent && recent.length >= MAX_STARTS_PER_15MIN) throw new ApiError(429, 'rate_limited');
  const last = await rest('GET', `age_sessions?user_id=eq.${uid}&select=challenges&order=created_at.desc&limit=1`);
  const avoid = last && last[0] ? last[0].challenges.join() : null;
  const challenges = E.pickSequence(secureRng, E.CFG.tasks, avoid);
  const nonce = newNonce(), now = Date.now();
  await rest('POST', 'age_sessions', { nonce_hash: sha256(nonce), user_id: uid, challenges, total: challenges.length, step_issued_at: iso(now), expires_at: iso(now + SESSION_TTL_MS) }, 'return=minimal');
  rest('DELETE', `age_sessions?user_id=eq.${uid}&created_at=lt.${encodeURIComponent(iso(now - 86400000))}`).catch(() => {});   // housekeeping
  return { nonce, expiresAt: now + SESSION_TTL_MS, total: challenges.length, step: publicStep({ challenges }, 0) };
}

async function loadSession(uid, nonce) {
  if (typeof nonce !== 'string' || nonce.length < 20 || nonce.length > 80) throw new ApiError(400, 'bad_request');
  const rows = await rest('GET', `age_sessions?nonce_hash=eq.${sha256(nonce)}&user_id=eq.${uid}&select=*`);
  if (!rows || !rows[0]) throw new ApiError(404, 'invalid_session');
  const s = rows[0];
  if (Date.parse(s.expires_at) < Date.now()) throw new ApiError(410, 'expired');
  return s;
}
async function failSession(hash) { await rest('PATCH', `age_sessions?nonce_hash=eq.${hash}`, { status: 'failed' }, 'return=minimal').catch(() => {}); }

async function step(uid, body) {
  const s = await loadSession(uid, body.nonce), hash = sha256(body.nonce), idx = body.index;
  if (s.status !== 'open' || !Number.isInteger(idx) || idx !== s.step) throw new ApiError(409, 'replayed');
  const bad = checkStep(s, idx, body.evidence, Date.now());
  if (bad) { await failSession(hash); throw new ApiError(422, bad); }
  const evidence = s.evidence.concat([{ id: body.evidence.id, ms: body.evidence.ms, peak: body.evidence.peak, blinks: body.evidence.blinks }]);
  const next = idx + 1;
  // compare-and-swap: only succeeds if nobody (e.g. a replay) advanced this session meanwhile
  const upd = await rest('PATCH', `age_sessions?nonce_hash=eq.${hash}&user_id=eq.${uid}&status=eq.open&step=eq.${idx}`, { step: next, evidence, step_issued_at: iso(Date.now()) }, 'return=representation');
  if (!upd || !upd.length) throw new ApiError(409, 'replayed');
  return next >= s.total ? { done: true } : { done: false, step: publicStep(s, next) };
}

async function finish(uid, body) {
  const s = await loadSession(uid, body.nonce), hash = sha256(body.nonce);
  if (s.status !== 'open' || s.step !== s.total) throw new ApiError(409, 'replayed');
  const bad = checkSignals(body.signals, Date.now());
  if (bad) { await failSession(hash); throw new ApiError(422, bad); }
  let image = null;
  if (typeof body.frame === 'string') {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.frame);
    if (!m || m[1].length > 900000) throw new ApiError(400, 'bad_request');
    image = m[1];
  }
  // claim the session so the same completed run can't be submitted twice
  const claim = await rest('PATCH', `age_sessions?nonce_hash=eq.${hash}&user_id=eq.${uid}&status=eq.open&step=eq.${s.total}`, { status: 'finalizing' }, 'return=representation');
  if (!claim || !claim.length) throw new ApiError(409, 'replayed');
  let verdict;
  try { verdict = await assessAge({ image, ref: hash.slice(0, 32) }); }
  catch (e) {
    if (e.code === 'provider_unavailable' || e.code === 'network') await rest('PATCH', `age_sessions?nonce_hash=eq.${hash}`, { status: 'open' }, 'return=minimal').catch(() => {});   // not the user's fault: allow retry
    else await failSession(hash);
    throw e;
  }
  image = null;                                                     // nothing about the face is kept
  if (verdict !== 'adult') { await failSession(hash); throw new ApiError(422, verdict === 'minor' ? 'age_failed' : 'age_uncertain'); }
  const method = String(process.env.AGE_PROVIDER || '').toLowerCase() === 'dev' ? 'dev_stub' : 'provider';
  await rest('PATCH', `profiles?id=eq.${uid}`, { maturity_verified: true, maturity_verified_at: iso(Date.now()), maturity_method: method }, 'return=minimal');
  await rest('PATCH', `age_sessions?nonce_hash=eq.${hash}`, { status: 'passed' }, 'return=minimal').catch(() => {});
  return { verified: true };
}

module.exports = { ApiError, authUser, start, step, finish, checkStep, checkSignals, assessAge, SESSION_TTL_MS, sha256 };
