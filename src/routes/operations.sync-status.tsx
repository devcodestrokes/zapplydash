import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw, Plug, AlertCircle, ChevronRight, LayoutGrid } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getSyncStatus, getDashboardData } from "@/server/dashboard.functions";

export const Route = createFileRoute("/operations/sync-status")({
  head: () => ({ meta: [{ title: "Sync status — Zapply" }] }),
  component: SyncStatusPage,
});

type SourceRow = {
  provider: string;
  key: string;
  label: string;
  expected: string;
  connected: boolean;
  status: "healthy" | "degraded" | "error" | "disconnected";
  lastSyncedAt: number | null;
  ageMinutes: number | null;
  rowCount: number | null;
  error: string | null;
};

function fmtAge(min: number | null) {
  if (min == null) return "—";
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)} min ago`;
  const h = min / 60;
  if (h < 24) return `${h < 1.5 ? 1 : Math.round(h)} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

const STATUS_LABEL: Record<SourceRow["status"], string> = {
  healthy: "Healthy",
  degraded: "Stale",
  error: "Error",
  disconnected: "Disconnected",
};
const STATUS_DOT: Record<SourceRow["status"], string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  error: "bg-rose-500",
  disconnected: "bg-neutral-400",
};
const STATUS_TXT: Record<SourceRow["status"], string> = {
  healthy: "text-emerald-600",
  degraded: "text-amber-600",
  error: "text-rose-600",
  disconnected: "text-neutral-500",
};

type Connector = {
  id: string;
  name: string;
  api: string;
  iconBg: string;
  iconColor: string;
  // Which sync status entries belong to this connector (provider names)
  providerKeys: string[];
  // How to derive the "X items" suffix
  unit: (data: any, sources: SourceRow[]) => string;
  // Optional bridge / warning chip
  badge?: string;
};

const CONNECTORS: Connector[] = [
  {
    id: "shopify",
    name: "Shopify Plus",
    api: "GraphQL Admin",
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    providerKeys: ["shopify"],
    unit: (data) => {
      const today = Number(data?.shopifyToday?.orders ?? 0);
      if (today > 0) return `${today.toLocaleString("en-GB")} orders`;
      const monthly: any[] = Array.isArray(data?.shopifyMonthly) ? data.shopifyMonthly : [];
      const last = monthly[monthly.length - 1];
      const ord = Number(last?.orders ?? 0);
      return ord > 0 ? `${ord.toLocaleString("en-GB")} orders` : "—";
    },
  },
  {
    id: "triplewhale",
    name: "Triple Whale",
    api: "REST v2",
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    providerKeys: ["triplewhale"],
    unit: (data) => {
      const tw = data?.tripleWhale;
      const markets = Array.isArray(tw?.markets) ? tw.markets.length : 0;
      const metrics = markets > 0 ? markets * 5 : 0;
      return metrics > 0 ? `${metrics} metrics` : "—";
    },
  },
  {
    id: "loop",
    name: "Loop",
    api: "REST",
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    providerKeys: ["loop", "juo"],
    unit: (data) => {
      const loop = Number(data?.loop?.activeSubscribers ?? data?.loop?.subscribers ?? 0);
      const juo = Number(data?.juo?.activeSubscribers ?? data?.juo?.subscribers ?? 0);
      const total = loop + juo;
      return total > 0 ? `${total.toLocaleString("en-GB")} subscribers` : "—";
    },
  },
  {
    id: "fulfillment",
    name: "Fulfillment partner",
    api: "REST",
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    providerKeys: [],
    unit: () => "—",
    badge: "Fulfillment partner",
  },
  {
    id: "jortt",
    name: "Jortt",
    api: "REST",
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
    providerKeys: ["jortt", "xero"],
    unit: (data) => {
      const inv = Number(data?.jortt?.invoiceCount ?? 0);
      const exp = Number(data?.jortt?.expenseCount ?? 0);
      const tx = Number(data?.jortt?.bankTransactionsCount ?? 0);
      const total = inv + exp + tx;
      return total > 0 ? `${total.toLocaleString("en-GB")} transactions` : "—";
    },
    badge: "Bridge connector · Xero replacing within ~1 month",
  },
];

function aggregateStatus(rows: SourceRow[]): SourceRow["status"] {
  if (rows.length === 0) return "disconnected";
  if (rows.some((r) => r.status === "error")) return "error";
  if (rows.some((r) => r.status === "disconnected")) return "disconnected";
  if (rows.some((r) => r.status === "degraded")) return "degraded";
  return "healthy";
}

function freshestAge(rows: SourceRow[]): number | null {
  const ages = rows.map((r) => r.ageMinutes).filter((a): a is number => a != null);
  return ages.length === 0 ? null : Math.min(...ages);
}

