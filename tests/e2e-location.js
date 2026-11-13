/* Browser integration test for the location feature: the REAL profile.html + nova-core.js + nova-location.js + nova-profile.js,
 * a generic in-page fake of Supabase, mocked reverse-geocoding / flag images / map tiles, and a controllable GPS position.
 * Run: E2E_OUT=/some/dir node tests/e2e-location.js   (needs `playwright` + Chromium) */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'loc-')); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..');
const FLAG_PNG = Buffer.from(fs.readFileSync(path.join(__dirname, 'flag.b64'), 'utf8'), 'base64');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

const STUB_SUPABASE = `window.supabase={createClient:()=>{
 const ok=d=>({data:d,error:null});
 const resolveQ=st=>{ if(st.table==='profiles'){ if(st.op==='update'){ if(window.__failSave) return {data:null,error:{message:'column does not exist'}}; Object.assign(window.__P,st.val); (window.__updates=window.__updates||[]).push(st.val); return ok(null);} return ok(st.single?window.__P:[window.__P]); } return ok(st.single?null:[]); };
 const builder=table=>{const st={table,op:'select'};const p=new Proxy({},{get(_,k){
   if(k==='then') return (res,rej)=>Promise.resolve(resolveQ(st)).then(res,rej);
   if(k==='single'||k==='maybeSingle') return ()=>{st.single=true;return Promise.resolve(resolveQ(st))};
   if(['update','insert','upsert','delete'].includes(k)) return v=>{st.op=k;st.val=v;return p};
   return ()=>p;}});return p};
 const generic=()=>new Proxy(function(){},{get:(_,k)=>k==='then'?undefined:generic(),apply:()=>generic()});
 return {auth:{getSession:async()=>({data:{session:{access_token:'t',user:{id:'u1',email:'me@x.com',user_metadata:{}}}}}),getUser:async()=>({data:{user:{id:'u1',email:'me@x.com'}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},
  from:builder,rpc:async(n,a)=>{ if(n==='public_profile'&&a&&a.p_uid==='u1'){const P=window.__P;return ok(Object.assign({own:true,id:'u1',name:P.full_name,username:P.username,avatar:P.avatar_url,country:P.country,country_code:P.country_code,bio:P.bio,visibility:{},s:{}},(window.__RPC||{}).self||{}));} return ok((window.__RPC||{})[n]??null); },channel:()=>generic(),removeChannel(){},storage:generic()};}};`;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/config') { res.setHeader('content-type', 'application/javascript'); return res.end("window.SUPABASE_URL='http://127.0.0.1:1';window.SUPABASE_ANON_KEY='anon';"); }
  const f = path.join(root, u === '/' ? 'index.html' : u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
});

let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.error('  ✗', n, '\n    ', (e.message || e).toString().split('\n')[0]); } };

