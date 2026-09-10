-- Family Hub Calendar — v1 consolidated schema
-- One auth user per household. Family members are rows (family_members), never auth users.
-- Every domain table carries household_id so one RLS policy shape covers the whole app.

create extension if not exists pgcrypto;

-- Provider tokens live here. This schema is NOT added to Supabase's exposed schemas,
-- so PostgREST cannot reach it with an anon/authenticated JWT at all.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- ---------------------------------------------------------------- core

create table households (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  timezone      text not null default 'Europe/London',
  created_at    timestamptz not null default now()
);
create unique index households_owner_key on households (owner_user_id);

-- Index-friendly, single source of scoping for every RLS policy below.
create or replace function current_household_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from households where owner_user_id = auth.uid() limit 1;
$$;

create table household_settings (
  household_id               uuid primary key references households(id) on delete cascade,
  location_label             text,
  latitude                   numeric(8,5),
  longitude                  numeric(8,5),
  weather_units              text not null default 'metric' check (weather_units in ('metric','imperial')),
  week_starts_on             smallint not null default 1 check (week_starts_on between 0 and 6),
  idle_timeout_seconds       int not null default 180,
  slideshow_interval_seconds int not null default 12,
  dim_starts_at              time,
  dim_ends_at                time,
  dim_max_opacity            numeric(3,2) not null default 0.75 check (dim_max_opacity between 0 and 0.95),
  updated_at                 timestamptz not null default now()
);

create table family_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  display_name text not null,
  color        text not null check (color ~* '^#[0-9a-f]{6}$'),
  avatar_url   text,          -- Supabase Storage path, nullable
  avatar_emoji text,          -- fallback when no photo
  sort_order   int not null default 0,
  is_active    boolean not null default true,   -- soft-retire; never delete, FKs point here
  created_at   timestamptz not null default now()
);
create unique index family_members_name_key on family_members (household_id, lower(display_name));
create index family_members_roster on family_members (household_id, is_active, sort_order);

-- ---------------------------------------------------------------- calendar

create table calendar_accounts (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  provider        text not null check (provider in ('google','microsoft')),
  account_email   text not null,
  granted_scopes  text[] not null default '{}',
  status          text not null default 'active' check (status in ('active','needs_reauth','revoked')),
  last_sync_at    timestamptz,
  last_sync_error text,
  created_at      timestamptz not null default now(),
  unique (household_id, provider, account_email)
);

create table private.oauth_tokens (
  calendar_account_id     uuid primary key references public.calendar_accounts(id) on delete cascade,
  access_token_enc        bytea not null,   -- AES-256-GCM, key from TOKEN_ENC_KEY (never in DB)
  refresh_token_enc       bytea not null,
  access_token_expires_at timestamptz not null,
  updated_at              timestamptz not null default now()
);
alter table private.oauth_tokens enable row level security;  -- zero policies => only service_role reads

create table calendars (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references households(id) on delete cascade,
  calendar_account_id uuid not null references calendar_accounts(id) on delete cascade,
  provider_calendar_id text not null,
  name                text not null,
  is_selected         boolean not null default false,
  sync_direction      text not null default 'two_way' check (sync_direction in ('pull_only','two_way')),
  default_member_id   uuid references family_members(id) on delete set null,
  sync_token          text,          -- Google syncToken / Graph deltaLink
  watch_channel_id    text,
  watch_resource_id   text,
  watch_expires_at    timestamptz,
  unique (calendar_account_id, provider_calendar_id)
);

