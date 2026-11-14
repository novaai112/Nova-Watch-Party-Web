/* Unit checks for Nova Chat helpers: rich text, links, SSRF guard. Run: node tests/chat-rich.test.js */
const assert = require('assert');
const R = require('../nova-chat-rich.js'); let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
ok('bold/italic/strike/mono render', () => { const h = R.render('*b* _i_ ~s~ `m`'); assert(/<(b|strong)>b</.test(h) && /<(i|em)>i</.test(h) && /<(s|del|strike)[ >]/.test(h) && /nc-mono|<code/.test(h)); });
ok('html is escaped', () => assert(!/<script/i.test(R.render('<script>alert(1)</script>'))));
ok('links detected and trimmed', () => { const l = R.extractLinks('see *https://example.com/a.* now'); assert.strictEqual((l[0].url || l[0]), 'https://example.com/a'); });
ok('unsafe hrefs refused', () => assert(!R.safeHref('javascript:alert(1)')));
ok('emoji-only count', () => assert.strictEqual(R.emojiOnlyCount('😂😂'), 2));
const lp = require('../api/link-preview.js')._test;
ok('private IPs blocked', () => { for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert(lp.isPrivateIp(ip), ip); assert(!lp.isPrivateIp('93.184.216.34')); });
ok('og preview parsed', () => { const p = lp.parsePreview('<head><meta property="og:title" content="T &amp; U"><meta property="og:image" content="/i.png"></head>', 'https://x.test/p'); assert.strictEqual(p.title, 'T & U'); assert.strictEqual(p.image, 'https://x.test/i.png'); });
console.log(`\n${n} checks passed`);
