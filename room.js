/* room.js — Nova watch-party rooms (needs rooms-schema.sql, config.js, nova-core.js, room.css) */
(function () {
'use strict';
if (!window.Nova || !Nova.sb) { console.warn('room.js: nova-core.js / Supabase missing'); return; }
const sb = Nova.sb, esc = Nova.esc, CFG = window.APP_CONFIG || {};
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [].slice.call((r || document).querySelectorAll(s));

/* ---------- icons ---------- */
const ST = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const PATH = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z"/><circle cx="12" cy="10" r="3"/>',
  users: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  ff: '<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>',
  skip: '<polygon points="5 4 15 12 5 20 5 4"/><path d="M19 5v14"/>',
  crown: '<path d="M2 20h20M4 17L2 6l6 5 4-7 4 7 6-5-2 11z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v4M8 22h8"/>',
  micoff: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v4M8 22h8M3 3l18 18"/>',
  vol: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
  phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  dock: '<rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="M10 3v18M7.4 9.2 5.4 12l2 2.8"/>',
  searchplay: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="M21 21l-5.2-5.2"/><polygon points="9 7.5 13.5 10.5 9 13.5 9 7.5"/>',
  heart: '<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z"/>',
  clap: '<rect x="3" y="9" width="18" height="12" rx="2.5"/><path d="M3 9l2.2-4.5h14.6L21 9M8.6 4.5 6.4 9M13.8 4.5 11.6 9M19 4.5 16.8 9"/><polygon points="10.5 13 15.2 15.5 10.5 18"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8"/>',
  userplus: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  ghost: '<path d="M9 10h.01M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>'
};
const ic = (n, s) => `<svg class="ic" width="${s || 22}" height="${s || 22}" viewBox="0 0 24 24" ${ST} aria-hidden="true">${PATH[n] || ''}</svg>`;

const PRIV = [
  ['public', 'globe', 'Public', 'Anyone can join the room'],
  ['nearby', 'pin', 'Nearby', 'People near you can join'],
  ['friends', 'users', 'Friends only', "Only the host's friends can join"],
  ['invite', 'lock', 'Invite only', 'Only people you invite can join']
];
const MODES = [
  ['vote', 'check', "Let's vote", 'Everyone votes; the most-voted video plays when this one ends'],
  ['play', 'play', 'Just play', 'This video plays, then stops until the leader picks the next one'],
  ['autoplay', 'ff', 'Autoplay', 'The next video in Up next plays by itself'],
  ['leader', 'crown', "Leader's choice", 'Only the leader chooses what plays next']
];

/* default videos so "More videos" / a vote is never empty (keep in sync with _room_defaults() in rooms-schema.sql) */
const DEFAULTS = [
  ['dQw4w9WgXcQ', 'Rick Astley - Never Gonna Give You Up'], ['9bZkp7q19f0', 'PSY - GANGNAM STYLE'],
  ['kJQP7kiw5Fk', 'Luis Fonsi - Despacito ft. Daddy Yankee'], ['JGwWNGJdvx8', 'Ed Sheeran - Shape of You'],
  ['fJ9rUzIMcZQ', 'Queen - Bohemian Rhapsody'], ['RgKAFK5djSk', 'Wiz Khalifa - See You Again ft. Charlie Puth'],
  ['OPf0YbXqDm0', 'Mark Ronson - Uptown Funk ft. Bruno Mars'], ['YQHsXMglC9A', 'Adele - Hello']
].map(d => ({ kind: 'youtube', provider: 'youtube', id: d[0], title: d[1] }));
const mkey = m => m ? [m.kind, m.id || '', m.pl || '', String(m.url || '').split('#')[0]].join('|') : '';
const PLAT = { youtube: 'YouTube', x: 'X', drive: 'Google Drive', twitch: 'Twitch', netflix: 'Netflix', prime: 'Prime Video', crunchyroll: 'Crunchyroll', web: 'Web', live: 'YouTube Live', playlist: 'YouTube', photos: 'Photos' };
const YT_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="1" y="4.5" width="22" height="15" rx="4.2" fill="#f00"/><path d="M10 9v6l5.2-3z" fill="#fff"/></svg>';
/* only the platform icon is shown on the video — never the platform's own title / share / watch-later bars */
function platBadge(m, cls) {
  if (!m) return '';
  const key = m.kind === 'youtube' ? 'youtube' : (m.provider || m.kind || 'web'), src = (window.ICON || {})[key];
  const name = PLAT[key] || (key.charAt(0).toUpperCase() + key.slice(1));
  return `<span class="pbg ${cls || ''}" title="${esc(name)}" aria-label="${esc(name)}">${src ? `<img src="${src}" alt="">` : key === 'youtube' ? YT_SVG : ic('globe', 16)}</span>`;
}

/* ---------- state ---------- */
let ME = null, R = null, members = [], queue = [], msgs = [], prof = {}, ch = null;
let skew = 0, hbT = null, tickT = null, homeT = null, homeRooms = [], mountKey = '', advAt = 0, endedAt = 0, pubT = 0, pubAt = 0;
let homeLoaded = false, homeLoading = false, homeLoadError = '', homeErrorNotified = '';
let roomSchemaWarned = false;
let ui = { more: false, moreAuto: false, moreDismiss: '', voteSeen: false, sheet: '', tab: 'members', privTried: false, vol: +(localStorage.getItem('nova_vol') || 50), friends: [], first: true, events: [], nowKeys: {} };
const micMap = new Map(), speak = new Map(), vad = new Map();
const mutedUsers = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('nova_room_muted_users') || '[]');
  if (Array.isArray(saved)) saved.filter(x => typeof x === 'string').forEach(x => mutedUsers.add(x));
} catch (e) {}
let pressTimer = null, longPressed = false;
let actx = null, vadT = null, micAt = 0;
let P = freshP();
function freshP() { return { kind: '', ready: false, yt: null, video: null, mute: 0, lastT: 0, lastC: 0, drag: false }; }

const isAdmin = () => !!(R && ME && R.admin_id === ME.id);
const who = id => prof[id] || { id, full_name: 'Someone', username: 'user' };
const nm = u => u.full_name || u.username || 'Someone';
const snow = () => Date.now() + skew;
const toast = (m, k) => Nova.toast(m, k);
const afterPick = () => { try { if (window.novaAfterPick) window.novaAfterPick(); } catch (e) {} };
const profileHref = id => 'profile.html#user/' + encodeURIComponent(id);
function userAvatar(u, size, active, isHost) {
  const id = String(u.id || ''), host = !!isHost || !!(R && id === R.admin_id);
  if (!id) return Nova.avatar(u, size);
  return `<button type="button" class="uav${active ? ' mic-on' : ''}${host ? ' host' : ''}" style="width:${size}px;height:${size}px" data-user-id="${esc(id)}" aria-label="Open ${esc(nm(u))}'s profile" title="${esc(nm(u))}">${Nova.avatar(u, Math.max(12, size - 4))}${Nova.geo ? Nova.geo.badge(u, size) : ''}</button>`;
}
const oops = e => {
  const m = (e && e.message) || 'Something went wrong';
  toast(/schema cache|does not exist|Could not find the function/i.test(m) ? 'Run rooms-schema.sql in Supabase first.' : m, 'err');
};
async function rpc(n, a, signal) {
  let request = sb.rpc(n, a || {});
  if (signal && typeof request.abortSignal === 'function') request = request.abortSignal(signal);
  const r = await request;
  if (r.error) throw r.error;
  return r.data;
}
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const thumb = m => !m ? '' : m.thumb || (m.id ? 'https://i.ytimg.com/vi/' + m.id + '/mqdefault.jpg' : '');
const safeHttps = u => /^https:\/\/[^\s<>"']+$/.test(u || '');

async function auth() {
  if (ME) return ME;
  const { data } = await sb.auth.getSession();
  ME = data.session ? data.session.user : null;
  return ME;
}
sb.auth.onAuthStateChange((e, s) => { ME = s ? s.user : null; if (!ME && R) cleanup(); });

async function loadProfiles(ids) {
  const miss = [...new Set(ids)].filter(i => i && !prof[i]);
  if (!miss.length) return;
  const { data } = await sb.from('public_profiles').select('id,full_name,username,avatar_url,country,country_code,city,region,location_lat,location_lng').in('id', miss);
  (data || []).forEach(p => { prof[p.id] = p; });
}
async function syncClock() {
  const t0 = Date.now();
  try { const d = await rpc('room_now'); const t1 = Date.now(); skew = Number(d) - (t0 + t1) / 2; } catch (e) { skew = 0; }
}
function cachedPos() {
  try { const c = JSON.parse(sessionStorage.getItem('nova_pos') || 'null'); if (c && Date.now() - c.t < 600000) return c; } catch (e) {}
  return null;
}
function getPos(fresh) {
  return new Promise(res => {
    if (!fresh) { const c = cachedPos(); if (c) return res(c); }
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => {
      const o = { lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now() };
      try { sessionStorage.setItem('nova_pos', JSON.stringify(o)); } catch (e) {}
      res(o);
    }, () => res(null), { timeout: 8000, maximumAge: fresh ? 0 : 600000 });
  });
}
function link() {
  const base = /^https?:$/.test(location.protocol) ? location.origin + location.pathname
    : (CFG.WEBSITE_URL || '').replace(/\/?$/, '/') + 'nova-home.html';
  return base + '#join/' + R.code;
}

