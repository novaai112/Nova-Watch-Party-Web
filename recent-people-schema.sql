-- Nova: "Recent" people (everyone you shared a watch room with).  Safe to re-run.
-- Rooms are deleted an hour after they close, so the history is kept in its own small table.
-- Every time someone first joins a room, or re-joins it, a row is written for each pair
-- (you -> them, them -> you) with the room's title and the time.
-- Run rooms-schema.sql first, then this file once in the Supabase SQL editor.

create table if not exists public.recent_people (
  user_id       uuid not null references auth.users(id) on delete cascade,
  other_id      uuid not null references auth.users(id) on delete cascade,
  room_title    text,
  last_together timestamptz not null default now(),
  times         int not null default 1,
  primary key (user_id, other_id),
  check (user_id <> other_id)
);
create index if not exists recent_people_user_idx on public.recent_people (user_id, last_together desc);

alter table public.recent_people enable row level security;
drop policy if exists recent_people_own_select on public.recent_people;
create policy recent_people_own_select on public.recent_people for select to authenticated using (user_id = auth.uid());
drop policy if exists recent_people_own_delete on public.recent_people;
create policy recent_people_own_delete on public.recent_people for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.recent_people from public, anon, authenticated;

create or replace function public._recent_touch() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text; first_time boolean := (tg_table_name = 'room_roster');
begin
  select title into t from public.rooms where id = new.room_id;
  -- you -> everyone who has ever joined this room
  insert into public.recent_people(user_id, other_id, room_title, last_together, times)
    select new.user_id, r.user_id, t, now(), 1 from public.room_roster r
    where r.room_id = new.room_id and r.user_id <> new.user_id
  on conflict (user_id, other_id) do update
    set room_title = excluded.room_title, last_together = now(),
        times = public.recent_people.times + (case when first_time then 1 else 0 end);
  -- everyone -> you
  insert into public.recent_people(user_id, other_id, room_title, last_together, times)
    select r.user_id, new.user_id, t, now(), 1 from public.room_roster r
    where r.room_id = new.room_id and r.user_id <> new.user_id
  on conflict (user_id, other_id) do update
    set room_title = excluded.room_title, last_together = now(),
        times = public.recent_people.times + (case when first_time then 1 else 0 end);
  return new;
end $$;

drop trigger if exists room_roster_recent on public.room_roster;
create trigger room_roster_recent after insert on public.room_roster
  for each row execute function public._recent_touch();
drop trigger if exists room_members_recent on public.room_members;
create trigger room_members_recent after insert on public.room_members
  for each row execute function public._recent_touch();

-- one-time fill from rooms that exist right now
insert into public.recent_people(user_id, other_id, room_title, last_together, times)
  select a.user_id, b.user_id, max(r.title), max(greatest(a.first_joined_at, b.first_joined_at)), count(*)::int
  from public.room_roster a
  join public.room_roster b on b.room_id = a.room_id and b.user_id <> a.user_id
  join public.rooms r on r.id = a.room_id
  group by a.user_id, b.user_id
on conflict (user_id, other_id) do nothing;

notify pgrst, 'reload schema';
