'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const browse = require('./browse.js');

test('preserves website JavaScript and inline handlers in the sandboxed page', () => {
  const html = '<html><head><script src="/app.js"></script><script>window.ready=true;</script></head>' +
    '<body onload="window.ready=true"><noscript>Fallback</noscript><template id="card"><b>Video</b></template></body></html>';
  const output = browse._rewrite(html, 'https://example.com/watch', 'https://nova.example');

  assert.match(output, /<script src="\/app\.js"><\/script>/);
  assert.match(output, /window\.ready=true;/);
  assert.match(output, /onload="window\.ready=true"/);
  assert.match(output, /<noscript>Fallback<\/noscript>/);
  assert.match(output, /<template id="card"><b>Video<\/b><\/template>/);
});

test('retains non-video frames in a restricted sandbox and preserves video add tiles', () => {
  const html = '<iframe src="https://widgets.example/embed"></iframe>' +
    '<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk"></iframe>';
  const output = browse._rewrite(html, 'https://example.com/watch', 'https://nova.example');

  assert.match(output, /<iframe src="https:\/\/widgets\.example\/embed" sandbox="allow-scripts allow-forms"><\/iframe>/);
  assert.match(output, /class="nv-emb" href="#" data-nv-video="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk"/);
});

test('allows site scripts without granting the Nova frame same-origin access', () => {
  const csp = browse._headers('https://nova.example')['Content-Security-Policy'];

  assert.match(csp, /script-src https: 'unsafe-inline' 'unsafe-eval'/);
  assert.match(csp, /sandbox allow-scripts allow-forms/);
  assert.doesNotMatch(csp, /allow-same-origin/);
});
