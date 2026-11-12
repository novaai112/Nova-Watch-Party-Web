const tlsTrust = require('../tls-trust');
tlsTrust.configureSystemCa();
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { URL } = require('url');
const { runUnifiedSearch } = require('./websearch');
const { extractStreamsFromHtml } = require('./extract');

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getInjectedBrowserScript(pageUrl, preExtracted) {
  const safePageUrl = JSON.stringify(pageUrl);
  const safeExtracted = JSON.stringify(preExtracted || { title: '', thumbnail: '', streams: [] });

  return `<script>
(function() {
  var CURRENT_PAGE_URL = ${safePageUrl};
  var PRE_EXTRACTED = ${safeExtracted};
  var lastPromptedUrl = '';
  var reportedStreams = {};

  function resolveAbs(raw) {
    if (!raw || typeof raw !== 'string') return '';
    if (raw.indexOf('blob:') === 0 || raw.indexOf('data:') === 0) return '';
    try {
      return new URL(raw, CURRENT_PAGE_URL).toString();
    } catch (e) {
      return '';
    }
  }

  function getBestTitle(el) {
    if (el && el.getAttribute) {
      var t = el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('data-title');
      if (t && t.trim()) return t.trim();
    }
    var og = document.querySelector('meta[property="og:title"]');
    if (og && og.content && og.content.trim()) return og.content.trim();
    var h1 = document.querySelector('h1');
    if (h1 && h1.textContent && h1.textContent.trim()) return h1.textContent.trim();
    if (PRE_EXTRACTED && PRE_EXTRACTED.title) return PRE_EXTRACTED.title;
    return (document.title || 'Web Video').trim();
  }

  function getBestThumbnail(el) {
    if (el && el.poster) return resolveAbs(el.poster);
    var og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) return resolveAbs(og.content);
    if (PRE_EXTRACTED && PRE_EXTRACTED.thumbnail) return PRE_EXTRACTED.thumbnail;
    return '';
  }

  function notifyParentMedia(streamUrl, title, thumbnail, autoPrompt) {
    var abs = resolveAbs(streamUrl);
    if (!abs) return;
    if (/\\.(jpg|jpeg|png|gif|webp|svg|css|js|woff|ico)(\\?|$)/i.test(abs)) return;

    var streamType = /\\.m3u8(\\?|$)/i.test(abs) ? 'hls' : (/\\.mpd(\\?|$)/i.test(abs) ? 'dash' : 'mp4');
    var proxiedUrl = '/api/browse?stream=1&url=' + encodeURIComponent(abs) + '&ref=' + encodeURIComponent(CURRENT_PAGE_URL);

    var payload = {
      type: autoPrompt ? 'NOVA_WEB_VIDEO_PROMPT' : 'NOVA_WEB_VIDEO_DETECTED',
      pageUrl: CURRENT_PAGE_URL,
      streamUrl: abs,
      proxiedStreamUrl: proxiedUrl,
      streamType: streamType,
      title: title || getBestTitle(),
      thumbnail: thumbnail || getBestThumbnail()
    };

    if (autoPrompt) {
      if (lastPromptedUrl === abs) return;
      lastPromptedUrl = abs;
    } else {
      if (reportedStreams[abs]) return;
      reportedStreams[abs] = true;
    }

    try {
      window.parent.postMessage(payload, '*');
    } catch (e) {}
  }

  function inspectMediaElement(el, shouldPrompt) {
    if (!el) return;
    var candidate = el.currentSrc || el.src || '';
    if (!candidate) {
      var srcEl = el.querySelector && el.querySelector('source[src]');
      if (srcEl) candidate = srcEl.getAttribute('src') || '';
    }
    if (candidate && candidate.indexOf('blob:') !== 0) {
      notifyParentMedia(candidate, getBestTitle(el), getBestThumbnail(el), shouldPrompt);
    } else if (shouldPrompt && PRE_EXTRACTED && PRE_EXTRACTED.streams && PRE_EXTRACTED.streams.length > 0) {
      notifyParentMedia(PRE_EXTRACTED.streams[0].url, getBestTitle(el), getBestThumbnail(el), true);
    }
  }

  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function() {
    try {
      inspectMediaElement(this, true);
    } catch (e) {}
    return origPlay.apply(this, arguments);
  };

  document.addEventListener('play', function(e) {
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
      inspectMediaElement(e.target, true);
    }
  }, true);

  document.addEventListener('loadedmetadata', function(e) {
    if (e.target && e.target.tagName === 'VIDEO') {
      inspectMediaElement(e.target, true);
    }
  }, true);

  document.addEventListener('click', function(e) {
    var v = e.target && e.target.closest ? e.target.closest('video, .jwplayer, .video-js, .plyr, [class*="player"], [id*="player"]') : null;
    if (v) {
      var vid = v.tagName === 'VIDEO' ? v : v.querySelector('video');
      if (vid) {
        setTimeout(function() { inspectMediaElement(vid, true); }, 250);
      } else if (PRE_EXTRACTED && PRE_EXTRACTED.streams && PRE_EXTRACTED.streams.length > 0) {
        notifyParentMedia(PRE_EXTRACTED.streams[0].url, getBestTitle(), getBestThumbnail(), true);
      }
    }
  }, true);

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      try {
        var reqUrl = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (/\\.(m3u8|mp4|webm)(\\?|$)/i.test(reqUrl)) {
          notifyParentMedia(reqUrl, getBestTitle(), getBestThumbnail(), true);
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try {
      if (typeof url === 'string' && /\\.(m3u8|mp4|webm)(\\?|$)/i.test(url)) {
        notifyParentMedia(url, getBestTitle(), getBestThumbnail(), true);
      }
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var rawHref = a.getAttribute('href');
    if (!rawHref || rawHref.indexOf('javascript:') === 0 || rawHref.indexOf('#') === 0) return;
    var abs = resolveAbs(rawHref);
    if (!abs) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      window.parent.postMessage({ type: 'NOVA_WEB_NAVIGATE', url: abs, title: document.title || abs }, '*');
    } catch (err) {}
    window.location.href = '/api/browse?url=' + encodeURIComponent(abs);
  }, true);

  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var action = form.getAttribute('action') || CURRENT_PAGE_URL;
    var absAction = resolveAbs(action) || CURRENT_PAGE_URL;
    var method = (form.getAttribute('method') || 'GET').toUpperCase();
    if (method === 'GET') {
      e.preventDefault();
      var fd = new FormData(form);
      var target = new URL(absAction);
      fd.forEach(function(value, key) {
        target.searchParams.set(key, String(value));
      });
      var finalUrl = target.toString();
      try {
        window.parent.postMessage({ type: 'NOVA_WEB_NAVIGATE', url: finalUrl }, '*');
      } catch (err) {}
      window.location.href = '/api/browse?url=' + encodeURIComponent(finalUrl);
    }
  }, true);

  function scanAllVideos() {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      inspectMediaElement(videos[i], true);
    }
    if (PRE_EXTRACTED && PRE_EXTRACTED.streams && PRE_EXTRACTED.streams.length > 0) {
      notifyParentMedia(PRE_EXTRACTED.streams[0].url, PRE_EXTRACTED.title || getBestTitle(), PRE_EXTRACTED.thumbnail || getBestThumbnail(), true);
    }
  }

  window.addEventListener('DOMContentLoaded', function() {
    try {
      window.parent.postMessage({
        type: 'NOVA_WEB_PAGE_LOADED',
        url: CURRENT_PAGE_URL,
        title: document.title || CURRENT_PAGE_URL
      }, '*');
    } catch (e) {}
    setTimeout(scanAllVideos, 700);
  });

  setTimeout(scanAllVideos, 1600);
})();
</script>`;
}

