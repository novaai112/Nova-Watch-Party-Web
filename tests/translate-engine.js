/* Engine unit checks in a real page: protected tokens, chunking, detection. Run: node tests/translate-engine.js */
const { chromium } = require('playwright'), fs = require('fs'), path = require('path'), assert = require('assert');
(async () => {
  const b = await chromium.launch(), page = await b.newPage(); const reqs = [];
  await page.route('**/*', r => { const u = r.request().url();
    if (u.startsWith('https://translate.googleapis.com')) { const q = new URL(u).searchParams.get('q'); reqs.push(q); return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([[['EN(' + q + ')', q]], null, 'es']) }); }
    return r.abort(); });
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: 'window.supabase={createClient:()=>({auth:{},from:()=>({})})};window.NOVA_CONFIG={SUPABASE_URL:"x",SUPABASE_ANON_KEY:"y"}' });
  await page.addScriptTag({ path: path.join(__dirname, '../nova-core.js') });
  const o = await page.evaluate(async () => {
    const r1 = await Nova.mt.translate('Hola @anvi mira https://x.com/a?b=1 ¿cómo estás? Escríbeme a ana@mail.com\nSegunda línea');
    const r2 = await Nova.mt.translate(('Esta es una frase larga número uno. ').repeat(80));
    return { r1: r1.text, same: r1.same, r2same: r2.same, r2len: r2.text.length,
      elig: ['😂😂', 'https://a.com', '1234', 'ok', '@bob', 'नमस्ते'].map(Nova.mt.eligible),
      eng: ['I think we should watch this one tonight', 'ok', 'lol', 'Kynki teri maa ne tujhe sikhaya ni', 'Hola como estas amigo', 'Bhai kya kar raha hai'].map(Nova.mt.likelyEnglish),
      hing: ['Kynki teri maa ne tujhe sikhaya ni ki satna me tera baap road pe milega rave me ni', 'Bhai kya kar raha hai', 'I will meet you at the mall', 'nahi'].map(Nova.mt.hinglish) };
  });
  console.log(JSON.stringify(o));
  assert.ok(o.r1.includes('@anvi') && o.r1.includes('https://x.com/a?b=1') && o.r1.includes('ana@mail.com') && o.r1.includes('\n'));
  assert.ok(!reqs.some(q => /@anvi|https|ana@mail/.test(q)), 'protected tokens were sent to the translator');
  assert.strictEqual(o.same, false); assert.strictEqual(o.r2same, false);
  assert.ok(Math.max(...reqs.map(x => x.length)) <= 460, 'chunks must stay small');
  assert.deepStrictEqual(o.elig, [false, false, false, true, false, true]);
  assert.deepStrictEqual(o.eng, [true, true, true, false, false, false]);
  assert.deepStrictEqual(o.hing, [true, true, false, true]);
  console.log('engine OK, requests:', reqs.length); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
