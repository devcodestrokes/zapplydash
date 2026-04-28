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

// Service-role Supabase client — no cookies, works anywhere server-side.
// In the TanStack Worker runtime, process.env may not contain the Supabase
// keys, so we read VITE_* values via import.meta.env at MODULE TOP LEVEL.
// Vite inlines these as string literals at build time, so the Worker bundle
// always has them available regardless of runtime env injection.
// The integrations + data_cache tables have permissive RLS for this use case.
const VITE_SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_PUBLISHABLE_KEY =
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

function serviceClient() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      `Supabase creds missing in fetchers (url=${!!url}, key=${!!key})`
    );
  }
  return createSupabaseJS(url, key, { auth: { persistSession: false } });
}

// ─── Shopify ─────────────────────────────────────────────────────────────────
//
// Uses Shopify OAuth2 client_credentials grant (no user redirect needed).
// Requires: SHOPIFY_APP_CLIENT_ID + SHOPIFY_APP_CLIENT_SECRET in .env.local
//           App must be installed in each store (done in Shopify Partner Dashboard).
// Tokens (~24h TTL) are cached in Supabase integrations table and auto-refreshed.
//
// Confirmed working on all 4 stores: zapply-nl, zapplyde, zapply-usa, zapplygermany

const SHOPIFY_STORES = [
  { code: "NL", flag: "🇳🇱", name: "Netherlands",   storeKey: "SHOPIFY_NL_STORE" },
  { code: "UK", flag: "🇬🇧", name: "United Kingdom", storeKey: "SHOPIFY_UK_STORE" },
  { code: "US", flag: "🇺🇸", name: "United States",  storeKey: "SHOPIFY_US_STORE", status: "scaling" },
  { code: "EU", flag: "🇩🇪", name: "Germany / EU",   storeKey: "SHOPIFY_EU_STORE" },
] as const;

async function getShopifyToken(store: string): Promise<string | null> {
  const clientId     = process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret || !store) return null;

  const provider = `shopify_${store.replace(".myshopify.com", "")}`;

  // 1. Use cached token from Supabase if still valid (with 10-min buffer)
  try {
    const supabase = serviceClient();
    const { data } = await supabase
      .from("integrations")
      .select("access_token, expires_at")
      .eq("provider", provider)
      .single();

    if (data?.access_token) {
      const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : Infinity;
      if (expiresAt > Date.now() + 10 * 60 * 1000) {
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
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    "client_credentials",
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
        { provider, access_token, expires_at: expiresAt, updated_at: new Date().toISOString(), metadata: { shop_domain: store, source: "client_credentials" } },
        { onConflict: "provider" }
      );

    return access_token;
  } catch (err: any) {
    console.error(`Shopify token refresh ${store}:`, err.message);
    return null;
  }
}

// Paginated GQL — one page, with optional cursor for subsequent pages
const SHOPIFY_GQL_PAGE = (since: string, cursor: string | null, until?: string | null) => `{
  orders(first:250, ${cursor ? `after:"${cursor}",` : ""}query:"created_at:>=${since}${until ? ` created_at:<=${until}` : ""} financial_status:paid") {
    pageInfo { hasNextPage endCursor }
    edges { node {
      totalPriceSet    { shopMoney { amount currencyCode } }
      totalDiscountsSet{ shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      createdAt
      customer { id }
    }}
  }
}`;

