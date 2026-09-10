import { NextResponse } from 'next/server';

// Compared by the kiosk against the build id baked into its own bundle, so a
// tablet left open across a deploy reloads instead of silently running stale
// JS against a migrated schema.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
