import { createServerFn } from "@tanstack/react-start";
import { readCacheKeys, writeCache, ageMinutes } from "./cache.server";
import { refreshStaleInBackground } from "./sync.server";
import { fetchTripleWhale, fetchTripleWhaleCustomerEconomics } from "./fetchers.server";
import { getProgress } from "./progress.server";

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
          fetchTripleWhale(data.from, data.to, key),
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
        return result;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, task);
    return await task;
  });

export const getTripleWhaleProgress = createServerFn({ method: "POST" })
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data }) => {
    const key = `${data.from}|${data.to}`;
    const p = getProgress(key);
    if (!p) {
      return { total: 0, fetched: 0, remaining: 0, stores: [], done: true } as const;
    }
    return {
      total: p.total,
      fetched: p.fetched,
      remaining: p.remaining,
      stores: p.stores,
      done: p.done,
    };
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
    ["shopify", "daily"],
    ["triplewhale", "summary"],
    ["triplewhale", "customer_economics"],
    ["triplewhale", "daily"],
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
  const shopifyDailyCache = get("shopify", "daily");
  const tripleWhaleCache = get("triplewhale", "summary");
  const tripleWhaleCustomerEconomicsCache = get("triplewhale", "customer_economics");
  const tripleWhaleDailyCache = get("triplewhale", "daily");
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
  let tripleWhaleCustomerEconomics = tripleWhaleCustomerEconomicsCache?.payload ?? null;
  if (!tripleWhaleCustomerEconomics || ageMinutes(tripleWhaleCustomerEconomicsCache?.fetchedAt) > 720) {
    try {
      const fresh = await withTimeout(fetchTripleWhaleCustomerEconomics(), 12_000, "Triple Whale customer economics");
      if (fresh) {
        tripleWhaleCustomerEconomics = fresh;
        await writeCache("triplewhale", "customer_economics", fresh);
      }
    } catch (err: any) {
      console.error("getDashboardData customer economics failed:", err?.message);
    }
  }

  return {
    shopifyMarkets: shopifyMarketsCache?.payload ?? null,
    shopifyMonthly: shopifyMonthlyCache?.payload ?? null,
    shopifyToday: shopifyTodayCache?.payload ?? null,
    shopifyDaily: shopifyDailyCache?.payload ?? null,
    tripleWhale: tripleWhaleCache?.payload ?? null,
    tripleWhaleCustomerEconomics,
    tripleWhaleDaily: tripleWhaleDailyCache?.payload ?? null,
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

export const getSyncStatus = createServerFn({ method: "GET" }).handler(async () => {
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
  const conns = getConnections();
  const get = (p: string, k: string) => cache[`${p}/${k}`] ?? null;

  function describe(payload: any): { ok: boolean; reason: string | null; rows: number | null } {
    if (payload == null) return { ok: false, reason: "No data cached yet", rows: null };
    if (typeof payload === "object") {
      if (payload.__error) return { ok: false, reason: String(payload.__error).slice(0, 200), rows: null };
      if (payload.__empty) return { ok: false, reason: "Provider returned empty payload", rows: 0 };
    }
    const rows = Array.isArray(payload) ? payload.length : Array.isArray(payload?.rows) ? payload.rows.length : null;
    return { ok: true, reason: null, rows };
  }

  function entry(provider: string, key: string, label: string, expected: string) {
    const c = get(provider, key);
    const d = describe(c?.payload);
    const connected = !!conns[provider];
    let status: "healthy" | "degraded" | "error" | "disconnected";
    if (!connected) status = "disconnected";
    else if (!c) status = "error";
    else if (!d.ok) status = "error";
    else if (ageMinutes(c.fetchedAt) > 60) status = "degraded";
    else status = "healthy";
    return {
      provider, key, label, expected,
      connected,
      status,
      lastSyncedAt: c?.fetchedAt ?? null,
      ageMinutes: c?.fetchedAt ? ageMinutes(c.fetchedAt) : null,
      rowCount: d.rows,
      error: d.reason,
    };
  }

  const sources = [
    entry("shopify", "markets", "Shopify Plus · Markets", "Per-market revenue & orders"),
    entry("shopify", "monthly", "Shopify Plus · Monthly", "Last 12 months revenue"),
    entry("shopify", "today", "Shopify Plus · Today", "Today's live orders"),
    entry("triplewhale", "summary", "Triple Whale · Summary", "Ad spend, ROAS, MER"),
    entry("juo", "subscriptions", "Juo · Subscriptions (NL)", "Active subs & MRR"),
    entry("loop", "subscriptions", "Loop · Subscriptions (UK/US/EU)", "Active subs & MRR"),
    entry("jortt", "invoices", "Jortt · Invoices", "Outstanding invoices"),
    entry("xero", "accounting", "Xero · Accounting", "P&L, cash, balance sheet"),
  ];

  return {
    sources,
    failing: sources.filter((s) => s.status === "error" || s.status === "disconnected"),
    degraded: sources.filter((s) => s.status === "degraded"),
    healthy: sources.filter((s) => s.status === "healthy"),
    checkedAt: Date.now(),
  };
});
