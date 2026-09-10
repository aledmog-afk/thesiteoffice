-- Local/dev seed. Run AFTER creating the household auth user, and set the id
-- below to that user's uuid (Supabase Studio → Authentication → Users).
--
--   psql "$DATABASE_URL" -v uid="'<auth-user-uuid>'" -f supabase/seed.sql

\if :{?uid}
\else
  \echo 'Pass the auth user id:  -v uid="''<uuid>''"'
  \quit 1
\endif

insert into households (owner_user_id, name, timezone)
values (:uid, 'Our Home', 'Europe/London')
on conflict (owner_user_id) do nothing;

insert into household_settings (household_id)
select id from households where owner_user_id = :uid
on conflict (household_id) do nothing;

insert into family_members (household_id, display_name, color, avatar_emoji, sort_order)
select h.id, m.display_name, m.color, m.emoji, m.sort_order
  from households h,
       (values ('Alex',  '#0284c7', '🐧', 0),
               ('Sam',   '#059669', '🦊', 1),
               ('Ada',   '#c026d3', '🦄', 2),
               ('Bo',    '#f59e0b', '🐢', 3))
         as m(display_name, color, emoji, sort_order)
 where h.owner_user_id = :uid
on conflict do nothing;

-- A couple of chores and a reward so the ledger has something to chew on at
-- build-order step 6.
insert into chores (household_id, title, member_id, points_value, rrule)
select h.id, 'Take the bins out', fm.id, 5, 'FREQ=WEEKLY;BYDAY=TU'
  from households h
  join family_members fm on fm.household_id = h.id and fm.display_name = 'Ada'
 where h.owner_user_id = :uid
on conflict do nothing;

insert into rewards (household_id, name, point_cost, emoji)
select h.id, '30 min extra screen time', 20, '📺'
  from households h where h.owner_user_id = :uid
on conflict do nothing;
