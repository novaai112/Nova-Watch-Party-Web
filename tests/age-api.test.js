/* End-to-end test of api/age-verify.js against an in-memory fake of Supabase (auth + the PostgREST calls we use).
 * Run: node tests/age-api.test.js */
const http = require('http'), crypto = require('crypto'), assert = require('assert');
const db = { profiles: [{ id: 'u1', maturity_verified: false }, { id: 'u2', maturity_verified: false }], age_sessions: [] };
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;

function match(row, q) {
  for (const [k, v] of q) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const [op, ...rest] = v.split('.'), val = rest.join('.'); const cur = row[k];
    if (op === 'eq' && String(cur) !== val) return false;
    if (op === 'gte' && !(Date.parse(cur) >= Date.parse(val))) return false;
    if (op === 'lt' && !(Date.parse(cur) < Date.parse(val))) return false;
  }
  return true;
}
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let body = '';
  req.on('data', c => body += c); req.on('end', () => {
    const json = (st, o) => { res.statusCode = st; res.setHeader('content-type', 'application/json'); res.end(o == null ? '' : JSON.stringify(o)); };
    if (u.pathname === '/auth/v1/user') { const t = (req.headers.authorization || '').replace('Bearer ', ''); return t === 'tok1' ? json(200, { id: 'u1' }) : t === 'tok2' ? json(200, { id: 'u2' }) : json(401, {}); }
    const tbl = u.pathname.replace('/rest/v1/', ''), rows = db[tbl]; if (!rows) return json(404, {});
    const hit = rows.filter(r => match(r, u.searchParams));
    if (req.method === 'GET') return json(200, JSON.parse(JSON.stringify(hit)));
    if (req.method === 'POST') { const b = JSON.parse(body); rows.push(Object.assign({ step: 0, status: 'open', evidence: [], created_at: new Date(Date.now()).toISOString() }, b)); return json(201); }
    if (req.method === 'PATCH') { hit.forEach(r => Object.assign(r, JSON.parse(body))); return json(200, req.headers.prefer === 'return=representation' ? hit : null); }
    if (req.method === 'DELETE') { db[tbl] = rows.filter(r => !hit.includes(r)); return json(204); }
  });
});

