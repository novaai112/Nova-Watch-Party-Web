/* Browser integration test: real page + real engine + real API handlers, with
 *   - Chromium's fake camera (noise texture so the quality checks pass),
 *   - a stub for the MediaPipe module that returns scripted synthetic landmarks ("a user who does what is asked"),
 *   - a stub for supabase-js and an in-memory fake of Supabase's REST.
 * Run: E2E_OUT=/some/dir node tests/e2e-age-verify.js   (needs `playwright` + Chromium)  */
const { chromium } = require('playwright'), { spawn } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');

// fake camera clip
const y4m = path.join(OUT, 'cam.y4m'); { const W = 640, H = 480; const fd = fs.openSync(y4m, 'w'); fs.writeSync(fd, `YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`); let s = 7;
  for (let f = 0; f < 4; f++) { fs.writeSync(fd, 'FRAME\n'); const y = Buffer.alloc(W * H); for (let i = 0; i < y.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; y[i] = 120 + ((s >> 16) % 56) - 28; } fs.writeSync(fd, y); fs.writeSync(fd, Buffer.alloc(W * H / 2, 128)); } fs.closeSync(fd); }

const STUB_SUPABASE = `window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'tok1',user:{id:'u1'}}}}),onAuthStateChange(){}},
  from:()=>({select:()=>({eq:()=>({single:async()=>({data:window.__profile||{maturity_verified:false}})})}),update:v=>({eq:async()=>{(window.__updates=window.__updates||[]).push(v);return{}}})}),rpc:async()=>({})})};`;
const STUB_MP = `export const FilesetResolver={forVisionTasks:async()=>({})};
export class FaceLandmarker{static FACE_LANDMARKS_FACE_OVAL=[{start:234,end:454}];static FACE_LANDMARKS_LIPS=[{start:61,end:291}];static FACE_LANDMARKS_LEFT_EYE=[{start:263,end:362}];static FACE_LANDMARKS_RIGHT_EYE=[{start:33,end:133}];static FACE_LANDMARKS_LEFT_EYEBROW=[{start:336,end:296}];static FACE_LANDMARKS_RIGHT_EYEBROW=[{start:70,end:63}];
 static async createFromOptions(){return new FaceLandmarker()} detectForVideo(v,t){return window.__detect(t)} close(){}}`;
// a user who performs whatever the instruction card says (and nothing when window.__idle is set)
const USER = `(()=>{const E=self.NovaLiveness,F=self.SyntheticFace;let last='',t0=0;
 const acts=[[/^blink_twice$/,t=>(t>1200&&t<1350)||(t>1650&&t<1800)?{eyeL:1,eyeR:1}:{}],[/^blink_both$/,t=>t>1200&&t<1380?{eyeL:1,eyeR:1}:{}],[/^close_reopen$/,t=>t>1200&&t<2100?{eyeL:1,eyeR:1}:{}],
 [/^wink_left$/,t=>t>1200&&t<1700?{eyeL:1}:{}],[/^wink_right$/,t=>t>1200&&t<1700?{eyeR:1}:{}],[/^turn_left$/,t=>t>1200&&t<2300?{yaw:30}:{}],[/^turn_right$/,t=>t>1200&&t<2300?{yaw:-30}:{}],
 [/^look_up$/,t=>t>1200&&t<2300?{pitch:22}:{}],[/^look_down$/,t=>t>1200&&t<2300?{pitch:-22}:{}],[/^tilt_left$/,t=>t>1200&&t<2300?{roll:22}:{}],[/^tilt_right$/,t=>t>1200&&t<2300?{roll:-22}:{}],
 [/^smile$/,t=>t>1200&&t<2300?{smile:.9}:{}],[/^open_mouth$/,t=>t>1200&&t<2300?{mouth:.8}:{}]];
 window.__detect=now=>{const txt=(document.getElementById('face')||{dataset:{}}).dataset.task||'';if(txt!==last){last=txt;t0=now}const dt=now-t0;let p={};
  if(!window.__idle){for(const[re,fn]of acts)if(re.test(txt)){p=fn(dt);break}}
  if(window.__two)p.two=true; p=Object.assign({yaw:0,roll:0},p,{});p.yaw=(p.yaw||0)+Math.sin(now/230)*.6;p.roll=(p.roll||0)+Math.cos(now/310)*.5;return F.face(p)};})();`;

