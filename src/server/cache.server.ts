import { createClient as createSupabaseJS } from "@supabase/supabase-js";

// Resolve Supabase credentials with sensible fallbacks.
// In the TanStack Worker runtime, only VITE_* vars are injected reliably;
// SUPABASE_SERVICE_ROLE_KEY may be unavailable. The data_cache table has
// permissive RLS for authenticated users, so the publishable/anon key works.
function resolveCreds() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    (import.meta as any).env?.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  return { url, key };
}

let _client: ReturnType<typeof createSupabaseJS> | null = null;
function serviceClient() {
  if (!_client) {
    const { url, key } = resolveCreds();
    if (!url || !key) {
      throw new Error(
        `Supabase creds missing (url=${!!url}, key=${!!key}). Need SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/VITE_SUPABASE_PUBLISHABLE_KEY.`
      );
    }
    _client = createSupabaseJS(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

export interface CacheEntry {
  payload: any;
  fetchedAt: string;
}

export type CacheMap = Record<string, CacheEntry | null>;

/**
 * Fetch all dashboard cache rows in ONE query.
 * Returns a map keyed by "provider/cache_key".
 */
export async function readAllCache(): Promise<CacheMap> {
  try {
    const { data, error } = await (serviceClient() as any)
      .from("data_cache")
      .select("provider, cache_key, payload, fetched_at");
    if (error) {
      console.error("readAllCache error:", error.message);
      return {};
    }
    if (!data) return {};
    const map: CacheMap = {};
    for (const row of data as any[]) {
      map[`${row.provider}/${row.cache_key}`] = {
        payload: row.payload,
        fetchedAt: row.fetched_at,
      };
    }
    return map;
  } catch (err: any) {
    console.error("readAllCache exception:", err?.message);
    return {};
  }
}

/** Write one cache entry. */
export async function writeCache(provider: string, key: string, payload: any): Promise<void> {
  try {
    const { error } = await (serviceClient() as any)
      .from("data_cache")
      .upsert(
        { provider, cache_key: key, payload, fetched_at: new Date().toISOString() },
        { onConflict: "provider,cache_key" }
      );
    if (error) {
      console.error(`writeCache ${provider}/${key} db error:`, error.message);
    }
  } catch (err: any) {
    console.error(`writeCache ${provider}/${key}:`, err?.message);
  }
}

/** Age of a cache entry in minutes. Returns Infinity if null/missing. */
export function ageMinutes(fetchedAt: string | null | undefined): number {
  if (!fetchedAt) return Infinity;
  return (Date.now() - new Date(fetchedAt).getTime()) / 60_000;
}
