import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getDashboardData } from "@/server/dashboard.functions";
import { MonthlyView } from "@/components/FinanceDashboard";

export const Route = createFileRoute("/pillars/monthly-overview")({
  head: () => ({ meta: [{ title: "Monthly Overview — Zapply" }] }),
  component: MonthlyOverviewPage,
});

function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-neutral-200/70 ${className}`} />;
}

function PillarSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <SkeletonBox className="h-8 w-64" />
      <SkeletonBox className="h-4 w-96" />
      <SkeletonBox className="h-32 mt-6" />
      <SkeletonBox className="h-72 mt-3" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mt-3">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonBox key={i} className="h-20" />)}
      </div>
    </div>
  );
}

function MonthlyOverviewPage() {
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

  if (loading) {
    return (
      <DashboardShell user={user} title="Monthly Overview">
        <PillarSkeleton />
      </DashboardShell>
    );
  }

  const jorttObj = data?.jortt && typeof data.jortt === "object" && !data.jortt.__empty && !data.jortt.__error ? data.jortt : null;
  const opexByMonth = Array.isArray(jorttObj?.opexByMonth) && jorttObj.opexByMonth.length > 0 ? jorttObj.opexByMonth : null;
  const opexDetail = jorttObj?.opexDetail ?? null;
  const jorttLive = !!(jorttObj?.live);
  const deniedScopes = Array.isArray(jorttObj?.deniedScopes) ? jorttObj.deniedScopes : [];
  const shopifyMonthly = Array.isArray(data?.shopifyMonthly) ? data.shopifyMonthly : [];
  const twData = (Array.isArray(data?.tripleWhale) ? data.tripleWhale : []).filter((m: any) => m?.live);
  const shopifyLive = shopifyMonthly.length > 0;

  return (
    <DashboardShell user={user} title="Monthly Overview">
      <div className="p-6">
        {(shopifyLive || jorttLive) ? (
          <MonthlyView
            opexByMonth={opexByMonth}
            opexDetail={opexDetail}
            jorttLive={jorttLive}
            deniedScopes={deniedScopes}
            shopifyMonthly={shopifyMonthly}
            twData={twData}
            jortt={jorttObj}
          />
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-800">
            <strong>Monthly Overview</strong> requires Shopify or Jortt data.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
