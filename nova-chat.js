/* Mobile-first private chat for accepted friends. Requires chat-schema.sql. */
(function () {
  const { sb, esc, t } = Nova, ic = Nova.ic;
  if (typeof V === 'undefined') return;

  const MAX_FILE = 20 * 1024 * 1024, MAX_ATTACHMENTS = 8, PAGE_SIZE = 60;
  const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/ogg,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,audio/x-wav,application/pdf,text/plain';
  const MIME = new Set(ACCEPT.split(','));
  let liveChannel = null, activeThread = null, threadMembers = [], profiles = {}, messages = [], oldestMessage = null;
  let pendingFiles = [], mentionedUsers = new Map(), recorder = null, recordedChunks = [];

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
  const titleFor = (conversation, members) => conversation.is_group
    ? (conversation.title || members.map(m => person(m.user_id).full_name || person(m.user_id).username).join(', '))
    : (() => { const p = person(members.find(m => m.user_id !== U.id)?.user_id); return p.full_name || `@${p.username}`; })();

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
    return shell('chat', `${mbar('Chats', route ? `<button class="ib" data-go="chat" aria-label="All chats">${ic('left')}</button>` : `<button class="btn pri sm" data-chat-compose>${ic('plus',15)} New</button>`, route ? 'chat' : 'home')}${body}`);
  }

  function peopleRow(user, subtitle, actions = '', tail = '') {
    const id = esc(user.id);
    return `<article class=people-row><button class=people-identity data-go="user/${id}" aria-label="View ${esc(user.full_name || user.username)}">${Nova.avatar(user, 48)}<span><b>${esc(user.full_name || user.username || 'User')}</b><small>@${esc(user.username || '')}</small>${subtitle ? `<small class=people-subtitle>${esc(subtitle)}</small>` : ''}</span></button><div class=people-actions>${tail}${actions}</div></article>`;
  }

  function peopleTabs() {
    const tabs = [['friends','Friends'],['recents','Recents'],['requests','Requests'],['blocked','Blocked']];
    return `<nav class=people-tabs aria-label="People">${tabs.map(([key,label]) => `<button class="${peopleTab===key?'on':''}" data-people-tab="${key}">${label}${key==='requests'&&REQ.length?`<i>${REQ.length}</i>`:''}</button>`).join('')}</nav>`;
  }

  V.friends = () => {
    setTimeout(() => { bindRealtime(); loadPeople(); }, 0);
    return shell('friends', `${mbar('People')}
      <section class="people-page">
        <label class="chat-search people-search"><span>${ic('search')}</span><input id=peopleSearch type=search autocomplete=off placeholder="Search username" aria-label="Search users by username" value="${esc(peopleQuery)}"></label>
        ${peopleTabs()}
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
      let recents = [];
      const { data: conversations, error: conversationError } = await sb.from('conversations')
        .select('id,title,is_group,last_message_at,conversation_members!inner(user_id)')
        .eq('conversation_members.user_id', U.id).order('last_message_at', { ascending: false }).limit(50);
      if (conversationError) throw conversationError;
      const conversationIds = (conversations || []).map(row => row.id);
      if (conversationIds.length) {
        const { data: members, error: memberError } = await sb.from('conversation_members')
          .select('conversation_id,user_id').in('conversation_id', conversationIds);
        if (memberError) throw memberError;
        const chatById = new Map((conversations || []).map(row => [row.id, row]));
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

      let searchProfiles = [];
      if (peopleTab === 'friends' && q.length >= 2) {
        const safeQuery = q.replace(/[^a-z0-9_.]/g, '');
        if (safeQuery.length >= 2) {
          const { data, error } = await sb.from('public_profiles').select('id,full_name,username,avatar_url')
            .ilike('username', `%${safeQuery}%`).neq('id', U.id).limit(40);
          if (error) throw error;
          searchProfiles = data || [];
        }
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
      const empty = text => `<div class=chat-empty><span>${ic('users',28)}</span><p>${esc(text)}</p></div>`;
      const usernameMatches = id => (person(id).username || '').toLowerCase().includes(q);
      let content = '';
      if (peopleTab === 'friends') {
        const ids = q.length >= 2 ? searchProfiles.map(user => user.id) : accepted;
        content = ids.length ? ids.map(id => peopleRow(person(id), friendIds.has(id) ? 'Your friend' : blockedIds.has(id) ? 'Blocked' : requestedYou.has(id) ? 'Sent you a request' : requestSent.has(id) ? 'Request sent' : 'Find people by username', actionFor(id))).join('')
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
        const face = c.is_group ? `<span class=chat-group-avatar>${ic('users',20)}</span>` : Nova.avatar(person(members.find(m => m.user_id !== U.id)?.user_id), 48);
        return `<button class=chat-row data-open-chat="${esc(c.id)}">${face}<span class=chat-row-copy><b>${esc(titleFor(c, members))}</b><small>${esc(sub)}</small></span>${unread ? '<i class=chat-unread aria-label="Unread"></i>' : ''}<time>${last ? new Date(last.created_at).toLocaleDateString() : ''}</time></button>`;
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
      await loadProfiles(threadMembers.map(m => m.user_id));
      const myMember = threadMembers.find(m => m.user_id === U.id);
      if (myMember) {
        const { error: readError } = await sb.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', id).eq('user_id', U.id);
        if (readError) throw readError;
      }
      target.innerHTML = `<header class=chat-head><div class=chat-head-person>${conversation.is_group ? `<span class=chat-group-avatar>${ic('users',20)}</span>` : Nova.avatar(person(threadMembers.find(m => m.user_id !== U.id)?.user_id), 42)}<span><b>${esc(titleFor(conversation, threadMembers))}</b><small>${conversation.is_group ? `${threadMembers.length} members` : `@${esc(person(threadMembers.find(m => m.user_id !== U.id)?.user_id).username)}`}</small></span></div></header>
        <div id=chatMessages class=chat-messages><p class=chat-loading>Loading messages…</p></div><div id=mentionList class=mention-list hidden></div>
        <div id=pendingFiles class=pending-files></div><div class=chat-compose>
          <label class="icon-btn attach-btn" title="Attach media or file">${ic('paperclip')}<input type=file id=chatFiles accept="${ACCEPT}" multiple hidden aria-label="Attach media or file"></label>
          <textarea id=chatInput rows=1 maxlength=5000 placeholder="Message… Use @ to mention a friend" aria-label="Message"></textarea>
          <button class="icon-btn record-btn" data-chat-record title="Record a voice message" aria-label="Record a voice message">${ic('mic')}</button>
          <button class="icon-btn send-btn" data-chat-send title="Send message" aria-label="Send message">${ic('send')}</button>
        </div><p class=chat-hint>Private to conversation members · files up to 20 MB</p>`;
      await loadMessages(true);
    } catch (error) {
      target.innerHTML = `<div class=chat-empty><b>Conversation unavailable</b><p>${esc(friendlyError(error))}</p><button class="btn sec" data-go=chat>Back to chats</button></div>`;
    }
  }

  async function formatAttachments(attachments) {
    const list = await Promise.all((attachments || []).map(async attachment => {
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
    const sender = mine ? '' : `<small class=message-sender>${esc(person(message.sender_id).full_name || person(message.sender_id).username)}</small>`;
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
    const value = query.trim().replace(/^@/, '').replace(/[%_*]/g, '');
    if (value.length < 2) { target.innerHTML = '<p class=chat-hint>Enter at least 2 characters of a username.</p>'; return; }
    const { data: relationships, error } = await acceptedFriendIds();
    if (error) { target.innerHTML = `<p class=chat-error>${esc(error.message)}</p>`; return; }
    const ids = [...new Set((relationships || []).map(r => r.user_id === U.id ? r.friend_id : r.user_id))];
    if (!ids.length) { target.innerHTML = '<p class=chat-hint>Accept a friend request before starting a chat.</p>'; return; }
    if (!/^[\p{L}\p{N}_.-]+$/u.test(value)) { target.innerHTML = '<p class=chat-hint>Search with a username.</p>'; return; }
    const { data, error: searchError } = await sb.from('public_profiles').select('id,full_name,username,avatar_url')
      .in('id', ids).ilike('username', `%${value}%`).limit(20);
    if (searchError) { target.innerHTML = `<p class=chat-error>${esc(searchError.message)}</p>`; return; }
    (data || []).forEach(p => { profiles[p.id] = p; });
    target.innerHTML = data?.length ? data.map(p => `<button class=friend-search-row data-select-friend="${esc(p.id)}">${Nova.avatar(p,42)}<span><b>${esc(p.full_name || p.username)}</b><small>@${esc(p.username)}</small></span><i>${ic('check',16)}</i></button>`).join('') : '<p class=chat-hint>No accepted friend matched that username.</p>';
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

  function mentionSuggestions(input) {
    const start = input.selectionStart, before = input.value.slice(0, start), match = before.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
    const list = document.getElementById('mentionList');
    if (!list) return;
    if (!match) { list.hidden = true; return; }
    const query = match[1].toLowerCase(), candidates = threadMembers.filter(m => m.user_id !== U.id)
      .filter(m => (person(m.user_id).username || '').toLowerCase().startsWith(query));
    if (!candidates.length) { list.hidden = true; return; }
    list.innerHTML = candidates.slice(0, 6).map(m => `<button data-mention="${esc(m.user_id)}">${Nova.avatar(person(m.user_id),28)}<span>@${esc(person(m.user_id).username)}</span></button>`).join('');
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
    target.innerHTML = pendingFiles.map((file, index) => `<span>${ic(file.type.startsWith('audio/') ? 'mic' : 'file',15)}${esc(file.name)}<button data-remove-file="${index}" aria-label="Remove ${esc(file.name)}">${ic('x',13)}</button></span>`).join('');
  }

  function addFiles(files) {
    for (const file of files) {
      if (!MIME.has((file.type || '').split(';')[0].toLowerCase())) { Nova.toast(`${file.name}: this file type is not supported.`, 'err'); continue; }
      if (file.size > MAX_FILE) { Nova.toast(`${file.name} is larger than 20 MB.`, 'err'); continue; }
      if (pendingFiles.length >= MAX_ATTACHMENTS) { Nova.toast(`You can attach up to ${MAX_ATTACHMENTS} files per message.`, 'err'); break; }
      pendingFiles.push(file);
    }
    renderPending();
  }

  async function sendMessage(button) {
    const input = document.getElementById('chatInput');
    const body = input?.value.trim() || '', files = [...pendingFiles];
    if ((!body && !files.length) || !activeThread) return;
    setBusy(button, true);
    const uploaded = [];
    try {
      const attachments = [];
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
      input.value = ''; pendingFiles = []; mentionedUsers.clear(); renderPending(); await loadMessages(true);
    } catch (error) {
      if (uploaded.length) {
        const { error: cleanupError } = await sb.storage.from('chat-media').remove(uploaded);
        if (cleanupError) console.error('Could not clean up failed chat uploads:', cleanupError);
      }
      Nova.toast(error.message || 'Message was not sent.', 'err');
    } finally { setBusy(button, false); }
  }

  async function startRecording(button) {
    if (recorder && recorder.state === 'recording') { recorder.stop(); button.classList.remove('recording'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return Nova.toast('Voice recording is not supported by this browser.', 'err');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const type = types.find(t => MediaRecorder.isTypeSupported(t));
      recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      recordedChunks = [];
      let stopTimer;
      recorder.ondataavailable = event => { if (event.data.size) recordedChunks.push(event.data); };
      recorder.onerror = event => Nova.toast(event.error?.message || 'Voice recording failed.', 'err');
      recorder.onstop = () => {
        clearTimeout(stopTimer);
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > MAX_FILE) Nova.toast('That voice message is larger than 20 MB.', 'err');
        else if (blob.size) addFiles([new File([blob], `voice-${Date.now()}.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`, { type: blob.type })]);
        recorder = null; button.classList.remove('recording');
      };
      recorder.start(); button.classList.add('recording'); Nova.toast('Recording… tap the microphone again to finish (max 3 minutes).');
      stopTimer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 180000);
    } catch (error) { Nova.toast(error.message || 'Microphone permission was denied.', 'err'); }
  }

  document.addEventListener('click', async event => {
    const el = event.target.closest('[data-chat-compose],[data-open-chat],[data-chat-retry],[data-select-friend],[data-remove-friend],[data-create-chat],[data-close-chat-compose],[data-chat-send],[data-chat-record],[data-chat-older],[data-mention],[data-remove-file],[data-people-tab],[data-people-add],[data-people-accept],[data-people-decline],[data-people-cancel],[data-people-remove],[data-people-block],[data-people-unblock],[data-people-retry]');
    if (!el) return;
    const d = el.dataset;
    if (d.peopleTab) { peopleTab = d.peopleTab; route(); }
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
    if (d.chatOlder !== undefined) loadOlder();
    if (d.mention) insertMention(d.mention);
    if (d.removeFile !== undefined) { pendingFiles.splice(Number(d.removeFile), 1); renderPending(); }
  });

  document.addEventListener('input', event => {
    const input = event.target;
    if (input.id === 'chatSearch') loadInbox(input.value);
    if (input.id === 'friendSearch') findFriends(input.value, document.getElementById('friendResults'));
    if (input.id === 'chatInput') mentionSuggestions(input);
    if (input.id === 'peopleSearch') {
      peopleQuery = input.value;
      clearTimeout(peopleSearchTimer);
      peopleSearchTimer = setTimeout(loadPeople, 180);
    }
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'chatFiles') {
      addFiles([...event.target.files]);
      event.target.value = '';
    }
  });

  document.addEventListener('keydown', event => {
    if (event.target.id === 'chatInput' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); sendMessage(document.querySelector('[data-chat-send]'));
    }
    if (event.key === 'Escape') closeCompose();
  });

  window.addEventListener('hashchange', () => {
    if (!(location.hash || '').startsWith('#chat') && liveChannel) {
      sb.removeChannel(liveChannel); liveChannel = null; activeThread = null;
    }
  });
})();
