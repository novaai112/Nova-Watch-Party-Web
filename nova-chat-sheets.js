/* nova-chat-sheets.js — secondary Nova Chat screens: new chat & message requests, contact/group info with shared
   media, QR + profile links, privacy & chat settings, forward, report, message info, reaction details,
   global + in-conversation search, scheduled messages. Requires nova-chat.js (window.NovaChatCore). */
(function () {
  'use strict';
  const Core = window.NovaChatCore; if (!Core) return;
  const { sb, esc } = Nova, ic = Nova.ic, R = window.NovaChatRich, M = window.NovaChatMedia, S = Core.S;
  const $ = (sel, root = document) => root.querySelector(sel), $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const { person, nameOf, friendly, titleFor, peerId } = Core;
  const toastErr = e => Nova.toast(friendly(e), 'err');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const profileLink = username => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}profile.html#u/${encodeURIComponent(username)}`;

  /* ------------------------------------------------------------- full panel */
  function panel(title, { body = '', right = '', className = '' } = {}) {
    const wrap = document.createElement('div'); wrap.className = `nc-panel-wrap ${className}`;
    wrap.innerHTML = `<div class="nc-scrim" data-close></div><section class="nc-panel"><header><button type=button class="nc-icon-btn" data-close aria-label="Close">${ic('left', 22)}</button><h3>${esc(title)}</h3><span class="grow"></span>${right}</header><div class="nc-panel-body">${body}</div></section>`;
    wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) M.closeOverlay(wrap); });
    M.openOverlay(wrap, { label: title });
    return { node: wrap, body: $('.nc-panel-body', wrap), close: () => M.closeOverlay(wrap) };
  }
  Core.ui.panel = panel;
  const userRow = (u, extra = '') => `<div class="nc-urow" data-uid="${esc(u.id)}">${Nova.avatar(u, 44)}<span class="nc-urow-t"><b dir=auto>${esc(u.full_name || u.username)}</b><small>@${esc(u.username || '')}</small></span>${extra}</div>`;
  const empty = (icon, title, text) => `<div class="nc-state">${ic(icon, 28)}<b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}</div>`;

  /* ----------------------------------------------------- friends + user search */
  async function loadFriends() {
    const { data, error } = await sb.from('friendships').select('user_id,friend_id,status').eq('status', 'accepted').or(`user_id.eq.${U.id},friend_id.eq.${U.id}`);
    if (error) throw error;
    const ids = (data || []).map(r => r.user_id === U.id ? r.friend_id : r.user_id); await Core.loadProfiles(ids); return ids.map(person);
  }
  async function searchUsers(q) {
    q = q.trim().replace(/^@/, ''); if (q.length < 2) return [];
    const term = Core.likeTerm(q.replace(/[^\p{L}\p{N}_. -]/gu, '')).slice(0, 60);
    const [a, b] = await Promise.all([sb.from('public_profiles').select('id,full_name,username,avatar_url').ilike('username', `%${term}%`).neq('id', U.id).limit(10), sb.from('public_profiles').select('id,full_name,username,avatar_url').ilike('full_name', `%${term}%`).neq('id', U.id).limit(10)]);
    const map = new Map(); [...(a.data || []), ...(b.data || [])].forEach(p => map.set(p.id, p)); const out = [...map.values()]; out.forEach(p => { S.profiles[p.id] = S.profiles[p.id] || p; return p; }); return out;
  }

  /* --------------------------------------------------------------- new chat */
  Core.newChat = async function () {
    const p = panel('New chat', { body: `<label class="nc-search"><span>${ic('search', 16)}</span><input type=search id=ncNewQ placeholder="Search friends or find a username" autocomplete=off aria-label="Search"></label>
      <div class="nc-quick"><button type=button class="nc-urow action" data-new-group><span class="nc-circle">${ic('users', 20)}</span><b>New group</b></button><button type=button class="nc-urow action" data-new-scan><span class="nc-circle">${M.ic('qr', 20)}</span><b>Scan QR code</b></button></div>
      <div id=ncNewList class="nc-ulist"><p class="nc-loading">Loading friends…</p></div>` });
    const list = $('#ncNewList', p.node); let friends = [], friendIds = new Set();
    const draw = async () => {
      const q = $('#ncNewQ', p.node).value; let others = [];
      const f = friends.filter(u => !q || `${u.username} ${u.full_name}`.toLowerCase().includes(q.toLowerCase().replace(/^@/, '')));
      if (q.trim().length >= 2) { try { others = (await searchUsers(q)).filter(u => !friendIds.has(u.id)); } catch (_) {} }
      list.innerHTML = `${f.length ? `<h4>Friends</h4>${f.map(u => userRow(u)).join('')}` : ''}${others.length ? `<h4>Other people</h4>${others.map(u => userRow(u, '<small class="nc-tag">Message request</small>')).join('')}` : ''}${!f.length && !others.length ? empty('users', q ? 'No one found' : 'No friends yet', q ? 'Check the username and try again.' : 'Search for a username to start a conversation.') : ''}`;
    };
    try { friends = await loadFriends(); friendIds = new Set(friends.map(u => u.id)); } catch (e) { list.innerHTML = empty('alert', 'Could not load friends', friendly(e)); return; }
    draw(); $('#ncNewQ', p.node).addEventListener('input', debounce(draw, 250));
    p.node.addEventListener('click', e => {
      const u = e.target.closest('.nc-urow[data-uid]'); if (u) { p.close(); setTimeout(() => Core.messageUser(u.dataset.uid), 150); }
      if (e.target.closest('[data-new-group]')) { p.close(); setTimeout(() => newGroup(friends), 150); }
      if (e.target.closest('[data-new-scan]')) { p.close(); setTimeout(() => Core.openQr('scan'), 150); }
    });
  };
  function newGroup(friends) {
    const chosen = new Set();
    const p = panel('New group', { body: `<input id=ncGroupTitle class="nc-field" maxlength=60 placeholder="Group name (optional)" aria-label="Group name"><div class="nc-chosen" id=ncChosen></div><div class="nc-ulist">${friends.map(u => userRow(u, `<span class="nc-check" data-pick="${esc(u.id)}"></span>`)).join('') || empty('users', 'No friends yet')}</div><div class="nc-panel-foot"><button type=button class="nc-btn pri block" id=ncCreateGroup disabled>Create group</button></div>` });
    p.node.addEventListener('click', async e => {
      const row = e.target.closest('.nc-urow[data-uid]');
      if (row) { const id = row.dataset.uid; chosen.has(id) ? chosen.delete(id) : chosen.add(id); $('.nc-check', row).classList.toggle('on', chosen.has(id)); $('.nc-check', row).innerHTML = chosen.has(id) ? ic('check', 14) : ''; $('#ncCreateGroup', p.node).disabled = chosen.size < 2; $('#ncCreateGroup', p.node).textContent = chosen.size < 2 ? 'Pick at least 2 friends' : `Create group (${chosen.size})`; }
      if (e.target.closest('#ncCreateGroup')) {
        const btn = e.target.closest('#ncCreateGroup'); btn.disabled = true;
        const { data, error } = await sb.rpc('start_chat', { p_member_ids: [...chosen], p_title: $('#ncGroupTitle', p.node).value.trim() || null });
        if (error) { btn.disabled = false; return toastErr(error); }
        p.close(); await Core.loadInbox(true); Core.go(`#chat/${data}`);
      }
    });
  }
  Core.messageRequest = async function (userId) {
    await Core.loadProfiles([userId]); const u = person(userId);
    const box = document.createElement('div'); box.innerHTML = `<div class="nc-reqcompose">${Nova.avatar(u, 56)}<b>${esc(u.full_name || u.username)}</b><small>@${esc(u.username || '')}</small><p>You aren't friends yet. Your first message is sent as a request. They choose whether to accept before you can chat further.</p><textarea id=ncReqText rows=3 maxlength=1000 placeholder="Write a short message…" aria-label="First message"></textarea><button type=button class="nc-btn pri block" id=ncReqSend>Send request</button></div>`;
    const sh = Core.ui.sheet({ node: box, cancel: false, className: 'req' });
    $('#ncReqSend', box).onclick = async () => {
      const btn = $('#ncReqSend', box), text = $('#ncReqText', box).value.trim(); if (!text) return Nova.toast('Write a short message first.', 'err');
      btn.disabled = true; const { data, error } = await sb.rpc('chat_request_start', { p_target: userId, p_body: text });
      if (error) { btn.disabled = false; return toastErr(error); }
      sh.close(); await Core.loadInbox(true); Nova.toast('Request sent'); Core.go(`#chat/${data}`);
    };
    setTimeout(() => { const t = $('#ncReqText', box); t && t.focus(); }, 200);
  };

  /* -------------------------------------------------------- contact / group info */
  async function sharedList(box, conv, kind) {
    box.innerHTML = '<p class="nc-loading">Loading…</p>';
    const { data, error } = await sb.rpc('chat_search', { p_query: null, p_conversation: conv.id, p_kind: kind, p_limit: 60 });
    if (error) { box.innerHTML = empty('alert', 'Could not load', friendly(error)); return; }
    let rows = data || []; if (conv.cleared_at) rows = rows.filter(r => r.created_at > conv.cleared_at);
    if (!rows.length) { box.innerHTML = empty({ media: 'image', docs: 'file', links: 'link', voice: 'mic' }[kind] || 'file', `No ${kind} yet`); return; }
    if (kind === 'media') {
      const items = []; rows.forEach(m => (m.attachments || []).forEach((a, i) => { const k = R.attKind(a); if ((k === 'image' || k === 'video') && !a.viewOnce) items.push({ ...a, kind: k, sender: { name: nameOf(m.sender_id) }, at: m.created_at, mid: m.id }); }));
      box.innerHTML = `<div class="nc-media-grid">${items.map((a, i) => `<button type=button data-mi="${i}" aria-label="Open ${a.kind}"><span class="nc-slot" data-att="${esc(JSON.stringify({ path: a.path, type: a.type, thumb: a.thumb, name: a.name }))}"></span>${a.thumb ? `<img src="${esc(a.thumb)}" alt="">` : ''}${a.kind === 'video' ? `<i>${ic('play', 12)}</i>` : ''}</button>`).join('')}</div>`;
      box.onclick = e => { const b = e.target.closest('[data-mi]'); if (b) M.openViewer(items, Number(b.dataset.mi)); };
    } else if (kind === 'links') {
      const links = []; rows.forEach(m => R.extractLinks(m.body || '').forEach(l => links.push({ url: l.url || l, at: m.created_at, id: m.id })));
      box.innerHTML = links.map(l => `<a class="nc-linkrow" href="${esc(R.safeHref(l.url) || '#')}" target=_blank rel="noopener noreferrer nofollow">${ic('link', 16)}<span><b>${esc(l.url.replace(/^https?:\/\//, '').slice(0, 60))}</b><small>${R.dayLabel(l.at)}</small></span></a>`).join('') || empty('link', 'No links yet');
    } else {
      box.innerHTML = rows.map(m => (m.attachments || []).filter(a => kind === 'voice' ? a.kind === 'voice' : true).map(a => `<div class="nc-docrow">${M.renderAttachments([a], { mine: m.sender_id === U.id, sender: m.sender_id })}<small>${esc(nameOf(m.sender_id))} · ${R.dayLabel(m.created_at)}</small></div>`).join('')).join('');
      M.hydrate(box);
    }
  }
  Core.openInfo = async function (conv, tab) {
    if (!conv) return; const group = conv.is_group, uid = peerId(conv), u = person(uid);
    await Core.loadProfiles(conv.member_ids || []);
    const header = group ? `<div class="nc-info-head"><span class="nc-gav big">${ic('users', 40)}</span><h2 dir=auto>${esc(titleFor(conv))}</h2><p>${(conv.member_ids || []).length} members</p></div>`
      : `<div class="nc-info-head"><button type=button class="nc-info-av" data-view-avatar aria-label="View profile photo">${Nova.avatar(u, 96)}</button><h2 dir=auto>${esc(u.full_name || u.username)}</h2><p>@${esc(u.username || '')}</p>${(Core.S.peer.get(uid) || {}).last_seen_at && !conv.blocked_by_me ? `<small>${Core.isOnline(uid) ? 'online' : esc(R.lastSeenLabel(S.peer.get(uid).last_seen_at))}</small>` : ''}${u.bio ? `<p class="nc-bio" dir=auto>${esc(u.bio)}</p>` : ''}</div>`;
    const members = group ? `<h4>Members</h4>${(conv.member_ids || []).map(id => userRow(person(id), id === U.id ? '<small class="nc-tag">You</small>' : '')).join('')}` : '';
    const muted = Core.mutedNow(conv);
    const p = panel(group ? 'Group info' : 'Contact info', { className: 'info', body: `${header}
      <div class="nc-info-actions">${!group ? `<button type=button data-i-profile>${ic('user', 20)}<span>Profile</span></button><button type=button data-i-share>${M.ic('share', 20)}<span>Share</span></button>` : ''}<button type=button data-i-mute>${M.ic('belloff', 20)}<span>${muted ? 'Unmute' : 'Mute'}</span></button><button type=button data-i-search>${ic('search', 20)}<span>Search</span></button></div>
      ${members}
      <nav class="nc-subtabs" role=tablist>${['media', 'docs', 'links', 'voice'].map(k => `<button type=button role=tab data-k="${k}" class="${(tab || 'media') === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</nav><div id=ncShared class="nc-shared"></div>
      ${!group ? `<div class="nc-danger-zone"><button type=button data-i-block class="${conv.blocked_by_me ? '' : 'danger'}">${M.ic('ban', 18)} ${conv.blocked_by_me ? 'Unblock' : 'Block'} ${esc(u.full_name || u.username)}</button><button type=button data-i-report class="danger">${M.ic('flag', 18)} Report</button></div>` : ''}` });
    const load = k => { $$('.nc-subtabs button', p.node).forEach(b => b.classList.toggle('on', b.dataset.k === k)); sharedList($('#ncShared', p.node), conv, k); };
    load(tab || 'media');
    p.node.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('.nc-subtabs [data-k]')) return load(t.closest('[data-k]').dataset.k);
      if (t.closest('[data-view-avatar]')) return M.openAvatar(u);
      if (t.closest('[data-i-profile]')) { p.close(); return setTimeout(() => { Core.go(`#user/${uid}`); }, 150); }
      if (t.closest('[data-i-share]')) return Core.shareProfile(uid);
      if (t.closest('[data-i-mute]')) { p.close(); return Core.memberUpdate(conv.id, { muted_until: muted ? null : 'infinity' }); }
      if (t.closest('[data-i-search]')) { p.close(); return setTimeout(() => Core.convSearch(), 150); }
      if (t.closest('[data-i-block]')) { p.close(); return Core.blockToggle(conv); }
      if (t.closest('[data-i-report]')) { p.close(); return setTimeout(() => Core.report({ userId: uid, conversationId: conv.id }), 150); }
      const row = t.closest('.nc-urow[data-uid]'); if (row && row.dataset.uid !== U.id) { p.close(); setTimeout(() => Core.openProfile(row.dataset.uid), 150); }
    });
  };
  Core.openProfile = async function (id) {
    if (id === U.id) { Core.go('#info'); return; }
    await Core.loadProfiles([id]); const u = person(id);
    const box = document.createElement('div'); box.innerHTML = `<div class="nc-reqcompose">${Nova.avatar(u, 72)}<b>${esc(u.full_name || u.username)}</b><small>@${esc(u.username || '')}</small>${u.bio ? `<p dir=auto>${esc(u.bio)}</p>` : ''}</div>`;
    Core.ui.sheet({ node: box, actions: [{ label: 'Message', icon: 'chat', run: () => Core.messageUser(id) }, { label: 'View profile', icon: 'user', run: () => { Core.go(`#user/${id}`); } }, { label: 'View photo', icon: 'image', run: () => M.openAvatar(u) }] });
  };
  Core.shareProfile = async function (id) {
    const u = person(id), url = profileLink(u.username), text = `${u.full_name || u.username} on Nova Watch Party`;
    if (navigator.share) { try { await navigator.share({ title: text, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    await Core.copyText(url); Nova.toast('Profile link copied');
  };
  Core.shareContact = async function () {
    let friends; try { friends = await loadFriends(); } catch (e) { return toastErr(e); }
    const p = panel('Share contact', { body: `<div class="nc-ulist">${friends.map(u => userRow(u)).join('') || empty('users', 'No friends to share yet')}</div>` });
    p.node.addEventListener('click', e => { const r = e.target.closest('.nc-urow[data-uid]'); if (!r) return; const u = person(r.dataset.uid); p.close(); Core.enqueue({ conversation_id: S.active, body: '', mentions: [], kind: 'contact', remote: [{ kind: 'contact', name: u.full_name || u.username, contact: { id: u.id, username: u.username, full_name: u.full_name, avatar_url: u.avatar_url } }] }); });
  };

  /* ------------------------------------------------------------- QR + scan */
  async function qrSvg(text) {
    await M.loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js');
    const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make(); return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  function parseProfileTarget(text) {
    const t = String(text || '').trim(); const m = /#u\/([^/?#\s]+)/i.exec(t) || /^@?([A-Za-z0-9_.-]{3,32})$/.exec(t); return m ? decodeURIComponent(m[1]).replace(/^@/, '') : '';
  }
  async function openUsername(username) {
    const { data, error } = await sb.from('public_profiles').select('id,full_name,username,avatar_url,bio').eq('username', username).maybeSingle();
    if (error || !data) return Nova.toast('No Nova user found for that code.', 'err');
    S.profiles[data.id] = data; if (data.id === U.id) return Nova.toast('That is your own code.'); Core.openProfile(data.id);
  }
  Core.openUsername = openUsername;
  Core.openQr = function (mode = 'mine') {
    const me = S.profiles[U.id] || { id: U.id, username: (window.P && P.username) || '', full_name: (window.P && P.full_name) || '', avatar_url: window.P && P.avatar_url };
    const p = panel('QR code', { className: 'qr', body: `<nav class="nc-subtabs"><button type=button data-qt=mine class="${mode === 'mine' ? 'on' : ''}">My code</button><button type=button data-qt=scan class="${mode === 'scan' ? 'on' : ''}">Scan code</button></nav><div id=ncQrBody class="nc-qr-body"></div>` });
    let stream = null, scanning = false;
    const stop = () => { scanning = false; if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } };
    const show = async which => {
      stop(); $$('[data-qt]', p.node).forEach(b => b.classList.toggle('on', b.dataset.qt === which)); const box = $('#ncQrBody', p.node);
      if (which === 'mine') {
        const url = profileLink(me.username); box.innerHTML = `<div class="nc-qr-card">${Nova.avatar(me, 56)}<b>${esc(me.full_name || me.username)}</b><small>@${esc(me.username)}</small><div class="nc-qr" id=ncQrImg><i class="nc-spin"></i></div><p>Scan this code with Nova to open your profile.</p><div class="nc-row-btns"><button type=button class="nc-btn" data-q-copy>${M.ic('copy', 15)} Copy link</button><button type=button class="nc-btn pri" data-q-share>${M.ic('share', 15)} Share</button></div></div>`;
        try { $('#ncQrImg', box).innerHTML = await qrSvg(url); $('#ncQrImg svg', box).setAttribute('aria-label', 'QR code for your profile'); } catch (e) { $('#ncQrImg', box).innerHTML = `<p class="mu">Could not generate the code. ${esc(friendly(e))}</p>`; }
        box.onclick = e => { if (e.target.closest('[data-q-copy]')) { Core.copyText(url); Nova.toast('Link copied'); } if (e.target.closest('[data-q-share]')) Core.shareProfile(U.id); };
      } else {
        box.innerHTML = `<div class="nc-scan"><video id=ncScanVideo playsinline muted></video><div class="nc-scan-frame"></div><p id=ncScanMsg>Point your camera at a Nova QR code.</p></div><form class="nc-scan-manual" id=ncScanForm><input id=ncScanText placeholder="…or paste a profile link or @username" aria-label="Profile link or username"><button class="nc-btn pri" type=submit>Open</button></form>`;
        $('#ncScanForm', box).onsubmit = ev => { ev.preventDefault(); const u = parseProfileTarget($('#ncScanText', box).value); if (!u) return Nova.toast('Enter a valid link or username.', 'err'); p.close(); openUsername(u); };
        if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { $('#ncScanMsg', box).textContent = 'Camera scanning is not supported in this browser. Paste a link or username instead.'; return; }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); const v = $('#ncScanVideo', box); v.srcObject = stream; await v.play();
          const det = new BarcodeDetector({ formats: ['qr_code'] }); scanning = true;
          const tick = async () => { if (!scanning) return; try { const codes = await det.detect(v); const hit = codes.map(c => parseProfileTarget(c.rawValue)).find(Boolean); if (hit) { stop(); p.close(); return openUsername(hit); } } catch (_) {} setTimeout(tick, 250); };
          tick();
        } catch (e) { $('#ncScanMsg', box).textContent = /denied|NotAllowed/i.test(e.name + e.message) ? 'Camera permission is blocked. Paste a link or username instead.' : 'Camera unavailable. Paste a link or username instead.'; }
      }
    };
    p.node.addEventListener('click', e => { const b = e.target.closest('[data-qt]'); if (b) show(b.dataset.qt); });
    new MutationObserver((_, o) => { if (!document.body.contains(p.node)) { stop(); o.disconnect(); } }).observe(document.body, { childList: true });
    show(mode);
  };

  /* ------------------------------------------------------------- settings */
  Core.openSettings = async function () {
    await Core.loadPrivacy(); const pr = S.privacy, pf = M.prefs(), quick = Core.quickReactions();
    const sel = (id, val, opts) => `<select id="${id}" aria-label="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const sw = (id, on, label, hint = '') => `<label class="nc-set"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><input type=checkbox class="nc-sw" id="${id}" ${on ? 'checked' : ''}></label>`;
    const who = [['everyone', 'Everyone'], ['friends', 'Friends'], ['nobody', 'Nobody']], dl = [['always', 'Always'], ['wifi', 'Wi-Fi only'], ['never', 'Never']];
    const p = panel('Chat settings', { className: 'settings', body: `
      <h4>Privacy</h4>
      <label class="nc-set"><span><b>Last seen</b><small>Who can see when you were last online</small></span>${sel('sLast', pr.show_last_seen, who)}</label>
      <label class="nc-set"><span><b>Online status</b><small>Who can see that you are online</small></span>${sel('sOnline', pr.show_online, who)}</label>
      ${sw('sReceipts', pr.read_receipts, 'Read receipts', 'If off, you will not see others’ read receipts either')}
      ${sw('sTyping', pr.typing_indicator, 'Typing indicators', 'Show and see typing, recording and uploading')}
      <label class="nc-set"><span><b>Message requests</b><small>Who can message you without being friends</small></span>${sel('sReq', pr.who_can_request, [['everyone', 'Everyone'], ['nobody', 'Nobody']])}</label>
      <h4>Quick reactions</h4><div class="nc-quick-edit" id=ncQuickEdit>${quick.map((e, i) => `<button type=button data-qe="${i}" aria-label="Change reaction ${i + 1}">${esc(e)}</button>`).join('')}</div><button type=button class="nc-link-btn" data-qe-reset>Reset to default</button>
      <h4>Media auto-download</h4>
      <label class="nc-set"><span><b>Photos</b></span>${sel('dImg', pf.dlImage, dl)}</label><label class="nc-set"><span><b>Videos</b></span>${sel('dVid', pf.dlVideo, dl)}</label><label class="nc-set"><span><b>Audio</b></span>${sel('dAud', pf.dlAudio, dl)}</label><label class="nc-set"><span><b>Documents</b></span>${sel('dFile', pf.dlFile, dl)}</label>
      <h4>Chats</h4>
      ${sw('sEnter', pf.enterSends !== false, 'Enter sends message', 'On desktop; use Shift+Enter for a new line')}
      ${sw('sTrans', !!pf.transcribe, 'Voice message transcripts', 'Uses your browser’s speech recognition where supported')}
      ${'Notification' in window ? `<div class="nc-set"><span><b>Notifications</b><small>${Notification.permission === 'granted' ? 'Enabled in this browser' : Notification.permission === 'denied' ? 'Blocked in browser settings' : 'Alerts while the page is open or in the background'}</small></span>${Notification.permission === 'default' ? '<button type=button class="nc-btn sm pri" data-enable-notif>Enable</button>' : ''}</div>` : ''}
      <h4>Blocked</h4><button type=button class="nc-set btn" data-go-blocked><span><b>Blocked contacts</b><small>Manage people you have blocked</small></span>${ic('right', 16)}</button>` });
    const savePrivacy = debounce(async () => {
      const settings = { show_last_seen: $('#sLast', p.node).value, show_online: $('#sOnline', p.node).value, read_receipts: $('#sReceipts', p.node).checked, typing_indicator: $('#sTyping', p.node).checked, who_can_request: $('#sReq', p.node).value };
      const { error } = await sb.rpc('chat_set_privacy', { p_settings: settings }); if (error) return toastErr(error);
      Object.assign(S.privacy, settings); Core.trackPresence(); Nova.toast('Saved');
    }, 400);
    p.node.addEventListener('change', e => {
      const id = e.target.id;
      if (['sLast', 'sOnline', 'sReceipts', 'sTyping', 'sReq'].includes(id)) savePrivacy();
      const map = { dImg: 'dlImage', dVid: 'dlVideo', dAud: 'dlAudio', dFile: 'dlFile' }; if (map[id]) M.setPref(map[id], e.target.value);
      if (id === 'sEnter') M.setPref('enterSends', e.target.checked); if (id === 'sTrans') M.setPref('transcribe', e.target.checked);
    });
    p.node.addEventListener('click', async e => {
      const q = e.target.closest('[data-qe]');
      if (q) { const i = Number(q.dataset.qe); Core.emojiPicker(emoji => { const list = Core.quickReactions(); list[i] = emoji; try { localStorage.setItem(`nova_chat_quick_${U.id}`, JSON.stringify(list)); } catch (_) {} q.textContent = emoji; }); }
      if (e.target.closest('[data-qe-reset]')) { try { localStorage.removeItem(`nova_chat_quick_${U.id}`); } catch (_) {} $$('[data-qe]', p.node).forEach((b, i) => { b.textContent = R.DEFAULT_QUICK[i]; }); }
      if (e.target.closest('[data-enable-notif]')) { try { await Notification.requestPermission(); } catch (_) {} p.close(); Core.openSettings(); }
      if (e.target.closest('[data-go-blocked]')) { p.close(); Core.go('#friends'); setTimeout(() => { const b = $('[data-people-tab="blocked"]'); b && b.click(); }, 900); }
    });
  };

  /* -------------------------------------------------------------- forward */
  Core.forward = function (ids) {
    ids = ids.filter(id => { const m = Core.msgById(id); return m && !m.deleted_at && !m._local; }); if (!ids.length) return Nova.toast('Nothing to forward.', 'err');
    const chosen = new Set(); const convs = S.inbox.filter(c => c.request_status !== 'pending' && !c.blocked_by_me);
    const p = panel(`Forward ${ids.length > 1 ? `${ids.length} messages` : 'message'}`, { className: 'forward', body: `<label class="nc-search"><span>${ic('search', 16)}</span><input type=search id=ncFwdQ placeholder="Search chats" aria-label="Search chats"></label><div id=ncFwdList class="nc-ulist"></div><div class="nc-panel-foot"><button type=button class="nc-btn pri block" id=ncFwdSend disabled>Select chats</button></div>` });
    const list = $('#ncFwdList', p.node);
    const draw = () => { const q = $('#ncFwdQ', p.node).value.toLowerCase(); list.innerHTML = convs.filter(c => !q || titleFor(c).toLowerCase().includes(q)).map(c => `<div class="nc-urow" data-cid="${esc(c.id)}">${Core.faceFor(c, 44)}<span class="nc-urow-t"><b dir=auto>${esc(titleFor(c))}</b><small>${c.is_group ? 'Group' : '@' + esc(person(peerId(c)).username || '')}</small></span><span class="nc-check ${chosen.has(c.id) ? 'on' : ''}">${chosen.has(c.id) ? ic('check', 14) : ''}</span></div>`).join('') || empty('chat', 'No chats found'); };
    draw(); $('#ncFwdQ', p.node).addEventListener('input', draw);
    p.node.addEventListener('click', async e => {
      const row = e.target.closest('[data-cid]');
      if (row) { const id = row.dataset.cid; chosen.has(id) ? chosen.delete(id) : (chosen.size < 5 ? chosen.add(id) : Nova.toast('You can forward to 5 chats at a time.')); draw(); const b = $('#ncFwdSend', p.node); b.disabled = !chosen.size; b.textContent = chosen.size ? `Send to ${chosen.size} chat${chosen.size > 1 ? 's' : ''}` : 'Select chats'; }
      if (e.target.closest('#ncFwdSend')) { const b = e.target.closest('#ncFwdSend'); b.disabled = true; const { error } = await sb.rpc('forward_chat_messages', { p_message_ids: ids, p_conversation_ids: [...chosen] }); if (error) { b.disabled = false; return toastErr(error); } p.close(); S.selection = null; Core.renderMessages({}); Nova.toast(`Forwarded to ${chosen.size} chat${chosen.size > 1 ? 's' : ''}`); Core.loadInbox(true); }
    });
  };

  /* --------------------------------------------------------------- report */
  Core.report = function ({ userId, conversationId, messageId, offerBlock = true }) {
    const reasons = [['spam', 'Spam'], ['harassment', 'Harassment or bullying'], ['inappropriate', 'Inappropriate content'], ['impersonation', 'Pretending to be someone else'], ['scam', 'Scam or fraud'], ['other', 'Something else']];
    const box = document.createElement('div'); box.className = 'nc-report'; box.innerHTML = `<p class="mu">Reports are reviewed by moderators. The person is not told that you reported them.</p>${reasons.map(([v, l], i) => `<label class="nc-radio"><input type=radio name=rr value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}<textarea id=ncRepD rows=2 maxlength=1000 placeholder="Add details (optional)" aria-label="Details"></textarea>${offerBlock ? `<label class="nc-radio"><input type=checkbox id=ncRepB><span>Also block this person</span></label>` : ''}<button type=button class="nc-btn pri block danger" id=ncRepGo>Submit report</button>`;
    const sh = Core.ui.sheet({ title: 'Report', node: box, cancel: false, className: 'report' });
    $('#ncRepGo', box).onclick = async () => {
      const btn = $('#ncRepGo', box); btn.disabled = true;
      const { error } = await sb.rpc('chat_report', { p_user: userId, p_conversation: conversationId || null, p_message: messageId || null, p_reason: $('input[name=rr]:checked', box).value, p_details: $('#ncRepD', box).value.trim() || null, p_block: !!($('#ncRepB', box) && $('#ncRepB', box).checked) });
      if (error) { btn.disabled = false; return toastErr(error); }
      sh.close(); Nova.toast('Thanks — report submitted'); Core.loadInbox(true);
    };
  };
  Core.reportMessage = id => { const m = Core.msgById(id); if (m) Core.report({ userId: m.sender_id, conversationId: m.conversation_id, messageId: m.id }); };

  /* ---------------------------------------------------- message info / reactions */
  Core.messageInfo = function (id) {
    const m = Core.msgById(id); if (!m) return; const rec = S.receipts.get(id) || new Map(), others = (S.conv.member_ids || []).filter(x => x !== U.id);
    const fmt = v => v ? `${R.dayLabel(v)}, ${R.fmtTime(v)}` : '—';
    const rows = others.map(uid => { const r = rec.get(uid) || {}; return `<div class="nc-info-r">${Nova.avatar(person(uid), 32)}<b>${esc(nameOf(uid))}</b><dl><dt>Read</dt><dd>${esc(S.privacy.read_receipts ? fmt(r.read_at) : 'Hidden (your read receipts are off)')}</dd><dt>Delivered</dt><dd>${esc(fmt(r.delivered_at))}</dd></dl></div>`; }).join('');
    Core.ui.sheet({ title: 'Message info', body: `<div class="nc-info-sent"><small>Sent</small><b>${esc(fmt(m.created_at))}</b>${m.edited_at ? `<small>Edited ${esc(fmt(m.edited_at))}</small>` : ''}</div>${rows}`, actions: [] });
  };
  Core.reactionDetails = function (id) {
    const map = S.reactions.get(id); if (!map || !map.size) return;
    const rows = [...map].map(([uid, e]) => `<button type=button class="nc-urow" data-ru="${esc(uid)}" data-e="${esc(e)}">${Nova.avatar(person(uid), 40)}<span class="nc-urow-t"><b>${esc(nameOf(uid))}</b><small>${uid === U.id ? 'Tap to remove' : ''}</small></span><span class="nc-big-e">${esc(e)}</span></button>`).join('');
    const sh = Core.ui.sheet({ title: 'Reactions', body: `<div class="nc-ulist">${rows}</div>`, actions: [] });
    sh.node.addEventListener('click', e => { const r = e.target.closest('[data-ru]'); if (r && r.dataset.ru === U.id) { sh.close(); Core.toggleReaction(id, r.dataset.e); } });
  };

  /* --------------------------------------------------------------- search */
  const snippet = (text, q) => { const t = R.plain(text || ''), i = t.toLowerCase().indexOf(String(q || '').toLowerCase().replace(/^#/, '')); const start = Math.max(0, i - 30); return (start ? '…' : '') + t.slice(start, start + 110); };
  const hl = (text, q) => { const s = esc(text); const k = esc(String(q || '').replace(/^#/, '')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return k ? s.replace(new RegExp(`(${k})`, 'ig'), '<mark>$1</mark>') : s; };
  Core.globalSearch = async function (q, box) {
    if (!box) return; box.innerHTML = '<p class="nc-loading">Searching…</p>';
    const [msgs, people] = await Promise.all([sb.rpc('chat_search', { p_query: q, p_limit: 25 }), searchUsers(q).catch(() => [])]);
    if (S.query.trim() !== q) return;
    if (msgs.error) { box.innerHTML = empty('alert', 'Search failed', friendly(msgs.error)); return; }
    const rows = msgs.data || []; await Core.loadProfiles(rows.map(r => r.sender_id));
    const known = new Set(S.inbox.map(c => peerId(c)).filter(Boolean)), ppl = (people || []).filter(u => !known.has(u.id)).slice(0, 5);
    box.innerHTML = `${ppl.length ? `<h4>People</h4>${ppl.map(u => userRow(u)).join('')}` : ''}${rows.length ? `<h4>Messages</h4>${rows.map(r => { const c = Core.convById(r.conversation_id); return `<button type=button class="nc-urow msg" data-sr="${esc(r.id)}" data-sc="${esc(r.conversation_id)}"><span class="nc-urow-t"><b dir=auto>${esc(c ? titleFor(c) : 'Chat')}</b><small dir=auto>${hl(`${r.sender_id === U.id ? 'You: ' : ''}${snippet(r.body || R.previewText(r), q)}`, q)}</small></span><time>${R.listTime(r.created_at)}</time></button>`; }).join('')}` : ''}${!ppl.length && !rows.length ? empty('search', 'No results', `Nothing found for “${q}”.`) : ''}`;
    box.onclick = e => { const m = e.target.closest('[data-sr]'), u = e.target.closest('[data-uid]'); if (m) { S.jumpTo = m.dataset.sr; if (S.active === m.dataset.sc) Core.jumpTo(S.jumpTo); else Core.go(`#chat/${m.dataset.sc}`); } if (u) Core.messageUser(u.dataset.uid); };
  };
  Core.convSearch = function (initial = '') {
    const conv = S.conv; if (!conv) return;
    let kind = 'any', from = '', to = '';
    const p = panel('Search in chat', { className: 'convsearch', body: `<div class="nc-search"><span>${ic('search', 16)}</span><input type=search id=ncCsQ value="${esc(initial)}" placeholder="Search messages, links, #tags" aria-label="Search in chat" data-autofocus></div>
      <div class="nc-chips">${[['any', 'All'], ['media', 'Photos & videos'], ['docs', 'Documents'], ['links', 'Links'], ['voice', 'Voice'], ['audio', 'Audio']].map(([k, l]) => `<button type=button data-ck="${k}" class="${k === 'any' ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="nc-daterow"><label>From <input type=date id=ncCsFrom></label><label>To <input type=date id=ncCsTo></label></div><div id=ncCsRes class="nc-ulist"></div>` });
    const res = $('#ncCsRes', p.node); let seq = 0;
    const run = async () => {
      const q = $('#ncCsQ', p.node).value.trim(), my = ++seq; if (!q && kind === 'any' && !from && !to) { res.innerHTML = empty('search', 'Search this conversation', 'Find messages, photos, documents, links and voice messages.'); return; }
      res.innerHTML = '<p class="nc-loading">Searching…</p>';
      const { data, error } = await sb.rpc('chat_search', { p_query: q || null, p_conversation: conv.id, p_kind: kind, p_from: from ? new Date(`${from}T00:00:00`).toISOString() : null, p_to: to ? new Date(`${to}T23:59:59`).toISOString() : null, p_limit: 50 });
      if (my !== seq) return; if (error) { res.innerHTML = empty('alert', 'Search failed', friendly(error)); return; }
      let rows = data || []; if (conv.cleared_at) rows = rows.filter(r => r.created_at > conv.cleared_at); await Core.loadProfiles(rows.map(r => r.sender_id));
      res.innerHTML = rows.length ? rows.map(r => `<button type=button class="nc-urow msg" data-sr="${esc(r.id)}"><span class="nc-urow-t"><b>${esc(nameOf(r.sender_id))}</b><small dir=auto>${hl(snippet(r.body || R.previewText(r), q), q)}</small></span><time>${R.listTime(r.created_at)}</time></button>`).join('') : empty('search', 'No results');
    };
    const go = debounce(run, 300); run();
    p.node.addEventListener('input', e => { if (e.target.id === 'ncCsQ') go(); if (e.target.id === 'ncCsFrom') { from = e.target.value; go(); } if (e.target.id === 'ncCsTo') { to = e.target.value; go(); } });
    p.node.addEventListener('click', e => {
      const k = e.target.closest('[data-ck]'); if (k) { kind = k.dataset.ck; $$('[data-ck]', p.node).forEach(b => b.classList.toggle('on', b === k)); run(); }
      const r = e.target.closest('[data-sr]'); if (r) { const id = r.dataset.sr; p.close(); setTimeout(() => Core.jumpTo(id), 250); }
    });
  };

  /* ------------------------------------------------------------ scheduling */
  const localInput = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  Core.scheduleDialog = function () {
    const input = $('#ncInput'), text = input ? input.value.trim() : ''; if (!S.active) return;
    if (!text) return Nova.toast('Type a message first, then choose Schedule.', 'err');
    const soon = new Date(Date.now() + 3600000); soon.setSeconds(0, 0); const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
    const box = document.createElement('div'); box.className = 'nc-schedule'; box.innerHTML = `<blockquote dir=auto>${esc(text.slice(0, 160))}</blockquote><label>Send at <input type="datetime-local" id=ncSchedAt min="${localInput(new Date(Date.now() + 60000))}" value="${localInput(soon)}"></label><div class="nc-row-btns"><button type=button class="nc-btn sm" data-sq="${soon.getTime()}">In 1 hour</button><button type=button class="nc-btn sm" data-sq="${tomorrow.getTime()}">Tomorrow 9:00</button></div><p class="mu">Scheduled messages are sent while Nova is open, or by the server if your admin enabled the scheduler.</p><button type=button class="nc-btn pri block" id=ncSchedGo>Schedule</button>`;
    const sh = Core.ui.sheet({ title: 'Schedule message', node: box, cancel: false, className: 'schedule' });
    box.addEventListener('click', async e => {
      const q = e.target.closest('[data-sq]'); if (q) $('#ncSchedAt', box).value = localInput(new Date(Number(q.dataset.sq)));
      if (e.target.closest('#ncSchedGo')) {
        const at = new Date($('#ncSchedAt', box).value); if (isNaN(at) || at.getTime() < Date.now() + 30000) return Nova.toast('Choose a time at least a minute from now.', 'err');
        const { error } = await sb.from('scheduled_messages').insert({ conversation_id: S.active, sender_id: U.id, body: text, send_at: at.toISOString(), reply_to: S.replyTo ? S.replyTo.id : null, mentions: [] });
        if (error) return toastErr(error);
        input.value = ''; input.dispatchEvent(new Event('input')); Core.saveDraft(S.active, ''); S.replyTo = null; sh.close(); Nova.toast(`Scheduled for ${R.dayLabel(at)}, ${R.fmtTime(at)}`); Core.loadScheduled();
      }
    });
  };
  Core.scheduledList = async function () {
    await Core.loadScheduled(); const draw = () => S.scheduled.length ? S.scheduled.map(s => `<div class="nc-urow sched"><span class="nc-urow-t"><b dir=auto>${esc(s.body.slice(0, 80))}</b><small>${esc(R.dayLabel(s.send_at))}, ${esc(R.fmtTime(s.send_at))}</small></span><button type=button class="nc-icon-btn danger" data-sd="${esc(s.id)}" aria-label="Cancel scheduled message">${ic('trash', 18)}</button></div>`).join('') : empty('clock', 'No scheduled messages');
    const p = panel('Scheduled messages', { body: `<div id=ncSchedList class="nc-ulist">${draw()}</div>` });
    p.node.addEventListener('click', async e => { const b = e.target.closest('[data-sd]'); if (!b) return; const { error } = await sb.from('scheduled_messages').delete().eq('id', b.dataset.sd).eq('sender_id', U.id); if (error) return toastErr(error); S.scheduled = S.scheduled.filter(s => s.id !== b.dataset.sd); $('#ncSchedList', p.node).innerHTML = draw(); Core.paintScheduledBadge(); });
  };
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-msg-profile]'); if (b) Core.messageUser(b.dataset.msgProfile); });
})();
