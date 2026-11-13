/* Browser test for the Nova home room cards: 3 / 2 / 1 columns, + button column, hover live preview (synced, mute button),
 * glass info panel, avatar name tip, right-click + long-press sheet, Delete / Cancel invite, Report video.
 * Uses the REAL nova-home.html + room.js + room-cards.js with an in-page fake Supabase.
 * Run: E2E_OUT=/some/dir node tests/e2e-room-cards.js   (needs `playwright` + Chromium; MEDIA=/path/clip.mp4 for the <video> path) */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..');
const FLAG_PNG = Buffer.from(fs.readFileSync(path.join(__dirname, 'flag.b64'), 'utf8'), 'base64');
const CLIP = process.env.MEDIA && fs.existsSync(process.env.MEDIA) ? fs.readFileSync(process.env.MEDIA) : null;
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

const member = (i, cc, extra) => Object.assign({ id: 'u' + i, full_name: ['Aviiieee', 'Just Sleepy', 'Priya Nair', 'Karan Mehta', 'Sana Khan'][i % 5], username: ['aviiieee', 'just.sleepy', 'priya', 'karan', 'sana'][i % 5], avatar_url: null, country_code: cc || 'IN' }, extra);
function rooms() {
  const now = Date.now(), base = (i, o) => Object.assign({ id: 'r' + i, code: 'code000' + i, title: 'Room ' + i, privacy: 'public', admin_id: 'u0', count: 3, created_at: new Date(now - (60 + i) * 60000).toISOString(),
    members: [member(0), member(1), member(2)], invited: false, mine: false, media: { kind: 'video', provider: 'video', title: 'Non-Stop Jukebox | Pain Inside Mashup 2024 | Arijit Singh', url: 'https://media.test/clip.mp4', thumb: 'https://thumbs.test/' + i + '.svg', duration: 120 },
    play_state: { playing: true, pos: 30, ts: now, seq: 1, idx: 0 } }, o);
  return [
    base(1), base(2, { media: { kind: 'youtube', provider: 'youtube', id: 'dQw4w9WgXcQ', title: 'Heavy Thunderstorm Sounds | Relaxing Rain, Thunder & Lightning', thumb: 'https://thumbs.test/2.svg', duration: 5000 }, play_state: { playing: true, pos: 1500, ts: now, seq: 1, idx: 0 } }),
    base(3, { invited: true, title: 'Invited room', members: [member(3), member(4, 'US')] }),
    base(4, { privacy: 'friends' }), base(5, { play_state: { playing: false, pos: 12, ts: now, seq: 1, idx: 0 } }), base(6, { media: null })
  ];
}
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', (e.message || e).toString().split('\n').slice(0, 3).join('\n     ')); } };

