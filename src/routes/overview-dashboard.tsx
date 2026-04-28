import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Wallet,
  Sparkles,
  Target,
  Megaphone,
  Package,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { getDashboardData } from "@/server/dashboard.functions";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { useInstantDashboardData } from "@/components/dashboard/useInstantDashboardData";

export const Route = createFileRoute("/overview-dashboard")({
  head: () => ({
    meta: [
      { title: "Overview Dashboard — Zapply" },
      { name: "description", content: "Zapply Group B.V. — Overview Dashboard" },
    ],
  }),
  component: OverviewDashboardPage,
});

type TWRow = {
  market: string;
  flag?: string;
  live?: boolean;
  revenue?: number | null;
  netRevenue?: number | null;
  orders?: number | null;
  grossProfit?: number | null;
  cogs?: number | null;
  netProfit?: number | null;
  adSpend?: number | null;
  aov?: number | null;
  roas?: number | null;
  mer?: number | null;
  ncpa?: number | null;
  ltvCpa?: number | null;
};

const fmtCurrency = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? `€${Math.round(n).toLocaleString()}`
    : "—";

const fmtNumber = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";

const fmtMultiplier = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(2)}×` : "—";

const sumField = (rows: TWRow[], field: keyof TWRow): number | null => {
  const live = rows.filter((r) => r.live);
  const vals = live
    .map((r) => r[field])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0);
};

function OverviewDashboardPage() {
  const { user, loading } = useDashboardSession();
  const fetchDashboard = useCallback(() => getDashboardData(), []);
  const { data, isLoading: loadingData } = useInstantDashboardData<
    Awaited<ReturnType<typeof getDashboardData>>
  >("overview", fetchDashboard, !!user);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading dashboard…</div>
      </div>
    );
  }

  return (
    <DashboardShell user={user} title="Overview Dashboard">
      {loadingData || !data ? (
        <div className="p-8 text-sm text-muted-foreground">Loading data…</div>
      ) : (
        <DashboardBody tw={(data.tripleWhale ?? []) as TWRow[]} />
      )}
    </DashboardShell>
  );
}

function DashboardBody({ tw }: { tw: TWRow[] }) {
  const liveRows = tw.filter((r) => r.live);
  const hasData = liveRows.length > 0;

  const totalRevenue = sumField(tw, "revenue");
  const totalOrders = sumField(tw, "orders");
  const totalGrossProfit = sumField(tw, "grossProfit");
  const totalCogs = sumField(tw, "cogs");
  const totalNetProfit = sumField(tw, "netProfit");
  const totalAdSpend = sumField(tw, "adSpend");
  const totalAov =
    totalRevenue && totalOrders ? totalRevenue / totalOrders : null;
  const blendedRoas =
    totalRevenue && totalAdSpend ? totalRevenue / totalAdSpend : null;

  const widgets: Array<{
    key: keyof TWRow | "aov" | "roas";
    label: string;
    value: string;
    sub?: string;
    icon: any;
    accent: string;
    breakdown: Array<{
      market: string;
      flag?: string;
      value: string;
    }>;
  }> = [
    {
      key: "revenue",
      label: "Revenue",
      value: fmtCurrency(totalRevenue),
      sub: "All stores · selected period",
      icon: DollarSign,
      accent: "text-emerald-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.revenue ?? null),
      })),
    },
    {
      key: "orders",
      label: "Orders",
      value: fmtNumber(totalOrders),
      sub: "All stores · selected period",
      icon: ShoppingCart,
      accent: "text-blue-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtNumber(r.orders ?? null),
      })),
    },
    {
      key: "grossProfit",
      label: "Gross profit",
      value: fmtCurrency(totalGrossProfit),
      sub:
        totalRevenue && totalGrossProfit
          ? `${((totalGrossProfit / totalRevenue) * 100).toFixed(1)}% margin`
          : "Triple Whale",
      icon: TrendingUp,
      accent: "text-emerald-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.grossProfit ?? null),
      })),
    },
    {
      key: "cogs",
      label: "COGS",
      value: fmtCurrency(totalCogs),
      sub:
        totalRevenue && totalCogs
          ? `${((totalCogs / totalRevenue) * 100).toFixed(1)}% of revenue`
          : "Triple Whale",
      icon: Package,
      accent: "text-amber-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.cogs ?? null),
      })),
    },
    {
      key: "netProfit",
      label: "Net profit",
      value: fmtCurrency(totalNetProfit),
      sub:
        totalRevenue && totalNetProfit
          ? `${((totalNetProfit / totalRevenue) * 100).toFixed(1)}% margin`
          : "Triple Whale",
      icon: Wallet,
      accent: "text-emerald-700",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.netProfit ?? null),
      })),
    },
    {
      key: "adSpend",
      label: "Ad spend",
      value: fmtCurrency(totalAdSpend),
      sub: "Blended · all channels",
      icon: Megaphone,
      accent: "text-rose-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.adSpend ?? null),
      })),
    },
    {
      key: "aov",
      label: "AOV",
      value: typeof totalAov === "number" ? `€${totalAov.toFixed(2)}` : "—",
      sub: "Average order value",
      icon: Target,
      accent: "text-indigo-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value:
          typeof r.aov === "number" ? `€${r.aov.toFixed(2)}` : "—",
      })),
    },
    {
      key: "roas",
      label: "ROAS",
      value: fmtMultiplier(blendedRoas),
      sub: "Blended return on ad spend",
      icon: Sparkles,
      accent: "text-purple-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtMultiplier(r.roas ?? null),
      })),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-[12px] font-medium text-muted-foreground">
          Overview Dashboard
        </div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
          All stores at a glance
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Aggregated KPIs from Triple Whale across every connected store, with
          per-store breakdowns.
        </p>
      </div>

      {!hasData && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No live Triple Whale data available yet. Once the sync completes,
          revenue, orders, profit and ad metrics for each store will appear
          here.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {widgets.map((w) => (
          <KpiWidget key={w.label} widget={w} />
        ))}
      </div>
    </div>
  );
}

function KpiWidget({
  widget,
}: {
  widget: {
    label: string;
    value: string;
    sub?: string;
    icon: any;
    accent: string;
    breakdown: Array<{ market: string; flag?: string; value: string }>;
  };
}) {
  const [open, setOpen] = useState(true);
  const Icon = widget.icon;

  return (
    <div className="rounded-xl border border-border bg-card p-5 transition hover:border-foreground/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <Icon size={14} className={widget.accent} />
          <span>{widget.label}</span>
        </div>
      </div>
      <div className="mt-3 text-[28px] font-semibold tracking-tight tabular-nums">
        {widget.value}
      </div>
      {widget.sub && (
        <div className="mt-1 text-[12px] text-muted-foreground">
          {widget.sub}
        </div>
      )}

      {widget.breakdown.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            <span>By store</span>
            {open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {widget.breakdown.map((b) => (
                <li
                  key={b.market}
                  className="flex items-center justify-between text-[13px]"
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span>{b.flag}</span>
                    <span className="font-medium text-foreground">
                      {b.market}
                    </span>
                  </span>
                  <span className="tabular-nums">{b.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
