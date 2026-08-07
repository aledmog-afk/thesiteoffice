-- Fitness Tracker schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Tables are prefixed `fitness_` because this schema may be deployed
-- alongside other apps in a shared Supabase project.

create extension if not exists "pgcrypto";

create type fitness_meal_category as enum ('Breakfast', 'Lunch', 'Dinner', 'Snack');

create table public.fitness_profiles (
    id uuid references auth.users(id) on delete cascade primary key,
    display_name text,
    daily_calorie_goal integer default 2500,
    daily_protein_goal integer default 150,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.fitness_exercises (
    id uuid default gen_random_uuid() primary key,
    name text not null,
    target_muscle_group text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.fitness_workouts (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references public.fitness_profiles(id) on delete cascade not null,
    name text not null,
    started_at timestamp with time zone default timezone('utc'::text, now()) not null,
    completed_at timestamp with time zone,
    notes text
);

create table public.fitness_workout_sets (
    id uuid default gen_random_uuid() primary key,
    workout_id uuid references public.fitness_workouts(id) on delete cascade not null,
    exercise_id uuid references public.fitness_exercises(id) on delete cascade not null,
    set_number integer not null,
    weight_kg numeric,
    reps integer,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.fitness_food_entries (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references public.fitness_profiles(id) on delete cascade not null,
    food_name text not null,
    category fitness_meal_category not null,
    calories integer not null,
    protein_g numeric default 0,
    carbs_g numeric default 0,
    fat_g numeric default 0,
    consumed_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Indexes for the app's common access patterns (per-user, date-ranged lookups).
create index fitness_workouts_user_id_started_at_idx on public.fitness_workouts (user_id, started_at desc);
create index fitness_workout_sets_workout_id_idx on public.fitness_workout_sets (workout_id);
create index fitness_food_entries_user_id_consumed_at_idx on public.fitness_food_entries (user_id, consumed_at desc);

-- Auto-create a profile row whenever a new auth user signs up.
create function public.fitness_handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.fitness_profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_fitness_auth_user_created
  after insert on auth.users
  for each row execute function public.fitness_handle_new_user();

-- Row Level Security: every table is scoped to its owning user.
alter table public.fitness_profiles enable row level security;
alter table public.fitness_exercises enable row level security;
alter table public.fitness_workouts enable row level security;
alter table public.fitness_workout_sets enable row level security;
alter table public.fitness_food_entries enable row level security;

create policy "Fitness profiles are viewable by owner" on public.fitness_profiles
  for select using (auth.uid() = id);
create policy "Fitness profiles are editable by owner" on public.fitness_profiles
  for update using (auth.uid() = id);

-- Exercises are a shared read-only reference list; only accessible to authenticated users.
create policy "Fitness exercises are viewable by authenticated users" on public.fitness_exercises
  for select using (auth.role() = 'authenticated');

create policy "Fitness workouts are viewable by owner" on public.fitness_workouts
  for select using (auth.uid() = user_id);
create policy "Fitness workouts are insertable by owner" on public.fitness_workouts
  for insert with check (auth.uid() = user_id);
create policy "Fitness workouts are updatable by owner" on public.fitness_workouts
  for update using (auth.uid() = user_id);
create policy "Fitness workouts are deletable by owner" on public.fitness_workouts
  for delete using (auth.uid() = user_id);

create policy "Fitness workout sets are viewable by owner" on public.fitness_workout_sets
  for select using (
    exists (select 1 from public.fitness_workouts w where w.id = workout_id and w.user_id = auth.uid())
  );
create policy "Fitness workout sets are insertable by owner" on public.fitness_workout_sets
  for insert with check (
    exists (select 1 from public.fitness_workouts w where w.id = workout_id and w.user_id = auth.uid())
  );
create policy "Fitness workout sets are updatable by owner" on public.fitness_workout_sets
  for update using (
    exists (select 1 from public.fitness_workouts w where w.id = workout_id and w.user_id = auth.uid())
  );
create policy "Fitness workout sets are deletable by owner" on public.fitness_workout_sets
  for delete using (
    exists (select 1 from public.fitness_workouts w where w.id = workout_id and w.user_id = auth.uid())
  );

create policy "Fitness food entries are viewable by owner" on public.fitness_food_entries
  for select using (auth.uid() = user_id);
create policy "Fitness food entries are insertable by owner" on public.fitness_food_entries
  for insert with check (auth.uid() = user_id);
create policy "Fitness food entries are updatable by owner" on public.fitness_food_entries
  for update using (auth.uid() = user_id);
create policy "Fitness food entries are deletable by owner" on public.fitness_food_entries
  for delete using (auth.uid() = user_id);

-- A starter set of common exercises so the workout logger isn't empty on first use.
insert into public.fitness_exercises (name, target_muscle_group) values
  ('Barbell Back Squat', 'Legs'),
  ('Bench Press', 'Chest'),
  ('Deadlift', 'Back'),
  ('Overhead Press', 'Shoulders'),
  ('Pull-Up', 'Back'),
  ('Barbell Row', 'Back'),
  ('Dumbbell Curl', 'Arms'),
  ('Tricep Pushdown', 'Arms'),
  ('Leg Press', 'Legs'),
  ('Plank', 'Core');
