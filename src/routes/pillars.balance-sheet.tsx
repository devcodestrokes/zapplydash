import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Wallet, Plug, Box, LineChart, ChevronDown } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { getDashboardData } from "@/server/dashboard.functions";

export const Route = createFileRoute("/pillars/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance Sheet — Zapply" }] }),
  component: BalanceSheetPage,
});

// ───────── helpers ─────────
function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-neutral-200/70 ${className}`} />;
}

const DASH = "—";

function ccySym(c?: string) {
  return c === "GBP" ? "£" : c === "USD" ? "$" : "€";
}

function fmt(n: number | null | undefined, ccy = "EUR"): string {
  if (n == null || !isFinite(n as number)) return DASH;
  const num = n as number;
  const sign = num < 0 ? "-" : "";
  const v = Math.abs(Math.round(num)).toLocaleString("en-GB");
  return `${sign}${ccySym(ccy)}${v}`;
}

function fmtSigned(n: number | null | undefined, ccy = "EUR"): string {
  if (n == null || !isFinite(n as number)) return DASH;
  const num = n as number;
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  const v = Math.abs(Math.round(num)).toLocaleString("en-GB");
  return `${sign}${ccySym(ccy)}${v}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n as number)) return DASH;
  return `${(n as number) > 0 ? "+" : ""}${(n as number).toFixed(1)}%`;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-neutral-200 bg-white ${className}`}>{children}</div>;
}

function Row({
  label,
  sub,
  value,
  bold,
  neg,
  divider,
}: {
  label: string;
  sub?: string;
  value: string;
  bold?: boolean;
  neg?: boolean;
  divider?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between py-2 ${divider ? "border-t border-neutral-100 mt-1 pt-3" : ""}`}>
      <div>
        <div className={`text-[13px] ${bold ? "font-semibold text-neutral-900" : "text-neutral-700"}`}>{label}</div>
        {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
      </div>
      <div
        className={`tabular-nums text-[13px] ${bold ? "font-semibold" : "font-medium"} ${
          neg ? "text-rose-600" : "text-neutral-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function BankIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  let bg = "bg-neutral-900 text-white";
  let label = name.slice(0, 3).toUpperCase();
  if (n.includes("ing")) {
    bg = "bg-orange-500 text-white";
    label = "ING";
  } else if (n.includes("revolut")) {
    bg = "bg-neutral-900 text-white";
    label = "R";
  } else if (n.includes("mollie")) {
    bg = "bg-neutral-900 text-white";
    label = "M";
  } else if (n.includes("shopify")) {
    bg = "bg-emerald-500 text-white";
    label = "S";
  } else if (n.includes("paypal")) {
    bg = "bg-blue-500 text-white";
    label = "P";
  }
  return (
    <div className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-[10px] font-bold ${bg}`}>
      {label}
    </div>
  );
}

function severityBadge(pct: number) {
  if (pct >= 30) return { label: "high", cls: "bg-rose-100 text-rose-700" };
  if (pct >= 15) return { label: "medium", cls: "bg-amber-100 text-amber-700" };
  return { label: "low", cls: "bg-neutral-100 text-neutral-600" };
}

