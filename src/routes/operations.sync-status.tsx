import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, MinusCircle, RefreshCw, Database, Clock } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getSyncStatus } from "@/server/dashboard.functions";

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
  if (min < 60) return `${Math.round(min)}m ago`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtTime(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

const STATUS_META = {
  healthy:      { label: "Healthy",       cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", Icon: CheckCircle2 },
  degraded:     { label: "Stale",         cls: "bg-amber-50 text-amber-700 ring-amber-200",       dot: "bg-amber-500",   Icon: AlertTriangle },
  error:        { label: "Error",         cls: "bg-rose-50 text-rose-700 ring-rose-200",          dot: "bg-rose-500",    Icon: AlertCircle },
  disconnected: { label: "Disconnected",  cls: "bg-neutral-100 text-neutral-600 ring-neutral-200", dot: "bg-neutral-400", Icon: MinusCircle },
} as const;

function SyncStatusPage() {
  const { user } = useDashboardSession();
  const [data, setData] = useState<{ sources: SourceRow[]; checkedAt: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const d = await getSyncStatus();
      setData(d as any);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const sources = data?.sources ?? [];
  const counts = {
    healthy: sources.filter((s) => s.status === "healthy").length,
    degraded: sources.filter((s) => s.status === "degraded").length,
    error: sources.filter((s) => s.status === "error").length,
    disconnected: sources.filter((s) => s.status === "disconnected").length,
  };
  const failing = sources.filter((s) => s.status === "error" || s.status === "disconnected");
  const providingData = sources.filter((s) => s.status === "healthy" || s.status === "degraded");

  return (
    <DashboardShell user={user} title="Sync status">
      <div className="px-6 py-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Live API status</h1>
            <p className="text-[13px] text-neutral-500 mt-1">
              Real-time health check of every data source. Last checked {data ? new Date(data.checkedAt).toLocaleTimeString() : "—"}.
            </p>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["healthy","degraded","error","disconnected"] as const).map((k) => {
            const m = STATUS_META[k];
            const Icon = m.Icon;
            return (
              <div key={k} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${k === "healthy" ? "text-emerald-600" : k === "degraded" ? "text-amber-600" : k === "error" ? "text-rose-600" : "text-neutral-500"}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{m.label}</span>
                </div>
                <div className="mt-2 text-[26px] font-semibold tabular-nums">{counts[k]}</div>
              </div>
            );
          })}
        </div>

        {/* Failing alert */}
        {failing.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-600 mt-0.5" />
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-rose-900">
                  {failing.length} source{failing.length > 1 ? "s" : ""} not returning expected data
                </div>
                <div className="text-[12px] text-rose-700 mt-1">
                  These APIs failed health checks and are missing from the dashboard.
                </div>
                <ul className="mt-3 space-y-1.5">
                  {failing.map((s) => (
                    <li key={`${s.provider}-${s.key}`} className="text-[12px] text-rose-800">
                      <span className="font-medium">{s.label}</span>
                      <span className="text-rose-600"> — {s.error ?? (s.connected ? "No data" : "Not connected")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Providing-data summary */}
        {providingData.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-emerald-900">
                  {providingData.length} source{providingData.length > 1 ? "s" : ""} providing data
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {providingData.map((s) => (
                    <li key={`${s.provider}-${s.key}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-1 text-[11px] text-emerald-800 ring-1 ring-emerald-200">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[s.status].dot}`} />
                      {s.label}
                      {s.rowCount != null && <span className="text-emerald-600">· {s.rowCount} rows</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Detail table */}
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-center gap-2">
            <Database className="h-4 w-4 text-neutral-500" />
            <div className="text-[14px] font-semibold">All data sources</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  <th className="py-2.5 px-4">Source</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Expected data</th>
                  <th className="py-2.5 px-4 text-right">Rows</th>
                  <th className="py-2.5 px-4">Last sync</th>
                  <th className="py-2.5 px-4">Age</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="py-8 text-center text-neutral-400">Loading…</td></tr>
                )}
                {!loading && sources.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-neutral-400">No sources configured.</td></tr>
                )}
                {sources.map((s) => {
                  const m = STATUS_META[s.status];
                  const Icon = m.Icon;
                  return (
                    <tr key={`${s.provider}-${s.key}`} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60">
                      <td className="py-3 px-4">
                        <div className="font-medium text-neutral-900">{s.label}</div>
                        {s.error && (
                          <div className="text-[11px] text-rose-600 mt-0.5 truncate max-w-[420px]">{s.error}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m.cls}`}>
                          <Icon className="h-3 w-3" />
                          {m.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-neutral-600">{s.expected}</td>
                      <td className="py-3 px-4 text-right tabular-nums text-neutral-700">{s.rowCount ?? "—"}</td>
                      <td className="py-3 px-4 text-neutral-600 tabular-nums">{fmtTime(s.lastSyncedAt)}</td>
                      <td className="py-3 px-4 text-neutral-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {fmtAge(s.ageMinutes)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
