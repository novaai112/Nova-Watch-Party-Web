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
  searchplay: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="M21 21l-5.2-5.2"/><polygon points="9 7.5 13.5 10.5 9 13.5 9 7.5"/>',
  heart: '<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z"/>',
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
  trash: '<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>'
};
const ic = (n, s) => `<svg class="ic" width="${s || 22}" height="${s || 22}" viewBox="0 0 24 24" ${ST} aria-hidden="true">${PATH[n] || ''}</svg>`;

const PRIV = [
  ['public', 'globe', 'Public', 'Anyone can join the room'],
  ['nearby', 'pin', 'Nearby', 'People near you can join'],
  ['friends', 'users', 'Friends only', "Only the host's friends can join"],
  ['invite', 'lock', 'Invite only', 'Only people with the invite link can join']
];
const MODES = [
  ['vote', 'check', "Let's vote", 'Voting occurs at the end of the video'],
  ['play', 'play', 'Just play', 'Picked videos play right away'],
  ['autoplay', 'ff', 'Autoplay', 'Videos play one after another'],
  ['leader', 'crown', "Leader's choice", 'Only the admin picks videos']
];

/* ---------- state ---------- */
let ME = null, R = null, members = [], queue = [], msgs = [], prof = {}, ch = null;
let skew = 0, hbT = null, tickT = null, homeT = null, homeRooms = [], mountKey = '', advAt = 0, endedAt = 0, pubT = 0, pubAt = 0;
let homeLoaded = false, homeLoading = false, homeLoadError = '', homeErrorNotified = '';
let roomSchemaWarned = false;
let ui = { sheet: '', tab: 'members', promptDone: false, vol: +(localStorage.getItem('nova_vol') || 50), friends: [], first: true, events: [], nowKeys: {} };
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
function getPos() {
  return new Promise(res => {
    try { const c = JSON.parse(sessionStorage.getItem('nova_pos') || 'null'); if (c && Date.now() - c.t < 600000) return res(c); } catch (e) {}
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => {
      const o = { lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now() };
      try { sessionStorage.setItem('nova_pos', JSON.stringify(o)); } catch (e) {}
      res(o);
    }, () => res(null), { timeout: 6000, maximumAge: 600000 });
  });
}
function link() {
  const base = /^https?:$/.test(location.protocol) ? location.origin + location.pathname
    : (CFG.WEBSITE_URL || '').replace(/\/?$/, '/') + 'nova-home.html';
  return base + '#join/' + R.code;
}

/* =====================================================================
   ENTER / LEAVE
   ===================================================================== */
