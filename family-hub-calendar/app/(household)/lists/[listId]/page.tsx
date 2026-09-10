import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { currentHouseholdId } from '@/lib/household';
import { ListView } from '@/components/lists/ListView';

export default async function ListPage({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  // No household filter needed — RLS already scoped this, so another
  // household's list id is indistinguishable from one that does not exist.
  const { data: list } = await supabase.from('lists').select('*').eq('id', listId).maybeSingle();
  if (!list) notFound();

  const { data: items } = await supabase
    .from('list_items')
    .select('*')
    .eq('list_id', listId)
    .order('position');

  const { data: otherLists } = await supabase
    .from('lists')
    .select('id, name')
    .eq('is_archived', false)
    .order('sort_order');

  return (
    <main className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        {(otherLists ?? []).map((other) => (
          <Link
            key={other.id}
            href={`/lists/${other.id}`}
            aria-current={other.id === list.id ? 'page' : undefined}
            className={`flex min-h-[44px] items-center rounded-xl px-4 text-base font-medium ${
              other.id === list.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'
            }`}
          >
            {other.name}
          </Link>
        ))}
      </div>

      <div className="mt-3 min-h-0 flex-1 bg-white">
        <ListView list={list} householdId={householdId} initialItems={items ?? []} />
      </div>
    </main>
  );
}
