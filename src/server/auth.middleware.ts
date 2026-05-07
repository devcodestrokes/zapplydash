// Server-side authorization middleware — wraps requireSupabaseAuth and additionally
// enforces that the authenticated user belongs to an allowed email domain.
// Used by every server function that returns or mutates sensitive business data.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_DOMAINS = ["zapply.nl", "codestrokes.com"];

export const requireAllowedUser = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const claims = (context as any).claims ?? {};
    const email: string =
      (typeof claims.email === "string" && claims.email) ||
      (typeof claims.user_metadata?.email === "string" && claims.user_metadata.email) ||
      "";
    const lower = email.toLowerCase();
    const ok =
      lower &&
      ALLOWED_DOMAINS.some((d) => lower.endsWith(`@${d}`));
    if (!ok) {
      throw new Response("Forbidden", { status: 403 });
    }
    return next();
  });