async function open(browser, port, o = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, o.ctx || {}));
  await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('**/flagcdn.com/**', r => r.fulfill({ contentType: 'image/png', body: FLAG_PNG }));
  await ctx.route('https://thumbs.test/**', r => { const n = +(/(\d+)\.svg/.exec(r.request().url()) || [0, 1])[1]; r.fulfill({ contentType: 'image/svg+xml', body: THUMB(n) }); });
  await ctx.route('https://media.test/**', r => CLIP ? r.fulfill({ contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes' }, body: CLIP }) : r.abort());
  await ctx.route('https://www.youtube.com/**', r => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#123;color:#fff;display:grid;place-items:center;height:100vh;font:16px sans-serif">YT frame</body>' }));
  await ctx.route('https://i.ytimg.com/**', r => r.fulfill({ contentType: 'image/svg+xml', body: THUMB(2) }));
  await ctx.addInitScript(`window.__rooms=${JSON.stringify(rooms())};`);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.errs = errs;
  await page.goto(`http://localhost:${port}/nova-home.html`);
  await page.waitForSelector('#pubL .room', { timeout: 8000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}
const cols = async page => page.evaluate(() => { const xs = [...document.querySelectorAll('#pubL .room')].map(e => Math.round(e.getBoundingClientRect().left)); return new Set(xs).size; });
const center = async (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.left + r.width / 2; }, sel);

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  console.log('A. layout');
  for (const [w, h, want] of [[1440, 900, 3], [1909, 1000, 3], [1100, 800, 3], [820, 1100, 2], [700, 900, 2], [390, 844, 1]]) {
    await t(`${w}px wide → ${want} column(s)`, async () => { const { ctx, page } = await open(browser, port, { ctx: { viewport: { width: w, height: h } } }); assert.strictEqual(await cols(page), want); assert.deepStrictEqual(page.errs, []); await ctx.close(); });
  }
  for (const w of [1440, 1909, 1024]) {
    await t(`+ button is centred under the People icon (${w}px)`, async () => { const { ctx, page } = await open(browser, port, { ctx: { viewport: { width: w, height: 900 } } });
      const a = await center(page, '#ppl'), b = await center(page, '#fab'); assert.ok(Math.abs(a - b) <= 1.5, `ppl ${a} vs fab ${b}`);
      if (w === 1909) await page.screenshot({ path: path.join(OUT, 'desktop-1909.png') }); await ctx.close(); });
  }
  await t('+ button stays bottom-right on phones', async () => { const { ctx, page } = await open(browser, port, { ctx: { viewport: { width: 390, height: 844 } } });
    const r = await page.evaluate(() => { const b = document.querySelector('#fab').getBoundingClientRect(); return [innerWidth - b.right, innerHeight - b.bottom]; }); assert.ok(r[0] > 10 && r[0] < 30, JSON.stringify(r)); await ctx.close(); });

  console.log('B. desktop hover (mouse)');
  const { ctx, page } = await open(browser, port);
  const box = async sel => page.locator(sel).first().boundingBox();
  await t('hover plays the room video inside the card, in sync, with a mute button', async () => {
    const c = await box('#pubL .room[data-rid="r1"] .cover');
    await page.mouse.move(c.x + 30, c.y + 30); await page.mouse.move(c.x + 40, c.y + 40);
    await page.waitForSelector('#rcLayer .rc-vid.on', { timeout: 4000 });
    if (CLIP) {
      await page.waitForFunction(() => { const v = document.querySelector('#rcLayer video'); return v && v.currentTime > 29 && !v.paused; }, null, { timeout: 8000 });
      const s = await page.evaluate(() => { const v = document.querySelector('#rcLayer video'); return { t: v.currentTime, m: v.muted }; });
      assert.ok(s.t >= 29 && s.t < 40 && s.m === true, JSON.stringify(s));
    } else assert.ok(await page.$('#rcLayer .rc-vid'));
    const vb = await box('#rcLayer .rc-vid'); assert.ok(Math.abs(vb.x - c.x) < 2 && Math.abs(vb.width - c.width) < 2, 'video covers the card cover');
    await page.waitForSelector('#rcLayer .rc-vid.show', { timeout: 2000 });
    await page.screenshot({ path: path.join(OUT, 'hover-video.png') });
  });
  await t('mute / unmute button toggles the sound', async () => {
    if (!CLIP) return;
    await page.locator('#rcLayer .rc-mute').click();
    assert.strictEqual(await page.evaluate(() => document.querySelector('#rcLayer video').muted), false);
    await page.locator('#rcLayer .rc-mute').click();
    assert.strictEqual(await page.evaluate(() => document.querySelector('#rcLayer video').muted), true);
  });
  await t('mute button hides shortly after the cursor leaves the video (video keeps playing)', async () => {
    const info = await box('#pubL .room[data-rid="r1"] .avs'); await page.mouse.move(info.x + info.width - 20, info.y - 6);
    await page.waitForFunction(() => !document.querySelector('#rcLayer .rc-vid.show'), null, { timeout: 4000 });
    assert.ok(await page.$('#rcLayer .rc-vid.on'));
  });
  await t('hovering the title opens the glass panel (title, timeline, watching, room open)', async () => {
    const tt = await box('#pubL .room[data-rid="r1"] .rt'); await page.mouse.move(tt.x + 20, tt.y + 6);
    await page.waitForSelector('#rcLayer .rc-info.on', { timeout: 2000 });
    const txt = (await page.locator('#rcLayer .rc-info').innerText()).replace(/\s+/g, ' ');
    assert.ok(/Non-Stop Jukebox/.test(txt) && /0:3\d \/ 2:00/.test(txt), txt); assert.ok(/3 watching/.test(txt), txt); assert.ok(/Room open for 1h 1m/.test(txt), txt);
    assert.ok(await page.$('#rcLayer .rc-vid.on'), 'video still playing while on the title');
    await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, 'hover-title.png') });
  });
  await t('hovering an avatar shows the name above it and keeps the video playing', async () => {
    const av = await box('#pubL .room[data-rid="r1"] .uav'); await page.mouse.move(av.x + av.width / 2, av.y + av.height / 2);
    await page.waitForSelector('#rcLayer .rc-tip.on', { timeout: 2000 });
    assert.ok(/Aviiieee/.test(await page.locator('#rcLayer .rc-tip').innerText()));
    const tip = await box('#rcLayer .rc-tip'); assert.ok(tip.y + tip.height <= av.y, 'tip is above the avatar');
    assert.ok(await page.$('#rcLayer .rc-vid.on')); assert.ok(!(await page.$('#rcLayer .rc-info.on')), 'info panel closed');
    await page.waitForTimeout(300); await page.screenshot({ path: path.join(OUT, 'hover-avatar.png') });
  });
  await t('preview survives the 10 s refresh re-render', async () => {
    await page.evaluate(() => NovaRoom.renderHome()); await page.waitForTimeout(250);
    assert.ok(await page.$('#rcLayer .rc-vid.on')); const c = await box('#pubL .room[data-rid="r1"] .cover'), v = await box('#rcLayer .rc-vid'); assert.ok(Math.abs(c.x - v.x) < 2 && Math.abs(c.y - v.y) < 2);
  });
  await t('YouTube room loads a muted autoplay frame at the synced start time', async () => {
    const c = await box('#pubL .room[data-rid="r2"] .cover'); await page.mouse.move(c.x + 30, c.y + 20); await page.mouse.move(c.x + 40, c.y + 30);
    await page.waitForSelector('#rcLayer iframe.rc-yt', { timeout: 4000 });
    const src = await page.getAttribute('#rcLayer iframe.rc-yt', 'src'); const q = new URL(src).searchParams;
    assert.ok(/dQw4w9WgXcQ/.test(src) && q.get('mute') === '1' && q.get('autoplay') === '1' && +q.get('start') >= 1500 && +q.get('start') < 1510, src);
  });
  await t('paused room keeps the thumbnail (no video) and the panel says paused', async () => {
    const tt = await box('#pubL .room[data-rid="r5"] .rt'); await page.mouse.move(tt.x + 10, tt.y + 5); await page.waitForTimeout(700);
    assert.ok(!(await page.$('#rcLayer .rc-vid.on')), 'no video'); assert.ok(await page.$('#rcLayer .rc-info.on.paused'));
  });
  await t('moving away stops the preview', async () => { await page.mouse.move(5, 5); await page.waitForTimeout(500); assert.ok(!(await page.$('#rcLayer .rc-vid'))); });

  console.log('C. right-click sheet (laptop)');
  await t('right-click opens the sheet with preview, status, members, delete + report', async () => {
    const c = await box('#pubL .room[data-rid="r1"]'); await page.mouse.click(c.x + 60, c.y + 40, { button: 'right' });
    await page.waitForSelector('.rc-ov.on .rc-sheet', { timeout: 2000 });
    const txt = await page.locator('.rc-sheet').innerText(); assert.ok(/Playing • \d+:\d\d\/2:00/.test(txt), txt); assert.ok(/Public/.test(txt)); assert.ok(/@aviiieee/.test(txt) && /@just.sleepy/.test(txt));
    assert.ok(await page.$('.rc-act[data-a="dismiss"][aria-label="Delete room"]')); assert.ok(await page.$('.rc-act[data-a="report"]'));
    assert.ok(await page.$('.rc-m .geo-flag, .rc-m img[src*="flagcdn"]'), 'flags');
    if (CLIP) await page.waitForFunction(() => { const v = document.querySelector('.rc-sheet video'); return v && v.currentTime > 29 && !v.paused; }, null, { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, 'sheet-desktop.png') });
  });
  await t('Esc closes the sheet without joining', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(350); assert.ok(!(await page.$('.rc-ov'))); assert.ok(!(await page.evaluate(() => (window.__calls || []).some(c => c[0] === 'join_room')))); });
  await t('Report video: pick a reason, send → room_report_video', async () => {
    const c = await box('#pubL .room[data-rid="r1"]'); await page.mouse.click(c.x + 60, c.y + 40, { button: 'right' });
    await page.waitForSelector('.rc-ov.on'); await page.click('.rc-act[data-a="report"]'); await page.waitForSelector('.rc-panel:not([hidden]) .rc-rs');
    await page.click('.rc-rs label:has-text("Spam")'); await page.fill('#rcDetails', 'looks like spam');
    await page.screenshot({ path: path.join(OUT, 'sheet-report.png') });
    await page.click('[data-a="send-report"]'); await page.waitForFunction(() => !document.querySelector('.rc-ov'), null, { timeout: 3000 });
    const call = await page.evaluate(() => window.__calls.filter(c => c[0] === 'room_report_video').pop()); assert.deepStrictEqual(call[1], { p_room: 'r1', p_reason: 'spam', p_details: 'looks like spam' });
  });
  await t('Delete: confirm → room_dismiss, card disappears and stays gone after reload', async () => {
    const c = await box('#pubL .room[data-rid="r4"]'); await page.mouse.click(c.x + 60, c.y + 40, { button: 'right' });
    await page.waitForSelector('.rc-ov.on'); await page.click('.rc-act[data-a="dismiss"]'); await page.waitForSelector('.rc-panel:not([hidden]) [data-a="confirm-dismiss"]');
    await page.click('[data-a="confirm-dismiss"]'); await page.waitForFunction(() => !document.querySelector('.rc-ov'), null, { timeout: 3000 });
    await page.waitForTimeout(400); assert.ok(!(await page.$('.room[data-rid="r4"]'))); await page.evaluate(() => NovaRoom.renderHome()); await page.evaluate(() => 0);
    assert.ok(!(await page.$('.room[data-rid="r4"]')));
    assert.deepStrictEqual((await page.evaluate(() => window.__calls.filter(c => c[0] === 'room_dismiss').pop()))[1], { p_room: 'r4' });
  });
  await t('Invited room: icon is "Cancel invite"; cancelling removes it from Invited', async () => {
    const c = await box('#invL .room[data-rid="r3"]'); await page.mouse.click(c.x + 60, c.y + 40, { button: 'right' });
    await page.waitForSelector('.rc-ov.on'); assert.ok(await page.$('.rc-act[aria-label="Cancel invite"]'));
    await page.screenshot({ path: path.join(OUT, 'sheet-invited.png') });
    await page.click('.rc-act[data-a="dismiss"]'); assert.ok(/Cancel this invite\?/.test(await page.locator('.rc-panel').innerText()));
    await page.click('[data-a="confirm-dismiss"]'); await page.waitForFunction(() => !document.querySelector('.rc-ov'), null, { timeout: 3000 }); await page.waitForTimeout(400);
    assert.ok(!(await page.$('.room[data-rid="r3"]'))); assert.ok(await page.isVisible('#invE'));
  });
  await t('room without a video: Report is disabled', async () => {
    const c = await box('#pubL .room[data-rid="r6"]'); await page.mouse.click(c.x + 60, c.y + 40, { button: 'right' });
    await page.waitForSelector('.rc-ov.on'); assert.ok(await page.isDisabled('.rc-act[data-a="report"]')); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });
  await t('no page errors on desktop', async () => assert.deepStrictEqual(page.errs, []));
  await ctx.close();

  console.log('D. phone long-press');
  const m = await open(browser, port, { ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } });
  const cdp = await m.ctx.newCDPSession(m.page);
  const touch = async (x, y, hold, move) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); if (move) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + move }] }); await m.page.waitForTimeout(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  await t('long-press opens the sheet (and does not join)', async () => {
    const c = await m.page.locator('#pubL .room[data-rid="r1"]').boundingBox(); await touch(c.x + 80, c.y + 40, 700);
    await m.page.waitForSelector('.rc-ov.on .rc-sheet', { timeout: 3000 }); await m.page.waitForTimeout(600);
    assert.ok(!(await m.page.evaluate(() => (window.__calls || []).some(c => c[0] === 'join_room'))));
    await m.page.screenshot({ path: path.join(OUT, 'sheet-phone.png') });
  });
  await t('tap on the backdrop closes it', async () => { await m.page.mouse.click(5, 5); await m.page.waitForTimeout(400); assert.ok(!(await m.page.$('.rc-ov'))); });
  await t('short tap does not open the sheet; scroll-drag cancels the press', async () => {
    const c = await m.page.locator('#pubL .room[data-rid="r2"]').boundingBox(); await touch(c.x + 80, c.y + 40, 700, 40); await m.page.waitForTimeout(200); assert.ok(!(await m.page.$('.rc-ov')));
  });
  await t('phone: no page errors', async () => assert.deepStrictEqual(m.page.errs, []));
  await m.ctx.close();
  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed. Screenshots: ${OUT}`);
  process.exit(bad ? 1 : 0);
})();
