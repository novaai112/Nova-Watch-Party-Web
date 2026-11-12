/* Mobile-first private chat for accepted friends. Requires chat-schema.sql. */
(function () {
  const { sb, esc, t } = Nova, ic = Nova.ic;
  if (typeof V === 'undefined') return;

  const MAX_FILE = 20 * 1024 * 1024, MAX_ATTACHMENTS = 8, PAGE_SIZE = 60;
  const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,image/bmp,image/tiff,video/mp4,video/webm,video/quicktime,video/ogg,video/3gpp,video/x-msvideo,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,audio/x-wav,audio/aac,audio/flac,audio/3gpp,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip';
  const MIME = new Set(ACCEPT.split(','));
  let liveChannel = null, activeThread = null, activeThreadIsGroup = false, threadMembers = [], profiles = {}, messages = [], oldestMessage = null;
  let pendingFiles = [], pendingRemote = [], pendingContacts = [], mediaSearchItems = [], mediaSearchSequence = 0, mediaSearchTimer = null, mediaRetryTimer = null, mediaProvider = '', mediaKind = 'image', mediaContactsCache = null, mediaKindPages = {}, mediaKindHasMore = {}, mediaLoadingMore = false, mediaPageError = false, mediaQuery = '', mentionedUsers = new Map(), recorder = null, recordingStream = null, recordedChunks = [], recordingTimer = null, recordingStartedAt = 0, recordingElapsed = 0, recordingCancelled = false;
  const pendingPreviewUrls = new WeakMap();

  const person = id => profiles[id] || { id, username: 'unknown', full_name: 'Unknown user' };
  const friendlyError = error => {
    const message = error && error.message || 'Chat could not be loaded.';
    return /relation .* does not exist|function .* does not exist|could not find the .* in the schema cache/i.test(message)
      ? 'Run chat-schema.sql in Supabase before using chat.'
      : message;
  };
  const chatError = error => Nova.toast(friendlyError(error), 'err');
  const setBusy = (node, busy) => { if (node) node.disabled = busy; };
  let peopleTab = 'friends', peopleQuery = '', peopleLoadSequence = 0, peopleSearchTimer = null;
  const likeTerm = value => String(value).replace(/[\\%_]/g, '\\$&');
  const titleFor = (conversation, members) => conversation.is_group
    ? (conversation.title || members.map(m => person(m.user_id).full_name || person(m.user_id).username).join(', '))
    : (() => { const p = person(members.find(m => m.user_id !== U.id)?.user_id); return p.full_name || 'Friend'; })();

  function bindRealtime() {
    if (liveChannel) sb.removeChannel(liveChannel);
    liveChannel = sb.channel(`nova-chat-${U.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
        const row = payload.new;
        if (!row || row.sender_id === U.id) return;
        if (row.conversation_id === activeThread) {
          loadMessages(false);
          sb.from('conversation_members').update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', activeThread).eq('user_id', U.id)
            .then(({ error }) => { if (error) console.error('Could not update chat read state:', error); });
        }
        else if ((location.hash || '').startsWith('#chat')) loadInbox();
        else if ((location.hash || '').startsWith('#friends')) loadPeople();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${U.id}` }, () => {
        if ((location.hash || '').startsWith('#chat')) loadInbox();
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') Nova.toast('Realtime chat connection failed. Check Supabase Realtime setup.', 'err');
      });
  }

  async function loadProfiles(ids) {
    const missing = [...new Set(ids)].filter(id => id && !profiles[id]);
    if (!missing.length) return;
    const { data, error } = await sb.from('public_profiles').select('id,full_name,username,avatar_url').in('id', missing);
    if (error) throw error;
    (data || []).forEach(p => { profiles[p.id] = p; });
  }

  function viewShell(route, body) {
    const back = `<a class=people-rail-back href="nova-home.html" aria-label="Back to Nova home" title="Back to Nova home">${ic('left',20)}</a>`;
    return shell('chat', `${peopleTabs(back)}<div class=chat-view>${body}</div>`);
  }

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
    const tabs = [['friends','users','Friends'],['recents','clock','Recent'],['requests','userplus','Request'],['blocked','shield','Blocked']];
    return `<div class=people-side-rail>${back}<nav class=people-bottom-nav aria-label="People">${tabs.map(([key,icon,label]) => `<button class="${peopleTab===key?'on':''}" data-people-tab="${key}" aria-current="${peopleTab===key?'page':'false'}">${ic(icon,24)}<span>${label}</span>${key==='requests'&&REQ.length?`<i>${REQ.length}</i>`:''}</button>`).join('')}</nav></div>`;
  }

  V.friends = requestedTab => {
    if (['friends', 'recents', 'requests', 'blocked'].includes(requestedTab)) peopleTab = requestedTab;
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
      let recents = [];
      let conversations = [];
      if (peopleTab === 'recents') {
        const { data, error } = await sb.from('conversations')
          .select('id,title,is_group,last_message_at,conversation_members!inner(user_id)')
          .eq('conversation_members.user_id', U.id).order('last_message_at', { ascending: false }).limit(50);
        if (error) throw error;
        conversations = data || [];
      }
      const conversationIds = conversations.map(row => row.id);
      if (conversationIds.length) {
        const { data: members, error: memberError } = await sb.from('conversation_members')
          .select('conversation_id,user_id').in('conversation_id', conversationIds);
        if (memberError) throw memberError;
        const chatById = new Map(conversations.map(row => [row.id, row]));
        const latestByUser = new Map();
        for (const member of members || []) {
          if (member.user_id === U.id || blockedIds.has(member.user_id)) continue;
          const room = chatById.get(member.conversation_id);
          if (!room) continue;
          const seen = latestByUser.get(member.user_id);
          if (!seen || room.last_message_at > seen.room.last_message_at) latestByUser.set(member.user_id, { user_id: member.user_id, room });
        }
        recents = [...latestByUser.values()].sort((a, b) => b.room.last_message_at.localeCompare(a.room.last_message_at));
        allIds.push(...recents.map(row => row.user_id));
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
        return `<button class="btn pri sm" data-people-add="${esc(userId)}">${ic('userplus',15)} Add</button><button class="icon-btn people-decline" data-people-block="${esc(userId)}" aria-label="Block user" title="Block user">${ic('shield',15)}</button>`;
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
      } else if (peopleTab === 'recents') {
        const rows = recents.filter(item => !q || usernameMatches(item.user_id));
        content = rows.length ? rows.map(item => {
          const roomName = item.room.is_group ? item.room.title || 'Group chat' : 'Recent conversation';
          return peopleRow(person(item.user_id), `${roomName} · ${new Date(item.room.last_message_at).toLocaleDateString()}`, `<button class="btn sec sm" data-open-chat="${esc(item.room.id)}">Open chat</button>`);
        }).join('') : empty(q ? 'No recent chat members match that username.' : 'People from your recent chats will appear here.');
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

  V.chat = id => {
    const threadId = id || null;
    setTimeout(() => {
      bindRealtime();
      if (threadId) openThread(threadId);
      else loadInbox();
    }, 0);
    return viewShell(threadId, threadId
      ? `<section class="chat-page"><div id=chatThread class="chat-thread"><div class=chat-loading>Loading conversation…</div></div></section>`
      : `<section class="chat-page"><div class=chat-toolbar><label class=chat-search><span>${ic('search')}</span><input id=chatSearch type=search autocomplete=off placeholder="Search chats or usernames" aria-label="Search chats or usernames"></label><button class="btn pri sm" data-chat-compose>${ic('plus',15)} New</button></div><div id=chatList class=chat-list><div class=chat-loading>Loading chats…</div></div></section>`);
  };

  async function loadInbox(query = '') {
    const target = document.getElementById('chatList');
    if (!target) return;
    try {
      const { data: rows, error } = await sb.from('conversations')
        .select('id,title,is_group,last_message_at,conversation_members!inner(user_id,last_read_at)')
        .eq('conversation_members.user_id', U.id).order('last_message_at', { ascending: false }).limit(100);
      if (error) throw error;
      const chats = rows || [], ids = chats.map(c => c.id);
      if (!ids.length) {
        target.innerHTML = `<div class=chat-empty><span>${ic('chat',30)}</span><b>No conversations yet</b><p>Start a chat with an accepted friend using their username.</p><button class="btn pri" data-chat-compose>${ic('plus',15)} Start a chat</button></div>`;
        return;
      }
      const { data: allMembers, error: memberError } = await sb.from('conversation_members').select('conversation_id,user_id,last_read_at').in('conversation_id', ids);
      if (memberError) throw memberError;
      const byChat = {};
      (allMembers || []).forEach(m => { (byChat[m.conversation_id] ||= []).push(m); });
      await loadProfiles((allMembers || []).map(m => m.user_id));
      const { data: recent, error: messageError } = await sb.from('chat_messages')
        .select('conversation_id,body,attachments,created_at,sender_id')
        .in('conversation_id', ids).order('created_at', { ascending: false }).limit(300);
      if (messageError) throw messageError;
      const latest = {};
      (recent || []).forEach(m => { if (!latest[m.conversation_id]) latest[m.conversation_id] = m; });
      const q = query.trim().toLowerCase();
      const filtered = chats.filter(c => {
        const title = titleFor(c, byChat[c.id] || []);
        const last = latest[c.id];
        const candidate = `${title} ${last?.body || ''} ${(byChat[c.id] || []).map(m => person(m.user_id).username).join(' ')}`.toLowerCase();
        return !q || candidate.includes(q);
      });
      target.innerHTML = filtered.length ? filtered.map(c => {
        const members = byChat[c.id] || [], last = latest[c.id], mine = c.conversation_members?.[0];
        const unread = last && last.sender_id !== U.id && new Date(last.created_at) > new Date(mine?.last_read_at || 0);
        const sub = last ? (last.body || `${last.attachments?.length || 0} attachment${last.attachments?.length === 1 ? '' : 's'}`) : 'Start the conversation';
        const face = c.is_group ? `<span class=chat-group-avatar>${ic('users',20)}</span>` : linkedAvatar(person(members.find(m => m.user_id !== U.id)?.user_id), 48);
        return `<article class=chat-row>${face}<button class=chat-row-open data-open-chat="${esc(c.id)}"><span class=chat-row-copy><b>${esc(titleFor(c, members))}</b><small>${esc(sub)}</small></span>${unread ? '<i class=chat-unread aria-label="Unread"></i>' : ''}<time>${last ? new Date(last.created_at).toLocaleDateString() : ''}</time></button></article>`;
      }).join('') : `<div class=chat-empty><b>No matching chats</b><p>Search a conversation or start a chat by username.</p><button class="btn sec" data-chat-compose>Find a friend</button></div>`;
    } catch (error) {
      target.innerHTML = `<div class=chat-empty><b>Chats could not be loaded</b><p>${esc(friendlyError(error))}</p><button class="btn sec" data-chat-retry>Try again</button></div>`;
    }
  }

  async function openThread(id) {
    activeThread = id; messages = []; mentionedUsers = new Map();
    const target = document.getElementById('chatThread');
    if (!target) return;
    try {
      const { data: conversation, error } = await sb.from('conversations').select('id,title,is_group').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!conversation) throw new Error('You do not have access to this conversation.');
      const { data: members, error: memberError } = await sb.from('conversation_members').select('user_id,last_read_at').eq('conversation_id', id);
      if (memberError) throw memberError;
      threadMembers = members || [];
      activeThreadIsGroup = conversation.is_group;
      await loadProfiles(threadMembers.map(m => m.user_id));
      const myMember = threadMembers.find(m => m.user_id === U.id);
      if (myMember) {
        const { error: readError } = await sb.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', id).eq('user_id', U.id);
        if (readError) throw readError;
      }
      clearPendingPreviews();
      pendingFiles = []; pendingRemote = []; pendingContacts = [];
      target.innerHTML = `<header class=chat-head><div class=chat-head-person>${conversation.is_group ? `<span class=chat-group-avatar>${ic('users',20)}</span>` : linkedAvatar(person(threadMembers.find(m => m.user_id !== U.id)?.user_id), 42)}<span><b>${esc(titleFor(conversation, threadMembers))}</b>${conversation.is_group ? `<small>${threadMembers.length} members</small>` : ''}</span></div></header>
        <div id=chatMessages class=chat-messages><p class=chat-loading>Loading messages…</p></div><div id=mentionList class=mention-list hidden></div><div id=recordingPanel class=voice-recording-panel hidden></div>
        <section id=chatMediaPicker class=chat-media-picker role=region aria-label="Share media" hidden>
          <div id=mediaMenu class=media-menu>
            <button class=media-menu-item data-media-action="document">${ic('file',18)}<span>Document</span></button>
            <button class=media-menu-item data-media-action="gallery">${ic('image',18)}<span>Photos &amp; videos</span></button>
            <button class=media-menu-item data-media-action="camera">${ic('camera',18)}<span>Camera</span></button>
            <button class=media-menu-item data-media-action="audio">${ic('mic',18)}<span>Audio</span></button>
            <button class=media-menu-item data-media-action="contact">${ic('users',18)}<span>Contact</span></button>
            <button class=media-menu-item data-media-provider="duckduckgo"><i class="media-brand duckduckgo-brand">D</i><span>DuckDuckGo Images &amp; GIFs</span></button>
            <button class=media-menu-item data-media-provider="giphy"><i class="media-brand giphy-brand">GIF</i><span>GIPHY</span></button>
            <button class=media-menu-item data-media-provider="klipy"><i class="media-brand klipy-brand">K</i><span>KLIPY</span></button>
          </div>
          <div id=mediaProviderPanel class=media-provider-panel hidden></div>
          <div id=mediaContactPicker class=media-contact-panel hidden></div>
        </section>
        <div id=pendingFiles class=pending-files></div><div class=chat-compose>
          <button class="icon-btn attach-btn" data-chat-media aria-expanded="false" aria-controls=chatMediaPicker title="Attach media or file" aria-label="Attach media or file">${ic('paperclip')}</button>
          <input type=file id=chatFiles accept="image/*,video/*" multiple hidden aria-label="Choose photos and videos">
          <input type=file id=chatDocuments accept="application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip" multiple hidden aria-label="Choose documents">
          <input type=file id=chatAudio accept="audio/*" multiple hidden aria-label="Choose audio files">
          <input type=file id=chatCamera accept="image/*,video/*" capture="environment" hidden aria-label="Take a photo or video">
          <textarea id=chatInput rows=1 maxlength=5000 placeholder="Message…" aria-label="Message" title="Type @ to mention a friend"></textarea>
          <button class="icon-btn record-btn" data-chat-record title="Record a voice message" aria-label="Record a voice message">${ic('mic')}</button>
          <button class="icon-btn send-btn" data-chat-send title="Send message" aria-label="Send message">${ic('send')}</button>
        </div>`;
      await loadMessages(true);
    } catch (error) {
      target.innerHTML = `<div class=chat-empty><b>Conversation unavailable</b><p>${esc(friendlyError(error))}</p><button class="btn sec" data-go=chat>Back to chats</button></div>`;
    }
  }

  async function formatAttachments(attachments) {
    const list = await Promise.all((attachments || []).map(async attachment => {
      if (attachment.kind === 'contact' && attachment.contact) {
        const contact = attachment.contact;
        const name = contact.full_name || contact.username || 'Nova contact';
        return `<button class=message-contact data-go="user/${esc(contact.id)}">${Nova.avatar(contact, 40)}<span><b>${esc(name)}</b><small>@${esc(contact.username || '')}</small></span></button>`;
      }
      if (attachment.url) {
        const remote = safeRemoteMedia(attachment.url, attachment.type, attachment.name);
        if (!remote) throw new Error('A shared media link is invalid or no longer supported.');
        const href = esc(remote.url), name = esc(attachment.name || remote.name);
        if (remote.type.startsWith('image/')) return `<a class=message-image href="${href}" target=_blank rel=noopener><img src="${href}" alt="${name}" loading=lazy></a>`;
        if (remote.type.startsWith('video/')) return `<video class=message-video controls preload=metadata src="${href}"></video>`;
        if (remote.type.startsWith('audio/')) return `<audio class=message-audio controls preload=metadata src="${href}"></audio>`;
        throw new Error('A shared media link has an unsupported media type.');
      }
      const { data, error } = await sb.storage.from('chat-media').createSignedUrl(attachment.path, 3600);
      if (error) throw error;
      const href = esc(data.signedUrl), mime = attachment.type || '';
      if (mime.startsWith('image/')) return `<a class=message-image href="${href}" target=_blank rel=noopener><img src="${href}" alt="${esc(attachment.name)}" loading=lazy></a>`;
      if (mime.startsWith('video/')) return `<video class=message-video controls preload=metadata src="${href}"></video>`;
      if (mime.startsWith('audio/')) return `<audio class=message-audio controls preload=metadata src="${href}"></audio>`;
      return `<a class=message-file href="${href}" target=_blank rel=noopener>${ic('file',18)}<span>${esc(attachment.name)}</span></a>`;
    }));
    return list.join('');
  }

  async function messageHTML(message) {
    const mine = message.sender_id === U.id;
    const mentions = new Set(message.mentions || []);
    let body = esc(message.body || '');
    body = body.replace(/@([\p{L}\p{N}_.-]+)/gu, (match, username) => {
      const found = threadMembers.find(m => mentions.has(m.user_id) && person(m.user_id).username?.toLowerCase() === username.toLowerCase());
      return found ? `<span class=chat-mention>${match}</span>` : match;
    });
    const attachments = await formatAttachments(message.attachments);
    const sender = mine || !activeThreadIsGroup ? '' : `<small class=message-sender>${linkedAvatar(person(message.sender_id), 24)}<span>${esc(person(message.sender_id).full_name || 'Member')}</span></small>`;
    return `<article class="message ${mine ? 'mine' : ''}" data-message="${esc(message.id)}">${sender}${body ? `<div class=message-body>${body.replace(/\n/g, '<br>')}</div>` : ''}${attachments ? `<div class=message-attachments>${attachments}</div>` : ''}<time>${new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></article>`;
  }

  async function loadMessages(initial) {
    if (!activeThread) return;
    const target = document.getElementById('chatMessages');
    if (!target) return;
    const { data, error } = await sb.from('chat_messages').select('id,conversation_id,sender_id,body,mentions,attachments,created_at')
      .eq('conversation_id', activeThread).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    if (error) { chatError(error); return; }
    const page = (data || []).reverse();
    if (page.length) oldestMessage = page[0].created_at;
    messages = page;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    try {
      const html = await Promise.all(messages.map(messageHTML));
      if (target.isConnected) {
        target.innerHTML = `${messages.length >= PAGE_SIZE ? '<button class="btn sec sm chat-older" data-chat-older>Load earlier messages</button>' : ''}${html.length ? html.join('') : '<p class=chat-empty>Say hello to start the conversation.</p>'}`;
        if (initial || nearBottom) target.scrollTop = target.scrollHeight;
      }
    } catch (renderError) { chatError(renderError); }
  }

  async function loadOlder() {
    if (!activeThread || !oldestMessage) return;
    const target = document.getElementById('chatMessages');
    if (!target) return;
    const { data, error } = await sb.from('chat_messages').select('id,conversation_id,sender_id,body,mentions,attachments,created_at')
      .eq('conversation_id', activeThread).lt('created_at', oldestMessage).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    if (error) { chatError(error); return; }
    const page = (data || []).reverse(), oldHeight = target.scrollHeight, oldTop = target.scrollTop;
    if (!page.length) { target.querySelector('[data-chat-older]')?.remove(); return; }
    oldestMessage = page[0].created_at;
    messages = [...page, ...messages];
    try {
      const html = await Promise.all(messages.map(messageHTML));
      if (target.isConnected) {
        target.innerHTML = `${page.length === PAGE_SIZE ? '<button class="btn sec sm chat-older" data-chat-older>Load earlier messages</button>' : ''}${html.join('')}`;
        target.scrollTop = target.scrollHeight - oldHeight + oldTop;
      }
    } catch (renderError) { chatError(renderError); }
  }

  function acceptedFriendIds() {
    return sb.from('friendships').select('user_id,friend_id').eq('status', 'accepted').or(`user_id.eq.${U.id},friend_id.eq.${U.id}`);
  }

  async function findFriends(query, target) {
    const value = query.trim().replace(/^@/, '').replace(/[^a-z0-9_.-]/gi, '');
    if (value.length < 2) { target.innerHTML = '<p class=chat-hint>Enter at least 2 characters of a username.</p>'; return; }
    const { data: relationships, error } = await acceptedFriendIds();
    if (error) { target.innerHTML = `<p class=chat-error>${esc(error.message)}</p>`; return; }
    const ids = [...new Set((relationships || []).map(r => r.user_id === U.id ? r.friend_id : r.user_id))];
    if (!ids.length) { target.innerHTML = '<p class=chat-hint>Accept a friend request before starting a chat.</p>'; return; }
    if (!/^[\p{L}\p{N}_.-]+$/u.test(value)) { target.innerHTML = '<p class=chat-hint>Search with a username.</p>'; return; }
    const { data, error: searchError } = await sb.from('public_profiles').select('id,full_name,username,avatar_url')
      .in('id', ids).ilike('username', `%${likeTerm(value)}%`).limit(20);
    if (searchError) { target.innerHTML = `<p class=chat-error>${esc(searchError.message)}</p>`; return; }
    (data || []).forEach(p => { profiles[p.id] = p; });
    target.innerHTML = data?.length ? data.map(p => `<div class=friend-search-row>${linkedAvatar(p,42)}<button class=friend-search-main data-select-friend="${esc(p.id)}"><span><b>${esc(p.full_name || p.username)}</b><small>@${esc(p.username)}</small></span><i>${ic('check',16)}</i></button></div>`).join('') : '<p class=chat-hint>No accepted friend matched that username.</p>';
  }

  function openCompose() {
    closeCompose();
    const overlay = document.createElement('div');
    overlay.className = 'ov c'; overlay.id = 'chatCompose'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class=modal><div class=mh>${ic('chat',18)}<b>New conversation</b><button class=mx data-close-chat-compose aria-label="Close">${ic('x',18)}</button></div><div class=mb><label class=chat-search>${ic('search')}<input id=friendSearch type=search autocomplete=off placeholder="Find by username" aria-label="Find friends by username"></label><div id=friendResults class=friend-results><p class=chat-hint>Search your accepted friends by username or name.</p></div><div id=selectedFriends class=selected-friends></div><label class=fld id=groupTitleField hidden><span class=l>Group name</span><input id=groupTitle maxlength=80 placeholder="Name this group"></label><div class=macts><button class="btn sec" data-close-chat-compose>Cancel</button><button class="btn pri" data-create-chat disabled>Create chat</button></div></div></div>`;
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeCompose(); });
    document.body.append(overlay);
  }

  function closeCompose() { document.getElementById('chatCompose')?.remove(); }
  function selectedIds() { return [...document.querySelectorAll('#selectedFriends [data-selected-id]')].map(e => e.dataset.selectedId); }
  function updateSelection() {
    const ids = selectedIds(), field = document.getElementById('groupTitleField'), button = document.querySelector('[data-create-chat]');
    if (field) field.hidden = ids.length < 2;
    if (button) { button.disabled = ids.length === 0; button.textContent = ids.length > 1 ? 'Create group' : 'Create chat'; }
    const target = document.getElementById('selectedFriends');
    if (target) target.innerHTML = ids.map(id => `<span data-selected-id="${esc(id)}">${esc(profiles[id]?.full_name || profiles[id]?.username)}<button data-remove-friend="${esc(id)}" aria-label="Remove">${ic('x',13)}</button></span>`).join('');
  }

  async function createConversation(button) {
    const ids = selectedIds();
    if (!ids.length) return;
    setBusy(button, true);
    try {
      const { data, error } = await sb.rpc('start_chat', { p_member_ids: ids, p_title: ids.length > 1 ? document.getElementById('groupTitle')?.value.trim() || null : null });
      if (error) throw error;
      closeCompose();
      location.hash = `#chat/${data}`;
    } catch (error) { Nova.toast(error.message || 'Could not create conversation.', 'err'); setBusy(button, false); }
  }

  async function openFriendChat(button, id) {
    if (!id) return;
    setBusy(button, true);
    try {
      const { data, error } = await sb.rpc('start_chat', { p_member_ids: [id], p_title: null });
      if (error) throw error;
      if (!data) throw new Error('Could not open this conversation.');
      location.hash = `#chat/${data}`;
    } catch (error) {
      Nova.toast(error.message || 'Could not open this conversation.', 'err');
      setBusy(button, false);
    }
  }

  function mentionSuggestions(input) {
    const start = input.selectionStart, before = input.value.slice(0, start), match = before.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
    const list = document.getElementById('mentionList');
    if (!list) return;
    if (!match) { list.hidden = true; return; }
    const query = match[1].toLowerCase(), candidates = threadMembers.filter(m => m.user_id !== U.id)
      .filter(m => (person(m.user_id).username || '').toLowerCase().startsWith(query));
    if (!candidates.length) { list.hidden = true; return; }
    list.innerHTML = candidates.slice(0, 6).map(m => `<div class=mention-candidate>${linkedAvatar(person(m.user_id),28)}<button data-mention="${esc(m.user_id)}">@${esc(person(m.user_id).username)}</button></div>`).join('');
    list.dataset.start = String(start - match[1].length - 1); list.dataset.end = String(start); list.hidden = false;
  }

  function insertMention(id) {
    const input = document.getElementById('chatInput'), list = document.getElementById('mentionList');
    if (!input || !list) return;
    const start = Number(list.dataset.start), end = Number(list.dataset.end), username = person(id).username;
    input.setRangeText(`@${username} `, start, end, 'end'); input.focus();
    mentionedUsers.set(username.toLowerCase(), id); list.hidden = true;
  }

  function renderPending() {
    const target = document.getElementById('pendingFiles');
    if (!target) return;
    const renderPreview = (item, index, remote = false) => {
      const { name, type, url } = item;
      const previewUrl = url || (() => {
        let current = pendingPreviewUrls.get(item);
        if (!current) { current = URL.createObjectURL(item); pendingPreviewUrls.set(item, current); }
        return current;
      })();
      const media = type.startsWith('image/')
        ? `<img class=pending-preview-image src="${esc(previewUrl)}" alt="">`
        : type.startsWith('video/')
          ? `<video class=pending-preview-video src="${esc(previewUrl)}" muted playsinline preload=metadata></video>`
          : type.startsWith('audio/')
            ? `<audio class=pending-preview-audio controls preload=metadata src="${esc(previewUrl)}"></audio>`
            : `<span class=pending-preview-file>${ic(type === 'application/pdf' ? 'file' : 'file',20)}</span>`;
      const remove = remote
        ? `data-remove-remote="${index}"`
        : `data-remove-file="${index}"`;
      return `<div class="pending-preview${type.startsWith('audio/') ? ' pending-preview-audio-card' : ''}">${media}<span class=pending-preview-name title="${esc(name)}">${esc(name)}</span><button class=pending-preview-remove ${remove} aria-label="Remove ${esc(name)}">${ic('x',15)}</button></div>`;
    };
    target.innerHTML = [
      ...pendingFiles.map((file, index) => renderPreview(file, index)),
      ...pendingRemote.map((item, index) => renderPreview(item, index, true)),
      ...pendingContacts.map((contact, index) => `<div class="pending-preview pending-contact"><span class=pending-preview-file>${ic('users',20)}</span><span class=pending-preview-name>${esc(contact.full_name || contact.username || 'Contact')}</span><button class=pending-preview-remove data-remove-contact="${index}" aria-label="Remove ${esc(contact.full_name || contact.username || 'contact')}">${ic('x',15)}</button></div>`)
    ].join('');
  }

  function clearPendingPreviews() {
    pendingFiles.forEach(file => {
      const url = pendingPreviewUrls.get(file);
      if (url) URL.revokeObjectURL(url);
    });
  }

  function resizeChatInput(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function addFiles(files) {
    for (const file of files) {
      const type = (file.type || '').split(';')[0].toLowerCase();
      if (!MIME.has(type) && !/^(?:video|audio)\//.test(type)) { Nova.toast(`${file.name}: this file type is not supported.`, 'err'); continue; }
      if (file.size > MAX_FILE) { Nova.toast(`${file.name} is larger than 20 MB.`, 'err'); continue; }
      if (pendingFiles.length + pendingRemote.length + pendingContacts.length >= MAX_ATTACHMENTS) { Nova.toast(`You can attach up to ${MAX_ATTACHMENTS} items per message.`, 'err'); break; }
      pendingFiles.push(file);
    }
    renderPending();
  }

  function safeRemoteMedia(value, typeHint = '', nameHint = '') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      const extension = url.pathname.split('.').pop().toLowerCase();
      const types = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg',
        mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', weba: 'audio/webm'
      };
      const type = /^image\/(?:\*|jpeg|png|gif|webp|avif)$/.test(typeHint)
        ? typeHint : types[extension];
      if (!type) return null;
      let name = nameHint;
      try { name = name || decodeURIComponent(url.pathname.split('/').pop() || `${type.split('/')[0]} media`); }
      catch { name = `${type.split('/')[0]} media`; }
      return { url: url.href, name: name.slice(0, 180), type };
    } catch { return null; }
  }

  function addRemoteMedia(value, type = '', name = '') {
    const media = safeRemoteMedia(value.trim(), type, name);
    if (!media) {
      Nova.toast('This media result is not a supported HTTPS image, GIF, video, or audio file.', 'err');
      return;
    }
    if (pendingFiles.length + pendingRemote.length + pendingContacts.length >= MAX_ATTACHMENTS) {
      Nova.toast(`You can attach up to ${MAX_ATTACHMENTS} items per message.`, 'err');
      return;
    }
    if (pendingRemote.some(item => item.url === media.url)) {
      Nova.toast('That media link is already attached.', 'err');
      return;
    }
    pendingRemote.push(media);
    renderPending();
  }

  function addContact(contact) {
    if (pendingFiles.length + pendingRemote.length + pendingContacts.length >= MAX_ATTACHMENTS) {
      Nova.toast(`You can attach up to ${MAX_ATTACHMENTS} items per message.`, 'err');
      return;
    }
    if (pendingContacts.some(item => item.id === contact.id)) {
      Nova.toast('That contact is already attached.', 'err');
      return;
    }
    pendingContacts.push({
      id: contact.id,
      full_name: contact.full_name || '',
      username: contact.username || '',
      avatar_url: contact.avatar_url || ''
    });
    renderPending();
  }

  async function loadMediaContacts(query = '') {
    const target = document.getElementById('mediaContacts');
    if (!target) return;
    try {
      if (!mediaContactsCache) {
        target.innerHTML = '<p class=chat-hint>Loading accepted friends…</p>';
        const { data: relationships, error } = await acceptedFriendIds();
        if (error) throw error;
        const ids = [...new Set((relationships || []).map(r => r.user_id === U.id ? r.friend_id : r.user_id))];
        await loadProfiles(ids);
        mediaContactsCache = ids.map(person);
      }
      const term = query.trim().toLowerCase();
      const contacts = mediaContactsCache.filter(contact => {
        const label = `${contact.full_name || ''} ${contact.username || ''}`.toLowerCase();
        return !term || label.includes(term);
      });
      target.innerHTML = contacts.length
        ? contacts.map(contact => `<button class=media-contact data-media-contact="${esc(contact.id)}">${Nova.avatar(contact,36)}<span><b>${esc(contact.full_name || contact.username)}</b><small>@${esc(contact.username || '')}</small></span>${ic('plus',16)}</button>`).join('')
        : '<p class=chat-hint>No accepted friends matched.</p>';
    } catch (error) {
      target.innerHTML = `<p class=chat-error>${esc(friendlyError(error))}</p>`;
    }
  }

  function renderMediaResults(items = [], append = false) {
    const target = document.getElementById('mediaSearchResults');
    if (!target) return;
    target.classList.toggle('media-mixed-results', mediaProvider === 'giphy' || mediaProvider === 'klipy');
    if (!items.length && !append) {
      const mediaHint = mediaKind === 'all' ? 'Loading popular GIFs and stickers…' : mediaKind === 'sticker' ? 'Search for stickers' : mediaKind === 'gif' ? 'Search for GIFs' : 'Search to see results here';
      target.innerHTML = `<p class=chat-hint>${mediaHint}</p>`;
      return;
    }
    const offset = append ? mediaSearchItems.length - items.length : 0;
    const markup = items.map((item, index) =>
      `<button class=media-result data-media-result="${offset + index}" aria-label="Attach ${item.mediaKind === 'sticker' ? 'sticker' : item.mediaKind === 'image' ? 'image' : 'GIF'}: ${esc(item.title)}"><img src="${esc(item.preview)}" alt="" loading=lazy></button>`
    ).join('');
    if (append) target.insertAdjacentHTML('beforeend', markup);
    else target.innerHTML = markup;
  }

  async function mediaSearchError(error) {
    const response = error?.context;
    if (response instanceof Response) {
      if (response.status === 404) {
        return 'The chat-media-search Edge Function is not deployed to this Supabase project (or the configured project URL is wrong). Deploy it with: supabase functions deploy chat-media-search';
      }
      try {
        const body = await response.clone().json();
        if (typeof body?.error === 'string') return body.error;
      } catch {
        if (response.status) return `Media search failed (HTTP ${response.status}).`;
      }
      if (response.status) return `Media search failed (HTTP ${response.status}).`;
    }
    return error?.message || 'Media search failed. Check the Edge Function deployment and provider configuration.';
  }

  async function mediaRetryDelay(error) {
    const response = error?.context;
    if (!(response instanceof Response)) return 0;
    const header = response.headers.get('Retry-After');
    if (!header) return 0;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const timestamp = Date.parse(header);
    if (!Number.isNaN(timestamp)) return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
    return 0;
  }

  function renderMediaRetry(target, append, delay) {
    clearInterval(mediaRetryTimer);
    const retryAction = append ? 'more' : 'search';
    const disabled = delay > 0 ? 'disabled' : '';
    target.insertAdjacentHTML('beforeend', `<button class=media-retry data-media-retry="${retryAction}" ${disabled}>${delay > 0 ? `Retry in ${delay}s` : 'Retry search'}</button>`);
    const update = () => {
      const button = target.querySelector('[data-media-retry]');
      if (!button) {
        clearInterval(mediaRetryTimer);
        return;
      }
      const remaining = Math.max(0, Math.ceil((button.dataset.retryUntil - Date.now()) / 1000));
      button.disabled = remaining > 0;
      button.textContent = remaining > 0 ? `Retry in ${remaining}s` : 'Retry search';
      if (!remaining) clearInterval(mediaRetryTimer);
    };
    if (delay > 0) {
      const button = target.querySelector('[data-media-retry]');
      button.dataset.retryUntil = String(Date.now() + delay * 1000);
      mediaRetryTimer = setInterval(update, 1000);
    }
  }

  function renderMediaProvider(provider) {
    mediaProvider = provider;
    mediaKind = provider === 'giphy' || provider === 'klipy' ? 'all' : 'image';
    mediaSearchSequence++;
    clearTimeout(mediaSearchTimer);
    mediaSearchItems = [];
    mediaKindPages = {};
    mediaKindHasMore = {};
    mediaLoadingMore = false;
    mediaPageError = false;
    clearInterval(mediaRetryTimer);
    document.getElementById('chatMediaPicker').classList.add('provider-open');
    document.getElementById('mediaMenu').hidden = true;
    document.getElementById('mediaContactPicker').hidden = true;
    const panel = document.getElementById('mediaProviderPanel');
    panel.hidden = false;
    const title = ({ duckduckgo: 'DuckDuckGo', giphy: 'GIPHY', klipy: 'KLIPY' })[provider];
    const searchLabel = provider === 'duckduckgo' ? 'Search images and GIFs' : provider === 'giphy' ? 'Search GIPHY' : 'Search KLIPY';
    const options = provider === 'duckduckgo'
      ? `<div class=media-kind-toggle role=group aria-label="${title} search type"><button class="media-kind-option selected" aria-pressed=true data-media-kind="image">Image</button><button class=media-kind-option aria-pressed=false data-media-kind="gif">GIF</button></div>`
      : `<div class=media-kind-toggle role=group aria-label="${title} search type"><button class="media-kind-option selected" aria-pressed=true data-media-kind="all">All</button><button class=media-kind-option aria-pressed=false data-media-kind="gif">GIFs</button><button class=media-kind-option aria-pressed=false data-media-kind="sticker">Stickers</button></div>`;
    const search = `<label class=media-search-label><span>${ic('search',17)}</span><input id=mediaSearchInput type=search maxlength=160 placeholder="${searchLabel}" aria-label="${searchLabel}"></label>`;
    const suggestions = provider === 'giphy'
      ? `<div class=media-suggestions aria-label="Popular searches">${['party', 'awesome', 'funny', 'dogs'].map(term => `<button class=media-suggestion data-media-suggestion="${term}">${ic('search',14)}${term}</button>`).join('')}</div>`
      : '';
    const footer = provider === 'giphy' || provider === 'klipy'
      ? `<div class=media-provider-footer>${options}<span class=media-attribution>${title}</span></div>`
      : '';
    panel.innerHTML = `<div class="media-provider-head"><button class=media-back data-media-back aria-label="Back to attachments">${ic('left',18)}</button><b>${title}</b><button class=media-close data-close-media aria-label="Close attachment picker">${ic('x',18)}</button></div>
      ${provider === 'klipy' ? '' : search}
      ${provider === 'duckduckgo' ? `<div class=media-provider-subhead><span>${title}</span>${options}</div>` : ''}
      ${suggestions}
      <div id=mediaSearchResults class=media-search-results aria-live=polite></div>
      ${provider === 'klipy' ? search : ''}
      ${footer}`;
    renderMediaResults();
    panel.querySelector('#mediaSearchInput').focus();
    if (provider === 'giphy' || provider === 'klipy') searchMediaPicker('');
  }

  async function searchMediaPicker(query, append = false) {
    const target = document.getElementById('mediaSearchResults');
    const trimmedQuery = query.trim();
    if (!target || !mediaProvider || (!trimmedQuery && mediaProvider !== 'giphy' && mediaProvider !== 'klipy')) return;
    if (append && (mediaLoadingMore || mediaPageError)) return;
    const selectedKinds = mediaKind === 'all' ? ['gif', 'sticker'] : [mediaKind];
    if (append && !selectedKinds.some(kind => mediaKindHasMore[kind])) return;
    clearTimeout(mediaSearchTimer);
    mediaQuery = trimmedQuery;
    const sequence = ++mediaSearchSequence;
    clearInterval(mediaRetryTimer);
    if (append) {
      mediaLoadingMore = true;
      target.querySelector('[data-media-load-more],[data-media-retry]')?.remove();
      target.insertAdjacentHTML('beforeend', '<p class="chat-hint media-loading-more">Loading more…</p>');
    } else {
      mediaKindPages = {};
      mediaKindHasMore = {};
      mediaLoadingMore = false;
      mediaPageError = false;
      target.scrollTop = 0;
      target.innerHTML = mediaProvider === 'giphy' || mediaProvider === 'klipy'
        ? '<div class="klipy-skeleton"><i></i><i></i><i></i><i></i><i></i><i></i></div>'
        : '<p class=chat-hint>Searching…</p>';
    }
    try {
      const kinds = append ? selectedKinds.filter(kind => mediaKindHasMore[kind]) : selectedKinds;
      const responses = await Promise.all(kinds.map(async kind => {
        const { data, error } = await sb.functions.invoke('chat-media-search', {
          body: { provider: mediaProvider, query: trimmedQuery, kind, page: mediaKindPages[kind] || 0 }
        });
        if (error) throw error;
        return { kind, hasMore: data?.hasMore === true, items: (data?.results || []).map(item => ({ ...item, mediaKind: kind })) };
      }));
      if (sequence !== mediaSearchSequence || !target.isConnected) return;
      for (const result of responses) {
        mediaKindHasMore[result.kind] = result.hasMore;
        mediaKindPages[result.kind] = (mediaKindPages[result.kind] || 0) + 1;
      }
      if (mediaKind === 'all') {
        const merged = [];
        for (let index = 0; index < Math.max(0, ...responses.map(result => result.items.length)); index++) {
          for (const result of responses) if (result.items[index]) merged.push(result.items[index]);
        }
        if (append) mediaSearchItems.push(...merged);
        else mediaSearchItems = merged;
        target.querySelector('.media-loading-more')?.remove();
        renderMediaResults(merged, append);
      } else {
        const newItems = responses.flatMap(result => result.items);
        if (append) mediaSearchItems.push(...newItems);
        else mediaSearchItems = newItems;
        target.querySelector('.media-loading-more')?.remove();
        renderMediaResults(newItems, append);
      }
      if (!mediaSearchItems.length) {
        target.innerHTML = mediaProvider === 'duckduckgo' && mediaKind === 'gif'
          ? '<p class=chat-hint>No direct GIF files found. Try another search.</p>'
          : '<p class=chat-hint>No results. Try another search.</p>';
      }
      if (mediaProvider === 'duckduckgo' && mediaKindHasMore[mediaKind]) {
        target.insertAdjacentHTML('beforeend', '<button class=media-load-more data-media-load-more>Load more results</button>');
      }
    } catch (error) {
      if (sequence !== mediaSearchSequence || !target.isConnected) return;
      const [message, retryDelay] = await Promise.all([
        mediaSearchError(error),
        mediaProvider === 'duckduckgo' ? mediaRetryDelay(error) : 0
      ]);
      if (sequence !== mediaSearchSequence || !target.isConnected) return;
      mediaPageError = true;
      target.querySelector('.media-loading-more')?.remove();
      const errorMarkup = `<p class=chat-error>${esc(message)}</p>`;
      if (append && mediaSearchItems.length) {
        target.insertAdjacentHTML('beforeend', `<div class=media-page-error>${errorMarkup}</div>`);
      } else {
        target.innerHTML = errorMarkup;
      }
      if (mediaProvider === 'duckduckgo') renderMediaRetry(target, append, retryDelay);
    } finally {
      if (sequence === mediaSearchSequence) mediaLoadingMore = false;
    }
  }

  function selectMediaKind(kind) {
    if (!['image', 'gif', 'sticker', 'all'].includes(kind)) return;
    mediaKind = kind;
    document.querySelectorAll('[data-media-kind]').forEach(button => {
      const selected = button.dataset.mediaKind === kind;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const input = document.getElementById('mediaSearchInput');
    if (input?.value.trim()) searchMediaPicker(input.value);
    else if (mediaProvider === 'giphy' || mediaProvider === 'klipy') searchMediaPicker('');
    else {
      mediaSearchSequence++;
      mediaPageError = false;
      clearInterval(mediaRetryTimer);
      mediaSearchItems = [];
      renderMediaResults();
    }
  }

  function openMediaPicker() {
    const picker = document.getElementById('chatMediaPicker');
    const button = document.querySelector('[data-chat-media]');
    if (!picker) return;
    const opening = picker.hidden;
    picker.hidden = !opening;
    button?.setAttribute('aria-expanded', String(opening));
    if (opening) {
      mediaProvider = '';
      picker.classList.remove('provider-open');
      document.getElementById('mediaMenu').hidden = false;
      document.getElementById('mediaProviderPanel').hidden = true;
      document.getElementById('mediaContactPicker').hidden = true;
    } else closeMediaPicker();
  }

  function closeMediaPicker() {
    mediaSearchSequence++;
    clearTimeout(mediaSearchTimer);
    clearInterval(mediaRetryTimer);
    const picker = document.getElementById('chatMediaPicker');
    if (picker) { picker.hidden = true; picker.classList.remove('provider-open'); }
    document.querySelector('[data-chat-media]')?.setAttribute('aria-expanded', 'false');
  }

  async function sendMessage(button) {
    if (recorder) {
      Nova.toast('Finish or discard your voice recording before sending.', 'err');
      return;
    }
    const input = document.getElementById('chatInput');
    const body = input?.value.trim() || '', files = [...pendingFiles], remoteFiles = [...pendingRemote], contacts = [...pendingContacts];
    if ((!body && !files.length && !remoteFiles.length && !contacts.length) || !activeThread) return;
    setBusy(button, true);
    const uploaded = [];
    try {
      const attachments = remoteFiles.map(({ url, name, type }) => ({ url, name, type }));
      attachments.push(...contacts.map(contact => ({ kind: 'contact', contact })));
      for (const file of files) {
        const extension = file.name.includes('.') ? file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : 'bin';
        const fileId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `${activeThread}/${U.id}/${fileId}.${extension}`;
        const mimeType = (file.type || '').split(';')[0].toLowerCase();
        const { error } = await sb.storage.from('chat-media').upload(path, file, { contentType: mimeType, upsert: false });
        if (error) throw error;
        uploaded.push(path);
        attachments.push({ path, name: file.name.slice(0, 180), type: mimeType, size: file.size });
      }
      const mentions = [...new Set([...body.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map(match => mentionedUsers.get(match[1].toLowerCase())).filter(id => id && threadMembers.some(m => m.user_id === id)))];
      const { error } = await sb.from('chat_messages').insert({ conversation_id: activeThread, sender_id: U.id, body, mentions, attachments });
      if (error) throw error;
      clearPendingPreviews();
      input.value = ''; input.style.height = ''; pendingFiles = []; pendingRemote = []; pendingContacts = []; mentionedUsers.clear(); closeMediaPicker(); renderPending(); await loadMessages(true);
    } catch (error) {
      if (uploaded.length) {
        const { error: cleanupError } = await sb.storage.from('chat-media').remove(uploaded);
        if (cleanupError) console.error('Could not clean up failed chat uploads:', cleanupError);
      }
      Nova.toast(error.message || 'Message was not sent.', 'err');
    } finally { setBusy(button, false); }
  }

  function formatRecordingTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function recordingDuration() {
    return recordingElapsed + (recorder?.state === 'recording' ? performance.now() - recordingStartedAt : 0);
  }

  function renderRecordingPanel() {
    const panel = document.getElementById('recordingPanel');
    if (!panel || !recorder || recorder.state === 'inactive') {
      if (panel) { panel.hidden = true; panel.innerHTML = ''; }
      return;
    }
    panel.hidden = false;
    const paused = recorder.state === 'paused';
    panel.innerHTML = `<span class="voice-recording-dot${paused ? ' paused' : ''}" aria-hidden=true></span><span class=voice-recording-time>${formatRecordingTime(recordingDuration())}</span><span class=voice-recording-label>${paused ? 'Recording paused' : 'Recording voice message'}</span><button class=voice-control data-voice-pause aria-label="${paused ? 'Resume recording' : 'Pause recording'}">${paused ? 'Resume' : 'Pause'}</button><button class="voice-control voice-stop" data-voice-stop aria-label="Finish recording">Done</button><button class="voice-control voice-cancel" data-voice-cancel aria-label="Discard recording">Discard</button>`;
  }

  function stopRecordingStream() {
    clearInterval(recordingTimer);
    recordingTimer = null;
    recordingStream?.getTracks().forEach(track => track.stop());
    recordingStream = null;
  }

  function finishRecording(discard = false) {
    if (!recorder) return;
    recordingCancelled = discard;
    if (recorder.state !== 'inactive') recorder.stop();
  }

  async function startRecording(button) {
    if (recorder) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      Nova.toast('Voice recording is not supported by this browser.', 'err');
      return;
    }
    setBusy(button, true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const panel = document.getElementById('recordingPanel');
      if (!panel?.isConnected || !activeThread) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      recordingStream = stream;
      const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
      const type = types.find(candidate => MediaRecorder.isTypeSupported(candidate));
      recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      recordedChunks = [];
      recordingElapsed = 0;
      recordingStartedAt = performance.now();
      recordingCancelled = false;
      const activeRecorder = recorder;
      activeRecorder.ondataavailable = event => { if (event.data.size) recordedChunks.push(event.data); };
      activeRecorder.onerror = event => {
        console.error('Voice recording failed:', event.error);
        recordingCancelled = true;
        if (activeRecorder.state !== 'inactive') activeRecorder.stop();
        Nova.toast(event.error?.message || 'Voice recording failed. Try again.', 'err');
      };
      activeRecorder.onpause = renderRecordingPanel;
      activeRecorder.onresume = () => { recordingStartedAt = performance.now(); renderRecordingPanel(); };
      activeRecorder.onstop = () => {
        const mimeType = activeRecorder.mimeType || recordedChunks[0]?.type || 'audio/webm';
        const blob = new Blob(recordedChunks, { type: mimeType });
        stopRecordingStream();
        recorder = null;
        recordedChunks = [];
        document.querySelectorAll('[data-chat-record]').forEach(recordButton => recordButton.classList.remove('recording'));
        const recordingPanel = document.getElementById('recordingPanel');
        if (recordingPanel) { recordingPanel.hidden = true; recordingPanel.innerHTML = ''; }
        if (recordingCancelled) return;
        if (!blob.size) { Nova.toast('No audio was captured. Check microphone permission and try again.', 'err'); return; }
        if (blob.size > MAX_FILE) { Nova.toast('That voice message is larger than 20 MB.', 'err'); return; }
        const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        addFiles([new File([blob], `voice-${Date.now()}.${extension}`, { type: mimeType })]);
      };
      activeRecorder.start(250);
      button.classList.add('recording');
      renderRecordingPanel();
      recordingTimer = setInterval(() => {
        if (recorder !== activeRecorder) return;
        renderRecordingPanel();
        if (recordingDuration() >= 180000) finishRecording();
      }, 250);
    } catch (error) {
      stopRecordingStream();
      recorder = null;
      console.error('Could not start voice recording:', error);
      Nova.toast(error.message || 'Microphone permission was denied.', 'err');
    } finally {
      setBusy(button, false);
    }
  }

  document.addEventListener('click', async event => {
    const el = event.target.closest('[data-chat-compose],[data-open-chat],[data-open-friend],[data-chat-retry],[data-select-friend],[data-remove-friend],[data-create-chat],[data-close-chat-compose],[data-chat-send],[data-chat-record],[data-voice-pause],[data-voice-stop],[data-voice-cancel],[data-chat-media],[data-chat-older],[data-mention],[data-remove-file],[data-remove-remote],[data-remove-contact],[data-close-media],[data-media-action],[data-media-provider],[data-media-back],[data-media-kind],[data-media-suggestion],[data-media-result],[data-media-contact],[data-media-load-more],[data-media-retry],[data-people-tab],[data-people-add],[data-people-accept],[data-people-decline],[data-people-cancel],[data-people-remove],[data-people-block],[data-people-unblock],[data-people-retry]');
    if (!el) return;
    const d = el.dataset;
    if (d.peopleTab) {
      peopleTab = d.peopleTab;
      document.body.classList.remove('message-chat-active');
      location.hash = '#friends';
      route();
    }
    if (d.openFriend) openFriendChat(el, d.openFriend);
    if (d.peopleAdd) peopleAction(el, 'add', d.peopleAdd);
    if (d.peopleAccept) peopleAction(el, 'accept', d.peopleAccept);
    if (d.peopleDecline) peopleAction(el, 'decline', d.peopleDecline);
    if (d.peopleCancel) peopleAction(el, 'cancel', d.peopleCancel);
    if (d.peopleRemove) peopleAction(el, 'remove', d.peopleRemove);
    if (d.peopleBlock) peopleAction(el, 'block', d.peopleBlock);
    if (d.peopleUnblock) peopleAction(el, 'unblock', d.peopleUnblock);
    if (d.peopleRetry !== undefined) loadPeople();
    if (d.chatCompose !== undefined) openCompose();
    if (d.closeChatCompose !== undefined) closeCompose();
    if (d.openChat) location.hash = `#chat/${d.openChat}`;
    if (d.chatRetry !== undefined) loadInbox(document.getElementById('chatSearch')?.value || '');
    if (d.selectFriend) {
      if (selectedIds().includes(d.selectFriend)) document.querySelector(`#selectedFriends [data-selected-id="${CSS.escape(d.selectFriend)}"]`)?.remove();
      else document.getElementById('selectedFriends')?.insertAdjacentHTML('beforeend', `<span data-selected-id="${esc(d.selectFriend)}">${esc(profiles[d.selectFriend]?.full_name || profiles[d.selectFriend]?.username)}<button data-remove-friend="${esc(d.selectFriend)}" aria-label="Remove">${ic('x',13)}</button></span>`);
      updateSelection();
    }
    if (d.removeFriend) { document.querySelector(`#selectedFriends [data-selected-id="${CSS.escape(d.removeFriend)}"]`)?.remove(); updateSelection(); }
    if (d.createChat !== undefined) createConversation(el);
    if (d.chatSend !== undefined) sendMessage(el);
    if (d.chatRecord !== undefined) startRecording(el);
    if (d.voicePause !== undefined && recorder) {
      if (recorder.state === 'recording') {
        recordingElapsed = recordingDuration();
        recorder.pause();
      } else if (recorder.state === 'paused') {
        recordingStartedAt = performance.now();
        recorder.resume();
      }
    }
    if (d.voiceStop !== undefined) finishRecording();
    if (d.voiceCancel !== undefined) finishRecording(true);
    if (d.chatMedia !== undefined) openMediaPicker();
    if (d.closeMedia !== undefined) closeMediaPicker();
    if (d.mediaProvider) renderMediaProvider(d.mediaProvider);
    if (d.mediaLoadMore !== undefined) searchMediaPicker(mediaQuery, true);
    if (d.mediaRetry && !el.disabled) {
      mediaPageError = false;
      if (d.mediaRetry === 'more') {
        mediaKindHasMore[mediaKind] = true;
        searchMediaPicker(mediaQuery, true);
      } else {
        searchMediaPicker(mediaQuery);
      }
    }
    if (d.mediaBack !== undefined) {
      mediaSearchSequence++;
      clearTimeout(mediaSearchTimer);
      mediaProvider = '';
      document.getElementById('chatMediaPicker').classList.remove('provider-open');
      document.getElementById('mediaProviderPanel').hidden = true;
      document.getElementById('mediaContactPicker').hidden = true;
      document.getElementById('mediaMenu').hidden = false;
    }
    if (d.mediaAction === 'gallery') document.getElementById('chatFiles')?.click();
    if (d.mediaAction === 'document') document.getElementById('chatDocuments')?.click();
    if (d.mediaAction === 'audio') document.getElementById('chatAudio')?.click();
    if (d.mediaAction === 'camera') document.getElementById('chatCamera')?.click();
    if (d.mediaAction === 'contact') {
      mediaSearchSequence++;
      mediaProvider = '';
      document.getElementById('mediaMenu').hidden = true;
      document.getElementById('mediaProviderPanel').hidden = true;
      document.getElementById('chatMediaPicker').classList.add('provider-open');
      const contactPanel = document.getElementById('mediaContactPicker');
      contactPanel.hidden = false;
      contactPanel.innerHTML = `<div class="media-provider-head"><button class=media-back data-media-back aria-label="Back to attachments">${ic('left',18)}</button><b>Contacts</b><button class=media-close data-close-media aria-label="Close attachment picker">${ic('x',18)}</button></div><label class=media-search-label><span>${ic('search',17)}</span><input id=mediaContactSearch type=search maxlength=80 placeholder="Find an accepted friend" aria-label="Search contacts"></label><div id=mediaContacts class=media-contact-list></div>`;
      mediaContactsCache = null;
      loadMediaContacts();
    }
    if (d.mediaKind) selectMediaKind(d.mediaKind);
    if (d.mediaSuggestion) {
      const input = document.getElementById('mediaSearchInput');
      if (input) { input.value = d.mediaSuggestion; searchMediaPicker(d.mediaSuggestion); }
    }
    if (d.mediaResult !== undefined) {
      const item = mediaSearchItems[Number(d.mediaResult)];
      if (item) addRemoteMedia(item.url, item.type, item.title);
    }
    if (d.mediaContact) addContact(person(d.mediaContact));
    if (d.chatOlder !== undefined) loadOlder();
    if (d.mention) insertMention(d.mention);
    if (d.removeFile !== undefined) {
      const [file] = pendingFiles.splice(Number(d.removeFile), 1);
      const url = file && pendingPreviewUrls.get(file);
      if (url) URL.revokeObjectURL(url);
      renderPending();
    }
    if (d.removeRemote !== undefined) { pendingRemote.splice(Number(d.removeRemote), 1); renderPending(); }
    if (d.removeContact !== undefined) { pendingContacts.splice(Number(d.removeContact), 1); renderPending(); }
  });

  document.addEventListener('input', event => {
    const input = event.target;
    if (input.id === 'chatSearch') loadInbox(input.value);
    if (input.id === 'friendSearch') findFriends(input.value, document.getElementById('friendResults'));
    if (input.id === 'chatInput') mentionSuggestions(input);
    if (input.id === 'chatInput') resizeChatInput(input);
    if (input.id === 'mediaContactSearch') loadMediaContacts(input.value);
    if (input.id === 'mediaSearchInput') {
      clearTimeout(mediaSearchTimer);
      if (input.value.trim().length >= 1) {
        mediaSearchTimer = setTimeout(() => searchMediaPicker(input.value), 350);
      } else if (mediaProvider === 'giphy' || mediaProvider === 'klipy') {
        mediaSearchTimer = setTimeout(() => searchMediaPicker(''), 180);
      } else {
        mediaSearchSequence++;
        mediaSearchItems = [];
        renderMediaResults();
      }
    }
    if (input.id === 'peopleSearch') {
      peopleQuery = input.value;
      clearTimeout(peopleSearchTimer);
      peopleSearchTimer = setTimeout(loadPeople, 180);
    }
  });

  document.addEventListener('scroll', event => {
    const target = event.target;
    if (target?.id !== 'mediaSearchResults' || mediaPageError || !['giphy', 'klipy'].includes(mediaProvider)) return;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 180) searchMediaPicker(mediaQuery, true);
  }, true);

  document.addEventListener('change', event => {
    if (['chatFiles', 'chatCamera', 'chatDocuments', 'chatAudio'].includes(event.target.id)) {
      addFiles([...event.target.files]);
      event.target.value = '';
      closeMediaPicker();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.target.id === 'chatInput' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); sendMessage(document.querySelector('[data-chat-send]'));
    }
    if (event.target.id === 'mediaSearchInput' && event.key === 'Enter') {
      event.preventDefault();
      if (event.target.value.trim() || mediaProvider === 'giphy' || mediaProvider === 'klipy') searchMediaPicker(event.target.value);
    }
    if (event.key === 'Escape') { closeCompose(); closeMediaPicker(); }
  });

  document.addEventListener('paste', event => {
    if (event.target.id !== 'chatInput') return;
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) addFiles(files);
  });

  window.addEventListener('hashchange', () => {
    if (recorder) finishRecording(true);
    if (!(location.hash || '').startsWith('#chat') && liveChannel) {
      sb.removeChannel(liveChannel); liveChannel = null; activeThread = null;
    }
  });
})();
