import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/debug-env")({
  server: {
    handlers: {
      GET: async () => {
        const keys = [
          "SUPABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "SUPABASE_PUBLISHABLE_KEY",
          "VITE_SUPABASE_URL",
          "VITE_SUPABASE_PUBLISHABLE_KEY",
          "SHOPIFY_APP_CLIENT_ID",
          "JORTT_CLIENT_ID",
          "XERO_CLIENT_ID",
          "TRIPLE_WHALE_API_KEY",
          "LOOP_UK_API_KEY",
          "JUO_NL_API_KEY",
        ];
        const status: Record<string, string> = {};
        for (const k of keys) {
          const v = process.env[k];
          status[k] = v ? `set (${v.length} chars)` : "MISSING";
        }
        return Response.json(status);
      },
    },
  },
});
