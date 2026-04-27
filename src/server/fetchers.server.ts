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

export async function fetchTripleWhale(fromDate?: string, toDate?: string) {
  const apiKey = process.env.TRIPLE_WHALE_API_KEY;
  if (!apiKey) return null;

  const start = fromDate ?? startOfMonth();
  const end   = toDate   ?? today();

  const results = await Promise.all(
    TW_SHOPS.map(async ({ market, flag, envKeys }: any) => {
      const shop = (envKeys as string[]).map((k) => process.env[k]).find(Boolean);
      if (!shop) return { market, flag, live: false };

      try {
        const res = await fetch("https://api.triplewhale.com/api/v2/summary-page/get-data", {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ shopDomain: shop, period: { start, end } }),
        });

        if (!res.ok) {
          const body = await res.text();
          console.error(`Triple Whale ${market} ${res.status}:`, body.slice(0, 200));
          return { market, flag, live: false };
        }

        const data = await res.json();
        const m = data.metrics ?? [];

        // All IDs confirmed from live API (698 metrics) — April 2026
        const row = {
          market, flag,
          revenue:         twMetric(m, "sales"),               // Gross Order Revenue
          netRevenue:      twMetric(m, "netSales"),             // Net Sales (after discounts)
          newCustomerRev:  twMetric(m, "newCustomerSales"),     // New Customer Revenue
          adSpend:         twMetric(m, "blendedAds"),           // Total blended ad spend
          facebookSpend:   twMetric(m, "facebookAds"),          // Facebook / Meta
          googleSpend:     twMetric(m, "googleAds"),            // Google Ads
          roas:            twMetric(m, "roas"),                  // Blended ROAS
          ncRoas:          twMetric(m, "newCustomersRoas"),     // New Customer ROAS
          fbRoas:          twMetric(m, "facebookRoas"),         // Facebook ROAS
          googleRoas:      twMetric(m, "googleRoas"),           // Google ROAS
          mer:             twMetric(m, "mer"),                   // Marketing Efficiency Ratio
          ncpa:            twMetric(m, "newCustomersCpa"),      // New Customer CPA
          ltvCpa:          twMetric(m, "ltvCpa"),                // LTV:CPA ratio
          aov:             twMetric(m, "shopifyAov"),            // True AOV
          orders:          twMetric(m, "shopifyOrders"),         // Total orders
          grossProfit:     twMetric(m, "grossProfit"),           // Gross Profit
          netProfit:       twMetric(m, "totalNetProfit"),        // Net Profit (after all costs)
          cogs:            twMetric(m, "cogs"),                  // Cost of Goods Sold
          newCustomersPct: twMetric(m, "newCustomersPercent"),  // % new customers
          uniqueCustomers: twMetric(m, "uniqueCustomers"),      // Unique customers
        };

        const hasData = Object.values(row).some((v) => typeof v === "number" && (v as number) !== 0);
        if (!hasData) return { market, flag, live: false };

        return { ...row, live: true };
      } catch (err: any) {
        console.error(`Triple Whale ${market}:`, err.message);
        return { market, flag, live: false };
      }
    })
  );

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
  if (!apiKey) return null;

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
      .select("access_token, expires_at, metadata")
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
  const refreshToken = row.metadata?.refresh_token;
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
  const v = String(cell?.Value ?? "").replace(/[, ]/g, "");
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Walk report rows recursively to find a SummaryRow under the first matching section title
function xSectionTotal(rows: any[], titleFragment: string, colIdx = 1): number | null {
  for (const row of rows) {
    const title = (row.Title ?? "").toLowerCase();
    if (row.RowType === "Section" && title.includes(titleFragment.toLowerCase())) {
      // Look for SummaryRow directly or in nested rows
      const findSummary = (rs: any[]): number | null => {
        for (const r of rs) {
          if (r.RowType === "SummaryRow" && r.Cells?.[colIdx] != null) return xNum(r.Cells[colIdx]);
          if (r.Rows) { const v = findSummary(r.Rows); if (v !== null) return v; }
        }
        return null;
      };
      const v = findSummary(row.Rows ?? []);
      if (v !== null) return v;
    }
    if (row.Rows) {
      const v = xSectionTotal(row.Rows, titleFragment, colIdx);
      if (v !== null) return v;
    }
  }
  return null;
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

  try {
    const [plS, balS, cashS, invS] = await Promise.allSettled([
      fetch(`${BASE}/Reports/ProfitAndLoss?fromDate=${fromDate}&toDate=${toDateStr}&periods=12&timeframe=MONTH`, { headers: h, cache: "no-store" })
        .then(r => r.ok ? r.json() : (console.error(`Xero P&L: ${r.status}`), null)).catch(() => null),
      fetch(`${BASE}/Reports/BalanceSheet?date=${toDateStr}`, { headers: h, cache: "no-store" })
        .then(r => r.ok ? r.json() : (console.error(`Xero BalanceSheet: ${r.status}`), null)).catch(() => null),
      fetch(`${BASE}/Reports/BankSummary?fromDate=${monthStartStr}&toDate=${toDateStr}`, { headers: h, cache: "no-store" })
        .then(r => r.ok ? r.json() : (console.warn(`Xero BankSummary: ${r.status}`), null)).catch(() => null),
      fetch(`${BASE}/Invoices?Statuses=AUTHORISED,SUBMITTED&where=Type%3D%3D%22ACCREC%22`, { headers: h, cache: "no-store" })
        .then(r => r.ok ? r.json() : (console.warn(`Xero Invoices: ${r.status}`), null)).catch(() => null),
    ]);

    const plData  = plS.status  === "fulfilled" ? plS.value  : null;
    const balData = balS.status === "fulfilled" ? balS.value : null;
    const cashData = cashS.status === "fulfilled" ? cashS.value : null;
    const invData  = invS.status === "fulfilled" ? invS.value  : null;

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
      // colLabels: ["Description", "Apr '25", "May '25", ..., "YTD"]
      const colLabels: string[] = (headerRow?.Cells ?? []).map((c: any) => String(c.Value ?? ""));
      const ytdCol = colLabels.indexOf("YTD");

      const extractCols = (summaryRow: any): { byMonth: Record<string, number>; ytd: number } => {
        const byMonth: Record<string, number> = {};
        let ytd = 0;
        (summaryRow.Cells ?? []).forEach((cell: any, i: number) => {
          if (i === 0) return;
          if (i === ytdCol) { ytd = xNum(cell); return; }
          const label = colLabels[i];
          if (label) byMonth[label] = xNum(cell);
        });
        return { byMonth, ytd };
      };

      for (const section of rows) {
        if (section.RowType !== "Section") continue;
        const title = (section.Title ?? "").toLowerCase();
        const summaryRow = (section.Rows ?? []).find((r: any) => r.RowType === "SummaryRow");
        if (!summaryRow) continue;

        const { byMonth, ytd } = extractCols(summaryRow);

        if (title.includes("revenue") || title.includes("income") || title.includes("trading income")) {
          Object.entries(byMonth).forEach(([m, v]) => { revenueByMonth[m] = (revenueByMonth[m] ?? 0) + v; });
          ytdRevenue = (ytdRevenue ?? 0) + ytd;
        } else if (title.includes("gross profit")) {
          Object.entries(byMonth).forEach(([m, v]) => { grossProfitByMonth[m] = v; });
        } else if (title.includes("operating") || title.includes("expense") || title.includes("overhead") || title.includes("less operating")) {
          Object.entries(byMonth).forEach(([m, v]) => { expensesByMonth[m] = (expensesByMonth[m] ?? 0) + v; });
          ytdExpenses = (ytdExpenses ?? 0) + ytd;
        } else if (title.includes("net profit") || title.includes("net loss") || title.includes("profit for")) {
          Object.entries(byMonth).forEach(([m, v]) => { netProfitByMonth[m] = v; });
          ytdNetProfit = ytd;
        }
      }
    }

    // ── Parse Balance Sheet ───────────────────────────────────────────────────
    const balRows: any[] = balData?.Reports?.[0]?.Rows ?? [];
    const totalAssets        = xSectionTotal(balRows, "total assets")        ?? xSectionTotal(balRows, "assets");
    const currentAssets      = xSectionTotal(balRows, "current assets");
    const fixedAssets        = xSectionTotal(balRows, "fixed assets")        ?? xSectionTotal(balRows, "non-current assets");
    const totalLiabilities   = xSectionTotal(balRows, "total liabilities")   ?? xSectionTotal(balRows, "liabilities");
    const currentLiabilities = xSectionTotal(balRows, "current liabilities");
    const equity             = xSectionTotal(balRows, "equity")              ?? xSectionTotal(balRows, "net assets");

    // ── Parse Bank Summary ───────────────────────────────────────────────────
    let cashBalance: number | null = null;
    const bankAccounts: { name: string; balance: number; currency: string }[] = [];
    const cashReport = cashData?.Reports?.[0];
    if (cashReport) {
      for (const section of cashReport.Rows ?? []) {
        if (section.RowType !== "Section") continue;
        for (const row of section.Rows ?? []) {
          if (row.RowType !== "Row" || !row.Cells?.length) continue;
          const name = String(row.Cells[0]?.Value ?? "").trim();
          const bal  = xNum(row.Cells[row.Cells.length - 1]);
          if (name && name !== "Account" && Math.abs(bal) > 0) {
            bankAccounts.push({ name, balance: bal, currency: "EUR" });
            cashBalance = (cashBalance ?? 0) + bal;
          }
        }
      }
    }

    // ── Parse Invoices (Accounts Receivable) ─────────────────────────────────
    const invoices: any[] = invData?.Invoices ?? [];
    const accountsReceivable  = invoices.reduce((s, inv) => s + (inv.AmountDue ?? 0), 0);
    const overdueInvoices     = invoices.filter(inv => inv.IsOverdue);
    const overdueAmount       = overdueInvoices.reduce((s, inv) => s + (inv.AmountDue ?? 0), 0);

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
      currentAssets:      currentAssets      !== null ? Math.round(currentAssets)      : null,
      fixedAssets:        fixedAssets        !== null ? Math.round(fixedAssets)        : null,
      totalLiabilities:   totalLiabilities   !== null ? Math.round(totalLiabilities)   : null,
      currentLiabilities: currentLiabilities !== null ? Math.round(currentLiabilities) : null,
      equity:             equity             !== null ? Math.round(equity)             : null,
      cashBalance:          cashBalance          !== null ? Math.round(cashBalance)          : null,
      bankAccounts,
      accountsReceivable:   accountsReceivable   > 0 ? Math.round(accountsReceivable)   : null,
      unpaidInvoiceCount:   invoices.length,
      overdueAmount:        overdueAmount        > 0 ? Math.round(overdueAmount)        : null,
      overdueInvoiceCount:  overdueInvoices.length,
      currency: "EUR",
    };
  } catch (err: any) {
    console.error("Xero fetch error:", err.message);
    return null;
  }
}


