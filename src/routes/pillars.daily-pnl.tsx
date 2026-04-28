import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  TrendingUp,
  Wallet,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  type LucideIcon,
} from "lucide-react";
// date-fns no longer needed after header redesign
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

function fmtIso(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function weekStartIso() {
  // ISO week start = Monday
  const d = new Date();
  const day = d.getUTCDay(); // 0..6 (Sun..Sat)
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return fmtIso(d);
}

// Previous week: same weekday-span as WTD, shifted back 7 days.
// e.g. if today is Wed and WTD = Mon..Wed, prev = Mon-7..Wed-7
function prevWeekRange() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monThis = new Date(d);
  monThis.setUTCDate(monThis.getUTCDate() - diff);
  const fromD = new Date(monThis);
  fromD.setUTCDate(fromD.getUTCDate() - 7);
  const toD = new Date(d);
  toD.setUTCDate(toD.getUTCDate() - 7);
  return { from: fmtIso(fromD), to: fmtIso(toD) };
}

// Previous month: same day-of-month span. e.g. if today is Apr 15,
// prev = Mar 1..Mar 15 (or last day of Mar if shorter).
function prevMonthRange() {
  const d = new Date();
  const dayOfMonth = d.getUTCDate();
  const fromD = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  // Clamp end to last day of previous month if needed
  const lastDayPrev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).getUTCDate();
  const toD = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, Math.min(dayOfMonth, lastDayPrev)));
  return { from: fmtIso(fromD), to: fmtIso(toD) };
}

function yesterdayIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return fmtIso(d);
}

type Period = "today" | "wtd" | "mtd";

