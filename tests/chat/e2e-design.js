const { open } = require('./harness');
const ok = (n, c, extra = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + extra));
const out = process.env.SHOTS || require('os').tmpdir();
(async () => {
  const theme = process.env.THEME || 'light';
  const t = await open({ hash: '#chat' }); const { page, errors } = t;
  await page.route('https://media.test/**', r => {
    const u = r.request().url(), c = /sticker/.test(u) ? '#0000' : '#e0a458';
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" rx="20" fill="${c}"/><circle cx="200" cy="150" r="70" fill="#4f46e5"/></svg>`;
    r.fulfill({ contentType: 'image/svg+xml', body });
  });
  await page.evaluate(th => document.documentElement.setAttribute('data-theme', th), theme);
  await page.waitForSelector('.nc-row'); await page.waitForTimeout(400);
  await page.click('.nc-row'); await page.waitForSelector('.nc-msg'); await page.waitForTimeout(500);
  const info = await page.evaluate(() => { const db = __fake.db, me = Object.keys(db).length && (__fake.ME || db.chat_messages.find(m => m.sender_id)?.sender_id); const c = db.chat_messages[0].conversation_id; return { c, me: U.id }; });
  await page.evaluate(({ c }) => {
    const db = __fake.db, ME = U.id, other = db.chat_messages.find(m => m.sender_id !== ME).sender_id; let n = 0;
    const add = (sender, body, attachments, extra = {}) => { const m = { id: 'x' + (++n), conversation_id: c, sender_id: sender, body, mentions: [], attachments, created_at: new Date(Date.now() - (60 - n) * 1000).toISOString(), kind: 'text', client_id: 'cx' + n, ...extra }; db.chat_messages.push(m); __fake.emit('chat_messages', 'INSERT', m); };
    const img = (u, o = {}) => ({ kind: 'image', url: 'https://media.test/' + u, name: u, type: 'image/svg+xml', ...o });
    add(other, 'Normal text from them', []);
    add(ME, 'Sent text in black card', []);
    add(other, '', [img('unsplash.jpg', { provider: 'unsplash', attribution: { photographer: 'Andrew Small', photographerUrl: 'https://unsplash.com/@a', photoUrl: 'https://unsplash.com/photos/x' } })]);
    add(ME, '', [img('giphy.gif', { gif: true, type: 'image/gif' })]);
    add(other, '', [img('sticker.png', { gif: true, type: 'image/gif' })]);
    add(ME, '😍🔥', []);
    add(other, '😂', []);
    add(ME, '', [img('a.jpg'), img('b.jpg'), img('c.jpg')]);
    add(other, '', [img('a.jpg'), img('b.jpg'), img('c.jpg'), img('d.jpg'), img('e.jpg')]);
    add(ME, 'Caption under the photo', [img('a.jpg')]);
    add(other, '', [{ kind: 'contact', name: 'Ava', contact: { id: 'u-carol', username: 'carol', full_name: 'Carol Stone', avatar_url: '' } }]);
    add(ME, '', [{ kind: 'contact', name: 'Ava', contact: { id: 'u-carol', username: 'carol', full_name: 'Carol Stone', avatar_url: '' } }]);
    add(ME, '', [{ kind: 'file', name: 'report.pdf', type: 'application/pdf', size: 20000, path: 'x/report.pdf' }]);
  }, info);
  await page.waitForTimeout(900);
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.nc-tile.remote img')].map(i => [Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height)]));
  ok('remote previews have size', sizes.length >= 3 && sizes.every(([w, h]) => w > 40 && h > 40), JSON.stringify(sizes));
  const box = await page.evaluate(() => { const a = document.querySelector('.nc-contact .av, .nc-contact img, .nc-contact>:first-child').getBoundingClientRect(); return [a.width, a.height]; });
  ok('contact avatar circle', box[0] === box[1] && box[0] >= 40, JSON.stringify(box));
  const bg = await page.evaluate(() => { const g = el => getComputedStyle(el).backgroundColor; return { sent: g(document.querySelector('.nc-msg.mine .nc-bubble:not(.bare)')), bare: g(document.querySelector('.nc-bubble.bare')), recv: g(document.querySelector('.nc-msg.theirs .nc-bubble:not(.bare)')) }; });
  console.log(JSON.stringify(bg));
  const box2 = page.locator('#ncMsgs'); await page.evaluate(() => { const b = document.querySelector('#ncMsgs'); b.scrollTop = b.scrollHeight; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/d-bottom-${theme}.png` });
  await page.evaluate(() => { const b = document.querySelector('#ncMsgs'); b.scrollTop = 0; });
  await page.waitForTimeout(300); await page.screenshot({ path: `${out}/d-top-${theme}.png` });
  for (const [k, sel] of [['mid1', '.nc-bubble.emoji'], ['mid2', '.nc-grid.n3']]) { await page.locator(sel).first().scrollIntoViewIfNeeded(); await page.evaluate(() => { document.querySelector('#ncMsgs').scrollTop -= 140; }); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/d-${k}-${theme}.png` }); }
  console.log('ERRORS', JSON.stringify(errors.filter(e => !/404|ERR_FAILED/.test(e))));
  await t.close();
})();
