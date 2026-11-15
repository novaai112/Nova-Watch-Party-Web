/* Unit test for the media stream proxy in api/browse.js (slices, cache, keep-alive, cancel, retry, SSRF, HLS rewrite).
   Run: node tests/proxy-stream.test.js */
process.env.NOVA_PROXY_ALLOW_PRIVATE = '1';
const http = require('http'), assert = require('assert');
const handler = require('../api/browse.js');
const SIZE = 20 * 1024 * 1024, FILE = Buffer.alloc(SIZE, 7), MB = 1024 * 1024;
let conns = 0, aborted = 0, flaky = 1, lastHeaders = null;
const upstream = http.createServer((req, res) => {
  lastHeaders = req.headers;
  if (req.url.startsWith('/pl.m3u8')) { res.setHeader('content-type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n'); }
  if (req.url.startsWith('/live.m3u8')) { res.setHeader('content-type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXTINF:4,\nseg9.ts\n'); }
  if (req.url.startsWith('/flaky')) { if (flaky-- > 0) return req.socket.destroy(); return res.end('ok-after-retry'); }
  if (req.url.startsWith('/slow')) { res.writeHead(200, { 'content-length': SIZE }); const iv = setInterval(() => res.write(Buffer.alloc(65536)), 5); res.on('close', () => { clearInterval(iv); aborted++; }); return; }
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (!m) { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': SIZE, 'accept-ranges': 'bytes' }); return res.end(FILE); }
  const a = +m[1], b = m[2] === '' ? SIZE - 1 : Math.min(+m[2], SIZE - 1);
  res.writeHead(206, { 'content-type': 'video/mp4', 'content-length': b - a + 1, 'content-range': `bytes ${a}-${b}/${SIZE}`, 'accept-ranges': 'bytes' });
  res.end(FILE.subarray(a, b + 1));
});
upstream.on('connection', () => conns++);
const proxy = http.createServer((req, res) => handler(req, res));
const get = (p, headers, abortAfter, agent) => new Promise((resolve, reject) => {
  const r = http.get({ port: proxy.address().port, path: p, headers, agent: agent || false }, res => {
    let n = 0, body = [];
    res.on('data', c => { n += c.length; if (!abortAfter && n < 4096) body.push(c); if (abortAfter && n >= abortAfter) { r.destroy(); resolve({ status: res.statusCode, n, h: res.headers, aborted: true }); } });
    res.on('end', () => resolve({ status: res.statusCode, n, h: res.headers, text: Buffer.concat(body).toString() }));
  });
  r.on('error', e => { if (!abortAfter) reject(e); });
});
let ok = 0, bad = 0;
const t = async (name, f) => { try { await f(); ok++; console.log('  ✓', name); } catch (e) { bad++; console.error('  ✗', name, '\n    ', String(e.message).split('\n')[0]); } };
const U = (p) => `/api/browse?stream=1&url=${encodeURIComponent('http://127.0.0.1:' + upstream.address().port + p)}&ref=${encodeURIComponent('https://x.com/')}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  await t('open range "bytes=0-" is answered with one 6 MB slice (206 + Content-Range)', async () => {
    const r = await get(U('/f.mp4'), { range: 'bytes=0-' });
    assert.strictEqual(r.status, 206); assert.strictEqual(r.n, 6 * MB); assert.strictEqual(r.h['content-range'], `bytes 0-${6 * MB - 1}/${SIZE}`);
  });
  await t('small exact range stays exact', async () => { const r = await get(U('/f.mp4'), { range: 'bytes=100-199' }); assert.strictEqual(r.n, 100); });
  await t('seek near the end returns only what is left', async () => { const r = await get(U('/f.mp4'), { range: `bytes=${SIZE - 1000}-` }); assert.strictEqual(r.n, 1000); });
  await t('browser may cache the slice, never a shared CDN copy', async () => { const r = await get(U('/f.mp4'), { range: 'bytes=0-99' }); assert.match(r.h['cache-control'], /^private, max-age=\d+/); });
  await t('connections to the video host are reused (keep-alive)', async () => {
    const before = conns; for (let i = 0; i < 6; i++) await get(U('/f.mp4'), { range: `bytes=${i * 100}-${i * 100 + 99}` });
    assert.ok(conns - before <= 2, 'new connections: ' + (conns - before));
  });
  await t('viewer leaves → upstream download is cancelled at once', async () => {
    const before = aborted; await get(U('/slow'), { range: 'bytes=0-' }, 200000); await wait(400); assert.ok(aborted > before, 'upstream still running');
  });
  await t('a connection reset before any data is retried once, quietly', async () => { const r = await get(U('/flaky')); assert.strictEqual(r.status, 200); assert.strictEqual(r.text, 'ok-after-retry'); });
  await t('HLS playlist: segments and key go through the proxy; finished playlist cached briefly, live one never', async () => {
    const r = await get(U('/pl.m3u8')); assert.match(r.text, /URI="\/api\/browse\?stream=1&url=/); assert.match(r.text, /\/api\/browse\?stream=1&url=.*seg1\.ts/); assert.strictEqual(r.h['cache-control'], 'private, max-age=60');
    const l = await get(U('/live.m3u8')); assert.strictEqual(l.h['cache-control'], 'no-cache');
  });
  await t('referer is sent to the video host', async () => { await get(U('/f.mp4'), { range: 'bytes=0-9' }); assert.strictEqual(lastHeaders.referer, 'https://x.com/'); });
  await t('private / internal addresses are refused when not in test mode', async () => {
    process.env.NOVA_PROXY_ALLOW_PRIVATE = '0';
    try { const r = await get(U('/f.mp4'), { range: 'bytes=0-9' }); assert.strictEqual(r.status, 403); } finally { process.env.NOVA_PROXY_ALLOW_PRIVATE = '1'; }
  });
  console.log(`\n${ok} passed, ${bad} failed`); upstream.closeAllConnections && upstream.closeAllConnections(); process.exit(bad ? 1 : 0);
})();
