/**
 * Detailed per-store fetchers for the dashboard pages.
 * These return raw orders/customers/etc. with the selected date range applied,
 * for the Store / Triple Whale / Subscription / Invoice / Accounting pages.
 *
 * Uses the SAME token helpers and OAuth flows as fetchers.server.ts.
 */
import { createClient as createSupabaseJS } from "@supabase/supabase-js";

const VITE_SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_PUBLISHABLE_KEY = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

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
  if (!url || !key) throw new Error("Supabase creds missing");
  return createSupabaseJS(url, key, { auth: { persistSession: false } });
}

// ─── Shopify per-store details ───────────────────────────────────────────────
export const SHOPIFY_STORE_LIST = [
  { code: "NL", flag: "🇳🇱", name: "Netherlands", storeKey: "SHOPIFY_NL_STORE" },
  { code: "UK", flag: "🇬🇧", name: "United Kingdom", storeKey: "SHOPIFY_UK_STORE" },
  { code: "US", flag: "🇺🇸", name: "United States", storeKey: "SHOPIFY_US_STORE" },
  { code: "EU", flag: "🇩🇪", name: "Germany / EU", storeKey: "SHOPIFY_EU_STORE" },
] as const;

async function getShopifyTokenLocal(store: string): Promise<string | null> {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret || !store) return null;

  const provider = `shopify_${store.replace(".myshopify.com", "")}`;
  try {
    const supabase = serviceClient();
    const { data } = await supabase
      .from("integrations")
      .select("access_token, expires_at")
      .eq("provider", provider)
      .single();
    if (data?.access_token) {
      const exp = data.expires_at ? new Date(data.expires_at).getTime() : Infinity;
      if (exp > Date.now() + 10 * 60 * 1000) return data.access_token;
    }
  } catch {}

  // fall through: refresh via client_credentials
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
    if (!res.ok) return null;
    const { access_token, expires_in } = await res.json();
    if (!access_token) return null;
    const expiresAt = new Date(Date.now() + ((expires_in ?? 86400) - 600) * 1000).toISOString();
    await serviceClient()
      .from("integrations")
      .upsert(
        { provider, access_token, expires_at: expiresAt, updated_at: new Date().toISOString(), metadata: { shop_domain: store, source: "client_credentials" } },
        { onConflict: "provider" }
      );
    return access_token;
  } catch {
    return null;
  }
}

export interface ShopifyOrderDetail {
  id: string;
  name: string;
  createdAt: string;
  total: number;
  refunded: number;
  discounts: number;
  currency: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  customerName: string | null;
  customerEmail: string | null;
  itemCount: number;
}

export interface ShopifyCustomerSummary {
  id: string;
  name: string;
  email: string | null;
  ordersCount: number;
  totalSpent: number;
}

