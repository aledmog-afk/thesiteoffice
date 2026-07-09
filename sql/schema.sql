-- Site Tracker schema
-- Run this once in your Supabase project's SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: uses "if not exists" / "on conflict do nothing" throughout.

create extension if not exists "pgcrypto";

-- ─── PROJECTS (sites) ─────────────────────────────────────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  contract_ref text,
  main_contractor_name text,
  main_contractor_email text,
  start_date date,
  status text not null default 'active' check (status in ('active', 'complete', 'on hold')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ─── WEEKLY REPORTS ───────────────────────────────────────────────
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  week_starting date not null,
  week_ending date not null,
  prepared_by text,
  weather text,
  labour_on_site text,
  progress_summary text,
  programme_status text not null default 'on-track' check (programme_status in ('ahead', 'on-track', 'behind')),
  health_safety_notes text,
  deliveries_materials text,
  issues_risks text,
  next_week_plan text,
  photos jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ─── SNAG ITEMS ───────────────────────────────────────────────────
create table if not exists public.snag_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_no integer,
  location text,
  description text not null,
  trade text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'closed')),
  photo_url text,
  raised_date date not null default current_date,
  closed_date date,
  raised_by text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Auto-number snag items per project (1, 2, 3... within each site)
create or replace function public.set_snag_item_no()
returns trigger as $$
begin
  if new.item_no is null then
    select coalesce(max(item_no), 0) + 1 into new.item_no
    from public.snag_items
    where project_id = new.project_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_snag_item_no on public.snag_items;
create trigger trg_snag_item_no
before insert on public.snag_items
for each row execute function public.set_snag_item_no();

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────
-- Any signed-in user of your Supabase project can read/write everything.
-- This app is meant for a small internal team (the client-side staff), not
-- the public, so a single shared workspace with no per-row ownership is
-- the simplest model. Only create logins for people on your team.

alter table public.projects enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.snag_items enable row level security;

drop policy if exists "authenticated read projects" on public.projects;
create policy "authenticated read projects" on public.projects for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert projects" on public.projects;
create policy "authenticated insert projects" on public.projects for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update projects" on public.projects;
create policy "authenticated update projects" on public.projects for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete projects" on public.projects;
create policy "authenticated delete projects" on public.projects for delete using (auth.role() = 'authenticated');

drop policy if exists "authenticated read weekly_reports" on public.weekly_reports;
create policy "authenticated read weekly_reports" on public.weekly_reports for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert weekly_reports" on public.weekly_reports;
create policy "authenticated insert weekly_reports" on public.weekly_reports for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update weekly_reports" on public.weekly_reports;
create policy "authenticated update weekly_reports" on public.weekly_reports for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete weekly_reports" on public.weekly_reports;
create policy "authenticated delete weekly_reports" on public.weekly_reports for delete using (auth.role() = 'authenticated');

drop policy if exists "authenticated read snag_items" on public.snag_items;
create policy "authenticated read snag_items" on public.snag_items for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert snag_items" on public.snag_items;
create policy "authenticated insert snag_items" on public.snag_items for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update snag_items" on public.snag_items;
create policy "authenticated update snag_items" on public.snag_items for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete snag_items" on public.snag_items;
create policy "authenticated delete snag_items" on public.snag_items for delete using (auth.role() = 'authenticated');

-- ─── STORAGE (photos for reports & snags) ────────────────────────
insert into storage.buckets (id, name, public)
values ('site-photos', 'site-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read site-photos" on storage.objects;
create policy "public read site-photos" on storage.objects
  for select using (bucket_id = 'site-photos');

drop policy if exists "authenticated upload site-photos" on storage.objects;
create policy "authenticated upload site-photos" on storage.objects
  for insert with check (bucket_id = 'site-photos' and auth.role() = 'authenticated');

drop policy if exists "authenticated delete site-photos" on storage.objects;
create policy "authenticated delete site-photos" on storage.objects
  for delete using (bucket_id = 'site-photos' and auth.role() = 'authenticated');
