import { createServerFn } from "@tanstack/react-start";
import {
  fetchShopifyMarkets,
  fetchShopifyMonthly,
  fetchTripleWhale,
  fetchLoop,
  fetchJortt,
  fetchConnections,
} from "./fetchers.server";

export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
  const [shopifyMarkets, shopifyMonthly, tripleWhale, loop, jortt, connections] = await Promise.all([
    fetchShopifyMarkets().catch(() => null),
    fetchShopifyMonthly().catch(() => null),
    fetchTripleWhale().catch(() => null),
    fetchLoop().catch(() => null),
    fetchJortt().catch(() => null),
    fetchConnections().catch(() => ({}) as Record<string, string>),
  ]);

  return { shopifyMarkets, shopifyMonthly, tripleWhale, loop, jortt, connections };
});
