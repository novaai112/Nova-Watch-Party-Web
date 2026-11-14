const { open } = require('./harness'); const fs = require('fs');
const ok = (n, c, extra = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + extra));
(async () => {
  const t = await open({ hash: '#chat/c1', mobile: false, w: 1100, h: 800 }); const { page, errors } = t;
  await page.waitForSelector('.nc-msg'); await page.waitForTimeout(600);
  // document send
  fs.writeFileSync(require('os').tmpdir() + '/report.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 65)]));
  await page.setInputFiles('#chatDocuments', require('os').tmpdir() + '/report.pdf'); await page.waitForTimeout(1500);
  ok('doc bubble', await page.locator('.nc-msg.mine .nc-file:has-text("report.pdf")').count() === 1);
  ok('doc upload path', await page.evaluate(() => (__fake.uploads || []).some(p => /^c1\/u-me\/.*\.pdf$/.test(p)) || __fake.db.chat_messages.some(m => (m.attachments || []).some(a => /^c1\/u-me\//.test(a.path || '')))));
  // image send via preview
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'); fs.writeFileSync(require('os').tmpdir() + '/pic.png', png);
  await page.setInputFiles('#chatFiles', require('os').tmpdir() + '/pic.png'); await page.waitForSelector('.nc-preview', { timeout: 5000 }).catch(() => console.log('no preview')); await page.screenshot({ path: 'm1-preview.png' });
  await page.fill('.nc-pv-caption input', 'nice pic'); await page.click('.nc-pv-bar .nc-send, .nc-pv-bar [data-pv-send]').catch(async () => { console.log('send btn?', await page.locator('.nc-pv-bar button').allInnerTexts()); }); await page.waitForTimeout(2000);
  ok('image message', await page.evaluate(() => __fake.db.chat_messages.some(m => m.body === 'nice pic' && (m.attachments || []).some(a => a.kind === 'image'))));
  // voice: tap mic (locked recording) -> record 2s -> send
  await page.click('#ncMic'); await page.waitForTimeout(2200); await page.screenshot({ path: 'm2-recording.png' });
  ok('recording panel', await page.locator('#ncRecPanel .voice-recording-dot').count() === 1);
  await page.click('[data-rec-send]'); await page.waitForTimeout(2500);
  ok('voice sent', await page.evaluate(() => __fake.db.chat_messages.some(m => m.kind === 'voice')), JSON.stringify(await page.evaluate(() => __fake.db.chat_messages.slice(-1))));
  // typing indicator via broadcast
  console.log('ERRORS', JSON.stringify(errors.filter(e => !/404|ERR_FAILED/.test(e))));
  await page.screenshot({ path: 'm3-after.png' }); await t.close();
})();
