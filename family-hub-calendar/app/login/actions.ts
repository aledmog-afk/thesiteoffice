'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// One shared household account: sign-in only, no sign-up screen and no
// per-member login (§Auth model). Create the account once in the Supabase
// dashboard; ensureHousehold() bootstraps its rows on first visit.
export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/display');

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent('Enter an email and password.')}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately generic: the message is rendered on a screen that may be
    // mounted on a wall in a hallway.
    redirect(`/login?error=${encodeURIComponent('That email and password did not match.')}`);
  }

  revalidatePath('/', 'layout');
  redirect(postLoginTarget(next));
}

// An allowlist rather than a `startsWith('/')` check. It closes the open-redirect
// surface on the `next` param, and it satisfies Next 16's typedRoutes, which will
// not accept an arbitrary string as a route. Add entries as routes land.
const POST_LOGIN_ROUTES = {
  '/display': '/display',
  '/settings/members': '/settings/members',
} as const;

function postLoginTarget(next: string) {
  return POST_LOGIN_ROUTES[next as keyof typeof POST_LOGIN_ROUTES] ?? '/display';
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
