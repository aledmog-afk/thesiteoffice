import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client that bypasses RLS. Only for trusted server contexts that
 * authorize by some other means (e.g. a capability token in the URL), such as
 * the public .ics calendar feed — never expose this client or its key to the browser.
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
