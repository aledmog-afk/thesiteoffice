# Family Hub Calendar — v1 Architecture

Next.js (App Router) + Tailwind PWA · Supabase (Postgres, Auth, Realtime, Storage) · Google Calendar + Microsoft Graph two-way sync · wall tablet in kiosk mode + family phones.

Full schema: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) — applied
against Postgres 16 with the Supabase primitives stubbed (`auth.users`, `auth.uid()`, the
`authenticated` role, `supabase_realtime`), and the points/RLS behaviour exercised: overdraw
blocked, un-tick/re-tick nets correctly, cache reconciles to the ledger, cross-household reads
isolated, direct writes to the ledger tables denied, and balances clamped at zero across penalties,
partial clawbacks and un-ticks of already-spent points.

## 1. Data Model Overview

One `auth.users` row per household. Family members are **rows**, not auth users, so every
foreign key in the app points at `family_members.id` — never `auth.uid()`.

```
auth.users
   └─1:1─ households ──1:1── household_settings   (lat/lon, units, idle + dim schedule, week start)
             │
             ├─1:N─ family_members  (display_name, color, avatar, sort_order, is_active)
             │          ▲ ▲ ▲ ▲ ▲ ▲           ← every feature tags rows against this
             │
             ├─1:N─ calendar_accounts (provider, account_email, status)
             │          ├─1:1─ private.oauth_tokens   (encrypted; service_role only)
             │          └─1:N─ calendars (provider_calendar_id, sync_token, watch_expires_at,
             │                            default_member_id → family_members)
             │                     └─1:N─ events (starts_at, rrule, provider_etag, sync_status,
             │                                       member_id → family_members, null = everyone)
             ├─1:N─ sync_outbox → events            (durable push queue, service_role only)
             │
             ├─1:N─ chores (rrule | one-off, points_value, member_id)
             │          └─1:N─ chore_instances (due_on, status, points_value snapshot)
             │                     └── source of ─┐
             ├─1:N─ rewards (name, point_cost, is_active)
             │          └─1:N─ reward_redemptions (point_cost_at_redemption, status)
             │                     └── source of ─┤
             ├─1:N─ points_ledger ◄───────────────┘  APPEND-ONLY (direction, amount,
             │          └─trigger─► member_points_cache (balance, lifetime_earned)
             │
             ├─1:N─ recipes ──1:N── recipe_ingredients (name, quantity, unit, aisle)
             ├─1:N─ meal_plan_entries (plan_date, slot, recipe_id | custom_title, cook_member_id)
             │          └── source of ─► list_items.source_meal_plan_entry_id
             ├─1:N─ lists (kind: shopping | todo)
             │          └─1:N─ list_items (is_done, done_by_member_id, assigned_member_id, position)
             ├─1:N─ photo_sources ──1:N── photos (storage_path → Storage bucket 'photos')
             └─1:1─ weather_cache (payload jsonb, expires_at)
```

Three deliberate choices:

- **`household_id` on every domain table.** Not multi-tenancy ambition — it makes every RLS
  policy the same one-liner (`household_id = current_household_id()`) and lets the client filter
  a single Realtime channel on one column. Cost is one `uuid` per row.
- **`family_members`, not `profiles`.** Supabase convention reserves `profiles` for a 1:1 mirror of
  `auth.users`; these rows are the opposite of that, and the name should say so.
- **Members are soft-retired (`is_active = false`), never deleted.** A child who moves out still
  owns years of ledger rows and completed chores; `on delete restrict` on `points_ledger.member_id`
  enforces it at the DB level.

Scoping helper used by every policy:

```sql
create or replace function current_household_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from households where owner_user_id = auth.uid() limit 1;
$$;
```

## 2. Feature-by-Feature Breakdown

### 2.1 Family profiles

**Schema** — `family_members` (see overview). `color` is constrained to `^#[0-9a-f]{6}$` and is the
single source of truth for member colour everywhere; nothing else stores a colour. Avatars are
either a Storage path (`avatar_url`) or an emoji fallback (`avatar_emoji`) so setup needs no upload.
`sort_order` fixes column order in the chore chart and calendar legend.

**Components**

| Component | Notes |
| --- | --- |
| `MemberProvider` | Loads the roster once at app root, subscribes to `family_members`, exposes `useMembers()` / `useMember(id)`. Every other feature reads colours from here rather than joining. |
| `MemberChip`, `MemberAvatar` | 44px+ avatar, colour ring, initial fallback. |
| `MemberPicker` | Horizontal avatar row, single- or multi-select. Used by event, chore, list and meal forms — one picker, four callers. |
| `app/settings/members/page.tsx` | CRUD + colour picker restricted to a 10-swatch palette so two members can never end up visually indistinguishable on a tablet across the room. |

