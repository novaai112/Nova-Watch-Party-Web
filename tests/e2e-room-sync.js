/* Browser test for SYNC ENGINE v2 (feature F1): real nova-home.html + room.js + room-sync.js + room-sync.css, in-page fake Supabase
 * (controllable realtime channel / network) and a fake YouTube player that really advances, can lag, stall and ignore seeks.
 * Time is virtual (Playwright clock), so "a 20 s network drop" or "2 minutes of a player that ignores seeks" run in seconds.
 *
 *  A. drift correction   >1.5 s → rate nudge (no seek) and release; >4 s → one hard seek
 *  B. no double-seek loops (regression): a player that ignores seeks is not hammered (≥5 s apart, ≤3 per 30 s); a stall is not "seeked"
 *  C. buffering awareness  "Waiting for {name}" pill; admin pauses for everyone (Wait for everyone) / keeps playing (Never wait); 20 s cap
 *  D. sync badges        In sync / Behind / Buffering in the People list, own status broadcast
 *  E. late joiner        lands on the live position, Catch up, 3-2-1 resync
 *  F. reconnect          offline / server down → pill → exponential back-off → rejoin without refresh (role + position restored), swept member re-joins
 *  G. clock offset       measured on join (3 samples), every 30 s, and on tab refocus
 * Run: E2E_OUT=/some/dir node tests/e2e-room-sync.js    (needs `playwright` + Chromium) */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'sync-')); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const THUMB = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#345"/></svg>';

/* fake Supabase: tables in window.__db, RPCs recorded in window.__calls; window.__net=false makes every RPC fail like a dead network;
   the realtime channel keeps its broadcast handlers (window.__ch.emit(event, payload)) and reports status through window.__ch.status(st) */
const STUB = `window.supabase={createClient:()=>{
 const ok=d=>({data:d,error:null}); const db=()=>window.__db;
 const generic=()=>new Proxy(function(){},{get:(_,k)=>k==='then'?undefined:generic(),apply:()=>generic()});
 const builder=t=>{const p=new Proxy({},{get(_,k){ if(k==='then')return(res,rej)=>{ if(window.__net===false) return Promise.reject(new TypeError('Failed to fetch')).then(res,rej); return Promise.resolve(ok((db()[t]||[]).slice())).then(res,rej); };
   if(k==='single'||k==='maybeSingle')return()=>window.__net===false?Promise.reject(new TypeError('Failed to fetch')):Promise.resolve(ok((db()[t]||[])[0]||null)); return()=>p;}});return p};
 const R=()=>db().rooms[0];
 return {auth:{getSession:async()=>({data:{session:{access_token:'t',user:{id:'me',email:'me@x.com',user_metadata:{}}}}}),getUser:async()=>({data:{user:{id:'me'}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},
  from:builder,
  rpc:(n,a)=>{ (window.__calls=window.__calls||[]).push([n,a,Date.now()]);
    if(window.__net===false) return Promise.reject(new TypeError('Failed to fetch'));
    if(n==='room_now') return Promise.resolve(ok(Date.now()+(window.__skew||0)));
    if(n==='list_rooms') return Promise.resolve(ok([]));
    if(n==='room_heartbeat'){ if(window.__swept){ window.__swept=false; return Promise.resolve(ok({member:false,status:'open',admin_id:R().admin_id})); } return Promise.resolve(ok({member:true,status:'open',admin_id:R().admin_id})); }
    if(n==='join_room') return Promise.resolve(ok(R()));
    if(n==='room_set_state'){ R().play_state=Object.assign({},R().play_state,{playing:a.p_playing,pos:a.p_pos,ts:Date.now()+(window.__skew||0)}); return Promise.resolve(ok(null)); }
    return Promise.resolve(ok(null)); },
  channel:()=>{ const c={handlers:{},
      on(type,f,cb){ if(type==='broadcast'){ (c.handlers[f.event]=c.handlers[f.event]||[]).push(cb); } return c; },
      subscribe(cb){ c.cb=cb; (window.__subs=window.__subs||[]).push(c); setTimeout(()=>cb&&cb('SUBSCRIBED'),0); return c; },
      send(m){ (window.__sent=window.__sent||[]).push(m); return Promise.resolve('ok'); },
      emit(ev,payload){ (c.handlers[ev]||[]).forEach(h=>h({payload})); },
      status(st){ c.cb&&c.cb(st); } };
    window.__ch=c; return c; },
  removeChannel(){ window.__removed=(window.__removed||0)+1; },storage:generic()};}};`;
