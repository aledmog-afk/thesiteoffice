import 'server-only';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Household, HouseholdSettings } from '@/types/database';

// A freshly created auth user has no household row, so the very first sign-in
// has to bootstrap one or every RLS policy resolves to NULL and the whole app
// reads as empty. Doing it here rather than in an auth.users trigger keeps it
// visible in application code and out of the auth schema.
export async function ensureHousehold(): Promise<{
  household: Household;
  settings: HouseholdSettings;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: existing, error: readError } = await supabase
    .from('households')
    .select('*')
    .eq('owner_user_id', user.id)
    .maybeSingle();
  if (readError) throw readError;

  let household = existing;

  if (!household) {
    const { data: created, error } = await supabase
      .from('households')
      .insert({
        owner_user_id: user.id,
        name: 'Our Home',
        // Intl gives the tablet's own zone, which is the household's zone in
        // practice and beats hardcoding one.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      })
      .select('*')
      .single();
    if (error) throw error;
    household = created;
  }

  const { data: existingSettings, error: settingsReadError } = await supabase
    .from('household_settings')
    .select('*')
    .eq('household_id', household.id)
    .maybeSingle();
  if (settingsReadError) throw settingsReadError;

  let settings = existingSettings;

  if (!settings) {
    // Every column has a DB default (including enabled_meal_slots = {dinner}),
    // so the row only needs its key.
    const { data: created, error } = await supabase
      .from('household_settings')
      .insert({ household_id: household.id })
      .select('*')
      .single();
    if (error) throw error;
    settings = created;
  }

  await ensureDefaultLists(household.id);

  return { household, settings };
}

// A shared list app that opens on an empty "no lists" screen has failed before
// it starts, so the two the household will certainly want exist from first run.
// Idempotent on the household having any list at all, so deleting one does not
// make it reappear on the next page load.
async function ensureDefaultLists(householdId: string) {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from('lists')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  if ((count ?? 0) > 0) return;

  const { error: insertError } = await supabase.from('lists').insert([
    { household_id: householdId, name: 'Shopping', kind: 'shopping', sort_order: 0 },
    { household_id: householdId, name: 'To do', kind: 'todo', sort_order: 1 },
  ]);
  if (insertError) throw insertError;
}

// Needed on insert because household_id is NOT NULL. Read from the session
// rather than accepted from a form: RLS's WITH CHECK would reject a foreign
// value anyway, but there is no reason to let one reach the database.
export async function currentHouseholdId(): Promise<string> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data, error } = await supabase
    .from('households')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (error) throw error;
  return data.id;
}
