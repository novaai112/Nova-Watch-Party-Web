/* Presence/typing/request/archive flows. Run: node tests/chat/e2e-realtime.js (needs playwright) */
const { open } = require('./harness');
const ok = (n, c, extra = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + extra));
(async () => {
  const t = await open({ hash: '#chat/c1' }); const { page, errors } = t;
  await page.waitForSelector('.nc-msg'); await page.waitForTimeout(600);
  // typing + recording indicator from the other person (broadcast)
  await page.evaluate(() => { const ch = NovaChatCore.S.typingChannel; const h = ch._h.find(x => x[0] === 'broadcast'); h[2]({ payload: { u: 'u-alice', k: 'typing' } }); });
  await page.waitForTimeout(200); ok('typing in header', /typing/i.test(await page.locator('#ncHeadStatus').innerText()));
  await page.evaluate(() => { const ch = NovaChatCore.S.typingChannel; ch._h.find(x => x[0] === 'broadcast')[2]({ payload: { u: 'u-alice', k: 'recording_audio' } }); });
  await page.waitForTimeout(200); ok('recording in header', /record/i.test(await page.locator('#ncHeadStatus').innerText()));
  await page.evaluate(() => { const ch = NovaChatCore.S.typingChannel; ch._h.find(x => x[0] === 'broadcast')[2]({ payload: { u: 'u-alice', k: 'idle' } }); }); await page.waitForTimeout(200);
  // read receipts update realtime: other user reads my message m4
  await page.evaluate(() => { const r = __fake.db.message_receipts.find(x => x.message_id === 'm4'); r.read_at = new Date().toISOString(); __fake.emit('message_receipts', 'UPDATE', r); }); await page.waitForTimeout(300);
  ok('read tick', await page.locator('.nc-msg:has-text("Replying to you") .nc-tick.read').count() === 1);
  // message from a stranger lands in Requests with a badge
  await page.evaluate(() => { __fake.db.conversations.push({ id: 'c9', is_group: false }); __fake.db.conversation_members.push({ conversation_id: 'c9', user_id: 'u-me', last_read_at: '1970-01-01T00:00:00Z', request_status: 'pending' }, { conversation_id: 'c9', user_id: 'u-carol', last_read_at: new Date().toISOString(), request_status: 'accepted' }); const row = { id: 'rq1', conversation_id: 'c9', sender_id: 'u-carol', body: 'Hi, can we chat?', mentions: [], attachments: [], created_at: new Date().toISOString(), kind: 'text', client_id: 'rq1' }; __fake.db.chat_messages.push(row); __fake.emit('chat_messages', 'INSERT', row); });
  await page.click('.nc-back').catch(() => {}); await page.evaluate(() => { location.hash = '#chat'; }); await page.waitForTimeout(900);
  ok('request tab badge', (await page.locator('[data-nc-tab=requests] i:not([hidden])').count()) === 1);
  await page.click('[data-nc-tab=requests]'); await page.waitForTimeout(300); ok('request row with actions', await page.locator('.nc-request [data-req=accept]').count() === 1);
  await page.click('.nc-request [data-req=accept]'); await page.waitForTimeout(1200);
  ok('accepted', await page.evaluate(() => __fake.db.conversation_members.find(m => m.conversation_id === 'c9' && m.user_id === 'u-me').request_status === 'accepted'));
  // row menu: archive then unarchive
  await page.evaluate(() => { location.hash = '#chat'; }); await page.waitForTimeout(500); await page.click('[data-nc-tab=chats]');
  await page.locator('.nc-row').first().click({ button: 'right' }); await page.click('.nc-sheet-item:has-text("Archive")'); await page.waitForTimeout(700);
  ok('archived in db', await page.evaluate(() => __fake.db.conversation_members.some(m => m.user_id === 'u-me' && m.archived_at)));
  await page.click('[data-nc-tab=archived]'); await page.waitForTimeout(300); ok('archived tab lists it', await page.locator('#ncList .nc-row').count() === 1);
  // offline banner
  await page.context().setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await page.waitForTimeout(400); ok('offline banner', await page.locator('.nc-conn.offline:visible, .nc-conn:visible').count() >= 1);
  console.log('ERRORS', JSON.stringify(errors.filter(e => !/404|ERR_FAILED/.test(e)))); await t.close();
})();
