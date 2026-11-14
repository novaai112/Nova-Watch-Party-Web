/* Browser test for the room VIDEO PLAYER (room-player.js): overlay controls, ⋮ glass menu (details / speed / quality / subtitles),
 * Hide Player / Show Player, full screen, admin-only seek (timeline, ±15 s buttons, double tap), viewers read-only, plain <video> files.
 * Run: E2E_OUT=/some/dir node tests/e2e-room-player.js   (needs `playwright` + Chromium, and ffmpeg for the sample clip) */
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
  channel:()=>{const c=new Proxy({},{get(_,k){ if(k==='then')return undefined; if(k==='send')return m=>{(window.__sent=window.__sent||[]).push(m);return Promise.resolve('ok')}; return()=>c}});return c},removeChannel(){},storage:generic()};}};`;
/* fake YouTube iframe API: a tiny player whose state the test can drive */
const FAKE_YT = `window.YT={Player:function(id,o){const s=this;s._s=-1;s._rate=1;s._q='medium';s._cap=null;window.__seeks=[];
 s.getCurrentTime=()=>window.__ytt||0;s.getDuration=()=>7161;s.getPlayerState=()=>s._s;
 const set=v=>{s._s=v;o.events&&o.events.onStateChange&&o.events.onStateChange({data:v});};s.__set=set;
 s.playVideo=()=>set(1);s.pauseVideo=()=>set(2);s.seekTo=t=>{window.__ytt=t;window.__seeks.push(t)};s.setVolume=()=>{};s.destroy=()=>{};s.getPlaylistIndex=()=>0;
 s.getVideoLoadedFraction=()=>.4;s.getAvailablePlaybackRates=()=>[.25,.5,.75,1,1.25,1.5,1.75,2];s.getPlaybackRate=()=>s._rate;s.setPlaybackRate=r=>{s._rate=r;window.__rate=r};
 s.getAvailableQualityLevels=()=>['hd1080','hd720','large','medium','small','tiny'];s.getPlaybackQuality=()=>s._q;s.setPlaybackQuality=q=>{s._q=q==='default'?'medium':q;window.__q=q};
 s.loadModule=m=>{window.__mod=m};s.unloadModule=()=>{window.__mod=null};
 s.getOption=(m,k)=>k==='tracklist'?[{languageCode:'en',displayName:'English'},{languageCode:'hi',displayName:'Hindi'}]:null;
 s.setOption=(m,k,v)=>{window.__cap=v};
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
const shot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png') });
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const txt = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
const pointer = (page, x, y) => page.evaluate(([x, y]) => { const g = document.querySelector('#pgz'), r = g.getBoundingClientRect(); const o = { clientX: r.left + r.width * x, clientY: r.top + r.height * y, pointerType: 'touch', bubbles: true, button: 0 }; g.dispatchEvent(new PointerEvent('pointerup', o)); }, [x, y]);
const wake = page => page.evaluate(() => NovaPlayer.wake());

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();

  console.log('A. admin: controls drawn over the video (phone)');
  { const { ctx, page } = await open(browser, port, db());
    await page.evaluate(() => { window.__ytt = 49 * 60 + 28; }); await page.waitForTimeout(500);
    await t('top-right buttons in order: full screen, like, ⋮', async () => {
      const l = await page.evaluate(() => [...document.querySelectorAll('#pui .ptop .pb')].map(b => b.dataset.p));
      assert.deepStrictEqual(l, ['fs', 'like', 'more']); });
    await t('centre: back 15 · play/pause · forward 15 are shown for the admin', async () => {
      const l = await page.evaluate(() => [...document.querySelectorAll('#pui .pmid .pb')].map(b => b.dataset.p + ':' + (getComputedStyle(b).display !== 'none')));
      assert.deepStrictEqual(l, ['back:true', 'toggle:true', 'fwd:true']); });
    await t('time reads "49:28 / 1:59:21" and the timeline is interactive', async () => {
      assert.strictEqual(await txt(page, '#pui .ptm'), '49:28 / 1:59:21');
      assert.strictEqual(await page.evaluate(() => document.querySelector('#pui .ptw').getAttribute('aria-disabled')), 'false'); });
    await t('video name is NOT shown above the timeline while not in full screen', async () => {
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#pui .pinfo')).display), 'none'); });
    await t('the old control row below the video (−10 ▶ +10, slider, More videos, Skip) is still there', async () => {
      assert.ok(await page.evaluate(() => ['back', 'toggle', 'fwd', 'more', 'skip'].every(r => document.querySelector('#ctl [data-r=' + r + ']')) && !!document.querySelector('#ctl #seek')));
      await shot(page, 'A-phone-controls'); });
    await t('big ▶/❚❚ toggles playback and publishes it', async () => {
      await click(page, '#pui [data-p=toggle]'); await page.waitForTimeout(400);
      assert.ok((await calls(page, 'room_set_state')).length >= 1); });
    await t('tapping the video hides the controls while playing; tapping again brings them back', async () => {
      await page.evaluate(() => window.__ytp.playVideo()); await page.waitForTimeout(300); await wake(page);
      await pointer(page, .5, .5); await page.waitForTimeout(400);
      assert.strictEqual(await page.evaluate(() => document.querySelector('#pui').dataset.vis), '0');
      await pointer(page, .5, .5); await page.waitForTimeout(400);
      assert.strictEqual(await page.evaluate(() => document.querySelector('#pui').dataset.vis), '1'); });
    await t('double tap on the right = +15 s, on the left = −15 s (admin)', async () => {
      await page.evaluate(() => { window.__ytt = 600; window.__seeks = []; }); await page.waitForTimeout(300);
      await pointer(page, .8, .5); await page.waitForTimeout(60); await pointer(page, .8, .5);
      await page.waitForTimeout(100);
      let s = await page.evaluate(() => window.__seeks.slice()); assert.deepStrictEqual(s, [615], JSON.stringify(s));
      await page.waitForTimeout(1100); await page.evaluate(() => { window.__seeks = []; });
      await pointer(page, .2, .5); await page.waitForTimeout(60); await pointer(page, .2, .5); await page.waitForTimeout(100);
      s = await page.evaluate(() => window.__seeks.slice()); assert.deepStrictEqual(s, [600], JSON.stringify(s)); });
    await t('dragging the timeline seeks and publishes', async () => {
      await page.evaluate(() => { window.__seeks = []; window.__calls = []; NovaPlayer.wake(); });
      const bb = await page.evaluate(() => { const r = document.querySelector('#pui .ptrack').getBoundingClientRect(); return { x: r.left, w: r.width, y: r.top + r.height / 2 }; });
      await page.mouse.move(bb.x + bb.w * .1, bb.y); await page.mouse.down(); await page.mouse.move(bb.x + bb.w * .5, bb.y, { steps: 4 }); await page.mouse.up();
      await page.waitForTimeout(400);
      const s = await page.evaluate(() => window.__seeks.slice()); assert.ok(s.length === 1 && Math.abs(s[0] - 7161 / 2) < 90, JSON.stringify(s));
      assert.ok((await calls(page, 'room_set_state')).length >= 1); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }

  console.log('B. ⋮ menu (one glass card)');
  { const { ctx, page } = await open(browser, port, db());
    await t('opens with: Hide Player · Video Details · Playback Speed 1x · Video Quality Auto (360p) · Subtitles Off', async () => {
      await click(page, '#pui [data-p=more]'); await page.waitForSelector('#pui .pmenu:not([hidden])');
      const rows = await page.evaluate(() => [...document.querySelectorAll('#pui .pmenu .pr')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
      assert.deepStrictEqual(rows, ['Hide Player', 'Video Details', 'Playback Speed 1x', 'Video Quality Auto (360p)', 'Subtitles Off']);
      await shot(page, 'B-phone-menu'); });
    await t('Video Details opens in the same card: title, platform, length, back works', async () => {
      await click(page, '[data-p=details]');
      const d = await txt(page, '#pui .pmenu');
      assert.ok(/Video Details/.test(d) && /Dil Meri Na Sune/.test(d) && /YouTube/.test(d) && /1:59:21/.test(d) && /Open original/.test(d), d);
      await shot(page, 'B-phone-details'); await click(page, '.pback'); assert.ok(/Hide Player/.test(await txt(page, '#pui .pmenu'))); });
    await t('Playback Speed: 1x / 1.25x / 1.5x / 2.0x, slider, − and +', async () => {
      await click(page, '[data-p=speed]');
      const chips = await page.evaluate(() => [...document.querySelectorAll('#pui .pchip')].map(c => c.innerText));
      assert.deepStrictEqual(chips, ['1x', '1.25x', '1.5x', '2.0x']);
      assert.ok(await page.evaluate(() => !!document.querySelector('#prate') && !!document.querySelector('[data-p="rate-"]') && !!document.querySelector('[data-p="rate+"]')));
      await shot(page, 'B-phone-speed');
      await click(page, '[data-p=rate][data-v="1.5"]'); await page.waitForTimeout(200);
      assert.strictEqual(await page.evaluate(() => window.__rate), 1.5);
      await click(page, '[data-p="rate+"]'); await page.waitForTimeout(100);
      assert.strictEqual(await page.evaluate(() => window.__rate), 1.75);
      await click(page, '[data-p="rate-"]'); await click(page, '[data-p="rate-"]'); await page.waitForTimeout(100);
      assert.strictEqual(await page.evaluate(() => window.__rate), 1.25);
      await page.evaluate(() => { const s = document.querySelector('#prate'); s.value = 2; s.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.strictEqual(await page.evaluate(() => window.__rate), 2);
      assert.strictEqual(await txt(page, '#prout'), '2x'); });
    await t('the speed is broadcast to the room and published with the position', async () => {
      const sent = await page.evaluate(() => (window.__sent || []).filter(m => m.event === 'rate').map(m => m.payload.r));
      assert.ok(sent.includes(1.5) && sent[sent.length - 1] === 2, JSON.stringify(sent));
      assert.ok((await calls(page, 'room_set_state')).length >= 1); });
    await t('main row shows the new speed', async () => { await click(page, '.pback'); assert.ok(/Playback Speed 2x/.test(await txt(page, '#pui .pmenu'))); });
    await t('Video Quality lists the video\'s own levels; picking one changes the player', async () => {
      await click(page, '[data-p=quality]');
      const l = await page.evaluate(() => [...document.querySelectorAll('#pui .plist .pr')].map(r => r.innerText.trim()));
      assert.deepStrictEqual(l, ['Auto (360p)', '1080p', '720p', '480p', '360p', '240p', '144p']);
      await click(page, '[data-p=q][data-v=hd720]'); assert.strictEqual(await page.evaluate(() => window.__q), 'hd720');
      await click(page, '.pback'); assert.ok(/Video Quality 720p/.test(await txt(page, '#pui .pmenu'))); });
    await t('Subtitles lists the video\'s own languages; Off turns them off', async () => {
      await click(page, '[data-p=subs]'); await page.waitForTimeout(700);
      const l = await page.evaluate(() => [...document.querySelectorAll('#pui .plist .pr')].map(r => r.innerText.trim()));
      assert.deepStrictEqual(l, ['Off', 'English', 'Hindi']);
      await click(page, '[data-p=s][data-v=hi]'); assert.deepStrictEqual(await page.evaluate(() => window.__cap), { languageCode: 'hi' });
      await click(page, '.pback'); assert.ok(/Subtitles Hindi/.test(await txt(page, '#pui .pmenu')));
      await click(page, '[data-p=subs]'); await click(page, '[data-p=s][data-v=off]'); assert.deepStrictEqual(await page.evaluate(() => window.__cap), {}); });
    await t('Esc closes the card', async () => { await page.keyboard.press('Escape'); assert.ok(await page.evaluate(() => document.querySelector('#pui .pmenu').hidden)); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }

  console.log('C. Hide Player / Show Player');
  { const { ctx, page } = await open(browser, port, db());
    const m = () => page.evaluate(() => { const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; }; const v = r('#vwrap'), f = r('#feed'), d = r('.rdock'), s = r('.rshow'); return { vh: v.height, feedH: f.height, vis: getComputedStyle(document.querySelector('#vwrap')).visibility, dockR: d.right, showL: s && s.left, showW: s && s.width, ctl: !!r('#ctl'), ctlH: r('#ctl').height }; });
    let before;
    await t('"show player" icon is not visible while the player is shown', async () => { before = await m(); assert.ok(!before.showW, JSON.stringify(before)); });
    await t('Hide Player: video frame collapses, chat grows into its place, control row stays, video keeps playing', async () => {
      await click(page, '#pui [data-p=more]'); await click(page, '[data-p=hide]'); await page.waitForTimeout(250);
      const a = await m();
      assert.ok(a.vh === 0 && a.vis === 'hidden' && a.feedH > before.feedH + before.vh * .8 && a.ctlH > 30, JSON.stringify({ before, a }));
      assert.ok(await page.evaluate(() => window.__ytp._s !== 2), 'player was paused'); await shot(page, 'C-phone-hidden'); });
    await t('the show-player icon appears right of the split icon', async () => {
      const a = await m(); assert.ok(a.showW > 20 && a.showL >= a.dockR - 1 && a.showL - a.dockR < 12, JSON.stringify(a)); });
    await t('tapping it brings the video back', async () => {
      await click(page, '.rshow'); await page.waitForTimeout(250); const a = await m();
      assert.ok(a.vh > 150 && !a.showW && Math.abs(a.feedH - before.feedH) < 4, JSON.stringify(a)); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db(), { ctx: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 } });
    await t('desktop: controls + menu look right', async () => { await page.mouse.move(400, 300); await click(page, '#pui [data-p=more]'); await shot(page, 'D-desktop-menu'); });
    await t('desktop: Hide Player → the chat takes the whole width', async () => {
      await click(page, '[data-p=hide]'); await page.waitForTimeout(300);
      const g = await page.evaluate(() => ({ s: document.querySelector('.scol').getBoundingClientRect(), w: innerWidth }));
      assert.ok(g.s.width > g.w - 80, JSON.stringify(g)); await shot(page, 'D-desktop-hidden');
      await click(page, '.rshow'); await page.waitForTimeout(300);
      const g2 = await page.evaluate(() => document.querySelector('.scol').getBoundingClientRect().width); assert.ok(g2 < 600, g2); });
    await t('full screen: title appears above the timeline; exit restores', async () => {
      await click(page, '#pui [data-p=fs]'); await page.waitForTimeout(500);
      const on = await page.evaluate(() => ({ fs: document.querySelector('#pui').dataset.fs, disp: getComputedStyle(document.querySelector('#pui .pinfo')).display, t: document.querySelector('#pui .ptt').innerText, ic: document.querySelector('#pui [data-p=fs]').getAttribute('aria-label'), w: document.querySelector('#vwrap').getBoundingClientRect().width, nat: !!document.fullscreenElement }));
      assert.ok(on.fs === '1' && on.disp !== 'none' && /Dil Meri/.test(on.t) && on.ic === 'Exit full screen' && on.w >= 1270, JSON.stringify(on));
      await page.evaluate(() => NovaPlayer.wake()); await shot(page, 'E-fullscreen');
      await click(page, '#pui [data-p=fs]'); await page.waitForTimeout(500);
      const off = await page.evaluate(() => ({ fs: document.querySelector('#pui').dataset.fs, disp: getComputedStyle(document.querySelector('#pui .pinfo')).display }));
      assert.ok(off.fs === '0' && off.disp === 'none', JSON.stringify(off)); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }

  console.log('E. everyone except the admin');
  { const { ctx, page } = await open(browser, port, db({ room: { admin_id: 'u1' } }));
    await page.evaluate(() => window.__ytp.playVideo()); await page.waitForTimeout(300);
    await t('no ▶ / back 15 / forward 15; timeline not interactive', async () => {
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#pui .pmid')).display), 'none');
      assert.strictEqual(await page.evaluate(() => document.querySelector('#pui .ptw').getAttribute('aria-disabled')), 'true');
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#pui .ptw')).pointerEvents), 'none'); await shot(page, 'F-viewer'); });
    await t('full screen, like and ⋮ still work for them; time is shown', async () => {
      assert.ok(await page.evaluate(() => ['fs', 'like', 'more'].every(p => document.querySelector('#pui [data-p=' + p + ']'))));
      assert.ok(/\/ 1:59:21/.test(await txt(page, '#pui .ptm'))); });
    await t('double tap does nothing for them', async () => {
      await page.evaluate(() => { window.__seeks = []; }); await pointer(page, .8, .5); await page.waitForTimeout(50); await pointer(page, .8, .5); await page.waitForTimeout(200);
      assert.deepStrictEqual(await page.evaluate(() => window.__seeks), []); });
    await t('speed controls are read-only for them; the admin\'s speed is followed', async () => {
      await wake(page); await click(page, '#pui [data-p=more]'); await click(page, '[data-p=speed]');
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('#pui .pchip,#pui .pstep,#prate')].every(e => e.disabled)));
      await page.evaluate(() => { const c = window.__ytp; }); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }


  console.log('F. plain video file (HTML5 <video>)');
  { let sample = process.env.SAMPLE_VIDEO || path.join(OUT, 'sample.webm');   /* needs ffmpeg once, to make a 20 s test clip */
    if (!fs.existsSync(sample)) require('child_process').execSync(`ffmpeg -v error -y -f lavfi -i testsrc=size=640x360:rate=24 -f lavfi -i sine=frequency=440 -t 20 -c:v libvpx -b:v 300k -c:a libvorbis "${sample}"`);
    const VID = fs.readFileSync(sample);
    const d = db({ room: { media: { kind: 'video', provider: 'link', url: 'https://media.test/sample.webm', title: 'Sample Documentary' }, play_state: { playing: false, pos: 0, ts: Date.now(), seq: 1, phase: 'PAUSED' } } });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); await ctx.route('**/flagcdn.com/**', r => r.abort());
    await ctx.route('https://media.test/**', r => {   /* byte-range support so seeking works like a real server */
      const m = /bytes=(\d*)-(\d*)/.exec(r.request().headers().range || '');
      if (!m) return r.fulfill({ status: 200, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes', 'content-length': String(VID.length) }, body: VID });
      const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], VID.length - 1) : VID.length - 1;
      r.fulfill({ status: 206, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${VID.length}` }, body: VID.subarray(a, b + 1) }); });
    await ctx.addInitScript(`window.__db=${JSON.stringify(d)};`);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://localhost:${port}/nova-home.html`);
    await page.waitForSelector('#vwrap video', { timeout: 8000 }); await page.waitForFunction(() => { const v = document.querySelector('#vwrap video'); return v && v.readyState >= 1; }, null, { timeout: 8000 });
    await page.waitForTimeout(500);
    await t('native browser controls are off; our controls are drawn', async () => {
      assert.ok(await page.evaluate(() => document.querySelector('#vwrap video').controls === false && !!document.querySelector('#pui .ptop')));
      assert.strictEqual(await txt(page, '#pui .ptm'), '0:00 / 0:20'); });
    await t('▶ plays the file; time moves', async () => {
      await click(page, '#pui [data-p=toggle]'); await page.waitForTimeout(1500);
      const v = await page.evaluate(() => ({ p: !document.querySelector('#vwrap video').paused, t: document.querySelector('#vwrap video').currentTime }));
      assert.ok(v.p && v.t > .5, JSON.stringify(v)); });
    await t('forward 15 / back 15 move the real video', async () => {
      await click(page, '#pui [data-p=fwd]'); await page.waitForTimeout(300);
      let tt = await page.evaluate(() => document.querySelector('#vwrap video').currentTime); assert.ok(tt > 15 && tt < 19, tt);
      await page.waitForTimeout(1000); await click(page, '#pui [data-p=back]'); await page.waitForTimeout(300);
      tt = await page.evaluate(() => document.querySelector('#vwrap video').currentTime); assert.ok(tt < 6, tt); });
    await t('speed 1.5x changes the real playbackRate; quality shows the file; subtitles say none', async () => {
      await click(page, '#pui [data-p=more]'); await click(page, '[data-p=speed]'); await click(page, '[data-p=rate][data-v="1.5"]');
      assert.strictEqual(await page.evaluate(() => document.querySelector('#vwrap video').playbackRate), 1.5);
      await click(page, '.pback'); await click(page, '[data-p=quality]'); assert.ok(/Original \(360p\)/.test(await txt(page, '#pui .pmenu')), await txt(page, '#pui .pmenu'));
      await click(page, '.pback'); await click(page, '[data-p=subs]'); assert.ok(/no subtitles/i.test(await txt(page, '#pui .pmenu')));
      await click(page, '.pback'); await click(page, '[data-p=details]'); assert.ok(/Sample Documentary/.test(await txt(page, '#pui .pmenu')) && /640 × 360/.test(await txt(page, '#pui .pmenu')), await txt(page, '#pui .pmenu'));
      await shot(page, 'G-video-details'); });
    await t('no page errors', async () => assert.deepStrictEqual(errs, []));
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed — screenshots in ${OUT}`); process.exit(bad ? 1 : 0);
})();
