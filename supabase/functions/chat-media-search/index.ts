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

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
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
  const maxPage = provider === "searxng" ? 9999 : 208;
  const page = typeof input.page === "number" && Number.isInteger(input.page) ? Math.max(0, Math.min(input.page, maxPage)) : 0;
  if (!["searxng", "giphy", "klipy"].includes(provider)) return reply(400, { error: "Unsupported media provider." });
  if (!["image", "gif", "sticker"].includes(kind)) {
    return reply(400, { error: "Unsupported media type for this provider." });
  }
  if (!query && provider !== "giphy" && provider !== "klipy") {
    return reply(400, { error: "Enter a search term for this provider." });
  }

  try {
    let endpoint: URL;
    let requestOptions: RequestInit = { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) };
    if (provider === "searxng") {
      const configuredBase = Deno.env.get("SEARXNG_BASE_URL");
      if (!configuredBase) return reply(503, { error: "SearXNG is not configured. Set the SEARXNG_BASE_URL Edge Function secret." });
      let base: URL;
      try {
        base = new URL(configuredBase);
      } catch {
        return reply(503, { error: "SEARXNG_BASE_URL must be a valid HTTPS URL." });
      }
      if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
        return reply(503, { error: "SEARXNG_BASE_URL must be an HTTPS instance URL without credentials, query, or fragment." });
      }
      base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
      endpoint = new URL("search", base);
      endpoint.search = new URLSearchParams({
        q: kind === "gif" ? `${query} animated GIF` : query,
        categories: "images",
        format: "json",
        pageno: String(page + 1),
        safesearch: "1"
      }).toString();
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
    if (!upstream.ok) {
      console.error(`Media provider ${provider} returned HTTP ${upstream.status}`);
      if (provider === "searxng" && upstream.status === 429) {
        const retry = retryAfterSeconds(upstream.headers.get("Retry-After"));
        const wait = retry === undefined
          ? "Wait a short while before trying again."
          : `Retry after ${retry} seconds.`;
        return reply(429, {
          error: `The SearXNG instance is rate-limiting this search. ${wait} Public instances have shared capacity limits; use an instance you operate for predictable higher-volume access.`,
          ...(retry === undefined ? {} : { retryAfterSeconds: retry }),
        }, retry === undefined ? {} : { "Retry-After": String(retry) });
      }
      if (provider === "searxng" && upstream.status === 403) {
        return reply(502, { error: "SearXNG returned HTTP 403. Enable JSON in the instance's search.formats settings, or use a SearXNG instance that allows JSON search requests." });
      }
      if (provider === "searxng" && upstream.status === 401) {
        return reply(502, { error: "SearXNG returned HTTP 401. This integration does not send SearXNG credentials; allow unauthenticated requests from Supabase Edge Functions or use a public instance." });
      }
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
    const raw = provider === "searxng"
      ? payload.results || []
      : provider === "giphy"
        ? payload.data || []
        : payload.data?.data || payload.data?.results || payload.results || [];
    if (!Array.isArray(raw)) {
      return reply(502, { error: `${provider} returned an unsupported search response.` });
    }

    const results = raw.flatMap((item: Record<string, any>) => {
      if (provider === "searxng") {
        const url = httpsUrl(item.img_src || item.thumbnail_src || item.thumbnail);
        const preview = httpsUrl(item.thumbnail_src || item.thumbnail || item.img_src) || url;
        if (!url || !preview) return [];
        const isGif = new URL(url).pathname.toLowerCase().endsWith(".gif");
        return [{ url, preview, title: String(item.title || (isGif ? "GIF" : "Image")).slice(0, 160), type: isGif ? "image/gif" : "image/*" }];
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

    const hasMore = provider === "searxng"
      ? raw.length > 0 && page < 9999
      : raw.length >= 24 && page < 208;
    return reply(200, { provider, results, hasMore });
  } catch (error) {
    console.error(`Media search failed for ${provider}:`, error);
    return reply(502, { error: "Media search failed. Try again shortly." });
  }
});
