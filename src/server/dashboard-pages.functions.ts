import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchShopifyStoreDetail,
  fetchLoopMarketDetail,
  fetchJuoDetail,
  fetchJorttInvoiceDetail,
} from "./dashboard-detail.server";
import { fetchTripleWhale, fetchXero } from "./fetchers.server";
import { readAllCache, writeCache, ageMinutes } from "./cache.server";

/**
 * CACHE-FIRST strategy for dashboard pages.
 *
 * - Each (provider, store, range) combo has its own cache row.
 * - GET returns cached data IMMEDIATELY if it exists. (sub-second)
 * - If the cache is stale OR missing, a background refresh is scheduled
 *   (fire-and-forget) so the next visit is fresh.
 * - When the user hits "Refresh" the page passes force=true and the
 *   server awaits the live fetch (and writes it back).
 *
 * Result: pages render in <500ms instead of waiting 10–60s for
 * paginated upstream APIs.
 */

const dateRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  force: z.boolean().optional(),
});

const STALE_MIN = 30; // minutes — refresh cached entries older than this in the background

// Background-safe scheduler for the Worker runtime.
function scheduleBackground(p: Promise<unknown>) {
  // @ts-ignore — EdgeRuntime is available on the Worker runtime
  if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
    (EdgeRuntime as any).waitUntil(p);
  }
  // Fallback: just let it run. Errors are swallowed.
  p.catch(() => {});
}

const inFlight = new Map<string, Promise<any>>();

async function dedupedFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

interface CacheReadResult<T> {
  data: T | null;
  fetchedAt: string | null;
  source: "cache" | "live" | "none";
  ageMinutes: number;
  error: string | null;
}

/**
 * Cache-first wrapper:
 *  - If cache hit: return it. If stale, kick off background refresh.
 *  - If cache miss: do live fetch synchronously.
 *  - If force=true: do live fetch synchronously regardless.
 */
async function cacheFirst<T>(
  provider: string,
  cacheKey: string,
  liveFetch: () => Promise<T>,
  opts: { force?: boolean } = {}
): Promise<CacheReadResult<T>> {
  const fullKey = `${provider}/${cacheKey}`;

  // Read all cache once (cheap; one query)
  const all = await readAllCache();
  const entry = all[fullKey];

  // Force refresh path: do live now and write
  if (opts.force) {
    try {
      const live = await dedupedFetch(fullKey, liveFetch);
      await writeCache(provider, cacheKey, live);
      return { data: live, fetchedAt: new Date().toISOString(), source: "live", ageMinutes: 0, error: null };
    } catch (err: any) {
      // Fall back to cache if live fails
      if (entry?.payload && !entry.payload.__error) {
        return {
          data: entry.payload as T,
          fetchedAt: entry.fetchedAt,
          source: "cache",
          ageMinutes: ageMinutes(entry.fetchedAt),
          error: err?.message ?? String(err),
        };
      }
      return { data: null, fetchedAt: null, source: "none", ageMinutes: Infinity, error: err?.message ?? String(err) };
    }
  }

  // Cache hit
  if (entry?.payload && !entry.payload.__error && !entry.payload.__empty) {
    const age = ageMinutes(entry.fetchedAt);
    // Stale → kick off background refresh, but return cached data NOW
    if (age > STALE_MIN) {
      scheduleBackground(
        dedupedFetch(fullKey, liveFetch)
          .then((live) => writeCache(provider, cacheKey, live))
          .catch((e) => console.error(`[bg-refresh] ${fullKey}:`, e?.message))
      );
    }
    return {
      data: entry.payload as T,
      fetchedAt: entry.fetchedAt,
      source: "cache",
      ageMinutes: age,
      error: null,
    };
  }

  // Cache miss — must fetch live (slow path)
  try {
    const live = await dedupedFetch(fullKey, liveFetch);
    await writeCache(provider, cacheKey, live);
    return { data: live, fetchedAt: new Date().toISOString(), source: "live", ageMinutes: 0, error: null };
  } catch (err: any) {
    return { data: null, fetchedAt: null, source: "none", ageMinutes: Infinity, error: err?.message ?? String(err) };
  }
}

// ─── Store dashboard (Shopify) ──────────────────────────────────────────────
export const getStoreDashboard = createServerFn({ method: "GET" })
  .inputValidator(
    dateRangeSchema.extend({
      storeCode: z.enum(["NL", "UK", "US", "EU"]),
    })
  )
  .handler(async ({ data }) => {
    const cacheKey = `detail_${data.storeCode}_${data.from}_${data.to}`;
    const result = await cacheFirst(
      "shopify",
      cacheKey,
      () => fetchShopifyStoreDetail(data.storeCode, data.from, data.to),
      { force: data.force }
    );
    return {
      detail: result.data,
      source: result.source,
      fetchedAt: result.fetchedAt,
      ageMinutes: result.ageMinutes,
      error: result.error,
    };
  });

// ─── Triple Whale dashboard ─────────────────────────────────────────────────
export const getTripleWhaleDashboard = createServerFn({ method: "GET" })
  .inputValidator(dateRangeSchema)
  .handler(async ({ data }) => {
    const cacheKey = `summary_${data.from}_${data.to}`;
    const result = await cacheFirst(
      "triplewhale",
      cacheKey,
      () => fetchTripleWhale(data.from, data.to),
      { force: data.force }
    );
    return {
      data: result.data,
      source: result.source,
      fetchedAt: result.fetchedAt,
      ageMinutes: result.ageMinutes,
      error: result.error,
    };
  });

// ─── Subscription dashboard (Loop UK/US/EU OR Juo NL) ───────────────────────
export const getSubscriptionDashboard = createServerFn({ method: "GET" })
  .inputValidator(
    dateRangeSchema.extend({
      storeCode: z.enum(["NL", "UK", "US", "EU"]),
    })
  )
  .handler(async ({ data }) => {
    const platform = data.storeCode === "NL" ? "juo" : "loop";
    const cacheKey = `detail_${data.storeCode}_${data.from}_${data.to}`;

    const result = await cacheFirst(
      platform,
      cacheKey,
      async () => {
        if (data.storeCode === "NL") return fetchJuoDetail(data.from, data.to);
        return fetchLoopMarketDetail(data.storeCode, data.from, data.to);
      },
      { force: data.force }
    );

    return {
      data: result.data,
      platform,
      source: result.source,
      fetchedAt: result.fetchedAt,
      ageMinutes: result.ageMinutes,
      error: result.error,
    };
  });

// ─── Invoice dashboard (Jortt) ──────────────────────────────────────────────
export const getInvoiceDashboard = createServerFn({ method: "GET" })
  .inputValidator(dateRangeSchema)
  .handler(async ({ data }) => {
    const cacheKey = `detail_${data.from}_${data.to}`;
    const result = await cacheFirst(
      "jortt",
      cacheKey,
      () => fetchJorttInvoiceDetail(data.from, data.to),
      { force: data.force }
    );
    return {
      data: result.data,
      source: result.source,
      fetchedAt: result.fetchedAt,
      ageMinutes: result.ageMinutes,
      error: result.error,
    };
  });

// ─── Accounting dashboard (Xero) ────────────────────────────────────────────
export const getAccountingDashboard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ force: z.boolean().optional() }).optional())
  .handler(async ({ data }) => {
    const force = data?.force === true;
    const result = await cacheFirst("xero", "accounting", () => fetchXero(), { force });
    return {
      data: result.data,
      source: result.source,
      fetchedAt: result.fetchedAt,
      ageMinutes: result.ageMinutes,
      error: result.error,
    };
  });
