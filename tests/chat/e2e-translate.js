/* Inbox chat: Translate / Original button, Auto-translate, errors. Run: node tests/chat/e2e-translate.js */
const { open } = require('./harness'); const mock = require('../translate-mock');
const ok = (n, c, extra = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + extra)); if (!c) process.exitCode = 1; };
const HING = 'Kynki teri maa ne tujhe sikhaya ni ki satna me tera baap road pe milega rave me ni', EN = 'I think we should watch this one tonight';
const row = (id, body, sender = 'u-alice') => ({ id, conversation_id: 'c1', sender_id: sender, body, mentions: [], attachments: [], created_at: new Date().toISOString(), kind: 'text', reply_to: null, client_id: id, edited_at: null, deleted_at: null, forwarded: false });
(async () => {
  const t = await open({ hash: '#chat/c1' }); const { page, errors } = t; const tr = await mock(page);
  await page.waitForSelector('.nc-msg', { timeout: 8000 }); await page.waitForTimeout(500);
  const push = async r => { await page.evaluate(r => { __fake.db.chat_messages.push(r); __fake.emit('chat_messages', 'INSERT', r); }, r); await page.waitForTimeout(250); };
  const msg = id => page.locator(`.nc-msg[data-msg-id="${id}"]`), btn = id => msg(id).locator('.mt-btn'), txt = id => msg(id).locator('.nc-text').innerText();
  await push(row('h1', HING)); await push(row('e1', EN)); await push(row('x1', '😂😂')); await push(row('mine1', HING, 'u-me'));
  ok('incoming Hinglish has a Translate button', await btn('h1').innerText() === 'Translate');
  ok('button is small + dim + no background', await btn('h1').evaluate(e => { const c = getComputedStyle(e); return parseFloat(c.fontSize) <= 13 && parseFloat(c.opacity) < 1 && (c.backgroundColor === 'rgba(0, 0, 0, 0)'); }));
  ok('button sits below the text', await msg('h1').evaluate(m => m.querySelector('.mt-btn').getBoundingClientRect().top >= m.querySelector('.nc-text').getBoundingClientRect().bottom - 1));
  ok('no button on own message / emoji / obvious English', (await btn('mine1').count()) + (await btn('x1').count()) + (await btn('e1').count()) === 0);
  await btn('h1').click(); await page.waitForSelector('.nc-msg[data-msg-id="h1"] .mt-btn:text("Original")');
  ok('Translate -> correct English', /^Because your mother taught you/.test(await txt('h1')));
  ok('Hinglish was sent with source = Hindi', tr.qs.some(x => x[0] === 'hi' && x[1] === HING));
  await btn('h1').click(); await page.waitForSelector('.nc-msg[data-msg-id="h1"] .mt-btn:text("Translate")');
  ok('Original -> sender words, button is Translate again', (await txt('h1')).startsWith('Kynki teri'));
  const n = tr.n; await btn('h1').click(); await page.waitForSelector('.nc-msg[data-msg-id="h1"] .mt-btn:text("Original")');
  ok('translating again is instant (cache)', tr.n === n);
  // other languages
  await push(row('s1', 'Hola, ¿cómo estás?')); await btn('s1').click(); await page.waitForSelector('.nc-msg[data-msg-id="s1"] .mt-btn:text("Original")');
  ok('Spanish -> English', (await txt('s1')).includes('Hello, how are you?'));
  await push(row('j1', 'こんにちは')); await btn('j1').click(); await page.waitForSelector('.nc-msg[data-msg-id="j1"] .mt-btn:text("Original")');
  ok('Japanese -> English', (await txt('j1')).includes('Hello'));
  // Auto-translate
  await page.evaluate(() => Nova.set('translate', true)); await page.waitForTimeout(500);
  await push(row('f1', 'Bonjour tout le monde')); await page.waitForSelector('.nc-msg[data-msg-id="f1"] .mt-btn:text("Original")');
  ok('Auto ON: new message arrives already in English', (await txt('f1')).includes('Hello everyone'));
  await btn('f1').click(); await page.waitForSelector('.nc-msg[data-msg-id="f1"] .mt-btn:text("Translate")'); await page.waitForTimeout(300);
  ok('Auto ON: "Original" on one message is respected', (await txt('f1')).includes('Bonjour'));
  await page.evaluate(() => Nova.set('translate', false)); await page.waitForTimeout(500);
  ok('Auto OFF: manual translations stay, others return to original', (await txt('h1')).includes('Because') && (await btn('s1').innerText()) === 'Original');
  // failure
  tr.fail = true; await push(row('z1', 'Zdravo svima, kako ste danas')); await btn('z1').click(); await page.waitForTimeout(900);
  ok('network failure: error toast, Translate button stays', (await btn('z1').innerText()) === 'Translate' && await page.locator('.toast.err').count() > 0);
  tr.fail = false; await btn('z1').click(); await page.waitForTimeout(700);
  await page.waitForSelector('.nc-msg[data-msg-id="z1"] .mt-btn:text("Original")'); ok('retry works after the network is back', (await txt('z1')).includes('how are you today'));
  // menu entry
  ok('settings sheet source has Auto-translate switch', require('fs').readFileSync(require('path').join(__dirname, '../../nova-chat-sheets.js'), 'utf8').includes('sAutoTr'));
  ok('no page errors', errors.filter(e => !/Failed to load|net::|status of 5/.test(e)).length === 0, JSON.stringify(errors));
  await t.close();
})();