// Aggregate all orders for a store using cursor pagination (max 40 pages = 10,000 orders)
async function fetchShopifyAllOrders(store: string, token: string, since: string, maxPages = 40, until?: string | null) {
  let revenue = 0, refunds = 0, discounts = 0, orderCount = 0, currency = "EUR";
  const customerIds = new Set<string>();
  const monthlySums: Record<string, { revenue: number; orders: number; refunds: number }> = {};
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage && page < maxPages) {
    const res: Response = await fetch(`https://${store}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SHOPIFY_GQL_PAGE(since, cursor, until) }),
    });
    if (!res.ok) break;
    const json = await res.json();
    if (json.errors) { console.error("Shopify GQL:", json.errors[0]?.message); break; }

    const page_data = json.data?.orders ?? {};
    const edges: any[] = page_data.edges ?? [];
    hasNextPage = page_data.pageInfo?.hasNextPage ?? false;
    cursor      = page_data.pageInfo?.endCursor ?? null;
    page++;

    for (const { node: o } of edges) {
      const r  = parseFloat(o.totalPriceSet.shopMoney.amount);
      const rf = parseFloat(o.totalRefundedSet.shopMoney.amount);
      const dc = parseFloat(o.totalDiscountsSet.shopMoney.amount);
      revenue   += r; refunds += rf; discounts += dc; orderCount++;
      currency = o.totalPriceSet.shopMoney.currencyCode;
      if (o.customer?.id) customerIds.add(o.customer.id);
      const mk = new Date(o.createdAt).toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");
      if (!monthlySums[mk]) monthlySums[mk] = { revenue: 0, orders: 0, refunds: 0 };
      monthlySums[mk].revenue += r;
      monthlySums[mk].refunds += rf;
      monthlySums[mk].orders  += 1;
    }
  }

  return { revenue, refunds, discounts, orderCount, currency, uniqueCustomers: customerIds.size, monthlySums, truncated: hasNextPage };
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
        const agg = await fetchShopifyAllOrders(store, token, since, 40, until);
        const { revenue, refunds, discounts, orderCount, currency, uniqueCustomers, truncated } = agg;
        const aov = orderCount > 0 ? revenue / orderCount : 0;
        if (truncated) console.warn(`Shopify ${code}: revenue capped at 40 pages (10,000 orders)`);
        return { code, flag, name, revenue, refunds, discounts, orders: orderCount, aov, currency, newCustomers: uniqueCustomers, truncated, status: status ?? null, live: true };
      } catch (err: any) {
        console.error(`Shopify ${code} fetch failed:`, err.message);
        return { code, flag, name, status: status ?? null, live: false, error: err.message };
      }
    })
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
        let revenue = 0, refunds = 0, orders = 0;
        let currency = "EUR";
        const hourlyRev: number[] = Array(24).fill(0);
        const hourlyOrd: number[] = Array(24).fill(0);
        let cursor: string | null = null;
        let hasNextPage = true;
        let page = 0;

        while (hasNextPage && page < 5) {
          const res: Response = await fetch(`https://${store}/admin/api/2025-01/graphql.json`, {
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
            const r  = parseFloat(o.totalPriceSet.shopMoney.amount);
            const rf = parseFloat(o.totalRefundedSet.shopMoney.amount);
            revenue += r; refunds += rf; orders++;
            currency = o.totalPriceSet.shopMoney.currencyCode;
            // Amsterdam = UTC+2 (CEST, valid Apr-Oct)
            const hour = (new Date(o.createdAt).getUTCHours() + 2) % 24;
            hourlyRev[hour] += r;
            hourlyOrd[hour]++;
          }
        }

        const hourly = hourlyRev.map((rev, h) => ({ hour: h, revenue: +rev.toFixed(2), orders: hourlyOrd[h] }));
        return { code, flag, name, revenue: +revenue.toFixed(2), refunds: +refunds.toFixed(2), orders, aov: orders > 0 ? +(revenue / orders).toFixed(2) : 0, currency, hourly, live: true };
      } catch (err: any) {
        console.error(`Shopify today ${code}:`, err.message);
        return { code, flag, name, live: false };
      }
    })
  );

  return markets.some((m: any) => m.live) ? { markets, fetchedAt: new Date().toISOString() } : null;
}

