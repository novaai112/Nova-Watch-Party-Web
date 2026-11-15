/* room-games.js — Nova Play: interactive games inside a watch room.
 * Needs room-games-schema.sql, room.js (host bridge), room-games.css. Every question is written by the room admin
 * (text, emoji, picture, answer options or a typed answer): there is no built-in question bank.
 * Rules: ONLY the current room admin sees / can use the control surfaces (the server enforces it again on every RPC);
 * the SERVER clock decides every round; answers stay private until the reveal.
 * The panel replaces the chat column while the Games icon is active; the chat icon brings the chat back WITHOUT leaving
 * the game; the Quit icon inside the panel is the only thing that leaves it. */
(function () {
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- catalogue: game type = name + emoji only ---------- */
const GAMES = [
  { id: 'trivia', name: 'Quick Trivia', emoji: '🧠', g: ['#3b6cff', '#7c4dff'] },
  { id: 'movie', name: 'Guess the Movie', emoji: '🎬', g: ['#ff6b6b', '#ff9f43'] },
  { id: 'emoji', name: 'Emoji Challenge', emoji: '😎', g: ['#ffcf33', '#ff7a59'] },
  { id: 'song', name: 'Guess the Song', emoji: '🎵', g: ['#22c55e', '#06b6d4'] },
  { id: 'predict', name: 'Predict What Happens Next', emoji: '🔮', g: ['#9b5cff', '#ff5fa2'] },
  { id: 'video', name: 'Video Knowledge Challenge', emoji: '📺', g: ['#f97316', '#e11d48'] },
  { id: 'wyr', name: 'Would You Rather?', emoji: '🤔', g: ['#14b8a6', '#3b82f6'] }
];
const gameOf = id => GAMES.find(g => g.id === id) || { id, name: id, emoji: '🎮', g: ['#444', '#222'] };
const BUCKET = 'room-media';                       /* question pictures live in the existing private room-media bucket */
const TEXT_OK = g => g !== 'wyr' && g !== 'predict';      /* games that may use a typed answer */
const NEEDS_COR = g => g !== 'wyr' && g !== 'predict';    /* games where the admin marks the correct option */
const DEF = { seconds: 15, mode: 'individual', team_pick: 'auto', team_names: { red: 'Red Team', blue: 'Blue Team' },
  participation: 'open', order: 'fixed', show: 'each', changes: true, spectator: true, sound: true, custom: [] };
/* which settings each game offers (the server clamps everything again) */
const FIELDS = {
  trivia: ['seconds', 'mode', 'participation', 'order', 'show', 'changes', 'spectator', 'sound', 'custom'],
  movie: ['seconds', 'mode', 'participation', 'order', 'show', 'changes', 'spectator', 'sound', 'custom'],
  emoji: ['seconds', 'mode', 'participation', 'order', 'show', 'changes', 'spectator', 'sound', 'custom'],
  song: ['seconds', 'mode', 'participation', 'order', 'show', 'changes', 'spectator', 'sound', 'custom'],
  predict: ['seconds', 'mode', 'participation', 'changes', 'spectator', 'sound', 'custom'],
  video: ['seconds', 'mode', 'participation', 'changes', 'spectator', 'sound', 'custom'],
  wyr: ['seconds', 'participation', 'changes', 'spectator', 'sound', 'custom']
};
const LIVE = ['lobby', 'countdown', 'idle', 'question', 'locked', 'reveal', 'paused'];
const REACTS = ['🔥', '👏', '😂', '😮', '❤️'];

/* ---------- icons ---------- */
const ST = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const P = {
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  skip: '<polygon points="5 4 15 12 5 20 5 4"/><path d="M19 5v14"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2.5"/>',
  users: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>',
  exit: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  vol: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
  mute: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>',
  next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  flame: '<path d="M12 2s5 4 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-5 1-8z"/>',
  star: '<polygon points="12 2 15.1 8.6 22 9.3 16.8 14 18.2 21 12 17.5 5.8 21 7.2 14 2 9.3 8.9 8.6 12 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'
};
const ic = (n, s) => `<svg class="gi" width="${s || 18}" height="${s || 18}" viewBox="0 0 24 24" ${ST} aria-hidden="true">${P[n] || ''}</svg>`;

/* ---------- state ---------- */
let H = null;                       /* host bridge from room.js */
let G = null;                       /* per-room state */
function fresh() {
  return { rid: '', S: null, players: [], me: null, ans: null, seq: -1, sid: '', skew: 0, rtt: 1e9, open: false, sheet: '', cfg: null, game: '', img: {}, dismissed: {}, ch: null, pollT: 0, tickT: 0, fetching: false, again: false, kickAt: 0, joining: '', busy: false,
    prev: { sid: '', status: '', idx: -2, paused: false }, vkey: '', sel: null, toastT: 0, sound: localStorage.getItem('nova_game_sound') !== '0', audio: null, board: false, draftQ: null, ping: 0 };
}
const sNow = () => Date.now() + (G ? G.skew : 0);
const live = () => !!(G && G.S && LIVE.includes(G.S.status));
const admin = () => !!(H && H.isAdmin());
const myId = () => (H && H.me() ? H.me().id : '');
const who = id => H.who(id);
const nm = id => { const u = who(id); return u.full_name || u.username || 'Someone'; };
const av = (id, s) => window.Nova && Nova.avatar ? Nova.avatar(who(id), s) : '';
const cfg = () => (G && G.S && G.S.cfg) || {};
const team = t => (cfg().team_names || {})[t] || (t === 'red' ? 'Red Team' : 'Blue Team');
const isTeam = () => cfg().mode === 'team';

/* =====================================================================
   DATA
   ===================================================================== */
async function fetchState() {
  if (!G || !H.room()) return;
  if (G.fetching) { G.again = true; return; }
  G.fetching = true; const g = G, t0 = Date.now();
  try {
    const d = await H.rpc('game_state', { p_room: g.rid });
    if (G !== g) return;
    const t1 = Date.now(), rtt = t1 - t0;
    if (d && d.now && (rtt <= g.rtt * 1.5 + 40 || g.rtt === 1e9)) { g.skew = d.now - (t0 + t1) / 2; g.rtt = Math.min(g.rtt === 1e9 ? rtt : g.rtt, rtt) + 5; }
    apply(d || {});
  } catch (e) {
    if (/schema cache|does not exist|Could not find the function/i.test((e && e.message) || '')) { if (!g.warned) { g.warned = 1; H.toast('Run room-games-schema.sql in Supabase to enable Nova Play.', 'err'); } }
  } finally { if (G === g) { G.fetching = false; if (G.again) { G.again = false; fetchState(); } } }
}
function refresh(delay) {
  if (!G) return;
  clearTimeout(G.ping);
  G.ping = setTimeout(fetchState, delay == null ? Math.round(Math.random() * 350) : delay);
}
function apply(d) {
  const s = d.session || null, o = G.prev;
  if (!s) {
    const had = G.S; G.S = null; G.players = []; G.me = null; G.ans = null; G.sid = ''; G.seq = -1;
    if (had) { G.prev = { sid: '', status: '', idx: -2, paused: false }; }
    return paint(true);
  }
  if (s.id === G.sid && s.seq < G.seq) return;                 /* an older answer arrived late */
  const isNew = s.id !== o.sid;
  G.S = s; G.sid = s.id; G.seq = s.seq; G.players = d.players || []; G.me = d.me || null;
  G.ans = d.answer && (d.answer.choice != null || d.answer.text != null) ? d.answer : null;
  if (G.sel != null && !G.ans) G.sel = null;
  const ids = G.players.map(p => p.user_id).concat([s.admin_id, s.started_by], (s.summary && s.summary.winner) ? [s.summary.winner] : []);
  if (H.load) H.load(ids).then(() => { if (G && G.sid === s.id) paint(false); });
  events(s, isNew);
  G.prev = { sid: s.id, status: s.status, idx: s.q_idx, paused: s.status === 'paused' };
  autoJoin();
  paint(true);
}
/* sounds / toasts for things that just happened */
function events(s, isNew) {
  const o = G.prev, snd = soundOn(), name = gameOf(s.game).name;
  if (isNew && s.status !== 'ended') {
    G.dismissed = {};
    const typing = document.activeElement && document.activeElement.id === 'cmsg';
    if (s.status !== 'paused' && Date.now() - Date.parse(s.created_at) < 20000) {
      H.toast((s.admin_id === myId() ? 'You started ' : nm(s.started_by) + ' started ') + name);
      if (!G.open && !typing && s.admin_id !== myId()) setOpen(true);
    }
  }
  if (isNew) return;
  if (s.status === 'question' && (o.status !== 'question' || o.idx !== s.q_idx)) { if (snd) beep(660, .09, 'sine'); if (!G.open) flashBanner(); }
  if (s.status === 'reveal' && o.status !== 'reveal') { const r = mineResult(); if (snd && r) { if (r.ok) { beep(740, .1, 'triangle'); setTimeout(() => beep(990, .14, 'triangle'), 110); } else beep(180, .22, 'sawtooth', .06); } }
  if (s.status === 'paused' && o.status !== 'paused') H.toast(s.paused_reason === 'admin' ? 'Game paused while the room admin changes' : 'Game paused');
  if (o.status === 'paused' && s.status !== 'paused') H.toast('Game resumed');
  if (s.status === 'ended' && o.status !== 'ended') { if (snd) { beep(523, .12, 'triangle'); setTimeout(() => beep(659, .12, 'triangle'), 130); setTimeout(() => beep(784, .22, 'triangle'), 260); } if (!G.open) H.toast('Game ended' + (s.summary && s.summary.winner ? ' · Winner: ' + nm(s.summary.winner) : '')); }
}
function autoJoin() {
  const s = G.S; if (!s || s.status === 'ended' || G.me || G.joining === s.id) return;
  if ((s.cfg || {}).participation === 'optional') return;      /* the member presses Join Game */
  G.joining = s.id; H.rpc('game_join', { p_session: s.id }).then(() => refresh(80)).catch(() => {});
}
function mineResult() { const r = G.S && G.S.reveal && G.S.reveal.results; return r ? r[myId()] || null : null; }

/* =====================================================================
   SOUND (respects the Admin's Sound effects switch and the member's own mute)
   ===================================================================== */
const soundOn = () => !!(G && G.sound && cfg().sound !== false);
function beep(f, d, type, vol) {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    if (!G.audio) G.audio = new C();
    const a = G.audio, o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = f; g.gain.value = vol || .05;
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + d);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + d);
  } catch (e) {}
}

