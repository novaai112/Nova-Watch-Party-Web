const assert = require('node:assert/strict');
const test = require('node:test');
const { _emptyResultsMessage, searchForRequest } = require('./websearch');
const browseHandler = require('./browse');
const { _renderGoogleDarkSearchPage } = browseHandler;
const { _isYouTubeVideoUrl } = browseHandler;
const { _getInjectedBrowserScript } = browseHandler;

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

test('identifies playable YouTube video and playlist links only', () => {
  assert.equal(_isYouTubeVideoUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ'), true);
  assert.equal(_isYouTubeVideoUrl('https://youtu.be/aqz-KE-bpKQ'), true);
  assert.equal(_isYouTubeVideoUrl('https://www.youtube.com/playlist?list=PL1234567890'), true);
  assert.equal(_isYouTubeVideoUrl('https://www.youtube.com/channel/UC1234567890'), false);
  assert.equal(_isYouTubeVideoUrl('https://youtube.com.example.org/watch?v=aqz-KE-bpKQ'), false);
  assert.equal(_isYouTubeVideoUrl('https://vimeo.com/123456789'), false);
});

test('offers YouTube search results directly for synced room playback', () => {
  const youtube = {
    title: 'Big Buck Bunny',
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    snippet: 'Video result',
    domain: 'youtube.com',
    favicon: '',
    thumbnail: 'https://img.example/video.jpg',
    duration: '10:35',
    source: 'YouTube',
    isVideo: true
  };
  const other = { ...youtube, title: 'Other video', url: 'https://vimeo.com/123456789' };
  const html = _renderGoogleDarkSearchPage({
    engine: 'duckduckgo',
    query: 'Big Buck Bunny',
    results: [youtube, other],
    videoCards: [youtube],
    message: ''
  });

  assert.match(html, /Big Buck Bunny - DuckDuckGo Search/);
  assert.match(html, /data-youtube-video="true" data-video-title="Big Buck Bunny"/);
  assert.match(html, /type: 'NOVA_WEB_VIDEO_PROMPT'/);
  assert.doesNotMatch(html, /data-youtube-video="true" data-video-title="Other video"/);
});

test('keeps injected browser video detection script syntactically valid', () => {
  const wrapped = _getInjectedBrowserScript('https://example.com/watch', { title: '', thumbnail: '', streams: [] });
  const script = wrapped.replace(/^<script>/, '').replace(/<\/script>$/, '');

  assert.match(script, /function isYouTubeVideoUrl/);
  assert.match(script, /NOVA_WEB_VIDEO_PROMPT/);
  assert.doesNotThrow(() => new Function(script));
});

test('forwards Vercel searches to the configured laptop backend using a server-only token', async (t) => {
  const previousUrl = process.env.LOCAL_DDG_BACKEND_URL;
  const previousToken = process.env.DDG_BACKEND_TOKEN;
  const previousFetch = global.fetch;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.LOCAL_DDG_BACKEND_URL;
    else process.env.LOCAL_DDG_BACKEND_URL = previousUrl;
    if (previousToken === undefined) delete process.env.DDG_BACKEND_TOKEN;
    else process.env.DDG_BACKEND_TOKEN = previousToken;
    global.fetch = previousFetch;
  });

  const token = 'secret-token-that-never-goes-to-the-browser';
  process.env.LOCAL_DDG_BACKEND_URL = 'https://tunnel.example/search';
  process.env.DDG_BACKEND_TOKEN = token;
  const payload = { engine: 'duckduckgo', results: [], videoCards: [], message: '' };
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return { ok: true, status: 200, json: async () => payload };
  };

  const result = await searchForRequest('song', 'all', 1);
  const parsedUrl = new URL(requestUrl);
  assert.equal(parsedUrl.searchParams.get('q'), 'song');
  assert.equal(parsedUrl.searchParams.get('tab'), 'all');
  assert.equal(requestOptions.headers.Authorization, `Bearer ${token}`);
  assert.equal(requestOptions.headers['ngrok-skip-browser-warning'], 'true');
  assert.equal(requestOptions.method, undefined);
  assert.deepEqual(result, payload);
});

test('rejects a laptop backend URL that does not target the search endpoint', async (t) => {
  const previousUrl = process.env.LOCAL_DDG_BACKEND_URL;
  const previousToken = process.env.DDG_BACKEND_TOKEN;
  const previousFetch = global.fetch;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.LOCAL_DDG_BACKEND_URL;
    else process.env.LOCAL_DDG_BACKEND_URL = previousUrl;
    if (previousToken === undefined) delete process.env.DDG_BACKEND_TOKEN;
    else process.env.DDG_BACKEND_TOKEN = previousToken;
    global.fetch = previousFetch;
  });

  process.env.LOCAL_DDG_BACKEND_URL = 'https://tunnel.example/not-search';
  process.env.DDG_BACKEND_TOKEN = 'secret-token';
  global.fetch = async () => {
    throw new Error('fetch should not be called for an invalid endpoint');
  };

  await assert.rejects(
    searchForRequest('song', 'all', 1),
    /LOCAL_DDG_BACKEND_URL to be an HTTPS URL ending in \/search/
  );
});

test('renders laptop DuckDuckGo results in the Nova browse page without exposing the token', async (t) => {
  const previousUrl = process.env.LOCAL_DDG_BACKEND_URL;
  const previousToken = process.env.DDG_BACKEND_TOKEN;
  const previousFetch = global.fetch;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.LOCAL_DDG_BACKEND_URL;
    else process.env.LOCAL_DDG_BACKEND_URL = previousUrl;
    if (previousToken === undefined) delete process.env.DDG_BACKEND_TOKEN;
    else process.env.DDG_BACKEND_TOKEN = previousToken;
    global.fetch = previousFetch;
  });

  const token = 'secret-token-that-must-not-be-in-page-html';
  const result = {
    title: 'Example video',
    url: 'https://videos.example/watch',
    snippet: 'Video result',
    domain: 'videos.example',
    favicon: '',
    thumbnail: '',
    duration: '',
    source: 'videos.example',
    isVideo: true
  };
  process.env.LOCAL_DDG_BACKEND_URL = 'https://tunnel.example/search';
  process.env.DDG_BACKEND_TOKEN = token;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      engine: 'duckduckgo',
      query: 'example',
      tab: 'all',
      results: [result],
      videoCards: [result],
      message: ''
    })
  });

  const res = {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
  await browseHandler({
    method: 'GET',
    url: '/api/browse?q=example',
    headers: { host: 'localhost' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Example video/);
  assert.doesNotMatch(res.body, new RegExp(token));
});
