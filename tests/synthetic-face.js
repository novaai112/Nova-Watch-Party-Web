/* tests/synthetic-face.js — builds MediaPipe-style landmark results from a simple rotated 3-D face model.
 * Used by the unit tests (node) and the browser integration test (stub landmarker). */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('../liveness-engine.js')); else root.SyntheticFace = factory(root.NovaLiveness); })(typeof self !== 'undefined' ? self : this, function (E) {
const { L } = E; const W = 640, H = 480; const DEG = Math.PI / 180;
// canonical 3-D points (face half-width = 1; y down; +z toward camera)
function model(open, mouthOpen, smile) {
  const m = {};
  const eye = (side, o) => { // side: -1 = subject's right eye (image left), +1 = subject's left
    const cx = side * 0.38, cy = -0.3, hw = 0.19, hh = 0.07 * o + 0.004;
    const e = side < 0 ? L.eyeR : L.eyeL;
    m[e.out] = [cx + side * hw, cy, 0.15]; m[e.inn] = [cx - side * hw, cy, 0.15];
    m[e.u1] = [cx + side * hw * 0.45, cy - hh, 0.2]; m[e.u2] = [cx - side * hw * 0.45, cy - hh, 0.2];
    m[e.l1] = [cx + side * hw * 0.45, cy + hh, 0.2]; m[e.l2] = [cx - side * hw * 0.45, cy + hh, 0.2];
    m[e.up] = [cx, cy - hh, 0.2]; m[e.lo] = [cx, cy + hh, 0.2];
  };
  eye(-1, open[0]); eye(1, open[1]);
  m[1] = [0, 0.15, 0.55]; m[10] = [0, -1.0, 0.1]; m[152] = [0, 1.1, 0.25]; m[234] = [-1, 0, 0]; m[454] = [1, 0, 0];
  const mw = 0.38 * (1 + 0.3 * smile), my = 0.62, mo = 0.35 * mouthOpen;
  m[61] = [-mw, my - 0.05 * smile, 0.3]; m[291] = [mw, my - 0.05 * smile, 0.3];
  m[13] = [0, my - mo / 2, 0.35]; m[14] = [0, my + mo / 2, 0.35]; m[0] = [0, my - mo / 2 - 0.05, 0.35]; m[17] = [0, my + mo / 2 + 0.05, 0.35];
  [70, 63, 105, 66, 107].forEach((i, k) => m[i] = [-0.75 + k * 0.12, -0.5, 0.15]); [336, 296, 334, 293, 300].forEach((i, k) => m[i] = [0.75 - k * 0.12, -0.5, 0.15]);
  return m;
}
// pose: yaw (+ = subject's left), pitch (+ = up), roll (+ = tilt to subject's left); eyes: closure 0..1
function face(p = {}) {
  const o = [1 - (p.eyeR || 0), 1 - (p.eyeL || 0)];
  const m = model(o, p.mouth || 0, p.smile || 0), lm = new Array(478);
  const y = (p.yaw || 0) * DEG, ph = (p.pitch || 0) * DEG, r = (p.roll || 0) * DEG, S = 0.24;
  for (let i = 0; i < 478; i++) {            // filler points on the face outline so the bbox is sensible
    const a = i / 478 * Math.PI * 2; lm[i] = { x: 0.5 + Math.cos(a) * 0.17, y: 0.5 + Math.sin(a) * 0.3, z: 0 };
  }
  for (const k in m) {
    let [x, yy, z] = m[k];
    let x1 = x * Math.cos(y) + z * Math.sin(y), z1 = -x * Math.sin(y) + z * Math.cos(y);
    let y1 = yy * Math.cos(ph) - z1 * Math.sin(ph);
    let x2 = x1 * Math.cos(r) - y1 * Math.sin(r), y2 = x1 * Math.sin(r) + y1 * Math.cos(r);
    lm[k] = { x: 0.5 + x2 * S * (H / W), y: 0.5 + y2 * S, z: 0 };
  }
  const cats = [
    { categoryName: 'eyeBlinkLeft', score: p.eyeL || 0 }, { categoryName: 'eyeBlinkRight', score: p.eyeR || 0 },
    { categoryName: 'jawOpen', score: p.mouth || 0 }, { categoryName: 'mouthSmileLeft', score: p.smile || 0 }, { categoryName: 'mouthSmileRight', score: p.smile || 0 }];
  return { faceLandmarks: p.none ? [] : p.two ? [lm, lm] : [lm], faceBlendshapes: [{ categories: cats }] };
}

return { face, W, H };
});
