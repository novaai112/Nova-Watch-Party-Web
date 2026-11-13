const https = require('https');
const http = require('http');
const { URL } = require('url');

function fetchRaw(targetUrl, options = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Too many redirects'));
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(e);
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTMLGum, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }, options.headers || {}),
      timeout: options.timeout || 10000
    };

    const req = lib.request(reqOpts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        res.resume();
        return resolve(fetchRaw(nextUrl, options, redirects - 1));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

async function searchGoogleApi(query, tab = 'all', page = 1) {
  const rawKeys = process.env.GOOGLE_API_KEY || process.env.GOOGLE_CSE_KEY || '';
  const cx = (process.env.GOOGLE_CX || process.env.GOOGLE_CSE_CX || '').trim();
  const keys = rawKeys.split(',').map((k) => k.trim()).filter(Boolean);

  if (!keys.length || !cx) {
    return { error: 'not-configured' };
  }

  const start = Math.max(1, Math.min(91, (page - 1) * 10 + 1));
  const effectiveQuery = tab === 'videos' ? `${query} video` : query;
  let lastFailure = 'unavailable';

  for (const apiKey of keys) {
    try {
      const apiUrl = new URL('https://www.googleapis.com/customsearch/v1');
      apiUrl.searchParams.set('key', apiKey);
      apiUrl.searchParams.set('cx', cx);
      apiUrl.searchParams.set('q', effectiveQuery);
      apiUrl.searchParams.set('safe', 'off');
      apiUrl.searchParams.set('num', '10');
      apiUrl.searchParams.set('start', String(start));

      const response = await fetchRaw(apiUrl.toString(), { timeout: 8000 });
      if (response.status !== 200) {
        lastFailure = response.status === 403
          ? 'forbidden'
          : response.status === 429
            ? 'quota'
            : response.status === 400
              ? 'invalid-search-engine'
              : 'unavailable';
        continue;
      }

      const data = JSON.parse(response.body);
      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        lastFailure = 'empty';
        continue;
      }

      const results = data.items.map((item) => {
        const pagemap = item.pagemap || {};
        const cseThumb = (pagemap.cse_thumbnail && pagemap.cse_thumbnail[0] && pagemap.cse_thumbnail[0].src) || '';
        const cseImage = (pagemap.cse_image && pagemap.cse_image[0] && pagemap.cse_image[0].src) || '';
        const videoObj = (pagemap.videoobject && pagemap.videoobject[0]) || {};
        const metatags = (pagemap.metatags && pagemap.metatags[0]) || {};
        const thumbnail = cseThumb || videoObj.thumbnailurl || metatags['og:image'] || cseImage || '';
        const duration = videoObj.duration || metatags['video:duration'] || '';
        const domain = extractDomain(item.link);

        return {
          title: decodeHtmlEntities(item.title || ''),
          url: item.link,
          snippet: decodeHtmlEntities(item.snippet || metatags['og:description'] || ''),
          domain,
          favicon: `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(item.link)}`,
          thumbnail,
          duration,
          source: metatags['og:site_name'] || domain,
          isVideo: Boolean(videoObj.url || videoObj.embedurl || metatags['og:video'] || /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|pornhub\.com|xvideos\.com|xnxx\.com|xhamster\.com|spankbang\.com|eporner\.com|redtube\.com|youporn\.com/i.test(item.link))
        };
      });

      return {
        engine: 'google-api',
        results
      };
    } catch (error) {
      lastFailure = 'network';
    }
  }

  return { error: lastFailure };
}

async function getDuckDuckGoVqd(query) {
  try {
    const initUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&kp=-2&ia=web`;
    const res = await fetchRaw(initUrl, {
      headers: {
        'Cookie': 'kp=-2; dcm=3'
      }
    });
    const match = res.body.match(/vqd=['"]?([\d-]+)['"]?/i) || res.body.match(/vqd=([\d-]+)&/i);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

async function searchDuckDuckGoVideos(query, vqd) {
  if (!vqd) return [];
  try {
    const videoApiUrl = `https://duckduckgo.com/v.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=-2`;
    const res = await fetchRaw(videoApiUrl, {
      headers: {
        'Referer': 'https://duckduckgo.com/',
        'Cookie': 'kp=-2'
      }
    });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.body);
    if (!data.results || !Array.isArray(data.results)) return [];

    return data.results.slice(0, 12).map((item) => {
      const url = item.content || '';
      const domain = extractDomain(url);
      return {
        title: decodeHtmlEntities(item.title || ''),
        url,
        snippet: decodeHtmlEntities(item.description || item.publisher || ''),
        domain,
        favicon: `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(url)}`,
        thumbnail: (item.images && (item.images.medium || item.images.small || item.images.large)) || '',
        duration: item.duration || '',
        views: item.statistics && item.statistics.viewCount ? `${Number(item.statistics.viewCount).toLocaleString()} views` : '',
        published: item.published ? new Date(item.published).toLocaleDateString() : '',
        source: item.publisher || domain,
        isVideo: true
      };
    }).filter((r) => r.url && r.title);
  } catch (e) {
    return [];
  }
}

