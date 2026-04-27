import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import FinanceDashboard from "@/components/FinanceDashboard";
import { getDashboardData } from "@/server/dashboard.functions";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Zapply Finance Dashboard" },
      { name: "description", content: "Zapply Group B.V. — Internal Finance Dashboard" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { user, loading } = useDashboardSession();
  const [data, setData] = useState<Awaited<ReturnType<typeof getDashboardData>> | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoadingData(true);
    getDashboardData()
      .then((d) => setData(d))
      .finally(() => setLoadingData(false));
  }, [user]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading dashboard…</div>
      </div>
    );
  }

  const Dashboard = FinanceDashboard as unknown as React.FC<any>;

  return (
    <DashboardShell user={user} title="Overview">
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
