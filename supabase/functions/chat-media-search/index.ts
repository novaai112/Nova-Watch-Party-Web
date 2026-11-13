import { createClient } from "npm:@supabase/supabase-js@2";
import { GiphyFetch } from "npm:@giphy/js-fetch-api@5.8.0";

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

function unsplashLink(value: unknown): string | null {
  const safe = httpsUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (!["unsplash.com", "www.unsplash.com"].includes(url.hostname)) return null;
  url.searchParams.set("utm_source", "nova_watch_party");
  url.searchParams.set("utm_medium", "referral");
  return url.href;
}

function unsplashDownloadLocation(value: unknown, photoId?: unknown): string | null {
  const safe = httpsUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  const pathMatch = url.pathname.match(/^\/photos\/([A-Za-z0-9_-]+)\/download\/?$/);
  return url.hostname === "api.unsplash.com" && pathMatch &&
      (photoId === undefined || (typeof photoId === "string" && photoId === pathMatch[1]))
    ? url.href
    : null;
}

function klipyLocale(value: unknown): string {
  if (typeof value !== "string") return "en_US";
  const match = value.trim().match(/^([a-z]{2,3})(?:-[a-z]{4})?(?:[-_]([a-z]{2}))?$/i);
  return match ? `${match[1].toLowerCase()}_${(match[2] || "US").toUpperCase()}` : "en_US";
}

function klipyMediaUrl(value: unknown): string | null {
  const candidate = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? (value as { url?: unknown; src?: unknown }).url || (value as { src?: unknown }).src
      : null;
  return httpsUrl(candidate);
}