// Last 6 months of order aggregates — NL store, fully paginated
export async function fetchShopifyMonthly() {
  const store = process.env.SHOPIFY_NL_STORE;
  if (!store) return null;

  const token = await getShopifyToken(store);
  if (!token) return null;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const since = `${sixMonthsAgo.toISOString().split("T")[0]}T00:00:00Z`;

  try {
    const { monthlySums } = await fetchShopifyAllOrders(store, token, since, 80);
    return Object.entries(monthlySums)
      .sort(([a], [b]) => new Date("1 " + a.replace("'", "20")).getTime() - new Date("1 " + b.replace("'", "20")).getTime())
      .map(([month, data]) => ({ month, ...data }));
  } catch {
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

async function getEurRate(currency: string, start: string, end: string): Promise<number> {
  if (currency === "EUR") return 1;
  const key = `${currency}|${start}|${end}`;
  const cached = fxCache.get(key);
  if (cached) return cached;

  const task = (async () => {
    try {
      const path = start === end ? start : `${start}..${end}`;
      const res = await fetch(`https://api.frankfurter.app/${path}?from=${currency}&to=EUR`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const rates = data.rates ?? {};
        const values = (typeof rates.EUR === "number" || typeof rates.EUR === "string"
          ? [rates.EUR]
          : Object.values(rates).map((r: any) => r?.EUR))
          .map((r: any) => toNumber(r))
          .filter((n): n is number => typeof n === "number");
        if (values.length > 0) return values.reduce((a, b) => a + b, 0) / values.length;
      }
    } catch (err: any) {
      console.warn(`FX ${currency}->EUR failed:`, err?.message);
    }
    return 1;
  })();

  fxCache.set(key, task);
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

export async function fetchTripleWhale(
  fromDate?: string,
  toDate?: string,
  progressKey?: string
) {
  const apiKey = process.env.TRIPLE_WHALE_API_KEY;
  if (!apiKey) return null;

  const start = fromDate ?? startOfMonth();
  const end   = toDate   ?? today();

  // Determine which stores will actually be fetched (have an env-mapped shop)
  const planned = TW_SHOPS
    .map(({ market, flag, envKeys }: any) => {
      const shop = (envKeys as string[]).map((k) => process.env[k]).find(Boolean);
      return shop ? { market, flag, shop } : null;
    })
    .filter(Boolean) as Array<{ market: string; flag: string; shop: string }>;

  if (progressKey) {
    startProgress(progressKey, planned.map(({ market, flag }) => ({ market, flag })));
  }

  const results = await Promise.all(
    TW_SHOPS.map(async ({ market, flag, envKeys }: any) => {
      const shop = (envKeys as string[]).map((k) => process.env[k]).find(Boolean);
      if (!shop) return { market, flag, live: false };

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000); // 20s per store
        const res = await fetch("https://api.triplewhale.com/api/v2/summary-page/get-data", {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ shopDomain: shop, period: { start, end }, todayHour: tripleWhaleTodayHour() }),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));

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
          market, flag,
          currency: "EUR",
          sourceCurrency,
          fxRate: eurRate,
          revenue:         moneyMetric("grossSales", "sales"),  // Gross Sales
          // Triple Whale API title for `netSales` is "Total Sales".
          // Formula: Gross Sales + Shipping + Taxes − Discounts − Refunded Sales − Refunded Shipping − Refunded Taxes.
          netRevenue:      moneyMetric("netSales", "sales"),
          newCustomerRev:  moneyMetric("newCustomerSales"),     // New Customer Revenue
          adSpend:         moneyMetric("blendedAds"),                   // Total blended ad spend
          facebookSpend:   moneyMetric("facebookAds"),                  // Facebook / Meta
          googleSpend:     moneyMetric("googleAds"),                    // Google Ads
          tiktokSpend:     moneyMetric("tiktokAds"),                    // TikTok Ads
          snapchatSpend:   moneyMetric("snapchatAds"),                  // Snapchat Ads
          pinterestSpend:  moneyMetric("pinterestAds"),                 // Pinterest Ads
          bingSpend:       moneyMetric("bingAds", "microsoftAds"),      // Microsoft / Bing
          klaviyoSpend:    moneyMetric("klaviyoCost"),                  // Klaviyo cost
          appleSpend:      moneyMetric("appleSearchAds"),               // Apple Search Ads
          amazonSpend:     moneyMetric("amazonAds"),                    // Amazon Ads
          linkedinSpend:   moneyMetric("linkedinAds"),                  // LinkedIn Ads
          twitterSpend:    moneyMetric("twitterAds", "xAds"),           // Twitter / X Ads
          youtubeSpend:    moneyMetric("youtubeAds"),                   // YouTube Ads
          redditSpend:     moneyMetric("redditAds"),                    // Reddit Ads
          outbrainSpend:   moneyMetric("outbrainAds"),                  // Outbrain
          taboolaSpend:    moneyMetric("taboolaAds"),                   // Taboola
          criteoSpend:     moneyMetric("criteoAds"),                    // Criteo
          influencerSpend: moneyMetric("influencerAds", "influencerCost"), // Influencer
          customSpend:     moneyMetric("customAds", "otherAds"),        // Custom / other
          roas:            twMetric(m, "roas"),                  // Blended ROAS
          ncRoas:          twMetric(m, "newCustomersRoas"),     // New Customer ROAS
          fbRoas:          twMetric(m, "facebookRoas"),         // Facebook ROAS
          googleRoas:      twMetric(m, "googleRoas"),           // Google ROAS
          mer:             twMetric(m, "mer"),                   // Marketing Efficiency Ratio
          ncpa:            moneyMetric("newCustomersCpa"),      // New Customer CPA
          ltvCpa:          twMetric(m, "ltvCpa"),                // LTV:CPA ratio
          aov:             moneyMetric("shopifyAov"),            // True AOV
          orders:          twMetric(m, "shopifyOrders"),         // Total orders
          grossProfit:     moneyMetric("grossProfit"),           // Gross Profit
          netProfit:       moneyMetric("totalNetProfit"),        // Net Profit (after all costs)
          cogs:            moneyMetric("cogs"),                  // Cost of Goods Sold
          newCustomersPct: twMetric(m, "newCustomersPercent"),  // % new customers
          uniqueCustomers: twMetric(m, "uniqueCustomers"),      // Unique customers
          // Subscription metrics
          subRevenue:        moneyMetric("subscriptionSales", "recurringRevenue", "subscriptionRevenue"),
          subOrders:         metric("subscriptionOrders"),
          activeSubscribers: metric("activeSubscribers", "subscriptionActive"),
          newSubscribers:    metric("newSubscribers", "subscriptionStarted", "subscriptionNew"),
          cancelledSubs:     metric("cancelledSubscribers", "subscriptionCancelled", "subscriptionChurned"),
          mrr:               moneyMetric("mrr", "monthlyRecurringRevenue"),
          churnRate:         metric("subscriptionChurnRate", "churnRate"),
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
    })
  );

  if (progressKey) finishProgress(progressKey);

  const hasAnyLive = results.some((r) => r.live);
  return hasAnyLive ? results : null;
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
    case "day":   return (price / n) * 30;
    case "week":  return (price / n) * 4.33;
    case "year":  return price / (n * 12);
    default:      return price / n; // month
  }
}

