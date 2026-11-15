/* Browser test for Hide Mature Content on Nova Home.
 *   Hide Mature ON  (default, or any account that has not passed the 18+ check): adult rooms are not listed (instant rules, YouTube age
 *                   limit, page rating, picture check, saved flag), and cannot be entered by a link or a card - the person gets the
 *                   "Mature content is hidden" dialog and is taken back out of the room.
 *   Hide Mature OFF (verified 18+): every room is listed, with the NSFW mark, and can be entered.
 * Run: E2E_OUT=/some/dir node tests/e2e-mature-gate.js   (needs `playwright` + Chromium) */
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
  from:t=>t==='profiles'?(()=>{const p=new Proxy({},{get(_,k){ if(k==='then')return undefined; if(k==='single'||k==='maybeSingle')return()=>Promise.resolve(ok(window.__profile||null)); return()=>p;}});return p})():builder(),
  rpc:(n,a)=>{ (window.__calls=window.__calls||[]).push([n,a]);
    if(n==='room_now') return Promise.resolve(ok(Date.now()));
    if(n==='list_rooms') return Promise.resolve(ok((window.__rooms||[]).filter(r=>!(window.__gone||[]).includes(r.id))));
    if(n==='join_room'){ const r=(window.__rooms||[]).find(x=>x.code===a.p_code); (window.__joined=window.__joined||[]).push(a.p_code);
      if((window.__refuse||[]).includes(a.p_code)) return Promise.resolve({data:null,error:{message:'This room has 18+ content and Hide Mature Content is on',hint:'mature'}});
      return Promise.resolve(ok(r||null)); }
    if(n==='leave_room'){ (window.__left=window.__left||[]).push(a.p_room); return Promise.resolve(ok(null)); }
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

const ADULT = ['r1', 'r3', 'r4', 'r6', 'r8', 'r10'], CLEAN = ['r2', 'r5', 'r7', 'r9'];
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();
  const mk = async (profile, extra) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.route('**/flagcdn.com/**', r => r.fulfill({ contentType: 'image/png', body: FLAG_PNG }));
    await ctx.route('https://thumbs.test/**', r => r.fulfill({ contentType: 'image/svg+xml', body: THUMB(+(/(\d+)\.svg/.exec(r.request().url()) || [0, 1])[1]) }));
    await ctx.route('https://media.test/**', r => r.abort());
    await ctx.route('https://www.youtube.com/**', r => r.fulfill({ contentType: 'text/html', body: '<body style="background:#123"></body>' }));
    await ctx.route('**/api/youtube**', r => { const id = new URL(r.request().url()).searchParams.get('id');
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id, title: 'x', channel: 'c', ageRestricted: id === 'AGEabc12345', description: '', tags: [] }) }); });
    await ctx.route('**/api/nsfw-check**', r => { const u = new URL(r.request().url()).searchParams.get('url');
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsfw: u === 'https://tube.example/v/1', score: 10, reasons: [] }) }); });
    await ctx.addInitScript(`window.tf={};window.nsfwjs={load:async()=>({classify:async(im)=>{const adult=/\\/8\\.svg/.test(im.src);return adult?[{className:'Porn',probability:.93},{className:'Neutral',probability:.07}]:[{className:'Neutral',probability:.97},{className:'Porn',probability:.03}]}})};`);
    await ctx.addInitScript(`window.__rooms=${JSON.stringify(rooms())};window.__profile=${JSON.stringify(profile)};${extra || ''}`);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    return { ctx, page, errs };
  };
  const shown = page => page.evaluate(() => [...document.querySelectorAll('#invL .room, #pubL .room')].map(e => e.dataset.rid).sort());
  const settle = async page => { await page.waitForTimeout(1800); };   // the picture check, YouTube and page look-ups all finish well within this

  console.log('Hide Mature ON (verified account, setting ON) - the server list is deliberately unfiltered here, so the browser layer is what is tested');
  {
    const { ctx, page, errs } = await mk({ settings: { hideMature: true }, maturity_verified: true });
    await page.goto(`http://localhost:${port}/nova-home.html`); await page.waitForSelector('#pubL .room', { timeout: 8000 }); await settle(page);
    await t('only clean rooms are listed: instant, YouTube age limit, page rating, picture check and the saved flag are all hidden', async () => {
      assert.deepStrictEqual(await shown(page), CLEAN.slice().sort());
    });
    await t('no NSFW mark appears anywhere (there is nothing adult to mark)', async () => { assert.strictEqual(await page.locator('.pbg.nsfw').count(), 0); });
    await t('rooms are not shown in Invited either', async () => {
      await page.evaluate(() => { window.__rooms.forEach(r => { r.invited = ['r1', 'r3', 'r2'].includes(r.id); }); NovaRoom.api.reload(); });
      await page.waitForTimeout(900);
      const inv = await page.evaluate(() => [...document.querySelectorAll('#invL .room')].map(e => e.dataset.rid));
      assert.deepStrictEqual(inv, ['r2']);
    });
    await t('a link to an adult room (instant rule) shows the dialog, is taken back out, and the room is never opened', async () => {
      await page.evaluate(() => { location.hash = '#join/code0001'; });
      await page.waitForSelector('#nvg', { timeout: 5000 });
      assert.match(await page.textContent('#nvg h3'), /Mature content is hidden/i);
      assert.match(await page.textContent('#nvg'), /Hide Mature Content/);
      assert.deepStrictEqual(await page.evaluate(() => window.__left), ['r1']);
      assert.ok(!(await page.evaluate(() => document.body.classList.contains('inroom'))));
    });
    await page.evaluate(() => document.querySelector('#nvg [data-v="close"]').click());
    await t('a link to a room only the picture check can tell (X, name-only title) is refused too', async () => {
      await page.evaluate(() => { location.hash = '#join/code0008'; });
      await page.waitForSelector('#nvg', { timeout: 12000 });
      assert.deepStrictEqual(await page.evaluate(() => window.__left), ['r1', 'r8']);
    });
    await page.evaluate(() => document.querySelector('#nvg [data-v="close"]').click());
    await t('the server saying "mature" (any route: invite, nearby, friends, creator) shows the same dialog', async () => {
      await page.evaluate(() => { window.__refuse = ['code0002']; location.hash = '#join/code0002'; });
      await page.waitForSelector('#nvg', { timeout: 5000 });
      assert.match(await page.textContent('#nvg h3'), /Mature content is hidden/i);
      assert.ok(!(await page.evaluate(() => document.body.classList.contains('inroom'))));
    });
    await page.evaluate(() => document.querySelector('#nvg [data-v="close"]').click());
    await t('"Open Settings" goes to the settings page', async () => {
      await page.evaluate(() => { location.hash = '#join/code0002'; });
      await page.waitForSelector('#nvg [data-v="settings"]', { timeout: 5000 });
      assert.ok(await page.evaluate(() => !!document.querySelector('#nvg [data-v="settings"]')));
    });
    await t('no page errors', async () => assert.deepStrictEqual(errs, []));
    await ctx.close();
  }

  console.log('Hide Mature ON (account NOT verified, even though the saved setting says OFF)');
  {
    const { ctx, page } = await mk({ settings: { hideMature: false }, maturity_verified: false });
    await page.goto(`http://localhost:${port}/nova-home.html`); await page.waitForSelector('#pubL .room', { timeout: 8000 }); await settle(page);
    await t('an unverified account never sees adult rooms', async () => { assert.deepStrictEqual(await shown(page), CLEAN.slice().sort()); });
    await ctx.close();
  }

  console.log('Hide Mature ON (settings could not be read at all -> safe default)');
  {
    const { ctx, page } = await mk(null);
    await page.goto(`http://localhost:${port}/nova-home.html`); await page.waitForSelector('#pubL .room', { timeout: 8000 }); await settle(page);
    await t('missing settings behave as ON', async () => { assert.deepStrictEqual(await shown(page), CLEAN.slice().sort()); });
    await ctx.close();
  }

  console.log('Hide Mature OFF (verified 18+)');
  {
    const { ctx, page, errs } = await mk({ settings: { hideMature: false }, maturity_verified: true });
    await page.goto(`http://localhost:${port}/nova-home.html`); await page.waitForSelector('#pubL .room', { timeout: 8000 }); await settle(page);
    await t('every room is listed again, adult ones with the NSFW mark', async () => {
      assert.deepStrictEqual(await shown(page), CLEAN.concat(ADULT).sort());
      assert.strictEqual(await page.locator('.pbg.nsfw').count(), ADULT.length);
    });
    await t('a link to an adult room is NOT blocked (no dialog, no leave)', async () => {
      await page.evaluate(() => { location.hash = '#join/code0001'; });
      await page.waitForTimeout(1500);
      assert.strictEqual(await page.locator('#nvg').count(), 0);
      assert.strictEqual(await page.evaluate(() => (window.__left || []).length), 0);
      assert.deepStrictEqual(await page.evaluate(() => window.__joined), ['code0001']);
    });
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