**Realtime** — `family_members` is in the publication. A colour change on a phone must repaint the
kiosk immediately, so `MemberProvider` holds the roster in React state (not per-component fetches)
and one `postgres_changes` listener updates it.

**Kiosk UX** — the roster is the only data the whole app blocks on; prefetch it in the root layout
server component and hydrate, so the wall display never flashes uncoloured events.

### 2.2 Calendar view

**Schema** — `calendar_accounts`, `private.oauth_tokens`, `calendars`, `events`, `sync_outbox`.

Recurrence: store the **master** row with an RFC-5545 `rrule` and expand occurrences client-side
with `rrule.js` over the visible window only. Provider exceptions ("this Tuesday's football moved")
arrive as separate rows with `recurrence_parent_id` + `recurrence_original_start`. Occurrences are
never materialised — a daily chore for five years is 1,825 rows worth having, a daily standup for
five years is not.

Member attribution is a single `events.member_id`, with `NULL` meaning "everyone" and rendering in
a neutral household colour. Multi-person events ("both kids at the dentist") are handled by
duplicating or leaving unassigned — the deliberate trade for keeping the sync push path simple,
since a join table means reconciling attendee rows against provider attendee lists on every push.
If it turns out to matter, upgrading is a backfill rather than a rewrite:

```sql
create table event_members (event_id uuid, member_id uuid, is_primary boolean,
                            primary key (event_id, member_id));
insert into event_members select id, member_id, true from events where member_id is not null;
```

**Components**

| Component | Notes |
| --- | --- |
| `CalendarShell` | Owns the visible date range + view mode; single data fetch keyed on `[start, end]`. |
| `MonthGrid` / `WeekGrid` / `DayAgenda` | Three renderers over one normalised `Occurrence[]`. Week/day are CSS-grid positioned by minute offset; month is 6×7 with an overflow count. |
| `EventSheet` | Bottom sheet for create/edit — title, member picker, time wheel, all-day toggle, calendar target. |
| `useOccurrences(start, end)` | Fetches `events` overlapping the window, expands `rrule`, subtracts cancellations, merges exceptions, sorts. |
| `SyncStatusBadge` | Surfaces `calendar_accounts.status = 'needs_reauth'` and unresolved `sync_status = 'conflict'` rows. Silent sync failure is the #1 way a wall calendar quietly becomes wrong. |

**Realtime** — subscribe to `events` filtered on `household_id`. Insert/update patches the local
occurrence set; a change to a row carrying an `rrule` re-expands that master only. `events` is
`replica identity full` so DELETE payloads still carry `household_id` for filtering.

**Integration notes — flagged security steps**

- *Scopes, least privilege.* Google: `calendar.calendarlist.readonly` (to list calendars at connect
  time) + `calendar.events` for read/write. **Do not request the blanket `calendar` scope** — it
  grants calendar deletion. Microsoft Graph: `Calendars.ReadWrite`, `offline_access`, `User.Read`.
- *OAuth flow.* Authorization-code + **PKCE**, initiated from `/api/oauth/[provider]/start`. The
  `code_verifier` and a random `state` go in `httpOnly`, `Secure`, `SameSite=Lax` cookies; the
  callback rejects any mismatch. Redirect URIs are exact-match HTTPS — a wall tablet on a LAN IP
  cannot be a redirect target, so connect flows happen on the deployed domain only.
- *Token storage.* Tokens live in `private.oauth_tokens`. The `private` schema is **not** added to
  Supabase's exposed schemas, so PostgREST cannot reach it with a household JWT at all; RLS is
  enabled with zero policies as belt-and-braces. Columns are `bytea`, AES-256-GCM encrypted with
  `TOKEN_ENC_KEY` held in the hosting platform's env (never in the DB, so a database dump alone is
  not enough). Only server route handlers using the service-role key decrypt them. **No provider
  token, and no service-role key, is ever sent to the browser** — every Google/Graph call is
  proxied through a route handler. Guard specifically against leaking them via server-component
  props: never `select *` from these tables in a component that serialises to the client.
- *Refresh handling.* Google returns a refresh token only with `access_type=offline&prompt=consent`,
  and — the trap — **while the OAuth consent screen is in "Testing", refresh tokens expire after 7
  days**. Publish the consent screen (or accept re-consenting weekly) before relying on unattended
  sync. Microsoft refresh tokens are a ~90-day sliding window, so a household that ignores the app
  for three months needs re-consent; both cases set `status = 'needs_reauth'` and raise
  `SyncStatusBadge` rather than failing silently. Refresh is single-flight per account (advisory
  lock) so a burst of parallel syncs cannot race and invalidate each other's rotated token.
