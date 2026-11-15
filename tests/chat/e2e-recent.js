/* Recent tab: people from watch rooms, row by row, with Add / Accept / Requested / Friend actions */
const { open } = require('./harness');
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) process.exitCode = 1; };
(async () => {
  for (const [w, h, mobile, tag] of [[390, 844, true, 'phone'], [1280, 800, false, 'laptop']]) {
    const t = await open({ w, h, mobile, hash: '#friends' }); const { page, errors } = t;
    await page.evaluate(() => {
      const d = __fake.db, ago = m => new Date(Date.now() - m * 60000).toISOString();
      d.profiles.push({ id: 'u-dan', username: 'dan', full_name: 'Dan Room', avatar_url: null, settings: {} }, { id: 'u-eve', username: 'eve', full_name: 'Eve Room', avatar_url: null, settings: {} });
      d.recent_people = [
        { user_id: __fake.ME, other_id: 'u-dan', room_title: 'Friday movie', last_together: ago(5), times: 2 },
        { user_id: __fake.ME, other_id: 'u-eve', room_title: 'Anime night', last_together: ago(300), times: 1 },
        { user_id: __fake.ME, other_id: 'u-alice', room_title: 'Anime night', last_together: ago(900), times: 1 }
      ];
      d.friendships.push({ user_id: 'u-eve', friend_id: __fake.ME, status: 'pending' });
      location.hash = '#chat'; setTimeout(() => { location.hash = '#friends'; }, 50);
    });
    await page.waitForSelector('.people-row', { timeout: 8000 }); await page.waitForTimeout(400);
    ok(tag + ': rail has Recent, no Friends tab', await page.evaluate(() => !!document.querySelector('[data-people-tab=recent]') && !document.querySelector('[data-people-tab=friends]')));
    ok(tag + ': no bubble stage on the people page', await page.locator('.nbx-stage').count() === 0);
    ok(tag + ': 3 rows, newest first', await page.evaluate(() => [...document.querySelectorAll('.people-row .people-identity small')].filter(s => s.textContent[0] === '@').map(s => s.textContent).join() === '@dan,@eve,@alice'));
    ok(tag + ': room title shown', await page.evaluate(() => /Friday movie/.test(document.querySelector('.people-list').innerText)));
    ok(tag + ': stranger has Add, pending sender has Accept, friend shows Friend', await page.evaluate(() => { const r = [...document.querySelectorAll('.people-row')]; return !!r[0].querySelector('[data-people-add]') && !!r[1].querySelector('[data-people-accept]') && /Friend/.test(r[2].innerText); }));
    await page.click('.people-row [data-people-add]'); await page.waitForTimeout(900);
    ok(tag + ': Add sends a friend request to Dan', await page.evaluate(() => __fake.db.friendships.some(f => f.user_id === __fake.ME && f.friend_id === 'u-dan')));
    await page.evaluate(() => { const f = __fake.db.friendships.find(x => x.friend_id === 'u-dan'); f.status = 'pending'; }); await page.click('[data-people-tab=requests]'); await page.click('[data-people-tab=recent]'); await page.waitForTimeout(700);
    ok(tag + ': pending request shows Requested on the Recent row', await page.locator('.people-row:has-text("Requested")').count() >= 1);
    await page.click('.people-row [data-people-accept]'); await page.waitForTimeout(900);
    ok(tag + ': Accept makes them a friend', await page.evaluate(() => __fake.db.friendships.some(f => f.user_id === 'u-eve' && f.friend_id === __fake.ME && f.status === 'accepted')));
    const real = errors.filter(e => !/Failed to load resource/.test(e)); ok(tag + ': no page errors', real.length === 0);
    await page.context().close();
  }
  process.exit(process.exitCode || 0);
})();
