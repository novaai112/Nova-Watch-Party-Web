-- Nova: Hide Mature Content, the parts that sit on top of rooms-schema.sql.
-- Run once in the Supabase SQL editor AFTER schema.sql and rooms-schema.sql (safe to run again).
--
--  1. room_flag_nsfw(room)  - the ROOM ADMIN's browser ran the deep check (YouTube age limit, page rating, picture check) on the
--     video and found it adult: the room is marked 18+ for everybody.  Only the admin may do it and it can only ever turn the
--     mark ON for the video that is playing now, so nobody can hide somebody else's clean room.  Members who hide mature
--     content leave at once.
--  2. a trigger on profiles: when someone turns Hide Mature Content ON (or loses their 18+ verification) they are taken out of
--     any room that is playing an adult video, wherever they are in the app.

create or replace function public.room_flag_nsfw(p_room uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into r from public.rooms where id = p_room and status = 'open' for update;
  if r.id is null or r.media is null then return false; end if;
  if r.admin_id <> uid then raise exception 'Only the room admin can mark the video'; end if;
  if coalesce(r.media ->> 'nsfw', '') <> 'true' then
    update public.rooms set media = media || '{"nsfw":true}'::jsonb where id = p_room;
  end if;
  perform public._room_drop_mature(p_room);
  return true;
end $$;
revoke all on function public.room_flag_nsfw(uuid) from public, anon;
grant execute on function public.room_flag_nsfw(uuid) to authenticated;

create or replace function public._profiles_drop_mature_rooms() returns trigger
language plpgsql security definer set search_path = public as $$
declare x uuid;
begin
  if public._viewer_hides_mature(new.id) then
    for x in select m.room_id from public.room_members m join public.rooms r on r.id = m.room_id
             where m.user_id = new.id and r.status = 'open' and public._media_is_nsfw(r.media) loop
      perform public._room_drop_member(x, new.id, 'left');
    end loop;
  end if;
  return null;
end $$;
revoke all on function public._profiles_drop_mature_rooms() from public, anon, authenticated;

drop trigger if exists profiles_drop_mature_rooms on public.profiles;
create trigger profiles_drop_mature_rooms after update of settings, maturity_verified on public.profiles
  for each row when (old.settings is distinct from new.settings or old.maturity_verified is distinct from new.maturity_verified)
  execute function public._profiles_drop_mature_rooms();
