import { createFileRoute } from "@tanstack/react-router";
import { writeCache } from "@/server/cache.server";
import {
  fetchShopifyMarkets,
  fetchShopifyMonthly,
  fetchShopifyToday,
  fetchTripleWhale,
  fetchJortt,
  fetchJuoRaw,
  fetchLoopRaw,
  fetchXero,
} from "@/server/fetchers.server";

// Full sync of all dashboard sources. Writes results to data_cache.
// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD for ad-hoc range (Shopify + TW only,
// returned in response without overwriting cache).
export const Route = createFileRoute("/api/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { searchParams } = new URL(request.url);
        const source = searchParams.get("source") ?? "all";
        const fromDate = searchParams.get("from") ?? undefined;
        const toDate = searchParams.get("to") ?? undefined;
        const isCustomRange = !!(fromDate && toDate);

        if (isCustomRange) {
          const [shopifyMarkets, tripleWhale] = await Promise.allSettled([
            fetchShopifyMarkets(fromDate, toDate),
            fetchTripleWhale(fromDate, toDate),
          ]);
          return Response.json({
            ok: true,
            from: fromDate,
            to: toDate,
            rangeData: {
              shopifyMarkets:
                shopifyMarkets.status === "fulfilled" ? shopifyMarkets.value : null,
              tripleWhale:
                tripleWhale.status === "fulfilled" ? tripleWhale.value : null,
            },
          });
        }

        const results: Record<string, string> = {};
        async function run(
          name: string,
          fn: () => Promise<unknown>,
          provider: string,
          key: string,
        ) {
          if (source !== "all" && source !== name) return;
          try {
            const data = await fn();
            await writeCache(provider, key, data);
            results[name] = "ok";
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Sync ${name}:`, msg);
            results[name] = `error: ${msg}`;
          }
        }

        await Promise.all([
          run("shopify_markets", fetchShopifyMarkets, "shopify", "markets"),
          run("shopify_monthly", fetchShopifyMonthly, "shopify", "monthly"),
          run("shopify_today", fetchShopifyToday, "shopify", "today"),
          run("triplewhale", fetchTripleWhale, "triplewhale", "summary"),
          run("jortt", fetchJortt, "jortt", "invoices"),
          run("juo", fetchJuoRaw, "juo", "subscriptions"),
          run("loop", fetchLoopRaw, "loop", "subscriptions"),
          run("xero", fetchXero, "xero", "accounting"),
        ]);

        return Response.json({
          ok: true,
          syncedAt: new Date().toISOString(),
          results,
        });
      },
    },
  },
});
