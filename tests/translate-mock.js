/* Stand-in for the translation endpoint (Google gtx format). Counts requests, records (sl, q). */
const MAP = {
  'Kynki teri maa ne tujhe sikhaya ni ki satna me tera baap road pe milega rave me ni': ['Because your mother taught you that in Satna you will find your father on the road and not in the rave.', 'hi'],
  'Hola, ¿cómo estás?': ['Hello, how are you?', 'es'],
  'मुझे यह वीडियो बहुत पसंद आया': ['I really liked this video', 'hi'],
  'Bonjour tout le monde': ['Hello everyone', 'fr'],
  'こんにちは': ['Hello', 'ja'],
  'Zdravo svima, kako ste danas': ['Hello everyone, how are you today', 'hr'],
};
module.exports = async function mock(target) {
  const state = { n: 0, qs: [], fail: false };
  await target.route('https://translate.googleapis.com/**', route => {
    const u = new URL(route.request().url()), q = u.searchParams.get('q') || '', sl = u.searchParams.get('sl'); state.n++; state.qs.push([sl, q]);
    if (state.fail) return route.fulfill({ status: 500, body: 'x' });
    const hit = MAP[q]; const [t, src] = hit || [q, 'en'];
    route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([[[t, q, null, null, 1]], null, src]) });
  });
  await target.route('https://api.mymemory.translated.net/**', r => r.fulfill({ status: 500, body: 'x' }));
  return state;
};