/* =====================================================================
   PANEL SHELL
   ===================================================================== */
function root() { return $('#gpanel'); }
function setOpen(on) {
  if (!G) return; G.open = !!on;
  const rm = $('#rm'), b = $('#rm .rgame'), p = root(), bn = $('#gbanner');
  if (rm) rm.classList.toggle('gv-on', G.open);
  if (b) {
    b.setAttribute('aria-pressed', G.open ? 'true' : 'false');
    b.setAttribute('aria-label', G.open ? 'Back to chat' : 'Games');
    b.title = G.open ? 'Back to chat' : 'Games';
  }
  if (p) p.hidden = !G.open;
  paintBanner();
  if (G.open) { shell(); fetchState(); paint(true); try { if (G.audio && G.audio.state === 'suspended') G.audio.resume(); } catch (e) {} }
  else if (rm) { const f = $('#feed'); if (f) f.scrollTop = f.scrollHeight; }
  syncBtn();
}
function syncBtn() {
  const b = $('#rm .rgame'); if (!b || !G) return;
  const on = live() && !G.open;
  b.classList.toggle('live', on);
  const dot = b.querySelector('.gdot'); if (dot) dot.hidden = !on;
}
function shell() {
  const p = root(); if (!p || p.dataset.ready) return;
  p.dataset.ready = '1';
  p.innerHTML = `<div class="gp"><header class="gp-h" id="gph"></header><div class="gp-m" id="gpm"><div class="gp-b" id="gpb"></div></div><footer class="gp-f" id="gpf"></footer>
    <div class="gp-sheet" id="gps" hidden></div><div class="gp-fx" id="gpfx" aria-hidden="true"></div></div>`;
  p.addEventListener('click', onClick);
  p.addEventListener('input', onInput);
  p.addEventListener('change', onInput);
  p.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'gtext') { e.preventDefault(); submitText(); } else if (e.key === 'Escape' && G.sheet) { closeSheet(); } });
}

/* =====================================================================
   RENDER
   ===================================================================== */
function paint(force) {
  if (!G) return;
  syncBtn(); paintBanner();
  if (!G.open || !root() || !root().dataset.ready) return;
  paintHead(); paintFoot();
  const key = viewKey();
  if (force && key !== G.vkey) { G.vkey = key; paintBody(); }
  else if (force) updateLive();
  if (G.sheet === 'board' || G.sheet === 'people') paintSheet();      /* only live sheets follow the data; the editor and confirm sheets are never redrawn behind the admin's back */
  tickUI();
}
function viewKey() {
  const s = G.S;
  if (!s) return ['lib', admin() ? 1 : 0].join('|');
  return [s.id, s.status, s.q_idx, s.seq && s.status !== 'question' ? s.seq : 0, admin() ? 1 : 0, G.me ? (G.me.left ? 'L' : G.me.spectator ? 'S' : 'P') : 'N', G.ans ? 'a' : '-', G.board ? 'b' : '', G.dismissed[s.id] ? 'd' : '', s.total].join('|');
}
function subtitle() {
  const s = G.S; if (!s) return 'Pick a game for the room';
  const g = gameOf(s.game);
  if (s.status === 'ended') return g.name + ' · Final results';
  if (s.status === 'lobby') return g.name + ' · Waiting for players';
  if (s.q_idx >= 0 && s.total) return g.name + ' · Round ' + (s.q_idx + 1) + '/' + s.total;
  return g.name;
}
function paintHead() {
  const h = $('#gph'); if (!h) return;
  const s = G.S, inGame = !!s && s.status !== 'ended' && G.me && !G.me.left;
  h.innerHTML = `<div class="gp-t"><i class="gp-ico" aria-hidden="true"></i><div><b>Nova Play</b><small>${esc(subtitle())}</small></div></div>
    <div class="gp-hb">
      ${s && live() ? `<span class="gp-time" id="gtime" aria-hidden="true"></span>` : ''}
      <button type="button" class="gb" data-g="sound" aria-label="${G.sound ? 'Mute game sounds' : 'Unmute game sounds'}" title="Sound">${ic(G.sound ? 'vol' : 'mute', 18)}</button>
      ${s ? `<button type="button" class="gb" data-g="board" aria-label="Leaderboard" title="Leaderboard">${ic('trophy', 18)}</button>` : ''}
      ${inGame ? `<button type="button" class="gb gb-quit" data-g="quit" aria-label="Quit game" title="Quit game">${ic('exit', 18)}</button>` : ''}
    </div>`;
}
function paintBanner() {
  const b = $('#gbanner'); if (!b) return;
  const s = G.S;
  const show = !G.open && live();
  if (!live()) { b.hidden = true; b.innerHTML = ''; return; }            /* content is always kept current so it is ready the moment the panel closes */
  b.innerHTML = `<button type="button" data-g="open"><i class="gp-ico sm" aria-hidden="true"></i><span><b>${esc(gameOf(s.game).name)}</b> is live${s.q_idx >= 0 && s.total ? ' · Round ' + (s.q_idx + 1) + '/' + s.total : ''}${s.status === 'paused' ? ' · Paused' : ''}</span><em data-gt>Open</em></button>`;
  if (!b.dataset.bound) { b.dataset.bound = 1; b.addEventListener('click', () => setOpen(true)); }
  b.hidden = !show;
}
function flashBanner() { const b = $('#gbanner'); if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); } }

