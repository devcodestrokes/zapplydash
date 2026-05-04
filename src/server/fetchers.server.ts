/**
 * Server-side data fetchers — called directly from page.tsx (no internal HTTP round-trips).
 * Each fetcher returns null when the source is not configured or errors.
 */
import { createClient as createSupabaseJS } from "@supabase/supabase-js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// Service-role Supabase client — no cookies, works anywhere server-side.
// In the TanStack Worker runtime, process.env may not contain the Supabase
// keys, so we read VITE_* values via import.meta.env at MODULE TOP LEVEL.
// Vite inlines these as string literals at build time, so the Worker bundle
// always has them available regardless of runtime env injection.
// The integrations + data_cache tables have permissive RLS for this use case.
const VITE_SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_PUBLISHABLE_KEY = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(`Supabase creds missing in fetchers (url=${!!url}, key=${!!key})`);
  }
  return createSupabaseJS(url, key, { auth: { persistSession: false } });
}

// ─── Shopify ─────────────────────────────────────────────────────────────────
//
// Uses Shopify OAuth2 client_credentials grant (no user redirect needed).
// Pin a single explicit Admin API version. 2025-01 reaches end-of-life Jan 2026
// and Shopify silently forwards stale callers to the latest stable schema —
// pin to current to avoid silent field drops.
export const SHOPIFY_API_VERSION = "2026-01" as const;
// Requires: SHOPIFY_APP_CLIENT_ID + SHOPIFY_APP_CLIENT_SECRET in .env.local
//           App must be installed in each store (done in Shopify Partner Dashboard).
// Tokens (~24h TTL) are cached in Supabase integrations table and auto-refreshed.
//
// Confirmed working on all 4 stores: zapply-nl, zapplyde, zapply-usa, zapplygermany

const SHOPIFY_STORES = [
  { code: "NL", flag: "🇳🇱", name: "Netherlands", storeKey: "SHOPIFY_NL_STORE" },
  { code: "UK", flag: "🇬🇧", name: "United Kingdom", storeKey: "SHOPIFY_UK_STORE" },
  {
    code: "US",
    flag: "🇺🇸",
    name: "United States",
    storeKey: "SHOPIFY_US_STORE",
    status: "scaling",
  },
  { code: "EU", flag: "🇩🇪", name: "Germany / EU", storeKey: "SHOPIFY_EU_STORE" },
] as const;

async function getShopifyToken(store: string): Promise<string | null> {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret || !store) return null;

  const provider = `shopify_${store.replace(".myshopify.com", "")}`;

  // 1. Use cached token from Supabase if still valid (with 10-min buffer)
  try {
    const supabase = serviceClient();
    const { data } = await supabase
      .from("integrations")
      .select("access_token, expires_at, metadata")
      .eq("provider", provider)
      .single();

    if (data?.access_token) {
      const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : Infinity;
      const scopes = String((data.metadata as any)?.scopes ?? "");
      if (expiresAt > Date.now() + 10 * 60 * 1000 && scopes.includes("read_all_orders")) {
        return data.access_token;
      }
    }
  } catch {
    // Supabase unavailable — fall through to fresh grant
  }

  // 2. Client credentials grant — no redirect needed, app must be installed in store
  try {
    const res = await fetch(`https://${store}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Shopify client_credentials ${store} ${res.status}:`, body.slice(0, 200));
      return null;
    }

    const { access_token, expires_in } = await res.json();
    if (!access_token) return null;

    // 3. Cache the fresh token in Supabase
    const expiresAt = new Date(Date.now() + ((expires_in ?? 86400) - 600) * 1000).toISOString();
    await serviceClient()
      .from("integrations")
      .upsert(
        {
          provider,
          access_token,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
          metadata: { shop_domain: store, source: "client_credentials", scopes: "read_orders,read_all_orders" },
        },
        { onConflict: "provider" },
      );

    return access_token;
  } catch (err: any) {
    console.error(`Shopify token refresh ${store}:`, err.message);
    return null;
  }
}

// Paginated GQL — one page, with optional cursor for subsequent pages
const SHOPIFY_GQL_PAGE = (since: string, cursor: string | null, until?: string | null) => `{
  orders(first:250, sortKey:CREATED_AT, reverse:false, ${cursor ? `after:"${cursor}",` : ""}query:"created_at:>=${since}${until ? ` created_at:<=${until}` : ""} financial_status:paid") {
    pageInfo { hasNextPage endCursor }
    edges { node {
      totalPriceSet    { shopMoney { amount currencyCode } }
      totalDiscountsSet{ shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      createdAt
      customer { id numberOfOrders }
    }}
  }
}`;

// Aggregate all orders for a store using cursor pagination (max 40 pages = 10,000 orders)
async function fetchShopifyAllOrders(
  store: string,
  token: string,
  since: string,
  maxPages = 40,
  until?: string | null,
) {
  let revenue = 0,
    refunds = 0,
    discounts = 0,
    orderCount = 0,
    currency = "EUR";
  const customerIds = new Set<string>();
  const monthlySums: Record<string, { revenue: number; orders: number; refunds: number }> = {};
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage && page < maxPages) {
    const res: Response = await fetch(`https://${store}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SHOPIFY_GQL_PAGE(since, cursor, until) }),
    });
    if (!res.ok) break;
    const json = await res.json();
    if (json.errors) {
      console.error("Shopify GQL:", json.errors[0]?.message);
      break;
    }

    const page_data = json.data?.orders ?? {};
    const edges: any[] = page_data.edges ?? [];
    hasNextPage = page_data.pageInfo?.hasNextPage ?? false;
    cursor = page_data.pageInfo?.endCursor ?? null;
    page++;

    for (const { node: o } of edges) {
      const r = parseFloat(o.totalPriceSet.shopMoney.amount);
      const rf = parseFloat(o.totalRefundedSet.shopMoney.amount);
      const dc = parseFloat(o.totalDiscountsSet.shopMoney.amount);
      // Shopify "Total sales" = orders − returns. Subtract refunds from revenue
      // so our number aligns with the figure shown in Shopify Analytics.
      const net = r - rf;
      revenue += net;
      refunds += rf;
      discounts += dc;
      orderCount++;
      currency = o.totalPriceSet.shopMoney.currencyCode;
      if (o.customer?.id) customerIds.add(o.customer.id);
      const mk = new Date(o.createdAt)
        .toLocaleDateString("en-US", { month: "short", year: "2-digit" })
        .replace(" ", " '");
      if (!monthlySums[mk]) monthlySums[mk] = { revenue: 0, orders: 0, refunds: 0 };
      monthlySums[mk].revenue += net;
      monthlySums[mk].refunds += rf;
      monthlySums[mk].orders += 1;
    }
  }

  return {
    revenue,
    refunds,
    discounts,
    orderCount,
    currency,
    uniqueCustomers: customerIds.size,
    monthlySums,
    truncated: hasNextPage,
  };
}

export async function fetchShopifyMarkets(fromDate?: string, toDate?: string) {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  if (!clientId) return null;

  const since = `${fromDate ?? startOfMonth()}T00:00:00Z`;
  const until = toDate ? `${toDate}T23:59:59Z` : null; // passed into GQL query filter

  const results = await Promise.all(
    SHOPIFY_STORES.map(async ({ code, flag, name, storeKey, status }: any) => {
      const store = process.env[storeKey];
      if (!store) return { code, flag, name, status: status ?? null, live: false };

      const token = await getShopifyToken(store);
      if (!token) return { code, flag, name, status: status ?? null, live: false };

      try {
        const agg = await fetchShopifyAllOrders(store, token, since, 180, until);
        const { revenue, refunds, discounts, orderCount, currency, uniqueCustomers, truncated } =
          agg;
        const aov = orderCount > 0 ? revenue / orderCount : 0;
        if (truncated) console.warn(`Shopify ${code}: revenue capped at 180 pages (45,000 orders)`);
        // Convert to EUR for cross-store aggregation. Keep native values too.
        const fxRate = await getEurRate(
          currency,
          since.slice(0, 10),
          (until ?? new Date().toISOString()).slice(0, 10),
        );
        const revenueEUR = +(revenue * fxRate).toFixed(2);
        const refundsEUR = +(refunds * fxRate).toFixed(2);
        return {
          code,
          flag,
          name,
          revenue: revenueEUR,
          refunds: refundsEUR,
          discounts,
          revenueNative: revenue,
          refundsNative: refunds,
          orders: orderCount,
          aov,
          currency,
          fxRate,
          newCustomers: uniqueCustomers,
          truncated,
          status: status ?? null,
          live: true,
        };
      } catch (err: any) {
        console.error(`Shopify ${code} fetch failed:`, err.message);
        return { code, flag, name, status: status ?? null, live: false, error: err.message };
      }
    }),
  );

  const hasAnyLive = results.some((r: any) => r.live);
  return hasAnyLive ? results : null;
}

// Today's orders per market, bucketed by hour (Amsterdam time = UTC+2)
export async function fetchShopifyToday() {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  if (!clientId) return null;

  const todayStart = `${today()}T00:00:00Z`;

  const markets = await Promise.all(
    SHOPIFY_STORES.map(async ({ code, flag, name, storeKey, status }: any) => {
      const store = process.env[storeKey];
      if (!store) return { code, flag, name, live: false };
      const token = await getShopifyToken(store);
      if (!token) return { code, flag, name, live: false };

      try {
        let revenue = 0,
          refunds = 0,
          orders = 0;
        let currency = "EUR";
        const hourlyRev: number[] = Array(24).fill(0);
        const hourlyOrd: number[] = Array(24).fill(0);
        let cursor: string | null = null;
        let hasNextPage = true;
        let page = 0;

        while (hasNextPage && page < 5) {
          const res: Response = await fetch(`https://${store}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
            method: "POST",
            headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
            body: JSON.stringify({ query: SHOPIFY_GQL_PAGE(todayStart, cursor) }),
            cache: "no-store",
          });
          if (!res.ok) break;
          const json = await res.json();
          if (json.errors) break;
          const page_data = json.data?.orders ?? {};
          const edges: any[] = page_data.edges ?? [];
          hasNextPage = page_data.pageInfo?.hasNextPage ?? false;
          cursor = page_data.pageInfo?.endCursor ?? null;
          page++;

          for (const { node: o } of edges) {
            const r = parseFloat(o.totalPriceSet.shopMoney.amount);
            const rf = parseFloat(o.totalRefundedSet.shopMoney.amount);
            // Net of refunds — matches Shopify Analytics "Total sales".
            const net = r - rf;
            revenue += net;
            refunds += rf;
            orders++;
            currency = o.totalPriceSet.shopMoney.currencyCode;
            // Amsterdam = UTC+2 (CEST, valid Apr-Oct)
            const hour = (new Date(o.createdAt).getUTCHours() + 2) % 24;
            hourlyRev[hour] += net;
            hourlyOrd[hour]++;
          }
        }

        const hourly = hourlyRev.map((rev, h) => ({
          hour: h,
          revenue: +rev.toFixed(2),
          orders: hourlyOrd[h],
        }));
        const fxRate = await getEurRate(currency, today(), today());
        const revenueEUR = +(revenue * fxRate).toFixed(2);
        const refundsEUR = +(refunds * fxRate).toFixed(2);
        return {
          code,
          flag,
          name,
          revenue: revenueEUR,
          refunds: refundsEUR,
          revenueNative: +revenue.toFixed(2),
          refundsNative: +refunds.toFixed(2),
          orders,
          aov: orders > 0 ? +(revenueEUR / orders).toFixed(2) : 0,
          currency,
          fxRate,
          hourly,
          live: true,
        };
      } catch (err: any) {
        console.error(`Shopify today ${code}:`, err.message);
        return { code, flag, name, live: false };
      }
    }),
  );

  return markets.some((m: any) => m.live) ? { markets, fetchedAt: new Date().toISOString() } : null;
}

// Last 6 months of order aggregates — all Shopify stores, converted to EUR.
export async function fetchShopifyMonthly() {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  if (!clientId) return null;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const since = `${sixMonthsAgo.toISOString().split("T")[0]}T00:00:00Z`;
  const sinceDay = since.slice(0, 10);

  try {
    const perStore = await Promise.all(
      SHOPIFY_STORES.map(async ({ code, storeKey }: any) => {
        const store = process.env[storeKey];
        if (!store)
          return {
            code,
            monthlySums: {} as Record<string, { revenue: number; orders: number; refunds: number }>,
          };
        const token = await getShopifyToken(store);
        if (!token) return { code, monthlySums: {} };
        const { monthlySums, truncated } = await fetchShopifyAllOrders(store, token, since, 240);
        if (truncated) console.warn(`Shopify monthly ${code}: capped at 240 pages (60,000 orders)`);
        return { code, monthlySums };
      }),
    );

    const merged: Record<
      string,
      {
        revenue: number;
        orders: number;
        refunds: number;
        byMarket: Record<string, { revenue: number; orders: number; refunds: number }>;
      }
    > = {};
    for (const storeRow of perStore) {
      for (const [month, row] of Object.entries(
        storeRow.monthlySums as Record<
          string,
          { revenue: number; orders: number; refunds: number }
        >,
      )) {
        if (!merged[month]) merged[month] = { revenue: 0, orders: 0, refunds: 0, byMarket: {} };
        const endDay = new Date(`1 ${month.replace("'", "20")}`);
        endDay.setMonth(endDay.getMonth() + 1, 0);
        const sourceCurrency = MARKET_CURRENCY[storeRow.code] ?? "EUR";
        const fxRate = await getEurRate(
          sourceCurrency,
          sinceDay,
          endDay.toISOString().split("T")[0],
        );
        const revenue = +(row.revenue * fxRate).toFixed(2);
        const refunds = +(row.refunds * fxRate).toFixed(2);
        merged[month].revenue += revenue;
        merged[month].orders += row.orders;
        merged[month].refunds += refunds;
        merged[month].byMarket[storeRow.code] = { revenue, orders: row.orders, refunds };
      }
    }

    return Object.entries(merged)
      .sort(
        ([a], [b]) =>
          new Date("1 " + a.replace("'", "20")).getTime() -
          new Date("1 " + b.replace("'", "20")).getTime(),
      )
      .map(([month, data]) => ({ month, ...data, calcVersion: 2 }));
  } catch {
    return null;
  }
}

