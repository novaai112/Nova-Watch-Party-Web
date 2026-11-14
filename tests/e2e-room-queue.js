// node tests/e2e-room-queue.js  (Playwright) - personal queue panel + playlist import against an in-memory stand-in
// for NovaRoom / the pq_* RPCs. Server rules are covered by tests/room-pqueue-test.sql.
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = path.join(__dirname, '..');
const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>:root{--card:#fff;--tx:#111;--line:#dfe8f0}body{margin:0;font-family:sans-serif}</style>
<link rel=stylesheet href="file://${root}/room-queue.css"><main id=picker><div class=grid></div><section id=pq hidden></section></main>
<script>
var DB={}, ACTIVE={}, ROOM=null, vid=0;
function mk(i){return {id:'v'+String(i).padStart(10,'0'),title:'Video '+i,channel:'Chan',dur:'3:0'+(i%10),thumb:''}}
window.NovaAdd={ytInfo:function(){return Promise.resolve({title:'My Playlist',channel:'Owner'})},ytPlaylistItems:function(pl,t){var s=t?+t:0,all=[];for(var i=1;i<=120;i++)all.push(mk(i));var items=all.slice(s,s+50);return Promise.resolve({items:items,next:s+50<120?String(s+50):''})}};
function rpc(n,a){return new Promise(function(res,rej){setTimeout(function(){try{res(call(n,a))}catch(e){rej(e)}},5)})}
function key(m){return m.id}
function call(n,a){var q=DB[a.p_room]=DB[a.p_room]||[];
 if(n==='pq_list')return {items:q.map(function(x){return {id:x.id,media:x.media}}),active:ACTIVE[a.p_room]||null,mode:'vote'};
 if(n==='pq_add'){var add=0,dup=0;a.p_items.forEach(function(m){if(q.some(function(x){return key(x.media)===key(m)})||(ACTIVE[a.p_room]&&key(ACTIVE[a.p_room].media)===key(m)))dup++;else{add++;q.push({id:'q'+(++vid),media:m})}});return {added:add,duplicates:dup,total:q.length}}
 if(n==='pq_remove'){DB[a.p_room]=q.filter(function(x){return x.id!==a.p_id});return null}
 if(n==='pq_clear'){var c=q.length;DB[a.p_room]=[];return c}
 if(n==='pq_reorder'){q.sort(function(x,y){return a.p_ids.indexOf(x.id)-a.p_ids.indexOf(y.id)});return null}
 if(n==='pq_submit'){if(ACTIVE[a.p_room])throw new Error('Your previous video is still in the vote');var it=q.shift();if(!it)throw new Error('Your queue is empty');ACTIVE[a.p_room]={media:it.media};window.__submitted=(window.__submitted||[]).concat(it.media.id);return {action:'queued',title:it.media.title}}
 throw new Error('unknown '+n)}
window.NovaRoom={ready:true,active:function(){return !!ROOM},roomId:function(){return ROOM},rpc:rpc,api:{toast:function(t){window.__toasts=(window.__toasts||[]).concat(t)}},ctx:function(){return {busy:false}},handle:function(){return Promise.resolve(true)}};
window.enter=function(id){ROOM=id;document.dispatchEvent(new CustomEvent('nova:room',{detail:{id:id}}))};
window.leave=function(){ROOM=null;document.dispatchEvent(new CustomEvent('nova:room',{detail:{id:null}}))};
window.endVote=function(){delete ACTIVE[ROOM]};
</script><script src="file://${root}/room-queue.js"></script>`;
(async () => {
  const f = path.join(require('os').tmpdir(), 'pq-harness.html'); fs.writeFileSync(f, html);
  const b = await chromium.launch(); let fails = 0;
  for (const [name, vp] of [['phone', { width: 390, height: 800 }], ['laptop', { width: 1366, height: 768 }], ['4k', { width: 2560, height: 1440 }]]) {
    const p = await b.newPage({ viewport: vp, hasTouch: name === 'phone' }); p.on('pageerror', e => { console.error('pageerror', e.message); fails++; });
    await p.goto('file://' + f);
    const t = async (label, fn) => { try { await fn(); console.log('ok  -', name, label); } catch (e) { fails++; console.error('FAIL -', name, label, e.message); } };
    await t('hidden outside a room', async () => assert(await p.$eval('#pq', e => e.hidden)));
    await p.evaluate(() => enter('room1')); await p.waitForSelector('.pq-empty');
    await t('shown in a room, empty state', async () => assert(!(await p.$eval('#pq', e => e.hidden))));
    await p.evaluate(() => NovaPQ.importPlaylist({ kind: 'youtube', pl: 'PLabcdefghij', title: 'My Playlist' }));
    await p.waitForFunction(() => document.querySelectorAll('.pqi-row').length === 120);
    await t('import lists all 120 with thumb/title/channel/duration', async () => {
      const r = await p.$eval('.pqi-row', e => ({ t: e.querySelector('b').textContent, c: e.querySelector('small').textContent, d: e.querySelector('em').textContent, th: e.querySelector('.pqi-th').style.backgroundImage }));
      assert(r.t && r.c === 'Chan' && r.d && r.th.includes('ytimg'));
    });
    await p.click('.pqi-row:nth-child(3) button'); await p.waitForSelector('.pqi-row.in');
    await t('single add marks the row', async () => assert.strictEqual(await p.$$eval('.pqi-row.in', e => e.length), 1));
    await p.click('.pqi-all'); await p.waitForFunction(() => /all in your queue/.test(document.querySelector('.pqi-ct').textContent));
    await t('add all skips the duplicate (119 + 1 = 120)', async () => assert.strictEqual(await p.$eval('.pq-n', e => e.textContent), '120'));
    await p.click('.pqi-back');
    await t('import screen closes', async () => assert(!(await p.$('#pqi'))));
    await t('order starts with the single video I added first', async () => assert.strictEqual(await p.$eval('.pq-item .pq-tx b', e => e.textContent), 'Video 3'));
    // keyboard reorder
    await p.focus('.pq-item:nth-child(1) .pq-grip'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80);
    await t('keyboard moves item down', async () => assert.strictEqual(await p.$eval('.pq-item:nth-child(2) .pq-tx b', e => e.textContent), 'Video 3'));
    // drag reorder: first item below the third
    const g = await p.$('.pq-item:nth-child(1) .pq-grip'), box = await g.boundingBox(), h = (await (await p.$('.pq-item')).boundingBox()).height + 6;
    await p.mouse.move(box.x + 10, box.y + 10); await p.mouse.down(); await p.mouse.move(box.x + 10, box.y + 10 + h * 2.2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150);
    await t('drag & drop persists the new order', async () => { const ids = await p.$$eval('.pq-item .pq-tx b', e => e.slice(0, 3).map(x => x.textContent)); assert.deepStrictEqual(ids.slice(2, 3), ['Video 1']); });
    // one at a time
    const first = await p.$eval('.pq-item .pq-tx b', e => e.textContent);
    await p.click('.pq-go'); await p.waitForSelector('.pq-live');
    await t('submits only the FIRST item, in order', async () => assert.deepStrictEqual(await p.evaluate(() => window.__submitted.length), 1));
    await t('next submit is blocked while the vote is open', async () => assert(await p.$eval('.pq-go', e => e.disabled)));
    await p.evaluate(() => endVote()); await p.evaluate(() => NovaPQ.reload()); await p.waitForFunction(() => !document.querySelector('.pq-live'));
    await t('after the vote the next one can be submitted, never automatically', async () => { assert.strictEqual(await p.evaluate(() => window.__submitted.length), 1); assert(!(await p.$eval('.pq-go', e => e.disabled))); });
    // remove + clear
    const n0 = +await p.$eval('.pq-n', e => e.textContent); await p.click('.pq-item:nth-child(2) .pq-rm'); await p.waitForFunction(n => +document.querySelector('.pq-n').textContent === n - 1, n0);
    await t('remove one', async () => assert.strictEqual(+await p.$eval('.pq-n', e => e.textContent), n0 - 1));
    // leave: everything cleaned; rejoin: queue is back
    await p.evaluate(() => leave());
    await t('leave room cleans the panel', async () => { assert(await p.$eval('#pq', e => e.hidden)); assert.strictEqual(await p.$eval('#pq', e => e.innerHTML), ''); });
    await p.evaluate(() => enter('room1')); await p.waitForSelector('.pq-item');
    await t('rejoin restores my pending queue', async () => assert.strictEqual(+await p.$eval('.pq-n', e => e.textContent), n0 - 1));
    await t('other room has its own empty queue', async () => { await p.evaluate(() => enter('room2')); await p.waitForSelector('.pq-empty'); });
    await p.evaluate(() => enter('room1')); await p.waitForSelector('.pq-item');
    p.once('dialog', d => d.accept()); await p.click('[data-a=clear]'); await p.waitForSelector('.pq-empty');
    await t('clear all', async () => assert.strictEqual(await p.$eval('.pq-n', e => e.textContent), '0'));
    await t('no horizontal overflow', async () => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
    await p.close();
  }
  await b.close(); if (fails) { console.error(fails + ' failure(s)'); process.exit(1); } console.log('all e2e checks passed');
})();
