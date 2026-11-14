/* Unit tests for room-sync.js (Sync Engine v2, feature F1).  Run: node tests/sync-engine.test.js */
const assert = require('assert');
const S = require('../room-sync.js');
const { CFG } = S;
let n = 0; const ok = (c, m) => { assert.ok(c, 'FAIL: ' + m); n++; console.log('ok  - ' + m); };

/* a host with every hook stubbed; tests override what they care about */
function mkHost(o) {
  const h = {
    t: 1000, now() { return h.t; }, isAdmin: () => false, me: () => 'me', connected: () => true, net: () => ({}),
    baseRate: () => 1, rates: () => null, applyRate() {}, seek() {}, pause() {}, resume() {}, send() {}, changed() {}, paint() {}, count() {},
    waitMode: () => 'wait', adminPause() {}, adminResume() {}, expectedIn: () => 0,
    sample: () => ({ ready: true, live: false, wantPlaying: true, ended: false, cur: 0, exp: 0, playing: true })
  };
  return Object.assign(h, o);
}

/* ---- decide(): thresholds (F1: nudge > 1.5 s, hard seek only > 4 s) ---- */
const d = (drift, extra) => S.decide(Object.assign({ drift, now: 100000, settleUntil: 0, lastSeekAt: 0, seeks: [], nudging: false }, extra));
ok(d(0.9).action === 'none', 'under 1.5 s: leave the player alone');
ok(d(1.5).action === 'none', 'exactly 1.5 s is still fine ("more than 1.5 s" triggers)');
ok(d(-1.6).action === 'nudge' && d(-1.6).dir === 1, 'behind by 1.6 s: nudge faster');
ok(d(2.5).action === 'nudge' && d(2.5).dir === -1, 'ahead by 2.5 s: nudge slower');
ok(d(-3.9).action === 'nudge', 'up to 4 s: only a nudge, never a hard seek');
ok(d(-4.1).action === 'seek' && d(5).action === 'seek', 'over 4 s: hard seek');
ok(d(-1.0, { nudging: true }).action === 'nudge', 'hysteresis: keeps nudging until within 0.4 s');
ok(d(-0.3, { nudging: true }).action === 'release', 'back within 0.4 s: release the rate');
ok(d(-9, { settleUntil: 100500 }).action === 'none', 'right after a seek: ignore drift while the player settles');
ok(d(-9, { lastSeekAt: 98000 }).action === 'nudge', 'seek cool-down: too soon after the last seek → nudge instead');
ok(d(-9, { seeks: [80000, 85000, 90000] }).action === 'nudge', 'seek budget: 3 seeks in the last 30 s → nudge instead');
ok(d(-9, { seeks: [60000, 85000, 90000] }).action === 'seek', 'seek budget: the oldest seek has left the 30 s window');

/* ---- no double-seek loops (F1 acceptance criterion) ---- */
{
  const run = (secs, drift) => {
    const times = []; const h = mkHost({ t: 0, seek() { times.push(h.t); } }); const E = S.create(h);
    for (let i = 0; i < secs; i++) { h.t += 1000; E.correct(0, -drift); }       /* cur 0, expected `drift` s ahead: stuck behind */
    return times;
  };
  const times = run(120, -30);
  ok(times.length >= 1 && times.length <= 12, 'stuck player (30 s behind, 120 s): ' + times.length + ' automatic seeks, not a loop');
  let min = Infinity; for (let i = 1; i < times.length; i++) min = Math.min(min, times[i] - times[i - 1]);
  ok(min >= CFG.SEEK_COOLDOWN, 'two automatic seeks are never closer than 5 s (min ' + min + ' ms)');
  let worst = 0; times.forEach(t0 => { worst = Math.max(worst, times.filter(x => x >= t0 && x - t0 < CFG.SEEK_WINDOW).length); });
  ok(worst <= CFG.SEEK_BUDGET, 'never more than 3 automatic seeks inside any 30 s window (worst ' + worst + ')');
  /* the player keeps landing 8 s behind after every seek (e.g. a stream that cannot seek) */
  const times2 = run(60, -8); ok(times2.length <= 6, 'a player that ignores seeks is not hammered: ' + times2.length + ' seeks in 60 s');
  /* one seek fixes it: exactly one seek, then silence */
  { let seeks = 0, cur = 0; const h = mkHost({ t: 0, seek() { seeks++; cur = 100; } }); const E = S.create(h);
    for (let i = 0; i < 30; i++) { h.t += 1000; E.correct(cur, 100); }
    ok(seeks === 1, 'a seek that works is a single seek (no echo seek on the same drift)'); }
  /* the admin is the reference and is never corrected */
  let s2 = 0; const E3 = S.create(mkHost({ isAdmin: () => true, seek: () => s2++ })); E3.correct(0, 50);
  ok(s2 === 0, 'the admin is never corrected');
  /* buffering players are not corrected (nothing to correct while the picture is frozen) */
  let s3 = 0; const E4 = S.create(mkHost({ seek: () => s3++ })); E4.setBuffering(true); E4.correct(0, 50);
  ok(s3 === 0, 'a buffering player is not seeked');
}

