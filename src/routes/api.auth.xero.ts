import { createFileRoute } from "@tanstack/react-router";

// Initiates the Xero OAuth 2.0 Authorization Code flow.
// Visit /api/auth/xero while logged in to connect your Xero organization.

// Xero OAuth 2.0 scopes — every scope listed here MUST be enabled in your
// Xero app at https://developer.xero.com/app/manage. If any scope is not
// enabled on the app, Xero returns: unauthorized_client / "Invalid scope for client".
// Allow override via env var so you can quickly trim scopes without redeploying code logic.
const XERO_SCOPES =
  process.env.XERO_SCOPES ??
  "openid profile email offline_access accounting.transactions accounting.reports.read accounting.settings.read";

export const Route = createFileRoute("/api/auth/xero")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env.XERO_CLIENT_ID;
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ??
          process.env.APP_URL ??
          new URL(request.url).origin;
        const redirectUri = `${appUrl}/api/auth/xero/callback`;

        if (!clientId) {
          return Response.json(
            { error: "XERO_CLIENT_ID not set" },
            { status: 500 },
          );
        }

        const state = Math.random().toString(36).slice(2);

        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: XERO_SCOPES,
          state,
        });

        const authUrl = `https://login.xero.com/identity/connect/authorize?${params}`;
        console.log("[Xero OAuth] redirect_uri:", redirectUri);

        return new Response(null, {
          status: 302,
          headers: {
            Location: authUrl,
            "Set-Cookie": `xero_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`,
          },
        });
      },
    },
  },
});
