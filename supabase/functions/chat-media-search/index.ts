import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
  "Content-Type": "application/json",
};

function reply(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extraHeaders } });
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function duckDuckGoVqd(html: string): string | null {
  return html.match(/vqd\s*[:=]\s*["']?([\d-]{10,})/i)?.[1] || null;
}

function isGifUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (/\.gif$/i.test(url.pathname)) return true;
    const nestedUrl = url.searchParams.get("u") || url.searchParams.get("url");
    return nestedUrl ? /\.gif$/i.test(new URL(nestedUrl).pathname) : false;
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: "Use POST for media searches." });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply(401, { error: "Sign in to search chat media." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return reply(503, { error: "Media search authentication is not configured." });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) return reply(401, { error: "Your session is invalid. Sign in again." });

  let input: { provider?: unknown; query?: unknown; kind?: unknown; page?: unknown };
  try {
    input = await request.json();
  } catch {
    return reply(400, { error: "Search request must be valid JSON." });
  }

  const provider = typeof input.provider === "string" ? input.provider : "";
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 100) : "";
  const kind = typeof input.kind === "string" ? input.kind : "gif";
  const maxPage = provider === "duckduckgo" ? 20 : 208;
  const page = typeof input.page === "number" && Number.isInteger(input.page) ? Math.max(0, Math.min(input.page, maxPage)) : 0;
  if (!["duckduckgo", "giphy", "klipy"].includes(provider)) return reply(400, { error: "Unsupported media provider." });
  if (!["image", "gif", "sticker"].includes(kind)) {
    return reply(400, { error: "Unsupported media type for this provider." });
  }
  if (provider === "duckduckgo" && !["image", "gif"].includes(kind)) {
    return reply(400, { error: "DuckDuckGo chat search supports images and GIFs only." });
  }
  if (!query && provider !== "giphy" && provider !== "klipy") {
    return reply(400, { error: "Enter a search term for this provider." });
  }

  try {
    let endpoint: URL;
    let requestOptions: RequestInit = { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) };
    if (provider === "duckduckgo") {
      const searchQuery = kind === "gif" ? `${query} GIF` : query;
      const imagePage = new URL("https://duckduckgo.com/");
      imagePage.search = new URLSearchParams({ q: searchQuery, iax: "images", ia: "images", kp: "1" }).toString();
      const pageResponse = await fetch(imagePage, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(10000),
      });
      if (pageResponse.status === 202 || pageResponse.status === 403 || pageResponse.status === 429) {
        return reply(429, { error: "DuckDuckGo is limiting this image search. Try again later; Nova does not bypass its access checks." });
      }
      if (!pageResponse.ok) return reply(502, { error: `DuckDuckGo image search could not start (HTTP ${pageResponse.status}).` });
      const vqd = duckDuckGoVqd(await pageResponse.text());
      if (!vqd) {
        return reply(429, { error: "DuckDuckGo did not provide an image-search token. It may be limiting automated requests; try again later." });
      }
      endpoint = new URL("https://duckduckgo.com/i.js");
      endpoint.search = new URLSearchParams({
        q: searchQuery,
        l: "us-en",
        o: "json",
        vqd,
        s: String(page * 100),
        p: "1",
      }).toString();
      requestOptions = {
        headers: { Accept: "application/json", Referer: imagePage.href },
        signal: AbortSignal.timeout(10000),
      };
    } else if (provider === "giphy") {
      const key = Deno.env.get("GIPHY_API_KEY");
      if (!key) return reply(503, { error: "GIPHY search is not configured on the server." });
      endpoint = new URL(`https://api.giphy.com/v1/${kind === "sticker" ? "stickers" : "gifs"}/${query ? "search" : "trending"}`);
      const params = new URLSearchParams({ api_key: key, limit: "24", offset: String(page * 24), rating: "pg", lang: "en", bundle: "messaging_non_clips" });
      if (query) params.set("q", query);
      endpoint.search = params.toString();
    } else {
      const key = Deno.env.get("KLIPY_API_KEY");
      if (!key) return reply(503, { error: "KLIPY search is not configured on the server." });
      endpoint = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/${kind === "sticker" ? "stickers" : "gifs"}/${query ? "search" : "trending"}`);
      const params = new URLSearchParams({ per_page: "24", page: String(page + 1), content_filter: "medium" });
      if (query) params.set("q", query);
      if (kind === "sticker") params.set("customer_id", userData.user.id);
      if (kind === "gif") params.set("format_filter", "gif");
      endpoint.search = params.toString();
    }

    const upstream = await fetch(endpoint, requestOptions);
    if (provider === "duckduckgo" && [202, 403, 429].includes(upstream.status)) {
      return reply(429, { error: "DuckDuckGo is limiting this image search. Try again later; Nova does not bypass its access checks." });
    }
    if (!upstream.ok) {
      console.error(`Media provider ${provider} returned HTTP ${upstream.status}`);
      const guidance = upstream.status === 401 || upstream.status === 403
        ? " Check that the server API key is valid and has the required access."
        : upstream.status === 429
          ? " The provider rate limit was reached; try again shortly."
          : upstream.status >= 500
            ? " The provider is temporarily unavailable; try again shortly."
            : " Check the provider configuration and search settings.";
      return reply(502, { error: `${provider} media search failed (provider HTTP ${upstream.status}).${guidance}` });
    }
    const payload = await upstream.json();
    if (provider === "duckduckgo" && (payload.response_type === "botnet_challenge" || payload.challenge)) {
      return reply(429, { error: "DuckDuckGo is limiting this image search. Try again later; Nova does not bypass its access checks." });
    }
    const raw = provider === "duckduckgo"
      ? payload.results || []
      : provider === "giphy"
        ? payload.data || []
        : payload.data?.data || payload.data?.results || payload.results || [];
    if (!Array.isArray(raw)) {
      return reply(502, { error: `${provider} returned an unsupported search response.` });
    }

    const results = raw.flatMap((item: Record<string, any>) => {
      if (provider === "duckduckgo") {
        const url = httpsUrl(item.image || item.image_url);
        const preview = httpsUrl(item.thumbnail || item.thumbnail_url || item.image) || url;
        if (!url || !preview) return [];
        const isGif = isGifUrl(url);
        if ((kind === "gif") !== isGif) return [];
        return [{ url, preview, title: String(item.title || item.source || (isGif ? "GIF" : "Image")).slice(0, 160), type: isGif ? "image/gif" : "image/*" }];
      }
      if (provider === "giphy") {
        const still = kind === "sticker" ? item.images?.original_still?.url : null;
        const url = httpsUrl(item.images?.original?.url || item.images?.fixed_width?.url || still);
        const preview = httpsUrl(item.images?.fixed_width_small?.url || item.images?.fixed_width?.url || still) || url;
        return url && preview ? [{ url, preview, title: String(item.title || (kind === "sticker" ? "Sticker" : "GIF")).slice(0, 160), type: kind === "sticker" ? "image/*" : "image/gif" }] : [];
      }
      const formats = kind === "sticker" ? ["webp", "png", "gif"] : ["gif"];
      const url = formats.map((format) => item.file?.hd?.[format]?.url || item.file?.md?.[format]?.url || item.file?.sm?.[format]?.url)
        .map(httpsUrl).find(Boolean) || null;
      const preview = formats.map((format) => item.file?.sm?.[format]?.url || item.file?.md?.[format]?.url)
        .map(httpsUrl).find(Boolean) || url;
      return url && preview ? [{ url, preview, title: String(item.title || item.slug || (kind === "sticker" ? "Sticker" : "GIF")).slice(0, 160), type: kind === "sticker" ? "image/*" : "image/gif" }] : [];
    }).slice(0, 24);

    const hasMore = provider === "duckduckgo"
      ? raw.length >= 24 && page < maxPage
      : raw.length >= 24 && page < 208;
    return reply(200, { provider, results, hasMore });
  } catch (error) {
    console.error(`Media search failed for ${provider}:`, error);
    return reply(502, { error: "Media search failed. Try again shortly." });
  }
});
