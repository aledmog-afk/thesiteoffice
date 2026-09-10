'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { currentHouseholdId } from '@/lib/household';
import { HEX_RE, isPaletteColor } from '@/lib/palette';

// No household_id is filtered anywhere below: RLS scopes every one of these to
// current_household_id(), so no query needs an explicit household filter to be safe.

function readForm(formData: FormData) {
  const displayName = String(formData.get('display_name') ?? '').trim();
  const color = String(formData.get('color') ?? '').trim();
  const emoji = String(formData.get('avatar_emoji') ?? '').trim();

  if (!displayName) return { error: 'Give them a name.' as const };
  if (displayName.length > 40) return { error: 'That name is too long.' as const };
  if (!HEX_RE.test(color) || !isPaletteColor(color)) {
    return { error: 'Pick a colour from the palette.' as const };
  }

  return {
    values: {
      display_name: displayName,
      color,
      // One grapheme, so a pasted string can't blow out the avatar layout.
      avatar_emoji: emoji ? Array.from(emoji)[0] : null,
    },
  };
}

export async function createMember(formData: FormData) {
  const parsed = readForm(formData);
  if ('error' in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  // Append to the end of the roster; ordering is drag-adjusted later.
  const { data: last } = await supabase
    .from('family_members')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('family_members').insert({
    household_id: householdId,
    ...parsed.values,
    avatar_url: null,
    sort_order: (last?.sort_order ?? -1) + 1,
    is_active: true,
  });

  if (error) {
    // family_members_name_key is UNIQUE (household_id, lower(display_name)).
    if (error.code === '23505') return { error: 'Someone already has that name.' };
    return { error: error.message };
  }

  revalidatePath('/settings/members');
  revalidatePath('/display');
  return { ok: true as const };
}

export async function updateMember(memberId: string, formData: FormData) {
  const parsed = readForm(formData);
  if ('error' in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from('family_members')
    .update(parsed.values)
    .eq('id', memberId);

  if (error) {
    if (error.code === '23505') return { error: 'Someone already has that name.' };
    return { error: error.message };
  }

  revalidatePath('/settings/members');
  revalidatePath('/display');
  return { ok: true as const };
}

// Soft-retire, never delete (§2.1). points_ledger.member_id is ON DELETE
// RESTRICT precisely so a member with history cannot be removed by accident.
export async function retireMember(memberId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('family_members')
    .update({ is_active: false })
    .eq('id', memberId);

  if (error) return { error: error.message };

  revalidatePath('/settings/members');
  revalidatePath('/display');
  return { ok: true as const };
}

export async function reactivateMember(memberId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('family_members')
    .update({ is_active: true })
    .eq('id', memberId);

  if (error) return { error: error.message };

  revalidatePath('/settings/members');
  revalidatePath('/display');
  return { ok: true as const };
}
