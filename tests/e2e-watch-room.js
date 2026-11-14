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
  await page.waitForSelector('#rm #ctl .cb', { timeout: 8000 });
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

  console.log('A. the video shows only the platform icon');
  { const { ctx, page } = await open(browser, port, db());
    await t('YouTube frame is cropped: its title bar / share / watch-later / logo sit outside the visible box', async () => {
      const g = await page.evaluate(() => { const w = document.querySelector('#vwrap').getBoundingClientRect(), b = document.querySelector('#vwrap .ytbox').getBoundingClientRect(), cs = getComputedStyle(document.querySelector('#vwrap')); return { wTop: w.top, wBot: w.bottom, bTop: b.top, bBot: b.bottom, ov: cs.overflow }; });
      assert.ok(g.ov === 'hidden' && g.bTop <= g.wTop - 60 && g.bBot >= g.wBot + 60, JSON.stringify(g)); });
    await t('a platform icon (YouTube) is drawn on the video; no platform text anywhere on it', async () => {
      const r = await page.evaluate(() => { const b = document.querySelector('#vwrap #vbadge'); return { has: !!b, label: b && b.getAttribute('aria-label'), txt: document.querySelector('#vwrap').innerText.trim() }; });
      assert.ok(r.has && r.label === 'YouTube', JSON.stringify(r)); assert.ok(!/youtube|share|watch later|more videos/i.test(r.txt.replace(/^\s+|\s+$/g, '')) || r.txt === '', r.txt); });
    await t('the player is created without the platform controls (controls=0, no fullscreen button)', async () => assert.ok(await page.evaluate(() => !!window.__ytp)));
    await t('paused frame is replaced by our cover (hides the platform pause panel)', async () => {
      await page.waitForTimeout(1800); await page.evaluate(() => window.__ytp.pauseVideo()); await page.waitForSelector('#vcover.paused', { timeout: 3000 });
      assert.strictEqual(await page.evaluate(() => document.querySelector('#rm').dataset.pstate), 'PAUSED');
      await page.evaluate(() => window.__ytp.playVideo()); await page.waitForFunction(() => !document.querySelector('#vcover'), null, { timeout: 3000 });
      assert.strictEqual(await page.evaluate(() => document.querySelector('#rm').dataset.pstate), 'PLAYING'); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }

  console.log('B. the More-videos icon: after the timeline, before Skip; active for everyone');
  { const { ctx, page } = await open(browser, port, db());
    await t('admin: order is  −10 ▶ +10  time  slider  time  [More videos]  Skip', async () => {
      const xs = await page.evaluate(() => { const x = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().left : null; }; return { tdur: x('#tdur'), more: x('#morebtn'), skip: x('[data-r=skip]'), seek: x('#seek') }; });
      assert.ok(xs.seek < xs.tdur && xs.tdur < xs.more && xs.more < xs.skip, JSON.stringify(xs)); });
    await t('the icon is below the video box (in the control row)', async () => {
      const r = await page.evaluate(() => ({ v: document.querySelector('#vwrap').getBoundingClientRect().bottom, m: document.querySelector('#morebtn').getBoundingClientRect().top }));
      assert.ok(r.m >= r.v, JSON.stringify(r)); await page.screenshot({ path: path.join(OUT, 'room-controls.png') }); });
    await ctx.close(); }
  { const d = db({ room: { admin_id: 'u1' } }); const { ctx, page } = await open(browser, port, d);
    await t('member (not admin) in Let\'s vote: icon is active, no Skip', async () => {
      assert.ok(!(await page.$('#morebtn.dis'))); assert.ok(!(await page.$('[data-r=skip]'))); await page.click('#morebtn'); await page.waitForSelector('#mv'); });
    await ctx.close(); }
  for (const mode of ['play', 'autoplay']) {
    const d = db({ room: { admin_id: 'u1', playback_mode: mode } }); const { ctx, page } = await open(browser, port, d);
    await t(`member in ${mode}: icon is active and opens More videos`, async () => { assert.ok(!(await page.$('#morebtn.dis'))); await page.click('#morebtn'); await page.waitForSelector('#mv'); });
    await ctx.close(); }
  { const d = db({ room: { admin_id: 'u1', playback_mode: 'leader' } }); const { ctx, page } = await open(browser, port, d);
    await t("member in Leader's choice: icon is disabled and opens nothing", async () => { assert.ok(await page.$('#morebtn.dis')); await page.dispatchEvent('#morebtn', 'click'); await page.waitForTimeout(300); assert.ok(!(await page.$('#mv'))); }); await ctx.close(); }
  { const d = db({ room: { playback_mode: 'leader' } }); const { ctx, page } = await open(browser, port, d);
    await t("leader in Leader's choice: icon is active", async () => { assert.ok(!(await page.$('#morebtn.dis'))); await page.click('#morebtn'); await page.waitForSelector('#mv'); }); await ctx.close(); }

  console.log('C. More videos overlay: one row over the video, scroll left/right, close X, never empty');
  { const { ctx, page } = await open(browser, port, db());
    await page.click('#morebtn'); await page.waitForSelector('#mv .mvc');
    await t('overlay covers the video frame and nothing else', async () => {
      const r = await page.evaluate(() => { const w = document.querySelector('#vwrap').getBoundingClientRect(), o = document.querySelector('#mv').getBoundingClientRect(); return { dl: Math.abs(w.left - o.left), dt: Math.abs(w.top - o.top), dw: Math.abs(w.width - o.width), dh: Math.abs(w.height - o.height) }; });
      assert.ok(r.dl < 1 && r.dt < 1 && r.dw < 1 && r.dh < 1, JSON.stringify(r)); await page.screenshot({ path: path.join(OUT, 'more-videos-phone.png') }); });
    await t('queue is empty yet the row has default videos (never empty)', async () => assert.ok((await page.$$('#mv .mvc')).length >= 8));
    await t('all videos are in ONE row (same top edge) that scrolls sideways', async () => {
      const r = await page.evaluate(() => { const cs = [...document.querySelectorAll('#mv .mvc')]; const row = document.querySelector('#mvrow'); return { tops: [...new Set(cs.map(c => Math.round(c.getBoundingClientRect().top)))].length, sw: row.scrollWidth, cw: row.clientWidth, ox: getComputedStyle(row).overflowX }; });
      assert.strictEqual(r.tops, 1, JSON.stringify(r)); assert.ok(r.sw > r.cw && r.ox === 'auto', JSON.stringify(r)); });
    await t('every video tile carries the platform icon, not the platform\'s own bars', async () => assert.strictEqual((await page.$$('#mv .mvth .pbg')).length, (await page.$$('#mv .mvc')).length));
    await t('swipe / scroll right then left moves the row', async () => {
      const a = await page.evaluate(() => { const r = document.querySelector('#mvrow'); r.scrollLeft = 300; return r.scrollLeft; }); assert.ok(a > 0);
      await page.evaluate(() => { const r = document.querySelector('#mvrow'); r.style.scrollBehavior = 'auto'; r.scrollLeft = 0; }); await page.waitForTimeout(400); assert.ok(await page.evaluate(() => document.querySelector('#mvrow').scrollLeft) < 30); });
    await t('close X closes it', async () => { await page.click('#mv .mvx'); await page.waitForFunction(() => !document.querySelector('#mv')); });
    await t('the icon toggles it open / closed', async () => { await page.click('#morebtn'); await page.waitForSelector('#mv'); await page.click('#morebtn'); await page.waitForFunction(() => !document.querySelector('#mv')); });
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db(), { ctx: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 } });
    await page.click('#morebtn'); await page.waitForSelector('#mv .mvc');
    await t('desktop: ‹ › arrows scroll the row', async () => {
      assert.ok(await page.isVisible('#mv .mvn.r')); await page.click('#mv .mvn.r'); await page.waitForTimeout(600);
      assert.ok(await page.evaluate(() => document.querySelector('#mvrow').scrollLeft) > 50); await page.screenshot({ path: path.join(OUT, 'more-videos-desktop.png') }); });
    await ctx.close(); }

  console.log('D. Let\'s vote: one vote each, countdown, early close, winner');
  { const d = db({ queue: [qitem(1, ['u1']), qitem(2, []), qitem(3, [])] }); const { ctx, page } = await open(browser, port, d);
    await page.click('#morebtn'); await page.waitForSelector('#mv .mvc');
    await t('header explains voting; votes are shown as hearts', async () => { const tx = await page.innerText('#mv .mvh'); assert.ok(/Vote for the next video/.test(tx), tx); assert.ok(await page.$('#mv .mvv')); });
    await t('tap a video = my one vote (RPC room_vote), "Your vote" appears on exactly that tile', async () => {
      await page.click('#mv .mvc[data-i="1"]'); await page.waitForSelector('#mv .mvth em');
      assert.strictEqual((await page.$$('#mv .mvth em')).length, 1); assert.deepStrictEqual((await calls(page, 'room_vote')).pop(), { p_queue_id: 'q2' }); });
    await t('tap another video MOVES the vote (still only one "Your vote")', async () => {
      await page.click('#mv .mvc[data-i="2"]'); await page.waitForTimeout(300);
      assert.strictEqual((await page.$$('#mv .mvth em')).length, 1); assert.ok(await page.evaluate(() => window.__db.room_queue.filter(q => q.votes.includes('me')).length === 1)); });
    await t('tap my video again withdraws the vote', async () => { await page.click('#mv .mvc.mine'); await page.waitForTimeout(300); assert.strictEqual((await page.$$('#mv .mvth em')).length, 0); });
    await t('a default video can be voted: it is added to Up next carrying my vote', async () => {
      const before = await page.evaluate(() => window.__db.room_queue.length); const n = await page.$$eval('#mv .mvc', e => e.length);
      await page.click(`#mv .mvc[data-i="${n - 1}"]`); await page.waitForTimeout(400); assert.ok((await calls(page, 'room_pick')).length >= 1); assert.strictEqual(await page.evaluate(() => window.__db.room_queue.length), before + 1); });
    await ctx.close(); }
  { // the vote window is open (video ended)
    const now = Date.now();
    const d = db({ room: { media_ver: 4, play_state: { playing: false, pos: 0, ts: now, seq: 5, idx: 0, ended: true, phase: 'VOTING', vote_until: now + 9000, vote_ms: 12000 } }, queue: [qitem(1, ['u1']), qitem(2, ['u2']), qitem(3, [], { suggested: true })] });
    const { ctx, page } = await open(browser, port, d);
    await t('when the video ends the vote opens by itself over the video, with a countdown', async () => {
      await page.waitForSelector('#mv .mvc', { timeout: 4000 }); assert.ok(/Vote for the next video/.test(await page.innerText('#mv .mvh'))); assert.ok(/^\d+s$/.test((await page.innerText('#mv .mvtm')).trim()));
      await page.waitForFunction(() => document.querySelector('#rm').dataset.pstate === 'VOTING', null, { timeout: 3000 }); await page.screenshot({ path: path.join(OUT, 'vote-open.png') }); });
    await t('entering a room mid-vote does not announce a winner', async () => assert.ok(!/Winner:/.test(await page.evaluate(() => document.body.innerText))));
    await t('admin sees End vote; it calls room_close_vote with the media version', async () => {
      await page.click('#mv .mvend'); await page.waitForTimeout(300); assert.deepStrictEqual((await calls(page, 'room_close_vote')).pop(), { p_room: 'r1', p_ver: 4 }); });
    await t('winner starts: overlay closes by itself and the winner is announced', async () => {
      await patch(page, { media_ver: 5, media: yt('winner00001', 'The Winner Video'), play_state: { playing: true, pos: 0, ts: Date.now(), seq: 6, idx: 0, phase: 'PLAYING' } }, []);
      await sync(page); await page.waitForFunction(() => !document.querySelector('#mv'), null, { timeout: 4000 });
      await page.waitForFunction(() => /Winner: The Winner Video/.test(document.body.innerText), null, { timeout: 3000 });
      assert.ok(['LOADING_NEXT_VIDEO', 'PLAYING'].includes(await page.evaluate(() => NovaRoom.state()))); });
    await ctx.close(); }
  { const now = Date.now();
    const d = db({ room: { admin_id: 'u1', media_ver: 4, play_state: { playing: false, pos: 0, ts: now, seq: 5, idx: 0, ended: true, phase: 'VOTING', vote_until: now + 9000, vote_ms: 12000 } }, queue: [qitem(1, ['u1']), qitem(2, [])] });
    const { ctx, page } = await open(browser, port, d);
    await t('member sees the vote but no End-vote button (only the leader closes it early)', async () => { await page.waitForSelector('#mv .mvc'); assert.ok(!(await page.$('#mv .mvend'))); });
    await t('the vote window closed: a member waits, the tie header says the leader picks', async () => {
      await patch(page, { play_state: { playing: false, pos: 0, ts: now, seq: 6, idx: 0, ended: true, phase: 'VOTING', vote_until: Date.now() - 500, vote_ms: 12000 } }, [qitem(1, ['u1']), qitem(2, ['u2'])]);
      await sync(page); await page.waitForFunction(() => /Tie/.test(document.querySelector('#mv .mvh').innerText), null, { timeout: 4000 }); });
    await ctx.close(); }

  console.log("E. Leader's choice: the leader selects the next video");
  { const d = db({ room: { playback_mode: 'leader' }, queue: [qitem(1), qitem(2)] }); const { ctx, page } = await open(browser, port, d);
    await page.click('#morebtn'); await page.waitForSelector('#mv .mvc');
    await t('no vote hearts in Leader\'s choice; the header says tap to play next', async () => { assert.ok(!(await page.$('#mv .mvv'))); assert.ok(/play it next/.test(await page.innerText('#mv .mvh'))); });
    await t('tap = select as next (room_set_next) and the tile shows "Next"; tap again clears it', async () => {
      await page.click('#mv .mvc[data-i="1"]'); await page.waitForSelector('#mv .mvth em'); assert.deepStrictEqual((await calls(page, 'room_set_next')).pop(), { p_room: 'r1', p_queue_id: 'q2' });
      assert.strictEqual(await page.innerText('#mv .mvth em'), 'Next');
      await page.click('#mv .mvc[data-i="1"]'); await page.waitForFunction(() => !document.querySelector('#mv .mvth em')); });
    await ctx.close(); }
  { const now = Date.now(); const d = db({ room: { playback_mode: 'play', media_ver: 4, play_state: { playing: false, pos: 0, ts: now, seq: 5, idx: 0, ended: true, phase: 'WAITING_FOR_SELECTION' } }, queue: [qitem(1)] });
    const { ctx, page } = await open(browser, port, d);
    await t('Just play: video finished → completed state + More videos opens for the leader; state is WAITING_FOR_SELECTION', async () => {
      await page.waitForSelector('#mv .mvc'); await page.waitForFunction(() => document.querySelector('#rm').dataset.pstate === 'WAITING_FOR_SELECTION', null, { timeout: 3000 }); await page.click('#mv .mvx');
      await page.waitForSelector('#vcover'); assert.ok(/Video finished/.test(await page.innerText('#vcover'))); });
    await ctx.close(); }
  { const now = Date.now(); const d = db({ room: { playback_mode: 'autoplay', media_ver: 4, play_state: { playing: false, pos: 0, ts: now, seq: 5, idx: 0, ended: true, phase: 'QUEUE_EMPTY' } }, queue: [] });
    const { ctx, page } = await open(browser, port, d);
    await t('Autoplay with an empty queue: "No more videos in the queue", state QUEUE_EMPTY, users can still add', async () => {
      await page.waitForSelector('#vcover'); assert.ok(/No more videos in the queue/.test(await page.innerText('#vcover'))); await page.waitForFunction(() => document.querySelector('#rm').dataset.pstate === 'QUEUE_EMPTY', null, { timeout: 3000 }); assert.ok(await page.$('#vcover [data-r=add]')); });
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed. Screenshots: ${OUT}`);
  process.exit(bad ? 1 : 0);
})();