function SyncStatusPage() {
  const { user } = useDashboardSession();
  const [status, setStatus] = useState<{ sources: SourceRow[]; checkedAt: number } | null>(null);
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const [s, d] = await Promise.all([getSyncStatus(), getDashboardData()]);
      setStatus(s as any);
      setData(d);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <DashboardShell user={user} title="Sync status">
      <div className="px-6 py-6 space-y-4 max-w-[1240px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[12px] text-neutral-500">Connections</div>
            <h1 className="text-[22px] font-semibold tracking-tight mt-0.5">Sync status</h1>
            <p className="text-[13px] text-neutral-500 mt-1">Health of each data source and last successful pull.</p>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[13px] font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Sync all now
          </button>
        </div>

        {/* Connector cards */}
        <div className="space-y-3">
          {CONNECTORS.map((c) => {
            const matching = (status?.sources ?? []).filter((s) => c.providerKeys.includes(s.provider));
            const st = aggregateStatus(matching);
            const age = freshestAge(matching);
            const items = data ? c.unit(data, matching) : "—";
            const apiLabel = c.api;
            const isPending = !status;

            return (
              <div key={c.id} className="rounded-xl border border-neutral-200 bg-white">
                <div className="flex items-start justify-between gap-3 p-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`grid h-10 w-10 place-items-center rounded-lg ${c.iconBg}`}>
                      <Plug className={`h-4 w-4 ${c.iconColor}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-neutral-900">{c.name}</span>
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
                          <span className={`h-1.5 w-1.5 rounded-full ${isPending ? "bg-neutral-300 animate-pulse" : STATUS_DOT[st]}`} />
                          <span className={isPending ? "text-neutral-400" : STATUS_TXT[st]}>
                            {isPending ? "Checking…" : STATUS_LABEL[st]}
                          </span>
                        </span>
                      </div>
                      <div className="text-[12px] text-neutral-500 mt-0.5">
                        {apiLabel} · Last sync {fmtAge(age)} · {items}
                      </div>
                      {c.badge && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 ring-1 ring-amber-200 px-2 py-1 text-[11px] text-amber-700">
                          <AlertCircle className="h-3 w-3" />
                          {c.badge}
                        </div>
                      )}
                      {!c.badge && matching.some((m) => m.error) && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-rose-50 ring-1 ring-rose-200 px-2 py-1 text-[11px] text-rose-700">
                          <AlertCircle className="h-3 w-3" />
                          {matching.find((m) => m.error)?.error}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="inline-flex items-center rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium hover:bg-neutral-50">
                      Logs
                    </button>
                    <button
                      onClick={load}
                      disabled={refreshing}
                      className="inline-flex items-center rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Resync
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Data flow */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <div className="text-[14px] font-semibold">Data flow</div>
          <div className="text-[12px] text-neutral-500 mt-0.5">How data moves from source to dashboard.</div>

          <div className="mt-6 flex items-center justify-between gap-2">
            {[
              { name: "Shopify",      sub: "Orders, customers",        bg: "bg-emerald-50", fg: "text-emerald-600",  icon: <Plug className="h-5 w-5" /> },
              { name: "Triple Whale", sub: data ? CONNECTORS[1].unit(data, []) : "—", bg: "bg-violet-50",  fg: "text-violet-600",  icon: <Plug className="h-5 w-5" /> },
              { name: "Jortt",        sub: "Accounting totals",        bg: "bg-teal-50",    fg: "text-teal-600",    icon: <Plug className="h-5 w-5" />, footnote: "→ Xero soon" },
              { name: "Dashboard",    sub: "Reconciled view",          bg: "bg-neutral-900", fg: "text-white",      icon: <LayoutGrid className="h-5 w-5" />, dark: true },
            ].map((node, i, arr) => (
              <div key={node.name} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center text-center">
                  <div className={`grid h-14 w-14 place-items-center rounded-xl ${node.bg} ${node.dark ? "" : "ring-1 ring-neutral-100"}`}>
                    <span className={node.fg}>{node.icon}</span>
                  </div>
                  <div className="mt-2 text-[13px] font-semibold text-neutral-900">{node.name}</div>
                  <div className="text-[11px] text-neutral-500">{node.sub}</div>
                  {node.footnote && (
                    <div className="text-[11px] text-neutral-400 mt-0.5">{node.footnote}</div>
                  )}
                </div>
                {i < arr.length - 1 && (
                  <div className="flex-1 mx-3 flex items-center">
                    <div className="h-px flex-1 bg-neutral-200" />
                    <ChevronRight className="h-3.5 w-3.5 text-neutral-300 -ml-1" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="text-center text-[11px] text-neutral-400 pt-2">
          Synced · {status ? new Date(status.checkedAt).toLocaleString() : "—"} · Live status from connector cache
        </div>
      </div>
    </DashboardShell>
  );
}
