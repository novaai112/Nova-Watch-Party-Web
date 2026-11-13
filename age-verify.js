/* age-verify.js — UI, camera and detection loop for the 18+ liveness check (age-verify.html).
 * Logic lives in liveness-engine.js (movement analysis) and api/age-verify.js (server decisions).
 * Privacy: the camera runs only while a check is active; no frame is stored, and the single still frame
 * is held in memory only until the server answers. */
(function () {
  'use strict';
  const E = window.NovaLiveness, $ = id => document.getElementById(id);
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const DEBUG = /[?&]debug=1/.test(location.search);
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TOTAL = E.CFG.tasks;
  const nextParam = (() => { const n = new URLSearchParams(location.search).get('next') || ''; return /^[\w\-.]+\.html(#[\w\-./]*)?$/i.test(n) ? n : 'profile.html#settings'; })();

  /* ---------------------------------------------------------------- plain-language outcomes (never reveal detection details) */
  const OUT = {
    permission_denied: ['Camera access is blocked', 'Allow camera access for this site in your browser’s address bar or settings, then press Try again.'],
    no_camera: ['No camera found', 'Connect or enable a camera, or open Nova on a device that has one, then try again.'],
    camera_busy: ['Camera is already in use', 'Close other apps or browser tabs that are using the camera, then press Try again.'],
    unsupported: ['This browser can’t run the check', 'Use the latest Chrome, Edge, Safari or Firefox on a secure (https) connection, then try again.'],
    model_load: ['Couldn’t load the face check', 'Check your internet connection and try again.'],
    network: ['Connection problem', 'Check your internet connection and press Try again.'],
    timeout: ['That took too long', 'Press Try again — you’ll get new random moves. Make sure your face is clearly visible and well lit.'],
    face_not_detected: ['We couldn’t see your face clearly', 'Face the camera in good light, keep your whole face inside the oval, then try again.'],
    capture_quality: ['We couldn’t get a clear view', 'Check the light and camera lens, keep still and fully in the oval, then try again.'],
    multiple_faces: ['More than one person in view', 'Make sure you’re the only person in front of the camera, then try again.'],
    poor_lighting: ['The lighting was too poor', 'Face a window or turn on a light, avoid strong light behind you, then try again.'],
    challenge_failed: ['We couldn’t confirm a live person', 'Try again in good light with your device’s own camera, and follow each instruction fully.'],
    liveness_failed: ['We couldn’t confirm a live person', 'Try again in good light with your device’s own camera, and follow each instruction fully.'],
    suspicious: ['We couldn’t confirm a live person', 'Use your device’s built-in camera (not a virtual or filtered one), then try again.'],
    age_failed: ['We couldn’t confirm you’re 18 or older', 'Mature content stays hidden. If you think this is a mistake, contact support from your profile.'],
    age_uncertain: ['The age check wasn’t conclusive', 'Try again in good light, without hats, masks or filters. Mature content stays hidden until then.'],
    provider_unavailable: ['Verification is unavailable right now', 'Our age-check service can’t be reached. Mature content stays hidden — please try again in a few minutes.'],
    invalid_signature: ['We couldn’t complete the check securely', 'Please try again in a few minutes. Mature content stays hidden.'],
    expired: ['This check expired', 'Press Try again to start a new one.'],
    replayed: ['This check can’t be used again', 'Each check works once. Press Try again to start a new one.'],
    invalid_session: ['This check is no longer valid', 'Press Try again to start a new one.'],
    unauthorized: ['Please sign in again', 'Your session has ended. Sign in, then start the check again.'],
    rate_limited: ['Too many attempts', 'Please wait about 15 minutes before trying again. Mature content stays hidden.'],
    not_configured: ['Verification isn’t available yet', 'This feature isn’t set up on this site yet. Mature content stays hidden.'],
    server_error: ['Something went wrong on our side', 'Please try again in a few minutes. Mature content stays hidden.']
  };
  const RETRYABLE = new Set(['permission_denied', 'no_camera', 'camera_busy', 'unsupported', 'model_load', 'network', 'timeout', 'face_not_detected', 'capture_quality',
    'multiple_faces', 'poor_lighting', 'challenge_failed', 'liveness_failed', 'suspicious', 'age_uncertain', 'provider_unavailable', 'invalid_signature', 'expired', 'replayed', 'invalid_session', 'server_error']);

  /* ---------------------------------------------------------------- state */
  let runId = 0, phase = 'idle', stream = null, track = null, landmarker = null, landmarkerP = null, FL = null;
  let baseline = null, cal, guidance, signals, session = null, stepIdx = 0, challenge = null, stepStart = 0, savedFrame = null;
  let lastInfer = 0, frameNo = 0, lastPx = null, rafId = 0, vfcId = 0, calStart = 0, lastIssueCode = '';
  const video = $('cam'), overlay = $('overlay'), octx = overlay.getContext('2d');
  const pxCan = document.createElement('canvas'); pxCan.width = pxCan.height = 64; const pxCtx = pxCan.getContext('2d', { willReadFrequently: true });

  /* ---------------------------------------------------------------- tiny UI helpers */
  const say = t => { $('liveStatus').textContent = ''; setTimeout(() => { $('liveStatus').textContent = t; }, 30); };
  function show(view) {
    for (const v of ['intro', 'capture', 'result']) $('v-' + v).hidden = v !== view;
    const h = view === 'intro' ? $('introTitle') : view === 'capture' ? $('capTitle') : $('resTitle');
    if (view !== 'capture') { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: false }); }
    scrollTo(0, 0);
  }
  const camUI = on => { $('camState').dataset.on = on; $('camStateTxt').textContent = on ? 'Camera on' : 'Camera off'; $('stageOff').hidden = on; };
  const loader = t => { $('loader').hidden = !t; if (t) $('loaderTxt').textContent = t; };
  function buildRings() {
    $('rings').innerHTML = '';
    for (let i = 0; i < TOTAL; i++) {
      const li = document.createElement('li'); li.className = 'rg'; li.dataset.s = 'idle'; li.id = 'rg' + i;
      li.innerHTML = '<svg viewBox="0 0 50 50" aria-hidden="true"><circle class="fill" cx="25" cy="25" r="20"/><circle class="trk" cx="25" cy="25" r="20"/><circle class="arc" cx="25" cy="25" r="20"/>' +
        '<text class="num" x="25" y="25">' + (i + 1) + '</text><path class="mark" d="" /></svg><span class="lbl">Task ' + (i + 1) + '</span><span class="sr st">Waiting</span>';
      $('rings').append(li);
    }
  }
  const TICK = 'M16 26l7 7 12-14', CROSS = 'M17 17l16 16M33 17L17 33';
  function ring(i, s, p) {
    const el = $('rg' + i); if (!el) return;
    if (el.dataset.s !== s) {
      el.dataset.s = s;
      const m = el.querySelector('.mark');
      if (s === 'ok' || s === 'err') { m.setAttribute('d', s === 'ok' ? TICK : CROSS); m.setAttribute('fill', 'none'); m.setAttribute('stroke', 'currentColor'); m.setAttribute('stroke-width', '4'); m.setAttribute('stroke-linecap', 'round'); m.setAttribute('stroke-linejoin', 'round'); m.style.transform = 'rotate(90deg)'; m.style.transformOrigin = 'center'; }
      el.querySelector('.st').textContent = { idle: 'Waiting', progress: 'In progress', ok: 'Completed', err: 'Failed' }[s];
    }
    if (s === 'progress') el.querySelector('.arc').style.strokeDashoffset = String(125.7 * (1 - Math.max(0.06, Math.min(1, p || 0))));
    else el.querySelector('.arc').style.strokeDashoffset = '';
  }
  function guide(issue) {
    const g = $('guide'), st = $('stage');
    if (!issue) { g.hidden = true; st.dataset.g = phase === 'task' || phase === 'calibrate' ? 'ok' : 'idle'; return; }
    g.hidden = false; g.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg><span></span>';
    g.lastChild.textContent = issue.text; st.dataset.g = 'warn';
    if (issue.code !== lastIssueCode) say(issue.text);
  }

  /* ---------------------------------------------------------------- API (server decides; we only relay evidence) */
  async function api(action, body) {
    const { data } = await Nova.sb.auth.getSession();
    if (!data.session) throw { code: 'unauthorized' };
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 25000);
    let r;
    try {
      r = await fetch('/api/age-verify', { method: 'POST', credentials: 'omit', cache: 'no-store', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify(Object.assign({ action }, body)) });
    } catch (e) { throw { code: 'network' }; } finally { clearTimeout(tm); }
    let j = null; try { j = await r.json(); } catch (e) { /* non-JSON */ }
    if (!r.ok || !j || !j.ok) throw { code: (j && j.error) || (r.status === 404 ? 'not_configured' : 'server_error') };
    return j;
  }

  /* ---------------------------------------------------------------- camera + model */
  async function openCamera() {
    const errMap = e => { const n = e && e.name; return n === 'NotAllowedError' || n === 'SecurityError' ? 'permission_denied' : n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError' ? 'no_camera' : n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError' ? 'camera_busy' : 'no_camera'; };
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } }); }
    catch (e) { try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); } catch (e2) { throw { code: errMap(e2.name ? e2 : e) }; } }
    track = stream.getVideoTracks()[0];
    video.srcObject = stream; video.muted = true;
    await new Promise((res, rej) => { const t = setTimeout(() => rej({ code: 'camera_busy' }), 8000); video.onloadedmetadata = () => { clearTimeout(t); res(); }; });
    try { await video.play(); } catch (e) { throw { code: 'camera_busy' }; }
    track.addEventListener('ended', () => { if (phase !== 'idle' && phase !== 'done') failRun('no_camera'); });
    track.addEventListener('mute', () => { signals && signals.flag('track_muted'); });
    camUI(true);
  }
  function stopCamera() {                              // called on every exit path: success, failure, cancel, leaving the page
    cancelAnimationFrame(rafId); rafId = 0;
    if (video.cancelVideoFrameCallback && vfcId) { try { video.cancelVideoFrameCallback(vfcId); } catch (e) { } vfcId = 0; }
    if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } });
    stream = null; track = null; video.srcObject = null; camUI(false);
    octx.clearRect(0, 0, overlay.width, overlay.height); $('stage').dataset.scan = 'false';
  }
  function loadLandmarker() {
    if (landmarker) return Promise.resolve(landmarker);
    if (landmarkerP) return landmarkerP;
    landmarkerP = (async () => {
      let mod;
      try { mod = await import(MP + '/vision_bundle.mjs'); } catch (e) { throw { code: 'model_load' }; }
      FL = mod.FaceLandmarker;
      const files = await mod.FilesetResolver.forVisionTasks(MP + '/wasm').catch(() => { throw { code: 'model_load' }; });
      const make = delegate => FL.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numFaces: 2,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      try { landmarker = await make('GPU'); } catch (e) { try { landmarker = await make('CPU'); } catch (e2) { throw { code: 'model_load' }; } }
      return landmarker;
    })().catch(e => { landmarkerP = null; throw e; });
    return landmarkerP;
  }

  /* ---------------------------------------------------------------- run control */
  function supported() { return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.WebAssembly); }

  async function begin() {
    const my = ++runId; phase = 'boot'; savedFrame = null; session = null; stepIdx = 0; challenge = null; baseline = null; lastIssueCode = '';
    cal = E.createCalibrator(); guidance = E.createGuidance(); signals = E.createSignals(); buildRings();
    $('stageMsg').hidden = true; guide(null); $('stage').dataset.g = 'idle';
    $('stepLbl').textContent = 'Getting ready'; $('instrTxt').textContent = 'Starting your camera…'; $('hintTxt').textContent = ''; $('timerBar').style.transform = 'scaleX(1)';
    show('capture'); loader('Starting camera…');
    try {
      if (!supported()) throw { code: 'unsupported' };
      await openCamera(); if (my !== runId) return stopCamera();
      loader('Loading face check…'); const lm = await loadLandmarker(); if (my !== runId) return stopCamera();
      for (const f of E.inspectCamera({ label: track.label, settings: track.getSettings(), muted: track.muted, readyState: track.readyState })) signals.flag(f);
      loader(null); phase = 'calibrate'; calStart = performance.now(); $('stage').dataset.scan = REDUCED ? 'false' : 'true';
      $('stepLbl').textContent = 'Get in position'; $('instrTxt').textContent = 'Look straight at the camera'; $('hintTxt').textContent = 'Keep your face inside the oval and hold still';
      say('Camera is on. Look straight at the camera and hold still.');
      startLoop(my, lm);
    } catch (e) { if (my === runId) failRun(e && e.code || 'unsupported'); }
  }

  function startLoop(my, lm) {
    const tick = () => {
      if (my !== runId || !stream) return;
      const now = performance.now();
      if (!document.hidden && video.readyState >= 2 && now - lastInfer >= 30) {
        lastInfer = now;
        try { onFrame(lm.detectForVideo(video, now), now, my); } catch (e) { if (my === runId) return failRun('unsupported'); }
      }
      schedule();
    };
    const schedule = () => { if (my !== runId || !stream) return; if (video.requestVideoFrameCallback) vfcId = video.requestVideoFrameCallback(tick); else rafId = requestAnimationFrame(tick); };
    schedule();
  }

  /* Pixel statistics of the face (or whole frame when no face) — every 5th frame only, 64×64, so it stays cheap. */
  function samplePixels(f) {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (f && f.face) { sx = Math.max(0, f.bbox.x0 * vw); sy = Math.max(0, f.bbox.y0 * vh); sw = Math.min(vw - sx, (f.bbox.x1 - f.bbox.x0) * vw); sh = Math.min(vh - sy, (f.bbox.y1 - f.bbox.y0) * vh); }
    if (sw < 8 || sh < 8) return null;
    pxCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 64, 64);
    const d = pxCtx.getImageData(0, 0, 64, 64).data, g = new Uint8Array(4096);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return E.analyzePixels(g, 64, 64);
  }

  function onFrame(res, now, my) {
    const frame = { w: video.videoWidth, h: video.videoHeight };
    const f = E.extractFeatures(res, frame, now);
    frameNo++;
    if (frameNo % 5 === 0) { lastPx = samplePixels(f); signals.pixels(lastPx); }
    signals.push(f, res.faceLandmarks && res.faceLandmarks[0], frame, now);
    E.derive(f, baseline || E.DEFAULT_BASELINE);
    draw(res, f);
    indicators(f);
    if (DEBUG) debug(f);
    if (phase === 'submit' || phase === 'done') return;

    let issue = E.checkFrame(f, lastPx);
    if (issue && issue.code === 'no_face' && lastPx && lastPx.mean < E.CFG.lumaLow) issue = { code: 'low_light', block: true, text: 'It’s too dark. Face a window or turn on a light.' };
    const shown = guidance.update(issue, now); guide(shown); lastIssueCode = shown ? shown.code : '';
    const blocked = !!(shown && shown.block);

    if (phase === 'calibrate') {
      if (!blocked && cal.push(f)) {
        const p = cal.count() / E.CFG.calibrateFrames; $('hintTxt').textContent = 'Hold still… ' + Math.min(99, Math.round(p * 100)) + '%';
        if (cal.ready()) { baseline = cal.baseline(); return startSession(my); }
      }
      if (now - calStart > 30000) failRun(lastPx && lastPx.mean < E.CFG.lumaLow ? 'poor_lighting' : f.faceCount > 1 ? 'multiple_faces' : 'face_not_detected');
      return;
    }
    if (phase === 'task' && challenge) {
      const st = challenge.update(f, now, blocked);
      ring(stepIdx, 'progress', st.progress);
      $('timerBar').style.transform = 'scaleX(' + (st.limitMs ? Math.max(0, st.leftMs / st.limitMs) : 1) + ')';
      if (!blocked && st.hint) $('hintTxt').textContent = st.hint; else if (blocked) $('hintTxt').textContent = 'Paused — fix the picture, then continue';
      if (st.done) return submitStep(st, now, my);
      if (st.failed) return failStep(st.reason === 'capture_quality' ? (f.faceCount > 1 ? 'multiple_faces' : lastPx && lastPx.mean < E.CFG.lumaLow ? 'poor_lighting' : 'capture_quality') : st.reason === 'timeout' ? 'timeout' : 'challenge_failed');
    }
  }

  async function startSession(my) {
    phase = 'submit'; $('stage').dataset.scan = 'false'; loader('Preparing your check…');
    try {
      const r = await api('start', {}); if (my !== runId) return;
      if (r.already) return success(true);
      session = r; loader(null); beginStep(r.step);
    } catch (e) { if (my === runId) failRun(e.code || 'server_error'); }
  }

  function beginStep(step) {
    stepIdx = step.index; challenge = E.createChallenge(step.id, baseline); stepStart = performance.now(); phase = 'task';
    for (let i = 0; i < TOTAL; i++) if (i > stepIdx) ring(i, 'idle');
    ring(stepIdx, 'progress', 0);
    $('stepLbl').textContent = 'Task ' + (stepIdx + 1) + ' of ' + TOTAL; $('instrTxt').textContent = step.text; $('hintTxt').textContent = 'Look straight at the camera first';
    $('timerBar').style.transform = 'scaleX(1)'; say('Task ' + (stepIdx + 1) + ' of ' + TOTAL + ': ' + step.text);
  }

  async function submitStep(st, now, my) {
    phase = 'submit'; const ev = E.stepEvidence(challenge.id, st, stepStart, now); const idx = stepIdx;
    try {
      const r = await api('step', { nonce: session.nonce, index: idx, evidence: ev }); if (my !== runId) return;
      ring(idx, 'ok'); say('Task ' + (idx + 1) + ' complete.');
      if (r.done) return finalize(my);
      session.step = r.step; guidance.reset(); beginStep(r.step);
    } catch (e) { if (my === runId) { ring(idx, 'err'); failRun(e.code || 'server_error', 700); } }
  }
  function failStep(code) { ring(stepIdx, 'err'); failRun(code, 700); }

  async function finalize(my) {
    $('stepLbl').textContent = 'Finishing up'; $('instrTxt').textContent = 'Almost done'; $('hintTxt').textContent = 'Camera is switching off…';
    savedFrame = grabFrame();                // one still frame, kept in memory only until the server answers
    const summary = signals.summary(); session.signals = summary;
    stopCamera();                            // camera processing ends here, before any network wait
    await sendFinish(my);
  }
  async function sendFinish(my) {
    phase = 'submit'; show('capture'); loader('Checking your result securely…');
    try {
      await api('finish', { nonce: session.nonce, signals: session.signals, frame: savedFrame });
      if (my !== runId) return;
      success(false);
    } catch (e) { if (my === runId) failRun(e.code || 'server_error', 0, true); }
  }
  function grabFrame() {
    try {
      const w = Math.min(480, video.videoWidth), h = Math.round(w * video.videoHeight / video.videoWidth), c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(video, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.85);
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- outcomes */
  async function success(already) {
    phase = 'done'; stopCamera(); savedFrame = null;
    try { Nova.maturityVerified = true; await Nova.set('hideMature', false); } catch (e) { /* settings sync is retried by the profile page */ }
    result('ok', already ? 'You’re already verified' : 'Verified — you’re 18+', 'Mature content can now be switched on or off in Settings whenever you like. You won’t be asked to verify again.', null);
    $('resPrimary').textContent = 'Continue'; $('resPrimary').onclick = () => location.href = nextParam; $('resSecondary').hidden = true;
    setTimeout(() => { if (phase === 'done' && !$('v-result').hidden && $('resBox').dataset.k === 'ok') location.href = nextParam; }, REDUCED ? 6000 : 3500);
  }
  function failRun(code, delay, canRetryFinish) {
    if (phase === 'done') return;
    const my = runId; phase = canRetryFinish ? 'submit' : 'done'; if (!canRetryFinish) { savedFrame = null; } stopCamera(); loader(null);
    setTimeout(() => {
      if (my !== runId) return;
      const m = OUT[code] || OUT.server_error;
      result('err', m[0], m[1], null);
      const retry = RETRYABLE.has(code);
      $('resNext').hidden = false; $('resNextTxt').textContent = m[1]; $('resText').textContent = 'No mature content has been unlocked.';
      const p = $('resPrimary'); p.hidden = !retry && code !== 'unauthorized';
      if (code === 'unauthorized') { p.textContent = 'Sign in'; p.onclick = () => location.href = 'index.html?next=' + encodeURIComponent('age-verify.html'); }
      else if (canRetryFinish && savedFrame && (code === 'provider_unavailable' || code === 'network' || code === 'invalid_signature') && session) { p.textContent = 'Try again'; p.onclick = () => { const r = ++runId; sendFinish(r); }; }
      else { p.textContent = 'Try again'; p.onclick = () => { savedFrame = null; begin(); }; }
      $('resSecondary').hidden = false; $('resSecondary').onclick = () => location.href = nextParam;
      say(m[0] + '. ' + m[1]);
    }, delay || 0);
  }
  function result(kind, title, text) {
    $('resBox').dataset.k = kind; $('resTitle').textContent = title; $('resText').textContent = text || ''; $('resNext').hidden = true;
    $('resMark').setAttribute('d', kind === 'ok' ? 'M38 62l15 15 30-32' : 'M42 42l36 36M78 42L42 78');
    const m = $('resMark'); m.style.animation = 'none'; void m.getBoundingClientRect(); m.style.animation = '';
    const a = document.querySelector('.big-ring .a'); a.style.animation = 'none'; void a.getBoundingClientRect(); a.style.animation = '';
    $('resPrimary').hidden = false; show('result');
  }
  function cancel() { runId++; phase = 'idle'; stopCamera(); savedFrame = null; session = null; loader(null); show('intro'); }

  /* ---------------------------------------------------------------- drawing + indicators (cheap, per frame) */
  function sizeOverlay() {
    const r = overlay.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1), w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    return d;
  }
  function draw(res, f) {
    const d = sizeOverlay(), cw = overlay.width, ch = overlay.height; octx.clearRect(0, 0, cw, ch);
    if (!f.face || !res.faceLandmarks[0]) return;
    const lm = res.faceLandmarks[0], vw = video.videoWidth, vh = video.videoHeight, sc = Math.max(cw / vw, ch / vh), ox = (cw - vw * sc) / 2, oy = (ch - vh * sc) / 2;
    const X = p => p.x * vw * sc + ox, Y = p => p.y * vh * sc + oy;
    const good = !(guidance && guidance.current());
    octx.lineWidth = Math.max(1.5, 1.6 * d); octx.lineCap = 'round';
    const sets = FL ? [[FL.FACE_LANDMARKS_FACE_OVAL, 'rgba(255,255,255,.55)'], [FL.FACE_LANDMARKS_LIPS, '#fda4af'], [FL.FACE_LANDMARKS_LEFT_EYEBROW, '#fde68a'], [FL.FACE_LANDMARKS_RIGHT_EYEBROW, '#fde68a']] : [];
    const eyeCol = (f.eyeL > 0.55 || f.eyeR > 0.55) ? '#fb923c' : '#7dd3fc';
    if (FL) { sets.push([FL.FACE_LANDMARKS_LEFT_EYE, f.eyeL > 0.55 ? '#fb923c' : eyeCol], [FL.FACE_LANDMARKS_RIGHT_EYE, f.eyeR > 0.55 ? '#fb923c' : eyeCol]); }
    for (const [conn, col] of sets) {
      if (!conn) continue; octx.strokeStyle = good ? col : 'rgba(255,255,255,.35)'; octx.beginPath();
      for (const c of conn) { const a = lm[c.start], b = lm[c.end]; if (a && b) { octx.moveTo(X(a), Y(a)); octx.lineTo(X(b), Y(b)); } }
      octx.stroke();
    }
    octx.fillStyle = '#34d399';                       // nose + key points
    for (const i of [1, 4, 168, 33, 263, 61, 291, 152]) { const p = lm[i]; if (p) { octx.beginPath(); octx.arc(X(p), Y(p), 2.2 * d, 0, 6.283); octx.fill(); } }
  }
  function indicators(f) {
    const set = (id, v) => { const el = $(id); el.dataset.closed = v > 0.55; el.querySelector('i').style.height = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; };
    if (f.face) {
      set('eyeL', f.eyeL || 0); set('eyeR', f.eyeR || 0);
      const dx = Math.max(-1, Math.min(1, -f.yaw / 35)) * 30, dy = Math.max(-1, Math.min(1, -f.pitch / 20)) * 30;   // mirrored preview: your left = screen left
      $('headDot').style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) rotate(' + (-(f.rollRel || 0)).toFixed(0) + 'deg)';
    } else { set('eyeL', 0); set('eyeR', 0); $('headDot').style.transform = ''; }
  }
  function debug(f) {
    const d = $('debug'); d.hidden = false;
    d.textContent = ['phase ' + phase, f.face ? 'yaw ' + f.yaw.toFixed(1) + ' pitch ' + f.pitch.toFixed(1) + ' roll ' + f.rollRel.toFixed(1) : 'no face',
      f.face ? 'eyeL ' + f.eyeL.toFixed(2) + ' eyeR ' + f.eyeR.toFixed(2) + ' smile ' + f.smile.toFixed(2) + ' mouth ' + f.mouthOpen.toFixed(2) : '',
      f.face ? 'fill ' + f.fill.toFixed(2) + ' ctr ' + f.cx.toFixed(2) + ',' + f.cy.toFixed(2) + ' anatomy ' + f.anatomyOk : '',
      lastPx ? 'luma ' + lastPx.mean.toFixed(0) + ' lap ' + lastPx.lapVar.toFixed(0) + ' clip ' + lastPx.clipHigh.toFixed(2) : ''].join('\n');
  }

  /* ---------------------------------------------------------------- wiring */
  function initTheme() {
    $('themeBtn').onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nx); try { localStorage.setItem('nova-watch-theme', nx); } catch (e) { }
    };
  }
  async function init() {
    initTheme();
    $('backLink').href = nextParam; $('declineLink').href = nextParam;
    if (!window.isSecureContext) {
      const c = $('chipSecure'); c.classList.add('bad'); c.lastChild.textContent = 'Not a secure connection';
      const e = $('introError'); e.hidden = false; e.textContent = 'The camera only works on a secure (https) connection. Open Nova using its https address.';
    }
    $('consent').addEventListener('change', e => { $('startBtn').disabled = !e.target.checked || !window.isSecureContext; });
    $('startBtn').addEventListener('click', () => { if ($('consent').checked) begin(); });
    $('cancelBtn').addEventListener('click', cancel);
    $('restartBtn').addEventListener('click', () => { runId++; stopCamera(); begin(); });
    // privacy: never keep the camera running in the background or after leaving
    document.addEventListener('visibilitychange', () => { if (document.hidden && stream) { cancel(); const e = $('introError'); e.hidden = false; e.textContent = 'The check was stopped and your camera switched off because you left this page. Start again when you’re ready.'; } });
    addEventListener('pagehide', () => { runId++; stopCamera(); });
    const user = await Nova.requireAuth(); if (!user) return;
    try { const { data } = await Nova.sb.from('profiles').select('maturity_verified').eq('id', user.id).single(); if (data && data.maturity_verified) { Nova.maturityVerified = true; result('ok', 'You’re already verified', 'Your account is already confirmed as 18+. Switch mature content on or off in Settings — no new check is needed.'); $('resPrimary').textContent = 'Back to settings'; $('resPrimary').onclick = () => location.href = nextParam; $('resSecondary').hidden = true; return; } } catch (e) { /* column may not exist yet; the server will report */ }
  }
  init();
})();
