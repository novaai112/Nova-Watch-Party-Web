/* Real-browser test: playback on a bad connection, through our stream proxy.
   1. throttled host (~3 Mbit/s): the clip plays to the end through sliced ranges
   2. host freezes mid-video: room-net.js notices and playback continues by itself
   3. connection dropped mid-body: playback recovers from the same second
   Run: CLIP=/tmp/clip.mp4 node tests/e2e-slow-playback.js  (needs playwright + chromium; ffmpeg -f lavfi -i testsrc=duration=30:size=640x360:rate=25 -c:v libx264 -b:v 1500k -g 50 -movflags +faststart clip.mp4) */
process.env.NOVA_PROXY_ALLOW_PRIVATE = '1';
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const CLIP = fs.readFileSync(process.env.CLIP || path.join(__dirname, 'clip.mp4')), SIZE = CLIP.length;
const handler = require('../api/browse.js'), NET = fs.readFileSync(path.join(__dirname, '../room-net.js'), 'utf8');
let mode = 'normal', hits = [], frozen = false, dropped = false;
const rng = (req) => { const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || ''); return m ? [+m[1], m[2] === '' ? SIZE - 1 : Math.min(+m[2], SIZE - 1)] : [0, SIZE - 1]; };
const host = http.createServer((req, res) => {
  const [a, b] = rng(req); hits.push(a);
  res.writeHead(req.headers.range ? 206 : 200, Object.assign({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': b - a + 1 }, req.headers.range ? { 'content-range': `bytes ${a}-${b}/${SIZE}` } : {}));
  const body = CLIP.subarray(a, b + 1);
  if (mode === 'freeze' && a === 0 && !frozen) { frozen = true; res.write(body.subarray(0, 450000)); return; }                       /* then silence, never ends */
  if (mode === 'drop' && a === 0 && !dropped) { dropped = true; res.write(body.subarray(0, 450000)); setTimeout(() => req.socket.destroy(), 500); return; }
  if (mode === 'slow') { let o = 0; const iv = setInterval(() => { if (o >= body.length) { clearInterval(iv); return res.end(); } res.write(body.subarray(o, o += 40000)); }, 100); res.on('close', () => clearInterval(iv)); return; }   /* ~3.2 Mbit/s */
  res.end(body);
});
const site = http.createServer((req, res) => {
  if (req.url === '/room-net.js') { res.setHeader('content-type', 'text/javascript'); return res.end(NET); }
  if (req.url.startsWith('/api/browse')) return handler(req, res);
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><body style="margin:0"><video id="v" muted playsinline preload="auto" width="320"></video><script src="/room-net.js"></script></body>');
});
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', String(e.message).split('\n')[0]); } };
async function play(page, m) {
  mode = m; hits = []; frozen = dropped = false;
  const src = `/api/browse?stream=1&url=${encodeURIComponent('http://127.0.0.1:' + host.address().port + '/clip.mp4')}&ref=${encodeURIComponent('https://x.com/')}`;
  await page.goto(`http://127.0.0.1:${site.address().port}/`);
  await page.evaluate((src) => {
    const v = document.getElementById('v'); v.src = src;
    const hooks = { reload: () => false, resume: () => v.play() };
    window.__w = NovaNet.watch(v, hooks);
    v.addEventListener('error', () => NovaNet.recoverError(v, hooks));
    v.addEventListener('ended', () => { window.__ended = true; });
    v.play();
  }, src);
  await page.waitForFunction(() => window.__ended === true, null, { timeout: 60000 });
  return page.evaluate(() => ({ t: document.getElementById('v').currentTime, w: window.__w.stats }));
}
(async () => {
  await new Promise(r => host.listen(0, '127.0.0.1', r)); await new Promise(r => site.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), page = await browser.newPage();
  await t('throttled host: the whole clip plays to the end through sliced ranges', async () => { const r = await play(page, 'slow'); assert.ok(r.t > 29, 'ended at ' + r.t); console.log('      watchdog', JSON.stringify(r.w), 'requests at', hits.join(',')); });
  await t('host freezes mid-video → watchdog restarts the download, playback continues by itself', async () => { const r = await play(page, 'freeze'); assert.ok(r.w.reloads >= 1, 'no reload: ' + JSON.stringify(r.w)); console.log('      requests at', hits.join(',')); });
  await t('connection dropped mid-body → playback recovers', async () => { const r = await play(page, 'drop'); assert.ok(r.t > 29); console.log('      requests at', hits.join(',')); });
  await browser.close(); console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