- *Change detection.* Google: `events.list` with `syncToken`, plus push notifications via
  `events.watch` (channel lifetime is days, not months). Graph: `/me/calendars/{id}/events/delta`
  with the stored `deltaLink`, plus a change subscription (max ~4230 minutes ≈ 3 days). A cron
  renews any `calendars.watch_expires_at` inside 24h, and a 15-minute delta poll runs regardless —
  webhooks are an optimisation, never the only path.
- *Webhook trust.* Verify Google's `X-Goog-Channel-Token` and Graph's `clientState` against a stored
  secret, answer Graph's validation handshake, then **discard the payload** and re-fetch via delta.
  The webhook is a doorbell, not a data source.
- *Conflict resolution.* Push with optimistic concurrency: `If-Match: <provider_etag>`. On `412`,
  re-pull the remote row and compare `remote_updated_at` against `local_updated_at`:
  remote newer → remote wins, overwrite locally; local newer → set `sync_status = 'conflict'` and
  surface a two-column "keep phone version / keep Google version" prompt. Inbound pull is
  remote-precedence except where a row is `pending_push` (a local edit not yet delivered), which
  also becomes a `conflict`. Never auto-merge field-by-field; a half-merged event on a wall
  calendar is worse than a visible conflict.
- *Delivery durability.* Local writes commit to Postgres and enqueue `sync_outbox`; a cron drains
  it with exponential backoff on `next_attempt_at`, capped at 8 attempts. This is what makes the
  tablet's flaky wifi a non-event.

**Kiosk UX** — no-scroll: week and month grids are `h-[100dvh]` with `grid-rows-[auto_1fr]` and
internal `overflow-hidden`; overflowing days show "+3 more" rather than scrolling. Tap targets:
day cells are the tap target for add (no separate `+` button); event pills are minimum 44px tall in
week/day view. The kiosk defaults to week view at 7am and never opens a keyboard unprompted — the
`EventSheet` opens with the time wheel focused, not the title field.

### 2.3 Chore chart

**Schema** — `chores` → `chore_instances` → `points_ledger` ← `reward_redemptions` ← `rewards`,
plus the `member_points_cache` projection.

`chore_instances` **are** materialised (unlike calendar occurrences) because each carries state —
who ticked it, when, for how many points. A nightly job generates instances 14 days ahead from each
active chore's `rrule`; `unique (chore_id, due_on)` makes re-running it a no-op. `points_value` is
snapshotted onto the instance so raising a chore's value tomorrow never rewrites yesterday.

**`points_ledger` — append-only**

```sql
create table points_ledger (
  id                       bigserial primary key,
  household_id             uuid not null references households(id) on delete cascade,
  member_id                uuid not null references family_members(id) on delete restrict,
  direction                text not null check (direction in ('earn','redeem','adjust_up','adjust_down')),
  amount                   int  not null check (amount > 0),
  signed_amount            int generated always as
    (case when direction in ('earn','adjust_up') then amount else -amount end) stored,
  source_chore_instance_id uuid references chore_instances(id) on delete set null,
  source_redemption_id     uuid references reward_redemptions(id) on delete set null,
  note                     text,
  occurred_at              timestamptz not null default now()
);
```

`amount` is always positive and `direction` is explicit (per the audit requirement), while the
`generated` `signed_amount` column keeps balance queries a plain `sum()` — no `CASE` in every
caller, no chance of a sign convention drifting between two queries.

Append-only is enforced, not merely intended: the client has a `SELECT`-only policy, and all writes
go through `SECURITY DEFINER` RPCs. The enforcement extends one table further than is obvious —
`reward_redemptions` is **also** `SELECT`-only, because the balance check lives inside
`redeem_reward()`, so a client with a blanket write policy there could insert a redemption row and
take the reward without paying for it. Likewise `chore_instances` has `SELECT`/`INSERT`/`DELETE`
policies but deliberately **no `UPDATE` policy**, so a tick cannot be written directly in a way
that skips the matching ledger row; ad-hoc one-off instances can still be added and removed.

Mistakes and penalties are compensating `adjust_down` rows via `adjust_points()`, so "where did
those 20 points go" is always answerable. **Balances clamp at zero**, enforced in the RPCs rather
than by a CHECK, because the clamp must be computed against the live ledger sum: taking 10 points
from a member holding 4 logs an `adjust_down` of 4, not 10, and an `adjust_down` against a zero
balance logs nothing at all. The same clamp applies to un-ticking, so **un-ticking a chore whose
points were already spent reclaims nothing** — the honest consequence of clamping, and worth knowing
before someone reports it as a bug. That is also why un-ticking a chore is
`adjust_down` rather than a delete — and why idempotency lives in the `pending → done` status
transition inside `complete_chore_instance()` rather than a unique index on
`source_chore_instance_id`, since un-tick/re-tick must legitimately produce three rows.

