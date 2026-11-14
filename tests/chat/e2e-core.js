const { open } = require('./harness');
const ok = (n, c, extra = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + extra));
(async () => {
  const t = await open({ hash: '#chat/c1' }); const { page, errors } = t;
  await page.waitForSelector('.nc-msg', { timeout: 8000 }); await page.waitForTimeout(600);
  // send text
  await page.fill('#ncInput', 'Hello *world* from test'); await page.click('[data-nc-send]'); await page.waitForTimeout(700);
  ok('sent text rendered', await page.locator('.nc-msg.mine:has-text("Hello")').count() === 1);
  ok('db insert', await page.evaluate(() => __fake.db.chat_messages.some(m => m.body === 'Hello *world* from test')));
  ok('bold rendered', await page.locator('.nc-msg b:has-text("world")').count() === 1 || await page.locator('.nc-msg strong:has-text("world")').count() === 1);
  // idempotent: no duplicate bubbles after realtime echo
  ok('no dup', await page.locator('.nc-msg:has-text("Hello *world*"), .nc-msg:has-text("Hello world")').count() === 1);
  // incoming realtime message
  await page.evaluate(() => { const row = { id: 'rt1', conversation_id: 'c1', sender_id: 'u-alice', body: 'Realtime hi', mentions: [], attachments: [], created_at: new Date().toISOString(), kind: 'text', reply_to: null, client_id: 'rt1', edited_at: null, deleted_at: null, forwarded: false }; __fake.db.chat_messages.push(row); __fake.emit('chat_messages', 'INSERT', row); });
  await page.waitForTimeout(500); ok('incoming realtime', await page.locator('.nc-msg:has-text("Realtime hi")').count() === 1);
  // typing indicator
  await page.evaluate(() => { const l = document.querySelector('#ncHeadStatus'); });
  // reaction via quick bar
  await page.locator('.nc-msg.theirs:has-text("Realtime hi") .nc-bubble').click({ button: 'right' }); await page.waitForSelector('.nc-quickbar'); await page.click('.nc-quickbar [data-q="👍"]'); await page.waitForTimeout(500);
  ok('reaction added', await page.evaluate(() => __fake.db.message_reactions.some(r => r.message_id === 'rt1' && r.emoji === '👍')));
  ok('reaction chip', await page.locator('.nc-msg:has-text("Realtime hi") .nc-react.mine').count() === 1);
  // reply
  await page.locator('.nc-msg.theirs:has-text("Realtime hi") .nc-bubble').click({ button: 'right' }); await page.click('.nc-sheet-item:has-text("Reply")'); await page.waitForTimeout(300);
  ok('reply ctx', await page.locator('#ncCtx:not([hidden])').count() === 1);
  await page.fill('#ncInput', 'my reply'); await page.click('[data-nc-send]'); await page.waitForTimeout(600);
  ok('reply saved', await page.evaluate(() => __fake.db.chat_messages.some(m => m.body === 'my reply' && m.reply_to === 'rt1')));
  // edit own message
  await page.locator('.nc-msg.mine:has-text("my reply") .nc-bubble').click({ button: 'right' }); await page.click('.nc-sheet-item:has-text("Edit")'); await page.waitForTimeout(400); await page.fill('#ncInput', 'my reply edited'); await page.click('[data-nc-send]'); await page.waitForTimeout(600);
  ok('edited', await page.evaluate(() => __fake.db.chat_messages.some(m => m.body === 'my reply edited' && m.edited_at)));
  ok('edited label', await page.locator('.nc-msg:has-text("my reply edited") em:has-text("edited")').count() === 1);
  // delete for everyone
  await page.locator('.nc-msg.mine:has-text("my reply edited") .nc-bubble').click({ button: 'right' }); await page.click('.nc-sheet-item:has-text("Delete")'); await page.waitForSelector('.nc-sheet-item:has-text("Delete for everyone")'); await page.click('.nc-sheet-item:has-text("Delete for everyone")'); await page.waitForTimeout(700);
  ok('deleted placeholder', await page.locator('.nc-bubble.deleted').count() >= 1);
  // pin
  await page.locator('.nc-msg.theirs:has-text("Realtime hi") .nc-bubble').click({ button: 'right' }); await page.click('.nc-sheet-item:has-text("Pin")'); await page.waitForTimeout(600);
  ok('pinned', await page.evaluate(() => __fake.db.pinned_messages.some(p => p.message_id === 'rt1')));
  // draft persistence
  await page.fill('#ncInput', 'draft text'); await page.waitForTimeout(300);
  await page.click('.nc-back'); await page.waitForTimeout(700);
  ok('draft shown in list', (await page.locator('.nc-row:has-text("Draft:")').count()) === 1);
  // failed send + retry
  await page.locator('.nc-row').first().click(); await page.waitForSelector('#ncInput'); await page.waitForTimeout(500);
  await page.evaluate(() => { __fake.failSend = true; }); await page.fill('#ncInput', 'will fail'); await page.click('[data-nc-send]'); await page.waitForTimeout(800);
  ok('pending state shown', await page.locator('.nc-msg.local').count() === 1);
  await page.evaluate(() => { __fake.failSend = false; const o = NovaChatCore.S.outbox[0]; if (o) { o.retryAt = 0; } NovaChatCore.retryOutbox && o && NovaChatCore.retryOutbox(o.client_id); }); await page.waitForTimeout(1500);
  ok('retry delivered', await page.evaluate(() => __fake.db.chat_messages.some(m => m.body === 'will fail')));
  console.log('ERRORS', JSON.stringify(errors.filter(e => !/404|ERR_FAILED/.test(e))));
  await page.screenshot({ path: require('os').tmpdir() + '/s6.png' });
  await t.close();
})();
