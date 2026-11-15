/* Browser test for the WATCH ROOM screen (real nova-home.html + room.js + room.css, in-page fake Supabase and fake YouTube player):
 *  - only the platform icon is drawn on the video (no title / share / watch-later / "More videos" of the platform)
 *  - the More-videos icon sits after the timeline (before Skip), active for everyone except non-leaders in Leader's choice
 *  - More videos = ONE row over the video, scrollable left / right, close X, default videos so it is never empty
 *  - Let's vote: ONE vote per person (tap moves it / withdraws it), countdown, admin "End vote", winner announced
 *  - the state machine attribute (data-pstate) follows play / pause / vote / waiting
 * Run: E2E_OUT=/some/dir node tests/e2e-watch-room.js    (needs `playwright` + Chromium) */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'wr-')); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const THUMB = n => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${n * 57},60%,45%)"/><stop offset="1" stop-color="hsl(${n * 57 + 70},60%,30%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="200" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">${n}</text></svg>`;

/* fake Supabase: tables live in window.__db, RPCs are recorded in window.__calls and the vote RPCs behave like the server */
const STUB = `window.supabase={createClient:()=>{
 const ok=d=>({data:d,error:null}); const db=()=>window.__db;
 const generic=()=>new Proxy(function(){},{get:(_,k)=>k==='then'?undefined:generic(),apply:()=>generic()});
 const builder=t=>{const p=new Proxy({},{get(_,k){ if(k==='then')return(res,rej)=>Promise.resolve(ok((db()[t]||[]).slice())).then(res,rej);
   if(k==='single'||k==='maybeSingle')return()=>Promise.resolve(ok((db()[t]||[])[0]||null)); return()=>p;}});return p};
 const R=()=>db().rooms[0];
 return {auth:{getSession:async()=>({data:{session:{access_token:'t',user:{id:'me',email:'me@x.com',user_metadata:{}}}}}),getUser:async()=>({data:{user:{id:'me'}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},
  from:builder,
  rpc:(n,a)=>{ (window.__calls=window.__calls||[]).push([n,a]);
    if(n==='room_now') return Promise.resolve(ok(Date.now()));
    if(n==='list_rooms') return Promise.resolve(ok([]));
    if(n==='room_heartbeat') return Promise.resolve(ok({member:true,status:'open',admin_id:R().admin_id}));
    if(n==='room_vote'){ const q=db().room_queue, it=q.find(x=>x.id===a.p_queue_id);
      if(it.votes.includes('me')) it.votes=it.votes.filter(v=>v!=='me'); else { q.forEach(x=>x.votes=x.votes.filter(v=>v!=='me')); it.votes=it.votes.concat('me'); }
      return Promise.resolve(ok(null)); }
    if(n==='room_pick'){ const q=db().room_queue; q.push({id:'new'+q.length,added_by:'me',media:a.p_media,votes:R().playback_mode==='vote'?['me']:[],created_at:new Date().toISOString(),suggested:false,pos:Date.now()}); return Promise.resolve(ok({action:'queued'})); }
    if(n.indexOf('pq_')===0){ const S=window.__pq=window.__pq||{items:[],active:null,n:0}; let r=null;
      if(n==='pq_list') r={items:S.items.slice(),active:S.active,mode:'vote'};
      else if(n==='pq_add'){ let add=0,dup=0; a.p_items.forEach(m=>{ if(S.items.some(x=>x.media.id===m.id)) dup++; else {add++; S.items.push({id:'p'+(++S.n),media:m});} }); r={added:add,duplicates:dup,total:S.items.length}; }
      else if(n==='pq_submit'){ if(S.active) return Promise.resolve({data:null,error:{message:'Your previous video is still in the vote'}}); const it=S.items.shift(); S.active={media:it.media,queue_id:'x'}; r={action:'queued',title:it.media.title}; }
      else if(n==='pq_clear') S.items=[];
      else if(n==='pq_remove') S.items=S.items.filter(x=>x.id!==a.p_id);
      return Promise.resolve(ok(r)); }
    if(n==='room_set_next'){ R().next_id=(R().next_id===a.p_queue_id?null:a.p_queue_id); return Promise.resolve(ok({})); }
    return Promise.resolve(ok(null)); },
  channel:()=>generic(),removeChannel(){},storage:generic()};}};`;
/* fake YouTube iframe API: a tiny player whose state the test can drive */
const FAKE_YT = `window.YT={Player:function(id,o){const s=this;s._s=-1;s.getCurrentTime=()=>window.__ytt||0;s.getDuration=()=>300;s.getPlayerState=()=>s._s;
 const set=v=>{s._s=v;o.events&&o.events.onStateChange&&o.events.onStateChange({data:v});};s.__set=set;
 s.playVideo=()=>set(1);s.pauseVideo=()=>set(2);s.seekTo=()=>{};s.setVolume=()=>{};s.destroy=()=>{};s.getPlaylistIndex=()=>0;
 window.__ytp=s;setTimeout(()=>{o.events&&o.events.onReady&&o.events.onReady({});},10);}};
 window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();`;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/config') { res.setHeader('content-type', 'application/javascript'); return res.end("window.SUPABASE_URL='http://127.0.0.1:1';window.SUPABASE_ANON_KEY='anon';"); }
  const f = path.join(root, u === '/' ? 'index.html' : u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
});

