import { writeCache, ageMinutes, readCache, type CacheMap } from "./cache.server";
import {
  fetchShopifyMarkets,
  fetchShopifyMonthly,
  fetchShopifyToday,
  fetchShopifyDaily,
  fetchShopifyRepeatFunnel,
  fetchTripleWhale,
  fetchTripleWhaleCustomerEconomics,
  fetchTripleWhaleDaily,
  fetchJortt,
  fetchJuoRaw,
  fetchLoopRaw,
  fetchXero,
} from "./fetchers.server";

// Module-level guards — prevent duplicate concurrent syncs hammering APIs.
// One in-flight promise per provider/key.
const inFlight = new Map<string, Promise<void>>();

interface Job {
  name: string;
  provider: string;
  key: string;
  fn: () => Promise<unknown>;
  /** Max age (minutes) before this job is considered stale and re-fetched. */
  maxAgeMin: number;
}

const ALL_JOBS: Job[] = [
  { name: "shopify_markets", provider: "shopify",     key: "markets",       fn: () => fetchShopifyMarkets(), maxAgeMin: 30 },
  { name: "shopify_monthly", provider: "shopify",     key: "monthly",       fn: fetchShopifyMonthly,         maxAgeMin: 60 },
  { name: "shopify_today",   provider: "shopify",     key: "today",         fn: fetchShopifyToday,           maxAgeMin: 10 },
  { name: "shopify_daily",   provider: "shopify",     key: "daily",         fn: fetchShopifyDaily,           maxAgeMin: 720 },
  { name: "shopify_repeat_funnel", provider: "shopify", key: "repeat_funnel", fn: fetchShopifyRepeatFunnel,  maxAgeMin: 720 },
  { name: "triplewhale",     provider: "triplewhale", key: "summary",       fn: () => fetchTripleWhale(),    maxAgeMin: 30 },
  { name: "triplewhale_customer_economics", provider: "triplewhale", key: "customer_economics", fn: fetchTripleWhaleCustomerEconomics, maxAgeMin: 720 },
  { name: "triplewhale_daily", provider: "triplewhale", key: "daily",       fn: fetchTripleWhaleDaily,       maxAgeMin: 720 },
  { name: "jortt",           provider: "jortt",       key: "invoices",      fn: fetchJortt,                  maxAgeMin: 60 },
  { name: "juo",             provider: "juo",         key: "subscriptions", fn: fetchJuoRaw,                 maxAgeMin: 60 },
  { name: "loop",            provider: "loop",        key: "subscriptions", fn: fetchLoopRaw,                maxAgeMin: 60 },
  { name: "xero",            provider: "xero",        key: "accounting",    fn: fetchXero,                   maxAgeMin: 60 },
];

async function runJob(job: Job): Promise<void> {
  const id = `${job.provider}/${job.key}`;
  const existing = inFlight.get(id);
  if (existing) return existing;
  const p = (async () => {
    try {
      const data = await job.fn();
      if (data === null || data === undefined) {
        // Fetcher returned no data. DO NOT overwrite an existing healthy
        // cache row with an empty marker — that would mask good data behind
        // a transient upstream hiccup. Only write the marker if there is
        // no previous successful payload to preserve.
        const existingRow = await readCache(job.provider, job.key);
        const hasGoodPrevious =
          existingRow?.payload &&
          typeof existingRow.payload === "object" &&
          !(existingRow.payload as any).__empty &&
          !(existingRow.payload as any).__error;
        if (hasGoodPrevious) {
          console.warn(
            `[sync] ${job.name} returned no data — keeping previous cached payload (fetched ${existingRow!.fetchedAt})`
          );
        } else {
          await writeCache(job.provider, job.key, {
            __empty: true,
            fetchedAt: new Date().toISOString(),
          });
          console.warn(`[sync] ${job.name} returned no data (empty/null)`);
        }
      } else {
        await writeCache(job.provider, job.key, data);
        console.log(`[sync] ${job.name} ok`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sync] ${job.name} failed:`, msg);
      // Same protection for hard errors — preserve previously good data.
      const existingRow = await readCache(job.provider, job.key);
      const hasGoodPrevious =
        existingRow?.payload &&
        typeof existingRow.payload === "object" &&
        !(existingRow.payload as any).__empty &&
        !(existingRow.payload as any).__error;
      if (!hasGoodPrevious) {
        await writeCache(job.provider, job.key, {
          __error: true,
          message: msg,
          fetchedAt: new Date().toISOString(),
        });
      }
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, p);
  return p;
}

/**
 * Run a full background sync of every source. Resolves when ALL jobs finish.
 * Use `runAllInBackground()` for fire-and-forget.
 */
export async function runAll(): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  await Promise.all(
    ALL_JOBS.map(async (job) => {
      try {
        await runJob(job);
        results[job.name] = "ok";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[job.name] = `error: ${msg}`;
      }
    }),
  );
  return results;
}

/** Fire-and-forget — caller does NOT await individual jobs. */
export function runAllInBackground(): void {
  // Intentionally not awaited; runJob() handles errors internally.
  void runAll();
}

/**
 * Look at the existing cache map and kick off background fetches for any
 * sources whose entry is missing or older than the per-job maxAge.
 * Returns immediately. Safe to call on every dashboard render.
 */
export function refreshStaleInBackground(cache: CacheMap): void {
  for (const job of ALL_JOBS) {
    const entry = cache[`${job.provider}/${job.key}`];
    const age = ageMinutes(entry?.fetchedAt);
    const payload = entry?.payload as any;
    const needsFreshCalc =
      (job.provider === "loop" && job.key === "subscriptions" && !Array.isArray(payload?.__empty) && !payload?.__error && Array.isArray(payload) && payload.some((row: any) => row?.calcVersion !== 3)) ||
      (job.provider === "juo" && job.key === "subscriptions" && !payload?.__error && Array.isArray(payload) && payload.some((row: any) => row?.calcVersion !== 2)) ||
      (job.provider === "shopify" && job.key === "monthly" && !payload?.__error && Array.isArray(payload) && payload.some((row: any) => row?.calcVersion !== 2)) ||
      (job.provider === "shopify" && job.key === "daily" && payload && !payload.__empty && !payload.__error && payload.calcVersion !== 2) ||
      (job.provider === "shopify" && job.key === "repeat_funnel" && payload && !payload.__empty && !payload.__error && payload.calcVersion !== 4);
    if (!entry || age > job.maxAgeMin || needsFreshCalc) {
      void runJob(job);
    }
  }
}
