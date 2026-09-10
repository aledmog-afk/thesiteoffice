import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// /api/cron is not session-authenticated: it is called by the platform's
// scheduler with a bearer secret, which each route verifies itself and fails
// closed on. Nothing else may be added here without its own auth.
const PUBLIC_PATHS = ['/login', '/auth', '/api/cron'];

// Refreshes the session cookie on every request and gates the app behind the
// single household login. The wall tablet stays signed in indefinitely because
// this runs on each navigation and rotates the refresh token before it expires.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), not getSession(): getSession trusts the cookie without verifying
  // it against the auth server, so it must not be the thing an auth gate reads.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/display';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
