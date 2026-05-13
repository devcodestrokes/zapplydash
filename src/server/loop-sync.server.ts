import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASE = "https://api.loopsubscriptions.com";
const PAGE_SIZE = 100;

// Loop rate limit: 2 requests per 3 seconds.
// Per-market token bucket — markets run in parallel because each has its own API key bucket.
function makeBucket() {
  let queue: Promise<void> = Promise.resolve();
  // 1500ms gap between requests = 2 requests / 3s, sustained.
  const GAP_MS = 1500;
  let lastAt = 0;
  return async function take(): Promise<void> {
    const slot = queue.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, lastAt + GAP_MS - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
    });
    queue = slot.catch(() => undefined);
    return slot;
  };
}

async function fetchAllSubsForStatus(
  apiKey: string,
  status: "ACTIVE" | "CANCELLED" | "PAUSED",
  take: () => Promise<void>,
): Promise<any[]> {
  const headers = { "X-Loop-Token": apiKey, Accept: "application/json" };
  const out: any[] = [];
  let page = 1;
  while (true) {
    await take();
    const url = `${BASE}/admin/2023-10/subscription?pageNo=${page}&pageSize=${PAGE_SIZE}&status=${status}`;
    let res = await fetch(url, { headers, cache: "no-store" });

    // Backoff for 429 — exponential, 3 retries
    let backoff = 3000;
    for (let attempt = 0; attempt < 3 && res.status === 429; attempt++) {
      console.warn(`[loop-sync] 429 on ${status} page ${page}, waiting ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff *= 2;
      await take();
      res = await fetch(url, { headers, cache: "no-store" });
    }

    if (!res.ok) {
      throw new Error(`Loop ${status} page ${page} failed: ${res.status} ${res.statusText}`);
    }
    const json: any = await res.json();
    const batch: any[] = json?.data ?? [];
    out.push(...batch);
    const hasNext =
      json?.pageInfo?.hasNextPage ??
      json?.pagination?.hasNextPage ??
      batch.length === PAGE_SIZE;
    if (!hasNext || batch.length === 0) break;
    page++;
  }
  return out;
}

function mapRow(sub: any): Record<string, any> {
  return {
    id: sub.id,
    shopify_id: sub.shopifyId ?? null,
    origin_order_shopify_id: sub.originOrderShopifyId ?? null,
    created_at: sub.createdAt ?? null,
    updated_at: sub.updatedAt ?? null,
    order_note: sub.orderNote ?? null,
    total_line_item_price:
      sub.totalLineItemPrice != null ? Number(sub.totalLineItemPrice) : null,
    total_line_item_discounted_price:
      sub.totalLineItemDiscountedPrice != null
        ? Number(sub.totalLineItemDiscountedPrice)
        : null,
    delivery_price: sub.deliveryPrice != null ? Number(sub.deliveryPrice) : null,
    currency_code: sub.currencyCode ?? null,
    status: sub.status ?? null,
    cancellation_reason: sub.cancellationReason ?? null,
    cancellation_comment: sub.cancellationComment ?? null,
    completed_orders_count: sub.completedOrdersCount ?? null,
    paused_at: sub.pausedAt ?? null,
    cancelled_at: sub.cancelledAt ?? null,
    is_prepaid: sub.isPrepaid ?? null,
    is_marked_for_cancellation: sub.isMarkedForCancellation ?? null,
    next_billing_date_epoch: sub.nextBillingDateEpoch ?? null,
    last_payment_status: sub.lastPaymentStatus ?? null,
    last_inventory_action: sub.lastInventoryAction ?? null,
    delivery_method: sub.deliveryMethod ?? null,
    billing_policy: sub.billingPolicy ?? null,
    delivery_policy: sub.deliveryPolicy ?? null,
    shipping_address: sub.shippingAddress ?? null,
    lines: sub.lines ?? null,
    attributes: sub.attributes ?? null,
    raw: sub,
    synced_at: new Date().toISOString(),
  };
}

async function upsertChunked(table: "UK_loop" | "US_loop", rows: any[]) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from(table as any)
      .upsert(slice, { onConflict: "id" });
    if (error) throw new Error(`upsert ${table} chunk@${i}: ${error.message}`);
  }
}

export async function syncLoopStore(
  market: "UK" | "US",
): Promise<{ market: string; total: number; statuses: Record<string, number> }> {
  const envKey = market === "UK" ? "LOOP_UK_API_KEY" : "LOOP_US_API_KEY";
  const apiKey = process.env[envKey];
  if (!apiKey) throw new Error(`Missing ${envKey}`);

  const take = makeBucket();
  const statuses: Array<"ACTIVE" | "CANCELLED" | "PAUSED"> = [
    "ACTIVE",
    "CANCELLED",
    "PAUSED",
  ];
  const all: any[] = [];
  const counts: Record<string, number> = {};
  for (const s of statuses) {
    const subs = await fetchAllSubsForStatus(apiKey, s, take);
    counts[s] = subs.length;
    all.push(...subs);
  }

  // Dedupe by id (in case Loop returns the same sub under multiple status calls)
  const byId = new Map<number, any>();
  for (const s of all) byId.set(s.id, s);
  const rows = Array.from(byId.values()).map(mapRow);

  const table = (market === "UK" ? "UK_loop" : "US_loop") as "UK_loop" | "US_loop";
  await upsertChunked(table, rows);

  return { market, total: rows.length, statuses: counts };
}

export async function syncAllLoop(): Promise<
  Array<{ market: string; total: number; statuses: Record<string, number> } | { market: string; error: string }>
> {
  // Each market has its own rate-limit bucket → run in parallel.
  const settled = await Promise.allSettled([syncLoopStore("UK"), syncLoopStore("US")]);
  return settled.map((r, i) => {
    const market = i === 0 ? "UK" : "US";
    return r.status === "fulfilled"
      ? r.value
      : { market, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  });
}
