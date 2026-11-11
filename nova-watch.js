/* Supabase-backed watch rooms. Requires watch-party-schema.sql and the media-search function. */
(function () {
  const { sb, esc, ic } = Nova;
  if (typeof V === 'undefined') return;

  const MAX_FILE = 20 * 1024 * 1024, MAX_ATTACHMENTS = 8;
  const ALLOWED_MIME = new Set([
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime','video/ogg',
    'audio/mpeg','audio/mp4','audio/ogg','audio/webm','audio/wav','audio/x-wav',
    'application/pdf','text/plain'
  ]);
  let roomChannel = null, activeRoomId = null, roomData = null, roomRole = null;
  let roomMembers = [], roomProfiles = {}, roomMessages = [], player = null;
  let playerSourceKey = '', remoteApplying = false, syncTimer = null, chatFiles = [];
  let mediaResults = [], mediaSearchSequence = 0, recorder = null, recordingStream = null;
  let loadCounter = 0, searchTimer = null, homeRooms = [], memberCheckTimer = null;

  const person = id => roomProfiles[id] || { id, full_name: 'Member', username: 'member' };
  const linkedAvatar = (user, size, className = '') => {
    const id = user?.id;
    if (!id) return Nova.avatar(user || {}, size, className);
    const route = id === U.id ? 'info' : `user/${esc(id)}`;
    return `<button class=profile-avatar-link data-go="${route}" aria-label="View ${id === U.id ? 'your' : esc(user.full_name || user.username || 'member')} profile">${Nova.avatar(user, size, className)}</button>`;
  };
  const isAdmin = () => roomRole === 'owner' || roomRole === 'admin';
  const isOwner = () => roomRole === 'owner';
  const toastError = error => Nova.toast(error?.message || 'Watch party could not be completed.', 'err');
  const roomError = error => /relation .* does not exist|function .* does not exist|schema cache/i.test(error?.message || '')
    ? 'Run watch-party-schema.sql in Supabase before using watch rooms.'
    : error?.message || 'Watch room could not be loaded.';

  function closeRoomChannel() {
    if (roomChannel) sb.removeChannel(roomChannel);
    roomChannel = null;
    clearInterval(syncTimer);
    syncTimer = null;
    clearInterval(memberCheckTimer);
    memberCheckTimer = null;
    destroyPlayer();
  }

  async function checkRoomMembership() {
    if (!activeRoomId) return;
    const { data, error } = await sb.from('watch_room_members').select('role')
      .eq('room_id', activeRoomId).eq('user_id', U.id).maybeSingle();
    if (error) { console.error('Could not verify watch-room membership:', error); return; }
    if (!data) {
      closeRoomChannel(); activeRoomId = null;
      Nova.toast('You are no longer a member of this room.', 'err');
      location.hash = 'watch';
    } else if (data.role !== roomRole) {
      roomRole = data.role;
      refreshMembers();
    }
  }

  function destroyPlayer() {
    if (player?.destroy) player.destroy();
    player = null;
    playerSourceKey = '';
  }

  function roomLink(id, code = '') {
    return `${location.origin}${location.pathname}#room/${encodeURIComponent(id)}${code ? `/${encodeURIComponent(code)}` : ''}`;
  }

  function roomCard(room, joined) {
    const title = room.current_title || 'Choose a video together';
    const role = room.role ? ` · ${room.role}` : '';
    return `<article class=watch-room-card data-watch-room-card data-search="${esc(`${room.name} ${title}`.toLowerCase())}">
      <div class=watch-room-meta><span class=watch-pill>${esc(room.visibility)}</span><span>${joined ? `Joined${role}` : 'Open room'}</span></div>
      <h3>${esc(room.name)}</h3><p>${esc(title)}</p>
      <div class=watch-room-meta><span>${room.is_playing ? '▶ Playing' : '⏸ Paused'}</span><button class="btn ${joined ? 'sec' : 'pri'} sm" data-room-open="${esc(room.id)}">${joined ? 'Enter room' : 'Join room'}</button></div>
    </article>`;
  }

  V.watch = () => {
    setTimeout(loadHome, 0);
    return shell('watch', `${mbar('Watch Together', `<button class="ib" data-watch-join aria-label="Join with invite">${ic('link')}</button>`, 'home')}
      <section class=watch-page>
        <div class=watch-hero><span class=watch-role>Nova Watch Party</span><h2>Watch together, in sync.</h2><p>Create a room, invite friends, and chat while an admin controls the shared player. Room roles and playback permissions are enforced by Supabase.</p>
          <div class=watch-hero-actions><button class="btn pri" data-watch-create>${ic('plus',16)} Create a room</button><button class="btn sec" data-watch-join>${ic('link',16)} Join with invite</button></div>
        </div>
        <section class=watch-section><div class=watch-section-head><h2>Your rooms</h2><label class=chat-search><span>${ic('search')}</span><input id=watchSearch type=search placeholder="Filter rooms" aria-label="Filter watch rooms"></label></div><div id=watchMyRooms class=watch-room-grid><p class=chat-loading>Loading your rooms…</p></div></section>
        <section class=watch-section><div class=watch-section-head><h2>Public rooms</h2><button class="btn sec sm" data-watch-reload>Refresh</button></div><div id=watchPublicRooms class=watch-room-grid><p class=chat-loading>Loading public rooms…</p></div></section>
      </section>`);
  };

  V.room = id => {
    const inviteCode = (location.hash || '').slice(1).split('/')[2] || '';
    setTimeout(() => openRoom(id, inviteCode), 0);
    return shell('watch', `${mbar('Watch room', '', 'watch')}
      <section class=watch-page><div id=watchRoomRoot class=watch-room-layout><div class=chat-loading>Joining watch room…</div></div></section>`);
  };

  async function loadHome() {
    const mineTarget = document.getElementById('watchMyRooms'), publicTarget = document.getElementById('watchPublicRooms');
    if (!mineTarget || !publicTarget) return;
    try {
      const { data: memberships, error: memberError } = await sb.from('watch_room_members')
        .select('room_id,role').eq('user_id', U.id).limit(50);
      if (memberError) throw memberError;
      const ids = (memberships || []).map(item => item.room_id);
      const mineQuery = ids.length
        ? sb.from('watch_rooms').select('id,name,visibility,current_title,is_playing,created_at').in('id', ids).order('updated_at', { ascending: false }).limit(50)
        : Promise.resolve({ data: [], error: null });
      const publicQuery = sb.from('watch_rooms').select('id,name,visibility,current_title,is_playing,created_at')
        .eq('visibility', 'public').order('created_at', { ascending: false }).limit(30);
      const [mine, publicRooms] = await Promise.all([mineQuery, publicQuery]);
      if (mine.error) throw mine.error;
      if (publicRooms.error) throw publicRooms.error;
      const roles = new Map((memberships || []).map(item => [item.room_id, item.role]));
      const myRooms = mine.data || [];
      const allRooms = [...new Map([...myRooms, ...(publicRooms.data || [])].map(item => [item.id, item])).values()];
      homeRooms = allRooms;
      mineTarget.innerHTML = myRooms.length
        ? myRooms.map(item => roomCard({ ...item, role: roles.get(item.id) }, true)).join('')
        : '<div class=watch-home-empty>Create a private room or join a public room to get started.</div>';
      publicTarget.innerHTML = publicRooms.data?.length
        ? publicRooms.data.map(item => roomCard(item, ids.includes(item.id))).join('')
        : '<div class=watch-home-empty>No public rooms are live yet. Create one and set its visibility to Public.</div>';
      filterRooms(document.getElementById('watchSearch')?.value || '');
    } catch (error) {
      const message = esc(roomError(error));
      mineTarget.innerHTML = `<div class="watch-error">${message}</div>`;
      publicTarget.innerHTML = `<div class="watch-error">${message}</div>`;
    }
  }

  function filterRooms(query) {
    const value = query.trim().toLowerCase();
    document.querySelectorAll('[data-watch-room-card]').forEach(card => {
      card.hidden = value.length > 0 && !card.dataset.search.includes(value);
    });
  }

  function openRoomCreate() {
    closeWatchModal();
    const overlay = document.createElement('div');
    overlay.className = 'ov c'; overlay.id = 'watchModal';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class=modal><div class=mh>${ic('play',18)}<b>Create a watch room</b><button class=mx data-watch-close aria-label="Close">${ic('x',18)}</button></div><div class=mb>
      <label class=fld><span class=l>Room name</span><input id=watchRoomName maxlength=80 placeholder="Friday movie night" required></label>
      <label class=fld><span class=l>Who can join?</span><select id=watchRoomVisibility><option value=invite>Invite link only</option><option value=friends>Host's friends</option><option value=public>Public</option></select></label>
      <p class=chat-hint>Only the room owner and admins can load, play, pause, or seek the shared video. Members can invite others.</p>
      <div class=macts><button class="btn sec" data-watch-close>Cancel</button><button class="btn pri" data-watch-create-confirm>Create room</button></div>
    </div></div>`;
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) closeWatchModal(); });
    document.body.append(overlay);
    overlay.querySelector('#watchRoomName').focus();
  }

  function openJoinModal() {
    closeWatchModal();
    const overlay = document.createElement('div');
    overlay.className = 'ov c'; overlay.id = 'watchModal';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class=modal><div class=mh>${ic('link',18)}<b>Join a watch room</b><button class=mx data-watch-close aria-label="Close">${ic('x',18)}</button></div><div class=mb>
      <label class=fld><span class=l>Invite link or code</span><input id=watchInviteInput autocomplete=off placeholder="Paste an invite link or code"></label>
      <div class=macts><button class="btn sec" data-watch-close>Cancel</button><button class="btn pri" data-watch-join-confirm>Join room</button></div>
    </div></div>`;
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) closeWatchModal(); });
    document.body.append(overlay);
    overlay.querySelector('#watchInviteInput').focus();
  }

  function closeWatchModal() { document.getElementById('watchModal')?.remove(); }

  async function createRoom(button) {
    const name = document.getElementById('watchRoomName')?.value.trim();
    const visibility = document.getElementById('watchRoomVisibility')?.value;
    if (!name) return Nova.toast('Enter a room name.', 'err');
    button.disabled = true;
    try {
      const { data, error } = await sb.rpc('watch_room_create', { p_name: name, p_visibility: visibility });
      if (error) throw error;
      closeWatchModal();
      location.hash = `room/${data}`;
    } catch (error) { toastError(error); button.disabled = false; }
  }

  function inviteCodeFrom(value) {
    const text = value.trim();
    if (!text) return '';
    try {
      const parsed = new URL(text, location.href);
      const route = parsed.hash.replace(/^#/, '').split('/');
      return route[0] === 'room' && route[2] ? decodeURIComponent(route[2]) : text;
    } catch { return text; }
  }

  async function joinInvite(button) {
    const code = inviteCodeFrom(document.getElementById('watchInviteInput')?.value || '');
    if (!code) return Nova.toast('Paste a room invite link or code.', 'err');
    button.disabled = true;
    try {
      const { data, error } = await sb.rpc('watch_room_join_invite', { p_code: code });
      if (error) throw error;
      closeWatchModal();
      location.hash = `room/${data}`;
    } catch (error) { toastError(error); button.disabled = false; }
  }

  async function loadRoomProfiles(ids) {
    const missing = [...new Set(ids)].filter(id => id && !roomProfiles[id]);
    if (!missing.length) return;
    const { data, error } = await sb.from('public_profiles').select('id,full_name,username,avatar_url').in('id', missing);
    if (error) throw error;
    (data || []).forEach(item => { roomProfiles[item.id] = item; });
  }

  async function openRoom(id, inviteCode) {
    closeRoomChannel();
    activeRoomId = id;
    roomData = null; roomRole = null; roomMembers = []; roomMessages = [];
    chatFiles = []; roomProfiles = {};
    const sequence = ++loadCounter;
    const root = document.getElementById('watchRoomRoot');
    if (!root || !id) return;
    try {
      const { data: membership, error: membershipError } = await sb.from('watch_room_members')
        .select('role').eq('room_id', id).eq('user_id', U.id).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) {
        if (inviteCode) {
          const { error } = await sb.rpc('watch_room_join', { p_room_id: id, p_invite_code: inviteCode });
          if (error) throw error;
        } else {
          const { error } = await sb.rpc('watch_room_join', { p_room_id: id, p_invite_code: null });
          if (error) throw error;
        }
      }
      const [roomResult, memberResult] = await Promise.all([
        sb.from('watch_rooms').select('*').eq('id', id).single(),
        sb.from('watch_room_members').select('room_id,user_id,role,joined_at').eq('room_id', id).order('joined_at', { ascending: true })
      ]);
      if (roomResult.error) throw roomResult.error;
      if (memberResult.error) throw memberResult.error;
      if (sequence !== loadCounter || !root.isConnected) return;
      roomData = roomResult.data;
      roomMembers = memberResult.data || [];
      roomRole = roomMembers.find(item => item.user_id === U.id)?.role || membership?.role || 'member';
      await loadRoomProfiles([...roomMembers.map(item => item.user_id), roomData.created_by]);
      renderRoom();
      await loadRoomMessages();
      setupRoomRealtime();
      memberCheckTimer = setInterval(checkRoomMembership, 12000);
      setupPlayer(roomData);
    } catch (error) {
      if (sequence === loadCounter && root.isConnected) {
        root.innerHTML = `<div class="watch-error"><b>Room unavailable</b><p>${esc(roomError(error))}</p><button class="btn sec" data-go=watch>Back to watch rooms</button></div>`;
      }
    }
  }

  function renderRoom() {
    const root = document.getElementById('watchRoomRoot');
    if (!root || !roomData) return;
    const members = roomMembers.map(member => {
      const user = person(member.user_id), self = member.user_id === U.id;
      const canManage = isAdmin() && !self && member.role !== 'owner' && (member.role !== 'admin' || isOwner());
      const actions = canManage ? `<div class=watch-member-action>${isOwner() && member.role !== 'owner' ? `<button class="btn sec" data-watch-admin="${esc(member.user_id)}" data-make-admin="${member.role !== 'admin'}">${member.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>` : ''}<button class="btn sec" data-watch-kick="${esc(member.user_id)}">Kick</button></div>` : '';
      return `<div class=watch-member>${linkedAvatar(user, 34)}<span class=watch-member-copy><b>${esc(user.full_name || user.username || 'Member')}${self ? ' (you)' : ''}</b><small>@${esc(user.username || 'member')} · ${esc(member.role)}</small></span>${actions}</div>`;
    }).join('');
    const ownerActions = isOwner()
      ? `<button class="btn sec sm" data-watch-delete>Delete room</button>`
      : `<button class="btn sec sm" data-watch-leave>Leave room</button>`;
    const roleLabel = roomRole === 'owner' ? 'Owner' : roomRole === 'admin' ? 'Admin' : 'Member';
    const adminControls = isAdmin() ? `<section class=watch-video-admin aria-label="Admin playback controls">
      <input id=watchVideoUrl class=watch-video-url type=url inputmode=url autocomplete=off placeholder="Paste a YouTube or direct MP4/WebM video URL">
      <input id=watchVideoTitle type=text maxlength=180 placeholder="Video title (optional)">
      <button class="btn pri sm" data-watch-load-media>Load video</button>
      <p class=watch-video-note>Admin-only synchronized playback. Use an embeddable YouTube video or a direct HTTPS MP4, WebM, MOV, or OGV file. Protected streaming services cannot be controlled by Nova.</p>
      <div class=watch-hero-actions><button class="btn sec sm" data-watch-toggle>Play / pause</button><button class="btn sec sm" data-watch-seek="-10">−10 sec</button><button class="btn sec sm" data-watch-seek="10">+10 sec</button></div>
    </section>` : '';
    root.innerHTML = `<div class=watch-main>
      <header class=watch-room-toolbar><div><h2>${esc(roomData.name)}</h2><small class=watch-video-note>${esc(roomData.current_title || 'No video selected')}</small></div><span class=watch-role>${roleLabel}</span></header>
      <div id=watchStage class=watch-stage><div class=watch-stage-empty><b>Loading shared player…</b></div></div>
      ${adminControls}
      <div class=watch-members><div class=watch-section-head><h3>Members · ${roomMembers.length}</h3><button class="btn sec sm" data-watch-invite>${ic('userplus',14)} Invite</button></div><div id=watchMemberList>${members || '<p class=chat-hint>No members yet.</p>'}</div><div class=watch-hero-actions>${ownerActions}<button class="btn sec sm" data-go=watch>Back to rooms</button></div></div>
    </div>
    <aside class=watch-sidebar><section class=watch-chat-panel><h3>Room chat</h3><div id=watchChatMessages class=watch-chat-messages><p class=chat-loading>Loading chat…</p></div><div id=watchPendingFiles class=watch-pending-files></div>
      <div class=watch-chat-form><button class="icon-btn" data-watch-media title="Search GIFs or images" aria-label="Search GIFs or images">${ic('image',18)}</button><button class="icon-btn" data-watch-files title="Attach files" aria-label="Attach files">${ic('paperclip',18)}</button><textarea id=watchChatInput rows=1 maxlength=5000 placeholder="Message room…" aria-label="Room message"></textarea><button class="icon-btn record-btn" data-watch-record title="Record voice note" aria-label="Record voice note">${ic('mic',18)}</button><button class="icon-btn send-btn" data-watch-send aria-label="Send message">${ic('send',18)}</button></div>
      <input type=file id=watchFiles multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/ogg,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,audio/x-wav,application/pdf,text/plain" hidden>
      <p class=chat-hint>Share image, GIF, video, audio, PDF, and text files · up to 20 MB each</p>
    </section></aside>`;
    renderChatFiles();
  }

  function setupRoomRealtime() {
    if (!activeRoomId) return;
    if (roomChannel) sb.removeChannel(roomChannel);
    roomChannel = sb.channel(`nova-watch-${activeRoomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'watch_rooms', filter: `id=eq.${activeRoomId}` }, payload => {
        if (!payload.new || payload.new.id !== activeRoomId) return;
        const previousUrl = roomData?.current_url;
        roomData = payload.new;
        const title = document.querySelector('.watch-room-toolbar h2');
        if (title) title.textContent = roomData.name;
        const sub = document.querySelector('.watch-room-toolbar .watch-video-note');
        if (sub) sub.textContent = roomData.current_title || 'No video selected';
        if (previousUrl !== roomData.current_url || !playerSourceKey) setupPlayer(roomData);
        else if (roomData.updated_by !== U.id) applyRemotePlayback(roomData);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'watch_room_messages', filter: `room_id=eq.${activeRoomId}` }, payload => {
        if (payload.new) appendRoomMessage(payload.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'watch_room_members', filter: `room_id=eq.${activeRoomId}` }, () => refreshMembers())
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') Nova.toast('Realtime watch room disconnected. Check Supabase Realtime setup.', 'err');
      });
  }

  async function refreshMembers() {
    if (!activeRoomId) return;
    try {
      const { data, error } = await sb.from('watch_room_members').select('room_id,user_id,role,joined_at')
        .eq('room_id', activeRoomId).order('joined_at', { ascending: true });
      if (error) throw error;
      const own = (data || []).find(item => item.user_id === U.id);
      if (!own) {
        closeRoomChannel(); activeRoomId = null;
        Nova.toast('You are no longer a member of this room.', 'err');
        location.hash = 'watch';
        return;
      }
      roomMembers = data || []; roomRole = own.role;
      await loadRoomProfiles(roomMembers.map(item => item.user_id));
      renderRoom();
      if (roomData) setupPlayer(roomData);
    } catch (error) { toastError(error); }
  }

  async function loadRoomMessages() {
    const target = document.getElementById('watchChatMessages');
    if (!target || !activeRoomId) return;
    const { data, error } = await sb.from('watch_room_messages')
      .select('id,room_id,sender_id,body,attachments,created_at')
      .eq('room_id', activeRoomId).order('created_at', { ascending: true }).limit(100);
    if (error) { target.innerHTML = `<p class=watch-error>${esc(error.message)}</p>`; return; }
    roomMessages = data || [];
    await loadRoomProfiles(roomMessages.map(item => item.sender_id));
    const html = await Promise.all(roomMessages.map(roomMessageHTML));
    if (target.isConnected) {
      target.innerHTML = html.join('') || '<p class=chat-hint>Say hello to everyone in the room.</p>';
      target.scrollTop = target.scrollHeight;
    }
  }

  async function roomMessageHTML(message) {
    const mine = message.sender_id === U.id, user = person(message.sender_id);
    const attachments = await Promise.all((message.attachments || []).map(async attachment => {
      let url = attachment.url;
      if (attachment.path) {
        const { data, error } = await sb.storage.from('watch-media').createSignedUrl(attachment.path, 3600);
        if (error) throw error;
        url = data.signedUrl;
      }
      try { if (new URL(url).protocol !== 'https:') return ''; }
      catch { return ''; }
      const href = esc(url), type = attachment.type || '';
      if (type.startsWith('image/')) return `<a href="${href}" target=_blank rel=noopener><img src="${href}" alt="${esc(attachment.name || 'Shared image')}" loading=lazy></a>`;
      if (type.startsWith('video/')) return `<video controls preload=metadata src="${href}"></video>`;
      if (type.startsWith('audio/')) return `<audio controls preload=metadata src="${href}"></audio>`;
      return `<a href="${href}" target=_blank rel=noopener>${ic('file',16)} ${esc(attachment.name || 'Shared file')}</a>`;
    }));
    const avatar = linkedAvatar(user, 30, 'watch-msg-avatar');
    const bubble = `<div class=watch-msg-bubble><small>${esc(user.full_name || user.username || 'Member')}</small>${message.body ? `<div>${esc(message.body).replace(/\n/g, '<br>')}</div>` : ''}${attachments.some(Boolean) ? `<div class=watch-msg-attachments>${attachments.join('')}</div>` : ''}<time>${new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>`;
    return `<article class="watch-chat-message ${mine ? 'mine' : ''}" data-watch-message="${esc(message.id)}">${mine ? bubble + avatar : avatar + bubble}</article>`;
  }

  async function appendRoomMessage(message) {
    if (roomMessages.some(item => item.id === message.id)) return;
    roomMessages.push(message);
    try {
      await loadRoomProfiles([message.sender_id]);
      const html = await roomMessageHTML(message);
      const target = document.getElementById('watchChatMessages');
      if (target?.isConnected) {
        if (target.querySelector('.chat-hint')) target.innerHTML = '';
        target.insertAdjacentHTML('beforeend', html);
        target.scrollTop = target.scrollHeight;
      }
    } catch (error) { toastError(error); }
  }

  function youtubeId(value) {
    try {
      const url = new URL(value);
      let id = '';
      if (url.hostname === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
      else if (url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com') {
        id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] || '';
      }
      return /^[\w-]{11}$/.test(id) ? id : '';
    } catch { return ''; }
  }

  function videoSource(value) {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      const id = youtubeId(url.href);
      if (id) return { source: 'youtube', url: url.href };
      if (/\.(mp4|webm|mov|ogv)(?:[?#].*)?$/i.test(url.href)) return { source: 'direct', url: url.href };
      return null;
    } catch { return null; }
  }

  function loadYoutubeAPI() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (window.novaYoutubeReady) return window.novaYoutubeReady;
    window.novaYoutubeReady = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') previous();
        resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('YouTube player could not be loaded.'));
      document.head.append(script);
    });
    return window.novaYoutubeReady;
  }

  function setupPlayer(room) {
    const stage = document.getElementById('watchStage');
    if (!stage || !room) return;
    if (!room.current_source || !room.current_url) {
      destroyPlayer();
      stage.classList.remove('readonly');
      stage.innerHTML = `<div class=watch-stage-empty><b>Choose a video for the room</b><p>${isAdmin() ? 'Paste a YouTube or direct video URL in the admin controls.' : 'The room admin has not selected a video yet.'}</p></div>`;
      return;
    }
    const sourceKey = `${room.current_source}:${room.current_url}`;
    if (playerSourceKey === sourceKey && player) {
      if (room.updated_by !== U.id) applyRemotePlayback(room);
      return;
    }
    destroyPlayer();
    playerSourceKey = sourceKey;
    stage.classList.toggle('readonly', !isAdmin());
    if (room.current_source === 'youtube') {
      stage.innerHTML = '<div id=watchYoutubePlayer></div>';
      loadYoutubeAPI().then(YT => {
        if (!stage.isConnected || playerSourceKey !== sourceKey) return;
        const id = youtubeId(room.current_url);
        if (!id) throw new Error('This YouTube link is not a valid video.');
        player = new YT.Player('watchYoutubePlayer', {
          width: '100%', height: '100%', videoId: id,
          playerVars: { playsinline: 1, controls: isAdmin() ? 1 : 0, disablekb: isAdmin() ? 0 : 1, rel: 0 },
          events: {
            onReady: () => { if (roomData) applyRemotePlayback(roomData, true); },
            onStateChange: event => {
              if (!isAdmin() && event.data === 1) {
                document.querySelector('.watch-playback-unlock')?.remove();
                return;
              }
              if (!isAdmin() || remoteApplying) return;
              if (event.data === 1 || event.data === 2 || event.data === 0) {
                publishPlayback(player.getCurrentTime() || 0, event.data === 1);
              }
            },
            onError: event => Nova.toast(`YouTube could not play this video (error ${event.data}).`, 'err')
          }
        });
        if (isAdmin()) {
          clearInterval(syncTimer);
          syncTimer = setInterval(() => {
            if (player?.getPlayerState?.() === 1) publishPlayback(player.getCurrentTime() || 0, true, true);
          }, 5000);
        }
      }).catch(toastError);
      return;
    }

    stage.innerHTML = `<video id=watchDirectPlayer playsinline preload=metadata ${isAdmin() ? 'controls' : ''}></video>`;
    const video = stage.querySelector('video');
    video.src = room.current_url;
    video.addEventListener('loadedmetadata', () => roomData && applyRemotePlayback(roomData, true), { once: true });
    video.addEventListener('playing', () => document.querySelector('.watch-playback-unlock')?.remove());
    video.addEventListener('play', () => {
      if (isAdmin() && !remoteApplying) publishPlayback(video.currentTime, true);
    });
    video.addEventListener('pause', () => { if (isAdmin() && !remoteApplying) publishPlayback(video.currentTime, false); });
    video.addEventListener('seeked', () => { if (isAdmin() && !remoteApplying) publishPlayback(video.currentTime, !video.paused); });
    video.addEventListener('error', () => Nova.toast('This video file could not be played. Use a direct, browser-supported HTTPS video URL.', 'err'));
    if (isAdmin()) {
      clearInterval(syncTimer);
      syncTimer = setInterval(() => {
        if (video && !video.paused) publishPlayback(video.currentTime, true, true);
      }, 5000);
    }
  }

  function playbackPosition(room) {
    const position = Number(room.position_seconds) || 0;
    return room.is_playing
      ? position + Math.max(0, Date.now() - new Date(room.playback_updated_at).getTime()) / 1000
      : position;
  }

  function applyRemotePlayback(room, force = false) {
    if (!room || !player || isAdmin() && room.updated_by === U.id) return;
    const target = playbackPosition(room);
    remoteApplying = true;
    try {
      if (room.current_source === 'youtube' && player.getCurrentTime) {
        if (force || Math.abs((player.getCurrentTime() || 0) - target) > 2.5) player.seekTo(target, true);
        if (room.is_playing) {
          if (!isAdmin()) showPlaybackUnlock();
          player.playVideo();
        } else {
          document.querySelector('.watch-playback-unlock')?.remove();
          player.pauseVideo();
        }
      } else if (player.tagName === 'VIDEO') {
        if (force || Math.abs(player.currentTime - target) > 1.5) player.currentTime = target;
        if (room.is_playing) player.play().catch(() => { if (!isAdmin()) showPlaybackUnlock(); });
        else player.pause();
      }
    } catch (error) { console.error('Could not synchronize room playback:', error); }
    setTimeout(() => { remoteApplying = false; }, 500);
  }

  function showPlaybackUnlock() {
    const stage = document.getElementById('watchStage');
    if (!stage || stage.querySelector('.watch-playback-unlock')) return;
    stage.insertAdjacentHTML('beforeend', '<div class=watch-playback-unlock><button class="btn pri" data-watch-enable-playback>Tap to join synchronized playback</button></div>');
  }

  async function publishPlayback(position, playing, heartbeat = false) {
    if (!isAdmin() || !activeRoomId || !roomData?.current_source) return;
    if (heartbeat && roomData.updated_by !== U.id) return;
    const { error } = await sb.rpc('watch_room_set_playback', {
      p_room_id: activeRoomId,
      p_source: roomData.current_source,
      p_url: roomData.current_url,
      p_title: roomData.current_title || '',
      p_position_seconds: Math.max(0, Math.min(86400, Number(position) || 0)),
      p_is_playing: !!playing
    });
    if (error) toastError(error);
  }

  async function loadRoomVideo(button) {
    if (!isAdmin()) return Nova.toast('Only room admins can change the video.', 'err');
    const input = document.getElementById('watchVideoUrl'), title = document.getElementById('watchVideoTitle');
    const parsed = videoSource(input?.value || '');
    if (!parsed) return Nova.toast('Use a YouTube video link or direct HTTPS MP4, WebM, MOV, or OGV link.', 'err');
    button.disabled = true;
    try {
      const { error } = await sb.rpc('watch_room_set_playback', {
        p_room_id: activeRoomId,
        p_source: parsed.source,
        p_url: parsed.url,
        p_title: title?.value.trim() || '',
        p_position_seconds: 0,
        p_is_playing: false
      });
      if (error) throw error;
      roomData = { ...roomData, current_source: parsed.source, current_url: parsed.url, current_title: title?.value.trim() || null, is_playing: false, position_seconds: 0, playback_updated_at: new Date().toISOString(), updated_by: U.id };
      setupPlayer(roomData);
      Nova.toast('Room video updated');
    } catch (error) { toastError(error); }
    finally { button.disabled = false; }
  }

  function togglePlayback() {
    if (!isAdmin()) return Nova.toast('Only room admins can control playback.', 'err');
    if (!player) return Nova.toast('Load a room video first.', 'err');
    if (roomData.current_source === 'youtube') {
      if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo();
    } else if (player.paused) player.play().catch(() => Nova.toast('Playback was blocked by the browser.', 'err'));
    else player.pause();
  }

  function seekPlayback(amount) {
    if (!isAdmin() || !player) return;
    if (roomData.current_source === 'youtube') player.seekTo(Math.max(0, player.getCurrentTime() + amount), true);
    else player.currentTime = Math.max(0, player.currentTime + amount);
  }

  async function createInvite(button) {
    button.disabled = true;
    try {
      const { data: code, error } = await sb.rpc('watch_room_create_invite', {
        p_room_id: activeRoomId, p_expires_hours: 168, p_max_uses: null
      });
      if (error) throw error;
      showInvite(roomLink(activeRoomId, code));
    } catch (error) { toastError(error); }
    finally { button.disabled = false; }
  }

  function showInvite(link) {
    closeWatchModal();
    const overlay = document.createElement('div');
    overlay.className = 'ov c'; overlay.id = 'watchModal';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class=modal><div class=mh>${ic('link',18)}<b>Room invite link</b><button class=mx data-watch-close aria-label="Close">${ic('x',18)}</button></div><div class=mb>
      <p class=chat-hint>Anyone with this link can join for seven days, subject to your room visibility.</p>
      <input class=watch-invite-link id=watchInviteLink readonly value="${esc(link)}">
      <div class=macts><button class="btn sec" data-watch-close>Close</button><button class="btn pri" data-watch-copy>Copy invite</button></div>
    </div></div>`;
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) closeWatchModal(); });
    document.body.append(overlay);
  }

  async function copyInvite(button) {
    const input = document.getElementById('watchInviteLink');
    try {
      await navigator.clipboard.writeText(input.value);
      Nova.toast('Invite link copied');
      closeWatchModal();
    } catch {
      input.focus(); input.select();
      Nova.toast('Copy is unavailable. The invite link is selected; copy it manually.', 'err');
    }
  }

  async function changeAdmin(button) {
    button.disabled = true;
    try {
      const { error } = await sb.rpc('watch_room_set_admin', {
        p_room_id: activeRoomId,
        p_user_id: button.dataset.watchAdmin,
        p_make_admin: button.dataset.makeAdmin === 'true'
      });
      if (error) throw error;
      await refreshMembers();
    } catch (error) { toastError(error); button.disabled = false; }
  }

  async function kickMember(button) {
    if (!await ask('Remove this member?', 'They will lose access to this room and its chat.', 'Remove')) return;
    button.disabled = true;
    try {
      const { error } = await sb.rpc('watch_room_kick', { p_room_id: activeRoomId, p_user_id: button.dataset.watchKick });
      if (error) throw error;
      await refreshMembers();
    } catch (error) { toastError(error); button.disabled = false; }
  }

  async function leaveRoom() {
    if (!await ask('Leave this room?', 'You can rejoin later if its visibility or invite link allows it.', 'Leave')) return;
    try {
      const { error } = await sb.rpc('watch_room_leave', { p_room_id: activeRoomId });
      if (error) throw error;
      closeRoomChannel(); location.hash = 'watch';
    } catch (error) { toastError(error); }
  }

  async function deleteRoom() {
    if (!await ask('Delete this room?', 'This permanently deletes its membership and chat history.', 'Delete')) return;
    try {
      const { error } = await sb.rpc('watch_room_delete', { p_room_id: activeRoomId });
      if (error) throw error;
      closeRoomChannel(); location.hash = 'watch';
    } catch (error) { toastError(error); }
  }

  function openMediaSearch() {
    closeWatchModal(); mediaResults = [];
    mediaSearchSequence++;
    const overlay = document.createElement('div');
    overlay.className = 'ov c media-overlay'; overlay.id = 'watchMediaModal';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class="modal media-modal"><div class=mh>${ic('image',18)}<b>Search images and GIFs</b><button class=mx data-watch-media-close aria-label="Close">${ic('x',18)}</button></div><div class=mb>
      <label class=fld><span class=l>Search media</span><input id=watchMediaQuery type=search maxlength=100 placeholder="Search Google Images, GIPHY, or KLIPY"></label>
      <div class=media-provider-grid><button class="btn sec" data-watch-search="google">Google Images</button><button class="btn sec" data-watch-search="giphy">GIPHY</button><button class="btn sec" data-watch-search="klipy">KLIPY GIFs</button></div>
      <div id=watchMediaResults class=watch-media-grid aria-live=polite></div>
      <p class=chat-hint>Tenor is discontinued as a public API. Search providers require server-side API configuration.</p>
    </div></div>`;
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) overlay.remove(); });
    document.body.append(overlay);
    overlay.querySelector('#watchMediaQuery').focus();
  }

  async function searchRoomMedia(provider, query) {
    const target = document.getElementById('watchMediaResults');
    if (!target || !query.trim()) return;
    const sequence = ++mediaSearchSequence;
    target.innerHTML = '<p class=chat-hint>Searching…</p>';
    try {
      const { data, error } = await sb.functions.invoke('watch-media-search', { body: { provider, query: query.trim() } });
      if (error) throw error;
      if (sequence !== mediaSearchSequence || !target.isConnected) return;
      mediaResults = data?.results || [];
      target.innerHTML = mediaResults.length
        ? mediaResults.map((item, index) => `<button class=watch-media-result data-watch-media-result="${index}" aria-label="Send ${esc(item.title)}"><img src="${esc(item.preview)}" alt="" loading=lazy><span>${esc(item.title)}</span></button>`).join('')
        : '<p class=chat-hint>No media matched that search.</p>';
    } catch (error) {
      if (sequence !== mediaSearchSequence || !target.isConnected) return;
      target.innerHTML = `<p class=chat-error>${esc(error.message || 'Media search is not configured.')}</p>`;
    }
  }

  function renderChatFiles() {
    const target = document.getElementById('watchPendingFiles');
    if (target) target.innerHTML = chatFiles.map((file, index) => `<span>${esc(file.name)}<button data-watch-remove-file="${index}" aria-label="Remove ${esc(file.name)}">${ic('x',12)}</button></span>`).join('');
  }

  function addChatFiles(files) {
    for (const file of files) {
      const mime = (file.type || '').split(';')[0].toLowerCase();
      if (!ALLOWED_MIME.has(mime)) { Nova.toast(`${file.name}: this file type is not supported.`, 'err'); continue; }
      if (file.size > MAX_FILE) { Nova.toast(`${file.name} exceeds 20 MB.`, 'err'); continue; }
      if (chatFiles.length >= MAX_ATTACHMENTS) { Nova.toast('You can attach up to eight items per message.', 'err'); break; }
      chatFiles.push(file);
    }
    renderChatFiles();
  }

  async function sendRoomMessage(button) {
    const input = document.getElementById('watchChatInput');
    const body = input?.value.trim() || '', files = [...chatFiles];
    if ((!body && !files.length) || !activeRoomId) return;
    button.disabled = true;
    const uploaded = [];
    try {
      const attachments = [];
      for (const file of files) {
        const mime = (file.type || '').split(';')[0].toLowerCase();
        const extension = file.name.includes('.') ? file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : 'bin';
        const path = `${activeRoomId}/${U.id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await sb.storage.from('watch-media').upload(path, file, { contentType: mime, upsert: false });
        if (error) throw error;
        uploaded.push(path);
        attachments.push({ path, name: file.name.slice(0, 180), type: mime, size: file.size });
      }
      const { error } = await sb.from('watch_room_messages').insert({
        room_id: activeRoomId, sender_id: U.id, body, attachments
      });
      if (error) throw error;
      input.value = ''; chatFiles = []; renderChatFiles();
    } catch (error) {
      if (uploaded.length) {
        const { error: cleanupError } = await sb.storage.from('watch-media').remove(uploaded);
        if (cleanupError) console.error('Could not clean up failed room chat uploads:', cleanupError);
      }
      toastError(error);
    } finally { button.disabled = false; }
  }

  function recordRoomVoice(button) {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return Nova.toast('Voice recording is not supported in this browser.', 'err');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      recordingStream = stream;
      const formats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const type = formats.find(mime => MediaRecorder.isTypeSupported(mime));
      recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = event => Nova.toast(event.error?.message || 'Voice recording failed.', 'err');
      recorder.onstop = () => {
        recordingStream?.getTracks().forEach(track => track.stop());
        recordingStream = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > MAX_FILE) Nova.toast('Voice note exceeds 20 MB.', 'err');
        else if (blob.size) addChatFiles([new File([blob], `voice-${Date.now()}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, { type: blob.type })]);
        recorder = null; button.classList.remove('recording');
      };
      recorder.start(); button.classList.add('recording');
      Nova.toast('Recording voice note… tap the microphone to finish.');
      setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 180000);
    }).catch(toastError);
  }

  async function sendSearchResult(index) {
    const item = mediaResults[index];
    if (!item || !activeRoomId) return;
    try {
      const { error } = await sb.from('watch_room_messages').insert({
        room_id: activeRoomId, sender_id: U.id, body: '',
        attachments: [{ url: item.url, name: item.title, type: item.type }]
      });
      if (error) throw error;
      document.getElementById('watchMediaModal')?.remove();
    } catch (error) { toastError(error); }
  }

  async function handleClick(event) {
    const element = event.target.closest('[data-watch-create],[data-watch-join],[data-watch-reload],[data-room-open],[data-watch-close],[data-watch-create-confirm],[data-watch-join-confirm],[data-watch-invite],[data-watch-copy],[data-watch-admin],[data-watch-kick],[data-watch-leave],[data-watch-delete],[data-watch-load-media],[data-watch-toggle],[data-watch-seek],[data-watch-media],[data-watch-files],[data-watch-media-close],[data-watch-search],[data-watch-media-result],[data-watch-enable-playback],[data-watch-send],[data-watch-record],[data-watch-remove-file]');
    if (!element) return;
    const data = element.dataset;
    if (data.watchCreate !== undefined) openRoomCreate();
    if (data.watchJoin !== undefined) openJoinModal();
    if (data.watchReload !== undefined) loadHome();
    if (data.roomOpen) {
      const existing = roomMembers.some(item => item.room_id === data.roomOpen && item.user_id === U.id);
      if (!existing) {
        const card = homeRooms.find(item => item.id === data.roomOpen);
        if (card?.visibility === 'public') {
          const { error } = await sb.rpc('watch_room_join', { p_room_id: data.roomOpen, p_invite_code: null });
          if (error) { toastError(error); return; }
        }
      }
      location.hash = `room/${data.roomOpen}`;
    }
    if (data.watchClose !== undefined) closeWatchModal();
    if (data.watchCreateConfirm !== undefined) createRoom(element);
    if (data.watchJoinConfirm !== undefined) joinInvite(element);
    if (data.watchInvite !== undefined) createInvite(element);
    if (data.watchCopy !== undefined) copyInvite(element);
    if (data.watchAdmin) changeAdmin(element);
    if (data.watchKick) kickMember(element);
    if (data.watchLeave !== undefined) leaveRoom();
    if (data.watchDelete !== undefined) deleteRoom();
    if (data.watchLoadMedia !== undefined) loadRoomVideo(element);
    if (data.watchToggle !== undefined) togglePlayback();
    if (data.watchSeek) seekPlayback(Number(data.watchSeek));
    if (data.watchEnablePlayback !== undefined && roomData) applyRemotePlayback(roomData, true);
    if (data.watchMedia !== undefined) openMediaSearch();
    if (data.watchFiles !== undefined) document.getElementById('watchFiles')?.click();
    if (data.watchMediaClose !== undefined) { mediaSearchSequence++; document.getElementById('watchMediaModal')?.remove(); }
    if (data.watchSearch) {
      const query = document.getElementById('watchMediaQuery')?.value.trim();
      if (!query) { Nova.toast('Enter a search term first.', 'err'); return; }
      searchRoomMedia(data.watchSearch, query);
    }
    if (data.watchMediaResult !== undefined) sendSearchResult(Number(data.watchMediaResult));
    if (data.watchSend !== undefined) sendRoomMessage(element);
    if (data.watchRecord !== undefined) recordRoomVoice(element);
    if (data.watchRemoveFile !== undefined) { chatFiles.splice(Number(data.watchRemoveFile), 1); renderChatFiles(); }
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('input', event => {
    if (event.target.id === 'watchSearch') filterRooms(event.target.value);
    if (event.target.id === 'watchMediaQuery') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const query = event.target.value.trim();
        if (query.length >= 2) searchRoomMedia('giphy', query);
      }, 300);
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'watchFiles') {
      addChatFiles([...event.target.files]);
      event.target.value = '';
    }
  });
  document.addEventListener('keydown', event => {
    if (event.target.id === 'watchChatInput' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); sendRoomMessage(document.querySelector('[data-watch-send]'));
    }
    if (event.target.id === 'watchInviteInput' && event.key === 'Enter') {
      event.preventDefault(); joinInvite(document.querySelector('[data-watch-join-confirm]'));
    }
    if (event.target.id === 'watchVideoUrl' && event.key === 'Enter') {
      event.preventDefault(); loadRoomVideo(document.querySelector('[data-watch-load-media]'));
    }
    if (event.key === 'Escape') {
      closeWatchModal(); mediaSearchSequence++; document.getElementById('watchMediaModal')?.remove();
    }
  });
  document.addEventListener('paste', event => {
    if (event.target.id === 'watchChatInput') {
      const files = [...(event.clipboardData?.files || [])];
      if (files.length) addChatFiles(files);
    }
  });
  window.addEventListener('hashchange', () => {
    const route = (location.hash || '').slice(1).split('/')[0];
    if (route !== 'room' && activeRoomId) {
      closeRoomChannel(); activeRoomId = null; roomData = null;
    }
  });
})();
