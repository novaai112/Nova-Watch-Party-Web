// node tests/e2e-profile-watch.js (Playwright) - profile Watch Activity rows
const { chromium } = require(process.env.PW || 'playwright'); const path = require('path'), fs = require('fs'), assert = require('assert'), os = require('os');
const root = path.join(__dirname, '..');
const mk = (i, n, at) => ({ t: 'Video ' + i, id: 'v' + String(i).padStart(10, '0'), kind: 'youtube', provider: 'youtube', d: '3:0' + (i % 10), ch: 'Chan', n, at });
const hist = Array.from({ length: 40 }, (_, i) => mk(i + 1, i < 3 ? 5 - i : 1, Date.now() - i * 1000));
const likes = Array.from({ length: 25 }, (_, i) => mk(100 + i, 1));
const page = (embed) => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href="file://${root}/profile-watch.css"><body style="margin:0;font-family:sans-serif;max-width:900px">
<div id=host></div><script>
localStorage.setItem('nova.h', ${JSON.stringify(JSON.stringify(hist))}); localStorage.setItem('nova.likes', ${JSON.stringify(JSON.stringify(likes))});
window.NovaEmbed = {active:${embed}}; window.__msgs=[]; ${embed ? "parent.postMessage = function(m){ window.__msgs.push(m) };" : ''}
</script><script src="file://${root}/profile-watch.js"></script><script>document.getElementById('host').innerHTML = NovaWatch.html()</script>`;
(async () => {
  const b = await chromium.launch(); let fails = 0;
  for (const [name, vp] of [['phone', { width: 390, height: 800 }], ['laptop', { width: 1366, height: 768 }]]) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: name === 'phone' }), p = await ctx.newPage(); p.on('pageerror', e => { console.error('pageerror', e.message); fails++; });
    const f = path.join(os.tmpdir(), 'pw-' + name + '.html'); fs.writeFileSync(f, page(true)); await p.goto('file://' + f);
    const t = async (l, fn) => { try { await fn(); console.log('ok  -', name, l); } catch (e) { fails++; console.error('FAIL -', name, l, e.message); } };
    await t('three rows: Most watched (3), History (40), Likes (25)', async () => assert.deepStrictEqual(await p.$$eval('.wa-h h4 span', e => e.map(x => +x.textContent)), [3, 40, 25]));
    await t('most watched sorted by count (5,4,3)', async () => assert.deepStrictEqual(await p.$$eval('#waTop .wa-th i', e => e.map(x => x.textContent)), ['5×', '4×', '3×']));
    await t('rows scroll horizontally, scrollbar hidden', async () => {
      const r = await p.$eval('#waHist', e => ({ sw: e.scrollWidth, cw: e.clientWidth, bar: e.offsetHeight - e.clientHeight, sbw: getComputedStyle(e).scrollbarWidth, ov: getComputedStyle(e).overflowX }));
      assert(r.sw > r.cw && r.ov === 'auto' && r.sbw === 'none' && r.bar === 0, JSON.stringify(r)); });
    await t('page itself has no horizontal overflow', async () => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
    await t('scrolls to the last history video', async () => { await p.$eval('#waHist', e => { e.scrollLeft = 1e6; }); assert(await p.$eval('#waHist .wa-c:last-child', e => { const r = e.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.right > 0; })); });
    await t('only history cards have a delete icon; likes have an unlike', async () => { assert.strictEqual(await p.$$eval('#waHist [data-wdel]', e => e.length), 40); assert.strictEqual(await p.$$eval('#waTop [data-wdel]', e => e.length), 0); assert.strictEqual(await p.$$eval('#waLike [data-wunlike]', e => e.length), 25); });
    await t('tap plays to the room (dock message)', async () => { await p.click('#waHist .wa-c:nth-child(1) .wa-p', { force: true }); await p.waitForFunction(() => window.__msgs.length === 1); const m = await p.evaluate(() => window.__msgs[0]); assert(m.nova === 'dock' && m.type === 'play' && m.item.id === 'v0000000001'); });
    await p.evaluate(() => { document.getElementById('waHist').scrollLeft = 0; });
    await t('delete one history video (removed from storage, count drops, likes untouched)', async () => { await p.click('#waHist .wa-c:nth-child(2) [data-wdel]'); assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage['nova.h']).length), 39); assert.strictEqual(+await p.$eval('#waHist', e => e.children.length), 39); assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage['nova.likes']).length), 25); });
    await t('delete also removes it from Most watched when it was there', async () => { const before = await p.$$eval('#waTop .wa-c', e => e.length); await p.click('#waHist .wa-c:nth-child(1) [data-wdel]'); assert.strictEqual(await p.$$eval('#waTop .wa-c', e => e.length), before - 1); });
    await t('Clear all history empties History + Most watched, keeps Likes', async () => { p.once('dialog', d => d.accept()); await p.click('[data-wclear]'); await p.waitForSelector('#waHist', { state: 'detached' });
      assert.strictEqual(await p.evaluate(() => localStorage['nova.h']), '[]'); assert.strictEqual(await p.$$eval('.wa-em', e => e.length), 2); assert.strictEqual(await p.$$eval('#waLike .wa-c', e => e.length), 25); });
    await t('unlike removes from likes', async () => { await p.click('#waLike .wa-c:nth-child(1) [data-wunlike]'); assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage['nova.likes']).length), 24); });
    await ctx.close();
  }
  await b.close(); if (fails) process.exit(1); console.log('all profile watch checks passed');
})();
