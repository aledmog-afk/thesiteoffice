# Family Hub Calendar

Shared family organiser for a wall-mounted tablet plus phones. Next.js 16 (App
Router) + Tailwind 4 + Supabase (Postgres, Auth, Realtime, Storage).

Design and rationale: [`ARCHITECTURE.md`](ARCHITECTURE.md).
Schema: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

## Status

Build-order steps 1–7 are done: foundation, family profiles, Realtime plumbing,
shared lists, the calendar, the chore chart, and rewards. Meals, photo frame,
weather and dimming are designed but not built — `/display` shows placeholders
naming the step each lands in.

Usable now:

- **`/lists`** — a Shopping and a To do list from first run, with quick add,
  tick, assign, delete and clear-completed, syncing live across devices.
- **`/calendar`** — day, week and month views colour-coded by member, tap to
  add or edit, recurring events with per-occurrence edit and delete. Two-way
  Google/Outlook sync is step 11; everything here is local-only so far.
- **`/chores`** — this week's chart as member columns × day rows, one-tap
  ticking, live point balances, and a per-member ledger drawer.
- **`/rewards`** — leaderboard by points earned this week/month/all-time,
  household-configured rewards to spend on, and a queue of claimed rewards
  waiting to be handed over (or cancelled and refunded).

## Setup

1. **Create a Supabase project**, then apply the migration (SQL Editor, or
   `supabase db push` with the CLI linked).

2. **Create the one household auth user.** Authentication → Users → Add user,
   with "Auto Confirm User" on. There is deliberately no sign-up screen: one
   shared account per household, and family members are rows rather than logins.

3. **Configure the environment:**

   ```bash
   cp .env.example .env.local
   # fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```

   `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are needed only for the
   scheduled chore-instance top-up; without them the board's "Refresh
   schedule" button does the same job on demand. `TOKEN_ENC_KEY` is for
   calendar sync (step 11) and can stay empty.

4. **Enable Realtime** for the tables in the publication. The migration already
   runs `alter publication supabase_realtime add table …`, so this only needs
   checking if Realtime was disabled at the project level.

5. **Run it:**

   ```bash
   npm install
   npm run dev
   ```

   Sign in with the account from step 2. The first authenticated request calls
   `ensureHousehold()`, which creates the `households` and `household_settings`
   rows — without them every RLS policy resolves to NULL and the app reads as
   empty. Then add family members at `/settings/members`.

Optional seed data (four members, a chore, a reward):

```bash
psql "$DATABASE_URL" -v uid="'<auth-user-uuid>'" -f supabase/seed.sql
```

## Layout

| Path | Purpose |
| --- | --- |
| `proxy.ts` | Session refresh + auth gate. Next 16 renamed the `middleware` convention to `proxy`. |
| `lib/supabase/{client,server,service}.ts` | Browser, RLS-scoped server, and service-role clients. The latter two are `server-only`. |
| `lib/household.ts` | `ensureHousehold()` — first-run bootstrap. |
| `lib/realtime/` | One channel per household, plus the reconnect/staleness epoch. |
| `components/members/` | `MemberProvider` (the roster every feature reads), avatar, chip, picker. |
| `components/lists/` | `ListView`, `QuickAddBar`, `ItemRow`, and the `useListItems` hook. |
| `lib/lists/` | `quickAdd.ts` (quantity parsing) and `reconcile.ts` (Realtime/optimistic merge) — both unit tested. |
| `components/calendar/` | `CalendarShell` (owns view + window), `MonthGrid`, `WeekGrid`, `DayAgenda`, `EventSheet`, `useOccurrences`. |
| `lib/calendar/` | `timezone.ts` (wall-clock ↔ instant, DST-safe), `occurrences.ts` (recurrence expansion), `rrule.ts` — 38 unit tests. |
| `components/chores/` | `ChoreBoard`, `ChoreCheckbox`, `LedgerDrawer`, `useChoreBoard`. |
| `lib/chores/` | `schedule.ts` (due-date generation, unit tested) and `generate.ts` (idempotent upsert). |
| `components/rewards/` | `PointsHub`, `Leaderboard`, `RewardShelf`, `RedemptionQueue`. |
| `lib/points/` | `periods.ts` (leaderboard date ranges) and `errors.ts` (RPC error → readable text) — both unit tested. |
| `app/api/cron/` | Scheduled routes. Each verifies `CRON_SECRET` itself and refuses to run without it. |
| `app/(household)/` | Signed-in routes; the layout supplies household + Realtime + roster context. |
| `types/database.ts` | Hand-written for now; regenerate with `supabase gen types` once a project exists. |

## Verification

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test over lib/**/*.test.ts
npm run build       # includes Next's own type check
```

Tests use Node's built-in runner with `--experimental-strip-types`, so there is
no test framework to install. They cover the pure logic worth pinning down:
quick-add parsing and the Realtime reconciliation rules.

The schema is exercised separately against a throwaway Postgres — see the
validation note at the top of `ARCHITECTURE.md` for what is covered.

## Not in v1

Voice input, app shortcuts, and AI email/receipt parsing are out of scope and
deliberately un-scaffolded.
