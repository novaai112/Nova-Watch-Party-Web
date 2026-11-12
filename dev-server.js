/* Local development server: serves this folder and the /api functions the way Vercel does.
   Usage:  node dev-server.js     then open http://localhost:3000/nova-home.html
   Put YOUTUBE_API_KEY=... in .env.local (git-ignored) to test video search locally. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
try {
  fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && !l.trim().startsWith('#') && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const root = __dirname, port = +process.env.PORT || 3000;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const m = /^\/api\/([\w-]+)$/.exec(u.pathname);
  if (m) {
    const f = path.join(root, 'api', m[1] + '.js');
    if (!fs.existsSync(f) || m[1][0] === '_') { res.statusCode = 404; return res.end('Not found'); }
    req.query = Object.fromEntries(u.searchParams);
    return Promise.resolve(require(f)(req, res)).catch(e => { res.statusCode = 500; res.end(String(e && e.message)); });
  }
  let p = path.normalize(path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
  if (!p.startsWith(root) || /(^|[\\/])\.(env|git)/.test(p)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream'); res.end(buf);
  });
}).listen(port, () => console.log('Nova dev server: http://localhost:' + port + '/nova-home.html' + (process.env.YOUTUBE_API_KEY ? '' : '   (YOUTUBE_API_KEY not set: YouTube search will not work)')));