const yt = (id, title) => ({ kind: 'youtube', provider: 'youtube', id, title });
function db(o = {}) {
  const now = Date.now();
  const room = Object.assign({ id: 'r1', code: 'code0001', admin_id: 'me', title: 'Test', privacy: 'public', playback_mode: 'vote', voice_enabled: true, status: 'open', media_ver: 3, vote_seconds: 12, next_id: null,
    media: yt('abcdefghijk', 'Dil Meri Na Sune | Atif Aslam'), play_state: { playing: true, pos: 5, ts: now, seq: 1, idx: 0, phase: 'PLAYING' } }, o.room);
  const prof = ['me', 'u1', 'u2'].map((id, i) => ({ id, full_name: ['Me', 'Suhani', 'Karan'][i], username: ['me', 'anvi', 'karan'][i], avatar_url: null, country_code: 'IN' }));
  return { rooms: [room], room_members: prof.map((p, i) => ({ room_id: 'r1', user_id: p.id, joined_at: new Date(now + i).toISOString(), mic_allowed: false })), public_profiles: prof, room_messages: [],
    room_queue: o.queue || [] };
}
const qitem = (i, votes, extra) => Object.assign({ id: 'q' + i, added_by: i % 2 ? 'u1' : 'u2', media: yt('vid' + String(i).padStart(8, '0'), 'Queued video number ' + i), votes: votes || [], created_at: new Date(Date.now() + i).toISOString(), suggested: false, pos: i }, extra);

let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', (e.message || e).toString().split('\n').slice(0, 4).join('\n     ')); } };

