/* Unit tests for room-net.js (profile, hls settings, preconnect, stall watchdog, error recovery) in a fake browser.
   Run: node tests/net-unit.test.js */
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const code = fs.readFileSync(path.join(__dirname, '../room-net.js'), 'utf8');
function load(conn) {
  const timers = []; let now = 1e6; const links = [];
  const sb = { navigator: { connection: conn || {}, onLine: true }, location: { href: 'https://nova.test/', origin: 'https://nova.test' },
    document: { head: { appendChild: l => links.push(l) }, createElement: () => ({}) }, URL, Math,
    setInterval: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearInterval() {}, setTimeout: (f, ms) => { timers.push({ f, ms, once: true }); return timers.length; },
    Date: { now: () => now } };
  sb.self = sb; vm.runInNewContext(code, sb);
  return { N: sb.NovaNet, timers, links, sb, advance: ms => { now += ms; } };
}
const video = o => Object.assign({ paused: false, ended: false, seeking: false, readyState: 2, currentTime: 10, isConnected: true, buffered: { length: 0 }, error: null, listeners: {}, loads: 0,
  addEventListener(ev, f) { (this.listeners[ev] = this.listeners[ev] || []).push(f); }, load() { this.loads++; }, play() {} }, o);
let ok = 0, bad = 0; const pend = []; const t = (n, f) => { const done = () => { ok++; console.log('  ✓', n); }, fail = (e) => { bad++; console.error('  ✗', n, '\n    ', String(e.message).split('\n')[0]); }; try { const r = f(); if (r && r.then) pend.push(r.then(done, fail)); else done(); } catch (e) { fail(e); } };

t('profile: fast link is fast; 3g / 2g / data-saver / low downlink / high rtt are slow', () => {
  assert.strictEqual(load({ effectiveType: '4g', downlink: 10, rtt: 50 }).N.profile().tier, 'fast');
  for (const c of [{ effectiveType: '3g' }, { effectiveType: '2g' }, { saveData: true }, { downlink: 0.8 }, { rtt: 900 }]) assert.strictEqual(load(c).N.profile().slow, true, JSON.stringify(c));
  assert.strictEqual(load({ effectiveType: '4g', downlink: 2.5, rtt: 100 }).N.profile().tier, 'ok');
});
t('profile: three stalls in two minutes make it "slow" whatever the browser claims; they expire', () => {
  const L = load({ effectiveType: '4g', downlink: 10, rtt: 50 }); for (let i = 0; i < 3; i++) L.N.noteStall();
  assert.strictEqual(L.N.profile().slow, true); L.advance(130000); assert.strictEqual(L.N.profile().slow, false);
});
t('hlsConfig: slow starts lowest + pessimistic + deep buffer; fast auto-selects high; preview is tiny', () => {
  const N = load().N, s = N.hlsConfig({ slow: true, tier: 'slow' }), f = N.hlsConfig({ slow: false, tier: 'fast' }), p = N.hlsConfig({ slow: false, tier: 'ok' }, { preview: true });
  assert.strictEqual(s.startLevel, 0); assert.ok(s.abrEwmaDefaultEstimate < 1e6); assert.ok(s.maxBufferLength >= 60); assert.ok(s.abrBandWidthUpFactor < f.abrBandWidthUpFactor);
  assert.strictEqual(f.startLevel, -1); assert.ok(f.abrEwmaDefaultEstimate >= 5e6); assert.strictEqual(p.startLevel, 0); assert.ok(p.maxBufferLength <= 4);
});
t('preconnect: once per host, never own origin, bad urls ignored', () => {
  const L = load(); assert.ok(L.N.preconnect('https://video.twimg.com/a.mp4')); assert.ok(!L.N.preconnect('https://video.twimg.com/b.mp4'));
  assert.ok(!L.N.preconnect('https://nova.test/api')); assert.ok(!L.N.preconnect('javascript:1')); assert.strictEqual(L.links.length, 1);
});
t('watchdog: a moving player is left alone', () => {
  const L = load(), v = video(), w = L.N.watch(v, {}); for (let i = 0; i < 20; i++) { L.advance(1000); v.currentTime += 1; w.tick(); }
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.stats)), { stalls: 0, nudges: 0, reloads: 0, alt: 0 });
});
t('watchdog: frozen with buffered data → nudge only, no reload', () => {
  const L = load(), v = video({ readyState: 3, buffered: { length: 1, start: () => 0, end: () => 60 } }), w = L.N.watch(v, {});
  w.tick(); for (let i = 0; i < 4; i++) { L.advance(1000); w.tick(); }
  assert.ok(w.stats.nudges >= 1 && w.stats.reloads === 0 && v.loads === 0);
});
t('watchdog: nothing arriving → restart download twice on the same route, then the other route, and it keeps trying', () => {
  const L = load(), v = video(), calls = []; const w = L.N.watch(v, { reload: () => { calls.push('alt'); return true; } });
  w.tick(); for (let i = 0; i < 60; i++) { L.advance(1000); w.tick(); }
  assert.ok(v.loads >= 2, 'same-route restarts: ' + v.loads); assert.ok(calls.length >= 1, 'other route'); assert.ok(w.stats.alt >= 1);
  assert.ok(v.loads + calls.length >= 4, 'keeps trying');
});
t('watchdog: slow link waits longer before restarting (no reload storm)', () => {
  const fast = load({ effectiveType: '4g', downlink: 10 }), slow = load({ effectiveType: '2g' });
  const run = L => { const v = video(), w = L.N.watch(v, {}); w.tick(); let s = 0; while (!v.loads && s < 40) { L.advance(1000); w.tick(); s++; } return s; };
  assert.ok(run(slow) > run(fast), 'slow must wait longer');
});
t('watchdog: offline = wait, paused = never touched', () => {
  const L = load(), v = video(), w = L.N.watch(v, {}); L.sb.navigator.onLine = false; w.tick(); for (let i = 0; i < 30; i++) { L.advance(1000); w.tick(); } assert.strictEqual(v.loads, 0);
  L.sb.navigator.onLine = true; v.paused = true; for (let i = 0; i < 30; i++) { L.advance(1000); w.tick(); } assert.strictEqual(v.loads, 0);
});
t('recoverError: mid-video network error retries from the same second with back-off; 3rd failure uses the other route; early errors are not retried', () => {
  const L = load(), v = video({ currentTime: 42, error: { code: 2 } }); let alt = 0; const hooks = { reload: () => { alt++; return true; } };
  assert.strictEqual(L.N.recoverError(v, hooks), true); assert.strictEqual(L.timers.at(-1).ms, 1000);
  assert.strictEqual(L.N.recoverError(v, hooks), true); assert.strictEqual(L.timers.at(-1).ms, 2000);
  assert.strictEqual(L.N.recoverError(v, hooks), true); assert.strictEqual(alt, 1);
  assert.strictEqual(L.N.recoverError(video({ currentTime: 0.2, error: { code: 4 } }), hooks), false);
  assert.strictEqual(L.N.recoverError(video({ currentTime: 30, error: { code: 3 } }), hooks), false);
});