**`rewards` / `reward_redemptions`** — household-configurable (`name`, `description`, `emoji`,
`point_cost`, `is_active`); deactivate rather than delete so past redemptions still resolve.
`reward_redemptions.point_cost_at_redemption` snapshots the price, and `status`
(`pending → fulfilled | cancelled`) tracks whether the extra screen time was actually granted, via
`fulfil_redemption()` and `cancel_redemption()`. Cancellation **refunds** with an `adjust_up` row
for the snapshotted cost — without that path the points silently vanish and the ledger stops
agreeing with what the family believes it has.

**Balance derivation** — the ledger is the source of truth; `member_points_cache` is a projection
maintained by an `AFTER INSERT` trigger. Two reasons the cache exists, one of which is not
performance:

1. **Supabase Realtime publishes table changes, not view changes.** A `v_member_balances` view
   cannot be subscribed to, so the kiosk leaderboard would have to listen to `points_ledger` inserts
   and re-derive. A real table gives every device the new balance in one payload.
2. Household volume is trivial (hundreds of rows a year), so `sum()` is fast — performance is a
   side benefit, not the justification.

Consistency is cheap precisely *because* the ledger is insert-only: the trigger only ever handles
`INSERT`, so there is no update/delete path to get wrong. Two safeguards regardless:
`reconcile_member_points()` recomputes the cache from the ledger (run weekly by cron and after any
manual DB work), and **authorisation never reads the cache** — `redeem_reward()` sums the ledger
under an advisory lock, so a drifted cache can display a wrong number but can never permit an
overdraw:

```sql
perform pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));
select coalesce(sum(signed_amount), 0) into v_balance
  from points_ledger where member_id = p_member_id;
if v_balance < v_cost then raise exception 'insufficient_points'; end if;
-- insert redemption + matching 'redeem' ledger row in the same transaction
```

**Leaderboard** — ranking by *period earnings* rather than balance, because balance drops on
redemption and a leaderboard that punishes spending points stops children spending them. The
`leaderboard(p_from, p_to)` function returns both columns so the UI can offer "This week" /
"This month" / "All time", ranks with `rank()` (ties share a position), converts the date bounds
using `households.timezone` so "this week" means the household's week, and left-joins the roster so
a member with zero points still appears.

**Components**

| Component | Notes |
| --- | --- |
| `ChoreBoard` | Member-column × day-row grid for the current week; the kiosk's default chore view. |
| `ChoreCheckbox` | 56px tap target, optimistic tick, `rpc('complete_chore_instance')`, haptic-free confetti burst on award. Rolls back visually if the RPC rejects. |
| `Leaderboard` | Reads `member_points_cache` + `rpc('leaderboard')` (returns `earned`, `balance`, `rank_position`), period toggle. |
| `RewardShelf` | Reward cards with cost and an affordability state derived from cached balance; redeem calls `rpc('redeem_reward')`, which re-checks against the ledger — the UI's affordability state is a hint, never the gate. |
| `RedemptionQueue` | Pending redemptions awaiting a parent's `fulfil_redemption()` / `cancel_redemption()`. |
| `LedgerDrawer` | Per-member reverse-chronological ledger — the visible payoff of the audit model, and how "that's not fair" arguments get settled. |
| `app/settings/chores`, `app/settings/rewards` | Chore + reward CRUD, recurrence builder over `rrule`. |

**Realtime** — subscribe to `chore_instances` (board ticks), `member_points_cache` (balances,
leaderboard) and `points_ledger` (drawer + "Ada earned 5 points" toast). A tick on a phone must
land on the wall tablet in under a second; that visible immediacy is most of why the chart works.

**Kiosk UX** — ticking is the single most-used interaction on the wall, so it must be one tap with
no confirmation dialog; undo lives in the row for 10 seconds (and is a real `adjust_down`, not a
suppressed write). Redemption *does* confirm, since it spends a balance.

### 2.4 Meal planner

**Schema** — `recipes`, `recipe_ingredients`, `meal_plan_entries`
(`unique (household_id, plan_date, slot)`, and a check that a slot has either a `recipe_id` or a
`custom_title` so "Takeaway" needs no recipe row). `recipe_ingredients` is normalised specifically
so the shopping list can be generated; `unit` stays free text and **no unit conversion is attempted
in v1** — the generator groups matching `(name, unit)` pairs and lists mismatched units as separate
lines, which is honest and predictable.

**Shopping-list generation** — a `generate_shopping_list(p_from, p_to, p_list_id)` RPC expands
ingredients from planned entries in the window into `list_items`, tagging each with
`source_meal_plan_entry_id`. The partial unique index
`(list_id, source_meal_plan_entry_id, lower(title))` makes re-running it idempotent, so "add this
week's meals to the shopping list" is safe to tap twice. Hand-added items are untouched. Removing a
meal does *not* retract items already in the list — someone may have bought them.

