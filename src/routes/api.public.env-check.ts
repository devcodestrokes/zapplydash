// Diagnostic route — confirms which Supabase-related env values the published
// Worker bundle can see at runtime. Values are redacted (only presence + length
// + first/last 4 chars) so it is safe to expose under /api/public/*.
//
// Visit: https://<your-app>.lovable.app/api/public/env-check
import { createFileRoute } from "@tanstack/react-router";

// Vite inlines these at build time — proves the bundle itself carries the keys.
const VITE_SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_PUBLISHABLE_KEY =
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

function redact(value: string | undefined) {
  if (!value) return { present: false };
  return {
    present: true,
    length: value.length,
    preview: `${value.slice(0, 4)}…${value.slice(-4)}`,
  };
}

export const Route = createFileRoute("/api/public/env-check")({
  server: {
    handlers: {
      GET: async () => {
        const report = {
          runtime: {
            // process.env values — only populated if the Worker runtime injected them
            SUPABASE_URL: redact(process.env.SUPABASE_URL),
            SUPABASE_SERVICE_ROLE_KEY: redact(process.env.SUPABASE_SERVICE_ROLE_KEY),
            SUPABASE_PUBLISHABLE_KEY: redact(process.env.SUPABASE_PUBLISHABLE_KEY),
            VITE_SUPABASE_URL_runtime: redact(process.env.VITE_SUPABASE_URL),
            VITE_SUPABASE_PUBLISHABLE_KEY_runtime: redact(
              process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            ),
          },
          buildInlined: {
            // import.meta.env values — Vite replaces these at build time
            VITE_SUPABASE_URL: redact(VITE_SUPABASE_URL),
            VITE_SUPABASE_PUBLISHABLE_KEY: redact(VITE_SUPABASE_PUBLISHABLE_KEY),
          },
          resolved: {
            // What the admin client will actually use
            url:
              process.env.SUPABASE_URL ||
              process.env.VITE_SUPABASE_URL ||
              VITE_SUPABASE_URL ||
              null,
            keySource:
              (process.env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY") ||
              (process.env.SUPABASE_PUBLISHABLE_KEY && "SUPABASE_PUBLISHABLE_KEY") ||
              (process.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
                "VITE_SUPABASE_PUBLISHABLE_KEY (runtime)") ||
              (VITE_SUPABASE_PUBLISHABLE_KEY &&
                "VITE_SUPABASE_PUBLISHABLE_KEY (build-inlined)") ||
              null,
          },
          allProcessEnvKeys: Object.keys(process.env || {})
            .filter((k) => /SUPABASE|VITE_/i.test(k))
            .sort(),
          timestamp: new Date().toISOString(),
        };

        return Response.json(report, {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
