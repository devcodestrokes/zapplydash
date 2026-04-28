import { createFileRoute } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/pillars/margin-per-market")({
  head: () => ({ meta: [{ title: "Margin per market — Zapply" }] }),
  component: MarginPerMarketPage,
});

function MarginPerMarketPage() {
  const { user } = useDashboardSession();
  return (
    <DashboardShell user={user} title="Margin per market">
      <div className="p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              <CardTitle>Margin per market</CardTitle>
            </div>
            <CardDescription>Gross and contribution margin breakdown by market.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