**Components** — `MealWeekGrid` (7 columns × slot rows, tap a cell to assign), `RecipePicker`
(recent + search), `RecipeSheet` (title, freeform notes, ingredient rows), `GenerateListButton`
(shows a diff preview: "adds 11 items, 3 already on the list").

**Realtime** — `meal_plan_entries` subscription; list items arrive via the list feature's channel.

**Kiosk UX** — the week grid is the whole screen with no scroll; slots the household doesn't use
(breakfast, snack) are hidden by a setting rather than rendered empty. Assigning a meal is
tap-cell → recent-recipes sheet, so the common case never reaches a keyboard.

### 2.5 To-do / shopping list

**Schema** — `lists` (`kind: shopping | todo`) + `list_items`. One table for both kinds: the
behaviour is identical (check, assign, order) and splitting them would duplicate the component tree
for a `kind` column's worth of difference. `position` is `numeric` so reordering writes one row
(midpoint between neighbours) instead of renumbering the list. `assigned_member_id` and
`done_by_member_id` are separate — who should get milk and who actually did are different facts,
and the second feeds "who's pulling their weight" without a second ledger.

**Components** — `ListView` (done items collapse to a "12 completed" footer rather than scrolling),
`QuickAddBar` (sticky, submit-and-stay-focused for rapid entry, splits a trailing quantity into
`quantity_text`), `ItemRow` (56px, swipe-to-delete on phones, long-press to assign).

**Realtime** — `list_items` filtered on `household_id`. Concurrent editing is the norm here (one
parent in the supermarket, one at home), so ticks are last-write-wins on `is_done` — acceptable
because the states are boolean and re-tickable. Optimistic updates reconcile against the Realtime
payload, keyed on `id`, which prevents the classic "item bounces back" flicker.

**Kiosk UX** — the wall tablet shows the shopping list read-mostly; `QuickAddBar` is present but
the on-screen keyboard covers half a wall tablet, so the kiosk layout pins the input to the top and
shifts the list rather than letting the keyboard overlap it.

### 2.6 Photo frame idle mode

**Flag before design:** a shared Google Photos album link cannot be a supported v1 source. Google
removed broad library-read scopes from the Photos Library API (March 2025); the replacement Picker
API only returns items a user explicitly selects, and scraping a public album URL is both fragile
and against Google's terms. **v1 sources uploads to Supabase Storage**, with the Picker API as a
post-v1 addition (`photo_sources.kind` already allows `google_photos_picker`) — the same
"add photos from your phone" outcome, one extra tap.

**Schema** — `photo_sources` (kind, label, is_active) and `photos` (`storage_path`, `caption`,
`width`/`height`, `taken_at`, `is_active`, `sort_order`). Files live in a **private** Storage bucket
`photos/{household_id}/…`; the kiosk gets signed URLs minted server-side in batches with a long TTL
and refreshed ahead of expiry — a private bucket means a leaked URL expires instead of exposing
family photos permanently.

**Components** — `IdleWatcher` (see below), `PhotoSlideshow` (double-buffered `<img>` with a CSS
cross-fade, preloads next-2, `Cache-Control: immutable` so a month-long slideshow doesn't re-download
the same 200 photos), `ClockOverlay` (time, date, next event, temperature — the frame stays useful
at a glance), `app/settings/photos` (multi-file upload, client-side downscale to ~2560px before
upload to keep a phone-camera album from filling the bucket).

**Idle detection** — one hook at the app root:

```ts
// pointerdown/keydown/visibilitychange reset a timer from household_settings.idle_timeout_seconds.
// Any interaction exits the slideshow to the previous route.
// requestAnimationFrame drives the fade so a backgrounded tab doesn't burn CPU.
```

Also request `navigator.wakeLock` on mount so the tablet's own screen timeout doesn't blank the
frame, and re-request it on `visibilitychange` (the lock is released when the page is hidden).

**Kiosk UX** — the slideshow is the *default* state, not a screensaver bolted on: a wall tablet
spends most of its life untouched, and the first tap should exit the frame and land on the calendar,
not merely dismiss an overlay. Interaction that exits idle mode must not also activate whatever was
under the finger — the exit tap is swallowed.

### 2.7 Weather widget

**Schema** — location on `household_settings` (`latitude`, `longitude`, `location_label`,
`weather_units`); readings in `weather_cache` (`payload jsonb`, `expires_at`), one row per
household.

**Integration notes** — recommend **Open-Meteo**: no API key, so there is no secret to leak to a
client component and no per-device quota problem. Fetch in a route handler
(`/api/weather`, `revalidate = 900`), write through to `weather_cache`, and serve from cache while
`expires_at > now()`. With three phones and a tablet all polling, the DB cache is what keeps this
one upstream request every 15 minutes instead of hundreds a day. On upstream failure, serve stale
cache with a `fetched_at` age indicator rather than an empty widget — a wall display showing
nothing reads as "app is broken".