/* ---------- quality ladder (plain files) ---------- */
const LAD = [{ h: 1080, u: 'https://v/1080.mp4', b: 5e6 }, { h: 320, u: 'https://v/320.mp4', b: 2.5e5 }, { h: 720, u: 'https://v/720.mp4', b: 2.2e6 }, { h: 480, u: 'https://v/480.mp4', b: 8.3e5 }];
t('ladderFrom: sorted low→high, bad links dropped, default url joins, one rung = no ladder', () => {
  const N = load().N, l = N.ladderFrom({ url: 'https://v/720.mp4', q: LAD.concat([{ h: 240, u: 'http://insecure/240.mp4' }, null]) });
  assert.strictEqual(l.map(r => r.h).join(), '320,480,720,1080'); assert.strictEqual(l.map(r => r.i).join(), '0,1,2,3');
  assert.strictEqual(N.ladderFrom({ url: 'https://v/x.mp4', q: [LAD[0]] }).length > 0, true, 'default url adds a second rung');
  assert.strictEqual(N.ladderFrom({ url: 'https://v/720.mp4' }).length, 0); assert.strictEqual(N.ladderFrom(null).length, 0);
  assert.strictEqual(N.ladderFrom({ url: 'https://v/1080.mp4', q: [LAD[0]] }).length, 0, 'a single rung is no choice');
});
t('pickStart: slow link → lowest; fast link → as sharp as the screen shows; small player is capped; ok link ~480', () => {
  const lad = load().N.ladderFrom({ url: 'https://v/720.mp4', q: LAD }), N = (c) => load(c).N;
  assert.strictEqual(N({ effectiveType: '2g' }).pickStart(lad, null, 1080), 0);
  assert.strictEqual(lad[N({ effectiveType: '4g', downlink: 10, rtt: 40 }).pickStart(lad, null, 1080)].h, 1080);
  assert.strictEqual(lad[N({ effectiveType: '4g', downlink: 10, rtt: 40 }).pickStart(lad, null, 300)].h, 320);
  assert.strictEqual(lad[N({ effectiveType: '4g', downlink: 2.5, rtt: 100 }).pickStart(lad, null, 1080)].h, 480);
});
const R = [2.5e5, 8.3e5, 2.2e6, 5e6], D = o => Object.assign({ i: 2, rungs: R, ceil: 3, ahead: 20, speed: 0, sinceSwitch: 60000, sinceStall: 1e9, playing: true }, o);
t('abrDecide: low buffer / stall / slow link → straight to the rung that fits (no staircase); grace after a switch; paused = no change', () => {
  const N = load().N;
  assert.strictEqual(N.abrDecide(D({ ahead: 1.5, speed: 1.2e6 })), 1); assert.strictEqual(N.abrDecide(D({ ahead: 1.5, speed: 0 })), 1);
  assert.strictEqual(N.abrDecide(D({ i: 3, ahead: 1, speed: 4e5 })), 0, 'jumps 1080 → 320');
  assert.strictEqual(N.abrDecide(D({ sinceStall: 1000, sinceSwitch: 9000 })), 1);
  assert.strictEqual(N.abrDecide(D({ ahead: 1, sinceSwitch: 2000 })), 2, 'grace: a fresh switch is given time to fill');
  assert.strictEqual(N.abrDecide(D({ speed: 2.3e6, ahead: 6 })), 1, 'cannot keep up with 2.2 Mbit/s');
  assert.strictEqual(N.abrDecide(D({ ahead: 0.5, playing: false })), 2);
});
t('abrDecide: climbs only after a long calm, with a real speed margin, one rung at a time, never above the screen ceiling', () => {
  const N = load().N, up = D({ i: 1, speed: 6e6 });
  assert.strictEqual(N.abrDecide(up), 2);
  for (const bad of [{ sinceSwitch: 8000 }, { sinceStall: 20000 }, { ahead: 8 }, { speed: 4e6 }, { ceil: 1 }]) assert.strictEqual(N.abrDecide(Object.assign({}, up, bad)), 1, JSON.stringify(bad));
  assert.strictEqual(N.abrDecide(D({ i: 0, speed: 50e6 })), 1, 'one step at a time');
});
const rv = (end) => { const v = video({ currentTime: 10, readyState: 4, buffered: { length: 1, start: () => 0, end: () => v.end }, end: end || 10, paused: false, srcs: [] });
  Object.defineProperty(v, 'src', { set(x) { this.srcs.push(x); }, get() { return this.srcs[this.srcs.length - 1]; } }); return v; };