function klipyAsset(item: Record<string, any>, formats: string[], sizes: string[] = ["hd", "md", "sm", "xs"]): { url: string; format: string } | null {
  for (const source of [item.file, item.files, item.media_formats]) {
    if (!source || typeof source !== "object") continue;
    if (Array.isArray(source)) {
      for (const asset of source) {
        const format = String(asset?.format || asset?.type || "").toLowerCase().replace(/^(?:image|video)\//, "");
        const url = formats.includes(format) ? klipyMediaUrl(asset) : null;
        if (url) return { url, format };
      }
      continue;
    }
    const directFormat = String(source.format || source.type || "").toLowerCase().replace(/^(?:image|video)\//, "");
    const directUrl = formats.includes(directFormat) ? klipyMediaUrl(source) : null;
    if (directUrl) return { url: directUrl, format: directFormat };
    for (const size of sizes) {
      for (const format of formats) {
        for (const candidate of [source[size]?.[format], source[format]?.[size], source[format]]) {
          const url = klipyMediaUrl(candidate);
          if (url) return { url, format };
        }
      }
    }
    for (const format of formats) {
      const url = klipyMediaUrl(source[format]);
      if (url) return { url, format };
    }
  }
  return null;
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  const status = candidate.status ?? candidate.response?.status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
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

  let input: { provider?: unknown; query?: unknown; kind?: unknown; page?: unknown; locale?: unknown; action?: unknown; downloadLocation?: unknown; photoId?: unknown };
  try {
    const parsedInput = await request.json();
    if (!parsedInput || typeof parsedInput !== "object" || Array.isArray(parsedInput)) {
      return reply(400, { error: "Search request must be a JSON object." });
    }
    input = parsedInput;
  } catch {
    return reply(400, { error: "Search request must be valid JSON." });
  }

  const provider = typeof input.provider === "string" ? input.provider.trim().toLowerCase() : "";
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const action = typeof input.action === "string" ? input.action : "search";
  const kind = typeof input.kind === "string" ? input.kind : provider === "unsplash" ? "image" : "gif";
  const maxPage = provider === "unsplash" ? 100 : 208;
  const page = typeof input.page === "number" && Number.isInteger(input.page) ? Math.max(0, Math.min(input.page, maxPage)) : 0;
  const maxQueryLength = provider === "giphy" && kind !== "text" ? 50 : 100;
  if (query.length > maxQueryLength) return reply(400, { error: `Search terms must be ${maxQueryLength} characters or fewer.` });
  if (!["unsplash", "giphy", "klipy"].includes(provider)) {
    return reply(400, {
      error: "Unsupported media provider.",
      code: "unsupported_media_provider",
      provider,
      supportedProviders: ["unsplash", "giphy", "klipy"],
    });
  }
  if (action !== "search" && !(provider === "unsplash" && action === "download")) {
    return reply(400, { error: "Unsupported media search action." });
  }
  const allowedKinds = provider === "giphy"
    ? ["gif", "sticker", "clip", "emoji", "text"]
    : provider === "klipy"
      ? ["gif", "sticker", "clip", "meme", "emoji"]
      : ["image"];
  if (!allowedKinds.includes(kind)) {
    return reply(400, { error: "Unsupported media type for this provider." });
  }
  if (!query && action !== "download" && provider !== "giphy" && provider !== "klipy") {
    return reply(400, { error: "Enter a search term for this provider." });
  }
  if (provider === "giphy" && kind === "text" && !query) {
    return reply(400, { error: "Type the exact words you want GIPHY to animate." });
  }

  try {
    if (provider === "unsplash" && action === "download") {
      const key = Deno.env.get("UNSPLASH_ACCESS_KEY");
      if (!key) return reply(503, { error: "Unsplash search is not configured on the server." });
      const downloadLocation = unsplashDownloadLocation(input.downloadLocation, input.photoId);
      if (!downloadLocation) return reply(400, { error: "Unsplash download tracking URL is invalid." });
      const tracked = await fetch(downloadLocation, {
        headers: { Authorization: `Client-ID ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!tracked.ok) {
        console.error(`Unsplash download tracking returned HTTP ${tracked.status}`);
        return reply(502, { error: "Unsplash could not record this photo use. Try again before sending." });
      }
      return reply(200, { tracked: true });
    }

    if (provider === "giphy" && ["clip", "emoji", "text"].includes(kind)) {
      const key = Deno.env.get("GIPHY_SDK_API_KEY");
      if (!key) {
        return reply(503, { error: "GIPHY Clips, Emoji, and Animated Text require GIPHY_SDK_API_KEY in Supabase Edge Function secrets." });
      }

      const giphy = new GiphyFetch(key);
      const pagination = { limit: 24, offset: page * 24 };
      const response = kind === "emoji"
        ? await giphy.emoji(pagination)
        : kind === "text"
          ? await giphy.animate(query, pagination)
          : query
            ? await giphy.search(query, { ...pagination, type: "videos", rating: "pg" })
            : await giphy.trending({ ...pagination, type: "videos", rating: "pg" });
      const raw = Array.isArray(response.data) ? response.data : [];
      const results = raw.flatMap((item: Record<string, any>) => {
        if (kind === "clip") {
          const assets = item.video?.assets || {};
          const video = assets["480p"] || assets["360p"] || assets["720p"] || assets.source;
          const url = httpsUrl(video?.url);
          const preview = httpsUrl(
            item.images?.fixed_width_small?.webp ||
            item.images?.fixed_width_small?.url ||
            item.images?.fixed_width?.webp ||
            item.images?.fixed_width?.url
          );
          return url && preview
            ? [{ url, preview, title: String(item.title || item.slug || "GIPHY Clip").slice(0, 160), type: "video/mp4" }]
            : [];
        }

        const url = httpsUrl(item.images?.original?.url || item.images?.fixed_width?.url);
        const preview = httpsUrl(
          item.images?.fixed_width_small?.webp ||
          item.images?.fixed_width_small?.url ||
          item.images?.fixed_width?.url
        ) || url;
        return url && preview
          ? [{
            url,
            preview,
            title: String(item.title || item.alt_text || item.slug || (kind === "emoji" ? "GIPHY Emoji" : query)).slice(0, 160),
            type: "image/gif",
          }]
          : [];
      }).slice(0, 24);
      const totalCount = Number(response.pagination?.total_count);
      const hasMore = page < maxPage && (Number.isFinite(totalCount)
        ? (page * 24 + raw.length) < totalCount
        : raw.length >= 24);
      return reply(200, { provider, results, hasMore });
    }

    let endpoint: URL;
    let requestOptions: RequestInit = { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) };
    if (provider === "giphy") {
      const key = Deno.env.get("GIPHY_API_KEY");
      if (!key) return reply(503, { error: "GIPHY search is not configured on the server." });
      endpoint = new URL(`https://api.giphy.com/v1/${kind === "sticker" ? "stickers" : "gifs"}/${query ? "search" : "trending"}`);
      const params = new URLSearchParams({ api_key: key, limit: "24", offset: String(page * 24), rating: "pg", lang: "en", bundle: "messaging_non_clips" });
      if (query) params.set("q", query);
      endpoint.search = params.toString();
    } else if (provider === "klipy") {
      const key = Deno.env.get("KLIPY_API_KEY");
      if (!key) return reply(503, { error: "KLIPY search is not configured on the server." });
      const paths: Record<string, string> = {
        gif: "gifs",
        sticker: "stickers",
        clip: "clips",
        meme: "static-memes",
        emoji: "emojis",
      };
      endpoint = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/${paths[kind]}/${query ? "search" : "trending"}`);
      const params = new URLSearchParams({
        per_page: "24",
        page: String(page + 1),
        content_filter: "high",
        customer_id: userData.user.id,
        locale: klipyLocale(input.locale),
      });
      if (query) params.set("q", query);
      if (kind === "gif") params.set("format_filter", "gif");
      endpoint.search = params.toString();
    } else {
      const key = Deno.env.get("UNSPLASH_ACCESS_KEY");
      if (!key) return reply(503, { error: "Unsplash search is not configured on the server." });
      endpoint = new URL("https://api.unsplash.com/search/photos");
      endpoint.search = new URLSearchParams({
        query,
        page: String(page + 1),
        per_page: "24",
        content_filter: "high",
      }).toString();
      requestOptions = {
        headers: { Accept: "application/json", Authorization: `Client-ID ${key}` },
        signal: AbortSignal.timeout(10000),
      };
    }

    const upstream = await fetch(endpoint, requestOptions);
    if (provider === "unsplash" && upstream.status === 429) {
      return reply(429, { error: "Unsplash is rate-limiting photo search. Wait before trying again." }, {
        "Retry-After": upstream.headers.get("Retry-After") || "60",
      });
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
    const raw = provider === "unsplash"
      ? payload.results || []
      : provider === "giphy"
        ? payload.data || []
        : payload.data?.data || payload.data?.results || payload.results || [];
    if (!Array.isArray(raw)) {
      return reply(502, { error: `${provider} returned an unsupported search response.` });
    }

    const results = raw.flatMap((item: Record<string, any>) => {
      if (provider === "unsplash") {
        const url = httpsUrl(item.urls?.regular || item.urls?.full);
        const preview = httpsUrl(item.urls?.small || item.urls?.thumb);
        const photoId = typeof item.id === "string" ? item.id : "";
        const downloadLocation = unsplashDownloadLocation(item.links?.download_location, photoId);
        const photographer = String(item.user?.name || "").trim().slice(0, 120);
        const photographerUrl = unsplashLink(item.user?.links?.html);
        const photoUrl = unsplashLink(item.links?.html);
        if (!url || !preview || !photoId || !downloadLocation || !photographer || !photographerUrl || !photoUrl) return [];
        return [{
          url,
          preview,
          title: String(item.alt_description || item.description || "Unsplash photo").slice(0, 160),
          type: "image/*",
          photoId,
          downloadLocation,
          attribution: { photographer, photographerUrl, photoUrl },
        }];
      }
      if (provider === "giphy") {
        const still = kind === "sticker" ? item.images?.original_still?.url : null;
        const url = httpsUrl(item.images?.original?.url || item.images?.fixed_width?.url || still);
        const preview = httpsUrl(item.images?.fixed_width_small?.url || item.images?.fixed_width?.url || still) || url;
        return url && preview ? [{ url, preview, title: String(item.title || (kind === "sticker" ? "Sticker" : "GIF")).slice(0, 160), type: kind === "sticker" ? "image/*" : "image/gif" }] : [];
      }
      if (kind === "clip") {
        if (item.has_audio !== true) return [];
        const video = klipyAsset(item, ["mp4", "loopedmp4", "webm"]);
        const preview = klipyAsset(item, ["gif", "webp", "jpg", "png", "tinygif", "nanogif", "mediumgif", "mediumwebp", "jpeg"], ["sm", "xs", "md", "hd"]);
        const type = video?.format === "webm" ? "video/webm" : "video/mp4";
        return video && preview
          ? [{ url: video.url, preview: preview.url, title: String(item.title || item.slug || "KLIPY Clip").slice(0, 160), type }]
          : [];
      }
      const formats = kind === "sticker"
        ? ["webp", "mediumwebp", "png", "gif", "mediumgif"]
        : kind === "meme"
          ? ["webp", "mediumwebp", "png", "jpg", "jpeg", "gif", "mediumgif"]
          : ["gif", "mediumgif", "webp", "mediumwebp", "png", "jpg", "jpeg"];
      const asset = klipyAsset(item, formats);
      const preview = klipyAsset(item, ["webp", "gif", "jpg", "png", "tinygif", "nanogif", "mediumgif", "mediumwebp", "jpeg"], ["sm", "xs", "md", "hd"]) || asset;
      const format = asset?.format.replace(/^(?:medium|tiny|nano)/, "");
      const mime = format === "gif" ? "image/gif"
        : format === "webp" ? "image/webp"
          : format === "png" ? "image/png" : "image/jpeg";
      const label = kind === "sticker" ? "Sticker" : kind === "meme" ? "Meme" : kind === "emoji" ? "AI Emoji" : "GIF";
      return asset && preview
        ? [{ url: asset.url, preview: preview.url, title: String(item.title || item.slug || label).slice(0, 160), type: kind === "sticker" ? "image/*" : mime }]
        : [];
    }).slice(0, 24);

    const hasMore = provider === "unsplash"
      ? page + 1 < Number(payload.total_pages || 0)
      : raw.length >= 24 && page < 208;
    return reply(200, { provider, results, hasMore });
  } catch (error) {
    console.error(`Media search failed for ${provider}:`, error);
    const status = statusOf(error);
    if (provider === "giphy" && ["clip", "emoji", "text"].includes(kind) && (status === 401 || status === 403)) {
      const guidance = kind === "clip"
        ? "GIPHY Clips access requires approval. Check GIPHY_SDK_API_KEY and request Clips access from GIPHY."
        : "Check that GIPHY_SDK_API_KEY is valid and enabled for the GIPHY SDK.";
      return reply(status, { error: guidance });
    }
    return reply(502, { error: "Media search failed. Try again shortly." });
  }
});
