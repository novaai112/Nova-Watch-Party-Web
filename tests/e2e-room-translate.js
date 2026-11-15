/* Room chat: Translate / Original button, Auto-translate to English, errors, links kept. Run: node tests/e2e-room-translate.js */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..'), mockTr = require('./translate-mock');
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
  const tr = await mockTr(ctx);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.errs = errs;
  await page.goto(`http://localhost:${port}/nova-home.html`);
  await page.waitForSelector('#rm #feed .cm[data-mid]', { timeout: 9000 }); await page.waitForTimeout(250);
  return { ctx, page, tr };
}
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();
  const HING = 'Kynki teri maa ne tujhe sikhaya ni ki satna me tera baap road pe milega rave me ni', EN = 'I think we should watch this one tonight', HI = 'मुझे यह वीडियो बहुत पसंद आया';
  const d = db(); d.room_messages.push({ id: 9, room_id: 'r1', user_id: 'u1', kind: 'chat', body: HING, created_at: new Date(now - 3000).toISOString() },
    { id: 10, room_id: 'r1', user_id: 'u2', kind: 'chat', body: EN, created_at: new Date(now - 2000).toISOString() },
    { id: 11, room_id: 'r1', user_id: 'u2', kind: 'chat', body: HI, created_at: new Date(now - 1000).toISOString() },
    { id: 12, room_id: 'r1', user_id: 'u1', kind: 'chat', body: 'Hola, ¿cómo estás?', created_at: new Date(now - 500).toISOString() });
  { const { ctx, page, tr } = await open(browser, port, d, { translate: false });
    const txt = id => page.textContent(`#feed .cm[data-mid="${id}"] .mcard p`), btn = id => page.locator(`#feed .cm[data-mid="${id}"] .mt-btn`), lab = async id => (await btn(id).innerText()).trim();
    await t('incoming non-English text has a small dim Translate button below the text; own / English message none', async () => {
      assert.strictEqual(await lab(9), 'Translate'); assert.strictEqual(await lab(11), 'Translate'); assert.strictEqual(await btn(8).count(), 0); assert.strictEqual(await btn(10).count(), 0);
      assert.ok(await page.evaluate(() => { const m = document.querySelector('#feed .cm[data-mid="9"]'); return m.querySelector('.mt-btn').getBoundingClientRect().top >= m.querySelector('.mcard p').getBoundingClientRect().bottom - 1; }));
      const css = await btn(9).evaluate(e => { const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), op: parseFloat(c.opacity), bg: c.backgroundColor }; });
      assert.ok(css.fs <= 13 && css.op < 1 && css.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(css)); });
    await t('Translate -> English + Original; Original -> sender words + Translate; again = cached', async () => {
      await btn(9).click(); await page.waitForSelector('#feed .cm[data-mid="9"] .mt-btn:text("Original")');
      assert.ok(/^Because your mother taught you/.test(await txt(9))); assert.ok(tr.qs.some(x => x[0] === 'hi' && x[1] === HING));
      await btn(9).click(); await page.waitForSelector('#feed .cm[data-mid="9"] .mt-btn:text("Translate")'); assert.strictEqual(await txt(9), HING);
      const n = tr.n; await btn(9).click(); await page.waitForSelector('#feed .cm[data-mid="9"] .mt-btn:text("Original")'); assert.strictEqual(tr.n, n); });
    await t('Devanagari and Spanish translate to English', async () => {
      await btn(11).click(); await page.waitForSelector('#feed .cm[data-mid="11"] .mt-btn:text("Original")'); assert.strictEqual(await txt(11), 'I really liked this video');
      await btn(12).click(); await page.waitForSelector('#feed .cm[data-mid="12"] .mt-btn:text("Original")'); assert.ok((await txt(12)).includes('Hello, how are you?')); });
    await t('tapping the button does not trigger the double-tap reaction or open anything else', async () => {
      assert.strictEqual(await page.locator('#feed .rx').count(), 0); assert.strictEqual(await page.locator('.msg-menu').count(), 0); });
    await t('no page errors', async () => assert.deepStrictEqual(page.errs, []));
    await ctx.close(); }

  { const o = await open(browser, port, d, { translate: false }); const p = o.page, btn = id => p.locator(`#feed .cm[data-mid="${id}"] .mt-btn`);
    await t('translator offline: friendly error toast, Translate button stays; retry works when back online', async () => {
      o.tr.fail = true; await btn(9).click(); await p.waitForSelector('.toast.err', { timeout: 5000 });
      assert.strictEqual((await btn(9).innerText()).trim(), 'Translate'); assert.ok(/^Kynki/.test(await p.textContent('#feed .cm[data-mid="9"] .mcard p')));
      o.tr.fail = false; await btn(9).click(); await p.waitForSelector('#feed .cm[data-mid="9"] .mt-btn:text("Original")'); });
    await o.ctx.close(); }

  { const o = await open(browser, port, d, { translate: true }); const p = o.page;
    const txt = id => p.textContent(`#feed .cm[data-mid="${id}"] .mcard p`), btn = id => p.locator(`#feed .cm[data-mid="${id}"] .mt-btn`);
    await t('Auto-translate ON: other-language messages already English with an Original button; English untouched, no request for it', async () => {
      await p.waitForSelector('#feed .cm[data-mid="9"] .mt-btn:text("Original")'); await p.waitForSelector('#feed .cm[data-mid="11"] .mt-btn:text("Original")');
      assert.ok(/^Because your mother/.test(await txt(9))); assert.strictEqual(await txt(11), 'I really liked this video');
      assert.strictEqual(await btn(10).count(), 0); assert.strictEqual(await txt(10), EN); assert.ok(!o.tr.qs.some(x => x[1] === EN)); });
    await t('Original on one message sticks while Auto-translate stays ON', async () => {
      await btn(9).click(); await p.waitForSelector('#feed .cm[data-mid="9"] .mt-btn:text("Translate")'); await p.waitForTimeout(300); assert.strictEqual(await txt(9), HING); });
    await t('Auto OFF: others return to original; ON again brings English back (from cache)', async () => {
      await p.evaluate(() => Nova.set('translate', false)); await p.waitForSelector('#feed .cm[data-mid="11"] .mt-btn:text("Translate")'); assert.ok(/^मुझे/.test(await txt(11)));
      const n = o.tr.n; await p.evaluate(() => Nova.set('translate', true)); await p.waitForSelector('#feed .cm[data-mid="11"] .mt-btn:text("Original")'); assert.strictEqual(await txt(11), 'I really liked this video'); assert.strictEqual(o.tr.n, n); });
    await t('room settings has the Auto-translate switch bound to the shared setting', async () => {
      await p.evaluate(() => { const b = document.querySelector('[data-act="settings"],#setbtn,[aria-label="Settings"]'); b && b.click(); }); 
      const src = fs.readFileSync(path.join(root, 'room.js'), 'utf8'); assert.ok(src.includes('id="trsw"') && src.includes("Nova.set('translate', t.checked)")); });
    await t('no page errors', async () => assert.deepStrictEqual(o.page.errs, []));
    await o.ctx.close(); }

  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
