const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const tlsTrust = require('./tls-trust');

tlsTrust.configureSystemCa();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.join(__dirname, '.env.local'));
loadEnvFile(path.join(__dirname, '.env'));

const websearchHandler = require('./api/websearch');
const browseHandler = require('./api/browse');
const extractHandler = require('./api/extract');
const configHandler = require('./api/config');
let youtubeHandler = null;
try {
  youtubeHandler = require('./api/youtube');
} catch (e) {}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/websearch') return await websearchHandler(req, res);
    if (pathname === '/api/browse') return await browseHandler(req, res);
    if (pathname === '/api/extract') return await extractHandler(req, res);
    if (pathname === '/api/config') return configHandler(req, res);
    if (pathname === '/api/youtube' && youtubeHandler) return await youtubeHandler(req, res);

    let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    if (safePath === '/' || safePath === '\\') safePath = '/index.html';

    let filePath = path.join(__dirname, safePath);
    if (!fs.existsSync(filePath) && !path.extname(filePath) && fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      return fs.createReadStream(filePath).pipe(res);
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(err.message || 'Internal Server Error');
  }
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Nova Watch Party server running on http://localhost:${PORT}`);
});