/* ----- body ----- */
function paintBody() {
  const b = $('#gpb'); if (!b) return;
  const keep = b.scrollTop;
  const s = G.S;
  if (!s || (s.status === 'ended' && G.dismissed[s.id])) b.innerHTML = libraryHTML();
  else if (s.status === 'ended') b.innerHTML = endedHTML();
  else b.innerHTML = liveHTML();
  /* the Game Paused cover sits over the question area only (the admin keeps the footer's Resume button) */
  const m = b.parentNode; m.querySelectorAll(':scope > .gpaused').forEach(x => x.remove());
  const pz = b.querySelector('.gpaused'); if (pz) m.appendChild(pz);
  b.scrollTop = G.vkeyPrev === G.vkey ? keep : 0; G.vkeyPrev = G.vkey;
  paintAnswer();
}
/* the parts that change without a re-build (leaderboard strip, counts) */
function updateLive() {
  const m = $('#gmini'); if (m) m.innerHTML = miniHTML();
}

function libraryHTML() {
  return (admin() ? '' : `<p class="gnote">${ic('lock', 14)}Only the room admin can start a game.</p>`)
    + '<div class="ggrid">' + GAMES.map(cardHTML).join('') + '</div>';
}
function cardHTML(g) {
  return `<article class="gcard" style="--g1:${g.g[0]};--g2:${g.g[1]}">
    <div class="gthumb" aria-hidden="true"><span>${g.emoji}</span></div>
    <div class="ginfo"><h3>${esc(g.name)}</h3>
      ${admin() ? `<button type="button" class="gbtn" data-g="pick" data-v="${g.id}">Select Game</button>` : ''}
    </div></article>`;
}

/* ----- question pictures (signed links for the private bucket; the picture is swapped in without repainting the question) ----- */
function imgURL(path) {
  if (!path || !G) return '';
  const c = G.img, v = c[path];
  if (v) return v === 'x' ? '' : v;
  if (!c['~' + path]) {
    c['~' + path] = 1; const g = G;
    H.sb.storage.from(BUCKET).createSignedUrl(path, 3600).then(r => {
      if (G !== g) return;
      g.img[path] = r && r.data && r.data.signedUrl ? r.data.signedUrl : 'x';
      document.querySelectorAll('#gpb .gq-img.ph').forEach(el => { if (el.dataset.p === path && g.img[path] !== 'x') el.outerHTML = qImgTag(path, el.classList.contains('sm') ? 'sm' : ''); });
    }, () => { if (G === g) g.img[path] = 'x'; });
  }
  return '';
}
function qImgTag(path, cls) { const u = G.img[path]; return `<img class="gq-img${cls ? ' ' + cls : ''}" src="${esc(u)}" alt="Question picture" decoding="async">`; }
function qImgHTML(path, cls) {
  if (!path) return '';
  return imgURL(path) ? qImgTag(path, cls) : `<div class="gq-img ph${cls ? ' ' + cls : ''}" data-p="${esc(path)}" aria-hidden="true"></div>`;
}