async function _fetchJuo() {
  const apiKey = process.env.JUO_NL_API_KEY;
  if (!apiKey) {
    console.warn("Juo: JUO_NL_API_KEY not set in this runtime");
    return null;
  }

  const JUO_BASE = "https://api.juo.io";
  const headers  = { "X-Juo-Admin-Api-Key": apiKey, Accept: "application/json" };
  const allSubs: any[] = [];
  const MAX_PAGES = 100;
  // Always build absolute URLs — Juo's Link header returns relative paths
  let nextUrl: string | null = `${JUO_BASE}/admin/v1/subscriptions?limit=100`;
  let page = 0;

  try {
    while (nextUrl && page < MAX_PAGES) {
      const res: Response = await fetch(nextUrl, { headers, cache: "no-store" });

      if (res.status === 429) {
        const reset = parseInt(res.headers.get("X-RateLimit-Reset") ?? "2", 10);
        await new Promise(r => setTimeout(r, (reset || 2) * 1000));
        continue;
      }
      if (!res.ok) { console.error(`Juo API ${res.status}`); break; }

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

    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeSubs   = allSubs.filter(s => s.status === "active");
    const pausedSubs   = allSubs.filter(s => s.status === "paused");
    const canceledSubs = allSubs.filter(s => s.status === "canceled");

    // MRR = sum of each active subscription's items, normalised to monthly
    let mrr = 0;
    for (const sub of activeSubs) {
      const interval      = sub.billingPolicy?.interval ?? "month";
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

    const newThisMonth     = allSubs.filter(s => s.createdAt && new Date(s.createdAt) >= monthStart).length;
    const churnedThisMonth = canceledSubs.filter(s => s.canceledAt && new Date(s.canceledAt) >= monthStart).length;
    const arpu             = activeSubs.length > 0 ? mrr / activeSubs.length : null;
    const churnRate        = (activeSubs.length + churnedThisMonth) > 0
      ? +((churnedThisMonth / (activeSubs.length + churnedThisMonth)) * 100).toFixed(1)
      : null;

    const currency = activeSubs[0]?.currencyCode ?? "EUR";

    return [{
      market: "NL", flag: "🇳🇱", platform: "juo", live: true,
      mrr: +mrr.toFixed(2), activeSubs: activeSubs.length,
      pausedSubs: pausedSubs.length, canceledSubs: canceledSubs.length,
      totalFetched: allSubs.length, newThisMonth, churnedThisMonth,
      arpu: arpu != null ? +arpu.toFixed(2) : null, churnRate, currency,
    }];
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
  const BASE    = "https://api.loopsubscriptions.com";
  const headers = { "X-Loop-Token": key, Accept: "application/json" };
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const allSubs: any[] = [];
  const MAX_PAGES = 60;
  let apiReached  = false; // true once we get at least one 200 response

  for (let page = 1; page <= MAX_PAGES; page++) {
    // Loop rate limit: ~1 req/s — wait 600ms between every page
    if (page > 1) await new Promise(r => setTimeout(r, 600));

    let res: Response = await fetch(`${BASE}/admin/2023-10/subscription?limit=50&page=${page}`, {
      headers, cache: "no-store",
    });

    // On 429: wait 15s and retry once — if still 429, stop gracefully with data collected so far
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 15000));
      res = await fetch(`${BASE}/admin/2023-10/subscription?limit=50&page=${page}`, { headers, cache: "no-store" });
    }
    if (res.status === 429) {
      console.warn(`Loop ${market}: rate-limited at page ${page}, returning ${allSubs.length} subs collected so far`);
      break; // Return partial data — don't drop everything we've already fetched
    }

    if (!res.ok) { console.error(`Loop ${market} page ${page} → ${res.status}`); break; }

    apiReached = true;
    const json   = await res.json();
    const batch: any[] = json.data ?? [];
    allSubs.push(...batch);
    if (!json.pageInfo?.hasNextPage || batch.length === 0) break;
  }

  // Return null only if the API never responded (key invalid / network error)
  if (!apiReached) return null;

  const currency         = market === "US" ? "USD" : market === "UK" ? "GBP" : "EUR";
  const activeSubs       = allSubs.filter(s => s.status === "ACTIVE");
  const canceledSubs     = allSubs.filter(s => s.status === "CANCELLED");
  const mrr              = activeSubs.reduce((sum, s) => sum + parseFloat(s.totalLineItemPrice ?? "0"), 0);
  const newThisMonth     = allSubs.filter(s => s.createdAt && new Date(s.createdAt) >= monthStart).length;
  const churnedThisMonth = canceledSubs.filter(s => s.cancelledAt && new Date(s.cancelledAt) >= monthStart).length;
  const arpu             = activeSubs.length > 0 ? mrr / activeSubs.length : null;
  const churnRate        = (activeSubs.length + churnedThisMonth) > 0
    ? +((churnedThisMonth / (activeSubs.length + churnedThisMonth)) * 100).toFixed(1)
    : null;

  return {
    market, flag, platform: "loop", live: true,
    mrr: Math.round(mrr), activeSubs: activeSubs.length,
    totalFetched: allSubs.length, newThisMonth, churnedThisMonth,
    arpu: arpu != null ? +arpu.toFixed(2) : null, churnRate, currency,
  };
}

