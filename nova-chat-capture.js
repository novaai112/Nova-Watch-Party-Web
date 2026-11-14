/* nova-chat-capture.js — capture & compose tools for Nova Chat: live camera (photo + video), photo editor
   (crop, rotate, flip, draw, text, stickers), send-preview sheet (HD / original, view-once, captions),
   voice recorder with live waveform, and circular video-note recorder.
   Requires nova-chat-rich.js and nova-chat-media.js. */
(function () {
  'use strict';
  const R = window.NovaChatRich, M = window.NovaChatMedia, Nova = window.Nova, { esc } = R, ic = M.ic, h = M.h;
  const mediaOk = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const micError = error => {
    const n = error && error.name;
    return n === 'NotAllowedError' ? 'Permission was denied. Allow camera / microphone access in your browser settings.'
      : n === 'NotFoundError' ? 'No camera or microphone was found on this device.'
      : n === 'NotReadableError' ? 'The camera or microphone is being used by another app.'
      : (error && error.message) || 'Could not start recording.';
  };
  const stopStream = s => s && s.getTracks().forEach(t => t.stop());
  const pickType = list => (window.MediaRecorder ? list.find(t => MediaRecorder.isTypeSupported(t)) : '') || '';
  const extFor = mime => /mp4/.test(mime) ? 'mp4' : /ogg/.test(mime) ? 'ogg' : /webm/.test(mime) ? 'webm' : 'bin';
  M.mediaSupported = mediaOk;

  /* ================================================================ camera */
  /* Resolves with an array of Files ([] when cancelled). */
  M.openCamera = function ({ video = true } = {}) {
    return new Promise(resolve => {
      if (!mediaOk()) { Nova.toast('Camera is not available in this browser. Use Photos & videos instead.', 'err'); return resolve([]); }
      let stream = null, facing = 'environment', mode = 'photo', recorder = null, chunks = [], timer = null, startedAt = 0, torch = false, done = false, holdTimer = null, held = false;
      const node = h(`<div class="nc-camera"><video class="nc-cam-video" playsinline muted autoplay></video>
        <div class="nc-cam-top"><button type=button class="nc-v-btn" data-c-close aria-label="Close camera">${ic('x', 22)}</button><span class="nc-cam-time" hidden>0:00</span><button type=button class="nc-v-btn" data-c-torch aria-label="Flash" hidden>${ic('zap', 20)}</button></div>
        <p class="nc-cam-error" hidden></p>
        <div class="nc-cam-bottom">${video ? `<div class="nc-cam-modes" role="tablist"><button type=button class="on" data-c-mode="photo" role="tab">Photo</button><button type=button data-c-mode="video" role="tab">Video</button></div>` : ''}
          <div class="nc-cam-row"><span></span><button type=button class="nc-shutter" data-c-shutter aria-label="Take photo"><i></i></button><button type=button class="nc-v-btn" data-c-flip aria-label="Switch camera">${ic('flipcam', 24)}</button></div>
          <small class="nc-cam-hint">${video ? 'Tap for photo · hold for video' : 'Tap to take a photo'}</small></div></div>`);
      const vid = node.querySelector('video'), err = node.querySelector('.nc-cam-error'), timeEl = node.querySelector('.nc-cam-time'), shutter = node.querySelector('.nc-shutter');
      const finish = files => { if (done) return; done = true; clearInterval(timer); stopStream(stream); close(); resolve(files); };
      const close = M.openOverlay(node, { label: 'Camera', onClose: () => { if (!done) { done = true; clearInterval(timer); stopStream(stream); resolve([]); } } });
      async function start() {
        stopStream(stream);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: video });
        } catch (error) {
          if (video) { try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false }); } catch (e2) { err.hidden = false; err.textContent = micError(e2); return; } }
          else { err.hidden = false; err.textContent = micError(error); return; }
        }
        vid.srcObject = stream; vid.classList.toggle('mirror', facing === 'user');
        const track = stream.getVideoTracks()[0], caps = track && track.getCapabilities ? track.getCapabilities() : {};
        node.querySelector('[data-c-torch]').hidden = !caps.torch;
        err.hidden = true;
      }
      function snap() {
        if (!vid.videoWidth) return;
        const canvas = document.createElement('canvas'); canvas.width = vid.videoWidth; canvas.height = vid.videoHeight;
        const ctx = canvas.getContext('2d'); if (facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
        ctx.drawImage(vid, 0, 0);
        canvas.toBlob(blob => blob && finish([new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })]), 'image/jpeg', 0.92);
      }
      function startRec() {
        if (recorder || !stream || !stream.getAudioTracks().length && !video) return;
        const type = pickType(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']);
        try { recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream); } catch (error) { Nova.toast('Video recording is not supported here.', 'err'); return; }
        chunks = []; recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        recorder.onstop = () => {
          const mime = (recorder.mimeType || type || 'video/webm').split(';')[0]; recorder = null; node.classList.remove('recording');
          const blob = new Blob(chunks, { type: mime });
          if (blob.size && !done) finish([new File([blob], `video-${Date.now()}.${extFor(mime)}`, { type: mime })]);
        };
        recorder.start(500); startedAt = Date.now(); node.classList.add('recording'); timeEl.hidden = false;
        timer = setInterval(() => { const s = (Date.now() - startedAt) / 1000; timeEl.textContent = R.fmtDuration(s); if (s >= 180) stopRec(); }, 250);
      }
      const stopRec = () => { clearInterval(timer); if (recorder && recorder.state !== 'inactive') recorder.stop(); };
      shutter.addEventListener('pointerdown', () => {
        held = false;
        if (mode === 'photo' && video) holdTimer = setTimeout(() => { held = true; setMode('video', true); startRec(); }, 450);
      });
      const release = () => { clearTimeout(holdTimer); if (held && recorder) { held = false; stopRec(); } };
      shutter.addEventListener('pointerup', release); shutter.addEventListener('pointerleave', release);
      shutter.addEventListener('click', () => {
        if (held) return;
        if (mode === 'photo') snap(); else if (recorder) stopRec(); else startRec();
      });
      function setMode(m, keep) { mode = m; node.querySelectorAll('[data-c-mode]').forEach(b => b.classList.toggle('on', b.dataset.cMode === m)); shutter.setAttribute('aria-label', m === 'photo' ? 'Take photo' : 'Record video'); if (!keep) node.classList.toggle('video-mode', m === 'video'); }
      node.addEventListener('click', async event => {
        const b = event.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-c-close')) finish([]);
        else if (b.dataset.cMode) setMode(b.dataset.cMode);
        else if (b.hasAttribute('data-c-flip')) { facing = facing === 'user' ? 'environment' : 'user'; start(); }
        else if (b.hasAttribute('data-c-torch')) { torch = !torch; try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch }] }); b.classList.toggle('on', torch); } catch (_) {} }
      });
      start();
    });
  };

  /* ============================================================== editor */
  /* Resolves with an edited File, or null when cancelled. */
  M.openEditor = function (file) {
    return new Promise(async resolve => {
      let bitmap;
      try { bitmap = await M.decodeImage(file); } catch (e) { Nova.toast('This image cannot be edited.', 'err'); return resolve(null); }
      const MAX = 2048; let base = document.createElement('canvas');
      { const k = Math.min(1, MAX / Math.max(bitmap.width || bitmap.naturalWidth, bitmap.height || bitmap.naturalHeight)); base.width = Math.round((bitmap.width || bitmap.naturalWidth) * k); base.height = Math.round((bitmap.height || bitmap.naturalHeight) * k); base.getContext('2d').drawImage(bitmap, 0, 0, base.width, base.height); }
      const history = []; let objects = [], tool = 'none', color = '#ffffff', crop = null, aspect = 0, drawing = null, active = null, finished = false;
      const COLORS = ['#ffffff', '#0f172a', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
      const node = h(`<div class="nc-editor"><div class="nc-v-top"><button type=button class="nc-v-btn" data-e-cancel aria-label="Cancel">${ic('x', 22)}</button><div class="nc-ed-tools" role="toolbar" aria-label="Editing tools">
          <button type=button data-e-tool="crop" aria-label="Crop">${ic('crop', 20)}</button><button type=button data-e-rot="-1" aria-label="Rotate left">${ic('rotateccw', 20)}</button><button type=button data-e-rot="1" aria-label="Rotate right">${ic('rotatecw', 20)}</button><button type=button data-e-flip aria-label="Flip">${ic('flipcam', 20)}</button>
          <button type=button data-e-tool="draw" aria-label="Draw">${ic('pen', 20)}</button><button type=button data-e-tool="text" aria-label="Add text">${ic('text', 20)}</button><button type=button data-e-tool="sticker" aria-label="Add sticker">${ic('smile', 20)}</button><button type=button data-e-undo aria-label="Undo" disabled>${ic('undo', 20)}</button></div>
          <button type=button class="nc-ed-done" data-e-done>Done</button></div>
        <div class="nc-ed-stage"><canvas class="nc-ed-canvas"></canvas><div class="nc-ed-crop" hidden><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div><div class="nc-ed-trash" hidden>${ic('trash', 22)}</div></div>
        <div class="nc-ed-bar"><div class="nc-ed-colors" hidden>${COLORS.map(c => `<button type=button data-e-color="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}</div>
          <div class="nc-ed-aspects" hidden>${[['Free', 0], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9], ['3:4', 3 / 4]].map(([l, v]) => `<button type=button data-e-aspect="${v}">${l}</button>`).join('')}<button type=button class="apply" data-e-apply-crop>Apply crop</button></div>
          <div class="nc-ed-stickers" hidden>${R.EMOJI.flatMap(c => c.items).slice(0, 120).map(([e]) => `<button type=button data-e-sticker="${e}">${e}</button>`).join('')}</div></div></div>`);
      const stage = node.querySelector('.nc-ed-stage'), canvas = node.querySelector('canvas'), ctx = canvas.getContext('2d'), cropBox = node.querySelector('.nc-ed-crop'), trash = node.querySelector('.nc-ed-trash');
      const close = M.openOverlay(node, { label: 'Edit photo', onClose: () => { if (!finished) resolve(null); } });
      const undoBtn = node.querySelector('[data-e-undo]');
      const snapshot = () => { history.push({ base: copy(base), objects: objects.map(o => ({ ...o, points: o.points && o.points.map(p => [...p]) })) }); if (history.length > 8) history.shift(); undoBtn.disabled = false; };
      function copy(c) { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); return n; }
      let scale = 1;
      function layout() {
        const r = stage.getBoundingClientRect(), k = Math.min(r.width / base.width, r.height / base.height);
        canvas.width = Math.round(base.width * k); canvas.height = Math.round(base.height * k); scale = k; draw();
        if (tool === 'crop' && crop) placeCrop();
      }
      function paintObjects(c, k) {
        for (const o of objects) {
          c.save();
          if (o.type === 'path') { c.strokeStyle = o.color; c.lineWidth = o.size * k; c.lineCap = c.lineJoin = 'round'; c.beginPath(); o.points.forEach(([x, y], i) => (i ? c.lineTo(x * k, y * k) : c.moveTo(x * k, y * k))); if (o.points.length === 1) c.lineTo(o.points[0][0] * k + 0.1, o.points[0][1] * k); c.stroke(); }
          else { c.translate(o.x * k, o.y * k); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `${o.type === 'sticker' ? '' : '700 '}${o.size * k}px system-ui, "Apple Color Emoji", sans-serif`;
            if (o.type === 'text') { const w = c.measureText(o.text).width; c.fillStyle = o.color === '#ffffff' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.8)'; c.beginPath(); c.roundRect ? c.roundRect(-w / 2 - 10 * k, -o.size * k * .7, w + 20 * k, o.size * k * 1.4, 10 * k) : c.rect(-w / 2 - 10 * k, -o.size * k * .7, w + 20 * k, o.size * k * 1.4); c.fill(); }
            c.fillStyle = o.color || '#fff'; c.fillText(o.text, 0, 0); }
          c.restore();
        }
      }
      function draw() { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(base, 0, 0, canvas.width, canvas.height); paintObjects(ctx, scale); }
      function flatten() { if (!objects.length) return; const c = base.getContext('2d'); paintObjects(c, 1); objects = []; }
      function setTool(t) {
        if (tool === 'crop' && t !== 'crop') { cropBox.hidden = true; }
        tool = tool === t ? 'none' : t;
        node.querySelectorAll('[data-e-tool]').forEach(b => b.classList.toggle('on', b.dataset.eTool === tool));
        node.querySelector('.nc-ed-colors').hidden = !(tool === 'draw' || tool === 'text');
        node.querySelector('.nc-ed-aspects').hidden = tool !== 'crop';
        node.querySelector('.nc-ed-stickers').hidden = tool !== 'sticker';
        canvas.style.cursor = tool === 'draw' ? 'crosshair' : '';
        if (tool === 'crop') { flatten(); draw(); crop = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; placeCrop(); cropBox.hidden = false; }
        if (tool === 'text') addText();
      }
      function placeCrop() { const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect(); Object.assign(cropBox.style, { left: `${cr.left - sr.left + crop.x * cr.width}px`, top: `${cr.top - sr.top + crop.y * cr.height}px`, width: `${crop.w * cr.width}px`, height: `${crop.h * cr.height}px` }); }
      function addText() {
        const text = prompt('Add text'); if (!text) return setTool('none');
        snapshot(); objects.push({ type: 'text', text: text.slice(0, 80), x: base.width / 2, y: base.height / 2, size: Math.round(base.width / 12), color }); draw();
      }
      const toImg = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * base.width, (e.clientY - r.top) / r.height * base.height]; };
      const hit = ([x, y]) => [...objects].reverse().find(o => o.type !== 'path' && Math.abs(x - o.x) < o.size * (o.text.length * .35 + .6) && Math.abs(y - o.y) < o.size * .8);
      canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId); const p = toImg(e);
        if (tool === 'draw') { snapshot(); drawing = { type: 'path', color, size: Math.round(base.width / 100) + 3, points: [p] }; objects.push(drawing); draw(); return; }
        const o = hit(p); if (o) { snapshot(); active = { o, dx: p[0] - o.x, dy: p[1] - o.y, moved: false }; }
      });
      canvas.addEventListener('pointermove', e => {
        const p = toImg(e);
        if (drawing) { drawing.points.push(p); draw(); }
        else if (active) { active.o.x = p[0] - active.dx; active.o.y = p[1] - active.dy; active.moved = true; trash.hidden = false; const cr = canvas.getBoundingClientRect(); trash.classList.toggle('hot', e.clientY > cr.bottom - 70); draw(); }
      });
      const up = e => {
        if (active) { const cr = canvas.getBoundingClientRect(); if (e.clientY > cr.bottom - 70 && active.moved) { objects = objects.filter(o => o !== active.o); } trash.hidden = true; trash.classList.remove('hot'); draw(); }
        drawing = null; active = null;
      };
      canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('wheel', e => { const o = hit(toImg(e)); if (o) { e.preventDefault(); o.size = Math.max(16, Math.min(base.width / 2, o.size * (e.deltaY < 0 ? 1.08 : 0.93))); draw(); } }, { passive: false });
      canvas.addEventListener('dblclick', e => { const o = hit(toImg(e)); if (o && o.type === 'text') { const t = prompt('Edit text', o.text); if (t) { o.text = t.slice(0, 80); draw(); } } });
      // crop handles
      let drag = null;
      cropBox.addEventListener('pointerdown', e => { cropBox.setPointerCapture(e.pointerId); drag = { handle: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, start: { ...crop } }; });
      cropBox.addEventListener('pointermove', e => {
        if (!drag) return; const cr = canvas.getBoundingClientRect(), dx = (e.clientX - drag.x) / cr.width, dy = (e.clientY - drag.y) / cr.height, s = drag.start; let { x, y, w, h: ht } = s;
        if (drag.handle === 'move') { x = s.x + dx; y = s.y + dy; }
        else { if (drag.handle.includes('w')) { x = s.x + dx; w = s.w - dx; } if (drag.handle.includes('e')) w = s.w + dx; if (drag.handle.includes('n')) { y = s.y + dy; ht = s.h - dy; } if (drag.handle.includes('s')) ht = s.h + dy;
          if (aspect) { ht = w * (base.width / base.height) / aspect; } }
        w = Math.max(0.1, w); ht = Math.max(0.1, ht); x = Math.max(0, Math.min(1 - w, x)); y = Math.max(0, Math.min(1 - ht, y));
        crop = { x, y, w, h: ht }; placeCrop();
      });
      cropBox.addEventListener('pointerup', () => { drag = null; });
      const rotate = dir => { flatten(); snapshot(); const n = document.createElement('canvas'); n.width = base.height; n.height = base.width; const c = n.getContext('2d'); c.translate(n.width / 2, n.height / 2); c.rotate(dir * Math.PI / 2); c.drawImage(base, -base.width / 2, -base.height / 2); base = n; layout(); };
      node.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-e-cancel')) { finished = false; close(); }
        else if (b.dataset.eTool) setTool(b.dataset.eTool);
        else if (b.dataset.eRot) { if (tool === 'crop') setTool('crop'); rotate(Number(b.dataset.eRot)); }
        else if (b.hasAttribute('data-e-flip')) { flatten(); snapshot(); const n = document.createElement('canvas'); n.width = base.width; n.height = base.height; const c = n.getContext('2d'); c.translate(n.width, 0); c.scale(-1, 1); c.drawImage(base, 0, 0); base = n; draw(); }
        else if (b.hasAttribute('data-e-undo')) { const s = history.pop(); if (s) { base = s.base; objects = s.objects; layout(); } undoBtn.disabled = !history.length; }
        else if (b.dataset.eColor) { color = b.dataset.eColor; node.querySelectorAll('[data-e-color]').forEach(x => x.classList.toggle('on', x === b)); }
        else if (b.dataset.eSticker) { snapshot(); objects.push({ type: 'sticker', text: b.dataset.eSticker, x: base.width / 2, y: base.height / 2, size: Math.round(base.width / 5) }); draw(); }
        else if (b.dataset.eAspect !== undefined) { aspect = Number(b.dataset.eAspect); if (aspect) { crop.h = Math.min(0.95, crop.w * (base.width / base.height) / aspect); placeCrop(); } }
        else if (b.hasAttribute('data-e-apply-crop')) { snapshot(); const sx = Math.round(crop.x * base.width), sy = Math.round(crop.y * base.height), sw = Math.round(crop.w * base.width), sh = Math.round(crop.h * base.height); const n = document.createElement('canvas'); n.width = sw; n.height = sh; n.getContext('2d').drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh); base = n; cropBox.hidden = true; tool = 'none'; setTool('none'); layout(); }
        else if (b.hasAttribute('data-e-done')) {
          flatten(); const type = /png/.test(file.type) && base.width * base.height < 3e6 ? 'image/png' : 'image/jpeg';
          const blob = await M.canvasBlob(base, type, 0.92); finished = true;
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg'), { type })); close();
        }
      });
      new ResizeObserver(layout).observe(stage); requestAnimationFrame(layout);
    });
  };

  /* ======================================================= send preview */
  /* files: File[]. Resolves { items: [{file, viewOnce, quality}], caption } or null. */
  M.openSendPreview = function (files, { title = 'Send', allowMore = true, pickMore, captionDefault = '' } = {}) {
    return new Promise(resolve => {
      let items = files.map(f => ({ file: f, viewOnce: false, url: URL.createObjectURL(f) })), current = 0, quality = 'standard', settled = false;
      const node = h(`<div class="nc-preview"><div class="nc-v-top"><button type=button class="nc-v-btn" data-p-cancel aria-label="Cancel">${ic('x', 22)}</button><span class="nc-v-count"></span>
        <div class="nc-v-actions"><button type=button class="nc-pill" data-p-quality aria-label="Photo quality">SD</button><button type=button class="nc-v-btn" data-p-once aria-label="View once">${ic('once', 22)}</button><button type=button class="nc-v-btn" data-p-edit aria-label="Edit">${ic('pen', 20)}</button><button type=button class="nc-v-btn" data-p-remove aria-label="Remove">${ic('trash', 20)}</button></div></div>
        <div class="nc-pv-stage"></div><div class="nc-pv-strip"></div>
        <div class="nc-pv-bar"><label class="nc-pv-caption"><input type=text maxlength=1000 placeholder="Add a caption…" aria-label="Caption" value="${esc(captionDefault)}" dir=auto></label><button type=button class="nc-send" data-p-send aria-label="${esc(title)}">${ic('send', 20)}</button></div></div>`);
      const finish = r => { if (settled) return; settled = true; items.forEach(i => URL.revokeObjectURL(i.url)); resolve(r); close(); };
      const close = M.openOverlay(node, { label: 'Preview before sending', onClose: () => { if (!settled) { settled = true; items.forEach(i => URL.revokeObjectURL(i.url)); resolve(null); } } });
      const kindOf = f => f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : 'file';
      function render() {
        if (!items.length) return finish(null);
        current = Math.min(current, items.length - 1); const it = items[current], kind = kindOf(it.file);
        node.querySelector('.nc-v-count').textContent = items.length > 1 ? `${current + 1} / ${items.length}` : '';
        node.querySelector('.nc-pv-stage').innerHTML = kind === 'image' ? `<img alt="Preview" src="${it.url}">` : kind === 'video' ? `<video controls playsinline src="${it.url}"></video>` : kind === 'audio' ? `<div class="nc-pv-file">${ic('music', 40)}<b>${esc(it.file.name)}</b><audio controls src="${it.url}"></audio></div>` : `<div class="nc-pv-file">${ic('file', 40)}<b>${esc(it.file.name)}</b><small>${R.fmtBytes(it.file.size)}</small></div>`;
        node.querySelector('[data-p-edit]').hidden = kind !== 'image' || /gif/.test(it.file.type);
        node.querySelector('[data-p-once]').hidden = !['image', 'video'].includes(kind);
        node.querySelector('[data-p-once]').classList.toggle('on', it.viewOnce);
        node.querySelector('[data-p-quality]').hidden = !items.some(i => kindOf(i.file) === 'image');
        node.querySelector('[data-p-quality]').textContent = { standard: 'SD', hd: 'HD', original: 'Original' }[quality];
        node.querySelector('.nc-pv-strip').innerHTML = items.map((x, i) => `<button type=button class="${i === current ? 'on' : ''}" data-p-go="${i}" aria-label="Item ${i + 1}">${kindOf(x.file) === 'image' ? `<img alt="" src="${x.url}">` : kindOf(x.file) === 'video' ? `<video muted src="${x.url}#t=0.1"></video>` : ic('file', 20)}</button>`).join('') + (allowMore && pickMore ? `<button type=button data-p-more aria-label="Add more">${ic('plus', 22)}</button>` : '');
      }
      node.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-p-cancel')) close();
        else if (b.dataset.pGo) { current = Number(b.dataset.pGo); render(); }
        else if (b.hasAttribute('data-p-remove')) { URL.revokeObjectURL(items[current].url); items.splice(current, 1); render(); }
        else if (b.hasAttribute('data-p-once')) { items[current].viewOnce = !items[current].viewOnce; render(); }
        else if (b.hasAttribute('data-p-quality')) { quality = quality === 'standard' ? 'hd' : quality === 'hd' ? 'original' : 'standard'; Nova.toast({ standard: 'Standard quality (smaller, faster)', hd: 'HD quality', original: 'Original, full quality' }[quality]); render(); }
        else if (b.hasAttribute('data-p-edit')) { const edited = await M.openEditor(items[current].file); if (edited) { URL.revokeObjectURL(items[current].url); items[current] = { ...items[current], file: edited, url: URL.createObjectURL(edited) }; render(); } }
        else if (b.hasAttribute('data-p-more')) { const more = await pickMore(); (more || []).slice(0, Math.max(0, 8 - items.length)).forEach(f => items.push({ file: f, viewOnce: false, url: URL.createObjectURL(f) })); render(); }
        else if (b.hasAttribute('data-p-send')) finish({ items: items.map(({ file, viewOnce }) => ({ file, viewOnce })), quality, caption: node.querySelector('.nc-pv-caption input').value.trim() });
      });
      node.querySelector('.nc-pv-caption input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); node.querySelector('[data-p-send]').click(); } });
      render();
    });
  };

  /* ======================================================= voice recorder */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  M.VoiceRecorder = class VoiceRecorder {
    constructor({ onLevel } = {}) { this.onLevel = onLevel; this.state = 'idle'; this.peaks = []; this.elapsed = 0; this.mark = 0; this.transcript = ''; }
    async start() {
      if (!mediaOk() || !window.MediaRecorder) throw new Error('Voice recording is not supported by this browser.');
      try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (error) { throw new Error(micError(error)); }
      const type = pickType(['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']);
      this.rec = type ? new MediaRecorder(this.stream, { mimeType: type }) : new MediaRecorder(this.stream);
      this.chunks = []; this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
      try {
        const AC = window.AudioContext || window.webkitAudioContext; this.ac = new AC(); const src = this.ac.createMediaStreamSource(this.stream);
        this.an = this.ac.createAnalyser(); this.an.fftSize = 512; src.connect(this.an); const buf = new Uint8Array(this.an.fftSize);
        this.levelTimer = setInterval(() => { if (this.state !== 'recording') return; this.an.getByteTimeDomainData(buf); let max = 0; for (const v of buf) max = Math.max(max, Math.abs(v - 128)); const level = Math.min(1, max / 90); this.peaks.push(level); this.onLevel && this.onLevel(level); }, 90);
      } catch (_) {}
      this.rec.start(250); this.state = 'recording'; this.mark = performance.now(); this._speech(true);
    }
    _speech(on) {
      if (!SR || !M.prefs().transcribe) return;
      try {
        if (!on) { this.sr && (this.sr.onend = null, this.sr.stop()); return; }
        this.sr = new SR(); this.sr.continuous = true; this.sr.interimResults = false; this.sr.lang = (Nova.S && Nova.S.lang) || navigator.language || 'en-US';
        this.sr.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) this.transcript += `${e.results[i][0].transcript.trim()} `; };
        this.sr.onend = () => { if (this.state === 'recording') { try { this.sr.start(); } catch (_) {} } };
        this.sr.start();
      } catch (_) {}
    }
    get duration() { return (this.elapsed + (this.state === 'recording' ? performance.now() - this.mark : 0)) / 1000; }
    pause() { if (this.state !== 'recording') return; this.elapsed += performance.now() - this.mark; this.rec.pause(); this.state = 'paused'; this._speech(false); }
    resume() { if (this.state !== 'paused') return; this.mark = performance.now(); this.rec.resume(); this.state = 'recording'; this._speech(true); }
    _cleanup() { clearInterval(this.levelTimer); this._speech(false); stopStream(this.stream); try { this.ac && this.ac.close(); } catch (_) {} this.state = 'idle'; }
    cancel() { if (this.rec && this.rec.state !== 'inactive') { this.rec.onstop = null; this.rec.stop(); } this._cleanup(); }
    stop() {
      return new Promise(resolve => {
        const duration = this.duration, mime = (this.rec.mimeType || 'audio/webm').split(';')[0];
        this.rec.onstop = () => {
          this._cleanup(); const blob = new Blob(this.chunks, { type: mime }), n = 44, per = Math.max(1, this.peaks.length / n);
          const waveform = Array.from({ length: n }, (_, i) => { const slice = this.peaks.slice(Math.floor(i * per), Math.floor((i + 1) * per) || undefined); return Math.round(Math.max(10, Math.min(100, (slice.length ? Math.max(...slice) : 0.1) * 100))); });
          resolve({ blob, duration, mime, waveform, transcript: this.transcript.trim(), file: new File([blob], `voice-${Date.now()}.${extFor(mime)}`, { type: mime }) });
        };
        if (this.rec.state !== 'inactive') this.rec.stop(); else this.rec.onstop();
      });
    }
  };

  /* Preview a finished voice recording before sending. Resolves true (send) / false (discard). */
  M.previewVoice = function (result) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(result.blob), att = { kind: 'voice', _blobUrl: url, duration: result.duration, waveform: result.waveform, name: 'Voice message' };
      const node = h(`<div class="nc-sheet nc-voice-preview"><div class="nc-sheet-grab"></div><h3>Voice message</h3>${M.renderAttachments([att], { mine: true })}<div class="nc-sheet-actions"><button type=button class="nc-btn" data-v-discard>${ic('trash', 16)} Discard</button><button type=button class="nc-btn pri" data-v-send>${ic('send', 16)} Send</button></div></div>`);
      let settled = false; const finish = v => { if (settled) return; settled = true; M.stopAll(); URL.revokeObjectURL(url); resolve(v); close(); };
      const close = M.openOverlay(node, { label: 'Voice preview', onClose: () => { if (!settled) { settled = true; M.stopAll(); URL.revokeObjectURL(url); resolve(false); } } });
      M.hydrate(node);
      node.addEventListener('click', e => { if (e.target === node) close(); const b = e.target.closest('button'); if (!b) return; if (b.hasAttribute('data-v-send')) finish(true); else if (b.hasAttribute('data-v-discard')) finish(false); });
    });
  };

  /* ======================================================== video note */
  /* Resolves { file, duration, thumb, w, h } or null. */
  M.recordVideoNote = function () {
    return new Promise(resolve => {
      if (!mediaOk() || !window.MediaRecorder) { Nova.toast('Video messages are not supported by this browser.', 'err'); return resolve(null); }
      let stream = null, rec = null, chunks = [], facing = 'user', started = 0, timer = null, blob = null, previewUrl = '', settled = false, mime = '';
      const MAX = 60, CIRC = 2 * Math.PI * 47;
      const node = h(`<div class="nc-vnrec"><div class="nc-v-top"><button type=button class="nc-v-btn" data-n-close aria-label="Close">${ic('x', 22)}</button><span class="nc-cam-time">0:00</span></div>
        <div class="nc-vn-circle"><video playsinline muted autoplay></video><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47"/></svg></div>
        <p class="nc-cam-error" hidden></p><div class="nc-vn-controls"><button type=button class="nc-v-btn" data-n-flip aria-label="Switch camera">${ic('flipcam', 24)}</button><button type=button class="nc-shutter" data-n-rec aria-label="Start recording"><i></i></button><button type=button class="nc-v-btn" data-n-send aria-label="Send" hidden>${ic('send', 24)}</button></div><small class="nc-cam-hint">Tap to record up to 60 seconds</small></div>`);
      const vid = node.querySelector('video'), ring = node.querySelector('svg circle'), err = node.querySelector('.nc-cam-error'), time = node.querySelector('.nc-cam-time'), recBtn = node.querySelector('[data-n-rec]');
      ring.style.strokeDasharray = String(CIRC); ring.style.strokeDashoffset = String(CIRC);
      const finish = v => { if (settled) return; settled = true; clearInterval(timer); stopStream(stream); if (previewUrl) URL.revokeObjectURL(previewUrl); resolve(v); close(); };
      const close = M.openOverlay(node, { label: 'Record video message', onClose: () => { if (!settled) { settled = true; clearInterval(timer); stopStream(stream); if (previewUrl) URL.revokeObjectURL(previewUrl); resolve(null); } } });
      async function start() {
        stopStream(stream);
        try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 640 } }, audio: { echoCancellation: true, noiseSuppression: true } }); }
        catch (e) { err.hidden = false; err.textContent = micError(e); return; }
        vid.srcObject = stream; vid.muted = true; vid.classList.toggle('mirror', facing === 'user'); err.hidden = true;
      }
      function begin() {
        const type = pickType(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']);
        try { rec = type ? new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 900000 }) : new MediaRecorder(stream); } catch (_) { Nova.toast('Recording is not supported here.', 'err'); return; }
        chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
        rec.onstop = () => { mime = (rec.mimeType || type || 'video/webm').split(';')[0]; blob = new Blob(chunks, { type: mime }); showPreview(); };
        rec.start(500); started = Date.now(); node.classList.add('recording'); recBtn.setAttribute('aria-label', 'Stop recording');
        timer = setInterval(() => { const s = (Date.now() - started) / 1000; time.textContent = R.fmtDuration(s); ring.style.strokeDashoffset = String(CIRC * (1 - s / MAX)); if (s >= MAX) stop(); }, 100);
      }
      function stop() { clearInterval(timer); if (rec && rec.state !== 'inactive') rec.stop(); }
      function showPreview() {
        node.classList.remove('recording'); node.classList.add('reviewing'); stopStream(stream);
        if (!blob.size || (Date.now() - started) < 700) { Nova.toast('Hold on a little longer to record a video message.', 'err'); return reset(); }
        previewUrl = URL.createObjectURL(blob); vid.srcObject = null; vid.src = previewUrl; vid.muted = false; vid.loop = true; vid.classList.remove('mirror'); vid.play().catch(() => {});
        node.querySelector('[data-n-send]').hidden = false; node.querySelector('[data-n-flip]').setAttribute('aria-label', 'Retake'); node.querySelector('[data-n-flip]').innerHTML = ic('trash', 24); recBtn.hidden = true;
        node.querySelector('.nc-cam-hint').textContent = 'Preview — send it or retake';
      }
      function reset() { node.classList.remove('reviewing'); vid.removeAttribute('src'); vid.loop = false; node.querySelector('[data-n-send]').hidden = true; node.querySelector('[data-n-flip]').innerHTML = ic('flipcam', 24); node.querySelector('[data-n-flip]').setAttribute('aria-label', 'Switch camera'); recBtn.hidden = false; ring.style.strokeDashoffset = String(CIRC); time.textContent = '0:00'; node.querySelector('.nc-cam-hint').textContent = 'Tap to record up to 60 seconds'; blob = null; start(); }
      node.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-n-close')) close();
        else if (b.hasAttribute('data-n-rec')) { if (rec && rec.state === 'recording') stop(); else begin(); }
        else if (b.hasAttribute('data-n-flip')) { if (node.classList.contains('reviewing')) { URL.revokeObjectURL(previewUrl); previewUrl = ''; reset(); } else { facing = facing === 'user' ? 'environment' : 'user'; start(); } }
        else if (b.hasAttribute('data-n-send')) {
          const duration = (Date.now() - started) / 1000; const info = await M.videoInfo(new File([blob], 'x', { type: mime }));
          finish({ file: new File([blob], `video-message-${Date.now()}.${extFor(mime)}`, { type: mime }), duration: info.duration || duration, thumb: info.thumb, w: info.w, h: info.h });
        }
      });
      start();
    });
  };
})();
