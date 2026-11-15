/* /api/nsfw-check?url=<https link>  ->  { nsfw: boolean, score, reasons }
   Deep adult-content check for Nova Home room cards. Opens the page behind a web video link and looks at
   what the site itself says about it, then runs the shared detector (nsfw-detect.js) over it:
     - the "RTA" adult label and <meta name="rating"> / age-rating / og:restrictions:age (18+) tags
     - schema.org isFamilyFriendly:false and "contentRating" in the page's JSON-LD
     - the page title, description, keywords, tags, site name and the final address after redirects
   Same rules as /api/link-preview: signed-in users only, private / internal addresses are refused (SSRF),
   small pages only, results cached for a day. A page that cannot be opened is simply "not flagged". */
const detect = require('../nsfw-detect.js');
const { verifyUser, fetchHtml, metaContent, decode, send } = require('./link-preview')._internal;

const cache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;

function pageSignals(html, pageUrl) {
  const head = html.slice(0, 250000);
  const m = { kind: 'web', url: pageUrl };
  m.title = metaContent(head, ['og:title', 'twitter:title']) || decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  m.description = metaContent(head, ['og:description', 'twitter:description', 'description']);
  m.keywords = [metaContent(head, ['keywords', 'news_keywords']), metaContent(head, ['og:video:tag', 'video:tag', 'article:tag'])].filter(Boolean).join(' ');
  m.siteName = metaContent(head, ['og:site_name', 'application-name']);
  const thumb = metaContent(head, ['og:image', 'twitter:image']);
  if (thumb) m.thumb = thumb;
  /* explicit adult labels */
  const rating = metaContent(head, ['rating', 'content-rating', 'contentrating', 'age-rating', 'agerating', 'audience', 'rating-adult']);
  if (rating) m.rating = rating.trim();
  if (/RTA-5042-1996-1400-1577-RTA/i.test(head)) m.rta = true;
  const restrict = metaContent(head, ['og:restrictions:age', 'restrictions:age', 'age-restriction']);
  if (/^(?:1[89]|2[01])\+?$/.test(restrict.trim())) m.age_limit = 18;
  if (/\b(?:adult|explicit|porn)\b/i.test(metaContent(head, ['adult', 'is_adult', 'isadult']) || '') || /^(?:true|1|yes)$/i.test(metaContent(head, ['adult', 'is_adult', 'isadult']))) m.nsfw = true;
  for (const block of head.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    if (/"isFamilyFriendly"\s*:\s*(?:false|"false")/i.test(body)) m.nsfw = true;
    if (/"contentRating"\s*:\s*"(?:adult|mature|explicit|18\+?|X|XXX|NC-17|TV-MA|RTA[^"]*)"/i.test(body)) m.nsfw = true;
  }
  return m;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Method not allowed' }); }
  const auth = await verifyUser(req);
  if (!auth.ok) return send(res, auth.status, { error: auth.error });
  let target;
  try { target = new URL(new URL(req.url, 'http://x').searchParams.get('url') || ''); }
  catch { return send(res, 400, { error: 'Invalid link.' }); }
  if (!/^https?:$/.test(target.protocol)) return send(res, 400, { error: 'Invalid link.' });
  const hit = cache.get(target.href);
  if (hit && Date.now() - hit.at < CACHE_MS) return send(res, 200, hit.data);

  /* the address alone can already decide it — no need to open the page */
  let data = detect.assess({ kind: 'web', url: target.href });
  if (!data.nsfw) {
    try {
      const { html, url } = await fetchHtml(target.href);
      data = detect.assess(Object.assign(pageSignals(html, url), { pageUrl: target.href }));
    } catch (error) {
      if (error && error.message === 'blocked') return send(res, 400, { error: 'This link cannot be checked.' });
      /* unreachable / not a web page (direct video file): fall back to the address verdict, do not cache the failure for long */
      return send(res, 200, { nsfw: false, score: data.score, reasons: data.reasons, unchecked: true });
    }
  }
  const out = { nsfw: data.nsfw, score: data.score, reasons: data.reasons };
  if (cache.size > 800) cache.delete(cache.keys().next().value);
  cache.set(target.href, { at: Date.now(), data: out });
  return send(res, 200, out);
};
module.exports._test = { pageSignals };