// ─── Jortt ───────────────────────────────────────────────────────────────────
//
// CONFIRMED WORKING — client_credentials via form params (NOT Basic auth header)
// Endpoint: POST https://app.jortt.nl/oauth-provider/oauth/token
// Body params: grant_type, client_id, client_secret, scope

const JORTT_CATEGORY_MAP: Record<string, string> = {
  personeel: "team", salaris: "team", loon: "team", freelance: "team",
  "management fee": "team", managementfee: "team", klantenservice: "team", nodots: "team",
  agency: "agencies", bureaukosten: "agencies", argento: "agencies",
  eightx: "agencies", fractional: "agencies",
  content: "content", creator: "content", influencer: "content", samenwerking: "content",
  "thor magis": "content", haec: "content", zadero: "content", remy: "content",
  software: "software", saas: "software", klaviyo: "software",
  "triple whale": "software", monday: "software", notion: "software",
};

function categorise(name: string): string {
  const lower = name.toLowerCase();
  for (const [kw, cat] of Object.entries(JORTT_CATEGORY_MAP)) {
    if (lower.includes(kw)) return cat;
  }
  return "other";
}

// Get a Jortt access_token for ONE specific scope.
// Confirmed via official docs (https://developer.jortt.nl/) and live testing:
//   1. credentials must be sent as HTTP Basic Auth (-u CLIENT:SECRET), NOT as form body params
//   2. only one scope per request — multi-scope requests return invalid_scope
//   3. requesting a new token invalidates any previously-issued token for the same client
async function getJorttTokenForScope(scope: string): Promise<string | null> {
  const clientId     = process.env.JORTT_CLIENT_ID;
  const clientSecret = process.env.JORTT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://app.jortt.nl/oauth-provider/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope,
      }).toString(),
      cache: "no-store",
    });

    if (!res.ok) {
      const err = await res.text();
      // invalid_scope simply means this OAuth app doesn't have that scope
      // enabled — log at warn level so it doesn't look like a hard failure.
      console.warn(`Jortt token (scope=${scope}) ${res.status}:`, err.slice(0, 200));
      return null;
    }
    const json: any = await res.json();
    return json.access_token ?? null;
  } catch (err: any) {
    console.error(`Jortt token (scope=${scope}) fetch failed:`, err.message);
    return null;
  }
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");
}

