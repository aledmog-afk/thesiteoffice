'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { currentHouseholdId } from '@/lib/household';
import { parseQuickAdd } from '@/lib/lists/quickAdd';

// No household_id filter appears in any query below: RLS scopes them all to
// current_household_id(). The id is only supplied where a NOT NULL column
// demands it.
//
// These return errors rather than throwing so the client can roll an optimistic
// row back and show why, instead of tripping an error boundary and losing the
// list the user was mid-way through.
type ActionResult = { ok: true } | { error: string };

export async function addItem(
  listId: string,
  itemId: string,
  raw: string,
  assignedMemberId: string | null,
): Promise<ActionResult> {
  const { title, quantityText } = parseQuickAdd(raw);
  if (!title) return { error: 'Type something to add.' };
  if (title.length > 200) return { error: 'That is too long for a list item.' };

  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  // Append: one row read instead of renumbering the list, which is the whole
  // reason position is numeric (§2.5).
  const { data: last } = await supabase
    .from('list_items')
    .select('position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('list_items').insert({
    // Client-generated so the optimistic row and its Realtime echo collide on
    // the same key rather than rendering twice.
    id: itemId,
    household_id: householdId,
    list_id: listId,
    title,
    quantity_text: quantityText,
    assigned_member_id: assignedMemberId,
    position: (last?.position ?? 0) + 1000,
  });

  if (error) return { error: error.message };

  revalidatePath(`/lists/${listId}`);
  return { ok: true };
}

export async function setItemDone(
  itemId: string,
  isDone: boolean,
  byMemberId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();

  // Last-write-wins on is_done (§2.5): one parent in the shop and one at home
  // ticking the same item is the normal case, and the state is a re-tickable
  // boolean, so there is nothing to reconcile.
  const { error } = await supabase
    .from('list_items')
    .update({
      is_done: isDone,
      done_at: isDone ? new Date().toISOString() : null,
      done_by_member_id: isDone ? byMemberId : null,
    })
    .eq('id', itemId);

  if (error) return { error: error.message };
  return { ok: true };
}

export async function assignItem(
  itemId: string,
  memberId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('list_items')
    .update({ assigned_member_id: memberId })
    .eq('id', itemId);

  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteItem(itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('list_items').delete().eq('id', itemId);

  if (error) return { error: error.message };
  return { ok: true };
}

export async function clearCompleted(listId: string): Promise<ActionResult> {
  const supabase = await createClient();

  // Deliberately does not touch items generated from a meal plan that are
  // still pending — only completed rows go, whatever their source.
  const { error } = await supabase
    .from('list_items')
    .delete()
    .eq('list_id', listId)
    .eq('is_done', true);

  if (error) return { error: error.message };

  revalidatePath(`/lists/${listId}`);
  return { ok: true };
}
