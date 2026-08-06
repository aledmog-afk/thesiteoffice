# Household OS

Multi-tenant household management SaaS — Phase 1 MVP (auth, households/members,
shared calendar, tasks & recurring routines, shopping list).

## Stack

Next.js 16 (App Router) + TypeScript, Tailwind CSS v4 + hand-rolled shadcn/ui
primitives, Supabase (Postgres, Auth, Realtime), Resend for email.

## Setup

1. Create a Supabase project and run the migration:

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push   # applies supabase/migrations/0001_init.sql
   ```

   (Or paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor.)

2. Copy `.env.example` to `.env.local` and fill in your Supabase project URL,
   anon key, and service role key. `SUPABASE_SERVICE_ROLE_KEY` is only used
   server-side by the public `.ics` calendar feed route.

3. In Supabase Auth settings, add `http://localhost:3000/auth/callback` (and
   your production URL) as a redirect URL.

4. Optionally add a `RESEND_API_KEY` to send real invite emails — without it,
   invite links are logged to the server console instead.

5. Install and run:

   ```bash
   npm install
   npm run dev
   ```

## What's built (Phase 1)

- Email/password auth, household creation, member roles (owner/adult/child),
  email invites with a secure token-based accept flow, row-level security
  scoped to `household_id` on every table.
- Shared calendar: month/week/day views, CRUD, per-member color coding, and a
  read-only `.ics` subscription feed (`/api/ics/[token]`) for Google/Apple
  Calendar. **Not yet built:** true two-way CalDAV sync — that needs OAuth
  app registrations with Google/Apple this environment couldn't provision.
- Tasks & recurring routines: one-off tasks, a small natural-language
  recurrence parser (`src/lib/recurrence.ts` — "every 90 days", "every
  Monday", "daily", ...), fair rotation between selected members, points +
  leaderboard, and parent-approval gating for a child's completed tasks.
- Shopping list & recipe box: free-text add (comma/newline separated),
  keyword-based aisle categorization, "add to list" from a saved recipe,
  Supabase Realtime sync so check-offs appear instantly for every member.
- Household notes broadcast feed on the dashboard.
- Billing gate stub: `households.plan` (`free`/`paid`) gates the property
  count in application code; no real payment processing is wired up.

## Known gaps / next steps

- Phase 2 (home reference & admin, document storage, maintenance reminders),
  Phase 3 (finances, notifications/digest email sending), and Phase 4
  (NL assistant, real billing) are not built yet — see the project brief.
- `src/lib/database.types.ts` is hand-written to match the migration. Once a
  Supabase project is linked, prefer regenerating it from the live schema.
- No automated tests yet.
