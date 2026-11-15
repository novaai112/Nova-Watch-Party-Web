/* Browser test (real nova-home.html + room.js + nova-core.js, in-page fake Supabase):
 *  Quick Reaction  - double-tap a ROOM message reacts with Settings > Quick Reaction; chips, counts, toggle off, menu bar, error rollback
 *  Mute When Other Audio Plays - Nova.audio ducks registered media while a hold is active, restores it, respects a manual un-mute, honours the OFF switch
 *  Floating Video Player       - Nova.pip follows the setting (PiP enabled/disabled, autopip attribute, open window closed), room player shows the button
 *  Inbox chat uses the same Quick Reaction emoji (slot 1 of the quick list)
 * Run: node tests/e2e-reactions-media-settings.js   (needs `playwright` + Chromium) */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const STUB = `window.supabase={createClient:()=>{
 const ok=d=>({data:d,error:null}); const db=()=>window.__db; window.__ops=[];
 const builder=t=>{ let op='select', filt={};
   const p=new Proxy({},{get(_,k){
     if(k==='then')return(res,rej)=>{
       if(op==='select')return Promise.resolve(ok((db()[t]||[]).slice())).then(res,rej);
       const fail=window.__fail&&window.__fail[t];
       window.__ops.push({t,op,row:filt.row,filt:Object.assign({},filt.eq)});
       if(fail)return Promise.resolve({data:null,error:{message:fail}}).then(res,rej);
       const rows=db()[t]=db()[t]||[];
       if(op==='upsert'){const r=filt.row,i=rows.findIndex(x=>x.message_id===r.message_id&&x.user_id===r.user_id);i>=0?rows[i]=r:rows.push(r);}
       if(op==='delete'){db()[t]=rows.filter(x=>!(x.message_id===filt.eq.message_id&&x.user_id===filt.eq.user_id));}
       return Promise.resolve(ok(null)).then(res,rej); };
     if(k==='single'||k==='maybeSingle')return()=>Promise.resolve(ok((db()[t]||[])[0]||null));
     if(k==='upsert'||k==='insert')return r=>{op='upsert';filt.row=r;return p};
     if(k==='delete')return()=>{op='delete';filt.eq={};return p};
     if(k==='eq')return(c,v)=>{filt.eq=filt.eq||{};filt.eq[c]=v;return p};
     return()=>p;}});return p};
 const R=()=>db().rooms[0];
 const generic=()=>new Proxy(function(){},{get:(_,k)=>k==='then'?undefined:generic(),apply:()=>generic()});
 return {auth:{getSession:async()=>({data:{session:{access_token:'t',user:{id:'me',email:'me@x.com',user_metadata:{}}}}}),getUser:async()=>({data:{user:{id:'me'}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}},
  from:builder,
  rpc:(n,a)=>{ if(n==='room_now')return Promise.resolve(ok(Date.now())); if(n==='list_rooms')return Promise.resolve(ok([])); if(n==='room_heartbeat')return Promise.resolve(ok({member:true,status:'open',admin_id:R().admin_id})); return Promise.resolve(ok(null)); },
  channel:()=>generic(),removeChannel(){},storage:generic()};}};`;
