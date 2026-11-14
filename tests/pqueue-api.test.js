// node tests/pqueue-api.test.js  - /api/youtube?plitems= with a mocked YouTube API
const assert = require('assert');
process.env.YOUTUBE_API_KEY = 'k';
const calls = [];
global.fetch = async (u) => {
  const url = new URL(String(u)); calls.push(url);
  const body = url.pathname.endsWith('/playlistItems') ? {
    items: [
      { snippet: { title: 'Song A', resourceId: { videoId: 'aaaaaaaaaaa' }, videoOwnerChannelTitle: 'Chan', thumbnails: { medium: { url: 'https://i.ytimg.com/a.jpg' } } }, status: { privacyStatus: 'public' } },
      { snippet: { title: 'Private video', resourceId: { videoId: 'bbbbbbbbbbb' } }, status: { privacyStatus: 'private' } },
      { snippet: { title: 'Blocked', resourceId: { videoId: 'ccccccccccc' } }, status: { privacyStatus: 'public' } },
      { snippet: { title: 'Song D', resourceId: { videoId: 'ddddddddddd' } }, status: { privacyStatus: 'public' } }],
    nextPageToken: 'T2', pageInfo: { totalResults: 120 }
  } : { items: [
    { id: 'aaaaaaaaaaa', contentDetails: { duration: 'PT3M5S' }, status: { embeddable: true } },
    { id: 'ccccccccccc', contentDetails: { duration: 'PT1M' }, status: { embeddable: false } },
    { id: 'ddddddddddd', contentDetails: { duration: 'PT1H2M3S' }, status: { embeddable: true } }] };
  return { ok: true, json: async () => body };
};
const h = require('../api/youtube.js');
(async () => {
  let out; const res = { setHeader() {}, end(b) { out = JSON.parse(b); } };
  await h({ query: { plitems: 'PLabcdefghij', pageToken: '' } }, res);
  assert.deepStrictEqual(out.items.map(i => i.id), ['aaaaaaaaaaa', 'ddddddddddd'], 'private + non-embeddable removed');
  assert.strictEqual(out.items[0].dur, '3:05'); assert.strictEqual(out.items[1].dur, '1:02:03');
  assert.strictEqual(out.items[0].channel, 'Chan'); assert.strictEqual(out.next, 'T2'); assert.strictEqual(out.total, 120);
  assert.strictEqual(calls[0].searchParams.get('playlistId'), 'PLabcdefghij');
  console.log('ok - playlist items: filtering, durations, paging');
})().catch(e => { console.error(e); process.exit(1); });