/* ----- live game ----- */
function leaderboard(list) {
  const rows = (list || G.players).filter(p => !p.spectator && (!p.left || p.answered > 0));
  rows.sort((a, b) => b.score - a.score || b.correct - a.correct || a.ms - b.ms || (a.user_id < b.user_id ? -1 : 1));
  return rows;
}
function rowHTML(p, i) {
  const me = p.user_id === myId();
  return `<li class="lbr${me ? ' me' : ''}"><span class="lbp">${i + 1}</span><span class="lba">${av(p.user_id, 30)}${isTeam() && p.team ? `<i class="tdot ${p.team}"></i>` : ''}</span>
    <span class="lbn">${esc(me ? 'You' : nm(p.user_id))}${p.streak >= 2 ? `<em class="lbs">${ic('flame', 12)}${p.streak}</em>` : ''}</span><span class="lbc">${p.correct} ✓</span><b class="lbv">${p.score}</b></li>`;
}
function teamBar() {
  if (!isTeam()) return '';
  const t = c => { const m = G.players.filter(p => p.team === c && !p.spectator); return { s: m.reduce((a, p) => a + p.score, 0), c: m.reduce((a, p) => a + p.correct, 0), n: m.length }; };
  const r = t('red'), b = t('blue'), tot = Math.max(1, r.s + b.s);
  return `<div class="gteams"><div class="tm red"><b>${esc(team('red'))}</b><span>${r.s}</span><small>${r.n} players · ${r.c} ✓</small></div>
    <div class="tmbar"><i class="red" style="width:${r.s / tot * 100}%"></i><i class="blue" style="width:${b.s / tot * 100}%"></i></div>
    <div class="tm blue"><b>${esc(team('blue'))}</b><span>${b.s}</span><small>${b.n} players · ${b.c} ✓</small></div></div>`;
}
function miniHTML() {
  const rows = leaderboard(), idx = rows.findIndex(p => p.user_id === myId()), me = idx >= 0 ? rows[idx] : null;
  if (!rows.length) return '';
  return `<button type="button" class="gmini-b" data-g="board" aria-label="Open leaderboard">
    <span class="gm-me">${me ? `<b>#${idx + 1}</b> <i>${me.score} pts</i>${me.streak >= 2 ? `<em>${ic('flame', 12)}${me.streak}</em>` : ''}` : '<i>Spectating</i>'}</span>
    <span class="gm-top">${rows.slice(0, 3).map((p, i) => `<span class="gm-p">${i + 1}. ${esc(nm(p.user_id))} <b>${p.score}</b></span>`).join('')}</span>${ic('trophy', 15)}</button>`;
}
function liveHTML() {
  const s = G.S, eff = s.status === 'paused' ? (s.paused_phase || 'idle') : s.status;
  const player = G.me && !G.me.left;
  let h = '';
  if (!player && s.status !== 'ended') h += joinHTML();
  if (eff === 'lobby') h += lobbyHTML();
  else if (eff === 'countdown') h += `<div class="gcount"><small>Get ready</small><b id="gcd">3</b><span>${esc(gameOf(s.game).name)}</span></div>${isTeam() ? teamPickHTML() : ''}`;
  else if (eff === 'idle') h += idleHTML();
  else if (eff === 'question' || eff === 'locked') h += questionHTML(eff === 'locked');
  else if (eff === 'reveal') h += revealHTML();
  if (s.status === 'paused') h += `<div class="gpaused" role="status"><div>${ic('pause', 26)}<b>Game Paused</b><small>${s.paused_reason === 'admin' ? 'The room admin changed — waiting for the new admin to resume.' : 'The admin paused the game. Your answers and progress are safe.'}</small></div></div>`;
  return h;
}
function joinHTML() {
  const s = G.S, opt = cfg().participation === 'optional', left = G.me && G.me.left, spec = !G.me && cfg().spectator !== false && s.q_idx >= 0;
  return `<div class="gjoin"><div><b>${left ? 'You left this game' : 'A game is live'}</b><small>${left ? 'Rejoin any time while it is running.' : opt ? 'Join to play in this round.' : spec ? 'You will join as a spectator.' : 'Join to play from the next round.'}</small></div>
    ${isTeam() && cfg().team_pick === 'choose' && !G.me ? `<div class="gtp"><button type="button" class="gbtn red" data-g="join" data-v="red">${esc(team('red'))}</button><button type="button" class="gbtn blue" data-g="join" data-v="blue">${esc(team('blue'))}</button></div>`
      : `<button type="button" class="gbtn" data-g="join">${left ? 'Rejoin Game' : 'Join Game'}</button>`}</div>`;
}
function teamPickHTML() {
  if (!isTeam()) return '';
  const mine = G.me && G.me.team, can = cfg().team_pick === 'choose' && G.S.q_idx < 0 && G.me && !G.me.left;
  const col = c => { const m = G.players.filter(p => p.team === c && !p.spectator && !p.left); return `<div class="tcol ${c}"><b>${esc(team(c))}</b><small>${m.length} players</small><div class="tav">${m.slice(0, 8).map(p => `<span>${av(p.user_id, 26)}</span>`).join('')}</div>${can && mine !== c ? `<button type="button" class="gbtn sm ${c}" data-g="join" data-v="${c}">Join ${esc(team(c))}</button>` : mine === c ? '<span class="gtag ok">Your team</span>' : ''}</div>`; };
  return `<div class="gteampick">${col('red')}${col('blue')}</div>`;
}
function lobbyHTML() {
  const n = G.players.filter(p => !p.spectator && !p.left).length;
  return `<div class="gcount lobby"><small>Join window</small><b id="gcd">10</b><span>${n} player${n === 1 ? '' : 's'} in</span></div>
    <div class="gplayers">${G.players.filter(p => !p.spectator && !p.left).map(p => `<span class="gpl">${av(p.user_id, 34)}<em>${esc(p.user_id === myId() ? 'You' : nm(p.user_id))}</em></span>`).join('')}</div>${isTeam() ? teamPickHTML() : ''}`;
}
function idleHTML() {
  const s = G.S;
  return `<div class="gcount idle"><span class="gbig">${gameOf(s.game).emoji}</span><b class="gt">${admin() ? 'You decide when the next question appears' : 'Waiting for the admin to ask a question'}</b>
    <span>${s.total} question${s.total === 1 ? '' : 's'} ready</span></div>`;
}
function questionHTML(locked) {
  const s = G.S, q = s.current || {}, spectator = !G.me || G.me.left || G.me.spectator || (G.me.from_idx > s.q_idx);
  const opts = q.options || [], text = q.kind === 'text';
  let h = `<div class="gq"><div class="gq-top"><span class="gq-n">${q.n || s.q_idx + 1} / ${q.total || s.total}</span><span class="gq-t" id="gqt">${locked ? ic('lock', 14) : ic('clock', 14)}<b data-gt>${locked ? 'Locked' : ''}</b></span></div>
    <div class="gq-bar"><i id="gqbar"></i></div>
    ${q.emoji ? `<div class="gq-emoji" aria-label="Emoji clue">${esc(q.emoji)}</div>` : ''}${qImgHTML(q.image, '')}<h2 class="gq-p">${esc(q.prompt)}</h2>`;
  if (locked) h += `<div class="gq-st locked" role="status">${ic('lock', 15)} Predictions are locked${admin() ? '. Choose what really happened.' : '. Waiting for the admin to reveal the result.'}</div>`;
  if (locked && admin()) h += `<div class="gopts">${opts.map((o, i) => `<button type="button" class="gopt" data-g="reveal" data-i="${i}"><b>${'ABCD'[i]}</b><span>${esc(o)}</span></button>`).join('')}<button type="button" class="gopt ghost" data-g="reveal" data-i="-1"><b>—</b><span>Nothing matched · no points</span></button></div>`;
  else if (!text && !locked) h += `<div class="gopts" role="group" aria-label="Answer choices">${opts.map((o, i) => `<button type="button" class="gopt" data-g="ans" data-i="${i}" aria-pressed="false"${spectator ? ' disabled' : ''}><b>${'ABCD'[i]}</b><span>${esc(o)}</span></button>`).join('')}</div>`;
  else if (text && !locked) h += `<div class="gtype"><input id="gtext" type="text" maxlength="120" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" placeholder="Type your guess" aria-label="Your answer"${spectator ? ' disabled' : ''}>
    <button type="button" class="gbtn" data-g="submit"${spectator ? ' disabled' : ''}>${ic('send', 16)} Submit</button></div>`;
  if (!locked) h += `<div class="gq-st" id="gqst" role="status" aria-live="polite">${spectator ? ic('eye', 15) + ' You are spectating this round' : ''}</div>`;
  if (locked && !admin()) h += opts.length ? `<div class="gopts">${opts.map((o, i) => `<div class="gopt static${G.ans && G.ans.choice === i ? ' sel' : ''}"><b>${'ABCD'[i]}</b><span>${esc(o)}</span></div>`).join('')}</div>` : '';
  h += `<div id="gmini" class="gmini">${miniHTML()}</div></div>`;
  return h;
}
function revealHTML() {
  const s = G.S, q = s.current || {}, r = s.reveal || {}, mine = mineResult(), opts = q.options || [], counts = r.counts || [], tot = counts.reduce((a, b) => a + b, 0) || 0;
  const poll = r.kind === 'poll', most = poll && tot ? counts.indexOf(Math.max.apply(null, counts)) : -1;
  let h = `<div class="gq reveal"><div class="gq-top"><span class="gq-n">${(r.idx != null ? r.idx : s.q_idx) + 1} / ${s.total}</span><span class="gq-t"><b data-gt></b></span></div>
    ${q.emoji ? `<div class="gq-emoji sm">${esc(q.emoji)}</div>` : ''}${qImgHTML(q.image, 'sm')}<h2 class="gq-p sm">${esc(q.prompt)}</h2>`;
  if (r.kind === 'text') {
    h += r.text ? `<div class="gans"><small>Correct answer</small><b>${esc(r.text)}</b></div>` : `<div class="gq-st">${ic('lock', 15)} The answer is revealed when the game ends.</div>`;
  }
  if (opts.length) h += `<div class="gres">${opts.map((o, i) => {
    const n = counts[i] || 0, pc = tot ? Math.round(n / tot * 100) : 0, ok = !poll && r.correct === i, mineSel = G.ans && G.ans.choice === i;
    return `<div class="gr${ok ? ' ok' : ''}${poll && i === most ? ' top' : ''}${mineSel ? ' mine' : ''}"><i style="width:${pc}%"></i><span class="gr-t"><b>${'ABCD'[i]}</b>${esc(o)}${ok ? ic('check', 15) : ''}${mineSel ? '<em>You</em>' : ''}</span><span class="gr-n">${n} · ${pc}%</span></div>`;
  }).join('')}</div>`;
  if (poll) h += tot ? `<div class="gans"><small>Most popular choice</small><b>${esc(opts[most] || '')}</b><span>${tot} vote${tot === 1 ? '' : 's'}</span></div>` : '<div class="gq-st">Nobody voted this time.</div>';
  else if (mine) h += `<div class="gme ${mine.ok ? 'ok' : 'no'}"><b>${mine.ok ? '+' + mine.pts + ' pts' : mine.ans ? 'Not this time' : 'No answer'}</b>${mine.ok && mine.streak >= 2 ? `<span>${ic('flame', 14)} ${mine.streak} in a row</span>` : ''}</div>`;
  if (r.fastest && !poll) h += `<div class="gfast">⚡ Fastest correct: <b>${esc(r.fastest === myId() ? 'You' : nm(r.fastest))}</b></div>`;
  if (!poll && r.results) {
    const rs = Object.keys(r.results).filter(id => r.results[id].ans).sort((a, b) => (r.results[b].pts - r.results[a].pts) || (r.results[a].ms - r.results[b].ms)).slice(0, 6);
    if (rs.length) h += `<ul class="gwho">${rs.map(id => `<li class="${r.results[id].ok ? 'ok' : 'no'}">${av(id, 22)}<span>${esc(id === myId() ? 'You' : nm(id))}</span><b>${r.results[id].ok ? '+' + r.results[id].pts : '0'}</b></li>`).join('')}</ul>`;
  }
  h += `<div class="gnext" id="gnext">${s.cfg && s.cfg.manual ? (admin() ? 'Press Next when you are ready.' : 'Waiting for the admin…') : 'Next round starting soon…'}</div><div id="gmini" class="gmini">${miniHTML()}</div></div>`;
  return h;
}
function endedHTML() {
  const s = G.S, sm = s.summary || {}, rank = sm.ranking || [], me = rank.find(r => r.user_id === myId()), t = sm.teams, wy = s.game === 'wyr';
  let title = 'Game over', sub = '';
  if (t && t.winner) { title = team(t.winner) + ' wins'; sub = (t[t.winner].score) + ' points'; }
  else if (t) title = 'It is a draw';
  else if (sm.winner) { title = (sm.winner === myId() ? 'You win!' : nm(sm.winner) + ' wins'); sub = ((rank[0] || {}).score || 0) + ' points'; }
  else if (wy) title = 'Votes are in';
  let h = `<div class="gend"><div class="gend-h"><span class="gbig">${t || sm.winner ? '🏆' : gameOf(s.game).emoji}</span><h2>${esc(title)}</h2><small>${esc(sub || gameOf(s.game).name)}</small></div>`;
  if (t) h += teamBar2(t);
  if (rank.length && !wy) h += `<ol class="lb">${rank.map((r, i) => rowHTML({ user_id: r.user_id, score: r.score, correct: r.correct, streak: r.streak, team: r.team }, i)).join('')}</ol>`;
  if (me && !wy) h += `<div class="gstats mini"><div><small>Your position</small><b>#${me.rank}</b></div><div><small>Correct</small><b>${me.correct}/${me.answered}</b></div><div><small>Best streak</small><b>${me.streak}</b></div></div>`;
  if ((sm.review || []).length && !wy) h += `<details class="grev"><summary>Question review</summary>${sm.review.map(q => `<div><small>${q.n}. ${esc(q.emoji || '')} ${esc(q.prompt)}</small>${q.answer ? `<b>${esc(q.answer)}</b>` : ''}</div>`).join('')}</details>`;
  h += `<div class="gend-f">${admin() ? `<button type="button" class="gbtn" data-g="rematch">Rematch</button>` : ''}<button type="button" class="gbtn ghost" data-g="done">Back to games</button></div></div>`;
  return h;
}
function teamBar2(t) {
  const r = t.red, b = t.blue, tot = Math.max(1, r.score + b.score);
  return `<div class="gteams"><div class="tm red"><b>${esc(team('red'))}</b><span>${r.score}</span><small>${r.members} players · ${r.correct} ✓ · streak ${r.streak}</small></div>
    <div class="tmbar"><i class="red" style="width:${r.score / tot * 100}%"></i><i class="blue" style="width:${b.score / tot * 100}%"></i></div>
    <div class="tm blue"><b>${esc(team('blue'))}</b><span>${b.score}</span><small>${b.members} players · ${b.correct} ✓ · streak ${b.streak}</small></div></div>`;
}

