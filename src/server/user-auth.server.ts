// Verifies that an incoming HTTP request carries a valid Supabase session
// bearer token from a user with an allowed email domain. Used to protect
// /api/sync (called by the in-app dashboard "Sync" button).
import { createClient } from "@supabase/supabase-js";

const ALLOWED_DOMAINS = ["zapply.nl", "codestrokes.com"];

export async function verifyAllowedUser(
  request: Request,
): Promise<Response | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) {
    return new Response("Unauthorized", { status: 401 });
  }
  const email = String((data.claims as any).email ?? "").toLowerCase();
  const ok =
    email && ALLOWED_DOMAINS.some((d) => email.endsWith(`@${d}`));
  if (!ok) return new Response("Forbidden", { status: 403 });
  return null;
}
