import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import FinanceDashboard from "@/components/FinanceDashboard";
import { getDashboardData } from "@/server/dashboard.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Zapply Finance Dashboard" },
      {
        name: "description",
        content: "Zapply Group B.V. — Internal Finance Dashboard",
      },
    ],
  }),
  component: HomePage,
});

const ALLOWED_DOMAINS = ["zapply.nl", "codestrokes.com"];

function HomePage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [data, setData] = useState<Awaited<ReturnType<typeof getDashboardData>> | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      navigate({ to: "/login", search: {} });
      return;
    }
    const email = (session.user.email ?? "").toLowerCase();
    const ok = ALLOWED_DOMAINS.some((d) => email.endsWith(`@${d}`));
    if (!ok) {
      supabase.auth.signOut().then(() =>
        navigate({ to: "/login", search: { error: "unauthorized_domain" } }),
      );
      return;
    }
    setLoadingData(true);
    getDashboardData()
      .then((d) => setData(d))
      .finally(() => setLoadingData(false));
  }, [session, navigate]);

  if (session === undefined || !session || loadingData || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-sm text-neutral-500">Loading dashboard…</div>
      </div>
    );
  }

  const user = {
    email: session.user.email ?? "",
    name:
      (session.user.user_metadata as Record<string, string> | null)?.full_name ??
      session.user.email ??
      "",
    avatar:
      (session.user.user_metadata as Record<string, string> | null)?.avatar_url ??
      (session.user.user_metadata as Record<string, string> | null)?.picture ??
      (session.user.user_metadata as Record<string, string> | null)?.avatar ??
      null,
  };

  const Dashboard = FinanceDashboard as unknown as React.FC<any>;
  return (
    <Dashboard
      user={user}
      liveData={{
        shopifyMarkets: data.shopifyMarkets,
        shopifyMonthly: data.shopifyMonthly,
        tripleWhale: data.tripleWhale,
        loop: data.loop,
        jortt: data.jortt,
      }}
      connections={data.connections}
    />
  );
}
