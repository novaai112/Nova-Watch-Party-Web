/* nsfw-detect.js — layered adult-content (18+) detector, shared by the browser (Nova Home cards) and the server
   (api/nsfw-check.js).  One media object in, one verdict out:

     NsfwDetect.assess(media)  -> { nsfw: boolean, score: number, reasons: string[] }       (instant, offline)
     NsfwDetect.verdict(media) -> true | false | null   (cache or instant hit; null = not decided yet)   [browser]
     NsfwDetect.resolve(media) -> Promise<boolean>      (instant check, then the deep server check)       [browser]

   Layers (a video is NSFW when the score reaches THRESHOLD):
     1. explicit flags       media.nsfw, age_limit >= 18, ageRestricted (YouTube contentRating), rating = adult / RTA / mature   -> 10
     2. adult sites          the video link, thumbnail or a link hidden inside a proxy URL is on a known adult site / CDN / adult TLD -> 10
     3. address words        porn / xxx / hentai … as a word in the host name or the path                                          -> 3
     4. title words          strong terms (3 each), mature terms (2), weak terms (1 each, only counted once per term)
   Word matching is on whole words, so Essex, Sussex, sextant, Scunthorpe, popcorn, "Adult Swim", "Sex Education",
   "XXXTENTACION" and YouTube ids that merely contain "xxx" are never flagged. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NsfwDetect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const THRESHOLD = 3;

  /* ---------- layer 2: adult sites, CDNs and TLDs (matched on a whole host-name suffix) ---------- */
  const SITES = ('pornhub.com pornhub.org phncdn.com pornhubpremium.com xvideos.com xvideos2.com xvideos-cdn.com xvideos.es xnxx.com xnxx.tv xnxx-cdn.com ' +
    'xhamster.com xhamster.desi xhamster2.com xhamster3.com xhcdn.com xhamsterlive.com spankbang.com sb-cd.com eporner.com redtube.com rdtcdn.com youporn.com ypncdn.com ' +
    'tube8.com beeg.com tnaflix.com thumbzilla.com porn.com pornone.com pornone.org motherless.com chaturbate.com stripchat.com bongacams.com cam4.com livejasmin.com ' +
    'camsoda.com myfreecams.com onlyfans.com fansly.com manyvids.com clips4sale.com rule34.xxx rule34.us e-hentai.org exhentai.org nhentai.net nhentai.to hanime.tv ' +
    'hentaihaven.xxx hentaihaven.com hentaigasm.com hentai.tv hentaistream.com hitomi.la txxx.com hclips.com hdzog.com upornia.com porntrex.com sxyprn.com erome.com ' +
    'hqporner.com daftsex.com vporn.com 4tube.com drtuber.com sunporno.com nuvid.com fuq.com fapello.com fapello.is pornpics.com brazzers.com realitykings.com ' +
    'bangbros.com naughtyamerica.com nubiles.net mofos.com teamskeet.com porntube.com youjizz.com slutload.com xtube.com heavy-r.com redgifs.com thothub.to ' +
    'camwhores.tv cumlouder.com xmoviesforyou.com fullporner.com pornktube.com pornhat.com eroprofile.com sex.com lewdgames.com ixxx.com 3movs.com hotmovs.com ' +
    'fxggxt.com tubegalore.com yespornplease.com xfreehd.com anyporn.com analdin.com pornzog.com tubxporn.com bellesa.co faphouse.com javhd.com jav.guru ' +
    'missav.com missav.ws supjav.com njav.tv spankwire.com keezmovies.com extremetube.com pornerbros.com gotporn.com porndig.com vjav.com pornflip.com').split(' ');
  const SITE_SET = new Set(SITES);
  const ADULT_TLD = /\.(xxx|porn|sex|adult|sexy)$/i;

  const isAdultHost = h => {
    h = String(h || '').toLowerCase().replace(/\.$/, '');
    if (!h) return '';
    if (ADULT_TLD.test(h)) return h;
    const p = h.split('.');
    for (let i = 0; i < p.length - 1; i++) if (SITE_SET.has(p.slice(i).join('.'))) return h;
    return '';
  };
  /* a host or path "word": tokens split on . - _ / and digits; whole tokens only */
  const WORD_URL = new Set(['porn', 'porno', 'pornos', 'xxx', 'hentai', 'nsfw', 'nude', 'nudes', 'nudity', 'milf', 'camgirl', 'camgirls', 'camwhore', 'hardcore', 'blowjob', 'handjob',
    'creampie', 'gangbang', 'bukkake', 'fetish', 'erotic', 'erotica', 'xvideos', 'pornhub', 'xnxx', 'xhamster', 'redtube', 'youporn', 'onlyfans', 'sexcam', 'sexcams', 'sextape', 'sexvideo',
    'sexvideos', 'sexmovies', 'adultvideo', 'adultvideos', 'pornstar', 'pornstars', 'rule34', 'ecchi', 'doujin', 'doujinshi', 'jav']);
  /* "porn" inside a longer host word such as best-porn-tube / freepornvideos / sexcams */
  const HOST_CONTAINS = /(?:porn|xxx|hentai|xvideos|xnxx|xhamster|sexcam|sextube|fuckvid|camgirl)/i;

  /* ---------- layer 4: words in the title / channel / description ---------- */
  const STRONG = [
    /\bp[o0]rn(?:o|s|hub|star|stars|ography|ographic)?\b/i, /\bpr0n\b/i, /\bp\*rn\b/i, /\bx{3,}\b/i, /\bhentai\b/i, /\bxvideos?\b/i, /\bxnxx\b/i, /\bxhamster\b/i, /\bonlyfans\b/i, /\bfansly\b/i,
    /\bnsfw\b/i, /\b18\s*\+(?=\s|$|\W)/i, /\badult\s+(?:film|films|video|videos|movie|movies|content|site|only|entertainment|cam)\b/i,
    /\bblow\s?jobs?\b/i, /\bhand\s?jobs?\b/i, /\bcream\s?pies?\b/i, /\bgang\s?bangs?\b/i, /\bbukkake\b/i, /\bmilfs?\b/i, /\borgasms?\b/i, /\bcum\s?shots?\b/i, /\bfacials?\s+cumshot\b/i,
    /\b(?:anal|oral)\s+sex\b/i, /\bsex\s+(?:scene|scenes|video|videos|clip|clips|movie|movies|cam|chat|show)\b/i, /\bhardcore\s+sex\b/i, /\bfull\s+sex\b/i, /\bcam\s?(?:girl|girls|model|models|show)\b/i,
    /\bstrip\s?tease\b/i, /\blap\s?dance\b/i, /\bporn\s?star\b/i, /\bescort\s+(?:girl|girls|service)\b/i, /\bwebcam\s+sex\b/i, /\bdeepthroat\b/i, /\bthreesome\b/i,
    /порно|секс\s?видео|эротик|порнуха/i, /pornograf[ií]a|pornogr[aá]fic[oa]|v[ií]deos?\s+porno/i, /\bpornographie\b|\bfilm\s+x\b/i, /\bchudai\b|\bdesi\s+(?:sex|xxx|bhabhi\s+sex)\b|\bbhabhi\s+sex\b/i,
    /色情|成人影片|成人视频|無碼|无码|ポルノ|エロ動画|アダルト(?:動画|ビデオ)|야동|포르노/, /إباحي|اباحي|سكس|\bsex\s+arab/i
  ];
  const STRONG_TAG = [['porn', /p[o0]rn|pr0n|p\*rn|порно|pornograf|pornogr[aá]f|色情|ポルノ|포르노|야동|إباحي|اباحي|pornographie/i], ['adult-site', /\bx{3,}\b|xvideos?|xnxx|xhamster|onlyfans|fansly|chudai|エロ|アダルト/i]];
  /* terms that are explicit on their own but not enough alone (2 points) */
  const MATURE = [/\bnude\b/i, /\bnudes\b/i, /\bnaked\b/i, /\btopless\b/i, /\bnudity\b/i, /\berotic(?:a)?\b/i, /\bfetish\b/i, /\bsex\s?tape\b/i, /\bhorny\b/i, /\bkinky\b/i, /\bnipples?\b/i,
    /\bbdsm\b/i, /\bsquirt(?:ing)?\b/i, /\bboobs\b/i, /\btits\b/i, /\bpussy\b/i, /\bdicks?\b/i, /\bcocks?\b/i, /\bnaughty\s+(?:girls?|videos?|milf)\b/i, /\bleaked\s+(?:nudes?|video|videos|mms)\b/i, /\bmms\s+(?:video|viral|leaked)\b/i];
  /* 1 point each, once per term: harmless alone ("Sexy Back", "Sex Education", "Sex and the City") */
  const WEAK = [/\bsexy\b/i, /\bsex\b/i, /\bhot\s+(?:girls?|babes?|models?|aunty|bhabhi)\b/i, /\blingerie\b/i, /\bbikini\b/i, /\bseduc(?:e|tive|tion)\b/i, /\bsteamy\b/i, /\bintimate\b/i, /\bsensual\b/i,
    /\bbabe\b/i, /\bleaked\b/i, /\buncensored\b/i, /\bunrated\b/i, /\buncut\b/i, /\bviral\s+video\b/i, /\bbed\s?scene\b/i, /\bromance\s+scene\b/i, /\bmature\b/i, /\bgirlfriend\s+leak/i, /\bonlyfan\b/i, /\bsugar\s+(?:baby|daddy)\b/i];
  /* a word that makes the weak terms mean something else (lessons, news, medicine) */
  const SAFE_CONTEXT = /\b(?:education|educational|lecture|lesson|health|doctor|cancer|awareness|news|police|court|trial|abuse\s+awareness|documentary\s+on|school\s+nurse|biology|reproductive)\b/i;

  /* ---------- helpers ---------- */
  const str = v => (v === undefined || v === null) ? '' : String(v);
  const norm = s => str(s).normalize ? str(s).normalize('NFKC') : str(s);
  const safeDecode = s => { let o = str(s); for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(o); if (d === o) break; o = d; } catch (e) { break; } } return o; };
  const hostsIn = text => {
    const out = [];
    const re = /(?:https?:)?\/\/([a-z0-9][a-z0-9.\-]*\.[a-z]{2,})/gi; let m;
    while ((m = re.exec(text))) out.push(m[1].toLowerCase());
    return out;
  };
  const urlParts = u => {
    u = str(u).trim(); if (!u) return null;
    try { const x = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u); return { host: x.hostname.toLowerCase(), path: safeDecode(x.pathname), full: safeDecode(u) }; }
    catch (e) { return { host: '', path: '', full: safeDecode(u) }; }
  };
  const tokens = s => str(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const RATING_ADULT = /^(?:adult|adults?\s+only|mature|mature\s*17\+?|explicit|18\+?|rta-5042-1996-1400-1577-rta|x|xxx|nc-?17|tv-?ma|restricted|r18|r-18|18\+ only|pornography|porn)$/i;

  /* ---------- the instant checks ---------- */
  function assess(m) {
    const reasons = []; let score = 0;
    const add = (n, why) => { score += n; reasons.push(why); };
    if (!m || typeof m !== 'object') return { nsfw: false, score: 0, reasons };

    /* layer 1: explicit flags */
    if (m.nsfw === true || m.nsfw === 'true' || m.adult === true || m.isAdult === true) add(10, 'flag');
    const age = Number(m.age_limit !== undefined ? m.age_limit : m.ageLimit);
    if (age >= 18) add(10, 'age-limit');
    if (m.ageRestricted === true || m.age_restricted === true || /ytAgeRestricted/i.test(str(m.contentRating))) add(10, 'age-restricted');
    if (m.rating !== undefined && RATING_ADULT.test(str(m.rating).trim())) add(10, 'rating');
    if (m.rta === true) add(10, 'rta-label');

    /* layer 2 + 3: where the video lives (video link, picture, a link hidden in a proxy URL) */
    let siteHit = '';
    const urlWords = new Set();
    [m.url, m.thumb, m.thumbnail, m.pageUrl, m.referrer, m.streamUrl].forEach(u => {
      const p = urlParts(u); if (!p) return;
      const hosts = [p.host].concat(hostsIn(p.full)).concat(hostsIn(safeDecode(p.full)));
      for (const h of hosts) { const a = isAdultHost(h); if (a && !siteHit) siteHit = a; }
      if (!siteHit && p.host && HOST_CONTAINS.test(p.host.replace(/^www\./, '')) && !/^(?:www\.)?(?:youtube|youtu|vimeo|twitch)\./.test(p.host)) siteHit = p.host;
      tokens(p.host + ' ' + p.path).forEach(t => { if (WORD_URL.has(t)) urlWords.add(t); });
      tokens(p.full.replace(/^https?:\/\/[^/]+/i, '')).forEach(t => { if (WORD_URL.has(t) && t !== 'jav') urlWords.add(t); });
    });
    if (siteHit) add(10, 'adult-site:' + siteHit);
    const strongUrlWords = [...urlWords].filter(t => !['nude', 'nudes', 'nudity', 'erotic', 'erotica', 'fetish', 'jav', 'ecchi', 'doujin', 'doujinshi', 'hardcore'].includes(t));
    if (strongUrlWords.length) add(3, 'url-word:' + strongUrlWords[0]);
    else if (urlWords.size) add(2, 'url-word:' + [...urlWords][0]);

    /* layer 4: text */
    const text = norm([m.title, m.channel, m.author, m.description, m.keywords, Array.isArray(m.tags) ? m.tags.join(' ') : m.tags, m.siteName].map(str).join(' \n '));
    if (text.trim()) {
      let tScore = 0; const tags = [];
      let strongHit = false;
      STRONG.forEach(re => { if (re.test(text)) strongHit = true; });
      if (strongHit) {
        tScore += 3;
        const tag = STRONG_TAG.find(t => t[1].test(text));
        tags.push(tag ? tag[0] : 'explicit');
      }
      let mature = 0, weak = 0;
      MATURE.forEach(re => { if (re.test(text)) mature++; });
      WEAK.forEach(re => { if (re.test(text)) weak++; });
      if (!strongHit && mature) { tScore += Math.min(mature, 2) * 2; tags.push('mature'); }
      else if (strongHit && mature) { tScore += 1; tags.push('explicit'); }
      if (weak) { tScore += weak; tags.push('weak'); }
      /* an educational / news context cancels the weak and mature terms (never the strong ones) */
      if (!strongHit && SAFE_CONTEXT.test(text)) tScore = Math.min(tScore, 2);
      if (tScore) add(tScore, 'words:' + tags.join('+'));
    }

    /* score of weak-only evidence never reaches the threshold on its own */
    return { nsfw: score >= THRESHOLD, score, reasons };
  }

  /* ---------- browser: cache + deep server check ---------- */
  const api = { assess, THRESHOLD, isAdultHost };
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const KEY = 'nova_nsfw_v1';
    const TTL_YES = 14 * 864e5, TTL_NO = 2 * 864e5;
    const mem = new Map(), pending = new Map();
    let store = null;
    const load = () => { if (store) return store; try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { store = {}; } return store; };
    let saveT = 0;
    const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { const s = load(), keys = Object.keys(s); if (keys.length > 400) keys.sort((a, b) => s[a].t - s[b].t).slice(0, keys.length - 300).forEach(k => delete s[k]); localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }, 400); };
    const keyOf = m => m ? [m.kind || '', m.id || '', m.pl || '', str(m.url).split('#')[0]].join('|') : '';
    const cached = k => {
      if (mem.has(k)) return mem.get(k);
      const e = load()[k]; if (!e) return null;
      if (Date.now() - e.t > (e.v ? TTL_YES : TTL_NO)) return null;
      mem.set(k, !!e.v); return !!e.v;
    };
    const put = (k, v) => { mem.set(k, v); load()[k] = { v: v ? 1 : 0, t: Date.now() }; save(); };
    const listeners = [];

    /* true / false from the cache or the instant checks; null = still has to be checked on the server */
    api.verdict = m => {
      if (!m) return false;
      const k = keyOf(m), c = cached(k); if (c !== null) return c;
      if (assess(m).nsfw) { put(k, true); return true; }
      return null;
    };
    /* what can still be looked into: a web page (server), a YouTube id (server) or the thumbnail picture (in this browser) */
    const DIRECT = /\.(?:mp4|m3u8|webm|ogg|mov)(?:$|[?#])|(?:^|\.)twimg\.com$/i;
    const canPage = m => !!m && m.kind !== 'youtube' && /^https:\/\//i.test(str(m.url)) && m.provider !== 'drive' && m.provider !== 'twitch' && m.provider !== 'x' &&
      !(DIRECT.test(str(m.url).split('#')[0]) || (urlParts(m.url) && DIRECT.test(urlParts(m.url).host)));
    const canImage = m => !!m && m.kind !== 'youtube' && /^https:\/\/[^\s]+$/i.test(str(m.thumb)) && !!api.imageCheck;
    api.needsDeepCheck = m => !!m && ((m.kind === 'youtube' && !!m.id) || canPage(m) || canImage(m));

    /* picture check: an on-device classifier (TensorFlow.js + NSFWJS, loaded on demand from a CDN) looks at the thumbnail.
       Catches videos whose title and address say nothing (a person's name on X, a bare .mp4 link). Nothing is uploaded:
       the picture is only drawn in this browser. If the libraries cannot load, the check is skipped and retried later. */
    api.imageCheck = true;
    const LIBS = ['https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js', 'https://cdn.jsdelivr.net/npm/nsfwjs@4.2.0/dist/browser/nsfwjs.min.js'];
    const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('lib')); document.head.appendChild(s); });
    let modelP = null, modelFailAt = 0, imgChain = Promise.resolve();
    const loadModel = () => {
      if (modelP) return modelP;
      if (Date.now() - modelFailAt < 5 * 60e3) return Promise.reject(new Error('model-backoff'));
      modelP = (async () => {
        if (!window.tf) await loadScript(LIBS[0]);
        if (!window.nsfwjs) await loadScript(LIBS[1]);
        return await window.nsfwjs.load();
      })().catch(e => { modelP = null; modelFailAt = Date.now(); throw e; });
      return modelP;
    };
    const loadImg = url => new Promise((res, rej) => {
      const im = new Image(), t = setTimeout(() => rej(new Error('img-timeout')), 9000);
      im.crossOrigin = 'anonymous'; im.referrerPolicy = 'no-referrer'; im.decoding = 'async';
      im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); rej(new Error('img')); };
      im.src = url;
    });
    /* -> true / false, or null when the picture could not be checked */
    api.classifyImage = url => {
      const job = imgChain.then(async () => {
        try {
          const [model, im] = await Promise.all([loadModel(), loadImg(url)]);
          const out = await model.classify(im, 5), p = {};
          out.forEach(o => { p[o.className] = o.probability; });
          const x = (p.Porn || 0) + (p.Hentai || 0), sexy = p.Sexy || 0;
          return x >= 0.55 || (x >= 0.3 && sexy >= 0.4) || sexy >= 0.9;
        } catch (e) { return null; }
      });
      imgChain = job.then(() => 0, () => 0);
      return job;
    };
    const token = async () => { try { const s = await Nova.sb.auth.getSession(); return (s && s.data && s.data.session && s.data.session.access_token) || ''; } catch (e) { return ''; } };
    const getJson = async (url, auth) => {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
      try { const r = await fetch(url, { headers: auth ? { Authorization: 'Bearer ' + auth } : {}, signal: ctl.signal }); if (!r.ok) throw new Error('http'); return await r.json(); }
      finally { clearTimeout(t); }
    };
    api.resolve = m => {
      const first = api.verdict(m);
      if (first !== null) return Promise.resolve(first);
      const k = keyOf(m);
      if (pending.has(k)) return pending.get(k);
      const job = (async () => {
        let yes = false, answered = false;
        try {
          if (m.kind === 'youtube' && m.id) {
            const j = await getJson('/api/youtube?id=' + encodeURIComponent(m.id));
            answered = true;
            yes = assess(Object.assign({}, m, { ageRestricted: !!j.ageRestricted, title: [m.title, j.title].join(' '), channel: j.channel, description: j.description, tags: j.tags })).nsfw;
          } else if (canPage(m)) {
            const j = await getJson('/api/nsfw-check?url=' + encodeURIComponent(m.url), await token());
            answered = !j.unchecked; yes = !!j.nsfw;
          }
          if (!yes && canImage(m)) {
            const r = await api.classifyImage(m.thumb);
            if (r !== null) { answered = true; yes = r; }
          }
        } catch (e) { /* offline / not signed in / API not deployed: stay "not flagged", try again next session */ }
        if (answered) put(k, yes);
        pending.delete(k);
        if (yes) listeners.slice().forEach(fn => { try { fn(m, true); } catch (e) {} });
        return yes;
      })();
      pending.set(k, job);
      return job;
    };
    api.onFlag = fn => { listeners.push(fn); };
    api.keyOf = keyOf;
  }
  return api;
});
