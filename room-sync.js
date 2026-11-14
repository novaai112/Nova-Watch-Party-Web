/* =====================================================================
   room-sync.js · Nova Watch Party · SYNC ENGINE v2 (feature F1)

   Keeps every member's player on the host's timeline, even on slow networks.
     1. Drift correction   off by > 1.5 s  → nudge the playback rate (0.95x / 1.05x, next step on fixed-rate players)
                           off by > 4 s    → hard seek (rate-limited: 5 s apart, 3 per 30 s, so it can never loop)
     2. Buffering aware    a member buffering > 3 s → "Waiting for {name}"; the admin may pause for everyone
                           (room setting rooms.wait_mode: 'wait' = Wait for everyone (max 20 s) / 'never' = Never wait)
     3. Sync badges        In sync / Behind / Ahead / Buffering per member (People list)
     4. Late joiner        lands on the live position, "Catch up" button and a 3-2-1 resync
     5. Reconnect          back-off helper used by room.js (1 s, 2 s, 4 s … 30 s, ±20 % jitter)
     6. Clock offset       best-of-N lowest round-trip sample, smoothed (room.js measures it on join, every 30 s and on tab focus)

   The file has two layers:
     · pure functions (decide, nudgeRate, statusOf, backoff, pickClock, blendClock, waitTarget) - no DOM, no timers, unit tested
     · create(host) - the stateful engine; everything it needs from the page goes through `host`, so it runs under Node in tests

   Loaded in the browser as window.NovaSync, in Node as module.exports.
   Tests: node tests/sync-engine.test.js · Spec: docs/PRD-F1-sync-engine-v2.md
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovaSync = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CFG = {
    NUDGE_AT: 1.5,          /* s  · beyond this the rate is nudged                                            */
    RELEASE_AT: 0.4,        /* s  · a running nudge stops once the drift is back inside this (hysteresis)     */
    SEEK_AT: 4,             /* s  · only beyond this is a hard seek allowed                                   */
    NUDGE_STEP: 0.05,       /*    · 0.95x … 1.05x of the room speed                                           */
    SETTLE_MS: 1500,        /* ms · after a seek the player needs a moment: drift is ignored meanwhile        */
    SEEK_COOLDOWN: 5000,    /* ms · two automatic seeks are never closer than this                            */
    SEEK_WINDOW: 30000,     /* ms · … and never more than SEEK_BUDGET inside this window                      */
    SEEK_BUDGET: 3,
    SEEK_LEAD: 250,         /* ms · land slightly ahead so the seek itself does not leave us behind           */
    DRIFT_PILL_DELAY: 4000, /* ms · the "Behind x s" pill only appears when the drift lasts                   */
    JOIN_PILL: 10000,       /* ms · "Live position · Catch up" stays this long after a late join              */
    JOIN_GRACE: 15000,      /* ms · the first buffering of a new joiner never holds the room up               */
    BUF_SHOW: 700,          /* ms · buffering shorter than this is a blip, not a status                       */
    BUF_WAIT: 3000,         /* ms · "buffering over 3 s" → Waiting for {name}                                 */
    WAIT_MAX: 20000,        /* ms · the room never waits longer than this for one person                      */
    WAIT_IGNORE: 60000,     /* ms · after giving up on someone, ignore their buffering for this long          */
    RESUME_DELAY: 800,      /* ms · resume a little after the last buffering member is back                   */
    REPORT_EVERY: 3000,     /* ms · status heartbeat                                                          */
    STALE: 12000,           /* ms · a member that has been quiet this long has no badge / cannot hold us up   */
    COUNT_STEPS: 3,         /*    · 3-2-1                                                                     */
    BACKOFF_BASE: 1000, BACKOFF_MAX: 30000, BACKOFF_JITTER: 0.2,
    CLOCK_MIN_STEP: 25,     /* ms · smaller clock changes are noise                                           */
    CLOCK_JUMP: 400,        /* ms · bigger changes are applied at once                                        */
    CLOCK_RTT_MAX: 3000,    /* ms · samples slower than this are ignored                                      */
    MAX_SAMPLES: 900
  };
  const STATUSES = ['ok', 'behind', 'ahead', 'buf'];

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;

  /* ------------------------------------------------------------------ pure logic */

  /* May an automatic hard seek happen right now? (cool-down + budget: this is what makes a seek loop impossible) */
  function seekAllowed(now, lastSeekAt, seeks) {
    if (now - lastSeekAt < CFG.SEEK_COOLDOWN) return false;
    let n = 0;
    for (const t of seeks) if (now - t < CFG.SEEK_WINDOW) n++;
    return n < CFG.SEEK_BUDGET;
  }

  /* drift = player position − expected position (negative = behind the host).
     → { action: 'none' | 'nudge' | 'release' | 'seek', dir: +1 faster / −1 slower } */
  function decide(o) {
    const a = Math.abs(o.drift), dir = o.drift < 0 ? 1 : -1;
    if (o.now < o.settleUntil) return { action: 'none' };
    if (a > CFG.SEEK_AT) return seekAllowed(o.now, o.lastSeekAt, o.seeks || []) ? { action: 'seek' } : { action: 'nudge', dir };
    if (o.nudging) return a > CFG.RELEASE_AT ? { action: 'nudge', dir } : { action: 'release' };
    return a > CFG.NUDGE_AT ? { action: 'nudge', dir } : { action: 'none' };
  }

  /* The rate to nudge to. Free-rate players get 0.95x / 1.05x of the room speed;
     players with fixed steps (YouTube: 0.25 … 2) get the next step above / below the room speed. */
  function nudgeRate(base, dir, rates) {
    if (Array.isArray(rates) && rates.length) {
      const sorted = rates.slice().sort((x, y) => x - y);
      const next = dir > 0 ? sorted.find(x => x > base + 1e-6) : sorted.slice().reverse().find(x => x < base - 1e-6);
      if (next) return next;
    }
    return Math.round(base * (1 + dir * CFG.NUDGE_STEP) * 1000) / 1000;
  }

  /* In sync / Behind / Ahead / Buffering. The admin is the reference, so only buffering can change the admin's badge. */
  function statusOf(o) {
    if (o.buffering) return 'buf';
    if (o.admin) return 'ok';
    if (o.drift < -CFG.NUDGE_AT) return 'behind';
    if (o.drift > CFG.NUDGE_AT) return 'ahead';
    return 'ok';
  }

  /* Reconnect delay for attempt i (0-based): 1 s, 2 s, 4 s, 8 s, 16 s, 30 s, 30 s … each ±20 % */
  function backoff(i, rnd) {
    const base = Math.min(CFG.BACKOFF_MAX, CFG.BACKOFF_BASE * Math.pow(2, Math.max(0, i)));
    const j = 1 - CFG.BACKOFF_JITTER + 2 * CFG.BACKOFF_JITTER * (rnd || Math.random)();
    return Math.round(base * j);
  }

  /* samples: [{ offset, rtt }] → the one with the lowest round trip (the least asymmetric guess) */
  function pickClock(samples) {
    let best = null;
    (samples || []).forEach(s => { if (s && isFinite(s.offset) && isFinite(s.rtt) && (!best || s.rtt < best.rtt)) best = s; });
    return best;
  }

  /* previous offset (or null) + a new best sample → the offset to use.
     tiny change = ignore (no jitter) · medium = halfway · big jump = at once · very slow sample = ignore */
  function blendClock(prev, best) {
    if (!best || best.rtt > CFG.CLOCK_RTT_MAX) return prev;
    if (prev == null) return best.offset;
    const diff = best.offset - prev, a = Math.abs(diff);
    if (a < CFG.CLOCK_MIN_STEP) return prev;
    if (a > CFG.CLOCK_JUMP) return best.offset;
    return prev + diff / 2;
  }

  /* Who is holding the room up? The member who has been buffering the longest, over BUF_WAIT.
     map: uid → { st, b (buffering ms when reported), ts (when reported), j (new joiner) } */
  function waitTarget(map, o) {
    let best = null;
    map.forEach((v, uid) => {
      if (uid === o.me || !v || v.st !== 'buf' || v.j) return;
      const age = o.now - v.ts;
      if (age > CFG.STALE) return;
      const until = o.ignore && o.ignore.get(uid);
      if (until && until > o.now) return;
      const ms = (v.b || 0) + age;
      if (ms > CFG.BUF_WAIT && (!best || ms > best.ms)) best = { uid, ms };
    });
    return best;
  }

  /* ------------------------------------------------------------------ stateful engine */

  function freshStats() { return { nudges: 0, hardSeeks: 0, manual: 0, bufferMs: 0, reconnects: 0, reconnectOk: 0 }; }

  /* host = {
       now(), isAdmin(), me(), connected(), net() → { down, n, offline },
       sample() → { ready, live, wantPlaying, ended, cur, exp, playing },   expectedIn(ms) → expected position in `ms` from now
       baseRate(), rates() → fixed rate steps or null, applyRate(),
       seek(t), pause(), resume() (plays only if the room is playing),
       send(payload) (broadcast 'sync'), waitMode() → 'wait' | 'never', adminPause(uid), adminResume(),
       changed(uid), paint(view), count(n)
     } */
  function create(host) {
    const E = {
      map: new Map(), st: freshStats(), drifts: [], ignore: new Map(),
      mountedAt: host.now(), waitUid: null, waiting: null, clearAt: 0,
      nudging: false, rate: 0, lastSeekAt: -1e9, settleUntil: 0, seeks: [], joinUntil: 0, driftSince: 0,
      buf: false, bufSince: 0, sentAt: 0, sentSt: '', my: null, counting: false, countT: 0
    };

    E.nudgeRate = () => (E.nudging ? E.rate : 0);
    E.busy = () => E.counting;

    function nudge(dir) {
      const r = nudgeRate(host.baseRate(), dir, host.rates());
      if (!E.nudging) E.st.nudges++;
      if (E.nudging && E.rate === r) return;
      E.nudging = true; E.rate = r; host.applyRate();
    }
    function release() {
      if (!E.nudging) return;
      E.nudging = false; E.rate = 0; host.applyRate();
    }
    /* every seek (automatic, join or manual) makes the player settle; automatic ones also count against the budget */
    E.noteSeek = kind => {
      const now = host.now();
      E.settleUntil = now + CFG.SETTLE_MS; E.lastSeekAt = now;
      if (kind === 'auto') { E.seeks = E.seeks.filter(t => now - t < CFG.SEEK_WINDOW); E.seeks.push(now); }
      if (kind === 'join') E.joinUntil = now + CFG.JOIN_PILL;
    };

    /* called by the page every second (and on room updates) for members: where is the player, where should it be? */
    E.correct = (cur, exp) => {
      if (host.isAdmin() || E.counting || E.buf) return;
      const d = decide({ drift: cur - exp, now: host.now(), settleUntil: E.settleUntil, lastSeekAt: E.lastSeekAt, seeks: E.seeks, nudging: E.nudging });
      if (d.action === 'seek') { release(); E.noteSeek('auto'); E.st.hardSeeks++; host.seek(host.expectedIn(CFG.SEEK_LEAD)); }
      else if (d.action === 'nudge') nudge(d.dir);
      else if (d.action === 'release') release();
    };
    E.release = release;

    E.setBuffering = b => {
      b = !!b;
      if (b === E.buf) return;
      const now = host.now();
      if (b) E.bufSince = now;
      else E.st.bufferMs += Math.max(0, now - E.bufSince);
      E.buf = b;
    };

    /* "Catch up": jump to the live position right now */
    E.catchUp = () => {
      if (host.isAdmin() || E.counting) return;
      const s = host.sample(); if (!s.ready) return;
      E.st.manual++; release(); E.noteSeek('manual'); E.joinUntil = 0; E.driftSince = 0;
      host.seek(host.expectedIn(CFG.SEEK_LEAD)); host.resume();
    };

    /* "3-2-1": park the player where the room will be when the countdown ends, then press play together */
    E.resync = () => {
      if (host.isAdmin() || E.counting) return;
      const s = host.sample(); if (!s.ready) return;
      const lead = CFG.COUNT_STEPS * 1000;
      E.st.manual++; release(); E.counting = true; E.joinUntil = 0; E.driftSince = 0;
      E.noteSeek('manual'); E.settleUntil = host.now() + lead + CFG.SETTLE_MS;
      host.seek(host.expectedIn(lead)); host.pause();
      let n = CFG.COUNT_STEPS; host.count(n);
      const step = () => {
        n--;
        if (n > 0) { host.count(n); E.countT = setTimeout(step, 1000); return; }
        host.count(0); E.counting = false; E.countT = 0;
        const s2 = host.sample();
        if (s2.ready && !s2.live && Math.abs(s2.cur - s2.exp) > 0.6) host.seek(host.expectedIn(CFG.SEEK_LEAD));
        E.noteSeek('manual'); host.resume();
      };
      E.countT = setTimeout(step, 1000);
    };

    /* another member's status report (broadcast 'sync') */
    E.onSync = p => {
      if (!p || typeof p !== 'object' || typeof p.u !== 'string' || p.u === host.me() || STATUSES.indexOf(p.st) < 0) return;
      const prev = E.map.get(p.u);
      E.map.set(p.u, { st: p.st, d: clamp(+p.d || 0, -86400, 86400), b: clamp(+p.b || 0, 0, 3600000), ts: host.now(), j: p.j ? 1 : 0 });
      if (p.st === 'ok') E.ignore.delete(p.u);           /* they recovered: a later stall counts again */
      if (!prev || prev.st !== p.st) host.changed(p.u);
    };

    /* the badge for one member (null = unknown / quiet) */
    E.statusOf = uid => {
      if (uid === host.me()) return E.my;
      const v = E.map.get(uid);
      if (!v || host.now() - v.ts > CFG.STALE) return null;
      return { st: v.st, d: v.d, b: v.b };
    };

    /* admin only: pause for everyone while a member buffers, resume when they are back (or after WAIT_MAX) */
    function adminWait(s, tgt, now) {
      const mode = host.waitMode();
      const resume = () => { E.waiting = null; E.clearAt = 0; host.adminResume(); };
      if (E.waiting) {
        if (s.playing) { E.ignore.set(E.waiting.uid, now + CFG.WAIT_IGNORE); E.waiting = null; E.clearAt = 0; return; }     /* the admin pressed play: respected */
        if (mode !== 'wait') return resume();
        if (now - E.waiting.since >= CFG.WAIT_MAX) { E.ignore.set(E.waiting.uid, now + CFG.WAIT_IGNORE); return resume(); }
        if (tgt) { E.waiting.uid = tgt.uid; E.clearAt = 0; }
        else if (!E.clearAt) E.clearAt = now;
        else if (now - E.clearAt >= CFG.RESUME_DELAY) resume();
        return;
      }
      if (mode === 'wait' && tgt && s.ready && s.playing && !s.ended) {
        E.waiting = { uid: tgt.uid, since: now }; E.clearAt = 0;
        host.adminPause(tgt.uid);
      }
    }

    /* once per second */
    E.tick = () => {
      const now = host.now(), net = host.net() || {}, admin = host.isAdmin(), me = host.me();
      if (net.down) { host.paint({ mode: 'net', n: net.n, offline: !!net.offline }); return; }
      const s = host.sample();
      if (!s.ready) { E.my = null; host.paint({ mode: 'none' }); return; }

      const settling = now < E.settleUntil || E.counting;
      const active = s.wantPlaying && !s.live && !s.ended && !settling;
      const drift = active ? s.cur - s.exp : 0;
      const bufMs = E.buf ? now - E.bufSince : 0;
      const st = statusOf({ buffering: E.buf && bufMs >= CFG.BUF_SHOW, admin, drift });
      const joiner = now - E.mountedAt < CFG.JOIN_GRACE;
      E.my = { st, d: r1(drift), b: Math.round(bufMs) };

      /* statistics: drift samples while really playing along */
      if (active && !E.buf && !joiner && !admin && s.playing) { E.drifts.push(Math.abs(drift)); if (E.drifts.length > CFG.MAX_SAMPLES) E.drifts.shift(); }

      /* report to the room: immediately on change, otherwise every REPORT_EVERY */
      if ((st !== E.sentSt || now - E.sentAt >= CFG.REPORT_EVERY) && host.connected()) {
        E.sentAt = now; E.sentSt = st;
        host.send({ u: me, st, d: r1(drift), b: Math.round(bufMs), j: joiner ? 1 : 0 });
      }

      /* who is holding the room up */
      const tgt = waitTarget(E.map, { me, now, ignore: E.ignore });
      if (admin) adminWait(s, tgt, now);
      E.waitUid = E.waiting ? E.waiting.uid : tgt ? tgt.uid : null;

      /* what to show on the video */
      if (E.waitUid && !E.buf) host.paint({ mode: 'waiting', uid: E.waitUid, pausing: host.waitMode() === 'wait' });
      else if (!admin && active && (Math.abs(drift) > CFG.NUDGE_AT || E.nudging)) {
        if (!E.driftSince) E.driftSince = now;
        if (now - E.driftSince >= CFG.DRIFT_PILL_DELAY) host.paint({ mode: 'drift', drift });
        else host.paint({ mode: 'none' });
      } else {
        E.driftSince = 0;
        if (!admin && now < E.joinUntil && s.wantPlaying) host.paint({ mode: 'join' });
        else host.paint({ mode: 'none' });
      }
    };

    /* numbers for the dashboards (median / p95 drift, nudges, seeks, manual resyncs, buffering, reconnects) */
    E.summary = () => {
      const a = E.drifts.slice().sort((x, y) => x - y);
      const q = p => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
      const now = host.now();
      return {
        samples: a.length, median_drift: r2(q(0.5)), p95_drift: r2(q(0.95)),
        nudges: E.st.nudges, hard_seeks: E.st.hardSeeks, manual_resyncs: E.st.manual,
        buffer_ms: Math.round(E.st.bufferMs + (E.buf ? Math.max(0, now - E.bufSince) : 0)),
        reconnects: E.st.reconnects, reconnect_ok: E.st.reconnectOk
      };
    };
    E.resetStats = () => { E.st = freshStats(); E.drifts = []; if (E.buf) E.bufSince = host.now(); };

    /* a new player (or leaving the room): forget everything that belonged to the old one */
    E.reset = () => {
      clearTimeout(E.countT); E.countT = 0;
      if (E.counting) { E.counting = false; host.count(0); }
      E.nudging = false; E.rate = 0; E.lastSeekAt = -1e9; E.settleUntil = 0; E.seeks = []; E.joinUntil = 0; E.driftSince = 0;
      E.buf = false; E.bufSince = 0; E.sentAt = 0; E.sentSt = ''; E.my = null; E.waiting = null; E.clearAt = 0; E.waitUid = null;
      E.ignore.clear(); E.mountedAt = host.now();
      host.paint({ mode: 'none' });
    };
    /* entering a room: also forget the other members and the statistics */
    E.resetAll = () => { E.reset(); E.map.clear(); E.resetStats(); };

    return E;
  }

  return { CFG, decide, seekAllowed, nudgeRate, statusOf, backoff, pickClock, blendClock, waitTarget, create };
});