function renderGoogleDarkSearchPage(searchData) {
  const q = searchData.query || '';
  const tab = searchData.tab || 'all';
  const results = searchData.results || [];
  const videoCards = searchData.videoCards || [];
  const emptyResultsMessage = searchData.message || 'No results found. Try another keyword or direct URL.';

  const resultItemsHtml = results.map((item) => {
    const thumbHtml = item.thumbnail ? `
      <div class="gs-thumb-wrap">
        <img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
        ${item.duration ? `<span class="gs-duration">${escapeHtml(item.duration)}</span>` : ''}
      </div>` : '';

    return `
      <div class="gs-result-card">
        <a class="gs-result-header" href="/api/browse?url=${encodeURIComponent(item.url)}" data-target-url="${escapeHtml(item.url)}">
          <img class="gs-favicon" src="${escapeHtml(item.favicon)}" alt="" onerror="this.style.display='none'">
          <div class="gs-site-meta">
            <div class="gs-site-name">${escapeHtml(item.source || item.domain)}</div>
            <div class="gs-site-url">${escapeHtml(item.url)}</div>
          </div>
        </a>
        <a class="gs-result-title" href="/api/browse?url=${encodeURIComponent(item.url)}" data-target-url="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>
        <div class="gs-result-body">
          ${thumbHtml}
          <div class="gs-snippet">${escapeHtml(item.snippet || '')}</div>
        </div>
      </div>`;
  }).join('');

  const topStoriesHtml = videoCards.length > 0 ? `
    <div class="gs-stories-section">
      <div class="gs-stories-heading">Top stories &amp; videos</div>
      <div class="gs-stories-grid">
        ${videoCards.slice(0, 4).map((vc) => `
          <a class="gs-story-card" href="/api/browse?url=${encodeURIComponent(vc.url)}" data-target-url="${escapeHtml(vc.url)}">
            <div class="gs-story-info">
              <div class="gs-story-source">
                <img src="${escapeHtml(vc.favicon)}" alt="" onerror="this.style.display='none'">
                <span>${escapeHtml(vc.source || vc.domain)}</span>
              </div>
              <div class="gs-story-title">${escapeHtml(vc.title)}</div>
              <div class="gs-story-time"><span class="gs-badge">VIDEO</span> ${escapeHtml(vc.views || vc.published || 'Watch now')}</div>
            </div>
            ${vc.thumbnail ? `
              <div class="gs-story-thumb">
                <img src="${escapeHtml(vc.thumbnail)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
                ${vc.duration ? `<span class="gs-story-dur">&#9654; ${escapeHtml(vc.duration)}</span>` : ''}
              </div>
            ` : ''}
          </a>
        `).join('')}
      </div>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(q)} - Google Search</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #202124;
    color: #bdc1c6;
    font-family: Arial, sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }
  .gs-topbar {
    position: sticky;
    top: 0;
    z-index: 50;
    background: #202124;
    border-bottom: 1px solid #3c4043;
    padding: 18px 24px 0;
  }
  .gs-header-row {
    display: flex;
    align-items: center;
    gap: 28px;
    max-width: 1180px;
  }
  .gs-logo {
    color: #fff;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.5px;
    text-decoration: none;
    user-select: none;
    flex-shrink: 0;
  }
  .gs-search-form {
    flex: 1;
    max-width: 690px;
    display: flex;
    align-items: center;
    background: #303134;
    border: 1px solid transparent;
    border-radius: 24px;
    height: 46px;
    padding: 0 16px;
    box-shadow: 0 1px 6px rgba(0,0,0,0.35);
  }
  .gs-search-form:focus-within {
    background: #303134;
    border-color: #5f6368;
  }
  .gs-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #e8eaed;
    font-size: 16px;
  }
  .gs-clear-btn, .gs-submit-btn {
    background: none;
    border: none;
    color: #9aa0a6;
    cursor: pointer;
    padding: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gs-tabs {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-top: 16px;
    padding-left: 116px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .gs-tab {
    color: #969ba1;
    text-decoration: none;
    font-size: 14px;
    padding-bottom: 12px;
    border-bottom: 3px solid transparent;
    white-space: nowrap;
  }
  .gs-tab.active {
    color: #8ab4f8;
    border-bottom-color: #8ab4f8;
  }
  .gs-container {
    max-width: 760px;
    margin-left: 140px;
    padding: 24px 16px 80px;
  }
  .gs-result-card {
    margin-bottom: 28px;
  }
  .gs-result-header {
    display: flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    margin-bottom: 6px;
  }
  .gs-favicon {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #303134;
    padding: 3px;
    object-fit: contain;
  }
  .gs-site-name {
    color: #dadce0;
    font-size: 14px;
    line-height: 1.3;
  }
  .gs-site-url {
    color: #9aa0a6;
    font-size: 12px;
    max-width: 520px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gs-result-title {
    display: inline-block;
    color: #8ab4f8;
    font-size: 20px;
    line-height: 1.3;
    text-decoration: none;
    margin-bottom: 8px;
  }
  .gs-result-title:hover {
    text-decoration: underline;
  }
  .gs-result-body {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  .gs-thumb-wrap {
    position: relative;
    width: 148px;
    height: 84px;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
    background: #171717;
  }
  .gs-thumb-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .gs-duration {
    position: absolute;
    left: 6px;
    bottom: 6px;
    background: rgba(0,0,0,0.82);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .gs-snippet {
    color: #bdc1c6;
    font-size: 14px;
    line-height: 1.58;
  }
  .gs-stories-section {
    margin: 28px 0;
    padding-top: 16px;
    border-top: 1px solid #3c4043;
  }
  .gs-stories-heading {
    color: #e8eaed;
    font-size: 20px;
    margin-bottom: 14px;
  }
  .gs-stories-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
  }
  .gs-story-card {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    background: #28292a;
    border: 1px solid #3c4043;
    border-radius: 12px;
    padding: 12px;
    text-decoration: none;
  }
  .gs-story-info {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    flex: 1;
    min-width: 0;
  }
  .gs-story-source {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #dadce0;
    font-size: 12px;
    margin-bottom: 6px;
  }
  .gs-story-source img {
    width: 14px;
    height: 14px;
    border-radius: 3px;
  }
  .gs-story-title {
    color: #8ab4f8;
    font-size: 14px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .gs-story-time {
    color: #9aa0a6;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .gs-badge {
    border: 1px solid #5f6368;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 9px;
    letter-spacing: 0.4px;
  }
  .gs-story-thumb {
    position: relative;
    width: 96px;
    height: 96px;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
    background: #171717;
  }
  .gs-story-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .gs-story-dur {
    position: absolute;
    bottom: 6px;
    left: 6px;
    background: rgba(0,0,0,0.8);
    color: #fff;
    font-size: 10px;
    padding: 2px 5px;
    border-radius: 4px;
  }
  @media (max-width: 820px) {
    .gs-topbar { padding: 12px 12px 0; }
    .gs-header-row { flex-direction: column; align-items: stretch; gap: 10px; }
    .gs-logo { font-size: 22px; text-align: center; }
    .gs-tabs { padding-left: 4px; gap: 18px; }
    .gs-container { margin-left: 0; padding: 18px 12px 80px; }
    .gs-stories-grid { grid-template-columns: 1fr; }
    .gs-thumb-wrap { width: 120px; height: 72px; }
  }
</style>
</head>
<body>
  <div class="gs-topbar">
    <div class="gs-header-row">
      <a class="gs-logo" href="/api/browse?q=${encodeURIComponent(q)}">Google</a>
      <form class="gs-search-form" action="/api/browse" method="GET">
        <input class="gs-search-input" type="text" name="q" value="${escapeHtml(q)}" autocomplete="off">
        <button class="gs-clear-btn" type="button" onclick="this.previousElementSibling.value='';this.previousElementSibling.focus();" title="Clear">&#10005;</button>
        <button class="gs-submit-btn" type="submit" title="Search">&#128269;</button>
      </form>
    </div>
    <div class="gs-tabs">
      <a class="gs-tab ${tab === 'all' ? 'active' : ''}" href="/api/browse?q=${encodeURIComponent(q)}&tab=all">All</a>
      <a class="gs-tab ${tab === 'videos' ? 'active' : ''}" href="/api/browse?q=${encodeURIComponent(q)}&tab=videos">Videos</a>
      <a class="gs-tab" href="/api/browse?q=${encodeURIComponent(q + ' short videos')}&tab=videos">Short videos</a>
      <a class="gs-tab" href="/api/browse?q=${encodeURIComponent(q + ' full movie watch online')}&tab=all">Movies</a>
      <a class="gs-tab" href="/api/browse?q=${encodeURIComponent(q + ' news')}&tab=all">News</a>
    </div>
  </div>
  <div class="gs-container">
    ${results.length ? resultItemsHtml : `<p style="color:#9aa0a6;padding:24px 0;">${escapeHtml(emptyResultsMessage)}</p>`}
    ${topStoriesHtml}
  </div>
  <script>
    document.addEventListener('click', function(e) {
      var a = e.target.closest('a[data-target-url]');
      if (!a) return;
      var targetUrl = a.getAttribute('data-target-url');
      try {
        window.parent.postMessage({ type: 'NOVA_WEB_NAVIGATE', url: targetUrl }, '*');
      } catch (err) {}
    });
  </script>
</body>
</html>`;
}

function proxyMediaStream(targetUrl, refererUrl, req, res, redirects = 5) {
  if (redirects < 0) {
    res.statusCode = 502;
    return res.end('Too many redirects');
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    res.statusCode = 400;
    return res.end('Invalid stream URL');
  }

  const lib = parsed.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': refererUrl || (parsed.origin + '/'),
    'Origin': refererUrl ? new URL(refererUrl).origin : parsed.origin
  };
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  const upstreamReq = lib.request({
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers
  }, (upstreamRes) => {
    if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
      const nextUrl = new URL(upstreamRes.headers.location, targetUrl).toString();
      upstreamRes.resume();
      return proxyMediaStream(nextUrl, refererUrl, req, res, redirects - 1);
    }

    const contentType = String(upstreamRes.headers['content-type'] || '').toLowerCase();
    const isM3u8 = /\.m3u8(\?|$)/i.test(targetUrl) || contentType.includes('mpegurl');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    if (isM3u8) {
      const chunks = [];
      upstreamRes.on('data', (c) => chunks.push(c));
      upstreamRes.on('end', () => {
        const rawText = Buffer.concat(chunks).toString('utf-8');
        const rewritten = rawText.split(/\r?\n/).map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('#')) {
            return line.replace(/URI=["']([^"']+)["']/gi, (_, uriVal) => {
              const absUri = new URL(uriVal, targetUrl).toString();
              return `URI="/api/browse?stream=1&url=${encodeURIComponent(absUri)}&ref=${encodeURIComponent(refererUrl || targetUrl)}"`;
            });
          }
          try {
            const absSeg = new URL(trimmed, targetUrl).toString();
            return `/api/browse?stream=1&url=${encodeURIComponent(absSeg)}&ref=${encodeURIComponent(refererUrl || targetUrl)}`;
          } catch (e) {
            return line;
          }
        }).join('\n');

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.end(rewritten);
      });
      return;
    }

    res.statusCode = upstreamRes.statusCode || 200;
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forwardHeaders) {
      if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
    }
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end(tlsTrust.errorMessage(err, 'Stream request failed.'));
    }
  });
  upstreamReq.end();
}

function fetchWebpage(targetUrl, redirects = 5) {
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cookie': 'age_verified=1; accessAgeDisclaimerPH=1; accessAgeDisclaimerUK=1; over18=1; consented=1'
      },
      timeout: 14000
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        res.resume();
        return resolve(fetchWebpage(nextUrl, redirects - 1));
      }

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();

        const finish = (err, decoded) => {
          if (err) return resolve({ status: res.statusCode, headers: res.headers, finalUrl: targetUrl, buffer });
          resolve({ status: res.statusCode, headers: res.headers, finalUrl: targetUrl, buffer: decoded });
        };

        if (encoding === 'gzip') zlib.gunzip(buffer, finish);
        else if (encoding === 'deflate') zlib.inflate(buffer, finish);
        else if (encoding === 'br') zlib.brotliDecompress(buffer, finish);
        else finish(null, buffer);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Navigation timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  try {
    const parsedReq = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const isStream = parsedReq.searchParams.get('stream') === '1';
    const rawUrl = (parsedReq.searchParams.get('url') || '').trim();
    const refUrl = (parsedReq.searchParams.get('ref') || '').trim();
    const searchQuery = (parsedReq.searchParams.get('q') || '').trim();
    const searchTab = (parsedReq.searchParams.get('tab') || 'all').toLowerCase();

    if (isStream && rawUrl) {
      return proxyMediaStream(rawUrl, refUrl, req, res);
    }

    if (searchQuery) {
      const searchData = await runUnifiedSearch(searchQuery, searchTab, 1);
      const html = renderGoogleDarkSearchPage(searchData);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }

    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('Invalid or missing target URL');
    }

    if (/\.(m3u8|mp4|webm|ogg)(\?|$)/i.test(rawUrl)) {
      return proxyMediaStream(rawUrl, refUrl, req, res);
    }

    const pageRes = await fetchWebpage(rawUrl);
    const contentType = String(pageRes.headers['content-type'] || 'text/html').toLowerCase();

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      res.statusCode = pageRes.status || 200;
      res.setHeader('Content-Type', contentType);
      return res.end(pageRes.buffer);
    }

    let html = pageRes.buffer.toString('utf-8');
    const finalUrl = pageRes.finalUrl || rawUrl;
    const baseOrigin = new URL(finalUrl);
    const baseHref = `${baseOrigin.origin}${baseOrigin.pathname.replace(/[^/]*$/, '')}`;

    html = html
      .replace(/<meta[^>]+http-equiv=["'](?:Content-Security-Policy|X-Frame-Options)["'][^>]*>/gi, '')
      .replace(/\sintegrity=["'][^"']*["']/gi, '');

    const preExtracted = extractStreamsFromHtml(html, finalUrl);
    const injection = `<base href="${escapeHtml(baseHref)}">${getInjectedBrowserScript(finalUrl, preExtracted)}`;

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
    } else {
      html = `${injection}${html}`;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(html);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!DOCTYPE html><html><body style="background:#121212;color:#e8eaed;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h3>Unable to load webpage</h3><p style="color:#9aa0a6;">${escapeHtml(tlsTrust.errorMessage(err, 'Connection failed'))}</p></div></body></html>`);
  }
};

module.exports._renderGoogleDarkSearchPage = renderGoogleDarkSearchPage;