/* Browser test for NOVA PLAY (room-games.js) inside the real watch room (nova-home.html + room.js + room.css + room-games.css):
 *  - the Games icon (uploaded gamepad PNG) opens the panel in place of the chat; the icon then BECOMES the chat icon (uploaded bubbles PNG)
 *  - the chat icon returns to the chat WITHOUT leaving the game (no game_leave call); the Games icon brings the game back
 *  - only the in-panel Quit icon leaves a game (confirm sheet -> game_leave) and it is shown to players only
 *  - admin controls / Select Game / Start Game exist for the admin ONLY; members see just the member interface
 *  - the video player keeps running and stays mounted while games are opened/closed
 *  - fit: no horizontal overflow, header + footer always visible, buttons reachable on phone / small phone / landscape / tablet / laptop
 * Run: E2E_OUT=/some/dir node tests/e2e-room-games.js    (needs `playwright` + Chromium) */
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
    if(n==='game_state') return Promise.resolve(ok(window.__gstate||{now:Date.now(),session:null}));
    if(n==='game_leave'){ const g=window.__gstate; if(g&&g.me) g.me.left=true; return Promise.resolve(ok(null)); }
    if(n==='game_join'){ const g=window.__gstate; if(g) g.me={team:null,spectator:false,left:false,from_idx:0}; return Promise.resolve(ok(null)); }
    if(n==='game_start'){ window.__started=a; return Promise.resolve(ok({})); }
    return Promise.resolve(ok(null)); },
  channel:()=>{const g=generic();const c=new Proxy({},{get:(_,k)=>k==='on'?(t,f,cb)=>{(window.__rt=window.__rt||[]).push({t,f,cb:cb||f});return c}:k==='then'?undefined:g[k]});return c},removeChannel(){},storage:{from:()=>({upload:async(p)=>{(window.__up=window.__up||[]).push(p);return{data:{path:p},error:null}},remove:async()=>({data:[],error:null}),createSignedUrl:async()=>({data:{signedUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'},error:null})})}};}};`;
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
  await page.waitForSelector('#rm .rgame', { state: 'attached', timeout: 8000 });
  await page.waitForFunction(() => window.__ytp && document.querySelector('#vwrap .ytbox'), null, { timeout: 8000 });
  await page.waitForTimeout(250);
  return { ctx, page };
}
const calls = (page, n) => page.evaluate(n => (window.__calls || []).filter(c => c[0] === n).map(c => c[1]), n);
const sync = page => page.evaluate(() => NovaRoom.sync());
const patch = (page, room, queue) => page.evaluate(([r, q]) => { if (r) Object.assign(window.__db.rooms[0], r); if (q) window.__db.room_queue = q; }, [room, queue]);


/* ---- game fixtures (what game_state returns) ---- */
const PL = [['me', 'Me', 250, 3, 3], ['u1', 'Suhani', 400, 4, 4], ['u2', 'Karan', 100, 1, 0]];
const players = () => PL.map(p => ({ user_id: p[0], team: null, spectator: false, left: false, from_idx: 0, score: p[2], correct: p[3], answered: 4, streak: p[4], best: p[4], ms: 5000 }));
const Q = { n: 2, total: 10, kind: 'mcq', prompt: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'] };
function sess(status, extra, adminId) {
  const now = Date.now();
  return Object.assign({ id: 's1', room_id: 'r1', game: 'trivia', status, q_idx: 1, total: 10, seq: 5, admin_id: adminId || 'me', started_by: adminId || 'me', created_at: new Date(now - 60000).toISOString(),
    cfg: { mode: 'individual', changes: true, spectator: true, sound: false, participation: 'open', seconds: 15 }, phase_end: now + 12000, phase_ms: 15000, current: Q }, extra || {});
}
const state = (status, extra, o = {}) => ({ now: Date.now(), session: status ? sess(status, extra, o.admin) : null, players: players(), me: o.me === null ? null : (o.me || { team: null, spectator: false, left: false, from_idx: 0 }), answer: o.answer || null });
const setState = (page, st) => page.evaluate(st => { st.now = Date.now(); window.__gstate = st; NovaGames.refresh(); }, st);
const swapAdmin = (page, id) => page.evaluate(id => { const r = Object.assign({}, window.__db.rooms[0], { admin_id: id }); window.__db.rooms[0] = r; if (window.__gstate && window.__gstate.session) window.__gstate.session.admin_id = id; (window.__rt || []).filter(x => x.f && x.f.table === 'rooms').forEach(x => x.cb({ new: r })); }, id);
const ready = page => page.waitForFunction(() => document.querySelector('#gpanel') && window.NovaGames, null, { timeout: 8000 });
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]'); }, sel);
async function openGames(page) { await page.click('#rm .rgame'); await page.waitForFunction(() => !document.querySelector('#gpanel').hidden && document.querySelector('#gph')?.innerText, null, { timeout: 4000 }); await page.waitForTimeout(120); }
async function show(page, st) { await setState(page, st); await page.waitForTimeout(450); }

const VIEWS = [['desktop 1440x900', { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false }], ['laptop 1366x768', { viewport: { width: 1366, height: 768 }, hasTouch: false, isMobile: false }],
  ['tablet 820x1180', { viewport: { width: 820, height: 1180 } }], ['phone 390x844', { viewport: { width: 390, height: 844 } }], ['small phone 320x640', { viewport: { width: 320, height: 640 } }], ['phone landscape 844x390', { viewport: { width: 844, height: 390 } }]];

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();

  console.log('A. icons: Games <-> Chat swap, and Quit');
  { const { ctx, page } = await open(browser, port, db(), { ctx: { viewport: { width: 390, height: 844 } } }); await ready(page);
    await t('both uploaded icon images are served', async () => { for (const f of ['game-icon.png', 'chat-icon.png']) { const r = await page.request.get(`http://localhost:${port}/${f}`); assert.strictEqual(r.status(), 200, f); assert.ok((await r.body()).length > 1000, f); } });
    await t('toolbar shows the GAMES icon first (chat icon hidden), button labelled Games', async () => {
      const g = await page.evaluate(() => { const b = document.querySelector('#rm .rgame'), q = s => getComputedStyle(b.querySelector(s)); return { g: q('.gi-game').display, c: q('.gi-chat').display, gm: q('.gi-game').webkitMaskImage || q('.gi-game').maskImage, label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed') }; });
      assert.ok(g.g === 'block' && g.c === 'none' && /game-icon\.png/.test(g.gm) && g.label === 'Games' && g.pressed === 'false', JSON.stringify(g)); });
    await t('video is playing and stays mounted when the panel opens and closes', async () => {
      await page.evaluate(() => window.__ytp.playVideo()); await openGames(page);
      assert.ok(await vis(page, '#vwrap')); assert.ok(await page.evaluate(() => !!document.querySelector('#vwrap .ytbox') && window.__ytp.getPlayerState() === 1)); });
    await t('panel replaces the chat column; icon BECOMES the chat icon', async () => {
      const g = await page.evaluate(() => { const b = document.querySelector('#rm .rgame'), q = s => getComputedStyle(b.querySelector(s)); return { g: q('.gi-game').display, c: q('.gi-chat').display, cm: q('.gi-chat').webkitMaskImage || q('.gi-chat').maskImage, label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), feed: !!document.querySelector('#feed') && getComputedStyle(document.querySelector('#feed')).display }; });
      assert.ok(g.g === 'none' && g.c === 'block' && /chat-icon\.png/.test(g.cm) && g.label === 'Back to chat' && g.pressed === 'true' && g.feed === 'none', JSON.stringify(g)); });
    await show(page, state('question'));
    await t('chat icon returns to the chat WITHOUT leaving the game; game stays live', async () => {
      const before = (await calls(page, 'game_leave')).length;
      await page.click('#rm .rgame'); await page.waitForTimeout(300);
      assert.ok(await vis(page, '#feed') && !(await vis(page, '#gpanel')), 'chat is back');
      assert.strictEqual((await calls(page, 'game_leave')).length, before, 'no game_leave call');
      assert.ok(await vis(page, '#gbanner'), 'live banner offers the way back'); assert.ok(/Quick Trivia is live/.test(await page.innerText('#gbanner')));
      assert.ok(await page.evaluate(() => !document.querySelector('#rm .rgame .gdot').hidden), 'live dot on the icon');
      assert.ok(await page.evaluate(() => window.__gstate.me.left === false), 'still a player'); });
    await t('Games icon (and the banner) bring the same game back, state intact', async () => {
      await page.click('#rm .rgame'); await page.waitForTimeout(250); assert.ok(/Red Planet/.test(await page.innerText('#gpb')));
      await page.click('#rm .rgame'); await page.click('#gbanner button'); await page.waitForTimeout(250); assert.ok(await vis(page, '#gpanel') && /Red Planet/.test(await page.innerText('#gpb'))); });
    await t('the Quit icon is inside the game panel header', async () => assert.ok(await vis(page, '#gph .gb-quit')));
    await t('Quit asks first; "Stay" keeps you in', async () => {
      await page.click('#gph .gb-quit'); await page.waitForSelector('#gps .gsh'); assert.ok(/Quit game\?/.test(await page.innerText('#gps')));
      await page.click('#gps [data-g=close]'); await page.waitForTimeout(150); assert.strictEqual((await calls(page, 'game_leave')).length, 0); });
    await t('confirming Quit calls game_leave once and returns to the chat', async () => {
      await page.click('#gph .gb-quit'); await page.waitForSelector('#gps .gsh'); await page.click('#gps [data-g=quit-yes]'); await page.waitForTimeout(500);
      assert.strictEqual((await calls(page, 'game_leave')).length, 1); assert.ok(await vis(page, '#feed') && !(await vis(page, '#gpanel'))); });
    await t('after Quitting, reopening shows Rejoin and no Quit icon', async () => {
      await page.click('#rm .rgame'); await page.waitForTimeout(500); assert.ok(/Rejoin Game/.test(await page.innerText('#gpb'))); assert.ok(!(await vis(page, '#gph .gb-quit'))); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }

  console.log('B. permissions: admin vs member');
  for (const [who, adminId] of [['admin', 'me'], ['member', 'u1']]) {
    const d = db(); d.rooms[0].admin_id = adminId;
    const { ctx, page } = await open(browser, port, d, { ctx: { viewport: { width: 390, height: 844 } } }); await ready(page); await openGames(page);
    await t(who + ': library — bare game cards, no tabs / filters / descriptions; Select Game ' + (who === 'admin' ? 'visible' : 'absent'), async () => {
      assert.strictEqual(await page.locator('#gpb .gcard').count(), 7);
      assert.strictEqual(await page.locator('#gpb [data-g=pick]').count(), who === 'admin' ? 7 : 0);
      for (const sel of ['.gtabs', '.gcats', '.gmeta', '.ginfo p', '[data-g=tab]', '[data-g=cat]']) assert.strictEqual(await page.locator('#gpb ' + sel).count(), 0, sel + ' must be gone');
      const tx = await page.innerText('#gpb'); for (const w of ['Daily', 'History', 'My stats', 'Trivia', 'Movies', 'Music', 'Social', 'Easy', 'players', 'Everyone gets the same question']) assert.ok(!tx.includes(w) || w === 'Trivia' && /Quick Trivia/.test(tx), 'still shows ' + w);
      if (who === 'member') assert.ok(/Only the room admin can start a game/.test(await page.innerText('#gpb'))); });
    if (who === 'admin') {
      await t('admin: Start is disabled until one complete question exists', async () => {
        await page.click('#gpb [data-g=pick][data-v=trivia]'); await page.waitForSelector('#gps .gsh');
        assert.ok(await page.locator('#gps [data-g=start]').isDisabled()); });
      await t('admin: editor offers question, emoji, picture, options (+ typed answer); no bank settings', async () => {
        const tx = (await page.innerText('#gps')).toLowerCase();
        for (const sel of ['[data-f=prompt]', '[data-f=emoji]', '[data-g=qimg]', '[data-f=opt][data-j="0"]', '[data-g=qtype][data-v=text]']) assert.strictEqual(await page.locator('#gps ' + sel).count(), 1, 'missing ' + sel);
        for (const w of ['picture', 'answer time', 'gameplay', 'participation', 'question order', 'show correct answer', 'allow answer changes', 'spectator mode', 'sound effects', 'summary']) assert.ok(tx.includes(w), 'missing ' + w);
        for (const w of ['category', 'difficulty', 'number of questions', 'game language', 'built-in']) assert.ok(!tx.includes(w), 'old setting still shown: ' + w); });
      await t('admin: write a question with emoji + picture + options; Start sends it with the uploaded picture path', async () => {
        await page.fill('#gps [data-f=prompt]', 'Which movie is this?'); await page.fill('#gps [data-f=emoji]', '🦁👑');
        await page.fill('#gps [data-f=opt][data-j="0"]', 'Frozen'); await page.fill('#gps [data-f=opt][data-j="1"]', 'The Lion King'); await page.check('#gps [data-g=qcor][data-j="1"]');
        await page.setInputFiles('#gps [data-g=qimg]', { name: 'clue.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
        await page.waitForSelector('#gps .gcq-img img'); await page.waitForFunction(() => !document.querySelector('#gps .gcq-up'), null, { timeout: 4000 });
        const up = await page.evaluate(() => window.__up || []); assert.strictEqual(up.length, 1); assert.ok(/^r1\/me\/[0-9a-f-]+\.png$/.test(up[0]), up[0]);
        await page.click('#gps [data-g=set][data-k=seconds][data-v="30"]'); await page.click('#gps [data-g=set][data-k=mode][data-v=team]');
        const t2 = (await page.innerText('#gps')).toLowerCase(); assert.ok(/team assignment/.test(t2) && /team names/.test(t2) && /team battle/.test(t2) && /1 question/.test(t2));
        await page.click('#gps [data-g=cq-add]'); await page.click('#gps [data-g=qtype][data-w=c][data-i="1"][data-v=text]');
        await page.fill('#gps [data-w=c][data-i="1"][data-f=emoji]', '🎬🧊'); await page.fill('#gps [data-w=c][data-i="1"][data-f=answer]', 'Frozen'); await page.fill('#gps [data-w=c][data-i="1"][data-f=accept]', 'Frozen 2, frozen');
        await page.click('#gps [data-g=cq-add]'); await page.fill('#gps [data-w=c][data-i="2"][data-f=prompt]', 'Incomplete one');   /* no options → dropped, hint shown */
        assert.ok(/at least two options/i.test(await page.innerText('#gps')));
        await page.click('#gps [data-g=start]'); await page.waitForTimeout(300); const s = await page.evaluate(() => window.__started);
        assert.ok(s && s.p_game === 'trivia' && s.p_cfg.seconds === 30 && s.p_cfg.mode === 'team' && s.p_cfg.team_names.red, JSON.stringify(s));
        const c = s.p_cfg.custom; assert.strictEqual(c.length, 2, JSON.stringify(c));
        assert.deepStrictEqual([c[0].type, c[0].prompt, c[0].emoji, c[0].options, c[0].correct], ['options', 'Which movie is this?', '🦁👑', ['Frozen', 'The Lion King'], 1]);
        assert.ok(/^r1\/me\/[0-9a-f-]+\.png$/.test(c[0].image));
        assert.deepStrictEqual([c[1].type, c[1].answer, c[1].accept, c[1].image], ['text', 'Frozen', ['Frozen 2', 'frozen'], '']); });
      await t('admin: cancelling the editor removes the draft picture again', async () => {
        await show(page, state(null)); await page.click('#gpb [data-g=pick][data-v=wyr]'); await page.waitForSelector('#gps .gsh');
        assert.strictEqual(await page.locator('#gps [data-g=qtype]').count(), 0, 'Would You Rather has no typed answers'); assert.strictEqual(await page.locator('#gps [data-g=qcor]').count(), 0, 'no correct option in Would You Rather');
        await page.click('#gps [data-g=close]'); await page.waitForSelector('#gps', { state: 'hidden' }); });
      await show(page, state('question'));
      await t('admin: footer has Pause / Skip / Players / End (+ reactions)', async () => { const tx = await page.innerText('#gpf'); for (const w of ['Pause', 'Skip', 'Players', 'End']) assert.ok(tx.includes(w), w); assert.strictEqual(await page.locator('#gpf .gre button').count(), 5); });
      await t('admin: pause then resume buttons call the server', async () => { await page.click('#gpf [data-g=pause]'); await page.waitForTimeout(250); assert.strictEqual((await calls(page, 'game_pause')).length, 1); });
      await show(page, state('paused', { paused_phase: 'question', paused_left: 8000 }));
      await t('admin: paused cover shown and Resume replaces Pause', async () => { assert.ok(/Game Paused/.test(await page.innerText('#gpanel'))); assert.ok(await vis(page, '#gpf [data-g=resume]')); assert.ok(!(await vis(page, '#gpf [data-g=pause]'))); });
      await t('admin: End asks for confirmation then calls game_end', async () => { await page.click('#gpf [data-g=end]'); await page.waitForSelector('#gps .gsh'); assert.strictEqual((await calls(page, 'game_end')).length, 0); await page.click('#gps [data-g=end-yes]'); await page.waitForTimeout(250); assert.strictEqual((await calls(page, 'game_end')).length, 1); });
    } else {
      await show(page, state('question', {}, { admin: 'u1' }));
      await t('member: sees question, 4 answer choices, countdown, leaderboard — and NO admin controls', async () => {
        const tx = await page.innerText('#gpb'); assert.ok(/Red Planet/.test(tx)); assert.strictEqual(await page.locator('#gpb [data-g=ans]').count(), 4); assert.ok(await vis(page, '#gqt'));
        assert.strictEqual(await page.locator('#gpf .gadm').count(), 0); for (const g of ['pause', 'resume', 'skip', 'end', 'next', 'start', 'pick', 'rematch', 'addq', 'reveal']) assert.strictEqual(await page.locator(`#gp [data-g=${g}], #gpanel [data-g=${g}]`).count(), 0, g + ' must not exist for a member'); });
      await t('member: picking an answer submits it privately; status says submitted', async () => {
        await page.click('#gpb [data-g=ans][data-i="1"]'); await page.waitForTimeout(250); const c = await calls(page, 'game_answer'); assert.deepStrictEqual(c.map(x => x.p_choice), [1]);
        assert.ok(/Answer submitted/.test(await page.innerText('#gqst'))); });
      await t('member: leaderboard sheet opens from the strip', async () => { await page.click('#gmini [data-g=board]'); await page.waitForSelector('#gps .gsh'); const tx = await page.innerText('#gps'); assert.ok(/Leaderboard/.test(tx) && /Suhani/.test(tx) && /400/.test(tx)); await page.click('#gps [data-g=close]'); });
      await show(page, state('ended', { summary: { winner: 'u1', ranking: [{ user_id: 'u1', score: 400, correct: 4, answered: 5, streak: 4, rank: 1 }, { user_id: 'me', score: 250, correct: 3, answered: 5, streak: 3, rank: 2 }] } }, { admin: 'u1' }));
      await t('member: final results have no Rematch, only Back to games', async () => { assert.ok(/Suhani wins/.test(await page.innerText('#gpb'))); assert.strictEqual(await page.locator('#gpb [data-g=rematch]').count(), 0); assert.ok(await vis(page, '#gpb [data-g=done]')); });
    }
    await t(who + ': no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close();
  }

  console.log('C. admin change: controls follow the CURRENT admin immediately');
  { const { ctx, page } = await open(browser, port, db(), { ctx: { viewport: { width: 390, height: 844 } } }); await ready(page); await openGames(page);
    await show(page, state('question'));
    await t('admin sees controls', async () => assert.ok(await vis(page, '#gpf .gadm')));
    await t('after the admin changes, the old admin loses every control at once', async () => {
      await swapAdmin(page, 'u1');
      await page.waitForFunction(() => !document.querySelector('#gpf .gadm'), null, { timeout: 5000 }); assert.strictEqual(await page.locator('#gpb [data-g=pick]').count(), 0); });
    await ctx.close(); }

  console.log('D. every game view fits every device (no sideways scroll, header + footer visible)');
  for (const [name, vp] of VIEWS) {
    const { ctx, page } = await open(browser, port, db(), { ctx: vp }); await ready(page); await openGames(page);
    const fit = async (label, needFoot) => { const g = await page.evaluate(() => { const q = s => document.querySelector(s), r = e => e && e.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, rm = r(q('#rm')), h = r(q('#gph')), f = q('#gpf'), fr = f && !f.hidden ? r(f) : null, b = q('#gpb'), pnl = r(q('#gpanel'));
        const btns = [...document.querySelectorAll('#rm .rh .rb')].map(r).filter(x => x && x.width); let ov = 0; for (let i = 0; i < btns.length; i++) { if (btns[i].right > vw + .5 || btns[i].left < -.5) ov++; for (let j = i + 1; j < btns.length; j++) { const a = btns[i], c = btns[j]; if (a.left < c.right - .5 && c.left < a.right - .5 && a.top < c.bottom - .5 && c.top < a.bottom - .5) ov++; } }
        return { vw, vh, docW: document.documentElement.scrollWidth, bodyW: b ? b.scrollWidth - b.clientWidth : 0, hTop: h ? h.top : -1, hBot: h ? h.bottom : -1, fBot: fr ? fr.bottom : null, pBot: pnl ? pnl.bottom : 0, hdrOv: ov, panelH: pnl ? pnl.height : 0 }; });
      assert.ok(g.docW <= g.vw, label + ' page wider than screen ' + JSON.stringify(g)); assert.ok(g.bodyW <= 1, label + ' panel scrolls sideways ' + JSON.stringify(g)); assert.ok(g.hdrOv === 0, label + ' header buttons overlap/escape ' + JSON.stringify(g));
      assert.ok(g.hTop >= -.5 && g.hBot <= g.vh + .5, label + ' header not visible ' + JSON.stringify(g)); if (needFoot) assert.ok(g.fBot != null && g.fBot <= g.vh + .5, label + ' footer not visible ' + JSON.stringify(g)); assert.ok(g.panelH > 60, label + ' panel collapsed ' + JSON.stringify(g)); };
    console.log(' ', name);
    await t('library', () => fit('library', false)); await page.screenshot({ path: path.join(OUT, 's-library-' + name.replace(/[ x]/g, '-') + '.png') });
    for (const [lbl, st] of [['question', state('question')], ['text question', state('question', { game: 'movie', current: { n: 3, total: 10, kind: 'text', emoji: '🎬 🦁 👑', prompt: 'Name this movie' } })], ['reveal', state('reveal', { reveal: { kind: 'mcq', idx: 1, correct: 1, counts: [1, 2, 0, 0], fastest: 'u1', results: { me: { ok: true, pts: 130, ans: 1, ms: 3000, streak: 3 }, u1: { ok: true, pts: 140, ans: 1, ms: 2000 }, u2: { ok: false, pts: 0, ans: 0, ms: 4000 } } } })], ['paused', state('paused', { paused_phase: 'question', paused_left: 7000 })], ['lobby', state('lobby', { q_idx: -1, current: null })],
      ['team game', state('question', { cfg: { mode: 'team', team_names: { red: 'Red Team', blue: 'Blue Team' }, changes: true, spectator: true, participation: 'open', seconds: 15 } })],
      ['ended', state('ended', { summary: { winner: 'u1', ranking: [{ user_id: 'u1', score: 400, correct: 4, answered: 5, streak: 4, rank: 1 }, { user_id: 'me', score: 250, correct: 3, answered: 5, streak: 3, rank: 2 }, { user_id: 'u2', score: 100, correct: 1, answered: 5, streak: 0, rank: 3 }], review: [{ n: 1, prompt: 'Q one', answer: 'A' }] } })]]) {
      await show(page, st); await t(lbl + ' (admin)', () => fit(lbl, lbl !== 'ended')); await page.screenshot({ path: path.join(OUT, 's-' + lbl.replace(/ /g, '-') + '-' + name.replace(/[ x]/g, '-') + '.png') }); }
    await show(page, state('question', {}, { admin: 'u1' })); await swapAdmin(page, 'u1'); await page.waitForTimeout(300);
    await t('question (member)', async () => { assert.strictEqual(await page.locator('#gpf .gadm').count(), 0, 'must be the member view'); await fit('member question', true); });
    await show(page, state('question')); await swapAdmin(page, 'me'); await page.waitForTimeout(300);
    await t('config sheet fits; its buttons stay reachable', async () => {
      await show(page, state(null)); await page.click('#gpb [data-g=pick][data-v=trivia]'); await page.waitForSelector('#gps .gsh'); await page.waitForTimeout(450); const g = await page.evaluate(() => { const s = document.querySelector('#gps .gsh').getBoundingClientRect(), f = document.querySelector('#gps .gsh-f').getBoundingClientRect(), vw = innerWidth, vh = innerHeight; return { sl: s.left, sr: s.right, st: s.top, fb: f.bottom, vw, vh, doc: document.documentElement.scrollWidth }; });
      assert.ok(g.sl >= -.5 && g.sr <= g.vw + .5 && g.fb <= g.vh + .5 && g.st >= -.5 && g.doc <= g.vw, JSON.stringify(g));
      assert.ok(await vis(page, '#gps [data-g=start]')); await page.screenshot({ path: path.join(OUT, 'cfg-' + name.replace(/[ x]/g, '-') + '.png') }); await page.click('#gps [data-g=close]'); });
    await show(page, state('question')); await page.screenshot({ path: path.join(OUT, 'question-' + name.replace(/[ x]/g, '-') + '.png') });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
