import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Index exists so /lists is not a dead URL, but with the usual one-or-two
// lists it just forwards to the first rather than making the household tap
// through a menu of two.
export default async function ListsIndexPage() {
  const supabase = await createClient();

  const { data: lists } = await supabase
    .from('lists')
    .select('*')
    .eq('is_archived', false)
    .order('sort_order');

  if (lists && lists.length === 1) redirect(`/lists/${lists[0].id}`);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Lists</h1>
      {!lists || lists.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No lists yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white">
          {lists.map((list) => (
            <li key={list.id}>
              <Link
                href={`/lists/${list.id}`}
                className="flex min-h-[56px] items-center px-4 text-lg font-medium"
              >
                {list.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