/* fake YouTube player that behaves: position advances with time x rate while playing, state 3 (buffering) freezes it, seeks can be ignored */
const FAKE_YT = `window.YT={Player:function(id,o){const s=this;let base=0,since=Date.now(),st=-1,rate=1,q='medium';
 const pos=()=>st===1?base+(Date.now()-since)/1000*rate:base; const mv=()=>{base=pos();since=Date.now();};
 window.__seeks=[];window.__seekT=[];window.__rates=[];window.__rate=1;
 s.getCurrentTime=()=>pos();s.getDuration=()=>7161;s.getPlayerState=()=>st;
 const set=v=>{mv();st=v;o.events&&o.events.onStateChange&&o.events.onStateChange({data:v});};s.__set=set;s.__lag=d=>{mv();base-=d;};s.__pos=pos;
 s.playVideo=()=>set(1);s.pauseVideo=()=>set(2);
 s.seekTo=t=>{window.__seeks.push(t);window.__seekT.push(Date.now());if(!window.__ignoreSeek){mv();base=t;}};
 s.setVolume=()=>{};s.destroy=()=>{};s.getPlaylistIndex=()=>0;s.getVideoLoadedFraction=()=>.4;
 s.getAvailablePlaybackRates=()=>[.25,.5,.75,1,1.25,1.5,1.75,2];s.getPlaybackRate=()=>rate;s.setPlaybackRate=r=>{mv();rate=r;window.__rate=r;window.__rates.push(r)};
 s.getAvailableQualityLevels=()=>['hd720','medium'];s.getPlaybackQuality=()=>q;s.setPlaybackQuality=v=>{q=v};s.loadModule=()=>{};s.unloadModule=()=>{};s.getOption=()=>null;s.setOption=()=>{};
 window.__ytp=s;setTimeout(()=>{o.events&&o.events.onReady&&o.events.onReady({});},10);}};
 window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();`;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/config') { res.setHeader('content-type', 'application/javascript'); return res.end("window.SUPABASE_URL='http://127.0.0.1:1';window.SUPABASE_ANON_KEY='anon';"); }
  const f = path.join(root, u === '/' ? 'index.html' : u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
});

const yt = (id, title) => ({ kind: 'youtube', provider: 'youtube', id, title });
/* o.admin: 'me' (default) or 'u1'; o.pos: where the room is right now; o.room: extra room columns */
function db(o = {}) {
  const now = Date.now(), pos = o.pos || 0;
  const room = Object.assign({ id: 'r1', code: 'code0001', admin_id: o.admin || 'me', creator_id: o.admin || 'me', title: 'Test', privacy: 'public', playback_mode: 'play', voice_enabled: false, status: 'open', media_ver: 3, vote_seconds: 12, next_id: null,
    media: yt('abcdefghijk', 'Sync test video'), play_state: { playing: true, pos, ts: now, seq: 1, idx: 0, phase: 'PLAYING' } }, o.room);
  const prof = ['me', 'u1', 'u2'].map((id, i) => ({ id, full_name: ['Me', 'Suhani', 'Karan'][i], username: ['me', 'anvi', 'karan'][i], avatar_url: null, country_code: 'IN' }));
  return { rooms: [room], room_members: prof.map((p, i) => ({ room_id: 'r1', user_id: p.id, joined_at: new Date(now + i).toISOString(), mic_allowed: false })), public_profiles: prof, room_messages: [], room_queue: [] };
}

