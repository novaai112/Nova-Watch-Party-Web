/* nova-chat-media.js — media layer for Nova Chat (shared by nova-chat.js and nova-chat-capture.js).
   Uploads with real progress, signed-URL cache, offline download cache, attachment rendering (photos, videos,
   voice, audio, video notes, documents, contacts), players, the full-screen viewer and the document previewer.
   Requires nova-core.js (Nova) and nova-chat-rich.js. */
(function () {
  'use strict';
  const R = window.NovaChatRich, { esc } = R;
  const Nova = window.Nova, sb = Nova.sb;
  const M = window.NovaChatMedia = window.NovaChatMedia || {};
  const BUCKET = 'chat-media';
  const MAX_FILE = 50 * 1024 * 1024;
  M.MAX_FILE = MAX_FILE;

  /* ------------------------------------------------------------------ icons */
  const ICONS = {
    rotateccw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    rotatecw: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    text: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
    forward: '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
    reply: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    volumex: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    checks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    flipcam: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    pushpin: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    belloff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    arrowdown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
    select: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
    chevdown: '<path d="m6 9 6 6 6-6"/>',
    lockopen: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    once: '<circle cx="12" cy="12" r="10" stroke-dasharray="3 3"/><path d="M11 9l1-1v8"/>',
    sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    face: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
    hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
    mapfile: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>'
  };
  const ic = (name, size = 18) => ICONS[name]
    ? `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
    : Nova.ic(name, size);
  M.ic = ic;
  M.h = (html, tag = 'div') => { const n = document.createElement(tag); n.innerHTML = html; return n; };

  /* --------------------------------------------------------------- overlays */
  const overlays = [];
  let ignorePop = 0;
  function openOverlay(node, { onClose, label } = {}) {
    node.classList.add('nc-overlay');
    if (label) node.setAttribute('aria-label', label);
    node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true');
    const entry = { node, onClose, previousFocus: document.activeElement };
    overlays.push(entry);
    document.body.append(node);
    document.body.classList.add('nc-noscroll');
    try { history.pushState({ ncOverlay: overlays.length }, ''); } catch (_) {}
    const focusable = node.querySelector('[data-autofocus],button,input,textarea');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 30);
    return () => closeOverlay(node);
  }
  function closeOverlay(node, fromPop) {
    const i = overlays.findIndex(entry => entry.node === node);
    if (i < 0) return;
    const [entry] = overlays.splice(i, 1);
    node.classList.add('nc-closing');
    const remove = () => node.remove();
    node.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 260);
    if (!overlays.length) document.body.classList.remove('nc-noscroll');
    try { entry.onClose && entry.onClose(); } catch (error) { console.error(error); }
    try { entry.previousFocus && entry.previousFocus.focus && entry.previousFocus.focus({ preventScroll: true }); } catch (_) {}
    if (!fromPop && history.state && history.state.ncOverlay) { ignorePop++; history.back(); }
  }
  window.addEventListener('popstate', () => {
    if (ignorePop > 0) { ignorePop--; return; }
    const top = overlays[overlays.length - 1];
    if (top) closeOverlay(top.node, true);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlays.length && !event.defaultPrevented) {
      event.preventDefault();
      closeOverlay(overlays[overlays.length - 1].node);
    }
  });
  M.openOverlay = openOverlay; M.closeOverlay = closeOverlay;
  M.hasOverlay = () => overlays.length > 0;

  /* --------------------------------------------------------- storage helpers */
  const signedCache = new Map();
  async function signed(path, ttl = 3600) {
    const hit = signedCache.get(path);
    if (hit && hit.exp - Date.now() > 300000) return hit.url;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, ttl);
    if (error) throw error;
    signedCache.set(path, { url: data.signedUrl, exp: Date.now() + ttl * 1000 });
    return data.signedUrl;
  }
  M.signed = signed;

  const CACHE_NAME = 'nova-chat-media-v1';
  const cacheKey = path => `/__nova_chat_media__/${encodeURI(path)}`;
  const blobUrls = new Map();
  async function cachedBlobUrl(path) {
    if (blobUrls.has(path)) return blobUrls.get(path);
    if (!window.caches) return null;
    try {
      const cache = await caches.open(CACHE_NAME), hit = await cache.match(cacheKey(path));
      if (!hit) return null;
      const url = URL.createObjectURL(await hit.blob());
      blobUrls.set(path, url);
      return url;
    } catch { return null; }
  }
  M.cachedBlobUrl = cachedBlobUrl;

  /* fetch with download progress; returns a Blob. */
  async function downloadBlob(url, onProgress, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body || !response.body.getReader) { const blob = await response.blob(); onProgress && onProgress(1); return blob; }
    const reader = response.body.getReader(), chunks = []; let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      onProgress && onProgress(total ? Math.min(1, received / total) : 0.5);
    }
    return new Blob(chunks, { type: response.headers.get('content-type') || '' });
  }
  M.downloadBlob = downloadBlob;

  async function downloadAttachment(att, onProgress, signal) {
    if (att._blobUrl) { const blob = await (await fetch(att._blobUrl)).blob(); onProgress && onProgress(1); return blob; }
    if (att.path && window.caches) {
      try {
        const hit = await (await caches.open(CACHE_NAME)).match(cacheKey(att.path));
        if (hit) { onProgress && onProgress(1); return await hit.blob(); }
      } catch (_) {}
    }
    const url = att.url || await signed(att.path);
    const blob = await downloadBlob(url, onProgress, signal);
    const typed = blob.type && blob.type !== 'application/octet-stream' ? blob : new Blob([blob], { type: att.type || '' });
    if (att.path && window.caches) {
      try { await (await caches.open(CACHE_NAME)).put(cacheKey(att.path), new Response(typed, { headers: { 'content-type': att.type || typed.type } })); }
      catch (_) {}
    }
    if (att.path) blobUrls.set(att.path, URL.createObjectURL(typed));
    return typed;
  }
  M.downloadAttachment = downloadAttachment;

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name || 'download'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function saveAttachment(att, onProgress) {
    const blob = await downloadAttachment(att, onProgress);
    saveBlob(blob, att.name || `nova-${Date.now()}`);
  }
  async function shareAttachment(att) {
    try {
      const blob = await downloadAttachment(att);
      const file = new File([blob], att.name || 'file', { type: att.type || blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: att.name }); return; }
      if (navigator.share && att.path === undefined && att.url) { await navigator.share({ url: att.url, title: att.name }); return; }
      saveBlob(blob, att.name);
      Nova.toast('Sharing is not supported here, so the file was downloaded.');
    } catch (error) { if (error && error.name !== 'AbortError') Nova.toast(error.message || 'Could not share this file.', 'err'); }
  }
  M.saveAttachment = saveAttachment; M.shareAttachment = shareAttachment;

  /* Upload with real progress (XHR). Resolves when stored; rejects with {retryable}. */
  async function upload({ path, blob, contentType, onProgress, signal }) {
    const cfg = window.APP_CONFIG || {};
    const base = (window.SUPABASE_URL || cfg.SUPABASE_URL || '').replace(/\/$/, ''), key = window.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY;
    if (!base || !key || typeof XMLHttpRequest === 'undefined') {
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message || '')) throw Object.assign(error, { retryable: true });
      onProgress && onProgress(1);
      return;
    }
    const attempt = async () => {
      const { data } = await sb.auth.getSession();
      const token = data && data.session ? data.session.access_token : key;
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${base}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('apikey', key);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('cache-control', 'max-age=3600');
        xhr.setRequestHeader('Content-Type', contentType || blob.type || 'application/octet-stream');
        xhr.upload.onprogress = event => { if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          let message = `Upload failed (HTTP ${xhr.status})`;
          try { message = JSON.parse(xhr.responseText).message || message; } catch (_) {}
          if (xhr.status === 409 || /already exists|duplicate/i.test(message)) return resolve();   // an earlier attempt finished
          reject(Object.assign(new Error(message), { status: xhr.status, retryable: xhr.status >= 500 || xhr.status === 408 || xhr.status === 429 || xhr.status === 401 }));
        };
        xhr.onerror = () => reject(Object.assign(new Error('Network error while uploading.'), { retryable: true }));
        xhr.ontimeout = () => reject(Object.assign(new Error('Upload timed out.'), { retryable: true }));
        xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled.'), { aborted: true }));
        xhr.timeout = 10 * 60 * 1000;
        if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(blob);
      });
    };
    return attempt();
  }
  M.upload = upload;

  /* ----------------------------------------------------- image / video prep */
  async function decodeImage(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) {}
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be read.')); };
      img.src = url;
    });
  }
  const dims = source => ({ w: source.naturalWidth || source.videoWidth || source.width, h: source.naturalHeight || source.videoHeight || source.height });
  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not process this image.')), type, quality));
  }
  function tinyThumb(source, w, h, max = 28) {
    const k = Math.min(1, max / Math.max(w, h)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.5);
  }
  M.decodeImage = decodeImage; M.canvasBlob = canvasBlob;

  const QUALITY = { standard: [1600, 0.8], hd: [2560, 0.92] };
  /* quality: 'standard' | 'hd' | 'original'. Returns { blob, name, type, w, h, thumb, size, hd }. */
  async function prepareImage(file, quality = 'standard') {
    const type = (file.type || '').split(';')[0].toLowerCase();
    let source = null, w = 0, h = 0, thumb = '';
    try { source = await decodeImage(file); ({ w, h } = dims(source)); thumb = tinyThumb(source, w, h); } catch (_) {}
    const keepOriginal = quality === 'original' || type === 'image/gif' || !source || /heic|heif|avif|svg/.test(type);
    if (keepOriginal) return { blob: file, name: file.name, type: type || 'image/jpeg', w, h, thumb, size: file.size, hd: quality === 'original' };
    const [max, q] = QUALITY[quality] || QUALITY.standard, k = Math.min(1, max / Math.max(w, h));
    if (k === 1 && file.size < 400 * 1024 && (type === 'image/jpeg' || type === 'image/webp')) {
      return { blob: file, name: file.name, type, w, h, thumb, size: file.size, hd: quality === 'hd' };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (source.close) source.close();
    const blob = await canvasBlob(canvas, 'image/jpeg', q);
    if (blob.size >= file.size && type === 'image/jpeg' && k === 1) return { blob: file, name: file.name, type, w, h, thumb, size: file.size, hd: quality === 'hd' };
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', w: canvas.width, h: canvas.height, thumb, size: blob.size, hd: quality === 'hd' };
  }
  async function videoInfo(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file), video = document.createElement('video');
      video.preload = 'metadata'; video.muted = true; video.playsInline = true;
      const done = info => { URL.revokeObjectURL(url); resolve(info); };
      const timer = setTimeout(() => done({ duration: 0, w: 0, h: 0, thumb: '' }), 8000);
      video.onloadedmetadata = () => { video.currentTime = Math.min(0.2, (video.duration || 1) / 2); };
      video.onseeked = () => {
        clearTimeout(timer);
        const { w, h } = dims(video); let thumb = '';
        try { thumb = tinyThumb(video, w, h); } catch (_) {}
        done({ duration: Number.isFinite(video.duration) ? video.duration : 0, w, h, thumb });
      };
      video.onerror = () => { clearTimeout(timer); done({ duration: 0, w: 0, h: 0, thumb: '' }); };
      video.src = url;
    });
  }
  M.prepareImage = prepareImage; M.videoInfo = videoInfo;

  /* ------------------------------------------------------------ preferences */
  const PREF_KEY = 'nova_chat_prefs';
  const defaults = { dlImage: 'always', dlVideo: 'wifi', dlAudio: 'always', dlFile: 'never', transcribe: false, enterSends: true };
  function prefs() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...defaults }; } }
  function setPref(key, value) { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...prefs(), [key]: value })); } catch (_) {} }
  M.prefs = prefs; M.setPref = setPref;
  function onCellular() {
    const c = navigator.connection;
    return !!(c && (c.type === 'cellular' || c.saveData));
  }
  function shouldAutoLoad(kind) {
    const p = prefs(), setting = { image: p.dlImage, video: p.dlVideo, audio: p.dlAudio, voice: 'always', video_note: 'always', file: p.dlFile }[kind] || 'always';
    return setting === 'always' || (setting === 'wifi' && !onCellular());
  }
  M.shouldAutoLoad = shouldAutoLoad;

  /* ----------------------------------------------------------- audio manager */
  let nowPlaying = null;
  function claimAudio(owner) {
    if (nowPlaying && nowPlaying !== owner && nowPlaying.pause) nowPlaying.pause();
    nowPlaying = owner;
  }
  const SPEEDS = [1, 1.5, 2];

  /* deterministic fallback waveform for audio without stored peaks */
  function fakeWave(seed, n = 40) {
    let s = 0; for (const c of String(seed || 'x')) s = (s * 31 + c.charCodeAt(0)) >>> 0;
    return Array.from({ length: n }, () => { s = (s * 1664525 + 1013904223) >>> 0; return 25 + (s >>> 24) % 70; });
  }
  const waveBars = (wave, seed) => (wave && wave.length ? wave : fakeWave(seed)).map(v => `<i style="height:${Math.max(12, Math.min(100, v))}%"></i>`).join('');

  /* --------------------------------------------------------- attachment HTML */
  const attData = att => esc(JSON.stringify(att, (k, v) => (k === '_file' ? undefined : v)));
  const stateOverlay = (att, i) => {
    if (att._state === 'uploading') return `<span class="nc-prog" data-prog="${i}" aria-label="Uploading"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" style="stroke-dashoffset:${94 - 94 * (att._progress || 0)}"/></svg><button type=button data-nc-cancel="${i}" aria-label="Cancel upload">${ic('x', 16)}</button></span>`;
    if (att._state === 'failed') return `<button type=button class="nc-retry" data-nc-retry="${i}" aria-label="Retry upload">${ic('upload', 18)}<span>Retry</span></button>`;
    return '';
  };

  function renderMediaGrid(items, ctx) {
    const shown = items.slice(0, 4), extra = items.length - shown.length, single = shown.length === 1;
    const credits = [];
    const tiles = shown.map(({ att, i }, n) => {
      const kind = R.attKind(att), remote = !!(att.url && !att.path && !att._blobUrl);
      const thumb = att.thumb && !remote ? `style="background-image:url(${esc(att.thumb)})"` : '';
      const ratio = single && att.w && att.h && !remote ? `style="aspect-ratio:${Math.max(0.62, Math.min(1.7, att.w / att.h)).toFixed(3)}"` : '';
      const label = att.viewOnce ? `<span class="nc-once">${ic('once', 22)}<b>${kind === 'video' ? 'Video' : 'Photo'}</b></span>` : '';
      const badge = kind === 'video' && !att.gif ? `<span class="nc-badge">${ic('play', 11)}${att.duration ? R.fmtDuration(att.duration) : 'Video'}</span>` : '';
      const more = extra && n === shown.length - 1 ? `<span class="nc-more">+${extra + 1}</span>` : '';
      let slot = att.viewOnce ? '' : '<span class=nc-slot></span>';
      if (remote) {
        const alt = esc(att.name || 'media');
        slot = kind === 'video'
          ? `<video class="nc-rmedia" muted playsinline loop autoplay preload="metadata" src="${esc(att.url)}"></video>`
          : `<img class="nc-rmedia" alt="${alt}" decoding=async loading=lazy referrerpolicy=no-referrer src="${esc(att.url)}">`;
        const a = att.attribution;
        if (a && a.photographer) credits.push(`Photo by <a href="${esc(a.photographerUrl)}" target=_blank rel="noopener noreferrer">${esc(a.photographer)}</a> on <a href="${esc(a.photoUrl)}" target=_blank rel="noopener noreferrer">Unsplash</a>`);
      }
      const cls = `nc-tile${att.viewOnce ? ' once' : ''}${remote ? ' remote' : ''}${att.gif ? ' gif' : ''}`;
      return `<button type=button class="${cls}" ${ratio} data-nc-open="${i}" data-att="${attData(att)}" data-kind="${kind}" ${thumb} aria-label="Open ${kind}">${slot}${label}${badge}${more}${stateOverlay(att, i)}</button>`;
    }).join('');
    return `<div class="nc-mediablock"><div class="nc-grid n${shown.length}" data-count="${shown.length}">${tiles}</div>${credits.length ? `<div class="nc-credit">${credits[0]}</div>` : ''}</div>`;
  }

  function renderVoice(att, i, ctx) {
    const mine = ctx.mine;
    return `<div class="nc-voice${mine ? ' mine' : ''}" data-voice="${i}" data-att="${attData(att)}" data-sender="${esc(ctx.sender || '')}">
      <button type=button class="nc-play" data-nc-play aria-label="Play voice message">${ic('play', 20)}</button>
      <div class="nc-wavebox"><div class="nc-wave" data-seek role="slider" aria-label="Seek voice message" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">${waveBars(att.waveform, att.path || att.name)}<u class="nc-wave-head"></u></div>
        <div class="nc-voice-meta"><span class="nc-vtime">${R.fmtDuration(att.duration || 0)}</span>${att.transcript ? `<button type=button class="nc-transcript-btn" data-nc-transcript aria-label="Show transcript">Aa</button>` : ''}</div></div>
      <button type=button class="nc-speed" data-nc-speed aria-label="Playback speed" hidden>1×</button>${stateOverlay(att, i)}
      ${att.transcript ? `<p class="nc-transcript" hidden dir=auto>${esc(att.transcript)}</p>` : ''}</div>`;
  }

  function renderAudio(att, i) {
    return `<div class="nc-audio" data-voice="${i}" data-audio-card data-att="${attData(att)}">
      <button type=button class="nc-play" data-nc-play aria-label="Play ${esc(att.name || 'audio')}">${ic('play', 20)}</button>
      <div class="nc-audio-main"><b title="${esc(att.name || '')}">${esc(att.name || 'Audio')}</b>
        <input type=range class="nc-audio-seek" min="0" max="1000" value="0" aria-label="Seek" data-seek-range>
        <div class="nc-audio-row"><span class="nc-vtime">${R.fmtDuration(att.duration || 0)}</span><button type=button class="nc-speed" data-nc-speed hidden>1×</button><span>${R.fmtBytes(att.size)}</span></div></div>
      <button type=button class="nc-icon-btn" data-nc-save aria-label="Download audio">${ic('download', 18)}</button>${stateOverlay(att, i)}</div>`;
  }

  function renderVideoNote(att, i, ctx) {
    return `<div class="nc-vnote${ctx.mine ? ' mine' : ''}" data-vnote="${i}" data-att="${attData(att)}" ${att.thumb ? `style="--thumb:url(${esc(att.thumb)})"` : ''}>
      <div class="nc-vnote-frame"><span class="nc-slot"></span></div>
      <svg class="nc-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47"/></svg>
      <span class="nc-vnote-dur">${R.fmtDuration(att.duration || 0)}</span>
      <button type=button class="nc-vnote-toggle" data-nc-vnote aria-label="Play video message">${ic('play', 24)}</button>${stateOverlay(att, i)}</div>`;
  }

  function renderFile(att, i) {
    const [label, color] = R.docStyle(att.name), previewable = canPreviewDoc(att);
    return `<div class="nc-file" data-file="${i}" data-att="${attData(att)}">
      <span class="nc-file-ico" style="--c:${color}"><b>${esc(label)}</b></span>
      <span class="nc-file-main"><b title="${esc(att.name || 'File')}">${esc(att.name || 'File')}</b><small>${esc((R.fileExt(att.name) || 'file').toUpperCase())} · ${R.fmtBytes(att.size)}<em class="nc-file-state"></em></small></span>
      <span class="nc-file-actions">${previewable ? `<button type=button data-nc-docview aria-label="Preview ${esc(att.name)}">${ic('eye', 17)}</button>` : ''}<button type=button data-nc-save aria-label="Download ${esc(att.name)}">${ic('download', 17)}</button><button type=button data-nc-share aria-label="Share ${esc(att.name)}">${ic('share', 17)}</button></span>
      ${stateOverlay(att, i)}<span class="nc-file-bar" hidden><i></i></span></div>`;
  }

  function renderContact(att) {
    const c = att.contact || {}, name = c.full_name || c.username || 'Nova contact';
    return `<button type=button class="nc-contact" data-go="user/${esc(c.id)}">${Nova.avatar(c, 40)}<span><b>${esc(name)}</b><small>@${esc(c.username || '')}</small></span>${ic('right', 16)}</button>`;
  }

  function renderRemote(att, i) {
    const kind = R.attKind(att), name = esc(att.name || 'media');
    if (false) {
      const credit = att.attribution && att.attribution.photographer
        ? `<figcaption>Photo by <a href="${esc(att.attribution.photographerUrl)}" target=_blank rel="noopener noreferrer">${esc(att.attribution.photographer)}</a> on <a href="${esc(att.attribution.photoUrl)}" target=_blank rel="noopener noreferrer">Unsplash</a></figcaption>` : '';
      return `<figure class="nc-remote"><button type=button class="nc-tile solo" data-nc-open="${i}" data-att="${attData(att)}" data-kind=image aria-label="Open ${name}"><img src="${esc(att.url)}" alt="${name}" loading=lazy referrerpolicy=no-referrer></button>${credit}</figure>`;
    }
    if (kind === 'video') return `<div class="nc-remote"><video class="nc-remote-video" controls playsinline preload=metadata src="${esc(att.url)}"></video></div>`;
    return `<div class="nc-audio" data-voice="${i}" data-audio-card data-att="${attData(att)}"><button type=button class="nc-play" data-nc-play>${ic('play', 20)}</button><div class="nc-audio-main"><b>${name}</b><input type=range class="nc-audio-seek" min="0" max="1000" value="0" data-seek-range><div class="nc-audio-row"><span class="nc-vtime">0:00</span></div></div></div>`;
  }

  /* ctx: { mine, sender, clientId } */
  const isVisual = att => ['image', 'video'].includes(R.attKind(att));
  M.isVisualAtt = att => isVisual(att) || R.attKind(att) === 'video_note';
  /* ctx: { mine, sender, part: 'visual' | 'other' | undefined } */
  M.renderAttachments = function (attachments, ctx = {}) {
    const media = [], rest = [], notes = [];
    (attachments || []).forEach((att, i) => {
      const kind = R.attKind(att), visual = M.isVisualAtt(att);
      if (ctx.part === 'visual' && !visual) return;
      if (ctx.part === 'other' && visual) return;
      if (att.url && !att.path && !att._blobUrl) {
        if (kind === 'image' || kind === 'video') return media.push({ att, i });
        return rest.push(renderRemote(att, i));
      }
      if ((kind === 'image' || kind === 'video')) media.push({ att, i });
      else if (kind === 'voice') rest.push(renderVoice(att, i, ctx));
      else if (kind === 'video_note') notes.push(renderVideoNote(att, i, ctx));
      else if (kind === 'audio') rest.push(renderAudio(att, i));
      else if (kind === 'contact') rest.push(renderContact(att));
      else rest.push(renderFile(att, i));
    });
    return `${media.length ? renderMediaGrid(media, ctx) : ''}${notes.join('')}${rest.join('')}`;
  };

  /* ----------------------------------------------------------- hydration */
  let observer = null;
  function lazyObserver() {
    if (observer || !('IntersectionObserver' in window)) return observer;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const target = entry.target;
        if (entry.isIntersecting) { if (target._ncLoad) { const load = target._ncLoad; target._ncLoad = null; load(); } observer.unobserve(target); }
      }
    }, { rootMargin: '500px 0px' });
    return observer;
  }
  function whenVisible(el, load) { const o = lazyObserver(); if (!o) return load(); el._ncLoad = load; o.observe(el); }

  const typedUrls = new Map();
  function guessMime(att) {
    const t = String(att.type || '').split(';')[0].trim();
    if (t && t !== 'application/octet-stream') return t;
    const k = R.attKind(att);
    return k === 'voice' || k === 'audio' ? 'audio/webm' : 'video/webm';
  }
  /* Download once and wrap in a correctly typed Blob: signed URLs sometimes come back with a wrong or missing Content-Type, which makes <audio>/<video> refuse webm/mp4 recordings. */
  async function typedSrc(att) {
    const key = att.path || att._blobUrl || att.url;
    if (typedUrls.has(key)) return typedUrls.get(key);
    const raw = await downloadAttachment(att);
    const url = URL.createObjectURL(new Blob([raw], { type: guessMime(att) }));
    typedUrls.set(key, url);
    return url;
  }
  M.typedSrc = typedSrc;
  async function srcFor(att) {
    if (att._blobUrl) return att._blobUrl;
    if (att.url) return att.url;
    if (att.path) return (await cachedBlobUrl(att.path)) || signed(att.path);
    return '';
  }

  function hydrateTile(tile) {
    const att = JSON.parse(tile.dataset.att), kind = tile.dataset.kind;
    if (att.viewOnce && !att._blobUrl) return;
    if (att.url && !att.path && !att._blobUrl) return;
    const slot = tile.querySelector('.nc-slot');
    const showManual = async () => {
      const cached = att.path && await cachedBlobUrl(att.path);
      if (cached) return mount(cached);
      tile.classList.add('manual');
      slot && (slot.innerHTML = `<span class="nc-dl" data-nc-download aria-label="Download ${kind}">${ic('download', 22)}<b>${R.fmtBytes(att.size)}</b></span>`);
    };
    const mount = src => {
      if (!slot) return;
      tile.classList.remove('manual');
      if (kind === 'video') slot.innerHTML = `<video muted playsinline preload="metadata" src="${esc(src)}#t=0.1" ${att.gif ? 'autoplay loop' : ''}></video>`;
      else { slot.innerHTML = `<img alt="" decoding=async src="${esc(src)}">`; slot.firstChild.onerror = () => { slot.innerHTML = `<span class="nc-dl" data-nc-download>${ic('alert', 22)}<b>Unavailable</b></span>`; tile.classList.add('manual'); }; }
    };
    if (att._blobUrl) return mount(att._blobUrl);
    if (att.gif || shouldAutoLoad(kind)) whenVisible(tile, async () => { try { mount(await srcFor(att)); } catch (_) { showManual(); } });
    else showManual();
  }

  /* ----- players ----- */
  function hydrateVoice(card) {
    if (card._ncHydrated) return; card._ncHydrated = true;
    const att = JSON.parse(card.dataset.att), isCard = card.hasAttribute('data-audio-card');
    const play = card.querySelector('[data-nc-play]'), time = card.querySelector('.nc-vtime'), speedBtn = card.querySelector('[data-nc-speed]');
    const bars = [...card.querySelectorAll('.nc-wave i')], head = card.querySelector('.nc-wave-head'), seek = card.querySelector('[data-seek-range]');
    let audio = null, speedIndex = 0;
    const setIcon = playing => { play.innerHTML = ic(playing ? 'pause' : 'play', 20); card.classList.toggle('playing', playing); };
    const paint = () => {
      if (!audio) return;
      const duration = audio.duration && Number.isFinite(audio.duration) ? audio.duration : att.duration || 0, p = duration ? audio.currentTime / duration : 0;
      if (bars.length) bars.forEach((bar, n) => bar.classList.toggle('on', n / bars.length < p));
      if (head) head.style.left = `${p * 100}%`;
      if (seek && document.activeElement !== seek) seek.value = String(Math.round(p * 1000));
      card.querySelector('.nc-wave')?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      if (time) time.textContent = R.fmtDuration(audio.currentTime > 0 && !audio.paused ? audio.currentTime : duration);
    };
    const ensure = async () => {
      if (audio) return audio;
      play.disabled = true;
      try {
        audio = new Audio(); audio.preload = 'auto';
        audio.src = att._blobUrl || att.url || await typedSrc(att);
      } catch (error) { audio = null; play.disabled = false; Nova.toast('Could not load this audio.', 'err'); throw error; }
      play.disabled = false;
      audio.addEventListener('timeupdate', paint);
      audio.addEventListener('loadedmetadata', paint);
      audio.addEventListener('pause', () => setIcon(false));
      audio.addEventListener('play', () => setIcon(true));
      audio.addEventListener('ended', () => {
        setIcon(false); audio.currentTime = 0; paint(); card.classList.add('played');
        if (!isCard) autoplayNext(card);
      });
      audio.addEventListener('error', () => { setIcon(false); if (!audio._retried && att.path) { audio._retried = true; srcFor(att).then(u => { audio.src = u; }).catch(() => {}); return; } Nova.toast('This audio could not be played.', 'err'); });
      card._ncAudio = audio;
      return audio;
    };
    card._ncToggle = async () => {
      const a = await ensure();
      if (a.paused) {
        claimAudio(a); a.playbackRate = SPEEDS[speedIndex];
        try { await a.play(); } catch (e1) {
          if (e1 && e1.name === 'NotAllowedError') { try { await new Promise(r => setTimeout(r, 60)); await a.play(); } catch (_) { Nova.toast('Tap play again to start audio.', 'err'); } }
          else if (e1 && e1.name !== 'AbortError') { Nova.toast('This audio could not be played.', 'err'); }
        }
        if (speedBtn) speedBtn.hidden = false;
      }
      else a.pause();
    };
    play.addEventListener('click', event => { event.stopPropagation(); card._ncToggle(); });
    if (speedBtn) speedBtn.addEventListener('click', async event => {
      event.stopPropagation();
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      speedBtn.textContent = `${SPEEDS[speedIndex]}×`;
      if (audio) audio.playbackRate = SPEEDS[speedIndex];
    });
    const seekTo = async p => { const a = await ensure(); const d = a.duration && Number.isFinite(a.duration) ? a.duration : att.duration || 0; if (d) { a.currentTime = Math.max(0, Math.min(1, p)) * d; paint(); } };
    const wave = card.querySelector('.nc-wave');
    if (wave) {
      wave.addEventListener('click', event => { const r = wave.getBoundingClientRect(); seekTo((event.clientX - r.left) / r.width); });
      wave.addEventListener('keydown', async event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); const a = await ensure(); a.currentTime = Math.max(0, a.currentTime + (event.key === 'ArrowRight' ? 5 : -5)); paint();
      });
    }
    if (seek) seek.addEventListener('input', () => seekTo(Number(seek.value) / 1000));
    const tbtn = card.querySelector('[data-nc-transcript]');
    if (tbtn) tbtn.addEventListener('click', event => { event.stopPropagation(); const p = card.querySelector('.nc-transcript'); p.hidden = !p.hidden; });
  }
  function autoplayNext(card) {
    const sender = card.dataset.sender;
    let next = card.closest('.nc-msg')?.nextElementSibling;
    while (next && !next.querySelector('[data-voice]') && next.classList.contains('nc-msg') === false) next = next.nextElementSibling;
    const nextCard = next && next.querySelector('.nc-voice:not(.played)');
    if (nextCard && sender && nextCard.dataset.sender === sender && next.dataset.sender === sender) { hydrateVoice(nextCard); nextCard._ncToggle(); }
  }

  function hydrateVideoNote(card) {
    if (card._ncHydrated) return; card._ncHydrated = true;
    const att = JSON.parse(card.dataset.att), frame = card.querySelector('.nc-vnote-frame'), ring = card.querySelector('.nc-ring circle'), toggle = card.querySelector('[data-nc-vnote]');
    const dur = card.querySelector('.nc-vnote-dur'), CIRC = 2 * Math.PI * 47;
    ring.style.strokeDasharray = String(CIRC); ring.style.strokeDashoffset = String(CIRC);
    let video = null, active = false;
    const mount = async () => {
      if (video) return video;
      video = document.createElement('video');
      video.playsInline = true; video.muted = true; video.loop = true; video.preload = 'auto'; video.setAttribute('playsinline', '');
      video.src = att._blobUrl || await typedSrc(att);
      frame.querySelector('.nc-slot')?.replaceWith(video);
      video.addEventListener('timeupdate', () => {
        if (!active || !video.duration) return;
        ring.style.strokeDashoffset = String(CIRC * (1 - video.currentTime / video.duration));
        dur.textContent = R.fmtDuration(video.duration - video.currentTime);
      });
      video.addEventListener('ended', () => { active = false; card.classList.remove('playing'); toggle.innerHTML = ic('play', 24); });
      return video;
    };
    const setActive = on => {
      active = on; card.classList.toggle('playing', on);
      toggle.innerHTML = ic(on ? 'pause' : 'play', 24);
      if (!on) { ring.style.strokeDashoffset = String(CIRC); dur.textContent = R.fmtDuration(att.duration || 0); }
    };
    toggle.addEventListener('click', async event => {
      event.stopPropagation();
      try {
        const v = await mount();
        if (!active) { claimAudio(v); v.loop = false; v.muted = false; v.currentTime = 0; setActive(true); try { await v.play(); } catch (e) { if (e && e.name === 'AbortError') return; throw e; } }
        else if (v.paused) { claimAudio(v); await v.play(); setActive(true); }
        else { v.pause(); toggle.innerHTML = ic('play', 24); }
      } catch (error) { Nova.toast('This video message could not be played.', 'err'); setActive(false); }
    });
    // muted looping preview while visible (Telegram style)
    whenVisible(card, async () => {
      if (!shouldAutoLoad('video_note')) return;
      try { const v = await mount(); v.muted = true; v.loop = true; v.play().catch(() => {}); } catch (_) {}
    });
  }

  function hydrateFile(card) {
    const att = JSON.parse(card.dataset.att);
    cachedBlobUrl(att.path || '').then(url => { if (url) card.classList.add('local'); });
  }

  M.hydrate = function (root) {
    root.querySelectorAll('.nc-tile[data-att]:not([data-hydrated])').forEach(tile => { tile.dataset.hydrated = '1'; hydrateTile(tile); });
    root.querySelectorAll('[data-voice]').forEach(hydrateVoice);
    root.querySelectorAll('[data-vnote]').forEach(hydrateVideoNote);
    root.querySelectorAll('.nc-file:not([data-hydrated])').forEach(card => { card.dataset.hydrated = '1'; hydrateFile(card); });
  };
  M.stopAll = () => { if (nowPlaying && nowPlaying.pause) nowPlaying.pause(); };

  /* upload-progress updates without re-rendering the bubble */
  M.setProgress = function (root, index, fraction) {
    root.querySelectorAll(`[data-prog="${index}"] .fg`).forEach(c => { c.style.strokeDashoffset = String(94 - 94 * fraction); });
    root.querySelectorAll(`.nc-file[data-file="${index}"] .nc-file-bar`).forEach(bar => { bar.hidden = fraction >= 1; bar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`; });
  };

  /* ----- manual download of a tile / file with progress ----- */
  async function downloadInto(el, att) {
    const bar = el.querySelector('.nc-file-bar'), label = el.querySelector('.nc-file-state');
    const slot = el.querySelector('.nc-slot');
    const progress = f => {
      if (bar) { bar.hidden = false; bar.firstElementChild.style.width = `${Math.round(f * 100)}%`; }
      if (label) label.textContent = ` · ${Math.round(f * 100)}%`;
      if (slot && el.classList.contains('manual')) slot.innerHTML = `<span class="nc-dl busy"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" style="stroke-dashoffset:${94 - 94 * f}"/></svg></span>`;
    };
    try {
      progress(0);
      await downloadAttachment(att, progress);
      if (label) label.textContent = ' · saved';
      if (bar) bar.hidden = true;
      if (el.classList.contains('nc-tile')) { el.removeAttribute('data-hydrated'); el.classList.remove('manual'); hydrateTile(el); el.dataset.hydrated = '1'; }
      el.classList.add('local');
    } catch (error) {
      if (label) label.textContent = ' · failed, tap to retry';
      if (slot && el.classList.contains('manual')) slot.innerHTML = `<span class="nc-dl" data-nc-download>${ic('alert', 22)}<b>Retry</b></span>`;
      if (bar) bar.hidden = true;
      Nova.toast(error.message || 'Download failed.', 'err');
    }
  }

  /* --------------------------------------------------------- media viewer */
  function buildVideoControls(video, host) {
    const bar = M.h(`<div class="nc-vc"><button type=button data-p aria-label="Play">${ic('play', 22)}</button><span class=nc-vc-t>0:00</span><input type=range min=0 max=1000 value=0 class=nc-vc-seek aria-label="Seek"><span class=nc-vc-d>0:00</span><button type=button data-s class=nc-vc-speed aria-label="Playback speed">1×</button><button type=button data-m aria-label="Mute">${ic('volume', 20)}</button>${document.pictureInPictureEnabled ? `<button type=button data-pip aria-label="Picture in picture">${ic('pip', 20)}</button>` : ''}<button type=button data-f aria-label="Fullscreen">${ic('maximize', 20)}</button></div>`);
    host.append(bar);
    const $ = s => bar.querySelector(s), seek = $('.nc-vc-seek'), speeds = [0.5, 1, 1.25, 1.5, 2]; let si = 1, hideTimer = null;
    const sync = () => { if (video.duration) { if (document.activeElement !== seek) seek.value = String(Math.round(video.currentTime / video.duration * 1000)); $('.nc-vc-t').textContent = R.fmtDuration(video.currentTime); $('.nc-vc-d').textContent = R.fmtDuration(video.duration); } };
    video.addEventListener('timeupdate', sync); video.addEventListener('loadedmetadata', sync);
    video.addEventListener('play', () => { $('[data-p]').innerHTML = ic('pause', 22); host.classList.add('playing'); });
    video.addEventListener('pause', () => { $('[data-p]').innerHTML = ic('play', 22); host.classList.remove('playing'); });
    const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());
    $('[data-p]').onclick = toggle;
    video.addEventListener('click', toggle);
    seek.oninput = () => { if (video.duration) video.currentTime = Number(seek.value) / 1000 * video.duration; };
    $('[data-s]').onclick = event => { si = (si + 1) % speeds.length; video.playbackRate = speeds[si]; event.currentTarget.textContent = `${speeds[si]}×`; };
    $('[data-m]').onclick = event => { video.muted = !video.muted; event.currentTarget.innerHTML = ic(video.muted ? 'volumex' : 'volume', 20); };
    const pip = $('[data-pip]'); if (pip) pip.onclick = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {});
    $('[data-f]').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else (host.requestFullscreen || video.webkitEnterFullscreen || (() => {})).call(host.requestFullscreen ? host : video); };
    host.addEventListener('pointermove', () => { host.classList.add('show-ui'); clearTimeout(hideTimer); hideTimer = setTimeout(() => host.classList.remove('show-ui'), 2500); });
    host.classList.add('show-ui');
    return { toggle };
  }

  /* items: [{ kind, path?, url?, _blobUrl?, name, type, w, h, size, thumb, sender:{name,avatar_url}, at, caption, messageId, own }] */
  function openViewer(items, startIndex = 0, opts = {}) {
    if (!items.length) return;
    let index = Math.max(0, Math.min(items.length - 1, startIndex)), scale = 1, tx = 0, ty = 0, closed = false, token = 0;
    const node = M.h(`<div class="nc-viewer"><div class="nc-v-top"><button type=button class="nc-v-btn" data-v-close aria-label="Close">${ic('x', 22)}</button>
        <div class="nc-v-who"></div><span class="nc-v-count"></span>
        <div class="nc-v-actions"><button type=button class="nc-v-btn" data-v-jump aria-label="Show in chat" ${opts.onJump ? '' : 'hidden'}>${ic('chat', 20)}</button><button type=button class="nc-v-btn" data-v-fwd aria-label="Forward" ${opts.onForward ? '' : 'hidden'}>${ic('forward', 20)}</button><button type=button class="nc-v-btn" data-v-share aria-label="Share">${ic('share', 20)}</button><button type=button class="nc-v-btn" data-v-save aria-label="Download">${ic('download', 20)}</button><button type=button class="nc-v-btn" data-v-del aria-label="Delete" hidden>${ic('trash', 20)}</button></div></div>
      <div class="nc-v-stage"><div class="nc-v-slide"></div></div>
      <button type=button class="nc-v-nav prev" data-v-prev aria-label="Previous">${ic('left', 26)}</button><button type=button class="nc-v-nav next" data-v-next aria-label="Next">${ic('right', 26)}</button>
      <div class="nc-v-caption" dir=auto></div></div>`);
    const stage = node.querySelector('.nc-v-stage'), slide = node.querySelector('.nc-v-slide');
    const close = openOverlay(node, { label: 'Media viewer', onClose: () => { closed = true; slide.querySelectorAll('video,audio').forEach(v => v.pause()); } });

    const apply = () => { const m = slide.firstElementChild; if (m && m.classList.contains('nc-v-media')) m.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
    const reset = () => { scale = 1; tx = 0; ty = 0; apply(); stage.classList.remove('zoomed'); };
    async function show(i, direction = 0) {
      index = i; const my = ++token, item = items[i]; reset();
      node.querySelector('.nc-v-count').textContent = items.length > 1 ? `${i + 1} / ${items.length}` : '';
      const who = item.sender;
      node.querySelector('.nc-v-who').innerHTML = who ? `${Nova.avatar(who, 34)}<span><b>${esc(who.name || who.full_name || who.username || '')}</b><small>${item.at ? esc(`${R.dayLabel(item.at)}, ${R.fmtTime(item.at)}`) : ''}</small></span>` : '';
      node.querySelector('.nc-v-caption').textContent = item.caption || '';
      node.querySelector('.nc-v-caption').hidden = !item.caption;
      node.querySelector('[data-v-prev]').hidden = i === 0; node.querySelector('[data-v-next]').hidden = i === items.length - 1;
      node.querySelector('[data-v-del]').hidden = !(opts.onDelete && item.own);
      const holder = document.createElement('div'); holder.className = 'nc-v-slide-in'; if (direction) holder.dataset.dir = direction > 0 ? 'next' : 'prev';
      holder.innerHTML = `<div class="nc-v-loading"><span class="nc-spin"></span></div>`;
      slide.replaceChildren(holder);
      try {
        const src = await srcFor(item);
        if (my !== token || closed) return;
        let media;
        if (item.kind === 'video') {
          const wrap = document.createElement('div'); wrap.className = 'nc-v-video';
          const video = document.createElement('video'); video.src = src; video.playsInline = true; video.autoplay = true; video.preload = 'auto'; video.className = 'nc-v-media';
          wrap.append(video); holder.replaceChildren(wrap); buildVideoControls(video, wrap); media = video;
          video.play().catch(() => {});
        } else if (src) {
          const img = document.createElement('img'); img.className = 'nc-v-media'; img.alt = item.name || ''; img.draggable = false; img.src = src;
          img.onerror = () => { holder.innerHTML = `<p class="nc-v-error">${ic('alert', 28)}<span>This photo could not be loaded.</span></p>`; };
          holder.replaceChildren(img); media = img;
        } else {
          holder.replaceChildren(M.h(`<div class="nc-v-bigavatar">${Nova.avatar(item.sender || {}, 220)}</div>`));
        }
        void media;
      } catch (error) { if (my === token) holder.innerHTML = `<p class="nc-v-error">${ic('alert', 28)}<span>${esc(error.message || 'Could not load this media.')}</span></p>`; }
      [items[i + 1], items[i - 1]].forEach(n => { if (n && n.kind === 'image' && n.path) signed(n.path).then(u => { const p = new Image(); p.src = u; }).catch(() => {}); });
    }
    const go = d => { const n = index + d; if (n >= 0 && n < items.length) show(n, d); };

    node.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-v-close')) close();
      else if (b.hasAttribute('data-v-prev')) go(-1);
      else if (b.hasAttribute('data-v-next')) go(1);
      else if (b.hasAttribute('data-v-save')) saveAttachment(items[index]).catch(e => Nova.toast(e.message || 'Download failed', 'err'));
      else if (b.hasAttribute('data-v-share')) shareAttachment(items[index]);
      else if (b.hasAttribute('data-v-fwd')) { close(); opts.onForward(items[index]); }
      else if (b.hasAttribute('data-v-jump')) { close(); opts.onJump(items[index]); }
      else if (b.hasAttribute('data-v-del')) { opts.onDelete(items[index]).then(ok => { if (ok) close(); }); }
    });
    document.addEventListener('keydown', function keys(event) {
      if (closed) return document.removeEventListener('keydown', keys);
      if (overlays[overlays.length - 1]?.node !== node) return;
      if (event.key === 'ArrowLeft') go(-1); else if (event.key === 'ArrowRight') go(1);
    });

    /* gestures: pinch / wheel / double-tap zoom, pan, swipe to change, swipe down to close */
    const pointers = new Map(); let startDist = 0, startScale = 1, pan = null, swipe = null, lastTap = 0;
    const clamp = () => { const m = slide.querySelector('.nc-v-media'); if (!m) return; const r = stage.getBoundingClientRect(), mw = (m.clientWidth || r.width) * scale, mh = (m.clientHeight || r.height) * scale; const lx = Math.max(0, (mw - r.width) / 2), ly = Math.max(0, (mh - r.height) / 2); tx = Math.max(-lx, Math.min(lx, tx)); ty = Math.max(-ly, Math.min(ly, ty)); };
    const zoomAt = (next, cx, cy) => { const r = stage.getBoundingClientRect(), ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2, k = next / scale; tx = ox - (ox - tx) * k; ty = oy - (oy - ty) * k; scale = next; if (scale <= 1.01) { scale = 1; tx = ty = 0; } clamp(); apply(); stage.classList.toggle('zoomed', scale > 1); };
    stage.addEventListener('wheel', event => { if (!slide.querySelector('img.nc-v-media')) return; event.preventDefault(); zoomAt(Math.max(1, Math.min(6, scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15))), event.clientX, event.clientY); }, { passive: false });
    stage.addEventListener('pointerdown', event => {
      if (event.target.closest('.nc-vc')) return;
      stage.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; startDist = Math.hypot(a.x - b.x, a.y - b.y); startScale = scale; swipe = null; }
      else { pan = { x: event.clientX, y: event.clientY, tx, ty }; swipe = { x: event.clientX, y: event.clientY, t: Date.now() }; }
    });
    stage.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const isImage = !!slide.querySelector('img.nc-v-media');
      if (pointers.size === 2 && isImage) { const [a, b] = [...pointers.values()]; zoomAt(Math.max(1, Math.min(6, startScale * Math.hypot(a.x - b.x, a.y - b.y) / startDist)), (a.x + b.x) / 2, (a.y + b.y) / 2); }
      else if (pointers.size === 1 && scale > 1 && pan) { tx = pan.tx + event.clientX - pan.x; ty = pan.ty + event.clientY - pan.y; clamp(); apply(); }
      else if (pointers.size === 1 && swipe && scale === 1) { const dy = event.clientY - swipe.y; if (dy > 0 && Math.abs(dy) > Math.abs(event.clientX - swipe.x)) { slide.style.transform = `translateY(${dy}px)`; node.style.setProperty('--fade', String(Math.max(0.3, 1 - dy / 400))); } }
    });
    const end = event => {
      if (!pointers.has(event.pointerId)) return; pointers.delete(event.pointerId);
      slide.style.transform = ''; node.style.removeProperty('--fade');
      if (swipe && pointers.size === 0 && scale === 1) {
        const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y, dt = Date.now() - swipe.t;
        if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) close();
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
        else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && dt < 300 && slide.querySelector('img.nc-v-media')) {
          if (Date.now() - lastTap < 320) { zoomAt(scale > 1 ? 1 : 2.5, event.clientX, event.clientY); lastTap = 0; } else lastTap = Date.now();
        }
      } else if (swipe && Math.abs(event.clientX - swipe.x) < 8 && Math.abs(event.clientY - swipe.y) < 8 && scale > 1 && Date.now() - lastTap < 320) { zoomAt(1, event.clientX, event.clientY); lastTap = 0; }
      else if (swipe && Math.abs(event.clientX - swipe.x) < 8 && Math.abs(event.clientY - swipe.y) < 8) lastTap = Date.now();
      swipe = null; pan = null;
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);

    // open animation from the tapped thumbnail
    if (opts.originRect) {
      const r = opts.originRect, sx = r.width / innerWidth, sy = r.height / innerHeight;
      node.animate([{ opacity: 0, transform: `translate(${r.left + r.width / 2 - innerWidth / 2}px,${r.top + r.height / 2 - innerHeight / 2}px) scale(${Math.max(sx, sy)})`, borderRadius: '24px' }, { opacity: 1, transform: 'none', borderRadius: '0' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    show(index);
    return { close };
  }
  M.openViewer = openViewer;
  M.openAvatar = function (user) {
    const name = user.full_name || user.username || 'Profile photo';
    openViewer([{ kind: 'image', url: user.avatar_url && /^https?:\/\//i.test(user.avatar_url) ? user.avatar_url : '', name, sender: { name, avatar_url: user.avatar_url } }], 0);
  };

  /* ----------------------------------------------------- document previews */
  const PREVIEW_EXT = new Set(['pdf', 'txt', 'csv', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'gif', 'webp']);
  function canPreviewDoc(att) { return PREVIEW_EXT.has(R.fileExt(att.name)) || att.type === 'application/pdf' || att.type === 'text/plain'; }
  M.canPreviewDoc = canPreviewDoc;

  const loadedScripts = {};
  function loadScript(src) {
    if (loadedScripts[src]) return loadedScripts[src];
    return loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous';
      s.onload = resolve; s.onerror = () => { delete loadedScripts[src]; reject(new Error('Could not load the preview component. Check your connection.')); };
      document.head.append(s);
    });
  }
  M.loadScript = loadScript;
  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html'), allowed = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'BR', 'SPAN', 'BLOCKQUOTE', 'SUB', 'SUP', 'A', 'IMG']);
    const walk = node => { for (const child of [...node.children]) {
      if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      for (const attr of [...child.attributes]) {
        const ok = (child.tagName === 'A' && attr.name === 'href' && /^https?:/i.test(attr.value)) || (child.tagName === 'IMG' && attr.name === 'src' && /^data:image\/(png|jpe?g|gif|webp);/i.test(attr.value)) || ['colspan', 'rowspan'].includes(attr.name);
        if (!ok) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') { child.target = '_blank'; child.rel = 'noopener noreferrer nofollow'; }
      walk(child);
    } };
    walk(doc.body); return doc.body.innerHTML;
  }
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length && rows.length < 300; i++) {
      const c = text[i];
      if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
      else if (c === '"') quoted = true;
      else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function tableFrom(rows) {
    const table = document.createElement('table'); table.className = 'nc-doc-table';
    rows.slice(0, 300).forEach((r, ri) => { const tr = table.insertRow(); r.slice(0, 40).forEach(v => { const td = document.createElement(ri === 0 ? 'th' : 'td'); td.textContent = v == null ? '' : String(v); tr.append(td); }); });
    return table;
  }

  async function openDocPreview(att) {
    const ext = R.fileExt(att.name), node = M.h(`<div class="nc-docview"><div class="nc-v-top"><button type=button class="nc-v-btn" data-d-close aria-label="Close">${ic('x', 22)}</button><div class="nc-v-who"><span><b>${esc(att.name)}</b><small>${esc(ext.toUpperCase())} · ${R.fmtBytes(att.size)}</small></span></div><div class="nc-v-actions"><button type=button class="nc-v-btn" data-d-share aria-label="Share">${ic('share', 20)}</button><button type=button class="nc-v-btn" data-d-save aria-label="Download">${ic('download', 20)}</button></div></div><div class="nc-docbody"><div class="nc-doc-loading"><span class="nc-spin"></span><span>Loading preview…</span><i><b></b></i></div></div></div>`);
    let blobUrl = null; const close = openOverlay(node, { label: `Preview ${att.name}`, onClose: () => { if (blobUrl) URL.revokeObjectURL(blobUrl); } });
    const body = node.querySelector('.nc-docbody'), loading = body.querySelector('.nc-doc-loading');
    node.addEventListener('click', event => { const b = event.target.closest('button'); if (!b) return; if (b.hasAttribute('data-d-close')) close(); else if (b.hasAttribute('data-d-save')) saveAttachment(att).catch(e => Nova.toast(e.message, 'err')); else if (b.hasAttribute('data-d-share')) shareAttachment(att); });
    try {
      const blob = await downloadAttachment(att, f => { loading.querySelector('i b').style.width = `${Math.round(f * 100)}%`; });
      const type = att.type || blob.type;
      if (ext === 'pdf' || type === 'application/pdf') {
        blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        body.innerHTML = `<iframe class="nc-doc-frame" title="${esc(att.name)}" src="${blobUrl}"></iframe><p class="nc-doc-hint">Can't see the document? <a href="${blobUrl}" target="_blank" rel="noopener">Open it in a new tab</a>.</p>`;
      } else if (/^image\//.test(type) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
        blobUrl = URL.createObjectURL(blob); body.innerHTML = `<img class="nc-doc-img" alt="${esc(att.name)}" src="${blobUrl}">`;
      } else if (ext === 'txt' || type === 'text/plain') {
        const text = (await blob.text()).slice(0, 300000), pre = document.createElement('pre'); pre.className = 'nc-doc-text'; pre.textContent = text; body.replaceChildren(pre);
      } else if (ext === 'csv') {
        const wrap = document.createElement('div'); wrap.className = 'nc-doc-scroll'; wrap.append(tableFrom(parseCsv((await blob.text()).slice(0, 400000)))); body.replaceChildren(wrap);
      } else if (ext === 'docx') {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
        const result = await window.mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        const page = document.createElement('article'); page.className = 'nc-doc-page'; page.innerHTML = sanitizeHtml(result.value) || '<p>This document is empty.</p>'; body.replaceChildren(page);
      } else if (ext === 'xlsx') {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
        const wb = window.XLSX.read(await blob.arrayBuffer(), { type: 'array' }), wrap = document.createElement('div'); wrap.className = 'nc-doc-scroll';
        wb.SheetNames.slice(0, 5).forEach(name => { const h = document.createElement('h4'); h.textContent = name; wrap.append(h, tableFrom(window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false }))); });
        body.replaceChildren(wrap);
      } else body.innerHTML = `<p class="nc-v-error">${ic('file', 28)}<span>Preview isn't available for this file type. Download it to open it.</span></p>`;
    } catch (error) { body.innerHTML = `<p class="nc-v-error">${ic('alert', 28)}<span>${esc(error.message || 'Preview failed.')}</span></p>`; }
  }
  M.openDocPreview = openDocPreview;

  /* ------------------------------------------------- delegated media clicks */
  /* hooks are provided by nova-chat.js: M.hooks = { galleryFor(el), retry(el, index), cancel(el, index), openViewOnce(el, index) } */
  M.hooks = {};
  document.addEventListener('click', async event => {
    const t = event.target;
    const open = t.closest('[data-nc-open]');
    if (open && !t.closest('[data-nc-cancel],[data-nc-retry]')) {
      event.preventDefault(); event.stopPropagation();
      const att = JSON.parse(open.dataset.att);
      if (att._state === 'uploading') return;
      if (att.viewOnce && !att._blobUrl && M.hooks.openViewOnce) return M.hooks.openViewOnce(open, Number(open.dataset.ncOpen));
      if (open.classList.contains('manual') || t.closest('[data-nc-download]')) { downloadInto(open, att); return; }
      if (att.url && !att.path) return openViewer([{ ...att, kind: R.attKind(att) }], 0, { originRect: open.getBoundingClientRect() });
      const gallery = M.hooks.galleryFor ? M.hooks.galleryFor(open) : null;
      if (gallery) return openViewer(gallery.items, gallery.index, { ...gallery.opts, originRect: open.getBoundingClientRect() });
      return openViewer([{ ...att, kind: R.attKind(att) }], 0, { originRect: open.getBoundingClientRect() });
    }
    const retry = t.closest('[data-nc-retry]');
    if (retry) { event.stopPropagation(); M.hooks.retry && M.hooks.retry(retry, Number(retry.dataset.ncRetry)); return; }
    const cancel = t.closest('[data-nc-cancel]');
    if (cancel) { event.stopPropagation(); M.hooks.cancel && M.hooks.cancel(cancel, Number(cancel.dataset.ncCancel)); return; }
    const file = t.closest('.nc-file');
    if (file) {
      const att = JSON.parse(file.dataset.att); if (att._state) return;
      if (t.closest('[data-nc-share]')) return shareAttachment(att);
      if (t.closest('[data-nc-save]')) { event.stopPropagation(); return downloadInto(file, att).then(() => saveAttachment(att).catch(() => {})); }
      if (canPreviewDoc(att)) return openDocPreview(att);
      return downloadInto(file, att).then(() => saveAttachment(att).catch(() => {}));
    }
    const audioSave = t.closest('.nc-audio [data-nc-save]');
    if (audioSave) { const att = JSON.parse(audioSave.closest('.nc-audio').dataset.att); saveAttachment(att).catch(e => Nova.toast(e.message, 'err')); }
  }, true);
})();
