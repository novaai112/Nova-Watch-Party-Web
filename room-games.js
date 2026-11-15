/* room-games.js — Nova Play: interactive games inside a watch room.
 * Needs room-games-schema.sql (+ room-games-bank.sql), room.js (host bridge), room-games.css.
 * Rules: ONLY the current room admin sees / can use the control surfaces (the server enforces it again on every RPC);
 * the SERVER clock decides every round; answers stay private until the reveal.
 * The panel replaces the chat column while the Games icon is active; the chat icon brings the chat back WITHOUT leaving
 * the game; the Quit icon inside the panel is the only thing that leaves it. */
(function () {
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- catalogue ---------- */
const GAMES = [
  { id: 'trivia', name: 'Quick Trivia', cat: 'trivia', emoji: '🧠', g: ['#3b6cff', '#7c4dff'], diff: 'Easy · Medium · Hard', pl: '1+ players',
    desc: 'Everyone gets the same question at once. Pick the right answer — faster answers score more.' },
  { id: 'movie', name: 'Guess the Movie', cat: 'movies', emoji: '🎬', g: ['#ff6b6b', '#ff9f43'], diff: 'Easy · Medium · Hard', pl: '2+ players',
    desc: 'Descriptions, characters, famous scenes and emoji clues. Type your guess — it stays hidden until the round ends.' },
  { id: 'emoji', name: 'Emoji Challenge', cat: 'movies', emoji: '😎', g: ['#ffcf33', '#ff7a59'], diff: 'Easy · Medium · Hard', pl: '1+ players',
    desc: 'Movies, characters, songs and phrases told in emoji. Speed bonuses and answer streaks.' },
  { id: 'song', name: 'Guess the Song', cat: 'music', emoji: '🎵', g: ['#22c55e', '#06b6d4'], diff: 'Easy · Medium · Hard', pl: '1+ players',
    desc: 'Work out the song title or the artist from a lyric-free clue. Multiple choice, scoreboard included.' },
  { id: 'predict', name: 'Predict What Happens Next', cat: 'video', emoji: '🔮', g: ['#9b5cff', '#ff5fa2'], diff: 'Admin-made', pl: '2+ players',
    desc: 'The admin asks what happens next in the video. Lock in your prediction, then see who called it.' },
  { id: 'video', name: 'Video Knowledge Challenge', cat: 'video', emoji: '📺', g: ['#f97316', '#e11d48'], diff: 'Admin-made', pl: '2+ players',
    desc: 'The admin writes questions about what you are watching and decides when each one appears.' },
  { id: 'wyr', name: 'Would You Rather?', cat: 'social', emoji: '🤔', g: ['#14b8a6', '#3b82f6'], diff: 'No wrong answers', pl: '2+ players',
    desc: 'A quick vote with two choices. See the totals, percentages and the most popular pick.' }
];
const CATS = [['all', 'All'], ['trivia', 'Trivia'], ['movies', 'Movies'], ['music', 'Music'], ['social', 'Social'], ['video', 'Video']];
const gameOf = id => GAMES.find(g => g.id === id) || { id, name: id, emoji: '🎮', g: ['#444', '#222'], desc: '' };
const TRIVIA_CATS = ['Random Mix', 'General Knowledge', 'Science', 'Technology', 'Movies', 'Anime', 'Sports', 'History', 'Geography', 'Music'];
const DEF = { difficulty: 'medium', count: 10, seconds: 15, mode: 'individual', team_pick: 'auto', team_names: { red: 'Red Team', blue: 'Blue Team' },
  participation: 'open', order: 'random', show: 'each', changes: true, spectator: true, sound: true, lang: 'en', category: 'Random Mix',
  movie_cat: 'any', emoji_cat: 'any', emoji_mc: false, song_mode: 'mix', custom: [] };
/* which settings each game offers (the server clamps everything again) */
const FIELDS = {
  trivia: ['category', 'difficulty', 'count', 'seconds', 'mode', 'participation', 'order', 'show', 'changes', 'spectator', 'sound', 'lang', 'custom'],
  movie: ['movie_cat', 'difficulty', 'count', 'seconds', 'mode', 'participation', 'order', 'show', 'changes', 'spectator', 'sound', 'lang'],
  emoji: ['emoji_cat', 'emoji_mc', 'difficulty', 'count', 'seconds', 'mode', 'participation', 'order', 'show', 'changes', 'spectator', 'sound', 'lang'],
  song: ['song_mode', 'difficulty', 'count', 'seconds', 'mode', 'participation', 'order', 'show', 'changes', 'spectator', 'sound', 'lang'],
  predict: ['seconds', 'mode', 'participation', 'changes', 'spectator', 'sound', 'lang', 'custom'],
  video: ['seconds', 'mode', 'participation', 'changes', 'spectator', 'sound', 'lang', 'custom'],
  wyr: ['count', 'seconds', 'participation', 'changes', 'spectator', 'sound', 'lang', 'custom']
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
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9M7.5 8a2.5 2.5 0 010-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 010 5"/>'
};
const ic = (n, s) => `<svg class="gi" width="${s || 18}" height="${s || 18}" viewBox="0 0 24 24" ${ST} aria-hidden="true">${P[n] || ''}</svg>`;

/* ---------- state ---------- */
let H = null;                       /* host bridge from room.js */
let G = null;                       /* per-room state */
function fresh() {
  return { rid: '', S: null, players: [], me: null, ans: null, seq: -1, sid: '', skew: 0, rtt: 1e9, open: false, tab: 'games', cat: 'all', sheet: '', cfg: null, game: '',
    stats: null, daily: null, hist: null, dismissed: {}, ch: null, pollT: 0, tickT: 0, fetching: false, again: false, kickAt: 0, joining: '', busy: false,
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
  if (G.sheet) paintSheet();
  tickUI();
}
function viewKey() {
  const s = G.S;
  if (!s) return ['lib', G.tab, G.cat, admin() ? 1 : 0].join('|');
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
  if (!s || (s && s.status === 'ended' && G.dismissed[s.id])) loadTab();
  paintAnswer();
}
/* the parts that change without a re-build (leaderboard strip, counts) */
function updateLive() {
  const m = $('#gmini'); if (m) m.innerHTML = miniHTML();
}

function libraryHTML() {
  const tabs = [['games', 'Games'], ['daily', 'Daily'], ['history', 'History'], ['stats', 'My stats']];
  let h = `<nav class="gtabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" class="${G.tab === t[0] ? 'on' : ''}" data-g="tab" data-v="${t[0]}" aria-selected="${G.tab === t[0]}">${t[1]}</button>`).join('')}</nav>`;
  if (G.tab === 'games') {
    h += `<div class="gcats">${CATS.map(c => `<button type="button" class="${G.cat === c[0] ? 'on' : ''}" data-g="cat" data-v="${c[0]}">${c[1]}</button>`).join('')}</div>`;
    h += admin() ? '' : `<p class="gnote">${ic('lock', 14)}Only the room admin can start a game. You can join, answer and climb the leaderboard once one begins.</p>`;
    h += '<div class="ggrid">' + GAMES.filter(g => G.cat === 'all' || g.cat === G.cat).map(cardHTML).join('') + '</div>';
  } else if (G.tab === 'daily') h += dailyHTML();
  else if (G.tab === 'history') h += historyHTML();
  else h += statsHTML();
  return h;
}
function cardHTML(g) {
  return `<article class="gcard" style="--g1:${g.g[0]};--g2:${g.g[1]}">
    <div class="gthumb" aria-hidden="true"><span>${g.emoji}</span></div>
    <div class="ginfo"><h3>${esc(g.name)}</h3><p>${esc(g.desc)}</p>
      <div class="gmeta"><span>${esc(g.diff)}</span><span>${esc(g.pl)}</span></div>
      ${admin() ? `<button type="button" class="gbtn" data-g="pick" data-v="${g.id}">Select Game</button>` : ''}
    </div></article>`;
}
function dailyHTML() {
  const d = G.daily, st = G.stats;
  if (!d) return '<div class="gempty">Loading daily challenges…</div>';
  return `<div class="gxp"><div><small>Nova XP</small><b>${st ? st.xp : 0}</b></div><div><small>Title</small><b>${esc(st ? st.title : 'Rookie')}</b></div><div><small>Daily streak</small><b>${ic('flame', 15)} ${st ? st.streak : 0}</b></div></div>
    <p class="gnote">Challenges count finished games only — idle watch time and repeated automatic answers never earn rewards.</p>
    <div class="glist">${d.map(c => `<div class="grow"><div class="grow-t"><b>${esc(c.title)}</b><small>+${c.xp} XP · ${c.progress}/${c.goal}</small><i class="gbar"><u style="width:${Math.round(c.progress / c.goal * 100)}%"></u></i></div>
      ${c.claimed ? `<span class="gtag ok">${ic('check', 14)} Claimed</span>` : c.done ? `<button type="button" class="gbtn sm" data-g="claim" data-v="${esc(c.key)}">${ic('gift', 15)} Claim</button>` : '<span class="gtag">In progress</span>'}</div>`).join('')}</div>
    ${st && st.badges && st.badges.length ? `<h4 class="gh4">Badges</h4><div class="gbadges">${st.badges.map(b => `<span>${esc(BADGE[b] || b)}</span>`).join('')}</div>` : ''}`;
}
const BADGE = { first_win: '🥇 First win', streak5: '🔥 5-answer streak', team_player: '🤝 Team player', streak3: '📅 3-day streak', streak7: '🏅 7-day streak' };
function historyHTML() {
  const h = G.hist;
  if (!h) return '<div class="gempty">Loading history…</div>';
  if (!h.length) return '<div class="gempty">No finished games in this room yet.</div>';
  return '<div class="glist">' + h.map(x => {
    const g = gameOf(x.game), win = x.mode === 'team' ? (x.teams && x.teams.winner ? (x.names || {})[x.teams.winner] || x.teams.winner : 'Draw') : (x.winner ? nm(x.winner) : '—');
    const mins = Math.max(1, Math.round((x.duration_ms || 0) / 60000));
    const top = (x.ranking || []).slice(0, 3).map(r => `${esc(nm(r.user_id))} ${r.score}`).join(' · ');
    return `<div class="grow col"><div class="grow-t"><b>${g.emoji} ${esc(g.name)}</b><small>${esc(new Date(x.ended_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))} · ${mins} min · ${x.participants || 0} players · started by ${esc(nm(x.started_by))}</small>
      <small>🏆 ${esc(win)}${top ? ' — ' + top : ''}</small></div></div>`;
  }).join('') + '</div>';
}
function statsHTML() {
  const s = G.stats;
  if (!s) return '<div class="gempty">Loading your stats…</div>';
  const cell = (l, v) => `<div><small>${l}</small><b>${v}</b></div>`;
  return `<div class="gstats">${cell('Games played', s.played)}${cell('Wins', s.wins)}${cell('Correct answers', s.correct)}${cell('Points earned', s.points)}${cell('Best position', s.best_rank ? '#' + s.best_rank : '—')}${cell('Best streak', s.best_streak)}${cell('Favourite game', s.favourite ? esc(gameOf(s.favourite).name) : '—')}${cell('Nova XP', s.xp)}</div>
    <h4 class="gh4">Recent matches</h4>${(s.recent || []).length ? '<div class="glist">' + s.recent.map(r => `<div class="grow"><div class="grow-t"><b>${gameOf(r.game).emoji} ${esc(gameOf(r.game).name)}</b><small>${new Date(r.at).toLocaleDateString([], { dateStyle: 'medium' })} · #${r.rank} of ${r.players} · ${r.score} pts</small></div>${r.won ? '<span class="gtag ok">Won</span>' : ''}</div>`).join('') + '</div>' : '<div class="gempty">Play a game to see it here.</div>'}`;
}
async function loadTab() {
  if (!G) return; const g = G, t = G.tab;
  try {
    if (t === 'daily') { const [d, s] = await Promise.all([H.rpc('game_daily'), H.rpc('game_my_stats')]); if (G === g) { G.daily = d; G.stats = s; if (G.tab === 't' || G.tab === 'daily') { G.vkey = ''; paint(true); } } }
    else if (t === 'stats') { const s = await H.rpc('game_my_stats'); if (G === g) { G.stats = s; if (G.tab === 'stats') { G.vkey = ''; paint(true); } } }
    else if (t === 'history') {
      const h = await H.rpc('game_history', { p_room: g.rid, p_limit: 20 });
      if (G === g) { G.hist = h || []; const ids = []; G.hist.forEach(x => { ids.push(x.started_by); if (x.winner) ids.push(x.winner); (x.ranking || []).slice(0, 3).forEach(r => ids.push(r.user_id)); });
        if (H.load) await H.load(ids); if (G === g && G.tab === 'history') { G.vkey = ''; paint(true); } }
    }
  } catch (e) { /* tables missing → the empty state stays */ }
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
  let h = `<div class="gq"><div class="gq-top"><span class="gq-n">${q.n || s.q_idx + 1} / ${q.total || s.total}</span>${q.cat ? `<span class="gq-cat">${esc(q.cat)}</span>` : ''}<span class="gq-t" id="gqt">${locked ? ic('lock', 14) : ic('clock', 14)}<b data-gt>${locked ? 'Locked' : ''}</b></span></div>
    <div class="gq-bar"><i id="gqbar"></i></div>
    ${q.emoji ? `<div class="gq-emoji" aria-label="Emoji clue">${esc(q.emoji)}</div>` : ''}<h2 class="gq-p">${esc(q.prompt)}</h2>`;
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
    ${q.emoji ? `<div class="gq-emoji sm">${esc(q.emoji)}</div>` : ''}<h2 class="gq-p sm">${esc(q.prompt)}</h2>`;
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
  if (me && !wy) h += `<p class="gnote">${ic('star', 14)} Nova XP was added to your profile for playing.</p>`;
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
function closeSheet() { G.sheet = ''; const s = $('#gps'); if (s) { s.hidden = true; s.innerHTML = ''; } }
function openSheet(k) { G.sheet = k; const s = $('#gps'); if (s) { s.hidden = false; paintSheet(true); } }
function paintSheet(reset) {
  const el = $('#gps'); if (!el || !G.sheet) return;
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
    b = '<p class="gp-p">The final leaderboard is shown to everyone and the match is saved to the room history.</p>';
    f = `<button type="button" class="gbtn ghost" data-g="close">Keep playing</button><button type="button" class="gbtn danger" data-g="end-yes">End game</button>`;
  } else if (k === 'cfg') { t = gameOf(G.game).name; b = cfgHTML(); f = cfgFoot(); }
  else if (k === 'addq') { t = 'Add a question'; b = addqHTML(); f = `<button type="button" class="gbtn ghost" data-g="close">Cancel</button><button type="button" class="gbtn" data-g="addq-yes">Add question</button>`; }
  el.innerHTML = `<div class="gsh" role="dialog" aria-modal="true" aria-label="${esc(t)}"><div class="gsh-h"><h3>${esc(t)}</h3><button type="button" class="gb" data-g="close" aria-label="Close">${ic('x', 18)}</button></div>
    <div class="gsh-b">${b}</div>${f ? `<div class="gsh-f">${f}</div>` : ''}</div>`;
  const sb = el.querySelector('.gsh-b'); if (sb) sb.scrollTop = keep;
  el.onclick = e => { if (e.target === el) closeSheet(); };
}

/* ----- configuration (admin only) ----- */
function openConfig(id) {
  if (!admin()) return;
  G.game = id; const c = JSON.parse(JSON.stringify(DEF));
  if (id === 'video' || id === 'predict') c.seconds = 30;
  if (id === 'video' || id === 'predict') c.custom = [];
  G.cfg = c; openSheet('cfg');
}
const chip = (k, v, label, on) => `<button type="button" class="chp${on ? ' on' : ''}" data-g="set" data-k="${k}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
const swt = (k, label, on, sub) => `<label class="gsw"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" data-g="tog" data-k="${k}"${on ? ' checked' : ''}><i></i></label>`;
function cfgHTML() {
  const c = G.cfg, F = FIELDS[G.game], has = k => F.includes(k), grp = (t, inner) => `<div class="gfg"><label>${t}</label><div class="chips">${inner}</div></div>`;
  let h = '';
  if (has('category')) h += grp('Category', TRIVIA_CATS.map(x => chip('category', x, x, c.category === x)).join(''));
  if (has('movie_cat')) h += grp('Clue type', [['any', 'Any'], ['description', 'Description'], ['actor', 'Actor / character'], ['scene', 'Famous scene'], ['emoji', 'Emoji'], ['mcq', 'Multiple choice']].map(x => chip('movie_cat', x[0], x[1], c.movie_cat === x[0])).join(''));
  if (has('emoji_cat')) h += grp('Guess a', [['any', 'Anything'], ['movie', 'Movie'], ['character', 'Character'], ['song', 'Song'], ['phrase', 'Phrase']].map(x => chip('emoji_cat', x[0], x[1], c.emoji_cat === x[0])).join(''));
  if (has('song_mode')) h += grp('Guess the', [['title', 'Song title'], ['artist', 'Artist'], ['mix', 'Both']].map(x => chip('song_mode', x[0], x[1], c.song_mode === x[0])).join(''));
  if (has('difficulty')) h += grp('Difficulty', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['mix', 'Mixed']].map(x => chip('difficulty', x[0], x[1], c.difficulty === x[0])).join(''));
  if (has('count')) h += grp(G.game === 'wyr' ? 'Number of rounds' : 'Number of questions', [5, 10, 15, 20].map(x => chip('count', x, x, c.count === x)).join(''));
  if (has('seconds')) h += grp('Answer time', [5, 10, 15, 30, 60].map(x => chip('seconds', x, x + 's', c.seconds === x)).join(''));
  if (has('mode')) h += grp('Gameplay', [['individual', 'Individual'], ['team', 'Team Battle']].map(x => chip('mode', x[0], x[1], c.mode === x[0])).join(''));
  if (has('mode') && c.mode === 'team') {
    h += grp('Team assignment', [['auto', 'Automatic · equal teams'], ['choose', 'Members choose']].map(x => chip('team_pick', x[0], x[1], c.team_pick === x[0])).join(''));
    h += `<div class="gfg"><label>Team names</label><div class="gtn"><input type="text" maxlength="20" data-g="tn" data-k="red" value="${esc(c.team_names.red)}" aria-label="Red team name"><input type="text" maxlength="20" data-g="tn" data-k="blue" value="${esc(c.team_names.blue)}" aria-label="Blue team name"></div></div>`;
  }
  if (has('participation')) h += grp('Participation', [['open', 'Open to all'], ['optional', 'Optional (Join button)']].map(x => chip('participation', x[0], x[1], c.participation === x[0])).join(''));
  if (has('order')) h += grp('Question order', [['random', 'Random'], ['fixed', 'Fixed']].map(x => chip('order', x[0], x[1], c.order === x[0])).join(''));
  if (has('show')) h += grp('Show correct answer', [['each', 'After each question'], ['end', 'At the end']].map(x => chip('show', x[0], x[1], c.show === x[0])).join(''));
  h += '<div class="gsws">';
  if (has('emoji_mc')) h += swt('emoji_mc', 'Multiple-choice answers', c.emoji_mc, 'Show four options instead of typing');
  if (has('changes')) h += swt('changes', 'Allow answer changes', c.changes, 'Until the timer ends');
  if (has('spectator')) h += swt('spectator', 'Spectator mode', c.spectator, 'Late joiners watch instead of waiting for the next round');
  if (has('sound')) h += swt('sound', 'Sound effects', c.sound);
  h += '</div>';
  if (has('lang')) h += `<div class="gfg"><label for="glang">Game language</label><select id="glang" data-g="sel" data-k="lang"><option value="en" selected>English — built-in question sets</option></select><small class="gh">Custom questions can be written in any language.</small></div>`;
  if (has('custom')) h += customHTML();
  return h + summaryHTML();
}
function customHTML() {
  const c = G.cfg, need = G.game === 'video', pred = G.game === 'predict', wyr = G.game === 'wyr';
  return `<div class="gfg"><label>${need ? 'Questions about the video' : pred ? 'Prediction questions' : 'Custom questions'}${need ? '' : ' <em>(optional)</em>'}</label>
    <p class="gh">${need ? 'Write what you want to ask about the video. Mark the correct answer. You choose when each one appears.' : pred ? 'Prepare questions now, or add them while the video plays.' : 'These come first, then the built-in questions fill the rest.'}</p>
    ${c.custom.map((q, i) => `<div class="gcq"><div class="gcq-h"><b>Question ${i + 1}</b><button type="button" class="gb" data-g="cq-del" data-i="${i}" aria-label="Remove question">${ic('trash', 16)}</button></div>
      <input type="text" maxlength="200" placeholder="${wyr ? 'Would you rather…' : 'Question'}" data-g="cq" data-i="${i}" value="${esc(q.prompt)}">
      ${q.options.map((o, j) => `<div class="gco">${wyr || pred ? '<span class="gdotl"></span>' : `<input type="radio" name="cor${i}" data-g="cq-cor" data-i="${i}" data-j="${j}"${q.correct === j ? ' checked' : ''} aria-label="Correct answer ${'ABCD'[j]}">`}<input type="text" maxlength="80" placeholder="Option ${'ABCD'[j]}${j > 1 ? ' (optional)' : ''}" data-g="co" data-i="${i}" data-j="${j}" value="${esc(o)}"></div>`).join('')}</div>`).join('')}
    ${c.custom.length < 30 ? `<button type="button" class="gbtn ghost sm" data-g="cq-add">${ic('plus', 15)} Add question</button>` : ''}</div>`;
}
function validCustom() { return G.cfg.custom.filter(q => q.prompt.trim() && q.options.filter(o => o.trim()).length >= 2); }
function cfgPayload() {
  const c = JSON.parse(JSON.stringify(G.cfg)), F = FIELDS[G.game], out = {};
  F.forEach(k => { out[k] = c[k]; });
  if (F.includes('mode') && c.mode === 'team') { out.team_pick = c.team_pick; out.team_names = c.team_names; }
  if (out.custom) out.custom = validCustom().map(q => { const opts = q.options.map(o => o.trim()); const keep = []; let cor = null; opts.forEach((o, j) => { if (o) { if (j === q.correct) cor = keep.length; keep.push(o); } }); return { prompt: q.prompt.trim(), options: keep, correct: G.game === 'video' || G.game === 'trivia' ? (cor == null ? 0 : cor) : null }; });
  return out;
}
function summaryHTML() {
  const c = G.cfg, F = FIELDS[G.game], bits = [];
  if (F.includes('category')) bits.push(c.category);
  if (F.includes('movie_cat') && c.movie_cat !== 'any') bits.push(c.movie_cat); if (F.includes('emoji_cat') && c.emoji_cat !== 'any') bits.push(c.emoji_cat);
  if (F.includes('difficulty')) bits.push(c.difficulty === 'mix' ? 'Mixed' : c.difficulty[0].toUpperCase() + c.difficulty.slice(1));
  if (F.includes('count')) bits.push(c.count + (G.game === 'wyr' ? ' rounds' : ' questions'));
  if (F.includes('custom') && validCustom().length) bits.push(validCustom().length + ' custom');
  bits.push(c.seconds + 's per round', F.includes('mode') && c.mode === 'team' ? 'Team Battle' : 'Individual', c.participation === 'optional' ? 'Join button' : 'Open to all');
  return `<div class="gsum"><small>Summary</small><b>${bits.map(esc).join(' · ')}</b></div>`;
}
function cfgFoot() {
  const need = G.game === 'video' && !validCustom().length;
  return `<button type="button" class="gbtn ghost" data-g="close">Cancel</button><button type="button" class="gbtn" data-g="start"${need ? ' disabled' : ''}>${need ? 'Add a question to start' : 'Start Game'}</button>`;
}
function addqHTML() {
  const q = G.draftQ || (G.draftQ = { prompt: '', options: ['', '', '', ''], correct: 0 }), vid = G.S.game === 'video';
  return `<div class="gcq"><input type="text" maxlength="200" placeholder="Question" data-g="dq" value="${esc(q.prompt)}">
    ${q.options.map((o, j) => `<div class="gco">${vid ? `<input type="radio" name="dcor" data-g="dq-cor" data-j="${j}"${q.correct === j ? ' checked' : ''} aria-label="Correct answer ${'ABCD'[j]}">` : '<span class="gdotl"></span>'}<input type="text" maxlength="80" placeholder="Option ${'ABCD'[j]}${j > 1 ? ' (optional)' : ''}" data-g="dq-o" data-j="${j}" value="${esc(o)}"></div>`).join('')}</div>
    <p class="gh">${vid ? 'Select the radio button next to the correct answer.' : 'You will pick what really happened after the timer locks the predictions.'}</p>`;
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
  const t = e.target, d = t.dataset.g; if (!d || !G.cfg) return;
  const i = +t.dataset.i, j = +t.dataset.j;
  if (d === 'cq') G.cfg.custom[i].prompt = t.value;
  else if (d === 'co') { G.cfg.custom[i].options[j] = t.value; refreshFoot(); }
  else if (d === 'cq-cor') G.cfg.custom[i].correct = j;
  else if (d === 'tn') G.cfg.team_names[t.dataset.k] = t.value.slice(0, 20);
  else if (d === 'tog') { G.cfg[t.dataset.k] = t.checked; const s = $('.gsum'); if (s) s.outerHTML = summaryHTML(); }
  else if (d === 'dq') G.draftQ.prompt = t.value;
  else if (d === 'dq-o') G.draftQ.options[j] = t.value;
  else if (d === 'dq-cor') G.draftQ.correct = j;
  if (d === 'cq' || d === 'co') { const s = $('.gsum'); if (s) s.outerHTML = summaryHTML(); }
}
function refreshFoot() { const f = $('#gps .gsh-f'); if (f && G.sheet === 'cfg') f.innerHTML = cfgFoot(); }
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
    case 'tab': G.tab = v; G.vkey = ''; paint(true); break;
    case 'cat': G.cat = v; G.vkey = ''; paint(true); break;
    case 'pick': openConfig(v); break;
    case 'set': { const k = el.dataset.k; G.cfg[k] = /^\d+$/.test(v) && k !== 'category' ? +v : v; paintSheet(); break; }
    case 'cq-add': G.cfg.custom.push({ prompt: '', options: ['', '', '', ''], correct: 0 }); paintSheet(); break;
    case 'cq-del': G.cfg.custom.splice(+el.dataset.i, 1); paintSheet(); break;
    case 'start': act('game_start', { p_room: G.rid, p_game: G.game, p_cfg: cfgPayload() }, () => { closeSheet(); G.dismissed = {}; G.vkey = ''; }); break;
    case 'join': act('game_join', { p_session: s.id, p_team: v || null }, () => { G.me = G.me || { left: false }; }); break;
    case 'ans': answer(+el.dataset.i); break;
    case 'submit': submitText(); break;
    case 'reveal': act('game_reveal', { p_session: s.id, p_correct: +el.dataset.i < 0 ? null : +el.dataset.i }); break;
    case 'addq': G.draftQ = null; openSheet('addq'); break;
    case 'addq-yes': { const q = G.draftQ; if (!q || !q.prompt.trim()) return H.toast('Write the question first', 'err'); const opts = [], cor = []; q.options.forEach((o, j) => { if (o.trim()) { if (j === q.correct) cor.push(opts.length); opts.push(o.trim()); } });
      act('game_add_question', { p_session: s.id, p_q: { prompt: q.prompt.trim(), options: opts, correct: s.game === 'video' ? (cor[0] == null ? 0 : cor[0]) : null } }, () => { closeSheet(); G.draftQ = null; H.toast('Question added'); }); break; }
    case 'rematch': act('game_rematch', { p_session: s.id }, () => { G.dismissed = {}; G.vkey = ''; }); break;
    case 'done': G.dismissed[s.id] = true; G.vkey = ''; G.tab = 'games'; paint(true); break;
    case 'react': react(v); break;
    case 'claim': act('game_claim', { p_key: v }, r => { H.toast('+' + ((r && r.xp) || 0) + ' Nova XP'); G.vkey = ''; loadTab(); }); break;
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
