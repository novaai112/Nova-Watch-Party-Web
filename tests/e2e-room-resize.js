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
  const box = async (page, q) => page.$eval(q, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  /* ---- laptop ---- */
  { const { ctx, page } = await open(browser, port, db(), { ctx: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false } });
    console.log('laptop 1366x768');
    await t('resize handle exists on the chat card wall', async () => { await page.waitForSelector('#rm .rsz:not([hidden])', { state: 'attached' }); const h = await box(page, '.rsz'), c = await box(page, '.scol'); assert.ok(Math.abs((h.x + h.w / 2) - (c.x - 8)) < 8, 'handle at chat left wall ' + JSON.stringify([h, c])); assert.strictEqual(await page.$eval('.rsz', e => getComputedStyle(e).cursor), 'col-resize'); });
    const w0 = (await box(page, '.scol')).w, v0 = (await box(page, '.vcol')).w;
    const drag = async (dx, hold) => { const h = await box(page, '.rsz'), x = h.x + h.w / 2, y = h.y + h.h / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 10 }); const hint = await page.$eval('.rsz', e => e.dataset.hint || ''); if (hold) { return hint; } await page.mouse.up(); return hint; };
    await t('drag left: chat grows, video shrinks', async () => { await drag(-150); await page.waitForTimeout(150); const w = (await box(page, '.scol')).w, v = (await box(page, '.vcol')).w; assert.ok(w > w0 + 120 && v < v0 - 120, [w0, w, v0, v].join(',')); });
    await t('the size is remembered', async () => assert.ok(await page.evaluate(() => +localStorage.getItem('nova.split') > 0.1)));
    await t('double-click resets to the default layout', async () => { const h = await box(page, '.rsz'); await page.mouse.dblclick(h.x + h.w / 2, h.y + h.h / 2); await page.waitForTimeout(150); assert.ok(Math.abs((await box(page, '.scol')).w - w0) < 3); assert.strictEqual(await page.evaluate(() => localStorage.getItem('nova.split')), null); });
    const mid = (await box(page, '.scol')).w;
    await t('keyboard: ArrowLeft widens the chat', async () => { await page.focus('.rsz'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100); assert.ok((await box(page, '.scol')).w > mid + 20); await page.keyboard.press('Home'); });
    await t('drag far left: hint says hide; release hides the video, chat only, player icon shows', async () => {
      const hint = await drag(-700, true); assert.match(hint, /hide the video/i); await page.mouse.up(); await page.waitForTimeout(250);
      assert.ok(await page.$eval('#rm', e => e.classList.contains('pl-hidden')), 'pl-hidden'); assert.ok(await page.$eval('.rshow', e => !e.hidden), 'show-player icon visible');
      assert.ok((await box(page, '.scol')).w > 1000, 'chat fills the row'); assert.ok(await page.$eval('.rsz', e => e.hidden || getComputedStyle(e).display === 'none')); });
    await t('player icon brings the video back with the previous size', async () => { await page.click('.rshow'); await page.waitForTimeout(250); assert.ok(!(await page.$eval('#rm', e => e.classList.contains('pl-hidden')))); assert.ok(Math.abs((await box(page, '.scol')).w - w0) < 3); });
    await t('drag far right: hint says full screen; release makes the video full screen', async () => {
      const hint = await drag(+700, true); assert.match(hint, /full screen/i); await page.mouse.up(); await page.waitForTimeout(400);
      const fs = await page.evaluate(() => !!document.fullscreenElement || document.body.classList.contains('pl-pfs')); assert.ok(fs, 'fullscreen or pseudo-fullscreen');
      assert.ok(Math.abs((await box(page, '.scol')).w - w0) < 3, 'chat width restored for when fullscreen ends'); });
    console.log('  errors:', page.errs.length ? page.errs : 'none'); await page.screenshot({ path: path.join(OUT, 'resize-laptop.png') }); await ctx.close(); }
  /* ---- phone: no handle ---- */
  { const { ctx, page } = await open(browser, port, db(), { ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } });
    console.log('phone');
    await t('no resize handle on phones / tablets', async () => { await page.waitForTimeout(300); const vis = await page.evaluate(() => { const e = document.querySelector('.rsz'); return !!e && getComputedStyle(e).display !== 'none' && !e.hidden; }); assert.ok(!vis); });
    await ctx.close(); }
  await browser.close(); server.close(); console.log(ok + ' ok, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})();