/* ----- footer: reactions for everyone, admin controls ONLY for the admin ----- */
function paintFoot() {
  const f = $('#gpf'); if (!f) return;
  const s = G.S;
  if (!s || s.status === 'ended') { f.innerHTML = ''; f.hidden = true; return; }
  f.hidden = false;
  let h = `<div class="gre" role="group" aria-label="Reactions">${REACTS.map(e => `<button type="button" data-g="react" data-v="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>`;
  if (admin()) {
    const st = s.status, manual = cfg().manual;
    h += `<div class="gadm" role="group" aria-label="Admin game controls">
      ${st === 'paused' ? `<button type="button" class="ga pri" data-g="resume">${ic('play', 16)}<span>Resume</span></button>` : `<button type="button" class="ga" data-g="pause">${ic('pause', 16)}<span>Pause</span></button>`}
      ${st === 'question' || st === 'locked' ? `<button type="button" class="ga" data-g="skip"${st === 'locked' ? ' hidden' : ''}>${ic('skip', 16)}<span>Skip</span></button>` : ''}
      ${['reveal', 'idle', 'lobby', 'countdown'].includes(st) ? `<button type="button" class="ga pri" data-g="next">${ic('next', 16)}<span>${st === 'lobby' || st === 'countdown' ? 'Start now' : st === 'idle' ? 'Ask question' : 'Next'}</span></button>` : ''}
      ${manual ? `<button type="button" class="ga" data-g="addq">${ic('plus', 16)}<span>Question</span></button>` : ''}
      <button type="button" class="ga" data-g="people">${ic('users', 16)}<span>Players</span></button>
      <button type="button" class="ga danger" data-g="end">${ic('stop', 16)}<span>End</span></button></div>`;
  }
  if (f.dataset.k !== h) { f.innerHTML = h; f.dataset.k = h; }
}

/* ----- answer state ----- */
function paintAnswer() {
  const s = G.S; if (!s || s.status !== 'question') return;
  const st = $('#gqst'), changes = cfg().changes !== false, ans = G.ans;
  document.querySelectorAll('#gpb .gopt[data-g="ans"]').forEach(b => {
    const i = +b.dataset.i, on = ans ? ans.choice === i : G.sel === i;
    b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.disabled = !!(ans && !changes) || b.hasAttribute('data-off');
  });
  const inp = $('#gtext'); if (inp && ans && ans.text != null && document.activeElement !== inp && !inp.value) inp.value = ans.text;
  if (st && !st.dataset.spec) {
    const spectator = !G.me || G.me.left || G.me.spectator || G.me.from_idx > s.q_idx;
    if (!spectator) st.innerHTML = ans ? `${ic('check', 15)} Answer submitted${changes ? ' — you can change it until time runs out' : ' — locked in'}` : '<span class="mut">Choose your answer</span>';
  }
}
function tickUI() {
  if (!G || !G.S) return;
  const s = G.S, now = sNow(), left = s.phase_end > 0 ? Math.max(0, s.phase_end - now) : 0, paused = s.status === 'paused';
  const eff = paused ? s.paused_phase : s.status;
  const lv = paused ? (s.paused_left || 0) : left, secs = Math.ceil(lv / 1000);
  const total = s.phase_ms || 1;
  document.querySelectorAll('#gpb [data-gt], #gbanner [data-gt]').forEach(el => {
    if (el.closest('#gbanner')) el.textContent = paused ? 'Paused' : eff === 'question' ? secs + 's' : 'Open';
    else if (eff === 'question') el.textContent = secs + 's';
    else if (eff === 'reveal' && s.phase_end > 0) el.textContent = secs + 's';
  });
  const bar = $('#gqbar'); if (bar) { bar.style.width = (eff === 'question' ? Math.max(0, Math.min(100, lv / total * 100)) : eff === 'locked' ? 0 : 100) + '%'; bar.parentNode.classList.toggle('low', eff === 'question' && secs <= 3); }
  const cd = $('#gcd'); if (cd) cd.textContent = Math.max(0, secs);
  const head = $('#gtime'); if (head) head.textContent = (eff === 'question' || eff === 'lobby' || eff === 'countdown') ? secs + 's' : '';
  const nx = $('#gnext'); if (nx && eff === 'reveal' && s.phase_end > 0) nx.textContent = (s.q_idx + 1 < s.total ? 'Next round in ' : 'Final results in ') + secs + 's';
  if (eff === 'countdown' && !paused && secs !== G.lastBeep) { G.lastBeep = secs; if (soundOn() && secs > 0) beep(440 + (3 - secs) * 110, .08, 'sine'); }
  if (eff === 'question' && !paused && secs === 3 && G.warnIdx !== s.q_idx) { G.warnIdx = s.q_idx; if (soundOn()) beep(880, .08, 'square', .03); }
  /* a round is over on the SERVER's clock: ask the server to move on (any member may; it is idempotent) */
  if (!paused && s.phase_end > 0 && now >= s.phase_end + 120 && Date.now() - G.kickAt > 1400) { G.kickAt = Date.now(); refresh(Math.round(Math.random() * 300)); }
}

/* =====================================================================
   SHEETS: leaderboard, participants, config, quit, add question
   ===================================================================== */
