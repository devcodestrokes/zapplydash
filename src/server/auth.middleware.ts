// Server-side authorization middleware — wraps requireSupabaseAuth and additionally
// enforces that the authenticated user belongs to an allowed email domain.
// Used by every server function that returns or mutates sensitive business data.
//
// Preview/dev hosts (Lovable preview iframe, localhost) bypass auth so the
// in-editor preview keeps working without a real Supabase session.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_DOMAINS = ["zapply.nl", "codestrokes.com"];

function isPreviewHost(host: string): boolean {
  return (
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.dev") ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1")
  );
}

export const requireAllowedUser = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const host = request?.headers.get("host") ?? "";
    const origin = request?.headers.get("origin") ?? "";

    // Preview/dev: skip auth entirely — used inside the Lovable editor iframe
    // where there's no real Supabase session.
    if (isPreviewHost(host) || isPreviewHost(origin)) {
      return next();
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Response("Server misconfigured", { status: 500 });
    }

    const auth = request?.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      throw new Response("Unauthorized", { status: 401 });
    }
    const token = auth.slice("Bearer ".length);

    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      throw new Response("Unauthorized", { status: 401 });
    }
    const email = String((data.claims as any).email ?? "").toLowerCase();
    const ok =
      email && ALLOWED_DOMAINS.some((d) => email.endsWith(`@${d}`));
    if (!ok) throw new Response("Forbidden", { status: 403 });

    return next();
  },
);