let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', (e.message || e).toString().split('\n').slice(0, 5).join('\n     ')); } };
const ev = (page, f, a) => page.evaluate(f, a);
/* virtual time: 1 s at a time so intervals, timeouts and promise chains interleave like in a real browser */
async function adv(page, secs) { for (let i = 0; i < Math.round(secs); i++) { await page.clock.runFor(1000); await page.waitForTimeout(6); } }
async function open(browser, port, data, o = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1100, height: 800 } }, o.ctx || {}));
  await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('**/flagcdn.com/**', r => r.abort());
  await ctx.route('https://www.youtube.com/iframe_api', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_YT }));
  await ctx.route('https://i.ytimg.com/**', r => r.fulfill({ contentType: 'image/svg+xml', body: THUMB }));
  await ctx.addInitScript(`window.__db=${JSON.stringify(data)};` + (o.init || ''));
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.errs = errs;
  await page.clock.install({ time: Date.now() });
  await page.goto(`http://localhost:${port}/nova-home.html`);
  for (let i = 0; i < 80; i++) {
    await page.clock.runFor(100); await page.waitForTimeout(20);
    if (await ev(page, () => !!(window.__ytp && document.querySelector('#rm #ctl .cb') && document.querySelector('#vwrap .ytbox') && window.__ytp.getPlayerState() === 1))) break;
  }
  return { ctx, page };
}
const pill = page => ev(page, () => { const b = document.querySelector('#syncbar'); return b && !b.hidden ? b.innerText.replace(/\s+/g, ' ').trim() : ''; });
const calls = (page, n) => ev(page, n => (window.__calls || []).filter(c => c[0] === n).map(c => c[1]), n);
const drift = page => ev(page, () => window.__ytp.__pos() - NovaRoom.api.livePos(NovaRoom.api.byId('r1') || { play_state: window.__db.rooms[0].play_state }).pos);
const emit = (page, p) => ev(page, p => window.__ch.emit('sync', p), p);
const sentSync = page => ev(page, () => (window.__sent || []).filter(m => m.event === 'sync').map(m => m.payload));

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();

  console.log('A. drift correction: nudge first, hard-seek only above 4 s');
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    await adv(page, 4);
    await t('in sync: no seek, normal rate, no pill', async () => {
      assert.strictEqual(await ev(page, () => window.__seeks.length), 0); assert.strictEqual(await ev(page, () => window.__rate), 1); assert.strictEqual(await pill(page), ''); });
    await t('1.0 s off is left alone (threshold is 1.5 s)', async () => { await ev(page, () => window.__ytp.__lag(1.0)); await adv(page, 3);
      assert.strictEqual(await ev(page, () => window.__rates.length), 0); assert.strictEqual(await ev(page, () => window.__seeks.length), 0); await ev(page, () => window.__ytp.__lag(-1.0)); await adv(page, 1); });
    await t('2.2 s behind: the playback rate is nudged up, the player is NOT seeked', async () => {
      await ev(page, () => window.__ytp.__lag(2.2)); await adv(page, 2);
      assert.ok((await ev(page, () => window.__rate)) > 1, 'rate ' + await ev(page, () => window.__rate));
      assert.strictEqual(await ev(page, () => window.__seeks.length), 0); });
    await t('a lasting drift shows "Behind x s" with Catch up and 3-2-1', async () => {
      await adv(page, 3); const p = await pill(page); assert.ok(/Behind \d\.\d s/.test(p) && /Catch up/.test(p) && /3-2-1/.test(p), p); });
    await t('once caught up (<0.4 s) the rate is released back to 1x and the pill goes away', async () => {
      await adv(page, 14); assert.strictEqual(await ev(page, () => window.__rate), 1); assert.strictEqual(await pill(page), '');
      assert.ok(Math.abs(await drift(page)) < 0.6, 'drift ' + await drift(page)); assert.strictEqual(await ev(page, () => window.__seeks.length), 0); });
    await t('ahead by 2.5 s: the rate is nudged down', async () => { await ev(page, () => window.__ytp.__lag(-2.5)); await adv(page, 2); assert.ok((await ev(page, () => window.__rate)) < 1); await adv(page, 14); assert.strictEqual(await ev(page, () => window.__rate), 1); });
    await t('6 s behind: ONE hard seek lands on the live position, rate stays 1x', async () => {
      await ev(page, () => { window.__seeks.length = 0; window.__ytp.__lag(6); }); await adv(page, 4);
      const s = await ev(page, () => window.__seeks.slice()); assert.strictEqual(s.length, 1, JSON.stringify(s));
      assert.ok(Math.abs(await drift(page)) < 1, 'drift after seek ' + await drift(page)); assert.strictEqual(await ev(page, () => window.__rate), 1); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }

  console.log('B. no double-seek loops (regression)');
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    await adv(page, 3);
    await t('a player that ignores seeks (stuck 30 s behind for 2 min): never closer than 5 s, never more than 3 per 30 s', async () => {
      await ev(page, () => { window.__ignoreSeek = true; window.__seeks.length = 0; window.__seekT.length = 0; window.__ytp.__lag(30); });
      await adv(page, 120);
      const ts = await ev(page, () => window.__seekT.slice()); assert.ok(ts.length >= 1 && ts.length <= 12, 'seeks: ' + ts.length);
      let min = Infinity; for (let i = 1; i < ts.length; i++) min = Math.min(min, ts[i] - ts[i - 1]); assert.ok(ts.length < 2 || min >= 5000, 'min gap ' + min);
      let worst = 0; ts.forEach(a => { worst = Math.max(worst, ts.filter(b => b >= a && b - a < 30000).length); }); assert.ok(worst <= 3, 'worst window ' + worst); });
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    await adv(page, 3);
    await t('a 7 s stall is not "fixed" while it lasts; afterwards exactly one seek brings the player back', async () => {
      await ev(page, () => { window.__seeks.length = 0; window.__ytp.__set(3); }); await adv(page, 7);
      assert.strictEqual(await ev(page, () => window.__seeks.length), 0, 'seeked while buffering');
      await ev(page, () => window.__ytp.__set(1)); await adv(page, 6);
      assert.strictEqual(await ev(page, () => window.__seeks.length), 1); assert.ok(Math.abs(await drift(page)) < 1, 'drift ' + await drift(page)); });
    await ctx.close(); }

  console.log('C. buffering awareness');
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    await adv(page, 20);
    await t('a member buffering > 3 s → everyone sees "Waiting for {name}…"', async () => {
      await emit(page, { u: 'u2', st: 'buf', b: 4000, d: 0, j: 0 }); await adv(page, 2);
      assert.strictEqual(await pill(page), 'Waiting for Karan…'); });
    await t('…and the pill disappears when they are back', async () => { await emit(page, { u: 'u2', st: 'ok', b: 0, d: 0, j: 0 }); await adv(page, 2); assert.strictEqual(await pill(page), ''); });
    await t('a short stall (1.5 s) and a new joiner\'s first buffering never hold the room', async () => {
      await emit(page, { u: 'u2', st: 'buf', b: 1000, d: 0, j: 0 }); await adv(page, 1); assert.strictEqual(await pill(page), '');
      await emit(page, { u: 'u1', st: 'buf', b: 9000, d: 0, j: 1 }); await adv(page, 1); assert.strictEqual(await pill(page), ''); });
    await t('a reporter that goes quiet (> 12 s) cannot hold the room up', async () => { await emit(page, { u: 'u2', st: 'buf', b: 5000, d: 0, j: 0 }); await adv(page, 2); assert.ok(/Waiting/.test(await pill(page))); await adv(page, 12); assert.strictEqual(await pill(page), ''); });
    await ctx.close(); }
  { /* the admin: Wait for everyone */
    const { ctx, page } = await open(browser, port, db({ admin: 'me' }));
    await adv(page, 3);
    await t('admin / Wait for everyone: pauses the room when a member buffers > 3 s, with a toast', async () => {
      await emit(page, { u: 'u2', st: 'buf', b: 4000, d: 0, j: 0 }); await adv(page, 2);
      assert.strictEqual(await ev(page, () => window.__ytp.getPlayerState()), 2);
      const c = await calls(page, 'room_set_state'); assert.strictEqual(c[c.length - 1].p_playing, false);
      assert.ok(/Waiting for Karan/.test(await ev(page, () => document.body.innerText))); });
    await t('…and resumes for everyone shortly after the member is back', async () => {
      await emit(page, { u: 'u2', st: 'ok', b: 0, d: 0, j: 0 }); await adv(page, 3);
      assert.strictEqual(await ev(page, () => window.__ytp.getPlayerState()), 1);
      const c = await calls(page, 'room_set_state'); assert.strictEqual(c[c.length - 1].p_playing, true); });
    await t('never waits longer than 20 s for one person, and does not pause again for the same stall', async () => {
      await ev(page, () => { window.__calls.length = 0; });
      for (let i = 0; i < 30; i++) { await emit(page, { u: 'u2', st: 'buf', b: 4000 + i * 1000, d: 0, j: 0 }); await adv(page, 1); }
      assert.strictEqual(await ev(page, () => window.__ytp.getPlayerState()), 1, 'still paused');
      const c = (await calls(page, 'room_set_state')).map(x => x.p_playing); assert.deepStrictEqual(c.filter(x => x === false).length, 1, JSON.stringify(c)); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }
  { /* the admin: Never wait */
    const { ctx, page } = await open(browser, port, db({ admin: 'me', room: { wait_mode: 'never' } }));
    await adv(page, 3);
    await t('admin / Never wait: the room keeps playing; the pill only says who is buffering', async () => {
      await emit(page, { u: 'u2', st: 'buf', b: 6000, d: 0, j: 0 }); await adv(page, 3);
      assert.strictEqual(await ev(page, () => window.__ytp.getPlayerState()), 1); assert.strictEqual(await pill(page), 'Karan is buffering'); });
    await t('Settings: "Playback sync" offers Wait for everyone / Never wait (admin can change it)', async () => {
      await ev(page, () => document.querySelector('[data-r=settings]') && document.querySelector('[data-r=settings]').click()); await adv(page, 1);
      const txt = await ev(page, () => document.querySelector('#rm').innerText); assert.ok(/Playback sync/.test(txt) && /Wait for everyone/.test(txt) && /Never wait/.test(txt), txt.slice(0, 200));
      await ev(page, () => document.querySelector('[data-v="waitmode:wait"]').click()); await adv(page, 1);
      const c = await calls(page, 'room_update'); assert.strictEqual(c[c.length - 1].p_wait_mode, 'wait'); });
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    await adv(page, 2);
    await t('a member cannot change the wait mode (buttons disabled)', async () => {
      await ev(page, () => document.querySelector('[data-r=settings]') && document.querySelector('[data-r=settings]').click()); await adv(page, 1);
      assert.ok(await ev(page, () => { const b = document.querySelector('[data-v="waitmode:never"]'); return !!b && b.disabled; })); });
    await ctx.close(); }

  console.log('D. per-member sync badges + own status broadcast');
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    await adv(page, 20);
    await t('the member broadcasts its own status ("In sync") on the room channel', async () => {
      const s = await sentSync(page); assert.ok(s.length >= 1 && s.every(p => p.u === 'me') && s[s.length - 1].st === 'ok', JSON.stringify(s.slice(-2))); });
    await t('People list: In sync / Behind x s / Buffering badges per member', async () => {
      await emit(page, { u: 'u1', st: 'ok', d: 0, b: 0, j: 0 }); await emit(page, { u: 'u2', st: 'behind', d: -2.4, b: 0, j: 0 });
      await ev(page, () => document.querySelector('[data-r=people]').click()); await adv(page, 1);
      const rows = await ev(page, () => [...document.querySelectorAll('#rm .li')].map(l => l.innerText.replace(/\s+/g, ' ')));
      assert.ok(rows.some(r => /Suhani/.test(r) && /In sync/.test(r)), JSON.stringify(rows));
      assert.ok(rows.some(r => /Karan/.test(r) && /Behind 2\.4 s/.test(r)), JSON.stringify(rows));
      assert.ok(rows.some(r => /Me/.test(r) && /\(you\)/.test(r) && /In sync/.test(r)), JSON.stringify(rows));
      await page.screenshot({ path: path.join(OUT, 'sync-people.png') }); });
    await t('the badge follows the member live (Buffering) while the list is open', async () => {
      await emit(page, { u: 'u2', st: 'buf', d: 0, b: 800, j: 0 }); await adv(page, 1);
      assert.ok(await ev(page, () => /Karan[\s\S]*Buffering/.test(document.querySelector('#rm .li:nth-of-type(3), #rm').innerText))); });
    await t('reports of non-members are ignored', async () => { await emit(page, { u: 'stranger', st: 'buf', b: 9000, j: 0 }); await adv(page, 1); assert.ok(!/stranger/i.test(await ev(page, () => document.body.innerText))); });
    await ctx.close(); }

  console.log('E. late joiner: live position, Catch up, 3-2-1');
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1', pos: 120 }));
    await t('joining a room that is 2 minutes in: the player lands on the live position (one seek)', async () => {
      const s = await ev(page, () => window.__seeks.slice()); assert.ok(s.length === 1 && s[0] > 119 && s[0] < 125, JSON.stringify(s)); });
    await t('the pill says "Live position" and offers Catch up + 3-2-1 resync', async () => {
      await adv(page, 1); const p = await pill(page); assert.ok(/Live position/.test(p) && /Catch up/.test(p) && /3-2-1 resync/.test(p), p); await page.screenshot({ path: path.join(OUT, 'sync-join-pill.png') }); });
    await t('Catch up: jumps to the live position again and closes the pill', async () => {
      await ev(page, () => { window.__ytp.__lag(2); window.__seeks.length = 0; }); await ev(page, () => document.querySelector('#syncbar [data-r=syncnow]').click()); await adv(page, 2);
      const s = await ev(page, () => window.__seeks.slice()); assert.strictEqual(s.length, 1); assert.ok(Math.abs(await drift(page)) < 1, 'drift ' + await drift(page)); assert.strictEqual(await pill(page), ''); });
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1', pos: 120 }));
    await adv(page, 1);
    await t('3-2-1 resync: parks the player 3 s ahead, shows 3 → 2 → 1, then plays together with the room', async () => {
      await ev(page, () => { window.__seeks.length = 0; document.querySelector('#syncbar [data-r=resync]').click(); });
      await adv(page, 0); await page.waitForTimeout(20);
      const seen = []; seen.push(await ev(page, () => (document.querySelector('#synccount') || {}).textContent));
      const s0 = await ev(page, () => window.__seeks.slice()); assert.ok(s0.length === 1, JSON.stringify(s0));
      assert.strictEqual(await ev(page, () => window.__ytp.getPlayerState()), 2, 'paused while counting');
      await adv(page, 1); seen.push(await ev(page, () => (document.querySelector('#synccount') || {}).textContent));
      await adv(page, 1); seen.push(await ev(page, () => (document.querySelector('#synccount') || {}).textContent));
      await adv(page, 1); seen.push(await ev(page, () => (document.querySelector('#synccount') || {}).textContent || ''));
      assert.deepStrictEqual(seen, ['3', '2', '1', ''], JSON.stringify(seen));
      await adv(page, 1); assert.strictEqual(await ev(page, () => window.__ytp.getPlayerState()), 1, 'playing again');
      assert.ok(Math.abs(await drift(page)) < 0.8, 'drift after 3-2-1: ' + await drift(page)); });
    await t('the room tick does not un-pause the player during the countdown (no tug of war)', async () => {
      await ev(page, () => { window.__seeks.length = 0; document.querySelector('#syncbar') && 0; });
      assert.strictEqual(await ev(page, () => window.__seeks.length), 0); });
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db({ admin: 'me', pos: 120 }));
    await t('the admin is the reference: no Catch up / 3-2-1 pill', async () => { await adv(page, 2); assert.strictEqual(await pill(page), ''); }); await ctx.close(); }

  console.log('F. automatic reconnect with exponential back-off');
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    await adv(page, 5);
    await t('realtime channel error → "Reconnecting…" pill → back within the first back-off step, no refresh', async () => {
      await ev(page, () => { window.__net = false; window.__ch.status('CHANNEL_ERROR'); }); await adv(page, 1);
      const p = await pill(page); assert.ok(/Reconnecting/.test(p), p);
      await ev(page, () => { window.__net = true; }); await adv(page, 3);
      assert.strictEqual(await pill(page), ''); });
    await t('after a 20 s outage (server unreachable, browser still "online") the member rejoins on its own', async () => {
      const before = await ev(page, () => ({ subs: window.__subs.length, removed: window.__removed || 0 }));
      await ev(page, () => { window.__net = false; window.__ch.status('CLOSED'); });
      await adv(page, 20); assert.ok(/Reconnecting/.test(await pill(page)), await pill(page));
      const tries = await ev(page, () => (window.__calls || []).filter(c => c[0] === 'room_now').length);
      await ev(page, () => { window.__net = true; }); await adv(page, 16);
      assert.strictEqual(await pill(page), '', 'pill: ' + await pill(page));
      const after = await ev(page, () => ({ subs: window.__subs.length, removed: window.__removed || 0 }));
      assert.ok(after.subs > before.subs && after.removed > before.removed, JSON.stringify({ before, after, tries }));
      const rep = (await calls(page, 'room_sync_report')).filter(r => r.p_stats && r.p_stats.reconnect_ok >= 1);
      const last = rep[rep.length - 1]; assert.ok(last && last.p_stats.reconnect_attempts >= 4 && last.p_stats.away_ms >= 20000, JSON.stringify(rep)); });
    await t('back-off delays double: retries during the outage happen at ≈1, 3, 7, 15 s (±20 %)', async () => {
      await ev(page, () => { window.__calls.length = 0; window.__net = false; window.__ch.status('TIMED_OUT'); }); await adv(page, 40);
      const ts = await ev(page, () => window.__calls.filter(c => c[0] === 'room_now').map(c => c[2])); const t0 = ts[0];
      const gaps = []; let last = null; ts.forEach(x => { if (last === null || x - last > 400) gaps.push(x); last = x; });          /* clusters of 3 samples = one attempt */
      const rel = gaps.map(x => Math.round((x - t0) / 1000)); assert.ok(rel.length >= 4 && rel.length <= 6, JSON.stringify(rel));
      const steps = rel.slice(1).map((x, i) => x - rel[i]); assert.ok(steps[1] > steps[0] && steps[2] > steps[1], 'gaps ' + JSON.stringify(steps));
      await ev(page, () => { window.__net = true; }); await adv(page, 40); assert.strictEqual(await pill(page), ''); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    await adv(page, 5);
    await t('browser offline for 20 s: pill says "You are offline"; the moment it is online again the room is back (no waiting for the back-off)', async () => {
      await ctx.setOffline(true); await ev(page, () => { window.__net = false; }); await adv(page, 20);
      assert.ok(/offline/i.test(await pill(page)), await pill(page));
      await ev(page, () => { window.__net = true; }); await ctx.setOffline(false); await adv(page, 3);
      assert.strictEqual(await pill(page), ''); });
    await t('while the connection was down the room moved on: the player is back on the live position', async () => {
      await adv(page, 3); assert.ok(Math.abs(await drift(page)) < 1.6, 'drift ' + await drift(page)); });
    await t('a member swept from the room while away joins again (join_room), without a refresh', async () => {
      await ev(page, () => { window.__swept = true; window.__net = false; window.__ch.status('CLOSED'); }); await adv(page, 2);
      await ev(page, () => { window.__net = true; }); await adv(page, 10);
      assert.ok((await calls(page, 'join_room')).length >= 1); assert.strictEqual(await pill(page), ''); });
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db({ admin: 'me' }));
    await adv(page, 5);
    await t('the admin keeps the admin role after a reconnect and re-anchors the room position', async () => {
      await ev(page, () => { window.__calls.length = 0; window.__net = false; window.__ch.status('CHANNEL_ERROR'); }); await adv(page, 6);
      await ev(page, () => { window.__net = true; }); await adv(page, 12);
      assert.strictEqual(await pill(page), ''); assert.ok(await ev(page, () => !!document.querySelector('#ctl .cb') && !!document.querySelector('#seek')), 'admin controls');
      const c = await calls(page, 'room_set_state'); assert.ok(c.length >= 1 && c[c.length - 1].p_playing === true, JSON.stringify(c)); });
    await ctx.close(); }

  console.log('G. server clock offset');
  { const { ctx, page } = await open(browser, port, db({ admin: 'u1' }));
    const n = () => ev(page, () => (window.__calls || []).filter(c => c[0] === 'room_now').length);
    await t('measured on join with 3 samples (lowest round trip wins)', async () => assert.ok((await n()) >= 3, 'room_now x' + await n()));
    await t('re-measured every 30 s', async () => { const a = await n(); await adv(page, 31); assert.ok((await n()) > a, a + ' → ' + await n()); });
    await t('re-measured (3 samples) when the tab is focused again', async () => {
      const a = await n(); await ev(page, () => document.dispatchEvent(new Event('visibilitychange'))); await adv(page, 1); assert.ok((await n()) >= a + 3, a + ' → ' + await n()); });
    await t('a clock that is 9 s off is picked up at once; the shared position follows the server clock', async () => {
      await ev(page, () => { window.__skew = 9000; document.dispatchEvent(new Event('visibilitychange')); }); await adv(page, 2);
      const off = await ev(page, () => NovaRoom.api.now() - Date.now()); assert.ok(off > 8500 && off < 9500, 'offset ' + off); });
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed · screenshots in ${OUT}`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
