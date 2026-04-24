/**
 * Server-side data fetchers — ported from the original Next.js project.
 * Each fetcher returns null when the source is not configured or errors.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── helpers ─────────────────────────────────────────────────────────────────

function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Shopify ─────────────────────────────────────────────────────────────────

const SHOPIFY_STORES = [
  { code: "NL", flag: "🇳🇱", name: "Netherlands", storeKey: "SHOPIFY_NL_STORE" },
  { code: "UK", flag: "🇬🇧", name: "United Kingdom", storeKey: "SHOPIFY_UK_STORE" },
  { code: "US", flag: "🇺🇸", name: "United States", storeKey: "SHOPIFY_US_STORE", status: "scaling" },
  { code: "EU", flag: "🇩🇪", name: "Germany / EU", storeKey: "SHOPIFY_EU_STORE" },
] as const;

async function getShopifyToken(store: string): Promise<string | null> {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret || !store) return null;

  const provider = `shopify_${store.replace(".myshopify.com", "")}`;

  // 1. cached token
  try {
    const { data } = await supabaseAdmin
      .from("integrations")
      .select("access_token, expires_at")
      .eq("provider", provider)
      .single();

    if (data?.access_token) {
      const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : Infinity;
      if (expiresAt > Date.now() + 10 * 60 * 1000) return data.access_token;
    }
  } catch {
    // fall through
  }

  // 2. fresh client_credentials grant
  try {
    const res = await fetch(`https://${store}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Shopify client_credentials ${store} ${res.status}:`, body.slice(0, 200));
      return null;
    }

    const { access_token, expires_in } = await res.json();
    if (!access_token) return null;

    const expiresAt = new Date(Date.now() + ((expires_in ?? 86400) - 600) * 1000).toISOString();
    await supabaseAdmin
      .from("integrations")
      .upsert(
        {
          provider,
          access_token,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
          metadata: { shop_domain: store, source: "client_credentials" },
        },
        { onConflict: "provider" },
      );

    return access_token;
  } catch (err) {
    console.error(`Shopify token refresh ${store}:`, (err as Error).message);
    return null;
  }
}

const SHOPIFY_GQL_PAGE = (since: string, cursor: string | null) => `{
  orders(first:250, ${cursor ? `after:"${cursor}",` : ""}query:"created_at:>=${since} financial_status:paid") {
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

async function fetchShopifyAllOrders(store: string, token: string, since: string, maxPages = 40) {
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
    const res: Response = await fetch(`https://${store}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SHOPIFY_GQL_PAGE(since, cursor) }),
    });
    if (!res.ok) break;
    const json = await res.json();
    if (json.errors) {
      console.error("Shopify GQL:", json.errors[0]?.message);
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
      const dc = parseFloat(o.totalDiscountsSet.shopMoney.amount);
      revenue += r;
      refunds += rf;
      discounts += dc;
      orderCount++;
      currency = o.totalPriceSet.shopMoney.currencyCode;
      if (o.customer?.id) customerIds.add(o.customer.id);
      const mk = new Date(o.createdAt)
        .toLocaleDateString("en-US", { month: "short", year: "2-digit" })
        .replace(" ", " '");
      if (!monthlySums[mk]) monthlySums[mk] = { revenue: 0, orders: 0, refunds: 0 };
      monthlySums[mk].revenue += r;
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

export async function fetchShopifyMarkets() {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  if (!clientId) return null;

  const since = `${startOfMonth()}T00:00:00Z`;

  const results = await Promise.all(
    SHOPIFY_STORES.map(async ({ code, flag, name, storeKey, status }: any) => {
      const store = process.env[storeKey];
      if (!store) return { code, flag, name, status: status ?? null, live: false };

      const token = await getShopifyToken(store);
      if (!token) return { code, flag, name, status: status ?? null, live: false };

      try {
        const agg = await fetchShopifyAllOrders(store, token, since);
        const aov = agg.orderCount > 0 ? agg.revenue / agg.orderCount : 0;
        return {
          code,
          flag,
          name,
          revenue: agg.revenue,
          refunds: agg.refunds,
          discounts: agg.discounts,
          orders: agg.orderCount,
          aov,
          currency: agg.currency,
          newCustomers: agg.uniqueCustomers,
          truncated: agg.truncated,
          status: status ?? null,
          live: true,
        };
      } catch (err) {
        return { code, flag, name, status: status ?? null, live: false, error: (err as Error).message };
      }
    }),
  );

  const hasAnyLive = results.some((r: any) => r.live);
  return hasAnyLive ? results : null;
}

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
      .sort(
        ([a], [b]) =>
          new Date("1 " + a.replace("'", "20")).getTime() -
          new Date("1 " + b.replace("'", "20")).getTime(),
      )
      .map(([month, data]) => ({ month, ...data }));
  } catch {
    return null;
  }
}

// ─── Triple Whale ────────────────────────────────────────────────────────────

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

export async function fetchTripleWhale() {
  const apiKey = process.env.TRIPLE_WHALE_API_KEY;
  if (!apiKey) return null;

  const start = startOfMonth();
  const end = today();

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
        if (!res.ok) return { market, flag, live: false };

        const data = await res.json();
        const m = data.metrics ?? [];
        const row = {
          market,
          flag,
          revenue: twMetric(m, "sales"),
          netRevenue: twMetric(m, "netSales"),
          newCustomerRev: twMetric(m, "newCustomerSales"),
          adSpend: twMetric(m, "blendedAds"),
          facebookSpend: twMetric(m, "facebookAds"),
          googleSpend: twMetric(m, "googleAds"),
          roas: twMetric(m, "roas"),
          ncRoas: twMetric(m, "newCustomersRoas"),
          fbRoas: twMetric(m, "facebookRoas"),
          googleRoas: twMetric(m, "googleRoas"),
          mer: twMetric(m, "mer"),
          ncpa: twMetric(m, "newCustomersCpa"),
          ltvCpa: twMetric(m, "ltvCpa"),
          aov: twMetric(m, "shopifyAov"),
          orders: twMetric(m, "shopifyOrders"),
          grossProfit: twMetric(m, "grossProfit"),
          netProfit: twMetric(m, "totalNetProfit"),
          cogs: twMetric(m, "cogs"),
          newCustomersPct: twMetric(m, "newCustomersPercent"),
          uniqueCustomers: twMetric(m, "uniqueCustomers"),
        };

        const hasData = Object.values(row).some(
          (v) => typeof v === "number" && (v as number) !== 0,
        );
        if (!hasData) return { market, flag, live: false };
        return { ...row, live: true };
      } catch {
        return { market, flag, live: false };
      }
    }),
  );

  const hasAnyLive = results.some((r) => r.live);
  return hasAnyLive ? results : null;
}

// ─── Loop Subscriptions ──────────────────────────────────────────────────────

export async function fetchLoop() {
  const key = process.env.LOOP_UK_API_KEY;
  if (!key) return null;

  const BASE = "https://api.loopsubscriptions.com";
  const headers = { "X-Loop-Token": key, Accept: "application/json" };
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const allSubs: any[] = [];
  const MAX_PAGES = 60;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let res = await fetch(`${BASE}/admin/2023-10/subscription?limit=50&page=${page}`, { headers });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000));
        res = await fetch(`${BASE}/admin/2023-10/subscription?limit=50&page=${page}`, { headers });
      }
      if (!res.ok) break;
      const json = await res.json();
      const batch: any[] = json.data ?? [];
      allSubs.push(...batch);
      if (!json.pageInfo?.hasNextPage || batch.length === 0) break;
    }

    if (!allSubs.length) return null;

    const activeSubs = allSubs.filter((s) => s.status === "ACTIVE");
    const mrr = activeSubs.reduce(
      (sum, s) => sum + parseFloat(s.totalLineItemPrice ?? "0"),
      0,
    );
    const newThisMonth = allSubs.filter((s) => s.createdAt >= monthStart).length;
    const churnedThisMonth = allSubs.filter(
      (s) => s.status === "CANCELLED" && s.cancelledAt && s.cancelledAt >= monthStart,
    ).length;
    const arpu = activeSubs.length > 0 ? mrr / activeSubs.length : null;
    const churnRate =
      activeSubs.length + churnedThisMonth > 0
        ? +((churnedThisMonth / (activeSubs.length + churnedThisMonth)) * 100).toFixed(1)
        : null;

    return [
      {
        market: "ALL",
        flag: "🌍",
        live: true,
        mrr: Math.round(mrr),
        activeSubs: activeSubs.length,
        totalFetched: allSubs.length,
        newThisMonth,
        churnedThisMonth,
        arpu: arpu != null ? +arpu.toFixed(2) : null,
        churnRate,
      },
    ];
  } catch (err) {
    console.error("Loop fetch error:", (err as Error).message);
    return null;
  }
}

// ─── Jortt ───────────────────────────────────────────────────────────────────

async function getJorttToken(): Promise<string | null> {
  const clientId = process.env.JORTT_CLIENT_ID;
  const clientSecret = process.env.JORTT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://app.jortt.nl/oauth-provider/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "invoices:read",
      }).toString(),
    });
    if (!res.ok) return null;
    const { access_token } = await res.json();
    return access_token ?? null;
  } catch {
    return null;
  }
}

export async function fetchJortt() {
  const token = await getJorttToken();
  if (!token) return null;

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const BASE = "https://api.jortt.nl";

  try {
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        fetch(`${BASE}/invoices?per_page=100&page=${page}&invoice_status=sent`, { headers })
          .then((r) => (r.ok ? r.json() : { data: [] }))
          .then((d) => d.data ?? []),
      ),
    );
    const invoices: any[] = pages.flat();

    const revenueByMonth: Record<string, number> = {};
    for (const inv of invoices) {
      const dateStr = inv.invoice_date ?? "";
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;
      const total = parseFloat(inv.invoice_total?.value ?? "0");
      if (total <= 0) continue;
      const mk = d
        .toLocaleDateString("en-US", { month: "short", year: "2-digit" })
        .replace(" ", " '");
      revenueByMonth[mk] = (revenueByMonth[mk] ?? 0) + total;
    }

    return {
      opexByMonth: [],
      opexDetail: {},
      revenueByMonth,
      invoiceCount: invoices.filter((i) => parseFloat(i.invoice_total?.value ?? "0") > 0).length,
      live: Object.keys(revenueByMonth).length > 0,
    };
  } catch {
    return null;
  }
}

// ─── Connections summary (from DB + env vars) ────────────────────────────────

export async function fetchConnections(): Promise<Record<string, string>> {
  const connections: Record<string, string> = {};
  try {
    const { data } = await supabaseAdmin
      .from("integrations")
      .select("provider")
      .order("created_at");
    for (const row of data ?? []) {
      if (row.provider.startsWith("shopify_")) {
        connections["shopify"] = "connected";
        connections[row.provider] = "connected";
      } else {
        connections[row.provider] = "connected";
      }
    }
  } catch {
    // ignore
  }

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
  if (process.env.JORTT_CLIENT_ID && process.env.JORTT_CLIENT_SECRET) connections["jortt"] = "connected";
  if (process.env.LOOP_UK_API_KEY) connections["loop"] = "connected";
  if (process.env.TRIPLE_WHALE_API_KEY) connections["triplewhale"] = "connected";
  return connections;
}
