/* Synthetic-face tests for liveness-engine.js. Run: node tests/liveness-engine.test.js
 * A simple 3-D face model is rotated/projected into MediaPipe-style landmarks so the detectors
 * are exercised end-to-end (geometry → features → challenge state machines). */
const assert = require('assert');
const E = require('../liveness-engine.js');
const W = 640, H = 480;

const { face } = require('./synthetic-face.js');
const { L } = E;
const feat = (p, t) => E.extractFeatures(face(p), { w: W, h: H }, t);

// ---- calibrate on a neutral face
function calibrated(jitter = 0) {
  const c = E.createCalibrator();
  for (let i = 0; i < 40; i++) c.push(feat({ yaw: Math.sin(i) * jitter }, i * 33));
  assert(c.ready(), 'calibrator ready');
  return c.baseline();
}
const base = calibrated(0.5);

// drive a challenge with a script: array of [durationMs, poseOrFn]
function run(id, script, opts = {}) {
  const ch = E.createChallenge(id, base, opts.cfg); let t = 10000, st = null, log = [];
  for (const [dur, pose] of script) {
    const end = t + dur;
    for (; t < end; t += 33) { st = ch.update(feat(typeof pose === 'function' ? pose(t - (end - dur)) : pose, t), t, false); if (st.done || st.failed) return st; }
  }
  return st;
}
const N = {};                                  // neutral
const holdThen = (pose) => [[600, N], [700, pose], [900, N], [600, N]];
let pass = 0; const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; } };

console.log('geometry');
ok('neutral face reads ~0 pose', () => { const f = E.derive(feat({}, 0), base); assert(Math.abs(f.yaw) < 3 && Math.abs(f.pitch) < 3 && Math.abs(f.rollRel) < 2, JSON.stringify([f.yaw, f.pitch, f.rollRel])); });
ok('yaw sign: +yaw = subject left', () => { assert(E.derive(feat({ yaw: 30 }, 0), base).yaw > 12); assert(E.derive(feat({ yaw: -30 }, 0), base).yaw < -12); });
ok('pitch sign: +pitch = up', () => { assert(E.derive(feat({ pitch: 20 }, 0), base).pitch > 5); assert(E.derive(feat({ pitch: -20 }, 0), base).pitch < -5); });
ok('roll sign: +roll = tilt left', () => { assert(E.derive(feat({ roll: 20 }, 0), base).rollRel > 15); });
ok('eyes: closure + EAR agree', () => { const f = E.derive(feat({ eyeL: 1, eyeR: 0 }, 0), base); assert(f.eyeL > 0.8 && f.eyeR < 0.2, f.eyeL + ' ' + f.eyeR); });

console.log('challenges — correct action passes');
ok('blink_both', () => assert(run('blink_both', [[600, N], [200, { eyeL: 1, eyeR: 1 }], [900, N]]).done));
ok('blink_twice', () => assert(run('blink_twice', [[600, N], [150, { eyeL: 1, eyeR: 1 }], [250, N], [150, { eyeL: 1, eyeR: 1 }], [600, N]]).done));
ok('blink_twice: one blink is not enough', () => assert(!run('blink_twice', [[600, N], [150, { eyeL: 1, eyeR: 1 }], [20000, N]]).done));
ok('close_reopen', () => assert(run('close_reopen', [[600, N], [900, { eyeL: 1, eyeR: 1 }], [700, N]]).done));
ok('close_reopen: quick blink does not count', () => assert(!run('close_reopen', [[600, N], [150, { eyeL: 1, eyeR: 1 }], [20000, N]]).done));
ok('wink_left', () => assert(run('wink_left', [[600, N], [450, { eyeL: 1 }], [600, N]]).done));
ok('wink_right', () => assert(run('wink_right', [[600, N], [450, { eyeR: 1 }], [600, N]]).done));
ok('wink_left rejects right-eye wink', () => assert(!run('wink_left', [[600, N], [450, { eyeR: 1 }], [20000, N]]).done));
ok('wink_left rejects both-eyes blink (ambiguous → hint, no pass)', () => { const s = run('wink_left', [[600, N], [450, { eyeL: 1, eyeR: 1 }], [500, N], [450, { eyeL: 1, eyeR: 1 }], [20000, N]]); assert(!s.done); });
ok('turn_left', () => assert(run('turn_left', holdThen({ yaw: 30 })).done));
ok('turn_right', () => assert(run('turn_right', holdThen({ yaw: -30 })).done));
ok('turn_left rejects turning right', () => assert(!run('turn_left', holdThen({ yaw: -30 }).concat([[20000, N]])).done));
ok('look_up', () => assert(run('look_up', holdThen({ pitch: 22 })).done));
ok('look_down', () => assert(run('look_down', holdThen({ pitch: -22 })).done));
ok('tilt_left', () => assert(run('tilt_left', holdThen({ roll: 22 })).done));
ok('tilt_right', () => assert(run('tilt_right', holdThen({ roll: -22 })).done));
ok('smile → neutral', () => assert(run('smile', holdThen({ smile: 0.9 })).done));
ok('open_mouth → close', () => assert(run('open_mouth', holdThen({ mouth: 0.8 })).done));
console.log('challenges — incomplete / static / ambiguous');
ok('head turn without return is not complete', () => { const s = run('turn_left', [[600, N], [900, { yaw: 30 }], [3000, { yaw: 30 }]]); assert(!s.done && s.phase === 'return', s.phase); });
ok('partial turn (8°) gives hint, no pass', () => { const s = run('turn_left', [[600, N], [3000, { yaw: 9 }]]); assert(!s.done); });
ok('static photo (never moves) times out', () => { const s = run('blink_both', [[30000, N]]); assert(s.failed && s.reason === 'timeout', JSON.stringify(s)); });
ok('static photo with eyes closed forever never "reopens"', () => assert(!run('blink_both', [[600, N], [30000, { eyeL: 1, eyeR: 1 }]]).done));
ok('time limit is configurable', () => { const s = run('turn_left', [[600, N], [4000, N]], { cfg: { limitMs: 1500 } }); assert(s.failed && s.reason === 'timeout'); });
ok('no carry-over: starts only after neutral gate', () => { const s = run('smile', [[2500, { smile: 0.9 }]]); assert(!s.done && s.phase === 'gate', s.phase); });
ok('multiple faces pause the clock, then fail past the cap', () => {
  const ch = E.createChallenge('smile', base); let t = 0, st;
  for (; t < 12000; t += 33) st = ch.update(feat({ two: true }, t), t, true);
  assert(st.failed && st.reason === 'capture_quality');
});
ok('brief face loss does not fail a challenge', () => {
  const ch = E.createChallenge('turn_left', base); let t = 0, st;
  const seq = [[600, N], [800, { none: true }], [600, N], [700, { yaw: 30 }], [900, N], [600, N]];
  for (const [d, p] of seq) { const e = t + d; for (; t < e; t += 33) { st = ch.update(feat(p, t), t, !!p.none); if (st.done) break; } if (st.done) break; }
  assert(st.done);
});

