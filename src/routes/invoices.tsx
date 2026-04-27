import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { DashboardShell, RefreshButton } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { DateRangePicker, defaultRange, toIsoDate } from "@/components/dashboard/Filters";
import { getInvoiceDashboard } from "@/server/dashboard-pages.functions";
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

export const Route = createFileRoute("/invoices")({
  head: () => ({
    meta: [{ title: "Invoices Dashboard — Zapply" }],
  }),
  component: InvoicesPage,
});

type InvData = Awaited<ReturnType<typeof getInvoiceDashboard>>;

function fmtMoney(n: number | null | undefined, currency = "EUR") {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toFixed(0)} ${currency}`;
  }
}

function InvoicesPage() {
  const { user, loading } = useDashboardSession();
  const [range, setRange] = useState<DateRange>(defaultRange());
  const [data, setData] = useState<InvData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = () => {
    setIsLoading(true);
    getInvoiceDashboard({ data: { from: toIsoDate(range.from), to: toIsoDate(range.to) } })
      .then((d) => setData(d))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range.from?.getTime(), range.to?.getTime()]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const result: any = data?.data ?? null;
  const totals = result?.totals ?? {};
  const invoices: any[] = result?.invoices ?? [];
  const unpaid: any[] = result?.unpaid ?? [];

  return (
    <DashboardShell
      user={user}
      title="Invoices (Jortt)"
      actions={
        <>
          <DateRangePicker value={range} onChange={setRange} />
          <RefreshButton onRefresh={load} isLoading={isLoading} />
        </>
      }
    >
      <div className="p-6 space-y-6">
        {result?.error && (
          <Card className="border-destructive/40">
            <CardContent className="pt-6 text-sm text-destructive">{result.error}</CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Revenue (sent)" value={fmtMoney(totals.revenue)} />
          <KpiCard label="Invoices" value={(totals.invoiceCount ?? 0).toLocaleString()} />
          <KpiCard label="Accounts receivable" value={fmtMoney(totals.accountsReceivable)} />
          <KpiCard
            label="Overdue"
            value={`${(totals.overdueCount ?? 0).toLocaleString()} · ${fmtMoney(totals.overdueAmount)}`}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Invoices in range</CardTitle>
            <CardDescription>{invoices.length} invoices</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border max-h-[480px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.slice(0, 200).map((i) => (
                    <TableRow key={i.id || i.number}>
                      <TableCell className="font-medium">{i.number}</TableCell>
                      <TableCell>{i.customer}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {i.invoiceDate ? format(new Date(i.invoiceDate), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {i.dueDate ? format(new Date(i.dueDate), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{i.status}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(i.total, i.currency)}</TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && invoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No invoices in this range
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unpaid invoices</CardTitle>
            <CardDescription>{unpaid.length} outstanding</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border max-h-[400px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unpaid.slice(0, 200).map((i) => (
                    <TableRow key={i.id || i.number}>
                      <TableCell className="font-medium">{i.number}</TableCell>
                      <TableCell>{i.customer}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {i.dueDate ? format(new Date(i.dueDate), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(i.due, i.currency)}</TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && unpaid.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        Nothing outstanding
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
