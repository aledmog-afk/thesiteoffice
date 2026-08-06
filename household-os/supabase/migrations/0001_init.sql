-- Household OS — Phase 1 schema (auth/households/members, calendar, tasks/routines, shopping)
-- Multi-tenant: every domain table carries household_id and is scoped by RLS.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user, created automatically on signup.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create policy "profiles: self read" on public.profiles
  for select using (id = auth.uid());

create policy "profiles: self update" on public.profiles
  for update using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Households & members
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'adult', 'child')),
  display_name text not null,
  color text not null default '#6366f1',
  points integer not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create index household_members_household_idx on public.household_members (household_id);
create index household_members_user_idx on public.household_members (user_id);

-- Security-definer helpers to avoid recursive RLS lookups on household_members.
create function public.is_household_member(hh uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hh and user_id = auth.uid()
  );
$$;

create function public.household_role(hh uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select role from public.household_members
  where household_id = hh and user_id = auth.uid()
  limit 1;
$$;

create function public.member_id_for(hh uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select id from public.household_members
  where household_id = hh and user_id = auth.uid()
  limit 1;
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy "households: members can read" on public.households
  for select using (public.is_household_member(id));

create policy "households: owner can update" on public.households
  for update using (public.household_role(id) = 'owner');

create policy "households: authenticated can create" on public.households
  for insert with check (created_by = auth.uid());

create policy "household_members: members can read roster" on public.household_members
  for select using (public.is_household_member(household_id));

create policy "household_members: owner manages members" on public.household_members
  for all using (public.household_role(household_id) = 'owner')
  with check (public.household_role(household_id) = 'owner');

create policy "household_members: self insert on household create" on public.household_members
  for insert with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null,
  role text not null check (role in ('adult', 'child')),
  token uuid not null default gen_random_uuid(),
  invited_by uuid not null references auth.users (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

create unique index invites_token_idx on public.invites (token);
create index invites_household_idx on public.invites (household_id);

alter table public.invites enable row level security;

create policy "invites: owner manages" on public.invites
  for all using (public.household_role(household_id) = 'owner')
  with check (public.household_role(household_id) = 'owner');

-- Invitees look up/accept their invite by token through the security-definer
-- RPCs below, so no public select policy is needed here.

-- ---------------------------------------------------------------------------
-- RPCs: atomic household creation + invite lookup/accept
-- ---------------------------------------------------------------------------
create function public.create_household(p_name text, p_display_name text)
returns public.households
language plpgsql
security definer set search_path = public
as $$
declare
  hh public.households;
begin
  insert into public.households (name, created_by)
  values (p_name, auth.uid())
  returning * into hh;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (hh.id, auth.uid(), 'owner', p_display_name);

  insert into public.shopping_lists (household_id) values (hh.id);
  insert into public.calendar_feed_tokens (household_id) values (hh.id);

  return hh;
end;
$$;

create function public.get_invite_by_token(p_token uuid)
returns table (
  id uuid,
  household_id uuid,
  household_name text,
  email text,
  role text,
  status text,
  expires_at timestamptz
)
language sql
stable
security definer set search_path = public
as $$
  select i.id, i.household_id, h.name, i.email, i.role, i.status, i.expires_at
  from public.invites i
  join public.households h on h.id = i.household_id
  where i.token = p_token;
$$;

create function public.accept_invite(p_token uuid)
returns public.household_members
language plpgsql
security definer set search_path = public
as $$
declare
  inv public.invites;
  mem public.household_members;
  user_email text;
begin
  select * into inv from public.invites where token = p_token for update;

  if inv is null then
    raise exception 'Invite not found';
  end if;
  if inv.status <> 'pending' then
    raise exception 'Invite already used';
  end if;
  if inv.expires_at < now() then
    raise exception 'Invite expired';
  end if;

  select email into user_email from auth.users where id = auth.uid();
  if user_email is distinct from inv.email then
    raise exception 'This invite was sent to a different email address';
  end if;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, auth.uid(), inv.role, split_part(user_email, '@', 1))
  on conflict (household_id, user_id) do update set role = excluded.role
  returning * into mem;

  update public.invites set status = 'accepted' where id = inv.id;

  return mem;
end;
$$;

-- ---------------------------------------------------------------------------
-- Properties (minimal stub for onboarding + billing gate; expanded in Phase 2)
-- ---------------------------------------------------------------------------
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create index properties_household_idx on public.properties (household_id);

alter table public.properties enable row level security;

create policy "properties: members read" on public.properties
  for select using (public.is_household_member(household_id));

create policy "properties: adults manage" on public.properties
  for all using (public.household_role(household_id) in ('owner', 'adult'))
  with check (public.household_role(household_id) in ('owner', 'adult'));

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  notes text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  color text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_events_household_idx on public.calendar_events (household_id, starts_at);

create table public.calendar_event_assignees (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  member_id uuid not null references public.household_members (id) on delete cascade,
  primary key (event_id, member_id)
);

alter table public.calendar_events enable row level security;
alter table public.calendar_event_assignees enable row level security;

create policy "calendar_events: members read" on public.calendar_events
  for select using (public.is_household_member(household_id));

create policy "calendar_events: members write" on public.calendar_events
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "calendar_event_assignees: members read" on public.calendar_event_assignees
  for select using (
    exists (
      select 1 from public.calendar_events e
      where e.id = event_id and public.is_household_member(e.household_id)
    )
  );

create policy "calendar_event_assignees: members write" on public.calendar_event_assignees
  for all using (
    exists (
      select 1 from public.calendar_events e
      where e.id = event_id and public.is_household_member(e.household_id)
    )
  )
  with check (
    exists (
      select 1 from public.calendar_events e
      where e.id = event_id and public.is_household_member(e.household_id)
    )
  );

-- Household calendar ICS export token (one per household, regenerable).
create table public.calendar_feed_tokens (
  household_id uuid primary key references public.households (id) on delete cascade,
  token uuid not null default gen_random_uuid()
);

alter table public.calendar_feed_tokens enable row level security;

create policy "calendar_feed_tokens: owner/adult manage" on public.calendar_feed_tokens
  for all using (public.household_role(household_id) in ('owner', 'adult'))
  with check (public.household_role(household_id) in ('owner', 'adult'));

-- ---------------------------------------------------------------------------
-- Tasks & recurring routines
-- ---------------------------------------------------------------------------
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  notes text,
  recurrence_rule jsonb not null,
  recurrence_text text not null,
  rotation_member_ids uuid[] not null default '{}',
  rotation_index integer not null default 0,
  points integer not null default 5,
  active boolean not null default true,
  next_due_date date not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index routines_household_idx on public.routines (household_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  routine_id uuid references public.routines (id) on delete set null,
  title text not null,
  notes text,
  assignee_member_id uuid references public.household_members (id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'pending_approval', 'done')),
  points integer not null default 0,
  created_by uuid not null references auth.users (id),
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_household_idx on public.tasks (household_id, due_date);
create index tasks_assignee_idx on public.tasks (assignee_member_id);

alter table public.routines enable row level security;
alter table public.tasks enable row level security;

create policy "routines: members read" on public.routines
  for select using (public.is_household_member(household_id));

create policy "routines: adults manage" on public.routines
  for all using (public.household_role(household_id) in ('owner', 'adult'))
  with check (public.household_role(household_id) in ('owner', 'adult'));

-- Adults/owners see every task; children only see tasks assigned to them.
create policy "tasks: adults read all" on public.tasks
  for select using (
    public.household_role(household_id) in ('owner', 'adult')
  );

create policy "tasks: children read own" on public.tasks
  for select using (
    public.household_role(household_id) = 'child'
    and assignee_member_id = public.member_id_for(household_id)
  );

create policy "tasks: adults manage all" on public.tasks
  for all using (public.household_role(household_id) in ('owner', 'adult'))
  with check (public.household_role(household_id) in ('owner', 'adult'));

-- Children may update (mark complete) only their own open tasks; they cannot
-- self-approve, which is enforced in application code (status becomes
-- 'pending_approval', not 'done', on a child's own update).
create policy "tasks: children update own" on public.tasks
  for update using (
    public.household_role(household_id) = 'child'
    and assignee_member_id = public.member_id_for(household_id)
  )
  with check (
    public.household_role(household_id) = 'child'
    and assignee_member_id = public.member_id_for(household_id)
  );

-- ---------------------------------------------------------------------------
-- Shopping lists, items, recipes
-- ---------------------------------------------------------------------------
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null default 'Shopping List',
  created_at timestamptz not null default now()
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  notes text,
  source_url text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  name text not null,
  quantity text,
  aisle text,
  position integer not null default 0
);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  quantity text,
  aisle text not null default 'Other',
  checked boolean not null default false,
  checked_by uuid references auth.users (id),
  checked_at timestamptz,
  recipe_id uuid references public.recipes (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index shopping_items_list_idx on public.shopping_items (list_id);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);

alter table public.shopping_lists enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.shopping_items enable row level security;

create policy "shopping_lists: members read/write" on public.shopping_lists
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "recipes: members read/write" on public.recipes
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "recipe_ingredients: members read/write" on public.recipe_ingredients
  for all using (
    exists (select 1 from public.recipes r where r.id = recipe_id and public.is_household_member(r.household_id))
  )
  with check (
    exists (select 1 from public.recipes r where r.id = recipe_id and public.is_household_member(r.household_id))
  );

create policy "shopping_items: members read/write" on public.shopping_items
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Household notes broadcast feed (lightweight, module 6)
-- ---------------------------------------------------------------------------
create table public.household_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.household_notes enable row level security;

create policy "household_notes: members read/write" on public.household_notes
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.shopping_items;
alter publication supabase_realtime add table public.shopping_lists;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.household_notes;