/* ---- nudge / release through the engine ---- */
{
  let applied = 0; const h = mkHost({ t: 5000, applyRate() { applied++; } }); const E = S.create(h);
  E.correct(8, 10);
  ok(E.nudgeRate() === 1.05 && applied === 1, 'behind by 2 s → rate 1.05 applied');
  h.t += 1000; E.correct(9.4, 10); ok(E.nudgeRate() === 1.05 && applied === 1, 'still 0.6 s behind: keeps nudging, rate not re-applied');
  h.t += 1000; E.correct(9.8, 10); ok(E.nudgeRate() === 0 && applied === 2, 'back within 0.4 s → rate released');
  h.t += 1000; E.correct(13, 10); ok(E.nudgeRate() === 0.95, 'ahead by 3 s → rate 0.95');
  E.release(); ok(E.nudgeRate() === 0, 'release() (room speed changed) drops the nudge');
  ok(E.summary().nudges === 2, 'nudge episodes are counted');
  const yh = mkHost({ rates: () => [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2] }); const YE = S.create(yh); YE.correct(8, 10);
  ok(YE.nudgeRate() === 1.25, 'YouTube (fixed steps): next step up');
}

/* ---- nudgeRate ---- */
ok(S.nudgeRate(1, 1, null) === 1.05 && S.nudgeRate(1, -1, null) === 0.95, 'free-rate players: 0.95x / 1.05x');
ok(S.nudgeRate(1.5, 1, null) === 1.575, 'a 1.5x room: nudge is relative to the room speed');
ok(S.nudgeRate(1, 1, [0.25, 0.5, 1, 1.5, 2]) === 1.5 && S.nudgeRate(1, -1, [0.25, 0.5, 1, 1.5, 2]) === 0.5, 'fixed-step players: next step up / down');
ok(S.nudgeRate(2, 1, [1, 2]) === 2.1, 'no higher step: falls back to +5 %');

/* ---- status ---- */
ok(S.statusOf({ buffering: true, admin: false, drift: 0 }) === 'buf', 'status: buffering');
ok(S.statusOf({ buffering: false, admin: false, drift: -2 }) === 'behind', 'status: behind');
ok(S.statusOf({ buffering: false, admin: false, drift: 2 }) === 'ahead', 'status: ahead');
ok(S.statusOf({ buffering: false, admin: true, drift: -9 }) === 'ok', 'status: the admin is always in sync');
ok(S.statusOf({ buffering: true, admin: true, drift: 0 }) === 'buf', 'status: the admin can still be buffering');
ok(S.statusOf({ buffering: false, admin: false, drift: 1.4 }) === 'ok', 'status: in sync inside 1.5 s');

/* ---- reconnect back-off ---- */
const mid = () => 0.5;
const seq = [0, 1, 2, 3, 4, 5, 6, 9].map(i => S.backoff(i, mid));
ok(seq.join() === '1000,2000,4000,8000,16000,30000,30000,30000', 'back-off doubles 1 s → 30 s then stays: ' + seq.join());
ok(S.backoff(2, () => 0) === 3200 && S.backoff(2, () => 1) === 4800, 'back-off jitter is ±20 %');
{ let at = 0; const marks = []; for (let i = 0; i < 6; i++) { at += S.backoff(i, mid); marks.push(at); }
  ok(marks.join() === '1000,3000,7000,15000,31000,61000', 'retries land at 1, 3, 7, 15, 31 s … (the browser "online" event retries at once)'); }

