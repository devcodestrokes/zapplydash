import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import FinanceDashboard from "@/components/FinanceDashboard";
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

function OverviewDashboardPage() {
  const { user, loading } = useDashboardSession();
  const fetchDashboard = useCallback(() => getDashboardData(), []);
  const { data, isLoading: loadingData } = useInstantDashboardData<Awaited<ReturnType<typeof getDashboardData>>>(
    "overview",
    fetchDashboard,
    !!user
  );

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading dashboard…</div>
      </div>
    );
  }

  const Dashboard = FinanceDashboard as unknown as React.FC<any>;

  return (
    <DashboardShell user={user} title="Overview Dashboard">
      {loadingData || !data ? (
        <div className="p-8 text-sm text-muted-foreground">Loading data…</div>
      ) : (
        <Dashboard
          user={user}
          liveData={{
            shopifyMarkets: data.shopifyMarkets,
            shopifyMonthly: data.shopifyMonthly,
            shopifyToday: data.shopifyToday,
            tripleWhale: data.tripleWhale,
            juo: data.juo,
            loop: data.loop,
            jortt: data.jortt,
            xero: data.xero,
          }}
          connections={data.connections}
          syncedAt={data.syncedAt}
          dataIsStale={data.dataIsStale}
          hasAnyData={data.hasAnyData}
          embedded
        />
      )}
    </DashboardShell>
  );
}
