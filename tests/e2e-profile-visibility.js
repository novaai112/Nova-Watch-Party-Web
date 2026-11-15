// node tests/e2e-profile-visibility.js (Playwright) - Public / Friends / Hidden menu + visitor view of History / Likes / Most watched
const { chromium } = require(process.env.PW || 'playwright'); const path = require('path'), fs = require('fs'), assert = require('assert'), os = require('os');
const root = path.join(__dirname, '..');
const mk = (i, n) => ({ t: 'Video ' + i, id: 'v' + String(i).padStart(10, '0'), kind: 'youtube', provider: 'youtube', ch: 'Chan', n, at: Date.now() - i * 1000 });
const page = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href="file://${root}/profile-watch.css">
<body style="margin:0;font-family:sans-serif;max-width:900px;padding:40px 20px 300px"><div id=app></div><script>
localStorage.setItem('nova.h', ${JSON.stringify(JSON.stringify([mk(1, 3), mk(2, 1)]))}); localStorage.setItem('nova.likes', ${JSON.stringify(JSON.stringify([mk(3, 1)]))});
window.__rpc = []; window.__upd = [];
var ICONS = { eye: 'EYE', user: 'USER', eyeoff: 'OFF', check: 'OK' };
window.Nova = { esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
  t: function (k) { return k; }, ic: function (n, s) { return '<svg class="ic" data-i="' + n + '" width="' + s + '" height="' + s + '"></svg>'; }, SOC: {}, S: {}, toast: function (m) { window.__toast = m; }, geo: { line: function () { return ''; }, badge: function () { return ''; } }, avatar: function () { return ''; },
  sb: { rpc: function (n, a) { window.__rpc.push([n, a]); return Promise.resolve({}); },
        from: function () { return { update: function (v) { return { eq: function () { window.__upd.push(v); PD.visibility = v.visibility; return Promise.resolve({ error: null }); } }; } }; } } };
