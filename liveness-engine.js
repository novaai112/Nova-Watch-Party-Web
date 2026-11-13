/* liveness-engine.js — pure logic for the Nova 18+ face-liveness check.
 *
 * No DOM, no camera, no network: it takes face-landmark results (MediaPipe Face Landmarker
 * format: 478 normalised {x,y,z} points + 52 blendshape scores) and decides
 *   - is the capture usable (one face, framed, lit, sharp)?
 *   - did the requested facial movement really happen (blink, wink, head turn, smile …)?
 *   - are there simple presentation-attack warning signs (frozen stream, virtual camera …)?
 *
 * The same file runs in the browser (window.NovaLiveness) and on the server (require()),
 * so the challenge catalogue and the sequence generator can never drift apart.
 *
 * IMPORTANT — what this is NOT: this is movement analysis, not an ISO/IEC 30107-3 evaluated
 * presentation-attack-detection (PAD) product, and nothing computed in a browser can prove that
 * the video stream is not injected or deep-faked. It does not identify anybody or read emotion.
 * See README → "18+ age assurance" for what a production deployment must add (a certified provider).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NovaLiveness = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ configuration */
  const CFG = {
    tasks: 4,                 // how many random challenges one verification asks for
    calibrateFrames: 24,      // neutral frames needed to learn the user's baseline
    gateMs: 350,              // neutral hold before every challenge starts (stops carry-over)
    gateCapMs: 9000,          // max time to reach the neutral pose before a challenge starts
    maxBlockedMs: 9000,       // total time a challenge may be paused by capture-quality problems
    // eyes (closure 0 = open … 1 = closed)
    closeThr: 0.55, openThr: 0.35, winkGap: 0.3,
    blinkMinMs: 30, blinkMaxMs: 900, closeHoldMinMs: 450, closeHoldMaxMs: 4500,
    doubleBlinkWindowMs: 3200, doubleBlinkGapMs: 80,
    // head (degrees, relative to the user's own calibrated front pose)
    turnDeg: 18, pitchDeg: 11, tiltDeg: 14, poseHoldMs: 250, returnTolDeg: 7, returnHoldMs: 350,
    // mouth
    smileOn: 0.5, smileOff: 0.22, mouthOpenOn: 0.4, mouthOpenOff: 0.15, expressHoldMs: 280, expressReturnMs: 320,
    // geometric model constants for turning landmark ratios into approximate degrees
    noseProtrusion: 0.35, noseDrop: 0.30,
    // framing / capture quality
    fillMin: 0.30, fillMax: 0.80, centerTol: 0.17, edgeMargin: 0.012,
    lumaLow: 62, lumaHigh: 205, clipHighMax: 0.22, blurLapMin: 28,
    // guidance debounce
    issueOnMs: 450, issueOffMs: 250
  };

  /* ------------------------------------------------------------------ challenge catalogue
   * family: eyes | head | mouth
   * limitMs: time allowed for the action itself (configurable); minMs: fastest plausible human completion
   * (used by the server to reject instantly-"completed" scripted submissions). */
  const CATALOG = {
    blink_both:  { family: 'eyes',  label: 'Blink',          text: 'Blink both eyes once',                 follow: 'Good — keep looking at the camera', limitMs: 12000, minMs: 150 },
    blink_twice: { family: 'eyes',  label: 'Blink twice',    text: 'Blink both eyes twice',                follow: 'Good — keep looking at the camera', limitMs: 14000, minMs: 380 },
    close_reopen:{ family: 'eyes',  label: 'Close & open',   text: 'Close both eyes for a moment, then open them', follow: 'Open your eyes', limitMs: 14000, minMs: 600 },
    wink_left:   { family: 'eyes',  label: 'Wink left',      text: 'Wink with your LEFT eye',              follow: 'Open both eyes', limitMs: 14000, minMs: 250 },
    wink_right:  { family: 'eyes',  label: 'Wink right',     text: 'Wink with your RIGHT eye',             follow: 'Open both eyes', limitMs: 14000, minMs: 250 },
    turn_left:   { family: 'head',  label: 'Turn left',      text: 'Turn your head to the LEFT',           follow: 'Now face the camera again', limitMs: 14000, minMs: 500 },
    turn_right:  { family: 'head',  label: 'Turn right',     text: 'Turn your head to the RIGHT',          follow: 'Now face the camera again', limitMs: 14000, minMs: 500 },
    look_up:     { family: 'head',  label: 'Look up',        text: 'Look UP (raise your chin)',            follow: 'Now face the camera again', limitMs: 14000, minMs: 500 },
    look_down:   { family: 'head',  label: 'Look down',      text: 'Look DOWN (lower your chin)',          follow: 'Now face the camera again', limitMs: 14000, minMs: 500 },
    tilt_left:   { family: 'head',  label: 'Tilt left',      text: 'Tilt your head to your LEFT shoulder', follow: 'Now straighten your head', limitMs: 14000, minMs: 500 },
    tilt_right:  { family: 'head',  label: 'Tilt right',     text: 'Tilt your head to your RIGHT shoulder',follow: 'Now straighten your head', limitMs: 14000, minMs: 500 },
    smile:       { family: 'mouth', label: 'Smile',          text: 'Smile naturally',                      follow: 'Relax to a neutral face', limitMs: 12000, minMs: 450 },
    open_mouth:  { family: 'mouth', label: 'Open mouth',     text: 'Open your mouth',                      follow: 'Close your mouth', limitMs: 12000, minMs: 450 }
  };
  const IDS = Object.keys(CATALOG);

  /* Random, per-session sequence. `rng` must return [0,1) — the server passes a CSPRNG-backed one.
   * Rules: n distinct challenges, at least one eye challenge, at least two families, and never two
   * challenges of the same family back-to-back (so the order is hard to predict and not repetitive). */
  function pickSequence(rng, n, avoidKey) {
    n = n || CFG.tasks;
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    let best = null;
    for (let attempt = 0; attempt < 200; attempt++) {
      const s = shuffle(IDS).slice(0, n), fam = s.map(i => CATALOG[i].family);
      const okFam = new Set(fam).size >= 2 && fam.includes('eyes');
      const okAdj = fam.every((f, i) => i === 0 || f !== fam[i - 1]);
      if (okFam && okAdj) { best = s; if (!avoidKey || s.join() !== avoidKey) break; }
    }
    return best || shuffle(IDS).slice(0, n);
  }

  /* ------------------------------------------------------------------ geometry helpers */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const DEG = 180 / Math.PI;

  // MediaPipe face-mesh landmark indices (subject's own left/right).
  const L = {
    nose: 1, forehead: 10, chin: 152, cheekR: 234, cheekL: 454,
    eyeR: { out: 33, inn: 133, u1: 160, u2: 158, l1: 144, l2: 153, up: 159, lo: 145 },
    eyeL: { out: 263, inn: 362, u1: 385, u2: 387, l1: 380, l2: 373, up: 386, lo: 374 },
    mouth: { cl: 61, cr: 291, ui: 13, li: 14, uo: 0, lo: 17 },
    browR: [70, 63, 105, 66, 107], browL: [336, 296, 334, 293, 300]
  };
  const REGION_POINTS = [].concat([1, 10, 152, 234, 454], Object.values(L.eyeR), Object.values(L.eyeL), Object.values(L.mouth), L.browR, L.browL);

  function earOf(P, e) {          // eye aspect ratio from 6 landmarks
    const w = dist(P[e.out], P[e.inn]) || 1e-6;
    return (dist(P[e.u1], P[e.l1]) + dist(P[e.u2], P[e.l2])) / (2 * w);
  }

  /* Turn one detector result into compact, identity-free features.
   *  res   : { faceLandmarks:[[{x,y,z}…]], faceBlendshapes:[{categories:[{categoryName,score}]}] }
   *  frame : { w, h }  (video pixel size, so distances are not distorted by the aspect ratio)
   * Returns null-face features when nothing usable is found. */
  function extractFeatures(res, frame, t) {
    const faces = (res && res.faceLandmarks) || [];
    const f = { t: t || 0, faceCount: faces.length, face: false };
    if (!faces.length) return f;
    const lm = faces[0], W = frame.w || 1, H = frame.h || 1;
    const P = new Proxy(lm, { get: (a, i) => { const p = a[i]; return p ? { x: p.x * W, y: p.y * H } : undefined; } });
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (let i = 0; i < lm.length; i++) { const p = lm[i]; if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    f.face = true; f.bbox = { x0: minX, y0: minY, x1: maxX, y1: maxY };
    f.fill = Math.max(maxY - minY, maxX - minX);                    // how much of the frame the face fills
    f.cx = (minX + maxX) / 2; f.cy = (minY + maxY) / 2;
    f.inFrame = minX > CFG.edgeMargin && minY > CFG.edgeMargin && maxX < 1 - CFG.edgeMargin && maxY < 1 - CFG.edgeMargin;
    f.regionsInFrame = REGION_POINTS.every(i => lm[i] && lm[i].x > 0 && lm[i].x < 1 && lm[i].y > 0 && lm[i].y < 1);

    const faceW = dist(P[L.cheekR], P[L.cheekL]) || 1e-6;
    const eyeMid = { x: (P[L.eyeR.out].x + P[L.eyeL.out].x) / 2, y: (P[L.eyeR.out].y + P[L.eyeL.out].y) / 2 };
    const interOc = dist(P[L.eyeR.out], P[L.eyeL.out]) || 1e-6;

    // head pose (approximate, from landmark geometry; made relative to the user's own baseline later)
    f.rYaw = (P[L.nose].x - P[L.cheekR].x) / (P[L.cheekL].x - P[L.cheekR].x || 1e-6);    // 0.5 ≈ frontal; ↑ = turned to the person's LEFT
    f.rPitch = (P[L.nose].y - eyeMid.y) / ((P[L.chin].y - eyeMid.y) || 1e-6);            // ↓ = chin raised (looking up)
    f.roll = Math.atan2(P[L.eyeL.out].y - P[L.eyeR.out].y, P[L.eyeL.out].x - P[L.eyeR.out].x) * DEG; // + = tilted to the person's left

    // eyes
    f.earR = earOf(P, L.eyeR); f.earL = earOf(P, L.eyeL);
    // mouth
    const mw = dist(P[L.mouth.cl], P[L.mouth.cr]) || 1e-6;
    f.mouthOpenLm = dist(P[L.mouth.ui], P[L.mouth.li]) / mw;
    f.mouthRatio = mw / faceW;                                      // width relative to face (rises when smiling)
    f.eyeRatio = interOc / faceW;
    // brows (distance brow→lid, normalised) — used for the landmark overlay and plausibility only
    f.browR = dist(P[L.browR[2]], P[L.eyeR.up]) / faceW; f.browL = dist(P[L.browL[2]], P[L.eyeL.up]) / faceW;
    // plausible anatomy (catches hands/masks/objects wrecking the mesh)
    f.anatomyOk = f.mouthRatio > 0.26 && f.mouthRatio < 0.7 && f.eyeRatio > 0.3 && f.eyeRatio < 0.8;

    // blendshapes (0..1). eyeBlinkLeft/Right and mouthSmile* are the SUBJECT's own left/right.
    const bs = {};
    const cats = res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories;
    if (cats) for (const c of cats) bs[c.categoryName] = c.score;
    f.hasBlend = !!cats;
    f.blinkL = bs.eyeBlinkLeft, f.blinkR = bs.eyeBlinkRight;
    f.jawOpen = bs.jawOpen;
    f.smileBs = (bs.mouthSmileLeft != null && bs.mouthSmileRight != null) ? (bs.mouthSmileLeft + bs.mouthSmileRight) / 2 : undefined;
    f._lmSubset = null;
    return f;
  }

  /* Combine blendshape and landmark evidence into 0..1 scores, relative to the user's baseline. */
  function derive(f, b) {
    if (!f.face) return f;
    b = b || DEFAULT_BASELINE;
    const earClose = ear => clamp(1 - ear / (b.ear || 0.28), 0, 1);
    const closure = (bs, ear) => bs != null ? clamp(0.7 * bs + 0.3 * earClose(ear), 0, 1) : earClose(ear);
    f.eyeL = closure(f.blinkL, f.earL); f.eyeR = closure(f.blinkR, f.earR);
    f.yaw = Math.atan((f.rYaw - b.rYaw) / CFG.noseProtrusion) * DEG;                       // + = person's left
    f.pitch = Math.asin(clamp(-(f.rPitch - b.rPitch) / CFG.noseDrop, -1, 1)) * DEG;        // + = looking up
    f.rollRel = f.roll - b.roll;                                                           // + = tilt to person's left
    f.mouthOpen = f.jawOpen != null ? clamp(f.jawOpen, 0, 1) : clamp(f.mouthOpenLm / 0.5, 0, 1);
    const smLm = clamp((f.mouthRatio / (b.mouthRatio || 0.4) - 1) / 0.22, 0, 1);
    f.smile = f.smileBs != null ? clamp(0.8 * f.smileBs + 0.2 * smLm, 0, 1) : smLm;
    return f;
  }
  const DEFAULT_BASELINE = { rYaw: 0.5, rPitch: 0.42, roll: 0, ear: 0.28, mouthRatio: 0.4 };

  /* ------------------------------------------------------------------ capture quality / guidance */
  /* Pixel statistics of the face crop (gray, 0..255). Cheap: call every few frames on a ~64×64 crop. */
  function analyzePixels(gray, w, h) {
    const n = w * h; if (!n) return null;
    let sum = 0, hi = 0, lo = 0;
    for (let i = 0; i < n; i++) { const v = gray[i]; sum += v; if (v >= 250) hi++; else if (v <= 5) lo++; }
    const mean = sum / n; let varSum = 0, lapSum = 0, lapSq = 0, lapN = 0;
    for (let i = 0; i < n; i++) { const d = gray[i] - mean; varSum += d * d; }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += l; lapSq += l * l; lapN++;
    }
    const lapVar = lapN ? lapSq / lapN - Math.pow(lapSum / lapN, 2) : 0;
    return { mean, std: Math.sqrt(varSum / n), clipHigh: hi / n, clipLow: lo / n, lapVar };
  }

  /* One-shot "what is wrong right now" check. Priority-ordered; returns {code, text, block} or null.
   * Wording is deliberately about how to fix the capture, never about what the detector measured. */
  function checkFrame(f, px) {
    if (!f || !f.face) return { code: 'no_face', block: true, text: 'We can’t see your face. Look at the camera and move into the oval.' };
    if (f.faceCount > 1) return { code: 'multiple_faces', block: true, text: 'Only one person should be in view. Ask others to step out of the picture.' };
    if (!f.inFrame || !f.regionsInFrame) return { code: 'out_of_frame', block: true, text: 'Your face is partly outside the picture. Move so your whole face is inside the oval.' };
    if (f.fill < CFG.fillMin) return { code: 'too_far', block: true, text: 'Move a little closer to the camera.' };
    if (f.fill > CFG.fillMax) return { code: 'too_close', block: true, text: 'Move back a little from the camera.' };
    if (Math.abs(f.cx - 0.5) > CFG.centerTol || Math.abs(f.cy - 0.5) > CFG.centerTol) return { code: 'off_center', block: true, text: 'Centre your face inside the oval.' };
    if (px) {
      if (px.mean < CFG.lumaLow) return { code: 'low_light', block: true, text: 'It’s too dark. Face a window or turn on a light.' };
      if (px.mean > CFG.lumaHigh || px.clipHigh > CFG.clipHighMax) return { code: 'too_bright', block: true, text: 'Too much light or glare. Avoid a bright light behind or directly on you.' };
      if (px.lapVar < CFG.blurLapMin) return { code: 'blur', block: true, text: 'The picture is blurry. Hold the phone steady and wipe the camera lens.' };
    }
    if (!f.anatomyOk) return { code: 'obstruction', block: true, text: 'Something may be covering your face. Remove masks, hands, hair or glasses glare.' };
    return null;
  }

  /* Debounced wrapper so messages don't flicker frame-to-frame. */
  function createGuidance() {
    let shown = null, cand = null, candSince = 0, clearSince = null;
    return {
      update(issue, t) {
        if (issue) {
          clearSince = null;
          if (shown && shown.code === issue.code) { shown = issue; return shown; }
          if (!cand || cand.code !== issue.code) { cand = issue; candSince = t; }
          if (t - candSince >= CFG.issueOnMs) { shown = issue; cand = null; }
        } else {
          cand = null;
          if (shown) { if (clearSince == null) clearSince = t; if (t - clearSince >= CFG.issueOffMs) { shown = null; clearSince = null; } }
        }
        return shown;
      },
      current: () => shown, reset() { shown = cand = null; clearSince = null; }
    };
  }

  /* ------------------------------------------------------------------ calibration */
  const isNeutralRaw = f => f.face && f.faceCount === 1 && f.eyeL < 0.35 && f.eyeR < 0.35 && f.mouthOpen < 0.2 && f.smile < 0.3;
  function createCalibrator() {
    const acc = { rYaw: [], rPitch: [], roll: [], ear: [], mouthRatio: [] };
    let n = 0;
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return {
      /* Feed raw features (before derive). Only near-frontal, eyes-open, relaxed frames count. */
      push(f) {
        if (!f.face || f.faceCount !== 1) return false;
        const eyesOpen = !(f.blinkL > 0.35 || f.blinkR > 0.35), jaw = (f.jawOpen || 0) < 0.2, sm = (f.smileBs || 0) < 0.3;
        const frontal = Math.abs(f.rYaw - 0.5) < 0.1 && Math.abs(f.roll) < 12;
        if (!(eyesOpen && jaw && sm && frontal)) return false;
        acc.rYaw.push(f.rYaw); acc.rPitch.push(f.rPitch); acc.roll.push(f.roll);
        acc.ear.push((f.earL + f.earR) / 2); acc.mouthRatio.push(f.mouthRatio); n++; return true;
      },
      count: () => n, ready: () => n >= CFG.calibrateFrames, reset() { for (const k in acc) acc[k] = []; n = 0; },
      baseline: () => ({ rYaw: med(acc.rYaw), rPitch: med(acc.rPitch), roll: med(acc.roll), ear: med(acc.ear), mouthRatio: med(acc.mouthRatio) })
    };
  }

  /* ------------------------------------------------------------------ challenge runner */
  function holder() {
    let since = null;
    return { tick(cond, t) { if (!cond) { since = null; return 0; } if (since == null) since = t; return t - since; }, reset() { since = null; } };
  }
  function blinkTracker() {
    let closed = false, start = 0, peak = 0, last = null;
    return {
      update(cl, cr, t) {
        const both = Math.min(cl, cr); let ev = null;
        if (!closed) { if (both >= CFG.closeThr) { closed = true; start = t; peak = both; } }
        else { peak = Math.max(peak, both); if (both <= CFG.openThr) { closed = false; ev = { start, end: t, dur: t - start, peak }; last = ev; } }
        return ev;
      },
      isClosed: () => closed, closedFor: t => closed ? t - start : 0, last: () => last
    };
  }

  /* createChallenge(id, baseline) → { update(features, t) → status }
   * status = { phase:'gate'|'action'|'return'|'done'|'failed', progress 0..1, hint, blocked, done, failed, reason, metrics } */
  function createChallenge(id, baseline, over) {
    const def = CATALOG[id]; if (!def) throw new Error('unknown challenge');
    const cfg = Object.assign({}, CFG, over || {});
    const limit = cfg.limitMs || def.limitMs;
    const S = { phase: 'gate', t0: null, last: null, blocked: 0, actionAt: null, blockedAtAction: 0, hint: '', frames: 0, peak: 0, returnAt: null };
    const gateH = holder(), actH = holder(), retH = holder(), bt = blinkTracker();
    const blinks = []; let oneEyeSince = null, gateBlocked0 = 0;
    const M = { actionMs: 0, returnMs: 0, peak: 0, blinks: 0, blinkDurs: [], frames: 0, ambiguous: 0 };
    const left = () => S.actionAt == null ? limit : Math.max(0, Math.round(limit - ((S.last - S.actionAt) - (S.blocked - S.blockedAtAction))));
    const out = (extra) => Object.assign({ phase: S.phase, progress: 0, hint: S.hint, blocked: false, done: false, failed: false, metrics: M, limitMs: limit, leftMs: left() }, extra);
    const fail = (reason) => { S.phase = 'failed'; S.reason = reason; return out({ failed: true, reason, progress: 0 }); };

    function neutral(f) {
      return Math.abs(f.yaw) < 8 && Math.abs(f.pitch) < 7 && Math.abs(f.rollRel) < 8 &&
             f.eyeL < 0.35 && f.eyeR < 0.35 && f.mouthOpen < 0.2 && f.smile < 0.3;
    }

    return {
      id, def,
      update(f0, t, blocked) {
        if (S.phase === 'done' || S.phase === 'failed') return out({ done: S.phase === 'done', failed: S.phase === 'failed', reason: S.reason, progress: S.phase === 'done' ? 1 : 0 });
        const f = derive(f0, baseline);
        if (S.t0 == null) { S.t0 = t; S.last = t; }
        const dt = Math.max(0, Math.min(250, t - S.last)); S.last = t;
        if (blocked || !f.face || f.faceCount !== 1) {       // capture problem: pause the clock (up to a cap)
          S.blocked += dt;
          gateH.reset(); actH.reset(); retH.reset();
          if (S.blocked > cfg.maxBlockedMs) return fail('capture_quality');
          return out({ blocked: true, progress: S.phase === 'return' ? 0.5 : 0 });
        }
        S.frames++; M.frames = S.frames;
        const elapsedActive = () => t - S.actionAt - (S.blocked - S.blockedAtAction);

        /* ---------- gate: be neutral & still before the challenge clock starts */
        if (S.phase === 'gate') {
          S.hint = 'Look straight at the camera';
          if (gateH.tick(neutral(f), t) >= cfg.gateMs) { S.phase = 'action'; S.actionAt = t; S.blockedAtAction = S.blocked; S.hint = def.text; }
          else if (t - S.t0 - S.blocked > cfg.gateCapMs) return fail('timeout');
          return out({ progress: 0 });
        }

        /* ---------- timeout (action + return share one budget) */
        if (elapsedActive() > limit) return fail('timeout');

        const act = def.family;
        let p = 0;                       // 0..1 within the current phase

        if (id === 'blink_both' || id === 'blink_twice') {
          const need = id === 'blink_twice' ? 2 : 1;
          const ev = bt.update(f.eyeL, f.eyeR, t);
          if (ev) {
            if (ev.dur >= cfg.blinkMinMs && ev.dur <= cfg.blinkMaxMs) {
              const prev = blinks[blinks.length - 1];
              if (prev && (ev.start - prev.end > cfg.doubleBlinkWindowMs)) blinks.length = 0;      // too slow → start over
              if (prev && blinks.length && ev.start - prev.end < cfg.doubleBlinkGapMs) { /* same blink bouncing */ }
              else { blinks.push(ev); M.blinks = blinks.length; M.blinkDurs.push(Math.round(ev.dur)); M.peak = Math.max(M.peak, ev.peak); S.hint = blinks.length < need ? 'Great — once more' : def.follow; }
            } else { M.ambiguous++; S.hint = 'Blink quickly, like normal'; }
          }
          // one eye only → ambiguous
          const one = (f.eyeL >= cfg.closeThr) !== (f.eyeR >= cfg.closeThr);
          if (one) { if (oneEyeSince == null) oneEyeSince = t; if (t - oneEyeSince > 400) S.hint = 'Blink BOTH eyes together'; } else oneEyeSince = null;
          if (blinks.length >= need) { if (!(f.eyeL < cfg.openThr && f.eyeR < cfg.openThr) && bt.isClosed()) return out({ progress: 0.9 }); return finish(t); }
          return out({ progress: (blinks.length + (bt.isClosed() ? 0.5 : 0)) / need * 0.95 });
        }

        if (id === 'close_reopen') {
          const ev = bt.update(f.eyeL, f.eyeR, t);
          if (bt.isClosed()) { const c = bt.closedFor(t); p = clamp(c / cfg.closeHoldMinMs, 0, 1); M.peak = Math.max(M.peak, Math.min(f.eyeL, f.eyeR)); S.hint = c < cfg.closeHoldMinMs ? 'Keep your eyes closed…' : 'Now open your eyes'; if (c > cfg.closeHoldMaxMs) return fail('timeout'); }
          if (ev) {
            if (ev.dur >= cfg.closeHoldMinMs && ev.dur <= cfg.closeHoldMaxMs) { M.blinks = 1; M.blinkDurs.push(Math.round(ev.dur)); return finish(t); }
            S.hint = 'Close your eyes a little longer, then open them'; M.ambiguous++;
          }
          return out({ progress: p * 0.9 });
        }

        if (id === 'wink_left' || id === 'wink_right') {
          const tgt = id === 'wink_left' ? f.eyeL : f.eyeR, oth = id === 'wink_left' ? f.eyeR : f.eyeL;
          const winking = tgt >= 0.5 && tgt - oth >= cfg.winkGap && oth < cfg.closeThr;
          const held = actH.tick(winking, t);
          if (tgt >= cfg.closeThr && oth >= cfg.closeThr) { S.hint = 'Close ONLY your ' + (id === 'wink_left' ? 'left' : 'right') + ' eye'; M.ambiguous++; }
          else if (!S.winked && (id === 'wink_left' ? f.eyeR : f.eyeL) >= cfg.closeThr && tgt < cfg.openThr) S.hint = 'Wrong eye — wink your ' + (id === 'wink_left' ? 'LEFT' : 'RIGHT') + ' eye';
          M.peak = Math.max(M.peak, winking ? tgt : 0);
          if (!S.winked && held >= 90) { S.winked = true; S.hint = def.follow; }
          if (S.winked) { if (tgt < cfg.openThr && oth < cfg.openThr) { if (retH.tick(true, t) >= 120) return finish(t); } else retH.reset(); return out({ progress: 0.6 }); }
          return out({ progress: clamp(tgt / 0.5, 0, 1) * 0.5 });
        }

        if (act === 'head') {
          let v, thr, sign = 1, others;
          if (id === 'turn_left')  { v = f.yaw; thr = cfg.turnDeg; others = [f.pitch, f.rollRel]; }
          if (id === 'turn_right') { v = -f.yaw; thr = cfg.turnDeg; others = [f.pitch, f.rollRel]; }
          if (id === 'look_up')    { v = f.pitch; thr = cfg.pitchDeg; others = [f.yaw, f.rollRel]; }
          if (id === 'look_down')  { v = -f.pitch; thr = cfg.pitchDeg; others = [f.yaw, f.rollRel]; }
          if (id === 'tilt_left')  { v = f.rollRel; thr = cfg.tiltDeg; others = [f.yaw, f.pitch]; }
          if (id === 'tilt_right') { v = -f.rollRel; thr = cfg.tiltDeg; others = [f.yaw, f.pitch]; }
          M.peak = Math.max(M.peak, v);
          if (S.phase === 'action') {
            p = clamp(v / thr, 0, 1);
            if (v < -thr * 0.6) S.hint = 'Other way — ' + def.text.toLowerCase();
            else if (v >= thr * 0.5 && v < thr) S.hint = 'A little more';
            else if (v < thr * 0.5) S.hint = def.text;
            if (actH.tick(v >= thr, t) >= cfg.poseHoldMs) { S.phase = 'return'; M.actionMs = Math.round(t - S.actionAt); S.returnAt = t; S.hint = def.follow; }
            return out({ progress: p * 0.5 });
          }
          // return phase: back to the user's own front pose
          const away = Math.max(Math.abs(f.yaw), Math.abs(f.pitch) * 1.3, Math.abs(f.rollRel));
          p = clamp(1 - away / Math.max(thr, 1), 0, 1);
          if (retH.tick(away <= cfg.returnTolDeg, t) >= cfg.returnHoldMs) { M.returnMs = Math.round(t - S.returnAt); return finish(t); }
          return out({ progress: 0.5 + p * 0.45 });
        }

        if (id === 'smile' || id === 'open_mouth') {
          const sm = id === 'smile', val = sm ? f.smile : f.mouthOpen, on = sm ? cfg.smileOn : cfg.mouthOpenOn, off = sm ? cfg.smileOff : cfg.mouthOpenOff;
          M.peak = Math.max(M.peak, val);
          if (S.phase === 'action') {
            if (val < on * 0.6) S.hint = def.text; else if (val < on) S.hint = sm ? 'A bigger smile' : 'Open a little wider';
            if (actH.tick(val >= on, t) >= cfg.expressHoldMs) { S.phase = 'return'; M.actionMs = Math.round(t - S.actionAt); S.returnAt = t; S.hint = def.follow; }
            return out({ progress: clamp(val / on, 0, 1) * 0.5 });
          }
          if (retH.tick(val <= off, t) >= cfg.expressReturnMs) { M.returnMs = Math.round(t - S.returnAt); return finish(t); }
          return out({ progress: 0.5 + clamp(1 - (val - off) / Math.max(on - off, 0.01), 0, 1) * 0.45 });
        }
        return fail('unsupported');

        function finish(tt) { S.phase = 'done'; M.actionMs = M.actionMs || Math.round(tt - S.actionAt); M.totalMs = Math.round(tt - S.actionAt); return out({ done: true, progress: 1, phase: 'done' }); }
      }
    };
  }

  /* ------------------------------------------------------------------ passive / environment signals
   * These are weak, honest heuristics that feed a risk score. They do NOT certify liveness. */
  const VIRTUAL_CAM = /obs|virtual|manycam|xsplit|snap camera|droidcam|iriun|epoccam|camo|vcam|splitcam|webcamoid|e2esoft|youcam|chromacam|nvidia broadcast|streamlabs|mmhmm/i;

  function inspectCamera(info) {
    const flags = []; info = info || {};
    if (VIRTUAL_CAM.test(info.label || '')) flags.push('virtual_camera_label');
    const s = info.settings || {};
    if (s.width && s.height && (s.width < 240 || s.height < 240)) flags.push('tiny_resolution');
    if (info.muted) flags.push('track_muted');
    if (info.readyState && info.readyState !== 'live') flags.push('track_not_live');
    return flags;
  }

  function createSignals() {
    let n = 0, lastT = null, dts = [], motionSum = 0, motionN = 0, multi = 0, noFace = 0, prev = null;
    const flags = new Set(), luma = [], sharp = [];
    const SUB = [1, 33, 133, 263, 362, 61, 291, 152, 10, 234, 454, 105, 334];
    return {
      push(f, rawLm, frame, t) {
        n++;
        if (lastT != null) { const d = t - lastT; if (d > 0 && d < 1000) dts.push(d); }
        lastT = t;
        if (!f.face) { noFace++; prev = null; return; }
        if (f.faceCount > 1) multi++;
        if (rawLm) {             // non-rigid micro-motion: landmark displacement after removing translation & scale
          const W = frame.w, H = frame.h, cur = SUB.map(i => [rawLm[i].x * W, rawLm[i].y * H]);
          const cx = cur.reduce((a, p) => a + p[0], 0) / cur.length, cy = cur.reduce((a, p) => a + p[1], 0) / cur.length;
          const sc = Math.hypot(cur[10][0] - cur[9][0], cur[10][1] - cur[9][1]) || 1;
          const norm = cur.map(p => [(p[0] - cx) / sc, (p[1] - cy) / sc]);
          if (prev) { let d = 0; for (let i = 0; i < norm.length; i++) d += Math.hypot(norm[i][0] - prev[i][0], norm[i][1] - prev[i][1]); motionSum += d / norm.length; motionN++; }
          prev = norm;
        }
      },
      pixels(px) { if (px) { luma.push(px.mean); sharp.push(px.lapVar); } },
      flag(c) { flags.add(c); },
      summary() {
        const mean = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
        const sd = dts.length ? Math.sqrt(dts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / dts.length) : 0;
        const motion = motionN ? motionSum / motionN : 0;
        const out = new Set(flags);
        if (n > 60 && motionN > 40 && motion < 1e-5) out.add('frozen_or_still_image');   // landmarks essentially never move
        if (dts.length > 60 && sd / (mean || 1) < 0.01) out.add('perfectly_regular_frames'); // synthetic cadence
        if (mean && 1000 / mean < 8) out.add('low_frame_rate');
        const m = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return { frames: n, fps: mean ? +(1000 / mean).toFixed(1) : 0, frameJitter: +(sd / (mean || 1)).toFixed(3), motion: +motion.toFixed(6),
                 multiFaceFrames: multi, noFaceFrames: noFace, luma: Math.round(m(luma)), sharp: Math.round(m(sharp)), flags: Array.from(out) };
      }
    };
  }

  /* Reduce a finished step to the few numbers the server needs (no images, no landmarks). */
  function stepEvidence(id, status, startedAt, endedAt) {
    const m = status.metrics || {};
    return { id, ok: !!status.done, reason: status.reason || null, ms: Math.round(endedAt - startedAt), actionMs: m.actionMs || 0, returnMs: m.returnMs || 0,
             peak: +(m.peak || 0).toFixed(2), blinks: m.blinks || 0, blinkDurs: (m.blinkDurs || []).slice(0, 4), ambiguous: m.ambiguous || 0, frames: m.frames || 0 };
  }

  return { CFG, CATALOG, IDS, pickSequence, extractFeatures, derive, analyzePixels, checkFrame, createGuidance, createCalibrator,
           createChallenge, createSignals, inspectCamera, stepEvidence, isNeutralRaw, DEFAULT_BASELINE, REGION_POINTS, L };
});
