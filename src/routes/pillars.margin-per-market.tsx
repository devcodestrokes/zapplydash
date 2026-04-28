import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getDashboardData } from "@/server/dashboard.functions";
import { MarketsView as MarketsViewRaw } from "@/components/FinanceDashboard";
const MarketsView: any = MarketsViewRaw;

export const Route = createFileRoute("/pillars/margin-per-market")({
  head: () => ({ meta: [{ title: "Margin per Market — Zapply" }] }),
  component: MarginPerMarketPage,
});

function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-neutral-200/70 ${className}`} />;
}

function PillarSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <SkeletonBox className="h-8 w-64" />
      <SkeletonBox className="h-4 w-96" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mt-6">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonBox key={i} className="h-24" />)}
      </div>
      <SkeletonBox className="h-72 mt-3" />
    </div>
  );
}

function MarginPerMarketPage() {
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
      <DashboardShell user={user} title="Margin per Market">
        <PillarSkeleton />
      </DashboardShell>
    );
  }

  const shopifyMarkets = Array.isArray(data?.shopifyMarkets) ? data.shopifyMarkets : [];
  const activeMarkets = shopifyMarkets.some((m: any) => m?.live) ? shopifyMarkets : null;
  const twData = (Array.isArray(data?.tripleWhale) ? data.tripleWhale : []).filter((m: any) => m?.live);

  return (
    <DashboardShell user={user} title="Margin per Market">
      <div className="p-6">
        {activeMarkets ? (
          <MarketsView liveMarkets={activeMarkets} twData={twData} />
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-800">
            <strong>Margin per Market</strong> requires Shopify &amp; Triple Whale data.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
