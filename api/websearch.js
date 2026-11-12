/* /api/websearch?q=text — plain web search (DuckDuckGo HTML, no key needed).
   The Web tab shows the results; tapping one runs /api/extract and only a found video is imported. */
const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', code === 200 ? 'public, s-maxage=300' : 'no-store');
  res.end(JSON.stringify(body));
};
const dec = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const text = String(q.q || '').trim().slice(0, 200);
  if (!text) return send(res, 400, { error: 'Type something to search.', results: [] });
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(text), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NovaWatchParty/1.0)', 'Accept-Language': 'en' }
    });
    const html = await r.text(), out = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
    let m;
    while ((m = re.exec(html)) && out.length < 20) {
      let u = m[1].replace(/&amp;/g, '&');
      const g = /[?&]uddg=([^&]+)/.exec(u); if (g) u = decodeURIComponent(g[1]);
      if (u.startsWith('//')) u = 'https:' + u;
      if (!/^https?:\/\//.test(u) || /duckduckgo\.com\/y\.js/.test(u)) continue;
      let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { continue; }
      out.push({ title: dec(m[2]).slice(0, 140), url: u, host, snippet: dec(m[3]).slice(0, 200) });
    }
    if (!out.length) return send(res, 200, { results: [], note: 'No results.' });
    return send(res, 200, { results: out });
  } catch (e) {
    return send(res, 502, { error: 'Web search is unavailable right now. Paste a link instead.', results: [] });
  }
};