var V = {}, U = { id: 'me' }, P = {}, NSFW = false, TAB = 'top', PROFILE_RELATION = null;
var PD = { own: true, visibility: { bio: 'public', top: 'public', history: 'friends', likes: true, keywords: false } };
var shell = function (n, h) { return h; }, mbar = function () { return ''; }, panel = function (t, s, a, b) { return '<div>' + a + b + '</div>'; }, ask = function () { return Promise.resolve(true); };
var fetchPD = async function () {}, route = function () { document.getElementById('app').innerHTML = V.activity(); };
var publicRoomCard = function () { return ''; }, bnav = function () { return ''; }, gridG = function () { return ''; }, frTile = function () { return ''; };
</script><script src="file://${root}/profile-watch.js"></script><script src="file://${root}/nova-profile.js"></script>`;
(async () => {
  const b = await chromium.launch(); let fails = 0;
  for (const [name, vp] of [['laptop', { width: 1366, height: 768 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: name === 'phone' }), p = await ctx.newPage(); p.on('pageerror', e => { console.error('pageerror', e.message); fails++; });
    const f = path.join(os.tmpdir(), 'pv-' + name + '.html'); fs.writeFileSync(f, page); await p.goto('file://' + f);
    const t = async (l, fn) => { try { await fn(); console.log('ok  -', name, l); } catch (e) { fails++; console.error('FAIL -', name, l, e.message.split('\n')[0]); } };
    await p.evaluate(() => { document.getElementById('app').innerHTML = V.activity(); });
    await t('own Activity: Most watched, History and Likes each have their own visibility button', async () => assert.deepStrictEqual(await p.$$eval('.wa-h .vmb', e => e.map(x => x.dataset.vmenu)), ['top', 'history', 'likes']));
    await t('buttons show the saved mode (old true = public, friends, public)', async () => assert.deepStrictEqual(await p.$$eval('.wa-h .vmb', e => e.map(x => x.dataset.mode)), ['public', 'friends', 'public']));
    await t('opening the menu lists Public, Friends, Hidden', async () => { await p.click('.wa-h .vmb[data-vmenu=history]'); assert.deepStrictEqual(await p.$$eval('#vmenu .vmi span', e => e.map(x => x.textContent)), ['Public', 'Friends', 'Hidden']); assert.strictEqual(await p.$eval('#vmenu .vmi.on span', e => e.textContent), 'Friends'); });
    await t('menu stays inside the screen and is a dark glass card', async () => { const r = await p.$eval('#vmenu', e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, bg: getComputedStyle(e).backgroundImage }; }); assert(r.l >= 0 && r.r <= vp.width && r.t >= 0 && r.b <= vp.height, JSON.stringify(r)); assert(/gradient/.test(r.bg)); });
    await t('Escape closes it', async () => { await p.keyboard.press('Escape'); assert.strictEqual(await p.$$eval('#vmenu', e => e.length), 0); });
    await t('choosing Hidden for Likes saves "hidden" for likes only and the button updates', async () => {
      await p.click('.wa-h .vmb[data-vmenu=likes]'); await p.click('#vmenu [data-vmode=hidden]'); await p.waitForFunction(() => window.__upd.length === 1);
      const v = await p.evaluate(() => window.__upd[0].visibility); assert.strictEqual(v.likes, 'hidden'); assert.strictEqual(v.history, 'friends'); assert.strictEqual(v.top, 'public');
      await p.waitForFunction(() => document.querySelector('.vmb[data-vmenu=likes]').dataset.mode === 'hidden'); assert.strictEqual(await p.$$eval('#vmenu', e => e.length), 0); });
    await t('choosing Friends for Most watched saves "friends"', async () => { await p.click('.wa-h .vmb[data-vmenu=top]'); await p.click('#vmenu [data-vmode=friends]'); await p.waitForFunction(() => window.__upd.length === 2); assert.strictEqual(await p.evaluate(() => window.__upd[1].visibility.top), 'friends'); });
    await t('picking the mode that is already set does nothing', async () => { await p.click('.wa-h .vmb[data-vmenu=top]'); await p.click('#vmenu [data-vmode=friends]'); await p.waitForTimeout(150); assert.strictEqual(await p.evaluate(() => window.__upd.length), 2); });
    await t('opening the page mirrors History and Likes to the account', async () => { const c = await p.evaluate(() => window.__rpc.filter(r => r[0] === 'sync_watch_activity')); assert(c.length >= 1); assert.strictEqual(c[0][1].p_history.length, 2); assert.strictEqual(c[0][1].p_likes.length, 1); });
    await t('deleting a history video also removes it from the account', async () => { await p.click('#waHist .wa-c:nth-child(1) [data-wdel]'); const c = await p.evaluate(() => window.__rpc.filter(r => r[0] === 'remove_watch')); assert.strictEqual(c.length, 1); assert(/watch\?v=/.test(c[0][1].p_url)); });
    await t('unliking removes it from the account likes', async () => { await p.click('#waLike .wa-c:nth-child(1) [data-wunlike]'); const c = await p.evaluate(() => window.__rpc.filter(r => r[0] === 'set_like')); assert.strictEqual(c.length, 1); assert.strictEqual(c[0][1].p_liked, false); });
    // ---- what a visitor gets
    const visit = async (videos) => p.evaluate(v => { PD = { own: false, id: 'x', name: 'Sam', username: 'sam', s: { videos: true }, videos: v, stats: null, gallery: null, friends: null, socials: null, titles: null, channels: null, interests: null }; TAB = 'top'; document.getElementById('app').innerHTML = V.user(); }, videos);
    const vid = [{ video_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'A', thumb: null, watch_count: 3 }];
    await visit({ top: null, history: vid, liked: null });
    await t('visitor: only the shared list shows (History); Most watched and Likes are not even mentioned', async () => { assert.deepStrictEqual(await p.$$eval('.tabs .tab', e => e.map(x => x.textContent)), ['History']); assert.strictEqual(await p.$eval('.tab.on', e => e.textContent), 'History'); assert.strictEqual(await p.$$eval('.vid', e => e.length), 1); });
    await visit({ top: vid, history: vid, liked: vid });
    await t('visitor: all three shared -> three tabs', async () => assert.deepStrictEqual(await p.$$eval('.tabs .tab', e => e.map(x => x.textContent)), ['Most watched', 'History', 'Likes']));
    await visit({ top: null, history: null, liked: null });
    await t('visitor: nothing shared -> no videos box at all, no controls', async () => { assert.strictEqual(await p.$$eval('.tabs', e => e.length), 0); assert.strictEqual(await p.$$eval('.vmb', e => e.length), 0); });
    await ctx.close();
  }
  await b.close(); if (fails) process.exit(1); console.log('all profile visibility checks passed');
})();