export async function fetchShopifyStoreDetail(
  storeCode: string,
  fromDate: string,
  toDate: string
): Promise<{
  store: string;
  storeCode: string;
  live: boolean;
  error?: string;
  currency: string;
  totals: { revenue: number; orders: number; refunds: number; discounts: number; aov: number; uniqueCustomers: number };
  orders: ShopifyOrderDetail[];
  customers: ShopifyCustomerSummary[];
  truncated: boolean;
} | null> {
  const meta = SHOPIFY_STORE_LIST.find((s) => s.code === storeCode);
  if (!meta) return null;
  const store = process.env[meta.storeKey];
  if (!store) return { store: meta.name, storeCode, live: false, error: "Store env var missing", currency: "EUR", totals: { revenue: 0, orders: 0, refunds: 0, discounts: 0, aov: 0, uniqueCustomers: 0 }, orders: [], customers: [], truncated: false };

  const token = await getShopifyTokenLocal(store);
  if (!token) return { store: meta.name, storeCode, live: false, error: "Could not obtain Shopify token", currency: "EUR", totals: { revenue: 0, orders: 0, refunds: 0, discounts: 0, aov: 0, uniqueCustomers: 0 }, orders: [], customers: [], truncated: false };

  const since = `${fromDate}T00:00:00Z`;
  const until = `${toDate}T23:59:59Z`;
  const orders: ShopifyOrderDetail[] = [];
  const customerMap = new Map<string, ShopifyCustomerSummary>();
  let revenue = 0,
    refundsTotal = 0,
    discountsTotal = 0,
    currency = "EUR";

  const QUERY = (cursor: string | null) => `{
    orders(first:100, ${cursor ? `after:"${cursor}",` : ""}query:"created_at:>=${since} created_at:<=${until}", sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id name createdAt
        displayFinancialStatus displayFulfillmentStatus
        totalPriceSet     { shopMoney { amount currencyCode } }
        totalRefundedSet  { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        lineItems(first: 1) { edges { node { id } } }
        subtotalLineItemsQuantity
        customer { id displayName email }
      }}
    }
  }`;

  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;
  // Cap pages to keep response under ~10s. 10 pages × 100 = 1,000 orders/page,
  // covers typical date ranges. Truncated flag tells UI when more exists.
  const MAX_PAGES = 10;

  try {
    while (hasNextPage && page < MAX_PAGES) {
      const res: Response = await fetch(`https://${store}/admin/api/2025-01/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY(cursor) }),
      });
      if (!res.ok) break;
      const json = await res.json();
      if (json.errors) {
        console.error("Shopify detail GQL:", json.errors[0]?.message);
        break;
      }
      const pageData = json.data?.orders ?? {};
      const edges: any[] = pageData.edges ?? [];
      hasNextPage = pageData.pageInfo?.hasNextPage ?? false;
      cursor = pageData.pageInfo?.endCursor ?? null;
      page++;
      for (const { node: o } of edges) {
        const total = parseFloat(o.totalPriceSet.shopMoney.amount);
        const refunded = parseFloat(o.totalRefundedSet.shopMoney.amount);
        const disc = parseFloat(o.totalDiscountsSet.shopMoney.amount);
        revenue += total;
        refundsTotal += refunded;
        discountsTotal += disc;
        currency = o.totalPriceSet.shopMoney.currencyCode;
        orders.push({
          id: o.id,
          name: o.name,
          createdAt: o.createdAt,
          total,
          refunded,
          discounts: disc,
          currency,
          financialStatus: o.displayFinancialStatus ?? null,
          fulfillmentStatus: o.displayFulfillmentStatus ?? null,
          customerName: o.customer?.displayName ?? null,
          customerEmail: o.customer?.email ?? null,
          itemCount: o.subtotalLineItemsQuantity ?? 0,
        });
        if (o.customer?.id) {
          const cid = o.customer.id;
          const existing = customerMap.get(cid);
          if (existing) {
            existing.ordersCount += 1;
            existing.totalSpent += total;
          } else {
            customerMap.set(cid, {
              id: cid,
              name: o.customer.displayName ?? "—",
              email: o.customer.email ?? null,
              ordersCount: 1,
              totalSpent: total,
            });
          }
        }
      }
    }
  } catch (err: any) {
    return {
      store: meta.name,
      storeCode,
      live: false,
      error: err?.message ?? String(err),
      currency,
      totals: { revenue: 0, orders: 0, refunds: 0, discounts: 0, aov: 0, uniqueCustomers: 0 },
      orders: [],
      customers: [],
      truncated: false,
    };
  }

  const customers = Array.from(customerMap.values()).sort((a, b) => b.totalSpent - a.totalSpent);

  return {
    store: meta.name,
    storeCode,
    live: true,
    currency,
    totals: {
      revenue: +revenue.toFixed(2),
      orders: orders.length,
      refunds: +refundsTotal.toFixed(2),
      discounts: +discountsTotal.toFixed(2),
      aov: orders.length > 0 ? +(revenue / orders.length).toFixed(2) : 0,
      uniqueCustomers: customers.length,
    },
    orders,
    customers,
    truncated: hasNextPage,
  };
}

// ─── Loop subscription detail (per market) ───────────────────────────────────
export async function fetchLoopMarketDetail(marketCode: string, fromDate: string, toDate: string) {
  const KEY_MAP: Record<string, string> = {
    UK: "LOOP_UK_API_KEY",
    US: "LOOP_US_API_KEY",
    EU: "LOOP_EU_API_KEY",
  };
  const envKey = KEY_MAP[marketCode];
  if (!envKey) return null;
  const key = process.env[envKey];
  if (!key) return { live: false, error: `${envKey} not set`, market: marketCode, subscriptions: [], totals: {} };

  const BASE = "https://api.loopsubscriptions.com";
  const headers = { "X-Loop-Token": key, Accept: "application/json" };
  const fromMs = new Date(`${fromDate}T00:00:00Z`).getTime();
  const toMs = new Date(`${toDate}T23:59:59Z`).getTime();
  const allSubs: any[] = [];
  // Cap pages to keep request fast. 15 × 50 = 750 most-recent subs.
  const MAX_PAGES = 15;
  let apiReached = false;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      // Removed 600ms sleep — Loop allows ~2 req/s, our concurrency is 1.
      let res: Response = await fetch(`${BASE}/admin/2023-10/subscription?limit=50&page=${page}`, { headers, cache: "no-store" });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        res = await fetch(`${BASE}/admin/2023-10/subscription?limit=50&page=${page}`, { headers, cache: "no-store" });
      }
      if (!res.ok) break;
      apiReached = true;
      const json = await res.json();
      const batch: any[] = json.data ?? [];
      allSubs.push(...batch);
      if (!json.pageInfo?.hasNextPage || batch.length === 0) break;
    }
  } catch (err: any) {
    return { live: false, error: err?.message, market: marketCode, subscriptions: [], totals: {} };
  }

  if (!apiReached) return { live: false, error: "Loop API unreachable", market: marketCode, subscriptions: [], totals: {} };

  const filtered = allSubs.filter((s) => {
    const created = s.createdAt ? new Date(s.createdAt).getTime() : 0;
    return created >= fromMs && created <= toMs;
  });

  const currency = marketCode === "US" ? "USD" : marketCode === "UK" ? "GBP" : "EUR";
  const subs = filtered.map((s) => ({
    id: s.id,
    status: s.status ?? null,
    price: parseFloat(s.totalLineItemPrice ?? "0"),
    currency: s.currencyCode ?? currency,
    createdAt: s.createdAt ?? null,
    cancelledAt: s.cancelledAt ?? null,
    nextBillingDate: s.nextBillingDate ?? null,
    customerEmail: s.email ?? s.customer?.email ?? null,
    customerName: s.customer?.displayName ?? s.customer?.firstName ?? null,
  }));

  const active = subs.filter((s) => s.status === "ACTIVE");
  const canceled = subs.filter((s) => s.status === "CANCELLED");
  const mrr = active.reduce((sum, s) => sum + s.price, 0);

  return {
    live: true,
    platform: "loop" as const,
    market: marketCode,
    currency,
    totals: {
      total: subs.length,
      active: active.length,
      canceled: canceled.length,
      mrr: +mrr.toFixed(2),
      arpu: active.length > 0 ? +(mrr / active.length).toFixed(2) : 0,
    },
    subscriptions: subs,
  };
}

// ─── Juo subscription detail (NL only) ───────────────────────────────────────
export async function fetchJuoDetail(fromDate: string, toDate: string) {
  const apiKey = process.env.JUO_NL_API_KEY;
  if (!apiKey) return { live: false, error: "JUO_NL_API_KEY not set", market: "NL", subscriptions: [], totals: {} };

  const BASE = "https://api.juo.io";
  const headers = { "X-Juo-Admin-Api-Key": apiKey, Accept: "application/json" };
  const fromMs = new Date(`${fromDate}T00:00:00Z`).getTime();
  const toMs = new Date(`${toDate}T23:59:59Z`).getTime();
  const allSubs: any[] = [];
  let nextUrl: string | null = `${BASE}/admin/v1/subscriptions?limit=100`;
  // Cap to keep response fast. 15 × 100 = 1,500 most-recent subs.
  const MAX_PAGES = 15;
  let page = 0;
  let apiReached = false;

  try {
    while (nextUrl && page < MAX_PAGES) {
      const res: Response = await fetch(nextUrl, { headers, cache: "no-store" });
      if (res.status === 429) {
        const reset = parseInt(res.headers.get("X-RateLimit-Reset") ?? "2", 10);
        await new Promise((r) => setTimeout(r, (reset || 2) * 1000));
        continue;
      }
      if (!res.ok) break;
      apiReached = true;
      const json = await res.json();
      const batch: any[] = json.data ?? json.subscriptions ?? (Array.isArray(json) ? json : []);
      if (batch.length === 0) break;
      allSubs.push(...batch);
      const link: string = res.headers.get("Link") ?? "";
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      if (m) {
        const href = m[1];
        nextUrl = href.startsWith("http") ? href : new URL(href, BASE).toString();
      } else {
        nextUrl = null;
      }
      page++;
    }
  } catch (err: any) {
    return { live: false, error: err?.message, market: "NL", subscriptions: [], totals: {} };
  }

  if (!apiReached) return { live: false, error: "Juo API unreachable", market: "NL", subscriptions: [], totals: {} };

  const filtered = allSubs.filter((s) => {
    const created = s.createdAt ? new Date(s.createdAt).getTime() : 0;
    return created >= fromMs && created <= toMs;
  });

  const subs = filtered.map((s) => {
    const items = s.items ?? [];
    const itemTotal = items.reduce((sum: number, it: any) => sum + parseFloat(it.price ?? it.unitPrice ?? "0"), 0);
    return {
      id: s.id,
      status: s.status ?? null,
      price: itemTotal,
      currency: s.currencyCode ?? "EUR",
      createdAt: s.createdAt ?? null,
      canceledAt: s.canceledAt ?? null,
      nextBillingDate: s.nextBillingDate ?? null,
      customerEmail: s.customer?.email ?? null,
      customerName: s.customer?.firstName
        ? `${s.customer.firstName} ${s.customer.lastName ?? ""}`.trim()
        : null,
      interval: s.billingPolicy?.interval ?? "month",
      intervalCount: s.billingPolicy?.intervalCount ?? 1,
    };
  });

  const active = subs.filter((s) => s.status === "active");
  const canceled = subs.filter((s) => s.status === "canceled");
  function normalizeMonthly(price: number, interval: string, n: number): number {
    const k = n || 1;
    switch (interval) {
      case "day": return (price / k) * 30;
      case "week": return (price / k) * 4.33;
      case "year": return price / (k * 12);
      default: return price / k;
    }
  }
  const mrr = active.reduce((sum, s) => sum + normalizeMonthly(s.price, s.interval, s.intervalCount), 0);

  return {
    live: true,
    platform: "juo" as const,
    market: "NL",
    currency: subs[0]?.currency ?? "EUR",
    totals: {
      total: subs.length,
      active: active.length,
      canceled: canceled.length,
      mrr: +mrr.toFixed(2),
      arpu: active.length > 0 ? +(mrr / active.length).toFixed(2) : 0,
    },
    subscriptions: subs,
  };
}

// ─── Jortt invoices detail ───────────────────────────────────────────────────
async function getJorttTokenForScope(scope: string): Promise<string | null> {
  const clientId = process.env.JORTT_CLIENT_ID;
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
      body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return j.access_token ?? null;
  } catch {
    return null;
  }
}

export async function fetchJorttInvoiceDetail(fromDate: string, toDate: string) {
  const BASE = "https://api.jortt.nl";
  const fromMs = new Date(`${fromDate}T00:00:00Z`).getTime();
  const toMs = new Date(`${toDate}T23:59:59Z`).getTime();

  const token = await getJorttTokenForScope("invoices:read");
  if (!token) return { live: false, error: "Could not obtain Jortt token", invoices: [], unpaid: [], totals: {} };

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Fetch invoices for ALL relevant statuses (sent invoices that are paid become
  // status=paid in Jortt — they are NOT returned by ?invoice_status=sent).
  // We fetch sent + paid + unpaid and merge.
  async function fetchAllPagesByStatus(status: string, maxPages = 20): Promise<any[]> {
    const out: any[] = [];
    for (let p = 1; p <= maxPages; p++) {
      try {
        const r = await fetch(
          `${BASE}/v1/invoices?per_page=100&page=${p}&invoice_status=${status}`,
          { headers, cache: "no-store" }
        );
        if (!r.ok) break;
        const j: any = await r.json();
        if (j?.error) break;
        const batch: any[] = j.data ?? [];
        out.push(...batch);
        if (batch.length < 100) break;
      } catch {
        break;
      }
    }
    return out;
  }

  let allSent: any[] = [];
  let allPaid: any[] = [];
  let allUnpaid: any[] = [];
  try {
    [allSent, allPaid, allUnpaid] = await Promise.all([
      fetchAllPagesByStatus("sent"),
      fetchAllPagesByStatus("paid"),
      fetchAllPagesByStatus("unpaid", 5),
    ]);
  } catch (err: any) {
    return { live: false, error: err?.message, invoices: [], unpaid: [], totals: {} };
  }

  // Deduplicate sent + paid by invoice id (an invoice that moves sent→paid
  // would, in theory, only show in one bucket, but be safe).
  const allRevenue = [...allSent, ...allPaid];
  const seen = new Set<string>();
  const dedupedRevenue = allRevenue.filter((i) => {
    const id = i.invoice_id ?? i.id ?? i.invoice_number;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const norm = (i: any) => ({
    id: i.invoice_id ?? i.id ?? "",
    number: i.invoice_number ?? "",
    customer: i.customer_company_name ?? i.customer_name ?? "—",
    invoiceDate: i.invoice_date ?? null,
    dueDate: i.invoice_due_date ?? null,
    total: parseFloat(i.invoice_total_incl_vat?.value ?? i.invoice_total?.value ?? "0"),
    due: parseFloat(i.invoice_due_amount?.value ?? "0"),
    status: i.invoice_status ?? "sent",
    currency: i.invoice_total_incl_vat?.currency ?? "EUR",
  });

  const inRangeRevenue = dedupedRevenue.map(norm).filter((i) => {
    if (!i.invoiceDate) return false;
    const t = new Date(i.invoiceDate).getTime();
    return t >= fromMs && t <= toMs;
  });
  const unpaidNorm = allUnpaid.map(norm);

  const totalRevenue = inRangeRevenue.reduce((s, i) => s + i.total, 0);
  const accountsReceivable = unpaidNorm.reduce((s, i) => s + i.due, 0);
  const overdueNow = Date.now();
  const overdue = unpaidNorm.filter(
    (i) => i.dueDate && new Date(i.dueDate).getTime() < overdueNow
  );

  // Sort newest first for display
  inRangeRevenue.sort((a, b) =>
    new Date(b.invoiceDate ?? 0).getTime() - new Date(a.invoiceDate ?? 0).getTime()
  );

  return {
    live: true,
    invoices: inRangeRevenue,
    unpaid: unpaidNorm,
    totals: {
      revenue: +totalRevenue.toFixed(2),
      invoiceCount: inRangeRevenue.length,
      accountsReceivable: +accountsReceivable.toFixed(2),
      unpaidCount: unpaidNorm.length,
      overdueCount: overdue.length,
      overdueAmount: +overdue.reduce((s, i) => s + i.due, 0).toFixed(2),
    },
    // Diagnostics so the UI can tell user "we found X invoices total but none in range"
    diagnostics: {
      totalSentFetched: allSent.length,
      totalPaidFetched: allPaid.length,
      totalUnpaidFetched: allUnpaid.length,
      dateRange: { from: fromDate, to: toDate },
    },
  };
}
