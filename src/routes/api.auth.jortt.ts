import { createFileRoute } from "@tanstack/react-router";

// Initiates the Jortt OAuth 2.0 Authorization Code flow.
// Visit /api/auth/jortt to connect or re-authorize the Jortt account.

const JORTT_SCOPES = [
  "invoices:read",
  "expenses:read",
  "reports:read",
  "customers:read",
  "financing:read",
  "organizations:read",
  "payroll:read",
  "estimates:read",
].join(" ");

export const Route = createFileRoute("/api/auth/jortt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env.JORTT_CLIENT_ID;
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ??
          process.env.APP_URL ??
          new URL(request.url).origin;
        // Callback path matches the existing handler at src/routes/api.jortt.callback.ts
        const redirectUri = `${appUrl}/api/jortt/callback`;

        if (!clientId) {
          return Response.json(
            { error: "JORTT_CLIENT_ID not set" },
            { status: 500 },
          );
        }

        const state = Math.random().toString(36).slice(2);

        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: JORTT_SCOPES,
          state,
        });

        const authUrl = `https://app.jortt.nl/oauth/authorize?${params}`;
        console.log("[Jortt OAuth] redirect_uri:", redirectUri);

        return new Response(null, {
          status: 302,
          headers: {
            Location: authUrl,
            "Set-Cookie": `jortt_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`,
          },
        });
      },
    },
  },
});