const PIP_STUB = `(()=>{ let cur=null; Object.defineProperty(document,'pictureInPictureEnabled',{get:()=>true,configurable:true});
 Object.defineProperty(document,'pictureInPictureElement',{get:()=>cur,configurable:true});
 HTMLVideoElement.prototype.requestPictureInPicture=function(){ if(this.disablePictureInPicture)return Promise.reject(new DOMException('disabled','InvalidStateError')); cur=this; this.dispatchEvent(new Event('enterpictureinpicture')); return Promise.resolve({}); };
 document.exitPictureInPicture=function(){ const v=cur; cur=null; if(v)v.dispatchEvent(new Event('leavepictureinpicture')); window.__pipExit=(window.__pipExit||0)+1; return Promise.resolve(); }; })();`;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/config') { res.setHeader('content-type', 'application/javascript'); return res.end("window.SUPABASE_URL='http://127.0.0.1:1';window.SUPABASE_ANON_KEY='anon';"); }
  const f = path.join(root, u === '/' ? 'index.html' : u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
});
const now = Date.now();
function db(o = {}) {
  const prof = ['me', 'u1', 'u2'].map((id, i) => ({ id, full_name: ['Me', 'Suhani', 'Karan'][i], username: ['me', 'anvi', 'karan'][i], avatar_url: null, country_code: 'IN' }));
  return { rooms: [{ id: 'r1', code: 'code0001', admin_id: 'me', title: 'Test', privacy: 'public', playback_mode: 'play', voice_enabled: false, status: 'open', media_ver: 3,
      media: { kind: 'video', provider: 'direct', url: 'https://example.invalid/v.mp4', title: 'Clip' }, play_state: { playing: false, pos: 0, ts: now, seq: 1, idx: 0, phase: 'PAUSED' } }],
    room_members: prof.map((p, i) => ({ room_id: 'r1', user_id: p.id, joined_at: new Date(now + i).toISOString(), mic_allowed: false })), public_profiles: prof,
    room_messages: [{ id: 7, room_id: 'r1', user_id: 'u1', kind: 'chat', body: 'Hello there', created_at: new Date(now - 5000).toISOString() },
                    { id: 8, room_id: 'r1', user_id: 'me', kind: 'chat', body: 'Hi Suhani', created_at: new Date(now - 4000).toISOString() }],
    room_queue: [], room_message_reactions: o.reacts || [] };
}
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', (e.message || e).toString().split('\n').slice(0, 5).join('\n     ')); } };
async function open(browser, port, data, settings, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|flagcdn\.com|example\.invalid/, r => r.abort());
  await ctx.addInitScript(`window.__db=${JSON.stringify(data)};try{if(!localStorage.getItem('nova_settings'))localStorage.setItem('nova_settings',${JSON.stringify(JSON.stringify(settings))})}catch(e){}${o.pip ? PIP_STUB : ''}`);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.errs = errs;
  await page.goto(`http://localhost:${port}/nova-home.html`);
  await page.waitForSelector('#rm #feed .cm[data-mid]', { timeout: 9000 }); await page.waitForTimeout(250);
  return { ctx, page };
}
const dbl = (page, sel) => page.evaluate(s => { const el = document.querySelector(s), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (let i = 0; i < 2; i++) el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); }, sel);
const ops = page => page.evaluate(() => window.__ops.filter(o => o.t === 'room_message_reactions'));
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();

  console.log('A. room chat: double-tap = Quick Reaction from Settings');
  { const { ctx, page } = await open(browser, port, db(), { quick: '🔥' });
    await t('double-tap on someone else\'s message stores the Settings emoji and shows a chip', async () => {
      await dbl(page, '#feed .cm[data-mid="7"] p'); await page.waitForSelector('#feed .cm[data-mid="7"] .rx.mine');
      const o = await ops(page); assert.strictEqual(o.length, 1); assert.strictEqual(o[0].op, 'upsert'); assert.deepStrictEqual([o[0].row.emoji, o[0].row.message_id, o[0].row.room_id, o[0].row.user_id], ['🔥', 7, 'r1', 'me']);
      assert.strictEqual(await page.textContent('#feed .cm[data-mid="7"] .rx.mine span'), '🔥'); });
    await t('double-tap again removes it (toggle) and the row is deleted', async () => {
      await dbl(page, '#feed .cm[data-mid="7"] p'); await page.waitForFunction(() => !document.querySelector('#feed .cm[data-mid="7"] .rx'));
      const o = await ops(page); assert.strictEqual(o[o.length - 1].op, 'delete'); assert.strictEqual(o[o.length - 1].filt.message_id, 7); });
    await t('works on your own message too (the bubble is on the other side)', async () => { await dbl(page, '#feed .cm[data-mid="8"] p'); await page.waitForSelector('#feed .cm[data-mid="8"] .rx.mine'); });
    await t('changing the Settings emoji changes the next double-tap (and replaces, one reaction per person)', async () => {
      await page.evaluate(() => Nova.set('quick', '😂')); await dbl(page, '#feed .cm[data-mid="8"] p'); await page.waitForFunction(() => document.querySelector('#feed .cm[data-mid="8"] .rx.mine span').textContent === '😂');
      assert.strictEqual(await page.locator('#feed .cm[data-mid="8"] .rx').count(), 1); });
    await t('a single tap does nothing; tapping a link/avatar never reacts', async () => {
      const before = (await ops(page)).length; await page.evaluate(() => document.querySelector('#feed .cm[data-mid="7"] p').click()); await page.waitForTimeout(450);
      await page.evaluate(() => { const a = document.querySelector('#feed .cm[data-mid="7"] .uav'); if (a) { a.click(); a.click(); } });
      assert.strictEqual((await ops(page)).length, before); });
    await t('long-press menu starts with the Settings emoji and reacts', async () => {
      await page.evaluate(() => document.querySelector('#feed .cm[data-mid="7"] p').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))); await page.waitForSelector('#msgmenu .rxbar');
      assert.strictEqual(await page.textContent('#msgmenu .rxbar button'), '😂'); await page.click('#msgmenu .rxbar button[data-rq="❤️"]'); await page.waitForSelector('#feed .cm[data-mid="7"] .rx.mine'); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db({ reacts: [{ message_id: 7, room_id: 'r1', user_id: 'u2', emoji: '👍' }, { message_id: 7, room_id: 'r1', user_id: 'me', emoji: '❤️' }] }), { quick: '❤️' });
    await t('existing reactions load with the room (who + count)', async () => { assert.strictEqual(await page.locator('#feed .cm[data-mid="7"] .rx').count(), 2); assert.ok(/You/.test(await page.getAttribute('#feed .cm[data-mid="7"] .rx.mine', 'title'))); });
    await t('chip tap removes your reaction; tapping another person\'s emoji joins it (replaces yours) and the count shows', async () => {
      await page.click('#feed .cm[data-mid="7"] .rx.mine'); await page.waitForFunction(() => !document.querySelector('#feed .cm[data-mid="7"] .rx.mine'));
      await page.click('#feed .cm[data-mid="7"] .rx'); await page.waitForSelector('#feed .cm[data-mid="7"] .rx.mine b');
      assert.strictEqual(await page.textContent('#feed .cm[data-mid="7"] .rx.mine b'), '2'); assert.strictEqual(await page.locator('#feed .cm[data-mid="7"] .rx').count(), 1); });
    await t('a failed save rolls the chip back and explains', async () => {
      await page.evaluate(() => { window.__fail = { room_message_reactions: 'permission denied' }; });
      await dbl(page, '#feed .cm[data-mid="8"] p'); await page.waitForSelector('#toasts .toast.err'); assert.ok(!(await page.$('#feed .cm[data-mid="8"] .rx'))); });
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db(), { quick: '❤️' });
    await t('table not created yet: friendly hint, chat keeps working', async () => {
      await page.evaluate(() => { window.__fail = { room_message_reactions: 'relation "public.room_message_reactions" does not exist' }; });
      await dbl(page, '#feed .cm[data-mid="7"] p'); await page.waitForFunction(() => /room-reactions-schema/.test(document.querySelector('#toasts')?.textContent || ''));
      assert.ok(!(await page.$('#feed .cm[data-mid="7"] .rx'))); });
    await ctx.close(); }

  console.log('B. Mute When Other Audio Plays');
  { const { ctx, page } = await open(browser, port, db(), { mute: true });
    const run = f => page.evaluate(f);
    await t('hold mutes a registered element, release restores it', async () => {
      const r = await run(() => { const v = document.createElement('video'); document.body.append(v); Nova.audio.element(v); Nova.audio.hold('x'); const a = v.muted; Nova.audio.release('x'); return [a, v.muted]; }); assert.deepStrictEqual(r, [true, false]); });
    await t('an element the person had muted stays muted after release', async () => {
      const r = await run(() => { const v = document.createElement('video'); v.muted = true; Nova.audio.element(v); Nova.audio.hold('y'); Nova.audio.release('y'); return v.muted; }); assert.strictEqual(r, true); });
    await t('two overlapping holds: unmutes only after the LAST one ends', async () => {
      const r = await run(() => { const v = document.createElement('video'); Nova.audio.element(v); Nova.audio.hold('a'); Nova.audio.hold('b'); Nova.audio.release('a'); const mid = v.muted; Nova.audio.release('b'); return [mid, v.muted]; }); assert.deepStrictEqual(r, [true, false]); });
    await t('un-muting by hand during a hold is respected', async () => {
      const r = await run(() => { const v = document.createElement('video'); Nova.audio.element(v); Nova.audio.hold('m'); v.muted = false; Nova.audio.release('m'); return v.muted; }); assert.strictEqual(r, false); });
    await t('a custom sink (YouTube) is muted / restored', async () => {
      const r = await run(() => { let m = false; Nova.audio.sink({ get: () => m, set: x => { m = x; } }); Nova.audio.hold('s'); const a = m; Nova.audio.release('s'); return [a, m]; }); assert.deepStrictEqual(r, [true, false]); });
    await t('switching the setting OFF during a hold restores sound at once; ON again re-applies', async () => {
      const r = await run(async () => { const v = document.createElement('video'); Nova.audio.element(v); Nova.audio.hold('t'); const a = v.muted; await Nova.set('mute', false); const b = v.muted; await Nova.set('mute', true); const c = v.muted; Nova.audio.release('t'); return [a, b, c, v.muted]; }); assert.deepStrictEqual(r, [true, false, true, false]); });
    await t('setting OFF: a hold changes nothing', async () => {
      const r = await run(async () => { await Nova.set('mute', false); const v = document.createElement('video'); Nova.audio.element(v); Nova.audio.hold('u'); const a = v.muted; Nova.audio.release('u'); await Nova.set('mute', true); return a; }); assert.strictEqual(r, false); });
    await t('a playing in-app audio (voice note) holds while it plays and releases on pause', async () => {
      const r = await run(() => { const v = document.createElement('video'), a = document.createElement('audio'); Nova.audio.element(v); Nova.audio.watch(a, 'vn'); Object.defineProperty(a, 'paused', { value: false, configurable: true });
        a.dispatchEvent(new Event('playing')); const during = v.muted; Object.defineProperty(a, 'paused', { value: true, configurable: true }); a.dispatchEvent(new Event('pause')); return [during, v.muted]; }); assert.deepStrictEqual(r, [true, false]); });
    await t('audioSession "interrupted" (call / other app) mutes, "active" restores', async () => {
      const r = await run(() => { const v = document.createElement('video'); Nova.audio.element(v); Nova.audio.hold('system'); const a = v.muted; Nova.audio.release('system'); return [a, v.muted]; }); assert.deepStrictEqual(r, [true, false]); });
    await ctx.close(); }

  console.log('C. Floating Video Player');
  { const { ctx, page } = await open(browser, port, db(), { floating: true }, { pip: true });
    await t('room video is PiP-enabled and shows the Floating player button', async () => {
      await page.waitForSelector('#vwrap video'); assert.strictEqual(await page.evaluate(() => document.querySelector('#vwrap video').disablePictureInPicture), false);
      assert.ok(await page.evaluate(() => document.querySelector('#vwrap video').hasAttribute('autopictureinpicture')));
      await page.waitForSelector('.pui [data-p=pip]', { state: 'attached' }); });
    await t('tapping it floats the video; the button shows "on"; tapping again brings it back', async () => {
      await page.evaluate(() => { const v = document.querySelector('#vwrap video'); Object.defineProperty(v, 'readyState', { value: 4, configurable: true }); });
      await page.evaluate(() => document.querySelector('.pui [data-p=pip]').click()); await page.waitForFunction(() => !!document.pictureInPictureElement);
      await page.waitForSelector('.pui [data-p=pip].on', { state: 'attached' });
      await page.evaluate(() => document.querySelector('.pui [data-p=pip]').click()); await page.waitForFunction(() => !document.pictureInPictureElement); });
    await t('switching the setting OFF closes an open floating window, disables PiP and removes the button', async () => {
      await page.evaluate(() => Nova.pip.enter(document.querySelector('#vwrap video'))); await page.waitForFunction(() => !!document.pictureInPictureElement);
      await page.evaluate(() => Nova.set('floating', false)); await page.waitForFunction(() => !document.pictureInPictureElement);
      const r = await page.evaluate(() => { const v = document.querySelector('#vwrap video'); return { dis: v.disablePictureInPicture, auto: v.hasAttribute('autopictureinpicture'), btn: !!document.querySelector('.pui [data-p=pip]'), can: Nova.pip.enabled() }; });
      assert.deepStrictEqual(r, { dis: true, auto: false, btn: false, can: false }); });
    await t('switching it back ON re-enables floating', async () => {
      await page.evaluate(() => Nova.set('floating', true)); await page.waitForSelector('.pui [data-p=pip]', { state: 'attached' });
      assert.strictEqual(await page.evaluate(() => document.querySelector('#vwrap video').disablePictureInPicture), false); });
    await t('leaving the page while a video plays floats it (fallback for browsers without the media-session action)', async () => {
      await page.evaluate(() => { const v = document.querySelector('#vwrap video'); Object.defineProperty(v, 'paused', { value: false, configurable: true }); Object.defineProperty(v, 'ended', { value: false, configurable: true });
        Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => !!document.pictureInPictureElement); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }
  { const { ctx, page } = await open(browser, port, db(), { floating: false }, { pip: true });
    await t('setting OFF from the start: no button, PiP disabled', async () => {
      await page.waitForSelector('#vwrap video'); assert.ok(!(await page.$('.pui [data-p=pip]'))); assert.strictEqual(await page.evaluate(() => document.querySelector('#vwrap video').disablePictureInPicture), true); });
    await ctx.close(); }

  console.log('D. inbox chat uses the same Quick Reaction');
  { const { ctx, page } = await open(browser, port, db(), { quick: '🔥' });
    await t('Nova.quick() follows Settings and falls back to a heart if the stored value is unusable', async () => {
      const r = await page.evaluate(async () => { const a = Nova.quick(); Nova.S.quick = ''; const b = Nova.quick(); Nova.S.quick = 'x'.repeat(40); const c = Nova.quick(); Nova.S.quick = '🔥'; return [a, b, c]; });
      assert.deepStrictEqual(r, ['🔥', '❤️', '❤️']); });
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
