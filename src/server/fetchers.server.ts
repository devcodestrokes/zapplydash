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

function startOfDay(): string {
  return `${today()}T00:00:00Z`;
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
  let access_token: string | null = null;
  let expires_in: number | undefined;
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

    const json = await res.json();
    access_token = json.access_token ?? null;
    expires_in = json.expires_in;
  } catch (err) {
    console.error(`Shopify token request ${store}:`, (err as Error).message);
    return null;
  }

  if (!access_token) return null;

  // 3. best-effort cache write — never let this swallow a valid token
  try {
    const expiresAt = new Date(Date.now() + ((expires_in ?? 86400) - 600) * 1000).toISOString();
    const { error } = await supabaseAdmin
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
    if (error) console.error(`Shopify token cache ${store}:`, error.message);
  } catch (err) {
    console.error(`Shopify token cache ${store}:`, (err as Error).message);
  }

  return access_token;
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
  const hourlySums: Record<string, { revenue: number; orders: number; refunds: number; discounts: number }> = {};
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

      const createdAt = new Date(o.createdAt);
      const hourKey = `${String(createdAt.getUTCHours()).padStart(2, "0")}:00`;
      if (!hourlySums[hourKey]) hourlySums[hourKey] = { revenue: 0, orders: 0, refunds: 0, discounts: 0 };
      hourlySums[hourKey].revenue += r;
      hourlySums[hourKey].refunds += rf;
      hourlySums[hourKey].discounts += dc;
      hourlySums[hourKey].orders += 1;
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
    hourlySums,
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

export async function fetchShopifyHourly() {
  const since = startOfDay();

  const hourlyTotals: Record<string, { revenue: number; orders: number; refunds: number; discounts: number }> = {};

  const results = await Promise.all(
    SHOPIFY_STORES.map(async ({ storeKey }: any) => {
      const store = process.env[storeKey];
      if (!store) return null;

      const token = await getShopifyToken(store);
      if (!token) return null;

      try {
        return await fetchShopifyAllOrders(store, token, since, 20);
      } catch {
        return null;
      }
    }),
  );

  for (const result of results) {
    if (!result?.hourlySums) continue;
    for (const [hour, values] of Object.entries(result.hourlySums)) {
      if (!hourlyTotals[hour]) hourlyTotals[hour] = { revenue: 0, orders: 0, refunds: 0, discounts: 0 };
      hourlyTotals[hour].revenue += values.revenue;
      hourlyTotals[hour].orders += values.orders;
      hourlyTotals[hour].refunds += values.refunds;
      hourlyTotals[hour].discounts += values.discounts;
    }
  }

  const currentHour = new Date().getUTCHours();
  const rows = Array.from({ length: currentHour + 1 }, (_, hour) => {
    const key = `${String(hour).padStart(2, "0")}:00`;
    return {
      hour: key,
      revenue: hourlyTotals[key]?.revenue ?? 0,
      orders: hourlyTotals[key]?.orders ?? 0,
      refunds: hourlyTotals[key]?.refunds ?? 0,
      discounts: hourlyTotals[key]?.discounts ?? 0,
    };
  });

  return rows.some((row) => row.revenue > 0 || row.orders > 0 || row.refunds > 0 || row.discounts > 0)
    ? rows
    : [];
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
// Docs: https://developer.jortt.nl/
// Auth: client_credentials grant (HTTP Basic on token endpoint).
// Base API: https://api.jortt.nl  (pagination via response._links.next.href)

const JORTT_BASE = "https://api.jortt.nl";
const JORTT_TOKEN_URL = "https://app.jortt.nl/oauth-provider/oauth/token";

// Jortt's client_credentials flow only allows ONE scope per token request.
// Fetch a separate token per scope and cache it for its lifetime.
type JorttScope =
  | "invoices:read"
  | "expenses:read"
  | "reports:read"
  | "organizations:read"
  | "customers:read";

const jorttTokenCache = new Map<JorttScope, { token: string; expiresAt: number }>();

async function getJorttToken(scope: JorttScope): Promise<string | null> {
  const clientId = process.env.JORTT_CLIENT_ID;
  const clientSecret = process.env.JORTT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn("[jortt] Missing JORTT_CLIENT_ID or JORTT_CLIENT_SECRET");
    return null;
  }

  // Reuse cached token if still valid (with 60s buffer)
  const cached = jorttTokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(JORTT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope,
      }).toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[jortt] Token request failed for scope "${scope}" ${res.status}: ${text.slice(0, 300)}`);
      return null;
    }
    const json = await res.json();
    const token: string | null = json.access_token ?? null;
    const expiresIn: number = typeof json.expires_in === "number" ? json.expires_in : 7200;
    if (token) {
      jorttTokenCache.set(scope, {
        token,
        expiresAt: Date.now() + expiresIn * 1000,
      });
    }
    return token;
  } catch (err) {
    console.error(`[jortt] Token request error for scope "${scope}":`, err);
    return null;
  }
}

// Walk all pages of a Jortt list endpoint via _links.next.
async function jorttFetchAll(path: string, token: string, maxPages = 20): Promise<any[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  let url: string | null = path.startsWith("http") ? path : `${JORTT_BASE}${path}`;
  const out: any[] = [];
  let pages = 0;
  while (url && pages < maxPages) {
    const res: Response = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[jortt] GET ${url} failed ${res.status}: ${text.slice(0, 200)}`);
      break;
    }
    const json: any = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    out.push(...data);
    const next: string | null = json?._links?.next?.href ?? null;
    if (!next || data.length === 0) break;
    url = next;
    pages++;
    // Respect 10 req/s rate limit
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