async function newPage(browser, port, { grant = false, pos = { latitude: 30.9010, longitude: 75.8573 }, profile = {}, rpc = {}, scheme = 'light', width = 390, height = 844, geo = {}, perm = grant ? null : 'prompt' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme, geolocation: pos, permissions: grant ? ['geolocation'] : [] });
  await ctx.route('**/supabase.min.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB_SUPABASE }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('**/api.bigdatacloud.net/**', r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(geo.bdc || { city: 'Ludhiana', locality: 'Ludhiana', principalSubdivision: 'Punjab', countryName: 'India', countryCode: 'IN' }) }));
  await ctx.route('**/nominatim.openstreetmap.org/**', r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(geo.osm || {}) }));
  await ctx.route('**/flagcdn.com/**', r => r.fulfill({ contentType: 'image/png', body: FLAG_PNG }));
  await ctx.route('**/www.openstreetmap.org/**', r => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#cfe8cf;font:14px sans-serif;display:grid;place-items:center;height:100vh">[ OpenStreetMap tile area ]</body>' }));
  await ctx.addInitScript(`window.__P=${JSON.stringify(Object.assign({ id: 'u1', full_name: 'Dinesh Kumar', username: 'dinesh', avatar_url: null, bio: 'hi', settings: {}, visibility: {}, maturity_verified: false }, profile))};window.__RPC=${JSON.stringify(rpc)};`);
  if (perm) await ctx.addInitScript(`(()=>{const q=navigator.permissions.query.bind(navigator.permissions);navigator.permissions.query=async d=>d&&d.name==='geolocation'?{state:${JSON.stringify(perm)},onchange:null}:q(d)})();`);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.errs = errs;
  return { ctx, page };
}
const go = async (page, port, hash = '#info') => { await page.goto(`http://localhost:${port}/profile.html${hash}`); await page.waitForSelector('.idstrip, .vhb, .mid', { timeout: 8000 }).catch(() => { }); };

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();

  console.log('A. helpers (real nova-core.js + nova-location.js)');
  { const { ctx, page } = await newPage(browser, port); await go(page, port);
    await t('text(): "City, State (Country)"; hidden → empty; country-only is not shown as a location', async () => {
      const r = await page.evaluate(() => { const g = Nova.geo; return [g.text({ city: 'Ludhiana', region: 'Punjab', country_code: 'IN' }), g.text(g.mask({ city: 'Ludhiana', region: 'Punjab', country_code: 'IN', location_lat: 1, location_lng: 2 }, true)), g.text({ city: 'Paris', region: 'Paris', country_code: 'FR' }), g.text({ region: 'Texas', country_code: 'US' })]; });
      assert.deepStrictEqual(r, ['Ludhiana, Punjab (India)', '', 'Paris (France)', 'Texas (United States)']); });
    await t('mask(hide) removes city/state/coordinates but keeps the country code (flag)', async () => {
      const m = await page.evaluate(() => Nova.geo.mask({ city: 'X', region: 'Y', country_code: 'IN', location_lat: 1, location_lng: 2, lat: 1, lng: 2 }, true));
      assert.strictEqual(m.country_code, 'IN'); assert(!m.city && !m.region && m.location_lat == null && m.lat == null); });
    await t('parsePlace(): BigDataCloud + OpenStreetMap shapes; rejects bad country codes', async () => {
      const r = await page.evaluate(() => { const g = Nova.geo; return [g.parsePlace('bdc', { locality: 'Ludhiana', principalSubdivision: 'Punjab', countryCode: 'IN' }), g.parsePlace('osm', { address: { town: 'Sangrur', state: 'Punjab', country_code: 'in' } }), g.parsePlace('bdc', { city: 'X', countryCode: 'ZZZ' }), g.parsePlace('bdc', null)]; });
      assert.deepStrictEqual([r[0].city, r[0].cc, r[0].country], ['Ludhiana', 'IN', 'India']); assert.deepStrictEqual([r[1].city, r[1].cc], ['Sangrur', 'IN']); assert.strictEqual(r[2], null); assert.strictEqual(r[3], null); });
    await t('XSS: markup in city/state/country is escaped; invalid codes render no flag', async () => {
      const h = await page.evaluate(() => Nova.geo.line({ city: '<img src=x onerror=alert(1)>', region: '"><script>1</script>', country_code: 'IN', lat: 30, lng: 75 }) + Nova.geo.flag('"><x', 14) + Nova.geo.badge({ country_code: 'IN1' }, 40));
      const bad = await page.evaluate(h => { const d = document.createElement('div'); d.innerHTML = h; return d.querySelectorAll('script, img[src="x"], [onerror]').length; }, h);
      assert.strictEqual(bad, 0, h); assert(!/<img src=x|<script/i.test(h), h); });
    await t('coordinates outside the valid range never produce a map button', async () => {
      const r = await page.evaluate(() => [Nova.geo.mapBtn({ lat: 95, lng: 10, city: 'a' }), Nova.geo.mapBtn({ lat: 'x', lng: 1 }), Nova.geo.mapBtn({ lat: 30, lng: 75, city: 'a' })]);
      assert.strictEqual(r[0], ''); assert.strictEqual(r[1], ''); assert(r[2].includes('data-geo-map')); });
    await ctx.close(); }

  console.log('B. after login: permission sheet → allow → saved → shown on profile');
  { const { ctx, page } = await newPage(browser, port); await go(page, port);
    await t('our own permission sheet appears (not the raw browser prompt) and explains what is shown', async () => {
      await page.waitForSelector('.geo-sheet', { timeout: 6000 }); const tx = await page.textContent('.geo-sheet'); assert(/country flag/i.test(tx) && /Hide Location/.test(tx) && /Allow location/.test(tx));
      await page.screenshot({ path: path.join(OUT, '01-permission-sheet-mobile.png') }); });
    await t('"Allow location" → coordinates reverse-geocoded and saved (rounded to ~1 km, city/state/country/flag code)', async () => {
      await ctx.grantPermissions(['geolocation'], { origin: `http://localhost:${port}` }); await page.click('[data-a=allow]');
      await page.waitForFunction(() => (window.__updates || []).length > 0, null, { timeout: 8000 });
      const u = await page.evaluate(() => window.__updates[0]);
      assert.deepStrictEqual([u.country_code, u.country, u.city, u.region, u.location_lat, u.location_lng], ['IN', 'India', 'Ludhiana', 'Punjab', 30.9, 75.86]); assert(!!u.location_updated_at); });
    await t('profile now shows the flag right after @username and "Ludhiana, Punjab (India)" with a map icon', async () => {
      await page.waitForSelector('.idt .geo-line', { timeout: 6000 });
      assert.strictEqual((await page.textContent('.idt .geo-text')).trim(), 'Ludhiana, Punjab (India)');
      assert.strictEqual(await page.locator('.idt p .geo-flag').count(), 0, 'no flag next to @username'); assert(await page.isVisible('.idt .geo-map'));
      assert(await page.locator('.idstrip .avtap .geo-badge').first().isVisible(), 'flag badge on the profile photo');
      assert.strictEqual(await page.locator('.idstrip .avtap .geo-badge img').first().getAttribute('alt'), 'India');
      await page.screenshot({ path: path.join(OUT, '02-profile-with-location-mobile.png') }); });
    await t('the map icon opens a popup with the map at the saved point; Esc closes it', async () => {
      await page.click('.idt .geo-map'); await page.waitForSelector('.geo-ov iframe');
      const src = await page.getAttribute('.geo-ov iframe', 'src'); assert(/openstreetmap\.org\/export\/embed\.html/.test(src) && /marker=30\.90000%2C75\.86000/.test(src), src);
      assert((await page.getAttribute('.geo-ov a[href*=google]', 'href')).includes('30.90000%2C75.86000'));
      await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, '03-map-popup-mobile.png') });
      await page.keyboard.press('Escape'); await page.waitForSelector('.geo-ov', { state: 'detached' }); });
    await t('Settings label explains the new behaviour', async () => {
      await page.goto(`http://localhost:${port}/profile.html#settings`); await page.waitForSelector('.idstrip, .mid, .rows, .chk', { timeout: 6000 }).catch(() => { });
      const body = await page.textContent('body'); assert(/country flag stays visible/i.test(body)); });
    assert.deepStrictEqual(page.errs, [], 'page errors: ' + page.errs.join(' | ')); await ctx.close(); }

  console.log('C. Hide Location ON → no city/state/map, country flag still shown');
  { const { ctx, page } = await newPage(browser, port, { grant: true, profile: { country: 'India', country_code: 'IN', city: 'Ludhiana', region: 'Punjab', location_lat: 30.9, location_lng: 75.86, location_updated_at: new Date().toISOString(), settings: {} } });
    await go(page, port);
    await t('toggle OFF: location line + map icon visible', async () => { await page.waitForSelector('.idt .geo-line'); assert(await page.isVisible('.idt .geo-map')); });
    await page.evaluate(async () => { await Nova.set('hideLoc', true); location.hash = '#settings'; }); await page.waitForTimeout(300); await page.evaluate(() => { location.hash = '#info'; }); await page.waitForSelector('.idstrip'); await page.waitForTimeout(300);
    await t('toggle ON: city/state text and map icon are gone', async () => {
      assert.strictEqual(await page.locator('.idt .geo-line').count(), 0); assert.strictEqual(await page.locator('.geo-map').count(), 0);
      assert(!/Ludhiana|Punjab/.test(await page.textContent('.idstrip'))); });
    await t('toggle ON: the country flag is still shown on the photo (none next to @username)', async () => {
      assert.strictEqual(await page.locator('.idt p .geo-flag').count(), 0); assert(await page.locator('.idstrip .avtap .geo-badge').first().isVisible()); });
    await t('toggle ON: Location card says it is hidden and keeps only the country', async () => {
      const c = await page.textContent('.fgrid'); assert(/India/.test(c) && /hidden/i.test(c) && !/Ludhiana/.test(c)); });
    await page.screenshot({ path: path.join(OUT, '04-profile-hidden-location-mobile.png') });
    assert.deepStrictEqual(page.errs, [], page.errs.join(' | ')); await ctx.close(); }

  console.log('D. other people\'s profile (server already masks hidden users)');
  { const base = { own: false, id: 'u2', name: 'Asha Verma', username: 'asha', avatar: null, country: 'India', country_code: 'IN', bio: 'hello', s: { bio: true }, friend: 'none' };
    const shown = await newPage(browser, port, { rpc: { public_profile: Object.assign({}, base, { city: 'Sangrur', region: 'Punjab', lat: 30.25, lng: 75.84 }) }, grant: true, profile: { country_code: 'IN', location_updated_at: new Date().toISOString() } }); await go(shown.page, port, '#user/u2');
    await t('visitor sees flag + "Sangrur, Punjab (India)" + map icon when the owner shares location', async () => {
      await shown.page.waitForSelector('.vhb .geo-line', { timeout: 6000 }); assert.strictEqual((await shown.page.textContent('.vhb .geo-text')).trim(), 'Sangrur, Punjab (India)');
      assert.strictEqual(await shown.page.locator('.vhb .mu .geo-flag').count(), 0); assert(await shown.page.isVisible('.vhb .geo-map')); assert(await shown.page.isVisible('.vhb .geo-badge'));
      await shown.page.screenshot({ path: path.join(OUT, '05-visitor-shared-mobile.png') }); });
    await shown.ctx.close();
    const hid = await newPage(browser, port, { rpc: { public_profile: Object.assign({}, base, { city: null, region: null, lat: null, lng: null }) }, grant: true, profile: { country_code: 'IN', location_updated_at: new Date().toISOString() } }); await go(hid.page, port, '#user/u2');
    await t('visitor of a hidden user sees ONLY the flag: no city text, no map icon', async () => {
      await hid.page.waitForSelector('.vhb'); await hid.page.waitForTimeout(300);
      assert.strictEqual(await hid.page.locator('.vhb .geo-line').count(), 0); assert.strictEqual(await hid.page.locator('.geo-map').count(), 0);
      assert.strictEqual(await hid.page.locator('.vhb .mu .geo-flag').count(), 0); assert(await hid.page.isVisible('.vhb .geo-badge'));
      await hid.page.screenshot({ path: path.join(OUT, '06-visitor-hidden-mobile.png') }); });
    await hid.ctx.close(); }

  console.log('E. edge cases');
  { const a = await newPage(browser, port); await go(a.page, port); await a.page.waitForSelector('.geo-sheet');
    await t('"Not now" saves nothing, closes the sheet and is remembered (no nagging on reload)', async () => {
      await a.page.click('[data-a=later]'); await a.page.waitForSelector('.geo-sheet', { state: 'detached' });
      assert.strictEqual((await a.page.evaluate(() => window.__updates || [])).length, 0);
      await a.page.reload(); await a.page.waitForSelector('.idstrip'); await a.page.waitForTimeout(2600); assert.strictEqual(await a.page.locator('.geo-sheet').count(), 0); });
    await a.ctx.close();
    const d = await newPage(browser, port); await go(d.page, port); await d.page.waitForSelector('.geo-sheet');
    await t('browser permission denied → friendly "blocked" message, nothing saved', async () => {
      await d.page.click('[data-a=allow]'); await d.page.waitForSelector('.toast', { timeout: 6000 }); assert(/blocked/i.test(await d.page.textContent('#toasts')));
      assert.strictEqual((await d.page.evaluate(() => window.__updates || [])).length, 0); });
    await t('profile without a saved location shows "Not shared yet" + Allow button, and no flag', async () => {
      assert(/Not shared yet/.test(await d.page.textContent('.fgrid'))); assert.strictEqual(await d.page.locator('.idt .geo-flag').count(), 0); });
    await d.ctx.close();
    const blocked = await newPage(browser, port, { perm: null }); await go(blocked.page, port); await blocked.page.waitForTimeout(2800);
    await t('location already blocked in the browser → we never show the sheet (no nagging)', async () => { assert.strictEqual(await blocked.page.locator('.geo-sheet').count(), 0); });
    await blocked.ctx.close();
    const g = await newPage(browser, port, { grant: true, geo: { bdc: {}, osm: { address: { city: 'Lyon', state: 'Auvergne-Rhône-Alpes', country_code: 'fr' } } }, pos: { latitude: 45.764, longitude: 4.8357 } }); await go(g.page, port);
    await t('geocoder fallback: BigDataCloud empty → OpenStreetMap answer is used (Lyon, France)', async () => {
      await g.page.waitForFunction(() => (window.__updates || []).length > 0, null, { timeout: 9000 }); const u = await g.page.evaluate(() => window.__updates[0]); assert.deepStrictEqual([u.city, u.country_code, u.country], ['Lyon', 'FR', 'France']); });
    await g.ctx.close();
    const s = await newPage(browser, port); await s.page.addInitScript('window.__failSave=true'); await go(s.page, port); await s.page.waitForSelector('.geo-sheet'); await s.ctx.grantPermissions(['geolocation'], { origin: `http://localhost:${port}` }); await s.page.click('[data-a=allow]');
    await t('database not migrated (save fails) → readable error, no crash', async () => {
      await s.page.waitForSelector('.toast', { timeout: 9000 }); assert(/schema\.sql/.test(await s.page.textContent('#toasts'))); assert.deepStrictEqual(s.page.errs, []); });
    await s.ctx.close();
    const w = await newPage(browser, port, { scheme: 'dark', width: 1280, height: 800, grant: true, profile: { country: 'India', country_code: 'IN', city: 'Ludhiana', region: 'Punjab', location_lat: 30.9, location_lng: 75.86, location_updated_at: new Date().toISOString() } }); await go(w.page, port);
    await t('desktop + dark theme render', async () => { await w.page.waitForSelector('.idt .geo-line'); await w.page.screenshot({ path: path.join(OUT, '07-profile-desktop-dark.png') }); assert.deepStrictEqual(w.page.errs, []); });
    await w.ctx.close(); }

  console.log('F. rooms (real userAvatar() extracted from room.js + real flag module)');
  { const { ctx, page } = await newPage(browser, port); await go(page, port);
    const roomSrc = fs.readFileSync(path.join(root, 'room.js'), 'utf8');
    const fnSrc = roomSrc.slice(roomSrc.indexOf('function userAvatar('), roomSrc.indexOf('\n}\n', roomSrc.indexOf('function userAvatar(')) + 3);
    await t('room avatar: flag badge for a member with a country, none without; markup stays valid', async () => {
      const r = await page.evaluate(src => { const esc = Nova.esc, nm = u => u.full_name || u.username || '?', id = 0; const f = new Function('Nova', 'esc', 'nm', 'R', src + '; return userAvatar;')(Nova, esc, nm, null);
        const withC = f({ id: 'a', full_name: 'Asha', country_code: 'IN' }, 42, false, false), none = f({ id: 'b', full_name: 'Bob' }, 42, true, true);
        const d = document.createElement('div'); d.innerHTML = withC + none; return { n: d.querySelectorAll('.uav').length, badges: d.querySelectorAll('.uav .geo-badge').length, first: !!d.querySelector('.uav:first-child .geo-badge'), alt: d.querySelector('.geo-badge img').alt, btnInside: d.querySelectorAll('button .geo-badge').length }; }, fnSrc);
      assert.deepStrictEqual(r, { n: 2, badges: 1, first: true, alt: 'India', btnInside: 1 }); });
    await t('room People row: hidden member → no city/map line; sharing member → "City, State (Country)" + map icon', async () => {
      const r = await page.evaluate(() => [Nova.geo.line({ country_code: 'IN', city: null, region: null, lat: null, lng: null }, { cls: 'sm left' }), Nova.geo.line({ country_code: 'IN', city: 'Ludhiana', region: 'Punjab', location_lat: 30.9, location_lng: 75.86 }, { cls: 'sm left' })]);
      assert.strictEqual(r[0], ''); assert(r[1].includes('Ludhiana, Punjab (India)') && r[1].includes('data-geo-map') && r[1].includes('sm left')); });
    await t('room.js loads the new profile fields from public_profiles and passes members through the geo helpers', async () => {
      assert(/public_profiles'\)\.select\('id,full_name,username,avatar_url,country,country_code,city,region,location_lat,location_lng'\)/.test(roomSrc)); assert(roomSrc.includes("Nova.geo.line(u, { cls: 'sm left' })")); });
    await ctx.close(); }

  console.log('G. location stays up to date; switching Hide Location OFF refreshes immediately');
  const OLD = { country: 'India', country_code: 'IN', city: 'Old Town', region: 'Haryana', location_lat: 29.1, location_lng: 76.1 };
  const flip = (page, on) => page.evaluate(v => { const el = document.querySelector('input[data-k="hideLoc"]'); el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, on);
  { const { ctx, page } = await newPage(browser, port, { grant: true, profile: Object.assign({}, OLD, { location_updated_at: new Date(Date.now() - 36e5).toISOString(), settings: { hideLoc: true } }) });
    await go(page, port); await page.waitForTimeout(3500);
    await t('Hide Location ON: nothing new is collected on a visit (old place kept, stays hidden)', async () => { assert.strictEqual((await page.evaluate(() => window.__updates || [])).length, 0); });
    await page.goto(`http://localhost:${port}/profile.html#settings`); await page.waitForSelector('input[data-k="hideLoc"]');
    await t('switching Hide Location ON does not request the location', async () => { await flip(page, true); await page.waitForTimeout(1500); const ups = await page.evaluate(() => window.__updates || []); assert(ups.some(u => u.settings), 'the setting itself was saved'); assert.strictEqual(ups.filter(u => 'location_lat' in u).length, 0); });
    await t('switching Hide Location OFF refreshes the location immediately (Old Town → Ludhiana) and says so', async () => {
      await flip(page, false); await page.waitForFunction(() => (window.__updates || []).some(u => u.city), null, { timeout: 8000 });
      const u = await page.evaluate(() => window.__updates.find(x => x.city)); assert.deepStrictEqual([u.city, u.region, u.country_code, u.location_lat, u.location_lng], ['Ludhiana', 'Punjab', 'IN', 30.9, 75.86]);
      assert(/Location updated/.test(await page.textContent('#toasts'))); });
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, port, { grant: true, profile: Object.assign({}, OLD, { location_updated_at: new Date(Date.now() - 36e5).toISOString(), settings: {} }) });
    await go(page, port);
    await t('location visible + older than 5 min: refreshed automatically on the visit', async () => {
      await page.waitForFunction(() => (window.__updates || []).length > 0, null, { timeout: 9000 }); assert.strictEqual((await page.evaluate(() => window.__updates[0])).city, 'Ludhiana'); });
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, port, { grant: true, profile: Object.assign({}, OLD, { location_updated_at: new Date(Date.now() - 60e3).toISOString(), settings: {} }) });
    await go(page, port); await page.waitForTimeout(3500);
    await t('updated under 5 minutes ago: not refreshed again (no needless geocoder calls)', async () => { assert.strictEqual((await page.evaluate(() => window.__updates || [])).length, 0); });
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed — screenshots in ${OUT}`); if (bad) process.exit(1);
})();
