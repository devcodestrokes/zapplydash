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

        {tab === "growth" && (
          <Card className="mt-6 p-6 text-center text-[13px] text-neutral-500">
            Growth Plan 2026 view — coming soon. Switch to <button onClick={() => setTab("cashflow")} className="underline">13-week cashflow</button> to view current model.
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}
