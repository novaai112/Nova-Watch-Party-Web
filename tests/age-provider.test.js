/* Contract test: the real lib/age-assurance.js assessAge() talking to the real age-provider/server.py
 * (mock estimator, so no model download). Run: node tests/age-provider.test.js   (needs python3) */
const { spawn } = require('child_process'), path = require('path'), assert = require('assert'), http = require('http');
const A = require('../lib/age-assurance.js');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]).toString('base64');   // JPEG magic + filler (mock never decodes)
const SECRET = 'test-secret-' + 'x'.repeat(30);
let ok = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { console.error('  ✗', n, '\n    ', e.message); process.exitCode = 1; } };
const get = (port, p) => new Promise((res, rej) => http.get({ port, host: '127.0.0.1', path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));

async function start(env) {
  const port = 8100 + Math.floor(Math.random() * 800);
  const child = spawn('python3', ['server.py'], { cwd: path.join(__dirname, '..', 'age-provider'), env: Object.assign({}, process.env, { PORT: port, AGE_PROVIDER_SECRET: SECRET, ESTIMATOR: 'mock' }, env) });
  child.stderr.on('data', d => process.stderr.write(d));
  for (let i = 0; i < 50; i++) { try { const h = await get(port, '/health'); if (h.ready) return { port, stop: () => child.kill() }; } catch (e) { } await new Promise(r => setTimeout(r, 100)); }
  child.kill(); throw new Error('service did not start');
}
const use = (port, secret) => { process.env.AGE_PROVIDER = 'http'; process.env.AGE_PROVIDER_URL = `http://127.0.0.1:${port}/verify`; process.env.AGE_PROVIDER_SECRET = secret; };

(async () => {
  for (const [age, want] of [[40, 'adult'], [25, 'adult'], [21, 'uncertain'], [12, 'minor']]) {
    const s = await start({ MOCK_AGE: String(age) }); use(s.port, SECRET);
    await t(`estimated age ${age} → ${want} (signed reply accepted by Nova's verifier)`, async () => assert.strictEqual(await A.assessAge({ image: JPEG, ref: 'ref' + 'a'.repeat(29) }), want));
    s.stop();
  }
  let s = await start({ MOCK_AGE: '40', MOCK_FACES: '2' }); use(s.port, SECRET);
  await t('two faces in the frame → uncertain, never adult', async () => assert.strictEqual(await A.assessAge({ image: JPEG, ref: 'ref' + 'b'.repeat(29) }), 'uncertain')); s.stop();
  s = await start({ MOCK_AGE: '40' });
  await t('wrong shared secret is refused (401) → provider_unavailable', async () => { use(s.port, 'wrong-' + 'y'.repeat(30)); await assert.rejects(() => A.assessAge({ image: JPEG, ref: 'ref' + 'c'.repeat(29) }), e => e.code === 'provider_unavailable'); });
  use(s.port, SECRET);
  await t('same ref twice → same verdict (client retry is safe)', async () => { const r = 'ref' + 'd'.repeat(29); assert.strictEqual(await A.assessAge({ image: JPEG, ref: r }), await A.assessAge({ image: JPEG, ref: r })); });
  await t('non-JPEG data is rejected', async () => { const png = Buffer.concat([Buffer.from([0x89, 0x50]), Buffer.alloc(300)]).toString('base64'); await assert.rejects(() => A.assessAge({ image: png, ref: 'ref' + 'e'.repeat(29) }), e => e.code === 'provider_unavailable'); });
  await t('/health works without secret and leaks nothing sensitive', async () => { const h = await get(s.port, '/health'); assert.deepStrictEqual(Object.keys(h).sort(), ['estimator', 'ok', 'ready']); });
  s.stop();
  await t('service not running → provider_unavailable (page keeps mature content hidden)', async () => { use(1, SECRET); await assert.rejects(() => A.assessAge({ image: JPEG, ref: 'ref' + 'f'.repeat(29) }), e => e.code === 'provider_unavailable'); });
  console.log(`\n${ok} checks passed`);
})();
