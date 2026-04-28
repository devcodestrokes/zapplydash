import { createFileRoute } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/pillars/daily-pnl")({
  head: () => ({ meta: [{ title: "Daily P&L — Zapply" }] }),
  component: DailyPnlPage,
});

function DailyPnlPage() {
  const { user } = useDashboardSession();
  return (
    <DashboardShell user={user} title="Daily P&L">
      <div className="p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle>Daily P&L</CardTitle>
            </div>
            <CardDescription>Day-by-day profit and loss across all markets.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