**Components** — `WeatherWidget` (current temp, icon, high/low), `ForecastStrip` (next 3 days or
next 12 hours), both driven by `useWeather()` which reads the cache row and subscribes to
`weather_cache` so all devices flip to fresh data together.

**Kiosk UX** — legible from across the room: temperature at `text-6xl` minimum on the dashboard,
icons as inline SVG (no icon-font FOUT on a device that reloads rarely).

### 2.8 Auto dim / brightness

The wall device is Android running Fully Kiosk Browser, so this has two layers: real backlight
control on the tablet, and a CSS overlay everywhere else (phones, or any browser without the Fully
JS interface). No ambient-light sensor is involved either way.

**Primary — Fully Kiosk's injected JS interface.** Still web; nothing native to build:

```ts
// lib/kiosk/fully.ts — feature-detected, never assumed.
export const hasFully = () => typeof (globalThis as any).fully !== 'undefined';
// fully.setScreenBrightness(0..255) — actual backlight, not a dark layer over a lit panel.
// fully.setScreensaverEnabled / fully.startScreensaver — hand idle mode to the device.
```

Two things this buys that the overlay cannot: the panel genuinely draws less light (a dimmed white
background still glows grey in a hallway at night), and Fully restarts the app on boot, so a power
cut doesn't leave a blank wall tablet until someone notices.

**Schema** — `household_settings.dim_starts_at`, `dim_ends_at` (`time`), `dim_max_opacity`
(capped at 0.95 by a CHECK so the screen can never be dimmed to fully black and appear dead).

**Fallback — `<DimOverlay/>`**, also the phone path:

```tsx
// Mounted once in the kiosk layout; inert when hasFully() reports true.
<div
  aria-hidden
  className="pointer-events-none fixed inset-0 z-50 bg-black transition-opacity duration-[3000ms]"
  style={{ opacity }}
/>
```

