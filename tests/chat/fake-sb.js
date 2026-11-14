/* In-memory Supabase stand-in for browser tests of Nova Chat. window.supabase.createClient(...) */
(function () {
  const ME = 'u-me', now = () => new Date().toISOString(), uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  const png = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="200" cy="150" r="60" fill="#fff8"/></svg>');
  const db = {
    profiles: [{ id: ME, username: 'me', full_name: 'Me Myself', avatar_url: null, bio: 'Hello', settings: {}, maturity_verified: false }, { id: 'u-alice', username: 'alice', full_name: 'Alice Wonder', bio: 'Loves movies' }, { id: 'u-bob', username: 'bob', full_name: 'Bob Builder' }, { id: 'u-carol', username: 'carol', full_name: 'Carol Stranger' }],
    friendships: [{ user_id: ME, friend_id: 'u-alice', status: 'accepted' }, { user_id: 'u-bob', friend_id: ME, status: 'accepted' }],
    user_blocks: [], conversations: [{ id: 'c1', is_group: false, title: null }, { id: 'c2', is_group: true, title: 'Movie Night' }],
    conversation_members: [], chat_messages: [], message_reactions: [], message_receipts: [], message_hidden: [], pinned_messages: [], scheduled_messages: [], chat_privacy: [], gallery: [], subscriptions: []
  };
  const cm = (c, u, extra = {}) => db.conversation_members.push({ conversation_id: c, user_id: u, last_read_at: ago(500), pinned_at: null, muted_until: null, archived_at: null, hidden_at: null, cleared_at: null, draft: null, request_status: 'accepted', ...extra });
  cm('c1', ME); cm('c1', 'u-alice'); cm('c2', ME, { last_read_at: ago(1000) }); cm('c2', 'u-alice'); cm('c2', 'u-bob');
  const msg = (id, conv, sender, body, minutes, extra = {}) => db.chat_messages.push({ id, conversation_id: conv, sender_id: sender, body, mentions: [], attachments: [], created_at: ago(minutes), kind: 'text', reply_to: null, client_id: id, edited_at: null, deleted_at: null, forwarded: false, ...extra });
  msg('m1', 'c1', 'u-alice', 'Hey! Are we watching tonight? 🍿', 300); msg('m2', 'c1', ME, 'Yes! *Dune* at 9?', 295);
  msg('m3', 'c1', 'u-alice', 'Perfect. Check this https://example.com/trailer and #movies', 290); msg('m4', 'c1', ME, 'Replying to you', 280, { reply_to: 'm1' });
  msg('m5', 'c1', 'u-alice', '', 60, { kind: 'media', attachments: [{ kind: 'image', path: 'c1/u-alice/a.png', name: 'a.png', type: 'image/png', size: 12000, w: 400, h: 300, thumb: png }] });
  msg('m6', 'c1', 'u-alice', '', 50, { kind: 'voice', attachments: [{ kind: 'voice', path: 'c1/u-alice/v.webm', name: 'v.webm', type: 'audio/webm', size: 9000, duration: 12, waveform: Array.from({ length: 40 }, (_, i) => Math.round(20 + 70 * Math.abs(Math.sin(i / 3)))) }] });
  msg('m7', 'c1', ME, 'Here is the doc', 40, { kind: 'media', attachments: [{ kind: 'document', path: 'c1/u-me/s.pdf', name: 'schedule.pdf', type: 'application/pdf', size: 245000 }] });
  msg('m8', 'c1', 'u-alice', 'Unread one', 5); msg('m9', 'c1', 'u-alice', 'And another unread 😂', 4);
  for (let i = 0; i < 6; i++) msg('g' + i, 'c2', i % 2 ? 'u-bob' : 'u-alice', 'Group message ' + i + (i === 2 ? ' @me look' : ''), 900 - i * 10);
  db.message_receipts.push({ message_id: 'm2', user_id: 'u-alice', delivered_at: ago(294), read_at: ago(293) }, { message_id: 'm4', user_id: 'u-alice', delivered_at: ago(279), read_at: null });
  db.message_reactions.push({ message_id: 'm1', user_id: ME, emoji: '❤️' }, { message_id: 'm1', user_id: 'u-alice', emoji: '😂' });
  db.pinned_messages.push({ conversation_id: 'c1', message_id: 'm3', pinned_by: ME, pinned_at: ago(100) });
  const listeners = [], log = [];
  const emit = (table, event, row, old) => listeners.forEach(l => (l.table === table && (l.event === '*' || l.event === event)) && l.cb({ eventType: event, new: row, old: old || row }));
  const emitNow = (table, event, row, old) => setTimeout(() => emit(table, event, row, old), 5);
  window.__fake = { db, emit, listeners, log, rpcCalls: [], ME };
  const pub = p => ({ id: p.id, full_name: p.full_name, username: p.username, avatar_url: p.avatar_url || null, bio: p.bio || '' });
  const view = t => t === 'public_profiles' ? db.profiles.map(pub) : (db[t] || []);
  function parseCond(v) { const i = v.indexOf('.'); return [v.slice(0, i), v.slice(i + 1)]; }
  class Q {
    constructor(t) { this.t = t; this.filters = []; this.op = 'select'; this.ord = null; this.lim = null; this.isSingle = false; this.isMaybe = false; this.payload = null; this.opts = {}; }
    select() { if (this.op === 'select') this.op = 'select'; this.returning = true; return this; }
    insert(v) { this.op = 'insert'; this.payload = v; return this; } upsert(v, o) { this.op = 'upsert'; this.payload = v; this.opts = o || {}; return this; }
    update(v) { this.op = 'update'; this.payload = v; return this; } delete() { this.op = 'delete'; return this; }
    eq(k, v) { this.filters.push(r => String(r[k]) === String(v)); return this; } neq(k, v) { this.filters.push(r => String(r[k]) !== String(v)); return this; }
    in(k, a) { this.filters.push(r => a.map(String).includes(String(r[k]))); return this; } gt(k, v) { this.filters.push(r => r[k] > v); return this; } lt(k, v) { this.filters.push(r => r[k] < v); return this; }
    is(k, v) { this.filters.push(r => v === null ? r[k] == null : r[k] === v); return this; } gte(k, v) { this.filters.push(r => r[k] >= v); return this; } lte(k, v) { this.filters.push(r => r[k] <= v); return this; }
    ilike(k, p) { const re = new RegExp(String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*'), 'i'); this.filters.push(r => re.test(String(r[k] || ''))); return this; }
    or(str) { const groups = [...String(str).matchAll(/and\(([^)]*)\)/g)].map(m => m[1].split(',').map(c => c.split('.'))); if (groups.length) this.filters.push(r => groups.some(g => g.every(([k, op, v]) => String(r[k]) === v))); return this; } order(k, o) { this.ord = [k, !(o && o.ascending === false)]; return this; } limit(n) { this.lim = n; return this; }
    single() { this.isSingle = true; return this; } maybeSingle() { this.isMaybe = true; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    run() {
      const t = this.t, tbl = view(t); log.push([this.op, t]);
      const match = r => this.filters.every(f => f(r));
      if (this.op === 'insert' || this.op === 'upsert') {
        const rows = [].concat(this.payload).map(r => ({ id: r.id || uid(), created_at: now(), ...r })), out = [];
        for (const r of rows) {
          if (t === 'chat_messages') { if (db.chat_messages.some(x => x.client_id && x.client_id === r.client_id)) return { data: null, error: { code: '23505', message: 'duplicate key' } }; if (window.__fake.failSend) return { data: null, error: { message: 'Failed to fetch' } }; }
          if (this.op === 'upsert') { const keys = (this.opts.onConflict || '').split(','); const ex = tbl.find(x => keys.every(k => x[k] === r[k])); if (ex) { Object.assign(ex, r); out.push(ex); emitNow(t, 'UPDATE', ex); continue; } }
          db[t].push(r); out.push(r); emitNow(t, 'INSERT', r);
        }
        return this.shape(out);
      }
      if (this.op === 'update') { const hit = tbl.filter(match); hit.forEach(r => { Object.assign(r, this.payload); emitNow(t, 'UPDATE', r); }); return this.shape(hit); }
      if (this.op === 'delete') { const hit = tbl.filter(match); db[t] = db[t].filter(r => !hit.includes(r)); hit.forEach(r => emitNow(t, 'DELETE', r)); return this.shape(hit); }
      let rows = tbl.filter(match); if (this.ord) rows = [...rows].sort((a, b) => (a[this.ord[0]] > b[this.ord[0]] ? 1 : -1) * (this.ord[1] ? 1 : -1)); if (this.lim) rows = rows.slice(0, this.lim);
      return this.shape(rows.map(r => ({ ...r })));
    }
    shape(rows) { if (this.isSingle || this.isMaybe) { if (!rows.length && this.isSingle) return { data: null, error: { message: 'no rows' } }; return { data: rows[0] || null, error: null }; } return { data: rows, error: null }; }
  }
  const members = c => db.conversation_members.filter(m => m.conversation_id === c);
  const rpc = {
    chat_inbox() {
      return db.conversations.filter(c => members(c.id).some(m => m.user_id === ME)).map(c => {
        const me = members(c.id).find(m => m.user_id === ME); if (me.hidden_at || me.request_status === 'rejected') return null;
        const msgs = db.chat_messages.filter(m => m.conversation_id === c.id).sort((a, b) => a.created_at < b.created_at ? -1 : 1), last = msgs[msgs.length - 1];
        const unread = msgs.filter(m => m.sender_id !== ME && !m.deleted_at && m.created_at > (me.last_read_at > (me.cleared_at || '') ? me.last_read_at : me.cleared_at)).length;
        const other = members(c.id).find(m => m.user_id !== ME);
        return { id: c.id, title: c.title, is_group: c.is_group, last_message_at: last ? last.created_at : c.created_at || ago(999), pinned_at: me.pinned_at, muted_until: me.muted_until, archived_at: me.archived_at, draft: me.draft, draft_updated_at: me.draft_updated_at, last_read_at: me.last_read_at, request_status: me.request_status, cleared_at: me.cleared_at, member_ids: members(c.id).map(m => m.user_id), unread, last_message: last ? { id: last.id, sender_id: last.sender_id, body: last.body, kind: last.kind, attachments: last.attachments, created_at: last.created_at, deleted_at: last.deleted_at, forwarded: last.forwarded } : null, blocked_by_me: !c.is_group && db.user_blocks.some(b => b.blocked_id === (other && other.user_id)) };
      }).filter(Boolean);
    },
    chat_peer_state(a) { return (a.p_users || []).map(u => ({ user_id: u, last_seen_at: ago(7), can_see_online: true, read_receipts: true, typing_ok: true })); },
    chat_get_privacy() { return { show_last_seen: 'everyone', show_online: 'everyone', read_receipts: true, typing_indicator: true, who_can_request: 'everyone', ...(db.chat_privacy[0] || {}) }; },
    chat_set_privacy(a) { db.chat_privacy = [a.p_settings]; return null; },
    chat_mark_read(a) { const m = members(a.p_conversation).find(x => x.user_id === ME); if (m) m.last_read_at = now(); db.chat_messages.filter(x => x.conversation_id === a.p_conversation && x.sender_id !== ME).forEach(x => { const r = db.message_receipts.find(q => q.message_id === x.id && q.user_id === ME); if (!r) db.message_receipts.push({ message_id: x.id, user_id: ME, delivered_at: now(), read_at: now() }); }); return null; },
    chat_mark_delivered() { return 0; }, chat_touch_presence() { return null; }, chat_dispatch_scheduled() { return false; },
    edit_chat_message(a) { const m = db.chat_messages.find(x => x.id === a.p_id); if (m) { m.body = a.p_body; m.edited_at = now(); emitNow('chat_messages', 'UPDATE', m); } return null; },
    delete_chat_message_everyone(a) { const m = db.chat_messages.find(x => x.id === a.p_id); if (m) { m.deleted_at = now(); m.body = ''; m.attachments = []; emitNow('chat_messages', 'UPDATE', m); } return []; },
    forward_chat_messages() { return null; }, block_user(a) { db.user_blocks.push({ blocker_id: ME, blocked_id: a.p_blocked_id }); return null; }, unblock_user(a) { db.user_blocks = db.user_blocks.filter(b => b.blocked_id !== a.p_blocked_id); return null; },
    start_chat(a) { const id = 'c-' + uid().slice(0, 6); db.conversations.push({ id, is_group: (a.p_member_ids || []).length > 1, title: a.p_title }); cm(id, ME); (a.p_member_ids || []).forEach(u => cm(id, u)); return id; },
    chat_request_start(a) { const id = 'c-' + uid().slice(0, 6); db.conversations.push({ id, is_group: false }); cm(id, ME); cm(id, a.p_target, { request_status: 'pending', last_read_at: '1970-01-01T00:00:00Z' }); msg(uid(), id, ME, a.p_body, 0); return id; },
    chat_request_respond(a) { const m = members(a.p_conversation).find(x => x.user_id === ME); if (a.p_action === 'accept') m.request_status = 'accepted'; else { m.hidden_at = now(); m.request_status = a.p_action === 'reject' ? 'rejected' : m.request_status; } return null; },
    chat_search(a) { const q = (a.p_query || '').toLowerCase(); return db.chat_messages.filter(m => (!a.p_conversation || m.conversation_id === a.p_conversation) && (!q || (m.body || '').toLowerCase().includes(q)) && (a.p_kind !== 'media' || m.attachments.some(x => x.kind === 'image' || x.kind === 'video')) && (a.p_kind !== 'docs' || m.attachments.some(x => x.kind === 'document')) && (a.p_kind !== 'links' || /https?:/.test(m.body)) && (a.p_kind !== 'voice' || m.attachments.some(x => x.kind === 'voice'))).sort((x, y) => x.created_at < y.created_at ? 1 : -1).slice(0, a.p_limit || 40); },
    chat_report() { return null; }, chat_open_view_once() { return true; },
    public_profile(a) { const p = db.profiles.find(x => x.id === a.p_uid); return p ? { id: p.id, own: p.id === ME, username: p.username, full_name: p.full_name, sections: {}, stats: { videos: 0, friends: 0, hours: 0 } } : null; }, public_room_for_user() { return null; }
  };
  window.supabase = {
    createClient() {
      const session = { access_token: 'tok', user: { id: ME, email: 'me@example.com' } };
      const mkChannel = name => { const ch = { name, on(type, cfg, cb) { if (type === 'postgres_changes') listeners.push({ table: cfg.table, event: cfg.event, cb }); if (type === 'presence' || type === 'broadcast') { (ch._h = ch._h || []).push([type, cfg, cb]); } return ch; }, subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 5); return ch; }, send(m) { log.push(['broadcast', name, m && m.payload]); return Promise.resolve('ok'); }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, presenceState() { return window.__fake.presence || { 'u-alice': [{ v: 'everyone' }] }; } }; return ch; };
      return {
        auth: { getSession: async () => ({ data: { session }, error: null }), getUser: async () => ({ data: { user: session.user }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
        from: t => new Q(t), rpc: async (name, args = {}) => { window.__fake.rpcCalls.push(name); const f = rpc[name]; if (!f) return { data: null, error: { message: `function ${name} does not exist` } }; try { const data = await f(args); return { data, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
        channel: mkChannel, removeChannel: () => Promise.resolve(),
        storage: { from: () => ({ upload: async (p, b) => { window.__fake.uploads = (window.__fake.uploads || []).concat(p); return { data: { path: p }, error: null }; }, createSignedUrl: async () => ({ data: { signedUrl: png }, error: null }), createSignedUrls: async paths => ({ data: paths.map(p => ({ path: p, signedUrl: png })), error: null }), download: async () => ({ data: new Blob(['x']), error: null }), remove: async () => ({ data: [], error: null }) }) },
        functions: { invoke: async () => ({ data: { results: [] }, error: null }) }
      };
    }
  };
})();
