import { createClient as createSupabaseJS } from "@supabase/supabase-js";

// Single persistent client — avoids re-creating on every request
let _client: ReturnType<typeof createSupabaseJS> | null = null;
function serviceClient() {
  if (!_client) {
    _client = createSupabaseJS(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
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
    if (error || !data) return {};
    const map: CacheMap = {};
    for (const row of data as any[]) {
      map[`${row.provider}/${row.cache_key}`] = {
        payload: row.payload,
        fetchedAt: row.fetched_at,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/** Write one cache entry. */
export async function writeCache(provider: string, key: string, payload: any): Promise<void> {
  try {
    await (serviceClient() as any)
      .from("data_cache")
      .upsert(
        { provider, cache_key: key, payload, fetched_at: new Date().toISOString() },
        { onConflict: "provider,cache_key" }
      );
  } catch (err: any) {
    console.error(`writeCache ${provider}/${key}:`, err.message);
  }
}

/** Age of a cache entry in minutes. Returns Infinity if null/missing. */
export function ageMinutes(fetchedAt: string | null | undefined): number {
  if (!fetchedAt) return Infinity;
  return (Date.now() - new Date(fetchedAt).getTime()) / 60_000;
}
