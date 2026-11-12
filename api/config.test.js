const assert = require('node:assert/strict');
const test = require('node:test');
const handler = require('./config');

function invoke(method = 'GET') {
  const headers = {};
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
  handler({ method }, res);
  return { ...res, headers };
}

test('serves configured Supabase client settings as uncached JavaScript', (t) => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_ANON_KEY;
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = oldKey;
  });

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-anon-key';
  const res = invoke();

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.body, /"SUPABASE_URL":"https:\/\/project\.supabase\.co"/);
  assert.match(res.body, /"SUPABASE_ANON_KEY":"public-anon-key"/);
  assert.doesNotMatch(res.body, /GOOGLE_API_KEY|YOUTUBE_API_KEY/);
});

test('reports missing deployment configuration without returning partial credentials', (t) => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_ANON_KEY;
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = oldKey;
  });

  process.env.SUPABASE_URL = 'http://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-anon-key';
  const res = invoke();

  assert.match(res.body, /"SUPABASE_URL":""/);
  assert.match(res.body, /"SUPABASE_ANON_KEY":""/);
  assert.match(res.body, /"CONFIG_ERROR":"Set valid SUPABASE_URL/);
});