async function searchDuckDuckGoWebJson(query, vqd) {
  if (!vqd) return [];
  try {
    const webApiUrl = `https://links.duckduckgo.com/d.js?q=${encodeURIComponent(query)}&l=us-en&p=-2&s=0&df=&vqd=${encodeURIComponent(vqd)}&o=json`;
    const res = await fetchRaw(webApiUrl, {
      headers: {
        'Referer': 'https://duckduckgo.com/',
        'Cookie': 'kp=-2'
      }
    });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.body);
    if (!data.results || !Array.isArray(data.results)) return [];

    return data.results
      .filter((item) => item && item.u && item.t && !item.n)
      .map((item) => {
        const domain = extractDomain(item.u);
        return {
          title: decodeHtmlEntities(item.t),
          url: item.u,
          snippet: decodeHtmlEntities(item.a || ''),
          domain,
          favicon: `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(item.u)}`,
          thumbnail: '',
          duration: '',
          source: domain,
          isVideo: /video|watch|movie|stream|tube|porn|xxx|xvideos|xnxx|pornhub|xhamster|spankbang|eporner|vimeo|dailymotion|youtube/i.test(item.u + ' ' + item.t)
        };
      });
  } catch (e) {
    return [];
  }
}

async function searchDuckDuckGoHtml(query) {
  try {
    const postData = `q=${encodeURIComponent(query)}&kl=wt-wt&kp=-2`;
    const res = await fetchRaw('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://html.duckduckgo.com',
        'Referer': 'https://html.duckduckgo.com/',
        'Cookie': 'kp=-2; kl=wt-wt'
      },
      body: postData
    });

    const results = [];
    const blocks = res.body.split(/class=["'][^"']*result__body[^"']*["']/i).slice(1);

    for (const block of blocks) {
      const linkMatch = block.match(/class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;

      let rawUrl = linkMatch[1];
      if (rawUrl.includes('uddg=')) {
        try {
          const parsedUddg = new URL(rawUrl, 'https://html.duckduckgo.com');
          rawUrl = decodeURIComponent(parsedUddg.searchParams.get('uddg') || rawUrl);
        } catch (e) {}
      }
      if (!/^https?:\/\//i.test(rawUrl)) continue;

      const title = decodeHtmlEntities(linkMatch[2]);
      const snippetMatch = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
      const snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1]) : '';
      const domain = extractDomain(rawUrl);

      results.push({
        title,
        url: rawUrl,
        snippet,
        domain,
        favicon: `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(rawUrl)}`,
        thumbnail: '',
        duration: '',
        source: domain,
        isVideo: /video|watch|movie|stream|tube|porn|xxx|xvideos|xnxx|pornhub|xhamster|spankbang|eporner|vimeo|dailymotion|youtube/i.test(rawUrl + ' ' + title)
      });
    }

    return results;
  } catch (e) {
    return [];
  }
}

function emptyResultsMessage(googleConfigured, googleFailure) {
  if (!googleConfigured || googleFailure === 'not-configured') {
    return 'Web search is not configured on this deployment. Add GOOGLE_API_KEY and GOOGLE_CX in Vercel, then redeploy.';
  }
  if (googleFailure === 'forbidden') {
    return 'Google rejected the search request. Check that the Custom Search JSON API is enabled and the API key and GOOGLE_CX are correct.';
  }
  if (googleFailure === 'quota') {
    return 'Google search quota is exhausted. Check the Custom Search API quota in Google Cloud.';
  }
  if (googleFailure === 'invalid-search-engine') {
    return 'Google rejected the search engine configuration. Verify the GOOGLE_CX search engine ID.';
  }
  if (googleFailure === 'network') {
    return 'The search provider could not be reached. Try again shortly.';
  }
  if (googleFailure === 'empty') {
    return 'Google returned no matches. Check that the Programmable Search Engine is configured to search the web.';
  }
  return 'Search providers returned no results. Verify the Google Custom Search JSON API, API key, search engine ID (GOOGLE_CX), and quota.';
}

