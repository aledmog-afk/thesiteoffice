// Next 16 renamed the `middleware` file convention to `proxy`.
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets and images so the session refresh doesn't run on every
  // slideshow photo request on the kiosk.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|avif|gif|ico)$).*)'],
};