async function enter(row) {
  cleanup(true);
  await syncClock();
  R = row; members = []; queue = []; msgs = []; mountKey = '';
  ui.first = true; ui.sheet = ''; ui.events = []; ui.nowKeys = {}; micMap.clear(); speak.clear();
  try { ui.promptDone = !!sessionStorage.getItem('nova_pd_' + R.id); } catch (e) { ui.promptDone = false; }
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
  const { data } = await sb.from('room_queue').select('id,added_by,media,votes,created_at').eq('room_id', R.id).order('created_at');
  queue = data || [];
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
        try { const row = await rpc('join_room', { p_code: R.code }); R = row; await Promise.all([refreshMembers(), refreshQueue()]); }
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
  const w = $('#vwrap'); if (w) $$('#vwrap > *:not(#vgrid)').forEach(n => n.remove());
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
  renderControls(); renderNow();
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
    v.addEventListener('playing', hideTap);
    v.addEventListener('error', () => {
      if (key !== mountKey) return;
      if (v._retry && v._retry()) return;
      const c = v.error && v.error.code;
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
  const vars = { autoplay: 0, controls: adm ? 1 : 0, rel: 0, playsinline: 1, modestbranding: 1, disablekb: adm ? 0 : 1, iv_load_policy: 3, fs: 1 };
  if (m.pl && !m.id) { vars.listType = 'playlist'; vars.list = m.pl; }
  else if (m.pl) vars.list = m.pl;
  if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
  P.kind = 'yt';
  P.yt = new YT.Player('ytp', {
    videoId: m.id || undefined, playerVars: vars,
    events: {
      onReady: () => { if (key !== mountKey) return; P.ready = true; pl.vol(); renderControls(); applyState(true); setTimeout(checkBlocked, 1800); },
      onStateChange: e => {
        const s = e.data;
        if ((s === 1 || s === 2) && isAdmin() && Date.now() > P.mute) publish(s === 1, pl.time());
        if (s === 1) hideTap();
        if (s === 0 && isAdmin()) ended();
        updateTimeUI();
      },
      onAutoplayBlocked: showTap,
      onError: () => toast('This video cannot be played in an embed' + (isAdmin() ? ' — skip it or pick another.' : '.'), 'err')
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
  rpc('room_ended', { p_room: R.id }).catch(() => {});
}
function onTick() {
  if (!R) return;
  updateTimeUI();
  if (mic && Date.now() - micAt > 4000) { micAt = Date.now(); announceMic(); }
  let gone_ = false;
  micMap.forEach((v, id) => { if (v.on && Date.now() - v.ts > 11000 && !speak.get(id)) { micMap.delete(id); gone_ = true; } });
  if (gone_) renderVoice();
  const s = R.play_state || {};
  if (s.vote_until) {
    renderHead();
    const late = snow() - s.vote_until;
    if (((isAdmin() && late > 0) || late > 3500) && Date.now() - advAt > 5000) {
      advAt = Date.now();
      rpc('room_advance', { p_room: R.id }).catch(() => {});
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
    const fit = () => { if (!el.isConnected) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); return; } el.style.height = vv.height + 'px'; el.style.top = vv.offsetTop + 'px'; el.style.bottom = 'auto'; };
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
  }
}
function renderAll() { renderHead(); renderSettings(); renderControls(); renderNow(); renderFeed(); renderVote(); renderMic(); renderVoice(); renderBadges(); }

function votingNow() { return !!(R && R.play_state && R.play_state.vote_until); }
function renderHead() {
  if (!R || !$('#rmid')) return;
  $('#rcount').textContent = members.length || 1;
  const mid = $('#rmid');
  const activeMic = R.voice_enabled ? members.map(m => m.user_id).filter(micOf) : [];
  const timer = votingNow() ? `<div class="cd" style="--p:${Math.min(100, Math.max(0, (R.play_state.vote_until - snow()) / 120))}%"><span>${Math.ceil(Math.max(0, (R.play_state.vote_until - snow()) / 1000))}</span></div>` : '';
  if (activeMic.length) {
    mid.innerHTML = `${timer}<div class="mic-header" aria-label="Members on microphone">${activeMic.map(id => userAvatar(who(id), 36, true)).join('')}</div>`;
    return;
  }
  if (votingNow()) {
    const left = Math.max(0, (R.play_state.vote_until - snow()) / 1000);
    mid.innerHTML = `<div class="cd" style="--p:${Math.min(100, left / 12 * 100)}%"><span>${Math.ceil(left)}</span></div>`;
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
  if (m.kind === 'embed') { el.innerHTML = '<span class="hint">Everyone opens the same page. This source cannot be time-synced.</span>'; return; }
  const adm = isAdmin();
  el.innerHTML = `${adm ? `<button class="cb" data-r="back" aria-label="Back 10 seconds">−10</button><button class="cb" data-r="toggle" id="ptog" aria-label="Play or pause">${ic('play', 18)}</button><button class="cb" data-r="fwd" aria-label="Forward 10 seconds">+10</button>` : `<span class="cb" title="Only the admin controls playback">${ic('lock', 16)}</span>`}
    <span class="t" id="tcur">0:00</span><input type="range" id="seek" min="0" max="1000" value="0" ${adm ? '' : 'disabled'} aria-label="Position"><span class="t" id="tdur">0:00</span>
    ${adm ? `<button class="cb" data-r="skip" aria-label="Next video">${ic('skip', 18)}</button>` : ''}`;
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

function thumbCell(q) {
  const t = thumb(q.media), v = (q.votes || []).length, mine = (q.votes || []).includes(ME.id);
  return `<button class="vi${mine ? ' mine' : ''}" style="background-image:url('${esc(t)}')" data-r="vote" data-id="${q.id}"><b>${ic('heart', 12)} ${v}</b><span>${esc(q.media.title || 'Video')}</span></button>`;
}
function renderVote() {
  const w = $('#vwrap'); if (!w) return;
  let g = $('#vgrid');
  if (!votingNow()) { if (g) g.remove(); return; }
  if (!g) { g = document.createElement('div'); g.id = 'vgrid'; g.className = 'vgrid'; w.appendChild(g); }
  const list = queue.slice().sort((a, b) => (b.votes || []).length - (a.votes || []).length);
  g.innerHTML = list.length ? list.map(thumbCell).join('') : '<p class="em">No suggestions</p>';
}

/* chat feed */
function msgHTML(m) {
  const u = who(m.user_id);
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
  ui.nowKeys[key] = 1;
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
function cardsHTML() {
  /* only the one-time "who can join?" question for a new room's admin — invite link & share apps were removed */
  if (!(isAdmin() && !ui.promptDone)) return '';
  return `<div class="cg"><div class="cgt"><span>Who can join this room?</span></div><div class="opt">${PRIV.map(p => optBtn('privacy:' + p[0], p[1], p[2], p[0] === R.privacy)).join('')}</div></div>`;
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
  const sorted = queue.slice().sort((a, b) => (b.votes || []).length - (a.votes || []).length);
  const que = sorted.length ? sorted.map(q => {
    const v = (q.votes || []).length, mine = (q.votes || []).includes(ME.id);
    return `<div class="li"><img class="th" src="${esc(thumb(q.media))}" alt=""><div><b>${esc(q.media.title || 'Video')}</b><small>Added by ${esc(nm(who(q.added_by)))}</small></div>
      <button class="cb${mine ? ' on' : ''}" data-r="vote" data-id="${q.id}" aria-label="Vote">${ic('heart', 16)} ${v}</button>
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
    if (val === 'nearby') {
      const pos = await getPos();
      if (pos) { a.p_lat = pos.lat; a.p_lng = pos.lng; } else toast('Location unavailable — the room will not show in Nearby lists', 'err');
    }
    ui.promptDone = true; try { sessionStorage.setItem('nova_pd_' + R.id, '1'); } catch (e) {}
  } else if (k === 'mode') a.p_mode = val;
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
    if (!queue.length) return toast('Nothing in Up next');
    rpc('room_advance', { p_room: R.id }).catch(oops);
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
  else if (r === 'playq') rpc('room_advance', { p_room: R.id, p_queue_id: d.id }).then(() => closeSheet()).catch(oops);
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
  return `<div class="room${r.invited ? ' inv' : ''}" role="button" tabindex="0" data-code="${esc(r.code)}">
    <div class="cover">${thumb(m) ? `<img src="${esc(thumb(m))}" alt="" loading="lazy" decoding="async">` : ''}<span class="pv">${ic(pv, 16)}</span></div>
    <div class="info"><b>${esc((m && m.title) || r.title)}</b><div class="avs">${av}${more ? `<em>+${more}</em>` : ''}</div></div>
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
}
async function loadHome() {
  if (R || homeLoading) return;
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
async function joinByCode(code) {
  if (!await auth()) { try { sessionStorage.setItem('nova_join', code); } catch (e) {} location.href = 'index.html'; return; }
  try { const row = await rpc('join_room', { p_code: code }); await enter(row); }
  catch (e) { oops(e); loadHome(); }
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
  const c = e.target.closest('.room[data-code]'); if (c) joinByCode(c.dataset.code);
});
document.addEventListener('keydown', e => { if (e.key === 'Enter') { const c = e.target.closest && e.target.closest('.room[data-code]'); if (c) joinByCode(c.dataset.code); } });
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
  homeT = setInterval(() => { if (!R && !document.hidden) loadHome(); }, 10000);
}

window.NovaRoom = { handle, ctx, renderHome, active: () => !!R, ready: true };
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