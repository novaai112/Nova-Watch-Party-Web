/* =====================================================================
   room-net.js · Nova Watch Party · NETWORK-AWARE PLAYBACK (window.NovaNet, module.exports in Node)

   What big video platforms do, scaled to a watch-party room:
     1. Connection profile   Network Information API (type / downlink / rtt / data-saver) + what actually happens
                             (3 stalls in 2 minutes = "slow", whatever the browser claims)
     2. Quality ladder (HLS) slow link: start on the lowest quality with a pessimistic bandwidth guess, climb only when
                             the measured speed allows, keep a deeper buffer. fast link: start high, capped to the
                             player size (no 1080p bytes for a phone-sized player)
     3. Warm-up              preconnect to the video host as soon as the room knows the address (no handshake at play)
     4. Stall watchdog       playback frozen -> nudge (data is there) -> restart the download at the same second ->
                             switch route (direct <-> proxy) -> keep trying; never a reload storm on a crawling link
     5. Mid-video recovery   a network error half-way through is retried from the same second with back-off
   Pure/stateless pieces are unit-tested in Node (tests/net-unit.test.js).
   ===================================================================== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovaNet = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const CFG = {
    TICK: 1000,              /* ms · watchdog period                                                            */
    NUDGE_AFTER: 2500,       /* ms · frozen with data buffered -> nudge the playhead                            */
    RELOAD_AFTER: 7000,      /* ms · frozen with nothing arriving -> restart the download (fast link)           */
    RELOAD_AFTER_SLOW: 14000,/* ms · same on a slow link: give the connection time before restarting            */
    SAME_RELOADS: 2,         /*    · restarts on the same route before the other route is used                  */
    SLOW_STALLS: 3,          /*    · this many stalls ...                                                       */
    SLOW_WINDOW: 120000,     /* ms · ... inside this window = slow link                                         */
    ERR_RETRIES: 3, ERR_BASE: 1000,
    MIN_PLAYED: 1            /* s  · errors before this are "cannot play at all", not "connection dropped"      */
  };

  const stalls = [];                     /* timestamps of real stalls (shared by every video on the page) */
  const warmed = new Set();
  const now = () => (root.Date && root.Date.now ? root.Date.now() : Date.now());
  const conn = () => { try { return (root.navigator && (root.navigator.connection || root.navigator.mozConnection || root.navigator.webkitConnection)) || {}; } catch (e) { return {}; } };

  function noteStall() { const t = now(); stalls.push(t); while (stalls.length && t - stalls[0] > CFG.SLOW_WINDOW) stalls.shift(); }

  /* { slow, tier: 'slow' | 'ok' | 'fast', saveData } */
  function profile() {
    const c = conn(), et = String(c.effectiveType || ''), dl = Number(c.downlink) || 0, rtt = Number(c.rtt) || 0;
    const t = now(); while (stalls.length && t - stalls[0] > CFG.SLOW_WINDOW) stalls.shift();
    const claimedSlow = !!c.saveData || /^(slow-2g|2g|3g)$/.test(et) || (dl > 0 && dl < 1.5) || rtt > 600;
    const slow = claimedSlow || stalls.length >= CFG.SLOW_STALLS;
    const fast = !slow && (et === '4g' || et === '') && (dl === 0 || dl >= 5) && rtt < 200 && stalls.length === 0;
    return { slow, tier: slow ? 'slow' : fast ? 'fast' : 'ok', saveData: !!c.saveData };
  }

  /* hls.js settings for this connection. opts.preview = small card preview (tiny buffer, lowest quality) */
  function hlsConfig(p, opts) {
    p = p || profile(); opts = opts || {};
    const base = { enableWorker: true, lowLatencyMode: false, startFragPrefetch: true, backBufferLength: 30,
      manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 4, fragLoadingMaxRetry: 6,
      manifestLoadingRetryDelay: 800, levelLoadingRetryDelay: 800, fragLoadingRetryDelay: 800, fragLoadingMaxRetryTimeout: 8000 };
    if (opts.preview) return Object.assign(base, { startLevel: 0, autoStartLoad: true, maxBufferLength: 4, maxMaxBufferLength: 8, capLevelToPlayerSize: true });
    if (p.slow) return Object.assign(base, {
      startLevel: 0, abrEwmaDefaultEstimate: 400000, abrBandWidthFactor: 0.75, abrBandWidthUpFactor: 0.5,   /* climb slowly, drop quickly */
      maxBufferLength: 60, maxMaxBufferLength: 180, maxBufferSize: 120 * 1000 * 1000, capLevelToPlayerSize: true });
    if (p.tier === 'ok') return Object.assign(base, {
      startLevel: -1, abrEwmaDefaultEstimate: 2000000, abrBandWidthFactor: 0.9, abrBandWidthUpFactor: 0.65,
      maxBufferLength: 40, maxMaxBufferLength: 120, capLevelToPlayerSize: true });
    return Object.assign(base, {                                                                              /* fast: best picture, no cap below the player size */
      startLevel: -1, abrEwmaDefaultEstimate: 6000000, abrBandWidthFactor: 0.95, abrBandWidthUpFactor: 0.7,
      maxBufferLength: 30, maxMaxBufferLength: 90, capLevelToPlayerSize: true });
  }

  /* open the connection to a video host early (once per host, never our own origin) */
  function preconnect(url) {
    try {
      const u = new URL(url, root.location && root.location.href);
      if (!/^https?:$/.test(u.protocol) || (root.location && u.origin === root.location.origin) || warmed.has(u.origin)) return false;
      warmed.add(u.origin);
      const l = root.document.createElement('link'); l.rel = 'preconnect'; l.href = u.origin; l.crossOrigin = 'anonymous';
      root.document.head.appendChild(l); return true;
    } catch (e) { return false; }
  }

  const bufferedAhead = (v) => {
    try { const b = v.buffered, t = v.currentTime; for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) > t + 0.5) return true; } catch (e) {}
    return false;
  };
  const online = () => { try { return !root.navigator || root.navigator.onLine !== false; } catch (e) { return true; } };

  /* Stall watchdog. hooks: { reload() -> true when another route was started, resume() }.
     Returns { stop, stats, tick } (tick is for tests). */
  function watch(v, hooks) {
    hooks = hooks || {};
    const st = { stalls: 0, nudges: 0, reloads: 0, alt: 0 };
    let lastT = -1, lastMove = now(), stuck = false, sameReloads = 0, lastAction = 0;
    const resumeAt = (t) => {
      v.addEventListener('loadedmetadata', () => { try { if (t > 0) v.currentTime = t; } catch (e) {} try { hooks.resume ? hooks.resume() : v.play && v.play(); } catch (e) {} }, { once: true });
    };
    function tick() {
      if (!v.isConnected || v.paused || v.ended || v.seeking || !online()) { lastT = v.currentTime; lastMove = now(); stuck = false; return; }
      const t = v.currentTime;
      if (Math.abs(t - lastT) > 0.05) { lastT = t; lastMove = now(); if (stuck) { stuck = false; sameReloads = 0; } return; }
      const idle = now() - lastMove, slow = profile().slow;
      if (!stuck && idle >= 1200) { stuck = true; st.stalls++; noteStall(); }
      if (now() - lastAction < 1500) return;
      if (idle >= CFG.NUDGE_AFTER && v.readyState >= 2 && bufferedAhead(v) && st.nudges <= st.reloads + 20) {     /* data is there, decoder stuck */
        lastAction = now(); st.nudges++; try { v.currentTime = t + 0.1; } catch (e) {} return;
      }
      if (idle >= (slow ? CFG.RELOAD_AFTER_SLOW : CFG.RELOAD_AFTER) && !bufferedAhead(v)) {
        lastAction = now(); lastMove = now();                                                                     /* wait a full period before the next step */
        if (sameReloads < CFG.SAME_RELOADS || !hooks.reload) {
          sameReloads++; st.reloads++;
          if (v._hls && v._hls.startLoad) { try { v._hls.startLoad(t); } catch (e) {} return; }
          resumeAt(t); v.load();
        } else {
          sameReloads = 0; st.alt++;
          let routed = false; try { routed = !!hooks.reload(); } catch (e) {}
          if (!routed) { st.reloads++; resumeAt(t); v.load(); }
        }
      }
    }
    const id = root.setInterval(tick, CFG.TICK);
    ['waiting', 'stalled'].forEach((ev) => v.addEventListener(ev, () => { lastMove = Math.min(lastMove, now()); }));
    v._novaWatch = { stop: () => root.clearInterval(id), stats: st, tick };
    return v._novaWatch;
  }

  /* The video element raised an error half-way through (network dropped). Returns true when handled here. */
  function recoverError(v, hooks) {
    hooks = hooks || {};
    const code = v.error && v.error.code, played = v.currentTime || 0;
    if (!(code === 2 || code === 4) || played < CFG.MIN_PLAYED) return false;     /* early errors: caller's own fallback */
    const n = v._netTries = (v._netTries || 0) + 1;
    if (n > CFG.ERR_RETRIES) { v._netTries = 0; return false; }
    if (n === CFG.ERR_RETRIES && hooks.reload) { try { if (hooks.reload()) return true; } catch (e) {} }  /* last try: the other route */
    const t = played;
    root.setTimeout(() => {
      if (!v.isConnected) return;
      v.addEventListener('loadedmetadata', () => { try { v.currentTime = t; } catch (e) {} try { hooks.resume ? hooks.resume() : v.play && v.play(); } catch (e) {} }, { once: true });
      v.load();
    }, CFG.ERR_BASE * Math.pow(2, n - 1));
    return true;
  }

  /* =====================================================================
     QUALITY LADDER FOR PLAIN FILES (X gives 320 / 480 / 720 / 1080 mp4 files)
     Same idea as Netflix / YouTube, for files instead of segments:
       · start rung  = what this connection and this player size can use (slow link -> lowest, fast -> as sharp as the screen shows)
       · measure     = how fast the browser really fills its buffer (not what the browser claims)
       · step DOWN at once when the buffer runs low / a stall happens / the link cannot keep up with the current rung,
                       and jump straight to the rung that fits (no 1080 -> 720 -> 480 -> 320 staircase of stalls)
       · step UP     only after a long calm: big buffer, no stall for 30 s, speed >= 2.5x the next rung
       · a rung that fails to load right after a switch is dropped and the previous one comes back
       · the viewer can lock a quality in the Video Quality menu ("Auto" hands control back)
     Every viewer runs their own copy: each member of the room gets the best picture THEIR connection can hold.
     ===================================================================== */
  const rungBps = (r) => r.b || Math.max(2e5, r.h * r.h * 4);          /* about 2.1 Mbit/s for 720, 0.9 for 480 when X gives no bitrate */

  /* media.q = [{h,u,b}] saved with the room (X importer). Returns rungs sorted low -> high, or [] when there is no choice. */
  function ladderFrom(m) {
    const out = [], seen = new Set();
    const add = (u, h, b) => { if (typeof u !== 'string' || !/^https:\/\//.test(u) || seen.has(u)) return; seen.add(u); out.push({ h: Number(h) || 0, u, b: Number(b) || 0 }); };
    (m && Array.isArray(m.q) ? m.q : []).slice(0, 6).forEach((x) => x && add(x.u, x.h, x.b));
    if (out.length && m.url) { const base = String(m.url).split('#')[0]; if (!seen.has(base)) { const d = /\/(\d{3,4})x(\d{3,4})\//.exec(base); add(base, d ? Math.min(+d[1], +d[2]) : 0, 0); } }
    out.sort((a, b) => a.h - b.h || a.b - b.b);
    return out.length > 1 ? out.map((r, i) => Object.assign(r, { i })) : [];
  }
  /* highest rung worth showing in a player this big (short side in device pixels) */
  function ceilingIndex(ladder, viewPx) {
    const lim = Math.max(360, (viewPx || 720) * 1.3); let c = 0;
    ladder.forEach((r, i) => { if (r.h <= lim) c = i; }); return c;
  }
  function pickStart(ladder, p, viewPx) {
    p = p || profile(); const c = conn(), dl = Number(c.downlink) || 0;
    const est = p.slow ? 4e5 : dl >= 9.5 ? 12e6 : dl > 0 ? dl * 1e6 * 0.6 : (p.tier === 'fast' ? 8e6 : 2e6);      /* Chrome reports at most 10 Mbit/s: that means "10 or more" */
    let idx = 0; ladder.forEach((r, i) => { if (rungBps(r) * 1.5 <= est) idx = i; });
    return Math.min(idx, ceilingIndex(ladder, viewPx));
  }
  /* pure decision. s = { i, rungs:[bit/s], ceil, ahead(s), speed(bit/s, 0 = unknown), sinceSwitch(ms), sinceStall(ms), grace(ms), playing } -> new rung index */
  function abrDecide(s) {
    const i = s.i, n = s.rungs.length; if (!s.playing || n < 2) return i;
    const cur = s.rungs[i], grace = s.grace == null ? 6000 : s.grace;
    const lowBuffer = s.ahead < 3 && s.sinceSwitch > grace;
    const justStalled = s.sinceStall < 4000 && s.sinceSwitch > 4000;
    const cannotKeepUp = s.speed > 0 && s.speed < cur * 1.15 && s.ahead < 10 && s.sinceSwitch > 6000;
    if ((lowBuffer || justStalled || cannotKeepUp) && i > 0) {
      if (s.speed > 0) { let j = 0; for (let k = 0; k < i; k++) if (s.rungs[k] * 1.3 <= s.speed) j = k; return Math.min(j, i - 1); }
      return i - 1;
    }
    if (i < Math.min(s.ceil, n - 1) && s.sinceSwitch > 20000 && s.sinceStall > 30000 && s.ahead > 12 && s.speed >= s.rungs[i + 1] * 2.5) return i + 1;
    return i;
  }
  /* is a step up worth testing? (calm + big buffer) - then the next rung is probed BEFORE the player is switched */
  function abrWantsProbe(s) {
    const n = s.rungs.length;
    return !!s.playing && s.i < Math.min(s.ceil, n - 1) && s.sinceSwitch > 20000 && s.sinceStall > 30000 && s.ahead > 12 && !(s.speed >= s.rungs[s.i + 1] * 2.5);
  }
  /* real download test: up to 1 MB of the file, timed (request start -> last byte, so latency counts against it). bit/s, 0 = unknown */
  async function probeSpeed(url, ms) {
    if (typeof root.fetch !== 'function') return 0;
    const ac = root.AbortController ? new root.AbortController() : null, timer = root.setTimeout(() => { try { ac && ac.abort(); } catch (e) {} }, ms || 5000);
    const t0 = now(); let n = 0;
    try {
      const res = await root.fetch(url, { headers: { Range: 'bytes=0-1048575' }, cache: 'no-store', signal: ac && ac.signal });
      if (!res.ok && res.status !== 206) return 0;
      const rd = res.body && res.body.getReader ? res.body.getReader() : null;
      if (rd) { for (;;) { const r = await rd.read(); if (r.done) break; n += r.value.length; } } else n = (await res.arrayBuffer()).byteLength;
    } catch (e) { if (!n) throw e; }                                     /* aborted after some data: what arrived still tells the speed */
    finally { root.clearTimeout && root.clearTimeout(timer); }
    return n >= 200000 ? n * 8 / (Math.max(50, now() - t0) / 1000) : 0;
  }
  /* hooks: { start, src(rung) -> url for the route in use, quiet(), resume(), viewPx(), changed(A) }.  Returns A (also v._abr). */
  function abr(v, ladder, hooks) {
    hooks = hooks || {};
    const bps = ladder.map(rungBps);
    const A = { ladder, level: Math.max(0, Math.min(ladder.length - 1, hooks.start | 0)), auto: true, switches: 0, speed: 0, ahead: 0, cap: ladder.length - 1, prev: -1, last: '' };
    let lastSwitch = now(), lastStall = -1e9, lastEnd = -1, lastWall = now(), probing = false, lastProbe = -1e9, probes = 0, probeFails = 0;
    const window_ = () => { try { const b = v.buffered, t = v.currentTime; for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) > t) return { ahead: b.end(i) - t, end: b.end(i) }; } catch (e) {} return { ahead: 0, end: -1 }; };
    function apply(idx, why) {
      if (idx === A.level || idx < 0 || idx >= ladder.length) return false;
      const t = v.currentTime || 0, play = !v.paused && !v.ended;
      A.prev = A.level; A.level = idx; A.switches++; A.last = why; lastSwitch = now(); lastEnd = -1; A.hold = t;          /* the player reports this second until the new file is open */
      if (hooks.quiet) hooks.quiet();                                                   /* the switch must not look like an admin pause / seek to the room */
      v.src = hooks.src ? hooks.src(ladder[idx]) : ladder[idx].u; v.load();
      v.addEventListener('loadedmetadata', () => {
        try { if (t > 0) v.currentTime = t; } catch (e) {}
        A.hold = null;
        if (play) { try { hooks.resume ? hooks.resume() : v.play(); } catch (e) {} }
        if (hooks.changed) hooks.changed(A);
      }, { once: true });
      if (hooks.changed) hooks.changed(A);
      return true;
    }
    function tick() {
      if (!v.isConnected) return;
      const w = now(), win = window_(); A.ahead = win.ahead;
      if (lastEnd >= 0 && win.end > lastEnd + 0.1 && win.ahead < 30) {                  /* the browser is downloading: how fast? (a full buffer says nothing) */
        const dt = (w - lastWall) / 1000;
        if (dt >= 0.5) { const sp = (win.end - lastEnd) * bps[A.level] / dt; A.speed = A.speed ? A.speed * 0.7 + sp * 0.3 : sp; }
      }
      lastEnd = win.end; lastWall = w;
      if (!A.auto || v.paused || v.ended || v.seeking) return;
      const st = { i: A.level, rungs: bps, ceil: Math.min(A.cap, ceilingIndex(ladder, hooks.viewPx ? hooks.viewPx() : 0)), ahead: win.ahead, speed: A.speed,
        sinceSwitch: w - lastSwitch, sinceStall: w - lastStall, playing: true };
      if (!probing && probeFails < 2 && probes < 8 && w - lastProbe > 25000 && abrWantsProbe(st)) {                    /* test the next rung's speed first */
        probing = true; lastProbe = w; probes++; const lvl = A.level, r = ladder[lvl + 1];
        Promise.resolve().then(() => (hooks.probe || probeSpeed)(hooks.src ? hooks.src(r) : r.u)).then((sp) => {
          probing = false; if (A.level !== lvl) return;
          if (sp > 0) { A.speed = sp; A.probed = sp; probeFails = 0; } else probeFails++;
        }).catch(() => { probing = false; probeFails++; });
      }
      let idx = abrDecide(st);
      if (idx > A.cap) idx = A.cap;
      if (idx !== A.level) apply(idx, idx > A.level ? 'up' : 'down');
    }
    let started = false; v.addEventListener('playing', () => { started = true; });
    v.addEventListener('waiting', () => { if (started && !v.seeking && v.readyState < 3) lastStall = now(); });      /* start-up buffering is not a stall */
    v.addEventListener('seeking', () => { lastEnd = -1; });
    A.set = (id) => { if (id === 'auto') { A.auto = true; return true; } A.auto = false; return apply(+id, 'manual'); };
    /* a rung that cannot be opened right after a switch: go back and never try it again in this session */
    A.onError = () => {
      if (A.prev < 0 || now() - lastSwitch > 10000 || A.level === A.prev) return false;
      const bad = A.level, back = A.prev; if (bad > back) A.cap = Math.min(A.cap, back);          /* a higher rung that fails is never tried again */
      return apply(back, 'revert');
    };
    A.label = () => (ladder[A.level].h ? ladder[A.level].h + 'p' : '');
    A.stop = () => root.clearInterval(id);
    const id = root.setInterval(tick, 1000);
    A.tick = tick; v._abr = A; return A;
  }

  return { CFG, profile, ladderFrom, ceilingIndex, pickStart, abrDecide, abrWantsProbe, probeSpeed, abr, rungBps, hlsConfig, preconnect, watch, recoverError, noteStall, _stalls: stalls };
});