/* unsaved pictures of a cancelled draft are removed from storage again (best effort); keep = the questions were saved */
function discardDrafts() {
  const list = G.sheet === 'cfg' ? ((G.cfg && G.cfg.custom) || []) : G.sheet === 'addq' ? (G.draftQ ? [G.draftQ] : []) : [];
  const paths = list.map(q => q.image).filter(Boolean);
  if (paths.length) H.sb.storage.from(BUCKET).remove(paths).then(() => {}, () => {});
}
function closeSheet(keep) {
  if (!keep) discardDrafts();
  G.sheet = ''; const s = $('#gps'); if (s) { s.hidden = true; s.innerHTML = ''; }
}
function openSheet(k) { G.sheet = k; const s = $('#gps'); if (s) { s.hidden = false; paintSheet(true); } }
function paintSheet(reset) {
  const el = $('#gps'); if (!el || !G.sheet) return;
  el.classList.toggle('still', !reset);                          /* a repaint of an open sheet must not replay the slide-in */
  const keep = reset ? 0 : (el.querySelector('.gsh-b') || {}).scrollTop || 0;
  const k = G.sheet; let t = '', b = '', f = '';
  if (k === 'board') { t = 'Leaderboard'; b = teamBar() + `<ol class="lb">${leaderboard().map(rowHTML).join('') || '<li class="gempty">No scores yet</li>'}</ol>`; }
  else if (k === 'people') {
    t = 'Participants';
    const all = G.players.slice().sort((a, b) => b.score - a.score);
    b = `<ul class="gpeople">${all.map(p => `<li>${av(p.user_id, 32)}<span>${esc(p.user_id === myId() ? 'You' : nm(p.user_id))}${p.user_id === G.S.admin_id ? '<em class="gtag">Admin</em>' : ''}</span>${isTeam() && p.team ? `<i class="tdot ${p.team}"></i>` : ''}<small>${p.spectator ? 'Spectating' : p.left ? 'Left' : p.score + ' pts'}</small></li>`).join('') || '<li class="gempty">Nobody has joined yet</li>'}</ul>`;
  } else if (k === 'quit') {
    t = 'Quit game?';
    b = `<p class="gp-p">You will leave <b>${esc(gameOf(G.S.game).name)}</b>. ${admin() ? 'You stay the host and can keep controlling it, or press End to stop it for everyone.' : 'You can rejoin any time while it is still running.'}</p>`;
    f = `<button type="button" class="gbtn ghost" data-g="close">Stay</button><button type="button" class="gbtn danger" data-g="quit-yes">Quit game</button>`;
  } else if (k === 'end') {
    t = 'End the game?';
    b = '<p class="gp-p">The final leaderboard is shown to everyone.</p>';
    f = `<button type="button" class="gbtn ghost" data-g="close">Keep playing</button><button type="button" class="gbtn danger" data-g="end-yes">End game</button>`;
  } else if (k === 'cfg') { t = gameOf(G.game).name; b = cfgHTML(); f = cfgFoot(); }
  else if (k === 'addq') { t = 'Add a question'; b = addqHTML(); f = `<button type="button" class="gbtn ghost" data-g="close">Cancel</button><button type="button" class="gbtn" data-g="addq-yes">Add question</button>`; }
  el.innerHTML = `<div class="gsh" role="dialog" aria-modal="true" aria-label="${esc(t)}"><div class="gsh-h"><h3>${esc(t)}</h3><button type="button" class="gb" data-g="close" aria-label="Close">${ic('x', 18)}</button></div>
    <div class="gsh-b">${b}</div>${f ? `<div class="gsh-f">${f}</div>` : ''}</div>`;
  const sf = el.querySelector('.gsh-f'); if (sf && k === 'cfg') sf.dataset.k = f;
  const sb = el.querySelector('.gsh-b'); if (sb) sb.scrollTop = keep;
  el.onclick = e => { if (e.target === el) closeSheet(); };
}

/* ----- configuration (admin only) ----- */
function openConfig(id) {
  if (!admin()) return;
  G.game = id; const c = JSON.parse(JSON.stringify(DEF));
  if (id === 'video' || id === 'predict') c.seconds = 30;
  c.custom = [newQ()];                                        /* start with one empty question card */
  G.cfg = c; openSheet('cfg');
}
const chip = (k, v, label, on) => `<button type="button" class="chp${on ? ' on' : ''}" data-g="set" data-k="${k}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
const swt = (k, label, on, sub) => `<label class="gsw"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" data-g="tog" data-k="${k}"${on ? ' checked' : ''}><i></i></label>`;
function cfgHTML() {
  const c = G.cfg, F = FIELDS[G.game], has = k => F.includes(k), grp = (t, inner) => `<div class="gfg"><label>${t}</label><div class="chips">${inner}</div></div>`;
  let h = '';
  if (has('custom')) h += customHTML();
  if (has('seconds')) h += grp('Answer time', [5, 10, 15, 30, 60].map(x => chip('seconds', x, x + 's', c.seconds === x)).join(''));
  if (has('mode')) h += grp('Gameplay', [['individual', 'Individual'], ['team', 'Team Battle']].map(x => chip('mode', x[0], x[1], c.mode === x[0])).join(''));
  if (has('mode') && c.mode === 'team') {
    h += grp('Team assignment', [['auto', 'Automatic · equal teams'], ['choose', 'Members choose']].map(x => chip('team_pick', x[0], x[1], c.team_pick === x[0])).join(''));
    h += `<div class="gfg"><label>Team names</label><div class="gtn"><input type="text" maxlength="20" data-g="tn" data-k="red" value="${esc(c.team_names.red)}" aria-label="Red team name"><input type="text" maxlength="20" data-g="tn" data-k="blue" value="${esc(c.team_names.blue)}" aria-label="Blue team name"></div></div>`;
  }
  if (has('participation')) h += grp('Participation', [['open', 'Open to all'], ['optional', 'Optional (Join button)']].map(x => chip('participation', x[0], x[1], c.participation === x[0])).join(''));
  if (has('order')) h += grp('Question order', [['fixed', 'My order'], ['random', 'Random']].map(x => chip('order', x[0], x[1], c.order === x[0])).join(''));
  if (has('show')) h += grp('Show correct answer', [['each', 'After each question'], ['end', 'At the end']].map(x => chip('show', x[0], x[1], c.show === x[0])).join(''));
  h += '<div class="gsws">';
  if (has('changes')) h += swt('changes', 'Allow answer changes', c.changes, 'Until the timer ends');
  if (has('spectator')) h += swt('spectator', 'Spectator mode', c.spectator, 'Late joiners watch instead of waiting for the next round');
  if (has('sound')) h += swt('sound', 'Sound effects', c.sound);
  h += '</div>';
  return h + summaryHTML();
}