t('abr controller: buffer runs dry → lower rung with the same second, quiet() first; manual lock; error right after a switch reverts', () => {
  const L = load(), lad = L.N.ladderFrom({ url: 'https://v/720.mp4', q: LAD }); let quiet = 0; const v = rv(11);
  const A = L.N.abr(v, lad, { start: 3, quiet: () => quiet++, src: r => r.u + '?x' });
  for (let i = 0; i < 8; i++) { L.advance(1000); A.tick(); }                      /* ahead = 1 s, grace over → down */
  assert.ok(A.level < 3, 'level ' + A.level); assert.ok(quiet >= 1); assert.match(v.src, /\?x$/); assert.strictEqual(v.loads >= 1, true);
  v.listeners.loadedmetadata.forEach(f => f()); assert.strictEqual(v.currentTime, 10, 'same second');
  assert.strictEqual(A.set('3'), true); assert.strictEqual(A.auto, false); assert.strictEqual(A.level, 3);
  assert.strictEqual(A.onError(), true); assert.ok(A.level < 3, 'reverted'); assert.strictEqual(A.cap, A.level, 'the failing higher rung is not tried again');
  A.set('auto'); assert.strictEqual(A.auto, true);
});
t('abr controller: calm + big buffer → probes the next rung first, switches up only when the probe is fast enough', async () => {
  const L = load(), lad = L.N.ladderFrom({ url: 'https://v/720.mp4', q: LAD }); const v = rv(60); v.currentTime = 10; let probed = 0, sp = 3e6;
  const A = L.N.abr(v, lad, { start: 1, viewPx: () => 1080, probe: async () => { probed++; return sp; } });
  L.advance(21000); A.tick(); await new Promise(r => setImmediate(r)); L.advance(1000); A.tick();
  assert.strictEqual(probed, 1); assert.strictEqual(A.level, 1, '3 Mbit/s is not 2.5x of 2.2 Mbit/s');
  L.advance(26000); sp = 9e6; A.tick(); await new Promise(r => setImmediate(r)); L.advance(1000); A.tick();
  assert.strictEqual(probed, 2); assert.strictEqual(A.level, 2);
});
Promise.all(pend).then(() => { console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0); });
