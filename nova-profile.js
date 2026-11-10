/* nova-profile.js — Rave-style profile sections. Load AFTER account.html's inline script (and on your player page for logWatch/setLike). */
(function () {
  const { sb, esc, t } = Nova;
  // ---- call these from your video player page ----
  Nova.logWatch = v => sb.rpc('log_watch', { p_url: v.url, p_title: v.title || '', p_thumb: v.thumb || null, p_source: v.source || 'web', p_channel: v.channel || null, p_nsfw: !!v.nsfw, p_seconds: v.seconds || 0 });
  Nova.setLike = (url, liked) => sb.rpc('set_like', { p_url: url, p_liked: liked });
  if (typeof V === 'undefined') return;

  let PD = null, PREVIEW = false, NSFW = false, TAB = 'top', REQ = [], FAILED = null, LOADING = null;
  const STOP = new Set('the and for with from this that official video full song hd new feat lyrical lyric audio you your are was not'.split(' '));
  const COL = ['#9ad6d4','#c9b6ff','#ffb36b','#7aa2ff','#ff8fb1','#8fe3a1','#e8d36b','#b0b0c8'];
  const okUrl = u => /^https?:\/\//i.test(u || '') ? esc(u) : '';
  const hasData = id => PD && PD.id === id;

  Nova.invalidate = () => { PD = null; FAILED = null; LOADING = null; };   // call after profile edits so the view refetches
  async function fetchPD(id) {
    const { data } = await sb.rpc('public_profile', { p_uid: id, p_preview: PREVIEW, p_nsfw: NSFW });
    PD = data; FAILED = data ? null : id;
    if (data && data.own) {
      const r = (await sb.from('friendships').select('user_id').eq('friend_id', U.id).eq('status', 'pending')).data || [];
      const ids = r.map(x => x.user_id);
      REQ = ids.length ? (await sb.from('public_profiles').select('id,full_name,username').in('id', ids)).data || [] : [];
    }
  }
  const reload = async () => { const id = PD ? PD.id : U.id; await fetchPD(id); route(); };

  const SOC = Nova.SOC;
  const sec = (k, ic, ti, body, extra = '') => {
    if (!PD.s[k]) return '';
    const eye = PD.own ? `<button class=ib data-vis=${k} title="${PD.visibility[k] === false ? 'Hidden from others' : 'Visible to others'}" aria-label="Toggle visibility for ${esc(ti)}">${Nova.ic(PD.visibility[k] === false ? 'eyeoff' : 'eye', 17)}</button>` : '';
    return `<section class=card><div class=sh><b>${Nova.hasIcon(ic) ? Nova.ic(ic, 17) : ''}${ti}</b><span class=shr>${extra}${eye}</span></div>${body}</section>`;
  };
  const av = (u, s) => Nova.avatar(u, s);

  function render() {
    if (!PD) return `${bar(t('profile'))}<p class=pad>${FAILED ? 'Profile not found.' : 'Loading…'}</p>`;
    const d = PD, own = d.own, can = !Nova.S.hideMature;
    let h = `${bar(own || PREVIEW ? t('profile') : '@' + esc(d.username || ''))}
<div class="card hero"><div class=cover></div><div class=hbody>${Nova.avatar(d, 92, 'ring')}<div class=hinfo><h2 class=hname>${esc(d.name || '')}</h2><div class=hsub>@${esc(d.username || '')}${d.country ? ' · ' + esc(d.country) : ''}</div></div>
${d.id === U.id && !PREVIEW ? `<button class="btn sec sm" data-go=editprofile>${Nova.ic('pencil', 15)}Edit profile</button>` : ''}</div>
${d.id === U.id ? `<div class=tools><button class="btn pri sm" data-pv>${PREVIEW ? 'Exit preview' : 'Preview as visitor'}</button>
<label style="display:flex;gap:10px;align-items:center;font-size:14px;${can ? '' : 'opacity:.5'}" title="${can ? '' : 'Turn off Hide Mature Content in Settings first'}">Include 🔞 NSFW <input type=checkbox class=sw data-nsfw ${NSFW && can ? 'checked' : ''} ${can ? '' : 'disabled'}></label></div>` : '<div style="height:16px"></div>'}</div>`;
    h += sec('bio', 'user', t('bio'), d.bio ? `<p class=bio>${esc(d.bio)}</p>` : `<p class="bio mu">${own ? 'You have not written a bio yet. <button class=link data-go=editprofile>Add one</button>' : 'No bio yet'}</p>`);
    const gl = d.gallery || [];
    h += sec('gallery', 'image', `${t('gallery')} (${gl.length})`, `<div class=gg>${gl.map((p, i) => `<button class=gt data-lb="${esc(sb.storage.from('gallery').getPublicUrl(p).data.publicUrl)}" aria-label="Open photo ${i + 1}"><img src="${esc(sb.storage.from('gallery').getPublicUrl(p).data.publicUrl)}" alt="" loading=lazy></button>`).join('') || `<p class="mu" style="grid-column:1/-1;margin:0">${own ? 'No photos yet. <button class=link data-go=editprofile>Add photos</button>' : 'No photos'}</p>`}</div>`);
    if (d.stats) h += sec('stats', '📊', t('stats'), `<div class=row><span class=m>${t('joined')}</span><span>${new Date(d.joined).toLocaleDateString()}</span></div>
<div class=row><span class=m>Watch time</span><span>${d.stats.hours} hours</span></div><div class=row><span class=m>Videos watched</span><span>${d.stats.videos}</span></div><div class=row><span class=m>${t('friends')}</span><span>${d.stats.friends}</span></div>`);
    if (d.friends) {
      const sz = [120, 94, 78, 66, 58, 52], f = d.friends;
      let body = `<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center;padding:14px">${f.map((u, i) => `<button data-go="user/${u.id}" title="${esc(u.full_name || u.username)}">${av(u, sz[Math.min(i, 5)])}</button>`).join('') || '<span style="color:var(--mu)">No friends yet</span>'}</div>`;
      if (own) body += `<div class=pad><input id=fu placeholder="Add friend by username"><button class=pri data-add>Add friend</button> <small id=fo></small>
${REQ.map(r => `<div class=row><span class=m>${esc(r.full_name || r.username)} <small>wants to be friends</small></span><button class=pri data-acc=${r.id} style="padding:6px 12px">✓</button><button class=ib data-dec=${r.id}>✕</button></div>`).join('')}</div>`;
      h += sec('friends', '👥', `${t('friends')} · Top`, body);
    }
    if (d.videos) {
      const list = d.videos[TAB] || [];
      const tabs = ['top', 'history', 'liked'].map(k => `<button data-tab=${k} style="padding:4px 10px;border-radius:12px;${TAB === k ? 'background:var(--ac);color:var(--onac)' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('');
      h += sec('videos', '▶️', 'Videos', `<div style="padding:4px 12px">${tabs}${own && TAB === 'history' ? ' <button data-clear style="color:var(--mu)">Clear</button>' : ''}</div>
<div class=gal>${list.map(v => `<a href="${okUrl(v.video_url)}" target=_blank rel=noopener style="width:150px;flex:none;color:inherit;text-decoration:none"><img src="${okUrl(v.thumb)}" style="width:150px;height:90px" onerror="this.style.visibility='hidden'"><div style="font-size:13px;max-height:36px;overflow:hidden">${esc(v.title)}</div><small>${v.watch_count} views</small></a>`).join('') || '<p class=pad style="color:var(--mu)">Nothing here yet</p>'}</div>`);
    }
    if (d.titles) {
      const c = {}; d.titles.join(' ').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.forEach(w => { if (!STOP.has(w) && !/^\d+$/.test(w)) c[w] = (c[w] || 0) + 1; });
      const kw = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 15);
      h += sec('keywords', '🔑', 'Keywords', `<div class=pad>${kw.map(([w, n]) => `<span style="display:inline-block;margin:3px;padding:4px 10px;border-radius:14px;background:var(--chip)">${esc(w)} <small>${n}</small></span>`).join('') || '—'}</div>`);
    }
    if (d.channels) h += sec('channels', '📺', 'Channels', `<div class=pad>${d.channels.map(c => `<span style="display:inline-block;margin:3px;padding:4px 10px;border-radius:14px;background:var(--chip)">${esc(c.name)} <small>${c.n}</small></span>`).join('') || '—'}</div>`);
    if (d.interests) {
      const tot = d.interests.reduce((a, b) => a + b.n, 0) || 1; let acc = 0;
      const stops = d.interests.map((x, i) => { const a = acc / tot * 100; acc += x.n; return `${COL[i % 8]} ${a}% ${acc / tot * 100}%`; }).join(',');
      h += sec('interests', '🍩', 'Interests', `<div class=pad style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div style="width:130px;height:130px;border-radius:50%;background:conic-gradient(${stops || 'var(--chip) 0 100%'});display:grid;place-items:center"><div style="width:74px;height:74px;border-radius:50%;background:var(--bg2);display:grid;place-items:center">Sites</div></div>
<div>${d.interests.map((x, i) => `<div><span style="color:${COL[i % 8]}">●</span> ${esc(x.name)} ${Math.round(x.n / tot * 100)}%</div>`).join('')}</div></div>`);
    }
    if (d.socials) {
      const chips = Object.entries(d.socials).filter(([k, v]) => (SOC[k] || k === 'website') && v).map(([k, v]) => {
        const info = k === 'website' ? { n: 'Website', u: '', i: 'globe' } : SOC[k];
        const href = k === 'website' ? okUrl(v) : info.u ? esc(info.u + encodeURIComponent(v)) : '';
        const label = k === 'website' ? esc(String(v).replace(/^https?:\/\//, '')) : info.u ? esc(info.n) : `${esc(info.n)} · ${esc(v)}`;
        return href ? `<a class=chip href="${href}" target=_blank rel="noopener noreferrer">${Nova.ic(info.i, 16)}${label}</a>` : `<span class=chip title="${esc(v)}">${Nova.ic(info.i, 16)}${label}</span>`;
      }).join('');
      h += sec('socials', 'link', t('socials'), `<div class=chips>${chips || `<span class=mu>${own ? 'No links yet. <button class=link data-go=editprofile/socials>Add social links</button>' : 'No links'}</span>`}</div>`, own ? `<button class="btn sec sm" data-go=editprofile/socials>${Nova.ic('pencil', 14)}Edit</button>` : '');
    }
    return h;
  }
  const show = id => { if (!hasData(id)) { if (FAILED !== id && LOADING !== id) { LOADING = id; fetchPD(id).then(() => { LOADING = null; route(); }); } if (!PD || PD.id !== id) return `${bar(t('profile'))}<p class=pad>${FAILED === id ? 'Profile not found.' : 'Loading…'}</p>`; } return render(); };
  V.profile = () => show(U.id);
  V.user = id => show(id);

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-vis],[data-pv],[data-tab],[data-add],[data-acc],[data-dec],[data-clear],[data-lb]'); if (!el) return; const d = el.dataset;
    if (d.vis) { const v = { ...PD.visibility, [d.vis]: PD.visibility[d.vis] === false }; await sb.from('profiles').update({ visibility: v }).eq('id', U.id); await reload(); }
    if (d.pv !== undefined) { PREVIEW = !PREVIEW; await reload(); }
    if (d.tab) { TAB = d.tab; route(); }
    if (d.clear !== undefined && confirm('Clear your watch history?')) { await sb.from('watch_history').delete().eq('user_id', U.id); await reload(); }
    if (d.add !== undefined) {
      const un = fu.value.trim().toLowerCase().replace(/^@/, ''), o = document.getElementById('fo');
      const { data } = await sb.from('public_profiles').select('id').eq('username', un).maybeSingle();
      if (!data) return o.textContent = 'User not found'; if (data.id === U.id) return o.textContent = "That's you";
      const { error } = await sb.from('friendships').insert({ user_id: U.id, friend_id: data.id });
      o.textContent = error ? 'Request already sent' : 'Request sent ✓';
    }
    if (d.acc) { await sb.from('friendships').update({ status: 'accepted' }).eq('user_id', d.acc).eq('friend_id', U.id); await reload(); }
    if (d.dec) { await sb.from('friendships').delete().eq('user_id', d.dec).eq('friend_id', U.id); await reload(); }
    if (d.lb) { const o = document.createElement('div'); o.className = 'lb'; o.setAttribute('role', 'dialog'); o.innerHTML = `<button class=ib aria-label="Close">${Nova.ic('x', 18)}</button><img src="${d.lb}" alt="">`;
      const close = () => { o.remove(); document.removeEventListener('keydown', k); }, k = ev => ev.key === 'Escape' && close();
      o.onclick = close; document.addEventListener('keydown', k); document.body.append(o); }
  });
  document.addEventListener('change', async e => { if (e.target.dataset && e.target.dataset.nsfw !== undefined) { NSFW = e.target.checked; await reload(); } });
})();
