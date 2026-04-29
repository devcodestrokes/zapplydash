import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getDashboardData } from "@/server/dashboard.functions";
import { OverviewView } from "@/components/FinanceDashboard";

const PRESETS = ["today","yesterday","7d","30d","mtd","last_month","90d","ytd","custom"] as const;
type Preset = (typeof PRESETS)[number];

const searchSchema = z.object({
  preset: z.enum(PRESETS).catch("30d").default("30d"),
  from: z.string().catch("").default(""),
  to: z.string().catch("").default(""),
});

export const Route = createFileRoute("/overview-dashboard")({
  validateSearch: (input: Record<string, unknown>) => searchSchema.parse(input),
  head: () => ({
    meta: [
      { title: "Overview — Zapply" },
      { name: "description", content: "Live revenue, ad performance and reconciled finance overview." },
    ],
  }),
  component: OverviewPage,
});

function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-neutral-200/70 ${className}`} />;
}

function OverviewSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <SkeletonBox className="h-8 w-64" />
      <SkeletonBox className="h-4 w-96" />
      <SkeletonBox className="h-32 mt-6" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 mt-3">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonBox key={i} className="h-24" />)}
      </div>
      <SkeletonBox className="h-72 mt-3" />
    </div>
  );
}

function OverviewPage() {
  const { user } = useDashboardSession();
  const search = Route.useSearch();
  const [range, setRange] = useState<string>(search.preset === "7d" || search.preset === "30d" || search.preset === "90d" ? search.preset : "30d");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getDashboardData()
      .then((d) => alive && setData(d))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  // Normalize live data into shapes OverviewView expects
  const shopifyMarketsArr = Array.isArray(data?.shopifyMarkets) ? data.shopifyMarkets : [];
  const liveMarkets = shopifyMarketsArr.some((m: any) => m?.live) ? shopifyMarketsArr : null;
  const twData = (Array.isArray(data?.tripleWhale) ? data.tripleWhale : []).filter((m: any) => m?.live);
  const loopData = Array.isArray(data?.loop) ? data.loop : [];

  return (
    <DashboardShell user={user ?? { email: "", name: "Loading…", avatar: null }} title="Overview">
      {loading ? (
        <OverviewSkeleton />
      ) : (
        <div className="p-6 bg-neutral-50 min-h-full" style={{ fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif' }}>
          <OverviewView
            dateRange={range}
            onDateChange={setRange}
            liveMarkets={liveMarkets}
            twData={twData}
            subData={loopData}
            shopifyMonthly={Array.isArray(data?.shopifyMonthly) ? data.shopifyMonthly : null}
            jorttData={data?.jortt && !data.jortt.__empty && !data.jortt.__error ? data.jortt : null}
          />
          <div className="mt-10 text-center text-[11px] text-neutral-400">
            {data?.syncedAt ? `Synced · ${new Date(data.syncedAt).toLocaleString()}` : "No live sources connected"}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