/* ----- the question editor (used when starting a game and when adding a question live) ----- */
const newQ = () => ({ type: 'options', prompt: '', emoji: '', image: '', preview: '', busy: false, options: ['', '', '', ''], correct: 0, answer: '', accept: '' });
const qOf = (w, i) => w === 'd' ? G.draftQ : (G.cfg && G.cfg.custom[i]);
function qValid(q, game) {
  if (q.busy) return false;
  if (!(q.prompt.trim() || q.emoji.trim() || q.image)) return false;
  if (q.type === 'text' && TEXT_OK(game)) return !!q.answer.trim();
  const f = q.options.map(o => o.trim());
  return f.filter(Boolean).length >= 2 && (!NEEDS_COR(game) || !!f[q.correct]);
}
function qPayload(q, game) {
  const base = { prompt: q.prompt.trim(), emoji: q.emoji.trim(), image: q.image || '' };
  if (q.type === 'text' && TEXT_OK(game)) return Object.assign(base, { type: 'text', answer: q.answer.trim(), accept: q.accept.split(',').map(x => x.trim()).filter(Boolean).slice(0, 5) });
  const keep = []; let cor = null;
  q.options.forEach((o, j) => { const t = o.trim(); if (t) { if (j === q.correct) cor = keep.length; keep.push(t); } });
  return Object.assign(base, { type: 'options', options: keep, correct: NEEDS_COR(game) ? cor : null });
}
function qHint(q, game) {
  if (q.busy) return 'Uploading picture…';
  const started = q.prompt.trim() || q.emoji.trim() || q.image || q.answer.trim() || q.options.some(o => o.trim());
  if (!started || qValid(q, game)) return '';
  if (!(q.prompt.trim() || q.emoji.trim() || q.image)) return 'Add a question, an emoji or a picture.';
  if (q.type === 'text' && TEXT_OK(game)) return 'Type the correct answer.';
  if (q.options.filter(o => o.trim()).length < 2) return 'Add at least two options.';
  return NEEDS_COR(game) ? 'Pick the correct option.' : '';
}
function qEditorHTML(q, w, i, game, n) {
  const wyr = game === 'wyr', typed = q.type === 'text' && TEXT_OK(game), ad = `data-w="${w}" data-i="${i}"`;
  const hint = qHint(q, game);
  return `<div class="gcq"><div class="gcq-h"><b>${n ? 'Question ' + n : 'New question'}</b>${w === 'c' ? `<button type="button" class="gb" data-g="cq-del" data-i="${i}" aria-label="Remove question">${ic('trash', 16)}</button>` : ''}</div>
    ${TEXT_OK(game) ? `<div class="chips gcq-type" role="group" aria-label="Answer type"><button type="button" class="chp${typed ? '' : ' on'}" data-g="qtype" data-v="options" ${ad}>Answer options</button><button type="button" class="chp${typed ? ' on' : ''}" data-g="qtype" data-v="text" ${ad}>Typed answer</button></div>` : ''}
    <input type="text" maxlength="200" placeholder="${wyr ? 'Would you rather…' : 'Question'}" data-g="qf" data-f="prompt" ${ad} value="${esc(q.prompt)}" aria-label="Question">
    <div class="gcq-ex"><input type="text" maxlength="40" placeholder="Emoji clue 🎬🦁👑" data-g="qf" data-f="emoji" ${ad} value="${esc(q.emoji)}" aria-label="Emoji clue">
      <label class="gfile${q.busy ? ' busy' : ''}" title="Add a picture">${ic('image', 17)}<span>${q.preview ? 'Change' : 'Picture'}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" data-g="qimg" ${ad}${q.busy ? ' disabled' : ''}></label></div>
    ${q.preview ? `<div class="gcq-img"><img src="${esc(q.preview)}" alt="Picture for this question"><button type="button" class="gb" data-g="qimg-del" ${ad} aria-label="Remove picture">${ic('x', 16)}</button>${q.busy ? '<i class="gcq-up">Uploading…</i>' : ''}</div>` : ''}
    ${typed ? `<input type="text" maxlength="80" placeholder="Correct answer" data-g="qf" data-f="answer" ${ad} value="${esc(q.answer)}" aria-label="Correct answer">
      <input type="text" maxlength="400" placeholder="Also accept (comma separated, optional)" data-g="qf" data-f="accept" ${ad} value="${esc(q.accept)}" aria-label="Other accepted answers">`
    : q.options.map((o, j) => `<div class="gco">${NEEDS_COR(game) ? `<input type="radio" name="cor${w}${i}" data-g="qcor" ${ad} data-j="${j}"${q.correct === j ? ' checked' : ''} aria-label="Correct answer ${'ABCD'[j]}">` : '<span class="gdotl"></span>'}<input type="text" maxlength="80" placeholder="Option ${'ABCD'[j]}${j > 1 ? ' (optional)' : ''}" data-g="qf" data-f="opt" data-j="${j}" ${ad} value="${esc(o)}" aria-label="Option ${'ABCD'[j]}"></div>`).join('')}
    ${!typed && NEEDS_COR(game) ? '<p class="gh">Select the round button next to the correct option.</p>' : ''}
    ${hint ? `<p class="gh gcq-warn" role="status">${esc(hint)}</p>` : ''}</div>`;
}
function customHTML() {
  const c = G.cfg, game = G.game, need = game !== 'predict';
  return `<div class="gfg"><label>Questions${need ? '' : ' <em>(optional — you can also add them while the video plays)</em>'}</label>
    ${c.custom.map((q, i) => qEditorHTML(q, 'c', i, game, i + 1)).join('')}
    ${c.custom.length < 60 ? `<button type="button" class="gbtn ghost sm" data-g="cq-add">${ic('plus', 15)} Add question</button>` : ''}</div>`;
}
const validCustom = () => G.cfg.custom.filter(q => qValid(q, G.game));
function cfgPayload() {
  const c = JSON.parse(JSON.stringify(G.cfg)), F = FIELDS[G.game], out = {};
  F.forEach(k => { out[k] = c[k]; });
  if (F.includes('mode') && c.mode === 'team') { out.team_pick = c.team_pick; out.team_names = c.team_names; }
  out.custom = validCustom().map(q => qPayload(q, G.game));
  return out;
}
function summaryHTML() {
  const c = G.cfg, F = FIELDS[G.game], n = validCustom().length, bits = [];
  bits.push(n + (n === 1 ? ' question' : ' questions'), c.seconds + 's per round', F.includes('mode') && c.mode === 'team' ? 'Team Battle' : 'Individual', c.participation === 'optional' ? 'Join button' : 'Open to all');
  return `<div class="gsum"><small>Summary</small><b>${bits.map(esc).join(' · ')}</b></div>`;
}
function cfgFoot() {
  const busy = G.cfg.custom.some(q => q.busy), need = G.game !== 'predict' && !validCustom().length;
  return `<button type="button" class="gbtn ghost" data-g="close">Cancel</button><button type="button" class="gbtn" data-g="start"${need || busy ? ' disabled' : ''}>${busy ? 'Uploading picture…' : need ? 'Add a question to start' : 'Start Game'}</button>`;
}
function addqHTML() {
  const q = G.draftQ || (G.draftQ = newQ()), vid = G.S.game === 'video';
  return qEditorHTML(q, 'd', 0, G.S.game, 0) + `<p class="gh">${vid ? 'Everyone sees it the moment you press Ask question.' : 'You will pick what really happened after the timer locks the predictions.'}</p>`;
}

/* pictures: uploaded straight to the room-media bucket (<room>/<you>/<file>); only the path goes to the server */
async function uploadImg(f) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[f.type];
  if (!ext) throw new Error('Choose a JPG, PNG, WebP, GIF or AVIF picture');
  if (f.size > 5 * 1024 * 1024) throw new Error('That picture is over 5 MB');
  const id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + '-' + Math.random().toString(16).slice(2)).replace(/[^0-9a-f-]/g, '');
  const path = G.rid + '/' + myId() + '/' + id + '.' + ext;
  const r = await H.sb.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
  if (r.error) throw r.error;
  return path;
}
async function pickImage(el) {
  const f = el.files && el.files[0]; el.value = ''; if (!f) return;
  const q = qOf(el.dataset.w, +el.dataset.i); if (!q) return;
  if (q.image) H.sb.storage.from(BUCKET).remove([q.image]).then(() => {}, () => {});
  const g = G, tok = {}; q.up = tok; q.busy = true; q.image = ''; q.preview = URL.createObjectURL(f); paintSheet(); refreshFoot();
  try {
    const path = await uploadImg(f);
    if (G !== g) return;
    if (q.up !== tok) { H.sb.storage.from(BUCKET).remove([path]).then(() => {}, () => {}); return; }   /* removed while uploading */
    q.image = path;
  } catch (e) {
    if (G !== g || q.up !== tok) return;
    q.preview = ''; H.toast((e && e.message) || 'Could not upload the picture', 'err');
  } finally { if (G === g && q.up === tok) { q.busy = false; if (G.sheet) { paintSheet(); refreshFoot(); } } }
}

/* =====================================================================
   EVENTS
   ===================================================================== */