export async function fetchJortt() {
  const token = await getJorttToken();
  if (!token) return null;

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const BASE    = "https://api.jortt.nl";

  // Date range: last 12 months
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceStr = since.toISOString().split("T")[0];

  try {
    // Fetch invoices, expenses, P&L summary, cash, and balance report in parallel
    const [invoicePages, unpaidInvoices, expensePages, plRes, cashRes, balanceRes] = await Promise.all([
      // Sent invoices (revenue) — /v1/invoices, 3 pages × 100
      Promise.all([1, 2, 3].map(p =>
        fetch(`${BASE}/v1/invoices?per_page=100&page=${p}&invoice_status=sent`, { headers, cache: "no-store" })
          .then(r => {
            if (!r.ok) { console.warn(`Jortt invoices p${p}: ${r.status}`); return []; }
            return r.json().then(d => d.data ?? []);
          })
      )),
      // Unpaid + late invoices → accounts receivable
      fetch(`${BASE}/v1/invoices?per_page=100&page=1&invoice_status=unpaid`, { headers, cache: "no-store" })
        .then(r => r.ok ? r.json().then(d => d.data ?? []) : []).catch(() => []),
      // Expenses — needs expenses:read scope
      Promise.all([1, 2].map(p =>
        fetch(`${BASE}/v3/expenses?expense_type=cost&vat_date_from=${sinceStr}&per_page=100&page=${p}`, { headers, cache: "no-store" })
          .then(r => {
            if (!r.ok) { console.warn(`Jortt expenses p${p}: ${r.status} (add expenses:read scope in Jortt app settings)`); return []; }
            return r.json().then(d => d.data ?? []);
          })
          .catch(() => [])
      )),
      // P&L summary — needs reports:read scope
      fetch(`${BASE}/v1/reports/summaries/profit_and_loss`, { headers, cache: "no-store" })
        .then(r => {
          if (!r.ok) { console.warn(`Jortt P&L: ${r.status} (add reports:read scope in Jortt app settings)`); return null; }
          return r.json();
        }).catch(() => null),
      // Cash & bank — needs reports:read scope
      fetch(`${BASE}/v1/reports/summaries/cash_and_bank`, { headers, cache: "no-store" })
        .then(r => {
          if (!r.ok) { console.warn(`Jortt cash: ${r.status} (add reports:read scope in Jortt app settings)`); return null; }
          return r.json();
        }).catch(() => null),
      // Balance report — needs reports:read scope
      fetch(`${BASE}/v1/reports/summaries/balance`, { headers, cache: "no-store" })
        .then(r => {
          if (!r.ok) { console.warn(`Jortt balance: ${r.status} (add reports:read scope in Jortt app settings)`); return null; }
          return r.json();
        }).catch(() => null),
    ]);

    const invoices: any[]  = invoicePages.flat();
    const expenses: any[]  = expensePages.flat();

    // Accounts receivable = total outstanding unpaid invoices
    const accountsReceivable = unpaidInvoices.reduce((sum: number, inv: any) => {
      return sum + parseFloat(inv.invoice_total?.value ?? inv.total_amount?.value ?? "0");
    }, 0);

    // Revenue by month from invoices
    const revenueByMonth: Record<string, number> = {};
    for (const inv of invoices) {
      const mk = monthKey(inv.invoice_date ?? "");
      if (!mk) continue;
      const total = parseFloat(inv.invoice_total?.value ?? "0");
      if (total <= 0) continue;
      revenueByMonth[mk] = (revenueByMonth[mk] ?? 0) + total;
    }

    // Expenses by month from /v3/expenses
    const expensesByMonth: Record<string, number> = {};
    for (const exp of expenses) {
      const mk = monthKey(exp.vat_date ?? exp.delivery_period ?? "");
      if (!mk) continue;
      // raw_total_amount is { value, currency }
      const amt = parseFloat(
        exp.raw_total_amount?.value ??
        exp.total_amount?.value ??
        exp.amount?.value ?? "0"
      );
      if (amt <= 0) continue;
      expensesByMonth[mk] = (expensesByMonth[mk] ?? 0) + amt;
    }

    // Cash position from summary (best-effort)
    const cashBalance: number | null = (() => {
      if (!cashRes) return null;
      const v = cashRes?.total_balance?.value ?? cashRes?.balance?.value ?? cashRes?.cash ?? null;
      return v != null ? parseFloat(v) : null;
    })();

    // P&L totals from summary (best-effort)
    const plSummary = plRes ? {
      revenue:    parseFloat(plRes?.revenue?.value      ?? plRes?.turnover?.value     ?? "0"),
      costs:      parseFloat(plRes?.costs?.value        ?? plRes?.expenses?.value     ?? "0"),
      grossProfit: parseFloat(plRes?.gross_profit?.value ?? plRes?.net_result?.value  ?? "0"),
    } : null;

    return {
      revenueByMonth,
      expensesByMonth,
      cashBalance,
      plSummary,
      balanceReport: balanceRes,
      accountsReceivable: accountsReceivable > 0 ? accountsReceivable : null,
      unpaidInvoiceCount: unpaidInvoices.length,
      invoiceCount: invoices.filter(i => parseFloat(i.invoice_total?.value ?? "0") > 0).length,
      expenseCount: expenses.length,
      live: Object.keys(revenueByMonth).length > 0,
      // Legacy fields (keep for compatibility)
      opexByMonth: [],
      opexDetail:  {},
    };
  } catch (err: any) {
    console.error("Jortt fetch error:", err.message);
    return null;
  }
}
