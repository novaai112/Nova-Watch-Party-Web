/* nova-profile.js — profile sections (Info, Stats, Gallery, Friends, Social, Notifications, Activity, visitor view),
   the Edit popups and the gallery uploader. Loaded by profile.html right after its inline script. */
(function () {
  const { sb, esc, t } = Nova, ic = Nova.ic;
  // ---- call these from your video player page ----
  Nova.logWatch = v => sb.rpc('log_watch', { p_url: v.url, p_title: v.title || '', p_thumb: v.thumb || null, p_source: v.source || 'web', p_channel: v.channel || null, p_nsfw: !!v.nsfw, p_seconds: v.seconds || 0 });
  Nova.setLike = (url, liked) => sb.rpc('set_like', { p_url: url, p_liked: liked });
  if (typeof V === 'undefined') return;

  const SOC = Nova.SOC;
  let TAB = 'top';
  const STOP = new Set('the and for with from this that official video full song hd new feat lyrical lyric audio you your are was not'.split(' '));
  const COL = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#22c55e', '#ef4444', '#64748b'];
  const okUrl = u => /^https?:\/\//i.test(u || '') ? esc(u) : '';
  const gUrl = p => sb.storage.from('gallery').getPublicUrl(p).data.publicUrl;
  const dateF = d => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const stat = () => (PD && PD.stats) || { videos: 0, hours: 0, friends: 0 };
  const fc = (i, l, v, cls = '') => `<div class="fc ${cls}"><span class=fi>${ic(i, 18)}</span><div class=fv><small>${l}</small>${v}</div></div>`;
  const eye = k => PD && PD.own ? `<button class="ib sm" data-vis=${k} title="${PD.visibility[k] === false ? 'Hidden from others' : 'Visible to others'}" aria-label="Toggle visibility">${ic(PD.visibility[k] === false ? 'eyeoff' : 'eye', 16)}</button>` : '';

  /* ---------- modal ---------- */
  function closeM() { const m = document.getElementById('mdl'); if (m) m.remove(); document.body.classList.remove('lock'); }
  function modal(title, body) {
    closeM();
    const o = document.createElement('div'); o.className = 'ov c'; o.id = 'mdl'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
    o.innerHTML = `<div class=modal><div class=mh>${ic('settings', 18)}<b>${title}</b><button class=mx data-close aria-label="Close">${ic('x', 18)}</button></div><div class=mb>${body}</div></div>`;
    o.addEventListener('mousedown', e => { if (e.target === o) closeM(); });
    document.body.append(o); document.body.classList.add('lock'); return o;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeM(); });

  /* ---------- shared fragments ---------- */
  const gridItems = (list, own) => list.map((x, i) => {
    const path = typeof x === 'string' ? x : x.path, u = esc(gUrl(path));
    return `<div class=gt><button class=gtb data-lb="${u}" aria-label="Open photo ${i + 1}"><img src="${u}" alt="" loading=lazy></button>${own ? `<button class=x data-act=delG data-id="${x.id}" data-p="${esc(path)}" aria-label="Delete photo">${ic('x', 15)}</button>` : ''}</div>`;
  }).join('');
  const gridG = (list, own) => `<div class=gg>${gridItems(list, own)}</div>`;
  function gHTML() {
    const g = P._g || [];
    return `${P._gerr ? `<div class=gerr>${ic('alert', 16)}<span>Gallery is not ready: ${esc(P._gerr)}. Run <b>fix-gallery-permissions.sql</b> in Supabase once.</span></div>` : ''}
${g.length ? `<div class=gg>${g.length<MAXG?`<label class="gt gadd" for=gf aria-label="Add photos" title="Add photos">${ic('plus',28)}</label>`:''}${gridItems(g,true)}</div>` : `<label class=dz id=dz for=gf><div>${ic('upload',24)}</div><div><b>Add photos</b> or drag &amp; drop</div><small>Select several at once · up to ${MAXG} photos · optimised automatically</small></label>`}`;
  }
  const kwHTML = titles => {
    const c = {}; (titles || []).join(' ').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.forEach(w => { if (!STOP.has(w) && !/^\d+$/.test(w)) c[w] = (c[w] || 0) + 1; });
    const kw = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 15);
    return kw.length ? `<div class=chips>${kw.map(([w, n]) => `<span class=chip>${esc(w)} <small>${n}</small></span>`).join('')}</div>` : '<span class=mu>Nothing here yet</span>';
  };
  const chHTML = ch => (ch && ch.length) ? `<div class=chips>${ch.map(c => `<span class=chip>${esc(c.name)} <small>${c.n}</small></span>`).join('')}</div>` : '<span class=mu>Nothing here yet</span>';
  const donutHTML = it => {
    if (!it || !it.length) return '<span class=mu>Nothing here yet</span>';
    const tot = it.reduce((a, b) => a + b.n, 0) || 1; let acc = 0;
    const stops = it.map((x, i) => { const a = acc / tot * 100; acc += x.n; return `${COL[i % 8]} ${a}% ${acc / tot * 100}%`; }).join(',');
    return `<div class=donutw><div class=donut style="background:conic-gradient(${stops})"><div>Sites</div></div><div class=legend>${it.map((x, i) => `<div><i style="background:${COL[i % 8]}"></i>${esc(x.name)}<b>${Math.round(x.n / tot * 100)}%</b></div>`).join('')}</div></div>`;
  };
  const vidHTML = list => list && list.length ? `<div class=vrow>${list.map(v => `<a class=vid href="${okUrl(v.video_url)}" target=_blank rel=noopener><img src="${okUrl(v.thumb)}" alt="" onerror="this.style.visibility='hidden'"><b>${esc(v.title)}</b><small>${v.watch_count} views</small></a>`).join('')}</div>` : '<span class=mu>Nothing here yet</span>';
  const socChips = (s, own) => {
    const chips = Object.entries(s || {}).filter(([k, v]) => (SOC[k] || k === 'website') && v).map(([k, v]) => {
      const info = k === 'website' ? { n: 'Website', u: '', i: 'globe' } : SOC[k];
      const href = k === 'website' ? okUrl(v) : info.u ? esc(info.u + encodeURIComponent(v)) : '';
      const label = k === 'website' ? esc(String(v).replace(/^https?:\/\//, '')) : info.u ? esc(info.n) : `${esc(info.n)} · ${esc(v)}`;
      return href ? `<a class=chip href="${href}" target=_blank rel="noopener noreferrer">${ic(info.i, 16)}${label}</a>` : `<span class=chip>${ic(info.i, 16)}${label}</span>`;
    }).join('');
    return chips ? `<div class=chips>${chips}</div>` : `<div class=empty>${ic('link', 28)}<p>${own ? 'No social links yet' : 'No links'}</p>${own ? `<button class="btn pri sm" data-act=editsoc>${ic('plus', 15)}Add links</button>` : ''}</div>`;
  };
  const frTile = u => `<button class=frc data-go="user/${u.id}">${Nova.avatar(u, 56)}<b>${esc(u.full_name || u.username || '')}</b><small>@${esc(u.username || '')}</small></button>`;
  /* "Location" card on the user's own profile. Hide Location ON -> no city/map, the country flag stays. */
  const locCard = () => {
    const g = Nova.geo, hide = !!Nova.S.hideLoc, m = g.mask(P, hide), tx = g.text(m);
    const upd = label => `<button type="button" class="btn sm" data-geo-update>${label}</button>`;
    if (!P.country_code) return `<div class="geo-card"><span class="biot mu">Not shared yet</span><div class="geo-acts">${upd('Allow location')}</div></div>`;
    const cn = esc(g.cname(P.country_code, P.country || ''));
    if (hide) return `<div class="geo-card"><b>${g.flag(P.country_code, 16)}${cn}</b><span class="geo-hint">Your city and map location are hidden. Only your country flag is visible.</span><div class="geo-acts">${upd('Update')}</div></div>`;
    return `<div class="geo-card"><b>${tx ? esc(tx) : cn}</b><div class="geo-acts">${g.mapBtn(m)}${upd('Update')}</div></div>`;
  };
  const profileAvatar = (u, size) => `<button class=profile-avatar-link data-go="user/${esc(u.id)}" aria-label="View ${esc(u.full_name || u.username || 'user')} profile">${Nova.avatar(u, size)}${Nova.geo.badge(u, size)}</button>`;
  const publicRoomCard = (room, error) => {
    if (!room) return error
      ? `<section class="card pad public-room-unavailable"><b>Public room status unavailable</b><small>Run the latest rooms-schema.sql in Supabase to enable room profiles.</small></section>`
      : '';
    const media = room.media || {}, thumbnail = media.thumb || (media.kind === 'youtube' && media.id ? `https://i.ytimg.com/vi/${encodeURIComponent(media.id)}/mqdefault.jpg` : '');
    const members = (room.members || []).map(u => `<button class="public-room-avatar${u.is_admin ? ' admin' : ''}" data-go="user/${esc(u.id)}" aria-label="View ${esc(u.full_name || u.username || 'member')} profile" title="${esc(u.full_name || u.username || 'Member')}">${Nova.avatar(u, 32)}</button>`).join('');
    const title = media.title || room.title || 'Watch together';
    return `<section class="card public-room-card">
      <a class="public-room-link" href="nova-home.html#join/${encodeURIComponent(room.code)}" aria-label="Join public room: ${esc(title)}"></a>
      <div class="public-room-content">
       <div class="public-room-media">${thumbnail ? `<img src="${esc(thumbnail)}" alt="" referrerpolicy="no-referrer">` : ''}<b>${esc(title)}</b></div>
       <div class="public-room-members" aria-label="Room members"><div class="public-room-member-list">${members}</div></div>
      </div>
    </section>`;
  };

  /* ---------- OWN VIEWS ---------- */
  V.info = () => shell('info', mbar(t('info')) + panel(t('info'), 'Your photo, name, username and bio',
    `<div class=actg>${eye('bio')}<button class="btn sec sm" data-go=preview>${ic('eye', 16)}${t('preview')}</button><button class="btn pri sm" data-act=editinfo>${ic('pencil', 15)}${t('edit')}</button></div>`,
    `<div class=idstrip>${avtap(76, 'ring')}<div class=idt><h3>${esc(P.full_name || '')}</h3><p>@${esc(P.username || '')}</p>${Nova.geo.line(Nova.geo.mask(P, Nova.S.hideLoc))}<div class=pills>${isVer() ? `<span class="pill ok">✓ ${t('verified')}</span>` : ''}${planPill()}</div></div></div>
<div class=fgrid>${fc('user', 'Full name', `<b>${esc(P.full_name || '—')}</b>`)}${fc('at', 'Username', `<b>@${esc(P.username || '')}</b>`)}${fc('pin', 'Location', locCard(), 'wide')}${fc('mail', 'Email address', `<b>${esc(U.email)}</b>`, 'wide')}${fc('pencil', 'Bio', P.bio ? `<span class=biot>${esc(P.bio)}</span>` : '<span class="biot mu">No bio yet</span>', 'wide bio')}</div>`));

  V.stats = () => {
    const s = stat(), provs = ((P.providers && P.providers.length) ? P.providers : (U.app_metadata.providers || [])).map(p => p === 'email' ? 'Email & password' : p.charAt(0).toUpperCase() + p.slice(1)).join(' + ') || '—';
    return shell('stats', mbar(t('accstats')) + panel(t('accstats'), 'Your activity at a glance', eye('stats') ? `<div class=actg>${eye('stats')}</div>` : '',
      `<div class=fgrid>${fc('calendar', 'Member since', `<b>${dateF(P.created_at || U.created_at)}</b>`)}${fc('key', 'Login methods', `<b>${esc(provs)}</b>`)}${fc('sparkles', 'Plan', `<b>${PLAN.pro ? 'Pro Plan' : 'Free Plan'}${PLAN.end ? ' · until ' + dateF(PLAN.end) : ''}</b>`)}${fc('badge', 'Email', `<b>${isVer() ? 'Verified' : 'Not verified'}</b>`)}</div>
<div class=tiles><div class="tile blue"><b>${s.videos}</b><span>Videos watched</span></div><div class="tile green"><b>${s.hours}</b><span>Hours watched</span></div><div class="tile indigo"><b>${s.friends}</b><span>${t('friends')}</span></div><div class="tile yellow"><b>${(P._g || []).length}</b><span>Photos</span></div></div>`));
  };

  V.gallery = () => shell('gallery', mbar(t('gallery')) + panel(t('gallery'), `<span id=gcnt>${(P._g || []).length} / ${MAXG}</span> photos`, eye('gallery') ? `<div class=actg>${eye('gallery')}</div>` : '', `<div id=gsec>${gHTML()}</div>`));

  V.friends = () => {
    const f = PD.friends || [];
    return shell('friends', mbar(t('friends')) + panel(t('friends'), `${f.length} friend${f.length === 1 ? '' : 's'}`, eye('friends') ? `<div class=actg>${eye('friends')}</div>` : '',
      `<div class=pbody><div class=addf><div class=pre><b>@</b><input id=fu placeholder="Add friend by username" autocapitalize=none spellcheck=false aria-label="Friend username"></div><button class="btn pri" data-add>${ic('userplus', 16)}Add friend</button></div><div class=hint id=fo></div>
${REQ.length ? `<h3 class=sub style="margin-top:22px">Requests</h3>${REQ.map(r => `<div class=reqr>${profileAvatar(r, 44)}<div class=fv><b>${esc(r.full_name || r.username)}</b><small>@${esc(r.username || '')} wants to be friends</small></div><button class="btn pri sm" data-acc=${r.id}>Accept</button><button class="ib sm" data-dec=${r.id} aria-label="Decline">${ic('x', 15)}</button></div>`).join('')}` : ''}
${f.length ? `<div class=frg>${f.map(frTile).join('')}</div>` : `<div class=empty>${ic('users', 30)}<p>No friends yet. Add someone by username.</p></div>`}</div>`));
  };

  V.social = () => shell('social', mbar(t('social')) + panel(t('social'), 'Links to your other profiles', `<div class=actg>${eye('socials')}<button class="btn pri sm" data-act=editsoc>${ic('pencil', 15)}${t('edit')}</button></div>`, `<div class=pbody>${socChips(P.socials, true)}</div>`));

  V.notifications = () => shell('notifications', mbar(t('notification')) + panel(t('notification'), 'Friend requests and updates', '', `<div class=rows>
<label class=row><span class=i>${ic('bell')}</span><span class=m>${t('notification')}<small>Get notified about requests and invitations</small></span><input type=checkbox class=sw data-k=notif ${Nova.S.notif ? 'checked' : ''}></label></div>
${REQ.length ? `<div class=pbody style="border-top:1px solid var(--line)">${REQ.map(r => `<div class=reqr>${profileAvatar(r, 44)}<div class=fv><b>${esc(r.full_name || r.username)}</b><small>@${esc(r.username || '')} sent you a friend request</small></div><button class="btn pri sm" data-acc=${r.id}>Accept</button><button class="ib sm" data-dec=${r.id} aria-label="Decline">${ic('x', 15)}</button></div>`).join('')}</div>`
      : `<div class=empty style="border-top:1px solid var(--line)">${ic('bell', 30)}<p>${t('nonotif')}</p></div>`}`));

  V.activity = () => {
    const d = PD, can = !Nova.S.hideMature && !!Nova.maturityVerified, v = d.videos || { top: [], history: [], liked: [] };
    const sh = (k, title, body, extra = '') => `<div class=subh><h3>${title}</h3><span class=actg>${extra}${eye(k)}</span></div>${body}`;
    return shell('activity', mbar(t('activity')) + panel(t('activity'), 'What you watch on Nova',
      `<div class=actg><label class=nsfw style="${can ? '' : 'opacity:.5'}" title="${can ? '' : 'Turn off Hide Mature Content in Settings first'}">Include 🔞 NSFW <input type=checkbox class=sw data-nsfw ${NSFW && can ? 'checked' : ''} ${can ? '' : 'disabled'}></label></div>`,
      `<div class=pbody>${sh('videos', 'Videos', `<div class=tabs>${['top', 'history', 'liked'].map(k => `<button class="tab${TAB === k ? ' on' : ''}" data-tab=${k}>${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}${TAB === 'history' ? '<button class=tab data-clear>Clear</button>' : ''}</div><div style="margin-top:12px">${vidHTML(v[TAB])}</div>`)}
${sh('keywords', 'Keywords', kwHTML(d.titles))}${sh('channels', 'Channels', chHTML(d.channels))}${sh('interests', 'Interests', donutHTML(d.interests))}</div>`));
  };

  /* ---------- VISITOR / PREVIEW ---------- */
  function profileFriendActions(profile, preview) {
    if (preview || profile.own || PROFILE_RELATION?.userId !== profile.id) return '';
    const state = PROFILE_RELATION.status, userId = esc(profile.id);
    if (state === 'loading') return `<div class="profile-friend-actions"><span class=mu>Loading friendship…</span></div>`;
    if (state === 'error') return `<div class="profile-friend-actions"><span class="hint bad">Friend actions unavailable: ${esc(PROFILE_RELATION.error || 'Could not load friendship status.')}</span></div>`;
    if (state === 'friend') return `<div class=profile-friend-actions><span class=people-status>Friend</span><button class="btn sec sm" data-profile-friend=remove data-user-id="${userId}">Remove Friend</button><button class="btn sec sm" data-profile-friend=block data-user-id="${userId}">${ic('shield',15)} Block</button><button class="btn sec sm" data-msg-profile="${userId}">${ic('chat',15)} Message</button></div>`;
    if (state === 'incoming') return `<div class=profile-friend-actions><button class="btn pri sm" data-profile-friend=accept data-user-id="${userId}">${ic('check',15)} Accept Request</button><button class="btn sec sm" data-profile-friend=decline data-user-id="${userId}">${ic('x',15)} Delete Request</button><button class="btn sec sm" data-profile-friend=block data-user-id="${userId}">${ic('shield',15)} Block</button><button class="btn sec sm" data-msg-profile="${userId}">${ic('chat',15)} Message</button></div>`;
    if (state === 'outgoing') return `<div class=profile-friend-actions><button class="btn sec sm" disabled>Request Sent</button><button class="btn sec sm" data-profile-friend=cancel data-user-id="${userId}">Cancel Request</button><button class="btn sec sm" data-profile-friend=block data-user-id="${userId}">${ic('shield',15)} Block</button><button class="btn sec sm" data-msg-profile="${userId}">${ic('chat',15)} Message</button></div>`;
    if (state === 'blocked') return `<div class=profile-friend-actions><button class="btn sec sm" data-profile-friend=unblock data-user-id="${userId}">Unblock</button></div>`;
    return `<div class=profile-friend-actions><button class="btn pri sm" data-profile-friend=add data-user-id="${userId}">${ic('userplus',15)} Send Friend Request</button><button class="btn sec sm" data-profile-friend=block data-user-id="${userId}">${ic('shield',15)} Block</button><button class="btn sec sm" data-msg-profile="${userId}">${ic('chat',15)} Message</button></div>`;
  }

  async function profileFriendAction(button, action, id) {
    if (!id || PROFILE_RELATION?.userId !== id) return Nova.toast('Friendship status is unavailable. Reload the profile and try again.', 'err');
    button.disabled = true;
    try {
      if (action === 'add') {
        const { error } = await sb.from('friendships').insert({ user_id: U.id, friend_id: id });
        if (error) throw error;
      } else if (action === 'accept') {
        const { data, error } = await sb.from('friendships').update({ status: 'accepted' })
          .eq('user_id', id).eq('friend_id', U.id).eq('status', 'pending').select('user_id').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This friend request is no longer available.');
      } else if (action === 'decline') {
        const { error } = await sb.from('friendships').delete().eq('user_id', id).eq('friend_id', U.id).eq('status', 'pending');
        if (error) throw error;
      } else if (action === 'cancel') {
        const { error } = await sb.from('friendships').delete().eq('user_id', U.id).eq('friend_id', id).eq('status', 'pending');
        if (error) throw error;
      } else if (action === 'remove') {
        if (!await ask('Remove this friend?', 'This ends the friendship. You can send a new request later.', 'Remove')) {
          button.disabled = false;
          return;
        }
        const first = await sb.from('friendships').delete().eq('user_id', U.id).eq('friend_id', id);
        if (first.error) throw first.error;
        const second = await sb.from('friendships').delete().eq('user_id', id).eq('friend_id', U.id);
        if (second.error) throw second.error;
      } else if (action === 'block') {
        if (!await ask('Block this user?', 'This removes your friendship and prevents friend requests and direct chats between you.', 'Block')) {
          button.disabled = false;
          return;
        }
        const { error } = await sb.rpc('block_user', { p_blocked_id: id });
        if (error) throw error;
      } else if (action === 'unblock') {
        const { error } = await sb.rpc('unblock_user', { p_blocked_id: id });
        if (error) throw error;
      } else {
        throw new Error('Unsupported friendship action.');
      }
      const refreshed = await loadProfileRelationship(id);
      route();
      if (!refreshed) {
        Nova.toast('Friendship action completed, but the updated status could not be loaded. Reload the profile.', 'err');
        return;
      }
      const notice = { add: 'Friend request sent', accept: 'Friend request accepted', decline: 'Friend request deleted', cancel: 'Friend request canceled', remove: 'Friend removed', block: 'User blocked', unblock: 'User unblocked' }[action];
      if (notice) Nova.toast(notice);
    } catch (error) {
      Nova.toast(error.message || 'Friendship action failed.', 'err');
      button.disabled = false;
    }
  }

  function visitor(pv) {
    const d = PD, S = d.s || {};
    const sec = (k, icon, title, body) => S[k] ? `<section class=card><h3 class=vt>${ic(icon, 17)}${title}</h3><div class=vb>${body}</div></section>` : '';
    const s = d.stats;
    return `<div class=lite>${pv ? `<div class=pvb><span>${ic('eye', 16)}Previewing as a visitor</span><button class="btn sec sm" data-go=info>Exit preview</button></div>` : `<button class="btn sec sm" data-go=friends style="margin:14px 0">${ic('left', 16)}${t('friends')}</button>`}
<div class=card><div class=vcover></div><div class=vhb>${profileAvatar({id:d.id,full_name:d.name,username:d.username,avatar_url:d.avatar,country_code:d.country_code}, 96)}<h2>${esc(d.name || '')}</h2><div class=mu>@${esc(d.username || '')}</div>${Nova.geo.line({country_code:d.country_code,country:d.country,city:d.city,region:d.region,lat:d.lat,lng:d.lng})}${profileFriendActions(d,pv)}${S.bio && d.bio ? `<p class=vbio>${esc(d.bio)}</p>` : ''}</div></div>
${!pv && !d.own ? publicRoomCard(d.public_room, d.public_room_error) : ''}
${s ? sec('stats', 'chart', t('accstats'), `<div class="tiles profile-stat-tiles"><div class="tile blue"><b>${s.videos}</b><span>Videos</span></div><div class="tile green"><b>${s.hours}</b><span>Hours</span></div><div class="tile indigo"><b>${s.friends}</b><span>${t('friends')}</span></div><div class="tile yellow"><b>${(d.gallery || []).length}</b><span>Photos</span></div></div>`) : ''}
${d.gallery && d.gallery.length ? sec('gallery', 'image', `${t('gallery')} (${d.gallery.length})`, gridG(d.gallery, false)) : ''}
${d.friends && d.friends.length ? sec('friends', 'users', t('friends'), `<div class="frg profile-friends-grid" style="margin:0">${d.friends.map(frTile).join('')}</div>`) : ''}
${d.socials ? sec('socials', 'link', t('social'), socChips(d.socials, false)) : ''}
${d.videos ? sec('videos', 'play', 'Videos', `<div class=tabs>${['top', 'history', 'liked'].map(k => `<button class="tab${TAB === k ? ' on' : ''}" data-tab=${k}>${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div><div style="margin-top:12px">${vidHTML(d.videos[TAB])}</div>`) : ''}
${d.titles ? sec('keywords', 'sparkles', 'Keywords', kwHTML(d.titles)) : ''}${d.channels ? sec('channels', 'play', 'Channels', chHTML(d.channels)) : ''}${d.interests ? sec('interests', 'chart', 'Interests', donutHTML(d.interests)) : ''}</div>${bnav('')}`;
  }
  V.user = () => visitor(false);
  V.preview = () => visitor(true);

  /* ---------- EDIT POPUPS ---------- */
  function editInfo() {
    modal(t('editprofile'), `<div class=mav>${avtap(72)}<div><b style="display:block">Profile photo</b><span class=avnote style="display:block">Tap the photo to change it.</span><span class=avact id=ava>${avActs()}</span></div></div>
<label class=fld><span class=l>Full Name</span><input id=fn maxlength=40 autocomplete=name value="${esc(P.full_name || '')}"></label>
<label class=fld><span class=l>Username</span><div class=pre><b>@</b><input id=un maxlength=24 autocomplete=off autocapitalize=none spellcheck=false value="${esc(P.username || '')}"></div><div class=hint id=uh></div></label>
<label class=fld><span class=l>Email Address</span><input value="${esc(U.email)}" disabled></label><p class=note>Your sign-in email cannot be changed.</p>
<label class=fld><span class=l>Bio <em id=bc></em></span><textarea id=bi maxlength=${MAXB} placeholder="Tell people a little about yourself">${esc(P.bio || '')}</textarea></label>
<div class=macts><button class="btn sec" data-close>${t('cancel')}</button><button class="btn pri" data-act=saveinfo>${t('savechanges')}</button></div>`);
    UN = Nova.unameField($('#un'), $('#uh'), P.username);
    const bc = () => $('#bc').textContent = $('#bi').value.length + ' / ' + MAXB; bc(); $('#bi').addEventListener('input', bc);
  }
  async function saveInfo(btn) {
    const name = $('#fn').value.trim();
    if (name.length < 2) { $('#fn').focus(); return Nova.toast('Please enter your name (2–40 characters)', 'err'); }
    if (UN.pending) return Nova.toast('Still checking the username…', 'err');
    if (!UN.ok) { $('#un').focus(); return Nova.toast(UN.val ? 'Choose a valid, available username' : 'A username is required', 'err'); }
    if (await saveProfile(btn, { full_name: name, username: UN.val, bio: $('#bi').value.trim() || null })) { closeM(); Nova.toast('Profile saved'); route(); }
  }
  function editSoc() {
    const S = { ...(P.socials || {}) };
    const platforms = [...Object.entries(SOC), ['website', { n: 'Website', i: 'globe' }]];
    const active = new Set(platforms.filter(([k]) => !!S[k]).map(([k]) => k));
    const row = (k, s, v) => `<div class=soc data-social-row="${k}" data-social-name="${esc(s.n)}"><span class=si>${ic(s.i,20)}</span><div class=sb><div class=sl>${esc(s.n)}</div><div class=pre>${k==='website'?'':'<b>@</b>'}<input data-s="${k}" value="${esc(v||'')}" maxlength=200 aria-label="${esc(s.n)}" autocapitalize=none spellcheck=false placeholder="${k==='website'?'https://yourwebsite.com':k==='discord'?'username':'username or link'}"></div><div class=hint></div></div><button class=soc-remove type=button data-remove-social="${k}" aria-label="Remove ${esc(s.n)}">${ic('x',18)}</button></div>`;
    const selected = () => platforms.filter(([k]) => active.has(k)).map(([k,s]) => row(k,s,S[k])).join('');
    const picker = () => `<label class="fld soc-add"><span class=l>Add a social profile</span><select id=socialPicker class=sel><option value="">Choose a platform…</option>${platforms.filter(([k])=>!active.has(k)).map(([k,s])=>`<option value="${k}">${esc(s.n)}</option>`).join('')}</select></label>`;
    modal('Edit Social Links', `<p class=note style="margin:0 0 16px">Only selected profiles are shown. Add a profile to make its icon appear on your page.</p><div id=socialRows>${selected()}</div>${picker()}
<div class=macts><button class="btn sec" data-close>${t('cancel')}</button><button class="btn pri" data-act=savesoc>${t('savechanges')}</button></div>`);
    const rows = document.getElementById('socialRows');
    rows.addEventListener('click', e => {
      const remove = e.target.closest('[data-remove-social]');
      if (!remove) return;
      const key = remove.dataset.removeSocial, socialRow = remove.closest('[data-social-row]');
      active.delete(key);
      if (socialRow) socialRow.remove();
      const option = document.createElement('option');
      option.value = key;
      option.textContent = platforms.find(([k]) => k === key)[1].n;
      document.getElementById('socialPicker').append(option);
      e.stopPropagation();
    });
    document.getElementById('socialPicker').addEventListener('change', e => {
      const key=e.target.value, item=platforms.find(([k])=>k===key);
      if(!item||active.has(key))return;
      active.add(key);
      S[key]='';
      document.getElementById('socialRows').insertAdjacentHTML('beforeend',row(key,item[1],''));
      e.target.outerHTML=picker();
      document.getElementById('socialPicker').focus();
    });
  }
  async function saveSoc(btn) {
    const socials = {}; let bad = null;
    document.querySelectorAll('#mdl [data-s]').forEach(i => { const r = Nova.parseSocial(i.dataset.s, i.value), h = i.closest('.sb').querySelector('.hint'); i.classList.toggle('bad', !!r.err); h.className = 'hint ' + (r.err ? 'bad' : ''); h.textContent = r.err || ''; if (r.err) { if (!bad) bad = i; } else if (r.v) socials[i.dataset.s] = r.v; });
    if (bad) { bad.focus(); return Nova.toast('Fix the highlighted link', 'err'); }
    if (await saveProfile(btn, { socials })) { closeM(); Nova.toast('Social links saved'); route(); }
  }

  /* ---------- GALLERY UPLOAD ---------- */
  async function addGallery(files) {
    files = [...files].filter(f => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|gif)$/i.test(f.name)); if (!files.length) return Nova.toast('Please choose image files', 'err');
    const room = MAXG - P._g.length; if (room <= 0) return Nova.toast(`Gallery is full (${MAXG} photos)`, 'err');
    if (files.length > room) { Nova.toast(`Only ${room} more photo${room > 1 ? 's' : ''} fit — extra files skipped`, 'err'); files = files.slice(0, room); }
    const grid = $('#gsec .gg') || (() => { const g = document.createElement('div'); g.className = 'gg'; $('#gsec').append(g); return g; })(), rows = []; let fail = 0, lastErr = '';
    const queue = files.map(f => { const tl = document.createElement('div'); tl.className = 'gt up'; tl.innerHTML = '<i class=spin></i>'; grid.prepend(tl); return { f, tl }; });
    const worker = async () => { for (let j; (j = queue.shift());) { try {
      if (j.f.size > 15e6) throw new Error('Image is larger than 15 MB');
      const blob = await Nova.imgBlob(j.f, 1600, .85, false), p = `${U.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const r = await sb.storage.from('gallery').upload(p, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }); if (r.error) throw r.error; rows.push({ user_id: U.id, path: p });
    } catch (e) { fail++; lastErr = e.message || String(e); j.tl.remove(); } } };
    await Promise.all([worker(), worker(), worker()]);
    if (rows.length) { const { error } = await sb.from('gallery').insert(rows); if (error) { sb.storage.from('gallery').remove(rows.map(r => r.path)); fail += rows.length; rows.length = 0; lastErr = error.message; } }
    await loadP(); inv(); const g = $('#gsec'); if (g) g.innerHTML = gHTML(); const c = $('#gcnt'); if (c) c.textContent = `${P._g.length} / ${MAXG}`;
    const perm = /permission denied|row-level security|not authorized/i.test(lastErr);
    if (rows.length) Nova.toast(`${rows.length} photo${rows.length > 1 ? 's' : ''} added${fail ? ` · ${fail} failed` : ''}`, fail ? 'err' : '');
    else if (fail) Nova.toast(perm ? 'Gallery permission missing. Run fix-gallery-permissions.sql in Supabase once.' : (lastErr || 'Upload failed'), 'err');
  }

  /* ---------- reload helper + events ---------- */
  const reload = async () => { const id = PD ? PD.id : U.id; await fetchPD(id); route(); };
  document.addEventListener('click', async e => {
    const roomCard = e.target.closest('.public-room-card');
    if (roomCard && !e.target.closest('.public-room-avatar,.public-room-link')) {
      const link = roomCard.querySelector('.public-room-link');
      if (link && !(window.NovaEmbed && NovaEmbed.join(link.getAttribute('href')))) location.href = link.href;
      return;
    }
    const el = e.target.closest('[data-close],[data-act],[data-vis],[data-tab],[data-add],[data-acc],[data-dec],[data-clear],[data-lb],[data-profile-friend]'); if (!el) return; const d = el.dataset;
    if (d.profileFriend) { await profileFriendAction(el, d.profileFriend, d.userId); return; }
    if (d.close !== undefined) closeM();
    if (d.act === 'editinfo') editInfo();
    if (d.act === 'saveinfo') saveInfo(el);
    if (d.act === 'editsoc') editSoc();
    if (d.act === 'savesoc') saveSoc(el);
    if (d.act === 'delG' && await ask('Delete this photo?', 'It will be removed from your gallery for good.')) {
      const { error } = await sb.from('gallery').delete().eq('id', d.id); if (error) return Nova.toast(error.message, 'err');
      sb.storage.from('gallery').remove([d.p]); await loadP(); inv(); const g = $('#gsec'); if (g) g.innerHTML = gHTML(); const c = $('#gcnt'); if (c) c.textContent = `${P._g.length} / ${MAXG}`; Nova.toast('Photo deleted');
    }
    if (d.vis) { const v = { ...PD.visibility, [d.vis]: PD.visibility[d.vis] === false }; const { error } = await sb.from('profiles').update({ visibility: v }).eq('id', U.id); if (error) return Nova.toast(error.message, 'err'); await reload(); }
    if (d.tab) { TAB = d.tab; route(); }
    if (d.clear !== undefined && await ask('Clear watch history?', 'This removes your watched videos list.', 'Clear')) { await sb.from('watch_history').delete().eq('user_id', U.id); await reload(); }
    if (d.add !== undefined) {
      const un = $('#fu').value.trim().toLowerCase().replace(/^@/, ''), o = $('#fo'), say = (k, m) => { o.className = 'hint ' + k; o.textContent = m; };
      if (!un) return say('bad', 'Enter a username');
      const { data } = await sb.from('public_profiles').select('id').eq('username', un).maybeSingle();
      if (!data) return say('bad', 'User not found'); if (data.id === U.id) return say('bad', "That's you");
      const { error } = await sb.from('friendships').insert({ user_id: U.id, friend_id: data.id });
      error ? say('bad', 'Request already sent') : (say('ok', 'Request sent ✓'), $('#fu').value = '');
    }
    if (d.acc) { await sb.from('friendships').update({ status: 'accepted' }).eq('user_id', d.acc).eq('friend_id', U.id); await reload(); }
    if (d.dec) { await sb.from('friendships').delete().eq('user_id', d.dec).eq('friend_id', U.id); await reload(); }
    if (d.lb) { const o = document.createElement('div'); o.className = 'lb'; o.setAttribute('role', 'dialog'); o.innerHTML = `<button class=ib aria-label="Close">${ic('x', 18)}</button><img src="${d.lb}" alt="">`;
      const close = () => { o.remove(); document.removeEventListener('keydown', k); }, k = ev => ev.key === 'Escape' && close();
      o.onclick = close; document.addEventListener('keydown', k); document.body.append(o); }
  });
  document.addEventListener('change', async e => {
    const x = e.target;
    if (x.id === 'gf') { const fs = [...x.files]; x.value = ''; if (fs.length) addGallery(fs); return; }
    if (x.dataset && x.dataset.nsfw !== undefined) { NSFW = x.checked; await reload(); }
  });
  document.addEventListener('dragover', e => { if (e.target.closest && e.target.closest('#dz')) { e.preventDefault(); $('#dz').classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (e.target.closest && e.target.closest('#dz')) $('#dz').classList.remove('over'); });
  document.addEventListener('drop', e => { const z = e.target.closest && e.target.closest('#dz'); if (!z) return; e.preventDefault(); z.classList.remove('over'); addGallery(e.dataTransfer.files); });
})();
