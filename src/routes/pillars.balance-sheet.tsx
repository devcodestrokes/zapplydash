import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Wallet, Receipt, TrendingUp } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getDashboardData } from "@/server/dashboard.functions";

export const Route = createFileRoute("/pillars/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance Sheet — Zapply" }] }),
  component: BalanceSheetPage,
});

function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-neutral-200/70 ${className}`} />;
}

function fmt(n: number | null | undefined, ccy = "EUR") {
  if (n == null || !isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(Math.round(n)).toLocaleString("en-GB");
  return `${sign}${ccy === "EUR" ? "€" : ccy === "GBP" ? "£" : ccy === "USD" ? "$" : ccy + " "}${v}`;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-neutral-200 bg-white ${className}`}>{children}</div>;
}

function Row({ label, value, muted, neg }: { label: string; value: string; muted?: boolean; neg?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span className={muted ? "text-neutral-400" : "text-neutral-600"}>{label}</span>
      <span className={`tabular-nums font-medium ${neg ? "text-rose-600" : muted ? "text-neutral-400" : "text-neutral-900"}`}>{value}</span>
    </div>
  );
}

function BalanceSheetPage() {
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
      <DashboardShell user={user} title="Balance Sheet">
        <div className="p-6 space-y-4">
          <SkeletonBox className="h-8 w-64" />
          <SkeletonBox className="h-4 w-96" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonBox key={i} className="h-56" />)}
          </div>
          <SkeletonBox className="h-72 mt-3" />
        </div>
      </DashboardShell>
    );
  }

  const xero = data?.xero && typeof data.xero === "object" && !data.xero.__empty && !data.xero.__error ? data.xero : null;
  const jorttObj = data?.jortt && typeof data.jortt === "object" && !data.jortt.__empty && !data.jortt.__error ? data.jortt : null;
  const twData = (Array.isArray(data?.tripleWhale) ? data.tripleWhale : []).filter((m: any) => m?.live);
  const totalAdSpend = twData.reduce((s: number, t: any) => s + (t?.adSpend ?? 0), 0);
  const nlAdSpend = twData.find((t: any) => t.market === "NL")?.adSpend ?? null;

  // Derive figures
  const currentAssets = xero?.currentAssets ?? null;
  const fixedAssets = xero?.fixedAssets ?? 0;
  const cashAndBank = xero?.cashBalance ?? null;
  const accountsReceivable = xero?.accountsReceivable ?? 0;
  const totalAssets = xero?.totalAssets ?? (currentAssets != null ? currentAssets + (fixedAssets ?? 0) : null);

  const currentLiabilities = xero?.currentLiabilities ?? 0;
  const opexYTD = jorttObj?.opexByMonth?.reduce((s: number, r: any) => s + (r?.total ?? 0), 0) ?? null;
  const totalLiabilities = xero?.totalLiabilities ?? 0;

  const totalEquity = xero?.equity ?? null;
  const ytdRevenue = xero?.ytdRevenue ?? null;
  const ytdExpenses = xero?.ytdExpenses ?? null;
  const ytdNetProfit = xero?.ytdNetProfit ?? (ytdRevenue != null && ytdExpenses != null ? ytdRevenue - ytdExpenses : null);

  const bankAccounts: any[] = Array.isArray(xero?.bankAccounts) ? xero.bankAccounts : [];
  const totalCash = bankAccounts.reduce((s, b) => s + (b?.balance ?? 0), 0);

  const xeroLive = !!xero;

  return (
    <DashboardShell user={user} title="Balance Sheet">
      <div className="p-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[12px] font-medium text-neutral-400">Pillar 4</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Balance Sheet</h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              Financial position · assets, liabilities, equity · via Xero
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${xeroLive ? "border-emerald-200 text-emerald-700 bg-emerald-50/30" : "border-amber-200 text-amber-700 bg-amber-50/30"}`}>
            {xeroLive ? "Xero live" : "Xero not connected"}
          </span>
        </div>

        {/* 3-column summary */}
        <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="rounded-md bg-emerald-50 p-1.5"><Wallet size={14} className="text-emerald-700" /></div>
              <div className="text-[14px] font-semibold">Assets</div>
            </div>
            <Row label="Current assets" value={fmt(currentAssets)} neg={(currentAssets ?? 0) < 0} />
            <Row label="Fixed assets" value={fmt(fixedAssets)} />
            <Row label="Cash & bank" value={fmt(cashAndBank)} neg={(cashAndBank ?? 0) < 0} />
            <Row label="Accounts receivable" value={fmt(accountsReceivable)} muted={!accountsReceivable} />
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">Total assets</span>
                <span className={`tabular-nums text-[15px] font-semibold ${(totalAssets ?? 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>{fmt(totalAssets)}</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="rounded-md bg-rose-50 p-1.5"><Receipt size={14} className="text-rose-700" /></div>
              <div className="text-[14px] font-semibold">Liabilities</div>
            </div>
            <Row label="Current liabilities" value={fmt(currentLiabilities)} neg={(currentLiabilities ?? 0) < 0} />
            <Row label="Operating costs (YTD)" value={fmt(opexYTD)} />
            <Row label="Ad spend (TW · NL)" value={fmt(nlAdSpend ?? totalAdSpend)} />
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">Total liabilities</span>
                <span className={`tabular-nums text-[15px] font-semibold ${(totalLiabilities ?? 0) > 0 ? "text-rose-600" : "text-neutral-900"}`}>{fmt(totalLiabilities)}</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="rounded-md bg-violet-50 p-1.5"><TrendingUp size={14} className="text-violet-700" /></div>
              <div className="text-[14px] font-semibold">Equity & P&amp;L</div>
            </div>
            <Row label="Total equity" value={fmt(totalEquity)} neg={(totalEquity ?? 0) < 0} />
            <Row label="YTD revenue" value={fmt(ytdRevenue)} />
            <Row label="YTD expenses" value={fmt(ytdExpenses != null ? -ytdExpenses : null)} neg />
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">Net profit (YTD)</span>
                <span className={`tabular-nums text-[15px] font-semibold ${(ytdNetProfit ?? 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>{fmt(ytdNetProfit)}</span>
              </div>
            </div>
          </Card>
        </section>

        {/* Bank accounts */}
        <Card className="mt-3 p-5">
          <div className="text-[13px] font-semibold mb-4">Bank accounts · Xero</div>
          {bankAccounts.length === 0 ? (
            <div className="text-[13px] text-neutral-400">No bank accounts available.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {bankAccounts.map((b, i) => {
                  const overdrawn = (b?.balance ?? 0) < 0;
                  return (
                    <div key={`${b.name}-${i}`} className="rounded-lg border border-neutral-100 bg-neutral-50/40 p-4">
                      <div className="text-[12px] text-neutral-500 truncate">{b.name}</div>
                      <div className={`mt-1 text-[20px] font-semibold tabular-nums ${overdrawn ? "text-rose-600" : "text-neutral-900"}`}>{fmt(b.balance, b.currency || "EUR")}</div>
                      {overdrawn && <div className="mt-0.5 text-[11px] text-rose-500">overdrawn</div>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
                <span className="text-[13px] font-semibold">Total cash position</span>
                <span className={`tabular-nums text-[15px] font-semibold ${totalCash < 0 ? "text-rose-600" : "text-emerald-700"}`}>{fmt(totalCash)}</span>
              </div>
            </>
          )}
        </Card>

        {!xeroLive && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-[13px] text-amber-800">
            Xero is not connected. Visit <code className="rounded bg-white px-1">/api/auth/xero</code> to connect for full balance sheet detail.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
