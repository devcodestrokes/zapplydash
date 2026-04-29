import { writeCache, ageMinutes, type CacheMap } from "./cache.server";
import {
  fetchShopifyMarkets,
  fetchShopifyMonthly,
  fetchShopifyToday,
  fetchShopifyDaily,
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
      // Always write SOMETHING so the cache row exists. If the fetcher
      // returned null/undefined, store a marker payload so we can tell
      // "fetched but empty" apart from "never fetched".
      const payload =
        data === null || data === undefined
          ? { __empty: true, fetchedAt: new Date().toISOString() }
          : data;
      await writeCache(job.provider, job.key, payload);
      if (data === null || data === undefined) {
        console.warn(`[sync] ${job.name} returned no data (empty/null)`);
      } else {
        console.log(`[sync] ${job.name} ok`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sync] ${job.name} failed:`, msg);
      // Persist an error marker so the dashboard knows this source failed.
      await writeCache(job.provider, job.key, {
        __error: true,
        message: msg,
        fetchedAt: new Date().toISOString(),
      });
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
    if (!entry || age > job.maxAgeMin) {
      void runJob(job);
    }
  }
}
