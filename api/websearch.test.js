const assert = require('node:assert/strict');
const test = require('node:test');
const { _emptyResultsMessage } = require('./websearch');
const { _renderGoogleDarkSearchPage } = require('./browse');

test('explains which Vercel settings are required when search is not configured', () => {
  const message = _emptyResultsMessage(false, 'not-configured');
  assert.match(message, /GOOGLE_API_KEY/);
  assert.match(message, /GOOGLE_CX/);
  assert.match(message, /redeploy/);
});

test('reports Google authorization failures without exposing the API key', () => {
  const message = _emptyResultsMessage(true, 'forbidden');
  assert.match(message, /Custom Search JSON API/);
  assert.match(message, /GOOGLE_CX/);
  assert.doesNotMatch(message, /key=[^ ]+/);
});

test('reports exhausted Google quota clearly', () => {
  const message = _emptyResultsMessage(true, 'quota');
  assert.match(message, /quota is exhausted/i);
});

test('shows escaped setup guidance instead of a misleading empty-results message', () => {
  const message = '<script>alert(1)</script>';
  const html = _renderGoogleDarkSearchPage({
    query: 'song',
    results: [],
    videoCards: [],
    message
  });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /No results found\. Try another keyword or direct URL\./);
});
