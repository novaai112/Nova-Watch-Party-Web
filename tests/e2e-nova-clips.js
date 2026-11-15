// node tests/e2e-nova-clips.js  (Playwright) — Nova Clips panel: 8 columns, lazy previews, transparent speaker, attach.
// Needs CLIPS_DIR = a folder with a few VP9/Opus .mp4 files named base1.mp4.. (Chromium has no H.264) — they are copied to the real names.
const { chromium } = require(process.env.PW || 'playwright'); const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert');
const root = path.join(__dirname, '..'), src = process.env.CLIPS_DIR || path.join(__dirname, 'fixtures');
global.window = {}; require(path.join(root, 'nova-clips-data.js')); const REAL = window.NOVA_CLIPS.files; delete global.window;
const srv = http.createServer((q, r) => {
  const n = decodeURIComponent(q.url.slice(1).split('?')[0]); const i = REAL.indexOf(n);
  if (i < 0) { r.writeHead(404); return r.end(); }
  const f = path.join(src, 'base' + (i % 3 + 1) + '.mp4'), st = fs.statSync(f), rg = q.headers.range;
  if (rg) { const [a, b] = rg.replace('bytes=', '').split('-'); const s = +a, e = b ? +b : st.size - 1; r.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 }); fs.createReadStream(f, { start: s, end: e }).pipe(r); }
  else { r.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': st.size }); fs.createReadStream(f).pipe(r); }
});
const MENU = `<div id=mediaMenu class=media-menu><button class=media-menu-item data-media-action=gallery>Photos</button><button class=media-menu-item data-nova-clips><i class="media-brand nclips-brand">▶</i><span>Nova Clips</span></button><button class=media-menu-item data-media-provider=giphy>GIPHY</button></div>`;
const mk = (room, w) => `<div ${room ? 'id=rm' : ''} style="position:relative;width:min(${w}px,100vw);box-sizing:border-box;height:600px;border:1px solid #ccc"><section id=chatMediaPicker class=chat-media-picker><style>#chatMediaPicker{position:absolute;left:0;bottom:0;width:100%;background:#fff}#chatMediaPicker.provider-open .media-provider-panel{display:flex}.media-provider-panel{height:min(56vh,480px);flex-direction:column;overflow:hidden;padding:10px 12px 0}.media-provider-panel[hidden]{display:none}.media-provider-head{display:flex;gap:10px;margin-bottom:8px}.media-provider-head>b{flex:1}</style>${MENU}<div id=mediaProviderPanel class=media-provider-panel hidden></div><div id=mediaContactPicker hidden></div></section></div>`;
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); let fails = 0;
  for (const [name, vp, room, w, cols] of [['chat laptop', { width: 1280, height: 760 }, false, 1000, 8], ['room tablet', { width: 820, height: 900 }, true, 760, 5], ['room phone', { width: 390, height: 800 }, true, 390, 3]]) {
    const ctx = await b.newContext({ viewport: vp }), p = await ctx.newPage(); p.on('pageerror', e => { fails++; console.error('pageerror', e.message); });
    await p.setContent(`<!doctype html><meta charset=utf-8><style>:root{--soft:#eef1f5;--ac:#2563eb}body{margin:0;font-family:sans-serif}.media-menu-item{display:flex;gap:8px;padding:8px}</style>${mk(room, w)}`);
    await p.addStyleTag({ path: path.join(root, 'nova-clips.css') });
    await p.evaluate(({ base, files, room }) => {
      window.NOVA_CLIPS = { base, files }; window.__added = [];
      const api = { addRemote: (u, t, n) => { window.__added.push({ u, t, n }); }, count: () => window.__added.length };
      if (room) window.NovaRoomMedia = api; else window.NovaChatPicker = Object.assign({ hooks: { count: () => 0 } }, api);
    }, { base, files: REAL, room });
    await p.addScriptTag({ path: path.join(root, 'nova-clips.js') });
    const t = async (l, fn) => { try { await fn(); console.log('ok  -', name, l); } catch (e) { fails++; console.error('FAIL -', name, l, e.message.split('\n')[0]); } };
    await p.click('[data-nova-clips]'); await p.waitForSelector('.nclip');
    await t('menu hides and the panel shows "Nova Clips"', async () => { assert(await p.$eval('#mediaMenu', e => e.hidden)); assert.strictEqual(await p.$eval('.media-provider-head b', e => e.textContent), 'Nova Clips'); });
    await t('has every clip as a tile, newest first', async () => { assert.strictEqual(await p.$$eval('.nclip', e => e.length), REAL.length); });
    await t(`exactly ${cols} columns`, async () => { const c = await p.$eval('.nclips-grid', e => getComputedStyle(e).gridTemplateColumns.split(' ').length); assert.strictEqual(c, cols); const tops = await p.$$eval('.nclip', e => e.slice(0, 16).map(x => Math.round(x.getBoundingClientRect().top))); assert.strictEqual(new Set(tops).size, Math.ceil(16 / cols)); });
    await p.waitForFunction(() => document.querySelectorAll('.nclip.playing').length >= 6, null, { timeout: 15000 });
    await t('visible tiles autoplay (muted loop previews) and offscreen ones stay unloaded', async () => {
      const r = await p.$$eval('.nclip', e => ({ loaded: e.filter(x => x.querySelector('video').getAttribute('src')).length, playing: e.filter(x => x.classList.contains('playing')).length, off: e.slice(-8).every(x => !x.querySelector('video').getAttribute('src')) }));
      assert(r.playing >= 6 && r.loaded < 90 && r.off, JSON.stringify(r)); });
    await t('only ONE tile is audible, it is the first, and its icon is the unmuted one', async () => {
      const r = await p.$$eval('.nclip', e => e.filter(x => x.classList.contains('playing')).map(x => ({ m: x.querySelector('video').muted, on: x.querySelector('.nclip-snd').classList.contains('on') })));
      assert.strictEqual(r.filter(x => !x.m).length, 1); assert(!r[0].m && r[0].on); assert.strictEqual(r.filter(x => x.on).length, 1); });
    await t('speaker is a bare icon: transparent background, no border', async () => { const s = await p.$eval('.nclip-snd', e => { const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopWidth, c.boxShadow]; }); assert.deepStrictEqual(s, ['rgba(0, 0, 0, 0)', '0px', 'none']); });
    await t('tapping another speaker moves the sound there (does not attach)', async () => { await p.click('.nclip:nth-child(3) .nclip-snd'); assert.deepStrictEqual(await p.$$eval('.nclip', e => e.slice(0, 4).map(x => x.querySelector('video').muted)), [true, true, false, true]); assert.strictEqual(await p.evaluate(() => __added.length), 0); });
    await t('tapping the audible speaker mutes everything, and it stays muted', async () => { await p.click('.nclip:nth-child(3) .nclip-snd'); await p.waitForTimeout(400); assert((await p.$$eval('.nclip.playing video', e => e.every(v => v.muted)))); assert.strictEqual(await p.$eval('.nclip:nth-child(3) .nclip-snd', e => e.getAttribute('aria-label')), 'Unmute clip'); });
    await t('preview loops inside its first 6 s', async () => { await p.waitForTimeout(7500); assert(await p.$$eval('.nclip.playing video', e => e.every(v => v.currentTime < 6.6 && !v.paused))); });
    await t('tapping a tile attaches it as a video (like a photo) with the right URL', async () => {
      await p.click('.nclip:nth-child(2)', { position: { x: 8, y: 8 } }); const a = await p.evaluate(() => __added);
      assert.strictEqual(a.length, 1); assert.strictEqual(a[0].t, 'video/mp4'); assert(a[0].u === base + encodeURIComponent(REAL[1]), a[0].u); assert(/^Nova Clip \d{4}-\d{2}-\d{2}\.mp4$/.test(a[0].n));
      assert(await p.$eval('.nclip:nth-child(2)', e => e.classList.contains('added'))); });
    await t('scrolling loads new tiles and releases the old ones', async () => {
      await p.$eval('#novaClipsScroll', e => e.scrollTop = e.scrollHeight / 2); await p.waitForTimeout(2500);
      const r = await p.$$eval('.nclip', e => ({ first: !e[0].querySelector('video').getAttribute('src'), loaded: e.filter(x => x.querySelector('video').getAttribute('src')).length })); assert(r.first && r.loaded < 90, JSON.stringify(r)); });
    await t('video bubble speaker: bare icon, toggles sound, one at a time, does not open the viewer', async () => {
      await p.evaluate(({ base }) => { window.__opened = 0; document.body.insertAdjacentHTML('beforeend', [0, 1].map(i => `<button class=nc-tile data-nc-open=${i} style="position:relative;display:block;width:120px;height:160px"><video class=nc-rmedia muted loop autoplay playsinline src="${base}${encodeURIComponent(window.NOVA_CLIPS.files[i])}"></video><span class=nc-snd role=button tabindex=0 data-nc-snd aria-pressed=false aria-label="Unmute video"></span></button>`).join('')); document.addEventListener('click', e => { if (e.target.closest('[data-nc-open]')) window.__opened++; }); }, { base });
      await p.waitForTimeout(600);
      const s = await p.$eval('.nc-tile .nc-snd', e => { const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopWidth]; }); assert.deepStrictEqual(s, ['rgba(0, 0, 0, 0)', '0px']);
      await p.click('.nc-tile:nth-of-type(1) .nc-snd'); assert.deepStrictEqual(await p.$$eval('.nc-tile video', e => e.map(v => v.muted)), [false, true]);
      await p.click('.nc-tile[data-nc-open="1"] .nc-snd'); assert.deepStrictEqual(await p.$$eval('.nc-tile video', e => e.map(v => v.muted)), [true, false]);
      await p.click('.nc-tile[data-nc-open="1"] .nc-snd'); assert.deepStrictEqual(await p.$$eval('.nc-tile video', e => e.map(v => v.muted)), [true, true]);
      assert.strictEqual(await p.evaluate(() => __opened), 0); });
    await t('no sideways overflow', async () => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
    await p.screenshot({ path: path.join(process.env.SHOTS || __dirname, `nova-clips-${name.replace(' ', '-')}.png`) });
    await ctx.close();
  }
  await b.close(); srv.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();
