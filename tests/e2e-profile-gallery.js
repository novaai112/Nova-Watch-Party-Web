// node tests/e2e-profile-gallery.js (Playwright) - one-row gallery, + first, eye on every photo, full viewer
const { chromium } = require(process.env.PW || 'playwright'); const path = require('path'), fs = require('fs'), assert = require('assert'), os = require('os');
const root = path.join(__dirname, '..');
const page = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href="file://${root}/profile-watch.css">
<style>:root{--card:#fff;--line:#e5e9f0;--tx:#0f172a;--mu:#64748b;--ac:#2563eb;--chip:#0f172a0a;--chip2:#0f172a14;--soft:#f6f8fc}.ib{width:36px;height:36px;border-radius:50%;border:1px solid #ccc;background:#fff;display:grid;place-items:center}.lock{overflow:hidden}.gt{position:relative}.gtb{position:absolute;inset:0;width:100%;height:100%;padding:0}.gt img{width:100%;height:100%;object-fit:cover;display:block}</style>
<body style="margin:0;font-family:sans-serif"><div style="max-width:900px;margin:0 auto"><div id=app></div></div><script>
window.__upd = []; window.__del = [];
var svg = function (n) { return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="hsl(' + (n * 47 % 360) + ',60%,50%)"/><text x="40" y="260" font-size="80" fill="#fff">' + n + '</text></svg>'); };
window.Nova = { esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }, t: function (k) { return k; },
  ic: function (n, s) { return '<svg class="ic" data-i="' + n + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 12h16"/></svg>'; }, SOC: {}, S: {}, toast: function (m) { window.__toast = m; }, geo: { line: function () { return ''; }, badge: function () { return ''; } }, avatar: function () { return ''; },
  sb: { storage: { from: function () { return { getPublicUrl: function (p) { return { data: { publicUrl: svg(+p.replace(/\\D/g, '')) } }; }, remove: function () { return Promise.resolve({}); } }; } },
        from: function () { return { update: function (v) { return { eq: function (c, id) { return { eq: function () { window.__upd.push([id, v]); return Promise.resolve({ error: null }); } }; } }; }, delete: function () { return { eq: function (c, id) { window.__del.push(id); P._g = P._g.filter(function (x) { return x.id !== id; }); return Promise.resolve({ error: null }); } }; } }; } } };
var V = {}, U = { id: 'me' }, MAXG = 12, NSFW = false, TAB = 'top', PROFILE_RELATION = null, PD = { own: true, visibility: {} };
var P = { _g: Array.from({ length: 8 }, function (_, i) { return { id: 'g' + (i + 1), path: 'me/p' + (i + 1) + '.jpg', visibility: i === 1 ? 'friends' : i === 2 ? 'hidden' : 'public' }; }) };
var $ = function (q, r) { return (r || document).querySelector(q); }, shell = function (n, h) { return h; }, mbar = function () { return ''; }, panel = function (t, s, a, b) { return '<div>' + a + b + '</div>'; }, ask = function () { return Promise.resolve(true); };
var fetchPD = async function () {}, loadP = async function () {}, inv = function () {}, route = function () {}, publicRoomCard = function () { return ''; }, bnav = function () { return ''; };
</script><script src="file://${root}/profile-watch.js"></script><script src="file://${root}/nova-profile.js"></script>`;
(async () => {
  const b = await chromium.launch(); let fails = 0;
  for (const [name, vp, touch] of [['laptop', { width: 1366, height: 768 }, false], ['phone', { width: 390, height: 800 }, true]]) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 }), p = await ctx.newPage(); p.on('pageerror', e => { console.error('pageerror', e.message); fails++; });
    const f = path.join(os.tmpdir(), 'pg-' + name + '.html'); fs.writeFileSync(f, page); await p.goto('file://' + f);
    const t = async (l, fn) => { try { await fn(); console.log('ok  -', name, l); } catch (e) { fails++; console.error('FAIL -', name, l, e.message.split('\n')[0]); } };
    await p.evaluate(() => { document.getElementById('app').innerHTML = V.gallery(); });
    await p.waitForSelector('.grow .gt');
    await t('everything sits in ONE row (same top for all tiles) and the row scrolls sideways', async () => { const r = await p.$$eval('.grow .gt', e => e.map(x => Math.round(x.getBoundingClientRect().top))); assert.strictEqual(new Set(r).size, 1, r.join()); assert(await p.$eval('.grow', e => e.scrollWidth > e.clientWidth && getComputedStyle(e).overflowX === 'auto' && getComputedStyle(e).scrollbarWidth === 'none')); });
    await t('the + tile is first and every photo has an eye icon', async () => { assert(await p.$eval('.grow .gt:first-child', e => e.classList.contains('gadd'))); assert.strictEqual(await p.$$eval('.grow .gt:not(.gadd) .gvis', e => e.length), 8); });
    await t('eye icons show each photo\'s own mode', async () => assert.deepStrictEqual(await p.$$eval('.gvis', e => e.slice(0, 3).map(x => x.dataset.mode)), ['public', 'friends', 'hidden']));
    await t('page has no sideways overflow', async () => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
    await t('photo menu: Hidden on photo 1 saves only that photo', async () => { await p.click('.gvis[data-vmenu="photo:g1"]'); assert.deepStrictEqual(await p.$$eval('#vmenu .vmi span', e => e.map(x => x.textContent)), ['Public', 'Friends', 'Hidden']); await p.click('#vmenu [data-vmode=hidden]'); await p.waitForFunction(() => window.__upd.length === 1); assert.deepStrictEqual(await p.evaluate(() => window.__upd[0]), ['g1', { visibility: 'hidden' }]); await p.waitForFunction(() => document.querySelector('.gvis[data-vmenu="photo:g1"]').dataset.mode === 'hidden'); });
    await t('row keeps its place after a refresh and + stays first', async () => { assert(await p.$eval('.grow .gt:first-child', e => e.classList.contains('gadd'))); });
    if (!touch) {
      await t('laptop: right arrow shows, left hidden at start; clicking scrolls smoothly', async () => { assert(await p.$eval('.gnav.l', e => e.hidden)); assert(!(await p.$eval('.gnav.r', e => e.hidden))); await p.click('.gnav.r'); await p.waitForFunction(() => document.querySelector('.grow').scrollLeft > 150); await p.waitForFunction(() => !document.querySelector('.gnav.l').hidden); });
    } else {
      await t('phone: no arrow buttons, swipe-scroll works', async () => { assert(!(await p.$eval('.gnav.r', e => getComputedStyle(e).display !== 'none'))); await p.$eval('.grow', e => e.scrollTo({ left: 300 })); await p.waitForFunction(() => document.querySelector('.grow').scrollLeft > 100); });
    }
    await p.$eval('.grow', e => { e.style.scrollBehavior = 'auto'; e.scrollLeft = 0; });
    await t('tap a photo -> full viewer opens at that photo with counter', async () => { await p.click('.gtb[data-id=g3]', { position: { x: 20, y: 60 } }); await p.waitForSelector('#lbx'); assert.strictEqual(await p.$eval('.lbc', e => e.textContent), '3 / 8'); const r = await p.$eval('.lbs:nth-child(3) img', e => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1 && b.width > 100; }); assert(r); });
    await t('viewer: delete button targets the current photo', async () => assert.strictEqual(await p.$eval('#lbx [data-act=delG]', e => e.dataset.id), 'g3'));
    if (!touch) {
      await t('laptop viewer: arrow buttons + keyboard change the photo', async () => { await p.click('#lbx .lbn.r'); await p.waitForFunction(() => document.querySelector('.lbc').textContent === '4 / 8'); await p.keyboard.press('ArrowLeft'); await p.waitForFunction(() => document.querySelector('.lbc').textContent === '3 / 8'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.waitForFunction(() => document.querySelector('.lbc').textContent === '5 / 8'); assert.strictEqual(await p.$eval('#lbx [data-act=delG]', e => e.dataset.id), 'g5'); });
      await t('viewer arrows disable at the ends', async () => { await p.$eval('.lbtrack', e => { e.style.scrollBehavior = 'auto'; e.scrollLeft = 0; }); await p.waitForFunction(() => document.querySelector('.lbn.l').disabled); });
    } else {
      await t('phone viewer: no arrow buttons, swiping (scrolling) changes the photo', async () => { assert(!(await p.$eval('#lbx .lbn.r', e => getComputedStyle(e).display !== 'none'))); await p.$eval('.lbtrack', e => e.scrollTo({ left: e.clientWidth * 4, behavior: 'smooth' })); await p.waitForFunction(() => document.querySelector('.lbc').textContent === '5 / 8'); });
    }
    await t('Escape closes the viewer', async () => { await p.keyboard.press('Escape'); assert.strictEqual(await p.$$eval('#lbx', e => e.length), 0); });
    await t('delete from the viewer removes the photo and closes it', async () => { await p.click('.gtb[data-id=g2]', { position: { x: 20, y: 60 } }); await p.waitForSelector('#lbx'); await p.click('#lbx [data-act=delG]'); await p.waitForFunction(() => window.__del.length === 1); assert.strictEqual(await p.evaluate(() => window.__del[0]), 'g2'); assert.strictEqual(await p.$$eval('#lbx', e => e.length), 0); assert.strictEqual(await p.$$eval('.grow .gt:not(.gadd)', e => e.length), 7); });
    // ---- visitor
    await p.evaluate(() => { PD = { own: false, id: 'x', name: 'Sam', username: 'sam', s: { gallery: true, videos: false }, gallery: ['u/p1.jpg', 'u/p2.jpg', 'u/p3.jpg'], stats: null, videos: null, socials: null, titles: null, channels: null, interests: null }; document.getElementById('app').innerHTML = V.user(); });
    await t('visitor: same one-row gallery with no + tile, no eye, and the viewer works', async () => { assert.strictEqual(await p.$$eval('.grow .gadd', e => e.length), 0); assert.strictEqual(await p.$$eval('.gvis', e => e.length), 0); assert.strictEqual(await p.$$eval('.grow .gt', e => e.length), 3); await p.click('.grow .gtb >> nth=1'); await p.waitForSelector('#lbx'); assert.strictEqual(await p.$eval('.lbc', e => e.textContent), '2 / 3'); assert.strictEqual(await p.$$eval('#lbx [data-act=delG]', e => e.length), 0); await p.keyboard.press('Escape'); });
    await p.screenshot({ path: '/tmp/gallery-' + name + '.png' });
    await ctx.close();
  }
  await b.close(); if (fails) process.exit(1); console.log('all gallery checks passed');
})();
