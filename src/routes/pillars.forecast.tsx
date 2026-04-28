import { createFileRoute } from "@tanstack/react-router";
import { LineChart } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/pillars/forecast")({
  head: () => ({ meta: [{ title: "Forecast — Zapply" }] }),
  component: ForecastPage,
});

function ForecastPage() {
  const { user } = useDashboardSession();
  return (
    <DashboardShell user={user} title="Forecast">
      <div className="p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <LineChart className="h-5 w-5 text-primary" />
              <CardTitle>Forecast</CardTitle>
            </div>
            <CardDescription>Projected revenue, spend and cash position.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