async function act(name, args, ok) {
  if (G.busy) return; G.busy = true;
  try { const r = await H.rpc(name, args); if (ok) ok(r); } catch (e) { H.toast((e && e.message) || 'Something went wrong', 'err'); }
  finally { if (G) G.busy = false; refresh(60); }
}
function submitText() {
  const s = G.S; if (!s || s.status !== 'question') return;
  const i = $('#gtext'); if (!i || i.disabled) return; const t = i.value.trim(); if (!t) return;
  if (G.ans && cfg().changes === false) return;
  const sid = s.id; G.ans = { choice: null, text: t }; paintAnswer();
  H.rpc('game_answer', { p_session: sid, p_text: t }).catch(e => { G.ans = null; paintAnswer(); H.toast((e && e.message) || 'Could not send your answer', 'err'); });
}
function onInput(e) {
  const t = e.target, d = t.dataset.g; if (!d) return;
  const i = +t.dataset.i, j = +t.dataset.j;
  if (d === 'qf' || d === 'qcor' || d === 'qimg') {
    if (d === 'qimg') { if (e.type === 'change') pickImage(t); return; }
    const q = qOf(t.dataset.w, i); if (!q) return;
    if (d === 'qcor') q.correct = j;
    else if (t.dataset.f === 'opt') q.options[j] = t.value;
    else q[t.dataset.f] = t.value;
  } else if (!G.cfg) return;
  else if (d === 'tn') G.cfg.team_names[t.dataset.k] = t.value.slice(0, 20);
  else if (d === 'tog') G.cfg[t.dataset.k] = t.checked;
  if (d === 'qf' || d === 'qcor') refreshHint(t);
  if (G.sheet === 'cfg') { const sm = $('.gsum'); if (sm) sm.outerHTML = summaryHTML(); refreshFoot(); }
}
/* keep the small "what is missing" line under a question current while typing (no repaint, so focus is never lost) */
function refreshHint(t) {
  const box = t.closest('.gcq'), q = qOf(t.dataset.w, +t.dataset.i); if (!box || !q) return;
  const game = t.dataset.w === 'd' ? G.S.game : G.game, h = qHint(q, game); let el = box.querySelector('.gcq-warn');
  if (!h) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('p'); el.className = 'gh gcq-warn'; el.setAttribute('role', 'status'); box.appendChild(el); }
  el.textContent = h;
}
/* only touch the footer when its content really changed: rebuilding it while a finger is on Start would swallow the tap */
function refreshFoot() {
  const f = $('#gps .gsh-f'); if (!f || G.sheet !== 'cfg' || !G.cfg) return;
  const h = cfgFoot(); if (f.dataset.k !== h) { f.innerHTML = h; f.dataset.k = h; }
}
function onClick(e) {
  const el = e.target.closest('[data-g]'); if (!el || !G) return;
  const d = el.dataset.g, v = el.dataset.v, s = G.S;
  if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') return;
  if (G.audio && G.audio.state === 'suspended') { try { G.audio.resume(); } catch (x) {} }
  switch (d) {
    case 'close': closeSheet(); break;
    case 'sound': G.sound = !G.sound; localStorage.setItem('nova_game_sound', G.sound ? '1' : '0'); paintHead(); break;
    case 'board': G.sheet === 'board' ? closeSheet() : openSheet('board'); break;
    case 'people': openSheet('people'); break;
    case 'quit': openSheet('quit'); break;
    case 'quit-yes': closeSheet(); act('game_leave', { p_session: s.id }, () => { G.me = Object.assign({}, G.me, { left: true }); setOpen(false); H.toast('You left the game'); }); break;
    case 'end': openSheet('end'); break;
    case 'end-yes': closeSheet(); act('game_end', { p_session: s.id }); break;
    case 'pause': act('game_pause', { p_session: s.id }); break;
    case 'resume': act('game_resume', { p_session: s.id }); break;
    case 'skip': act('game_skip', { p_session: s.id }); break;
    case 'next': act('game_next', { p_session: s.id }); break;
    case 'pick': openConfig(v); break;
    case 'set': { const k = el.dataset.k; G.cfg[k] = /^\d+$/.test(v) ? +v : v; paintSheet(); break; }
    case 'cq-add': G.cfg.custom.push(newQ()); paintSheet(); break;
    case 'cq-del': { const q = G.cfg.custom[+el.dataset.i]; if (q && q.image) H.sb.storage.from(BUCKET).remove([q.image]).then(() => {}, () => {}); if (q) q.up = null; G.cfg.custom.splice(+el.dataset.i, 1); if (!G.cfg.custom.length) G.cfg.custom.push(newQ()); paintSheet(); break; }
    case 'qtype': { const q = qOf(el.dataset.w, +el.dataset.i); if (q) { q.type = v; paintSheet(); refreshFoot(); } break; }
    case 'qimg-del': { const q = qOf(el.dataset.w, +el.dataset.i); if (q) { if (q.image) H.sb.storage.from(BUCKET).remove([q.image]).then(() => {}, () => {}); q.up = null; q.busy = false; q.image = ''; q.preview = ''; paintSheet(); refreshFoot(); } break; }
    case 'start': act('game_start', { p_room: G.rid, p_game: G.game, p_cfg: cfgPayload() }, () => { closeSheet(true); G.dismissed = {}; G.vkey = ''; }); break;
    case 'join': act('game_join', { p_session: s.id, p_team: v || null }, () => { G.me = G.me || { left: false }; }); break;
    case 'ans': answer(+el.dataset.i); break;
    case 'submit': submitText(); break;
    case 'reveal': act('game_reveal', { p_session: s.id, p_correct: +el.dataset.i < 0 ? null : +el.dataset.i }); break;
    case 'addq': G.draftQ = null; openSheet('addq'); break;
    case 'addq-yes': { const q = G.draftQ; if (!q || !qValid(q, s.game)) return H.toast(q && q.busy ? 'Wait for the picture to finish uploading' : 'Complete the question first (question, options' + (s.game === 'video' ? ', correct answer' : '') + ')', 'err');
      act('game_add_question', { p_session: s.id, p_q: qPayload(q, s.game) }, () => { closeSheet(true); G.draftQ = null; H.toast('Question added'); }); break; }
    case 'rematch': act('game_rematch', { p_session: s.id }, () => { G.dismissed = {}; G.vkey = ''; }); break;
    case 'done': G.dismissed[s.id] = true; G.vkey = ''; paint(true); break;
    case 'react': react(v); break;
    case 'open': setOpen(true); break;
  }
}
async function answer(i) {
  const s = G.S; if (!s || s.status !== 'question' || !G.me || G.me.left) return;
  if (G.ans && cfg().changes === false) return;
  if (G.ans && G.ans.choice === i) return;
  const prev = G.ans; G.ans = { choice: i, text: null }; G.sel = i; paintAnswer();
  if (soundOn()) beep(520, .05, 'sine');
  try { await H.rpc('game_answer', { p_session: s.id, p_choice: i }); }
  catch (e) { G.ans = prev; G.sel = prev ? prev.choice : null; paintAnswer(); H.toast((e && e.message) || 'Could not send your answer', 'err'); }
}

/* ----- reactions (broadcast only: nothing is stored) ----- */
function react(e) { if (!G || !G.ch) return; floatEmoji(e); try { G.ch.send({ type: 'broadcast', event: 'react', payload: { u: myId(), e } }); } catch (x) {} }
function floatEmoji(e) {
  const fx = $('#gpfx'); if (!fx || !G.open || !REACTS.includes(e)) return;
  const n = document.createElement('span'); n.textContent = e; n.style.left = (10 + Math.random() * 80) + '%'; fx.appendChild(n);
  setTimeout(() => n.remove(), 1800);
}

/* =====================================================================
   LIFECYCLE
   ===================================================================== */
function attach(host) {
  detach(); H = host; G = fresh();
  const R = H.room(); if (!R) return; G.rid = R.id;
  const g = G;
  g.ch = H.sb.channel('nova-games-' + R.id, { config: { broadcast: { self: false } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions', filter: 'room_id=eq.' + R.id }, () => refresh())
    .on('broadcast', { event: 'react' }, ({ payload }) => { if (payload && payload.u !== myId()) floatEmoji(payload.e); })
    .subscribe();
  g.tickT = setInterval(() => { if (G === g) tickUI(); }, 250);
  g.pollT = setInterval(() => { if (G === g && !document.hidden) fetchState(); }, 6000);   /* safety net if realtime drops */
  fetchState();
}
function detach() {
  if (!G) return;
  clearInterval(G.tickT); clearInterval(G.pollT); clearTimeout(G.ping);
  if (G.ch && H) { try { H.sb.removeChannel(G.ch); } catch (e) {} }
  try { if (G.audio) G.audio.close(); } catch (e) {}
  const rm = $('#rm'); if (rm) rm.classList.remove('gv-on');
  G = null;
}
function toggle() { if (!G) return; setOpen(!G.open); }
function adminChanged() { if (!G) return; G.vkey = ''; if (G.sheet && !admin() && ['cfg', 'end', 'addq'].includes(G.sheet)) closeSheet(); paint(true); }

window.NovaGames = { attach, detach, toggle, adminChanged, isOpen: () => !!(G && G.open), refresh: () => refresh(0) };
})();
