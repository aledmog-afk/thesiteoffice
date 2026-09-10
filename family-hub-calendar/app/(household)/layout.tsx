import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ensureHousehold } from '@/lib/household';
import { HouseholdChannelProvider } from '@/lib/realtime/HouseholdChannelProvider';
import { MemberProvider } from '@/components/members/MemberProvider';

// Everything inside this group is signed-in-only (proxy.ts already redirected
// otherwise) and gets the household context, the shared Realtime channel and
// the member roster. §2.1: the roster is prefetched here and handed to the
// provider so the wall display never renders uncoloured content.
export default async function HouseholdLayout({ children }: { children: React.ReactNode }) {
  const { household } = await ensureHousehold();
  const supabase = await createClient();

  const { data: members } = await supabase
    .from('family_members')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
    .order('display_name');

  return (
    <HouseholdChannelProvider householdId={household.id}>
      <MemberProvider householdId={household.id} initialMembers={members ?? []}>
        <div className="flex min-h-dvh flex-col">
          <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
            <Link href="/display" className="text-base font-semibold">
              {household.name}
            </Link>
            <nav className="ml-auto flex items-center gap-1">
              <Link
                href="/calendar"
                className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-600"
              >
                Calendar
              </Link>
              <Link
                href="/lists"
                className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-600"
              >
                Lists
              </Link>
              <Link
                href="/settings/members"
                className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-600"
              >
                Settings
              </Link>
            </nav>
          </header>
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </MemberProvider>
    </HouseholdChannelProvider>
  );
}