async function _fetchLoop() {
  // Each market has its own API key → its own rate-limit bucket → safe to run in parallel
  const settled = await Promise.allSettled(
    LOOP_STORES.map(({ market, flag, envKey }) => {
      const key = process.env[envKey];
      if (!key) return Promise.resolve(null);
      return fetchLoopStore(market, flag, key);
    })
  );
  const results = settled
    .map(r => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean);
  return results.length > 0 ? results : null;
}

// Raw exports — called by /api/sync which writes results to Supabase data_cache
export const fetchJuoRaw  = _fetchJuo;
export const fetchLoopRaw = _fetchLoop;
// Aliases for any legacy callers
export const fetchJuo  = _fetchJuo;
export const fetchLoop = _fetchLoop;

// ─── Xero ────────────────────────────────────────────────────────────────────
//
// OAuth 2.0 Authorization Code flow — one-time browser auth, then refresh tokens
// Connect once:  GET /api/auth/xero  (redirects to Xero, stores tokens in Supabase)
// Token refresh: automatic via stored refresh_token (60-day TTL, rotated on each refresh)
//
// CONFIRMED WORKING: requires accounting.reports.read + accounting.transactions scopes

async function getXeroToken(): Promise<string | null> {
  const clientId     = process.env.XERO_CLIENT_ID;
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
  } catch { /* no row yet */ }

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
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
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
    await serviceClient().from("integrations").upsert(
      {
        provider: "xero",
        access_token,
        refresh_token: new_refresh ?? refreshToken,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
        metadata: { ...row.metadata, refresh_token: new_refresh ?? refreshToken },
      },
      { onConflict: "provider" }
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
      .from("integrations").select("metadata").eq("provider", "xero").single();
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

  const h = { Authorization: `Bearer ${token}`, "Xero-tenant-id": tenantId, Accept: "application/json" };
  const BASE = "https://api.xero.com/api.xro/2.0";

  // 12 months back, monthly breakdown
  const fromDate = (() => { const d = new Date(); d.setMonth(d.getMonth() - 11); d.setDate(1); return d.toISOString().split("T")[0]; })();
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
    const bankTxSince = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split("T")[0]; })();
    const bankTxUrl = `${BASE}/BankTransactions?where=${encodeURIComponent(`Date>=DateTime(${bankTxSince.replaceAll("-", ",")})`)}`;

    const [plS, balS, cashS, invS, accS, billS, draftS, contactsS, itemsS, bankTxS, journalsS, trackingS] = await Promise.allSettled([
      // P&L: omit periods/timeframe — fromDate→toDate alone yields a single column
      // total for the range; with timeframe=MONTH Xero auto-derives the period count.
      xeroFetch("P&L", `${BASE}/Reports/ProfitAndLoss?fromDate=${fromDate}&toDate=${toDateStr}&timeframe=MONTH&periods=11`),
      xeroFetch("BalanceSheet", `${BASE}/Reports/BalanceSheet?date=${toDateStr}`),
      xeroFetch("BankSummary", `${BASE}/Reports/BankSummary?fromDate=${monthStartStr}&toDate=${toDateStr}`),
      xeroFetchAllInvoicePages(`${BASE}/Invoices?Statuses=AUTHORISED,SUBMITTED&where=${encodeURIComponent('Type=="ACCREC"')}`),
      // Full Chart of Accounts filtered to BANK type — gives every bank account
      // with its native CurrencyCode, even when balance is zero.
      xeroFetch("Accounts", `${BASE}/Accounts?where=${encodeURIComponent('Type=="BANK"')}`),
      // Bills to pay (ACCPAY)
      xeroFetchAllInvoicePages(`${BASE}/Invoices?Statuses=AUTHORISED,SUBMITTED&where=${encodeURIComponent('Type=="ACCPAY"')}`),
      // Draft invoices owed to you
      xeroFetchAllInvoicePages(`${BASE}/Invoices?Statuses=DRAFT&where=${encodeURIComponent('Type=="ACCREC"')}`),
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

    const plData  = plS.status  === "fulfilled" ? plS.value  : null;
    const balData = balS.status === "fulfilled" ? balS.value : null;
    const cashData = cashS.status === "fulfilled" ? cashS.value : null;
    const invData  = invS.status === "fulfilled" ? invS.value  : null;
    const accData  = accS.status === "fulfilled" ? accS.value  : null;
    const billData = billS.status === "fulfilled" ? billS.value : null;
    const draftData = draftS.status === "fulfilled" ? draftS.value : null;
    const contactsData = contactsS.status === "fulfilled" ? contactsS.value : null;
    const itemsData = itemsS.status === "fulfilled" ? itemsS.value : null;
    const bankTxData = bankTxS.status === "fulfilled" ? bankTxS.value : null;
    const journalsData = journalsS.status === "fulfilled" ? journalsS.value : null;
    const trackingData = trackingS.status === "fulfilled" ? trackingS.value : null;

    // ── Parse P&L report ─────────────────────────────────────────────────────
    const revenueByMonth:     Record<string, number> = {};
    const expensesByMonth:    Record<string, number> = {};
    const grossProfitByMonth: Record<string, number> = {};
    const netProfitByMonth:   Record<string, number> = {};
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
          if (i === ytdCol) { ytd = xNum(cell); return; }
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
              title.includes("income") || title.includes("revenue") || title.includes("turnover") || title.includes("sales");
            const isCogs =
              title.includes("cost of sales") || title.includes("cost of goods") || title.includes("cogs");
            const isGross = title.includes("gross profit") || title.includes("gross margin");
            const isExpense =
              title.includes("operating expense") || title.includes("less operating") ||
              title.includes("overhead") || title.includes("administrative") ||
              (title.includes("expense") && !title.includes("non-operating"));
            const isNet =
              title.includes("net profit") || title.includes("net loss") ||
              title.includes("profit for") || title.includes("net income");

            if (isRevenue && !isGross && !isNet) {
              Object.entries(byMonth).forEach(([m, v]) => { revenueByMonth[m] = (revenueByMonth[m] ?? 0) + v; });
              ytdRevenue = (ytdRevenue ?? 0) + ytd;
            } else if (isGross) {
              Object.entries(byMonth).forEach(([m, v]) => { grossProfitByMonth[m] = v; });
            } else if (isCogs || isExpense) {
              Object.entries(byMonth).forEach(([m, v]) => { expensesByMonth[m] = (expensesByMonth[m] ?? 0) + v; });
              ytdExpenses = (ytdExpenses ?? 0) + ytd;
            } else if (isNet) {
              Object.entries(byMonth).forEach(([m, v]) => { netProfitByMonth[m] = v; });
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
              Object.entries(byMonth).forEach(([m, v]) => { netProfitByMonth[m] = v; });
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
                !/(cost of sales|cost of goods|cogs|expense|gross|net|liabilit|asset|equity)/i.test(label);
              if (looksRevenue) {
                const isTotal = r.RowType === "SummaryRow" || /^total\b/i.test(label);
                (isTotal ? revenueTotals : revenueDetails).push(r.Cells);
              }
            }
            if (r.Rows) scanRevenueRows(r.Rows);
          }
        };
        scanRevenueRows(rows);

        const candidates = revenueTotals.length > 0
          ? [revenueTotals[revenueTotals.length - 1]]
          : revenueDetails;
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
          plMonths.forEach((m) => { revenueByMonth[m] = 0; });
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
    const bsLookups: { field: string; query: string; type: "row" | "section"; matched: boolean; value: number | null }[] = [];
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
      tryRow("Total Assets", "total assets") ??
      trySection("Total Assets", "assets");
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
    const arBalanceRows = xRowsByLabels(balRows, ["accounts receivable", "trade debtors", "debtors"]);
    const arBalance = arBalanceRows.length > 0
      ? arBalanceRows[arBalanceRows.length - 1].value
      : null;

    // Detect whether Xero returned ANY liabilities section/row at all.
    // If Assets and Equity are present but liabilities are entirely absent,
    // this org legitimately has no liabilities — treat as 0 instead of failing.
    const hasLiabilitiesSection =
      bsLabels.sections.some((s) => /liabilit/i.test(s)) ||
      bsLabels.rows.some((r) => /liabilit/i.test(r));

    const derivedCurrentAssets = currentAssets ??
      (totalAssets !== null && fixedAssets !== null ? totalAssets - fixedAssets : null);
    const derivedFixedAssets = fixedAssets ??
      (totalAssets !== null && currentAssets !== null ? totalAssets - currentAssets : null);
    const totalLiabilities = parsedTotalLiabilities ??
      (totalAssets !== null && parsedEquity !== null ? totalAssets - parsedEquity : null) ??
      (!hasLiabilitiesSection && (totalAssets !== null || parsedEquity !== null) ? 0 : null);
    const equity = parsedEquity ??
      (totalAssets !== null && totalLiabilities !== null ? totalAssets - totalLiabilities : null);
    const derivedCurrentLiabilities = currentLiabilities ??
      (totalLiabilities !== null ? totalLiabilities : null);


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
          const bal  = xNum(row.Cells[row.Cells.length - 1]);
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
    const bankAccounts: BankAcct[] = Array.from(bankAccountsMap.values())
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

    // ── Parse Invoices (Accounts Receivable) ─────────────────────────────────
    const invoices: any[] = invData?.Invoices ?? [];
    const invoiceAccountsReceivable = invoices.reduce((s, inv) => s + (inv.AmountDue ?? 0), 0);
    const overdueInvoices     = invoices.filter(inv => inv.IsOverdue);
    const overdueAmount       = overdueInvoices.reduce((s, inv) => s + (inv.AmountDue ?? 0), 0);
    const accountsReceivable = invoiceAccountsReceivable || arBalance || 0;

    // ── Parse Bills (Accounts Payable / ACCPAY) ──────────────────────────────
    const bills: any[] = billData?.Invoices ?? [];
    const billsAwaitingAmount = bills.reduce((s, b) => s + (b.AmountDue ?? 0), 0);
    const overdueBills        = bills.filter((b) => b.IsOverdue);
    const overdueBillsAmount  = overdueBills.reduce((s, b) => s + (b.AmountDue ?? 0), 0);

    // ── Parse Drafts (ACCREC) ────────────────────────────────────────────────
    const drafts: any[] = draftData?.Invoices ?? [];
    const draftsAmount  = drafts.reduce((s, d) => s + (d.Total ?? d.AmountDue ?? 0), 0);

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
        total: (j.JournalLines ?? []).reduce(
          (s: number, l: any) => s + Math.abs(l.LineAmount ?? 0),
          0,
        ) / 2,
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

    const live = Object.keys(revenueByMonth).length > 0 || totalAssets !== null || cashBalance !== null;

    return {
      live,
      tenantId,
      revenueByMonth,
      expensesByMonth,
      grossProfitByMonth,
      netProfitByMonth,
      ytdRevenue:   ytdRevenue  !== null ? Math.round(ytdRevenue)  : null,
      ytdExpenses:  ytdExpenses !== null ? Math.round(ytdExpenses) : null,
      ytdNetProfit: ytdNetProfit !== null ? Math.round(ytdNetProfit) : null,
      totalAssets:        totalAssets        !== null ? Math.round(totalAssets)        : null,
      currentAssets:      derivedCurrentAssets !== null ? Math.round(derivedCurrentAssets) : null,
      fixedAssets:        derivedFixedAssets   !== null ? Math.round(derivedFixedAssets)   : null,
      totalLiabilities:   totalLiabilities   !== null ? Math.round(totalLiabilities)   : null,
      currentLiabilities: derivedCurrentLiabilities !== null ? Math.round(derivedCurrentLiabilities) : null,
      equity:             equity             !== null ? Math.round(equity)             : null,
      cashBalance:          cashBalance          !== null ? Math.round(cashBalance)          : null,
      bankAccounts,
      accountsReceivable:   accountsReceivable   > 0 ? Math.round(accountsReceivable)   : null,
      unpaidInvoiceCount:   invoices.length,
      overdueAmount:        overdueAmount        > 0 ? Math.round(overdueAmount)        : null,
      overdueInvoiceCount:  overdueInvoices.length,
      // Bills (ACCPAY)
      billsAwaitingAmount:  billsAwaitingAmount  > 0 ? Math.round(billsAwaitingAmount)  : null,
      billsAwaitingCount:   bills.length,
      overdueBillsAmount:   overdueBillsAmount   > 0 ? Math.round(overdueBillsAmount)   : null,
      overdueBillsCount:    overdueBills.length,
      // Drafts (ACCREC)
      draftsAmount:         draftsAmount         > 0 ? Math.round(draftsAmount)         : null,
      draftsCount:          drafts.length,
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

// OpEx categorisation — used to roll real Jortt expense descriptions / ledger
// account names into the 5 categories the dashboard renders.
const JORTT_CATEGORY_MAP: Record<string, string> = {
  personeel: "team", salaris: "team", loon: "team", freelance: "team",
  "management fee": "team", managementfee: "team", klantenservice: "team", nodots: "team",
  agency: "agencies", bureaukosten: "agencies", argento: "agencies",
  eightx: "agencies", fractional: "agencies",
  content: "content", creator: "content", influencer: "content", samenwerking: "content",
  "thor magis": "content", haec: "content", zadero: "content", remy: "content",
  software: "software", saas: "software", klaviyo: "software",
  "triple whale": "software", monday: "software", notion: "software",
  huur: "rent", rent: "rent", utility: "rent", utilities: "rent", energie: "rent",
  electricity: "rent", gas: "rent", water: "rent", internet: "rent", kantoor: "rent",
};

function categorise(name: string): "team" | "agencies" | "content" | "software" | "rent" | "other" {
  const lower = (name ?? "").toLowerCase();
  for (const [kw, cat] of Object.entries(JORTT_CATEGORY_MAP)) {
    if (lower.includes(kw)) return cat as any;
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
  const clientId     = process.env.JORTT_CLIENT_ID;
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

  console.log(`[Jortt] granted scopes (${grantedScopes.length}/${JORTT_ALL_SCOPES.length}):`, grantedScopes.join(", ") || "(none)");

  if (grantedScopes.length === 0) return null;

  // 2. Invoices (revenue, AR, invoice list) — invoices:read
  let invoices: any[] = [];
  let unpaidInvoices: any[] = [];
  if (tokens["invoices:read"]) {
    const t = tokens["invoices:read"]!;
    invoices       = await jorttPaginate(t, "/v1/invoices?invoice_status=sent", 10);
    unpaidInvoices = await jorttPaginate(t, "/v1/invoices?invoice_status=unpaid", 5);
  }

  // 3. Expenses (real OpEx) — expenses:read (v3 endpoint)
  let expenses: any[] = [];
  if (tokens["expenses:read"]) {
    expenses = await jorttPaginate(tokens["expenses:read"]!, "/v3/expenses", 20);
  }

  // 4. Reports — reports:read
  let plRes: any = null, cashRes: any = null, balanceRes: any = null, btwRes: any = null, dashInvRes: any = null;
  if (tokens["reports:read"]) {
    const t = tokens["reports:read"]!;
    plRes      = await jorttGet(t, "/v1/reports/summaries/profit_and_loss");
    cashRes    = await jorttGet(t, "/v1/reports/summaries/cash_and_bank");
    balanceRes = await jorttGet(t, "/v1/reports/summaries/balance");
    btwRes     = await jorttGet(t, "/v1/reports/summaries/btw");
    dashInvRes = await jorttGet(t, "/v1/reports/summaries/invoices");
  }

  // 5. Customers — customers:read
  let customers: any[] = [];
  if (tokens["customers:read"]) {
    customers = await jorttPaginate(tokens["customers:read"]!, "/v1/customers", 10);
  }

  // 6. Bank accounts + transactions — financing:read (v3)
  let bankAccounts: any[] = [];
  let bankTransactions: any[] = [];
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
    organization   = await jorttGet(t, "/v1/organizations");
    tradenames     = await jorttPaginate(t, "/v1/tradenames", 3);
    ledgerAccounts = await jorttPaginate(t, "/v1/ledger_accounts/invoices", 5);
    labels         = await jorttPaginate(t, "/v1/labels", 3);
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
    const total = parseFloat(
      inv.invoice_total_incl_vat?.value ??
      inv.invoice_total?.value ??
      "0"
    );
    if (!Number.isFinite(total) || total <= 0) continue;
    revenueByMonth[mk] = (revenueByMonth[mk] ?? 0) + total;
  }

  // Expenses by month + OpEx breakdown from real expenses
  const expensesByMonth: Record<string, number> = {};
  // monthKey -> { team, agencies, content, software, other }
  const opexBuckets: Record<string, { ym: string; team: number; agencies: number; content: number; software: number; rent: number; other: number }> = {};
  // category -> name -> amount  (rolled-up detail items)
  const opexDetailMap: Record<string, Record<string, number>> = {
    team: {}, agencies: {}, content: {}, software: {}, rent: {}, other: {},
  };

  for (const ex of expenses) {
    const dateStr = ex.vat_date ?? ex.delivery_period ?? ex.created_at ?? "";
    const mk = monthKey(dateStr);
    const ym = monthIsoKey(dateStr);
    if (!mk || !ym) continue;
    if (String(ex.expense_type ?? "").toLowerCase() === "income") continue;
    const amountStr =
      ex.raw_total_amount?.value ??
      ex.raw_total_amount?.amount ??
      ex.total_amount?.value ??
      ex.amount?.value ??
      "0";
    const amount = parseFloat(String(amountStr));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    expensesByMonth[mk] = (expensesByMonth[mk] ?? 0) + amount;

    // category from description / ledger account name
    const ledgerName = ledgerAccounts.find((l: any) => l.id === ex.ledger_account_id)?.name ?? "";
    const desc = ex.description ?? ex.supplier_name ?? ledgerName ?? "other";
    const cat = categorise(`${desc} ${ledgerName}`);

    if (!opexBuckets[mk]) opexBuckets[mk] = { ym, team: 0, agencies: 0, content: 0, software: 0, rent: 0, other: 0 };
    opexBuckets[mk][cat] += amount;

    const itemName = (desc || "Unknown").trim().slice(0, 80);
    opexDetailMap[cat][itemName] = (opexDetailMap[cat][itemName] ?? 0) + amount;
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
  const opexDetail: Record<string, { label: string; items: Array<{ name: string; amount: number }> }> = {};
  const catLabels: Record<string, string> = {
    team: "Team", agencies: "Agencies", content: "Content samenwerkingen", software: "Software", rent: "Rent & utilities", other: "Other costs",
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
        const v = parseFloat(String(a?.current_balance?.value ?? a?.balance?.value ?? a?.balance ?? "0"));
        return s + (Number.isFinite(v) ? v : 0);
      }, 0);
      return sum > 0 ? sum : null;
    }
    return null;
  })();

  const plSummary = plRes ? {
    revenue:     parseFloat(plRes?.revenue?.value      ?? plRes?.turnover?.value     ?? "0"),
    costs:       parseFloat(plRes?.costs?.value        ?? plRes?.expenses?.value     ?? "0"),
    grossProfit: parseFloat(plRes?.gross_profit?.value ?? plRes?.net_result?.value   ?? "0"),
  } : null;

  const expenseCount = expenses.filter((e: any) => {
    const v = parseFloat(String(e.raw_total_amount?.value ?? e.total_amount?.value ?? "0"));
    return Number.isFinite(v) && v > 0;
  }).length;
  const invoiceCount = invoices.filter((i: any) =>
    parseFloat(i.invoice_total_incl_vat?.value ?? i.invoice_total?.value ?? "0") > 0
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
