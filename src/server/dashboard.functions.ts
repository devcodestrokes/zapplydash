import { createServerFn } from "@tanstack/react-start";
import { readAllCache, ageMinutes } from "./cache.server";

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
  const cache = await readAllCache();
  const get = (provider: string, key: string) => cache[`${provider}/${key}`] ?? null;

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