/* ---- clock ---- */
const best = S.pickClock([{ offset: 50, rtt: 400 }, { offset: 12, rtt: 40 }, { offset: 90, rtt: 900 }]);
ok(best.offset === 12, 'clock: the lowest-RTT sample wins');
ok(S.pickClock([]) === null && S.pickClock(null) === null, 'clock: no samples → null');
ok(S.blendClock(null, best) === 12, 'clock: first sample is taken as is');
ok(S.blendClock(10, { offset: 20, rtt: 30 }) === 10, 'clock: changes under 25 ms are ignored (no jitter)');
ok(S.blendClock(10, { offset: 110, rtt: 30 }) === 60, 'clock: medium changes are smoothed');
ok(S.blendClock(10, { offset: 900, rtt: 30 }) === 900, 'clock: big jumps apply at once');
ok(S.blendClock(10, { offset: 500, rtt: 5000 }) === 10, 'clock: very slow samples are ignored');
ok(S.blendClock(10, null) === 10, 'clock: a failed measurement keeps the old offset');

/* ---- wait target ---- */
{
  const m = new Map(); const now = 50000;
  m.set('a', { st: 'buf', b: 2000, ts: now - 2000, j: 0 });   /* 4 s buffering */
  m.set('b', { st: 'buf', b: 500, ts: now - 100, j: 0 });     /* 0.6 s */
  m.set('c', { st: 'buf', b: 9000, ts: now - 500, j: 1 });    /* new joiner */
  m.set('d', { st: 'ok', b: 0, ts: now, j: 0 });
  const w = S.waitTarget(m, { me: 'me', now, ignore: new Map() });
  ok(w && w.uid === 'a', 'wait target: the member buffering > 3 s (not new joiners, not short stalls)');
  ok(S.waitTarget(m, { me: 'a', now, ignore: new Map() }) === null, 'wait target: never yourself');
  ok(S.waitTarget(m, { me: 'me', now, ignore: new Map([['a', now + 1000]]) }) === null, 'wait target: ignored members do not hold the room up');
  ok(S.waitTarget(m, { me: 'me', now: now + 20000, ignore: new Map() }) === null, 'wait target: stale reports are dropped');
}

/* ---- admin: Wait for everyone / Never wait ---- */
function adminRig(mode) {
  let playing = true, paused = 0, resumed = 0, who = null;
  const h = mkHost({ t: 1000, isAdmin: () => true, me: () => 'adm', waitMode: () => mode,
    sample: () => ({ ready: true, live: false, wantPlaying: true, ended: false, cur: 5, exp: 5, playing }),
    adminPause(u) { paused++; playing = false; who = u; }, adminResume() { resumed++; playing = true; } });
  return { h, E: S.create(h), adv: ms => { h.t += ms; }, get paused() { return paused; }, get resumed() { return resumed; }, get who() { return who; }, set playing(v) { playing = v; } };
}
{
  const r = adminRig('wait'); r.E.onSync({ u: 'x', st: 'buf', b: 4000 });
  r.adv(1000); r.E.tick();
  ok(r.paused === 1 && r.who === 'x', 'wait mode: admin pauses for everyone when a member buffers > 3 s');
  r.E.onSync({ u: 'x', st: 'ok', b: 0 }); r.adv(1000); r.E.tick(); r.adv(800); r.E.tick();
  ok(r.resumed === 1, 'wait mode: admin resumes shortly after the member is back');
}
{ const r = adminRig('wait'); r.E.onSync({ u: 'x', st: 'buf', b: 1000 }); r.adv(500); r.E.tick(); ok(r.paused === 0, 'wait mode: a buffering of 1.5 s is not enough to pause'); }
{ const r = adminRig('never'); r.E.onSync({ u: 'x', st: 'buf', b: 6000 }); r.adv(1000); r.E.tick(); ok(r.paused === 0, 'never-wait mode: the room keeps playing'); }
{
  const r = adminRig('wait'); r.E.onSync({ u: 'x', st: 'buf', b: 4000 }); r.adv(1000); r.E.tick();
  for (let i = 0; i < 25; i++) { r.adv(1000); r.E.onSync({ u: 'x', st: 'buf', b: 5000 + i * 1000 }); r.E.tick(); }
  ok(r.resumed === 1 && r.paused === 1, 'wait mode: never waits longer than 20 s for one person, and does not pause again for the same stall');
}
{
  const r = adminRig('wait'); r.E.onSync({ u: 'x', st: 'buf', b: 4000 }); r.adv(1000); r.E.tick();
  r.playing = true; r.adv(1000); r.E.onSync({ u: 'x', st: 'buf', b: 6000 }); r.E.tick(); r.adv(1000); r.E.onSync({ u: 'x', st: 'buf', b: 7000 }); r.E.tick();
  ok(r.paused === 1 && r.resumed === 0, 'wait mode: if the admin presses play during a wait, the room is not paused again');
}
{
  const r = adminRig('wait'); r.E.onSync({ u: 'x', st: 'buf', b: 4000 }); r.adv(1000); r.E.tick();
  r.h.waitMode = () => 'never'; r.adv(1000); r.E.tick();
  ok(r.resumed === 1, 'switching to Never wait while waiting resumes at once');
}
{
  const painted = []; const h = mkHost({ paint: v => painted.push(v) });
  const E = S.create(h); E.onSync({ u: 'x', st: 'buf', b: 4000 }); h.t += 500; E.tick();
  ok(painted[painted.length - 1].mode === 'waiting' && painted[painted.length - 1].uid === 'x' && painted[painted.length - 1].pausing === true, 'members see "Waiting for {name}" when a member buffers > 3 s');
  h.waitMode = () => 'never'; h.t += 100; E.tick(); ok(painted[painted.length - 1].pausing === false, 'with Never wait the pill only says who is buffering');
}