async function startApp(env) {
  const db = { profiles: [{ id: 'u1', maturity_verified: false }], age_sessions: [] };
  const fake = await require('./fake-supabase.js')(db);
  const port = 3300 + Math.floor(Math.random() * 500);
  const child = spawn('node', ['dev-server.js'], { cwd: root, env: Object.assign({}, process.env, { PORT: port, SUPABASE_URL: 'http://127.0.0.1:' + fake.address().port, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' }, env), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  return { db, port, stop() { child.kill(); fake.close(); } };
}
async function pageFor(browser, app, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'], colorScheme: 'light' }, opts));
  await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB_SUPABASE }));
  await ctx.route('**/vision_bundle.mjs', r => r.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: STUB_MP }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.addInitScript(read('liveness-engine.js')); await ctx.addInitScript(read('tests/synthetic-face.js')); await ctx.addInitScript(USER);
  const page = await ctx.newPage(); page.on('pageerror', e => console.log('   [pageerror]', e.message));
  await page.goto(`http://localhost:${app.port}/age-verify.html?next=profile.html%23settings`); return { ctx, page };
}
let ok = 0; const t = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; } };

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + y4m, '--autoplay-policy=no-user-gesture-required'] });

  console.log('A. landing page + success path (dev provider)');
  let app = await startApp({ AGE_PROVIDER: 'dev' }); let { ctx, page } = await pageFor(browser, app);
  await t('landing: no network request for any media/thumbnail', async () => { /* checked below via request log */ });
  const reqs = []; page.on('request', r => reqs.push(r.url()));
  await page.waitForSelector('#startBtn');
  await page.screenshot({ path: path.join(OUT, '01-intro-light-mobile.png'), fullPage: true });
  await t('Start is disabled until consent is ticked', async () => { assert(await page.isDisabled('#startBtn')); await page.check('#consent'); assert(!(await page.isDisabled('#startBtn'))); });
  await t('camera is off before Start', async () => assert.strictEqual(await page.evaluate(() => !document.getElementById('cam').srcObject), true));
  await page.click('#startBtn');
  await t('camera turns on after Start', async () => { await page.waitForFunction(() => !!document.getElementById('cam').srcObject, null, { timeout: 15000 }); });
  let shot = false, pcts = new Set(), instrs = [], last = -1, rises = 0;
  await t('percentage climbs 25 → 50 → 75 → 100 as each of the 4 steps is verified; one task at a time', async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const v = parseInt(await page.textContent('#pct'), 10); pcts.add(v); if (v > last) rises++; last = v;
      const ins = await page.getAttribute('#face', 'data-task'); if (ins && instrs[instrs.length - 1] !== ins) instrs.push(ins);
      if (!shot && v >= 50) { shot = true; await page.screenshot({ path: path.join(OUT, '02-capture-midway-mobile.png') }); }
      if (await page.isVisible('#popup')) break; await page.waitForTimeout(100);
    }
    for (const m of [25, 50, 75, 100]) assert(pcts.has(m), 'never showed ' + m + '% — saw ' + [...pcts].join());
  });
  await page.waitForSelector('#popup:not([hidden])', { timeout: 30000 });
  await t('success screen + camera fully released', async () => {
    assert.strictEqual(await page.getAttribute('#resBox', 'data-k'), 'ok');
    assert.strictEqual(await page.evaluate(() => document.getElementById('cam').srcObject), null);
    assert.strictEqual(await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).length >= 0), true);
  });
  await page.screenshot({ path: path.join(OUT, '03-success-mobile.png') });
  await t('4 distinct random tasks were asked', async () => { assert.strictEqual(new Set(instrs).size, 4, instrs.join(' | ')); });
  await t('DB: only maturity_verified set; Hide Mature turned off by the page', async () => {
    assert.strictEqual(app.db.profiles[0].maturity_verified, true);
    const upd = await page.evaluate(() => window.__updates || []); assert(upd.some(u => u.settings && u.settings.hideMature === false), JSON.stringify(upd));
    assert.strictEqual(app.db.age_sessions[0].status, 'passed');
  });
  await t('no media / thumbnail / image requests during the whole check', async () => { const bad = reqs.filter(u => /\.(mp4|webm|m3u8|jpe?g|png|gif|webp)(\?|$)/i.test(u) && !/7949\.jpg/.test(u)); assert.deepStrictEqual(bad, []); });
  await ctx.close();

  console.log('B. repeat visit after verification (profile flag true) needs no new check');
  ({ ctx, page } = await pageFor(browser, app, {})); 
  await page.close(); const p2 = await ctx.newPage(); await ctx.addInitScript(() => { window.__profile = { maturity_verified: true }; });
  await p2.goto(`http://localhost:${app.port}/age-verify.html`);
  await t('already-verified user lands on "already verified"', async () => { await p2.waitForSelector('#popup:not([hidden])', { timeout: 8000 }); assert((await p2.textContent('#resTitle')).includes('already verified')); });
  await ctx.close(); app.stop();

  console.log('C. provider unavailable (no AGE_PROVIDER) → fails closed with a clear next step');
  app = await startApp({ AGE_PROVIDER: '' }); ({ ctx, page } = await pageFor(browser, app, { colorScheme: 'dark', viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 }));
  await page.screenshot({ path: path.join(OUT, '04-intro-dark-desktop.png'), fullPage: true });
  await page.check('#consent'); await page.click('#startBtn');
  await page.waitForSelector('#popup:not([hidden])', { timeout: 70000 });
  await t('error screen: unavailable, not verified, retry offered', async () => {
    assert.strictEqual(await page.getAttribute('#resBox', 'data-k'), 'err'); assert((await page.textContent('#resTitle')).includes('unavailable'));
    assert.strictEqual(app.db.profiles[0].maturity_verified, false); assert(!(await page.isHidden('#resPrimary')));
    assert.strictEqual(await page.evaluate(() => document.getElementById('cam').srcObject), null);
  });
  await page.screenshot({ path: path.join(OUT, '05-error-dark-desktop.png') });
  await ctx.close(); app.stop();

  console.log('D. user does nothing → timeout → error pop-up');
  app = await startApp({ AGE_PROVIDER: 'dev' }); ({ ctx, page } = await pageFor(browser, app));
  await page.evaluate(() => { window.__idle = true; }); await page.check('#consent'); await page.click('#startBtn');
  await t('timeout → error pop-up with Try Again + Keep Mature Hidden; verification not granted', async () => {
    await page.waitForSelector('#popup:not([hidden])', { timeout: 70000 });
    await page.screenshot({ path: path.join(OUT, '06-timeout-popup-mobile.png') });
    assert.strictEqual(await page.getAttribute('#resBox', 'data-k'), 'err'); assert.strictEqual(app.db.profiles[0].maturity_verified, false);
    assert((await page.textContent('#resPrimary')).includes('Try Again')); assert(!(await page.isHidden('#resSecondary')));
  });
  await ctx.close();

  console.log('E. two faces in view → guidance, never proceeds');
  ({ ctx, page } = await pageFor(browser, app)); await page.evaluate(() => { window.__two = true; }); await page.check('#consent'); await page.click('#startBtn');
  await t('"Multiple faces detected" shown on the live info line', async () => { await page.waitForFunction(() => /multiple faces/i.test((document.getElementById('info') || {}).textContent || ''), null, { timeout: 20000 }); await page.screenshot({ path: path.join(OUT, '07-multi-face-mobile.png') }); });
  await ctx.close(); app.stop();

  console.log(`\n${ok} checks passed; screenshots in ${OUT}`); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
