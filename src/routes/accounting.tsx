import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { DashboardShell, RefreshButton } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { useInstantDashboardData } from "@/components/dashboard/useInstantDashboardData";
import { getAccountingDashboard } from "@/server/dashboard-pages.functions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";

export const Route = createFileRoute("/accounting")({
  head: () => ({
    meta: [{ title: "Accounting Dashboard — Zapply" }],
  }),
  component: AccountingPage,
});

type XData = Awaited<ReturnType<typeof getAccountingDashboard>>;

function fmtMoney(n: number | null | undefined, currency = "EUR") {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toFixed(0)} ${currency}`;
  }
}

function AccountingPage() {
  const { user, loading } = useDashboardSession();
  const fetchDashboard = useCallback(
    (force: boolean) => getAccountingDashboard({ data: { force } }),
    []
  );
  const { data, isLoading, load } = useInstantDashboardData<XData>("accounting", fetchDashboard, !!user);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const x: any = data?.data ?? null;
  const currency = x?.currency ?? "EUR";

  const monthEntries = (obj: Record<string, number> | undefined) =>
    obj ? Object.entries(obj) : [];

  return (
    <DashboardShell
      user={user}
      title="Accounting (Xero)"
      actions={
        <>
          <Button
            asChild
            variant="default"
            size="sm"
            className="gap-2"
          >
            <a href="/api/auth/xero">
              <LogIn className="w-4 h-4" />
              Connect Xero
            </a>
          </Button>
          <RefreshButton onRefresh={() => load(true)} isLoading={isLoading} />
        </>
      }
    >
      <div className="p-6 space-y-6">
        {data?.source === "cache" && (
          <Card className="border-yellow-500/40 bg-yellow-500/5">
            <CardContent className="pt-6 text-sm">
              Showing cached Xero data — live API didn't respond.
            </CardContent>
          </Card>
        )}

        {data?.source === "none" && !isLoading && (
          <Card className="border-destructive/40">
            <CardContent className="pt-6 text-sm">
              No Xero data — visit{" "}
              <a className="underline" href="/api/auth/xero">
                /api/auth/xero
              </a>{" "}
              to connect your organization.
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard label="YTD Revenue" value={fmtMoney(x?.ytdRevenue, currency)} />
          <KpiCard label="YTD Expenses" value={fmtMoney(x?.ytdExpenses, currency)} />
          <KpiCard label="YTD Net Profit" value={fmtMoney(x?.ytdNetProfit, currency)} />
          <KpiCard label="Cash" value={fmtMoney(x?.cashBalance, currency)} />
          <KpiCard label="A/R" value={fmtMoney(x?.accountsReceivable, currency)} />
          <KpiCard label="Overdue" value={fmtMoney(x?.overdueAmount, currency)} />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Balance Sheet</CardTitle>
              <CardDescription>As of today</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell>Total Assets</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(x?.totalAssets, currency)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Current Assets</TableCell>
                    <TableCell className="text-right">{fmtMoney(x?.currentAssets, currency)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Fixed Assets</TableCell>
                    <TableCell className="text-right">{fmtMoney(x?.fixedAssets, currency)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Total Liabilities</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(x?.totalLiabilities, currency)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Current Liabilities</TableCell>
                    <TableCell className="text-right">{fmtMoney(x?.currentLiabilities, currency)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Equity</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(x?.equity, currency)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bank Accounts</CardTitle>
              <CardDescription>Cash positions</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(x?.bankAccounts ?? []).map((b: any) => (
                    <TableRow key={b.name}>
                      <TableCell>{b.name}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(b.balance, b.currency)}</TableCell>
                    </TableRow>
                  ))}
                  {(!x || (x.bankAccounts ?? []).length === 0) && (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                        No bank accounts
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>P&L by Month</CardTitle>
            <CardDescription>Last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Gross Profit</TableHead>
                    <TableHead className="text-right">Net Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthEntries(x?.revenueByMonth).map(([m, rev]) => (
                    <TableRow key={m}>
                      <TableCell className="font-medium">{m}</TableCell>
                      <TableCell className="text-right">{fmtMoney(rev as number, currency)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(x?.expensesByMonth?.[m], currency)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(x?.grossProfitByMonth?.[m], currency)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {fmtMoney(x?.netProfitByMonth?.[m], currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {monthEntries(x?.revenueByMonth).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        No P&L data
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
