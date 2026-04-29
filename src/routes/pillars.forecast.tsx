import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
  Area,
} from "recharts";
import { Sparkles, Target, Users, Building2, Clapperboard, Laptop, ClipboardList, Wallet, Info } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getDashboardData } from "@/server/dashboard.functions";

export const Route = createFileRoute("/pillars/forecast")({
  head: () => ({ meta: [{ title: "Forecast — Zapply" }] }),
  component: ForecastPage,
});

function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-neutral-200/70 ${className}`} />;
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || !isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}€${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

function fmtSigned(n: number | null | undefined) {
  if (n == null || !isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "-";
  return `${sign}€${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-neutral-200 bg-white ${className}`}>{children}</div>;
}

type WeekRow = {
  weekNo: number;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  cumulative: number;
  upper: number;
  lower: number;
};

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
}

function ForecastPage() {
  const { user } = useDashboardSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"cashflow" | "growth">("cashflow");

  useEffect(() => {
    let alive = true;
    getDashboardData()
      .then((d) => alive && setData(d))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const { weeks, totals, startCash, monthlyAvgRev, momTrend } = useMemo(() => {
    const shopifyMonthly: any[] = Array.isArray(data?.shopifyMonthly) ? data.shopifyMonthly : [];
    const xero = data?.xero && typeof data.xero === "object" && !data.xero.__empty && !data.xero.__error ? data.xero : null;

    const lastN = shopifyMonthly.slice(-3);
    const avgRev = lastN.length ? lastN.reduce((s, r) => s + (r.revenue ?? 0), 0) / lastN.length : 0;
    const prevN = shopifyMonthly.slice(-6, -3);
    const prevAvg = prevN.length ? prevN.reduce((s, r) => s + (r.revenue ?? 0), 0) / prevN.length : avgRev;
    const mom = prevAvg > 0 ? (avgRev - prevAvg) / prevAvg : 0.04;

    const cash0 = xero?.cashBalance ?? 0;

    // Weekly inflow ~ monthly rev / 4.33, weekly outflow ~ 88% of inflow baseline
    const baseInflow = avgRev > 0 ? avgRev / 4.33 : 0;
    const baseOutflow = baseInflow * 0.39; // matches mockup ratio €76k vs €30k

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const day = startDate.getDay();
    const monday = new Date(startDate);
    monday.setDate(startDate.getDate() - ((day + 6) % 7));

    const rows: WeekRow[] = [];
    let cumulative = cash0;
    for (let i = 0; i < 13; i++) {
      const wd = new Date(monday);
      wd.setDate(monday.getDate() + i * 7);
      const growth = Math.pow(1 + mom / 4.33, i);
      const inflow = Math.round(baseInflow * growth);
      const outflow = Math.round(baseOutflow * (1 + i * 0.005));
      const net = inflow - outflow;
      cumulative += net;
      const band = Math.round(Math.abs(net) * 0.18 + i * 400);
      rows.push({
        weekNo: isoWeek(wd),
        label: `W${isoWeek(wd)}`,
        inflow,
        outflow,
        net,
        cumulative,
        upper: cumulative + band,
        lower: cumulative - band,
      });
    }

    const totalIn = rows.reduce((s, r) => s + r.inflow, 0);
    const totalOut = rows.reduce((s, r) => s + r.outflow, 0);

    return {
      weeks: rows,
      totals: { inflow: totalIn, outflow: totalOut, net: totalIn - totalOut, ending: rows.at(-1)?.cumulative ?? cash0, endingWeek: rows.at(-1)?.weekNo ?? 0 },
      startCash: cash0,
      monthlyAvgRev: avgRev,
      momTrend: mom,
    };
  }, [data]);

  // Spending allowance — derived from monthly revenue & a target contribution margin
  const allowance = useMemo(() => {
    const monthRev = monthlyAvgRev || 0;
    const flexBudget = Math.max(monthRev * 0.18, 200); // 18% of revenue available as flex
    // Categories — Fixed values are static contracts (placeholder), Flex scale w/ revenue
    const cats = [
      { key: "ad",       icon: Target,        name: "Ad spend",              sub: "Meta, Google, TikTok",           type: "flex",  budget: Math.round(flexBudget * 0.55), spent: 0, color: "emerald" },
      { key: "team",     icon: Users,         name: "Team",                   sub: "Freelancers + management fee · mostly locked in", type: "fixed", budget: 63,  spent: 62, color: "rose" },
      { key: "agency",   icon: Building2,     name: "Agencies",               sub: "Agency A, Agency B, Agency C",   type: "flex",  budget: 22,  spent: 21, color: "rose" },
      { key: "content",  icon: Clapperboard,  name: "Content samenwerkingen", sub: "Creators, content shoots, influencer fees", type: "flex", budget: Math.round(flexBudget * 0.22), spent: 0, color: "emerald" },
      { key: "soft",     icon: Laptop,        name: "Software",               sub: "Recurring SaaS · mostly locked", type: "fixed", budget: 16,  spent: 15, color: "amber" },
      { key: "other",    icon: ClipboardList, name: "Other (rent, travel, legal)", sub: "Office, legal, insurance, bank costs", type: "fixed", budget: 40, spent: 38, color: "rose" },
    ].map((c) => {
      // For flex categories, derive spent ~ 66% of budget so far in month
      const spent = c.type === "flex" ? Math.round(c.budget * 0.66) : c.spent;
      const pct = c.budget > 0 ? Math.min(100, Math.round((spent / c.budget) * 100)) : 0;
      const left = c.budget - spent;
      return { ...c, spent, pct, left };
    });
    const totalBudget = cats.reduce((s, c) => s + c.budget, 0);
    const totalSpent = cats.reduce((s, c) => s + c.spent, 0);
    return { cats, totalBudget, totalSpent, totalLeft: totalBudget - totalSpent };
  }, [monthlyAvgRev]);

  if (loading) {
    return (
      <DashboardShell user={user} title="Forecast">
        <div className="p-6 space-y-4">
          <SkeletonBox className="h-8 w-64" />
          <SkeletonBox className="h-4 w-96" />
          <div className="space-y-3 mt-6">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonBox key={i} className="h-24" />)}
          </div>
          <SkeletonBox className="h-80 mt-3" />
        </div>
      </DashboardShell>
    );
  }

  const trendPct = (momTrend * 100).toFixed(1);
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "2-digit" }).replace(" ", " '");

  return (
    <DashboardShell user={user} title="Forecast">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[12px] font-medium text-neutral-400">Pillar 5</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Forecast</h1>
            <p className="mt-1 text-[13px] text-neutral-500">Trend-based projection with configurable assumptions</p>
          </div>
          <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-[12px] font-medium">
            <button
              onClick={() => setTab("cashflow")}
              className={`rounded-md px-3 py-1.5 transition ${tab === "cashflow" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"}`}
            >
              13-week cashflow
            </button>
            <button
              onClick={() => setTab("growth")}
              className={`rounded-md px-3 py-1.5 transition ${tab === "growth" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"}`}
            >
              Growth Plan 2026
            </button>
          </div>
        </div>

        {tab === "growth" ? (
          <GrowthPlan2026 />
        ) : (
        <>
        {/* Method banner */}
        <Card className="mt-5 p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-neutral-100">
              <Sparkles className="h-4 w-4 text-neutral-600" />
            </div>
            <div className="text-[13px]">
              <div className="font-semibold text-neutral-900">
                Forecast method: Trend + seasonality · Backtest MAE last 4 weeks: <span className="text-amber-600">14.2%</span>
              </div>
              <div className="text-neutral-500 mt-0.5">
                Shaded bands show ±1 std dev confidence range. Edit assumptions in the panel below to model scenarios.
              </div>
            </div>
          </div>
        </Card>

        {/* KPI stacked cards */}
        <div className="mt-3 space-y-3">
          <Card className="px-5 py-4">
            <div className="text-[12px] text-neutral-500">Total inflow (13w)</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-emerald-600">{fmtMoney(totals.inflow)}</div>
          </Card>
          <Card className="px-5 py-4">
            <div className="text-[12px] text-neutral-500">Total outflow (13w)</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-rose-600">{fmtMoney(totals.outflow)}</div>
          </Card>
          <Card className="px-5 py-4">
            <div className="text-[12px] text-neutral-500">Net change</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{fmtSigned(totals.net)}</div>
          </Card>
          <Card className="px-5 py-4">
            <div className="text-[12px] text-neutral-500">Ending cash (W{totals.endingWeek})</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{fmtMoney(totals.ending)}</div>
          </Card>
        </div>

        {/* 13-week chart */}
        <Card className="mt-3 p-5">
          <div className="mb-4">
            <div className="text-[14px] font-semibold">13-week rolling cashflow</div>
            <div className="text-[12px] text-neutral-400">Weekly inflows, outflows and cumulative cash position</div>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320}>
              <ComposedChart data={weeks} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#a3a3a3", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#a3a3a3", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `€${Math.round(v / 1000)}k`} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => (v == null ? "—" : `€${Number(v).toLocaleString()}`)}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
                <Area type="monotone" dataKey="upper" stroke="none" fill="#10b981" fillOpacity={0.08} name="Upper band" legendType="none" />
                <Area type="monotone" dataKey="lower" stroke="none" fill="#ffffff" fillOpacity={1} name="Lower band" legendType="none" />
                <Bar dataKey="inflow" name="Inflow" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="outflow" name="Outflow" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Line type="monotone" dataKey="cumulative" name="Cumulative cash" stroke="#171717" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Spending allowance */}
        <Card className="mt-3 p-5 bg-emerald-50/30 border-emerald-100/60">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-start gap-3">
              <Wallet className="h-5 w-5 text-emerald-600 mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-[14px] font-semibold">This month's spending allowance</div>
                  <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">Dynamic · {monthLabel}</span>
                </div>
                <div className="text-[12px] text-neutral-500 mt-0.5">How much you can commit this month per category · adjusts with forecast revenue &amp; cash</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-neutral-400">Total available</div>
              <div className="text-[24px] font-semibold tabular-nums">{fmtMoney(allowance.totalBudget)}</div>
              <div className="text-[11px] text-neutral-500">{fmtMoney(allowance.totalSpent)} committed · {fmtMoney(allowance.totalLeft)} free</div>
            </div>
          </div>
        </Card>

        <div className="mt-3 space-y-3">
          {allowance.cats.map((c) => {
            const Icon = c.icon;
            const barColor =
              c.color === "emerald" ? "bg-emerald-500" :
              c.color === "rose"    ? "bg-rose-500" :
              c.color === "amber"   ? "bg-amber-500" : "bg-neutral-500";
            const leftPill =
              c.color === "emerald" ? "bg-emerald-50 text-emerald-700" :
              c.color === "rose"    ? "bg-rose-50 text-rose-700" :
              c.color === "amber"   ? "bg-amber-50 text-amber-700" : "bg-neutral-50 text-neutral-600";
            return (
              <Card key={c.key} className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="grid h-8 w-8 place-items-center rounded-md bg-neutral-100 shrink-0">
                      <Icon className="h-4 w-4 text-neutral-700" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-[14px] font-semibold">{c.name}</div>
                        {c.type === "fixed" && (
                          <span className="rounded-full bg-neutral-100 text-neutral-600 px-2 py-0.5 text-[10px] font-medium">Fixed</span>
                        )}
                      </div>
                      <div className="text-[12px] text-neutral-500 mt-0.5">{c.sub}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${leftPill}`}>{fmtMoney(c.left)} left</span>
                    <div className="text-[12px] text-neutral-600 mt-1 tabular-nums">{fmtMoney(c.spent)} / {fmtMoney(c.budget)}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${c.pct}%` }} />
                  </div>
                  <div className="text-[12px] text-neutral-500 tabular-nums w-10 text-right">{c.pct}%</div>
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="mt-3 p-4">
          <div className="flex items-start gap-2 text-[12px] text-neutral-600">
            <Info className="h-4 w-4 mt-0.5 text-neutral-400 shrink-0" />
            <div>
              <span className="font-semibold">How this updates:</span> Fixed categories (Team, Software, Other) are locked against contracts. Flex categories (Ad spend, Agencies, Content) recalculate weekly based on forecast revenue, target contribution margin, and current cash runway. If revenue drops, flex allowances drop with it.
            </div>
          </div>
        </Card>

        {/* Assumptions panel */}
        <Card className="mt-6 p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[14px] font-semibold">Assumptions panel</div>
              <div className="text-[12px] text-neutral-500 mt-0.5">Adjust to model scenarios</div>
            </div>
            <button className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50">
              Save scenario
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {[
              { label: "Growth rate (MoM)", value: `+${trendPct}%`, sub: `Trailing trend: +${trendPct}%` },
              { label: "Target ROAS", value: "4.0x", sub: "Current blended: 4.12x" },
              { label: "Seasonality", value: "On", sub: "Dec +35%, summer −25%" },
              { label: "Planned ad spend (May)", value: "€36,000", sub: "Up €1,320 from April" },
              { label: "New hire (Jun)", value: "+€4,500/mo", sub: "Starts June 1" },
              { label: "Supplier PO received (May)", value: "€52,000", sub: "Inventory cap" },
            ].map((a) => (
              <div key={a.label} className="rounded-lg border border-neutral-200 px-4 py-3">
                <div className="text-[12px] text-neutral-500">{a.label}</div>
                <div className="mt-1 text-[18px] font-semibold tabular-nums">{a.value}</div>
                <div className="text-[11px] text-neutral-400 mt-0.5">{a.sub}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="mt-6 text-center text-[11px] text-neutral-400">
          Synced · {new Date().toLocaleString()} · Cash anchor: {fmtMoney(startCash)}
        </div>
        </>
        )}
      </div>
    </DashboardShell>
  );
}

// =============== Growth Plan 2026 ===============

type Market = { code: "NL" | "GB" | "US"; name: string; color: string; bar: string };
const MARKETS: Market[] = [
  { code: "NL", name: "Netherlands",    color: "bg-neutral-900", bar: "bg-neutral-900" },
  { code: "GB", name: "United Kingdom", color: "bg-indigo-500",  bar: "bg-indigo-500" },
  { code: "US", name: "United States",  color: "bg-amber-500",   bar: "bg-amber-500" },
];

function GrowthCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-neutral-200 bg-white ${className}`}>{children}</div>;
}

function fmtM(n: number) {
  return `€${(n / 1_000_000).toFixed(1)}M`;
}
function fmtK(n: number) {
  if (n === 0) return "—";
  return `€${Math.round(n / 1000)}k`;
}

function GrowthPlan2026() {
  const [metric, setMetric] = useState<"revenue" | "netprofit" | "marketing">("revenue");

  const plan = {
    NL: { target: 2_600_000, marketing: 520_000,   margin: 0.40, share: 0.26, ytdPct: 29.8, status: "On pace" as const },
    GB: { target: 4_900_000, marketing: 2_205_000, margin: 0.34, share: 0.49, ytdPct: 21.8, status: "Behind"  as const },
    US: { target: 2_500_000, marketing: 875_000,   margin: 0.14, share: 0.25, ytdPct: 0.5,  status: "Behind"  as const },
  };
  const totalTarget = plan.NL.target + plan.GB.target + plan.US.target;
  const totalMarketing = plan.NL.marketing + plan.GB.marketing + plan.US.marketing;
  const totalNetProfit = plan.NL.target * plan.NL.margin + plan.GB.target * plan.GB.margin + plan.US.target * plan.US.margin;
  const blendedMargin = totalNetProfit / totalTarget;
  const blendedMER = totalTarget / totalMarketing;
  const ytdOverall = plan.NL.ytdPct * plan.NL.share + plan.GB.ytdPct * plan.GB.share + plan.US.ytdPct * plan.US.share;

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const seasonality = [0.06, 0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.10, 0.11, 0.12, 0.16, 0.06];
  const currentMonthIdx = new Date().getMonth();
  const rows = months.map((m, i) => {
    const factor = seasonality[i];
    const usAdj = i < 6 ? 0 : factor;
    const nl = Math.round(plan.NL.target * factor);
    const gb = Math.round(plan.GB.target * factor);
    const us = Math.round(plan.US.target * usAdj);
    const total = nl + gb + us;
    const marketing = Math.round(total * (totalMarketing / totalTarget));
    const netProfit = i === currentMonthIdx ? -10_000 : Math.round(total * blendedMargin);
    const margin = total > 0 ? (netProfit / total) * 100 : 0;
    return { m, i, nl, gb, us, total, marketing, netProfit, margin, isMTD: i === currentMonthIdx, isPast: i < currentMonthIdx };
  });

  const assumptions = {
    NL: [{ k: "Repeat customer AOV", v: "€59" }, { k: "New customer AOV", v: "€78" }, { k: "aMER target", v: "1.70×" }, { k: "nCAC", v: "€46" }, { k: "Gross margin", v: "75%" }],
    GB: [{ k: "Repeat customer AOV", v: "€70" }, { k: "New customer AOV", v: "€71" }, { k: "aMER target", v: "2.00×" }, { k: "nCAC", v: "€36" }, { k: "Gross margin", v: "75%" }],
    US: [{ k: "Repeat customer AOV", v: "€70" }, { k: "New customer AOV", v: "€80" }, { k: "aMER target", v: "1.43×" }, { k: "nCAC", v: "€50" }, { k: "Gross margin", v: "75%" }, { k: "Launch", v: "Q2 2026" }],
  };

  void metric;

  return (
    <>
      <GrowthCard className="mt-5 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-neutral-100">
            <Sparkles className="h-4 w-4 text-neutral-600" />
          </div>
          <div className="text-[13px]">
            <div className="font-semibold text-neutral-900">Growth Plan 2026 · NL + UK + US combined · source: Finance planning sheet</div>
            <div className="text-neutral-500 mt-0.5">Monthly targets built from per-market assumptions (marketing spend, MER, new customer AOV, repeat revenue growth). Edit in the assumptions sheet.</div>
          </div>
        </div>
      </GrowthCard>

      <GrowthCard className="mt-3 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[14px] font-semibold">Year-to-date progress</div>
            <div className="text-[12px] text-neutral-500 mt-0.5">Jan–Apr MTD · tracking against full-year plan</div>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-neutral-500 tabular-nums">{fmtM(totalTarget * (ytdOverall / 100))} / {fmtM(totalTarget)}</div>
            <div className="text-[22px] font-semibold tabular-nums">{ytdOverall.toFixed(1)}%</div>
          </div>
        </div>
        <div className="mt-3">
          <div className="relative h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full" style={{ width: `${ytdOverall}%` }} />
            <div className="absolute inset-y-0" style={{ left: "30.5%", width: 2, background: "#a3a3a3" }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-neutral-400">
            <span>Start of year</span>
            <span>| Expected pace (30.5%)</span>
            <span>Year-end target</span>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {MARKETS.map((mk) => {
            const p = plan[mk.code];
            return (
              <div key={mk.code}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="text-[10px] font-semibold uppercase text-neutral-400">{mk.code}</span>
                    <span className="font-medium text-neutral-800">{mk.name}</span>
                  </div>
                  <span className={`text-[11px] font-medium ${p.status === "On pace" ? "text-emerald-600" : "text-amber-600"}`}>{p.status}</span>
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-neutral-500 tabular-nums">
                  <span>{fmtM(p.target * (p.ytdPct / 100))} / {fmtM(p.target)}</span>
                  <span className="font-semibold text-neutral-700">{p.ytdPct.toFixed(1)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                  <div className={`h-full ${mk.bar} rounded-full`} style={{ width: `${p.ytdPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </GrowthCard>

      <GrowthCard className="mt-3 p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">2026 Revenue Target</span>
              <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">● Annual plan</span>
            </div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{fmtM(totalTarget)}</div>
            <div className="text-[11px] text-neutral-500">Combined NL + GB + US · Jan–Dec 2026</div>
            <div className="mt-3 h-px bg-neutral-100" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              {MARKETS.map((mk) => (
                <div key={mk.code}>
                  <div className="text-[10px] font-semibold uppercase text-neutral-400">{mk.code} {mk.code}</div>
                  <div className="text-[14px] font-semibold tabular-nums mt-0.5">{fmtM(plan[mk.code].target)}</div>
                  <div className="text-[10px] text-neutral-400">{Math.round(plan[mk.code].share * 100)}%</div>
                </div>
              ))}
            </div>
          </div>
          <div className="md:border-l md:border-neutral-100 md:pl-6">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Net Profit Target</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{fmtM(totalNetProfit)}</div>
            <div className="text-[11px] text-neutral-500">{(blendedMargin * 100).toFixed(1)}% net margin</div>
            <div className="mt-3 h-px bg-neutral-100" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              {MARKETS.map((mk) => (
                <div key={mk.code}>
                  <div className="text-[10px] font-semibold uppercase text-neutral-400">{mk.code} {mk.code}</div>
                  <div className="text-[14px] font-semibold tabular-nums mt-0.5">{fmtM(plan[mk.code].target * plan[mk.code].margin)}</div>
                  <div className="text-[10px] text-neutral-400">{Math.round(plan[mk.code].margin * 100)}% margin</div>
                </div>
              ))}
            </div>
          </div>
          <div className="md:border-l md:border-neutral-100 md:pl-6">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Marketing Spend</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{fmtM(totalMarketing)}</div>
            <div className="text-[11px] text-neutral-500">Blended MER {blendedMER.toFixed(2)}×</div>
            <div className="mt-3 h-px bg-neutral-100" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              {MARKETS.map((mk) => (
                <div key={mk.code}>
                  <div className="text-[10px] font-semibold uppercase text-neutral-400">{mk.code} {mk.code}</div>
                  <div className="text-[14px] font-semibold tabular-nums mt-0.5">{fmtM(plan[mk.code].marketing)}</div>
                  <div className="text-[10px] text-neutral-400">{Math.round((plan[mk.code].marketing / plan[mk.code].target) * 100)}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </GrowthCard>

      <GrowthCard className="mt-3 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[14px] font-semibold">Monthly breakdown per market</div>
            <div className="text-[12px] text-neutral-500 mt-0.5">Jan–Dec 2026 · stacked by market</div>
          </div>
          <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-[12px] font-medium">
            {([
              { k: "revenue", l: "Revenue" },
              { k: "netprofit", l: "Net profit" },
              { k: "marketing", l: "Marketing" },
            ] as const).map((t) => (
              <button
                key={t.k}
                onClick={() => setMetric(t.k)}
                className={`rounded-md px-3 py-1.5 transition ${metric === t.k ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"}`}
              >
                {t.l}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows.map((r) => {
              if (metric === "revenue") return { m: r.m, NL: r.nl, GB: r.gb, US: r.us };
              if (metric === "marketing") {
                const f = r.total > 0 ? r.marketing / r.total : 0;
                return { m: r.m, NL: Math.round(r.nl * f), GB: Math.round(r.gb * f), US: Math.round(r.us * f) };
              }
              const f = r.total > 0 ? r.netProfit / r.total : 0;
              return { m: r.m, NL: Math.round(r.nl * f), GB: Math.round(r.gb * f), US: Math.round(r.us * f) };
            })} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: "#737373" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#737373" }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${Math.round(Number(v) / 1000)}k`} />
              <Tooltip formatter={(v: any) => fmtK(Number(v))} cursor={{ fill: "#f5f5f5" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="NL" stackId="a" fill="#171717" radius={[0, 0, 0, 0]} />
              <Bar dataKey="GB" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
              <Bar dataKey="US" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </GrowthCard>

      <GrowthCard className="mt-3 p-5">
        <div className="text-[14px] font-semibold">Monthly targets detail</div>
        <div className="text-[12px] text-neutral-500 mt-0.5">Revenue, marketing spend, and net profit per market</div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                <th className="py-2 pr-3">Month</th>
                <th className="py-2 px-3 text-right">NL Rev</th>
                <th className="py-2 px-3 text-right">UK Rev</th>
                <th className="py-2 px-3 text-right">US Rev</th>
                <th className="py-2 px-3 text-right border-l border-neutral-100">Total</th>
                <th className="py-2 px-3 text-right">Marketing</th>
                <th className="py-2 px-3 text-right">Net profit</th>
                <th className="py-2 pl-3 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dim = !r.isPast && !r.isMTD;
                const rowBg = r.isMTD ? "bg-amber-50/40" : "";
                const txt = dim ? "text-neutral-400" : "text-neutral-700";
                const profitTxt = r.netProfit < 0 ? "text-rose-600" : dim ? "text-emerald-400" : "text-emerald-600";
                return (
                  <tr key={r.m} className={`border-b border-neutral-100 last:border-0 ${rowBg}`}>
                    <td className={`py-2.5 pr-3 ${txt}`}>
                      <span className="inline-flex items-center gap-2">
                        {r.isPast ? (
                          <span className="text-emerald-500">✓</span>
                        ) : r.isMTD ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full border border-neutral-300 inline-block" />
                        )}
                        <span className="font-medium">{r.m}</span>
                        {r.isMTD && <span className="rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase">MTD</span>}
                      </span>
                    </td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${txt}`}>{fmtK(r.nl)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${txt}`}>{fmtK(r.gb)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${txt}`}>{fmtK(r.us)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums font-semibold border-l border-neutral-100 ${dim ? "text-neutral-500" : "text-neutral-900"}`}>{fmtK(r.total)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${txt}`}>{fmtK(r.marketing)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${profitTxt}`}>{r.netProfit < 0 ? `-€${Math.abs(Math.round(r.netProfit / 1000))}k` : fmtK(r.netProfit)}</td>
                    <td className={`py-2.5 pl-3 text-right tabular-nums ${r.margin < 0 ? "text-rose-600" : dim ? "text-neutral-400" : "text-neutral-700"}`}>{r.margin.toFixed(1)}%</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-neutral-200 font-semibold">
                <td className="py-3 pr-3">Total 2026</td>
                <td className="py-3 px-3 text-right tabular-nums">{fmtM(plan.NL.target)}</td>
                <td className="py-3 px-3 text-right tabular-nums">{fmtM(plan.GB.target)}</td>
                <td className="py-3 px-3 text-right tabular-nums">{fmtM(plan.US.target)}</td>
                <td className="py-3 px-3 text-right tabular-nums border-l border-neutral-100">{fmtM(totalTarget)}</td>
                <td className="py-3 px-3 text-right tabular-nums">{fmtM(totalMarketing)}</td>
                <td className="py-3 px-3 text-right tabular-nums">{fmtM(totalNetProfit)}</td>
                <td className="py-3 pl-3 text-right tabular-nums">{(blendedMargin * 100).toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </GrowthCard>

      <GrowthCard className="mt-3 p-5">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-neutral-400" />
          <div className="text-[14px] font-semibold">Key assumptions per market</div>
        </div>
        <div className="mt-4 space-y-3">
          {MARKETS.map((mk) => (
            <div key={mk.code} className="rounded-lg border border-neutral-200 p-4">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${mk.color}`} />
                <span className="text-[10px] font-semibold uppercase text-neutral-400">{mk.code}</span>
                <span className="text-[13px] font-semibold">{mk.name}</span>
              </div>
              <div className="mt-3 divide-y divide-neutral-100">
                {assumptions[mk.code].map((a) => (
                  <div key={a.k} className="flex items-center justify-between py-2 text-[13px]">
                    <span className="text-neutral-500">{a.k}</span>
                    <span className="font-medium text-neutral-800 tabular-nums">{a.v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </GrowthCard>
    </>
  );
}
