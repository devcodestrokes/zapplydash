import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getDashboardData, getTripleWhaleRange } from "@/server/dashboard.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pillars/daily-pnl")({
  head: () => ({ meta: [{ title: "Daily P&L — Zapply" }] }),
  component: DailyPnlPage,
});

type TodayRow = {
  code: string;
  flag?: string;
  name?: string;
  revenue?: number;
  orders?: number;
  aov?: number;
  currency?: string;
  live?: boolean;
  hourly?: { hour: number; revenue: number; orders: number }[];
};

type TwRow = {
  market?: string;
  code?: string;
  revenue?: number | null;
  adSpend?: number | null;
  grossProfit?: number | null;
  roas?: number | null;
};

const MARKET_ORDER = ["NL", "UK", "US", "EU"];
const NAMES: Record<string, string> = {
  NL: "Netherlands",
  UK: "United Kingdom",
  US: "United States",
  EU: "Germany / EU",
};
const FLAGS: Record<string, string> = { NL: "🇳🇱", UK: "🇬🇧", US: "🇺🇸", EU: "🇩🇪" };
const DEFAULT_CCY: Record<string, string> = { NL: "EUR", UK: "GBP", US: "USD", EU: "EUR" };

function fmtMoney(n: number | null | undefined, currency = "EUR") {
  if (n == null || !isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString("en-GB")}`;
  }
}

function todayIso() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function monthStartIso() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function isoNDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function weekStartIso() {
  // ISO week start = Monday
  const d = new Date();
  const day = d.getUTCDay(); // 0..6 (Sun..Sat)
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

type Period = "today" | "wtd" | "mtd";

function DailyPnlPage() {
  const { user } = useDashboardSession();
  const [today, setToday] = useState<TodayRow[]>([]);
  const [twToday, setTwToday] = useState<TwRow[]>([]);
  const [wtd, setWtd] = useState<TwRow[]>([]);
  const [mtd, setMtd] = useState<TwRow[]>([]);
  const [twPrevTuesdays, setTwPrevTuesdays] = useState<TwRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("today");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = todayIso();
    Promise.all([
      getDashboardData(),
      getTripleWhaleRange({ data: { from: t, to: t } }).catch(() => ({ rows: [] })),
      getTripleWhaleRange({ data: { from: weekStartIso(), to: t } }).catch(() => ({ rows: [] })),
      getTripleWhaleRange({ data: { from: monthStartIso(), to: t } }).catch(() => ({ rows: [] })),
      // Same weekday last 4 weeks (rough comparison baseline for "Today")
      getTripleWhaleRange({ data: { from: isoNDaysAgo(28), to: isoNDaysAgo(7) } }).catch(() => ({ rows: [] })),
    ])
      .then((results: any[]) => {
        const [d, twT, twW, twM, twPrev] = results;
        if (!alive) return;
        const rawToday = d?.shopifyToday as any;
        const todayArr: TodayRow[] = Array.isArray(rawToday)
          ? rawToday
          : Array.isArray(rawToday?.markets)
          ? rawToday.markets
          : [];
        const sToday = todayArr.filter((r) => r && r.code);
        setToday(sToday);
        setTwToday((twT?.rows as TwRow[]) || []);
        setWtd((twW?.rows as TwRow[]) || []);
        setMtd((twM?.rows as TwRow[]) || []);
        setTwPrevTuesdays((twPrev?.rows as TwRow[]) || []);
        setSyncedAt(d?.syncedAt ?? null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    return MARKET_ORDER.map((code) => {
      const t = today.find((r) => r.code === code);
      const tw: any = twToday.find((r: any) => (r.code || r.market) === code) || {};
      const m: any = mtd.find((r: any) => (r.code || r.market) === code) || {};
      const currency = t?.currency || tw.sourceCurrency || DEFAULT_CCY[code];
      // TW values are converted to EUR (multiplied by fxRate). Convert back to
      // the store's local currency so the table reads in £ / US$ / € natively.
      const fx = typeof tw.fxRate === "number" && tw.fxRate > 0 ? tw.fxRate : 1;
      const toLocal = (v: number | null | undefined) =>
        v == null ? null : v / fx;

      const revenue = t?.revenue ?? toLocal(tw.revenue) ?? 0;
      const orders = t?.orders ?? tw.orders ?? 0;
      const aov = t?.aov ?? (orders > 0 && revenue ? revenue / orders : 0);
      const adSpend = toLocal(tw.adSpend);
      const grossProfit = toLocal(tw.grossProfit);
      const netProfit =
        grossProfit != null && adSpend != null ? grossProfit - adSpend : null;
      return {
        code,
        name: NAMES[code],
        flag: FLAGS[code],
        currency,
        revenue,
        orders,
        aov,
        roas: tw.roas ?? null,
        adSpend,
        grossProfit,
        netProfit,
        roasMtd: m.roas ?? null,
        adSpendMtd: m.adSpend != null ? m.adSpend / fx : null,
        grossProfitMtd: m.grossProfit != null ? m.grossProfit / fx : null,
        hourly: t?.hourly || [],
      };
    });
  }, [today, twToday, mtd]);

  const totalOrdersToday = rows.reduce((s, r) => s + (r.orders || 0), 0);

  const nl = rows.find((r) => r.code === "NL")!;
  const uk = rows.find((r) => r.code === "UK")!;

  // Hourly chart for NL
  const maxHourly = Math.max(1, ...nl.hourly.map((h) => h.revenue));
  const lastHour = new Date().getUTCHours() + 2; // CEST
  const visibleHours = nl.hourly.filter((h) => h.hour <= lastHour);

  const sourcesCount = 4; // Shopify, Jortt, Triple Whale, Juo + Loop
  const syncedAgo = syncedAt
    ? `${Math.max(1, Math.round((Date.now() - new Date(syncedAt).getTime()) / 60000))}m ago`
    : "—";

  if (loading) {
    return (
      <DashboardShell user={user} title="Daily P&L">
        <DailyPnlSkeleton />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell user={user} title="Daily P&L">
      <div className="bg-muted/20 min-h-full p-6 md:p-8">
        <div className="mx-auto max-w-6xl space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Pillar 1</div>
              <h2 className="mt-1 text-3xl font-bold tracking-tight">Daily P&L Tracker</h2>
              <div className="mt-1 text-sm text-muted-foreground">
                {format(new Date(), "EEEE, d MMMM yyyy")}
              </div>
            </div>
            <div className="text-right text-xs">
              <div className="text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle mr-1.5" />
                Live · {totalOrdersToday} orders today
              </div>
              <div className="mt-1 space-x-2 text-muted-foreground">
                {rows.map((r) => (
                  <span key={r.code}>
                    <span className="text-[10px] uppercase mr-0.5">{r.code}</span>
                    {fmtMoney(r.revenue, r.currency)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Per-market tiles */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {rows.map((r) => (
              <div
                key={r.code}
                className="rounded-xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {r.code} <span className="ml-0.5 font-medium normal-case text-foreground">{r.name}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">
                      {r.roas != null ? `${r.roas.toFixed(2)}×` : "—"}
                    </div>
                    <div className="text-[10px] uppercase text-muted-foreground">ROAS</div>
                  </div>
                </div>
                <div className="mt-3 text-2xl font-bold">{fmtMoney(r.revenue, r.currency)}</div>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{r.orders} orders</span>
                  <span>AOV {fmtMoney(r.aov, r.currency)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Daily P&L per Shopify store */}
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <div className="text-sm font-semibold">Daily P&L by store</div>
                <div className="text-xs text-muted-foreground">
                  Today · revenue, ad spend, gross profit and net (gross − ad spend)
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">Triple Whale + Shopify</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-5 py-2.5">Store</th>
                    <th className="text-right font-medium px-3 py-2.5">Revenue</th>
                    <th className="text-right font-medium px-3 py-2.5">Orders</th>
                    <th className="text-right font-medium px-3 py-2.5">Ad spend</th>
                    <th className="text-right font-medium px-3 py-2.5">Gross profit</th>
                    <th className="text-right font-medium px-3 py-2.5">Net P&L</th>
                    <th className="text-right font-medium px-5 py-2.5">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const netPositive = r.netProfit != null && r.netProfit >= 0;
                    return (
                      <tr key={r.code} className="border-t">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{r.flag}</span>
                            <div>
                              <div className="font-medium leading-tight">{r.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {r.code} · Shopify
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">
                          {fmtMoney(r.revenue, r.currency)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {r.orders}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {fmtMoney(r.adSpend, r.currency)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {fmtMoney(r.grossProfit, r.currency)}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-semibold ${
                            r.netProfit == null
                              ? ""
                              : netPositive
                              ? "text-emerald-600"
                              : "text-red-600"
                          }`}
                        >
                          {fmtMoney(r.netProfit, r.currency)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {r.roas != null ? `${r.roas.toFixed(2)}×` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold">Hourly revenue · NL</div>
                <div className="text-xs text-muted-foreground">
                  Amsterdam time (CEST) · paid orders only
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold">{fmtMoney(nl.revenue, nl.currency)}</div>
                <div className="text-[11px] text-muted-foreground">today so far</div>
              </div>
            </div>

            <div className="mt-5 relative h-56">
              {/* gridlines */}
              <div className="absolute inset-0 flex flex-col justify-between text-[10px] text-muted-foreground">
                {[1, 0.66, 0.33, 0].map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-10 text-right">
                      {fmtMoney(maxHourly * p, nl.currency)}
                    </span>
                    <div className="flex-1 border-t border-dashed border-border/60" />
                  </div>
                ))}
              </div>
              {/* bars */}
              <div className="absolute inset-0 ml-12 flex items-end gap-[3px]">
                {Array.from({ length: 24 }).map((_, h) => {
                  const v = visibleHours.find((x) => x.hour === h)?.revenue ?? 0;
                  const heightPct = (v / maxHourly) * 100;
                  return (
                    <div key={h} className="flex flex-1 flex-col items-center justify-end h-full">
                      <div
                        className="w-full rounded-sm bg-[hsl(220_60%_15%)] transition-all"
                        style={{ height: `${heightPct}%`, minHeight: v > 0 ? 2 : 0 }}
                        title={`${String(h).padStart(2, "0")}:00 · ${fmtMoney(v, nl.currency)}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {/* x-axis */}
            <div className="ml-12 mt-1 flex gap-[3px] text-[10px] text-muted-foreground">
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="flex-1 text-center">
                  {h % 2 === 0 ? String(h).padStart(2, "0") : ""}
                </div>
              ))}
            </div>
          </div>

          {/* UK today + UK ROAS MTD */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                UK revenue today
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtMoney(uk.revenue, uk.currency)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {uk.orders} orders · AOV {fmtMoney(uk.aov, uk.currency)}
              </div>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                UK ROAS (MTD)
              </div>
              <div className="mt-2 text-2xl font-bold">
                {uk.roas != null ? `${uk.roas.toFixed(2)}×` : "—"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Ad spend {fmtMoney(uk.adSpendMtd, uk.currency)} MTD
              </div>
            </div>
          </div>

          {/* NL MTD strip */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                NL ad spend (MTD)
              </div>
              <div className="mt-2 text-2xl font-bold">
                {fmtMoney(nl.adSpendMtd, nl.currency)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Triple Whale</div>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                NL ROAS (MTD)
              </div>
              <div className="mt-2 text-2xl font-bold">
                {nl.roas != null ? `${nl.roas.toFixed(2)}×` : "—"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Triple Whale</div>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                NL gross profit (MTD)
              </div>
              <div className="mt-2 text-2xl font-bold">
                {fmtMoney(nl.grossProfitMtd, nl.currency)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Triple Whale</div>
            </div>
          </div>

          <div className="pt-2 text-center text-[11px] text-muted-foreground">
            {sourcesCount} live sources · Shopify, Jortt, Triple Whale, Juo (NL), Loop (UK) · synced{" "}
            {syncedAgo}
          </div>

        </div>
      </div>
    </DashboardShell>
  );
}

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/60",
        className
      )}
    />
  );
}

function DailyPnlSkeleton() {
  return (
    <div className="bg-muted/20 min-h-full p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <SkeletonBox className="h-3 w-16" />
            <SkeletonBox className="h-8 w-72" />
            <SkeletonBox className="h-3 w-40" />
          </div>
          <div className="space-y-2 text-right">
            <SkeletonBox className="ml-auto h-3 w-32" />
            <SkeletonBox className="ml-auto h-3 w-56" />
          </div>
        </div>

        {/* Tiles */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <div className="flex items-start justify-between">
                <SkeletonBox className="h-3 w-24" />
                <SkeletonBox className="h-3 w-10" />
              </div>
              <SkeletonBox className="h-7 w-32" />
              <SkeletonBox className="h-3 w-40" />
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="space-y-2">
              <SkeletonBox className="h-3 w-32" />
              <SkeletonBox className="h-3 w-64" />
            </div>
            <SkeletonBox className="h-3 w-24" />
          </div>
          <div className="divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid grid-cols-7 gap-3 px-5 py-3 items-center">
                <SkeletonBox className="h-6 col-span-1" />
                <SkeletonBox className="h-4" />
                <SkeletonBox className="h-4" />
                <SkeletonBox className="h-4" />
                <SkeletonBox className="h-4" />
                <SkeletonBox className="h-4" />
                <SkeletonBox className="h-4" />
              </div>
            ))}
          </div>
        </div>

        {/* Hourly chart */}
        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <SkeletonBox className="h-3 w-40" />
              <SkeletonBox className="h-3 w-56" />
            </div>
            <SkeletonBox className="h-6 w-24" />
          </div>
          <div className="flex h-56 items-end gap-[3px]">
            {Array.from({ length: 24 }).map((_, i) => (
              <SkeletonBox
                key={i}
                className="flex-1"
                // varying heights for nicer skeleton
              />
            ))}
          </div>
        </div>

        {/* Bottom strips */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <SkeletonBox className="h-3 w-32" />
              <SkeletonBox className="h-7 w-28" />
              <SkeletonBox className="h-3 w-40" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <SkeletonBox className="h-3 w-32" />
              <SkeletonBox className="h-7 w-28" />
              <SkeletonBox className="h-3 w-24" />
            </div>
          ))}
        </div>

        <div className="pt-2 text-center text-[11px] text-muted-foreground">
          Loading fresh data…
        </div>
      </div>
    </div>
  );
}