// Fetch Shopify per-market monthly + daily revenue for a specific calendar year.
// Used by the Growth Plan year selector — runs on demand (not cached) so any
// year (including older years) can be inspected.
export async function fetchShopifyGrowthYear(year: number) {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  if (!clientId) return null;

  const sinceDay = `${year}-01-01`;
  const untilDay = `${year}-12-31`;
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const lastActualMonthIdx = year === currentYear ? now.getUTCMonth() : 11;
  const monthIndices = Array.from({ length: lastActualMonthIdx + 1 }, (_, i) => i);

  const mapWithConcurrency = async <T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ) => {
    const results: R[] = [];
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        results[current] = await fn(items[current]);
      }
    });
    await Promise.all(workers);
    return results;
  };

  const monthWindow = (monthIdx: number) => {
    const month = String(monthIdx + 1).padStart(2, "0");
    const endDay = String(new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()).padStart(2, "0");
    return {
      since: `${year}-${month}-01T00:00:00Z`,
      until: `${year}-${month}-${endDay}T23:59:59Z`,
    };
  };

  try {
    const perStore = await Promise.all(
      SHOPIFY_STORES.map(async ({ code, storeKey }: any) => {
        const store = process.env[storeKey];
        if (!store) return { code, monthlySums: {}, dailySums: {} };
        const token = await getShopifyToken(store);
        if (!token) return { code, monthlySums: {}, dailySums: {} };

        const monthResults = await mapWithConcurrency(monthIndices, 2, async (monthIdx) => {
          const { since, until } = monthWindow(monthIdx);
          const monthlySums: Record<string, { revenue: number; orders: number; refunds: number }> = {};
          const dailySums: Record<string, { revenue: number; orders: number }> = {};
          let cursor: string | null = null;
          let hasNextPage = true;
          let page = 0;
          const maxPages = 120;

          while (hasNextPage && page < maxPages) {
            const res: Response = await fetch(`https://${store}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
              method: "POST",
              headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
              body: JSON.stringify({ query: SHOPIFY_GQL_PAGE(since, cursor, until) }),
              cache: "no-store",
            });
            if (!res.ok) break;
            const json = await res.json();
            if (json.errors) {
              console.error(`Shopify growth-month ${year}-${monthIdx + 1} ${code}:`, json.errors[0]?.message);
              break;
            }
            const pageData = json.data?.orders ?? {};
            const edges: any[] = pageData.edges ?? [];
            hasNextPage = pageData.pageInfo?.hasNextPage ?? false;
            cursor = pageData.pageInfo?.endCursor ?? null;
            page++;

            for (const { node: o } of edges) {
              const r = parseFloat(o.totalPriceSet.shopMoney.amount);
              const rf = parseFloat(o.totalRefundedSet.shopMoney.amount);
              const net = r - rf;
              const created = new Date(o.createdAt);
              const mk = created
                .toLocaleDateString("en-US", { month: "short", year: "2-digit" })
                .replace(" ", " '");
              if (!monthlySums[mk]) monthlySums[mk] = { revenue: 0, orders: 0, refunds: 0 };
              monthlySums[mk].revenue += net;
              monthlySums[mk].refunds += rf;
              monthlySums[mk].orders += 1;
              const dayKey = amsterdamDateKey(o.createdAt);
              if (!dailySums[dayKey]) dailySums[dayKey] = { revenue: 0, orders: 0 };
              dailySums[dayKey].revenue += net;
              dailySums[dayKey].orders += 1;
            }
          }

          if (hasNextPage) {
            console.warn(`Shopify growth-month ${year}-${monthIdx + 1} ${code}: capped at ${maxPages} pages`);
          }
          return { monthlySums, dailySums };
        });

        const monthlySums: Record<string, { revenue: number; orders: number; refunds: number }> = {};
        const dailySums: Record<string, { revenue: number; orders: number }> = {};
        for (const result of monthResults) {
          for (const [k, v] of Object.entries(result.monthlySums)) {
            if (!monthlySums[k]) monthlySums[k] = { revenue: 0, orders: 0, refunds: 0 };
            monthlySums[k].revenue += v.revenue;
            monthlySums[k].refunds += v.refunds;
            monthlySums[k].orders += v.orders;
          }
          for (const [k, v] of Object.entries(result.dailySums)) {
            if (!dailySums[k]) dailySums[k] = { revenue: 0, orders: 0 };
            dailySums[k].revenue += v.revenue;
            dailySums[k].orders += v.orders;
          }
        }

        const sourceCurrency = MARKET_CURRENCY[code] ?? "EUR";
        const fxRate = await getEurRate(sourceCurrency, sinceDay, untilDay);
        const monthlyEur: Record<string, { revenue: number; orders: number; refunds: number }> = {};
        for (const [k, v] of Object.entries(monthlySums)) {
          monthlyEur[k] = {
            revenue: +(v.revenue * fxRate).toFixed(2),
            orders: v.orders,
            refunds: +(v.refunds * fxRate).toFixed(2),
          };
        }
        const dailyEur: Record<string, { revenue: number; orders: number }> = {};
        for (const [k, v] of Object.entries(dailySums)) {
          dailyEur[k] = { revenue: +(v.revenue * fxRate).toFixed(2), orders: v.orders };
        }
        return { code, monthlySums: monthlyEur, dailySums: dailyEur };
      }),
    );

    // Build shopifyMonthly-shaped rows and shopifyDaily.byMarket
    const merged: Record<
      string,
      {
        revenue: number;
        orders: number;
        refunds: number;
        byMarket: Record<string, { revenue: number; orders: number; refunds: number }>;
      }
    > = {};
    for (const storeRow of perStore) {
      for (const [month, row] of Object.entries(storeRow.monthlySums)) {
        if (!merged[month]) merged[month] = { revenue: 0, orders: 0, refunds: 0, byMarket: {} };
        merged[month].revenue += row.revenue;
        merged[month].orders += row.orders;
        merged[month].refunds += row.refunds;
        merged[month].byMarket[storeRow.code] = row;
      }
    }
    const shopifyMonthly = Object.entries(merged)
      .sort(
        ([a], [b]) =>
          new Date("1 " + a.replace("'", "20")).getTime() -
          new Date("1 " + b.replace("'", "20")).getTime(),
      )
      .map(([month, d]) => ({ month, ...d, calcVersion: 2 }));

    const dailyByMarket: Record<string, Record<string, { revenue: number; orders: number }>> = {};
    const mergedDaily: Record<string, { revenue: number; orders: number }> = {};
    for (const s of perStore) {
      dailyByMarket[s.code] = s.dailySums;
      for (const [k, v] of Object.entries(s.dailySums)) {
        if (!mergedDaily[k]) mergedDaily[k] = { revenue: 0, orders: 0 };
        mergedDaily[k].revenue += v.revenue;
        mergedDaily[k].orders += v.orders;
      }
    }

    const dailyDates = Object.keys(mergedDaily).sort();
    const returnedMonths = shopifyMonthly.map((m: any) => m.month);
    const expectedMonths = Array.from({ length: 12 }, (_, i) =>
      new Date(Date.UTC(year, i, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " '")
    );

    return {
      year,
      shopifyMonthly,
      shopifyDaily: {
        daily: mergedDaily,
        byMarket: dailyByMarket,
        calcVersion: 2,
        fetchedAt: new Date().toISOString(),
      },
      coverage: {
        dataStart: dailyDates[0] ?? null,
        dataEnd: dailyDates.at(-1) ?? null,
        returnedMonths,
        missingMonths: expectedMonths.filter((m) => !returnedMonths.includes(m)),
      },
    };
  } catch (err: any) {
    console.error(`fetchShopifyGrowthYear ${year} failed:`, err?.message);
    return null;
  }
}

// ─── Triple Whale ─────────────────────────────────────────────────────────────
//
// CONFIRMED WORKING — POST https://api.triplewhale.com/api/v2/summary-page/get-data
// Returns 698 metrics; all IDs below verified from live API response April 2026.

const TW_SHOPS = [
  { market: "NL", flag: "🇳🇱", envKeys: ["SHOPIFY_NL_STORE"] },
  { market: "UK", flag: "🇬🇧", envKeys: ["SHOPIFY_UK_STORE"] },
  { market: "US", flag: "🇺🇸", envKeys: ["SHOPIFY_US_STORE", "TRIPLE_WHALE_SHOP_US"] },
  { market: "EU", flag: "🇩🇪", envKeys: ["SHOPIFY_EU_STORE"] },
] as const;

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function twMetric(metrics: any[], id: string): number | null {
  const m = metrics.find((x: any) => x.id === id);
  return toNumber(m?.values?.current);
}

const MARKET_CURRENCY: Record<string, string> = {
  NL: "EUR",
  UK: "GBP",
  US: "USD",
  EU: "EUR",
};

const fxCache = new Map<string, Promise<number>>();
// Last-known-good rate per currency. Populated on every successful fetch; used
// as a graceful fallback when Frankfurter is unreachable. NEVER fabricate 1.0
// for non-EUR currencies — that silently corrupts UK/US revenue totals.
const fxLastGood = new Map<string, { rate: number; at: number }>();

async function getEurRate(currency: string, start: string, end: string): Promise<number> {
  if (currency === "EUR") return 1;
  const key = `${currency}|${start}|${end}`;
  const cached = fxCache.get(key);
  if (cached) return cached;

  const task = (async () => {
    try {
      const path = start === end ? start : `${start}..${end}`;
      // frankfurter.app now redirects to frankfurter.dev/v1/ — use the new URL directly
      const url = `https://api.frankfurter.dev/v1/${path}?base=${currency}&symbols=EUR`;
      const res = await fetch(url, { cache: "no-store", redirect: "follow" });
      if (res.ok) {
        const data = await res.json();
        const rates = data.rates ?? {};
        // Single-day response: { rates: { EUR: 0.92 } }
        // Range response: { rates: { "2026-04-01": { EUR: 0.92 }, ... } }
        const direct = toNumber(rates.EUR);
        if (direct !== null && direct > 0) {
          fxLastGood.set(currency, { rate: direct, at: Date.now() });
          return direct;
        }
        const series = Object.values(rates)
          .map((r: any) => toNumber(r?.EUR))
          .filter((n): n is number => typeof n === "number" && n > 0);
        if (series.length > 0) {
          const avg = series.reduce((a, b) => a + b, 0) / series.length;
          fxLastGood.set(currency, { rate: avg, at: Date.now() });
          return avg;
        }
        console.warn(
          `FX ${currency}->EUR: no rates in response`,
          JSON.stringify(data).slice(0, 200),
        );
      } else {
        console.warn(`FX ${currency}->EUR: HTTP ${res.status} from ${url}`);
      }
    } catch (err: any) {
      console.warn(`FX ${currency}->EUR failed:`, err?.message);
    }
    // Fall back to last-known-good rate rather than 1.0 (which would silently
    // misrepresent UK/US revenue at parity with EUR).
    const lkg = fxLastGood.get(currency);
    if (lkg) {
      console.warn(
        `FX ${currency}->EUR: using last-known-good rate ${lkg.rate} from ${new Date(lkg.at).toISOString()}`,
      );
      return lkg.rate;
    }
    throw new Error(`FX rate unavailable for ${currency} and no last-known-good cached`);
  })();

  fxCache.set(key, task);
  // Don't poison the cache with a rejected promise — drop on failure so the
  // next call retries Frankfurter.
  task.catch(() => fxCache.delete(key));
  return task;
}

function tripleWhaleTodayHour(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Amsterdam",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Math.min(25, Math.max(1, (Number.isFinite(hour) ? hour : 0) + 1));
}

// Triple Whale: Summary Page endpoint
// POST https://api.triplewhale.com/api/v2/summary-page/get-data
// Docs: https://triplewhale.readme.io/reference/get-summary-page-data
// Returns 698 metrics for a given shopDomain + period.
import { startProgress, markStore, finishProgress } from "./progress.server";

export async function fetchTripleWhale(fromDate?: string, toDate?: string, progressKey?: string) {
  const apiKey = process.env.TRIPLE_WHALE_API_KEY;
  if (!apiKey) return null;

  const start = fromDate ?? startOfMonth();
  const end = toDate ?? today();

  // Determine which stores will actually be fetched (have an env-mapped shop)
  const planned = TW_SHOPS.map(({ market, flag, envKeys }: any) => {
    const shop = (envKeys as string[]).map((k) => process.env[k]).find(Boolean);
    return shop ? { market, flag, shop } : null;
  }).filter(Boolean) as Array<{ market: string; flag: string; shop: string }>;

  if (progressKey) {
    startProgress(
      progressKey,
      planned.map(({ market, flag }) => ({ market, flag })),
    );
  }

  const results = await Promise.all(
    TW_SHOPS.map(async ({ market, flag, envKeys }: any) => {
      const shop = (envKeys as string[]).map((k) => process.env[k]).find(Boolean);
      if (!shop) return { market, flag, live: false };

      // Triple Whale's summary-page endpoint returns 698 metrics; under load it
      // can routinely take 30–50s. Use a 60s timeout and retry once on abort to
      // avoid blanking the dashboard on a single slow response.
      const TW_TIMEOUT_MS = 60_000;
      const callTW = async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TW_TIMEOUT_MS);
        try {
          return await fetch("https://api.triplewhale.com/api/v2/summary-page/get-data", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              shopDomain: shop,
              period: { start, end },
              todayHour: tripleWhaleTodayHour(),
            }),
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      };

      try {
        let res: Response;
        try {
          res = await callTW();
        } catch (firstErr: any) {
          // Retry once on abort/network errors before giving up
          const msg = firstErr?.message || String(firstErr);
          if (/abort|timeout|network/i.test(msg)) {
            console.warn(`Triple Whale ${market} first attempt failed (${msg}), retrying...`);
            res = await callTW();
          } else {
            throw firstErr;
          }
        }

        if (!res.ok) {
          const body = await res.text();
          console.error(`Triple Whale ${market} ${res.status}:`, body.slice(0, 200));
          if (progressKey) markStore(progressKey, market, "error");
          return { market, flag, live: false };
        }

        const data = await res.json();
        const m = data.metrics ?? [];
        const sourceCurrency = MARKET_CURRENCY[market] ?? "EUR";
        const eurRate = await getEurRate(sourceCurrency, start, end);
        const metric = (...ids: string[]) => {
          for (const id of ids) {
            const value = twMetric(m, id);
            if (value != null) return value;
          }
          return null;
        };
        const moneyMetric = (...ids: string[]) => {
          const value = metric(...ids);
          return value == null ? null : value * eurRate;
        };

        // All IDs confirmed from live API (698 metrics) — April 2026
        const row = {
          market,
          flag,
          currency: "EUR",
          sourceCurrency,
          fxRate: eurRate,
          revenue: moneyMetric("grossSales", "sales"), // Gross Sales
          // Triple Whale API title for `netSales` is "Total Sales".
          // Formula: Gross Sales + Shipping + Taxes − Discounts − Refunded Sales − Refunded Shipping − Refunded Taxes.
          netRevenue: moneyMetric("netSales", "sales"),
          newCustomerRev: moneyMetric("newCustomerSales"), // New Customer Revenue
          adSpend: moneyMetric("blendedAds"), // Total blended ad spend
          facebookSpend: moneyMetric("facebookAds"), // Facebook / Meta
          googleSpend: moneyMetric("googleAds"), // Google Ads
          tiktokSpend: moneyMetric("tiktokAds"), // TikTok Ads
          snapchatSpend: moneyMetric("snapchatAds"), // Snapchat Ads
          pinterestSpend: moneyMetric("pinterestAds"), // Pinterest Ads
          bingSpend: moneyMetric("bingAds", "microsoftAds"), // Microsoft / Bing
          klaviyoSpend: moneyMetric("klaviyoCost"), // Klaviyo cost
          appleSpend: moneyMetric("appleSearchAds"), // Apple Search Ads
          amazonSpend: moneyMetric("amazonAds"), // Amazon Ads
          linkedinSpend: moneyMetric("linkedinAds"), // LinkedIn Ads
          twitterSpend: moneyMetric("twitterAds", "xAds"), // Twitter / X Ads
          youtubeSpend: moneyMetric("youtubeAds"), // YouTube Ads
          redditSpend: moneyMetric("redditAds"), // Reddit Ads
          outbrainSpend: moneyMetric("outbrainAds"), // Outbrain
          taboolaSpend: moneyMetric("taboolaAds"), // Taboola
          criteoSpend: moneyMetric("criteoAds"), // Criteo
          influencerSpend: moneyMetric("influencerAds", "influencerCost"), // Influencer
          customSpend: moneyMetric("customAds", "otherAds"), // Custom / other
          roas: twMetric(m, "roas"), // Blended ROAS
          ncRoas: twMetric(m, "newCustomersRoas"), // New Customer ROAS
          fbRoas: twMetric(m, "facebookRoas"), // Facebook ROAS
          googleRoas: twMetric(m, "googleRoas"), // Google ROAS
          mer: twMetric(m, "mer"), // Marketing Efficiency Ratio
          ncpa: moneyMetric("newCustomersCpa"), // New Customer CPA
          ltvCpa: twMetric(m, "ltvCpa"), // LTV:CPA ratio
          aov: moneyMetric("shopifyAov"), // True AOV
          orders: twMetric(m, "shopifyOrders"), // Total orders
          grossProfit: moneyMetric("grossProfit"), // Gross Profit
          netProfit: moneyMetric("totalNetProfit"), // Net Profit (after all costs)
          cogs: moneyMetric("cogs"), // Cost of Goods Sold
          newCustomersPct: twMetric(m, "newCustomersPercent"), // % new customers
          uniqueCustomers: twMetric(m, "uniqueCustomers"), // Unique customers
          // Subscription metrics
          subRevenue: moneyMetric("subscriptionSales", "recurringRevenue", "subscriptionRevenue"),
          subOrders: metric("subscriptionOrders"),
          activeSubscribers: metric("activeSubscribers", "subscriptionActive"),
          newSubscribers: metric("newSubscribers", "subscriptionStarted", "subscriptionNew"),
          cancelledSubs: metric(
            "cancelledSubscribers",
            "subscriptionCancelled",
            "subscriptionChurned",
          ),
          mrr: moneyMetric("mrr", "monthlyRecurringRevenue"),
          churnRate: metric("subscriptionChurnRate", "churnRate"),
        };

        const hasMetrics = Array.isArray(m) && m.length > 0;
        if (progressKey) markStore(progressKey, market, hasMetrics ? "done" : "error");
        if (!hasMetrics) return { market, flag, live: false };

        return { ...row, live: true };
      } catch (err: any) {
        console.error(`Triple Whale ${market}:`, err.message);
        if (progressKey) markStore(progressKey, market, "error");
        return { market, flag, live: false };
      }
    }),
  );

  if (progressKey) finishProgress(progressKey);

  const hasAnyLive = results.some((r) => r.live);
  return hasAnyLive ? results : null;
}

export async function fetchTripleWhaleCustomerEconomics() {
  const apiKey = process.env.TRIPLE_WHALE_API_KEY;
  const shop = process.env.SHOPIFY_NL_STORE;
  if (!apiKey || !shop) return null;

  const end = today();
  const fetchWindow = async (days: number) => {
    const start = daysAgo(days);
    const res = await fetch("https://api.triplewhale.com/api/v2/summary-page/get-data", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        shopDomain: shop,
        period: { start, end },
        todayHour: tripleWhaleTodayHour(),
      }),
    });
    if (!res.ok) throw new Error(`Triple Whale customer economics ${days}D: ${res.status}`);
    const data = await res.json();
    return twMetric(data.metrics ?? [], "uniqueCustomerSales");
  };

  try {
    const [ltv90, ltv365] = await Promise.all([fetchWindow(90), fetchWindow(365)]);
    return { market: "NL", currency: "EUR", ltv90, ltv365, live: ltv90 != null || ltv365 != null };
  } catch (err: any) {
    console.error("Triple Whale customer economics:", err?.message);
    return null;
  }
}

