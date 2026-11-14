const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = '' + require('path').resolve(__dirname, '../..') + '', FAKE = fs.readFileSync('' + require('path').join(__dirname, 'fake-sb.js') + '', 'utf8');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
function serve() { return new Promise(r => { const s = http.createServer((q, res) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); } res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f)); }); s.listen(0, () => r(s)); }); }
async function open({ w = 390, h = 844, hash = '#chat', mobile = true } = {}) {
  const server = await serve(), port = server.address().port, browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });
  await page.route('**/*', route => { const u = route.request().url(); if (u.startsWith(`http://localhost:${port}`) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: FAKE });
    if (/qrcode-generator/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: 'window.qrcode=function(){var d="";return{addData:function(x){d=x},make:function(){},createSvgTag:function(){return \'<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/><rect x="2" y="2" width="6" height="6" fill="#fff"/></svg>\'}}}' });
    if (/storage\/v1\/object/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.abort(); });
  await page.route(`http://localhost:${port}/api/link-preview**`, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://example.com/trailer', title: 'Dune Trailer', description: 'Official trailer', siteName: 'example.com', image: '' }) }));
  await page.goto(`http://localhost:${port}/profile.html${hash}`);
  return { page, errors, close: async () => { await browser.close(); server.close(); }, port };
}
module.exports = { open };
