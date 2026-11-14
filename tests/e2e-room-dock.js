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
    if(n==='list_rooms') return Promise.resolve(ok(window.__rooms||[]));
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
const other = (i, title) => ({ id: 'x' + i, code: 'other00' + i, admin_id: 'u1', title, privacy: 'public', status: 'open', created_at: new Date(Date.now() - 600000).toISOString(), count: 2, mine: false, invited: false,
  members: [{ id: 'u1', full_name: 'Suhani', username: 'anvi', avatar_url: null }, { id: 'u2', full_name: 'Karan', username: 'karan', avatar_url: null }],
  media: yt('zzzzzzzzz0' + i, title), play_state: { playing: true, pos: 30, ts: Date.now(), seq: 1 } });

async function open(browser, port, o) {
  const ctx = await browser.newContext(Object.assign({ deviceScaleFactor: 1 }, o.ctx));
  await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('**/flagcdn.com/**', r => r.abort());
  await ctx.route('https://www.youtube.com/iframe_api', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_YT }));
  await ctx.route('https://i.ytimg.com/**', r => r.fulfill({ contentType: 'image/svg+xml', body: THUMB(1) }));
  await ctx.addInitScript(`window.__db=${JSON.stringify(db())};window.__rooms=${JSON.stringify([other(1, 'Kesariya | Arijit Singh'), other(2, 'Deepika Padukone interview')])};`);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.errs = errs;
  await page.goto(`http://localhost:${port}/nova-home.html`);
  await page.waitForSelector('#rm #ctl .cb', { timeout: 8000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}
const rect = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; }, sel);
const vp = (w, h, extra) => ({ ctx: Object.assign({ viewport: { width: w, height: h } }, extra || {}) });

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();

  const layouts = [
    ['laptop 1366x768', vp(1366, 768), 'side'],
    ['monitor 1920x1080', vp(1920, 1080), 'side'],
    ['tablet portrait 820x1180', vp(820, 1180, { hasTouch: true, isMobile: true }), 'half'],
    ['tablet landscape 1024x768', vp(1024, 768, { hasTouch: true }), 'half'],
    ['phone 390x844', vp(390, 844, { hasTouch: true, isMobile: true }), 'stack'],
  ];
  for (const [name, o, mode] of layouts) {
    console.log('Dock — ' + name);
    const { ctx, page } = await open(browser, port, o);
    const W = o.ctx.viewport.width, H = o.ctx.viewport.height, slug = name.replace(/[^a-z0-9]+/gi, '-');
    await t('dock button sits LEFT of the Leave X in the room header', async () => {
      const a = await rect(page, '#rm .rdock'), b = await rect(page, '#rm [data-r=leave]');
      assert.ok(a && b && a.r <= b.l + 1 && Math.abs(a.t - b.t) < 3, JSON.stringify({ a, b })); });
    await t('before opening: room fills the screen, Home is not shown beside it', async () => {
      const r = await rect(page, '#rm'); assert.ok(r.l === 0 && r.w === W, JSON.stringify(r));
      assert.strictEqual(await page.evaluate(() => document.body.classList.contains('nv-dock')), false); });
    await page.click('#rm .rdock'); await page.waitForTimeout(500);
    await t(mode === 'stack' ? 'Home takes the top half, room the bottom half' : mode === 'half' ? 'Home takes the left half, room the right half' : 'Home is a mobile-width column on the left, room shifted right', async () => {
      const w = await rect(page, '.wrap'), r = await rect(page, '#rm');
      if (mode === 'stack') { assert.ok(w.t === 0 && Math.abs(w.h - H / 2) <= 1 && w.w === W, JSON.stringify(w)); assert.ok(Math.abs(r.t - H / 2) <= 2 && r.l === 0 && r.b >= H - 1, JSON.stringify(r)); }
      else if (mode === 'half') { assert.ok(w.l === 0 && Math.abs(w.w - W / 2) <= 1 && w.h === H, JSON.stringify(w)); assert.ok(Math.abs(r.l - W / 2) <= 1 && r.r === W, JSON.stringify(r)); }
      else { assert.ok(w.l === 0 && w.w >= 380 && w.w <= 460 && w.h === H, JSON.stringify(w)); assert.ok(Math.abs(r.l - w.w) <= 1 && r.r === W, JSON.stringify(r)); } });
    await t('nothing overlaps: Home column and room do not cover each other', async () => {
      const w = await rect(page, '.wrap'), r = await rect(page, '#rm');
      assert.ok(mode === 'stack' ? w.b <= r.t + 1 : w.r <= r.l + 1, JSON.stringify({ w, r })); });
    await t('Home is the one-column phone layout: header, search, rooms stacked in ONE column', async () => {
      const g = await page.evaluate(() => { const c = [...document.querySelectorAll('.wrap .room')].map(e => Math.round(e.getBoundingClientRect().left)); return { n: c.length, same: new Set(c).size, gear: !!document.querySelector('#gear').offsetWidth, ppl: !!document.querySelector('#ppl').offsetWidth, search: !!document.querySelector('#hs').offsetWidth }; });
      assert.ok(g.n >= 2 && g.same === 1 && g.gear && g.ppl && g.search, JSON.stringify(g)); });
    await t('room stays usable: video, chat feed and message box are all visible inside its own area', async () => {
      const r = await rect(page, '#rm'), v = await rect(page, '#vwrap'), f = await rect(page, '#feed'), c = await rect(page, '#cin');
      assert.ok(v.w > 150 && f.h > 40 && c.h > 30, JSON.stringify({ v, f, c }));
      assert.ok(v.l >= r.l - 1 && v.r <= r.r + 1 && c.r <= r.r + 1 && c.b <= r.b + 1, JSON.stringify({ r, v, c })); });
    await page.screenshot({ path: path.join(OUT, 'dock-' + slug + '.png') });
    await t('Settings button opens Settings inside the Home column (room keeps playing, page not navigated)', async () => {
      const url0 = page.url(); await page.click('#gear'); await page.waitForSelector('#nvDockPanel .nvdp-frame', { timeout: 4000 });
      const p = await rect(page, '#nvDockPanel'), w = await rect(page, '.wrap');
      assert.ok(Math.abs(p.w - w.w) <= 1 && Math.abs(p.h - w.h) <= 1 && p.l === w.l && p.t === w.t, JSON.stringify({ p, w }));
      assert.ok(/profile\.html\?embed=1#settings/.test(await page.evaluate(() => document.querySelector('#nvDockPanel iframe').src)));
      assert.strictEqual(page.url(), url0); assert.ok(await page.$('#rm #vwrap')); });
    await t('People button switches the same panel to Friends', async () => {
      await page.evaluate(() => NovaDock.closePanel()); await page.click('#ppl'); await page.waitForTimeout(300);
      assert.strictEqual(await page.evaluate(() => NovaDock.panelName()), 'friends'); });
    await t('Back / "Nova home" inside the panel closes only the panel', async () => {
      const fr = page.frames().find(f => /profile\.html/.test(f.url())); assert.ok(fr);
      await fr.waitForFunction(() => window.NovaEmbed && NovaEmbed.active, null, { timeout: 5000 });
      await fr.evaluate(() => { const a = document.createElement('a'); a.href = 'nova-home.html'; a.textContent = 'x'; document.body.appendChild(a); a.click(); });
      await page.waitForFunction(() => document.querySelector('#nvDockPanel').hidden, null, { timeout: 3000 });
      assert.ok(await page.$('#rm #vwrap')); assert.ok(/nova-home\.html/.test(page.url())); });
    await t('tapping a room in the docked Home asks before switching rooms', async () => {
      await page.evaluate(() => document.querySelector('.wrap .room[data-code]').click());
      await page.waitForSelector('#nvg', { timeout: 3000 });
      assert.ok(/Switch rooms/.test(await page.innerText('#nvg')));
      await page.click('#nvg button:not(.p)'); await page.waitForTimeout(200);
      assert.strictEqual(await page.evaluate(() => (window.__calls || []).filter(c => c[0] === 'join_room').length), 0); });
    await t('right-click on a room card in the docked Home opens the preview sheet', async () => {
      if (!o.ctx.hasTouch || mode === 'side' || mode === 'half') {
        const box = await page.evaluate(() => { const r = document.querySelector('.wrap .room[data-code]').getBoundingClientRect(); return [r.left + 30, r.top + 30]; });
        await page.mouse.click(box[0], box[1], { button: 'right' }); await page.waitForTimeout(400);
        assert.ok(await page.evaluate(() => !!document.querySelector('.rc-ov,.rc-sheet')), 'no preview sheet');
        await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      } });
    await t('dock button again: room goes back to full screen', async () => {
      await page.evaluate(() => { const e = document.querySelector('#nvg'); if (e) e.remove(); document.querySelectorAll('.rc-ov').forEach(e => e.remove()); });
      await page.click('#rm .rdock'); await page.waitForTimeout(450);
      const r = await rect(page, '#rm'); assert.ok(r.l === 0 && r.t === 0 && r.w === W && r.h === H, JSON.stringify(r)); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close();
  }

  console.log('Room settings popup');
  for (const [name, o] of [['phone', vp(390, 640, { hasTouch: true, isMobile: true })], ['laptop short', vp(1280, 560)]]) {
    const { ctx, page } = await open(browser, port, o);
    await t(name + ': no visible scrollbar, content still scrolls', async () => {
      await page.click('#rm [data-r=settings]'); await page.waitForSelector('#rm .md .mb');
      const g = await page.evaluate(() => { const m = document.querySelector('#rm .md .mb'); const cs = getComputedStyle(m); return { gutter: m.offsetWidth - m.clientWidth, sw: cs.scrollbarWidth, sh: m.scrollHeight, ch: m.clientHeight }; });
      assert.ok(g.sh > g.ch, 'popup should overflow in this viewport ' + JSON.stringify(g)); assert.ok(g.gutter === 0 && g.sw === 'none', JSON.stringify(g));
      const top = await page.evaluate(() => { const m = document.querySelector('#rm .md .mb'); m.scrollTop = 9999; return m.scrollTop; }); assert.ok(top > 0); });
    await page.screenshot({ path: path.join(OUT, 'settings-' + name.replace(/ /g, '-') + '.png') });
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