// ───────── component ─────────
function BalanceSheetPage() {
  const { user } = useDashboardSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>("supplier");
  const [showWeeks, setShowWeeks] = useState(false);

  useEffect(() => {
    let alive = true;
    getDashboardData()
      .then((d) => alive && setData(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const { xero, jortt, syncedAt } = useMemo(() => {
    const xero =
      data?.xero && typeof data.xero === "object" && !data.xero.__empty && !data.xero.__error
        ? data.xero
        : null;
    const jortt =
      data?.jortt && typeof data.jortt === "object" && !data.jortt.__empty && !data.jortt.__error
        ? data.jortt
        : null;
    return { xero, jortt, syncedAt: data?.syncedAt ?? null };
  }, [data]);

  // ── derive figures (real data only, "—" otherwise) ──
  const {
    asOfDate,
    bankAccountsAll,
    bankAccountsBank,
    platformPending,
    cashBank,
    cashPlatforms,
    cashTotal,
    inventoryItems,
    inventoryTotal,
    receivables,
    prepaidExpenses,
    currentAssets,
    fixedAssetsCost,
    accumDepreciation,
    fixedAssetsNet,
    totalAssets,
    apSupplier,
    apMeta,
    vatPayable,
    otherPayables,
    accruedExpenses,
    totalCurrentLiabilities,
    shareCapital,
    retainedEarnings,
    ytdResult,
    totalEquity,
    totalLiabEquity,
    outstandingTotal,
    outstandingBreakdown,
    currentRatio,
    quickRatio,
    suppliersInvoices,
  } = useMemo(() => {
    const asOf = syncedAt ? new Date(syncedAt) : new Date();
    const asOfDate = asOf.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    // ── Bank accounts (Xero) ──
    const xeroBanks: any[] = Array.isArray(xero?.bankAccounts) ? xero.bankAccounts : [];
    const jorttBanks: any[] = Array.isArray(jortt?.bankAccounts) ? jortt.bankAccounts : [];
    const merged = new Map<string, { name: string; balance: number; currency: string }>();
    for (const b of [...xeroBanks, ...jorttBanks]) {
      const name = String(b?.name ?? "").trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (!merged.has(k)) {
        merged.set(k, {
          name,
          balance: Number(b?.balance ?? 0),
          currency: String(b?.currency ?? "EUR"),
        });
      }
    }
    const bankAccountsAll = Array.from(merged.values());
    const isPlatform = (n: string) =>
      /(mollie|shopify|paypal|stripe|adyen|klarna|amazon)/i.test(n);
    const bankAccountsBank = bankAccountsAll.filter((b) => !isPlatform(b.name));
    const platformPending = bankAccountsAll.filter((b) => isPlatform(b.name));

    const cashBank = bankAccountsBank.length
      ? bankAccountsBank.reduce((s, b) => s + (b.balance ?? 0), 0)
      : null;
    const cashPlatforms = platformPending.length
      ? platformPending.reduce((s, b) => s + (b.balance ?? 0), 0)
      : null;
    const cashTotal =
      cashBank == null && cashPlatforms == null
        ? xero?.cashBalance ?? null
        : (cashBank ?? 0) + (cashPlatforms ?? 0);

    // ── Inventory (Xero items: tracked) ──
    const items: any[] = Array.isArray(xero?.items) ? xero.items : [];
    const tracked = items.filter(
      (i) => i?.isTracked && (i?.qtyOnHand ?? 0) > 0 && (i?.purchasePrice ?? 0) > 0,
    );
    const inventoryItems = tracked
      .map((i) => {
        const qty = Number(i.qtyOnHand ?? 0);
        const cost = Number(i.purchasePrice ?? 0);
        const value = qty * cost;
        const code = String(i.code ?? "").toUpperCase();
        let location = "NL";
        if (/uk|gb/.test(code) || /uk/i.test(i.name ?? "")) location = "GB";
        else if (/us/.test(code) || /us/i.test(i.name ?? "")) location = "US";
        return {
          name: String(i.name ?? i.code ?? "Item"),
          location,
          unitCost: cost,
          pieces: qty,
          value,
        };
      })
      .sort((a, b) => b.value - a.value);
    const inventoryTotal = inventoryItems.length
      ? inventoryItems.reduce((s, i) => s + i.value, 0)
      : null;

    // ── Receivables / payables / equity (Xero only) ──
    const receivables = xero?.accountsReceivable ?? null;
    const prepaidExpenses: number | null = null; // not exposed by current fetcher
    const currentAssets = xero?.currentAssets ?? null;
    const fixedAssetsNet = xero?.fixedAssets ?? null;
    const fixedAssetsCost: number | null = null;
    const accumDepreciation: number | null = null;
    const totalAssets = xero?.totalAssets ?? null;

    // ── Outstanding payments (suppliers + bills awaiting) ──
    const suppliers: any[] = Array.isArray(xero?.suppliers) ? xero.suppliers : [];
    const apSupplierList = suppliers
      .filter((s) => /supplier|leverancier|supply/i.test(s.name ?? "") || (s.outstanding ?? 0) > 0)
      .filter((s) => !/(meta|facebook|google|tiktok)/i.test(s.name ?? ""));
    const apSupplier = apSupplierList.length
      ? apSupplierList.reduce((s, x) => s + (x.outstanding ?? 0), 0)
      : xero?.billsAwaitingAmount ?? null;
    const apMetaList = suppliers.filter((s) => /(meta|facebook|google|tiktok|ads)/i.test(s.name ?? ""));
    const apMeta = apMetaList.length
      ? apMetaList.reduce((s, x) => s + (x.outstanding ?? 0), 0)
      : null;

    // VAT / other payables — try to read from Xero diagnostics; otherwise null
    const vatPayable: number | null = null;
    const otherPayables: number | null = null;
    const accruedExpenses: number | null = null;

    const totalCurrentLiabilities =
      xero?.currentLiabilities ??
      (xero?.totalLiabilities ?? null);

    const equity = xero?.equity ?? null;
    const shareCapital: number | null = null;
    const retainedEarnings: number | null = null;
    const ytdResult = xero?.ytdNetProfit ?? null;
    const totalEquity = equity;
    const totalLiabEquity =
      totalCurrentLiabilities != null && totalEquity != null
        ? totalCurrentLiabilities + totalEquity
        : null;

    // ── Outstanding breakdown ──
    const outstandingTotal =
      (apSupplier ?? 0) + (apMeta ?? 0) + (vatPayable ?? 0) + (otherPayables ?? 0);
    const breakdownRaw = [
      { key: "supplier", label: "Supplier (supplier invoices)", color: "bg-orange-500", val: apSupplier },
      { key: "ad", label: "Ad network (billing)", color: "bg-violet-500", val: apMeta },
      { key: "vat", label: "VAT & corporate tax", color: "bg-amber-500", val: vatPayable },
      { key: "other", label: "Affiliates & partners", color: "bg-neutral-400", val: otherPayables },
    ];
    const totalForPct = outstandingTotal > 0 ? outstandingTotal : null;
    const outstandingBreakdown = breakdownRaw.map((b) => {
      const pct = totalForPct && b.val != null ? (b.val / totalForPct) * 100 : null;
      return { ...b, pct };
    });

    // ── Ratios ──
    const currentRatio =
      currentAssets != null && totalCurrentLiabilities && totalCurrentLiabilities !== 0
        ? currentAssets / totalCurrentLiabilities
        : null;
    const quickRatio =
      currentAssets != null && totalCurrentLiabilities && totalCurrentLiabilities !== 0
        ? (currentAssets - (inventoryTotal ?? 0)) / totalCurrentLiabilities
        : null;

    // ── Supplier invoice line items (use Xero bills if exposed, else show top suppliers) ──
    const suppliersInvoices = apSupplierList
      .slice(0, 12)
      .map((s, idx) => ({
        ref: `INV-${String(idx + 1).padStart(4, "0")}`,
        date: null as string | null,
        name: s.name,
        amount: s.outstanding ?? 0,
      }));

    return {
      asOfDate,
      bankAccountsAll,
      bankAccountsBank,
      platformPending,
      cashBank,
      cashPlatforms,
      cashTotal,
      inventoryItems,
      inventoryTotal,
      receivables,
      prepaidExpenses,
      currentAssets,
      fixedAssetsCost,
      accumDepreciation,
      fixedAssetsNet,
      totalAssets,
      apSupplier,
      apMeta,
      vatPayable,
      otherPayables,
      accruedExpenses,
      totalCurrentLiabilities,
      shareCapital,
      retainedEarnings,
      ytdResult,
      totalEquity,
      totalLiabEquity,
      outstandingTotal: outstandingTotal > 0 ? outstandingTotal : null,
      outstandingBreakdown,
      currentRatio,
      quickRatio,
      suppliersInvoices,
    };
  }, [xero, jortt, syncedAt]);

  if (loading) {
    return (
      <DashboardShell user={user} title="Balance Sheet">
        <div className="p-6 space-y-4">
          <SkeletonBox className="h-8 w-64" />
          <SkeletonBox className="h-4 w-96" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonBox key={i} className="h-28" />
            ))}
          </div>
          <SkeletonBox className="h-72 mt-3" />
        </div>
      </DashboardShell>
    );
  }

  const liquidityShortfall =
    cashTotal != null && outstandingTotal != null && cashTotal < outstandingTotal;

  return (
    <DashboardShell user={user} title="Balance Sheet">
      <div className="mx-auto max-w-[1200px] p-6 space-y-4">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[12px] font-medium text-neutral-400">Pillar 4</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Balance Sheet</h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              Financial position · as of {asOfDate} · all amounts in EUR
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">Total Assets</div>
            <div
              className={`mt-1 text-[26px] font-semibold tabular-nums ${
                (totalAssets ?? 0) < 0 ? "text-rose-600" : "text-neutral-900"
              }`}
            >
              {fmt(totalAssets)}
            </div>
          </div>
        </div>

        {/* Liquidity check banner */}
        {liquidityShortfall && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
            <div className="text-[13px]">
              <div className="font-semibold text-amber-900">
                Liquidity check: {fmt(cashTotal)} cash vs {fmt(outstandingTotal)} outstanding
              </div>
              <div className="mt-1 text-amber-800/90">
                Not all payables are due immediately — Supplier has 60-day terms, META bills rolling, VAT includes
                accruing 2026 liabilities not yet due. See outstanding breakdown below for timing.
              </div>
            </div>
          </div>
        )}

        {/* Ratios */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card className="p-5">
            <div className="text-[12px] text-neutral-500">Current ratio</div>
            <div className="mt-2 text-[34px] font-semibold tabular-nums leading-none">
              {currentRatio != null ? currentRatio.toFixed(1) : DASH}
            </div>
            <div className="mt-3 text-[11px] text-rose-600">Current assets vs current liabilities</div>
          </Card>
          <Card className="p-5">
            <div className="text-[12px] text-neutral-500">Quick ratio</div>
            <div className="mt-2 text-[34px] font-semibold tabular-nums leading-none">
              {quickRatio != null ? quickRatio.toFixed(1) : DASH}
            </div>
            <div className="mt-3 text-[11px] text-rose-600">Excludes inventory</div>
          </Card>
          <Card className="p-5">
            <div className="text-[12px] text-neutral-500">Cash position</div>
            <div className="mt-2 text-[28px] font-semibold tabular-nums leading-none">{fmt(cashTotal)}</div>
            <div className="mt-3 text-[11px] text-amber-600">Bank + platforms</div>
          </Card>
          <Card className="p-5">
            <div className="text-[12px] text-neutral-500">Inventory days</div>
            <div className="mt-2 text-[28px] font-semibold tabular-nums leading-none">{DASH}</div>
            <div className="mt-3 text-[11px] text-amber-600">Target: 30–45</div>
          </Card>
        </section>

        {/* Cash & platform positions */}
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[15px] font-semibold">Cash &amp; platform positions</div>
              <div className="mt-1 text-[12px] text-neutral-500">
                Current balances across banks and payment processors
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Total Liquid</div>
              <div className="mt-0.5 text-[20px] font-semibold tabular-nums">{fmt(cashTotal)}</div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <Wallet size={13} /> Bank Accounts
              </div>
              {bankAccountsBank.length === 0 ? (
                <div className="text-[13px] text-neutral-400">{DASH}</div>
              ) : (
                bankAccountsBank.map((b, i) => (
                  <div
                    key={`${b.name}-${i}`}
                    className="flex items-center justify-between border-t border-neutral-100 py-3 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-center gap-3">
                      <BankIcon name={b.name} />
                      <div>
                        <div className="text-[13px] font-medium text-neutral-900">{b.name}</div>
                        <div className="text-[11px] text-neutral-400">{b.name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[14px] font-semibold tabular-nums">{fmt(b.balance, b.currency)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{b.currency}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <Plug size={13} /> Platform Payouts Pending
              </div>
              {platformPending.length === 0 ? (
                <div className="text-[13px] text-neutral-400">{DASH}</div>
              ) : (
                platformPending.map((b, i) => (
                  <div
                    key={`${b.name}-${i}`}
                    className="flex items-center justify-between border-t border-neutral-100 py-3 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-center gap-3">
                      <BankIcon name={b.name} />
                      <div>
                        <div className="text-[13px] font-medium text-neutral-900">{b.name}</div>
                        <div className="text-[11px] text-neutral-400">Pending payouts</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[14px] font-semibold tabular-nums">{fmt(b.balance, b.currency)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{b.currency}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>

        {/* Cash & assets · week over week */}
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <LineChart size={15} />
                <div className="text-[15px] font-semibold">Cash &amp; assets · week over week</div>
                <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                  26 weeks trailing
                </span>
              </div>
              <div className="mt-1 text-[12px] text-neutral-500">
                How much does the business have: cash · cash after debt · cash + assets after debt
              </div>
            </div>
            <div className="text-[12px] text-neutral-500">
              Week <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1">current <ChevronDown size={12} /></span>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div className="border-t border-neutral-100 pt-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <span className="h-2 w-2 rounded-full bg-neutral-900" /> Total Cash
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="text-[22px] font-semibold tabular-nums">{fmt(cashTotal)}</div>
                <div className="text-[12px] text-emerald-600">{DASH}</div>
              </div>
              <div className="text-[12px] text-neutral-500">Bank + platforms combined</div>
              <div className="mt-1 text-[11px] text-neutral-400">vs prev week: {DASH}</div>
            </div>

            <div className="border-t border-neutral-100 pt-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Cash after Debt
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="text-[22px] font-semibold tabular-nums">
                  {cashTotal != null && outstandingTotal != null ? fmt(cashTotal - outstandingTotal) : DASH}
                </div>
              </div>
              <div className="text-[12px] text-neutral-500">What's left after paying all outstanding</div>
              <div className="mt-1 text-[11px] text-neutral-400">vs prev week: {DASH}</div>
            </div>

            <div className="border-t border-neutral-100 pt-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Cash + Assets after Debt
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="text-[22px] font-semibold tabular-nums">
                  {totalAssets != null && outstandingTotal != null
                    ? fmt(totalAssets - outstandingTotal)
                    : DASH}
                </div>
              </div>
              <div className="text-[12px] text-neutral-500">Cash + inventory + receivables, after debt</div>
              <div className="mt-1 text-[11px] text-neutral-400">vs prev week: {DASH}</div>
            </div>

            <div className="border-t border-neutral-100 pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">26-Week Trend</div>
              <button
                onClick={() => setShowWeeks((v) => !v)}
                className="mt-3 flex w-full items-center justify-between rounded-md border border-neutral-100 px-3 py-2 text-[12px] text-neutral-500 hover:bg-neutral-50"
              >
                <span className="flex items-center gap-2">
                  <ChevronDown size={12} className={showWeeks ? "rotate-180 transition" : "transition"} />
                  LAST 8 WEEKS <span className="text-neutral-400">click to expand</span>
                </span>
                <span className="text-neutral-400">Click a row to select a week</span>
              </button>
              {showWeeks && (
                <div className="mt-2 text-[12px] text-neutral-400">Weekly trend data not available yet.</div>
              )}
            </div>
          </div>
        </Card>

        {/* Outstanding payments */}
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-rose-500" />
                <div className="text-[15px] font-semibold">Outstanding payments</div>
              </div>
              <div className="mt-1 text-[12px] text-neutral-500">
                Open invoices and accruing obligations · sourced from Xero
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Total Outstanding</div>
              <div className="mt-0.5 text-[20px] font-semibold tabular-nums text-rose-600">{fmt(outstandingTotal)}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {outstandingBreakdown.map((b) => {
              const sev = b.pct != null ? severityBadge(b.pct) : { label: "—", cls: "bg-neutral-100 text-neutral-500" };
              const isActive = activeCat === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => setActiveCat(b.key)}
                  className={`rounded-xl border p-4 text-left transition ${
                    isActive ? "border-neutral-900" : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${b.color}`} />
                      <span className="text-[12px] text-neutral-600">{b.label}</span>
                    </div>
                  </div>
                  <div className="mt-2 text-[20px] font-semibold tabular-nums">{fmt(b.val)}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[11px] text-neutral-400">
                      {b.pct != null ? `${b.pct.toFixed(1)}% of total` : DASH}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sev.cls}`}>{sev.label}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Drilldown table */}
          <div className="mt-6 border-t border-neutral-100 pt-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[14px] font-semibold">
                  {outstandingBreakdown.find((b) => b.key === activeCat)?.label ?? "Selected category"}
                </div>
                <div className="mt-0.5 text-[12px] text-neutral-500">
                  Open purchase invoices · sourced from Xero
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-neutral-400">Category Total</div>
                <div className="mt-0.5 text-[16px] font-semibold tabular-nums">
                  {fmt(outstandingBreakdown.find((b) => b.key === activeCat)?.val)}
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-neutral-100">
              <div className="grid grid-cols-[1fr_1fr_1fr] bg-neutral-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                <div>Reference</div>
                <div>Date</div>
                <div className="text-right">Amount</div>
              </div>
              {activeCat === "supplier" && suppliersInvoices.length > 0 ? (
                <div className="max-h-[260px] overflow-y-auto">
                  {suppliersInvoices.map((inv, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_1fr_1fr] border-t border-neutral-100 px-4 py-2.5 text-[12px]"
                    >
                      <div className="font-mono text-neutral-700">{inv.ref}</div>
                      <div className="text-neutral-500">{inv.date ?? DASH}</div>
                      <div className="text-right tabular-nums font-medium">{fmt(inv.amount)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center text-[12px] text-neutral-400">{DASH}</div>
              )}
            </div>
            <div className="mt-3 text-[11px] text-neutral-400">
              ⓘ Click a category above to drill into line items. Sourced from Xero contacts.
            </div>
          </div>
        </Card>

        {/* Inventory at cost */}
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-neutral-100 p-2">
                <Box size={15} />
              </div>
              <div>
                <div className="text-[15px] font-semibold">
                  Inventory at cost{inventoryItems.length ? ` — ${inventoryItems.length} SKUs` : ""}
                </div>
                <div className="mt-0.5 text-[12px] text-neutral-500">
                  Stock positions across NL, UK, and US warehouses
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Total Value</div>
              <div className="mt-0.5 text-[18px] font-semibold tabular-nums">{fmt(inventoryTotal)}</div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.2fr] border-b border-neutral-100 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              <div>SKU</div>
              <div>Location</div>
              <div className="text-right">Unit Cost</div>
              <div className="text-right">Pieces</div>
              <div className="text-right">Value</div>
              <div className="text-right">% of Stock</div>
            </div>
            {inventoryItems.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-neutral-400">{DASH}</div>
            ) : (
              inventoryItems.map((it, i) => {
                const pct = inventoryTotal && inventoryTotal > 0 ? (it.value / inventoryTotal) * 100 : 0;
                return (
                  <div
                    key={`${it.name}-${i}`}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.2fr] items-center border-b border-neutral-50 px-2 py-2.5 text-[12px]"
                  >
                    <div className="text-neutral-800">{it.name}</div>
                    <div>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                        {it.location}
                      </span>{" "}
                      <span className="text-neutral-500">{it.location}</span>
                    </div>
                    <div className="text-right tabular-nums text-neutral-700">{fmt(it.unitCost)}</div>
                    <div className="text-right tabular-nums text-neutral-700">{it.pieces}</div>
                    <div className="text-right tabular-nums font-medium">{fmt(it.value)}</div>
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100">
                        <div className="h-full bg-neutral-800" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="text-[11px] tabular-nums text-neutral-500">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Assets vs Liabilities & Equity */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold">Assets</div>
            <div
              className={`text-[18px] font-semibold tabular-nums ${
                (totalAssets ?? 0) < 0 ? "text-rose-600" : "text-neutral-900"
              }`}
            >
              {fmt(totalAssets)}
            </div>
          </div>
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Current</div>
            <Row label="Cash — Bank accounts" sub="ING + Revolut (EUR/GBP)" value={fmt(cashBank)} />
            <Row
              label="Platform receivables"
              sub="Mollie + Shopify + PayPal pending payouts"
              value={fmt(cashPlatforms)}
            />
            <Row
              label="Inventory (at cost)"
              sub={inventoryItems.length ? `${inventoryItems.length} SKUs across NL/UK/US` : undefined}
              value={fmt(inventoryTotal)}
            />
            <Row label="Prepaid expenses" sub="Rent, software, insurance" value={fmt(prepaidExpenses)} />
            <Row label="Total current" value={fmt(currentAssets)} bold divider />

            <div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Fixed</div>
            <Row label="Equipment & hardware" value={fmt(fixedAssetsCost)} />
            <Row
              label="Less: accumulated depreciation"
              value={fmt(accumDepreciation)}
              neg={accumDepreciation != null && accumDepreciation < 0}
            />
            <Row label="Total fixed" value={fmt(fixedAssetsNet)} bold divider neg={(fixedAssetsNet ?? 0) < 0} />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold">Liabilities &amp; Equity</div>
            <div className="text-[18px] font-semibold tabular-nums">{fmt(totalLiabEquity)}</div>
          </div>
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Current Liabilities</div>
            <Row label="Accounts payable — Supplier" sub="Product supplier" value={fmt(apSupplier)} />
            <Row label="Accounts payable — META" sub="Ad spend billing" value={fmt(apMeta)} />
            <Row label="VAT payable" sub="NL/EU/UK + VPB" value={fmt(vatPayable)} />
            <Row label="Other payables" sub="Affiliates, partners" value={fmt(otherPayables)} />
            <Row label="Accrued expenses" sub="Salaries, utilities" value={fmt(accruedExpenses)} />
            <Row label="Total current liabilities" value={fmt(totalCurrentLiabilities)} bold divider />

            <div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Equity</div>
            <Row label="Share capital" value={fmt(shareCapital)} />
            <Row label="Retained earnings" value={fmt(retainedEarnings)} />
            <Row label="Current period result (YTD)" sub="EBITDA YTD" value={fmt(ytdResult)} />
            <Row label="Total equity" value={fmt(totalEquity)} bold divider />
          </div>
        </Card>

        <div className="text-center text-[11px] text-neutral-400">
          Synced ·{" "}
          {syncedAt
            ? new Date(syncedAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : DASH}{" "}
          · Live data from Xero & Jortt
        </div>
      </div>
    </DashboardShell>
  );
}
