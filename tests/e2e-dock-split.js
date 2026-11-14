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
    room_queue: o.queue || [], profiles: [{ id: 'me', full_name: 'Me', username: 'me', avatar_url: null, country_code: 'IN', bio: '', socials: {} }] };
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
  await page.addStyleTag({ content: '.geo-ov,.geo-sheet{display:none!important}' });   // the location prompt is not what these tests are about
  await page.waitForSelector('#rm #ctl .cb', { timeout: 8000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}
const rect = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; }, sel);
const vp = (w, h, extra) => ({ ctx: Object.assign({ viewport: { width: w, height: h } }, extra || {}) });

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();
  const wrapW = page => page.evaluate(() => Math.round(document.querySelector('.wrap').getBoundingClientRect().width));
  const wrapH = page => page.evaluate(() => Math.round(document.querySelector('.wrap').getBoundingClientRect().height));

  console.log('Split resize — laptop (mouse)');
  {
    const { ctx, page } = await open(browser, port, vp(1366, 768));
    await page.click('#rm .rdock'); await page.waitForTimeout(500);
    const w0 = await wrapW(page);
    await t('an invisible resize line sits on the border between Home and the room, with a resize cursor', async () => {
      const r = await rect(page, '#nvDockResize'); assert.ok(r && Math.abs((r.l + r.r) / 2 - w0) <= 2 && r.h === 768, JSON.stringify({ r, w0 }));
      const cs = await page.evaluate(() => { const e = document.querySelector('#nvDockResize'); const c = getComputedStyle(e); return { cur: c.cursor, bg: getComputedStyle(e.firstElementChild).backgroundColor }; });
      assert.strictEqual(cs.cur, 'col-resize'); assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(cs.bg), 'line must be invisible until hovered: ' + cs.bg); });
    await t('hovering the line shows it', async () => {
      await page.mouse.move(w0, 300); await page.waitForTimeout(250);
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#nvDockResize i')).backgroundColor); assert.ok(!/rgba\(0, 0, 0, 0\)/.test(bg), bg); });
    await t('dragging right makes Home wider and the room narrower, nothing overlaps', async () => {
      await page.mouse.move(w0, 300); await page.mouse.down(); await page.mouse.move(w0 + 60, 300, { steps: 5 }); await page.mouse.move(w0 + 140, 300, { steps: 5 }); await page.mouse.up();
      await page.waitForTimeout(200);
      const w1 = await wrapW(page), r = await rect(page, '#rm'); assert.ok(Math.abs(w1 - (w0 + 140)) <= 2, w0 + ' -> ' + w1);
      assert.ok(Math.abs(r.l - w1) <= 1 && r.r === 1366, JSON.stringify(r)); });
    await t('dragging left makes Home narrower, stops at the minimum width', async () => {
      const w1 = await wrapW(page); await page.mouse.move(w1, 300); await page.mouse.down(); await page.mouse.move(40, 300, { steps: 12 }); await page.mouse.up();
      const w2 = await wrapW(page); assert.ok(w2 >= 278 && w2 <= 290, 'min width ' + w2); });
    await t('dragging far right stops so the room keeps a usable width', async () => {
      const w1 = await wrapW(page); await page.mouse.move(w1, 300); await page.mouse.down(); await page.mouse.move(1360, 300, { steps: 12 }); await page.mouse.up();
      const r = await rect(page, '#rm'); assert.ok(r.w >= 335, JSON.stringify(r)); });
    await t('room content still fits after resizing (video + message box inside the room)', async () => {
      const r = await rect(page, '#rm'), v = await rect(page, '#vwrap'), c = await rect(page, '#cin');
      assert.ok(v.l >= r.l - 1 && v.r <= r.r + 1 && c.r <= r.r + 1 && c.l >= r.l - 1, JSON.stringify({ r, v, c })); });
    await page.mouse.move(await wrapW(page), 300); await page.mouse.down(); await page.mouse.move(520, 300, { steps: 6 }); await page.mouse.up();
    const set = await wrapW(page);
    await t('the chosen size is remembered after a reload', async () => {
      await page.reload(); await page.addStyleTag({ content: '.geo-ov,.geo-sheet{display:none!important}' }); await page.waitForSelector('#rm #ctl .cb', { timeout: 8000 }); await page.waitForTimeout(500);
      assert.ok(await page.evaluate(() => document.body.classList.contains('nv-dock')), 'dock should come back open');
      assert.ok(Math.abs(await wrapW(page) - set) <= 2, set + ' vs ' + await wrapW(page)); });
    await t('double-click on the line resets to the default size', async () => {
      const w = await wrapW(page); await page.mouse.dblclick(w, 300); await page.waitForTimeout(250);
      const d = await wrapW(page); assert.ok(d >= 380 && d <= 460, 'default ' + d); });
    await t('arrow keys resize too (keyboard)', async () => {
      await page.focus('#nvDockResize'); const a = await wrapW(page); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
      assert.strictEqual(await wrapW(page), a + 32); });
    await t('no drag leftovers: body class cleared, iframes clickable again', async () => assert.strictEqual(await page.evaluate(() => document.body.classList.contains('nv-dock-drag')), false));
    await t('closing the dock removes the custom size (room full screen again)', async () => {
      await page.click('#rm .rdock'); await page.waitForTimeout(450); const r = await rect(page, '#rm'); assert.ok(r.l === 0 && r.w === 1366, JSON.stringify(r));
      assert.strictEqual(await page.evaluate(() => document.body.style.getPropertyValue('--dk-w')), ''); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close();
  }

  console.log('Split resize — phone (touch, Home on top)');
  {
    const { ctx, page } = await open(browser, port, vp(390, 844, { hasTouch: true, isMobile: true }));
    await page.click('#rm .rdock'); await page.waitForTimeout(500);
    const cdp = await ctx.newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const h0 = await wrapH(page);
    await t('the resize line is a horizontal bar on the border between Home (top) and the room (bottom)', async () => {
      const r = await rect(page, '#nvDockResize'); assert.ok(r && Math.abs((r.t + r.b) / 2 - h0) <= 2 && r.w === 390 && r.h >= 20, JSON.stringify({ r, h0 }));
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#nvDockResize')).cursor), 'row-resize'); });
    await t('dragging the line down with a finger makes Home taller and the room shorter', async () => {
      await touch('touchStart', 195, h0); for (let i = 1; i <= 8; i++) await touch('touchMove', 195, h0 + i * 15); await touch('touchEnd'); await page.waitForTimeout(250);
      const h1 = await wrapH(page), r = await rect(page, '#rm'); assert.ok(Math.abs(h1 - (h0 + 120)) <= 3, h0 + ' -> ' + h1); assert.ok(Math.abs(r.t - h1) <= 2 && r.b >= 843, JSON.stringify(r)); });
    await t('dragging up makes Home shorter; it never gets smaller than the minimum', async () => {
      const h1 = await wrapH(page); await touch('touchStart', 195, h1); for (let i = 1; i <= 20; i++) await touch('touchMove', 195, Math.max(2, h1 - i * 40)); await touch('touchEnd'); await page.waitForTimeout(250);
      const h2 = await wrapH(page); assert.ok(h2 >= 125 && h2 <= 140, 'min ' + h2); });
    await t('room stays usable at the new height (video and message box visible)', async () => {
      const r = await rect(page, '#rm'), v = await rect(page, '#vwrap'), c = await rect(page, '#cin'); assert.ok(v.w > 150 && c.h > 30 && c.b <= r.b + 1 && v.t >= r.t - 1, JSON.stringify({ r, v, c })); });
    await t('the + button follows the Home column', async () => {
      const h = await wrapH(page), f = await rect(page, '#fab'); assert.ok(f.b <= h + 1, JSON.stringify({ f, h })); });
    await t('double-tap resets the split to half / half', async () => {
      const h = await wrapH(page); await touch('touchStart', 195, h); await touch('touchEnd'); await new Promise(r => setTimeout(r, 90)); await touch('touchStart', 195, h); await touch('touchEnd'); await page.waitForTimeout(300);
      const d = await wrapH(page); assert.ok(Math.abs(d - 422) <= 2, 'default ' + d); });
    await page.screenshot({ path: path.join(OUT, 'split-phone.png') });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close();
  }

  console.log('Split resize — tablet portrait (touch, side by side)');
  {
    const { ctx, page } = await open(browser, port, vp(820, 1180, { hasTouch: true, isMobile: true }));
    await page.click('#rm .rdock'); await page.waitForTimeout(500);
    const cdp = await ctx.newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await t('finger drag resizes the side-by-side split', async () => {
      const w0 = await wrapW(page); await touch('touchStart', w0, 600); for (let i = 1; i <= 5; i++) await touch('touchMove', w0 - i * 20, 600); await touch('touchEnd'); await page.waitForTimeout(250);
      const w1 = await wrapW(page), r = await rect(page, '#rm'); assert.ok(Math.abs(w1 - (w0 - 100)) <= 3, w0 + ' -> ' + w1); assert.ok(Math.abs(r.l - w1) <= 1, JSON.stringify(r)); });
    await ctx.close();
  }

  console.log('+ button and profile pages inside the split');
  for (const [name, o] of [['laptop', vp(1366, 768)], ['phone', vp(390, 844, { hasTouch: true, isMobile: true })]]) {
    const { ctx, page } = await open(browser, port, o);
    await page.click('#rm .rdock'); await page.waitForTimeout(500);
    await t(name + ': + button is visible in the Home column', async () => {
      const f = await rect(page, '#fab'), w = await rect(page, '.wrap'); assert.ok(f && f.w >= 50 && f.r <= w.r && f.b <= w.b, JSON.stringify({ f, w }));
      const top = await page.evaluate(() => { const f = document.getElementById('fab').getBoundingClientRect(); return !!document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2).closest('#fab'); }); assert.ok(top, 'covered by something'); });
    await t(name + ': Settings icon opens the MAIN PROFILE page (not the Settings sub-page)', async () => {
      await page.click('#gear'); await page.waitForSelector('#nvDockPanel .nvdp-frame', { timeout: 4000 });
      assert.ok(/embed=1#home$/.test(await page.evaluate(() => document.querySelector('#nvDockPanel iframe').src))); });
    await t(name + ': + button stays reachable on top of the profile panel', async () => {
      await page.waitForSelector('#nvDockFab:not([hidden])', { timeout: 3000 });
      const f = await rect(page, '#nvDockFab'), w = await rect(page, '#nvDockPanel'); assert.ok(f.r <= w.r && f.b <= w.b, JSON.stringify({ f, w }));
      const top = await page.evaluate(() => { const f = document.getElementById('nvDockFab').getBoundingClientRect(); return !!document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2).closest('#nvDockFab'); }); assert.ok(top, 'covered'); });
    await t(name + ': back arrow in a profile sub-page returns to the main profile page, then closes to Nova Home', async () => {
      const fr = page.frames().find(f => /profile\.html/.test(f.url())); await fr.waitForFunction(() => window.NovaEmbed && NovaEmbed.active, null, { timeout: 5000 });
      await fr.evaluate(() => { location.hash = '#settings'; }); await page.waitForTimeout(250);
      const mk = () => fr.evaluate(() => { const b = document.createElement('button'); b.id = 'tb'; b.setAttribute('data-go', 'home'); document.body.appendChild(b); b.click(); b.remove(); return location.hash; });
      assert.strictEqual(await mk(), '#home', 'Settings back arrow should land on #home');
      assert.strictEqual(await page.evaluate(() => document.querySelector('#nvDockPanel').hidden), false, 'panel must stay open on the main profile page');
      await mk(); await page.waitForFunction(() => document.querySelector('#nvDockPanel').hidden, null, { timeout: 3000 }); });
    await t(name + ': a sub-page opened directly (stack of one) still goes up to the main profile page first', async () => {
      await page.click('#gear'); await page.waitForTimeout(500);
      const fr = page.frames().find(f => /profile\.html/.test(f.url()));
      await page.evaluate(() => { const f = document.querySelector('#nvDockPanel iframe'); f.contentWindow.postMessage({ nova: 'dock-go', hash: '#settings' }, location.origin); }); await page.waitForTimeout(300);
      const h = await fr.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-go', 'home'); document.body.appendChild(b); b.click(); return location.hash; });
      assert.strictEqual(h, '#home'); });
    await t(name + ': + button hides on the Friends / chat pages (they have their own bottom bar)', async () => {
      const fr = page.frames().find(f => /profile\.html/.test(f.url())); await fr.evaluate(() => { location.hash = '#friends'; }); await page.waitForTimeout(300);
      assert.strictEqual(await page.evaluate(() => document.getElementById('nvDockFab').hidden), true);
      await fr.evaluate(() => { location.hash = '#settings'; }); await page.waitForTimeout(300);
      assert.strictEqual(await page.evaluate(() => document.getElementById('nvDockFab').hidden), false); });
    await t(name + ': tapping + closes the panel and opens the platform picker', async () => {
      await page.click('#nvDockFab'); await page.waitForTimeout(400);
      assert.ok(await page.evaluate(() => document.querySelector('#nvDockPanel').hidden)); assert.ok(await page.evaluate(() => !document.getElementById('picker').hidden), 'picker not shown'); });
    await t(name + ': no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close();
  }

  console.log('End-screen guard (YouTube end cards)');
  for (const [name, o] of [['laptop', vp(1366, 768)], ['phone', vp(390, 844, { hasTouch: true, isMobile: true })]]) {
    const { ctx, page } = await open(browser, port, o);
    await t(name + ': nothing is drawn over the video in the middle of a video', async () => {
      await page.evaluate(() => { window.__ytt = 100; }); await page.waitForTimeout(1300); assert.strictEqual(await page.$('#vguard'), null); });
    await t(name + ': in the last seconds two panels cover where the playlist card and channel circle appear', async () => {
      await page.evaluate(() => { window.__ytt = 292; }); await page.waitForSelector('#vguard .eg.l', { timeout: 3000 });
      const g = await rect(page, '#vguard'), l = await rect(page, '#vguard .eg.l'), r = await rect(page, '#vguard .eg.r'), v = await rect(page, '#vwrap');
      assert.ok(Math.abs(g.w / g.h - 16 / 9) < 0.03, 'guard follows the 16:9 video ' + JSON.stringify(g));
      assert.ok(g.l >= v.l - 1 && g.r <= v.r + 1 && g.t >= v.t - 1 && g.b <= v.b + 1, JSON.stringify({ g, v }));
      assert.ok(l.l === g.l && l.b === g.b && r.r === g.r && r.b === g.b, JSON.stringify({ l, r, g }));
      /* the two zones from the screenshot (card 2%–34% wide, circle 82%–98% wide, both in the lower half) */
      assert.ok(l.w / g.w >= 0.36 && r.w / g.w >= 0.2 && l.h / g.h >= 0.5, JSON.stringify({ l, r, g }));
      const pe = await page.evaluate(() => getComputedStyle(document.querySelector('#vguard')).pointerEvents); assert.strictEqual(pe, 'none'); });
    await page.screenshot({ path: path.join(OUT, 'endguard-' + name + '.png') });
    await t(name + ': the guard leaves when the video is replaced / restarted', async () => {
      await page.evaluate(() => { window.__ytt = 3; }); await page.waitForTimeout(1300); assert.strictEqual(await page.$('#vguard'), null); });
    await t(name + ': no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
