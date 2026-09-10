// Next 16 renamed the `middleware` file convention to `proxy`.
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets and images so the session refresh doesn't run on every
  // slideshow photo request on the kiosk.
  //
  // sw.js MUST be here: a service worker script that 307s to /login fails
  // registration outright, and the app then cannot be installed to the home
  // screen at all.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|avif|gif|ico)$).*)',
  ],
};
