import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/pillars/monthly-overview")({
  head: () => ({ meta: [{ title: "Monthly overview — Zapply" }] }),
  component: MonthlyOverviewPage,
});

function MonthlyOverviewPage() {
  const { user } = useDashboardSession();
  return (
    <DashboardShell user={user} title="Monthly overview">
      <div className="p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <CardTitle>Monthly overview</CardTitle>
            </div>
            <CardDescription>Consolidated monthly performance across all stores.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
