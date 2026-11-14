/* nova-chat.js — Nova Chat Pro core: inbox, threads, realtime (presence, typing, receipts), offline outbox,
   composer, message actions and people management. Secondary screens live in nova-chat-sheets.js.
   Requires: nova-core.js, nova-chat-rich.js, nova-chat-media.js, nova-chat-capture.js, nova-chat-picker.js,
   and the globals of profile.html (U, V, shell, REQ, route, ask, fetchPD). Needs chat-schema.sql + chat-pro-schema.sql. */
(function () {
  'use strict';
  const { sb, esc } = Nova, ic = Nova.ic;
  /* inside the Watch-room dock the thread header shows the room's left-panel icon and returns to the Friends page */
  const embedded = () => !!(window.NovaEmbed && NovaEmbed.active);
  const DOCK_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="M10 3v18M7.4 9.2 5.4 12l2 2.8"/></svg>';
  const backBtn = () => embedded()
    ? `<button type=button class="nc-icon-btn nc-back nc-back-dock" data-go=friends aria-label="Back to friends" title="Friends">${DOCK_ICON}</button>`
    : `<button type=button class="nc-icon-btn nc-back" data-go=chat aria-label="Back to chats">${ic('left', 22)}</button>`;
  const R = window.NovaChatRich, M = window.NovaChatMedia, Pk = window.NovaChatPicker;
  if (typeof V === 'undefined') return;

  const Core = window.NovaChatCore = { ui: {} };
  const PAGE_SIZE = 40, EDIT_WINDOW = 15 * 60000, DELETE_WINDOW = 48 * 3600000, MAX_ATTACHMENTS = 8;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const iso = () => new Date().toISOString();
  const isoNow = iso;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ------------------------------------------------------------------ state */
  const S = Core.S = {
    inbox: [], inboxLoaded: false, inboxError: '', tab: 'chats', query: '',
    active: null, conv: null, members: [], msgs: [], hasOlder: false, hasNewer: false, loadingOlder: false,
    reactions: new Map(), receipts: new Map(), hidden: new Set(), pins: [], profiles: {}, peer: new Map(),
    online: new Map(), typing: new Map(), conn: 'online', privacy: { show_last_seen: 'everyone', show_online: 'everyone', read_receipts: true, typing_indicator: true, who_can_request: 'everyone' },
    selection: null, replyTo: null, editing: null, expanded: new Set(), translations: new Map(), mentions: new Map(),
    previews: new Map(), dividerAt: null, scheduled: [], outbox: [], newerCount: 0
  };
  const profiles = S.profiles;
  const person = id => profiles[id] || { id, username: 'unknown', full_name: 'Unknown user' };
  Core.person = person;
  const nameOf = id => id === U.id ? 'You' : (person(id).full_name || person(id).username || 'User');
  const friendly = error => {
    const message = (error && error.message) || 'Something went wrong.';
    if (/relation .* does not exist|function .* does not exist|could not find the .* in the schema cache|schema cache/i.test(message)) return 'Run chat-schema.sql and then chat-pro-schema.sql in Supabase before using chat.';
    if (/Failed to fetch|NetworkError|network/i.test(message)) return 'Network problem. Check your connection and try again.';
    return message;
  };
  Core.friendly = friendly;
  const toastErr = e => Nova.toast(friendly(e), 'err');
  const copyText = async text => {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch (_) {} t.remove(); }
  };
  Core.copyText = copyText;
  const likeTerm = value => String(value).replace(/[\\%_]/g, '\\$&');
  Core.likeTerm = likeTerm;

  async function loadProfiles(ids) {
    const missing = [...new Set(ids)].filter(id => id && !profiles[id]);
    if (!missing.length) return;
    const { data, error } = await sb.from('public_profiles').select('id,full_name,username,avatar_url,bio').in('id', missing);
    if (error) throw error;
    (data || []).forEach(p => { profiles[p.id] = p; });
  }
  Core.loadProfiles = loadProfiles;

  const isGroup = c => !!(c && c.is_group);
  const peerId = c => c && !c.is_group ? (c.member_ids || []).find(id => id !== U.id) : null;
  const titleFor = c => c.is_group ? (c.title || (c.member_ids || []).filter(id => id !== U.id).map(id => person(id).full_name || person(id).username).join(', ') || 'Group')
    : (person(peerId(c)).full_name || person(peerId(c)).username || 'Chat');
  Core.titleFor = titleFor; Core.peerId = peerId;
  const mutedNow = c => !!c && !!c.muted_until && (c.muted_until === 'infinity' || new Date(c.muted_until) > new Date());
  Core.mutedNow = mutedNow;
  const convById = id => S.inbox.find(c => c.id === id);
  Core.convById = convById;

  /* peers can be seen online only when their privacy and mine allow it */
  const canSeeOnline = id => { const p = S.peer.get(id); return !!p && p.can_see_online; };
  const isOnline = id => canSeeOnline(id) && S.online.has(id) && (S.online.get(id) === 'everyone' || S.online.get(id) === 'friends');
  Core.isOnline = isOnline;
  const typingOf = convId => { const now = Date.now(); const out = []; for (const [key, v] of S.typing) { if (v.conv === convId && v.until > now) out.push({ id: v.user, kind: v.kind }); } return out; };
  Core.typingOf = typingOf;
  const ACTIVITY = { typing: 'typing…', recording_audio: 'recording voice message…', recording_video: 'recording video message…', uploading: 'sending a file…' };

  /* ------------------------------------------------------- tiny IndexedDB */
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open('nova-chat', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('outbox', { keyPath: 'client_id' });
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((resolve, reject) => { const t = db.transaction('outbox', mode), store = t.objectStore('outbox'), req = fn(store); t.oncomplete = () => resolve(req && req.result); t.onerror = () => reject(t.error); }); };
    return {
      put: item => tx('readwrite', s => s.put(item)).catch(() => {}),
      del: id => tx('readwrite', s => s.delete(id)).catch(() => {}),
      all: () => tx('readonly', s => s.getAll()).then(r => r || []).catch(() => [])
    };
  })();

  /* ------------------------------------------------------ connection state */
  function setConn(state) {
    if (S.conn === state) return;
    const was = S.conn; S.conn = state; paintConn();
    if (state === 'online' && was !== 'online') { resync(); }
  }
  function paintConn() {
    $$('.nc-conn').forEach(el => {
      const online = S.conn === 'online';
      el.hidden = online && !el._flash; el.className = `nc-conn ${S.conn}`;
      el.innerHTML = S.conn === 'offline' ? `${ic('alert', 14)}<span>Waiting for network… messages will send when you're back online</span>`
        : S.conn === 'connecting' ? `<i class="nc-spin sm"></i><span>Connecting…</span>` : `${ic('check', 14)}<span>Back online</span>`;
    });
  }
  Core.connHtml = () => `<div class="nc-conn online" role="status" aria-live="polite" hidden></div>`;
  window.addEventListener('offline', () => setConn('offline'));
  window.addEventListener('online', () => setConn(S.channel ? 'connecting' : 'online'));

  /* ------------------------------------------------------------- realtime */
  let heartbeat = null, inboxTimer = null, deliverTimer = null, readTimer = null, wasDisconnected = false;
  function scheduleInbox(delay = 900) { clearTimeout(inboxTimer); inboxTimer = setTimeout(() => { if (inChat()) loadInbox(true); }, delay); }
  const inChat = () => (location.hash || '').startsWith('#chat');
  const inMessaging = () => inChat() || (location.hash || '').startsWith('#friends');

  function bindRealtime() {
    if (S.channel) return;
    const ch = sb.channel(`nova-chat-${U.id}`);
    const on = (table, event, handler, filter) => ch.on('postgres_changes', { event, schema: 'public', table, ...(filter ? { filter } : {}) }, handler);
    on('chat_messages', 'INSERT', p => onMessageInsert(p.new));
    on('chat_messages', 'UPDATE', p => onMessageUpdate(p.new));
    on('message_reactions', '*', p => onReaction(p));
    on('message_receipts', '*', p => onReceipt(p));
    on('pinned_messages', '*', p => onPin(p));
    on('conversation_members', '*', () => scheduleInbox(500), `user_id=eq.${U.id}`);
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') { const reconnect = wasDisconnected; wasDisconnected = false; S.realtimeOk = true; setConn(navigator.onLine ? 'online' : 'offline'); if (reconnect) { S.conn = 'connecting'; setConn('online'); } }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { wasDisconnected = true; S.realtimeOk = false; setConn(navigator.onLine ? 'connecting' : 'offline'); }
    });
    S.channel = ch; bindPresence(); startHeartbeat();
  }
  function bindPresence() {
    if (S.presence) return;
    const pres = sb.channel('nova-presence', { config: { presence: { key: U.id } } });
    const sync = () => {
      const state = pres.presenceState(), map = new Map();
      for (const key of Object.keys(state)) { const last = state[key][state[key].length - 1]; map.set(key, (last && last.v) || 'everyone'); }
      S.online = map; refreshPresenceUi();
    };
    pres.on('presence', { event: 'sync' }, sync).on('presence', { event: 'join' }, sync).on('presence', { event: 'leave' }, sync);
    pres.subscribe(async status => { if (status === 'SUBSCRIBED') trackPresence(); });
    S.presence = pres;
  }
  function trackPresence() {
    if (!S.presence) return;
    if (S.privacy.show_online === 'nobody' || document.hidden) { try { S.presence.untrack(); } catch (_) {} return; }
    try { S.presence.track({ v: S.privacy.show_online, t: Date.now() }); } catch (_) {}
  }
  Core.trackPresence = trackPresence;
  function startHeartbeat() {
    clearInterval(heartbeat);
    const beat = () => { if (!document.hidden && navigator.onLine) sb.rpc('chat_touch_presence').then(() => {}, () => {}); };
    beat(); heartbeat = setInterval(beat, 60000);
  }
  function unbindRealtime() {
    clearInterval(heartbeat); clearTimeout(inboxTimer);
    if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
    if (S.presence) { sb.removeChannel(S.presence); S.presence = null; }
    closeTypingChannel(); S.realtimeOk = false;
  }
  document.addEventListener('visibilitychange', () => {
    trackPresence();
    if (!document.hidden) { if (inMessaging()) { resync(); } if (S.active) scheduleMarkRead(); }
    else sb.rpc('chat_touch_presence').then(() => {}, () => {});
  });
  window.addEventListener('pagehide', () => { try { sb.rpc('chat_touch_presence'); } catch (_) {} });

  /* typing / recording / uploading broadcast */
  let activityLast = 0, activityKind = '';
  function openTypingChannel(convId) {
    closeTypingChannel();
    const ch = sb.channel(`nova-activity-${convId}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'activity' }, ({ payload }) => {
      if (!payload || payload.u === U.id || !S.privacy.typing_indicator) return;
      const key = `${convId}:${payload.u}`;
      if (!payload.k || payload.k === 'idle') S.typing.delete(key);
      else S.typing.set(key, { conv: convId, user: payload.u, kind: payload.k, until: Date.now() + 6000 });
      refreshPresenceUi(); setTimeout(refreshPresenceUi, 6200);
    });
    ch.subscribe(); S.typingChannel = ch; S.typingConv = convId;
  }
  function closeTypingChannel() { if (S.typingChannel) { sb.removeChannel(S.typingChannel); S.typingChannel = null; S.typingConv = null; } }
  function sendActivity(kind) {
    if (!S.typingChannel || !S.privacy.typing_indicator || !navigator.onLine) return;
    const now = Date.now();
    if (kind === activityKind && kind !== 'idle' && now - activityLast < 2500) return;
    if (kind === 'idle' && activityKind === 'idle') return;
    activityKind = kind; activityLast = now;
    try { S.typingChannel.send({ type: 'broadcast', event: 'activity', payload: { u: U.id, k: kind } }); } catch (_) {}
  }
  Core.sendActivity = sendActivity;

  function refreshPresenceUi() { paintHeaderStatus(); paintInboxList(); }

  /* ------------------------------------------------------- notifications */
  function totalUnread() { return S.inbox.reduce((n, c) => n + (c.request_status === 'pending' || c.archived_at && mutedNow(c) || mutedNow(c) ? 0 : (c.unread || 0)), 0); }
  const baseTitle = document.title;
  function paintBadge() { const n = totalUnread(); document.title = n && inChat() ? `(${n > 99 ? '99+' : n}) ${baseTitle}` : baseTitle; }
  function notify(row, conv) {
    if (!Nova.S.notif || mutedNow(conv)) return;
    const visible = !document.hidden && S.active === row.conversation_id;
    if (visible) return;
    const who = nameOf(row.sender_id), body = R.previewText(row);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { const n = new Notification(conv && conv.is_group ? `${who} · ${titleFor(conv)}` : who, { body, tag: row.conversation_id, icon: '7949.jpg' }); n.onclick = () => { window.focus(); location.hash = `#chat/${row.conversation_id}`; n.close(); }; } catch (_) {}
    } else if (!document.hidden) {
      Nova.toast(`${who}: ${body}`.slice(0, 90));
    }
  }

  /* ============================================================ data layer */
  const MSG_COLS = 'id,conversation_id,sender_id,body,mentions,attachments,created_at,kind,reply_to,client_id,edited_at,deleted_at,forwarded';
  const keyOf = m => m.client_id || m.id;
  const sortMsgs = () => S.msgs.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  S.replyCache = new Map();

  async function hydrateMessages(rows) {
    const ids = rows.map(r => r.id), replyIds = [...new Set(rows.map(r => r.reply_to).filter(Boolean))].filter(id => !S.replyCache.has(id) && !rows.some(r => r.id === id));
    const mineIds = rows.filter(r => r.sender_id === U.id).map(r => r.id);
    const none = Promise.resolve({ data: [] });
    const [rep, rea, rec, hid] = await Promise.all([
      replyIds.length ? sb.from('chat_messages').select('id,sender_id,body,kind,attachments,deleted_at').in('id', replyIds) : none,
      ids.length ? sb.from('message_reactions').select('message_id,user_id,emoji').in('message_id', ids) : none,
      mineIds.length ? sb.from('message_receipts').select('message_id,user_id,delivered_at,read_at').in('message_id', mineIds) : none,
      ids.length ? sb.from('message_hidden').select('message_id').in('message_id', ids) : none
    ]);
    (rep.data || []).forEach(r => S.replyCache.set(r.id, r));
    rows.forEach(r => S.replyCache.set(r.id, r));
    (rea.data || []).forEach(r => setReaction(r.message_id, r.user_id, r.emoji));
    (rec.data || []).forEach(r => setReceipt(r));
    (hid.data || []).forEach(r => S.hidden.add(r.message_id));
  }
  function setReaction(messageId, userId, emoji) {
    let map = S.reactions.get(messageId); if (!map) S.reactions.set(messageId, map = new Map());
    if (emoji) map.set(userId, emoji); else map.delete(userId);
  }
  function setReceipt(r) {
    let map = S.receipts.get(r.message_id); if (!map) S.receipts.set(r.message_id, map = new Map());
    const prev = map.get(r.user_id) || {};
    map.set(r.user_id, { delivered_at: r.delivered_at || prev.delivered_at || null, read_at: r.read_at || prev.read_at || null });
  }

  async function loadLatest() {
    const convId = S.active, conv = convById(convId), cleared = conv && conv.cleared_at;
    let q = sb.from('chat_messages').select(MSG_COLS).eq('conversation_id', convId).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    if (cleared) q = q.gt('created_at', cleared);
    const { data, error } = await q; if (error) throw error;
    const rows = (data || []).reverse(); await hydrateMessages(rows);
    if (convId !== S.active) return;
    const locals = S.msgs.filter(m => m._local && m.conversation_id === convId);
    S.msgs = [...rows, ...locals.filter(l => !rows.some(r => r.client_id && r.client_id === l.client_id))]; sortMsgs();
    S.hasOlder = rows.length >= PAGE_SIZE; S.hasNewer = false; S.newerCount = 0;
  }
  async function loadOlder() {
    if (S.loadingOlder || !S.hasOlder || !S.msgs.length) return;
    S.loadingOlder = true;
    const convId = S.active, conv = convById(convId), first = S.msgs.find(m => !m._local);
    try {
      let q = sb.from('chat_messages').select(MSG_COLS).eq('conversation_id', convId).lt('created_at', first.created_at).order('created_at', { ascending: false }).limit(PAGE_SIZE);
      if (conv && conv.cleared_at) q = q.gt('created_at', conv.cleared_at);
      const { data, error } = await q; if (error) throw error;
      const rows = (data || []).reverse(); await hydrateMessages(rows);
      if (convId !== S.active) return;
      S.hasOlder = rows.length >= PAGE_SIZE; S.msgs = [...rows, ...S.msgs]; sortMsgs();
      Core.renderMessages({ keepScroll: true });
    } catch (e) { toastErr(e); } finally { S.loadingOlder = false; }
  }
  async function loadNewer() {
    if (!S.hasNewer) return;
    const last = [...S.msgs].reverse().find(m => !m._local); if (!last) return;
    const { data, error } = await sb.from('chat_messages').select(MSG_COLS).eq('conversation_id', S.active).gt('created_at', last.created_at).order('created_at', { ascending: true }).limit(PAGE_SIZE);
    if (error) return toastErr(error);
    await hydrateMessages(data || []);
    S.msgs = [...S.msgs, ...(data || [])]; sortMsgs(); S.hasNewer = (data || []).length >= PAGE_SIZE;
    if (!S.hasNewer) S.newerCount = 0;
    Core.renderMessages({}); Core.paintJumpButton();
  }
  async function loadAround(messageId) {
    const { data: target, error } = await sb.from('chat_messages').select(MSG_COLS).eq('id', messageId).maybeSingle();
    if (error || !target) throw error || new Error('That message is no longer available.');
    const conv = convById(target.conversation_id), cleared = conv && conv.cleared_at;
    const [before, after] = await Promise.all([
      sb.from('chat_messages').select(MSG_COLS).eq('conversation_id', target.conversation_id).lt('created_at', target.created_at).order('created_at', { ascending: false }).limit(20),
      sb.from('chat_messages').select(MSG_COLS).eq('conversation_id', target.conversation_id).gt('created_at', target.created_at).order('created_at', { ascending: true }).limit(20)
    ]);
    const rows = [...(before.data || []).reverse().filter(r => !cleared || r.created_at > cleared), target, ...(after.data || [])];
    await hydrateMessages(rows);
    S.msgs = rows; S.hasOlder = (before.data || []).length >= 20; S.hasNewer = true; sortMsgs();
  }
  Core.loadNewer = loadNewer; Core.loadOlder = loadOlder;

  async function loadPins() {
    const { data } = await sb.from('pinned_messages').select('message_id,pinned_at').eq('conversation_id', S.active).order('pinned_at', { ascending: false });
    const ids = (data || []).map(p => p.message_id), missing = ids.filter(id => !S.replyCache.has(id));
    if (missing.length) { const r = await sb.from('chat_messages').select('id,sender_id,body,kind,attachments,deleted_at,created_at').in('id', missing); (r.data || []).forEach(m => S.replyCache.set(m.id, m)); }
    S.pins = ids; Core.paintPinned && Core.paintPinned();
  }
  async function loadPeerState(ids) {
    const list = [...new Set(ids)].filter(id => id && id !== U.id); if (!list.length) return;
    const { data, error } = await sb.rpc('chat_peer_state', { p_users: list });
    if (error) return;
    list.forEach(id => S.peer.delete(id));
    (data || []).forEach(p => S.peer.set(p.user_id, p));
  }
  async function loadPrivacy() {
    const { data } = await sb.rpc('chat_get_privacy');
    if (data) { S.privacy = { ...S.privacy, ...data }; trackPresence(); }
  }
  Core.loadPrivacy = loadPrivacy; Core.loadPeerState = loadPeerState;

  /* -------------------------------------------------------- realtime events */
  const inboxSort = (a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0) || (a.pinned_at && b.pinned_at ? (a.pinned_at < b.pinned_at ? 1 : -1) : 0) || (b.last_message_at || '').localeCompare(a.last_message_at || '');
  function bumpInbox(row, mine) {
    const c = convById(row.conversation_id);
    if (!c) { scheduleInbox(200); return null; }
    c.last_message = { id: row.id, sender_id: row.sender_id, body: row.body, kind: row.kind, attachments: row.attachments, created_at: row.created_at, deleted_at: row.deleted_at, forwarded: row.forwarded };
    c.last_message_at = row.created_at; c.hidden_at = null;
    if (!mine && S.active !== row.conversation_id) c.unread = (c.unread || 0) + 1;
    if (c.archived_at && !mutedNow(c)) c.archived_at = null;
    S.inbox.sort(inboxSort); paintInboxList(); paintBadge();
    return c;
  }
  function onMessageInsert(row) {
    if (!row) return;
    const mine = row.sender_id === U.id, conv = bumpInbox(row, mine);
    if (!mine) { loadProfiles([row.sender_id]).then(paintInboxList).catch(() => {}); scheduleDelivered(); if (conv) notify(row, conv); }
    if (row.conversation_id !== S.active) return;
    const localIdx = row.client_id ? S.msgs.findIndex(m => m.client_id === row.client_id) : -1;
    if (localIdx >= 0) { const l = S.msgs[localIdx]; (l.attachments || []).forEach(a => a._blobUrl && setTimeout(() => URL.revokeObjectURL(a._blobUrl), 4000)); S.msgs[localIdx] = row; }
    else if (S.msgs.some(m => m.id === row.id)) return;
    else if (S.hasNewer) { S.newerCount++; Core.paintJumpButton(); return; }
    else S.msgs.push(row);
    S.replyCache.set(row.id, row); sortMsgs();
    if (row.reply_to && !S.replyCache.has(row.reply_to)) sb.from('chat_messages').select('id,sender_id,body,kind,attachments,deleted_at').eq('id', row.reply_to).maybeSingle().then(({ data }) => { if (data) { S.replyCache.set(data.id, data); Core.renderMessages({}); } });
    const stick = Core.nearBottom();
    Core.renderMessages({ stick: stick || mine });
    if (!mine) { if (!stick) { S.newerCount++; Core.paintJumpButton(); } scheduleMarkRead(); }
  }
  function onMessageUpdate(row) {
    if (!row) return;
    const conv = convById(row.conversation_id);
    if (conv && conv.last_message && conv.last_message.id === row.id) { Object.assign(conv.last_message, { body: row.body, attachments: row.attachments, deleted_at: row.deleted_at }); paintInboxList(); }
    if (row.conversation_id !== S.active) return;
    const i = S.msgs.findIndex(m => m.id === row.id);
    if (i >= 0) { S.msgs[i] = { ...S.msgs[i], ...row }; S.replyCache.set(row.id, S.msgs[i]); if (row.deleted_at) { S.reactions.delete(row.id); S.pins = S.pins.filter(id => id !== row.id); Core.paintPinned && Core.paintPinned(); } Core.renderMessages({}); }
    else if (S.replyCache.has(row.id)) { S.replyCache.set(row.id, { ...S.replyCache.get(row.id), ...row }); Core.renderMessages({}); }
  }
  function onReaction(p) {
    const row = p.eventType === 'DELETE' ? p.old : p.new; if (!row) return;
    if (p.eventType === 'DELETE') setReaction(row.message_id, row.user_id, null); else setReaction(row.message_id, row.user_id, row.emoji);
    if (S.msgs.some(m => m.id === row.message_id)) Core.renderMessages({});
  }
  function onReceipt(p) {
    const row = p.new; if (!row) return;
    setReceipt(row);
    if (S.msgs.some(m => m.id === row.message_id)) Core.renderMessages({});
  }
  function onPin(p) {
    const row = p.eventType === 'DELETE' ? p.old : p.new; if (!row || (row.conversation_id && row.conversation_id !== S.active)) return;
    if (S.active) loadPins().then(() => Core.renderMessages({}));
  }

  function scheduleDelivered() { clearTimeout(deliverTimer); deliverTimer = setTimeout(() => { if (navigator.onLine) sb.rpc('chat_mark_delivered').then(() => {}, () => {}); }, 600); }
  function scheduleMarkRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      if (!S.active || document.hidden || !navigator.onLine) return;
      const conv = convById(S.active); if (conv && conv.request_status === 'pending') return;
      const { error } = await sb.rpc('chat_mark_read', { p_conversation: S.active });
      if (error) return; const c = convById(S.active); if (c) { c.unread = 0; c.last_read_at = iso(); paintInboxList(); paintBadge(); }
    }, 350);
  }
  Core.scheduleMarkRead = scheduleMarkRead;

  async function resync() {
    if (!inMessaging() || !navigator.onLine) return;
    scheduleDelivered();
    try {
      await loadInbox(true);
      if (S.active && !S.hasNewer) { await loadLatest(); await loadPins(); Core.renderMessages({}); scheduleMarkRead(); }
    } catch (_) {}
    processOutbox(); dispatchScheduled();
  }

  /* ============================================================= outbox */
  /* Every outgoing message is saved locally first (IndexedDB), uploaded with progress, then inserted with a
     client id, so a retry can never create a duplicate. It survives reloads, crashes and network loss. */
  let processing = false;
  const stripLocal = a => { const c = { ...a }; Object.keys(c).forEach(k => k.startsWith('_') && delete c[k]); return c; };

  function localMessage(item) {
    return { id: item.client_id, client_id: item.client_id, conversation_id: item.conversation_id, sender_id: U.id, body: item.body || '', mentions: item.mentions || [], kind: item.kind,
      reply_to: item.reply_to || null, created_at: item.created, forwarded: false, _local: true, _state: item.state, _error: item.error || '',
      attachments: (item.files || []).map(f => ({ ...f.meta, _blobUrl: URL.createObjectURL(f.blob), _state: f.uploaded ? 'done' : (item.state === 'failed' ? 'failed' : 'uploading'), _progress: f.uploaded ? 1 : 0 })).concat(item.remote || []) };
  }
  async function enqueue(item) {
    item.client_id = item.client_id || R.uuid(); item.created = item.created || iso(); item.state = 'sending'; item.attempts = 0;
    S.outbox.push(item); idb.put(item);
    if (item.conversation_id === S.active) { S.msgs.push(localMessage(item)); sortMsgs(); Core.renderMessages({ stick: true }); }
    bumpInbox({ conversation_id: item.conversation_id, id: item.client_id, sender_id: U.id, body: item.body, kind: item.kind, attachments: [...(item.files || []).map(f => f.meta), ...(item.remote || [])], created_at: item.created }, true);
    processOutbox();
  }
  Core.enqueue = enqueue;
  const findLocal = id => S.msgs.find(m => m.client_id === id);

  async function processOutbox() {
    if (processing || !navigator.onLine) return;
    processing = true;
    try {
      for (const item of [...S.outbox]) {
        if (item.state === 'failed' || item.cancelled) continue;
        if (item.retryAt && item.retryAt > Date.now()) continue;
        await sendItem(item);
      }
    } finally { processing = false; }
    const next = S.outbox.filter(i => i.state === 'sending' && i.retryAt).map(i => i.retryAt).sort()[0];
    if (next) { clearTimeout(Core._outboxTimer); Core._outboxTimer = setTimeout(processOutbox, Math.max(500, next - Date.now())); }
  }
  async function sendItem(item) {
    const local = findLocal(item.client_id);
    try {
      const files = item.files || [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i]; if (f.uploaded) continue;
        item.abort = new AbortController(); sendActivity('uploading');
        await M.upload({ path: f.meta.path, blob: f.blob, contentType: f.meta.type, signal: item.abort.signal, onProgress: p => { const a = local && local.attachments[i]; if (a) a._progress = p; const el = $(`[data-key="${item.client_id}"]`); if (el) M.setProgress(el, i, p); } });
        f.uploaded = true; const a = local && local.attachments[i]; if (a) { a._state = 'done'; a._progress = 1; }
        idb.put(item);
      }
      sendActivity('idle');
      const attachments = [...files.map(f => stripLocal(f.meta)), ...(item.remote || []).map(stripLocal)];
      for (const r of item.remote || []) if (r.provider === 'unsplash') await Pk.trackUnsplash(r);
      const row = { conversation_id: item.conversation_id, sender_id: U.id, body: item.body || '', mentions: item.mentions || [], attachments, kind: item.kind, client_id: item.client_id, ...(item.reply_to ? { reply_to: item.reply_to } : {}) };
      const { data, error } = await sb.from('chat_messages').insert(row).select(MSG_COLS).maybeSingle();
      if (error && error.code !== '23505') throw error;
      S.outbox = S.outbox.filter(i => i !== item); idb.del(item.client_id);
      if (data) onMessageInsert(data);
      else { const { data: existing } = await sb.from('chat_messages').select(MSG_COLS).eq('client_id', item.client_id).maybeSingle(); if (existing) onMessageInsert(existing); }
    } catch (error) {
      sendActivity('idle');
      if (error && error.aborted) return;
      const transient = !navigator.onLine || error.retryable || /Failed to fetch|NetworkError|network|timeout|fetch/i.test(error.message || '') || error.status >= 500;
      item.attempts = (item.attempts || 0) + 1;
      if (transient && item.attempts < 8) { item.retryAt = Date.now() + Math.min(60000, 2000 * 2 ** (item.attempts - 1)); item.state = 'sending'; idb.put(item); Core.renderMessages({}); return; }
      item.retryAt = 0; item.state = 'failed'; item.error = friendly(error); idb.put(item);
      if (local) { local._state = 'failed'; local._error = item.error; (local.attachments || []).forEach(a => { if (a._state !== 'done') a._state = 'failed'; }); }
      Core.renderMessages({});
    }
  }
  Core.retryOutbox = clientId => {
    const item = S.outbox.find(i => i.client_id === clientId); if (!item) return;
    item.state = 'sending'; item.attempts = 0; item.retryAt = 0; item.error = '';
    const l = findLocal(clientId); if (l) { l._state = 'sending'; (l.attachments || []).forEach(a => { if (a._state === 'failed') a._state = 'uploading'; }); }
    idb.put(item); Core.renderMessages({}); processOutbox();
  };
  Core.cancelOutbox = clientId => {
    const item = S.outbox.find(i => i.client_id === clientId); if (!item) return;
    item.cancelled = true; if (item.abort) item.abort.abort(); S.outbox = S.outbox.filter(i => i !== item); idb.del(clientId);
    S.msgs = S.msgs.filter(m => m.client_id !== clientId); Core.renderMessages({});
  };
  async function restoreOutbox() {
    const items = await idb.all();
    for (const item of items) {
      if (item.created && Date.now() - new Date(item.created) > 7 * 86400000) { idb.del(item.client_id); continue; }
      item.state = item.state === 'failed' ? 'failed' : 'sending'; item.retryAt = 0; S.outbox.push(item);
    }
    processOutbox();
  }
  M.hooks.retry = el => { const k = el.closest('[data-key]'); if (k) Core.retryOutbox(k.dataset.key); };
  M.hooks.cancel = el => { const k = el.closest('[data-key]'); if (k) Core.cancelOutbox(k.dataset.key); };
  window.addEventListener('beforeunload', e => { if (S.outbox.some(i => i.state === 'sending' && (i.files || []).some(f => !f.uploaded))) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------------------------------------------------------- inbox */
  async function loadInbox(quiet) {
    try {
      const { data, error } = await sb.rpc('chat_inbox'); if (error) throw error;
      S.inbox = (data || []).sort(inboxSort); S.inboxLoaded = true; S.inboxError = '';
      await loadProfiles(S.inbox.flatMap(c => [...(c.member_ids || []), c.last_message && c.last_message.sender_id].filter(Boolean)));
      await loadPeerState(S.inbox.filter(c => !c.is_group).map(peerId));
      for (const c of S.inbox) { const d = localDraft(c.id); if (d && (!c.draft_updated_at || d.t > new Date(c.draft_updated_at).getTime())) c.draft = d.text; }
      for (const item of S.outbox) { const c = convById(item.conversation_id); if (c && (!c.last_message || c.last_message.created_at < item.created)) { c.last_message = { id: item.client_id, sender_id: U.id, body: item.body, kind: item.kind, attachments: (item.files || []).map(f => f.meta), created_at: item.created }; c.last_message_at = item.created; } }
      S.inbox.sort(inboxSort);
      if (S.active) { const c = convById(S.active); if (c) S.conv = c; }
      paintInboxList(); paintBadge(); paintHeaderStatus();
    } catch (error) { S.inboxError = friendly(error); if (!quiet || !S.inboxLoaded) paintInboxList(); }
  }
  Core.loadInbox = loadInbox;

  const draftKey = id => `nova_chat_draft_${U.id}_${id}`;
  function localDraft(id) { try { const v = JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); return v && v.text ? v : null; } catch { return null; } }
  let draftTimer = null;
  function saveDraft(convId, text) {
    try { text ? localStorage.setItem(draftKey(convId), JSON.stringify({ text, t: Date.now() })) : localStorage.removeItem(draftKey(convId)); } catch (_) {}
    const c = convById(convId); if (c) c.draft = text || null;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (navigator.onLine) sb.from('conversation_members').update({ draft: text || null, draft_updated_at: iso() }).eq('conversation_id', convId).eq('user_id', U.id).then(() => {}, () => {}); }, 1500);
  }
  Core.saveDraft = saveDraft; Core.localDraft = localDraft;

  async function loadScheduled() {
    if (!S.active) return;
    const { data } = await sb.from('scheduled_messages').select('id,conversation_id,body,send_at,status,reply_to').eq('conversation_id', S.active).eq('status', 'pending').order('send_at');
    S.scheduled = data || []; Core.paintScheduledBadge && Core.paintScheduledBadge();
  }
  Core.loadScheduled = loadScheduled;
  let dispatching = false;
  async function dispatchScheduled() {
    if (dispatching || !navigator.onLine) return; dispatching = true;
    try { const { data } = await sb.rpc('chat_dispatch_scheduled'); if (data) await loadScheduled(); } catch (_) {} finally { dispatching = false; }
  }
  Core.dispatchScheduled = dispatchScheduled;
  setInterval(() => { if (S.channel) dispatchScheduled(); }, 30000);
  /* ============================================================ people (friends, requests, blocks) */
  const friendlyError = friendly, setBusy = (node, busy) => { if (node) node.disabled = busy; };
  let peopleTab = 'friends', peopleQuery = '', peopleLoadSequence = 0, peopleSearchTimer = null;
  function peopleRow(user, subtitle, actions = '', tail = '') {
    const id = esc(user.id);
    return `<article class=people-row><button class=people-identity data-go="user/${id}" aria-label="View ${esc(user.full_name || user.username)}">${Nova.avatar(user, 48)}<span><b>${esc(user.full_name || user.username || 'User')}</b><small>@${esc(user.username || '')}</small>${subtitle ? `<small class=people-subtitle>${esc(subtitle)}</small>` : ''}</span></button><div class=people-actions>${tail}${actions}</div></article>`;
  }

  function friendRow(user) {
    const id = esc(user.id), name = user.full_name || 'User';
    return `<article class="people-row people-friend-row"><button class=people-friend-open data-open-friend="${id}" aria-label="Open chat with ${esc(name)}">${esc(name)}</button><button class=people-friend-avatar data-go="user/${id}" aria-label="View ${esc(name)}'s profile">${Nova.avatar(user,48)}</button></article>`;
  }

  function linkedAvatar(user, size, className = '') {
    const id = user?.id || user?.user_id;
    if (!id) return Nova.avatar(user || {}, size, className);
    return `<button class=profile-avatar-link data-go="${id === U.id ? 'info' : `user/${esc(id)}`}" aria-label="View ${id === U.id ? 'your' : esc(user.full_name || user.username || 'user')} profile">${Nova.avatar(user, size, className)}</button>`;
  }

  function peopleTabs(back = `<a class=people-rail-back href="nova-home.html" aria-label="Back to Nova home" title="Back to Nova home">${ic('left',20)}</a>`) {
    const tabs = [['chats','chat','Chats'],['friends','users','Friends'],['requests','userplus','Request'],['blocked','shield','Blocked']];
    return `<div class=people-side-rail>${back}<nav class=people-bottom-nav aria-label="People">${tabs.map(([key,icon,label]) => `<button class="${peopleTab===key?'on':''}" data-people-tab="${key}" aria-current="${peopleTab===key?'page':'false'}">${ic(icon,24)}<span>${label}</span>${key==='requests'&&REQ.length?`<i>${REQ.length}</i>`:''}</button>`).join('')}</nav></div>`;
  }

  V.friends = requestedTab => {
    if (['friends', 'requests', 'blocked'].includes(requestedTab)) peopleTab = requestedTab; else if (peopleTab === 'chats') peopleTab = 'friends';
    setTimeout(() => { bindRealtime(); loadPeople(); }, 0);
    return shell('friends', `<section class="people-page">
        ${peopleTabs()}
        <label class="chat-search people-search"><span>${ic('search')}</span><input id=peopleSearch type=search autocomplete=off placeholder="Search username" aria-label="Search users by username" value="${esc(peopleQuery)}"></label>
        <div id=peopleSuggestions class=people-suggestions hidden></div>
        <div id=peopleList class=people-list><p class=chat-loading>Loading people…</p></div>
      </section>`);
  };

  async function loadPeople() {
    const target = document.getElementById('peopleList');
    if (!target) return;
    const sequence = ++peopleLoadSequence;
    target.innerHTML = '<p class=chat-loading>Loading people…</p>';
    try {
      const [friendshipResult, blockResult] = await Promise.all([
        sb.from('friendships').select('user_id,friend_id,status,created_at')
          .or(`user_id.eq.${U.id},friend_id.eq.${U.id}`),
        sb.from('user_blocks').select('blocked_id,created_at').eq('blocker_id', U.id)
      ]);
      if (friendshipResult.error) throw friendshipResult.error;
      if (blockResult.error) throw blockResult.error;
      const relationships = friendshipResult.data || [], blocked = blockResult.data || [];
      const blockedIds = new Set(blocked.map(row => row.blocked_id));
      const accepted = relationships.filter(row => row.status === 'accepted')
        .map(row => row.user_id === U.id ? row.friend_id : row.user_id);
      const incoming = relationships.filter(row => row.status === 'pending' && row.friend_id === U.id);
      const outgoing = relationships.filter(row => row.status === 'pending' && row.user_id === U.id);
      const allIds = [
        ...accepted, ...blocked.map(row => row.blocked_id),
        ...incoming.map(row => row.user_id), ...outgoing.map(row => row.friend_id)
      ];
      const q = peopleQuery.trim().replace(/^@/, '').toLowerCase();
      let searchProfiles = [];
      const searchBox = document.getElementById('peopleSuggestions');
      if (q.length >= 2) {
        const usernameQuery = likeTerm(q.replace(/[^a-z0-9_.-]/g, ''));
        const nameQuery = likeTerm(q).slice(0, 100);
        const searches = [];
        if (usernameQuery.length >= 2) searches.push(sb.from('public_profiles').select('id,full_name,username,avatar_url').ilike('username', `%${usernameQuery}%`).neq('id', U.id).limit(10));
        if (nameQuery.length >= 2) searches.push(sb.from('public_profiles').select('id,full_name,username,avatar_url').ilike('full_name', `%${nameQuery}%`).neq('id', U.id).limit(10));
        const results = await Promise.all(searches);
        const searchError = results.find(result => result.error)?.error;
        if (searchError) throw searchError;
        const usernamePrefix = q.replace(/[^a-z0-9_.-]/g, '');
        searchProfiles = [...new Map(results.flatMap(result => result.data || []).map(user => [user.id, user])).values()]
          .sort((a, b) => {
            const aExact = a.username?.toLowerCase().startsWith(usernamePrefix) ? 0 : 1;
            const bExact = b.username?.toLowerCase().startsWith(usernamePrefix) ? 0 : 1;
            return aExact - bExact || (a.username || '').localeCompare(b.username || '');
          }).slice(0, 3);
      }
      allIds.push(...searchProfiles.map(row => row.id));
      await loadProfiles(allIds);
      REQ = incoming.map(row => person(row.user_id));

      const requestedYou = new Set(incoming.map(row => row.user_id));
      const requestSent = new Set(outgoing.map(row => row.friend_id));
      const friendIds = new Set(accepted);
      const actionFor = userId => {
        if (blockedIds.has(userId)) return `<button class="btn sec sm" data-people-unblock="${esc(userId)}">Unblock</button>`;
        if (requestedYou.has(userId)) return `<button class="btn pri sm" data-people-accept="${esc(userId)}" aria-label="Accept friend request">${ic('check',15)} Accept</button><button class="icon-btn people-decline" data-people-decline="${esc(userId)}" aria-label="Decline request">${ic('x',15)}</button><button class="icon-btn people-decline" data-people-block="${esc(userId)}" aria-label="Block user" title="Block user">${ic('shield',15)}</button>`;
        if (requestSent.has(userId)) return `<button class="btn sec sm" disabled>Requested</button><button class="icon-btn people-decline" data-people-cancel="${esc(userId)}" aria-label="Cancel request">${ic('x',15)}</button>`;
        if (friendIds.has(userId)) return `<span class=people-status>Friend</span><button class="btn sec sm" data-people-remove="${esc(userId)}">Remove</button><button class="icon-btn people-decline" data-people-block="${esc(userId)}" aria-label="Block user" title="Block user">${ic('shield',15)}</button>`;
        return `<button class="btn sec sm" data-msg-user="${esc(userId)}">Message</button><button class="btn pri sm" data-people-add="${esc(userId)}">${ic('userplus',15)} Add</button><button class="icon-btn people-decline" data-people-block="${esc(userId)}" aria-label="Block user" title="Block user">${ic('shield',15)}</button>`;
      };
      if (searchBox && sequence === peopleLoadSequence) {
        searchBox.hidden = q.length < 2;
        searchBox.innerHTML = q.length < 2 ? '' : searchProfiles.length
          ? `<small class=people-suggest-label>Matching profiles</small>${searchProfiles.map(user => peopleRow(user, user.full_name && user.full_name.toLowerCase() !== user.username?.toLowerCase() ? user.full_name : '', actionFor(user.id))).join('')}`
          : `<p class=people-suggest-empty>No username or name matches “${esc(peopleQuery.trim())}”.</p>`;
      }
      const empty = text => `<div class=chat-empty><span>${ic('users',28)}</span><p>${esc(text)}</p></div>`;
      const usernameMatches = id => (person(id).username || '').toLowerCase().includes(q);
      let content = '';
      if (peopleTab === 'friends') {
        const ids = accepted.filter(id => !q || usernameMatches(id));
        content = ids.length ? ids.map(id => friendRow(person(id))).join('')
          : empty(q.length >= 2 ? 'No users found for that username.' : 'No friends yet. Search for a username to find people.');
      } else if (peopleTab === 'requests') {
        const ins = incoming.filter(row => !q || usernameMatches(row.user_id));
        const outs = outgoing.filter(row => !q || usernameMatches(row.friend_id));
        content = `${ins.length ? `<h3 class=people-section-title>Received · ${ins.length}</h3>${ins.map(row => peopleRow(person(row.user_id), 'Wants to be friends', actionFor(row.user_id))).join('')}` : ''}${outs.length ? `<h3 class=people-section-title>Sent · ${outs.length}</h3>${outs.map(row => peopleRow(person(row.friend_id), 'Waiting for response', actionFor(row.friend_id))).join('')}` : ''}` || empty(q ? 'No requests match that username.' : 'No pending friend requests.');
      } else {
        const ids = blocked.map(row => row.blocked_id).filter(id => !q || usernameMatches(id));
        content = ids.length ? ids.map(id => peopleRow(person(id), 'Blocked · cannot send friend requests or direct messages', actionFor(id))).join('') : empty(q ? 'No blocked users match that username.' : 'Users you block will appear here.');
      }
      if (target.isConnected && sequence === peopleLoadSequence) target.innerHTML = content;
    } catch (error) {
      if (target.isConnected && sequence === peopleLoadSequence) target.innerHTML = `<div class=chat-empty><b>People could not be loaded</b><p>${esc(friendlyError(error))}</p><button class="btn sec" data-people-retry>Try again</button></div>`;
    }
  }

  async function peopleAction(button, action, id) {
    if (!id) return;
    setBusy(button, true);
    try {
      if (action === 'block') {
        if (!await ask('Block this user?', 'This removes your friendship and prevents friend requests and direct chats between you.', 'Block')) {
          setBusy(button, false);
          return;
        }
        const { error } = await sb.rpc('block_user', { p_blocked_id: id });
        if (error) throw error;
      } else if (action === 'unblock') {
        const { error } = await sb.rpc('unblock_user', { p_blocked_id: id });
        if (error) throw error;
      } else if (action === 'add') {
        const { error } = await sb.from('friendships').insert({ user_id: U.id, friend_id: id });
        if (error) throw error;
        Nova.toast('Friend request sent');
      } else if (action === 'accept') {
        const { data, error } = await sb.from('friendships').update({ status: 'accepted' }).eq('user_id', id).eq('friend_id', U.id).eq('status', 'pending').select('user_id').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This friend request is no longer available.');
        Nova.toast('Friend request accepted');
      } else if (action === 'decline') {
        const { error } = await sb.from('friendships').delete().eq('user_id', id).eq('friend_id', U.id).eq('status', 'pending');
        if (error) throw error;
      } else if (action === 'cancel') {
        const { error } = await sb.from('friendships').delete().eq('user_id', U.id).eq('friend_id', id).eq('status', 'pending');
        if (error) throw error;
      } else if (action === 'remove') {
        if (!await ask('Remove this friend?', 'This ends the friendship. You can send a new request later.', 'Remove')) {
          setBusy(button, false);
          return;
        }
        const first = await sb.from('friendships').delete().eq('user_id', U.id).eq('friend_id', id);
        if (first.error) throw first.error;
        const second = await sb.from('friendships').delete().eq('user_id', id).eq('friend_id', U.id);
        if (second.error) throw second.error;
      }
      await fetchPD(U.id);
      await loadPeople();
    } catch (error) {
      const message = action === 'add' && /row-level security|blocked/i.test(error.message || '')
        ? 'Unable to send a request to this user.'
        : friendlyError(error);
      Nova.toast(message, 'err');
      setBusy(button, false);
    }
  }

  /* ======================================================== layout + inbox UI */
  const tick = status => ({
    sending: ic('clock', 12), sent: `<svg class="ic tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    delivered: M.ic('checks', 16), read: `<span class="read">${M.ic('checks', 16)}</span>`, failed: ic('alert', 14)
  }[status] || '');
  Core.tick = tick;

  const avatarWithDot = (user, size, online) => `<span class="nc-av">${Nova.avatar(user || {}, size)}${online ? '<i class="nc-dot" title="Online"></i>' : ''}</span>`;
  const groupAvatar = (size = 48) => `<span class="nc-av"><span class="nc-gav" style="width:${size}px;height:${size}px">${ic('users', Math.round(size * .45))}</span></span>`;
  const faceFor = (c, size = 48) => c.is_group ? groupAvatar(size) : avatarWithDot(person(peerId(c)), size, isOnline(peerId(c)));
  Core.faceFor = faceFor; Core.avatarWithDot = avatarWithDot;

  function buildRoot() {
    const root = document.createElement('div'); root.className = 'nc-root'; root.id = 'ncRoot';
    root.innerHTML = `<aside class="nc-list-pane" aria-label="Conversations">
        <header class="nc-list-head"><a class="nc-icon-btn nc-home" href="nova-home.html" aria-label="Back to Nova home">${ic('left', 20)}</a><h2>Chats</h2>
          <div class="nc-head-actions"><button type=button class="nc-icon-btn" data-nc-qr aria-label="My QR code">${M.ic('qr', 20)}</button><button type=button class="nc-icon-btn" data-go=friends aria-label="Friends">${ic('users', 20)}</button><button type=button class="nc-icon-btn" data-nc-settings aria-label="Chat settings">${M.ic('sliders', 20)}</button><button type=button class="nc-icon-btn pri" data-chat-compose aria-label="New chat">${ic('plus', 20)}</button></div></header>
        ${Core.connHtml()}
        <label class="nc-search"><span>${ic('search', 16)}</span><input id="ncSearch" type="search" autocomplete="off" placeholder="Search chats, people, messages" aria-label="Search chats, people and messages"><button type=button class="nc-clear" data-nc-clear-search hidden aria-label="Clear search">${ic('x', 14)}</button></label>
        <nav class="nc-tabs" role="tablist"><button type=button role=tab data-nc-tab="chats" class="on">Chats</button><button type=button role=tab data-nc-tab="archived">Archived<i hidden></i></button><button type=button role=tab data-nc-tab="requests">Requests<i hidden></i></button></nav>
        <div id="ncBanner"></div>
        <div id="ncList" class="nc-list" role="list" aria-live="polite"></div><div id="ncSearchResults" class="nc-search-results" hidden></div>
      </aside>
      <section class="nc-thread-pane" id="ncThreadPane" aria-label="Conversation"><div class="nc-empty-thread"><span>${ic('chat', 40)}</span><h3>Nova Chat</h3><p>Select a conversation or start a new one.<br>Messages are delivered in real time.</p></div></section>`;
    return root;
  }
  function mount() {
    if (!S.root) S.root = buildRoot();
    const slot = $('#ncMount'); if (slot) slot.replaceWith(S.root);
    document.body.classList.add('nc-active');
    paintInboxList(); paintConn(); paintBadge();
  }

  function skeletonRows(n = 7) { return Array.from({ length: n }, () => `<div class="nc-row sk"><i class="sk-av"></i><div><i class="sk-l w1"></i><i class="sk-l w2"></i></div></div>`).join(''); }

  function rowPreview(c) {
    const t = typingOf(c.id);
    if (t.length) return `<span class="nc-typing-txt">${c.is_group ? `${esc(nameOf(t[0].id))} is ` : ''}${ACTIVITY[t[0].kind] || 'typing…'}</span>`;
    if (c.draft && c.id !== S.active) return `<span class="nc-draft">Draft:</span> ${esc(R.plain(c.draft).slice(0, 80))}`;
    const m = c.last_message; if (!m) return `<span class="mu">${c.request_status === 'pending' ? 'wants to message you' : 'No messages yet'}</span>`;
    const mine = m.sender_id === U.id, prefix = c.is_group && !mine && !m.deleted_at ? `${esc((person(m.sender_id).full_name || person(m.sender_id).username || '').split(' ')[0])}: ` : mine && c.is_group ? 'You: ' : '';
    const local = S.outbox.some(i => i.client_id === m.id);
    const status = mine && !m.deleted_at ? `<span class="nc-row-tick ${local ? 'sending' : ''}">${tick(local ? 'sending' : 'sent')}</span>` : '';
    return `${status}${prefix}${esc(R.previewText(m).slice(0, 100))}`;
  }
  function rowHtml(c) {
    const unread = c.unread || 0, muted = mutedNow(c), name = titleFor(c), m = c.last_message;
    return `<article class="nc-row${c.id === S.active ? ' active' : ''}${unread ? ' unread' : ''}" role="listitem" tabindex="0" data-conv="${esc(c.id)}" data-open-conv="${esc(c.id)}" aria-label="${esc(name)}${unread ? `, ${unread} unread` : ''}">
      ${faceFor(c)}<div class="nc-row-main"><div class="nc-row-top"><b dir=auto>${esc(name)}</b><time>${m ? R.listTime(m.created_at) : ''}</time></div>
      <div class="nc-row-bot"><span class="nc-row-prev" dir=auto>${rowPreview(c)}</span><span class="nc-badges">${muted ? `<span class="nc-ico" title="Muted">${M.ic('belloff', 14)}</span>` : ''}${c.pinned_at ? `<span class="nc-ico" title="Pinned">${M.ic('pushpin', 14)}</span>` : ''}${c.blocked_by_me ? `<span class="nc-ico" title="Blocked">${M.ic('ban', 14)}</span>` : ''}${unread ? `<span class="nc-unread${muted ? ' muted' : ''}">${unread > 99 ? '99+' : unread}</span>` : ''}</span></div></div>
      <button type=button class="nc-row-more" data-row-menu="${esc(c.id)}" aria-label="Chat options">${ic('more', 18)}</button></article>`;
  }
  function visibleInbox() {
    const q = S.query.trim().toLowerCase().replace(/^@/, '');
    const base = S.inbox.filter(c => S.tab === 'requests' ? c.request_status === 'pending' : S.tab === 'archived' ? c.archived_at && c.request_status !== 'pending' : !c.archived_at && c.request_status !== 'pending');
    if (!q) return base;
    return base.filter(c => `${titleFor(c)} ${(c.member_ids || []).map(id => person(id).username).join(' ')} ${c.last_message ? R.previewText(c.last_message) : ''}`.toLowerCase().includes(q));
  }
  function paintInboxList() {
    const list = $('#ncList'); if (!list) return;
    const pending = S.inbox.filter(c => c.request_status === 'pending'), archived = S.inbox.filter(c => c.archived_at && c.request_status !== 'pending');
    $$('[data-nc-tab]').forEach(b => {
      const on = b.dataset.ncTab === S.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
      const badge = b.querySelector('i'); if (badge) { const n = b.dataset.ncTab === 'requests' ? pending.length : archived.filter(c => c.unread && !mutedNow(c)).length; badge.hidden = !n; badge.textContent = n; }
    });
    if (!S.inboxLoaded && !S.inboxError) { list.innerHTML = skeletonRows(); return; }
    if (S.inboxError && !S.inboxLoaded) { list.innerHTML = `<div class="nc-state"><b>Chats could not be loaded</b><p>${esc(S.inboxError)}</p><button type=button class="nc-btn" data-chat-retry>Try again</button></div>`; return; }
    const rows = visibleInbox();
    if (S.tab === 'requests') {
      list.innerHTML = rows.length ? rows.map(requestRow).join('') : `<div class="nc-state">${ic('userplus', 30)}<b>No message requests</b><p>When someone you aren't friends with messages you, it appears here. You choose whether to accept.</p></div>`; return;
    }
    const scroll = list.scrollTop;
    list.innerHTML = rows.length ? rows.map(rowHtml).join('') : S.query ? `<div class="nc-state"><b>No matching chats</b><p>Try a different name, or search messages below.</p></div>`
      : S.tab === 'archived' ? `<div class="nc-state">${M.ic('archive', 30)}<b>No archived chats</b><p>Archived chats stay quiet and out of the way.</p></div>`
      : `<div class="nc-state">${ic('chat', 30)}<b>No conversations yet</b><p>Start a chat with a friend, or message someone new.</p><button type=button class="nc-btn pri" data-chat-compose>${ic('plus', 15)} New chat</button></div>`;
    list.scrollTop = scroll;
    const banner = $('#ncBanner');
    if (banner) banner.innerHTML = S.tab === 'chats' && 'Notification' in window && Notification.permission === 'default' && Nova.S.notif && !sessionStorage.getItem('nc_notif_dismiss')
      ? `<div class="nc-notice">${ic('bell', 16)}<span>Turn on notifications to never miss a message.</span><button type=button data-nc-notify>Turn on</button><button type=button data-nc-notify-dismiss aria-label="Dismiss">${ic('x', 14)}</button></div>` : '';
  }
  Core.paintInboxList = paintInboxList;
  function requestRow(c) {
    const m = c.last_message, p = person(peerId(c));
    return `<article class="nc-row nc-request" data-conv="${esc(c.id)}"><button type=button class="nc-request-open" data-open-conv="${esc(c.id)}">${faceFor(c)}<div class="nc-row-main"><div class="nc-row-top"><b dir=auto>${esc(titleFor(c))}</b><time>${m ? R.listTime(m.created_at) : ''}</time></div><div class="nc-row-bot"><span class="nc-row-prev">${m ? esc(R.previewText(m).slice(0, 100)) : ''}</span></div><small class="mu">@${esc(p.username || '')}</small></div></button>
      <div class="nc-request-actions"><button type=button class="nc-btn pri sm" data-req="accept" data-conv-id="${esc(c.id)}">Accept</button><button type=button class="nc-btn sm" data-req="reject" data-conv-id="${esc(c.id)}">Reject</button><button type=button class="nc-btn sm" data-req="delete" data-conv-id="${esc(c.id)}">Delete</button><button type=button class="nc-btn sm danger" data-req="block" data-conv-id="${esc(c.id)}">Block</button><button type=button class="nc-btn sm" data-req="report" data-conv-id="${esc(c.id)}">Report</button></div></article>`;
  }

  /* ================================================================ route hook */
  V.chat = id => {
    const threadId = id || null; peopleTab = 'chats';
    setTimeout(() => { bindRealtime(); mount(); if (!S.inboxLoaded) { loadPrivacy(); loadInbox(); } else loadInbox(true); syncThread(threadId); }, 0);
    document.body.classList.toggle('message-thread-active', !!threadId);
    const back = `<a class=people-rail-back href="nova-home.html" aria-label="Back to Nova home" title="Back to Nova home">${ic('left', 20)}</a>`;
    return shell('chat', `${peopleTabs(back)}<div class=chat-view><div id=ncMount></div></div>`);
  };
  async function syncThread(id) {
    if (S.root) S.root.classList.toggle('has-thread', !!id); document.body.classList.toggle('message-thread-active', !!id);
    if (!id) { if (S.active) closeThread(); return; }
    if (S.active === id && $('#ncThread')) return;
    await openThread(id);
  }

  /* =============================================================== thread */
  function closeThread() {
    if (S.recorder) cancelVoice();
    M.stopAll(); closeTypingChannel(); sendActivity('idle');
    if (S.active) { const input = $('#ncInput'); if (input) saveDraft(S.active, input.value.trim()); }
    S.active = null; S.conv = null; S.msgs = []; S.pins = []; S.selection = null; S.replyTo = null; S.editing = null; S.pending = [];
    const pane = $('#ncThreadPane'); if (pane) pane.innerHTML = `<div class="nc-empty-thread"><span>${ic('chat', 40)}</span><h3>Nova Chat</h3><p>Select a conversation or start a new one.</p></div>`;
    if (S.root) S.root.classList.remove('has-thread');
    paintInboxList();
  }
  Core.closeThread = closeThread;

  async function openThread(id) {
    if (S.active && S.active !== id) { const input = $('#ncInput'); if (input) saveDraft(S.active, input.value.trim()); if (S.recorder) cancelVoice(); }
    S.active = id; S.msgs = []; S.pins = []; S.selection = null; S.replyTo = null; S.editing = null; S.pending = []; S.mentions = new Map(); S.newerCount = 0; S.scheduled = []; S.hasNewer = false;
    const pane = $('#ncThreadPane'); if (!pane) return;
    pane.innerHTML = `<div class="nc-thread" id="ncThread"><header class="nc-thread-head">${backBtn()}<div class="sk-av"></div><div><i class="sk-l w1"></i></div></header><div class="nc-msgs"><div class="nc-loading-msgs">${Array.from({ length: 5 }, (_, i) => `<i class="sk-bubble ${i % 2 ? 'r' : ''}"></i>`).join('')}</div></div></div>`;
    S.root && S.root.classList.add('has-thread'); paintInboxList();
    try {
      if (!S.inboxLoaded) await loadInbox(true);
      let conv = convById(id);
      if (!conv) { await loadInbox(true); conv = convById(id); }
      if (!conv) throw new Error('You do not have access to this conversation.');
      if (S.active !== id) return;
      S.conv = conv;
      await loadProfiles(conv.member_ids || []); await loadPeerState(conv.is_group ? conv.member_ids : [peerId(conv)]);
      S.dividerAt = conv.unread ? conv.last_read_at : null; S.dividerCount = conv.unread || 0;
      renderThreadShell(conv);
      openTypingChannel(id);
      const draft = localDraft(id) || (conv.draft ? { text: conv.draft } : null);
      const input = $('#ncInput'); if (draft && input) { input.value = draft.text; autosize(input); toggleSendMic(); }
      await loadLatest(); if (S.active !== id) return;
      Core.renderMessages({ initial: true });
      loadPins().then(() => Core.renderMessages({})); loadScheduled(); dispatchScheduled();
      scheduleMarkRead(); scheduleDelivered();
      if (conv.blocked_by_me) paintBlocked();
      if (conv.request_status === 'pending') paintRequestBar();
      if (S.jumpTo) { const target = S.jumpTo; S.jumpTo = null; jumpTo(target); }
    } catch (error) {
      if (S.active !== id) return;
      const blocked = /access/i.test(error.message || '') ? 'This conversation is unavailable. It may have been removed, or you may have blocked or been blocked by this person.' : friendly(error);
      pane.innerHTML = `<div class="nc-empty-thread"><span>${ic('alert', 36)}</span><h3>Conversation unavailable</h3><p>${esc(blocked)}</p><button type=button class="nc-btn" data-go=chat>Back to chats</button></div>`;
    }
  }
  Core.openThread = openThread;

  function renderThreadShell(conv) {
    const pane = $('#ncThreadPane'), group = conv.is_group;
    pane.innerHTML = `<div class="nc-thread" id="ncThread" data-conv="${esc(conv.id)}">
      <header class="nc-thread-head" id="ncHead">${backBtn()}
        <button type=button class="nc-head-person" data-nc-info aria-label="Open chat info"><span id="ncHeadFace">${faceFor(conv, 42)}</span><span class="nc-head-text"><b id="ncHeadName" dir=auto>${esc(titleFor(conv))}</b><small id="ncHeadStatus"></small></span></button>
        <div class="nc-head-actions"><button type=button class="nc-icon-btn" data-nc-search aria-label="Search in chat">${ic('search', 20)}</button><button type=button class="nc-icon-btn" data-nc-thread-menu aria-label="Chat menu">${ic('more', 20)}</button></div></header>
      <div class="nc-selbar" id="ncSelBar" hidden></div>
      ${Core.connHtml()}
      <div id="ncPinned" class="nc-pinned" hidden></div><div id="ncRequestBar"></div>
      <div class="nc-msgs-wrap"><div id="ncMsgs" class="nc-msgs" role="log" aria-live="polite" aria-label="Messages" tabindex="-1"></div><button type=button class="nc-jump" id="ncJump" data-nc-jump hidden aria-label="Jump to latest messages">${M.ic('arrowdown', 20)}<i hidden></i></button><div class="nc-drop" hidden>${ic('upload', 34)}<b>Drop files to send</b></div></div>
      <div id="ncBlockedBar"></div>
      <footer class="nc-composer" id="ncComposer">
        <div class="nc-ctx" id="ncCtx" hidden></div><div id="ncPendingRemote" class="nc-pending"></div>
        <div class="nc-format" id="ncFormat" hidden role="toolbar" aria-label="Text formatting"><button type=button data-fmt="*" aria-label="Bold"><b>B</b></button><button type=button data-fmt="_" aria-label="Italic"><i>I</i></button><button type=button data-fmt="__" aria-label="Underline"><u>U</u></button><button type=button data-fmt="~" aria-label="Strikethrough"><s>S</s></button><button type=button data-fmt="\`" aria-label="Monospace"><code>&lt;/&gt;</code></button></div>
        <div id="ncMention" class="nc-mention-list" hidden></div>
        <div class="nc-input-row" id="ncInputRow">
          <button type=button class="nc-icon-btn" data-nc-emoji aria-label="Emoji" aria-expanded="false">${ic('smile', 22)}</button>
          <div class="nc-input-box"><textarea id="ncInput" rows="1" maxlength="5000" placeholder="Message" aria-label="Message" dir="auto" enterkeyhint="send"></textarea><button type=button class="nc-icon-btn sm" data-nc-format aria-label="Formatting">Aa</button></div>
          <button type=button class="nc-icon-btn" data-chat-media aria-expanded="false" aria-controls="chatMediaPicker" aria-label="Attach">${ic('paperclip', 22)}</button>
          <button type=button class="nc-icon-btn camera-quick" data-media-action="camera" aria-label="Camera">${ic('camera', 22)}</button>
          <button type=button class="nc-send mic" id="ncMic" data-nc-mic aria-label="Record voice message (hold) or tap to record">${ic('mic', 22)}</button>
          <button type=button class="nc-send" id="ncSend" data-nc-send aria-label="Send message" hidden>${ic('send', 20)}</button></div>
        <div id="ncRecPanel" class="nc-rec" hidden></div>
        <div id="ncEmojiPanel" class="nc-emoji-panel" hidden></div>
        <section id="chatMediaPicker" class="chat-media-picker" role="region" aria-label="Share media" hidden>
          <div id="mediaMenu" class="media-menu">
            <button type=button class="media-menu-item" data-media-action="gallery">${ic('image', 18)}<span>Photos &amp; videos</span></button>
            <button type=button class="media-menu-item" data-media-action="camera">${ic('camera', 18)}<span>Camera</span></button>
            <button type=button class="media-menu-item" data-media-action="document">${ic('file', 18)}<span>Document</span></button>
            <button type=button class="media-menu-item" data-media-action="audio">${ic('music', 18)}<span>Audio</span></button>
            <button type=button class="media-menu-item" data-media-action="videonote">${M.ic('video', 18)}<span>Video message</span></button>
            <button type=button class="media-menu-item" data-media-action="contact">${ic('user', 18)}<span>Contact</span></button>
            <button type=button class="media-menu-item" data-media-provider="unsplash"><i class="media-brand unsplash-brand">U</i><span>Unsplash Photos</span></button>
            <button type=button class="media-menu-item" data-media-provider="giphy"><i class="media-brand giphy-brand">GIF</i><span>GIPHY</span></button>
            <button type=button class="media-menu-item" data-media-provider="klipy"><i class="media-brand klipy-brand">K</i><span>KLIPY</span></button>
          </div><div id="mediaProviderPanel" class="media-provider-panel" hidden></div><div id="mediaContactPicker" hidden></div></section>
        <input type=file id=chatFiles accept="image/*,video/*" multiple hidden aria-label="Choose photos and videos"><input type=file id=chatDocuments multiple hidden aria-label="Choose documents" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv,application/pdf,text/plain,text/csv,application/zip">
        <input type=file id=chatAudio accept="audio/*" multiple hidden aria-label="Choose audio files"><input type=file id=chatCameraFallback accept="image/*,video/*" capture="environment" hidden aria-label="Take a photo or video">
      </footer></div>`;
    paintConn(); paintHeaderStatus(); Core.paintScheduledBadge();
    const msgs = $('#ncMsgs'); msgs.addEventListener('scroll', onMsgScroll, { passive: true });
  }

  function paintHeaderStatus() {
    const conv = S.conv; if (!conv || !S.active) return;
    const status = $('#ncHeadStatus'), name = $('#ncHeadName'), face = $('#ncHeadFace'); if (!status) return;
    const t = typingOf(conv.id);
    let text = '', cls = '';
    if (t.length) { text = conv.is_group ? `${nameOf(t[0].id)} is ${ACTIVITY[t[0].kind]}` : (ACTIVITY[t[0].kind] || 'typing…'); cls = 'live'; }
    else if (conv.is_group) text = `${(conv.member_ids || []).length} members`;
    else { const id = peerId(conv), st = S.peer.get(id); if (conv.blocked_by_me) text = ''; else if (isOnline(id)) { text = 'online'; cls = 'live'; } else if (st && st.last_seen_at) text = R.lastSeenLabel(st.last_seen_at); }
    status.textContent = text; status.className = cls; if (name) name.textContent = titleFor(conv);
    if (face) face.innerHTML = faceFor(conv, 42);
  }
  Core.paintHeaderStatus = paintHeaderStatus;
  Core.paintScheduledBadge = () => { const b = $('[data-nc-thread-menu]'); if (b) b.classList.toggle('has-dot', S.scheduled.length > 0); };

  function paintBlocked() {
    const bar = $('#ncBlockedBar'), comp = $('#ncComposer'); if (!bar) return;
    const blocked = S.conv && S.conv.blocked_by_me;
    bar.innerHTML = blocked ? `<div class="nc-bar warn">${M.ic('ban', 16)}<span>You blocked this contact.</span><button type=button class="nc-btn sm" data-nc-unblock>Unblock</button></div>` : '';
    if (comp) comp.hidden = !!blocked;
  }
  function paintRequestBar() {
    const bar = $('#ncRequestBar'), comp = $('#ncComposer'); if (!bar || !S.conv) return;
    const pending = S.conv.request_status === 'pending', p = person(peerId(S.conv));
    bar.innerHTML = pending ? `<div class="nc-request-bar"><p><b>${esc(p.full_name || p.username)}</b> isn't in your friends. They sent you a message request. They can't see that you've read it until you accept.</p><div><button type=button class="nc-btn pri sm" data-req="accept" data-conv-id="${esc(S.conv.id)}">Accept</button><button type=button class="nc-btn sm" data-req="reject" data-conv-id="${esc(S.conv.id)}">Reject</button><button type=button class="nc-btn sm danger" data-req="block" data-conv-id="${esc(S.conv.id)}">Block</button><button type=button class="nc-btn sm" data-req="report" data-conv-id="${esc(S.conv.id)}">Report</button></div></div>` : '';
    if (comp) comp.hidden = pending;
  }
  Core.paintBlocked = paintBlocked; Core.paintRequestBar = paintRequestBar;

  function paintPinned() {
    const el = $('#ncPinned'); if (!el) return;
    const pins = S.pins.map(id => S.replyCache.get(id)).filter(m => m && !m.deleted_at);
    if (!pins.length) { el.hidden = true; el.innerHTML = ''; return; }
    S.pinIndex = (S.pinIndex || 0) % pins.length; const m = pins[S.pinIndex];
    el.hidden = false; el.innerHTML = `<button type=button class="nc-pin-main" data-jump="${esc(m.id)}" data-pin-next><span class="nc-pin-bars">${pins.map((_, i) => `<i class="${i === S.pinIndex ? 'on' : ''}"></i>`).join('')}</span><span class="nc-pin-text"><b>${pins.length > 1 ? `Pinned message ${S.pinIndex + 1}` : 'Pinned message'}</b><small dir=auto>${esc(R.previewText(m).slice(0, 120))}</small></span></button><button type=button class="nc-icon-btn sm" data-pin-menu="${esc(m.id)}" aria-label="Unpin">${M.ic('pushpin', 16)}</button>`;
  }
  Core.paintPinned = paintPinned;

  /* ---------------------------------------------------------- composer bits */
  function autosize(input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; }
  function toggleSendMic() {
    const input = $('#ncInput'), has = !!(input && input.value.trim()) || S.pending.length > 0 || !!S.editing;
    const send = $('#ncSend'), mic = $('#ncMic'); if (!send || !mic) return;
    send.hidden = !has; mic.hidden = has; $('.camera-quick') && ($('.camera-quick').hidden = has);
  }
  function paintContext() {
    const el = $('#ncCtx'); if (!el) return;
    const r = S.replyTo, e = S.editing;
    if (e) { el.hidden = false; el.innerHTML = `<span class="nc-ctx-ico">${ic('pencil', 16)}</span><div><b>Edit message</b><small dir=auto>${esc(R.plain(e.body).slice(0, 100))}</small></div><button type=button class="nc-icon-btn sm" data-nc-cancel-ctx aria-label="Cancel edit">${ic('x', 16)}</button>`; }
    else if (r) { el.hidden = false; el.innerHTML = `<span class="nc-ctx-ico">${M.ic('reply', 16)}</span><div><b>Replying to ${esc(nameOf(r.sender_id))}</b><small dir=auto>${esc(R.previewText(r).slice(0, 100))}</small></div><button type=button class="nc-icon-btn sm" data-nc-cancel-ctx aria-label="Cancel reply">${ic('x', 16)}</button>`; }
    else { el.hidden = true; el.innerHTML = ''; }
    toggleSendMic();
  }
  S.pending = [];
  function paintPendingRemote() {
    const el = $('#ncPendingRemote'); if (!el) return;
    el.innerHTML = S.pending.map((p, i) => `<div class="nc-chip-media"><img src="${esc(p.url)}" alt="" referrerpolicy="no-referrer"><span>${esc((p.name || 'Media').slice(0, 24))}</span><button type=button data-remove-pending="${i}" aria-label="Remove">${ic('x', 14)}</button></div>`).join('');
    toggleSendMic();
  }
  Pk.hooks.count = () => S.pending.length; Pk.hooks.add = media => { S.pending.push(media); paintPendingRemote(); Pk.close(); };
  Pk.onClose = () => { const b = $('[data-chat-media]'); b && b.setAttribute('aria-expanded', 'false'); };

  /* ============================================================ messages */
  const GROUP_GAP = 5 * 60000;
  const quickReactions = () => { try { const v = JSON.parse(localStorage.getItem(`nova_chat_quick_${U.id}`) || 'null'); if (Array.isArray(v) && v.length) return v.slice(0, 6); } catch (_) {} return R.DEFAULT_QUICK.slice(0, 6); };
  Core.quickReactions = quickReactions;
  const mentionMap = () => { const map = new Map(); (S.conv && S.conv.member_ids || []).forEach(id => { const p = person(id); if (p.username) map.set(String(p.username).toLowerCase(), id); }); return map; };

  function statusOf(m) {
    if (m._local) return m._state === 'failed' ? 'failed' : 'sending';
    const rec = S.receipts.get(m.id), others = ((S.conv && S.conv.member_ids) || []).filter(id => id !== U.id);
    if (!rec || !others.length) return 'sent';
    const rs = others.map(id => rec.get(id) || {});
    if (rs.every(r => r.read_at)) return 'read';
    if (rs.every(r => r.delivered_at || r.read_at)) return 'delivered';
    return 'sent';
  }
  Core.statusOf = statusOf;

  function reactionsHtml(m) {
    const map = S.reactions.get(m.id); if (!map || !map.size) return '';
    const counts = new Map(); for (const [uid, e] of map) { const c = counts.get(e) || { n: 0, mine: false }; c.n++; if (uid === U.id) c.mine = true; counts.set(e, c); }
    return `<div class="nc-reacts">${[...counts].map(([e, c]) => `<button type=button class="nc-react${c.mine ? ' mine' : ''}" data-react-chip="${esc(m.id)}" data-emoji="${esc(e)}" aria-label="${esc(e)} ${c.n}">${esc(e)}${c.n > 1 ? `<i>${c.n}</i>` : ''}</button>`).join('')}</div>`;
  }
  function replyQuote(m) {
    if (!m.reply_to) return '';
    const r = S.replyCache.get(m.reply_to);
    if (!r) return `<button type=button class="nc-quote gone" data-jump="${esc(m.reply_to)}"><b>Message</b><span>Original message unavailable</span></button>`;
    const first = (r.attachments || [])[0], thumb = first && first.thumb && /^(data:image|https:)/.test(first.thumb) ? `<img src="${esc(first.thumb)}" alt="">` : '';
    return `<button type=button class="nc-quote" data-jump="${esc(r.id)}"><div><b>${esc(nameOf(r.sender_id))}</b><span dir=auto>${r.deleted_at ? 'This message was deleted' : esc(R.previewText(r).slice(0, 140))}</span></div>${thumb}</button>`;
  }
  function previewCard(m) {
    const link = R.extractLinks(m.body || '')[0]; if (!link) return '';
    const p = S.previews.get(link.url || link);
    if (!p || p === 'loading') return '';
    return `<a class="nc-lp" href="${esc(R.safeHref(p.url) || '#')}" target=_blank rel="noopener noreferrer nofollow">${p.image ? `<img src="${esc(p.image)}" alt="" loading=lazy referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<div><small>${esc(p.siteName || '')}</small><b dir=auto>${esc(p.title || p.url)}</b>${p.description ? `<p dir=auto>${esc(p.description)}</p>` : ''}</div></a>`;
  }
  async function loadPreview(m) {
    const link = R.extractLinks(m.body || '')[0]; if (!link) return;
    const url = link.url || link; if (S.previews.has(url)) return;
    S.previews.set(url, 'loading');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${session ? session.access_token : ''}` } });
      if (!res.ok) throw new Error('none');
      S.previews.set(url, await res.json()); Core.renderMessages({});
    } catch { S.previews.set(url, null); }
  }
  function bodyHtml(m) {
    const text = m.body || ''; if (!text) return '';
    const long = text.length > 700 && !S.expanded.has(m.id), shown = long ? text.slice(0, 600).trimEnd() + '…' : text;
    const only = R.emojiOnlyCount(text);
    return `<div class="nc-text${only && only <= 8 && !(m.attachments || []).length ? ` big e${Math.min(only, 3)}` : ''}" dir=auto>${R.render(shown, { mentions: mentionMap() })}</div>${long ? `<button type=button class="nc-readmore" data-expand="${esc(m.id)}">Read more</button>` : ''}`;
  }
  function translationHtml(m) {
    const t = S.translations.get(m.id); if (!t) return '';
    return `<div class="nc-translation" dir=auto>${t === 'loading' ? '<i class="nc-spin sm"></i> Translating…' : `<small>Translated</small>${esc(t)}`}</div>`;
  }

  function msgHtml(m, ctx) {
    const mine = m.sender_id === U.id, group = S.conv && S.conv.is_group;
    if (m.deleted_at) return `<div class="nc-bubble deleted">${M.ic('ban', 14)}<i>${mine ? 'You deleted this message' : 'This message was deleted'}</i><span class="nc-meta"><time>${R.fmtTime(m.created_at)}</time></span></div>`;
    const st = mine ? statusOf(m) : '', atts = m.attachments || [];
    const sticker = m.kind === 'sticker' || (atts.length === 1 && (atts[0].kind === 'sticker'));
    const meta = `<span class="nc-meta">${m.edited_at ? '<em>edited</em>' : ''}<time datetime="${esc(m.created_at)}">${R.fmtTime(m.created_at)}</time>${mine ? `<span class="nc-tick ${st}" title="${st}">${tick(st)}</span>` : ''}</span>`;
    const failed = m._state === 'failed' ? `<div class="nc-failed">${ic('alert', 14)}<span>${esc(m._error || 'Not sent')}</span><button type=button data-retry="${esc(m.client_id || m.id)}">Retry</button><button type=button data-discard="${esc(m.client_id || m.id)}">Delete</button></div>` : '';
    const name = group && !mine && ctx.first ? `<button type=button class="nc-sender" data-user="${esc(m.sender_id)}">${esc(nameOf(m.sender_id))}</button>` : '';
    const visual = atts.filter(M.isVisualAtt), others = atts.filter(a => !M.isVisualAtt(a));
    const only = !atts.length && m.body ? R.emojiOnlyCount(m.body) : 0, bigEmoji = only > 0 && only <= 8;
    const card = (m.body && !bigEmoji) || others.length || (!m.body && !atts.length) || /nc-preview|nc-lp/.test(previewCard(m) || '');
    const fwd = m.forwarded ? `<div class="nc-fwd">${M.ic('forward', 12)}Forwarded</div>` : '';
    const lead = `${name}${fwd}${replyQuote(m)}`;
    const ctxA = { mine, sender: m.sender_id };
    if (!card) {
      const body = bigEmoji ? bodyHtml(m) : M.renderAttachments(atts, ctxA);
      return `<div class="nc-bubble bare${bigEmoji ? ' emoji' : ''}${sticker ? ' sticker' : ''}">${lead}<div class="nc-media-row"><div class="nc-media-main">${body}</div>${meta}</div></div>${failed}`;
    }
    const head = visual.length ? `<div class="nc-bubble bare">${name}<div class="nc-media-row"><div class="nc-media-main">${M.renderAttachments(atts, { ...ctxA, part: 'visual' })}</div></div></div>` : '';
    const cardLead = visual.length ? `${fwd}${replyQuote(m)}` : lead;
    return `${head}<div class="nc-bubble${head ? ' after-media' : ''}">${cardLead}${others.length ? M.renderAttachments(atts, { ...ctxA, part: 'other' }) : ''}${bodyHtml(m)}${translationHtml(m)}${previewCard(m)}${meta}</div>${failed}`;
  }

  function buildRows() {
    const rows = []; let prev = null, dividerDone = false;
    const list = S.msgs.filter(m => !S.hidden.has(m.id) && m.conversation_id === S.active);
    for (const m of list) {
      const d = new Date(m.created_at);
      if (!prev || !R.sameDay(new Date(prev.created_at), d)) rows.push({ type: 'day', key: `d:${d.toDateString()}`, label: R.dayLabel(m.created_at) });
      if (!dividerDone && S.dividerAt && m.sender_id !== U.id && !m._local && m.created_at > S.dividerAt) { dividerDone = true; rows.push({ type: 'unread', key: 'unread', label: `${S.dividerCount || ''} unread message${S.dividerCount === 1 ? '' : 's'}`.trim() }); prev = null; }
      const first = !prev || prev.sender_id !== m.sender_id || new Date(m.created_at) - new Date(prev.created_at) > GROUP_GAP || prev.deleted_at;
      rows.push({ type: 'msg', key: keyOf(m), m, first }); prev = m;
    }
    return rows;
  }

  function renderMessages(opts = {}) {
    const box = $('#ncMsgs'); if (!box || !S.active) return;
    const rows = buildRows(), near = nearBottom(), prevHeight = box.scrollHeight, prevTop = box.scrollTop;
    const existing = new Map(); [...box.children].forEach(el => el.dataset.rk && existing.set(el.dataset.rk, el));
    const frag = []; const fresh = [];
    const olderBtn = S.hasOlder ? (box.querySelector('.nc-older') || Object.assign(document.createElement('div'), { className: 'nc-older', innerHTML: '<i class="nc-spin sm"></i>' })) : null;
    if (olderBtn) frag.push(olderBtn);
    for (const r of rows) {
      let el = existing.get(r.key), html, sig;
      if (r.type === 'day') { sig = r.label; html = `<span>${esc(r.label)}</span>`; }
      else if (r.type === 'unread') { sig = r.label; html = `<span>${esc(r.label)}</span>`; }
      else {
        const m = r.m, sel = S.selection && S.selection.has(m.id);
        html = msgHtml(m, r); sig = `${r.first}|${sel}|${S.pins.includes(m.id)}|${S.expanded.has(m.id)}|${html}|${reactionsHtml(m)}`;
      }
      if (!el || el._sig !== sig) {
        const node = document.createElement('div'); node._sig = sig; node.dataset.rk = r.key;
        if (r.type === 'msg') {
          const m = r.m, mine = m.sender_id === U.id, sel = S.selection && S.selection.has(m.id);
          node.className = `nc-msg ${mine ? 'mine' : 'theirs'}${r.first ? ' first' : ''}${sel ? ' sel' : ''}${m._local ? ' local' : ''}${S.pins.includes(m.id) ? ' pinned' : ''}`;
          node.dataset.key = m.client_id || m.id; node.dataset.msgId = m.id; node.dataset.sender = m.sender_id; node.tabIndex = 0;
          node.innerHTML = `${S.selection ? `<span class="nc-check${sel ? ' on' : ''}">${sel ? ic('check', 14) : ''}</span>` : ''}${S.conv && S.conv.is_group && !mine ? `<span class="nc-gav-slot">${r.first ? `<button type=button data-user="${esc(m.sender_id)}" aria-label="${esc(nameOf(m.sender_id))}">${Nova.avatar(person(m.sender_id), 28)}</button>` : ''}</span>` : ''}<div class="nc-stack">${html}${reactionsHtml(m)}</div>${S.pins.includes(m.id) ? `<span class="nc-pinmark">${M.ic('pushpin', 12)}</span>` : ''}`;
          fresh.push(node);
          if (!m.deleted_at && (m.body || '') && R.extractLinks(m.body)[0]) loadPreview(m);
        } else { node.className = r.type === 'day' ? 'nc-day' : 'nc-unread-div'; node.innerHTML = html; if (r.type === 'unread') node.id = 'ncUnreadDiv'; }
        if (el) el.replaceWith(node); el = node;
      }
      frag.push(el);
    }
    if (!rows.length) { frag.push(Object.assign(document.createElement('div'), { className: 'nc-empty-msgs', innerHTML: `<span>${ic('chat', 28)}</span><b>No messages yet</b><p>${S.conv && S.conv.request_status === 'pending' ? '' : 'Say hello 👋'}</p>` })); }
    // reconcile order without wiping scroll
    let cursor = box.firstChild;
    for (const el of frag) { if (el === cursor) cursor = cursor.nextSibling; else box.insertBefore(el, cursor); }
    while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
    fresh.forEach(n => M.hydrate(n));
    if (opts.initial) { const div = $('#ncUnreadDiv'); if (div) div.scrollIntoView({ block: 'center' }); else box.scrollTop = box.scrollHeight; S.seenTs = S.msgs.length ? S.msgs[S.msgs.length - 1].created_at : null; }
    else if (opts.keepScroll) box.scrollTop = prevTop + (box.scrollHeight - prevHeight);
    else if (opts.stick || near) { box.scrollTop = box.scrollHeight; if (S.msgs.length) S.seenTs = S.msgs[S.msgs.length - 1].created_at; }
    paintJumpButton(); paintPinned();
    if (S.selection) paintSelBar();
  }
  Core.renderMessages = renderMessages;

  const nearBottom = () => { const b = $('#ncMsgs'); return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 140; };
  Core.nearBottom = nearBottom;
  function paintJumpButton() {
    const btn = $('#ncJump'); if (!btn) return;
    const near = nearBottom(), unseen = S.msgs.filter(m => m.sender_id !== U.id && !m._local && S.seenTs && m.created_at > S.seenTs).length + (S.hasNewer ? 1 : 0);
    btn.hidden = near && !S.hasNewer; const badge = btn.querySelector('i'); if (badge) { badge.hidden = !unseen; badge.textContent = unseen > 99 ? '99+' : unseen; }
  }
  Core.paintJumpButton = paintJumpButton;
  function onMsgScroll() {
    const box = $('#ncMsgs'); if (!box) return;
    if (nearBottom()) { if (S.msgs.length) S.seenTs = S.msgs[S.msgs.length - 1].created_at; if (S.hasNewer) loadNewer().then(() => renderMessages({})); scheduleMarkRead(); }
    paintJumpButton();
    if (box.scrollTop < 120 && S.hasOlder) loadOlder();
  }

  async function jumpTo(id) {
    let el = $(`[data-msg-id="${CSS.escape(id)}"]`);
    if (!el) { try { await loadAround(id); renderMessages({}); } catch (e) { return toastErr(e); } el = $(`[data-msg-id="${CSS.escape(id)}"]`); }
    if (!el) return Nova.toast('Message not available', 'err');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  }
  Core.jumpTo = jumpTo;

  /* gallery for the media viewer: every visual item in this conversation */
  M.hooks.galleryFor = el => {
    const key = el.closest('[data-key]'); if (!key) return null;
    const items = []; let index = 0;
    S.msgs.filter(m => !m.deleted_at && !S.hidden.has(m.id)).forEach(m => (m.attachments || []).forEach((a, i) => {
      const kind = R.attKind(a); if (kind !== 'image' && kind !== 'video') return; if (a.viewOnce && !a._blobUrl) return;
      if (m.client_id === key.dataset.key && String(i) === el.dataset.ncOpen) index = items.length;
      items.push({ ...a, kind, messageId: m.id, sender: { name: nameOf(m.sender_id), avatar_url: person(m.sender_id).avatar_url }, at: m.created_at });
    }));
    return items.length ? { items, index, opts: {} } : null;
  };
  M.hooks.openViewOnce = async (el, index) => {
    const key = el.closest('[data-msg-id]'); if (!key) return;
    const m = S.msgs.find(x => x.id === key.dataset.msgId); if (!m) return;
    const att = (m.attachments || [])[index];
    if (m.sender_id === U.id) return Nova.toast('View-once media can only be opened by the recipient.');
    const { data, error } = await sb.rpc('chat_open_view_once', { p_message_id: m.id, p_index: index });
    if (error) return Nova.toast(/expired|already/i.test(error.message) ? 'This media has expired.' : friendly(error), 'err');
    try { M.openViewer([{ ...att, kind: R.attKind(att), viewOnce: true, sender: { name: nameOf(m.sender_id) } }], 0, { viewOnce: true }); } catch (e) { toastErr(e); }
  };

  /* ======================================================== composer: send */
  const unique = (arr) => [...new Set(arr)];
  function extractMentionIds(text) {
    const map = mentionMap(), ids = [];
    for (const m of text.matchAll(/(^|[^\p{L}\p{N}_.-])@([\p{L}\p{N}_.-]{2,40})/gu)) { const id = map.get(m[2].toLowerCase()); if (id && id !== U.id) ids.push(id); }
    return unique(ids);
  }
  const safeName = name => String(name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  const extOf = (name, type) => { const e = R.fileExt(name); if (e) return e; const t = String(type || '').split('/')[1] || 'bin'; return t.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin'; };

  async function sendText() {
    const input = $('#ncInput'); if (!input || !S.active) return;
    const text = input.value.trim();
    if (S.editing) return submitEdit(text);
    if (!text && !S.pending.length) return;
    if (text.length > 5000) return Nova.toast('Message is too long (max 5000 characters).', 'err');
    const item = { conversation_id: S.active, body: text, mentions: extractMentionIds(text), kind: S.pending.length ? 'media' : 'text', reply_to: S.replyTo ? S.replyTo.id : null, remote: S.pending.splice(0).map(p => ({ ...p })) };
    input.value = ''; autosize(input); S.replyTo = null; saveDraft(S.active, ''); paintContext(); paintPendingRemote(); sendActivity('idle');
    hideMention(); enqueue(item); input.focus();
  }
  Core.sendText = sendText;

  /* files -> outbox items. Each file keeps meta so the bubble renders before upload finishes. */
  async function sendFiles(entries, caption = '', quality = 'standard') {
    if (!S.active || !entries.length) return;
    const convId = S.active, replyTo = S.replyTo ? S.replyTo.id : null; S.replyTo = null; paintContext();
    const files = [];
    for (const entry of entries.slice(0, MAX_ATTACHMENTS)) {
      const file = entry.file || entry; let blob = file, meta;
      const baseKind = R.attKind({ type: file.type, name: file.name });
      if (file.size > M.MAX_FILE) { Nova.toast(`${file.name} is larger than ${R.fmtBytes(M.MAX_FILE)}.`, 'err'); continue; }
      const id = R.uuid(); let info = {};
      if (baseKind === 'image' && !/gif|svg/.test(file.type)) { try { const p = await M.prepareImage(file, quality); blob = p.blob; info = { w: p.w, h: p.h, thumb: p.thumb }; } catch (_) {} }
      else if (baseKind === 'video') { try { info = await M.videoInfo(file); } catch (_) {} }
      const type = blob.type || file.type || 'application/octet-stream';
      meta = { kind: entry.kind || baseKind, name: safeName(file.name), type, size: blob.size, path: `${convId}/${U.id}/${entry.viewOnce ? 'once-' : ''}${id}.${extOf(file.name, type)}`, ...info, ...(entry.viewOnce ? { viewOnce: true } : {}), ...(quality === 'hd' && baseKind === 'image' ? { hd: true } : {}), ...(entry.duration ? { duration: entry.duration } : {}), ...(entry.waveform ? { waveform: entry.waveform } : {}), ...(entry.transcript ? { transcript: entry.transcript } : {}) };
      files.push({ blob, meta, uploaded: false });
    }
    if (!files.length) return;
    const voice = files.length === 1 && files[0].meta.kind === 'voice', vnote = files.length === 1 && files[0].meta.kind === 'video_note';
    enqueue({ conversation_id: convId, body: caption || '', mentions: caption ? extractMentionIds(caption) : [], kind: voice ? 'voice' : vnote ? 'video_note' : 'media', reply_to: replyTo, files });
  }
  Core.sendFiles = sendFiles;

  async function pickAndSend(files, { video } = {}) {
    files = [...files].filter(Boolean); if (!files.length) return;
    const images = files.filter(f => /^(image|video)\//.test(f.type)), others = files.filter(f => !/^(image|video)\//.test(f.type));
    if (images.length) {
      const result = await M.openSendPreview(images, { pickMore: () => new Promise(res => { const inp = $('#chatFiles'); inp.onchange = () => { res([...inp.files]); inp.value = ''; }; inp.click(); }) });
      if (result) await sendFiles(result.items, result.caption, result.quality);
    }
    if (others.length) await sendFiles(others.map(f => ({ file: f, kind: /^audio\//.test(f.type) ? 'audio' : 'document' })));
  }
  Core.pickAndSend = pickAndSend;

  /* ----------------------------------------------------------- voice notes */
  function cancelVoice() { if (S.recorder) { try { S.recorder.cancel(); } catch (_) {} S.recorder = null; } paintRec(false); sendActivity('idle'); }
  function paintRec(on, state = {}) {
    const panel = $('#ncRecPanel'), row = $('#ncInputRow'); if (!panel) return;
    panel.hidden = !on; if (row) row.hidden = on;
    if (!on) { panel.innerHTML = ''; return; }
    const sec = Math.floor(state.sec || 0);
    panel.innerHTML = `<span class="voice-recording-dot${state.paused ? ' paused' : ''}" aria-hidden="true"></span><span class="voice-recording-time nc-rec-time">${R.fmtDuration(sec)}</span>
      <div class="nc-rec-wave" id="ncRecWave">${Array.from({ length: 22 }, () => '<i></i>').join('')}</div>
      <span class="voice-recording-label nc-rec-hint">${state.paused ? 'Recording paused' : state.locked ? 'Recording voice message' : 'Slide left to cancel'}</span>
      <button type=button class="voice-control" data-rec-pause aria-label="${state.paused ? 'Resume recording' : 'Pause recording'}">${state.paused ? 'Resume' : 'Pause'}</button>
      <button type=button class="voice-control voice-cancel" data-rec-cancel aria-label="Cancel recording">Cancel</button>
      <button type=button class="voice-control voice-stop" data-rec-send aria-label="Send voice message">Send</button>`;
  }
  async function startVoice({ locked = false } = {}) {
    if (S.recorder || !S.active) return;
    if (!M.mediaSupported() || !window.MediaRecorder) return Nova.toast('Voice recording is not supported in this browser.', 'err');
    const rec = new M.VoiceRecorder(); S.recorder = rec; rec.locked = locked;
    try { await rec.start(); } catch (e) { S.recorder = null; paintRec(false); return Nova.toast(/denied|NotAllowed/i.test(e.name + e.message) ? 'Microphone permission is blocked. Allow it in your browser settings.' : 'Could not start recording.', 'err'); }
    sendActivity('recording_audio'); const started = Date.now(); let paused = 0, pausedAt = 0;
    paintRec(true, { locked });
    rec.onLevel = lvl => { const bars = $$('#ncRecWave i'); bars.forEach((b, i) => { b.style.height = `${6 + Math.max(0, Math.min(1, lvl * (0.5 + ((i * 37) % 10) / 10))) * 22}px`; }); };
    rec.timer = setInterval(() => { if (!S.recorder) return clearInterval(rec.timer); const t = $('.nc-rec-time'); if (t) t.textContent = R.fmtDuration(Math.floor(((rec.isPaused ? pausedAt : Date.now()) - started - paused) / 1000)); sendActivity('recording_audio'); }, 500);
    rec.pauseToggle = () => { if (rec.isPaused) { rec.resume(); paused += Date.now() - pausedAt; rec.isPaused = false; } else { rec.pause(); pausedAt = Date.now(); rec.isPaused = true; } paintRec(true, { locked: true, paused: rec.isPaused, sec: Math.floor(((rec.isPaused ? pausedAt : Date.now()) - started - paused) / 1000) }); };
  }
  async function finishVoice(preview = true) {
    const rec = S.recorder; if (!rec) return; clearInterval(rec.timer); S.recorder = null;
    let result; try { result = await rec.stop(); } catch (_) { result = null; }
    paintRec(false); sendActivity('idle');
    if (!result || result.duration < 0.8) return Nova.toast('Hold the mic to record a voice message.');
    if (preview && result.duration > 3) { const ok = await M.previewVoice(result); if (!ok) return; }
    await sendFiles([{ file: result.file, kind: 'voice', duration: result.duration, waveform: result.waveform, transcript: M.prefs().transcribe ? result.transcript : undefined }]);
  }
  Core.startVoice = startVoice; Core.finishVoice = finishVoice; Core.cancelVoice = cancelVoice;

  /* ======================================================== edit / actions */
  async function submitEdit(text) {
    const m = S.editing; if (!m) return; S.editing = null; paintContext();
    const input = $('#ncInput'); if (input) { input.value = ''; autosize(input); }
    if (!text) return Nova.toast('A message cannot be empty. Delete it instead.', 'err');
    if (text === m.body) return;
    const old = { body: m.body, edited_at: m.edited_at }; m.body = text; m.edited_at = iso(); renderMessages({});
    const { error } = await sb.rpc('edit_chat_message', { p_id: m.id, p_body: text, p_mentions: extractMentionIds(text) });
    if (error) { m.body = old.body; m.edited_at = old.edited_at; renderMessages({}); Nova.toast(/expired|window|15/i.test(error.message) ? 'Messages can only be edited for 15 minutes.' : friendly(error), 'err'); }
  }
  async function toggleReaction(id, emoji) {
    const mine = (S.reactions.get(id) || new Map()).get(U.id), next = mine === emoji ? null : emoji;
    setReaction(id, U.id, next); renderMessages({});
    const { error } = next ? await sb.from('message_reactions').upsert({ message_id: id, user_id: U.id, emoji: next }, { onConflict: 'message_id,user_id' }) : await sb.from('message_reactions').delete().eq('message_id', id).eq('user_id', U.id);
    if (error) { setReaction(id, U.id, mine || null); renderMessages({}); toastErr(error); }
  }
  async function deleteForMe(ids) {
    ids.forEach(id => S.hidden.add(id)); renderMessages({});
    const { error } = await sb.from('message_hidden').upsert(ids.map(id => ({ user_id: U.id, message_id: id })), { onConflict: 'user_id,message_id' });
    if (error) { ids.forEach(id => S.hidden.delete(id)); renderMessages({}); toastErr(error); } else loadInbox(true);
  }
  async function deleteForEveryone(ids) {
    for (const id of ids) {
      const m = S.msgs.find(x => x.id === id); if (!m) continue;
      const { data: orphans, error } = await sb.rpc('delete_chat_message_everyone', { p_id: id });
      if (!error && Array.isArray(orphans) && orphans.length) sb.storage.from('chat-media').remove(orphans).then(() => {}, () => {});
      if (error) { Nova.toast(/window|expired|48/i.test(error.message) ? 'You can only delete for everyone within 48 hours.' : friendly(error), 'err'); continue; }
      m.deleted_at = iso(); m.body = ''; m.attachments = [];
    }
    renderMessages({}); loadInbox(true);
  }
  function confirmDelete(ids) {
    const msgs = ids.map(id => S.msgs.find(m => m.id === id || m.client_id === id)).filter(Boolean); if (!msgs.length) return;
    const local = msgs.filter(m => m._local), real = msgs.filter(m => !m._local);
    local.forEach(m => Core.cancelOutbox(m.client_id)); if (!real.length) return;
    const everyone = real.every(m => m.sender_id === U.id && !m.deleted_at && Date.now() - new Date(m.created_at) < DELETE_WINDOW);
    Core.ui.sheet({ title: `Delete ${real.length > 1 ? `${real.length} messages` : 'message'}?`, actions: [
      ...(everyone ? [{ label: 'Delete for everyone', icon: 'trash', danger: true, run: () => { S.selection = null; deleteForEveryone(real.map(m => m.id)); paintSelBar(); } }] : []),
      { label: 'Delete for me', icon: 'trash', danger: !everyone, run: () => { S.selection = null; deleteForMe(real.map(m => m.id)); paintSelBar(); } }
    ] });
  }
  async function togglePin(id) {
    const pinned = S.pins.includes(id);
    if (!pinned && S.pins.length >= 3) return Nova.toast('You can pin up to 3 messages. Unpin one first.', 'err');
    const { error } = pinned ? await sb.from('pinned_messages').delete().eq('conversation_id', S.active).eq('message_id', id) : await sb.from('pinned_messages').insert({ conversation_id: S.active, message_id: id, pinned_by: U.id });
    if (error) return toastErr(error);
    await loadPins(); renderMessages({}); Nova.toast(pinned ? 'Message unpinned' : 'Message pinned');
  }
  async function translateMessage(m) {
    if (S.translations.has(m.id)) { S.translations.delete(m.id); return renderMessages({}); }
    const target = (navigator.language || 'en').split('-')[0]; S.translations.set(m.id, 'loading'); renderMessages({});
    try {
      const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(R.plain(m.body).slice(0, 450))}&langpair=${encodeURIComponent(`Autodetect|${target}`)}`);
      const json = await res.json(); const text = json && json.responseData && json.responseData.translatedText;
      if (!text || /INVALID|QUERY LENGTH/i.test(text)) throw new Error('x');
      S.translations.set(m.id, text);
    } catch { S.translations.delete(m.id); Nova.toast('Translation is unavailable right now.', 'err'); }
    renderMessages({});
  }
  const msgById = id => S.msgs.find(m => m.id === id || m.client_id === id) || S.replyCache.get(id);
  function startReply(m) { S.replyTo = m; S.editing = null; paintContext(); const i = $('#ncInput'); i && i.focus(); }
  function startEdit(m) { S.editing = m; S.replyTo = null; const i = $('#ncInput'); if (i) { i.value = m.body; autosize(i); i.focus(); } paintContext(); }
  Core.msgById = msgById; Core.confirmDelete = confirmDelete; Core.toggleReaction = toggleReaction; Core.startReply = startReply;

  /* ---------------------------------------------------- selection mode */
  function paintSelBar() {
    const bar = $('#ncSelBar'), head = $('#ncHead'); if (!bar) return;
    if (!S.selection) { bar.hidden = true; bar.innerHTML = ''; if (head) head.hidden = false; return; }
    const n = S.selection.size, only = n === 1 ? msgById([...S.selection][0]) : null, texts = [...S.selection].map(msgById).filter(m => m && m.body);
    if (head) head.hidden = true; bar.hidden = false;
    bar.innerHTML = `<button type=button class="nc-icon-btn" data-sel-cancel aria-label="Cancel selection">${ic('x', 20)}</button><b>${n} selected</b><span class="grow"></span>
      ${only && !only.deleted_at ? `<button type=button class="nc-icon-btn" data-sel-reply aria-label="Reply">${M.ic('reply', 20)}</button>` : ''}
      ${texts.length ? `<button type=button class="nc-icon-btn" data-sel-copy aria-label="Copy">${M.ic('copy', 20)}</button>` : ''}
      <button type=button class="nc-icon-btn" data-sel-forward aria-label="Forward">${M.ic('forward', 20)}</button><button type=button class="nc-icon-btn danger" data-sel-delete aria-label="Delete">${ic('trash', 20)}</button>`;
  }
  function toggleSelect(id) {
    if (!S.selection) S.selection = new Set(); S.selection.has(id) ? S.selection.delete(id) : S.selection.add(id);
    if (!S.selection.size) S.selection = null; renderMessages({}); paintSelBar();
  }

  /* ----------------------------------------------------- context menu */
  Core.ui.sheet = ({ title, body = '', actions = [], cancel = true, node, className = '' }) => {
    const wrap = document.createElement('div'); wrap.className = `nc-sheet-wrap ${className}`;
    wrap.innerHTML = `<div class="nc-scrim" data-close></div><div class="nc-sheet" role="document"><div class="nc-grab"></div>${title ? `<h3>${esc(title)}</h3>` : ''}<div class="nc-sheet-body">${body}</div><div class="nc-sheet-actions"></div></div>`;
    const list = $('.nc-sheet-actions', wrap), content = $('.nc-sheet-body', wrap);
    if (node) content.append(node);
    const close = () => M.closeOverlay(wrap);
    actions.forEach(a => { const b = document.createElement('button'); b.type = 'button'; b.className = `nc-sheet-item${a.danger ? ' danger' : ''}`; b.innerHTML = `${a.icon ? (M.ic(a.icon, 20) || ic(a.icon, 20)) : ''}<span>${esc(a.label)}</span>${a.hint ? `<small>${esc(a.hint)}</small>` : ''}`; b.onclick = () => { close(); setTimeout(() => a.run && a.run(), 120); }; list.append(b); });
    if (cancel && actions.length) { const c = document.createElement('button'); c.type = 'button'; c.className = 'nc-sheet-item cancel'; c.textContent = 'Cancel'; c.onclick = close; list.append(c); }
    wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    M.openOverlay(wrap, { label: title || 'Options' });
    return { close, node: wrap };
  };

  function openMsgMenu(id) {
    const m = msgById(id); if (!m || (S.selection && !m.deleted_at)) return;
    if (m.deleted_at) return Core.ui.sheet({ title: 'Message deleted', actions: [{ label: 'Delete for me', icon: 'trash', danger: true, run: () => deleteForMe([m.id]) }] });
    const mine = m.sender_id === U.id, canEdit = mine && !m._local && m.kind === 'text' && !(m.attachments || []).length && Date.now() - new Date(m.created_at) < EDIT_WINDOW;
    const quick = quickReactions(), cur = (S.reactions.get(m.id) || new Map()).get(U.id);
    const bar = document.createElement('div'); bar.className = 'nc-quickbar';
    bar.innerHTML = `${quick.map(e => `<button type=button class="${e === cur ? 'on' : ''}" data-q="${esc(e)}" aria-label="React ${esc(e)}">${esc(e)}</button>`).join('')}<button type=button data-q-more aria-label="More reactions">${ic('plus', 18)}</button>`;
    const acts = []; const A = (label, icon, run, extra = {}) => acts.push({ label, icon, run, ...extra });
    if (m._local) { if (m._state === 'failed') A('Retry sending', 'refresh', () => Core.retryOutbox(m.client_id)); A('Delete', 'trash', () => Core.cancelOutbox(m.client_id), { danger: true }); }
    else {
      A('Reply', 'reply', () => startReply(m));
      if (m.body) A('Copy', 'copy', () => { copyText(R.plain(m.body)); Nova.toast('Copied'); });
      A('Forward', 'forward', () => Core.forward([m.id]));
      if (canEdit) A('Edit', 'pencil', () => startEdit(m));
      A(S.pins.includes(m.id) ? 'Unpin' : 'Pin', 'pushpin', () => togglePin(m.id));
      if (m.body) A(S.translations.has(m.id) ? 'Hide translation' : 'Translate', 'translate', () => translateMessage(m));
      A('Select', 'check', () => { S.selection = new Set([m.id]); renderMessages({}); paintSelBar(); });
      if ((m.attachments || []).some(a => a.path || a.url)) A('Save to device', 'download', () => (m.attachments || []).filter(a => a.path).forEach(a => M.saveAttachment(a).catch(e => Nova.toast(e.message, 'err'))));
      if (mine) A('Message info', 'info', () => Core.messageInfo && Core.messageInfo(m.id));
      if (!mine) A('Report', 'flag', () => Core.reportMessage && Core.reportMessage(m.id), { danger: true });
      A('Delete', 'trash', () => confirmDelete([m.id]), { danger: true });
    }
    const sh = Core.ui.sheet({ node: bar, actions: acts, className: 'msg-menu' });
    bar.addEventListener('click', e => {
      const q = e.target.closest('[data-q]'), more = e.target.closest('[data-q-more]');
      if (q) { sh.close(); toggleReaction(m.id, q.dataset.q); }
      if (more) { sh.close(); setTimeout(() => Core.emojiPicker && Core.emojiPicker(e2 => toggleReaction(m.id, e2)), 150); }
    });
  }
  Core.openMsgMenu = openMsgMenu;

  /* ============================================================ conversation row + thread menus */
  async function memberUpdate(convId, patch) {
    const { error } = await sb.from('conversation_members').update(patch).eq('conversation_id', convId).eq('user_id', U.id);
    if (error) { toastErr(error); return false; }
    const c = convById(convId); if (c) Object.assign(c, patch); S.inbox.sort(inboxSort); paintInboxList(); paintBadge(); return true;
  }
  Core.memberUpdate = memberUpdate;
  function muteSheet(c) {
    const set = ms => memberUpdate(c.id, { muted_until: ms === Infinity ? 'infinity' : new Date(Date.now() + ms).toISOString() }).then(ok => ok && Nova.toast('Chat muted'));
    Core.ui.sheet({ title: 'Mute notifications', actions: [
      { label: 'For 8 hours', icon: 'belloff', run: () => set(8 * 3600000) }, { label: 'For 1 week', icon: 'belloff', run: () => set(7 * 86400000) }, { label: 'Always', icon: 'belloff', run: () => set(Infinity) }] });
  }
  async function clearChat(c) {
    if (!await ask('Clear this chat?', 'All messages are removed from your device view. Other people keep their copy.', 'Clear chat')) return;
    if (await memberUpdate(c.id, { cleared_at: iso() })) { if (S.active === c.id) { S.msgs = []; S.pins = []; renderMessages({}); } Nova.toast('Chat cleared'); }
  }
  async function deleteChat(c) {
    if (!await ask('Delete this chat?', 'It is removed from your list and your messages are cleared. It returns if the person writes again.', 'Delete')) return;
    if (await memberUpdate(c.id, { hidden_at: iso(), cleared_at: iso(), pinned_at: null })) { S.inbox = S.inbox.filter(x => x.id !== c.id); if (S.active === c.id) location.hash = '#chat'; paintInboxList(); }
  }
  async function blockToggle(c) {
    const id = peerId(c); if (!id) return;
    if (c.blocked_by_me) { const { error } = await sb.rpc('unblock_user', { p_blocked_id: id }); if (error) return toastErr(error); c.blocked_by_me = false; Nova.toast('Contact unblocked'); }
    else { if (!await ask(`Block ${nameOf(id)}?`, 'They can no longer message you. They are not told that you blocked them.', 'Block')) return; const { error } = await sb.rpc('block_user', { p_blocked_id: id }); if (error) return toastErr(error); c.blocked_by_me = true; Nova.toast('Contact blocked'); }
    paintBlocked(); paintInboxList(); loadInbox(true);
  }
  Core.blockToggle = blockToggle;
  function openRowMenu(c) {
    if (!c) return; const muted = mutedNow(c);
    Core.ui.sheet({ title: titleFor(c), actions: [
      { label: c.pinned_at ? 'Unpin chat' : 'Pin chat', icon: 'pushpin', run: async () => { if (!c.pinned_at && S.inbox.filter(x => x.pinned_at).length >= 3) return Nova.toast('You can pin up to 3 chats.', 'err'); memberUpdate(c.id, { pinned_at: c.pinned_at ? null : iso() }); } },
      { label: muted ? 'Unmute' : 'Mute', icon: 'belloff', run: () => muted ? memberUpdate(c.id, { muted_until: null }) : muteSheet(c) },
      { label: c.archived_at ? 'Unarchive' : 'Archive', icon: 'archive', run: () => memberUpdate(c.id, { archived_at: c.archived_at ? null : iso() }) },
      { label: 'Mark as unread', icon: 'chat', run: () => { c.unread = c.unread || 1; paintInboxList(); paintBadge(); } },
      { label: 'Clear chat', icon: 'trash', run: () => clearChat(c) },
      ...(!c.is_group ? [{ label: c.blocked_by_me ? 'Unblock' : 'Block', icon: 'ban', danger: !c.blocked_by_me, run: () => blockToggle(c) }] : []),
      { label: 'Delete chat', icon: 'trash', danger: true, run: () => deleteChat(c) }] });
  }
  function openThreadMenu() {
    const c = S.conv; if (!c) return; const muted = mutedNow(c);
    Core.ui.sheet({ title: titleFor(c), actions: [
      { label: 'Search in chat', icon: 'search', run: () => Core.convSearch && Core.convSearch() },
      { label: 'Media, links and docs', icon: 'image', run: () => Core.openInfo && Core.openInfo(c, 'media') },
      { label: 'Schedule message', icon: 'clock', run: () => Core.scheduleDialog && Core.scheduleDialog() },
      { label: 'Scheduled messages', icon: 'clock', hint: S.scheduled.length ? String(S.scheduled.length) : '', run: () => Core.scheduledList && Core.scheduledList() },
      { label: muted ? 'Unmute' : 'Mute notifications', icon: 'belloff', run: () => muted ? memberUpdate(c.id, { muted_until: null }) : muteSheet(c) },
      { label: c.pinned_at ? 'Unpin chat' : 'Pin chat', icon: 'pushpin', run: () => memberUpdate(c.id, { pinned_at: c.pinned_at ? null : iso() }) },
      { label: c.archived_at ? 'Unarchive' : 'Archive', icon: 'archive', run: () => memberUpdate(c.id, { archived_at: c.archived_at ? null : iso() }) },
      { label: 'Clear chat', icon: 'trash', run: () => clearChat(c) },
      ...(!c.is_group ? [{ label: c.blocked_by_me ? 'Unblock' : 'Block', icon: 'ban', danger: !c.blocked_by_me, run: () => blockToggle(c) }, { label: 'Report', icon: 'flag', danger: true, run: () => Core.report && Core.report({ userId: peerId(c), conversationId: c.id }) }] : [])] });
  }

  async function respondRequest(action, convId) {
    const c = convById(convId), id = c && peerId(c);
    try {
      if (action === 'block') { if (!await ask('Block this sender?', 'Their request is removed and they cannot message you again.', 'Block')) return; const { error } = await sb.rpc('block_user', { p_blocked_id: id }); if (error) throw error; await sb.rpc('chat_request_respond', { p_conversation: convId, p_action: 'delete' }); }
      else if (action === 'report') return Core.report && Core.report({ userId: id, conversationId: convId, offerBlock: true });
      else { const { error } = await sb.rpc('chat_request_respond', { p_conversation: convId, p_action: action }); if (error) throw error; }
      await loadInbox(true);
      if (action === 'accept') { Nova.toast('Request accepted'); S.tab = 'chats'; if (S.active === convId) { S.conv = convById(convId); paintRequestBar(); paintBlocked(); } else location.hash = `#chat/${convId}`; }
      else { Nova.toast(action === 'reject' ? 'Request rejected' : action === 'block' ? 'Blocked' : 'Request deleted'); if (S.active === convId) location.hash = '#chat'; }
      paintInboxList();
    } catch (e) { toastErr(e); }
  }

  async function openFriendChat(userId) {
    try {
      const existing = S.inbox.find(c => !c.is_group && peerId(c) === userId);
      if (existing) { if (existing.hidden_at) await sb.from('conversation_members').update({ hidden_at: null }).eq('conversation_id', existing.id).eq('user_id', U.id); Core.go(`#chat/${existing.id}`); return; }
      const { data, error } = await sb.rpc('start_chat', { p_member_ids: [userId] }); if (error) throw error;
      await loadInbox(true); Core.go(`#chat/${data}`);
    } catch (e) { toastErr(e); }
  }
  Core.go = (hash, tries = 0) => { if (history.state && history.state.ncOverlay && tries < 30) return setTimeout(() => Core.go(hash, tries + 1), 40); if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; };
  Core.openFriendChat = openFriendChat;
  Core.messageUser = async userId => {
    if (userId === U.id) return;
    const { data } = await sb.from('friendships').select('status').or(`and(user_id.eq.${U.id},friend_id.eq.${userId}),and(user_id.eq.${userId},friend_id.eq.${U.id})`).eq('status', 'accepted').limit(1);
    if (data && data.length) return openFriendChat(userId);
    const existing = S.inbox.find(c => !c.is_group && peerId(c) === userId); if (existing) { Core.go(`#chat/${existing.id}`); return; }
    Core.messageRequest ? Core.messageRequest(userId) : Nova.toast('Add this person as a friend first.', 'err');
  };

  /* ================================================================ mentions + format */
  let mentionState = null;
  function hideMention() { mentionState = null; const el = $('#ncMention'); if (el) { el.hidden = true; el.innerHTML = ''; } }
  function updateMention(input) {
    if (!S.conv || !S.conv.is_group) return hideMention();
    const pos = input.selectionStart, before = input.value.slice(0, pos), m = /(^|\s)@([\p{L}\p{N}_.-]{0,40})$/u.exec(before);
    if (!m) return hideMention();
    const q = m[2].toLowerCase(), list = (S.conv.member_ids || []).filter(id => id !== U.id).map(person).filter(p => p.username && (`${p.username} ${p.full_name || ''}`.toLowerCase().includes(q))).slice(0, 6);
    if (!list.length) return hideMention();
    mentionState = { start: pos - m[2].length - 1, list, index: 0 };
    const el = $('#ncMention'); el.hidden = false;
    el.innerHTML = list.map((p, i) => `<button type=button class="${i === 0 ? 'on' : ''}" data-mention="${i}">${Nova.avatar(p, 28)}<span><b>${esc(p.full_name || p.username)}</b><small>@${esc(p.username)}</small></span></button>`).join('');
  }
  function pickMention(i) {
    const input = $('#ncInput'), p = mentionState && mentionState.list[i]; if (!p) return;
    const end = input.selectionStart; input.value = `${input.value.slice(0, mentionState.start)}@${p.username} ${input.value.slice(end)}`;
    const caret = mentionState.start + p.username.length + 2; input.setSelectionRange(caret, caret); hideMention(); input.focus(); toggleSendMic();
  }
  function wrapSelection(mark) {
    const input = $('#ncInput'); if (!input) return;
    const a = input.selectionStart, b = input.selectionEnd, sel = input.value.slice(a, b) || 'text';
    input.value = `${input.value.slice(0, a)}${mark}${sel}${mark}${input.value.slice(b)}`; input.setSelectionRange(a + mark.length, a + mark.length + sel.length); input.focus(); autosize(input); toggleSendMic();
  }

  /* ================================================================ emoji panel */
  function emojiGrid(onPick, container) {
    let cat = 0, q = '';
    const draw = () => {
      const all = q ? R.EMOJI.flatMap(c => c.items).filter(([, n]) => n.includes(q)) : R.EMOJI[cat].items;
      container.innerHTML = `<div class="nc-emoji-search"><input type=search placeholder="Search emoji" value="${esc(q)}" aria-label="Search emoji"></div><div class="nc-emoji-tabs">${R.EMOJI.map((c, i) => `<button type=button class="${!q && i === cat ? 'on' : ''}" data-ecat="${i}" aria-label="${esc(c.name)}">${c.icon}</button>`).join('')}</div><div class="nc-emoji-grid">${all.map(([e, n]) => `<button type=button data-emoji-pick="${esc(e)}" title="${esc(n)}">${e}</button>`).join('') || '<p class=mu>No emoji found</p>'}</div>`;
      const input = container.querySelector('input'); if (q) { input.focus(); input.setSelectionRange(q.length, q.length); }
    };
    container.onclick = e => { const t = e.target.closest('[data-ecat]'); if (t) { cat = Number(t.dataset.ecat); q = ''; draw(); } const p = e.target.closest('[data-emoji-pick]'); if (p) onPick(p.dataset.emojiPick); };
    container.oninput = e => { if (e.target.matches('input')) { q = e.target.value.trim().toLowerCase(); draw(); } };
    draw();
  }
  Core.emojiPicker = onPick => { const box = document.createElement('div'); box.className = 'nc-emoji-sheet'; const sh = Core.ui.sheet({ title: 'Choose emoji', node: box, cancel: false, className: 'emoji' }); emojiGrid(e => { sh.close(); onPick(e); }, box); };
  function toggleEmojiPanel() {
    const panel = $('#ncEmojiPanel'), btn = $('[data-nc-emoji]'); if (!panel) return;
    const open = panel.hidden; panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); Pk.close();
    if (open) emojiGrid(e => { const i = $('#ncInput'), a = i.selectionStart; i.value = i.value.slice(0, a) + e + i.value.slice(i.selectionEnd); i.setSelectionRange(a + e.length, a + e.length); autosize(i); toggleSendMic(); saveDraft(S.active, i.value.trim()); }, panel);
  }

  /* ================================================================ clicks */
  document.addEventListener('click', async event => {
    const t = event.target, hit = sel => t.closest(sel);
    if (!inMessaging()) return;
    let el;
    if ((el = hit('[data-people-tab]'))) {
      const tab = el.dataset.peopleTab;
      if (tab === 'chats') { location.hash = '#chat'; return; }
      peopleTab = tab; if (location.hash === '#friends') route(); else location.hash = '#friends'; return;
    }
    if ((el = hit('[data-open-friend]'))) return openFriendChat(el.dataset.openFriend);
    if ((el = hit('[data-msg-user]'))) return Core.messageUser(el.dataset.msgUser);
    for (const a of ['add', 'accept', 'decline', 'cancel', 'remove', 'block', 'unblock']) { const k = `people${a[0].toUpperCase()}${a.slice(1)}`; if ((el = hit(`[data-people-${a}]`))) { await peopleAction(el, a, el.dataset[k]); loadPeople(); return; } }
    if (hit('[data-people-retry]')) return loadPeople();
    if (!S.root || !document.body.contains(S.root)) return;
    if ((el = hit('[data-req]'))) { event.stopPropagation(); return respondRequest(el.dataset.req, el.dataset.convId); }
    if ((el = hit('[data-row-menu]'))) { event.stopPropagation(); return openRowMenu(convById(el.dataset.rowMenu)); }
    if ((el = hit('[data-open-conv]'))) { location.hash = `#chat/${el.dataset.openConv}`; return; }
    if ((el = hit('[data-nc-tab]'))) { S.tab = el.dataset.ncTab; paintInboxList(); return; }
    if (hit('[data-chat-compose]')) return Core.newChat && Core.newChat();
    if (hit('[data-nc-qr]')) return Core.openQr && Core.openQr();
    if (hit('[data-nc-settings]')) return Core.openSettings && Core.openSettings();
    if (hit('[data-chat-retry]')) return loadInbox();
    if (hit('[data-nc-clear-search]')) { const i = $('#ncSearch'); i.value = ''; S.query = ''; i.dispatchEvent(new Event('input')); return i.focus(); }
    if (hit('[data-nc-notify]')) { try { await Notification.requestPermission(); } catch (_) {} return paintInboxList(); }
    if (hit('[data-nc-notify-dismiss]')) { try { sessionStorage.setItem('nc_notif_dismiss', '1'); } catch (_) {} return paintInboxList(); }
    if (!S.active) return;
    if (hit('[data-nc-info]')) return Core.openInfo && Core.openInfo(S.conv);
    if (hit('[data-nc-search]')) return Core.convSearch && Core.convSearch();
    if (hit('[data-nc-thread-menu]')) return openThreadMenu();
    if (hit('[data-nc-unblock]')) return blockToggle(S.conv);
    if (hit('[data-nc-jump]')) { if (S.hasNewer) { await loadLatest(); renderMessages({ stick: true }); } else { const b = $('#ncMsgs'); b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); } return; }
    if ((el = hit('[data-jump]')) && !hit('[data-pin-menu]')) { if (hit('[data-pin-next]')) { S.pinIndex = (S.pinIndex || 0) + 1; paintPinned(); } return jumpTo(el.dataset.jump); }
    if ((el = hit('[data-pin-menu]'))) { event.stopPropagation(); return togglePin(el.dataset.pinMenu); }
    if ((el = hit('[data-expand]'))) { S.expanded.add(el.dataset.expand); return renderMessages({}); }
    if ((el = hit('[data-react-chip]'))) { event.stopPropagation(); const id = el.dataset.reactChip; return Core.reactionDetails ? (S.reactions.get(id) && (event.detail === 0 || true) && Core.reactionDetails(id)) : toggleReaction(id, el.dataset.emoji); }
    if ((el = hit('[data-retry]'))) return Core.retryOutbox(el.dataset.retry);
    if ((el = hit('[data-discard]'))) return Core.cancelOutbox(el.dataset.discard);
    if ((el = hit('.nc-mention[data-user],.nc-sender[data-user],[data-user]'))) { if (el.closest('.nc-msg') || el.classList.contains('nc-mention')) return Core.openProfile ? Core.openProfile(el.dataset.user) : (location.hash = `#user/${el.dataset.user}`); }
    if ((el = hit('[data-hashtag]'))) { return Core.convSearch && Core.convSearch(`#${el.dataset.hashtag}`); }
    if ((el = hit('[data-sel-cancel]'))) { S.selection = null; renderMessages({}); return paintSelBar(); }
    if (hit('[data-sel-delete]')) return confirmDelete([...S.selection]);
    if (hit('[data-sel-forward]')) return Core.forward && Core.forward([...S.selection]);
    if (hit('[data-sel-reply]')) { const m = msgById([...S.selection][0]); S.selection = null; renderMessages({}); paintSelBar(); return startReply(m); }
    if (hit('[data-sel-copy]')) { const text = [...S.selection].map(msgById).filter(m => m && m.body).sort((a, b) => a.created_at < b.created_at ? -1 : 1).map(m => R.plain(m.body)).join('\n'); copyText(text); Nova.toast('Copied'); S.selection = null; renderMessages({}); return paintSelBar(); }
    if (hit('[data-nc-cancel-ctx]')) { if (S.editing) { const i = $('#ncInput'); i.value = ''; autosize(i); } S.replyTo = null; S.editing = null; return paintContext(); }
    if ((el = hit('[data-remove-pending]'))) { S.pending.splice(Number(el.dataset.removePending), 1); return paintPendingRemote(); }
    if (hit('[data-nc-emoji]')) return toggleEmojiPanel();
    if (hit('[data-nc-format]')) { const f = $('#ncFormat'); f.hidden = !f.hidden; return; }
    if ((el = hit('[data-fmt]'))) return wrapSelection(el.dataset.fmt);
    if ((el = hit('[data-mention]'))) return pickMention(Number(el.dataset.mention));
    if (hit('[data-nc-send]')) return sendText();
    if (hit('[data-chat-media]')) { const e = $('#ncEmojiPanel'); if (e) e.hidden = true; return Pk.open(); }
    if (hit('[data-rec-cancel]')) return cancelVoice();
    if (hit('[data-rec-pause]')) return S.recorder && S.recorder.pauseToggle();
    if (hit('[data-rec-send]')) return finishVoice(false);
    if ((el = hit('[data-media-action]'))) {
      const action = el.dataset.mediaAction; if (action !== 'camera' || el.classList.contains('media-menu-item') || true) Pk.close();
      if (action === 'gallery') return $('#chatFiles').click();
      if (action === 'document') return $('#chatDocuments').click();
      if (action === 'audio') return $('#chatAudio').click();
      if (action === 'camera') { try { const files = M.mediaSupported() ? await M.openCamera({ video: true }) : await new Promise(res => { const i = $('#chatCameraFallback'); i.onchange = () => { res([...i.files]); i.value = ''; }; i.click(); }); return pickAndSend(files || []); } catch (e) { return Nova.toast(/denied|NotAllowed/i.test(e.name + e.message) ? 'Camera permission is blocked.' : 'Camera unavailable.', 'err'); } }
      if (action === 'videonote') { sendActivity('recording_video'); try { const r = await M.recordVideoNote(); sendActivity('idle'); if (r) await sendFiles([{ file: r.file, kind: 'video_note', duration: r.duration }]); } catch (e) { sendActivity('idle'); Nova.toast('Video recording unavailable.', 'err'); } return; }
      if (action === 'contact') return Core.shareContact && Core.shareContact();
    }
    if ((el = hit('[data-nc-schedule]'))) return Core.scheduleDialog && Core.scheduleDialog();
  });

  /* inputs */
  document.addEventListener('input', event => {
    const t = event.target;
    if (t.id === 'ncInput') {
      autosize(t); toggleSendMic(); updateMention(t);
      if (S.active && !S.editing) { saveDraft(S.active, t.value.trim()); if (t.value.trim()) sendActivity('typing'); else sendActivity('idle'); }
    }
    if (t.id === 'ncSearch') {
      S.query = t.value; const clr = $('[data-nc-clear-search]'); if (clr) clr.hidden = !t.value; paintInboxList();
      clearTimeout(Core._gs); const box = $('#ncSearchResults'), list = $('#ncList');
      if (t.value.trim().length >= 2 && Core.globalSearch) { Core._gs = setTimeout(() => Core.globalSearch(t.value.trim(), box), 350); box.hidden = false; }
      else if (box) { box.hidden = true; box.innerHTML = ''; }
    }
    if (t.id === 'peopleSearch') { peopleQuery = t.value; clearTimeout(peopleSearchTimer); peopleSearchTimer = setTimeout(loadPeople, 300); }
  });
  document.addEventListener('keydown', event => {
    const t = event.target;
    if (t.id === 'ncInput') {
      if (mentionState) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const n = mentionState.list.length; mentionState.index = (mentionState.index + (event.key === 'ArrowDown' ? 1 : n - 1)) % n; $$('#ncMention button').forEach((b, i) => b.classList.toggle('on', i === mentionState.index)); return; }
        if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); return pickMention(mentionState.index); }
        if (event.key === 'Escape') { event.preventDefault(); return hideMention(); }
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !matchMedia('(pointer:coarse)').matches && M.prefs().enterSends !== false) { event.preventDefault(); sendText(); }
      if (event.key === 'Escape' && (S.replyTo || S.editing)) { event.preventDefault(); const b = $('[data-nc-cancel-ctx]'); b && b.click(); }
      if ((event.ctrlKey || event.metaKey) && /^[bi]$/i.test(event.key)) { event.preventDefault(); wrapSelection(event.key.toLowerCase() === 'b' ? '*' : '_'); }
    }
    if (event.key === 'Escape' && S.selection && !document.querySelector('.nc-overlay')) { S.selection = null; renderMessages({}); paintSelBar(); }
    if ((event.key === 'Enter' || event.key === ' ') && t.classList && t.classList.contains('nc-row') && t === event.target) { event.preventDefault(); location.hash = `#chat/${t.dataset.conv}`; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { const row = t.closest && t.closest('.nc-row'); if (row) { const rows = $$('#ncList .nc-row'), i = rows.indexOf(row), n = rows[i + (event.key === 'ArrowDown' ? 1 : -1)]; if (n) { event.preventDefault(); n.focus(); } } }
    if (event.key === 'Enter' && t.id === 'ncInput' === false && (t.classList && t.classList.contains('nc-msg'))) { openMsgMenu(t.dataset.msgId); }
  });
  document.addEventListener('change', async event => {
    const t = event.target;
    if (t.id === 'chatFiles') { const f = [...t.files]; t.value = ''; return pickAndSend(f); }
    if (t.id === 'chatDocuments' || t.id === 'chatAudio') { const f = [...t.files]; t.value = ''; return sendFiles(f.map(file => ({ file, kind: t.id === 'chatAudio' ? 'audio' : 'document' }))); }
  });
  document.addEventListener('paste', event => {
    if (event.target.id !== 'ncInput') return;
    const files = [...(event.clipboardData && event.clipboardData.files || [])];
    if (files.length) { event.preventDefault(); pickAndSend(files); }
  });

  /* mic: hold to record (slide left cancels, slide up locks), tap to start a locked recording */
  (function micGestures() {
    let down = null, timer = null;
    document.addEventListener('pointerdown', e => {
      const mic = e.target.closest && e.target.closest('[data-nc-mic]'); if (!mic || e.button) return;
      e.preventDefault(); down = { x: e.clientX, y: e.clientY, t: Date.now(), started: false, id: e.pointerId };
      try { mic.setPointerCapture(e.pointerId); } catch (_) {}
      timer = setTimeout(() => { if (down) { down.started = true; startVoice(); } }, 220);
    });
    document.addEventListener('pointermove', e => {
      if (!down || !down.started || !S.recorder || S.recorder.locked) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y, hint = $('.nc-rec-hint');
      if (hint) hint.style.transform = `translateX(${Math.min(0, dx)}px)`;
      if (dx < -90) { down = null; cancelVoice(); }
      else if (dy < -80) { S.recorder.locked = true; down = null; paintRec(true, { locked: true }); }
    });
    const up = e => {
      if (!down) return; clearTimeout(timer); const d = down; down = null;
      if (!d.started) { startVoice({ locked: true }); return; }               // quick tap -> locked recording
      if (S.recorder && !S.recorder.locked) finishVoice(false);                // release -> send
    };
    document.addEventListener('pointerup', up); document.addEventListener('pointercancel', () => { if (down) { clearTimeout(timer); const s = down.started; down = null; if (s) cancelVoice(); } });
  })();

  /* conversation rows: right-click / long-press opens the chat menu (touch has no hover button) */
  (function rowGestures() {
    let t = null, start = null;
    const row = e => e.target.closest && e.target.closest('.nc-row[data-conv]:not(.nc-request)');
    document.addEventListener('contextmenu', e => { const r = row(e); if (r) { e.preventDefault(); openRowMenu(convById(r.dataset.conv)); } });
    document.addEventListener('pointerdown', e => { const r = row(e); if (!r || e.button || e.pointerType === 'mouse' || e.target.closest('.nc-row-more')) return; start = { x: e.clientX, y: e.clientY }; t = setTimeout(() => { t = null; start = null; r.dataset.lp = '1'; navigator.vibrate && navigator.vibrate(12); openRowMenu(convById(r.dataset.conv)); }, 500); });
    document.addEventListener('pointermove', e => { if (t && start && (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10)) { clearTimeout(t); t = null; } });
    const stop = () => { if (t) { clearTimeout(t); t = null; } };
    document.addEventListener('pointerup', stop); document.addEventListener('pointercancel', stop);
    document.addEventListener('click', e => { const r = row(e); if (r && r.dataset.lp) { delete r.dataset.lp; e.stopPropagation(); e.preventDefault(); } }, true);
  })();

  /* long-press / right-click / double-tap on a bubble */
  (function msgGestures() {
    let press = null, lastTap = { id: '', t: 0 }, swipe = null;
    const target = e => e.target.closest && e.target.closest('.nc-msg');
    document.addEventListener('contextmenu', e => { const m = target(e); if (m && !e.target.closest('a,.nc-voice,video,audio')) { e.preventDefault(); openMsgMenu(m.dataset.msgId); } });
    document.addEventListener('pointerdown', e => {
      const m = target(e); if (!m || e.button || e.target.closest('button,a,input,.nc-voice,.nc-tile,video,audio')) return;
      press = { id: m.dataset.msgId, x: e.clientX, y: e.clientY, timer: setTimeout(() => { if (press) { const id = press.id; press = null; swipe = null; navigator.vibrate && navigator.vibrate(12); openMsgMenu(id); } }, 450) };
      swipe = e.pointerType === 'touch' ? { el: m, x: e.clientX, y: e.clientY, id: m.dataset.msgId, done: false } : null;
    });
    document.addEventListener('pointermove', e => {
      if (press && (Math.abs(e.clientX - press.x) > 10 || Math.abs(e.clientY - press.y) > 10)) { clearTimeout(press.timer); press = null; }
      if (swipe && !swipe.done) { const dx = e.clientX - swipe.x, dy = Math.abs(e.clientY - swipe.y); if (dx > 8 && dx > dy * 1.5) { swipe.el.style.transform = `translateX(${Math.min(dx, 70)}px)`; swipe.el.classList.add('swiping'); if (dx > 60) { swipe.done = true; swipe.el.style.transform = ''; swipe.el.classList.remove('swiping'); navigator.vibrate && navigator.vibrate(8); const m = msgById(swipe.id); if (m && !m.deleted_at) startReply(m); } } }
    });
    const end = e => {
      if (press) { clearTimeout(press.timer); press = null; }
      if (swipe) { swipe.el.style.transform = ''; swipe.el.classList.remove('swiping'); swipe = null; }
    };
    document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
    document.addEventListener('click', e => {
      const m = target(e); if (!m || e.target.closest('button,a,input,.nc-voice,.nc-tile,.nc-file,video,audio,.nc-lp,.nc-quote')) {
        if (m && S.selection && !e.target.closest('a')) toggleSelect(m.dataset.msgId); return; }
      if (S.selection) return toggleSelect(m.dataset.msgId);
      const now = Date.now(), id = m.dataset.msgId;
      if (lastTap.id === id && now - lastTap.t < 320) { lastTap = { id: '', t: 0 }; const msg = msgById(id); if (msg && !msg.deleted_at && !msg._local) toggleReaction(id, quickReactions()[0]); }
      else lastTap = { id, t: now };
    });
  })();

  document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('[data-nc-send]')) { e.preventDefault(); Core.scheduleDialog && Core.scheduleDialog(); } });

  /* drag & drop files */
  document.addEventListener('dragover', e => { if (S.active && e.dataTransfer && [...e.dataTransfer.types].includes('Files') && $('#ncThread')) { e.preventDefault(); const d = $('.nc-drop'); d && (d.hidden = false); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) { const d = $('.nc-drop'); d && (d.hidden = true); } });
  document.addEventListener('drop', e => { const d = $('.nc-drop'); d && (d.hidden = true); if (S.active && e.dataTransfer && e.dataTransfer.files.length && $('#ncThread')) { e.preventDefault(); pickAndSend([...e.dataTransfer.files]); } });

  /* ================================================================ lifecycle */
  window.addEventListener('hashchange', () => {
    if (!inChat()) { if (S.active) { const input = $('#ncInput'); input && saveDraft(S.active, input.value.trim()); if (S.recorder) cancelVoice(); M.stopAll(); sendActivity('idle'); closeTypingChannel(); S.active = null; S.conv = null; } document.body.classList.remove('nc-active', 'message-thread-active'); S.root = S.root && document.body.contains(S.root) ? S.root : null; if (!inMessaging()) { unbindRealtime(); } }
  });
  window.addEventListener('beforeunload', () => { const input = $('#ncInput'); if (S.active && input) { try { saveDraft(S.active, input.value.trim()); } catch (_) {} } });
  if ('Notification' in window) { /* permission is requested only from the in-app banner (user gesture) */ }
  (function waitUser() { if (typeof U !== 'undefined' && U && U.id) restoreOutbox(); else setTimeout(waitUser, 400); })();
  Object.assign(Core, { S, nameOf, peerId, person, friendly, titleFor, convById, copyText, loadInbox, loadProfiles, loadPrivacy, loadScheduled, enqueue, saveDraft, mutedNow, isOnline, likeTerm, toggleReaction, confirmDelete, startReply, msgById, memberUpdate, trackPresence });
  Core.ready = true;
})();
