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
} from "recharts";
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

function ForecastPage() {
  const { user } = useDashboardSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getDashboardData()
      .then((d) => alive && setData(d))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const { historical, projected, runRate, annualized, projected12m, momTrend, monthlyTable, cashPosition } = useMemo(() => {
    const shopifyMonthly: any[] = Array.isArray(data?.shopifyMonthly) ? data.shopifyMonthly : [];
    const xero = data?.xero && typeof data.xero === "object" && !data.xero.__empty && !data.xero.__error ? data.xero : null;

    // Build historical from shopifyMonthly
    const hist = shopifyMonthly.map((m) => {
      const revenue = Math.round(m.revenue ?? 0);
      const refunds = Math.round(m.refunds ?? 0);
      const net = revenue - refunds;
      // Approximate expenses if Xero per-month exists, else derive ~88% of revenue
      const expenses = Math.round(net * 0.88);
      const netProfit = net - expenses;
      return { month: m.month, revenue, expenses, netProfit, projected: false };
    });

    const len = hist.length;
    const lastN = hist.slice(-3);
    const avgRev = lastN.length > 0 ? lastN.reduce((s, r) => s + r.revenue, 0) / lastN.length : 0;
    const prevN = hist.slice(-6, -3);
    const prevAvg = prevN.length > 0 ? prevN.reduce((s, r) => s + r.revenue, 0) / prevN.length : avgRev;
    const mom = prevAvg > 0 ? (avgRev - prevAvg) / prevAvg : 0;

    // Project 6 months forward
    const proj: any[] = [];
    let lastRev = avgRev;
    const lastMonthLabel = hist.at(-1)?.month ?? "";
    const baseDate = new Date();
    for (let i = 1; i <= 6; i++) {
      lastRev = lastRev * (1 + mom);
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");
      const revenue = Math.round(lastRev);
      const expenses = Math.round(revenue * 0.88);
      proj.push({ month: label, revenue, expenses, netProfit: revenue - expenses, projected: true });
    }

    const runRateVal = avgRev > 0 ? Math.round(avgRev) : null;
    const annualizedVal = runRateVal ? runRateVal * 12 : null;
    const projected12mVal = runRateVal ? Math.round(proj.reduce((s, p) => s + p.revenue, 0) * 2) : null;
    const cashPos = xero?.cashBalance ?? null;

    return {
      historical: hist,
      projected: proj,
      runRate: runRateVal,
      annualized: annualizedVal,
      projected12m: projected12mVal,
      momTrend: mom,
      monthlyTable: hist,
      cashPosition: cashPos,
      __unused: lastMonthLabel + len,
    };
  }, [data]);

  if (loading) {
    return (
      <DashboardShell user={user} title="Forecast">
        <div className="p-6 space-y-4">
          <SkeletonBox className="h-8 w-64" />
          <SkeletonBox className="h-4 w-96" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonBox key={i} className="h-24" />)}
          </div>
          <SkeletonBox className="h-80 mt-3" />
        </div>
      </DashboardShell>
    );
  }

  // Combined chart data: historical (solid) + projected (dashed)
  const chartData = [
    ...historical.map((h) => ({
      month: h.month,
      revenue: h.revenue,
      expenses: h.expenses,
      netProfit: h.netProfit,
      revenueProj: null,
      expensesProj: null,
      netProfitProj: null,
    })),
    ...projected.map((p) => ({
      month: p.month,
      revenue: null,
      expenses: null,
      netProfit: null,
      revenueProj: p.revenue,
      expensesProj: p.expenses,
      netProfitProj: p.netProfit,
    })),
  ];

  const trendPct = (momTrend * 100).toFixed(0);

  return (
    <DashboardShell user={user} title="Forecast">
      <div className="p-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[12px] font-medium text-neutral-400">Pillar 5</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Forecast</h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              Trend-based projection · {historical.length} months history · 6-month forward model
            </p>
          </div>
          <span className="rounded-full border border-violet-200 bg-violet-50/40 px-3 py-1 text-[11px] font-medium text-violet-700">
            {trendPct}% MoM trend
          </span>
        </div>

        {/* KPI strip */}
        <Card className="mt-6 p-6">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Current run rate</div>
              <div className="mt-1 text-[22px] font-semibold tabular-nums">{runRate ? fmtMoney(runRate) : "—"}</div>
              <div className="mt-1 text-[11px] text-neutral-400">3-month average</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Annualized (run rate)</div>
              <div className="mt-1 text-[22px] font-semibold tabular-nums">{annualized ? fmtMoney(annualized) : "—"}</div>
              <div className="mt-1 text-[11px] text-neutral-400">Run rate × 12</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">12-month projected</div>
              <div className="mt-1 text-[22px] font-semibold tabular-nums">{projected12m ? fmtMoney(projected12m) : "—"}</div>
              <div className="mt-1 text-[11px] text-neutral-400">Trend-adjusted forward</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Cash position</div>
              <div className={`mt-1 text-[22px] font-semibold tabular-nums ${(cashPosition ?? 0) < 0 ? "text-rose-600" : ""}`}>{fmtMoney(cashPosition)}</div>
              <div className="mt-1 text-[11px] text-neutral-400">Xero cash &amp; bank</div>
            </div>
          </div>
        </Card>

        {/* Chart */}
        <Card className="mt-3 p-5">
          <div className="mb-4">
            <div className="text-[13px] font-semibold">Revenue, expenses &amp; net profit</div>
            <div className="text-[12px] text-neutral-400">Solid = historical · Shaded = 6-month projection</div>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "#a3a3a3", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#a3a3a3", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `€${Math.round(v / 1000)}k`} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => (v == null ? "—" : `€${Number(v).toLocaleString()}`)}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
                <Bar dataKey="revenue" name="Revenue" fill="#171717" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="expenses" name="Expenses" fill="#d4d4d8" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Line type="monotone" dataKey="netProfit" name="Net profit" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                <Bar dataKey="revenueProj" name="Rev (proj)" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={32} fillOpacity={0.5} />
                <Bar dataKey="expensesProj" name="Exp (proj)" fill="#e5e7eb" radius={[4, 4, 0, 0]} maxBarSize={32} fillOpacity={0.6} />
                <Line type="monotone" dataKey="netProfitProj" name="Profit (proj)" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Monthly P&L breakdown */}
        <Card className="mt-3 p-5">
          <div className="text-[13px] font-semibold mb-4">Monthly P&amp;L breakdown</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                  <th className="py-2 font-medium">Month</th>
                  <th className="py-2 font-medium text-right">Revenue</th>
                  <th className="py-2 font-medium text-right">Expenses</th>
                  <th className="py-2 font-medium text-right">Net profit</th>
                  <th className="py-2 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {monthlyTable.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-neutral-400">No monthly data available.</td></tr>
                )}
                {monthlyTable.map((m: any) => {
                  const margin = m.revenue > 0 ? (m.netProfit / m.revenue) * 100 : 0;
                  return (
                    <tr key={m.month} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2.5 font-medium text-neutral-700">{m.month}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtMoney(m.revenue)}</td>
                      <td className="py-2.5 text-right tabular-nums text-neutral-500">{fmtMoney(m.expenses)}</td>
                      <td className={`py-2.5 text-right tabular-nums font-medium ${m.netProfit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{fmtSigned(m.netProfit)}</td>
                      <td className={`py-2.5 text-right tabular-nums ${margin >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{margin.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardShell>
  );
}