async function runUnifiedSearch(query, tab = 'all', page = 1, options = {}) {
  const forceDuckDuckGo = options.forceDuckDuckGo === true;
  const keys = String(process.env.GOOGLE_API_KEY || process.env.GOOGLE_CSE_KEY || '')
    .split(',').map((key) => key.trim()).filter(Boolean);
  const googleConfigured = keys.length > 0 && Boolean(String(process.env.GOOGLE_CX || process.env.GOOGLE_CSE_CX || '').trim());
  const googleData = forceDuckDuckGo ? { error: 'not-configured' } : await searchGoogleApi(query, tab, page);
  const googleFailure = googleData && googleData.error;
  const vqd = await getDuckDuckGoVqd(query);
  const [ddgVideos, ddgJsonWeb] = await Promise.all([
    searchDuckDuckGoVideos(query, vqd),
    googleData && !googleData.error ? Promise.resolve([]) : searchDuckDuckGoWebJson(query, vqd)
  ]);

  let mainResults = [];
  let engineUsed = 'duckduckgo';

  if (googleData && googleData.results && googleData.results.length > 0) {
    engineUsed = 'google-api';
    mainResults = googleData.results;
  } else if (ddgJsonWeb && ddgJsonWeb.length > 0) {
    mainResults = ddgJsonWeb;
  } else {
    mainResults = await searchDuckDuckGoHtml(query);
  }

  if (tab === 'videos') {
    const mergedVideos = [...ddgVideos, ...mainResults.filter((r) => r.isVideo), ...mainResults];
    const seen = new Set();
    const deduped = mergedVideos.filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    return {
      engine: engineUsed,
      query,
      tab,
      results: deduped.slice(0, 20),
      videoCards: ddgVideos.slice(0, 8),
      message: deduped.length || ddgVideos.length ? '' : (forceDuckDuckGo
        ? 'DuckDuckGo did not return results. Check that the laptop search service can reach DuckDuckGo.'
        : emptyResultsMessage(googleConfigured, googleFailure))
    };
  }

  const videoMap = new Map();
  for (const v of ddgVideos) {
    videoMap.set(v.url, v);
  }

  const enrichedResults = mainResults.map((item) => {
    const matchedVideo = videoMap.get(item.url);
    if (matchedVideo) {
      return Object.assign({}, item, {
        thumbnail: item.thumbnail || matchedVideo.thumbnail,
        duration: item.duration || matchedVideo.duration,
        views: matchedVideo.views || '',
        isVideo: true
      });
    }
    return item;
  });

  const existingUrls = new Set(enrichedResults.map((r) => r.url));
  const topVideos = ddgVideos.filter((v) => !existingUrls.has(v.url)).slice(0, 6);

  const results = [...topVideos.slice(0, 3), ...enrichedResults].slice(0, 20);
  return {
    engine: engineUsed,
    query,
    tab,
    results,
    videoCards: ddgVideos.slice(0, 6),
    message: results.length || ddgVideos.length ? '' : (forceDuckDuckGo
      ? 'DuckDuckGo did not return results. Check that the laptop search service can reach DuckDuckGo.'
      : emptyResultsMessage(googleConfigured, googleFailure))
  };
}

function runDuckDuckGoSearch(query, tab = 'all', page = 1) {
  return runUnifiedSearch(query, tab, page, { forceDuckDuckGo: true });
}

async function searchForRequest(query, tab, page) {
  const backendUrl = String(process.env.LOCAL_DDG_BACKEND_URL || '').trim();
  if (!backendUrl) return runUnifiedSearch(query, tab, page);

  const token = String(process.env.DDG_BACKEND_TOKEN || '');
  if (!token) throw new Error('Laptop DuckDuckGo backend is configured without DDG_BACKEND_TOKEN.');

  let endpoint;
  try {
    endpoint = new URL(backendUrl);
  } catch (error) {
    throw new Error('LOCAL_DDG_BACKEND_URL must be a valid HTTPS URL ending in /search.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/search' ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Laptop DuckDuckGo backend requires LOCAL_DDG_BACKEND_URL to be an HTTPS URL ending in /search.');
  }

  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('tab', tab);
  endpoint.searchParams.set('page', String(page));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      signal: controller.signal
    });

    if (response.status === 401) {
      throw new Error('Laptop DuckDuckGo backend rejected authentication. Match DDG_BACKEND_TOKEN in Vercel and .env.local.');
    }
    if (response.status === 429) {
      throw new Error('Laptop DuckDuckGo backend is busy. Try again shortly.');
    }
    if (!response.ok) {
      throw new Error(`Laptop DuckDuckGo backend returned HTTP ${response.status}. Check the ngrok URL and laptop service.`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('Laptop DuckDuckGo backend did not return JSON. Set LOCAL_DDG_BACKEND_URL to the ngrok URL ending in /search.');
    }
    if (!data || data.engine !== 'duckduckgo' || !Array.isArray(data.results) || !Array.isArray(data.videoCards)) {
      throw new Error('Laptop DuckDuckGo backend returned an invalid response. Check that ngrok forwards to the DDG search service.');
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Laptop DuckDuckGo search timed out. Check that the local service and ngrok tunnel are running.');
    }
    if (error.message && error.message.startsWith('Laptop DuckDuckGo')) throw error;
    throw new Error('Could not reach the laptop DuckDuckGo service. Check that ngrok is running and LOCAL_DDG_BACKEND_URL is correct.');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const q = (parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query') || '').trim();
    const tab = (parsedUrl.searchParams.get('tab') || 'all').toLowerCase();
    const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10) || 1;

    if (!q) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Missing search query' }));
    }

    const data = await searchForRequest(q, tab, page);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(data));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    const message = err.message && err.message.startsWith('Laptop DuckDuckGo')
      ? err.message
      : ((err && err.message) || 'Search failed');
    return res.end(JSON.stringify({ error: message, results: [], videoCards: [] }));
  }
};

module.exports.runUnifiedSearch = runUnifiedSearch;
module.exports.runDuckDuckGoSearch = runDuckDuckGoSearch;
module.exports.searchForRequest = searchForRequest;
module.exports._emptyResultsMessage = emptyResultsMessage;