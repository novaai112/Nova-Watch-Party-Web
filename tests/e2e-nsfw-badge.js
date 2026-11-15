/* Browser test for the NSFW badge on the Nova home room cards: adult videos (address, title, YouTube age limit, server page check)
 * get the white NSFW mark at the right of the video box, in the same row as the platform icon; normal videos do not.
 * Run: E2E_OUT=/some/dir node tests/e2e-nsfw-badge.js   (needs `playwright` + Chromium) */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..');
const FLAG_PNG = Buffer.from(fs.readFileSync(path.join(__dirname, 'flag.b64'), 'utf8'), 'base64');
const CLIP = null;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
// a 16:9 test picture (SVG) used as every thumbnail
const THUMB = n => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${n * 57},60%,45%)"/><stop offset="1" stop-color="hsl(${n * 57 + 70},60%,30%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="200" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">Room ${n}</text></svg>`;

const STUB = `window.supabase={createClient:()=>{
 const ok=d=>({data:d,error:null});
 const generic=()=>new Proxy(function(){},{get:(_,k)=>k==='then'?undefined:generic(),apply:()=>generic()});
 const builder=()=>{const p=new Proxy({},{get(_,k){ if(k==='then')return(res,rej)=>Promise.resolve(ok([])).then(res,rej); if(k==='single'||k==='maybeSingle')return()=>Promise.resolve(ok(null)); return()=>p;}});return p};
 return {auth:{getSession:async()=>({data:{session:{access_token:'t',user:{id:'me',email:'me@x.com',user_metadata:{}}}}}),getUser:async()=>({data:{user:{id:'me',email:'me@x.com'}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},
  from:builder,
  rpc:(n,a)=>{ (window.__calls=window.__calls||[]).push([n,a]);
    if(n==='room_now') return Promise.resolve(ok(Date.now()));
    if(n==='list_rooms') return Promise.resolve(ok((window.__rooms||[]).filter(r=>!(window.__gone||[]).includes(r.id))));
    if(n==='room_dismiss'){ (window.__gone=window.__gone||[]).push(a.p_room); return Promise.resolve(ok(null)); }
    if(n==='room_report_video') return Promise.resolve(ok(null));
    return Promise.resolve(ok(null)); },
  channel:()=>generic(),removeChannel(){},storage:generic()};}};`;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/config') { res.setHeader('content-type', 'application/javascript'); return res.end("window.SUPABASE_URL='http://127.0.0.1:1';window.SUPABASE_ANON_KEY='anon';"); }
  const f = path.join(root, u === '/' ? 'index.html' : u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
});
const member = (i) => ({ id: 'u' + i, full_name: 'User ' + i, username: 'user' + i, avatar_url: null, country_code: 'IN' });
function rooms() {
  const now = Date.now(), base = (i, media) => ({ id: 'r' + i, code: 'code000' + i, title: 'Room ' + i, privacy: 'public', admin_id: 'u0', count: 2, created_at: new Date(now - 3600e3).toISOString(),
    members: [member(0), member(1)], invited: false, mine: false, media: Object.assign({ thumb: 'https://thumbs.test/' + i + '.svg', duration: 600 }, media), play_state: { playing: true, pos: 30, ts: now, seq: 1, idx: 0 } });
  return [
    base(1, { kind: 'video', provider: 'web', title: 'Clip', url: 'https://www.pornhub.com/view_video.php?viewkey=abc' }),        // instant: adult site
    base(2, { kind: 'youtube', provider: 'youtube', id: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up' }),         // normal
    base(3, { kind: 'youtube', provider: 'youtube', id: 'AGEabc12345', title: 'Late night clip' }),                                // server: YouTube age limit
    base(4, { kind: 'video', provider: 'web', title: 'Some video', url: 'https://tube.example/v/1' }),                              // server: page says adult
    base(5, { kind: 'video', provider: 'web', title: 'Sex Education Season 3 Official Trailer', url: 'https://media.test/a.mp4' }), // normal (weak word only)
    base(6, { kind: 'video', provider: 'web', title: 'Desi XXX full video', url: 'https://clips.example/x' }),                      // instant: title
    base(7, { kind: 'video', provider: 'web', title: 'Cat video', url: 'https://clips.example/cat' }),                             // server says no
    Object.assign(base(8, { kind: 'video', provider: 'x', title: 'Remy LaCroix', url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/720x1280/a.mp4' }), {}), // X: name only -> picture check
    base(9, { kind: 'video', provider: 'x', title: 'Beach sunset', url: 'https://video.twimg.com/ext_tw_video/2/pu/vid/avc1/720x1280/b.mp4' }),                 // X: picture is fine
    base(10, { kind: 'video', provider: 'x', title: 'Saved with flag', url: 'https://video.twimg.com/ext_tw_video/3/pu/vid/avc1/720x1280/c.mp4', nsfw: true })     // flag saved at import
  ];
}
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', (e.message || e).toString().split('\n').slice(0, 3).join('\n     ')); } };
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();
  const calls = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('**/flagcdn.com/**', r => r.fulfill({ contentType: 'image/png', body: FLAG_PNG }));
  await ctx.route('https://thumbs.test/**', r => r.fulfill({ contentType: 'image/svg+xml', body: THUMB(+(/(\d+)\.svg/.exec(r.request().url()) || [0, 1])[1]) }));
  await ctx.route('https://media.test/**', r => r.abort());
  await ctx.route('https://www.youtube.com/**', r => r.fulfill({ contentType: 'text/html', body: '<body style="background:#123"></body>' }));
  await ctx.route('**/api/youtube**', r => { const id = new URL(r.request().url()).searchParams.get('id'); calls.push('yt:' + id);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id, title: 'x', channel: 'c', ageRestricted: id === 'AGEabc12345', description: '', tags: [] }) }); });
  await ctx.route('**/api/nsfw-check**', r => { const u = new URL(r.request().url()).searchParams.get('url'); calls.push('chk:' + u);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsfw: u === 'https://tube.example/v/1', score: 10, reasons: [] }) }); });
  /* stand-in for TensorFlow.js + NSFWJS (the real libraries load from a CDN): room 8's thumbnail is "Porn", the others "Neutral" */
  await ctx.addInitScript(`window.tf={};window.nsfwjs={load:async()=>({classify:async(im)=>{window.__imgChecks=(window.__imgChecks||0)+1;const adult=/\\/8\\.svg/.test(im.src);return adult?[{className:'Porn',probability:.93},{className:'Neutral',probability:.07}]:[{className:'Neutral',probability:.97},{className:'Porn',probability:.03}]}})};`);
  await ctx.addInitScript(`window.__rooms=${JSON.stringify(rooms())};`);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://localhost:${port}/nova-home.html`);
  await page.waitForSelector('#pubL .room', { timeout: 8000 });
  const has = id => page.evaluate(i => !!document.querySelector(`.room[data-rid="${i}"] .cover .pbg.nsfw`), id);
  await t('adult-site link and adult title get the badge instantly', async () => { assert.ok(await has('r1')); assert.ok(await has('r6')); });
  await t('server checks add the badge afterwards (YouTube age limit, page rating)', async () => {
    await page.waitForFunction(() => document.querySelector('.room[data-rid="r3"] .cover .pbg.nsfw') && document.querySelector('.room[data-rid="r4"] .cover .pbg.nsfw'), null, { timeout: 6000 });
  });
  await t('normal videos are never badged', async () => {
    await page.waitForTimeout(600);
    for (const id of ['r2', 'r5', 'r7', 'r9']) assert.ok(!(await has(id)), id + ' wrongly flagged');
  });
  await t('X video with only a name as title: picture check adds the badge; clean X picture does not; saved flag works', async () => {
    await page.waitForFunction(() => document.querySelector('.room[data-rid="r8"] .cover .pbg.nsfw'), null, { timeout: 6000 });
    assert.ok(!(await has('r9')), 'r9 wrongly flagged'); assert.ok(await has('r10'));
    assert.ok(await page.evaluate(() => window.__imgChecks >= 2));
  });
  await t('badge sits top-right of the video box, same row as the platform icon, uses the uploaded NSFW image', async () => {
    const g = await page.evaluate(() => { const cv = document.querySelector('.room[data-rid="r1"] .cover'), a = cv.querySelector('.pbg:not(.nsfw)').getBoundingClientRect(), b = cv.querySelector('.pbg.nsfw').getBoundingClientRect(), c = cv.getBoundingClientRect();
      return { sameTop: Math.abs(a.top - b.top) < 1, sameH: Math.abs(a.height - b.height) < 1, right: Math.round(c.right - b.right), left: Math.round(a.left - c.left), isRight: b.left > c.left + c.width / 2, src: cv.querySelector('.pbg.nsfw img').src.slice(0, 22), natW: cv.querySelector('.pbg.nsfw img').naturalWidth }; });
    assert.ok(g.sameTop && g.sameH && g.isRight && g.right === 8 && g.left === 8 && g.src.startsWith('data:image/png') && g.natW === 192, JSON.stringify(g));
  });
  await t('badge survives a home re-render and a second visit uses the cache (no new server calls)', async () => {
    const n = calls.length;
    await page.evaluate(() => NovaRoom.renderHome());
    assert.ok(await has('r3') && await has('r4'));
    assert.strictEqual(calls.length, n, 'extra server calls: ' + calls.slice(n));
  });
  await t('each undecided video is checked once', async () => { assert.strictEqual(new Set(calls).size, calls.length, calls.join(',')); });
  await t('X video preview: direct address first, our stream proxy (with x.com referer) as fallback', async () => {
    const r = await page.evaluate(() => NovaRoom.api.previewSource(NovaRoom.api.byId('r8').media));
    assert.ok(r && r.type === 'video' && r.src.startsWith('https://video.twimg.com/') && /\/api\/browse\?stream=1&url=.*&ref=https%3A%2F%2Fx\.com%2F/.test(r.alt), JSON.stringify(r));
  });
  await t('hover preview carries the badge too', async () => {
    const c = await page.locator('#pubL .room[data-rid="r1"] .cover').boundingBox();
    await page.mouse.move(c.x + 30, c.y + 30); await page.mouse.move(c.x + 40, c.y + 40);
    await page.waitForSelector('#rcLayer .rc-vid .pbg.nsfw', { state: 'attached', timeout: 4000 });
  });
  await page.mouse.move(5, 5); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'home-nsfw.png') });
  await t('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed — screenshots in ${OUT}`); process.exit(bad ? 1 : 0);
})();
