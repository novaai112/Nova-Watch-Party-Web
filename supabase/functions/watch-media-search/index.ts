import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
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
  if (!authorization?.startsWith("Bearer ")) return reply(401, { error: "Sign in to search media." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return reply(503, { error: "Media search authentication is not configured." });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) return reply(401, { error: "Your session is invalid. Sign in again." });

  let input: { provider?: unknown; query?: unknown };
  try {
    input = await request.json();
  } catch {
    return reply(400, { error: "Search request must be valid JSON." });
  }

  const provider = typeof input.provider === "string" ? input.provider : "";
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 100) : "";
  if (!["google", "giphy", "klipy"].includes(provider)) return reply(400, { error: "Unsupported media provider." });
  if (query.length < 2) return reply(400, { error: "Enter at least two characters to search." });

  try {
    let endpoint: URL;
    if (provider === "google") {
      const key = Deno.env.get("GOOGLE_CSE_API_KEY");
      const engine = Deno.env.get("GOOGLE_CSE_ID");
      if (!key || !engine) return reply(503, { error: "Google Images needs an eligible Custom Search API key and Search Engine ID." });
      endpoint = new URL("https://www.googleapis.com/customsearch/v1");
      endpoint.search = new URLSearchParams({ key, cx: engine, q: query, searchType: "image", safe: "active", num: "10" }).toString();
    } else if (provider === "giphy") {
      const key = Deno.env.get("GIPHY_API_KEY");
      if (!key) return reply(503, { error: "GIPHY search is not configured on the server." });
      endpoint = new URL("https://api.giphy.com/v1/gifs/search");
      endpoint.search = new URLSearchParams({ api_key: key, q: query, limit: "24", rating: "pg", lang: "en", bundle: "messaging_non_clips" }).toString();
    } else {
      const key = Deno.env.get("KLIPY_API_KEY");
      if (!key) return reply(503, { error: "KLIPY search is not configured on the server." });
      endpoint = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/search`);
      endpoint.search = new URLSearchParams({ q: query, per_page: "24", page: "1", content_filter: "medium", format_filter: "gif" }).toString();
    }

    const upstream = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) {
      console.error(`Media provider ${provider} returned HTTP ${upstream.status}`);
      return reply(502, { error: `${provider} media search is temporarily unavailable.` });
    }
    const payload = await upstream.json();
    const raw = provider === "google"
      ? payload.items || []
      : provider === "giphy"
        ? payload.data || []
        : payload.data?.data || payload.data?.results || payload.results || [];

    const results = raw.flatMap((item: Record<string, any>) => {
      if (provider === "google") {
        const url = httpsUrl(item.link);
        const preview = httpsUrl(item.image?.thumbnailLink) || url;
        return url && preview ? [{ url, preview, title: String(item.title || "Image").slice(0, 160), type: "image/*" }] : [];
      }
      if (provider === "giphy") {
        const url = httpsUrl(item.images?.original?.url || item.images?.fixed_width?.url);
        const preview = httpsUrl(item.images?.fixed_width_small?.url || item.images?.fixed_width?.url) || url;
        return url && preview ? [{ url, preview, title: String(item.title || "GIF").slice(0, 160), type: "image/gif" }] : [];
      }
      const url = httpsUrl(item.file?.hd?.gif?.url || item.file?.md?.gif?.url || item.file?.sm?.gif?.url);
      const preview = httpsUrl(item.file?.sm?.gif?.url || item.file?.md?.gif?.url) || url;
      return url && preview ? [{ url, preview, title: String(item.title || item.slug || "GIF").slice(0, 160), type: "image/gif" }] : [];
    }).slice(0, 24);

    return reply(200, { provider, results });
  } catch (error) {
    console.error(`Media search failed for ${provider}:`, error);
    return reply(502, { error: "Media search failed. Try again shortly." });
  }
});
