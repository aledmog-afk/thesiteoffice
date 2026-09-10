import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ensureHousehold } from '@/lib/household';
import { MemberList } from './MemberList';

export default async function MembersSettingsPage() {
  await ensureHousehold();
  const supabase = await createClient();

  const { data: members } = await supabase
    .from('family_members')
    .select('*')
    .order('sort_order')
    .order('display_name');

  const all = members ?? [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/display" className="text-sm font-medium text-slate-600">
        ← Back
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Family members</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        These are profiles, not logins — everyone shares the one household account.
      </p>

      <MemberList
        active={all.filter((m) => m.is_active)}
        retired={all.filter((m) => !m.is_active)}
      />
    </main>
  );
}
