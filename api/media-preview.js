const https = require('https');
const { URL } = require('url');


const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp', 'image/avif']);

function isAllowedImageUrl(url) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (url.pathname.split('/').includes('..')) return false;
  return url.hostname === 'klipy.com' || url.hostname.endsWith('.klipy.com') ||
    url.hostname === 'klipy.co' || url.hostname.endsWith('.klipy.co');
}

function sendError(res, status, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(message);
}

function fetchImage(url, res, redirects = 2) {
  const request = https.get(url, {
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
    timeout: 8000
  }, upstream => {
    if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
      if (redirects === 0) {
        upstream.resume();
        return sendError(res, 502, 'The image provider redirected too many times.');
      }
      let nextUrl;
      try {
        nextUrl = new URL(upstream.headers.location, url);
      } catch {
        upstream.resume();
        return sendError(res, 502, 'The image provider returned an invalid redirect.');
      }
      upstream.resume();
      if (!isAllowedImageUrl(nextUrl)) return sendError(res, 502, 'The image provider redirected to an unsupported host.');
      return fetchImage(nextUrl, res, redirects - 1);
    }

    if (upstream.statusCode !== 200) {
      upstream.resume();
      return sendError(res, upstream.statusCode === 404 ? 404 : 502, 'The image provider could not return this preview.');
    }

    const contentType = String(upstream.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(contentType)) {
      upstream.resume();
      return sendError(res, 415, 'The provider response is not a supported image.');
    }
    const contentLength = Number(upstream.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      upstream.resume();
      return sendError(res, 413, 'The provider image is too large to preview.');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (Number.isFinite(contentLength) && contentLength >= 0) res.setHeader('Content-Length', contentLength);

    let bytes = 0;
    upstream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_IMAGE_BYTES) {
        upstream.destroy();
        return sendError(res, 413, 'The provider image is too large to preview.');
      }
      res.write(chunk);
    });
    upstream.on('end', () => res.end());
    upstream.on('error', () => sendError(res, 502, 'The provider image download failed.'));
  });

  request.on('timeout', () => request.destroy(new Error('Image provider request timed out.')));
  request.on('error', error => {
    console.error(`Media preview request failed for ${url.hostname}: ${error.code || 'network error'}`);
    sendError(res, 502, 'The provider image could not be downloaded.');
  });
}

module.exports = (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'Use GET to load an image preview.');
  }

  let url;
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const value = requestUrl.searchParams.get('url');
    if (!value || value.length > 2048) return sendError(res, 400, 'A valid image URL is required.');
    url = new URL(value);
  } catch {
    return sendError(res, 400, 'A valid image URL is required.');
  }

  if (!isAllowedImageUrl(url)) return sendError(res, 400, 'This image host is not supported.');
  return fetchImage(url, res);
};
