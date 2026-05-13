// DB-backed Loop fetchers + status helpers.
// Reads from public."UK_loop" / "US_loop" instead of hitting the Loop API.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LOOP_STORES = [
  { market: "UK", flag: "🇬🇧", table: "UK_loop", currency: "GBP", envKey: "LOOP_UK_API_KEY" },
  { market: "US", flag: "🇺🇸", table: "US_loop", currency: "USD", envKey: "LOOP_US_API_KEY" },
] as const;

const PAGE = 1000;

async function readAll(table: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from(table as any)
      .select(
        "id,status,total_line_item_price,currency_code,created_at,cancelled_at,updated_at",
      )
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function summarize(market: string, flag: string, currency: string, rows: any[], from?: Date, to?: Date) {
  const monthStart = from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const cutoff = to ?? null;

  const activeAsOf = rows.filter((s) => {
    const status = (s.status ?? "").toUpperCase();
    if (cutoff) {
      const created = s.created_at ? new Date(s.created_at) : null;
      if (!created || created > cutoff) return false;
      const cancelled = s.cancelled_at ? new Date(s.cancelled_at) : null;
      if (cancelled && cancelled <= cutoff) return false;
      return true;
    }
    return status === "ACTIVE";
  });

  const mrr = activeAsOf.reduce(
    (sum, s) => sum + parseFloat(s.total_line_item_price ?? "0"),
    0,
  );
  const newInRange = rows.filter((s) => {
    const c = s.created_at ? new Date(s.created_at) : null;
    if (!c) return false;
    if (cutoff) return c >= monthStart && c <= cutoff;
    return c >= monthStart;
  }).length;
  const churnedInRange = rows.filter((s) => {
    const c = s.cancelled_at ? new Date(s.cancelled_at) : null;
    if (!c) return false;
    if (cutoff) return c >= monthStart && c <= cutoff;
    return c >= monthStart;
  }).length;

  const arpu = activeAsOf.length > 0 ? mrr / activeAsOf.length : null;
  const churnRate =
    activeAsOf.length + churnedInRange > 0
      ? +((churnedInRange / (activeAsOf.length + churnedInRange)) * 100).toFixed(1)
      : null;

  return {
    market,
    flag,
    platform: "loop" as const,
    live: true,
    calcVersion: 4,
    rangeMode: !!cutoff,
    mrr: Math.round(mrr),
    activeSubs: activeAsOf.length,
    totalFetched: rows.length,
    newThisMonth: newInRange,
    churnedThisMonth: churnedInRange,
    arpu: arpu != null ? +arpu.toFixed(2) : null,
    churnRate,
    currency,
    source: "db" as const,
  };
}

export async function fetchLoopFromDb() {
  const out: any[] = [];
  for (const s of LOOP_STORES) {
    try {
      const rows = await readAll(s.table);
      out.push(summarize(s.market, s.flag, s.currency, rows));
    } catch (err: any) {
      console.error(`[loop-db] ${s.market} failed:`, err?.message);
    }
  }
  return out.length > 0 ? out : null;
}

export async function fetchLoopFromDbForRange(fromIso: string, toIso: string) {
  const from = new Date(fromIso + "T00:00:00");
  const to = new Date(toIso + "T23:59:59");
  const out: any[] = [];
  for (const s of LOOP_STORES) {
    try {
      const rows = await readAll(s.table);
      out.push(summarize(s.market, s.flag, s.currency, rows, from, to));
    } catch (err: any) {
      console.error(`[loop-db] range ${s.market} failed:`, err?.message);
    }
  }
  return out.length > 0 ? out : null;
}

// ── Status ────────────────────────────────────────────────────────────────────
export async function getLoopDbStatus() {
  const out: Array<{
    market: string;
    table: string;
    dbCount: number;
    lastSyncedAt: string | null;
    maxUpdatedAt: string | null;
    byStatus: Record<string, number>;
  }> = [];
  for (const s of LOOP_STORES) {
    const { count } = await supabaseAdmin
      .from(s.table as any)
      .select("*", { count: "exact", head: true });
    const { data: last } = await supabaseAdmin
      .from(s.table as any)
      .select("synced_at,updated_at")
      .order("synced_at", { ascending: false })
      .limit(1);
    // status breakdown
    const byStatus: Record<string, number> = {};
    for (const st of ["ACTIVE", "CANCELLED", "PAUSED"]) {
      const { count: c } = await supabaseAdmin
        .from(s.table as any)
        .select("*", { count: "exact", head: true })
        .eq("status", st);
      byStatus[st] = c ?? 0;
    }
    const { data: maxUpd } = await supabaseAdmin
      .from(s.table as any)
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    out.push({
      market: s.market,
      table: s.table,
      dbCount: count ?? 0,
      lastSyncedAt: (last?.[0] as any)?.synced_at ?? null,
      maxUpdatedAt: (maxUpd?.[0] as any)?.updated_at ?? null,
      byStatus,
    });
  }
  return out;
}

// Light API peek per market: pages until updatedAt <= maxUpdatedAt in DB.
// Counts subscriptions whose updatedAt is newer than what we have stored.
// Respects 2 req / 3s rate limit.
export async function getLoopApiPending(): Promise<
  Array<{ market: string; pending: number; checked: number; error?: string }>
> {
  const BASE = "https://api.loopsubscriptions.com";
  const PAGE_SIZE = 100;
  const GAP = 1500;
  const dbStatus = await getLoopDbStatus();
  const dbMap = new Map(dbStatus.map((d) => [d.market, d]));

  const results: Array<{ market: string; pending: number; checked: number; error?: string }> = [];
  for (const s of LOOP_STORES) {
    const apiKey = process.env[s.envKey];
    if (!apiKey) {
      results.push({ market: s.market, pending: 0, checked: 0, error: "missing API key" });
      continue;
    }
    const headers = { "X-Loop-Token": apiKey, Accept: "application/json" };
    const maxUpdated = dbMap.get(s.market)?.maxUpdatedAt;
    const cutoff = maxUpdated ? new Date(maxUpdated).getTime() : 0;

    let pending = 0;
    let checked = 0;
    let lastErr: string | undefined;
    try {
      for (const status of ["ACTIVE", "CANCELLED", "PAUSED"] as const) {
        let page = 1;
        let stop = false;
        while (!stop && page <= 50) {
          if (page > 1 || status !== "ACTIVE") {
            await new Promise((r) => setTimeout(r, GAP));
          }
          const url = `${BASE}/admin/2023-10/subscription?pageNo=${page}&pageSize=${PAGE_SIZE}&status=${status}`;
          let res = await fetch(url, { headers, cache: "no-store" });
          if (res.status === 429) {
            await new Promise((r) => setTimeout(r, 4000));
            res = await fetch(url, { headers, cache: "no-store" });
          }
          if (!res.ok) {
            lastErr = `${status} ${res.status}`;
            break;
          }
          const json: any = await res.json();
          const batch: any[] = json?.data ?? [];
          checked += batch.length;
          let pageHasNew = false;
          for (const sub of batch) {
            const u = sub?.updatedAt ? new Date(sub.updatedAt).getTime() : 0;
            if (u > cutoff) {
              pending++;
              pageHasNew = true;
            }
          }
          const hasNext =
            json?.pageInfo?.hasNextPage ?? batch.length === PAGE_SIZE;
          if (!hasNext || !pageHasNew) stop = true;
          page++;
        }
      }
    } catch (err: any) {
      lastErr = err?.message ?? String(err);
    }
    results.push({ market: s.market, pending, checked, error: lastErr });
  }
  return results;
}