(async () => {
  await new Promise(r => fake.listen(0, r));
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + fake.address().port; process.env.SUPABASE_ANON_KEY = 'anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const handler = require('../api/age-verify.js'), E = require('../liveness-engine.js');
  const call = (token, body, opts = {}) => new Promise(resolve => {
    const req = new (require('stream').Readable)({ read() {} }); req.method = opts.method || 'POST'; req.headers = { authorization: token ? 'Bearer ' + token : '', 'content-type': 'application/json' };
    const res = { setHeader() {}, end(s) { resolve({ status: res.statusCode, body: JSON.parse(s) }); } };
    handler(req, res); req.push(JSON.stringify(body)); req.push(null);
  });
  const evFor = (id, over = {}) => Object.assign({ id, ok: true, ms: E.CATALOG[id].minMs + 900, frames: 40, blinks: id === 'blink_twice' ? 2 : 1, blinkDurs: [150, 160], peak: 0.9 }, over);
  const goodSignals = { frames: 400, fps: 29, multiFaceFrames: 0, flags: [] };
  let n = 0; const ok = async (name, fn) => { try { await fn(); n++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; } };

  await ok('rejects missing/invalid auth', async () => { assert.strictEqual((await call(null, { action: 'start' })).status, 401); assert.strictEqual((await call('bad', { action: 'start' })).status, 401); });
  let s, nonce;
  await ok('start: random server-chosen sequence, 4 tasks, ONE instruction revealed', async () => {
    const r = await call('tok1', { action: 'start' }); assert(r.body.ok && r.body.total === 4 && r.body.nonce.length >= 30 && r.body.step.index === 0);
    assert(!('challenges' in r.body)); nonce = r.body.nonce; s = db.age_sessions[0];
    assert.strictEqual(s.nonce_hash, crypto.createHash('sha256').update(nonce).digest('hex'), 'only the hash is stored');
  });
  await ok('step too fast (scripted) is rejected and kills the session', async () => {
    const r = await call('tok1', { action: 'step', nonce, index: 0, evidence: evFor(s.challenges[0]) }); assert.strictEqual(r.body.error, 'suspicious'); assert.strictEqual(db.age_sessions[0].status, 'failed');
  });
  await ok('failed session cannot continue', async () => { skew += 3000; const r = await call('tok1', { action: 'step', nonce, index: 0, evidence: evFor(s.challenges[0]) }); assert.strictEqual(r.body.error, 'replayed'); });

  let nonce2;
  await ok('full happy path: 4 steps in order, then finish → verified in DB', async () => {
    db.age_sessions.length = 0;
    const st = await call('tok1', { action: 'start' }); nonce2 = st.body.nonce; const ch = db.age_sessions[0].challenges;
    for (let i = 0; i < 4; i++) {
      skew += 3000;
      const r = await call('tok1', { action: 'step', nonce: nonce2, index: i, evidence: evFor(ch[i]) });
      assert(r.body.ok, JSON.stringify(r.body)); if (i < 3) assert.strictEqual(r.body.step.id, ch[i + 1]); else assert(r.body.done);
    }
    process.env.AGE_PROVIDER = 'dev';
    const f = await call('tok1', { action: 'finish', nonce: nonce2, signals: goodSignals, frame: 'data:image/jpeg;base64,AAAA' });
    assert(f.body.ok && f.body.verified, JSON.stringify(f.body));
    assert.strictEqual(db.profiles[0].maturity_verified, true); assert.strictEqual(db.profiles[0].maturity_method, 'dev_stub');
  });
  await ok('replaying the finished nonce is rejected', async () => { assert.strictEqual((await call('tok1', { action: 'finish', nonce: nonce2, signals: goodSignals })).body.error, 'replayed'); assert.strictEqual((await call('tok1', { action: 'step', nonce: nonce2, index: 3, evidence: evFor('smile') })).body.error, 'replayed'); });
  await ok('already-verified user is told so (no re-verification)', async () => { assert.strictEqual((await call('tok1', { action: 'start' })).body.already, true); });
  await ok("another user can't use someone else's nonce", async () => { assert.strictEqual((await call('tok2', { action: 'step', nonce: nonce2, index: 0, evidence: evFor('smile') })).body.error, 'invalid_session'); });

  const fresh = async () => { db.age_sessions.length = 0; const st = await call('tok2', { action: 'start' }); return { nonce: st.body.nonce, ch: db.age_sessions[0].challenges }; };
  await ok('out-of-order / skipped step rejected', async () => { const { nonce, ch } = await fresh(); skew += 3000; assert.strictEqual((await call('tok2', { action: 'step', nonce, index: 2, evidence: evFor(ch[2]) })).body.error, 'replayed'); });
  await ok('wrong challenge id for the step rejected', async () => { const { nonce, ch } = await fresh(); skew += 3000; const other = E.IDS.find(x => x !== ch[0]); assert.strictEqual((await call('tok2', { action: 'step', nonce, index: 0, evidence: evFor(other) })).body.error, 'challenge_failed'); });
  await ok('a reported failure (e.g. timeout) ends the session', async () => { const { nonce, ch } = await fresh(); skew += 3000; assert.strictEqual((await call('tok2', { action: 'step', nonce, index: 0, evidence: evFor(ch[0], { ok: false, reason: 'timeout' }) })).body.error, 'challenge_failed'); });
  await ok('step taking far longer than allowed → expired', async () => { const { nonce, ch } = await fresh(); skew += 120000; assert.strictEqual((await call('tok2', { action: 'step', nonce, index: 0, evidence: evFor(ch[0]) })).body.error, 'expired'); });
  await ok('expired session rejected', async () => { const { nonce, ch } = await fresh(); skew += 6 * 60 * 1000; assert.strictEqual((await call('tok2', { action: 'step', nonce, index: 0, evidence: evFor(ch[0]) })).body.error, 'expired'); });
  const passSteps = async (nonce, ch) => { for (let i = 0; i < 4; i++) { skew += 3000; const r = await call('tok2', { action: 'step', nonce, index: i, evidence: evFor(ch[i]) }); assert(r.body.ok, JSON.stringify(r.body)); } };
  await ok('virtual camera flagged → rejected, no verification', async () => { const { nonce, ch } = await fresh(); await passSteps(nonce, ch); const r = await call('tok2', { action: 'finish', nonce, signals: Object.assign({}, goodSignals, { flags: ['virtual_camera_label'] }) }); assert.strictEqual(r.body.error, 'suspicious'); assert.strictEqual(db.profiles[1].maturity_verified, false); });
  await ok('multiple faces during capture → rejected', async () => { const { nonce, ch } = await fresh(); await passSteps(nonce, ch); assert.strictEqual((await call('tok2', { action: 'finish', nonce, signals: Object.assign({}, goodSignals, { multiFaceFrames: 90 }) })).body.error, 'multiple_faces'); });
  await ok('finish before all steps done rejected', async () => { const { nonce } = await fresh(); assert.strictEqual((await call('tok2', { action: 'finish', nonce, signals: goodSignals })).body.error, 'replayed'); });
  await ok('NO provider configured → fails closed (provider_unavailable), session reusable', async () => {
    delete process.env.AGE_PROVIDER; const { nonce, ch } = await fresh(); await passSteps(nonce, ch);
    const r = await call('tok2', { action: 'finish', nonce, signals: goodSignals, frame: 'data:image/jpeg;base64,AAAA' }); assert.strictEqual(r.body.error, 'provider_unavailable'); assert.strictEqual(db.profiles[1].maturity_verified, false); assert.strictEqual(db.age_sessions[0].status, 'open');
  });
  await ok('dev stub refuses to run in production', async () => { process.env.AGE_PROVIDER = 'dev'; process.env.VERCEL_ENV = 'production'; const { nonce, ch } = await fresh(); await passSteps(nonce, ch); assert.strictEqual((await call('tok2', { action: 'finish', nonce, signals: goodSignals })).body.error, 'provider_unavailable'); delete process.env.VERCEL_ENV; });

  // signed http provider
  const secret = 'shh'; let mode = 'adult';
  const prov = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const q = JSON.parse(b); const result = mode === 'minor' ? 'minor' : mode === 'uncertain' ? 'uncertain' : 'adult';
    const sig = crypto.createHmac('sha256', secret).update(`${q.ref}.${result}.${q.ts}`).digest('hex');
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ref: q.ref, ts: mode === 'badsig' ? q.ts : q.ts, result, signature: mode === 'badsig' ? 'deadbeef'.repeat(8) : sig })); }); });
  await new Promise(r => prov.listen(0, r));
  process.env.AGE_PROVIDER = 'http'; process.env.AGE_PROVIDER_URL = 'http://127.0.0.1:' + prov.address().port; process.env.AGE_PROVIDER_SECRET = secret;
  const runProv = async (m) => { mode = m; const { nonce, ch } = await fresh(); await passSteps(nonce, ch); return call('tok2', { action: 'finish', nonce, signals: goodSignals, frame: 'data:image/jpeg;base64,AAAA' }); };
  await ok('provider: invalid signature rejected', async () => { const r = await runProv('badsig'); assert.strictEqual(r.body.error, 'invalid_signature'); assert.strictEqual(db.profiles[1].maturity_verified, false); });
  await ok('provider: minor → age_failed', async () => assert.strictEqual((await runProv('minor')).body.error, 'age_failed'));
  await ok('provider: uncertain → age_uncertain', async () => assert.strictEqual((await runProv('uncertain')).body.error, 'age_uncertain'));
  await ok('provider: signed adult → verified, only then', async () => { const r = await runProv('adult'); assert(r.body.verified); assert.strictEqual(db.profiles[1].maturity_verified, true); assert.strictEqual(db.profiles[1].maturity_method, 'provider'); });
  await ok('rate limit on repeated starts', async () => { db.profiles[1].maturity_verified = false; db.age_sessions.length = 0; let last; for (let i = 0; i < 8; i++) last = await call('tok2', { action: 'start' }); assert.strictEqual(last.body.error, 'rate_limited'); });
  await ok('GET is refused', async () => assert.strictEqual((await call('tok1', {}, { method: 'GET' })).status, 405));
  console.log(`\n${n} checks passed`); fake.close(); prov.close(); setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
