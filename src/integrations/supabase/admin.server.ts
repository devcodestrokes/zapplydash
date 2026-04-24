// Service-role Supabase client — server-side only. Bypasses RLS.
// Used for token cache reads/writes and other internal operations.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export function adminClient() {
  const url =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