/* ---- member engine: badges, reports, summary ---- */
{
  const sent = []; let drift = 0, changed = [];
  const h = mkHost({ send: m => sent.push(m), changed: u => changed.push(u), sample: () => ({ ready: true, live: false, wantPlaying: true, ended: false, cur: 100 + drift, exp: 100, playing: true }) });
  const E = S.create(h); E.mountedAt = 0;
  h.t += 20000; E.tick();
  ok(sent.length === 1 && sent[0].st === 'ok' && sent[0].u === 'me', 'first tick reports "In sync"');
  h.t += 1000; E.tick(); ok(sent.length === 1, 'unchanged status is re-sent only every 3 s');
  h.t += 2500; E.tick(); ok(sent.length === 2, 'status heartbeat every 3 s');
  drift = -2.2; h.t += 1000; E.tick();
  ok(sent[sent.length - 1].st === 'behind' && sent[sent.length - 1].d === -2.2, 'status change is sent immediately ("Behind", -2.2 s)');
  drift = 0; E.setBuffering(true); h.t += 1000; E.tick(); h.t += 1000; E.tick();
  ok(sent[sent.length - 1].st === 'buf' && sent[sent.length - 1].b >= 1000, 'buffering is reported with its duration');
  E.setBuffering(false);
  E.onSync({ u: 'bob', st: 'behind', d: -3 });
  ok(changed.join() === 'bob', 'the page is told when a member\'s badge changes');
  ok(E.statusOf('bob').st === 'behind' && E.statusOf('me').st, 'badges for other members and for yourself');
  E.onSync({ u: 'me', st: 'buf' }); E.onSync({ u: 'zed', st: 'hacked' }); E.onSync(null); E.onSync({ st: 'ok' });
  ok(E.statusOf('zed') === null && E.map.size === 1, 'own echoes, unknown statuses and malformed reports are ignored');
  h.t += 20000; ok(E.statusOf('bob') === null, 'badge disappears when a member goes quiet (> 12 s)');
  const sm = E.summary(); ok(sm.samples >= 1 && typeof sm.median_drift === 'number' && typeof sm.p95_drift === 'number' && sm.buffer_ms >= 1000, 'summary: median / p95 drift and buffering time');
  E.resetStats(); ok(E.summary().samples === 0 && E.summary().buffer_ms === 0, 'resetStats() starts a fresh window');
}
{
  const sent = []; const h = mkHost({ connected: () => false, send: m => sent.push(m) }); const E = S.create(h); h.t += 20000; E.tick();
  ok(sent.length === 0, 'nothing is broadcast while the channel is down');
  const painted = []; const h2 = mkHost({ net: () => ({ down: true, n: 3, offline: true }), paint: v => painted.push(v) }); S.create(h2).tick();
  ok(painted[0].mode === 'net' && painted[0].n === 3 && painted[0].offline === true, 'while disconnected the video shows the reconnecting pill (attempt number, offline flag)');
}

