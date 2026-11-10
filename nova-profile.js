/* nova-profile.js — Rave-style profile sections. Load AFTER account.html's inline script (and on your player page for logWatch/setLike). */
(function () {
  const { sb, esc, t } = Nova;
  // ---- call these from your video player page ----
  Nova.logWatch = v => sb.rpc('log_watch', { p_url: v.url, p_title: v.title || '', p_thumb: v.thumb || null, p_source: v.source || 'web', p_channel: v.channel || null, p_nsfw: !!v.nsfw, p_seconds: v.seconds || 0 });
  Nova.setLike = (url, liked) => sb.rpc('set_like', { p_url: url, p_liked: liked });
  if (typeof V === 'undefined') return;

  let PD = null, PREVIEW = false, NSFW = false, TAB = 'top', REQ = [], FAILED = null, LOADING = null;
  const SOC = { instagram:['📸','https://instagram.com/'], x:['𝕏','https://x.com/'], tiktok:['🎵','https://tiktok.com/@'], snapchat:['👻','https://snapchat.com/add/'],
    youtube:['▶️','https://youtube.com/@'], facebook:['📘','https://facebook.com/'], telegram:['✈️','https://t.me/'], github:['💻','https://github.com/'],
    linkedin:['💼','https://linkedin.com/in/'], twitch:['🎮','https://twitch.tv/'], discord:['💬',''] };
  const STOP = new Set('the and for with from this that official video full song hd new feat lyrical lyric audio you your are was not'.split(' '));
  const COL = ['#9ad6d4','#c9b6ff','#ffb36b','#7aa2ff','#ff8fb1','#8fe3a1','#e8d36b','#b0b0c8'];
  const okUrl = u => /^https?:\/\//i.test(u || '') ? esc(u) : '';
  const hasData = id => PD && PD.id === id;

  const _edit = V.profile; V.editprofile = () => { PD = null; return _edit(); };                       // old form page (name, username, bio, gallery upload)
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

  const sec = (k, ic, ti, body, extra = '') => {
    if (!PD.s[k]) return '';
    const eye = PD.own ? `<button class=ib data-vis=${k} title="Visible to others">${PD.visibility[k] === false ? '🙈' : '👁️'}</button>` : '';
    return `<div class=card><div class=row style="justify-content:space-between"><b>${ic} ${ti}</b><span>${extra}${eye}</span></div>${body}</div>`;
  };
  const av = (u, s) => u.avatar_url || u.avatar ? `<img src="${okUrl(u.avatar_url || u.avatar)}" style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover">`
    : `<span style="width:${s}px;height:${s}px;border-radius:50%;background:var(--chip2);display:grid;place-items:center;font-size:${s / 2.2}px">${esc((u.full_name || u.name || '?')[0])}</span>`;

  function render() {
    if (!PD) return `${bar(t('profile'))}<p class=pad>${FAILED ? 'Profile not found.' : 'Loading…'}</p>`;
    const d = PD, own = d.own, can = !Nova.S.hideMature;
    let h = `${bar(own || PREVIEW ? t('profile') : '@' + esc(d.username || ''))}
<div class="card pad"><div style="display:flex;gap:14px;align-items:center">${av(d, 76)}<div style="flex:1"><b style="font-size:22px">${esc(d.name || '')}</b><br><span style="color:var(--mu)">@${esc(d.username || 'username')} ${esc(d.country || '')}</span></div>
${d.id === U.id ? '<button class=ib data-go=editprofile>✏️</button>' : ''}</div>
${d.id === U.id ? `<div style="display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap"><button class=pri data-pv style="padding:8px 14px">${PREVIEW ? 'Exit preview' : 'Preview'}</button>
<label style="display:flex;gap:8px;align-items:center;${can ? '' : 'opacity:.5'}" title="${can ? '' : 'Turn off Hide Mature Content in Settings first'}">Include 🔞 NSFW <input type=checkbox class=sw data-nsfw ${NSFW && can ? 'checked' : ''} ${can ? '' : 'disabled'}></label></div>` : ''}</div>`;
    h += sec('bio', '📝', t('bio'), `<p class=pad>${esc(d.bio) || '<span style="color:var(--mu)">No bio yet</span>'}</p>`);
    h += sec('gallery', '🖼️', `${t('gallery')} (${(d.gallery || []).length})`, `<div class=gal>${(d.gallery || []).map(p => `<img src="${sb.storage.from('gallery').getPublicUrl(p).data.publicUrl}" loading=lazy>`).join('') || '<p class=pad style="color:var(--mu)">No photos</p>'}</div>`);
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
      const own_ = own ? `<div class=pad>${Object.entries(SOC).map(([k, [ic]]) => `<input data-s=${k} placeholder="${ic} ${k} username" value="${esc(d.socials[k] || '')}" maxlength=40>`).join('')}<button class=pri data-savesoc>${t('save')}</button></div>` : '';
      const links = Object.entries(d.socials).filter(([k, v]) => SOC[k] && v).map(([k, v]) => SOC[k][1] ? `<a href="${esc(SOC[k][1] + encodeURIComponent(v))}" target=_blank rel=noopener style="font-size:30px;text-decoration:none;margin:6px">${SOC[k][0]}</a>` : `<span title="${esc(v)}" style="font-size:30px;margin:6px">${SOC[k][0]}</span>`).join('');
      h += sec('socials', '🔗', t('socials'), `<div class=pad style="text-align:center">${links || '<span style="color:var(--mu)">No links</span>'}</div>${own_}`);
    }
    return h;
  }
  const show = id => { if (!hasData(id)) { if (FAILED !== id && LOADING !== id) { LOADING = id; fetchPD(id).then(() => { LOADING = null; route(); }); } if (!PD || PD.id !== id) return `${bar(t('profile'))}<p class=pad>${FAILED === id ? 'Profile not found.' : 'Loading…'}</p>`; } return render(); };
  V.profile = () => show(U.id);
  V.user = id => show(id);

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-vis],[data-pv],[data-tab],[data-add],[data-acc],[data-dec],[data-savesoc],[data-clear]'); if (!el) return; const d = el.dataset;
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
    if (d.savesoc !== undefined) { const s = {}; document.querySelectorAll('[data-s]').forEach(i => { const v = i.value.trim().replace(/^@/, ''); if (/^[\w.\-]{1,40}$/.test(v)) s[i.dataset.s] = v; });
      await sb.from('profiles').update({ socials: s }).eq('id', U.id); await reload(); }
  });
  document.addEventListener('change', async e => { if (e.target.dataset && e.target.dataset.nsfw !== undefined) { NSFW = e.target.checked; await reload(); } });
})();