create table events (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid not null references households(id) on delete cascade,
  calendar_id               uuid references calendars(id) on delete set null,  -- null => local-only event
  title                     text not null,
  description               text,
  location                  text,
  starts_at                 timestamptz not null,
  ends_at                   timestamptz not null,
  all_day                   boolean not null default false,
  event_timezone            text,
  rrule                     text,     -- recurring master; occurrences expanded client-side
  recurrence_parent_id      uuid references events(id) on delete cascade,
  recurrence_original_start timestamptz,   -- set on exception rows
  is_cancelled              boolean not null default false,
  provider_event_id         text,
  provider_etag             text,     -- Google etag / Graph changeKey, for If-Match on push
  remote_updated_at         timestamptz,
  local_updated_at          timestamptz not null default now(),
  sync_status               text not null default 'local_only'
    check (sync_status in ('local_only','synced','pending_push','pending_delete','conflict')),
  created_at                timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create unique index events_provider_key
  on events (calendar_id, provider_event_id, coalesce(recurrence_original_start, 'epoch'::timestamptz))
  where provider_event_id is not null;
create index events_window on events (household_id, starts_at, ends_at) where is_cancelled = false;

create table event_members (
  event_id   uuid not null references events(id) on delete cascade,
  member_id  uuid not null references family_members(id) on delete cascade,
  is_primary boolean not null default false,   -- drives the colour bar in the grid
  primary key (event_id, member_id)
);
create unique index event_members_one_primary on event_members (event_id) where is_primary;

-- Durable push queue: a wall tablet that loses wifi mid-edit must not lose the push.
create table sync_outbox (
  id              bigserial primary key,
  household_id    uuid not null references households(id) on delete cascade,
  event_id        uuid references events(id) on delete cascade,
  op              text not null check (op in ('create','update','delete')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now()
);
create index sync_outbox_due on sync_outbox (next_attempt_at) where attempts < 8;

-- ---------------------------------------------------------------- chores & points

create table chores (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title        text not null,
  notes        text,
  member_id    uuid references family_members(id) on delete set null,  -- null => anyone
  points_value int not null default 0 check (points_value >= 0),
  rrule        text,          -- null => one-off
  starts_on    date not null default current_date,
  ends_on      date,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table chore_instances (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references households(id) on delete cascade,
  chore_id               uuid not null references chores(id) on delete cascade,
  member_id              uuid references family_members(id) on delete set null,
  due_on                 date not null,
  points_value           int not null,     -- snapshot: editing a chore never rewrites history
  status                 text not null default 'pending' check (status in ('pending','done','skipped')),
  completed_at           timestamptz,
  completed_by_member_id uuid references family_members(id) on delete set null,
  unique (chore_id, due_on)                -- makes instance generation idempotent
);
create index chore_instances_board on chore_instances (household_id, due_on, status);

create table rewards (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  description  text,
  emoji        text,
  point_cost   int not null check (point_cost > 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table reward_redemptions (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references households(id) on delete cascade,
  reward_id                uuid not null references rewards(id) on delete restrict,
  member_id                uuid not null references family_members(id) on delete restrict,
  point_cost_at_redemption int not null check (point_cost_at_redemption > 0),
  status                   text not null default 'pending' check (status in ('pending','fulfilled','cancelled')),
  redeemed_at              timestamptz not null default now(),
  fulfilled_at             timestamptz
);

-- Append-only. Corrections are new rows (adjust_up/adjust_down), never UPDATEs.
create table points_ledger (
  id                       bigserial primary key,
  household_id             uuid not null references households(id) on delete cascade,
  member_id                uuid not null references family_members(id) on delete restrict,
  direction                text not null check (direction in ('earn','redeem','adjust_up','adjust_down')),
  amount                   int not null check (amount > 0),
  signed_amount            int generated always as
    (case when direction in ('earn','adjust_up') then amount else -amount end) stored,
  source_chore_instance_id uuid references chore_instances(id) on delete set null,
  source_redemption_id     uuid references reward_redemptions(id) on delete set null,
  note                     text,
  occurred_at              timestamptz not null default now()
);
create index points_ledger_member_time on points_ledger (member_id, occurred_at desc);
create index points_ledger_earned on points_ledger (household_id, occurred_at) where direction = 'earn';

-- Display/Realtime projection only. NEVER read for authorisation (see redeem_reward).
create table member_points_cache (
  member_id       uuid primary key references family_members(id) on delete cascade,
  household_id    uuid not null references households(id) on delete cascade,
  balance         int not null default 0,
  lifetime_earned int not null default 0,
  updated_at      timestamptz not null default now()
);

create or replace function apply_ledger_to_cache() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into member_points_cache (member_id, household_id, balance, lifetime_earned, updated_at)
  values (new.member_id, new.household_id, new.signed_amount,
          case when new.direction = 'earn' then new.amount else 0 end, now())
  on conflict (member_id) do update
     set balance         = member_points_cache.balance + new.signed_amount,
         lifetime_earned = member_points_cache.lifetime_earned
                           + case when new.direction = 'earn' then new.amount else 0 end,
         updated_at      = now();
  return new;
end $$;

create trigger points_ledger_to_cache after insert on points_ledger
  for each row execute function apply_ledger_to_cache();

create or replace function reconcile_member_points(p_household uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into member_points_cache (member_id, household_id, balance, lifetime_earned, updated_at)
  select m.id, m.household_id,
         coalesce(sum(l.signed_amount), 0)::int,
         coalesce(sum(case when l.direction = 'earn' then l.amount else 0 end), 0)::int,
         now()
    from family_members m
    left join points_ledger l on l.member_id = m.id
   where p_household is null or m.household_id = p_household
   group by m.id, m.household_id
  on conflict (member_id) do update
     set balance = excluded.balance,
         lifetime_earned = excluded.lifetime_earned,
         updated_at = now();
$$;

-- Ticking a chore. Idempotency comes from the status transition, not a unique index,
-- because un-tick then re-tick must be representable as two further ledger rows.
create or replace function complete_chore_instance(p_instance_id uuid, p_by_member_id uuid default null)
returns chore_instances language plpgsql security definer set search_path = public as $$
declare v_row chore_instances;
begin
  update chore_instances
     set status = 'done', completed_at = now(),
         completed_by_member_id = coalesce(p_by_member_id, member_id)
   where id = p_instance_id
     and household_id = current_household_id()
     and status <> 'done'
  returning * into v_row;

  if v_row.id is null then                             -- already done, or not ours
    select * into v_row from chore_instances
     where id = p_instance_id and household_id = current_household_id();
    return v_row;
  end if;

  if v_row.points_value > 0 and v_row.member_id is not null then
    insert into points_ledger (household_id, member_id, direction, amount,
                               source_chore_instance_id, note)
    values (v_row.household_id, v_row.member_id, 'earn', v_row.points_value,
            v_row.id, (select title from chores where id = v_row.chore_id));
  end if;
  return v_row;
end $$;

create or replace function uncomplete_chore_instance(p_instance_id uuid)
returns chore_instances language plpgsql security definer set search_path = public as $$
declare v_row chore_instances;
begin
  update chore_instances
     set status = 'pending', completed_at = null, completed_by_member_id = null
   where id = p_instance_id and household_id = current_household_id() and status = 'done'
  returning * into v_row;
  if v_row.id is null then return null; end if;

  if v_row.points_value > 0 and v_row.member_id is not null then
    insert into points_ledger (household_id, member_id, direction, amount,
                               source_chore_instance_id, note)
    values (v_row.household_id, v_row.member_id, 'adjust_down', v_row.points_value,
            v_row.id, 'Un-ticked');
  end if;
  return v_row;
end $$;

-- Balance is read from the ledger, not the cache, and the member row is serialised so
-- two phones tapping "redeem" at once cannot overdraw.
create or replace function redeem_reward(p_member_id uuid, p_reward_id uuid)
returns reward_redemptions language plpgsql security definer set search_path = public as $$
declare
  v_household  uuid := current_household_id();
  v_cost       int;
  v_name       text;
  v_balance    int;
  v_redemption reward_redemptions;
begin
  select point_cost, name into v_cost, v_name
    from rewards
   where id = p_reward_id and household_id = v_household and is_active;
  if v_cost is null then raise exception 'reward_not_available' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));

  select coalesce(sum(signed_amount), 0) into v_balance
    from points_ledger where member_id = p_member_id;
  if v_balance < v_cost then
    raise exception 'insufficient_points: have %, need %', v_balance, v_cost using errcode = 'P0002';
  end if;

  insert into reward_redemptions (household_id, reward_id, member_id, point_cost_at_redemption)
  values (v_household, p_reward_id, p_member_id, v_cost)
  returning * into v_redemption;

  insert into points_ledger (household_id, member_id, direction, amount, source_redemption_id, note)
  values (v_household, p_member_id, 'redeem', v_cost, v_redemption.id, 'Redeemed: ' || v_name);

  return v_redemption;
end $$;

create or replace function fulfil_redemption(p_redemption_id uuid)
returns reward_redemptions language plpgsql security definer set search_path = public as $$
declare v_row reward_redemptions;
begin
  update reward_redemptions
     set status = 'fulfilled', fulfilled_at = now()
   where id = p_redemption_id and household_id = current_household_id() and status = 'pending'
  returning * into v_row;
  return v_row;
end $$;

-- Cancelling a redemption must refund, or the points vanish and the ledger stops
-- reconciling against what the family believes it has.
create or replace function cancel_redemption(p_redemption_id uuid)
returns reward_redemptions language plpgsql security definer set search_path = public as $$
declare v_row reward_redemptions;
begin
  update reward_redemptions
     set status = 'cancelled'
   where id = p_redemption_id and household_id = current_household_id() and status = 'pending'
  returning * into v_row;
  if v_row.id is null then return null; end if;

  insert into points_ledger (household_id, member_id, direction, amount, source_redemption_id, note)
  values (v_row.household_id, v_row.member_id, 'adjust_up', v_row.point_cost_at_redemption,
          v_row.id, 'Refund: cancelled redemption');
  return v_row;
end $$;

create or replace function leaderboard(p_from date, p_to date)
returns table (member_id uuid, display_name text, color text,
               earned int, balance int, rank_position int)
language sql stable set search_path = public as $$
  with tz as (select timezone from households where id = current_household_id())
  select m.id, m.display_name, m.color,
         coalesce(e.earned, 0)::int,
         coalesce(c.balance, 0)::int,
         rank() over (order by coalesce(e.earned, 0) desc, m.display_name)::int
    from family_members m
    left join (
      select l.member_id, sum(l.amount)::int as earned
        from points_ledger l, tz
       where l.direction = 'earn'
         and l.occurred_at >= (p_from::timestamp at time zone tz.timezone)
         and l.occurred_at <  ((p_to + 1)::timestamp at time zone tz.timezone)
       group by l.member_id
    ) e on e.member_id = m.id
    left join member_points_cache c on c.member_id = m.id
   where m.household_id = current_household_id() and m.is_active
   order by 6, 2;
$$;

-- ---------------------------------------------------------------- meals

create table recipes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title        text not null,
  notes        text,                -- freeform method; no structured steps in v1
  source_url   text,
  servings     int,
  created_at   timestamptz not null default now()
);

create table recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references recipes(id) on delete cascade,
  name       text not null,
  quantity   numeric(10,2),
  unit       text,                  -- free text; no unit conversion in v1
  aisle      text,                  -- groups the generated shopping list
  sort_order int not null default 0
);

create table meal_plan_entries (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  plan_date     date not null,
  slot          text not null check (slot in ('breakfast','lunch','dinner','snack')),
  recipe_id     uuid references recipes(id) on delete set null,
  custom_title  text,               -- "Leftovers", "Takeaway" — no recipe needed
  notes         text,
  cook_member_id uuid references family_members(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (household_id, plan_date, slot),
  check (recipe_id is not null or custom_title is not null)
);

-- ---------------------------------------------------------------- lists

create table lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  kind         text not null check (kind in ('shopping','todo')),
  is_archived  boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create table list_items (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references households(id) on delete cascade,
  list_id                  uuid not null references lists(id) on delete cascade,
  title                    text not null,
  quantity_text            text,          -- "2 tins", kept as text for quick-add parity
  aisle                    text,
  is_done                  boolean not null default false,
  done_at                  timestamptz,
  done_by_member_id        uuid references family_members(id) on delete set null,
  assigned_member_id       uuid references family_members(id) on delete set null,
  source_meal_plan_entry_id uuid references meal_plan_entries(id) on delete set null,
  position                 numeric not null default 1000,   -- fractional index for reorder
  created_at               timestamptz not null default now()
);
create index list_items_board on list_items (list_id, is_done, position);
create unique index list_items_generated_key
  on list_items (list_id, source_meal_plan_entry_id, lower(title))
  where source_meal_plan_entry_id is not null;   -- re-running generation is a no-op

-- ---------------------------------------------------------------- photo frame

create table photo_sources (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  kind         text not null check (kind in ('upload','google_photos_picker')),
  label        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table photos (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  source_id    uuid references photo_sources(id) on delete set null,
  storage_path text not null,        -- object key in the private 'photos' bucket
  caption      text,
  width        int,
  height       int,
  taken_at     timestamptz,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index photos_slideshow on photos (household_id, is_active, sort_order);

-- ---------------------------------------------------------------- weather

create table weather_cache (
  household_id uuid primary key references households(id) on delete cascade,
  provider     text not null,
  payload      jsonb not null,
  fetched_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

-- ---------------------------------------------------------------- RLS

do $$
declare t text;
begin
  foreach t in array array[
    'households','household_settings','family_members','calendar_accounts','calendars',
    'events','event_members','sync_outbox','chores','chore_instances','rewards',
    'reward_redemptions','points_ledger','member_points_cache','recipes','recipe_ingredients',
    'meal_plan_entries','lists','list_items','photo_sources','photos','weather_cache'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- households / settings key off the auth user directly.
create policy household_rw on households for all to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy settings_rw on household_settings for all to authenticated
  using (household_id = current_household_id()) with check (household_id = current_household_id());

-- Every household_id-scoped table gets the same policy shape.
do $$
declare t text;
begin
  foreach t in array array[
    'family_members','calendar_accounts','calendars','events','chores',
    'rewards','recipes','meal_plan_entries','lists','list_items',
    'photo_sources','photos'
  ] loop
    execute format($f$
      create policy %1$s_rw on %1$I for all to authenticated
        using (household_id = current_household_id())
        with check (household_id = current_household_id())
    $f$, t);
  end loop;
end $$;

-- Children reached through their parent.
create policy event_members_rw on event_members for all to authenticated
  using (exists (select 1 from events e
                  where e.id = event_id and e.household_id = current_household_id()))
  with check (exists (select 1 from events e
                  where e.id = event_id and e.household_id = current_household_id()));
create policy recipe_ingredients_rw on recipe_ingredients for all to authenticated
  using (exists (select 1 from recipes r
                  where r.id = recipe_id and r.household_id = current_household_id()))
  with check (exists (select 1 from recipes r
                  where r.id = recipe_id and r.household_id = current_household_id()));

-- chore_instances: the client may add/remove ad-hoc instances but must NOT UPDATE them —
-- status changes go through complete_/uncomplete_chore_instance so a tick always writes a
-- matching ledger row.
create policy chore_instances_read on chore_instances for select to authenticated
  using (household_id = current_household_id());
create policy chore_instances_insert on chore_instances for insert to authenticated
  with check (household_id = current_household_id());
create policy chore_instances_delete on chore_instances for delete to authenticated
  using (household_id = current_household_id());

-- reward_redemptions: SELECT only. A direct INSERT here would grant a reward without
-- paying for it, since the balance check lives in redeem_reward().
create policy reward_redemptions_read on reward_redemptions for select to authenticated
  using (household_id = current_household_id());

-- Read-only from the client: written by triggers, RPCs and server routes only.
create policy ledger_read on points_ledger for select to authenticated
  using (household_id = current_household_id());
create policy points_cache_read on member_points_cache for select to authenticated
  using (household_id = current_household_id());
create policy weather_read on weather_cache for select to authenticated
  using (household_id = current_household_id());
-- sync_outbox: no policies at all — service_role only.

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table
  family_members, events, event_members, chore_instances, points_ledger,
  member_points_cache, meal_plan_entries, list_items, photos, weather_cache;

-- DELETE payloads only carry the primary key unless replica identity is full; the client
-- filters on household_id, so the tables it subscribes to need it.
alter table events            replica identity full;
alter table event_members     replica identity full;
alter table chore_instances   replica identity full;
alter table list_items        replica identity full;
alter table meal_plan_entries replica identity full;