const monthKey = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");

const parseAmount = (a: any): number => {
  if (a == null) return 0;
  if (typeof a === "number") return a;
  if (typeof a === "string") return parseFloat(a) || 0;
  if (typeof a === "object") {
    if ("value" in a) return parseFloat(a.value) || 0;
    if ("amount" in a) return parseFloat(a.amount) || 0;
  }
  return 0;
};

export async function fetchJortt() {
  const token = await getJorttToken();
  if (!token) return null;

  try {
    // ─ Revenue: paid/sent invoices via v2 API ────────────────────────────────
    const [sent, paid] = await Promise.all([
      jorttFetchAll("/v2/invoices?invoice_status=sent", token),
      jorttFetchAll("/v2/invoices?invoice_status=paid", token),
    ]);
    // Dedupe by id (an invoice may show up in multiple status filters)
    const invoiceMap = new Map<string, any>();
    for (const inv of [...sent, ...paid]) {
      if (inv?.id) invoiceMap.set(inv.id, inv);
    }
    const invoices = Array.from(invoiceMap.values());

    const revenueByMonth: Record<string, number> = {};
    let revenueInvoiceCount = 0;
    for (const inv of invoices) {
      const dateStr =
        inv.invoice_date ??
        inv.delivery_period ??
        inv.created_at ??
        "";
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;
      const total = parseAmount(inv.invoice_total ?? inv.total ?? inv.amount);
      if (total <= 0) continue;
      const mk = monthKey(d);
      revenueByMonth[mk] = (revenueByMonth[mk] ?? 0) + total;
      revenueInvoiceCount++;
    }

    // ─ OpEx: cost-type expenses via v3 API ──────────────────────────────────
    const expenses = await jorttFetchAll("/v3/expenses?expense_type=cost", token);

    // Aggregate opex by month and by ledger account name (for breakdown)
    const opexMonthMap: Record<string, number> = {};
    const opexDetail: Record<string, Record<string, number>> = {}; // month -> { category: amount }

    for (const exp of expenses) {
      const dateStr =
        exp.delivery_period ??
        exp.vat_date ??
        exp.expense_date ??
        exp.created_at ??
        "";
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;

      const total = parseAmount(
        exp.raw_total_amount ?? exp.total_amount ?? exp.amount ?? exp.total,
      );
      if (total <= 0) continue;

      const mk = monthKey(d);
      opexMonthMap[mk] = (opexMonthMap[mk] ?? 0) + total;

      const category =
        exp.ledger_account_name ??
        exp.ledger_account?.name ??
        exp.description ??
        "Other";
      opexDetail[mk] = opexDetail[mk] ?? {};
      opexDetail[mk][category] = (opexDetail[mk][category] ?? 0) + total;
    }

    // Convert to ordered array (chronological)
    const opexByMonth = Object.entries(opexMonthMap)
      .map(([month, total]) => ({ month, total: Math.round(total) }))
      .sort((a, b) => {
        // Sort by parsing "Jan '24" style key
        const parse = (s: string) => {
          const [m, y] = s.split(" '");
          return new Date(`${m} 1, 20${y}`).getTime();
        };
        return parse(a.month) - parse(b.month);
      });

    const live = Object.keys(revenueByMonth).length > 0 || opexByMonth.length > 0;

    console.log(
      `[jortt] Loaded ${invoices.length} invoices (${revenueInvoiceCount} with revenue), ${expenses.length} expenses. Live=${live}`,
    );

    return {
      opexByMonth,
      opexDetail,
      revenueByMonth,
      invoiceCount: revenueInvoiceCount,
      expenseCount: expenses.length,
      live,
    };
  } catch (err) {
    console.error("[jortt] fetchJortt error:", err);
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
