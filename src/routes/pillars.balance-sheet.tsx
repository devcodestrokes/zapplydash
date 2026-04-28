import { createFileRoute } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/pillars/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance sheet — Zapply" }] }),
  component: BalanceSheetPage,
});

function BalanceSheetPage() {
  const { user } = useDashboardSession();
  return (
    <DashboardShell user={user} title="Balance sheet">
      <div className="p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" />
              <CardTitle>Balance sheet</CardTitle>
            </div>
            <CardDescription>Assets, liabilities and equity overview.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
