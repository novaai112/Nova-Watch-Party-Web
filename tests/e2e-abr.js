/* Real-browser test: quality ladder (ABR) for plain files, as for X videos (several mp4 qualities).
   1. link too slow for the high rung → the player drops to the low rung by itself, same second, and plays to the end
   2. fast link, low start rung → after a calm period the next rung is probed and the player climbs, without jumping back in time
   Run: LOW=/tmp/low.mp4 HIGH=/tmp/high.mp4 node tests/e2e-abr.js   (50 s clips: ffmpeg -f lavfi -i testsrc=duration=50:size=640x360:rate=25 -c:v libx264 -b:v 300k low.mp4 …) */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const FILES = { '/low.mp4': fs.readFileSync(process.env.LOW || path.join(__dirname, 'low.mp4')), '/high.mp4': fs.readFileSync(process.env.HIGH || path.join(__dirname, 'high.mp4')) };
const NET = fs.readFileSync(path.join(__dirname, '../room-net.js'), 'utf8');
let throttle = 0, hits = [];                                           /* bytes per 100 ms; 0 = full speed */
const host = http.createServer((req, res) => {
  const f = FILES[req.url.split('?')[0]]; if (!f) { res.statusCode = 404; return res.end(); }
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || ''), a = m ? +m[1] : 0, b = m && m[2] !== '' ? Math.min(+m[2], f.length - 1) : f.length - 1;
  hits.push(req.url.split('?')[0] + '@' + a);
  const h = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': b - a + 1, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range,content-length,accept-ranges' };
  if (m) h['content-range'] = `bytes ${a}-${b}/${f.length}`;
  res.writeHead(m ? 206 : 200, h); const body = f.subarray(a, b + 1);
  if (!throttle) return res.end(body);
  let o = 0; const iv = setInterval(() => { if (o >= body.length) { clearInterval(iv); return res.end(); } res.write(body.subarray(o, o += throttle)); }, 100); res.on('close', () => clearInterval(iv));
});
const site = http.createServer((req, res) => {
  if (req.url === '/room-net.js') { res.setHeader('content-type', 'text/javascript'); return res.end(NET); }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><body style="margin:0"><video id="v" muted playsinline preload="auto" width="640" height="360"></video><script src="/room-net.js"></script></body>');
});
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', String(e.message).split('\n')[0]); } };
async function setup(page, start) {
  hits = []; const base = `http://127.0.0.1:${host.address().port}`;
  await page.goto(`http://127.0.0.1:${site.address().port}/`);
  await page.evaluate(({ base, start }) => {
    const v = document.getElementById('v');
    const lad = [{ h: 360, u: base + '/low.mp4', b: 300000, i: 0 }, { h: 720, u: base + '/high.mp4', b: 4000000, i: 1 }];   /* built by hand: ladderFrom only accepts https links */
    window.__log = []; window.__maxBack = 0; let last = 0;
    const A = NovaNet.abr(v, lad, { start, viewPx: () => 1080, src: r => r.u, resume: () => v.play(), quiet() {} });
    window.__A = A; v.src = lad[A.level].u; v.addEventListener('ended', () => { window.__ended = true; });
    setInterval(() => { const c = v.currentTime; if (c > 1 && last - c > window.__maxBack) window.__maxBack = last - c; if (c > 0.5 || !last) last = Math.max(last, c); }, 200);
    NovaNet.watch(v, { reload: () => false, resume: () => v.play() });
    v.play();
  }, { base, start });
}
(async () => {
  await new Promise(r => host.listen(0, '127.0.0.1', r)); await new Promise(r => site.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), page = await browser.newPage();
  await t('link too slow for the 4 Mbit/s rung (2.4 Mbit/s): drops to the low rung by itself and finishes without going back in time', async () => {
    throttle = 30000; await setup(page, 1);
    await page.waitForFunction(() => window.__ended === true, null, { timeout: 90000 });
    const r = await page.evaluate(() => ({ level: __A.level, sw: __A.switches, last: __A.last, back: __maxBack, t: document.getElementById('v').currentTime, speed: Math.round(__A.speed) }));
    console.log('      ', JSON.stringify(r), hits.slice(0, 6).join(' '));
    assert.strictEqual(r.level, 0); assert.ok(r.sw >= 1); assert.ok(r.back < 2, 'jumped back ' + r.back + ' s'); assert.ok(r.t > 49);
  });
  await t('fast link, low start: after a calm period the next rung is probed and the player climbs, keeping its place', async () => {
    throttle = 0; await setup(page, 0);
    await page.waitForFunction(() => window.__A.level === 1, null, { timeout: 40000 });
    await page.waitForFunction(() => { const v = document.getElementById('v'); return __A.hold == null && v.readyState >= 2; }, null, { timeout: 10000 });
    const r = await page.evaluate(() => ({ level: __A.level, t: document.getElementById('v').currentTime, probed: Math.round(__A.probed || 0), back: __maxBack }));
    console.log('      ', JSON.stringify(r), hits.join(' '));
    assert.ok(r.probed > 8e6, 'probe ' + r.probed); assert.ok(r.t > 18, 'switched too early ' + r.t); assert.ok(r.back < 2);
    await page.waitForFunction((t0) => document.getElementById('v').currentTime > t0 + 3 || window.__ended, r.t, { timeout: 15000 });   /* and it keeps playing on the new rung */
  });
  await browser.close(); console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