// ─── Daily Profit Fetchers (Shopify daily revenue + TW daily ad spend) ────────
//
// Powers the "Today's Profit" card on the Overview dashboard.
// Cached for 12h (sync.server.ts) — the rolling 30-day chart only needs to be
// refreshed once a day.

function amsterdamDateKey(iso: string): string {
  // Returns "YYYY-MM-DD" in Europe/Amsterdam timezone for an ISO string.
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

/**
 * Fetch the last 365 days of Shopify orders for every store, bucketed by
 * Amsterdam-tz day and converted to EUR. Returns:
 *   { daily: { "YYYY-MM-DD": { revenue: EUR, orders: int } }, byMarket: {...} }
 */
export async function fetchShopifyDaily() {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  if (!clientId) return null;

  const sinceDate = daysAgoIso(365);
  const since = `${sinceDate}T00:00:00Z`;

  const perStore = await Promise.all(
    SHOPIFY_STORES.map(async ({ code, storeKey }: any) => {
      const store = process.env[storeKey];
      if (!store) return { code, daily: {} as Record<string, { revenue: number; orders: number }> };

      const token = await getShopifyToken(store);
      if (!token) return { code, daily: {} };

      try {
        // Reuse fetchShopifyAllOrders but extract per-day buckets ourselves —
        // the existing helper aggregates monthly. Run a fresh paginated query
        // here so we can bucket by day with Amsterdam-tz keys.
        const dailySums: Record<string, { revenue: number; orders: number; currency: string }> = {};
        let cursor: string | null = null;
        let hasNextPage = true;
        let page = 0;
        const maxPages = 240; // up to 60k orders / store / year

        while (hasNextPage && page < maxPages) {
          const res: Response = await fetch(`https://${store}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
            method: "POST",
            headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
            body: JSON.stringify({ query: SHOPIFY_GQL_PAGE(since, cursor) }),
          });
          if (!res.ok) break;
          const json = await res.json();
          if (json.errors) {
            console.error(`Shopify daily ${code} GQL:`, json.errors[0]?.message);
            break;
          }
          const pageData = json.data?.orders ?? {};
          const edges: any[] = pageData.edges ?? [];
          hasNextPage = pageData.pageInfo?.hasNextPage ?? false;
          cursor = pageData.pageInfo?.endCursor ?? null;
          page++;

          for (const { node: o } of edges) {
            const r = parseFloat(o.totalPriceSet.shopMoney.amount);
            const rf = parseFloat(o.totalRefundedSet.shopMoney.amount);
            const net = r - rf;
            const currency = o.totalPriceSet.shopMoney.currencyCode || "EUR";
            const dayKey = amsterdamDateKey(o.createdAt);
            if (!dailySums[dayKey]) dailySums[dayKey] = { revenue: 0, orders: 0, currency };
            dailySums[dayKey].revenue += net;
            dailySums[dayKey].orders += 1;
          }
        }

        // Convert each day to EUR using a single FX rate for the whole period
        // (good enough for a rolling chart; daily FX would be 365 extra calls).
        const sample = Object.values(dailySums)[0];
        const currency = sample?.currency || "EUR";
        const fxRate = await getEurRate(currency, sinceDate, today());
        const daily: Record<string, { revenue: number; orders: number }> = {};
        for (const [k, v] of Object.entries(dailySums)) {
          daily[k] = { revenue: +(v.revenue * fxRate).toFixed(2), orders: v.orders };
        }
        return { code, daily };
      } catch (err: any) {
        console.error(`Shopify daily ${code}:`, err?.message);
        return { code, daily: {} };
      }
    }),
  );

  // Merge per-market into a single daily series
  const merged: Record<string, { revenue: number; orders: number }> = {};
  for (const { daily } of perStore) {
    for (const [k, v] of Object.entries(
      daily as Record<string, { revenue: number; orders: number }>,
    )) {
      if (!merged[k]) merged[k] = { revenue: 0, orders: 0 };
      merged[k].revenue += v.revenue;
      merged[k].orders += v.orders;
    }
  }

  const hasAny = Object.keys(merged).length > 0;
  if (!hasAny) return null;

  return {
    daily: merged,
    byMarket: Object.fromEntries(perStore.map((s) => [s.code, s.daily])),
    calcVersion: 2,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch Triple Whale per-day ad spend & gross profit for the last 30 days
 * across all stores. One TW summary call per (day × store) — heavy but cached
 * for 12h. Returns { daily: { "YYYY-MM-DD": { adSpend, grossProfit } } }
 */
export async function fetchTripleWhaleDaily() {
  const apiKey = process.env.TRIPLE_WHALE_API_KEY;
  if (!apiKey) return null;

  const planned = TW_SHOPS.map(({ market, envKeys }: any) => {
    const shop = (envKeys as string[]).map((k) => process.env[k]).find(Boolean);
    return shop ? { market, shop } : null;
  }).filter(Boolean) as Array<{ market: string; shop: string }>;

  if (planned.length === 0) return null;

  // Build the list of (day, store) pairs we need to fetch — last 30 days incl. today.
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(daysAgoIso(i));

  type DayBucket = { adSpend: number; grossProfit: number; revenue: number };
  const merged: Record<string, DayBucket> = {};
  for (const d of days) merged[d] = { adSpend: 0, grossProfit: 0, revenue: 0 };

  // Concurrency limit — 8 concurrent TW calls.
  const CONCURRENCY = 8;
  const tasks: Array<() => Promise<void>> = [];
  for (const { market, shop } of planned) {
    const sourceCurrency = MARKET_CURRENCY[market] ?? "EUR";
    for (const day of days) {
      tasks.push(async () => {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15_000);
          const res = await fetch("https://api.triplewhale.com/api/v2/summary-page/get-data", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              shopDomain: shop,
              period: { start: day, end: day },
              todayHour: tripleWhaleTodayHour(),
            }),
            signal: ctrl.signal,
          }).finally(() => clearTimeout(timer));
          if (!res.ok) return;
          const data = await res.json();
          const m = data.metrics ?? [];
          const fxRate = await getEurRate(sourceCurrency, day, day);
          const ad = twMetric(m, "blendedAds");
          const gp = twMetric(m, "grossProfit");
          const rv = twMetric(m, "netSales") ?? twMetric(m, "sales");
          if (ad != null) merged[day].adSpend += ad * fxRate;
          if (gp != null) merged[day].grossProfit += gp * fxRate;
          if (rv != null) merged[day].revenue += rv * fxRate;
        } catch (err: any) {
          // Silent — single-day failures shouldn't kill the whole sync
          console.warn(`TW daily ${market} ${day}:`, err?.message);
        }
      });
    }
  }

  // Run in batches of CONCURRENCY
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    await Promise.all(tasks.slice(i, i + CONCURRENCY).map((t) => t()));
  }

  // Round
  const daily: Record<string, DayBucket> = {};
  for (const [k, v] of Object.entries(merged)) {
    daily[k] = {
      adSpend: +v.adSpend.toFixed(2),
      grossProfit: +v.grossProfit.toFixed(2),
      revenue: +v.revenue.toFixed(2),
    };
  }

  return { daily, fetchedAt: new Date().toISOString() };
}

// ─── Juo Subscriptions (NL store) ────────────────────────────────────────────
//
// Base URL: https://api.juo.io/admin/v1
// Auth: X-Juo-Admin-Api-Key header
// Pagination: Link response header with rel="next" (cursor-based)
// Fields: id, status (active|paused|canceled|failed|expired|merged),
//         currencyCode, createdAt, canceledAt, nextBillingDate,
//         items[].price, billingPolicy.interval, billingPolicy.intervalCount

function normalizeToMonthly(price: number, interval: string, intervalCount: number): number {
  const n = intervalCount || 1;
  switch (interval) {
    case "day":
      return (price / n) * 30;
    case "week":
      return (price / n) * 4.33;
    case "year":
      return price / (n * 12);
    default:
      return price / n; // month
  }
}

async function _fetchJuo() {
  const apiKey = process.env.JUO_NL_API_KEY;
  if (!apiKey) {
    console.warn("Juo: JUO_NL_API_KEY not set in this runtime");
    return null;
  }

  const JUO_BASE = "https://api.juo.io";
  const headers = { "X-Juo-Admin-Api-Key": apiKey, Accept: "application/json" };
  const allSubs: any[] = [];
  const MAX_PAGES = 300;
  // Always build absolute URLs — Juo's Link header returns relative paths
  // Fetch the active book directly. Pulling every historical cancelled/expired
  // subscription first can cap the response before all active subscriptions are
  // seen, which makes MRR and active-subscriber finance metrics inaccurate.
  let nextUrl: string | null = `${JUO_BASE}/admin/v1/subscriptions?limit=100&status=active`;
  let page = 0;

  try {
    while (nextUrl && page < MAX_PAGES) {
      const res: Response = await fetch(nextUrl, { headers, cache: "no-store" });

      if (res.status === 429) {
        const reset = parseInt(res.headers.get("X-RateLimit-Reset") ?? "2", 10);
        await new Promise((r) => setTimeout(r, (reset || 2) * 1000));
        continue;
      }
      if (!res.ok) {
        console.error(`Juo API ${res.status}`);
        break;
      }

      const json = await res.json();
      const batch: any[] = json.data ?? json.subscriptions ?? (Array.isArray(json) ? json : []);
      if (batch.length === 0) break;
      allSubs.push(...batch);

      // Follow Link header — Juo returns relative paths like </admin/v1/subscriptions?...>; rel="next"
      const link: string = res.headers.get("Link") ?? "";
      const m: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
      if (m) {
        // Resolve relative or absolute href against JUO_BASE
        const href = m[1];
        nextUrl = href.startsWith("http") ? href : new URL(href, JUO_BASE).toString();
      } else {
        nextUrl = null;
      }
      page++;
    }

    if (!allSubs.length) return null;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeSubs = allSubs.filter((s) => s.status === "active");
    const pausedSubs = allSubs.filter((s) => s.status === "paused");
    const canceledSubs = allSubs.filter((s) => s.status === "canceled");

    // MRR = sum of each active subscription's items, normalised to monthly
    let mrr = 0;
    for (const sub of activeSubs) {
      const interval = sub.billingPolicy?.interval ?? "month";
      const intervalCount = sub.billingPolicy?.intervalCount ?? 1;
      for (const item of sub.items ?? []) {
        const price = parseFloat(item.price ?? item.unitPrice ?? "0");
        mrr += normalizeToMonthly(price, interval, intervalCount);
      }
      // Add delivery price if billed to customer
      if (sub.deliveryPrice > 0) {
        mrr += normalizeToMonthly(parseFloat(sub.deliveryPrice), interval, intervalCount);
      }
    }

    const newThisMonth = allSubs.filter(
      (s) => s.createdAt && new Date(s.createdAt) >= monthStart,
    ).length;
    const churnedThisMonth = canceledSubs.filter(
      (s) => s.canceledAt && new Date(s.canceledAt) >= monthStart,
    ).length;
    const arpu = activeSubs.length > 0 ? mrr / activeSubs.length : null;
    const churnRate =
      activeSubs.length + churnedThisMonth > 0
        ? +((churnedThisMonth / (activeSubs.length + churnedThisMonth)) * 100).toFixed(1)
        : null;

    const currency = activeSubs[0]?.currencyCode ?? "EUR";

    return [
      {
        market: "NL",
        flag: "🇳🇱",
        platform: "juo",
        live: true,
        calcVersion: 2,
        mrr: +mrr.toFixed(2),
        activeSubs: activeSubs.length,
        pausedSubs: pausedSubs.length,
        canceledSubs: canceledSubs.length,
        totalFetched: allSubs.length,
        newThisMonth,
        churnedThisMonth,
        arpu: arpu != null ? +arpu.toFixed(2) : null,
        churnRate,
        currency,
      },
    ];
  } catch (err: any) {
    console.error("Juo fetch error:", err.message);
    return null;
  }
}

// ─── Loop Subscriptions (UK · and future US/EU when keys added) ───────────────
//
// CONFIRMED WORKING — GET https://api.loopsubscriptions.com/admin/2023-10/subscription
// Auth: X-Loop-Token header (NOT Bearer token)
// Returns { success, message, data: [...subscriptions] }
// Each subscription: { id, status, totalLineItemPrice, currencyCode, createdAt, cancelledAt, ... }

const LOOP_STORES = [
  { market: "UK", flag: "🇬🇧", envKey: "LOOP_UK_API_KEY" },
  { market: "US", flag: "🇺🇸", envKey: "LOOP_US_API_KEY" },
  { market: "EU", flag: "🇩🇪", envKey: "LOOP_EU_API_KEY" },
] as const;

async function fetchLoopStore(market: string, flag: string, key: string) {
  const BASE = "https://api.loopsubscriptions.com";
  const headers = { "X-Loop-Token": key, Accept: "application/json" };
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const MAX_PAGES = 500;
  // Loop currently caps this endpoint at 100 rows even when pageSize is higher.
  // Keeping the requested size aligned prevents bad hasNext fallbacks and makes
  // partial-page detection reliable.
  const PAGE_SIZE = 100;

  // Fetch ACTIVE subs (paginated). To compute real churn we make a second pass
  // for CANCELLED subs — without this, churnedThisMonth is structurally always 0.
  async function fetchPages(status: "ACTIVE" | "CANCELLED"): Promise<{
    subs: any[];
    apiReached: boolean;
    rateLimited: boolean;
  }> {
    const subs: any[] = [];
    let apiReached = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) await new Promise((r) => setTimeout(r, 1300));
      const url = `${BASE}/admin/2023-10/subscription?pageNo=${page}&pageSize=${PAGE_SIZE}&status=${status}`;
      let res: Response = await fetch(url, { headers, cache: "no-store" });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 15000));
        res = await fetch(url, { headers, cache: "no-store" });
      }
      if (res.status === 429) {
        console.warn(`Loop ${market} ${status}: rate-limited at page ${page}`);
        return { subs, apiReached, rateLimited: true };
      }
      if (!res.ok) {
        console.error(`Loop ${market} ${status} page ${page} → ${res.status}`);
        break;
      }
      apiReached = true;
      const json = await res.json();
      const batch: any[] = json.data ?? [];
      subs.push(...batch);
      const hasNext =
        json.pageInfo?.hasNextPage ?? json.pagination?.hasNextPage ?? batch.length === PAGE_SIZE;
      if (!hasNext || batch.length === 0) break;
    }
    return { subs, apiReached, rateLimited: false };
  }

  const activeResult = await fetchPages("ACTIVE");
  if (activeResult.rateLimited && !activeResult.apiReached) return null;

  // For CANCELLED, only paginate while results are still within the current
  // month — Loop returns newest first, so we can stop once cancelledAt < monthStart.
  let cancelledSubs: any[] = [];
  try {
    const cancelledResult = await fetchPages("CANCELLED");
    cancelledSubs = cancelledResult.subs;
  } catch (err: any) {
    console.warn(`Loop ${market} cancelled fetch failed:`, err?.message);
  }

  const allSubsFromActive = activeResult.subs;
  if (!activeResult.apiReached) return null;

  const currency = market === "US" ? "USD" : market === "UK" ? "GBP" : "EUR";
  const activeSubs = allSubsFromActive.filter((s) => (s.status ?? "").toUpperCase() === "ACTIVE");
  const mrr = activeSubs.reduce((sum, s) => sum + parseFloat(s.totalLineItemPrice ?? "0"), 0);
  const newThisMonth = allSubsFromActive.filter(
    (s) => s.createdAt && new Date(s.createdAt) >= monthStart,
  ).length;
  const churnedThisMonth = cancelledSubs.filter(
    (s) => s.cancelledAt && new Date(s.cancelledAt) >= monthStart,
  ).length;
  const arpu = activeSubs.length > 0 ? mrr / activeSubs.length : null;
  const churnRate =
    activeSubs.length + churnedThisMonth > 0
      ? +((churnedThisMonth / (activeSubs.length + churnedThisMonth)) * 100).toFixed(1)
      : null;

  return {
    market,
    flag,
    platform: "loop",
    live: true,
    calcVersion: 4,
    mrr: Math.round(mrr),
    activeSubs: activeSubs.length,
    totalFetched: allSubsFromActive.length + cancelledSubs.length,
    newThisMonth,
    churnedThisMonth,
    arpu: arpu != null ? +arpu.toFixed(2) : null,
    churnRate,
    currency,
  };
}

async function _fetchLoop() {
  // Each market has its own API key → its own rate-limit bucket → safe to run in parallel
  const settled = await Promise.allSettled(
    LOOP_STORES.map(({ market, flag, envKey }) => {
      const key = process.env[envKey];
      if (!key) return Promise.resolve(null);
      return fetchLoopStore(market, flag, key);
    }),
  );
  const results = settled.map((r) => (r.status === "fulfilled" ? r.value : null)).filter(Boolean);
  return results.length > 0 ? results : null;
}

// Raw exports — called by /api/sync which writes results to Supabase data_cache
export const fetchJuoRaw = _fetchJuo;
export const fetchLoopRaw = _fetchLoop;
// Aliases for any legacy callers
export const fetchJuo = _fetchJuo;
export const fetchLoop = _fetchLoop;

// ─── Xero ────────────────────────────────────────────────────────────────────
//
// OAuth 2.0 Authorization Code flow — one-time browser auth, then refresh tokens
// Connect once:  GET /api/auth/xero  (redirects to Xero, stores tokens in Supabase)
// Token refresh: automatic via stored refresh_token (60-day TTL, rotated on each refresh)
//
// CONFIRMED WORKING: requires accounting.reports.read + accounting.transactions scopes

async function getXeroToken(): Promise<string | null> {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Load stored row from Supabase
  let row: any = null;
  try {
    const { data } = await serviceClient()
      .from("integrations")
      .select("access_token, refresh_token, expires_at, metadata")
      .eq("provider", "xero")
      .single();
    row = data;
  } catch {
    /* no row yet */
  }

  if (!row) {
    console.warn("Xero: no token stored — visit /api/auth/xero to connect");
    return null;
  }

  // Return cached access_token if still valid (2-min buffer)
  const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && exp > Date.now() + 2 * 60 * 1000) {
    return row.access_token;
  }

  // Refresh using stored refresh_token
  const refreshToken = row.refresh_token ?? row.metadata?.refresh_token;
  if (!refreshToken) {
    console.warn("Xero: access token expired and no refresh_token — reconnect via /api/auth/xero");
    return null;
  }

  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("Xero token refresh failed:", res.status, (await res.text()).slice(0, 200));
      return null;
    }

    const { access_token, refresh_token: new_refresh, expires_in } = await res.json();
    if (!access_token) return null;

    const expiresAt = new Date(Date.now() + ((expires_in ?? 1800) - 60) * 1000).toISOString();
    // Always persist the new refresh_token (Xero rotates them)
    await serviceClient()
      .from("integrations")
      .upsert(
        {
          provider: "xero",
          access_token,
          refresh_token: new_refresh ?? refreshToken,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
          metadata: { ...row.metadata, refresh_token: new_refresh ?? refreshToken },
        },
        { onConflict: "provider" },
      );
    return access_token;
  } catch (err: any) {
    console.error("Xero token refresh error:", err.message);
    return null;
  }
}

async function getXeroTenantId(): Promise<string | null> {
  // tenantId is stored in metadata during the OAuth callback
  try {
    const { data } = await serviceClient()
      .from("integrations")
      .select("metadata")
      .eq("provider", "xero")
      .single();
    return (data?.metadata?.tenant_id as string) ?? null;
  } catch {
    return null;
  }
}

// Parse a numeric cell value from a Xero report
function xNum(cell: any): number {
  const raw = String(cell?.Value ?? "").trim();
  if (!raw || raw === "-") return 0;
  const negative = raw.startsWith("-") || /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[(), ]/g, "").replace(/^-/, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? (negative ? -Math.abs(n) : n) : 0;
}

// Walk report rows recursively. Returns the LAST SummaryRow under any section
// whose title contains the given fragment (case-insensitive). Xero balance
// sheets nest subsections (Bank → Current Assets → Fixed Assets) inside a
// parent "Assets" section whose grand total is the LAST SummaryRow — picking
// the first one would return a sub-total instead.
function xSectionTotal(rows: any[], titleFragment: string, colIdx = 1): number | null {
  const frag = titleFragment.toLowerCase();
  for (const row of rows) {
    const title = (row.Title ?? "").toLowerCase();
    if (row.RowType === "Section" && title.includes(frag)) {
      const findLastSummary = (rs: any[]): number | null => {
        let last: number | null = null;
        for (const r of rs) {
          if (r.RowType === "SummaryRow" && r.Cells?.[colIdx] != null) {
            last = xNum(r.Cells[colIdx]);
          }
          if (r.Rows) {
            const nested = findLastSummary(r.Rows);
            if (nested !== null) last = nested;
          }
        }
        return last;
      };
      const v = findLastSummary(row.Rows ?? []);
      if (v !== null) return v;
    }
    if (row.Rows) {
      const v = xSectionTotal(row.Rows, titleFragment, colIdx);
      if (v !== null) return v;
    }
  }
  return null;
}

// Find a Row (not SummaryRow) whose first cell title matches fragment.
// Used for Xero rows like "Total Assets", "Total Liabilities" that appear
// at top level outside any section.
function xRowByLabel(rows: any[], labelFragment: string, colIdx = 1): number | null {
  const frag = labelFragment.toLowerCase();
  for (const row of rows) {
    if (row.RowType === "Section" && row.Rows) {
      const v = xRowByLabel(row.Rows, labelFragment, colIdx);
      if (v !== null) return v;
    }
    if ((row.RowType === "Row" || row.RowType === "SummaryRow") && row.Cells?.length) {
      const label = String(row.Cells[0]?.Value ?? "").toLowerCase();
      if (label.includes(frag) && row.Cells[colIdx] != null) {
        return xNum(row.Cells[colIdx]);
      }
    }
  }
  return null;
}

function xRowsByLabels(rows: any[], fragments: string[], colIdx = 1) {
  const lowerFrags = fragments.map((f) => f.toLowerCase());
  const matches: { label: string; value: number }[] = [];
  const walk = (rs: any[]) => {
    for (const row of rs ?? []) {
      if ((row.RowType === "Row" || row.RowType === "SummaryRow") && row.Cells?.length) {
        const label = String(row.Cells[0]?.Value ?? "").trim();
        const lower = label.toLowerCase();
        if (label && lowerFrags.some((frag) => lower.includes(frag)) && row.Cells[colIdx] != null) {
          matches.push({ label, value: xNum(row.Cells[colIdx]) });
        }
      }
      if (row.Rows) walk(row.Rows);
    }
  };
  walk(rows);
  return matches;
}

export async function fetchXero() {
  const [token, tenantId] = await Promise.all([getXeroToken(), getXeroTenantId()]);
  if (!token) return null;
  if (!tenantId) {
    console.error("Xero: no tenantId — visit /api/auth/xero to connect your organization");
    return null;
  }

  const h = {
    Authorization: `Bearer ${token}`,
    "Xero-tenant-id": tenantId,
    Accept: "application/json",
  };
  const BASE = "https://api.xero.com/api.xro/2.0";

  // 12 months back, monthly breakdown
  const fromDate = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 11);
    d.setDate(1);
    return d.toISOString().split("T")[0];
  })();
  const toDateStr = today();
  const monthStartStr = startOfMonth();

  // Helper: fetch + log status & body snippet on failure so we can diagnose
  // exactly which Xero endpoint rejects the request (scopes, params, etc).
  const xeroFetch = async (label: string, url: string) => {
    try {
      const r = await fetch(url, { headers: h, cache: "no-store" });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        console.error(`Xero ${label} ${r.status}: ${body.slice(0, 300)}`);
        return null;
      }
      return await r.json();
    } catch (err: any) {
      console.error(`Xero ${label} fetch error:`, err?.message);
      return null;
    }
  };

  const xeroFetchAllInvoicePages = async (url: string) => {
    const invoices: any[] = [];
    let lastJson: any = null;
    for (let page = 1; page <= 50; page++) {
      const pageUrl = `${url}${url.includes("?") ? "&" : "?"}page=${page}`;
      const json = await xeroFetch(`Invoices page ${page}`, pageUrl);
      if (!json) return null;
      const pageInvoices: any[] = json.Invoices ?? [];
      invoices.push(...pageInvoices);
      lastJson = json;
      if (pageInvoices.length < 100) break;
    }
    return { ...lastJson, Invoices: invoices };
  };

  try {
    // Bank Transactions: last 90 days
    const bankTxSince = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return d.toISOString().split("T")[0];
    })();
    const bankTxUrl = `${BASE}/BankTransactions?where=${encodeURIComponent(`Date>=DateTime(${bankTxSince.replaceAll("-", ",")})`)}`;

    const [
      plS,
      balS,
      cashS,
      invS,
      accS,
      billS,
      draftS,
      contactsS,
      itemsS,
      bankTxS,
      journalsS,
      trackingS,
    ] = await Promise.allSettled([
      // P&L: omit periods/timeframe — fromDate→toDate alone yields a single column
      // total for the range; with timeframe=MONTH Xero auto-derives the period count.
      xeroFetch(
        "P&L",
        `${BASE}/Reports/ProfitAndLoss?fromDate=${fromDate}&toDate=${toDateStr}&timeframe=MONTH&periods=11`,
      ),
      xeroFetch("BalanceSheet", `${BASE}/Reports/BalanceSheet?date=${toDateStr}`),
      xeroFetch(
        "BankSummary",
        `${BASE}/Reports/BankSummary?fromDate=${monthStartStr}&toDate=${toDateStr}`,
      ),
      xeroFetchAllInvoicePages(
        `${BASE}/Invoices?Statuses=AUTHORISED,SUBMITTED&where=${encodeURIComponent('Type=="ACCREC"')}`,
      ),
      // Full Chart of Accounts filtered to BANK type — gives every bank account
      // with its native CurrencyCode, even when balance is zero.
      xeroFetch("Accounts", `${BASE}/Accounts?where=${encodeURIComponent('Type=="BANK"')}`),
      // Bills to pay (ACCPAY)
      xeroFetchAllInvoicePages(
        `${BASE}/Invoices?Statuses=AUTHORISED,SUBMITTED&where=${encodeURIComponent('Type=="ACCPAY"')}`,
      ),
      // Draft invoices owed to you
      xeroFetchAllInvoicePages(
        `${BASE}/Invoices?Statuses=DRAFT&where=${encodeURIComponent('Type=="ACCREC"')}`,
      ),
      // Contacts (customers + suppliers)
      xeroFetch("Contacts", `${BASE}/Contacts?summaryOnly=true&page=1`),
      // Items / Products
      xeroFetch("Items", `${BASE}/Items`),
      // Bank Transactions (recent 90 days)
      xeroFetch("BankTransactions", bankTxUrl),
      // Manual Journals
      xeroFetch("ManualJournals", `${BASE}/ManualJournals`),
      // Tracking Categories
      xeroFetch("TrackingCategories", `${BASE}/TrackingCategories`),
    ]);

    const plData = plS.status === "fulfilled" ? plS.value : null;
    const balData = balS.status === "fulfilled" ? balS.value : null;
    const cashData = cashS.status === "fulfilled" ? cashS.value : null;
    const invData = invS.status === "fulfilled" ? invS.value : null;
    const accData = accS.status === "fulfilled" ? accS.value : null;
    const billData = billS.status === "fulfilled" ? billS.value : null;
    const draftData = draftS.status === "fulfilled" ? draftS.value : null;
    const contactsData = contactsS.status === "fulfilled" ? contactsS.value : null;
    const itemsData = itemsS.status === "fulfilled" ? itemsS.value : null;
    const bankTxData = bankTxS.status === "fulfilled" ? bankTxS.value : null;
    const journalsData = journalsS.status === "fulfilled" ? journalsS.value : null;
    const trackingData = trackingS.status === "fulfilled" ? trackingS.value : null;

    // ── Parse P&L report ─────────────────────────────────────────────────────
    const revenueByMonth: Record<string, number> = {};
    const expensesByMonth: Record<string, number> = {};
    const grossProfitByMonth: Record<string, number> = {};
    const netProfitByMonth: Record<string, number> = {};
    let ytdRevenue: number | null = null;
    let ytdExpenses: number | null = null;
    let ytdNetProfit: number | null = null;

    const plReport = plData?.Reports?.[0];
    if (plReport) {
      const rows: any[] = plReport.Rows ?? [];
      const headerRow = rows.find((r: any) => r.RowType === "Header");
      // colLabels: ["", "Apr 25", "May 25", ..., "YTD"] OR just one period column
      const colLabels: string[] = (headerRow?.Cells ?? []).map((c: any) => String(c.Value ?? ""));
      const ytdCol = colLabels.findIndex((l) => /ytd/i.test(l));

      const extractCols = (cells: any[]): { byMonth: Record<string, number>; ytd: number } => {
        const byMonth: Record<string, number> = {};
        let ytd = 0;
        cells.forEach((cell: any, i: number) => {
          if (i === 0) return;
          if (i === ytdCol) {
            ytd = xNum(cell);
            return;
          }
          const label = colLabels[i];
          if (label) byMonth[label] = xNum(cell);
        });
        // If no YTD column, sum the monthly values as YTD
        if (ytdCol === -1) ytd = Object.values(byMonth).reduce((s, v) => s + v, 0);
        return { byMonth, ytd };
      };

      // Recursively walk every Section, classifying by title & accumulating values.
      // Xero P&L structure varies: some orgs use "Income"+"Less Operating Expenses",
      // others "Trading Income"+"Less Cost of Sales"+"Gross Profit"+"Less Operating Expenses".
      // We accept any of those and use the LAST SummaryRow as the section total.
      const walk = (sections: any[]) => {
        for (const section of sections) {
          if (section.RowType !== "Section") continue;
          const title = (section.Title ?? "").toLowerCase();
          const subRows: any[] = section.Rows ?? [];
          // Find LAST summary row of this section (Xero puts subsection totals first)
          let summaryRow: any = null;
          for (const r of subRows) {
            if (r.RowType === "SummaryRow") summaryRow = r;
          }

          if (summaryRow) {
            const { byMonth, ytd } = extractCols(summaryRow.Cells ?? []);

            const isRevenue =
              title.includes("income") ||
              title.includes("revenue") ||
              title.includes("turnover") ||
              title.includes("sales");
            const isCogs =
              title.includes("cost of sales") ||
              title.includes("cost of goods") ||
              title.includes("cogs");
            const isGross = title.includes("gross profit") || title.includes("gross margin");
            const isExpense =
              title.includes("operating expense") ||
              title.includes("less operating") ||
              title.includes("overhead") ||
              title.includes("administrative") ||
              (title.includes("expense") && !title.includes("non-operating"));
            const isNet =
              title.includes("net profit") ||
              title.includes("net loss") ||
              title.includes("profit for") ||
              title.includes("net income");

            if (isRevenue && !isGross && !isNet) {
              Object.entries(byMonth).forEach(([m, v]) => {
                revenueByMonth[m] = (revenueByMonth[m] ?? 0) + v;
              });
              ytdRevenue = (ytdRevenue ?? 0) + ytd;
            } else if (isGross) {
              Object.entries(byMonth).forEach(([m, v]) => {
                grossProfitByMonth[m] = v;
              });
            } else if (isCogs || isExpense) {
              Object.entries(byMonth).forEach(([m, v]) => {
                expensesByMonth[m] = (expensesByMonth[m] ?? 0) + v;
              });
              ytdExpenses = (ytdExpenses ?? 0) + ytd;
            } else if (isNet) {
              Object.entries(byMonth).forEach(([m, v]) => {
                netProfitByMonth[m] = v;
              });
              ytdNetProfit = ytd;
            }
          }

          // Some Xero orgs put "Net Profit" as a top-level Row (not Section)
          // — so also scan child rows recursively.
          walk(subRows);
        }

        // Also scan top-level Rows for "Net Profit" / "Total Income" labels
        for (const r of sections) {
          if (r.RowType === "Row" && r.Cells?.length) {
            const label = String(r.Cells[0]?.Value ?? "").toLowerCase();
            if (label.includes("net profit") || label.includes("net income")) {
              const { byMonth, ytd } = extractCols(r.Cells);
              Object.entries(byMonth).forEach(([m, v]) => {
                netProfitByMonth[m] = v;
              });
              if (ytdNetProfit === null) ytdNetProfit = ytd;
            }
          }
        }
      };
      walk(rows);

      // Fallback for Xero P&L variants where the Section title is blank or
      // generic, but the row label carries the useful name (e.g. "Total Income",
      // "Sales", "Turnover"). Prefer total/summary rows to avoid double-counting.
      if (Object.keys(revenueByMonth).length === 0) {
        const revenueTotals: any[][] = [];
        const revenueDetails: any[][] = [];
        const scanRevenueRows = (rs: any[]) => {
          for (const r of rs) {
            if ((r.RowType === "Row" || r.RowType === "SummaryRow") && r.Cells?.length) {
              const label = String(r.Cells[0]?.Value ?? "").toLowerCase();
              const looksRevenue =
                /(income|revenue|turnover|sales|fees)/i.test(label) &&
                !/(cost of sales|cost of goods|cogs|expense|gross|net|liabilit|asset|equity)/i.test(
                  label,
                );
              if (looksRevenue) {
                const isTotal = r.RowType === "SummaryRow" || /^total\b/i.test(label);
                (isTotal ? revenueTotals : revenueDetails).push(r.Cells);
              }
            }
            if (r.Rows) scanRevenueRows(r.Rows);
          }
        };
        scanRevenueRows(rows);

        const candidates =
          revenueTotals.length > 0 ? [revenueTotals[revenueTotals.length - 1]] : revenueDetails;
        for (const cells of candidates) {
          const { byMonth, ytd } = extractCols(cells);
          Object.entries(byMonth).forEach(([m, v]) => {
            revenueByMonth[m] = (revenueByMonth[m] ?? 0) + v;
          });
          ytdRevenue = (ytdRevenue ?? 0) + ytd;
        }
      }

      // If Xero returns a valid P&L with only costs/net profit for the period,
      // keep the month rows visible and treat missing revenue as zero rather
      // than failing the whole sync.
      if (Object.keys(revenueByMonth).length === 0) {
        const plMonths = new Set([
          ...Object.keys(expensesByMonth),
          ...Object.keys(grossProfitByMonth),
          ...Object.keys(netProfitByMonth),
        ]);
        if (plMonths.size > 0) {
          plMonths.forEach((m) => {
            revenueByMonth[m] = 0;
          });
          if (ytdRevenue === null) ytdRevenue = 0;
        }
      }

      // Fallback YTD calc if not picked up from a YTD column or section
      if (ytdRevenue === null && Object.keys(revenueByMonth).length > 0) {
        ytdRevenue = Object.values(revenueByMonth).reduce((s, v) => s + v, 0);
      }
      if (ytdExpenses === null && Object.keys(expensesByMonth).length > 0) {
        ytdExpenses = Object.values(expensesByMonth).reduce((s, v) => s + v, 0);
      }
      if (ytdNetProfit === null && Object.keys(netProfitByMonth).length > 0) {
        ytdNetProfit = Object.values(netProfitByMonth).reduce((s, v) => s + v, 0);
      }
    }

    // ── Diagnostics: collect labels actually present in the Xero reports ─────
    const collectLabels = (rs: any[], out: { sections: string[]; rows: string[] }) => {
      for (const r of rs ?? []) {
        if (r.RowType === "Section") {
          if (r.Title) out.sections.push(String(r.Title));
          if (r.Rows) collectLabels(r.Rows, out);
        } else if ((r.RowType === "Row" || r.RowType === "SummaryRow") && r.Cells?.length) {
          const lbl = String(r.Cells[0]?.Value ?? "").trim();
          if (lbl) out.rows.push(lbl);
        }
      }
    };
    const plLabels = { sections: [] as string[], rows: [] as string[] };
    const bsLabels = { sections: [] as string[], rows: [] as string[] };
    if (plReport) collectLabels(plReport.Rows ?? [], plLabels);

    // ── Parse Balance Sheet ───────────────────────────────────────────────────
    // Xero BS structure: top-level Sections "Assets", "Liabilities", "Equity"
    // each with nested subsections + a final SummaryRow that's the section total.
    // Some orgs also expose explicit "Total Assets" Row at top level.
    const balRows: any[] = balData?.Reports?.[0]?.Rows ?? [];
    collectLabels(balRows, bsLabels);
    // Track every lookup attempt for diagnostics: which label/section we tried,
    // and whether Xero returned a match. The UI can show this verbatim.
    const bsLookups: {
      field: string;
      query: string;
      type: "row" | "section";
      matched: boolean;
      value: number | null;
    }[] = [];
    const tryRow = (field: string, q: string) => {
      const v = xRowByLabel(balRows, q);
      bsLookups.push({ field, query: q, type: "row", matched: v !== null, value: v });
      return v;
    };
    const trySection = (field: string, q: string) => {
      const v = xSectionTotal(balRows, q);
      bsLookups.push({ field, query: q, type: "section", matched: v !== null, value: v });
      return v;
    };
    const totalAssets =
      tryRow("Total Assets", "total assets") ?? trySection("Total Assets", "assets");
    const currentAssets =
      trySection("Current Assets", "current assets") ??
      tryRow("Current Assets", "total current assets") ??
      // Some Xero orgs (especially small ones) expose only a top-level "Bank"
      // section instead of a "Current Assets" wrapper. Treat Total Bank as
      // current assets in that case.
      trySection("Current Assets", "bank") ??
      tryRow("Current Assets", "total bank");
    const fixedAssets =
      trySection("Fixed Assets", "fixed assets") ??
      trySection("Fixed Assets", "non-current assets") ??
      tryRow("Fixed Assets", "total fixed assets") ??
      tryRow("Fixed Assets", "total non-current assets");
    const parsedTotalLiabilities =
      tryRow("Total Liabilities", "total liabilities") ??
      tryRow("Total Liabilities", "total liability") ??
      trySection("Total Liabilities", "liabilities") ??
      trySection("Total Liabilities", "liability");
    const currentLiabilities =
      trySection("Current Liabilities", "current liabilities") ??
      trySection("Current Liabilities", "current liability") ??
      tryRow("Current Liabilities", "total current liabilities") ??
      tryRow("Current Liabilities", "total current liability");
    const parsedEquity =
      tryRow("Equity", "total equity") ??
      tryRow("Equity", "total capital") ??
      tryRow("Equity", "net assets") ??
      trySection("Equity", "equity") ??
      trySection("Equity", "capital") ??
      trySection("Equity", "net assets");
    const arBalanceRows = xRowsByLabels(balRows, [
      "accounts receivable",
      "trade debtors",
      "debtors",
    ]);
    const arBalance =
      arBalanceRows.length > 0 ? arBalanceRows[arBalanceRows.length - 1].value : null;

    // Detect whether Xero returned ANY liabilities section/row at all.
    // If Assets and Equity are present but liabilities are entirely absent,
    // this org legitimately has no liabilities — treat as 0 instead of failing.
    const hasLiabilitiesSection =
      bsLabels.sections.some((s) => /liabilit/i.test(s)) ||
      bsLabels.rows.some((r) => /liabilit/i.test(r));

    const derivedCurrentAssets =
      currentAssets ??
      (totalAssets !== null && fixedAssets !== null ? totalAssets - fixedAssets : null);
    const derivedFixedAssets =
      fixedAssets ??
      (totalAssets !== null && currentAssets !== null ? totalAssets - currentAssets : null);
    const totalLiabilities =
      parsedTotalLiabilities ??
      (totalAssets !== null && parsedEquity !== null ? totalAssets - parsedEquity : null) ??
      (!hasLiabilitiesSection && (totalAssets !== null || parsedEquity !== null) ? 0 : null);
    const equity =
      parsedEquity ??
      (totalAssets !== null && totalLiabilities !== null ? totalAssets - totalLiabilities : null);
    const derivedCurrentLiabilities =
      currentLiabilities ?? (totalLiabilities !== null ? totalLiabilities : null);

    // ── Parse Bank Summary + full Accounts list ──────────────────────────────
    // 1) Build a base list from /Accounts (every BANK account, with currency,
    //    even if balance is zero). 2) Overlay balances parsed from BankSummary
    //    when available. This mirrors what the Xero dashboard shows.
    type BankAcct = {
      name: string;
      balance: number;
      currency: string;
      accountId?: string;
      code?: string;
      bankAccountNumber?: string;
      status?: string;
    };
    const acctsList: any[] = accData?.Accounts ?? [];
    const bankAccountsMap = new Map<string, BankAcct>();
    for (const a of acctsList) {
      const name = String(a.Name ?? "").trim();
      if (!name) continue;
      bankAccountsMap.set(name.toLowerCase(), {
        name,
        balance: 0,
        currency: a.CurrencyCode ?? "EUR",
        accountId: a.AccountID,
        code: a.Code,
        bankAccountNumber: a.BankAccountNumber,
        status: a.Status,
      });
    }

    let cashBalance: number | null = null;
    const cashReport = cashData?.Reports?.[0];
    if (cashReport) {
      for (const section of cashReport.Rows ?? []) {
        if (section.RowType !== "Section") continue;
        for (const row of section.Rows ?? []) {
          if (row.RowType !== "Row" || !row.Cells?.length) continue;
          const name = String(row.Cells[0]?.Value ?? "").trim();
          const bal = xNum(row.Cells[row.Cells.length - 1]);
          if (!name || name === "Account") continue;
          const key = name.toLowerCase();
          const existing = bankAccountsMap.get(key);
          if (existing) {
            existing.balance = bal;
          } else {
            bankAccountsMap.set(key, { name, balance: bal, currency: "EUR" });
          }
          cashBalance = (cashBalance ?? 0) + bal;
        }
      }
    }
    const bankAccounts: BankAcct[] = Array.from(bankAccountsMap.values()).sort(
      (a, b) => Math.abs(b.balance) - Math.abs(a.balance),
    );

    // ── Parse Invoices (Accounts Receivable) ─────────────────────────────────
    const invoices: any[] = invData?.Invoices ?? [];
    const invoiceAccountsReceivable = invoices.reduce((s, inv) => s + (inv.AmountDue ?? 0), 0);
    const overdueInvoices = invoices.filter((inv) => inv.IsOverdue);
    const overdueAmount = overdueInvoices.reduce((s, inv) => s + (inv.AmountDue ?? 0), 0);
    const accountsReceivable = invoiceAccountsReceivable || arBalance || 0;

    // ── Parse Bills (Accounts Payable / ACCPAY) ──────────────────────────────
    const bills: any[] = billData?.Invoices ?? [];
    const billsAwaitingAmount = bills.reduce((s, b) => s + (b.AmountDue ?? 0), 0);
    const overdueBills = bills.filter((b) => b.IsOverdue);
    const overdueBillsAmount = overdueBills.reduce((s, b) => s + (b.AmountDue ?? 0), 0);

    // ── Parse Drafts (ACCREC) ────────────────────────────────────────────────
    const drafts: any[] = draftData?.Invoices ?? [];
    const draftsAmount = drafts.reduce((s, d) => s + (d.Total ?? d.AmountDue ?? 0), 0);

    // ── Parse Contacts ──────────────────────────────────────────────────────
    const contactsList: any[] = contactsData?.Contacts ?? [];
    const customers = contactsList
      .filter((c) => c.IsCustomer)
      .map((c) => ({
        id: c.ContactID,
        name: String(c.Name ?? ""),
        email: c.EmailAddress ?? null,
        outstanding: c.Balances?.AccountsReceivable?.Outstanding ?? 0,
        overdue: c.Balances?.AccountsReceivable?.Overdue ?? 0,
      }))
      .sort((a, b) => Math.abs(b.outstanding) - Math.abs(a.outstanding));
    const suppliers = contactsList
      .filter((c) => c.IsSupplier)
      .map((c) => ({
        id: c.ContactID,
        name: String(c.Name ?? ""),
        email: c.EmailAddress ?? null,
        outstanding: c.Balances?.AccountsPayable?.Outstanding ?? 0,
        overdue: c.Balances?.AccountsPayable?.Overdue ?? 0,
      }))
      .sort((a, b) => Math.abs(b.outstanding) - Math.abs(a.outstanding));

    // ── Parse Items ─────────────────────────────────────────────────────────
    const itemsList: any[] = itemsData?.Items ?? [];
    const items = itemsList.map((i) => ({
      id: i.ItemID,
      code: i.Code ?? "",
      name: String(i.Name ?? i.Description ?? ""),
      salesPrice: i.SalesDetails?.UnitPrice ?? null,
      purchasePrice: i.PurchaseDetails?.UnitPrice ?? null,
      isTracked: !!i.IsTrackedAsInventory,
      qtyOnHand: i.QuantityOnHand ?? null,
    }));

    // ── Parse Bank Transactions ─────────────────────────────────────────────
    const bankTxList: any[] = bankTxData?.BankTransactions ?? [];
    const bankTransactions = bankTxList
      .map((t) => ({
        id: t.BankTransactionID,
        date: t.DateString ?? t.Date ?? null,
        type: t.Type ?? "",
        contact: t.Contact?.Name ?? "",
        account: t.BankAccount?.Name ?? "",
        reference: t.Reference ?? "",
        total: t.Total ?? 0,
        currency: t.CurrencyCode ?? "EUR",
        status: t.Status ?? "",
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 100);

    // ── Parse Manual Journals ───────────────────────────────────────────────
    const journalsList: any[] = journalsData?.ManualJournals ?? [];
    const manualJournals = journalsList
      .map((j) => ({
        id: j.ManualJournalID,
        date: j.Date ?? null,
        narration: String(j.Narration ?? ""),
        status: j.Status ?? "",
        lineCount: (j.JournalLines ?? []).length,
        total:
          (j.JournalLines ?? []).reduce((s: number, l: any) => s + Math.abs(l.LineAmount ?? 0), 0) /
          2,
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 50);

    // ── Parse Tracking Categories ───────────────────────────────────────────
    const trackingList: any[] = trackingData?.TrackingCategories ?? [];
    const trackingCategories = trackingList.map((t) => ({
      id: t.TrackingCategoryID,
      name: String(t.Name ?? ""),
      status: t.Status ?? "",
      options: (t.Options ?? []).map((o: any) => ({
        id: o.TrackingOptionID,
        name: String(o.Name ?? ""),
        status: o.Status ?? "",
      })),
    }));

    const live =
      Object.keys(revenueByMonth).length > 0 || totalAssets !== null || cashBalance !== null;

    return {
      live,
      tenantId,
      revenueByMonth,
      expensesByMonth,
      grossProfitByMonth,
      netProfitByMonth,
      ytdRevenue: ytdRevenue !== null ? Math.round(ytdRevenue) : null,
      ytdExpenses: ytdExpenses !== null ? Math.round(ytdExpenses) : null,
      ytdNetProfit: ytdNetProfit !== null ? Math.round(ytdNetProfit) : null,
      totalAssets: totalAssets !== null ? Math.round(totalAssets) : null,
      currentAssets: derivedCurrentAssets !== null ? Math.round(derivedCurrentAssets) : null,
      fixedAssets: derivedFixedAssets !== null ? Math.round(derivedFixedAssets) : null,
      totalLiabilities: totalLiabilities !== null ? Math.round(totalLiabilities) : null,
      currentLiabilities:
        derivedCurrentLiabilities !== null ? Math.round(derivedCurrentLiabilities) : null,
      equity: equity !== null ? Math.round(equity) : null,
      cashBalance: cashBalance !== null ? Math.round(cashBalance) : null,
      bankAccounts,
      accountsReceivable: accountsReceivable > 0 ? Math.round(accountsReceivable) : null,
      unpaidInvoiceCount: invoices.length,
      overdueAmount: overdueAmount > 0 ? Math.round(overdueAmount) : null,
      overdueInvoiceCount: overdueInvoices.length,
      // Bills (ACCPAY)
      billsAwaitingAmount: billsAwaitingAmount > 0 ? Math.round(billsAwaitingAmount) : null,
      billsAwaitingCount: bills.length,
      overdueBillsAmount: overdueBillsAmount > 0 ? Math.round(overdueBillsAmount) : null,
      overdueBillsCount: overdueBills.length,
      // Drafts (ACCREC)
      draftsAmount: draftsAmount > 0 ? Math.round(draftsAmount) : null,
      draftsCount: drafts.length,
      // Extended Xero data
      customers,
      suppliers,
      items,
      bankTransactions,
      manualJournals,
      trackingCategories,
      currency: "EUR",
      _diagnostics: {
        profitAndLoss: {
          reportPresent: !!plReport,
          sectionTitles: plLabels.sections,
          rowLabels: plLabels.rows.slice(0, 80),
          parsedRevenueMonths: Object.keys(revenueByMonth),
          parsedExpenseMonths: Object.keys(expensesByMonth),
          parsedNetProfitMonths: Object.keys(netProfitByMonth),
        },
        balanceSheet: {
          reportPresent: balRows.length > 0,
          sectionTitles: bsLabels.sections,
          rowLabels: bsLabels.rows.slice(0, 80),
          lookups: bsLookups,
          accountsReceivableRows: arBalanceRows,
        },
        bankSummary: {
          reportPresent: !!cashReport,
          accountsFromAccountsApi: acctsList.length,
          accountsFound: bankAccounts.map((b) => `${b.name} (${b.currency})`),
        },
        invoices: {
          endpointResponded: invData !== null,
          totalReturned: invoices.length,
          amountDueTotal: invoiceAccountsReceivable,
          billsReturned: bills.length,
          draftsReturned: drafts.length,
        },
      },
    };
  } catch (err: any) {
    console.error("Xero fetch error:", err.message);
    return null;
  }
}

// ─── Jortt ───────────────────────────────────────────────────────────────────
//
// Full-scope Jortt integration — uses ALL scopes the OAuth client has access to.
// Per the Jortt docs (https://developer.jortt.nl/#scopes) the client_credentials
// flow supports these scopes (one token per scope, since multi-scope requests
// fail with invalid_scope):
//
//   invoices:read       customers:read      estimates:read
//   expenses:read       financing:read      organizations:read
//   payroll:read        reports:read
//
// Each scope is requested independently; scopes that fail are logged but don't
// abort the overall fetch. With expenses:read granted the OpEx breakdown is
// built from real purchase invoices instead of being empty.

const JORTT_BASE = "https://api.jortt.nl";
const JORTT_TOKEN_URL = "https://app.jortt.nl/oauth-provider/oauth/token";

const JORTT_ALL_SCOPES = [
  "invoices:read",
  "expenses:read",
  "reports:read",
  "customers:read",
  "financing:read",
  "organizations:read",
  "payroll:read",
  "estimates:read",
] as const;

// OpEx categorisation.
//
// Primary signal: Jortt's native ledger-account category (`category` /
// `ledger_account_category` on the account, e.g. `personeelskosten`,
// `huisvestingskosten`, `verkoopkosten`, `algemene_kosten`,
// `afschrijvingen`, `financiele_baten_lasten`). This is what Jortt itself
// uses to build its P&L, so matching it produces numbers that line up with
// Jortt's own reports.
//
// Fallback: Dutch account-number ranges (4xxx series for OpEx) when the
// category field is absent.
//
// Last resort: keyword match on description for items without a ledger
// account (rare — usually free-text expenses).
type OpExCat = "team" | "agencies" | "content" | "software" | "rent" | "other";

// Jortt category slug → bucket
const JORTT_LEDGER_CATEGORY_TO_BUCKET: Record<string, OpExCat> = {
  // personnel / payroll
  personeelskosten: "team",
  loonkosten: "team",
  salariskosten: "team",
  // housing / rent / utilities
  huisvestingskosten: "rent",
  // sales / marketing / agencies / content
  verkoopkosten: "agencies",
  marketingkosten: "agencies",
  reclamekosten: "agencies",
  // general / office / software typically lands here in Jortt
  algemene_kosten: "software",
  kantoorkosten: "software",
  autokosten: "other",
  afschrijvingen: "other",
  financiele_baten_lasten: "other",
  rentelasten: "other",
};

// Keyword fallback (only used when no ledger account info is available)
const JORTT_KEYWORD_FALLBACK: Record<string, OpExCat> = {
  personeel: "team",
  salaris: "team",
  loon: "team",
  freelance: "team",
  "management fee": "team",
  managementfee: "team",
  agency: "agencies",
  bureau: "agencies",
  marketing: "agencies",
  reclame: "agencies",
  ads: "agencies",
  content: "content",
  creator: "content",
  influencer: "content",
  samenwerking: "content",
  software: "software",
  saas: "software",
  klaviyo: "software",
  shopify: "software",
  "triple whale": "software",
  monday: "software",
  notion: "software",
  figma: "software",
  adobe: "software",
  google: "software",
  microsoft: "software",
  huur: "rent",
  rent: "rent",
  energie: "rent",
  internet: "rent",
  kantoor: "rent",
};

function bucketFromLedger(
  ledgerAcct: any | null | undefined,
): OpExCat | null {
  if (!ledgerAcct) return null;
  const catRaw =
    ledgerAcct.category ??
    ledgerAcct.ledger_account_category ??
    ledgerAcct.account_category ??
    "";
  const cat = String(catRaw).toLowerCase().replace(/[\s-]+/g, "_");
  if (cat && JORTT_LEDGER_CATEGORY_TO_BUCKET[cat]) {
    return JORTT_LEDGER_CATEGORY_TO_BUCKET[cat];
  }
  // Fall back to the Dutch 4xxx OpEx code ranges
  const code = String(ledgerAcct.code ?? ledgerAcct.number ?? "").trim();
  const num = parseInt(code, 10);
  if (Number.isFinite(num)) {
    if (num >= 4000 && num <= 4099) return "team";        // personnel
    if (num >= 4100 && num <= 4199) return "rent";        // housing
    if (num >= 4200 && num <= 4299) return "other";       // exploitation
    if (num >= 4300 && num <= 4399) return "other";       // depreciation
    if (num >= 4400 && num <= 4499) return "software";    // general / office
    if (num >= 4500 && num <= 4599) return "other";       // car / transport
    if (num >= 4600 && num <= 4699) return "agencies";    // selling / marketing
    if (num >= 4700 && num <= 4799) return "other";       // financial
  }
  return null;
}

function bucketFromKeywords(text: string): OpExCat {
  const lower = (text ?? "").toLowerCase();
  for (const [kw, cat] of Object.entries(JORTT_KEYWORD_FALLBACK)) {
    if (lower.includes(kw)) return cat;
  }
  return "other";
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");
}

function monthIsoKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Get an access_token for ONE scope (Jortt requires one scope per token).
async function getJorttTokenForScope(scope: string): Promise<string | null> {
  const clientId = process.env.JORTT_CLIENT_ID;
  const clientSecret = process.env.JORTT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(JORTT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
      cache: "no-store",
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[Jortt] token (scope=${scope}) ${res.status}: ${err.slice(0, 160)}`);
      return null;
    }
    const json: any = await res.json();
    return json.access_token ?? null;
  } catch (err: any) {
    console.error(`[Jortt] token (scope=${scope}) failed:`, err.message);
    return null;
  }
}

// Page through a Jortt list endpoint with the given token. Stops on first
// non-OK response, error body, or empty page. Caps at maxPages to keep the
// per-request total inside the Worker time budget.
async function jorttPaginate(token: string, path: string, maxPages = 20): Promise<any[]> {
  const out: any[] = [];
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  for (let p = 1; p <= maxPages; p++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${JORTT_BASE}${path}${sep}per_page=100&page=${p}`;
    try {
      const r = await fetch(url, { headers, cache: "no-store" });
      if (!r.ok) {
        console.warn(`[Jortt] ${path} p${p}: ${r.status}`);
        break;
      }
      const j: any = await r.json();
      if (j?.error) {
        console.warn(`[Jortt] ${path} p${p} error:`, j.error?.key ?? j.error?.message);
        break;
      }
      const batch: any[] = j?.data ?? [];
      out.push(...batch);
      if (batch.length < 100) break;
    } catch (err: any) {
      console.warn(`[Jortt] ${path} p${p} fetch failed:`, err.message);
      break;
    }
  }
  return out;
}

async function jorttGet(token: string, path: string): Promise<any | null> {
  try {
    const r = await fetch(`${JORTT_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) {
      console.warn(`[Jortt] GET ${path}: ${r.status}`);
      return null;
    }
    const j: any = await r.json();
    if (j?.error) return null;
    return j;
  } catch (err: any) {
    console.warn(`[Jortt] GET ${path} failed:`, err.message);
    return null;
  }
}

export async function fetchJortt() {
  // 1. Validate every scope up-front and remember which ones we got.
  // We grab tokens in parallel — Jortt's token endpoint is independent per scope
  // (and we serialise all reads under each token before requesting the next).
  const scopeResults = await Promise.all(
    JORTT_ALL_SCOPES.map(async (scope) => ({
      scope,
      token: await getJorttTokenForScope(scope),
    })),
  );
  const tokens: Record<string, string | null> = Object.fromEntries(
    scopeResults.map(({ scope, token }) => [scope, token]),
  );
  const grantedScopes = scopeResults.filter((s) => s.token).map((s) => s.scope);

  console.log(
    `[Jortt] granted scopes (${grantedScopes.length}/${JORTT_ALL_SCOPES.length}):`,
    grantedScopes.join(", ") || "(none)",
  );

  if (grantedScopes.length === 0) return null;

  // 2. Invoices (revenue, AR, invoice list) — invoices:read
  let invoices: any[] = [];
  let unpaidInvoices: any[] = [];
  if (tokens["invoices:read"]) {
    const t = tokens["invoices:read"]!;
    invoices = await jorttPaginate(t, "/v1/invoices?invoice_status=sent", 10);
    unpaidInvoices = await jorttPaginate(t, "/v1/invoices?invoice_status=unpaid", 5);
  }

  // 3. Expenses (real OpEx) — expenses:read (v3 endpoint)
  let expenses: any[] = [];
  if (tokens["expenses:read"]) {
    expenses = await jorttPaginate(tokens["expenses:read"]!, "/v3/expenses", 20);
  }

  // 4. Reports — reports:read
  let plRes: any = null,
    cashRes: any = null,
    balanceRes: any = null,
    btwRes: any = null,
    dashInvRes: any = null;
  if (tokens["reports:read"]) {
    const t = tokens["reports:read"]!;
    plRes = await jorttGet(t, "/v1/reports/summaries/profit_and_loss");
    cashRes = await jorttGet(t, "/v1/reports/summaries/cash_and_bank");
    balanceRes = await jorttGet(t, "/v1/reports/summaries/balance");
    btwRes = await jorttGet(t, "/v1/reports/summaries/btw");
    dashInvRes = await jorttGet(t, "/v1/reports/summaries/invoices");
  }

  // 5. Customers — customers:read
  let customers: any[] = [];
  if (tokens["customers:read"]) {
    customers = await jorttPaginate(tokens["customers:read"]!, "/v1/customers", 10);
  }

  // 6. Bank accounts + transactions — financing:read (v3)
  let bankAccounts: any[] = [];
  const bankTransactions: any[] = [];
  if (tokens["financing:read"]) {
    const t = tokens["financing:read"]!;
    bankAccounts = await jorttPaginate(t, "/v3/bank_accounts", 5);
    // Pull recent transactions per bank account (cap totals for speed)
    for (const acct of bankAccounts.slice(0, 5)) {
      const id = acct?.id;
      if (!id) continue;
      const tx = await jorttPaginate(t, `/v3/bank_accounts/${id}/transactions`, 5);
      bankTransactions.push(...tx.map((x: any) => ({ ...x, _bank_account_id: id })));
    }
  }

  // 7. Organization + tradenames + ledger accounts + labels — organizations:read
  let organization: any = null;
  let tradenames: any[] = [];
  let ledgerAccounts: any[] = [];
  let labels: any[] = [];
  if (tokens["organizations:read"]) {
    const t = tokens["organizations:read"]!;
    organization = await jorttGet(t, "/v1/organizations");
    tradenames = await jorttPaginate(t, "/v1/tradenames", 3);
    // Pull ledger accounts from BOTH the invoices and expenses endpoints so
    // we get a full id→category map (Jortt splits them by intent).
    const [invLedgers, expLedgers] = await Promise.all([
      jorttPaginate(t, "/v1/ledger_accounts/invoices", 5),
      jorttPaginate(t, "/v1/ledger_accounts/expenses", 10),
    ]);
    const seen = new Set<string>();
    ledgerAccounts = [...invLedgers, ...expLedgers].filter((l: any) => {
      const id = String(l?.id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    labels = await jorttPaginate(t, "/v1/labels", 3);
  }

  // 8. Payroll — payroll:read
  let payroll: any[] = [];
  if (tokens["payroll:read"]) {
    payroll = await jorttPaginate(tokens["payroll:read"]!, "/v1/loonjournaalposten", 10);
  }

  // 9. Estimates — estimates:read
  let estimates: any[] = [];
  if (tokens["estimates:read"]) {
    estimates = await jorttPaginate(tokens["estimates:read"]!, "/v2/estimates", 5);
  }

  // ── Aggregations ────────────────────────────────────────────────────────────

  // Revenue by month from invoices
  const revenueByMonth: Record<string, number> = {};
  for (const inv of invoices) {
    const mk = monthKey(inv.invoice_date ?? inv.created_at ?? "");
    if (!mk) continue;
    const total = parseFloat(inv.invoice_total_incl_vat?.value ?? inv.invoice_total?.value ?? "0");
    if (!Number.isFinite(total) || total <= 0) continue;
    revenueByMonth[mk] = (revenueByMonth[mk] ?? 0) + total;
  }

  // Expenses by month + OpEx breakdown from real expenses
  const expensesByMonth: Record<string, number> = {};
  // monthKey -> { team, agencies, content, software, other }
  const opexBuckets: Record<
    string,
    {
      ym: string;
      team: number;
      agencies: number;
      content: number;
      software: number;
      rent: number;
      other: number;
    }
  > = {};
  // category -> name -> amount  (rolled-up detail items)
  const opexDetailMap: Record<string, Record<string, number>> = {
    team: {},
    agencies: {},
    content: {},
    software: {},
    rent: {},
    other: {},
  };

  // Build a fast id → ledger account map for category lookup.
  const ledgerById = new Map<string, any>();
  for (const la of ledgerAccounts) {
    if (la?.id) ledgerById.set(String(la.id), la);
  }

  for (const ex of expenses) {
    if (String(ex.expense_type ?? "").toLowerCase() !== "cost") continue;
    const dateStr = ex.vat_date ?? ex.delivery_period ?? ex.created_at ?? "";
    const mk = monthKey(dateStr);
    const ym = monthIsoKey(dateStr);
    if (!mk || !ym) continue;
    const amountStr =
      ex.raw_total_amount?.value ??
      ex.raw_total_amount?.amount ??
      ex.total_amount_incl_vat?.value ??
      ex.total_amount_incl_vat?.amount ??
      ex.total_amount?.value ??
      ex.total_amount?.amount ??
      ex.amount?.value ??
      ex.amount?.amount ??
      "0";
    const amount = Math.abs(parseFloat(String(amountStr)));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    expensesByMonth[mk] = (expensesByMonth[mk] ?? 0) + amount;

    // Categorise: prefer Jortt's native ledger-account category, then
    // account-number ranges, then keyword fallback on description.
    const ledger =
      (ex.ledger_account_id && ledgerById.get(String(ex.ledger_account_id))) ||
      null;
    const ledgerName =
      ex.ledger_account_name ?? ledger?.name ?? "";
    const desc = ex.description ?? ex.supplier_name ?? ledgerName ?? "other";
    const cat: OpExCat =
      bucketFromLedger(ledger) ?? bucketFromKeywords(`${desc} ${ledgerName}`);

    if (!opexBuckets[mk])
      opexBuckets[mk] = { ym, team: 0, agencies: 0, content: 0, software: 0, rent: 0, other: 0 };
    opexBuckets[mk][cat] += amount;

    const itemName = (desc || "Unknown").trim().slice(0, 80);
    opexDetailMap[cat][itemName] = (opexDetailMap[cat][itemName] ?? 0) + amount;
  }

  // Payroll (loonjournaalposten) — Jortt's payroll posts are NOT included in
  // /v3/expenses, so add them to the team bucket explicitly. Each post has a
  // total gross/employer cost we can extract from common field shapes.
  for (const post of payroll) {
    const dateStr =
      post?.payment_date ??
      post?.period_end ??
      post?.period ??
      post?.date ??
      post?.created_at ??
      "";
    const mk = monthKey(dateStr);
    const ym = monthIsoKey(dateStr);
    if (!mk || !ym) continue;
    const amountStr =
      post?.total_employer_cost?.value ??
      post?.employer_cost?.value ??
      post?.total_amount?.value ??
      post?.gross_amount?.value ??
      post?.amount?.value ??
      post?.total ??
      post?.amount ??
      "0";
    const amount = Math.abs(parseFloat(String(amountStr)));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    expensesByMonth[mk] = (expensesByMonth[mk] ?? 0) + amount;
    if (!opexBuckets[mk])
      opexBuckets[mk] = { ym, team: 0, agencies: 0, content: 0, software: 0, rent: 0, other: 0 };
    opexBuckets[mk].team += amount;

    const employee =
      post?.employee_name ??
      post?.employee?.name ??
      post?.description ??
      "Payroll";
    const itemName = `Payroll · ${String(employee).trim().slice(0, 70)}`;
    opexDetailMap.team[itemName] = (opexDetailMap.team[itemName] ?? 0) + amount;
  }

  // Sort months chronologically for opexByMonth
  const sortedMonths = Object.keys(opexBuckets).sort((a, b) => {
    const pa = new Date(a.replace(" '", " 20"));
    const pb = new Date(b.replace(" '", " 20"));
    return pa.getTime() - pb.getTime();
  });
  const opexByMonth = sortedMonths.map((m) => {
    const b = opexBuckets[m];
    const total = b.team + b.agencies + b.content + b.software + b.rent + b.other;
    return { month: m, ...b, total };
  });

  // opexDetail in shape consumed by OpExBreakdownSection
  const opexDetail: Record<
    string,
    { label: string; items: Array<{ name: string; amount: number }> }
  > = {};
  const catLabels: Record<string, string> = {
    team: "Team",
    agencies: "Agencies",
    content: "Content samenwerkingen",
    software: "Software",
    rent: "Rent & utilities",
    other: "Other costs",
  };
  for (const cat of Object.keys(opexDetailMap)) {
    const items = Object.entries(opexDetailMap[cat])
      .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 25);
    opexDetail[cat] = { label: catLabels[cat] ?? cat, items };
  }

  // AR + cash + P&L summary
  const accountsReceivable = unpaidInvoices.reduce((sum: number, inv: any) => {
    const v = parseFloat(inv.invoice_due_amount?.value ?? inv.invoice_total?.value ?? "0");
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);

  const cashBalance: number | null = (() => {
    if (cashRes) {
      const v = cashRes?.total_balance?.value ?? cashRes?.balance?.value ?? cashRes?.cash ?? null;
      if (v != null) {
        const n = parseFloat(String(v));
        if (Number.isFinite(n)) return n;
      }
    }
    // Fall back to summing live bank account balances
    if (bankAccounts.length > 0) {
      const sum = bankAccounts.reduce((s: number, a: any) => {
        const v = parseFloat(
          String(a?.current_balance?.value ?? a?.balance?.value ?? a?.balance ?? "0"),
        );
        return s + (Number.isFinite(v) ? v : 0);
      }, 0);
      return sum > 0 ? sum : null;
    }
    return null;
  })();

  const plSummary = plRes
    ? {
        revenue: parseFloat(plRes?.revenue?.value ?? plRes?.turnover?.value ?? "0"),
        costs: parseFloat(plRes?.costs?.value ?? plRes?.expenses?.value ?? "0"),
        grossProfit: parseFloat(plRes?.gross_profit?.value ?? plRes?.net_result?.value ?? "0"),
      }
    : null;

  const expenseCount = expenses.filter((e: any) => {
    const v = Math.abs(
      parseFloat(
        String(
          e.raw_total_amount?.value ??
            e.raw_total_amount?.amount ??
            e.total_amount_incl_vat?.value ??
            e.total_amount_incl_vat?.amount ??
            e.total_amount?.value ??
            e.total_amount?.amount ??
            "0",
        ),
      ),
    );
    return String(e.expense_type ?? "").toLowerCase() === "cost" && Number.isFinite(v) && v > 0;
  }).length;
  const invoiceCount = invoices.filter(
    (i: any) => parseFloat(i.invoice_total_incl_vat?.value ?? i.invoice_total?.value ?? "0") > 0,
  ).length;

  const live =
    Object.keys(revenueByMonth).length > 0 ||
    cashBalance !== null ||
    plSummary !== null ||
    invoices.length > 0 ||
    expenses.length > 0;

  return {
    // Core financials (consumed by FinanceDashboard)
    revenueByMonth,
    expensesByMonth,
    opexByMonth,
    opexDetail,
    cashBalance,
    accountsReceivable: accountsReceivable > 0 ? accountsReceivable : null,
    plSummary,
    balanceReport: balanceRes,
    unpaidInvoiceCount: unpaidInvoices.length,
    invoiceCount,
    expenseCount,
    live,

    // Extended data — available to any UI that wants to surface it
    bankAccounts,
    bankTransactionsCount: bankTransactions.length,
    customersCount: customers.length,
    customers: customers.slice(0, 50),
    organization,
    tradenames,
    ledgerAccountsCount: ledgerAccounts.length,
    labels,
    payrollCount: payroll.length,
    estimatesCount: estimates.length,
    btwSummary: btwRes,
    dashboardInvoices: dashInvRes,

    // Diagnostics — useful for the sync/debug screens
    grantedScopes,
    deniedScopes: JORTT_ALL_SCOPES.filter((s) => !tokens[s]),
  };
}

// ─── Shopify Repeat Purchase Funnel ──────────────────────────────────────────
// Pulls the last 5 years of orders for every Shopify store, builds per-customer
// order timelines, then computes cohort-based repeat rates (1st → 2nd → 3rd → 4th
// + 5th/6th/7th orders) and monthly cohort tables.
//
// Cohort definition: customers whose FIRST order falls in the cohort month.
// Repeat rate = % of cohort that placed an Nth order within the observation window.
// Slow first sync (multi-minute on big stores) — cached for 720 minutes.
export async function fetchShopifyRepeatFunnel() {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  if (!clientId) return null;

  // This is intentionally independent from the Overview page date filter.
  // Five years gives enough customer history to avoid marking old repeat buyers
  // as new first-time buyers in recent cohorts.
  const lookbackYears = 5;
  const lookbackDays = 365 * lookbackYears + 2;
  const sinceDate = daysAgoIso(lookbackDays);
  const since = `${sinceDate}T00:00:00Z`;

  // customerId → sorted list of observed order timestamps + Shopify's lifetime
  // order count. Lifetime count prevents a truncated lookback window from
  // pretending older customers are new first-time buyers.
  const customerOrders = new Map<string, { dates: string[]; lifetimeOrders: number }>();
  const storeCoverage: Array<{ code: string; pages: number; truncated: boolean; firstOrder: string | null; lastOrder: string | null }> = [];

  for (const { code, storeKey } of SHOPIFY_STORES) {
    const store = process.env[storeKey];
    if (!store) continue;
    const token = await getShopifyToken(store);
    if (!token) continue;

    let cursor: string | null = null;
    let hasNextPage = true;
    let page = 0;
    const maxPages = 1200; // up to ~300k orders per store over 5y (oldest-first so partial fetches still cover early cohorts)
    let firstOrder: string | null = null;
    let lastOrder: string | null = null;

    try {
      while (hasNextPage && page < maxPages) {
        const res: Response = await fetch(`https://${store}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
          body: JSON.stringify({ query: SHOPIFY_GQL_PAGE(since, cursor) }),
        });
        if (!res.ok) break;
        const json = await res.json();
        if (json.errors) {
          console.error(`Shopify repeat ${code} GQL:`, json.errors[0]?.message);
          break;
        }
        const pageData = json.data?.orders ?? {};
        const edges: any[] = pageData.edges ?? [];
        hasNextPage = pageData.pageInfo?.hasNextPage ?? false;
        cursor = pageData.pageInfo?.endCursor ?? null;
        page++;

        for (const { node: o } of edges) {
          const cid = o.customer?.id;
          if (!cid) continue;
          firstOrder = firstOrder ?? o.createdAt;
          lastOrder = o.createdAt;
          const lifetimeOrders = Number(o.customer?.numberOfOrders ?? 0) || 0;
          const entry = customerOrders.get(cid) ?? { dates: [], lifetimeOrders: 0 };
          entry.dates.push(o.createdAt);
          entry.lifetimeOrders = Math.max(entry.lifetimeOrders, lifetimeOrders, entry.dates.length);
          customerOrders.set(cid, entry);
        }
      }
    } catch (err: any) {
      console.error(`Shopify repeat ${code}:`, err?.message);
    }
    storeCoverage.push({ code, pages: page, truncated: hasNextPage, firstOrder, lastOrder });
  }

  if (customerOrders.size === 0) return null;

  // Sort each customer's observed order timeline ascending
  for (const entry of customerOrders.values()) entry.dates.sort();

  const now = Date.now();
  const DAY = 86_400_000;
  // Customers whose first recorded order is right at the dataset boundary
  // are almost certainly older customers with prior orders we can't see.
  const datasetEdgeTs = now - (lookbackDays - 10) * DAY;

  // Bucket by TRUE first-order month. The fixed 120–90 day cohort can be empty
  // when Shopify only has recent first-time buyers; picking the latest non-empty
  // cohort with at least 30 days of observation keeps the dashboard populated
  // with real, auditable Shopify customer history.
  const monthLabel = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");
  const monthKeyFromDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthStartFromKey = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, 1);
  };

  const cohortBuckets = new Map<string, string[][]>(); // monthKey → array of customer order arrays
  for (const entry of customerOrders.values()) {
    const orders = entry.dates;
    if (orders.length === 0) continue;
    // If Shopify says the customer has more lifetime orders than we fetched in
    // the lookback, their first order is outside this dataset, so exclude them
    // from first-time-buyer cohorts instead of inflating recent cohort sizes.
    if (entry.lifetimeOrders > orders.length) continue;
    const first = new Date(orders[0]);
    if (first.getTime() <= datasetEdgeTs) continue;
    const key = monthKeyFromDate(first);
    if (!cohortBuckets.has(key)) cohortBuckets.set(key, []);
    cohortBuckets.get(key)!.push(orders);
  }

  // ── Repeat funnel from the newest fully mature cohort ─────────────────────
  // The dashboard headline is "Repeat to 3rd order", so a cohort needs a real
  // 3rd-order observation window. Showing a 30/60-day cohort here makes the
  // number look precise while it is still materially incomplete.
  const allCohortCandidates = Array.from(cohortBuckets.entries())
    .map(([key, orders]) => {
      const start = monthStartFromKey(key);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      return { key, orders, start, end, daysSinceEnd: Math.floor((now - end.getTime()) / DAY) };
    })
    .filter((c) => c.orders.length > 0)
    .sort((a, b) => b.start.getTime() - a.start.getTime());

  const selectedCohort =
    allCohortCandidates.find((c) => c.daysSinceEnd >= 90) ??
    allCohortCandidates.find((c) => c.daysSinceEnd >= 30) ??
    allCohortCandidates[0] ??
    null;
  const cohortOrders = selectedCohort?.orders ?? [];
  const cohortSize = cohortOrders.length;
  const selectedSecondMatured = (selectedCohort?.daysSinceEnd ?? 0) >= 30;
  const selectedDeepMatured = (selectedCohort?.daysSinceEnd ?? 0) >= 90;
  const reachedN = [0, 0, 0, 0, 0, 0, 0];
  for (const orders of cohortOrders) {
    const reached = Math.min(orders.length, 7);
    for (let i = 0; i < reached; i++) reachedN[i]++;
  }

  const funnel = reachedN.map((c, i) => ({
    order: i + 1,
    customers: c,
    rate:
      cohortSize > 0 &&
      (i === 0 || (i === 1 && selectedSecondMatured) || (i >= 2 && selectedDeepMatured))
        ? +((c / cohortSize) * 100).toFixed(1)
        : null,
    maturing: i > 0 && !((i === 1 && selectedSecondMatured) || (i >= 2 && selectedDeepMatured)),
  }));

  // ── Monthly cohort table — last 6 calendar months ───────────────────
  const monthlyCohorts: Array<{
    month: string;
    size: number;
    second: number | null;
    third: number | null;
    fourth: number | null;
    avgOrders: number | null;
    maturing: boolean;
  }> = [];

  // last 6 calendar months including current — ensures the oldest mature
  // cohort (>= 90 days observed) is visible alongside still-maturing months.
  const now2 = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
    const key = monthKeyFromDate(d);
    const cohort = cohortBuckets.get(key) ?? [];
    const size = cohort.length;
    const monthAge = i; // months ago (0 = current)
    // Need at least 30 days for 2nd-order and 90 days for 3rd/4th-order data.
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
    const daysSinceCohortEnd = (now - monthEnd) / DAY;
    const secondMatured = daysSinceCohortEnd >= 30;
    const deepMatured = daysSinceCohortEnd >= 90;
    const maturing = !deepMatured;

    if (size === 0) {
      monthlyCohorts.push({
        month: monthLabel(d) + (monthAge === 0 ? " (MTD)" : ""),
        size: 0,
        second: null,
        third: null,
        fourth: null,
        avgOrders: null,
        maturing,
      });
      continue;
    }

    let s2 = 0,
      s3 = 0,
      s4 = 0,
      totalOrders = 0;
    for (const orders of cohort) {
      if (orders.length >= 2) s2++;
      if (orders.length >= 3) s3++;
      if (orders.length >= 4) s4++;
      totalOrders += orders.length;
    }
    monthlyCohorts.push({
      month: monthLabel(d) + (monthAge === 0 ? " (MTD)" : ""),
      size,
      second: secondMatured ? +((s2 / size) * 100).toFixed(1) : null,
      third: deepMatured ? +((s3 / size) * 100).toFixed(1) : null,
      fourth: deepMatured ? +((s4 / size) * 100).toFixed(1) : null,
      avgOrders: secondMatured ? +(totalOrders / size).toFixed(2) : null,
      maturing,
    });
  }

  return {
    calcVersion: 6,
    sourceWindowDays: lookbackDays,
    sourceWindowYears: lookbackYears,
    sourceStart: sinceDate,
    sourceEnd: today(),
    storeCoverage,
    cohortSize,
    cohortMonth: selectedCohort ? monthLabel(selectedCohort.start) : null,
    cohortWindowDays: selectedCohort ? Math.max(0, selectedCohort.daysSinceEnd) : 0,
    cohortMatureForSecond: selectedSecondMatured,
    cohortMatureForThird: selectedDeepMatured,
    cohortStartedDaysAgo: selectedCohort
      ? Math.floor((now - selectedCohort.start.getTime()) / DAY)
      : 0,
    cohortEndedDaysAgo: selectedCohort ? selectedCohort.daysSinceEnd : 0,
    funnel,
    monthlyCohorts,
    totalCustomersAnalyzed: customerOrders.size,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Shopify Payments — pending payouts per market ─────────────────────────
// Returns one row per store with the live pending balance + scheduled/in-transit
// payouts. Stores without Shopify Payments simply return live:false.
export async function fetchShopifyPayouts() {
  const results = await Promise.all(
    SHOPIFY_STORES.map(async (s) => {
      const store = process.env[s.storeKey];
      if (!store) return { market: s.code, name: s.name, live: false, reason: "store env not set" };
      const token = await getShopifyToken(store);
      if (!token) return { market: s.code, name: s.name, live: false, reason: "no token" };

      const headers = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
      const base = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments`;

      try {
        const [balRes, payRes] = await Promise.all([
          fetch(`${base}/balance.json`, { headers }),
          fetch(`${base}/payouts.json?status=scheduled&limit=50`, { headers }),
        ]);

        // 404 => store not on Shopify Payments
        if (balRes.status === 404) {
          return { market: s.code, name: s.name, live: false, reason: "Shopify Payments not enabled" };
        }
        if (!balRes.ok) {
          return { market: s.code, name: s.name, live: false, reason: `balance HTTP ${balRes.status}` };
        }

        const balJson: any = await balRes.json();
        const balances: Array<{ amount: string; currency: string }> = balJson?.balance ?? [];
        const pending = balances.reduce((s, b) => s + Number(b.amount || 0), 0);
        const currency = balances[0]?.currency ?? (s.code === "US" ? "USD" : s.code === "UK" ? "GBP" : "EUR");

        let scheduledTotal = 0;
        let nextPayoutDate: string | null = null;
        if (payRes.ok) {
          const pj: any = await payRes.json();
          const payouts: any[] = pj?.payouts ?? [];
          scheduledTotal = payouts.reduce((s, p) => s + Number(p.amount || 0), 0);
          const upcoming = payouts
            .map((p) => p.date)
            .filter(Boolean)
            .sort();
          nextPayoutDate = upcoming[0] ?? null;
        }

        return {
          market: s.code,
          name: `Shopify Payments ${s.code}`,
          live: true,
          currency,
          pendingBalance: pending,
          scheduledPayouts: scheduledTotal,
          nextPayoutDate,
        };
      } catch (err: any) {
        return { market: s.code, name: s.name, live: false, reason: err?.message ?? "fetch failed" };
      }
    }),
  );

  return { calcVersion: 1, fetchedAt: new Date().toISOString(), markets: results };
}
