'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

// One client per browser tab. @supabase/ssr reads the same cookies the server
// writes, so a session established in a server action is visible here without a
// round trip — which is what lets Realtime authenticate immediately after login.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
