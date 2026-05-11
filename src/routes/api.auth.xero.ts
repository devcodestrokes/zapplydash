import { createFileRoute } from "@tanstack/react-router";

// Initiates the Xero OAuth 2.0 Authorization Code flow.
// Visit /api/auth/xero while logged in to connect your Xero organization.

// Xero OAuth 2.0 scopes — validated against the official Xero scopes docs:
// https://developer.xero.com/documentation/guides/oauth2/scopes/
// Xero now assigns granular Accounting scopes to Web/PKCE apps. Requesting the
// old broad/deprecated scopes can return invalid_scope on newer Xero apps.
// Restricted scopes that require certification/partner access and non-tenanted
// client-credentials scopes are intentionally NOT requested because they also
// cause invalid_scope for normal authorization-code login flows.
// Allow override via env var so scopes can be trimmed without code changes.
const XERO_SCOPES =
  process.env.XERO_SCOPES ??
  [
    "openid",
    "profile",
    "email",
    "offline_access",

    // Accounting API — new granular read scopes used by this dashboard.
    "accounting.invoices.read",
    "accounting.payments.read",
    "accounting.banktransactions.read",
    "accounting.manualjournals.read",
    "accounting.reports.aged.read",
    "accounting.reports.balancesheet.read",
    "accounting.reports.banksummary.read",
    "accounting.reports.budgetsummary.read",
    "accounting.reports.executivesummary.read",
    "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read",
    "accounting.reports.taxreports.read",
    "accounting.reports.tenninetynine.read",
    "accounting.journals.read",
    "accounting.contacts.read",
    "accounting.settings.read",
    "accounting.attachments.read",
    "accounting.budgets.read",

    // Other generally available organisation APIs from the same Xero docs.
    "files.read",
    "assets.read",
    "projects.read",
  ].join(" ");

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

        const stateBytes = new Uint8Array(32);
        crypto.getRandomValues(stateBytes);
        const state = Array.from(stateBytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

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
