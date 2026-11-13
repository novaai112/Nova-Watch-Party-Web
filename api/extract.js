const https = require('https');
const http = require('http');
const { URL } = require('url');

function fetchPage(targetUrl, customHeaders = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Too many redirects'));
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(e);
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': parsed.origin + '/'
      }, customHeaders),
      timeout: 12000
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        res.resume();
        return resolve(fetchPage(nextUrl, customHeaders, redirects - 1));
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total <= 3 * 1024 * 1024) chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          finalUrl: targetUrl,
          body: Buffer.concat(chunks).toString('utf-8')
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

function unescapeUrl(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

function resolveCandidateUrl(candidate, baseUrl) {
  const cleaned = unescapeUrl(candidate);
  if (!cleaned || cleaned.startsWith('blob:') || cleaned.startsWith('data:')) return null;
  try {
    const resolved = new URL(cleaned, baseUrl).toString();
    if (!/^https?:\/\//i.test(resolved)) return null;
    return resolved;
  } catch (e) {
    return null;
  }
}

function extractStreamsFromHtml(html, baseUrl) {
  const streams = [];
  const seen = new Set();

  function addStream(url, type = 'auto', label = 'HD') {
    const resolved = resolveCandidateUrl(url, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|woff|woff2|ttf|ico)(\?|$)/i.test(resolved)) return;
    seen.add(resolved);

    let streamType = type;
    if (/\.m3u8(\?|$)/i.test(resolved)) streamType = 'hls';
    else if (/\.mpd(\?|$)/i.test(resolved)) streamType = 'dash';
    else if (/\.mp4(\?|$)/i.test(resolved)) streamType = 'mp4';
    else if (/\.webm(\?|$)/i.test(resolved)) streamType = 'webm';

    streams.push({ url: resolved, type: streamType, label });
  }

  let title = '';
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                  html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  title = (ogTitle ? ogTitle[1] : (titleTag ? titleTag[1] : '')).replace(/\s+/g, ' ').trim();

  let thumbnail = '';
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                  html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogImage) thumbnail = resolveCandidateUrl(ogImage[1], baseUrl) || '';

  const ogVideoRegex = /<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["'][^>]+content=["']([^"']+)["']/gi;
  let match;
  while ((match = ogVideoRegex.exec(html)) !== null) {
    addStream(match[1], 'video', 'Meta Video');
  }

  const ldJsonRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = ldJsonRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== 'object') continue;
        if (item.contentUrl) addStream(item.contentUrl, 'video', 'ContentURL');
        if (item.embedUrl && /\.(mp4|m3u8|webm)/i.test(item.embedUrl)) addStream(item.embedUrl, 'video', 'EmbedURL');
        if (!title && item.name) title = String(item.name);
        if (!thumbnail && item.thumbnailUrl) {
          const thumbCandidate = Array.isArray(item.thumbnailUrl) ? item.thumbnailUrl[0] : item.thumbnailUrl;
          thumbnail = resolveCandidateUrl(thumbCandidate, baseUrl) || thumbnail;
        }
        for (const val of Object.values(item)) {
          if (val && typeof val === 'object') stack.push(val);
        }
      }
    } catch (e) {}
  }

  const videoTagRegex = /<(?:video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = videoTagRegex.exec(html)) !== null) {
    addStream(match[1], 'video', 'HTML5 Video');
  }

  const adultPatterns = [
    /setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,
    /setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,
    /setVideoHLS\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,
    /["'](?:videoUrl|video_url|hlsUrl|hls_url|contentUrl|file|stream_url|mp4Url|manifestUrl)["']\s*:\s*["'](https?:\\?\/\\?\/[^"']+)["']/gi,
    /((?:https?:)?(?:\/|\\\/){2}[^"'\\\s<>]+?\.(?:m3u8|mp4|webm)(?:\?[^"'\\\s<>]*)?)/gi
  ];

  for (const pattern of adultPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      addStream(match[1], 'auto', 'Direct Stream');
    }
  }

  streams.sort((a, b) => {
    const score = (s) => (s.type === 'hls' ? 3 : s.type === 'mp4' ? 2 : 1);
    return score(b) - score(a);
  });

  return {
    title: title || 'Web Video',
    thumbnail,
    streams
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  try {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const targetUrl = (parsed.searchParams.get('url') || '').trim();

    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Invalid URL' }));
    }

    if (/\.(m3u8|mp4|webm|ogg)(\?|$)/i.test(targetUrl)) {
      const streamType = /\.m3u8(\?|$)/i.test(targetUrl) ? 'hls' : 'mp4';
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        url: targetUrl,
        title: decodeURIComponent(targetUrl.split('/').pop().split('?')[0]) || 'Direct Web Video',
        thumbnail: '',
        streamUrl: targetUrl,
        proxiedStreamUrl: `/api/browse?stream=1&url=${encodeURIComponent(targetUrl)}`,
        streamType,
        streams: [{ url: targetUrl, type: streamType, label: 'Direct' }]
      }));
    }

    const page = await fetchPage(targetUrl);
    const contentType = String(page.headers['content-type'] || '').toLowerCase();

    if (contentType.includes('video/') || contentType.includes('mpegurl') || contentType.includes('application/vnd.apple.mpegurl')) {
      const streamType = contentType.includes('mpegurl') ? 'hls' : 'mp4';
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        url: page.finalUrl,
        title: 'Direct Stream',
        thumbnail: '',
        streamUrl: page.finalUrl,
        proxiedStreamUrl: `/api/browse?stream=1&url=${encodeURIComponent(page.finalUrl)}`,
        streamType,
        streams: [{ url: page.finalUrl, type: streamType, label: 'Direct' }]
      }));
    }

    const extracted = extractStreamsFromHtml(page.body, page.finalUrl);
    const best = extracted.streams[0] || null;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      url: page.finalUrl,
      title: extracted.title,
      thumbnail: extracted.thumbnail,
      streamUrl: best ? best.url : null,
      proxiedStreamUrl: best ? `/api/browse?stream=1&url=${encodeURIComponent(best.url)}&ref=${encodeURIComponent(page.finalUrl)}` : null,
      streamType: best ? best.type : null,
      streams: extracted.streams
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: ((err && err.message) || 'Extraction failed'), streams: [] }));
  }
};

module.exports.extractStreamsFromHtml = extractStreamsFromHtml;