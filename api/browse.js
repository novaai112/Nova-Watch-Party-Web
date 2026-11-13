const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { URL } = require('url');
const { searchForRequest } = require('./websearch');
const { extractStreamsFromHtml } = require('./extract');

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isYouTubeVideoUrl(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) {
      return false;
    }

    const pathId = host === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : (url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/i) || [])[1];
    const videoId = url.searchParams.get('v') || pathId || '';
    const playlistId = url.searchParams.get('list') || '';
    return /^[\w-]{11}$/.test(videoId) || /^[\w-]{10,64}$/.test(playlistId);
  } catch (e) {
    return false;
  }
}

function novaInjected(CURRENT_PAGE_URL, PRE_EXTRACTED) {
  'use strict';
  var ORIGIN = location.origin;
  var TOP = window.top;
  var NESTED = window.parent !== window.top;
  var reported = {};
  var pendingNet = {};
  var netTimer = null;
  var netTries = 0;
  var lastGestureAt = 0;
  var AD_RE = /(^|[\/._-])(ads?|adserver|advert\w*|vast|vpaid|preroll|doubleclick|googlesyndication|exoclick|juicyads|trafficjunky|popads|syndication)([\/._-]|$)/i;
  var SKIP_FRAME_RE = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|google\.com|gstatic\.com|recaptcha\.net|doubleclick\.net|vimeo\.com|twitch\.tv|facebook\.com|twitter\.com|x\.com)$/i;

  function send(payload) {
    try { TOP.postMessage(payload, '*'); } catch (e) {}
  }

  function resolveAbs(raw) {
    if (!raw || typeof raw !== 'string') return '';
    if (raw.indexOf('blob:') === 0 || raw.indexOf('data:') === 0 || raw.indexOf('javascript:') === 0) return '';
    try { return new URL(raw, CURRENT_PAGE_URL).toString(); } catch (e) { return ''; }
  }

  function getBestTitle(el) {
    if (el && el.getAttribute) {
      var t = el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('data-title');
      if (t && t.trim()) return t.trim();
    }
    var og = document.querySelector('meta[property="og:title"]');
    if (og && og.content && og.content.trim()) return og.content.trim();
    var h1 = document.querySelector('h1');
    if (h1 && h1.textContent && h1.textContent.trim()) return h1.textContent.trim().slice(0, 160);
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

  function typeFrom(raw, contentType) {
    var ct = String(contentType || '').toLowerCase();
    if (ct.indexOf('mpegurl') !== -1) return 'hls';
    if (ct.indexOf('dash+xml') !== -1) return 'dash';
    if (ct.indexOf('video/webm') !== -1) return 'webm';
    if (ct.indexOf('video/ogg') !== -1) return 'ogg';
    if (ct.indexOf('video/mp4') !== -1 || ct.indexOf('video/quicktime') !== -1) return 'mp4';
    var path = '';
    try { path = new URL(raw, CURRENT_PAGE_URL).pathname.toLowerCase(); } catch (e) { return ''; }
    if (/\.m3u8$/.test(path)) return 'hls';
    if (/\.mpd$/.test(path)) return 'dash';
    if (/\.(mp4|m4v|mov)$/.test(path)) return 'mp4';
    if (/\.webm$/.test(path)) return 'webm';
    if (/\.(ogv|ogg)$/.test(path)) return 'ogg';
    return '';
  }

  function isYouTubeVideoUrl(raw) {
    try {
      var url = new URL(raw);
      var host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be'].indexOf(host) === -1) return false;
      var pathId = host === 'youtu.be'
        ? url.pathname.split('/').filter(Boolean)[0]
        : ((url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/i) || [])[1] || '');
      var videoId = url.searchParams.get('v') || pathId;
      var playlistId = url.searchParams.get('list') || '';
      return /^[\w-]{11}$/.test(videoId || '') || /^[\w-]{10,64}$/.test(playlistId);
    } catch (e) { return false; }
  }

  function hasMainVideo() {
    var vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      if (v.loop && v.muted) continue;
      var r = v.getBoundingClientRect();
      if (r.width >= 200 || v.videoWidth >= 360) return true;
    }
    return false;
  }

  function report(streamUrl, streamType, source, title, thumbnail, explicit) {
    var abs = resolveAbs(streamUrl);
    if (!abs) return;
    if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|woff2?|ttf|ico|vtt|srt|ts|m4s|aac|mp3)(\?|$)/i.test(abs)) return;
    var parsed;
    try { parsed = new URL(abs); } catch (e) { return; }
    if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost') {
      parsed.protocol = 'https:';
      abs = parsed.toString();
    }
    if (parsed.protocol !== 'https:') return;
    if (AD_RE.test(parsed.hostname + parsed.pathname)) return;
    var type = streamType || typeFrom(abs) || 'mp4';
    if (type === 'dash') {
      if (!reported[abs]) {
        reported[abs] = true;
        send({ type: 'NOVA_WEB_VIDEO_UNSUPPORTED', title: title || getBestTitle(), streamType: type });
      }
      return;
    }
    var key = abs + '|' + (explicit ? 'x' : 'd');
    if (reported[key]) return;
    reported[key] = true;
    send({
      type: explicit ? 'NOVA_WEB_VIDEO_PROMPT' : 'NOVA_WEB_VIDEO_DETECTED',
      pageUrl: CURRENT_PAGE_URL,
      streamUrl: abs,
      proxiedStreamUrl: '/api/browse?stream=1&url=' + encodeURIComponent(abs) + '&ref=' + encodeURIComponent(CURRENT_PAGE_URL),
      streamType: type,
      source: source,
      title: title || getBestTitle(),
      thumbnail: thumbnail || getBestThumbnail()
    });
  }

  function inspectMediaElement(el) {
    if (!el) return;
    if (el.loop && el.muted) return;
    var candidate = el.currentSrc || el.src || '';
    if (!candidate) {
      var source = el.querySelector && el.querySelector('source[src]');
      if (source) candidate = source.currentSrc || source.src || source.getAttribute('src') || '';
    }
    if (candidate && candidate.indexOf('blob:') !== 0) {
      report(candidate, typeFrom(candidate), 'element', getBestTitle(el), getBestThumbnail(el), false);
    }
    reportPageStreams();
  }

  function reportPageStreams() {
    if (!PRE_EXTRACTED || !PRE_EXTRACTED.streams || !PRE_EXTRACTED.streams.length || !hasMainVideo()) return;
    for (var i = 0; i < PRE_EXTRACTED.streams.length && i < 4; i++) {
      var s = PRE_EXTRACTED.streams[i];
      report(s.url, s.type, 'page', getBestTitle(), getBestThumbnail(), false);
    }
  }

  /* network sniffing: catches HLS/MP4 loaded through MediaSource (blob:) players */
  function noteNetwork(url, contentType) {
    var abs = resolveAbs(url);
    if (!abs) return;
    var type = typeFrom(abs, contentType);
    if (!type || pendingNet[abs]) return;
    pendingNet[abs] = type;
    flushNetwork();
  }

  function flushNetwork() {
    clearTimeout(netTimer);
    var keys = Object.keys(pendingNet);
    if (!keys.length) return;
    if (hasMainVideo()) {
      keys.forEach(function(u) {
        report(u, pendingNet[u], 'network', getBestTitle(), getBestThumbnail(), false);
        delete pendingNet[u];
      });
      reportPageStreams();
      return;
    }
    if (++netTries < 12) netTimer = setTimeout(flushNetwork, 1000);
  }

  try {
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function(input) {
        var promise = origFetch.apply(this, arguments);
        try {
          var reqUrl = typeof input === 'string' ? input : (input && input.url);
          if (reqUrl) noteNetwork(reqUrl, '');
          promise.then(function(res) {
            try { noteNetwork(res.url || reqUrl, res.headers.get('content-type')); } catch (e) {}
          }, function() {});
        } catch (e) {}
        return promise;
      };
    }
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        var xhr = this;
        if (url) noteNetwork(String(url), '');
        xhr.addEventListener('readystatechange', function() {
          if (xhr.readyState === 2) {
            try { noteNetwork(xhr.responseURL || String(url), xhr.getResponseHeader('content-type')); } catch (e) {}
          }
        });
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    if (window.PerformanceObserver) {
      new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(entry) { noteNetwork(entry.name, ''); });
      }).observe({ type: 'resource', buffered: true });
    }
  } catch (e) {}

  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function() {
    try { inspectMediaElement(this); } catch (e) {}
    return origPlay.apply(this, arguments);
  };

  ['play', 'playing', 'loadedmetadata'].forEach(function(name) {
    document.addEventListener(name, function(e) {
      if (e.target && e.target.tagName === 'VIDEO') {
        inspectMediaElement(e.target);
        if (name !== 'loadedmetadata') flushNetwork();
      }
    }, true);
  });

  /* make nested player iframes go through the proxy so they can be detected too */
  function proxifyFrame(frame) {
    try {
      var raw = frame.getAttribute('src');
      if (!raw || raw.indexOf(ORIGIN + '/api/browse') === 0 || raw.indexOf('about:') === 0 || raw.indexOf('javascript:') === 0) return;
      var abs = resolveAbs(raw);
      if (!abs) return;
      var u = new URL(abs);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
      if (SKIP_FRAME_RE.test(u.hostname)) return;
      if (u.origin === location.origin) return;
      frame.setAttribute('src', ORIGIN + '/api/browse?url=' + encodeURIComponent(abs));
    } catch (e) {}
  }

  document.addEventListener('click', function(e) {
    lastGestureAt = Date.now();
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) {
      setTimeout(function() { flushNetwork(); scanAllVideos(); }, 400);
      return;
    }
    var rawHref = a.getAttribute('href');
    if (!rawHref || rawHref.indexOf('javascript:') === 0 || rawHref.indexOf('#') === 0) return;
    var abs = resolveAbs(rawHref);
    if (!abs) return;
    if (isYouTubeVideoUrl(abs)) {
      e.preventDefault();
      e.stopPropagation();
      send({
        type: 'NOVA_WEB_VIDEO_PROMPT',
        streamUrl: abs,
        title: (a.getAttribute('data-video-title') || a.getAttribute('title') || a.textContent || '').trim() || 'YouTube video',
        thumbnail: a.getAttribute('data-video-thumbnail') || getBestThumbnail(a)
      });
      return;
    }
    var directType = typeFrom(abs);
    if (directType && directType !== 'dash' && /^https:/i.test(abs)) {
      e.preventDefault();
      e.stopPropagation();
      report(abs, directType, 'element', (a.getAttribute('data-video-title') || a.getAttribute('title') || a.textContent || '').trim(), getBestThumbnail(a), true);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!NESTED) send({ type: 'NOVA_WEB_NAVIGATE', url: abs, title: document.title || abs });
    window.location.href = ORIGIN + '/api/browse?url=' + encodeURIComponent(abs);
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
      fd.forEach(function(value, key) { target.searchParams.set(key, String(value)); });
      var finalUrl = target.toString();
      if (!NESTED) send({ type: 'NOVA_WEB_NAVIGATE', url: finalUrl });
      window.location.href = ORIGIN + '/api/browse?url=' + encodeURIComponent(finalUrl);
    }
  }, true);

  function scanAllVideos() {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) inspectMediaElement(videos[i]);
    if (!videos.length) flushNetwork();
  }

  function observeDom() {
    if (!window.MutationObserver || !document.documentElement) return;
    new MutationObserver(function(records) {
      records.forEach(function(record) {
        if (record.type === 'attributes' && record.target.tagName === 'IFRAME') { proxifyFrame(record.target); return; }
        record.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          if (node.tagName === 'IFRAME') proxifyFrame(node);
          if (node.tagName === 'VIDEO') inspectMediaElement(node);
          if (node.querySelectorAll) {
            var frames = node.querySelectorAll('iframe');
            for (var i = 0; i < frames.length; i++) proxifyFrame(frames[i]);
            var videos = node.querySelectorAll('video');
            for (var j = 0; j < videos.length; j++) inspectMediaElement(videos[j]);
          }
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  if (!NESTED) send({ type: 'NOVA_WEB_PAGE_START', url: CURRENT_PAGE_URL });
  observeDom();

  window.addEventListener('DOMContentLoaded', function() {
    if (!NESTED) send({ type: 'NOVA_WEB_PAGE_LOADED', url: CURRENT_PAGE_URL, title: document.title || CURRENT_PAGE_URL });
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) proxifyFrame(frames[i]);
    setTimeout(scanAllVideos, 500);
  });
  window.addEventListener('load', function() { setTimeout(scanAllVideos, 600); });
  setTimeout(scanAllVideos, 1800);
  setTimeout(scanAllVideos, 4000);
}

function getInjectedBrowserScript(pageUrl, preExtracted) {
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '<script>(' + novaInjected.toString() + ')(' + json(pageUrl) + ',' + json(preExtracted || { title: '', thumbnail: '', streams: [] }) + ');</script>';
}

function renderGoogleDarkSearchPage(searchData) {
  const q = searchData.query || '';
  const tab = searchData.tab || 'all';
  const providerName = searchData.engine === 'google-api' ? 'Google' : 'DuckDuckGo';
  const results = searchData.results || [];
  const videoCards = searchData.videoCards || [];
  const emptyResultsMessage = searchData.message || 'No results found. Try another keyword or direct URL.';

  function resultLinkAttributes(item) {
    const youtubeAttributes = isYouTubeVideoUrl(item.url)
      ? ` data-youtube-video="true" data-video-title="${escapeHtml(item.title || 'YouTube video')}" data-video-thumbnail="${escapeHtml(item.thumbnail || '')}"`
      : '';
    return `href="/api/browse?url=${encodeURIComponent(item.url)}" data-target-url="${escapeHtml(item.url)}"${youtubeAttributes}`;
  }

  const resultItemsHtml = results.map((item) => {
    const thumbHtml = item.thumbnail ? `
      <div class="gs-thumb-wrap">
        <img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
        ${item.duration ? `<span class="gs-duration">${escapeHtml(item.duration)}</span>` : ''}
      </div>` : '';

    return `
      <div class="gs-result-card">
        <a class="gs-result-header" ${resultLinkAttributes(item)}>
          <img class="gs-favicon" src="${escapeHtml(item.favicon)}" alt="" onerror="this.style.display='none'">
          <div class="gs-site-meta">
            <div class="gs-site-name">${escapeHtml(item.source || item.domain)}</div>
            <div class="gs-site-url">${escapeHtml(item.url)}</div>
          </div>
        </a>
        <a class="gs-result-title" ${resultLinkAttributes(item)}>${escapeHtml(item.title)}</a>
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
          <a class="gs-story-card" ${resultLinkAttributes(vc)}>
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
<title>${escapeHtml(q)} - ${providerName} Search</title>
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
      <a class="gs-logo" href="/api/browse?q=${encodeURIComponent(q)}">${providerName}</a>
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
      if (a.getAttribute('data-youtube-video') === 'true') {
        e.preventDefault();
        try {
          window.parent.postMessage({
            type: 'NOVA_WEB_VIDEO_PROMPT',
            streamUrl: targetUrl,
            title: a.getAttribute('data-video-title') || a.textContent.trim() || 'YouTube video',
            thumbnail: a.getAttribute('data-video-thumbnail') || ''
          }, '*');
        } catch (err) {}
        return;
      }
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
    'Origin': parsed.origin
  };
  try { if (refererUrl) headers['Origin'] = new URL(refererUrl).origin; } catch (e) {}
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
      res.end(((err && err.message) || 'Stream request failed.'));
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
        'Accept-Encoding': 'gzip, deflate, br'
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
      let searchData;
      try {
        searchData = await searchForRequest(searchQuery, searchTab, 1);
      } catch (error) {
        searchData = {
          query: searchQuery,
          tab: searchTab,
          results: [],
          videoCards: [],
          message: error.message || 'Search is temporarily unavailable.'
        };
      }
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
    return res.end(`<!DOCTYPE html><html><body style="background:#121212;color:#e8eaed;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h3>Unable to load webpage</h3><p style="color:#9aa0a6;">${escapeHtml(((err && err.message) || 'Connection failed'))}</p></div></body></html>`);
  }
};

module.exports._renderGoogleDarkSearchPage = renderGoogleDarkSearchPage;
module.exports._isYouTubeVideoUrl = isYouTubeVideoUrl;
module.exports._getInjectedBrowserScript = getInjectedBrowserScript;