`opacity` is computed from the household's local time against the dim window, ramped over ~20
minutes at each edge so the change is never a visible step. A tap temporarily lifts the overlay to
0 for 60 seconds (someone checking tomorrow's schedule at 11pm), then ramps back. Recompute on a
60-second interval **and** on `visibilitychange` — a tablet that slept through the boundary must not
wake up bright at 3am. `pointer-events-none` is load-bearing: the overlay must never eat taps.

**Kiosk UX** — pair dimming with `color-scheme` switching: the dashboard swaps to a dark, low-blue
palette inside the dim window rather than only darkening, because a dimmed white background still
glows grey in a hallway at night.

## Cross-cutting: Realtime, session and staleness

- **One channel per household.** `supabase.channel('household:' + id)` with several
  `postgres_changes` listeners filtered `household_id=eq.<id>`, mounted at the app root and routed
  into feature stores. Per-component channels would multiply subscriptions on a page that shows
  calendar + chores + weather at once.
- **Ephemeral cross-device state uses `broadcast`, not tables.** "Wake the kiosk", "jump the wall
  display to next week" are messages, not data — no rows, no cleanup.
- **Reconnect and drift.** A tablet open for six weeks will drop its socket. On
  `SUBSCRIBED`-after-reconnect, refetch the visible window (Realtime does not replay missed
  changes), and refetch on `visibilitychange` and every 15 minutes as a floor.
- **Post-deploy staleness.** The kiosk may run a build from three deploys ago. A tiny
  `/api/build-id` polled hourly and compared to the baked-in build id triggers `location.reload()`
  when idle — without it, a wall tablet silently runs stale JS against a migrated schema.
- **Session longevity.** `@supabase/ssr` with cookie storage so middleware can gate routes and the
  kiosk's refresh token rotates indefinitely as long as the app opens periodically.
- **Household credential on a wall.** One shared login means the tablet holds full household
  access, which is the accepted model — but the OAuth connect screens and member/reward settings
  are worth putting behind a 4-digit PIN gate (`sessionStorage`-scoped, not auth, not RBAC) so a
  visitor cannot revoke calendar access or invent a 500-point reward.

## 3. Project Structure

```
family-hub-calendar/
├─ app/
│  ├─ layout.tsx                     # MemberProvider, RealtimeProvider, DimOverlay, IdleWatcher
│  ├─ (household)/
│  │  ├─ display/page.tsx            # wall dashboard: calendar + chores + weather + meals
│  │  ├─ calendar/page.tsx
│  │  ├─ chores/page.tsx
│  │  ├─ rewards/page.tsx
│  │  ├─ meals/page.tsx
│  │  ├─ lists/[listId]/page.tsx
│  │  └─ frame/page.tsx              # slideshow, also the idle target
│  ├─ settings/
│  │  ├─ members/page.tsx
│  │  ├─ calendars/page.tsx          # connect Google / Outlook, pick calendars, sync status
│  │  ├─ chores/page.tsx
│  │  ├─ rewards/page.tsx
│  │  ├─ recipes/page.tsx
│  │  ├─ photos/page.tsx
│  │  └─ display/page.tsx            # location, units, idle timeout, dim window
│  ├─ login/page.tsx                 # the single household login. No signup, no per-member auth.
│  └─ api/
│     ├─ oauth/[provider]/start/route.ts
│     ├─ oauth/[provider]/callback/route.ts
│     ├─ webhooks/google-calendar/route.ts
│     ├─ webhooks/microsoft-calendar/route.ts
│     ├─ weather/route.ts
│     ├─ build-id/route.ts
│     └─ cron/
│        ├─ sync-calendars/route.ts     # delta pull + drain sync_outbox
│        ├─ renew-watches/route.ts      # channels/subscriptions expiring < 24h
│        ├─ generate-chore-instances/route.ts
│        └─ reconcile-points/route.ts
├─ components/
│  ├─ members/     MemberChip.tsx  MemberAvatar.tsx  MemberPicker.tsx
│  ├─ calendar/    CalendarShell.tsx  MonthGrid.tsx  WeekGrid.tsx  DayAgenda.tsx
│  │               EventSheet.tsx  SyncStatusBadge.tsx
│  ├─ chores/      ChoreBoard.tsx  ChoreCheckbox.tsx  Leaderboard.tsx
│  │               RewardShelf.tsx  LedgerDrawer.tsx
│  ├─ meals/       MealWeekGrid.tsx  RecipePicker.tsx  RecipeSheet.tsx  GenerateListButton.tsx
│  ├─ lists/       ListView.tsx  QuickAddBar.tsx  ItemRow.tsx
│  ├─ frame/       PhotoSlideshow.tsx  ClockOverlay.tsx
│  ├─ weather/     WeatherWidget.tsx  ForecastStrip.tsx
│  └─ kiosk/       DimOverlay.tsx  IdleWatcher.tsx  KioskFrame.tsx
├─ lib/
│  ├─ supabase/    client.ts  server.ts  service.ts  middleware.ts   # service.ts = server-only
│  ├─ realtime/    HouseholdChannelProvider.tsx  useTableSubscription.ts
│  ├─ calendar/    occurrences.ts  rrule.ts  conflict.ts
│  │               google/{auth,calendars,events,watch}.ts
│  │               microsoft/{auth,calendars,events,subscribe}.ts
│  ├─ crypto/      tokens.ts        # AES-256-GCM seal/open, server-only
│  ├─ points/      queries.ts       # rpc wrappers: complete, uncomplete, redeem, leaderboard
│  ├─ shopping/    generate.ts
│  ├─ kiosk/       fully.ts         # Fully Kiosk JS interface, feature-detected
│  └─ weather/     openmeteo.ts
├─ hooks/          useMembers.ts  useOccurrences.ts  useIdle.ts  useDimLevel.ts  useWeather.ts
├─ supabase/
│  ├─ migrations/  0001_init.sql …
│  └─ seed.sql                       # one household, four members, a few chores/rewards
├─ public/         manifest.webmanifest  icons/  sw.js
├─ types/          database.ts        # generated: supabase gen types typescript
├─ middleware.ts
└─ vercel.json                       # cron schedules
```

Server-only boundary: `lib/supabase/service.ts` and `lib/crypto/tokens.ts` start with
`import 'server-only'`, so importing them from a client component fails at build rather than
shipping the service-role key or the encryption key to a browser.

## 4. Build Order

1. **Foundation** — Next.js + Tailwind + `@supabase/ssr`, household login, `middleware.ts` route
   gate, `households` + `household_settings` + `current_household_id()` + the RLS policy pattern.
   Everything downstream depends on the scoping helper being right.
2. **Family members** — `family_members` CRUD, `MemberProvider`, `MemberChip`/`MemberPicker`,
   colour palette. Hard prerequisite: chores, events, lists and meals all FK to this, and no
   colour-coded UI can be built or judged before the roster exists.
3. **Realtime plumbing** — `HouseholdChannelProvider`, `useTableSubscription`, reconnect refetch.
   Built once now, on `family_members` as the guinea pig, rather than retrofitted per feature.
4. **Lists** — smallest full vertical slice (schema → RLS → optimistic write → Realtime →
   kiosk-sized rows). Proves the whole stack end-to-end in a day, and is immediately useful, which
   matters for getting the household onto the tablet early.
5. **Local calendar** — `events`, the three grid renderers, `useOccurrences` with
   `rrule` expansion, `EventSheet`. **No provider sync yet**: get the data model and rendering right
   against local rows, because debugging recurrence expansion and delta sync simultaneously is the
   single biggest schedule risk in this project.
6. **Chores + ledger** — `chores`, `chore_instances`, the instance-generation cron, `points_ledger`,
   the cache trigger, `complete_chore_instance`. Ship earning before spending.
7. **Rewards + leaderboard** — `rewards`, `reward_redemptions`, `redeem_reward` with the advisory
   lock, `RewardShelf`, `Leaderboard`, `LedgerDrawer`. Depends on 6 for a balance to spend.
8. **Kiosk shell** — `/display` dashboard, `KioskFrame`, `IdleWatcher`, `DimOverlay`, wake lock,
   PWA manifest + install on the tablet. Do this before the frame and weather so there is somewhere
   for them to live, and so the household starts using the wall device while sync is still landing.
9. **Weather** — `weather_cache`, `/api/weather`, widgets. Small, independent, high visible value
   per hour spent; deliberately placed before the sync slog.
10. **Photo frame** — Storage bucket, upload + downscale, signed-URL batching, `PhotoSlideshow`
    wired to the idle state from 8.
11. **Google Calendar sync** — OAuth + PKCE, token sealing, calendar selection, `syncToken` pull,
    push with `If-Match`, `sync_outbox` drain, `events.watch` + renewal cron, conflict UI. One
    provider all the way to green before the second.
12. **Outlook / Graph sync** — the same, reusing the provider-agnostic conflict and outbox layer
    that step 11 forced into existence. Cheaper second time by design.
13. **Meal planner** — `recipes`, `recipe_ingredients`, `meal_plan_entries`,
    `generate_shopping_list` writing into the lists from step 4.
14. **Hardening** — `reconcile_member_points` cron, `/api/build-id` staleness reload, settings PIN
    gate, `needs_reauth` surfacing, seed script, `supabase gen types` in CI.

Dependency-critical edges: 2 before 5/6/13 · 3 before 4 · 5 before 11 · 6 before 7 · 8 before 10 ·
4 before 13 · 11 before 12.

## 5. Decisions

### Settled with input (2026-09-10)

| Decision | Choice | Consequence |
| --- | --- | --- |
| Event attribution | Single `events.member_id`, `NULL` = everyone | `event_members` dropped. Multi-person events are duplicated or left unassigned; upgrade path is the backfill in §2.2. |
| Chore assignment | Fixed assignee per chore | No `chore_members` table. The instance generator copies `chores.member_id`; rotation can be added later without a schema change. |
| Point penalties | Clamp at zero | `adjust_points()` and `uncomplete_chore_instance()` compute the clamp against the live ledger sum. Un-ticking a chore whose points were already spent reclaims nothing. |
| Kiosk device | Android + Fully Kiosk Browser | §2.8 is Fully's brightness/screensaver API first, CSS overlay as the phone and no-Fully fallback. Fully's boot-restart also covers power cuts. |

### Defaulted — reversible, revisit at the relevant build step

| Decision | Default | Revisit at |
| --- | --- | --- |
| Hosting | Vercel + managed Supabase free tier. Not self-hosted on Home Assistant: HA restarts monthly and would take the family calendar down with it, and you'd own Postgres backups for no saving. | Step 1 |
| Cron split | `pg_cron` for pure-DB jobs (chore instance generation, points reconciliation) so they survive a paused hosting project; Vercel Cron for provider sync and watch renewal, which need secrets and a Node runtime. | Step 6, 11 |
| Leaderboard ranking | Period-earned, not balance. `leaderboard()` returns both columns, so this is a UI default rather than a commitment. | Step 7 |
| Weather provider | Open-Meteo, keyless — no secret to leak to a client component, no per-device quota. Not HA's `weather.*` entity, which would need inbound access to your HA box from Vercel. | Step 9 |
| Google Photos | Uploads to Supabase Storage only. The album-link route is closed (Google removed broad library-read scopes in March 2025); the Picker API is a post-v1 addition and `photo_sources.kind` already allows it. | Step 10 |
| Timezone handling | Single `households.timezone`. `events.event_timezone` is stored but not surfaced in the UI. | Step 5 |
| Offline depth | A "reconnecting…" banner. No service-worker data caching in v1. | Step 14 |
| Household count | One. The `households` table supports more at no extra cost, so a second household needs no migration. | — |

### Still genuinely open

- Do you want the settings PIN gate from the cross-cutting section (protecting OAuth connect and reward config from a visitor tapping the wall tablet), or is that unnecessary friction in your house?
- Which meal slots does your household actually use? Hiding breakfast and snack changes the §2.4 grid from 4 rows to 1, which materially changes the kiosk layout.
- What's the Fully Kiosk licence situation — the free version shows a nag and lacks some JS interface calls, so is the ~€10 one-off Plus licence in scope?
