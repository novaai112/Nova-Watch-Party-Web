/* Login-page cookie card: layout (bottom-right on laptop/tablet, bottom on phone), Customize view, toggles, shown once, shown again after sign-out.
   Run: E2E_OUT=/dir node tests/e2e-cookie-consent.js */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'ck-')); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..'), MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' };
const server = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); if (u === '/api/config') { r.setHeader('content-type', 'application/javascript'); return r.end(''); }
  const f = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', MIME[path.extname(f)] || 'text/plain'); r.end(fs.readFileSync(f)); });
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', String(e.message).split('\n')[0]); } };
(async () => {
  await new Promise(r => server.listen(0, r)); const url = `http://localhost:${server.address().port}/index.html`;
  const b = await chromium.launch();
  const mk = async (vp) => { const c = await b.newContext({ viewport: vp }); await c.route(/cdn\.jsdelivr|fonts\.g/, r => r.abort()); const p = await c.newPage(); await p.goto(url); await p.waitForSelector('.nck'); await p.waitForTimeout(500); return { c, p }; };
  const box = p => p.evaluate(() => { const r = document.querySelector('.nck').getBoundingClientRect(); return { l: r.left, r: innerWidth - r.right, b: innerHeight - r.bottom, w: r.width }; });
  for (const [name, vp] of [['laptop', { width: 1366, height: 768 }], ['tablet', { width: 820, height: 1180 }]]) {
    const { c, p } = await mk(vp);
    await t(`${name}: card sits at the bottom-right`, async () => { const g = await box(p); assert.ok(g.r >= 16 && g.r <= 24 && g.b >= 16 && g.b <= 24 && g.l > vp.width / 2 - 50 && g.w <= 400, JSON.stringify(g)); await p.screenshot({ path: path.join(OUT, `cookie-${name}.png`) }); });
    await c.close();
  }
  { const { c, p } = await mk({ width: 390, height: 844 });
    await t('phone: card sits at the bottom, full width', async () => { const g = await box(p); assert.ok(g.l === 12 && g.r === 12 && g.b === 12, JSON.stringify(g)); await p.screenshot({ path: path.join(OUT, 'cookie-phone.png') }); });
    await t('main view: title, text, Customize, Reject, Accept', async () => { const x = await p.innerText('.nck'); assert.ok(/Cookie settings/.test(x) && /Customize cookie settings/.test(x) && /Reject all cookies/.test(x) && /Accept all cookies/.test(x)); });
    await t('Customize: Necessary (required, locked), Analytics, Marketing toggles default Off, Save preferences', async () => {
      await p.click('text=Customize cookie settings'); const x = await p.innerText('.nck'); assert.ok(/Necessary/.test(x) && /Required/.test(x) && /Analytics/.test(x) && /Marketing/.test(x) && /Save preferences/.test(x));
      assert.strictEqual(await p.getAttribute('[data-t=analytics]', 'aria-checked'), 'false'); assert.ok(await p.isDisabled('.nck-sw[disabled]')); await p.screenshot({ path: path.join(OUT, 'cookie-custom-phone.png') }); });
    await t('toggle Analytics on, Save → stored, card gone', async () => { await p.click('[data-t=analytics]'); assert.strictEqual(await p.innerText('[data-l=analytics]'), 'On'); await p.click('text=Save preferences');
      assert.ok(!(await p.$('.nck'))); const v = JSON.parse(await p.evaluate(() => localStorage.getItem('nova_cookie_consent'))); assert.ok(v.analytics === true && v.marketing === false);
      assert.ok(await p.evaluate(() => NovaCookies.allowed('analytics') && !NovaCookies.allowed('marketing') && NovaCookies.allowed('necessary'))); });
    await t('shown only once: reloading the login page does not show it again', async () => { await p.reload(); await p.waitForTimeout(400); assert.ok(!(await p.$('.nck'))); });
    await t('after sign-out the choice is cleared, so the next login page shows it once more', async () => { await p.evaluate(() => localStorage.removeItem('nova_cookie_consent')); await p.reload(); await p.waitForSelector('.nck'); });
    await t('Reject all → nothing optional allowed', async () => { await p.click('text=Reject all cookies'); assert.ok(await p.evaluate(() => !NovaCookies.allowed('analytics') && !NovaCookies.allowed('marketing'))); });
    await c.close(); }
  { const { c, p } = await mk({ width: 1280, height: 800 }); await t('Accept all → both allowed', async () => { await p.click('text=Accept all cookies'); assert.ok(await p.evaluate(() => NovaCookies.allowed('analytics') && NovaCookies.allowed('marketing'))); }); await c.close(); }
  await b.close(); server.close(); console.log(`\n${ok} passed, ${bad} failed · ${OUT}`); process.exit(bad ? 1 : 0);
})();
