import { createServerFn } from "@tanstack/react-start";
import { readCacheKeys, ageMinutes } from "./cache.server";
import { refreshStaleInBackground } from "./sync.server";
import { fetchTripleWhale } from "./fetchers.server";

// In-memory range cache (per Worker instance). Triple Whale aggregates are
// expensive (4 stores × external API). For a given (from,to) range the data
// is identical for everyone, so we can safely cache it for a few minutes.
const RANGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const rangeCache = new Map<
  string,
  { rows: any[]; error: string | null; fetchedAt: number }
>();
const inflight = new Map<string, Promise<{ rows: any[]; error: string | null }>>();

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export const getTripleWhaleRange = createServerFn({ method: "POST" })
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data }) => {
    const key = `${data.from}|${data.to}`;
    const now = Date.now();

    // 1) Serve from cache if fresh
    const cached = rangeCache.get(key);
    if (cached && now - cached.fetchedAt < RANGE_TTL_MS) {
      return { rows: cached.rows, error: cached.error };
    }

    // 2) De-duplicate concurrent requests for the same range
    const pending = inflight.get(key);
    if (pending) return await pending;

    const task = (async () => {
      try {
        const rows = await withTimeout(
          fetchTripleWhale(data.from, data.to),
          25_000,
          "Triple Whale fetch"
        );
        const result = { rows: (rows ?? []) as any[], error: null as string | null };
        rangeCache.set(key, { ...result, fetchedAt: Date.now() });
        return result;
      } catch (err: any) {
        console.error("getTripleWhaleRange failed:", err?.message);
        const result = {
          rows: [] as any[],
          error: err?.message?.includes("timed out")
            ? "Triple Whale is taking too long. Please try again."
            : "Failed to load Triple Whale data",
        };
        // Cache failures briefly so we don't hammer a broken upstream
        rangeCache.set(key, { ...result, fetchedAt: Date.now() - (RANGE_TTL_MS - 30_000) });
        return result;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, task);
    return await task;
  });

function getConnections(): Record<string, string> {
  const connections: Record<string, string> = {};
  if (process.env.SHOPIFY_APP_CLIENT_ID && process.env.SHOPIFY_APP_CLIENT_SECRET) {
    const stores = ["SHOPIFY_NL_STORE", "SHOPIFY_UK_STORE", "SHOPIFY_US_STORE", "SHOPIFY_EU_STORE"];
    for (const key of stores) {
      const v = process.env[key];
      if (v) {
        connections["shopify"] = "connected";
        connections[`shopify_${v.replace(".myshopify.com", "")}`] = "connected";
      }
    }
  }
  if (process.env.JORTT_CLIENT_ID) connections["jortt"] = "connected";
  if (process.env.JUO_NL_API_KEY) connections["juo"] = "connected";
  if (process.env.LOOP_UK_API_KEY || process.env.LOOP_US_API_KEY || process.env.LOOP_EU_API_KEY)
    connections["loop"] = "connected";
  if (process.env.TRIPLE_WHALE_API_KEY) connections["triplewhale"] = "connected";
  if (process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET) connections["xero"] = "connected";
  return connections;
}

export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
  const cache = await readCacheKeys([
    ["shopify", "markets"],
    ["shopify", "monthly"],
    ["shopify", "today"],
    ["triplewhale", "summary"],
    ["juo", "subscriptions"],
    ["loop", "subscriptions"],
    ["jortt", "invoices"],
    ["xero", "accounting"],
  ]);
  const get = (provider: string, key: string) => cache[`${provider}/${key}`] ?? null;

  // Fire-and-forget background refresh for any source whose cache entry is
  // missing or older than its max age. Dashboard returns instantly with
  // whatever is currently cached (stale-while-revalidate).
  refreshStaleInBackground(cache);

  const shopifyMarketsCache = get("shopify", "markets");
  const shopifyMonthlyCache = get("shopify", "monthly");
  const shopifyTodayCache = get("shopify", "today");
  const tripleWhaleCache = get("triplewhale", "summary");
  const juoCache = get("juo", "subscriptions");
  const loopCache = get("loop", "subscriptions");
  const jorttCache = get("jortt", "invoices");
  const xeroCache = get("xero", "accounting");

  const syncTimes = [shopifyMarketsCache, tripleWhaleCache, juoCache, loopCache, xeroCache]
    .filter(Boolean)
    .map((c) => c!.fetchedAt);
  const oldestSyncedAt =
    syncTimes.length > 0 ? syncTimes.reduce((a, b) => (a < b ? a : b)) : null;

  const dataIsStale = ageMinutes(oldestSyncedAt) > 30;
  const hasAnyData = !!(shopifyMarketsCache || tripleWhaleCache || loopCache || juoCache || xeroCache);

  return {
    shopifyMarkets: shopifyMarketsCache?.payload ?? null,
    shopifyMonthly: shopifyMonthlyCache?.payload ?? null,
    shopifyToday: shopifyTodayCache?.payload ?? null,
    tripleWhale: tripleWhaleCache?.payload ?? null,
    juo: juoCache?.payload ?? null,
    loop: loopCache?.payload ?? null,
    jortt: jorttCache?.payload ?? null,
    xero: xeroCache?.payload ?? null,
    connections: getConnections(),
    syncedAt: oldestSyncedAt,
    dataIsStale,
    hasAnyData,
  };
});
