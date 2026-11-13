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
    offline: ['You’re offline', 'Reconnect to the internet, then press Try again.'],
    network: ['Connection problem', 'We couldn’t reach the verification service. Check your connection and press Try again. If it keeps happening, the site owner should check the server settings.'],
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
  const RETRYABLE = new Set(['permission_denied', 'no_camera', 'camera_busy', 'unsupported', 'model_load', 'offline', 'network', 'timeout', 'face_not_detected', 'capture_quality',
    'multiple_faces', 'poor_lighting', 'challenge_failed', 'liveness_failed', 'suspicious', 'age_uncertain', 'provider_unavailable', 'invalid_signature', 'expired', 'replayed', 'invalid_session', 'server_error']);

  /* ---------------------------------------------------------------- state */
  let runId = 0, phase = 'idle', stream = null, track = null, landmarker = null, landmarkerP = null, FL = null;
  let baseline = null, cal, guidance, signals, session = null, stepIdx = 0, challenge = null, stepStart = 0, savedFrame = null;
  let lastInfer = 0, frameNo = 0, lastPx = null, rafId = 0, vfcId = 0, calStart = 0, lastIssueCode = '', lastSaid = '';
  let pctTarget = 0, pctShown = 0, uiRaf = 0;
  const RING = 305.4;
  const video = $('cam'), overlay = $('overlay'), octx = overlay.getContext('2d');
  const pxCan = document.createElement('canvas'); pxCan.width = pxCan.height = 64; const pxCtx = pxCan.getContext('2d', { willReadFrequently: true });

  /* short, one-line live messages */
  const ISSUE = {
    no_face: 'Face not detected', multiple_faces: 'Multiple faces detected', out_of_frame: 'Full face not detected', too_far: 'Move a little closer',
    too_close: 'Move back a little', off_center: 'Centre your face in the circle', low_light: 'Too dark — add some light', too_bright: 'Too bright — reduce glare',
    blur: 'Image is blurry — hold steady', obstruction: 'Remove anything covering your face'
  };
  const SHORT = {
    blink_both: 'Blink both eyes', blink_twice: 'Blink twice', close_reopen: 'Close your eyes, then open', wink_left: 'Wink your left eye', wink_right: 'Wink your right eye',
    turn_left: 'Turn your head left', turn_right: 'Turn your head right', look_up: 'Look up', look_down: 'Look down', tilt_left: 'Tilt your head left', tilt_right: 'Tilt your head right',
    smile: 'Smile', open_mouth: 'Open your mouth'
  };

  /* ---------------------------------------------------------------- tiny UI helpers */
  const say = t => { if (t === lastSaid) return; lastSaid = t; $('liveStatus').textContent = ''; setTimeout(() => { $('liveStatus').textContent = t; }, 30); };
  function show(view) {
    $('v-intro').hidden = view !== 'intro'; $('v-capture').hidden = view !== 'capture';
    document.body.style.overflow = view === 'capture' ? 'hidden' : '';
    if (view === 'intro') { const h = $('introTitle'); h.focus({ preventScroll: true }); }
    scrollTo(0, 0);
  }
  const loader = on => { $('loader').hidden = !on; };
  function info(text, kind) {
    const el = $('info'); if (el.textContent !== text) el.textContent = text; el.dataset.k = kind || '';
    if (kind === 'err' || text !== 'Look straight at the camera') say(text);
  }
  const setTarget = v => { pctTarget = Math.max(0, Math.min(100, v)); };
  function uiLoop(my) {          // eases the big percentage (and the ring around the face) up AND down toward the real progress
    cancelAnimationFrame(uiRaf);
    const tick = () => {
      if (my !== runId || phase === 'idle') return;
      const d = pctTarget - pctShown; pctShown += Math.abs(d) < 0.15 ? d : d * (REDUCED ? 1 : 0.14);
      const v = Math.round(pctShown); const pe = $('pct'); if (pe.textContent !== v + '%') pe.textContent = v + '%';
      $('ringFg').style.strokeDashoffset = String(RING * (1 - pctShown / 100));
      if (phase === 'done' && pctShown === pctTarget) return;          // finished easing after the run ended
      uiRaf = requestAnimationFrame(tick);
    };
    uiRaf = requestAnimationFrame(tick);
  }
  function resetPct() { pctTarget = pctShown = 0; $('pct').textContent = '0%'; $('ringFg').style.strokeDashoffset = String(RING); }
  function showIssue(issue) {
    const f = $('face');
    if (!issue) { f.dataset.g = phase === 'task' || phase === 'calibrate' ? 'ok' : 'idle'; return; }
    f.dataset.g = 'warn';
  }

  /* ---------------------------------------------------------------- API (server decides; we only relay evidence) */
  async function api(action, body, tries) {
    if (navigator.onLine === false) throw { code: 'offline' };
    const { data } = await Nova.sb.auth.getSession();
    if (!data.session) throw { code: 'unauthorized' };
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 30000);
    let r;
    try {
      r = await fetch('/api/age-verify', { method: 'POST', credentials: 'omit', cache: 'no-store', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify(Object.assign({ action }, body)) });
    } catch (e) {
      if ((tries || 0) < 1 && action === 'start') { await new Promise(res => setTimeout(res, 700)); return api(action, body, 1); }   // one quiet retry; 'start' is safe to repeat
      throw { code: navigator.onLine === false ? 'offline' : 'network' };
    } finally { clearTimeout(tm); }
    let j = null; try { j = await r.json(); } catch (e) { /* non-JSON */ }
    if (!r.ok || !j || !j.ok) {
      const code = (j && j.error) || (r.status === 404 ? 'not_configured' : 'server_error');
      if ((tries || 0) < 1 && action === 'start' && (code === 'network' || code === 'server_error')) { await new Promise(res => setTimeout(res, 900)); return api(action, body, 1); }
      throw { code };
    }
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
      }
  function stopCamera() {                              // called on every exit path: success, failure, cancel, leaving the page
    cancelAnimationFrame(rafId); rafId = 0;
    if (video.cancelVideoFrameCallback && vfcId) { try { video.cancelVideoFrameCallback(vfcId); } catch (e) { } vfcId = 0; }
    if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } });
    stream = null; track = null; video.srcObject = null;
    octx.clearRect(0, 0, overlay.width, overlay.height); $('face').dataset.scan = 'false';
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
    const my = ++runId; phase = 'boot'; savedFrame = null; session = null; stepIdx = 0; challenge = null; baseline = null; lastIssueCode = ''; lastSaid = '';
    cal = E.createCalibrator(); guidance = E.createGuidance(); signals = E.createSignals();
    closePopup(); resetPct(); showIssue(null); $('face').dataset.g = 'idle'; delete $('face').dataset.task;
    info('Starting camera…'); show('capture'); loader(true); uiLoop(my);
    try {
      if (!supported()) throw { code: 'unsupported' };
      await openCamera(); if (my !== runId) return stopCamera();
      info('Loading face check…'); const lm = await loadLandmarker(); if (my !== runId) return stopCamera();
      for (const f of E.inspectCamera({ label: track.label, settings: track.getSettings(), muted: track.muted, readyState: track.readyState })) signals.flag(f);
      loader(false); phase = 'calibrate'; calStart = performance.now(); $('face').dataset.scan = REDUCED ? 'false' : 'true';
      info('Look straight at the camera'); $('capTitle').focus({ preventScroll: true });
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
    if (DEBUG) debug(f);
    if (phase === 'submit' || phase === 'done') return;

    let issue = E.checkFrame(f, lastPx);
    if (issue && issue.code === 'no_face' && lastPx && lastPx.mean < E.CFG.lumaLow) issue = { code: 'low_light', block: true, text: '' };
    const shown = guidance.update(issue, now); showIssue(shown); lastIssueCode = shown ? shown.code : '';
    const blocked = !!(shown && shown.block);
    const issueText = shown ? (ISSUE[shown.code] || shown.text) : '';

    if (phase === 'calibrate') {
      setTarget(0);
      if (blocked) info(issueText, 'err'); else info('Look straight at the camera');
      if (!blocked && cal.push(f)) {
        if (cal.ready()) { baseline = cal.baseline(); return startSession(my); }
      }
      if (now - calStart > 30000) failRun(lastPx && lastPx.mean < E.CFG.lumaLow ? 'poor_lighting' : f.faceCount > 1 ? 'multiple_faces' : 'face_not_detected');
      return;
    }
    if (phase === 'task' && challenge) {
      const st = challenge.update(f, now, blocked);
      setTarget(stepIdx * 25 + Math.min(1, st.progress) * 24);          // drops back if the person loses the pose or leaves the frame
      if (blocked) info(issueText || 'Hold on — adjust your position', 'err');
      else info(st.hint && st.hint !== challenge.def.text ? st.hint : (SHORT[challenge.id] || challenge.def.text));
      if (st.done) return submitStep(st, now, my);
      if (st.failed) return failStep(st.reason === 'capture_quality' ? (f.faceCount > 1 ? 'multiple_faces' : lastPx && lastPx.mean < E.CFG.lumaLow ? 'poor_lighting' : 'capture_quality') : st.reason === 'timeout' ? 'timeout' : 'challenge_failed');
    }
  }

  async function startSession(my) {
    phase = 'submit'; $('face').dataset.scan = 'false'; loader(true); info('Preparing your check…');
    try {
      const r = await api('start', {}); if (my !== runId) return;
      if (r.already) return success(true);
      session = r; loader(false); $('face').dataset.scan = REDUCED ? 'false' : 'true'; beginStep(r.step);
    } catch (e) { if (my === runId) failRun(e.code || 'server_error'); }
  }

  function beginStep(step) {
    stepIdx = step.index; challenge = E.createChallenge(step.id, baseline); stepStart = performance.now(); phase = 'task'; $('face').dataset.task = step.id;
    setTarget(stepIdx * 25); info('Look straight at the camera');
  }

  async function submitStep(st, now, my) {
    phase = 'submit'; const ev = E.stepEvidence(challenge.id, st, stepStart, now); const idx = stepIdx;
    setTarget((idx + 1) * 25);                                          // this step is verified: 25 / 50 / 75 / 100 %
    try {
      const r = await api('step', { nonce: session.nonce, index: idx, evidence: ev }); if (my !== runId) return;
      if (r.done) return finalize(my);
      session.step = r.step; guidance.reset(); beginStep(r.step);
    } catch (e) { if (my === runId) { setTarget(idx * 25); failRun(e.code || 'server_error', 500); } }
  }
  function failStep(code) { failRun(code, 500); }

  async function finalize(my) {
    info('Verifying your face…');
    savedFrame = grabFrame();                // one still frame, kept in memory only until the server answers
    const summary = signals.summary(); session.signals = summary;
    stopCamera();                            // camera processing ends here, before any network wait
    await sendFinish(my);
  }
  async function sendFinish(my) {
    phase = 'submit'; show('capture'); loader(true); setTarget(100); info('Verifying your face…');
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

  /* ---------------------------------------------------------------- outcomes (shown in a pop-up) */
  function openPopup() { const p = $('popup'); p.hidden = false; $('resTitle').focus({ preventScroll: true }); }
  function closePopup() { $('popup').hidden = true; }
  function result(kind, title, text, note, code) {
    $('resBox').dataset.k = kind; $('resTitle').textContent = title; $('resText').textContent = text || '';
    const n = $('resNote'); n.hidden = !note; n.textContent = note || '';
    const c = $('resCode'); c.hidden = !code; c.textContent = code ? 'Error code: ' + code : '';
    $('resMark').setAttribute('d', kind === 'ok' ? 'M20 33l8 8 17-18' : 'M23 23l18 18M41 23L23 41');
    const els = [document.querySelector('#resBox .icon circle'), $('resMark')];
    for (const el of els) { el.style.animation = 'none'; void el.getBoundingClientRect(); el.style.animation = ''; }
    $('resPrimary').hidden = false; openPopup();
  }
  async function success(already) {
    phase = 'done'; stopCamera(); savedFrame = null; setTarget(100); loader(false); showIssue(null); $('face').dataset.g = 'ok';
    try { Nova.maturityVerified = true; await Nova.set('hideMature', false); } catch (e) { /* settings sync is retried by the profile page */ }
    info('Verified', 'ok'); const my = runId;
    setTimeout(() => {                                                 // let the ring visibly reach 100% first
      if (my !== runId) return;
      result('ok', already ? 'You’re already verified' : 'Verified — you’re 18+', 'Mature content can now be switched on or off in Settings whenever you like. You won’t be asked to verify again.');
      $('resPrimary').textContent = 'Continue'; $('resPrimary').onclick = () => location.href = nextParam; $('resSecondary').hidden = true;
      setTimeout(() => { if (phase === 'done' && !$('popup').hidden && $('resBox').dataset.k === 'ok') location.href = nextParam; }, REDUCED ? 6000 : 3500);
    }, REDUCED ? 0 : 900);
  }
  function failRun(code, delay, canRetryFinish) {
    if (phase === 'done') return;
    const my = runId; phase = canRetryFinish ? 'submit' : 'done'; if (!canRetryFinish) { savedFrame = null; } stopCamera(); loader(false);
    $('face').dataset.g = 'warn'; $('face').dataset.scan = 'false';
    setTimeout(() => {
      if (my !== runId) return;
      const m = OUT[code] || OUT.server_error, retry = RETRYABLE.has(code);
      info(m[0], 'err');
      result('err', m[0], m[1], 'No mature content has been unlocked.', DEBUG || code === 'network' || code === 'not_configured' || code === 'server_error' ? code : '');
      const p = $('resPrimary'); p.hidden = !retry && code !== 'unauthorized';
      if (code === 'unauthorized') { p.textContent = 'Sign in'; p.onclick = () => location.href = 'index.html?next=' + encodeURIComponent('age-verify.html'); }
      else if (canRetryFinish && savedFrame && (code === 'provider_unavailable' || code === 'network' || code === 'invalid_signature' || code === 'offline') && session) { p.textContent = 'Try Again'; p.onclick = () => { closePopup(); const r = ++runId; sendFinish(r); uiLoop(r); }; }
      else { p.textContent = 'Try Again'; p.onclick = () => { savedFrame = null; begin(); }; }
      $('resSecondary').hidden = false; $('resSecondary').onclick = () => location.href = nextParam;
      say(m[0] + '. ' + m[1]);
    }, delay || 0);
  }
  function cancel() { runId++; phase = 'idle'; cancelAnimationFrame(uiRaf); stopCamera(); savedFrame = null; session = null; loader(false); closePopup(); show('intro'); }

  /* ---------------------------------------------------------------- drawing: sparse "face mesh" like a scan animation */
  const MESH = [10, 54, 284, 127, 356, 234, 454, 21, 251, 70, 105, 334, 300, 33, 133, 263, 362, 168, 1, 205, 425, 61, 291, 17, 152, 172, 397, 93, 323];
  function sizeOverlay() {
    const r = overlay.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1), w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    return d;
  }
  function draw(res, f) {
    const d = sizeOverlay(), cw = overlay.width, ch = overlay.height; octx.clearRect(0, 0, cw, ch);
    if (!f.face || !res.faceLandmarks[0]) return;
    const lm = res.faceLandmarks[0], vw = video.videoWidth, vh = video.videoHeight, sc = Math.max(cw / vw, ch / vh), ox = (cw - vw * sc) / 2, oy = (ch - vh * sc) / 2;
    const pts = [];
    for (const i of MESH) { const p = lm[i]; if (p) pts.push([p.x * vw * sc + ox, p.y * vh * sc + oy]); }
    const bad = !!(guidance && guidance.current());
    octx.lineWidth = Math.max(1, 1.1 * d); octx.lineCap = 'round'; octx.strokeStyle = bad ? 'rgba(255,214,211,.75)' : 'rgba(255,255,255,.8)';
    octx.beginPath();                                     // each point joins its 3 nearest neighbours → light triangulated mesh
    for (let i = 0; i < pts.length; i++) {
      const near = pts.map((q, j) => [j, Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1])]).filter(a => a[0] !== i).sort((a, b) => a[1] - b[1]).slice(0, 3);
      for (const [j] of near) { octx.moveTo(pts[i][0], pts[i][1]); octx.lineTo(pts[j][0], pts[j][1]); }
    }
    octx.stroke(); octx.fillStyle = bad ? '#ffd6d3' : '#fff';
    for (const p of pts) { octx.beginPath(); octx.arc(p[0], p[1], 2.6 * d, 0, 6.283); octx.fill(); }
  }
  function debug(f) {
    const d = $('debug'); d.hidden = false;
    d.textContent = ['phase ' + phase, f.face ? 'yaw ' + f.yaw.toFixed(1) + ' pitch ' + f.pitch.toFixed(1) + ' roll ' + f.rollRel.toFixed(1) : 'no face',
      f.face ? 'eyeL ' + f.eyeL.toFixed(2) + ' eyeR ' + f.eyeR.toFixed(2) + ' smile ' + f.smile.toFixed(2) + ' mouth ' + f.mouthOpen.toFixed(2) : '',
      lastPx ? 'luma ' + lastPx.mean.toFixed(0) + ' lap ' + lastPx.lapVar.toFixed(0) : ''].join('\n');
  }

  /* ---------------------------------------------------------------- wiring */
  async function init() {
    $('backLink').href = nextParam;
    if (!window.isSecureContext) {
      const e = $('introError'); e.hidden = false; e.textContent = 'The camera only works on a secure (https) connection. Open Nova using its https address.';
    }
    $('consent').addEventListener('change', e => { $('startBtn').disabled = !e.target.checked || !window.isSecureContext; });
    $('startBtn').addEventListener('click', () => { if ($('consent').checked) begin(); });
    $('cancelBtn').addEventListener('click', cancel);
    // privacy: never keep the camera running in the background or after leaving
    document.addEventListener('visibilitychange', () => { if (document.hidden && stream) { cancel(); const e = $('introError'); e.hidden = false; e.textContent = 'The scan was stopped and your camera switched off because you left this page. Start again when you’re ready.'; } });
    addEventListener('pagehide', () => { runId++; stopCamera(); });
    const user = await Nova.requireAuth(); if (!user) return;
    try { const { data } = await Nova.sb.from('profiles').select('maturity_verified').eq('id', user.id).single(); if (data && data.maturity_verified) { Nova.maturityVerified = true; result('ok', 'You’re already verified', 'Your account is already confirmed as 18+. Switch mature content on or off in Settings — no new check is needed.'); $('resPrimary').textContent = 'Back to settings'; $('resPrimary').onclick = () => location.href = nextParam; $('resSecondary').hidden = true; return; } } catch (e) { /* column may not exist yet; the server will report */ }
  }
  init();
})();
