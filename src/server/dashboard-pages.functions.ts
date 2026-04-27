import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchShopifyStoreDetail,
  fetchLoopMarketDetail,
  fetchJuoDetail,
  fetchJorttInvoiceDetail,
  SHOPIFY_STORE_LIST,
} from "./dashboard-detail.server";
import { fetchTripleWhale, fetchXero } from "./fetchers.server";
import { readAllCache } from "./cache.server";

const dateRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const STORE_OPTIONS = SHOPIFY_STORE_LIST.map((s) => ({
  code: s.code,
  flag: s.flag,
  name: s.name,
}));

// ─── Store dashboard (Shopify) ──────────────────────────────────────────────
export const getStoreDashboard = createServerFn({ method: "GET" })
  .inputValidator(
    dateRangeSchema.extend({
      storeCode: z.enum(["NL", "UK", "US", "EU"]),
    })
  )
  .handler(async ({ data }) => {
    try {
      const detail = await fetchShopifyStoreDetail(data.storeCode, data.from, data.to);
      return { detail, error: null as string | null };
    } catch (err: any) {
      return { detail: null, error: err?.message ?? String(err) };
    }
  });

// ─── Triple Whale dashboard ─────────────────────────────────────────────────
export const getTripleWhaleDashboard = createServerFn({ method: "GET" })
  .inputValidator(dateRangeSchema)
  .handler(async ({ data }) => {
    try {
      const live = await fetchTripleWhale(data.from, data.to);
      if (live) return { data: live, source: "live" as const, error: null };
      // fallback to cache
      const cache = await readAllCache();
      const cached = cache["triplewhale/summary"]?.payload ?? null;
      return { data: cached, source: cached ? ("cache" as const) : ("none" as const), error: null };
    } catch (err: any) {
      return { data: null, source: "error" as const, error: err?.message ?? String(err) };
    }
  });

// ─── Subscription dashboard (Loop UK/US/EU OR Juo NL) ───────────────────────
export const getSubscriptionDashboard = createServerFn({ method: "GET" })
  .inputValidator(
    dateRangeSchema.extend({
      storeCode: z.enum(["NL", "UK", "US", "EU"]),
    })
  )
  .handler(async ({ data }) => {
    try {
      if (data.storeCode === "NL") {
        const result = await fetchJuoDetail(data.from, data.to);
        return { data: result, platform: "juo" as const, error: null as string | null };
      }
      const result = await fetchLoopMarketDetail(data.storeCode, data.from, data.to);
      return { data: result, platform: "loop" as const, error: null as string | null };
    } catch (err: any) {
      return { data: null, platform: null, error: err?.message ?? String(err) };
    }
  });

// ─── Invoice dashboard (Jortt) ──────────────────────────────────────────────
export const getInvoiceDashboard = createServerFn({ method: "GET" })
  .inputValidator(dateRangeSchema)
  .handler(async ({ data }) => {
    try {
      const result = await fetchJorttInvoiceDetail(data.from, data.to);
      return { data: result, error: null as string | null };
    } catch (err: any) {
      return { data: null, error: err?.message ?? String(err) };
    }
  });

// ─── Accounting dashboard (Xero) ────────────────────────────────────────────
export const getAccountingDashboard = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const live = await fetchXero();
    if (live) return { data: live, source: "live" as const, error: null };
    const cache = await readAllCache();
    const cached = cache["xero/accounting"]?.payload ?? null;
    return { data: cached, source: cached ? ("cache" as const) : ("none" as const), error: null };
  } catch (err: any) {
    return { data: null, source: "error" as const, error: err?.message ?? String(err) };
  }
});
