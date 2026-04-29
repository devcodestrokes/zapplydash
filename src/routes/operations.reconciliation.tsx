import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { GitMerge, AlertCircle, CheckCircle2, ArrowRight, RefreshCw } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getDashboardData, getSyncStatus } from "@/server/dashboard.functions";

export const Route = createFileRoute("/operations/reconciliation")({
  head: () => ({ meta: [{ title: "Reconciliation — Zapply" }] }),
  component: ReconciliationPage,
});

function fmtMoney(n: number | null | undefined) {
  if (n == null || !isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}€${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

type Issue = {
  id: string;
  severity: "high" | "medium" | "low";
  source: string;
  title: string;
  detail: string;
  delta?: number | null;
  action?: string;
};

function ReconciliationPage() {
  const { user } = useDashboardSession();
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const [d, s] = await Promise.all([getDashboardData(), getSyncStatus()]);
      setData(d);
      setStatus(s);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const issues = useMemo<Issue[]>(() => {
    if (!data) return [];
    const out: Issue[] = [];

    // 1. Failing data sources surfaced from sync status
    for (const s of (status?.sources ?? []) as any[]) {
      if (s.status === "error" || s.status === "disconnected") {
        out.push({
          id: `src-${s.provider}-${s.key}`,
          severity: "high",
          source: s.label,
          title: s.status === "disconnected" ? "Source not connected" : "Source not returning data",
          detail: s.error ?? "Health check failed — values shown on dashboards may be incomplete.",
          action: "Open Sync status",
        });
      } else if (s.status === "degraded") {
        out.push({
          id: `stale-${s.provider}-${s.key}`,
          severity: "low",
          source: s.label,
          title: "Stale data",
          detail: `Last sync ${s.ageMinutes != null ? Math.round(s.ageMinutes) + "m ago" : "unknown"} — refresh recommended.`,
          action: "Refresh",
        });
      }
    }

    // 2. Shopify revenue vs Xero income comparison (most recent month)
    const shopifyMonthly: any[] = Array.isArray(data?.shopifyMonthly) ? data.shopifyMonthly : [];
    const xeroMonthly: any[] = Array.isArray(data?.xero?.netProfitByMonth) ? data.xero.netProfitByMonth : [];
    if (shopifyMonthly.length && xeroMonthly.length) {
      const sLast = shopifyMonthly[shopifyMonthly.length - 1];
      const xLast = xeroMonthly[xeroMonthly.length - 1];
      const sRev = Number(sLast?.revenue ?? 0);
      const xInc = Number(xLast?.income ?? xLast?.revenue ?? 0);
      if (sRev > 0 && xInc > 0) {
        const delta = sRev - xInc;
        const pct = Math.abs(delta) / Math.max(sRev, xInc);
        if (pct > 0.1) {
          out.push({
            id: "shopify-xero-rev",
            severity: pct > 0.25 ? "high" : "medium",
            source: "Shopify ↔ Xero",
            title: `Revenue mismatch (${(pct * 100).toFixed(1)}%)`,
            detail: `Shopify reports ${fmtMoney(sRev)} vs Xero ${fmtMoney(xInc)} for the latest month.`,
            delta,
            action: "Investigate",
          });
        }
      }
    }

    // 3. Outstanding Jortt invoices not yet matched in Xero
    const outstanding = Array.isArray(data?.jortt?.outstanding)
      ? data.jortt.outstanding.reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0)
      : Number(data?.jortt?.totalOutstanding ?? 0);
    if (outstanding > 0) {
      out.push({
        id: "jortt-outstanding",
        severity: outstanding > 10_000 ? "medium" : "low",
        source: "Jortt → Xero",
        title: "Outstanding invoices",
        detail: `${fmtMoney(outstanding)} in unpaid invoices awaiting reconciliation.`,
        delta: outstanding,
        action: "Review invoices",
      });
    }

    // 4. Triple Whale ad spend vs Xero marketing expense
    const tw = data?.tripleWhale;
    const adSpend = Number(tw?.totalSpend ?? tw?.spend ?? 0);
    const xeroMarketing = Number(data?.xero?.marketingSpend ?? data?.xero?.marketing ?? 0);
    if (adSpend > 0 && xeroMarketing > 0) {
      const delta = adSpend - xeroMarketing;
      const pct = Math.abs(delta) / Math.max(adSpend, xeroMarketing);
      if (pct > 0.15) {
        out.push({
          id: "tw-xero-spend",
          severity: "medium",
          source: "Triple Whale ↔ Xero",
          title: `Ad spend mismatch (${(pct * 100).toFixed(1)}%)`,
          detail: `Triple Whale ${fmtMoney(adSpend)} vs Xero marketing ${fmtMoney(xeroMarketing)}.`,
          delta,
          action: "Investigate",
        });
      }
    }

    return out;
  }, [data, status]);

  const counts = {
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  };

  const sevMeta = {
    high:   { cls: "bg-rose-50 text-rose-700 ring-rose-200",     dot: "bg-rose-500",    label: "High" },
    medium: { cls: "bg-amber-50 text-amber-700 ring-amber-200",  dot: "bg-amber-500",   label: "Medium" },
    low:    { cls: "bg-sky-50 text-sky-700 ring-sky-200",        dot: "bg-sky-500",     label: "Low" },
  } as const;

  return (
    <DashboardShell user={user} title="Reconciliation">
      <div className="px-6 py-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Reconciliation queue</h1>
            <p className="text-[13px] text-neutral-500 mt-1">
              Discrepancies and missing data detected across Shopify, Triple Whale, Jortt and Xero.
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
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Open issues</div>
            <div className="mt-2 text-[26px] font-semibold tabular-nums">{issues.length}</div>
          </div>
          {(["high","medium","low"] as const).map((k) => (
            <div key={k} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${sevMeta[k].dot}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{sevMeta[k].label}</span>
              </div>
              <div className="mt-2 text-[26px] font-semibold tabular-nums">{counts[k]}</div>
            </div>
          ))}
        </div>

        {/* Issues list */}
        <div className="rounded-xl border border-neutral-200 bg-white">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-neutral-500" />
            <div className="text-[14px] font-semibold">Items to reconcile</div>
          </div>
          {loading ? (
            <div className="py-10 text-center text-neutral-400 text-[13px]">Loading…</div>
          ) : issues.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <div className="mt-2 text-[14px] font-medium text-neutral-800">All sources reconciled</div>
              <div className="text-[12px] text-neutral-500">No discrepancies detected across your data sources.</div>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {issues.map((i) => {
                const m = sevMeta[i.severity];
                return (
                  <li key={i.id} className="px-4 py-4 hover:bg-neutral-50/60">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 grid h-8 w-8 place-items-center rounded-md ring-1 ring-inset ${m.cls}`}>
                        <AlertCircle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-neutral-900">{i.title}</span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${m.cls}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                            {m.label}
                          </span>
                          <span className="text-[11px] text-neutral-500">· {i.source}</span>
                        </div>
                        <div className="text-[12px] text-neutral-600 mt-1">{i.detail}</div>
                        {i.delta != null && (
                          <div className="text-[11px] text-neutral-500 mt-1 tabular-nums">
                            Δ {fmtMoney(i.delta)}
                          </div>
                        )}
                      </div>
                      {i.action && (
                        <button className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50">
                          {i.action}
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