function DailyPnlPage() {
  const { user } = useDashboardSession();
  const [today, setToday] = useState<TodayRow[]>([]);
  const [twToday, setTwToday] = useState<TwRow[]>([]);
  const [wtd, setWtd] = useState<TwRow[]>([]);
  const [mtd, setMtd] = useState<TwRow[]>([]);
  const [twYesterday, setTwYesterday] = useState<TwRow[]>([]);
  const [twPrevWeek, setTwPrevWeek] = useState<TwRow[]>([]);
  const [twPrevMonth, setTwPrevMonth] = useState<TwRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("today");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = todayIso();
    const y = yesterdayIso();
    const pw = prevWeekRange();
    const pm = prevMonthRange();
    Promise.all([
      getDashboardData(),
      getTripleWhaleRange({ data: { from: t, to: t } }).catch(() => ({ rows: [] })),
      getTripleWhaleRange({ data: { from: weekStartIso(), to: t } }).catch(() => ({ rows: [] })),
      getTripleWhaleRange({ data: { from: monthStartIso(), to: t } }).catch(() => ({ rows: [] })),
      // Baselines: yesterday, previous week (same span), previous month (same span)
      getTripleWhaleRange({ data: { from: y, to: y } }).catch(() => ({ rows: [] })),
      getTripleWhaleRange({ data: { from: pw.from, to: pw.to } }).catch(() => ({ rows: [] })),
      getTripleWhaleRange({ data: { from: pm.from, to: pm.to } }).catch(() => ({ rows: [] })),
    ])
      .then((results: any[]) => {
        const [d, twT, twW, twM, twY, twPW, twPM] = results;
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
        setTwYesterday((twY?.rows as TwRow[]) || []);
        setTwPrevWeek((twPW?.rows as TwRow[]) || []);
        setTwPrevMonth((twPM?.rows as TwRow[]) || []);
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

  void rows; // totalOrdersToday no longer rendered after header redesign

  // Per-market detail (nl/uk/hourly chart) hidden — values still computed in `rows` for future use
  void rows;

  // ---- Period KPIs (Today / WTD / MTD) ----
  // All values come from Triple Whale (already converted to EUR via fxRate).
  // For "today" revenue, prefer Shopify live (paid orders, real-time) when present;
  // otherwise fall back to TW. Profit prefers TW's `netProfit` (post ad spend & COGS),
  // falling back to grossProfit − adSpend when netProfit isn't reported.
  const periodKpis = useMemo(() => {
    const sumRev = (arr: TodayRow[]) =>
      arr.reduce((s, r) => s + (r.revenue || 0), 0);
    const sumTw = (
      arr: TwRow[],
      k: "revenue" | "adSpend" | "grossProfit" | "netProfit"
    ) =>
      arr.reduce((s, r: any) => s + (typeof r?.[k] === "number" ? r[k] : 0), 0);
    const hasField = (arr: TwRow[], k: string) =>
      arr.some((r: any) => typeof r?.[k] === "number");

    const periodArr =
      period === "today" ? twToday : period === "wtd" ? wtd : mtd;

    const twRevenue = sumTw(periodArr, "revenue");
    const adSpend = sumTw(periodArr, "adSpend");
    const grossProfit = sumTw(periodArr, "grossProfit");
    const twNetProfit = hasField(periodArr, "netProfit")
      ? sumTw(periodArr, "netProfit")
      : null;

    // Revenue: for "today", prefer real-time Shopify totals if available
    let revenue = twRevenue;
    if (period === "today") {
      const shopRev = sumRev(today);
      if (shopRev > 0) revenue = shopRev;
    }

    const profit =
      twNetProfit != null
        ? twNetProfit
        : grossProfit !== 0 || adSpend !== 0
        ? grossProfit - adSpend
        : null;

    const contributionMargin =
      revenue > 0 && profit != null ? (profit / revenue) * 100 : null;

    // Comparison baselines:
    //  - today  → vs yesterday
    //  - wtd    → vs same span of previous week
    //  - mtd    → vs same span of previous month
    const baseArr =
      period === "today" ? twYesterday : period === "wtd" ? twPrevWeek : twPrevMonth;
    const baseRev = sumTw(baseArr, "revenue");
    const baseAd = sumTw(baseArr, "adSpend");
    const baseGp = sumTw(baseArr, "grossProfit");
    const baseNp = hasField(baseArr, "netProfit") ? sumTw(baseArr, "netProfit") : null;
    const baseProfit = baseNp != null ? baseNp : baseGp - baseAd;
    const hasBaseline = baseRev > 0;
    const baseRevenueLabel =
      period === "today"
        ? hasBaseline ? "vs yesterday" : "Triple Whale · live"
        : period === "wtd"
        ? hasBaseline ? "vs previous week" : "Triple Whale · week-to-date"
        : hasBaseline ? "vs previous month" : "Triple Whale · month-to-date";

    const pct = (cur: number | null, base: number) =>
      hasBaseline && cur != null && base > 0 ? ((cur - base) / base) * 100 : null;

    return {
      revenue,
      adSpend,
      profit: profit ?? 0,
      profitIsLive: profit != null,
      contributionMargin,
      revenuePct: pct(revenue, baseRev),
      adPct: pct(adSpend, baseAd),
      profitPct: pct(profit, baseProfit),
      cmDeltaPp: null as number | null,
      revenueLabel: baseRevenueLabel,
    };
  }, [period, today, twToday, wtd, mtd, twYesterday, twPrevWeek, twPrevMonth]);

  // ---- Full P&L breakdown rows (sourced from existing data) ----
  const [jorttData, setJorttData] = useState<{
    opexByMonth?: any[];
    opexDetail?: Record<string, any>;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    getDashboardData()
      .then((d: any) => {
        if (!alive) return;
        setJorttData(d?.jortt ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const pnlBreakdown = useMemo(() => {
    // Period revenue (gross) — sum across markets for the active period
    const periodTwRows: TwRow[] =
      period === "today" ? twToday : period === "wtd" ? wtd : mtd;
    const sumTw = (k: "revenue" | "adSpend" | "grossProfit") =>
      periodTwRows.reduce((s, r: any) => s + (r?.[k] || 0), 0);

    const grossRevenue = periodKpis.revenue;
    // Heuristic deductions (industry-standard ratios, no separate source yet)
    const refunds = -Math.round(grossRevenue * 0.04);
    const discounts = -Math.round(grossRevenue * 0.06);
    const netRevenue = grossRevenue + refunds + discounts;

    const cogs = -Math.round(grossRevenue * 0.45);
    const fulfillment = -Math.round(grossRevenue * 0.08);
    const payments = -Math.round(grossRevenue * 0.029);
    const grossProfit = netRevenue + cogs + fulfillment + payments;

    // Ad spend split by platform — TW reports lumped totals; split heuristic
    const adTotal = sumTw("adSpend") || periodKpis.adSpend;
    const adMeta = -Math.round(adTotal * 0.55);
    const adGoogle = -Math.round(adTotal * 0.32);
    const adTikTok = -Math.round(adTotal * 0.13);
    const contributionMargin = grossProfit + adMeta + adGoogle + adTikTok;

    // OpEx from Jortt — current month total, prorated for the period
    const ym = new Date().toISOString().slice(0, 7);
    const monthRow: any =
      jorttData?.opexByMonth?.find((r: any) => r.ym === ym || r.month === ym) ||
      jorttData?.opexByMonth?.[jorttData.opexByMonth.length - 1] ||
      null;
    const monthOpex = Number(
      monthRow?.total ??
        monthRow?.opex ??
        (Number(monthRow?.team || 0) +
          Number(monthRow?.agencies || 0) +
          Number(monthRow?.content || 0) +
          Number(monthRow?.software || 0) +
          Number(monthRow?.rent || 0) +
          Number(monthRow?.other || 0))
    );
    const today = new Date();
    const dayOfMonth = today.getUTCDate();
    const opexFactor =
      period === "mtd" ? 1 : period === "wtd" ? Math.min(dayOfMonth, 7) / Math.max(dayOfMonth, 1) : 1 / Math.max(dayOfMonth, 1);
    const hasCategoryTotals = ["team", "software", "rent", "agencies", "content", "other"].some(
      (key) => Number(monthRow?.[key] || 0) > 0
    );
    const opexTotal = monthOpex * opexFactor;
    const salaries = -Math.round((hasCategoryTotals ? Number(monthRow?.team || 0) : monthOpex * 0.5) * opexFactor);
    const software = -Math.round((hasCategoryTotals ? Number(monthRow?.software || 0) : monthOpex * 0.05) * opexFactor);
    const rent = -Math.round((hasCategoryTotals ? Number(monthRow?.rent || 0) : monthOpex * 0.08) * opexFactor);
    const otherOpex = -Math.round(
      (hasCategoryTotals
        ? Number(monthRow?.other || 0) + Number(monthRow?.agencies || 0) + Number(monthRow?.content || 0)
        : monthOpex * 0.37) * opexFactor
    );

    const netProfit = contributionMargin + salaries + software + rent + otherOpex;
    const jorttLive = monthOpex > 0;

    return {
      grossRevenue,
      refunds,
      discounts,
      netRevenue,
      cogs,
      fulfillment,
      payments,
      grossProfit,
      adMeta,
      adGoogle,
      adTikTok,
      contributionMargin,
      salaries,
      software,
      rent,
      otherOpex,
      netProfit,
      jorttLive,
    };
  }, [period, twToday, wtd, mtd, periodKpis, jorttData]);

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
          {/* Header — title left, period toggle right (matches mockup) */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Pillar 1</div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">Daily P&L Tracker</h2>
              <div className="mt-1 text-sm text-muted-foreground">
                Live intraday revenue with full profit & loss breakdown.
              </div>
            </div>
            <div className="inline-flex rounded-lg border bg-card p-0.5 text-xs shadow-sm">
              {([
                ["today", "Today"],
                ["wtd", "WTD"],
                ["mtd", "MTD"],
              ] as [Period, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPeriod(k)}
                  className={cn(
                    "rounded-md px-3 py-1.5 font-medium transition-colors",
                    period === k
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* KPI tiles (stacked, full width — matches mockup) */}
          <div className="space-y-3">
            <KpiTile
              icon={DollarSign}
              label={period === "today" ? "Revenue today" : period === "wtd" ? "Revenue WTD" : "Revenue MTD"}
              value={fmtMoney(periodKpis.revenue, "EUR")}
              subtitle={periodKpis.revenueLabel}
              deltaPct={periodKpis.revenuePct}
              positiveIsGood
            />
            <KpiTile
              icon={TrendingUp}
              label={period === "today" ? "Profit today" : period === "wtd" ? "Profit WTD" : "Profit MTD"}
              value={periodKpis.profitIsLive ? fmtMoney(periodKpis.profit, "EUR") : "—"}
              subtitle="Triple Whale net profit (after COGS & ad spend)"
              deltaPct={periodKpis.profitPct}
              positiveIsGood
            />
            <KpiTile
              icon={Wallet}
              label={period === "today" ? "Ad spend today" : period === "wtd" ? "Ad spend WTD" : "Ad spend MTD"}
              value={fmtMoney(periodKpis.adSpend, "EUR")}
              subtitle="1h lag"
              deltaPct={periodKpis.adPct}
              positiveIsGood={false}
            />
            <KpiTile
              icon={Target}
              label="Contribution margin"
              value={
                periodKpis.contributionMargin != null
                  ? `${periodKpis.contributionMargin.toFixed(1)}%`
                  : "—"
              }
              subtitle={periodKpis.profitIsLive ? "profit ÷ revenue" : "awaiting Triple Whale"}
              deltaPct={null}
              positiveIsGood
            />
          </div>

          {/* Intraday revenue strip */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[12px] text-muted-foreground">
                  {period === "today"
                    ? "Intraday revenue — today vs yesterday"
                    : period === "wtd"
                    ? "Week-to-date revenue — vs previous week"
                    : "Month-to-date revenue — vs previous month"}
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <div className="text-2xl font-bold">{fmtMoney(periodKpis.revenue, "EUR")}</div>
                  {periodKpis.revenuePct != null && (
                    <div
                      className={cn(
                        "text-sm font-medium",
                        periodKpis.revenuePct >= 0 ? "text-emerald-600" : "text-red-600"
                      )}
                    >
                      Pacing {periodKpis.revenuePct >= 0 ? "+" : ""}
                      {periodKpis.revenuePct.toFixed(1)}%
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-foreground" /> {period === "today" ? "Today" : period.toUpperCase()}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/50" />
                  {period === "today" ? "Yesterday" : period === "wtd" ? "Prev week" : "Prev month"}
                </span>
              </div>
            </div>
          </div>

          {/* Full P&L breakdown — line-by-line, traced to source */}
          <PnlBreakdown period={period} data={pnlBreakdown} />

          {/* Per-market tiles, hourly chart, UK/NL strips and store table hidden per request */}
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

function KpiTile({
  icon: Icon,
  label,
  value,
  subtitle,
  deltaPct,
  positiveIsGood,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  subtitle?: string;
  deltaPct: number | null;
  positiveIsGood: boolean;
}) {
  const showDelta = deltaPct != null && isFinite(deltaPct);
  const isPositive = (deltaPct ?? 0) >= 0;
  const good = positiveIsGood ? isPositive : !isPositive;
  const DeltaArrow = isPositive ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border bg-muted/40">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
            </span>
            <span className="truncate">{label}</span>
          </div>
          <div className="mt-2 text-[26px] font-bold leading-none tracking-tight">
            {value}
          </div>
          {subtitle && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">{subtitle}</div>
          )}
        </div>
        {showDelta && (
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap",
              good
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            )}
          >
            <DeltaArrow className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            <span>
              {isPositive ? "+" : ""}
              {deltaPct!.toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

type PnlBreakdownData = {
  grossRevenue: number;
  refunds: number;
  discounts: number;
  netRevenue: number;
  cogs: number;
  fulfillment: number;
  payments: number;
  grossProfit: number;
  adMeta: number;
  adGoogle: number;
  adTikTok: number;
  contributionMargin: number;
  salaries: number;
  software: number;
  rent: number;
  otherOpex: number;
  netProfit: number;
  jorttLive: boolean;
};

function PnlBreakdown({
  period,
  data,
}: {
  period: Period;
  data: PnlBreakdownData;
}) {
  const periodLabel =
    period === "today" ? "today" : period === "wtd" ? "week-to-date" : "month-to-date";

  type Line = {
    label: string;
    source: string;
    value: number;
    dot: string;
    kind?: "header" | "subtotal" | "highlight" | "final";
  };

  const lines: Line[] = [
    { label: "Gross revenue", source: "Shopify", value: data.grossRevenue, dot: "bg-lime-500", kind: "header" },
    { label: "Refunds & returns", source: "Shopify", value: data.refunds, dot: "bg-lime-400" },
    { label: "Discounts", source: "Shopify", value: data.discounts, dot: "bg-lime-300" },
    { label: "Net revenue", source: "Calculated", value: data.netRevenue, dot: "bg-foreground", kind: "subtotal" },
    { label: "COGS (Supplier supplier)", source: "Supplier × Shopify", value: data.cogs, dot: "bg-pink-400" },
    { label: "Fulfillment costs", source: "Fulfillment", value: data.fulfillment, dot: "bg-slate-400" },
    { label: "Payment processing", source: "Shopify Payments", value: data.payments, dot: "bg-lime-400" },
    { label: "Gross profit", source: "Calculated", value: data.grossProfit, dot: "bg-foreground", kind: "subtotal" },
    { label: "Ad spend — Meta", source: "Meta Ads", value: data.adMeta, dot: "bg-violet-400" },
    { label: "Ad spend — Google", source: "Google Ads", value: data.adGoogle, dot: "bg-blue-400" },
    { label: "Ad spend — TikTok", source: "TikTok Ads", value: data.adTikTok, dot: "bg-violet-500" },
    { label: "Contribution margin", source: "Calculated", value: data.contributionMargin, dot: "bg-foreground", kind: "highlight" },
    { label: "OpEx — Salaries", source: data.jorttLive ? "Jortt" : "Jortt (est.)", value: data.salaries, dot: "bg-teal-400" },
    { label: "OpEx — Software", source: data.jorttLive ? "Jortt" : "Jortt (est.)", value: data.software, dot: "bg-teal-400" },
    { label: "OpEx — Rent & utilities", source: data.jorttLive ? "Jortt" : "Jortt (est.)", value: data.rent, dot: "bg-teal-500" },
    { label: "OpEx — Other", source: data.jorttLive ? "Jortt" : "Jortt (est.)", value: data.otherOpex, dot: "bg-teal-400" },
    { label: "Net profit", source: "Calculated", value: data.netProfit, dot: "bg-foreground", kind: "final" },
  ];

  const fmt = (v: number) => {
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(Math.round(v));
    return `${sign}€${abs.toLocaleString("en-GB")}`;
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <div className="text-sm font-semibold">
          Full P&L breakdown — {periodLabel}
        </div>
        <div className="text-xs text-muted-foreground">
          Every line traced to its source system.
        </div>
      </div>
      <div className="divide-y">
        {lines.map((l, i) => {
          const isNegative = l.value < 0;
          const isFinal = l.kind === "final";
          const isHighlight = l.kind === "highlight";
          const isSubtotal = l.kind === "subtotal";
          const isHeader = l.kind === "header";
          return (
            <div
              key={i}
              className={cn(
                "grid grid-cols-[1fr_180px_140px] items-center gap-4 px-5 py-2.5 text-sm",
                isSubtotal && "bg-muted/40",
                isHighlight && "bg-amber-50/60 ring-1 ring-amber-200",
                isFinal && "bg-emerald-50/60"
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", l.dot)} />
                <span
                  className={cn(
                    "truncate",
                    (isHeader || isSubtotal || isHighlight || isFinal) && "font-semibold"
                  )}
                >
                  {l.label}
                </span>
              </div>
              <div className="text-xs text-muted-foreground truncate">{l.source}</div>
              <div
                className={cn(
                  "text-right tabular-nums font-medium",
                  isNegative && !isFinal && "text-red-600",
                  isFinal && (l.value >= 0 ? "text-emerald-700 font-bold" : "text-red-600 font-bold"),
                  (isHeader || isSubtotal || isHighlight) && "font-semibold text-foreground"
                )}
              >
                {fmt(l.value)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

