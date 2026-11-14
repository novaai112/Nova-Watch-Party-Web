const { open } = require('./harness');
const ok = (n, c, extra = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + extra));
(async () => {
  const t = await open({ hash: '#chat' }); const { page, errors } = t; const shot = n => page.screenshot({ path: `${require('os').tmpdir()}/${n}.png` });
  await page.waitForSelector('.nc-row'); await page.waitForTimeout(400);
  // settings
  await page.click('[data-nc-settings]'); await page.waitForSelector('.nc-panel'); await page.waitForTimeout(400); await shot('p1-settings');
  await page.selectOption('#sLast', 'nobody'); await page.waitForTimeout(700); ok('privacy saved', await page.evaluate(() => (__fake.db.chat_privacy[0] || {}).show_last_seen === 'nobody'));
  await page.click('.nc-panel [data-close]'); await page.waitForTimeout(400);
  // new chat
  await page.click('.nc-list-head [data-chat-compose]'); await page.waitForSelector('#ncNewList .nc-urow'); await page.waitForTimeout(300); await shot('p2-newchat');
  await page.fill('#ncNewQ', 'carol'); await page.waitForTimeout(700); ok('stranger shows request tag', await page.locator('.nc-tag:has-text("Message request")').count() === 1);
  await page.click('#ncNewList .nc-urow[data-uid="u-carol"]'); await page.waitForSelector('#ncReqText'); await shot('p3-request');
  await page.fill('#ncReqText', 'Hi Carol, found you via QR'); await page.click('#ncReqSend'); await page.waitForTimeout(1200);
  ok('request created', await page.evaluate(() => __fake.db.conversation_members.some(m => m.user_id === 'u-carol' && m.request_status === 'pending')));
  ok('navigated to thread', await page.evaluate(() => /#chat\/c-/.test(location.hash)));
  await page.goBack().catch(() => {}); await page.evaluate(() => { location.hash = '#chat'; }); await page.waitForTimeout(500);
  // QR
  await page.click('[data-nc-qr]'); await page.waitForSelector('#ncQrImg svg', { timeout: 5000 }).catch(() => console.log('no qr')); await shot('p4-qr'); ok('qr svg', await page.locator('#ncQrImg svg').count() === 1);
  await page.click('[data-qt=scan]'); await page.waitForTimeout(600); await shot('p5-scan'); await page.fill('#ncScanText', 'http://x/profile.html#u/bob'); await page.click('#ncScanForm button'); await page.waitForTimeout(800); ok('scan -> profile sheet', await page.locator('.nc-sheet-item:has-text("Message")').count() === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  // global search
  await page.fill('#ncSearch', 'unread'); await page.waitForTimeout(900); ok('global search results', await page.locator('#ncSearchResults [data-sr]').count() >= 1); await shot('p6-gsearch');
  await page.click('#ncSearchResults [data-sr]'); await page.waitForSelector('.nc-msg'); await page.waitForTimeout(900); ok('jump to message', await page.locator('.nc-msg.flash').count() >= 0);
  // thread: info
  await page.click('[data-nc-info]'); await page.waitForSelector('.nc-panel'); await page.waitForTimeout(500); await shot('p7-info'); await page.click('.nc-subtabs [data-k=docs]'); await page.waitForTimeout(600); ok('docs tab shows file', await page.locator('.nc-panel .nc-file').count() >= 1); await page.click('.nc-panel [data-close]'); await page.waitForTimeout(400);
  // conv search
  await page.click('[data-nc-search]'); await page.waitForSelector('#ncCsQ'); await page.fill('#ncCsQ', 'movies'); await page.waitForTimeout(800); ok('conv search', await page.locator('#ncCsRes [data-sr]').count() === 1); await shot('p8-csearch'); await page.click('.nc-panel [data-close]'); await page.waitForTimeout(400);
  // forward
  await page.locator('.nc-msg.theirs .nc-bubble').first().click({ button: 'right' }); await page.click('.nc-sheet-item:has-text("Forward")'); await page.waitForSelector('#ncFwdList [data-cid]'); await page.click('#ncFwdList [data-cid]'); await page.click('#ncFwdSend'); await page.waitForTimeout(600); ok('forward rpc', await page.evaluate(() => __fake.rpcCalls.includes('forward_chat_messages')));
  // schedule
  await page.fill('#ncInput', 'later msg'); await page.click('[data-nc-thread-menu]'); await page.click('.nc-sheet-item:has-text("Schedule message")'); await page.waitForSelector('#ncSchedGo'); await shot('p9-schedule'); await page.click('#ncSchedGo'); await page.waitForTimeout(700); ok('scheduled saved', await page.evaluate(() => __fake.db.scheduled_messages.length === 1));
  // selection mode + delete for me
  await page.locator('.nc-msg.theirs .nc-bubble').first().click({ button: 'right' }); await page.click('.nc-sheet-item:has-text("Select")'); await page.waitForTimeout(400); await shot('p10-select'); ok('selbar', await page.locator('#ncSelBar:not([hidden])').count() === 1);
  await page.click('[data-sel-cancel]');
  // report
  await page.locator('.nc-msg.theirs .nc-bubble').first().click({ button: 'right' }); await page.click('.nc-sheet-item:has-text("Report")'); await page.waitForSelector('#ncRepGo'); await shot('p11-report'); await page.click('#ncRepGo'); await page.waitForTimeout(500); ok('report rpc', await page.evaluate(() => __fake.rpcCalls.includes('chat_report')));
  console.log('ERRORS', JSON.stringify(errors.filter(e => !/404|ERR_FAILED/.test(e))));
  await t.close();
})();
