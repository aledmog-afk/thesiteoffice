import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { generateChoreInstances } from '@/lib/chores/generate';
import { dateKey } from '@/lib/calendar/timezone';

// Rolls the chore horizon forward for every household. Runs as the service
// role because it is not acting for a signed-in session.
//
// This path is public as far as the auth gate is concerned, so the secret
// below is the only thing protecting it — and it FAILS CLOSED when CRON_SECRET
// is unset, rather than leaving an open endpoint that writes rows.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const provided = request.headers.get('authorization');
  if (provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createServiceClient();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'service client unavailable' },
      { status: 503 },
    );
  }

  const { data: households, error } = await supabase.from('households').select('id, timezone');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { householdId: string; inserted: number; error?: string }[] = [];
  for (const household of households ?? []) {
    // Each household's horizon is measured in its own timezone, so "today"
    // means today where the tablet is.
    const today = dateKey(new Date(), household.timezone);
    const result = await generateChoreInstances(supabase, household.id, today);
    results.push({ householdId: household.id, ...result });
  }

  return NextResponse.json({
    households: results.length,
    inserted: results.reduce((n, r) => n + r.inserted, 0),
    failures: results.filter((r) => r.error),
  });
}