/* ---------- small dialog (join restrictions, location explanation) ---------- */
function gate(o) {
  return new Promise(res => {
    const old = document.getElementById('nvg'); if (old) old.remove();
    const el = document.createElement('div'); el.id = 'nvg'; el.className = 'nvg'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="nvg-b"><span class="nvg-i">${ic(o.icon || 'lock', 26)}</span><h3>${esc(o.title)}</h3><p>${esc(o.text)}</p><div class="nvg-a">${(o.actions || [{ label: 'OK', value: 'ok', primary: true }]).map(a => `<button type="button" class="${a.primary ? 'p' : 's'}" data-v="${esc(a.value)}">${esc(a.label)}</button>`).join('')}</div></div>`;
    const done = v => { el.remove(); document.removeEventListener('keydown', onKey, true); res(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done('close'); } };
    el.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v); else if (e.target === el) done('close'); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(el);
    const f = el.querySelector('.p') || el.querySelector('button'); if (f) f.focus();
  });
}
/* location is asked only when a Nearby room really needs it, with the reason explained first */
async function locationReady(why) {
  const c = cachedPos(); if (c) return c;
  let granted = false;
  try { granted = (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch (e) {}
  if (!granted) {
    const v = await gate({ icon: 'pin', title: 'Use your location?', actions: [{ label: 'Allow location', value: 'go', primary: true }, { label: 'Not now', value: 'no' }],
      text: why === 'host' ? 'Nearby rooms are shown only to people close to you, so Nova needs your location to set this room up. It is used to match nearby people and is never shown to others.'
        : 'This Watch Party is for people nearby. Nova needs your location to check that you are close enough to join. It is not shared with the host or other members.' });
    if (v !== 'go') return null;
  }
  return getPos(true);
}

/* =====================================================================
   ENTER / LEAVE
   ===================================================================== */
async function enter(row) {
  cleanup(true);
  await syncClock();
  R = row; members = []; queue = []; msgs = []; mountKey = '';
  ui.first = true; ui.sheet = ''; ui.events = []; ui.nowKeys = {}; micMap.clear(); speak.clear();
  ui.privTried = false;
  document.body.classList.add('inroom');
  buildShell();
  await Promise.all([refreshRoom(), refreshMembers(), refreshQueue(), loadMsgs()]);
  if (!R) return;
  subscribe();
  hbT = setInterval(beat, 15000);
  tickT = setInterval(onTick, 1000);
  renderAll();
  await mountMedia();
  afterPick();
  try { history.replaceState({ v: 'room' }, '', location.pathname + location.search + '#room'); } catch (e) {}
}
function cleanup(keepShell) {
  clearInterval(hbT); clearInterval(tickT); hbT = tickT = null;
  if (ch) { try { sb.removeChannel(ch); } catch (e) {} ch = null; }
  closeAllPeers(); stopMic();
  if (window.NovaRoomMedia) NovaRoomMedia.reset();
  clearInterval(vadT); vadT = null; vad.clear(); speak.clear(); micMap.clear();
  destroyPlayer();
  R = null; members = []; queue = []; msgs = []; mountKey = '';
  if (!keepShell) {
    const rm = $('#rm'); if (rm) rm.remove();
    document.body.classList.remove('inroom');
    if (window.NovaDock) NovaDock.close(true);
    loadHome();
  }
}
function gone(msg) {
  if (msg) toast(msg);
  cleanup();
}
async function leave() {
  if (!R) return;
  const many = members.length > 1;
  const q = isAdmin() && many ? 'Leave this room? Admin passes to the member who has been here longest.'
    : many ? 'Leave this room?' : 'Leave? The room closes when nobody is left.';
  if (!confirm(q)) return;
  const id = R.id;
  try { await rpc('leave_room', { p_room: id }); } catch (e) {}
  cleanup();
}

/* =====================================================================
   DATA
   ===================================================================== */
async function refreshRoom() {
  const { data } = await sb.from('rooms').select('*').eq('id', R.id).maybeSingle();
  if (!data) return gone('Room closed');
  if (data.status === 'closed') return gone('Room closed');
  R = data;
}
async function refreshMembers() {
  if (!R) return;
  let result = await sb.from('room_members').select('user_id,joined_at,mic_allowed').eq('room_id', R.id).order('joined_at');
  if (result.error && /mic_allowed/i.test(result.error.message || '')) {
    if (!roomSchemaWarned) { toast('Run the latest rooms-schema.sql to enable member microphone controls', 'err'); roomSchemaWarned = true; }
    result = await sb.from('room_members').select('user_id,joined_at').eq('room_id', R.id).order('joined_at');
    if (!result.error) result.data = (result.data || []).map(m => Object.assign({ mic_allowed: false }, m));
  }
  if (result.error) { oops(result.error); return; }
  members = result.data || [];
  await loadProfiles(members.map(m => m.user_id));
  if (!members.length) { beat(); return; }
  renderHead(); renderSheet(); renderFeed(); voiceSync(); renderVoice();
}
async function refreshQueue() {
  if (!R) return;
  let res = await sb.from('room_queue').select('id,added_by,media,votes,created_at,suggested,pos').eq('room_id', R.id).order('pos').order('created_at');
  if (res.error) res = await sb.from('room_queue').select('id,added_by,media,votes,created_at,suggested').eq('room_id', R.id).order('created_at');
  if (res.error) res = await sb.from('room_queue').select('id,added_by,media,votes,created_at').eq('room_id', R.id).order('created_at');
  queue = res.data || [];
  await loadProfiles(queue.map(q => q.added_by));
  renderVote(); renderSheet(); renderBadges();
}
/* room_messages.attachments exists once room-media-schema.sql was run; chat keeps working without it */
let msgCols = 'id,user_id,kind,body,attachments,created_at';
const MEDIA = () => window.NovaRoomMedia;
async function loadMsgs() {
  let { data, error } = await sb.from('room_messages').select(msgCols)
    .eq('room_id', R.id).order('created_at', { ascending: false }).limit(60);
  if (error && /attachments/i.test(error.message || '')) {
    msgCols = 'id,user_id,kind,body,created_at';
    ({ data } = await sb.from('room_messages').select(msgCols).eq('room_id', R.id).order('created_at', { ascending: false }).limit(60));
  }
  msgs = (data || []).reverse();
  await loadProfiles(msgs.map(m => m.user_id));
  if (MEDIA()) MEDIA().sign(msgs).then(got => { if (got) renderFeed(); });
}
function subscribe() {
  const id = R.id;
  ch = sb.channel('nova-room-' + id, { config: { broadcast: { self: false } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + id }, onRoom)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: 'room_id=eq.' + id }, () => refreshMembers())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_queue', filter: 'room_id=eq.' + id }, () => refreshQueue())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: 'room_id=eq.' + id }, p => addMsg(p.new))
    .on('broadcast', { event: 'kick' }, ({ payload }) => { if (payload && payload.uid === ME.id) gone('You were removed from the room'); })
    .on('broadcast', { event: 'sig' }, ({ payload }) => onSig(payload))
    .on('broadcast', { event: 'mic' }, ({ payload }) => {
      if (!payload || !payload.uid || payload.uid === ME.id) return;
      if (!canMic(payload.uid)) { micMap.delete(payload.uid); renderVoice(); return; }
      micMap.set(payload.uid, { on: !!payload.on, ts: Date.now() });
      if (!payload.on) speak.delete(payload.uid);
      renderVoice();
    })
    .subscribe(st => { if (st === 'SUBSCRIBED') { voiceSync(); if (mic) announceMic(); } });
}
function onRoom(p) {
  if (!R || !p.new || p.new.id !== R.id) return;
  const prevAdmin = R.admin_id;
  R = Object.assign({}, R, p.new);
  if (R.status === 'closed') return gone('Room closed');
  if (prevAdmin !== R.admin_id) toast(R.admin_id === ME.id ? 'You are now the admin' : nm(who(R.admin_id)) + ' is now the admin');
  const changed = mediaKey() !== mountKey;
  renderHead(); renderSettings(); renderNow(); renderVote(); renderBadges();
  if (changed) { renderControls(); }
  mountMedia().then(() => { if (!isAdmin()) applyState(false); });
  voiceSync();
}
function addMsg(m) {
  if (!R || !m || msgs.some(x => x.id === m.id)) return;
  msgs.push(m);
  if (Nova.S.translate && m.kind === 'chat') Nova.tr(m.body).then(t => { if (t !== m.body) { m.tr = t; renderFeed(); } });
  loadProfiles([m.user_id]).then(renderFeed);
  if (MEDIA() && Array.isArray(m.attachments) && m.attachments.length) MEDIA().sign([m]).then(got => { if (got) renderFeed(); });
}
async function beat() {
  if (!R) return;
  try {
    const d = await rpc('room_heartbeat', { p_room: R.id });
    if (!R) return;
    if (!d.member) {
      if (d.status === 'open') {
        try { const cp = cachedPos(), row = await rpc('join_room', { p_code: R.code, p_lat: cp ? cp.lat : null, p_lng: cp ? cp.lng : null }); R = row; await Promise.all([refreshMembers(), refreshQueue()]); }
        catch (e) { gone(/removed/i.test(e.message) ? 'You were removed from the room' : e.message); }
      } else gone('Room closed');
    } else if (d.admin_id && d.admin_id !== R.admin_id) await refreshRoom().then(() => { renderAll(); mountMedia(); });
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && R) beat(); });

/* =====================================================================
   PLAYER + SYNC
   ===================================================================== */
const mediaKey = () => R && R.media ? [R.media.kind, R.media.id, R.media.pl, R.media.url, R.media_ver, isAdmin() ? 1 : 0].join('|') : '';
function normalizeLegacyWebYoutube() {
  const media = R && R.media;
  if (!media || media.kind !== 'video' || media.provider !== 'web' || !media.url) return;

  try {
    const url = new URL(media.url);
    const host = url.hostname.toLowerCase();
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
      'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be'].includes(host)) return;

    const videoId = host.endsWith('youtu.be')
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1] || '';
    const playlistId = url.searchParams.get('list') || '';
    const id = /^[\w-]{6,20}$/.test(videoId) ? videoId : '';
    const pl = /^[\w-]{10,64}$/.test(playlistId) ? playlistId : '';
    if (!id && !pl) return;

    R = Object.assign({}, R, {
      media: Object.assign({}, media, { kind: 'youtube', provider: 'youtube', id, pl })
    });
  } catch (e) {}
}
let ytWait = null;
function loadYT() {
  if (window.YT && YT.Player) return Promise.resolve();
  if (ytWait) return ytWait;
  ytWait = new Promise(res => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
  return ytWait;
}
/* web videos carry their stream type + source page in the URL fragment: url#nova={"t":"hls","r":"https://page"} */
function webStreamInfo(m) {
  const raw = String(m.url || '');
  const i = raw.indexOf('#nova=');
  let meta = {};
  if (i >= 0) { try { meta = JSON.parse(decodeURIComponent(raw.slice(i + 6))) || {}; } catch (e) {} }
  const url = i >= 0 ? raw.slice(0, i) : raw;
  return { url, ref: typeof meta.r === 'string' ? meta.r : '', hls: meta.t === 'hls' || /\.m3u8(?:$|[?#])/i.test(url) };
}
let hlsWait = null;
function loadHls() {
  if (window.Hls) return Promise.resolve();
  if (hlsWait) return hlsWait;
  hlsWait = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js'; s.onload = res; s.onerror = () => rej(new Error('hls')); document.head.appendChild(s); });
  return hlsWait;
}
/* plain files use <video src>; .m3u8 streams use native HLS (Safari) or hls.js */
function attachSrc(v, url, forceHls) {
  if ((!forceHls && !/\.m3u8(?:$|[?#])/i.test(url)) || v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; return; }
  loadHls().then(() => {
    if (window.Hls && Hls.isSupported()) {
      const h = new Hls({ enableWorker: true, maxBufferLength: 30, manifestLoadingMaxRetry: 3, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 4 }); v._hls = h; h.loadSource(url); h.attachMedia(v);
      let netRetries = 0;
      h.on(Hls.Events.ERROR, (ev, d) => {
        if (!d || !d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries++ < 3) h.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR && netRetries++ < 3) h.recoverMediaError();
        else toast('This stream cannot be played', 'err');
      });
    } else v.src = url;
  }).catch(() => toast('Could not load the stream player', 'err'));
}
const pl = {
  time() { try { return P.yt ? P.yt.getCurrentTime() || 0 : P.video ? P.video.currentTime : 0; } catch (e) { return 0; } },
  dur() { try { return P.yt ? P.yt.getDuration() || 0 : P.video ? (isFinite(P.video.duration) ? P.video.duration : 0) : 0; } catch (e) { return 0; } },
  playing() { try { if (P.yt) { const s = P.yt.getPlayerState(); return s === 1 || s === 3; } return P.video ? !P.video.paused : false; } catch (e) { return false; } },
  play() { try { if (P.yt) P.yt.playVideo(); else if (P.video) P.video.play().catch(showTap); } catch (e) {} },
  pause() { try { if (P.yt) P.yt.pauseVideo(); else if (P.video) P.video.pause(); } catch (e) {} },
  seek(t) { try { if (P.yt) P.yt.seekTo(t, true); else if (P.video) P.video.currentTime = t; } catch (e) {} },
  idx() { try { return P.yt && R.media && R.media.pl ? P.yt.getPlaylistIndex() : null; } catch (e) { return null; } },
  vol() { const v = Math.min(1, (100 - ui.vol) / 50); try { if (P.yt) P.yt.setVolume(Math.round(v * 100)); else if (P.video) P.video.volume = v; } catch (e) {} }
};
function destroyPlayer() {
  try { if (P.yt) P.yt.destroy(); } catch (e) {}
  try { if (P.video && P.video._hls) P.video._hls.destroy(); } catch (e) {}
  P = freshP();
  const w = $('#vwrap'); if (w) $$('#vwrap > *:not(#mv):not(#vcover):not(#vbadge)').forEach(n => n.remove());
}
function emptyHTML() {
  const can = isAdmin() || R.playback_mode !== 'leader';
  return `<div class="vnone"><div>${can ? 'No video yet' : 'Waiting for the admin to pick a video'}</div>${can ? `<button data-r="add">Choose a video</button>` : ''}</div>`;
}
async function mountMedia() {
  if (!R) return;
  normalizeLegacyWebYoutube();
  const key = mediaKey();
  if (!R || key === mountKey) return;
  mountKey = key;
  destroyPlayer();
  const w = $('#vwrap'); if (!w) return;
  const m = R.media, adm = isAdmin();
  if (!m) { w.insertAdjacentHTML('afterbegin', emptyHTML()); renderControls(); renderNow(); return; }
  noteNow(m);
  renderControls(); renderNow(); paintCover(); syncMore();
  if (m.kind === 'embed') {
    if (!safeHttps(m.url)) return;
    w.insertAdjacentHTML('afterbegin', `<iframe src="${esc(m.url)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms"></iframe>`);
    P.kind = 'embed';
    return;
  }
  if (m.kind === 'video') {
    if (!safeHttps(m.url)) return;
    const v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto'; v.controls = adm;
    if (m.provider === 'web') {
      const info = webStreamInfo(m);
      const proxy = new URL('/api/browse', location.href);
      proxy.searchParams.set('stream', '1');
      proxy.searchParams.set('url', info.url);
      if (info.ref) proxy.searchParams.set('ref', info.ref);
      attachSrc(v, proxy.href, info.hls || m.streamType === 'hls');
    } else attachSrc(v, m.url);
    /* X / Drive / plain links: if the browser refuses the direct address (hot-link or referer rules),
       retry once through our own stream proxy that sends the source site's referer */
    const viaProxy = (ref) => { const px = new URL('/api/browse', location.href); px.searchParams.set('stream', '1'); px.searchParams.set('url', m.url); if (ref) px.searchParams.set('ref', ref); return px.href; };
    let retried = m.provider === 'web';
    v._retry = () => {
      if (retried) return false;
      retried = true;
      const t = v.currentTime || 0;
      v.src = viaProxy(m.provider === 'x' ? 'https://x.com/' : m.provider === 'drive' ? 'https://drive.google.com/' : '');
      v.load();
      v.addEventListener('loadedmetadata', () => { try { if (t > 0) v.currentTime = t; } catch (e) {} }, { once: true });
      return true;
    };
    P.kind = 'video'; P.video = v;
    ['play', 'pause', 'seeked'].forEach(ev => v.addEventListener(ev, () => { if (isAdmin() && Date.now() > P.mute) publish(!v.paused, v.currentTime); updateTimeUI(); }));
    v.addEventListener('ended', () => { if (isAdmin()) ended(); });
    v.addEventListener('loadedmetadata', () => { P.ready = true; pl.vol(); renderControls(); applyState(true); });
    v.addEventListener('playing', () => { P.started = true; hideTap(); paintCover(); });
    v.addEventListener('error', () => {
      if (key !== mountKey) return;
      if (v._retry && v._retry()) return;
      const c = v.error && v.error.code;
      mediaFailed();
      toast('This video cannot be played' + (c ? ' (error ' + c + (c === 4 ? ': file not reachable or format unsupported' : c === 2 ? ': network' : '') + ')' : ''), 'err');
    });
    w.insertAdjacentElement('afterbegin', v);
    if (!adm) w.insertAdjacentHTML('beforeend', '<div class="shield"></div>');
    setTimeout(checkBlocked, 1800);
    return;
  }
  // YouTube
  await loadYT();
  if (key !== mountKey || !$('#vwrap')) return;
  const box = document.createElement('div'); box.className = 'ytbox'; box.innerHTML = '<div id="ytp"></div>';
  w.insertAdjacentElement('afterbegin', box);
  if (!adm) w.insertAdjacentHTML('beforeend', '<div class="shield"></div>');
  const vars = { autoplay: 0, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, disablekb: 1, iv_load_policy: 3, fs: 0, cc_load_policy: 0 };
  if (m.pl && !m.id) { vars.listType = 'playlist'; vars.list = m.pl; }
  else if (m.pl) vars.list = m.pl;
  if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
  P.kind = 'yt'; fitYT();
  P.yt = new YT.Player('ytp', {
    videoId: m.id || undefined, playerVars: vars,
    events: {
      onReady: () => { if (key !== mountKey) return; P.ready = true; pl.vol(); renderControls(); applyState(true); setTimeout(checkBlocked, 1800); },
      onStateChange: e => {
        const s = e.data;
        if ((s === 1 || s === 2) && isAdmin() && Date.now() > P.mute) publish(s === 1, pl.time());
        if (s === 1) { P.started = true; hideTap(); }
        paintCover(); paintState();
        if (s === 0 && isAdmin()) ended();
        updateTimeUI();
      },
      onAutoplayBlocked: showTap,
      onError: () => { toast('This video cannot be played' + (isAdmin() ? ' — moving on.' : '.'), 'err'); mediaFailed(); }
    }
  });
}
function checkBlocked() {
  if (!R || !R.media || P.kind === 'embed') return;
  const s = R.play_state || {};
  if (s.playing && !s.ended && !pl.playing()) showTap();
}
function showTap() {
  const w = $('#vwrap'); if (!w || $('#tap')) return;
  w.insertAdjacentHTML('beforeend', '<button id="tap" class="tap" data-r="tap">Tap to join playback</button>');
}
function hideTap() { const t = $('#tap'); if (t) t.remove(); }

function applyState(force) {
  if (!R || !P.ready || P.kind === 'embed' || !R.media) return;
  const s = R.play_state || {};
  P.mute = Date.now() + 1500;
  if (s.ended) { if (pl.playing()) pl.pause(); return; }
  if (P.yt && R.media.pl) {
    try { const i = P.yt.getPlaylistIndex(); if (s.idx != null && i >= 0 && i !== s.idx) { P.yt.playVideoAt(s.idx); return; } } catch (e) {}
  }
  const exp = s.playing ? (s.pos || 0) + (snow() - s.ts) / 1000 : (s.pos || 0);
  const cur = pl.time(), live = P.yt && pl.dur() === 0;
  if (s.playing) {
    if (!live && Math.abs(cur - exp) > (force ? 0.8 : 2.2)) pl.seek(exp);
    if (!pl.playing()) pl.play();
  } else {
    if (pl.playing()) pl.pause();
    if (!live && Math.abs(cur - (s.pos || 0)) > 0.8) pl.seek(s.pos || 0);
  }
}
/* admin → everyone */
function publish(playing, pos) {
  if (!isAdmin() || !R) return;
  const p = pos != null ? pos : pl.time();
  R.play_state = Object.assign({}, R.play_state, { playing, pos: p, ts: snow(), seq: ((R.play_state || {}).seq || 0) + 1, ended: false });
  pubAt = Date.now();
  clearTimeout(pubT);
  pubT = setTimeout(() => rpc('room_set_state', { p_room: R.id, p_playing: playing, p_pos: p, p_idx: pl.idx(), p_duration: pl.dur() || null }).catch(() => {}), 120);
}
function ended() {
  if (Date.now() - endedAt < 4000) return;
  endedAt = Date.now();
  rpc('room_ended', { p_room: R.id, p_ver: R.media_ver }).catch(() => {});
}
function onTick() {
  if (!R) return;
  privTick();
  updateTimeUI();
  if (mic && Date.now() - micAt > 4000) { micAt = Date.now(); announceMic(); }
  let gone_ = false;
  micMap.forEach((v, id) => { if (v.on && Date.now() - v.ts > 11000 && !speak.get(id)) { micMap.delete(id); gone_ = true; } });
  if (gone_) renderVoice();
  const s = R.play_state || {};
  fitYT(); paintCover(); tickMore(); paintState();
  if (s.vote_until) {
    renderHead();
    const late = snow() - s.vote_until;
    if (((isAdmin() && late > 0) || late > 3500) && Date.now() - advAt > 5000) {
      advAt = Date.now();
      rpc('room_advance', { p_room: R.id, p_ver: R.media_ver }).catch(() => {});
    }
  }
  if (!P.ready || P.kind === 'embed' || !R.media) return;
  if (isAdmin()) {
    const now = Date.now(), cur = pl.time(), playing = pl.playing();
    if (P.lastT && now > P.mute) {
      const dt = (now - P.lastT) / 1000;
      const jump = playing ? Math.abs(cur - (P.lastC + dt)) > 2.5 : Math.abs(cur - P.lastC) > 1;
      if (jump && !P.drag) publish(playing, cur);
      else if (playing && now - pubAt > 10000) publish(true, cur);
    }
    P.lastT = now; P.lastC = cur;
  } else if (!$('#tap')) applyState(false);
}

/* =====================================================================
   VOICE (WebRTC mesh, signalling over the room's realtime channel)
   ===================================================================== */
const peers = new Map(); let local = null, mic = false;
function canMic(id) {
  if (!R || !R.voice_enabled) return false;
  const member = members.find(m => m.user_id === id);
  return !!member && (id === R.admin_id || R.privacy === 'public' || !!member.mic_allowed);
}
function iceServers() {
  const s = [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const urls = String(CFG.TURN_URL || '').replace(/\\/g, '').split(',').map(x => x.trim()).filter(Boolean);
    if (urls.length && CFG.TURN_USERNAME) s.push({ urls, username: CFG.TURN_USERNAME, credential: CFG.TURN_CREDENTIAL });
  } catch (e) {}
  return s;
}
const voiceVol = () => Math.min(1, ui.vol / 50);
function sig(to, p) { if (ch) ch.send({ type: 'broadcast', event: 'sig', payload: Object.assign({ to, from: ME.id }, p) }); }
function voiceSync() {
  if (!R || !ch || !window.RTCPeerConnection) return;
  if (!R.voice_enabled) { closeAllPeers(); if (mic) stopMic(); micMap.clear(); renderVoice(); return; }
  if (mic && !canMic(ME.id)) stopMic();
  const ids = members.map(m => m.user_id).filter(i => i !== ME.id);
  ids.forEach(id => { if (!peers.has(id)) makePeer(id); });
  [...peers.keys()].forEach(id => { if (!ids.includes(id)) dropPeer(id); });
  applyRemoteVoiceAccess();
}
async function offer(id) {
  const o = peers.get(id); if (!o) return;
  try { await o.pc.setLocalDescription(await o.pc.createOffer()); sig(id, { t: 'sdp', d: o.pc.localDescription }); } catch (e) {}
}
function makePeer(id) {
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const o = { pc, tr, audio: null, pend: [] };
  peers.set(id, o);
  pc.ontrack = e => {
    if (!o.audio) { const a = document.createElement('audio'); a.autoplay = true; a.playsInline = true; ($('#rm') || document.body).appendChild(a); o.audio = a; }
    o.audio.srcObject = e.streams[0] || new MediaStream([e.track]);
    o.audio.volume = voiceVol();
    o.audio.muted = mutedUsers.has(id) || !canMic(id);
    o.audio.play().catch(() => {});
    watch(id, o.audio.srcObject);
  };
  pc.onicecandidate = e => { if (e.candidate) sig(id, { t: 'ice', c: e.candidate }); };
  pc.onnegotiationneeded = () => { if (ME.id < id && pc.signalingState === 'stable') offer(id); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch (e) {} } };
  if (local && mic) tr.sender.replaceTrack(local.getAudioTracks()[0]).catch(() => {});
  if (ME.id > id) sig(id, { t: 'hi' });
}
function dropPeer(id) {
  const o = peers.get(id); if (!o) return;
  try { o.pc.close(); } catch (e) {}
  if (o.audio) { o.audio.srcObject = null; o.audio.remove(); }
  unwatch(id); micMap.delete(id);
  peers.delete(id);
}
function closeAllPeers() { [...peers.keys()].forEach(dropPeer); }
async function onSig(pl_) {
  if (!pl_ || pl_.to !== ME.id || !R || !R.voice_enabled || !window.RTCPeerConnection) return;
  const id = pl_.from;
  if (!members.some(m => m.user_id === id)) { dropPeer(id); return; }
  if (!peers.has(id)) makePeer(id);
  const o = peers.get(id), pc = o.pc;
  try {
    if (pl_.t === 'hi') { if (ME.id < id && pc.signalingState === 'stable') await offer(id); }
    else if (pl_.t === 'sdp') {
      await pc.setRemoteDescription(pl_.d);
      if (pl_.d.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); sig(id, { t: 'sdp', d: pc.localDescription }); }
      while (o.pend.length) await pc.addIceCandidate(o.pend.shift()).catch(() => {});
    } else if (pl_.t === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(pl_.c).catch(() => {}); else o.pend.push(pl_.c);
    }
  } catch (e) {}
}
async function toggleMic() {
  if (!R.voice_enabled) return toast('Voice chat is off in this room');
  if (mic) stopMic();
  else {
    if (!canMic(ME.id)) return toast('The room admin must enable your microphone', 'err');
    if (R.privacy !== 'public') {
      let access;
      try {
        access = await rpc('room_can_mic', { p_room: R.id });
      } catch (e) { oops(e); return; }
      if (!access) return toast('The room admin must enable your microphone', 'err');
    }
    try {
      audioCtx();
      local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mic = true; micAt = Date.now();
      const t = local.getAudioTracks()[0];
      peers.forEach(o => o.tr.sender.replaceTrack(t).catch(() => {}));
      watch(ME.id, local);
      announceMic();
    } catch (e) { toast(window.isSecureContext ? 'Microphone permission denied' : 'The microphone needs a secure (https) page', 'err'); }
  }
  renderVoice();
}
function stopMic() {
  const was = mic;
  mic = false;
  if (local) local.getTracks().forEach(t => t.stop());
  local = null;
  peers.forEach(o => o.tr.sender.replaceTrack(null).catch(() => {}));
  if (ME) unwatch(ME.id);
  if (was) announceMic();
}
function announceMic() { if (ch && ME) { try { ch.send({ type: 'broadcast', event: 'mic', payload: { uid: ME.id, on: mic } }); } catch (e) {} } }

/* speaking detection: local mic + every remote voice, so the "On mic" strip can light up whoever talks */
function audioCtx() {
  try {
    if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  } catch (e) {}
  return actx;
}
function resumeAudio() {
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  peers.forEach(o => { if (o.audio && o.audio.paused && o.audio.srcObject) o.audio.play().catch(() => {}); });
}
function watch(id, stream) {
  const c = audioCtx(); if (!c || !stream) return;
  unwatch(id);
  try {
    const src = c.createMediaStreamSource(stream), an = c.createAnalyser();
    an.fftSize = 512; src.connect(an);
    vad.set(id, { src, an, buf: new Uint8Array(an.fftSize), hold: 0 });
  } catch (e) {}
  if (!vadT) vadT = setInterval(vadTick, 160);
}
function unwatch(id) {
  const o = vad.get(id);
  if (o) { try { o.src.disconnect(); } catch (e) {} vad.delete(id); }
  if (speak.get(id)) { speak.delete(id); $$('[data-vu="' + id + '"]').forEach(n => n.classList.remove('talk')); }
}
function vadTick() {
  if (!R) return;
  const now = Date.now();
  vad.forEach((o, id) => {
    if (id !== ME.id && (!canMic(id) || mutedUsers.has(id))) {
      if (speak.get(id)) { speak.set(id, false); $$('[data-vu="' + id + '"]').forEach(n => n.classList.remove('talk')); }
      return;
    }
    o.an.getByteTimeDomainData(o.buf);
    let sum = 0; for (let i = 0; i < o.buf.length; i++) { const x = (o.buf[i] - 128) / 128; sum += x * x; }
    if (Math.sqrt(sum / o.buf.length) > 0.03) o.hold = now + 450;
    const on = now < o.hold;
    if (!!speak.get(id) === on) return;
    speak.set(id, on);
    if (on && id !== ME.id && !micOf(id)) { micMap.set(id, { on: true, ts: now }); renderVoice(); }   // heard them → they are on the mic
    $$('[data-vu="' + id + '"]').forEach(n => n.classList.toggle('talk', on));
  });
}
function applyVolume() {
  pl.vol();
  peers.forEach(o => { if (o.audio) o.audio.volume = voiceVol(); });
}
function applyRemoteVoiceAccess() {
  peers.forEach((o, id) => {
    if (o.audio) o.audio.muted = mutedUsers.has(id) || !canMic(id);
  });
}
function setUserMuted(id, muted) {
  if (muted) mutedUsers.add(id); else mutedUsers.delete(id);
  try { localStorage.setItem('nova_room_muted_users', JSON.stringify([...mutedUsers])); } catch (e) {}
  const peer = peers.get(id);
  if (peer && peer.audio) peer.audio.muted = muted || !canMic(id);
  renderVoice();
}

/* =====================================================================
   UI
   ===================================================================== */
function buildShell() {
  const old = $('#rm'); if (old) old.remove();
  const el = document.createElement('div'); el.id = 'rm';
  el.innerHTML = `
  <header class="rh">
    <button class="rb rdock" data-r="dock" aria-label="Show Nova Home" title="Nova Home" aria-pressed="false">${ic('dock', 24)}</button>
    <button class="rb" data-r="leave" aria-label="Leave room">${ic('x', 24)}</button>
    <button class="rb" data-r="settings" aria-label="Room settings">${ic('gear', 24)}</button>
    <div class="rmid" id="rmid"></div>
    <button class="rb" data-r="add" aria-label="Add a video">${ic('searchplay', 26)}</button>
    <button class="rb rpb" data-r="people" aria-label="People">${ic('users', 26)}<b id="rcount">1</b></button>
  </header>
  <div class="rbody">
    <section class="vcol">
      <div class="vwrap" id="vwrap"></div>
      <div class="ctl" id="ctl"></div>
    </section>
    <section class="scol">
      <div class="vbar" id="vbar" hidden></div>
      <div class="feed" id="feed"></div>
      <div class="mentions" id="mentions" hidden></div>
      ${MEDIA() ? MEDIA().markup() : ''}
      <div class="cin" id="cin">
        <button class="micb" id="micb" data-r="mic" aria-label="Microphone"></button>
        ${MEDIA() ? MEDIA().buttonHTML() : ''}
        <input id="cmsg" placeholder="Message" maxlength="500" autocomplete="off" enterkeyhint="send">
        <button class="ib2 tool" data-r="share" aria-label="Invite friends">${ic('userplus', 22)}</button>
        <button class="sendb" data-r="send" aria-label="Send message">${ic('send', 20)}</button>
      </div>
    </section>
  </div>
  <div id="rsheet"></div>`;
  document.body.appendChild(el);
  if (MEDIA()) MEDIA().onChange = syncTyping;
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  el.addEventListener('contextmenu', e => {
    const avatar = e.target.closest && e.target.closest('.uav[data-user-id]');
    if (!avatar) return;
    e.preventDefault();
    openUserMenu(avatar.dataset.userId);
  });
  el.addEventListener('pointerdown', e => {
    const avatar = e.target.closest && e.target.closest('.uav[data-user-id]');
    if (!avatar || e.pointerType === 'mouse') return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      openUserMenu(avatar.dataset.userId);
    }, 600);
  });
  ['pointerup', 'pointercancel', 'pointermove', 'pointerleave'].forEach(name => el.addEventListener(name, () => clearTimeout(pressTimer)));
  el.addEventListener('keydown', e => { if (e.target.id === 'cmsg' && e.key === 'Enter') { e.preventDefault(); sendMsg(); } });
  /* keep the Send button tappable: pressing it must not blur the input (that would swap the icons away) */
  el.addEventListener('pointerdown', e => { if (e.target.closest('.sendb')) e.preventDefault(); });
  el.addEventListener('focusin', e => { if (e.target.id === 'cmsg') setTimeout(() => { const f = $('#feed'); if (f) f.scrollTop = f.scrollHeight; }, 280); });
  /* phones: follow the visible area so the keyboard never covers the message box */
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fit = () => {
      if (!el.isConnected) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); return; }
      /* Nova Home docked above the room (phones): the room is the bottom half, unless the keyboard is open */
      const stack = document.body.classList.contains('nv-dock-stack') && vv.height > innerHeight * 0.75;
      /* the Home part's height is whatever the person dragged the split to (half of the screen by default) */
      const hw = stack ? document.querySelector('.wrap') : null;
      const home = stack ? Math.min(Math.round((hw && hw.getBoundingClientRect().height) || vv.height / 2), Math.round(vv.height) - 150) : 0;
      const h = vv.height - home;
      el.style.height = h + 'px';
      el.style.top = (vv.offsetTop + home) + 'px';
      el.style.bottom = 'auto';
    };
    el._fit = fit;
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
  }
  if (window.NovaDock) NovaDock.attach(el);
}
function renderAll() { renderHead(); renderSettings(); renderControls(); renderNow(); renderFeed(); renderVote(); renderMic(); renderVoice(); renderBadges(); }

function votingNow() { return !!(R && R.play_state && R.play_state.vote_until); }
function renderHead() {
  if (!R || !$('#rmid')) return;
  $('#rcount').textContent = members.length || 1;
  const mid = $('#rmid');
  const activeMic = R.voice_enabled ? members.map(m => m.user_id).filter(micOf) : [];
  const timer = votingNow() ? `<div class="cd" style="--p:${Math.min(100, Math.max(0, (R.play_state.vote_until - snow()) / (R.play_state.vote_ms || 12000) * 100))}%"><span>${Math.ceil(Math.max(0, (R.play_state.vote_until - snow()) / 1000))}</span></div>` : '';
  if (activeMic.length) {
    mid.innerHTML = `${timer}<div class="mic-header" aria-label="Members on microphone">${activeMic.map(id => userAvatar(who(id), 36, true)).join('')}</div>`;
    return;
  }
  if (votingNow()) {
    const left = Math.max(0, (R.play_state.vote_until - snow()) / 1000);
    mid.innerHTML = `<div class="cd" style="--p:${Math.min(100, left * 1000 / (R.play_state.vote_ms || 12000) * 100)}%"><span>${Math.ceil(left)}</span></div>`;
  } else if (!mid.querySelector('.brand')) mid.innerHTML = '<div class="brand">nova</div>';
}
function renderBadges() { /* queue count lives in the People sheet (Up next tab) */ }
function renderMic() {
  const b = $('#micb'); if (!b) return;
  const off = !(R && R.voice_enabled), denied = !off && !canMic(ME.id);
  b.className = 'micb' + (mic ? ' on' : '') + ((off || denied) ? ' dis' : '');
  b.innerHTML = ic(mic ? 'mic' : 'micoff', 22);
  b.title = off ? 'Voice chat is off' : denied ? 'The room admin must enable your microphone' : mic ? 'Mute microphone' : 'Turn on microphone';
  b.disabled = off || denied;
  b.setAttribute('aria-pressed', mic ? 'true' : 'false');
}
const micOf = id => canMic(id) && (id === (ME && ME.id) ? mic : !!(micMap.get(id) || {}).on);
/* strip above the chat: who is on the mic right now (ring pulses while they talk) */
function renderVoice() {
  const bar = $('#vbar'); if (!bar || !R) return;
  renderMic();
  const ids = R.voice_enabled ? members.map(m => m.user_id).filter(micOf) : [];
  renderHead();
  bar.hidden = !ids.length;
  if (!ids.length) { bar.innerHTML = ''; if (ui.sheet === 'people') openPeople(true); return; }
  bar.innerHTML = `<span class="vb-l">${ic('mic', 14)}On mic</span>` + ids.map(id => {
    const u = who(id);
    return `<span class="chip${speak.get(id) ? ' talk' : ''}" data-vu="${id}">${userAvatar(u, 28, true)}<em>${esc(id === ME.id ? 'You' : nm(u))}</em></span>`;
  }).join('');
  if (ui.sheet === 'people') openPeople(true);
}
function renderNow() {
  $$('#feed [data-event-index]').forEach(button => {
    const event = ui.events[Number(button.dataset.eventIndex)];
    if (!event || !canLike(event.media)) return;
    const liked = NovaApp.isLiked(likeItem(event.media));
    button.classList.toggle('on', liked);
    button.setAttribute('aria-label', liked ? 'Unlike video' : 'Like video');
    button.innerHTML = ic('heart', 18).replace('fill="none"', liked ? 'fill="currentColor"' : 'fill="none"');
  });
}
const canLike = m => !!(m && ['youtube', 'video', 'embed'].includes(m.kind) && window.NovaApp);
const likeItem = m => ({ t: m.title || 'Video', id: m.id, pl: m.pl, url: m.url, kind: m.kind, provider: m.provider, d: '', a: '#222', b: '#444', x: '', th: m.thumb || thumb(m) });

function renderControls() {
  const el = $('#ctl'); if (!el) return;
  const m = R.media;
  if (!m) { el.innerHTML = ''; return; }
  if (m.kind === 'embed') { el.innerHTML = '<span class="hint">Everyone opens the same page. This source cannot be time-synced.</span>' + moreBtn(); return; }
  const adm = isAdmin();
  el.innerHTML = `${adm ? `<button class="cb" data-r="back" aria-label="Back 10 seconds">−10</button><button class="cb" data-r="toggle" id="ptog" aria-label="Play or pause">${ic('play', 18)}</button><button class="cb" data-r="fwd" aria-label="Forward 10 seconds">+10</button>` : `<span class="cb" title="Only the admin controls playback">${ic('lock', 16)}</span>`}
    <span class="t" id="tcur">0:00</span><input type="range" id="seek" min="0" max="1000" value="0" ${adm ? '' : 'disabled'} aria-label="Position"><span class="t" id="tdur">0:00</span>
    ${moreBtn()}${adm ? `<button class="cb" data-r="skip" aria-label="Next video">${ic('skip', 18)}</button>` : ''}`;
}
function updateTimeUI() {
  if (!R || !$('#seek') || !P.ready) return;
  const cur = pl.time(), dur = pl.dur();
  $('#tcur').textContent = fmt(cur);
  $('#tdur').textContent = dur ? fmt(dur) : 'LIVE';
  if (!P.drag) $('#seek').value = dur ? Math.round(cur / dur * 1000) : 0;
  const t = $('#ptog'); if (t) { const p = pl.playing(); if (t.dataset.p !== String(p)) { t.dataset.p = String(p); t.innerHTML = ic(p ? 'pause' : 'play', 18); } }
}

function optBtn(v, icon, label, on, dis) {
  return `<button class="op${on ? ' on' : ''}" data-r="set" data-v="${v}" ${dis ? 'disabled' : ''}>${ic(icon, 18)}<span>${label}</span></button>`;
}
function openSettings(refresh) {
  ui.sheet = 'settings';
  const adm = isAdmin();
  const pv = PRIV.find(x => x[0] === R.privacy) || PRIV[0], md = MODES.find(x => x[0] === R.playback_mode) || MODES[0];
  const group = (title, desc, opts) => `<section class="sg"><div class="sgh"><b>${title}</b><small>${esc(desc)}</small></div><div class="opt">${opts}</div></section>`;
  const html = `<div class="mh"><h3>Room settings</h3><button class="mx" data-r="close" aria-label="Close">${ic('x', 18)}</button></div>
    ${adm ? '' : '<p class="mnote">Only the room admin can change these settings.</p>'}
    ${group('Privacy', pv[3], PRIV.map(p => optBtn('privacy:' + p[0], p[1], p[2], p[0] === R.privacy, !adm)).join(''))}
    ${group('Playback', md[3], MODES.map(p => optBtn('mode:' + p[0], p[1], p[2], p[0] === R.playback_mode, !adm)).join(''))}
    ${R.playback_mode === 'vote' ? group('Voting time', 'How long the vote stays open when a video ends', [12, 20, 30, 60].map(n => optBtn('votesec:' + n, 'check', n + ' s', (R.vote_seconds || 12) === n, !adm)).join('')) : ''}
    <section class="sg row"><span class="sgi">${ic(R.voice_enabled ? 'mic' : 'micoff', 18)}</span><div class="sgh"><b>Voice chat</b><small>${R.voice_enabled ? (R.privacy === 'public' ? 'Everyone can talk and listen' : 'Only admin-approved members can talk') : 'Microphones are off for everyone'}</small></div><input type="checkbox" class="sw" id="voicesw" ${R.voice_enabled ? 'checked' : ''} ${adm ? '' : 'disabled'} aria-label="Voice chat"></section>
    <section class="sg"><div class="sgh"><b>Volume</b><small>Balance between the video and voices</small></div><div class="vol">${ic('vol', 18)}<input type="range" id="volr" min="0" max="100" value="${ui.vol}" aria-label="Video and voice balance">${ic('phone', 18)}</div></section>
    <section class="sg row"><span class="sgi">${ic('globe', 18)}</span><div class="sgh"><b>Auto-translate chat</b><small>Translate messages into your language</small></div><input type="checkbox" class="sw" id="trsw" ${Nova.S.translate ? 'checked' : ''} aria-label="Auto-translate chat"></section>`;
  if (refresh && $('#rmodal')) $('#rmodal .mb').innerHTML = html; else sheet(html);
}
function renderSettings() {
  if (ui.sheet !== 'settings' || !$('#rmodal')) return;
  if (document.activeElement && document.activeElement.id === 'volr') return;   // don't reset the slider while it is dragged
  openSettings(true);
}

/* =====================================================================
   MORE VIDEOS (overlay on the video) · cover · platform badge
   ===================================================================== */
const canMore = () => !!R && (isAdmin() || R.playback_mode !== 'leader');
function moreBtn() {
  const ok = canMore(), t = ok ? 'More videos' : "Only the leader can choose videos in Leader's choice";
  return `<button class="cb${ui.more ? ' on' : ''}${ok ? '' : ' dis'}" id="morebtn" data-r="more" aria-label="${t}" title="${t}" aria-pressed="${ui.more ? 'true' : 'false'}" ${ok ? '' : 'aria-disabled="true"'}>${ic('clap', 22)}</button>`;
}
function renderMoreBtn() {
  const b = $('#morebtn'); if (!b) return;
  const ok = canMore();
  b.classList.toggle('dis', !ok); b.classList.toggle('on', ui.more);
  b.setAttribute('aria-pressed', ui.more ? 'true' : 'false');
  b.title = ok ? 'More videos' : "Only the leader can choose videos in Leader's choice";
}
function toggleMore() {
  if (!canMore()) return toast("Only the leader can choose videos in Leader's choice");
  if (ui.more) return closeMore();
  ui.more = true; ui.moreAuto = false; paintMore(true);
}
function closeMore() { ui.more = false; ui.moreAuto = false; ui.moreDismiss = String(((R && R.play_state) || {}).seq || 0); paintMore(); }
const mvLeaders = () => {
  const mx = queue.reduce((a, q) => Math.max(a, (q.votes || []).length), 0);
  return { mx, ties: queue.filter(q => (q.votes || []).length === mx).length };
};
function moreList() {
  const vote = R.playback_mode === 'vote', cur = R.media ? mkey(R.media) : '', have = new Set(queue.map(q => mkey(q.media)));
  let list = queue.map(q => ({ q, id: q.id, media: q.media, votes: (q.votes || []).length, mine: (q.votes || []).includes(ME.id), next: !!R.next_id && R.next_id === q.id, by: q.suggested ? 'Suggested' : 'Added by ' + (q.added_by === ME.id ? 'you' : nm(who(q.added_by))) }));
  if (vote) list.sort((a, b) => b.votes - a.votes);
  DEFAULTS.forEach(m => { if (!have.has(mkey(m)) && mkey(m) !== cur) list.push({ q: null, id: null, media: m, votes: 0, mine: false, by: 'Suggested' }); });
  return list;
}
function moreHead() {
  const s = R.play_state || {}, md = R.playback_mode, vu = s.vote_until, left = vu ? Math.max(0, Math.ceil((vu - snow()) / 1000)) : 0;
  const over = !!R.media && !!s.ended, adm = isAdmin();
  if (md === 'vote') {
    if (vu) {
      if (left > 0) return ['Vote for the next video', 'One vote each · tap another to move it · tap yours to withdraw', left + 's'];
      const { mx, ties } = mvLeaders();
      return (mx === 0 || ties > 1) ? ['Tie — the leader picks', adm ? 'Tap a video to play it' : 'Waiting for the leader', ''] : ['Counting votes…', '', ''];
    }
    if (over) return ['No videos to vote on yet', 'Add a video to continue', ''];
    return ['Vote for the next video', 'Voting closes when this video ends · one vote each', ''];
  }
  if (md === 'play') return ['More videos', adm ? (over ? 'Tap a video to play it' : 'Tap a video to play it now') : 'Tap to add it to Up next · the leader picks what plays next', ''];
  if (md === 'autoplay') return ['Up next', 'Videos play in this order · tap to add to the end', ''];
  return ["Leader's choice", over ? 'Tap a video to play it' : 'Tap a video to play it next · tap it again to clear', ''];
}
function paintMore(scrollTop) {
  const w = $('#vwrap'); if (!w) return;
  let o = $('#mv');
  if (!ui.more || !R) { if (o) o.remove(); renderMoreBtn(); return; }
  if (!o) { o = document.createElement('div'); o.id = 'mv'; o.className = 'mv'; w.appendChild(o); }
  const old = $('#mvrow'), keep = old && !scrollTop ? old.scrollLeft : 0;
  ui.moreList = moreList();
  const vote = R.playback_mode === 'vote', [t, sub, tm] = moreHead(), top = vote ? Math.max(0, ...ui.moreList.map(x => x.votes)) : 0;
  const endable = vote && isAdmin() && !!(R.play_state || {}).vote_until && (R.play_state.vote_until - snow()) > 0;
  o.innerHTML = `<div class="mvh"><div class="mvt"><b>${esc(t)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>${tm ? `<span class="mvtm">${tm}</span>` : ''}${endable ? `<button class="mvend" data-r="closevote">End vote</button>` : ''}<button class="mvx" data-r="moreclose" aria-label="Close">${ic('x', 22)}</button></div>
    <div class="mvw"><button class="mvn l" data-r="mvscroll" data-d="-1" aria-label="Scroll left">‹</button><div class="mvrow" id="mvrow">${ui.moreList.map((x, i) => `<button class="mvc${x.mine ? ' mine' : ''}${vote && top > 0 && x.votes === top ? ' lead' : ''}" data-r="mv" data-i="${i}">
      <span class="mvth" style="background-image:url('${esc(thumb(x.media))}')">${platBadge(x.media, 'sm')}${vote ? `<b class="mvv">${ic('heart', 12)} ${x.votes}</b>` : ''}${x.mine ? '<em>Your vote</em>' : x.next ? '<em>Next</em>' : ''}</span>
      <strong>${esc(x.media.title || 'Video')}</strong><small>${esc(x.by)}</small></button>`).join('')}</div><button class="mvn r" data-r="mvscroll" data-d="1" aria-label="Scroll right">›</button></div>`;
  const row = $('#mvrow'); if (row && keep) row.scrollLeft = keep;
  renderMoreBtn();
}
function tickMore() {
  const o = $('#mv'); if (!o || !R) return;
  const vu = (R.play_state || {}).vote_until; if (!vu) return;
  const tm = $('.mvtm', o), left = Math.max(0, Math.ceil((vu - snow()) / 1000));
  if (tm) tm.textContent = left > 0 ? left + 's' : '';
  const h = moreHead(), b = $('.mvt b', o); if (b && b.textContent !== h[0]) paintMore();
}
/* open by itself when a decision is needed (vote started / leader must pick), close when the next video starts */
function syncMore() {
  if (!R || !$('#vwrap')) return;
  const s = R.play_state || {}, md = R.playback_mode, ended = !!R.media && !!s.ended;
  if (votingNow() && md === 'vote') ui.voteSeen = true;
  paintState();
  const need = (votingNow() && md === 'vote') || (ended && isAdmin() && (md === 'play' || md === 'leader')) || (ended && md === 'vote' && !s.vote_until);
  if (need) { if (!ui.more && String(s.seq || 0) !== ui.moreDismiss) { ui.more = true; ui.moreAuto = true; } }
  else if (ui.more && ui.moreAuto) { ui.more = false; ui.moreAuto = false; }
  if (ui.more && !canMore()) { ui.more = false; ui.moreAuto = false; }
  paintMore(); paintCover(); renderMoreBtn();
}
const renderVote = syncMore;
async function tapMore(i) {
  const x = (ui.moreList || [])[i]; if (!x || !R) return;
  const md = R.playback_mode, adm = isAdmin(), s = R.play_state || {}, playing = !!R.media && !s.ended, title = x.media.title || 'this video';
  try {
    if (md === 'vote') {
      const closed = s.vote_until && snow() > s.vote_until;
      if (closed && adm && (mvLeaders().mx === 0 || mvLeaders().ties > 1)) {          // tie / no votes: the leader decides
        if (x.q) await rpc('room_advance', { p_room: R.id, p_queue_id: x.id, p_ver: R.media_ver }); else await rpc('room_pick', { p_room: R.id, p_media: x.media, p_now: true });
        await refreshRoom(); renderAll(); mountMedia(); return;
      }
      if (x.q) await rpc('room_vote', { p_queue_id: x.id });                           // ONE vote: moves / withdraws
      else { await rpc('room_pick', { p_room: R.id, p_media: x.media, p_now: false }); toast('Added — your vote is on it'); await refreshRoom(); mountMedia(); }
      await refreshQueue(); return;
    }
    if (md === 'leader') {                                                            // only the leader gets here
      if (playing) {                                                                  // choose / change / clear the next video
        if (x.q) await rpc('room_set_next', { p_room: R.id, p_queue_id: x.id });
        else await rpc('room_pick', { p_room: R.id, p_media: x.media, p_now: false });
        toast(x.next ? 'Next video cleared' : 'Next: ' + title);
        await refreshRoom(); await refreshQueue(); paintMore(); return;
      }
      if (x.q) await rpc('room_advance', { p_room: R.id, p_queue_id: x.id, p_ver: R.media_ver }); else await rpc('room_pick', { p_room: R.id, p_media: x.media, p_now: true });
      closeMore(); await refreshRoom(); renderAll(); mountMedia(); return;
    }
    if (adm) {
      if (playing && !confirm('Play “' + title + '” now? This stops the current video.')) return;
      if (x.q) await rpc('room_advance', { p_room: R.id, p_queue_id: x.id, p_ver: R.media_ver }); else await rpc('room_pick', { p_room: R.id, p_media: x.media, p_now: true });
      closeMore(); await refreshRoom(); renderAll(); mountMedia(); return;
    }
    if (!x.q) { await rpc('room_pick', { p_room: R.id, p_media: x.media, p_now: false }); toast('Added to Up next'); await refreshQueue(); return; }
    toast(md === 'autoplay' ? 'Videos play in queue order' : 'Only the leader plays the next video');
  } catch (e) { oops(e); refreshQueue(); }
}
async function endVote() {
  if (!isAdmin() || !R) return;
  try { await rpc('room_close_vote', { p_room: R.id, p_ver: R.media_ver }); await refreshRoom(); await refreshQueue(); renderAll(); mountMedia(); }
  catch (e) { oops(e); }
}
function coverMsg() {
  const md = R.playback_mode, adm = isAdmin(), s = R.play_state || {};
  const err = s.error ? "This video couldn't be played. " : '';
  if (md === 'vote') return s.vote_until ? 'Choose the next video' : err + 'No videos to vote on yet — add one';
  if (md === 'autoplay') return queue.length ? 'Playing the next video…' : err + 'No more videos in the queue';
  if (md === 'leader') return err + (adm ? 'Choose the next video' : "Waiting for the leader's choice");
  return err + (adm ? 'Video finished — pick the next one' : 'Video finished — waiting for the leader');
}
/* =====================================================================
   PLAYBACK STATE MACHINE — the server keeps the phase in rooms.play_state.phase (set inside the same locked
   transaction that changes the video); the browser only adds the short LOADING step. Shown as data-pstate on #rm.
     IDLE → PLAYING ⇄ PAUSED → VIDEO_ENDED → (VOTING | WAITING_FOR_SELECTION | WAITING_FOR_LEADER | QUEUE_EMPTY | PLAYBACK_ERROR)
          → NEXT_VIDEO_SELECTED → LOADING_NEXT_VIDEO → PLAYING
   ===================================================================== */
function stateName() {
  if (!R || !R.media) return 'IDLE';
  const s = R.play_state || {};
  if (s.ended) {
    if (s.vote_until) return 'VOTING';
    return s.phase && !/^(PLAYING|PAUSED|IDLE)$/.test(s.phase) ? s.phase : 'VIDEO_ENDED';
  }
  if (!P.started && P.kind !== 'embed') return 'LOADING_NEXT_VIDEO';
  return s.playing ? 'PLAYING' : 'PAUSED';
}
function paintState() {
  const rm = $('#rm'); if (!rm || !R) return;
  const st = stateName();
  if (rm.dataset.pstate !== st) rm.dataset.pstate = st;
  rm.dataset.nextSelected = R.next_id ? '1' : '';
}
function paintCover() {
  const w = $('#vwrap'); if (!w || !R) return;
  let c = $('#vcover'), b = $('#vbadge');
  const m = R.media, s = R.play_state || {};
  if (!m) { if (c) c.remove(); if (b) b.remove(); return; }
  const bk = (m.provider || m.kind) + '|' + m.kind;
  if (!b || b.dataset.k !== bk) { if (b) b.remove(); w.insertAdjacentHTML('beforeend', platBadge(m, 'main').replace('class="pbg', 'id="vbadge" data-k="' + esc(bk) + '" class="pbg')); }
  const ended = !!s.ended, wait = !ended && !P.started && P.kind !== 'embed';
  /* paused: YouTube draws its own "More videos" / title panel over a paused frame, so a paused frame is replaced by our own cover */
  const paused = !ended && !wait && P.kind === 'yt' && s.playing === false;
  if (!ended && !wait && !paused) { if (c) c.remove(); return; }
  const msg = ended ? coverMsg() : '', can = canMore(), key = [thumb(m), msg, can, ui.more, paused ? 'p' : ''].join('|');
  if (!c) { c = document.createElement('div'); c.id = 'vcover'; c.className = 'vcover'; w.appendChild(c); }
  if (c.dataset.k === key) return;
  c.dataset.k = key;
  c.classList.toggle('paused', paused);
  if (paused) { c.innerHTML = `<div class="cbg" style="background-image:url('${esc(thumb(m))}')"></div><span class="pz" aria-label="Paused">${ic('pause', 26)}</span>`; return; }
  c.innerHTML = `<div class="cbg" style="background-image:url('${esc(thumb(m))}')"></div>${ended ? `<b>${esc(msg)}</b><div class="cbt">${can ? `<button class="pill" data-r="more">${ic('clap', 18)}More videos</button>` : ''}<button class="pill alt" data-r="add">${ic('searchplay', 18)}Add video</button></div>` : '<i class="spin" aria-hidden="true"></i>'}`;
  if (R.playback_mode === 'leader' && !isAdmin()) { const a = $('.pill.alt', c); if (a) a.remove(); }
}
function fitYT() {
  const w = $('#vwrap'), b = $('.ytbox'); if (!w || !b) return;
  const W = w.clientWidth, H = w.clientHeight; if (!W || !H) return;
  const bw = Math.min(W, Math.round(H * 16 / 9));
  Object.assign(b.style, { left: Math.round((W - bw) / 2) + 'px', width: bw + 'px', top: '-72px', height: (H + 144) + 'px' });
}
let mediaFailT = 0;
function mediaFailed() {
  if (!R || !isAdmin() || P.failed || Date.now() - mediaFailT < 3000) return;
  P.failed = true; mediaFailT = Date.now();
  rpc('room_media_failed', { p_room: R.id, p_ver: R.media_ver }).catch(() => {});
}

/* chat feed */
function noticeIcon(t) {
  t = String(t || '');
  const n = /^Room is set to (\w+)/.exec(t);
  if (n) return ic({ Public: 'globe', Nearby: 'pin', Friends: 'users', Invite: 'lock' }[n[1]] || 'globe', 15);
  if (/mic/i.test(t)) return ic(/disabled/i.test(t) ? 'micoff' : 'mic', 15);
  if (/^Playback|^Voting/.test(t)) return ic('play', 15);
  return ic('gear', 15);
}
function msgHTML(m) {
  const u = who(m.user_id);
  if (m.kind === 'notice') return `<div class="nt" role="status"><span>${noticeIcon(m.body)}<em>${esc(m.body)}</em></span></div>`;
  if (m.kind === 'system') return `<div class="sy">${userAvatar(u, 24)}<span><b>${esc(nm(u))}</b> ${esc(m.body)}</span></div>`;
  const me = m.user_id === ME.id;
  const text = esc(m.tr || m.body).replace(/@([\w.]{2,24})/g, (a, n) =>
    members.some(x => (who(x.user_id).username || '').toLowerCase() === n.toLowerCase()) ? `<span class="mn">${a}</span>` : a);
  const att = MEDIA() && Array.isArray(m.attachments) && m.attachments.length ? MEDIA().render(m.attachments) : '';
  const time = m.created_at ? `<time>${new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>` : '';
  return `<div class="cm${me ? ' me' : ''}">${userAvatar(u, 32)}<div class="cb2">${me ? '' : `<small>${esc(nm(u))}</small>`}${text ? `<p>${text}</p>` : ''}${att ? `<div class="message-attachments">${att}</div>` : ''}${time}</div></div>`;
}
/* "Now playing" notice: a normal centred chat line that scrolls away with the conversation */
function noteNow(m) {
  const key = [m.kind, m.id || '', m.pl || '', m.url || '', R.media_ver || ''].join('|');
  if (ui.nowKeys[key]) return;
  const first = !Object.keys(ui.nowKeys).length;   // entering a room is not a vote result
  ui.nowKeys[key] = 1;
  if (!first && ui.voteSeen && R.playback_mode === 'vote') toast('Winner: ' + (m.title || 'Video'));   // the vote closed and its winner is starting
  ui.voteSeen = false;
  ui.events.push({ t: snow(), title: m.title || 'Video', th: thumb(m), kind: m.kind, media: Object.assign({}, m) });
  if (ui.events.length > 40) ui.events.shift();
  renderFeed();
}
function nowHTML(e, index) {
  const media = e.media || {};
  const canLikeMedia = canLike(media);
  const liked = canLikeMedia && NovaApp.isLiked(likeItem(media));
  return `<div class="nowm"><div class="nowc">${e.th ? `<img src="${esc(e.th)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="nowi">${ic('play', 14)}</span>`}<span class="nowt"><small>Now playing</small><b>${esc(e.title)}</b></span>${canLikeMedia ? `<button class="cb${liked ? ' on' : ''}" data-r="like" data-event-index="${index}" aria-label="${liked ? 'Unlike video' : 'Like video'}">${ic('heart', 18).replace('fill="none"', liked ? 'fill="currentColor"' : 'fill="none"')}</button>` : ''}</div></div>`;
}
const PRIV_WINDOW = 15000;
/* ms left to answer "Who can join this room?" - only for the admin of a brand-new room; the server decides via privacy_chosen */
function privLeft() {
  if (!R || !isAdmin() || R.privacy_chosen === true) return 0;
  const t = Date.parse(R.created_at) || 0;
  return t ? Math.max(0, PRIV_WINDOW - (snow() - t)) : 0;
}
/* nobody chose within 15 s -> the room stays Public; the server posts "Room is set to Public" in the chat */
function privTick() {
  if (!R || !isAdmin() || R.privacy_chosen === true || ui.privTried) return;
  const t = Date.parse(R.created_at) || 0;
  if (!t || snow() - t < PRIV_WINDOW) return;
  ui.privTried = true;
  const id = R.id;
  rpc('room_privacy_confirm', { p_room: id })
    .then(row => { if (R && row && row.id === id) R = Object.assign({}, R, row); })
    .catch(() => {})
    .then(() => { if (R && R.id === id) renderFeed(); });
}
function cardsHTML() {
  const left = privLeft();
  if (!left) return '';
  return `<div class="cg" id="privcard"><div class="cgt"><span>Who can join this room?</span></div><div class="opt">${PRIV.map(p => optBtn('privacy:' + p[0], p[1], p[2], p[0] === R.privacy)).join('')}</div><small class="cgh">Stays ${esc((PRIV.find(x => x[0] === R.privacy) || PRIV[0])[2])} if you don't choose</small><div class="cgbar" aria-hidden="true"><i style="animation-duration:${PRIV_WINDOW}ms;animation-delay:-${PRIV_WINDOW - left}ms"></i></div></div>`;
}
function renderFeed() {
  const f = $('#feed'); if (!f || !R) return;
  const near = f.scrollHeight - f.scrollTop - f.clientHeight < 90;
  const items = msgs.map(m => ({ t: Date.parse(m.created_at) || 0, h: msgHTML(m), sys: m.kind === 'system' }))
    .concat(ui.events.map((e, i) => ({ t: e.t, h: nowHTML(e, i), sys: false })));
  items.sort((a, b) => a.t - b.t);
  let h = '', done = false;
  items.forEach(i => { h += i.h; if (!done && i.sys) { done = true; h += cardsHTML(); } });
  if (!done) h += cardsHTML();
  if (!msgs.some(m => m.kind === 'chat')) h += '<div class="fempty">No messages yet — say hi 👋</div>';
  f.innerHTML = h;
  if (near || ui.first) { f.scrollTop = f.scrollHeight; ui.first = false; }
}
function syncTyping() { const c = $('#cin'), i = $('#cmsg'); if (c && i) c.classList.toggle('has-text', !!i.value.trim() || !!(MEDIA() && MEDIA().count())); }
let sending = false;
async function sendMsg() {
  const i = $('#cmsg'); if (!i || !R || sending) return;
  const body = i.value.trim().slice(0, 500);
  const hasMedia = !!(MEDIA() && MEDIA().count());
  if (!body && !hasMedia) return;
  sending = true;
  const btn = $('.sendb'); if (btn) btn.disabled = true;
  try {
    let attachments = [], cleanup = null;
    if (hasMedia) { const r = await MEDIA().prepare(R.id, ME.id); attachments = r.attachments; cleanup = r.cleanup; }
    const row = { room_id: R.id, user_id: ME.id, body, kind: 'chat' };
    if (attachments.length) row.attachments = attachments;
    const { data, error } = await sb.from('room_messages').insert(row).select(msgCols).single();
    if (error) {
      if (cleanup) cleanup();
      throw new Error(/attachments|room_messages_/i.test(error.message || '') && attachments.length ? 'Photos and files need room-media-schema.sql to be run in Supabase once.' : error.message);
    }
    i.value = ''; $('#mentions').hidden = true;
    if (hasMedia) MEDIA().reset();
    syncTyping();
    addMsg(data);
  } catch (e) { toast(e.message || 'Message was not sent.', 'err'); }
  finally { sending = false; if (btn) btn.disabled = false; }
}

/* sheets */
function sheet(html) { closeSheet(true); const o = document.createElement('div'); o.className = 'md'; o.id = 'rmodal'; o.innerHTML = `<div class="mb">${html}</div>`; o.addEventListener('mousedown', e => { if (e.target === o) closeSheet(); }); $('#rm').appendChild(o); }
function closeSheet(keep) { const o = $('#rmodal'); if (o) o.remove(); if (!keep) ui.sheet = ''; }
function renderSheet() { if (ui.sheet === 'people') openPeople(true); }
function openPeople(refresh) {
  ui.sheet = 'people';
  const adm = isAdmin();
  const mem = members.map(m => {
    const u = who(m.user_id), me = m.user_id === ME.id, isA = m.user_id === R.admin_id;
    return `<div class="li">${userAvatar(u, 42, micOf(m.user_id))}<div><b>${esc(nm(u))}</b>${isA ? ' <span class="crownb">' + ic('crown', 15) + '</span>' : ''}${me ? ' (you)' : ''}${micOf(m.user_id) ? ' <span class="micon" data-vu="' + m.user_id + '">' + ic('mic', 14) + '</span>' : ''}<small>@${esc(u.username || '')}</small>${Nova.geo ? Nova.geo.line(u, { cls: 'sm left' }) : ''}</div>
      ${adm && !me ? `${R.privacy !== 'public' ? `<button class="cb${m.mic_allowed ? ' on' : ''}" data-r="member-mic" data-id="${esc(m.user_id)}" data-on="${m.mic_allowed ? 'false' : 'true'}" title="${m.mic_allowed ? 'Disable microphone' : 'Enable microphone'}" aria-label="${m.mic_allowed ? 'Disable microphone' : 'Enable microphone'}">${ic(m.mic_allowed ? 'mic' : 'micoff', 17)}</button>` : ''}<button class="cb crownb" data-r="transfer" data-id="${esc(m.user_id)}" title="Make admin" aria-label="Make admin">${ic('crown', 18)}</button><button class="cb" data-r="kick" data-id="${esc(m.user_id)}" title="Kick from room" aria-label="Kick from room">${ic('x', 18)}</button>` : ''}</div>`;
  }).join('');
  const vote = R.playback_mode === 'vote', lead = R.playback_mode === 'leader';
  const sorted = vote ? queue.slice().sort((a, b) => (b.votes || []).length - (a.votes || []).length) : queue.slice();
  const que = sorted.length ? sorted.map((q, i) => {
    const v = (q.votes || []).length, mine = (q.votes || []).includes(ME.id), isNext = lead && R.next_id === q.id;
    return `<div class="li"><img class="th" src="${esc(thumb(q.media))}" alt=""><div><b>${esc(q.media.title || 'Video')}</b><small>${isNext ? 'Next · ' : ''}${q.suggested ? 'Suggested' : 'Added by ' + esc(nm(who(q.added_by)))}</small></div>
      ${vote ? `<button class="cb${mine ? ' on' : ''}" data-r="vote" data-id="${q.id}" aria-label="Vote">${ic('heart', 16)} ${v}</button>` : ''}
      ${adm && !vote ? `<button class="cb" data-r="qmove" data-d="-1" data-id="${q.id}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${ic('up', 16)}</button><button class="cb" data-r="qmove" data-d="1" data-id="${q.id}" aria-label="Move down" ${i === sorted.length - 1 ? 'disabled' : ''}>${ic('down', 16)}</button>` : ''}
      ${adm && lead ? `<button class="cb${isNext ? ' on' : ''}" data-r="setnext" data-id="${q.id}" aria-label="Play next">${ic('check', 16)}</button>` : ''}
      ${adm ? `<button class="cb" data-r="playq" data-id="${q.id}" aria-label="Play now">${ic('play', 16)}</button>` : ''}
      ${adm || q.added_by === ME.id ? `<button class="cb" data-r="rmq" data-id="${q.id}" aria-label="Remove">${ic('trash', 16)}</button>` : ''}</div>`;
  }).join('') : '<p class="em">Nothing queued yet. Tap the search button at the top to add videos.</p>';
  const micHint = adm && R.privacy !== 'public' ? '<p class="mnote">Tap a member microphone button to enable or disable their mic.</p>' : '';
  const html = `<div class="tabs"><button class="${ui.tab === 'members' ? 'on' : ''}" data-r="tab" data-t="members">Members (${members.length})</button><button class="${ui.tab === 'queue' ? 'on' : ''}" data-r="tab" data-t="queue">Up next (${queue.length})</button></div>${ui.tab === 'members' ? micHint + mem : que}<div class="row"><button class="s" data-r="close">Close</button></div>`;
  if (refresh && $('#rmodal')) { $('#rmodal .mb').innerHTML = html; } else sheet(html);
}
function openShare() {
  ui.sheet = 'share';
  sheet(`<h3>Invite to this room</h3><div class="li"><div><small>Invite link</small><b>${esc(link())}</b></div><button class="cb" data-r="copy" aria-label="Copy">${ic('copy', 18)}</button></div>
  <div class="apps"><button class="app a-sms" data-r="app" data-a="sms"><i>${ic('chat', 26)}</i>Messages</button><button class="app a-sc" data-r="app" data-a="sc"><i>${ic('ghost', 26)}</i>Snapchat</button><button class="app a-wa" data-r="app" data-a="wa"><i>${ic('phone', 26)}</i>WhatsApp</button><button class="app a-tg" data-r="app" data-a="tg"><i>${ic('send', 26)}</i>Telegram</button><button class="app" data-r="app" data-a="more"><i>${ic('more', 26)}</i>More</button></div>
  <div class="row"><button class="s" data-r="invite">Invite friends</button><button class="p" data-r="close">Done</button></div>`);
}
async function openInvite() {
  ui.sheet = 'invite';
  sheet('<h3>Invite friends</h3><input type="search" id="fq" placeholder="Search friends" autocomplete="off"><div class="fl" id="fl"><p class="em">Loading…</p></div><div class="row"><button class="s" data-r="copy">Copy link</button><button class="p" data-r="sendinv">Invite selected</button></div>');
  try {
    const { data, error } = await sb.from('friendships').select('user_id,friend_id').eq('status', 'accepted').or(`user_id.eq.${ME.id},friend_id.eq.${ME.id}`);
    if (error) throw error;
    const ids = [...new Set((data || []).map(r => r.user_id === ME.id ? r.friend_id : r.user_id))];
    await loadProfiles(ids);
    ui.friends = ids.map(who);
    renderFriends('');
  } catch (e) { const f = $('#fl'); if (f) f.innerHTML = '<p class="em">Could not load friends.</p>'; }
}
function renderFriends(q) {
  const f = $('#fl'); if (!f) return;
  const inRoom = new Set(members.map(m => m.user_id)), t = q.trim().toLowerCase();
  const list = ui.friends.filter(u => !inRoom.has(u.id) && (!t || (nm(u) + ' ' + (u.username || '')).toLowerCase().includes(t)));
  f.innerHTML = list.length ? list.map(u => `<label>${userAvatar(u, 38)}<span style="flex:1"><b>${esc(nm(u))}</b><br><small>@${esc(u.username || '')}</small></span><input type="checkbox" value="${esc(u.id)}"></label>`).join('') : '<p class="em">No friends to invite.</p>';
}
async function openUserMenu(id) {
  if (!R || !members.some(m => m.user_id === id) || id === ME.id) return;
  ui.sheet = 'user-menu';
  const u = who(id);
  sheet(`<div class="mh"><h3>${esc(nm(u))}</h3><button class="mx" data-r="close" aria-label="Close">${ic('x', 18)}</button></div><p class="em">Loading actions…</p>`);
  try {
    const { data, error } = await sb.from('friendships').select('user_id,friend_id,status')
      .or(`and(user_id.eq.${ME.id},friend_id.eq.${id}),and(user_id.eq.${id},friend_id.eq.${ME.id})`);
    if (error) throw error;
    if (!R || !members.some(m => m.user_id === id)) return closeSheet();
    const relation = (data || [])[0];
    const friend = relation && relation.status === 'accepted';
    const incoming = relation && relation.status === 'pending' && relation.user_id === id;
    const outgoing = relation && relation.status === 'pending' && relation.user_id === ME.id;
    const actions = [
      `<button class="op" data-r="user-action" data-a="profile" data-id="${esc(id)}">${ic('userplus', 18)}<span>Profile</span></button>`,
      friend
        ? `<button class="op" data-r="user-action" data-a="unfriend" data-id="${esc(id)}">${ic('users', 18)}<span>Remove Friend</span></button>`
        : incoming
          ? `<button class="op" data-r="user-action" data-a="accept" data-id="${esc(id)}">${ic('check', 18)}<span>Accept Friend Request</span></button>`
          : outgoing
            ? `<button class="op" disabled>${ic('check', 18)}<span>Friend Request Sent</span></button>`
            : `<button class="op" data-r="user-action" data-a="friend" data-id="${esc(id)}">${ic('userplus', 18)}<span>Add Friend</span></button>`,
      `<button class="op" data-r="user-action" data-a="mute" data-id="${esc(id)}">${ic(mutedUsers.has(id) ? 'vol' : 'micoff', 18)}<span>${mutedUsers.has(id) ? 'Unmute' : 'Mute'}</span></button>`,
      `<button class="op" data-r="user-action" data-a="block" data-id="${esc(id)}">${ic('x', 18)}<span>Block</span></button>`,
      `<button class="op" data-r="user-action" data-a="report" data-id="${esc(id)}">${ic('at', 18)}<span>Report</span></button>`
    ];
    if (isAdmin()) actions.push(`<button class="op danger" data-r="user-action" data-a="kick" data-id="${esc(id)}">${ic('trash', 18)}<span>Kick from room</span></button>`);
    $('#rmodal .mb').innerHTML = `<div class="mh"><h3>${esc(nm(u))}</h3><button class="mx" data-r="close" aria-label="Close">${ic('x', 18)}</button></div><div class="user-actions">${actions.join('')}</div>`;
  } catch (e) {
    const box = $('#rmodal .mb');
    if (box) box.innerHTML = `<div class="mh"><h3>${esc(nm(u))}</h3><button class="mx" data-r="close" aria-label="Close">${ic('x', 18)}</button></div><p class="hint err">Could not load friendship actions: ${esc(e.message || 'Please try again.')}</p><div class="user-actions"><button class="op" data-r="user-action" data-a="profile" data-id="${esc(id)}"><span>Profile</span></button><button class="op" data-r="user-action" data-a="friend" data-id="${esc(id)}"><span>Add Friend</span></button><button class="op" data-r="user-action" data-a="mute" data-id="${esc(id)}"><span>${mutedUsers.has(id) ? 'Unmute' : 'Mute'}</span></button><button class="op" data-r="user-action" data-a="block" data-id="${esc(id)}"><span>Block</span></button><button class="op" data-r="user-action" data-a="report" data-id="${esc(id)}"><span>Report</span></button>${isAdmin() ? `<button class="op danger" data-r="user-action" data-a="kick" data-id="${esc(id)}"><span>Kick from room</span></button>` : ''}</div>`;
  }
}
async function changeFriendship(id, remove) {
  const { data, error } = await sb.from('friendships').select('user_id,friend_id,status')
    .or(`and(user_id.eq.${ME.id},friend_id.eq.${id}),and(user_id.eq.${id},friend_id.eq.${ME.id})`);
  if (error) throw error;
  const relation = (data || [])[0];
  if (remove) {
    const first = await sb.from('friendships').delete().eq('user_id', ME.id).eq('friend_id', id);
    if (first.error) throw first.error;
    const second = await sb.from('friendships').delete().eq('user_id', id).eq('friend_id', ME.id);
    if (second.error) throw second.error;
    toast('Friend removed');
  } else if (relation && relation.status === 'pending' && relation.user_id === id) {
    const result = await sb.from('friendships').update({ status: 'accepted' }).eq('user_id', id).eq('friend_id', ME.id).eq('status', 'pending');
    if (result.error) throw result.error;
    toast('Friend request accepted');
  } else if (!relation) {
    const result = await sb.from('friendships').insert({ user_id: ME.id, friend_id: id });
    if (result.error) throw result.error;
    toast('Friend request sent');
  } else toast('A friend request is already pending');
  openUserMenu(id);
}
function openReport(id) {
  ui.sheet = 'report';
  sheet(`<div class="mh"><h3>Report ${esc(nm(who(id)))}</h3><button class="mx" data-r="close" aria-label="Close">${ic('x', 18)}</button></div>
    <p class="mnote">Your report is stored privately for moderator review.</p>
    <label class="sgh" for="reportReason"><b>Reason</b></label><select id="reportReason"><option value="harassment">Harassment or bullying</option><option value="hate_speech">Hate speech</option><option value="spam">Spam</option><option value="inappropriate">Inappropriate content</option><option value="safety">Safety concern</option><option value="other">Other</option></select>
    <label class="sgh" for="reportDetails"><b>Details (optional)</b></label><textarea id="reportDetails" maxlength="1000" rows="4" placeholder="Add context for the reviewer"></textarea>
    <div class="row"><button class="s" data-r="close">Cancel</button><button class="p" data-r="user-action" data-a="submit-report" data-id="${esc(id)}">Send report</button></div>`);
}
/* actions */
async function pick(m, now) {
  try {
    const r = await rpc('room_pick', { p_room: R.id, p_media: m, p_now: !!now });
    toast(r && r.action === 'queued' ? 'Added to Up next' : 'Playing now');
    afterPick();
    await refreshRoom(); renderAll(); mountMedia();
    return true;
  } catch (e) { oops(e); return false; }
}
async function handle(m, o) {
  o = o || {};
  if (!await auth()) { toast('Sign in to add a video to a room', 'err'); return false; }
  try {
    if (!R) {
      const row = await rpc('create_room', { p_title: m.title || 'Nova room', p_privacy: 'public', p_media: m });
      await enter(row);
      return true;
    }
    return await pick(m, !!o.now);
  } catch (e) { oops(e); return false; }
}
function ctx() {
  const busy = !!(R && R.media && !(R.play_state || {}).ended && !votingNow());
  return { inRoom: !!R, admin: isAdmin(), busy };
}
async function setOpt(v) {
  if (!isAdmin()) return toast('Only the admin can change this');
  const [k, val] = v.split(':'), a = { p_room: R.id };
  if (k === 'privacy') {
    a.p_privacy = val;
    if (val === 'nearby' && R.privacy !== 'nearby') {
      const pos = await locationReady('host');
      if (!pos) return toast('Location is needed for a Nearby room. The privacy was not changed.', 'err');
      a.p_lat = pos.lat; a.p_lng = pos.lng;
    }
  } else if (k === 'mode') a.p_mode = val;
  else if (k === 'votesec') a.p_vote_seconds = +val;
  else if (k === 'voice') a.p_voice = val === 'on';
  try { R = Object.assign({}, R, await rpc('room_update', a)); if (ui.sheet !== 'settings') closeSheet(); renderAll(); voiceSync(); } catch (e) { oops(e); }
}
function shareText() { return 'Join my Nova watch party' + (R.media && R.media.title ? ': ' + R.media.title : '') + ' ' + link(); }
async function copyLink() {
  try { await navigator.clipboard.writeText(link()); toast('Invite link copied'); }
  catch (e) { prompt('Copy this invite link', link()); }
}
function shareApp(a) {
  const t = encodeURIComponent(shareText()), u = encodeURIComponent(link()), open = x => window.open(x, '_blank', 'noopener');
  if (a === 'sms') location.href = 'sms:?&body=' + t;
  else if (a === 'wa') open('https://wa.me/?text=' + t);
  else if (a === 'tg') open('https://t.me/share/url?url=' + u + '&text=' + encodeURIComponent('Join my Nova watch party'));
  else if (a === 'sc') open('https://www.snapchat.com/scan?attachmentUrl=' + u);
  else if (navigator.share) navigator.share({ title: 'Nova watch party', text: shareText(), url: link() }).catch(() => {});
  else copyLink();
}

function onClick(e) {
  if (longPressed) { longPressed = false; e.preventDefault(); e.stopPropagation(); return; }
  if (R) resumeAudio();
  const avatar = e.target.closest('.uav[data-user-id]');
  if (avatar) {
    e.preventDefault();
    e.stopPropagation();
    const page = window.open(profileHref(avatar.dataset.userId), '_blank');
    if (page) page.opener = null;
    if (!page) location.href = profileHref(avatar.dataset.userId);
    return;
  }
  const el = e.target.closest('[data-r]'); if (!el || !R) return;
  const d = el.dataset, r = d.r;
  if (r === 'leave') leave();
  else if (r === 'dock') { if (window.NovaDock) NovaDock.toggle(); }
  else if (r === 'settings') openSettings();
  else if (r === 'set') setOpt(d.v);
  else if (r === 'add') {
    if (!isAdmin() && R.playback_mode === 'leader') return toast('Only the admin can pick videos');
    closeSheet(); if (typeof show === 'function') show('picker', true);
  }
  else if (r === 'people') { ui.tab = 'members'; openPeople(); }
  else if (r === 'tab') { ui.tab = d.t; openPeople(true); }
  else if (r === 'close') closeSheet();
  else if (r === 'mic') toggleMic();
  else if (r === 'share') openShare();
  else if (r === 'invite') openInvite();
  else if (r === 'send') sendMsg();
  else if (r === 'copy') copyLink();
  else if (r === 'app') shareApp(d.a);
  else if (r === 'openset') openSettings();
  else if (r === 'tap') { hideTap(); pl.play(); applyState(true); }
  else if (r === 'toggle' && isAdmin()) { if (pl.playing()) { pl.pause(); publish(false, pl.time()); } else { pl.play(); publish(true, pl.time()); } updateTimeUI(); }
  else if ((r === 'back' || r === 'fwd') && isAdmin()) { const t = Math.max(0, pl.time() + (r === 'back' ? -10 : 10)); pl.seek(t); publish(pl.playing(), t); }
  else if (r === 'skip' && isAdmin()) {
    rpc('room_skip', { p_room: R.id, p_ver: R.media_ver }).catch(oops);
  }
  else if (r === 'like') {
    const event = d.eventIndex == null ? null : ui.events[Number(d.eventIndex)];
    const media = event ? event.media : R.media;
    if (canLike(media)) {
      NovaApp.toggleLike(likeItem(media));
      renderNow();
    }
  }
  else if (r === 'vote') rpc('room_vote', { p_queue_id: d.id }).then(refreshQueue).catch(oops);
  else if (r === 'more') toggleMore();
  else if (r === 'moreclose') closeMore();
  else if (r === 'closevote') endVote();
  else if (r === 'qmove') rpc('room_queue_move', { p_queue_id: d.id, p_dir: Number(d.d) }).then(refreshQueue).catch(oops);
  else if (r === 'setnext') rpc('room_set_next', { p_room: R.id, p_queue_id: d.id }).then(() => refreshRoom().then(() => { renderSheet(); paintMore(); })).catch(oops);
  else if (r === 'mv') tapMore(Number(d.i));
  else if (r === 'mvscroll') { const row = $('#mvrow'); if (row) row.scrollBy({ left: Number(d.d) * Math.max(160, row.clientWidth * .8), behavior: 'smooth' }); }
  else if (r === 'playq') rpc('room_advance', { p_room: R.id, p_queue_id: d.id, p_ver: R.media_ver }).then(() => closeSheet()).catch(oops);
  else if (r === 'rmq') rpc('room_queue_remove', { p_queue_id: d.id }).then(refreshQueue).catch(oops);
  else if (r === 'transfer') {
    const u = who(d.id);
    if (confirm('Make ' + nm(u) + ' the admin? You will lose admin control.')) rpc('room_transfer', { p_room: R.id, p_user: d.id }).then(() => refreshRoom().then(() => { renderAll(); mountMedia(); })).catch(oops);
  }
  else if (r === 'kick') {
    const u = who(d.id);
    if (confirm('Kick ' + nm(u) + ' from this room? They can rejoin only if you invite them again.'))
      rpc('room_kick', { p_room: R.id, p_user: d.id }).then(() => { if (ch) ch.send({ type: 'broadcast', event: 'kick', payload: { uid: d.id } }); refreshMembers(); toast('Removed from the room'); }).catch(oops);
  }
  else if (r === 'sendinv') {
    const ids = $$('#fl input:checked').map(x => x.value);
    if (!ids.length) return toast('Select at least one friend');
    rpc('room_invite', { p_room: R.id, p_users: ids }).then(n => { toast(n + ' friend' + (n === 1 ? '' : 's') + ' invited'); closeSheet(); }).catch(oops);
  }
  else if (r === 'member-mic') {
    rpc('room_set_member_mic', { p_room: R.id, p_user: d.id, p_allowed: d.on === 'true' })
      .then(refreshMembers).catch(oops);
  }
  else if (r === 'user-action') {
    if (d.a === 'profile') {
      const page = window.open(profileHref(d.id), '_blank');
      if (page) page.opener = null;
      if (!page) location.href = profileHref(d.id);
    } else if (d.a === 'friend' || d.a === 'accept') {
      changeFriendship(d.id, false).catch(e => toast(e.message || 'Friend request failed', 'err'));
    } else if (d.a === 'unfriend') {
      if (confirm('Remove this friend?')) changeFriendship(d.id, true).catch(e => toast(e.message || 'Could not remove friend', 'err'));
    } else if (d.a === 'mute') {
      setUserMuted(d.id, !mutedUsers.has(d.id));
      toast(mutedUsers.has(d.id) ? 'User muted' : 'User unmuted');
      openUserMenu(d.id);
    } else if (d.a === 'block') {
      if (confirm('Block this user? This also removes any friendship and prevents friend requests and direct chats.')) {
        rpc('block_user', { p_blocked_id: d.id }).then(() => {
          setUserMuted(d.id, true);
          toast('User blocked');
          closeSheet();
        }).catch(oops);
      }
    } else if (d.a === 'report') openReport(d.id);
    else if (d.a === 'submit-report') {
      const reason = $('#reportReason'), details = $('#reportDetails');
      el.disabled = true;
      rpc('room_report_user', { p_room: R.id, p_user: d.id, p_reason: reason ? reason.value : 'other', p_details: details ? details.value.trim() : '' })
        .then(() => { closeSheet(); toast('Report sent'); })
        .catch(e => { el.disabled = false; oops(e); });
    } else if (d.a === 'kick') {
      const u = who(d.id);
      if (isAdmin() && confirm('Kick ' + nm(u) + ' from this room? They can rejoin only if you invite them again.')) {
        rpc('room_kick', { p_room: R.id, p_user: d.id }).then(() => {
          if (ch) ch.send({ type: 'broadcast', event: 'kick', payload: { uid: d.id } });
          refreshMembers();
          closeSheet();
        }).catch(oops);
      }
    }
  }
}
function onInput(e) {
  const t = e.target;
  if (t.id === 'seek') {
    P.drag = true; const dur = pl.dur(); if (dur) $('#tcur').textContent = fmt(dur * t.value / 1000);
  } else if (t.id === 'volr') {
    ui.vol = +t.value; localStorage.setItem('nova_vol', ui.vol); applyVolume();
  } else if (t.id === 'fq') renderFriends(t.value);
  else if (t.id === 'cmsg') {
    syncTyping();
    const box = $('#mentions'), m = /@([\w.]*)$/.exec(t.value.slice(0, t.selectionStart || t.value.length));
    if (!m) { box.hidden = true; return; }
    const c = members.filter(x => x.user_id !== ME.id && (who(x.user_id).username || '').toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 8);
    if (!c.length) { box.hidden = true; return; }
    box.innerHTML = c.map(x => { const u = who(x.user_id); return `${userAvatar(u, 24)}<button data-u="${esc(u.username || '')}">@${esc(u.username || '')}</button>`; }).join('');
    box.hidden = false;
    box.onclick = ev => {
      const b = ev.target.closest('[data-u]'); if (!b) return;
      t.value = t.value.replace(/@([\w.]*)$/, '@' + b.dataset.u + ' '); box.hidden = true; t.focus();
    };
  }
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'seek' && isAdmin()) {
    const dur = pl.dur(), pos = dur ? dur * t.value / 1000 : 0;
    pl.seek(pos); publish(pl.playing(), pos); P.drag = false;
  } else if (t.id === 'trsw') Nova.set('translate', t.checked);
  else if (t.id === 'voicesw') setOpt('voice:' + (t.checked ? 'on' : 'off'));
}

/* =====================================================================
   HOME  (Invited / Public lists, join links, resume)
   ===================================================================== */
function card(r) {
  const m = r.media, ps = r.play_state || {}, dur = m && m.duration;
  const pos = ps.playing ? (ps.pos || 0) + (snow() - ps.ts) / 1000 : (ps.pos || 0);
  const pct = dur ? Math.max(2, Math.min(100, pos / dur * 100)) : 0;
  const pv = (PRIV.find(x => x[0] === r.privacy) || PRIV[0])[1];
  const av = (r.members || []).slice(0, 4).map(u => userAvatar(u, 30, false, u.id === r.admin_id)).join('');
  const more = Math.max(0, (r.count || 0) - 4);
  return `<div class="room${r.invited ? ' inv' : ''}" role="button" tabindex="0" data-code="${esc(r.code)}" data-rid="${esc(r.id)}">
    <div class="cover">${thumb(m) ? `<img src="${esc(thumb(m))}" alt="" loading="lazy" decoding="async">` : ''}<span class="pv">${ic(pv, 16)}</span>${platBadge(m, 'card')}</div>
    <div class="info"><b class="rt">${esc((m && m.title) || r.title)}</b><div class="avs">${av}${more ? `<em>+${more}</em>` : ''}</div></div>
    ${pct ? `<i class="prog" style="width:${pct * .62}%"></i>` : ''}</div>`;
}
function renderHome() {
  const q = ($('#hs') ? $('#hs').value : '').trim().toLowerCase();
  const rooms = homeRooms.filter(r => !r.mine && (!q || ((r.media && r.media.title) || r.title || '').toLowerCase().includes(q)));
  const inv = rooms.filter(r => r.invited), pub = rooms.filter(r => !r.invited);
  const set = (l, e, list, emptyText) => {
    const a = $('#' + l), b = $('#' + e);
    if (a) a.innerHTML = list.map(card).join('');
    if (!b) return;
    b.hidden = list.length > 0;
    if (list.length) return;
    if (!homeLoaded) {
      b.innerHTML = '<i class="spin" aria-hidden="true"></i> Loading rooms…';
      b.setAttribute('aria-live', 'polite');
    } else if (homeLoadError) {
      b.innerHTML = 'Could not load rooms. <button type="button" data-home-retry>Try again</button>';
      b.setAttribute('role', 'alert');
    } else {
      b.textContent = emptyText;
      b.removeAttribute('aria-live');
      b.removeAttribute('role');
    }
  };
  set('invL', 'invE', inv, 'No invited rooms right now.');
  set('pubL', 'pubE', pub, 'No public rooms right now.');
  if (window.NovaCards) NovaCards.afterRender();
}
const dockOpen = () => !!(window.NovaDock && NovaDock.isOpen());
async function loadHome() {
  if ((R && !dockOpen()) || homeLoading) return;
  homeLoading = true;
  if (!homeLoaded) renderHome();
  try {
    if (!await auth()) {
      homeRooms = [];
      homeLoadError = 'Sign in to load rooms.';
      return;
    }
    const pos = JSON.parse(sessionStorage.getItem('nova_pos') || 'null');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      homeRooms = await rpc('list_rooms', { p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null }, controller.signal) || [];
    } catch (e) {
      if (controller.signal.aborted) throw new Error('Loading rooms timed out. Check your connection and try again.');
      throw e;
    } finally {
      clearTimeout(timeout);
    }
    homeLoadError = '';
    homeErrorNotified = '';
  } catch (e) {
    homeRooms = [];
    homeLoadError = e && e.message || 'Could not load rooms.';
    if (homeErrorNotified !== homeLoadError) { oops(e); homeErrorNotified = homeLoadError; }
  } finally {
    homeLoaded = true;
    homeLoading = false;
    renderHome();
  }
}
async function joinByCode(code, pos) {
  if (!await auth()) { try { sessionStorage.setItem('nova_join', code); } catch (e) {} location.href = 'index.html'; return; }
  pos = pos || cachedPos();
  try { const row = await rpc('join_room', { p_code: code, p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null }); await enter(row); }
  catch (e) { await joinDenied(e, code, pos); }
}
/* the server said no: show the right message, never room details, and allow a safe retry for location problems */
async function joinDenied(e, code, pos) {
  const h = (e && e.hint) || '';
  const retryAct = [{ label: 'Try again', value: 'retry', primary: true }, { label: 'Close', value: 'close' }];
  if (h === 'nearby_location' && !pos) {
    const p = await locationReady('join');
    if (p) return joinByCode(code, p);
    if (await gate({ icon: 'pin', title: 'Location needed', text: 'This Nearby Watch Party needs to confirm that you are close by. Allow location access to try again.', actions: retryAct }) === 'retry') {
      const p2 = await getPos(true); if (p2) return joinByCode(code, p2);
    }
  } else if (h === 'nearby_location' || h === 'nearby_range' || h === 'nearby_unverified') {
    const v = await gate({ icon: 'pin', title: 'Could not verify your location', text: 'We could not confirm that you are near this Watch Party. Check your location settings and try again.', actions: retryAct });
    if (v === 'retry') { const p = await getPos(true); if (p) return joinByCode(code, p); }
  } else if (h === 'friends') await gate({ icon: 'users', title: 'Friends Only Room', text: 'This Watch Party is available only to friends of the room host.' });
  else if (h === 'invite') await gate({ icon: 'lock', title: 'Invite Only Room', text: 'This Watch Party is invite only. Ask the host to invite you.' });
  else if (h === 'banned' || h === 'blocked' || h === 'full' || h === 'closed') await gate({ icon: 'lock', title: h === 'full' ? 'Room is full' : h === 'closed' ? 'Room unavailable' : 'Cannot join', text: (e && e.message) || 'You cannot join this room.' });
  else oops(e);
  loadHome();
}
function hashJoin() {
  const m = /^#join\/([A-Za-z0-9]{6,16})/.exec(location.hash);
  if (m) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} joinByCode(m[1]); return true; }
  return false;
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-home-retry]')) { loadHome(); return; }
  const avatar = e.target.closest('.uav[data-user-id]');
  if (avatar) {
    e.preventDefault();
    const url = profileHref(avatar.dataset.userId), page = window.open(url, '_blank');
    if (page) page.opener = null;
    if (!page) location.href = url;
    return;
  }
  const c = e.target.closest('.room[data-code]');
  if (!c) return;
  if (window.NovaCards && NovaCards.swallowClick(e)) return;   // long-press / right-click just opened the room menu
  switchTo(c.dataset.code);
});
/* tapping a room in the docked Nova Home while inside another room: confirm, then the server moves you */
async function switchTo(code) {
  if (R && R.code !== code) {
    const v = await gate({ icon: 'users', title: 'Switch rooms?', text: 'You will leave this Watch Party and join the other one.', actions: [{ label: 'Join', value: 'go', primary: true }, { label: 'Stay here', value: 'no' }] });
    if (v !== 'go') return;
  }
  joinByCode(code);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const c = e.target.closest && e.target.closest('.room[data-code]'); if (c && e.target === c) switchTo(c.dataset.code); }
  else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && window.NovaCards) {
    const c = e.target.closest && e.target.closest('.room[data-code]');
    if (c) { e.preventDefault(); NovaCards.openMenu(c.dataset.rid, c); }
  }
});
window.addEventListener('hashchange', hashJoin);

async function boot() {
  const u = await auth();
  if (!u) {
    const next = location.pathname.split('/').pop() + location.search + location.hash;
    location.replace('index.html?next=' + encodeURIComponent(next));
    return;
  }
  let code = null;
  try { code = sessionStorage.getItem('nova_join'); if (code) sessionStorage.removeItem('nova_join'); } catch (e) {}
  if (u) {
    if (code) { await joinByCode(code); }
    else if (!hashJoin()) {
      try {
        const { data: mem } = await sb.from('room_members').select('room_id').eq('user_id', u.id).maybeSingle();
        if (mem) {
          await rpc('room_heartbeat', { p_room: mem.room_id });
          const { data: row } = await sb.from('rooms').select('*').eq('id', mem.room_id).maybeSingle();
          if (row && row.status === 'open') await enter(row);
        }
      } catch (e) {}
    }
  } else hashJoin();
  loadHome();
  homeT = setInterval(() => { if ((!R || dockOpen()) && !document.hidden) loadHome(); }, 10000);
}

/* Small read-only API for room-cards.js (hover preview, long-press / right-click menu) */
function previewSource(m) {
  if (!m) return null;
  if (m.kind === 'youtube') return { type: 'youtube', id: m.id || '', pl: m.pl || '' };
  if (m.kind === 'video' && safeHttps(m.url)) {
    if (m.provider === 'web') {
      const info = webStreamInfo(m), px = new URL('/api/browse', location.href);
      px.searchParams.set('stream', '1'); px.searchParams.set('url', info.url);
      if (info.ref) px.searchParams.set('ref', info.ref);
      return { type: 'video', src: px.href, hls: info.hls || m.streamType === 'hls' };
    }
    return { type: 'video', src: m.url, hls: /\.m3u8(?:$|[?#])/i.test(m.url) };
  }
  return null;   // embeds cannot be muted / seeked from outside, so they keep the thumbnail
}
function livePos(r) {
  const ps = r.play_state || {};
  if (ps.ended) return { pos: ps.pos || 0, playing: false };
  return { pos: ps.playing ? (ps.pos || 0) + (snow() - (ps.ts || snow())) / 1000 : (ps.pos || 0), playing: !!ps.playing };
}
const roomApi = {
  rooms: () => homeRooms, byId: id => homeRooms.find(r => r.id === id) || null,
  previewSource, livePos, now: snow, attachSrc, thumb, fmt, PRIV, ic, platBadge,
  reload: () => loadHome(),
  dismiss: id => rpc('room_dismiss', { p_room: id }),
  reportVideo: (id, reason, details) => rpc('room_report_video', { p_room: id, p_reason: reason, p_details: details || '' }),
  toast, oops, inRoom: () => !!R && !dockOpen()
};
/* sync(): re-read the room + Up next and repaint (used by tests and as a manual re-sync) */
async function sync() { if (!R) return; await refreshRoom(); await refreshQueue(); renderAll(); await mountMedia(); }
window.NovaRoom = { handle, ctx, renderHome, active: () => !!R, ready: true, api: roomApi, sync, state: stateName, join: switchTo };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

(function() {
  let activeHlsInstance = null;

  function ensureHlsLibrary() {
    if (window.Hls) return Promise.resolve(window.Hls);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
      s.onload = () => resolve(window.Hls);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  window.loadWebMediaIntoRoomPlayer = async function(media, autoPlay = true) {
    if (!media || !media.url) return;

    const titleNodes = document.querySelectorAll('#roomVideoTitle, .room-video-title, #nowPlayingTitle, #videoTitle, .video-title');
    titleNodes.forEach((node) => {
      node.textContent = media.title || 'Web Video';
    });

    const sourceNodes = document.querySelectorAll('#roomVideoProvider, .room-video-provider, #videoProvider, .provider-badge');
    sourceNodes.forEach((node) => {
      node.textContent = media.sourceLabel || 'generic • Web';
    });

    const nowPlayingBanner = document.querySelector('#nowPlayingSubtext, .now-playing-text');
    if (nowPlayingBanner) {
      nowPlayingBanner.textContent = `Now playing ${media.title || 'Web Video'}`;
    }

    let videoEl = document.getElementById('novaHtml5Player') || document.querySelector('video.room-video-player, #playerContainer video, #videoContainer video');
    const container = document.getElementById('playerContainer') || document.getElementById('videoContainer') || document.querySelector('.video-stage, .player-wrapper, .video-wrapper, main') || document.body;

    const otherFrames = container.querySelectorAll('iframe');
    otherFrames.forEach((frame) => {
      frame.style.display = 'none';
    });

    const emptyStates = container.querySelectorAll('.empty-player, .no-video, #emptyPlayerState, .placeholder-screen');
    emptyStates.forEach((el) => {
      el.style.display = 'none';
    });

    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.id = 'novaHtml5Player';
      videoEl.className = 'room-video-player';
      videoEl.controls = true;
      videoEl.playsInline = true;
      videoEl.crossOrigin = 'anonymous';
      videoEl.style.width = '100%';
      videoEl.style.height = '100%';
      videoEl.style.backgroundColor = '#000';
      videoEl.style.objectFit = 'contain';
      container.prepend(videoEl);
    }

    videoEl.style.display = 'block';
    if (media.thumbnail) videoEl.poster = media.thumbnail;

    if (activeHlsInstance) {
      activeHlsInstance.destroy();
      activeHlsInstance = null;
    }

    const isHls = media.streamType === 'hls' || /\.m3u8(\?|$)/i.test(media.rawStreamUrl || media.url);

    if (isHls) {
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = media.url;
      } else {
        const HlsLib = await ensureHlsLibrary();
        if (HlsLib && HlsLib.isSupported()) {
          activeHlsInstance = new HlsLib({ enableWorker: true, lowLatencyMode: true });
          activeHlsInstance.loadSource(media.url);
          activeHlsInstance.attachMedia(videoEl);
        } else {
          videoEl.src = media.url;
        }
      }
    } else {
      videoEl.src = media.url;
    }

    if (autoPlay) {
      videoEl.play().catch(() => {
        videoEl.muted = true;
        videoEl.play().catch(() => {});
      });
    }

    if (window.roomChannel && typeof window.roomChannel.send === 'function') {
      window.roomChannel.send({
        type: 'broadcast',
        event: 'media_change',
        payload: media
      });
    }
  };

  window.onNovaWebMediaSelected = function(media) {
    window.loadWebMediaIntoRoomPlayer(media, true);
  };

  document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('provider') === 'web' && params.get('video')) {
      window.loadWebMediaIntoRoomPlayer({
        provider: 'web',
        sourceLabel: 'generic • Web',
        title: params.get('title') || 'Web Video',
        url: params.get('video'),
        rawStreamUrl: params.get('video')
      }, true);
      return;
    }

    try {
      const saved = sessionStorage.getItem('nova_active_web_media');
      if (saved) {
        const parsed = JSON.parse(saved);
        sessionStorage.removeItem('nova_active_web_media');
        if (parsed && parsed.url) {
          window.loadWebMediaIntoRoomPlayer(parsed, true);
        }
      }
    } catch (e) {}
  });
})();