console.log('sequence generator');
ok('4 distinct ids, ≥1 eyes, ≥2 families, no adjacent family', () => {
  for (let i = 0; i < 500; i++) {
    const s = E.pickSequence(Math.random, 4), f = s.map(x => E.CATALOG[x].family);
    assert.strictEqual(new Set(s).size, 4); assert(f.includes('eyes')); assert(new Set(f).size >= 2);
    f.forEach((x, k) => k && assert.notStrictEqual(x, f[k - 1]));
  }
});
ok('sequences vary (not predictable)', () => { const set = new Set(); for (let i = 0; i < 200; i++) set.add(E.pickSequence(Math.random, 4).join()); assert(set.size > 100, 'only ' + set.size); });
ok('avoidKey avoids repeating the previous sequence', () => { const prev = E.pickSequence(Math.random, 4).join(); for (let i = 0; i < 300; i++) assert.notStrictEqual(E.pickSequence(Math.random, 4, prev).join(), prev); });

console.log('capture-quality guidance');
const px = (v, noise = 40) => { const g = new Uint8Array(64 * 64); for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, v + ((i * 2654435761 >>> 0) % (noise * 2)) - noise)); return E.analyzePixels(g, 64, 64); };
ok('good capture → no issue', () => assert.strictEqual(E.checkFrame(E.derive(feat({}, 0), base), px(120)), null));
ok('no face', () => assert.strictEqual(E.checkFrame(feat({ none: true }, 0), px(120)).code, 'no_face'));
ok('multiple faces', () => assert.strictEqual(E.checkFrame(feat({ two: true }, 0), px(120)).code, 'multiple_faces'));
ok('low light', () => assert.strictEqual(E.checkFrame(E.derive(feat({}, 0), base), px(25, 8)).code, 'low_light'));
ok('too bright', () => assert.strictEqual(E.checkFrame(E.derive(feat({}, 0), base), px(235, 20)).code, 'too_bright'));
ok('blur', () => assert.strictEqual(E.checkFrame(E.derive(feat({}, 0), base), px(120, 1)).code, 'blur'));
ok('guidance is debounced', () => { const g = E.createGuidance(); const iss = { code: 'x', text: 'x', block: true }; assert.strictEqual(g.update(iss, 0), null); assert.strictEqual(g.update(iss, 200), null); assert(g.update(iss, 600)); assert(g.update(null, 700)); assert.strictEqual(g.update(null, 1000), null); });
ok('virtual camera labels flagged', () => { assert(E.inspectCamera({ label: 'OBS Virtual Camera' }).includes('virtual_camera_label')); assert(!E.inspectCamera({ label: 'FaceTime HD Camera' }).length); });
ok('frozen stream flagged', () => { const s = E.createSignals(); for (let i = 0; i < 200; i++) { const r = face({}); s.push(feat({}, i * 33), r.faceLandmarks[0], { w: W, h: H }, i * 33); } assert(s.summary().flags.includes('frozen_or_still_image')); assert(s.summary().flags.includes('perfectly_regular_frames')); });
ok('live-ish stream not flagged as frozen', () => { const s = E.createSignals(); for (let i = 0; i < 200; i++) { const p = { yaw: Math.sin(i / 7) * 3, roll: Math.cos(i / 9) * 2, smile: 0.1 + 0.1 * Math.sin(i / 5) }; const r = face(p); const t = i * 33 + (i % 3) * 4; s.push(feat(p, t), r.faceLandmarks[0], { w: W, h: H }, t); } const f = s.summary().flags; assert(!f.includes('frozen_or_still_image') && !f.includes('perfectly_regular_frames'), f.join()); });
console.log(`\n${pass} checks passed`);