/* ---- late joiner: live position + Catch up + 3-2-1 ---- */
{
  const painted = []; const h = mkHost({ paint: v => painted.push(v) }); const E = S.create(h);
  E.noteSeek('join'); h.t += 3000; E.tick();
  ok(painted[painted.length - 1].mode === 'join', 'after landing on the live position the pill offers Catch up / 3-2-1');
  h.t += 20000; E.tick(); ok(painted[painted.length - 1].mode === 'none', 'the join pill goes away by itself');
}
{
  const calls = []; const h = mkHost({ expectedIn: ms => 100 + ms / 1000, seek: t => calls.push(['seek', t]), resume: () => calls.push(['resume']), pause: () => calls.push(['pause']), count: c => calls.push(['count', c]) });
  const E = S.create(h); E.catchUp();
  ok(calls[0][0] === 'seek' && Math.abs(calls[0][1] - 100.25) < 1e-9 && calls[1][0] === 'resume' && E.summary().manual_resyncs === 1, 'Catch up: seeks to the live position, resumes, counts as a manual resync');
  const adm = S.create(mkHost({ isAdmin: () => true, seek: () => calls.push(['bad']) })); adm.catchUp(); adm.resync();
  ok(!calls.some(c => c[0] === 'bad'), 'the admin has no Catch up / 3-2-1');
}
{
  /* 3-2-1 with a manual clock: parks the player where the room will be, counts, then plays together */
  const timers = []; const realSet = global.setTimeout, realClr = global.clearTimeout;
  global.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; }; global.clearTimeout = () => {};
  try {
    const calls = []; const h = mkHost({ expectedIn: ms => 200 + ms / 1000, seek: t => calls.push(['seek', t]), resume: () => calls.push(['resume']), pause: () => calls.push(['pause']), count: c => calls.push(['count', c]),
      sample: () => ({ ready: true, live: false, wantPlaying: true, ended: false, cur: 203, exp: 203, playing: false }) });
    const E = S.create(h); E.resync();
    ok(calls[0][0] === 'seek' && calls[0][1] === 203 && calls[1][0] === 'pause' && calls[2].join() === 'count,3' && E.busy(), '3-2-1: parks the player 3 s ahead on the live timeline, paused, shows 3');
    let c = 0; while (timers.length) { const t = timers.shift(); t.f(); if (++c > 10) break; }
    const counts = calls.filter(x => x[0] === 'count').map(x => x[1]);
    ok(counts.join() === '3,2,1,0' && calls[calls.length - 1][0] === 'resume' && !E.busy(), '3-2-1: counts 3, 2, 1, then plays; the engine is free again');
    ok(!calls.some((x, i) => x[0] === 'seek' && i > 2), '3-2-1: no second seek when the player landed on the right spot');
    h.t += 1000; E.correct(0, 100); ok(E.busy() === false, 'corrections work again after the countdown');
    /* leaving mid-countdown clears the overlay and the timer */
    calls.length = 0; E.resync(); E.reset(); ok(calls.some(x => x[0] === 'count' && x[1] === 0) && !E.busy(), 'reset() during a countdown removes the overlay');
  } finally { global.setTimeout = realSet; global.clearTimeout = realClr; }
}

/* ---- reset ---- */
{
  const h = mkHost(); const E = S.create(h); E.setBuffering(true); E.noteSeek('auto'); E.onSync({ u: 'x', st: 'ok' });
  E.reset(); ok(!E.buf && E.seeks.length === 0 && E.map.size === 1, 'reset(): new player state, other members kept');
  E.resetAll(); ok(E.map.size === 0, 'resetAll(): entering a room forgets the old room');
}
console.log('\nALL ' + n + ' SYNC ENGINE TESTS PASSED');
