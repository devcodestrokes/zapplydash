import { createFileRoute } from "@tanstack/react-router";
import { createClient as createSupabaseJS } from "@supabase/supabase-js";

function serviceClient() {
  return createSupabaseJS(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export const Route = createFileRoute("/api/auth/xero/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ??
          process.env.APP_URL ??
          url.origin;
        const redirectUri = `${appUrl}/api/auth/xero/callback`;

        if (error) {
          console.error("Xero OAuth error:", error);
          return Response.redirect(
            `${appUrl}/?xero_error=${encodeURIComponent(error)}`,
            302,
          );
        }
        if (!code) {
          return Response.redirect(`${appUrl}/?xero_error=no_code`, 302);
        }

        const clientId = process.env.XERO_CLIENT_ID;
        const clientSecret = process.env.XERO_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return Response.json(
            { error: "Xero credentials not set" },
            { status: 500 },
          );
        }

        const creds = Buffer.from(`${clientId}:${clientSecret}`).toString(
          "base64",
        );

        try {
          const tokenRes = await fetch(
            "https://identity.xero.com/connect/token",
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${creds}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
              }).toString(),
              cache: "no-store",
            },
          );

          if (!tokenRes.ok) {
            const body = await tokenRes.text();
            console.error("Xero token exchange failed:", tokenRes.status, body);
            return Response.redirect(
              `${appUrl}/?xero_error=token_exchange_failed`,
              302,
            );
          }

          const { access_token, refresh_token, expires_in } =
            await tokenRes.json();

          const connRes = await fetch("https://api.xero.com/connections", {
            headers: {
              Authorization: `Bearer ${access_token}`,
              Accept: "application/json",
            },
            cache: "no-store",
          });
          const connections = connRes.ok ? await connRes.json() : [];
          const zapplyOrg =
            (connections as any[]).find((c) =>
              (c.tenantName ?? "").toLowerCase().includes("zapply"),
            ) ??
            (connections as any[])[0] ??
            null;

          const tenantId = zapplyOrg?.tenantId ?? null;
          const tenantName = zapplyOrg?.tenantName ?? "Unknown";

          const expiresAt = new Date(
            Date.now() + ((expires_in ?? 1800) - 60) * 1000,
          ).toISOString();

          await (serviceClient() as any).from("integrations").upsert(
            {
              provider: "xero",
              access_token,
              expires_at: expiresAt,
              updated_at: new Date().toISOString(),
              metadata: {
                refresh_token,
                tenant_id: tenantId,
                tenant_name: tenantName,
                source: "oauth2_authorization_code",
                connections: (connections as any[]).map((c) => ({
                  id: c.tenantId,
                  name: c.tenantName,
                })),
              },
            },
            { onConflict: "provider" },
          );

          console.log(`Xero connected: ${tenantName} (${tenantId})`);
          return Response.redirect(`${appUrl}/?xero_connected=1`, 302);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("Xero callback error:", msg);
          return Response.redirect(`${appUrl}/?xero_error=callback_error`, 302);
        }
      },
    },
  },
});