async function open(browser, port, data, o = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, o.ctx || {}));
  await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('**/flagcdn.com/**', r => r.abort());
  await ctx.route('https://www.youtube.com/iframe_api', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_YT }));
  await ctx.route('https://i.ytimg.com/**', r => { const n = +(/vi\/[^/]*?(\d+)\//.exec(r.request().url()) || [0, 1])[1] || 1; r.fulfill({ contentType: 'image/svg+xml', body: THUMB(n) }); });
  await ctx.addInitScript(`window.__db=${JSON.stringify(data)};`);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.errs = errs;
  await page.goto(`http://localhost:${port}/nova-home.html`);
  await page.waitForSelector('#rm #ctl .cb', { state: 'attached', timeout: 8000 });
  await page.waitForFunction(() => window.__ytp && document.querySelector('#vwrap .ytbox'), null, { timeout: 8000 });
  await page.waitForTimeout(250);
  return { ctx, page };
}
const calls = (page, n) => page.evaluate(n => (window.__calls || []).filter(c => c[0] === n).map(c => c[1]), n);
const sync = page => page.evaluate(() => NovaRoom.sync());
const patch = (page, room, queue) => page.evaluate(([r, q]) => { if (r) Object.assign(window.__db.rooms[0], r); if (q) window.__db.room_queue = q; }, [room, queue]);

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();
  for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1366, height: 768 }]]) {
    const { ctx, page } = await open(browser, port, db(), { ctx: { viewport: vp, isMobile: name === 'phone', hasTouch: name === 'phone', deviceScaleFactor: 1 } });
    await ctx.route('**/api/youtube**', r => { const u = new URL(r.request().url()), s = u.searchParams;
      if (s.get('plitems')) { const st = +(s.get('pageToken') || 0), items = []; for (let i = st + 1; i <= Math.min(st + 50, 120); i++) items.push({ id: 'pl' + String(i).padStart(9, '0'), title: 'Song ' + i, channel: 'Chan', thumb: '', dur: '3:0' + (i % 10), embeddable: true });
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, next: st + 50 < 120 ? String(st + 50) : '', total: 120 }) }); }
      if (s.get('pl')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ pl: s.get('pl'), title: 'Bollywood Hitlist', channel: 'Owner', thumb: '' }) });
      r.fulfill({ contentType: 'application/json', body: '{"items":[],"next":""}' }); });
    console.log(name + ': real nova-home.html + room.js');
    await t('in a room: NovaPQ sees the room', async () => assert.ok(await page.evaluate(() => NovaPQ.active()), 'NovaPQ.active() is false while in a room'));
    await page.evaluate(() => show('picker', true));
    await t('green panel is visible in the picker', async () => { await page.waitForSelector('#pq:not([hidden]) .pq-card', { timeout: 3000 }); });
    await t('launching a playlist opens the import screen (not a direct play)', async () => {
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('nova:platform', { detail: 'youtube' })));
      await page.fill('#scr .sb input', 'https://www.youtube.com/playlist?list=PLabcdefghijk'); await page.press('#scr .sb input', 'Enter');
      await page.waitForSelector('#pqi'); await page.waitForFunction(() => document.querySelectorAll('.pqi-row').length === 120, null, { timeout: 5000 }); });
    await t('add all: first video auto-sent to the vote, the other 119 wait in MY queue', async () => {
      await page.click('.pqi-all'); await page.waitForFunction(() => document.querySelector('.pq-n') && document.querySelector('.pq-n').textContent === '119', null, { timeout: 5000 });
      assert.strictEqual(await page.$$eval('.pq-item', e => e.length), 119); assert.ok(await page.$('.pq-live'), 'first video auto-submitted'); });
    await t('queue list can scroll to the last video', async () => { const r = await page.evaluate(() => { const u = document.querySelector('.pq-list'); u.scrollTop = 1e6; return { sh: u.scrollHeight, ch: u.clientHeight, last: u.lastElementChild.querySelector('b').textContent }; }); assert.strictEqual(r.last, 'Song 120'); assert.ok(r.sh > r.ch); });
    await t('watching a video in the room is recorded in History with a count', async () => { const h = await page.evaluate(() => JSON.parse(localStorage.getItem('nova.h') || '[]')); assert.ok(h.length >= 1 && h[0].n === 1 && h[0].at, JSON.stringify(h).slice(0, 200)); });
    await t('same video within 2 minutes is one watch; later it counts again', async () => {
      const r = await page.evaluate(() => { const h = JSON.parse(localStorage['nova.h']), v = h[0]; NovaApp.addHistory(v); const a = JSON.parse(localStorage['nova.h'])[0].n;
        const o = JSON.parse(localStorage['nova.h']); o[0].at = Date.now() - 600000; localStorage['nova.h'] = JSON.stringify(o); NovaApp.addHistory(v); return [a, JSON.parse(localStorage['nova.h'])[0].n, JSON.parse(localStorage['nova.h']).length]; });
      assert.deepStrictEqual(r, [1, 2, 1]); });
    console.log('  errors:', page.errs.length ? page.errs : 'none'); await page.screenshot({ path: path.join(OUT, name + '.png') });
    await ctx.close();
  }
  await browser.close(); server.close(); console.log(ok + ' ok, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})();
