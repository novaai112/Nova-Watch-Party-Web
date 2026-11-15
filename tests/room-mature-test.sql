-- Hide Mature Content: server rules.
--   psql -f tests/mock-supabase.sql -f rooms-schema.sql -f mature-gate-schema.sql -f tests/room-mature-test.sql
\set ON_ERROR_STOP on
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(c,false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  - %', msg; end $$;
create or replace function t_err(sql text, pat text) returns void language plpgsql as $$
begin execute sql; raise exception 'FAIL: expected error /%/ from %', pat, sql;
exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm !~* pat then raise exception 'FAIL: wrong error "%" (wanted /%/)', sqlerrm, pat; end if; raise notice 'ok  - error: %', sqlerrm; end $$;
create or replace function t_sees(u uuid, rid uuid) returns boolean language plpgsql as $$
begin perform t_as(u); return exists(select 1 from jsonb_array_elements(list_rooms(10, 10)) e where (e->>'id')::uuid = rid); end $$;

truncate public.rooms cascade; truncate public.friendships; delete from public.profiles;
-- A: verified 18+, Hide Mature OFF.  B: default (setting never saved).  C: verified but Hide Mature ON.  D: says OFF but NOT verified.  E: second adult viewer.
insert into public.profiles(id, full_name, username, settings, maturity_verified) values
 ('00000000-0000-0000-0000-00000000000a','A','a','{"hideMature":false}', true),
 ('00000000-0000-0000-0000-00000000000b','B','b', null, false),
 ('00000000-0000-0000-0000-00000000000c','C','c','{"hideMature":true}', true),
 ('00000000-0000-0000-0000-00000000000d','D','d','{"hideMature":false}', false),
 ('00000000-0000-0000-0000-00000000000e','E','e','{"hideMature":false}', true);
insert into auth.users(id) select id from public.profiles on conflict do nothing;
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
\set D '''00000000-0000-0000-0000-00000000000d'''
\set E '''00000000-0000-0000-0000-00000000000e'''
insert into public.friendships(user_id, friend_id, status) values (:A, :B, 'accepted'), (:A, :C, 'accepted'), (:A, :D, 'accepted'), (:A, :E, 'accepted');

-- ---- who counts as "hides mature" ----
select t_ok(not _viewer_hides_mature(:A), 'A (verified, setting OFF) does not hide');
select t_ok(_viewer_hides_mature(:B), 'B (default) hides');
select t_ok(_viewer_hides_mature(:C), 'C (verified, setting ON) hides');
select t_ok(_viewer_hides_mature(:D), 'D (setting OFF but not verified) still hides');

-- ---- what counts as an adult video ----
select t_ok(_media_is_nsfw('{"kind":"video","title":"x","url":"https://a.test/v.mp4","nsfw":true}'), 'saved 18+ flag');
select t_ok(_media_is_nsfw('{"kind":"video","title":"Clip","url":"https://www.pornhub.com/view_video.php?viewkey=1"}'), 'adult site link');
select t_ok(_media_is_nsfw('{"kind":"video","title":"Clip","url":"https://x.test/p?u=https%3A%2F%2Fxvideos.com%2Fv1"}'), 'adult site hidden inside a proxy link');
select t_ok(_media_is_nsfw('{"kind":"video","title":"Desi XXX full video","url":"https://clips.example/x"}'), 'explicit title');
select t_ok(_media_is_nsfw('{"kind":"video","title":"clip","url":"https://clips.example/free-porn-video"}'), 'explicit word in the address');
select t_ok(not _media_is_nsfw('{"kind":"video","title":"Sex Education Season 3 Official Trailer","url":"https://media.test/a.mp4"}'), 'Sex Education is fine');
select t_ok(not _media_is_nsfw('{"kind":"video","title":"XXXTENTACION - SAD!","url":"https://media.test/b.mp4"}'), 'XXXTENTACION is fine');
select t_ok(not _media_is_nsfw('{"kind":"youtube","id":"dQw4w9WgXcQ","title":"Rick Astley - Never Gonna Give You Up"}'), 'normal YouTube video is fine');
select t_ok(not _media_is_nsfw('{"kind":"video","title":"Essex Sussex Scunthorpe","url":"https://media.test/essex.mp4"}'), 'Essex / Sussex are fine');
select t_ok(not _media_is_nsfw(null), 'no media is fine');

-- ---- creating ----
select t_as(:B);
select t_err($q$ select create_room('x','public','{"kind":"video","title":"Desi XXX full video","url":"https://clips.example/x"}'::jsonb) $q$, 'Hide Mature|18\+|mature');
select t_as(:A);
select create_room('adult room','public','{"kind":"video","title":"Late night","url":"https://clips.example/y","nsfw":true}'::jsonb) is not null as x \gset
select id as rid, code from public.rooms where admin_id = :A limit 1 \gset
select leave_room(:'rid');                                     -- A steps out, the room closes when empty -> reopen by creating again
select create_room('adult room','public','{"kind":"video","title":"Late night","url":"https://clips.example/y","nsfw":true}'::jsonb) is not null as x \gset
select id as rid, code from public.rooms where status = 'open' and admin_id = :A limit 1 \gset

-- ---- listing: Public ----
select t_ok(t_sees(:A, :'rid'), 'A (adult viewer) sees the adult room');
select t_ok(t_sees(:E, :'rid'), 'E (adult viewer) sees the adult room');
select t_ok(not t_sees(:B, :'rid'), 'B does not see it (Public)');
select t_ok(not t_sees(:C, :'rid'), 'C does not see it (Public)');
select t_ok(not t_sees(:D, :'rid'), 'D does not see it (Public)');

-- ---- joining by link / code ----
select t_as(:B); select t_err(format($q$ select join_room(%L) $q$, :'code'), 'mature|18\+');
select t_as(:C); select t_err(format($q$ select join_room(%L) $q$, :'code'), 'mature|18\+');
select t_as(:D); select t_err(format($q$ select join_room(%L) $q$, :'code'), 'mature|18\+');
select t_ok((select count(*) from room_members where room_id = :'rid') = 1, 'nobody who hides mature content got in');
select t_as(:E); select join_room(:'code') is not null as j \gset
select t_ok((select count(*) from room_members where room_id = :'rid') = 2, 'E (adult viewer) joins by link');
select leave_room(:'rid');

-- ---- Friends only / Invite only / Nearby: still blocked even when the privacy mode would let them in ----
select t_as(:A); select room_update(:'rid', p_privacy => 'friends') is not null as x \gset
select t_ok(not t_sees(:B, :'rid'), 'B does not see it (Friends only, B is the host''s friend)');
select t_as(:B); select t_err(format($q$ select join_room(%L) $q$, :'code'), 'mature|18\+');
select t_ok(t_sees(:E, :'rid'), 'E sees it (Friends only)');

select t_as(:A); select room_update(:'rid', p_privacy => 'invite') is not null as x \gset
select room_invite(:'rid', array[:B::uuid, :C::uuid, :D::uuid]) = 0 as none \gset
select t_ok(:'none', 'invite skips everyone who hides mature content');
insert into room_invites(room_id, user_id, invited_by) values (:'rid', :B, :A) on conflict do nothing;      -- even a stale / forced invite row
select t_ok(not t_sees(:B, :'rid'), 'B does not see it (Invited)');
select t_ok(not exists(select 1 from jsonb_array_elements((select list_rooms(10,10))) e where (e->>'invited')::boolean and (e->>'id')::uuid = :'rid'), 'not in the Invited list');
select t_as(:B); select t_err(format($q$ select join_room(%L) $q$, :'code'), 'mature|18\+');
select t_as(:A); select room_invite(:'rid', array[:E::uuid]) = 1 as one \gset
select t_ok(:'one', 'invite still works for an adult viewer');

select t_as(:A); select room_update(:'rid', p_privacy => 'nearby', p_lat => 10, p_lng => 10) is not null as x \gset
select t_ok(not t_sees(:B, :'rid'), 'B does not see it (Nearby, B is right here)');
select t_as(:B); select t_err(format($q$ select join_room(%L, 10, 10) $q$, :'code'), 'mature|18\+');
select t_ok(t_sees(:E, :'rid'), 'E sees it (Nearby)');
select t_as(:A); select room_update(:'rid', p_privacy => 'public') is not null as x \gset

-- ---- picking an adult video ----
select t_as(:A); select create_room('clean','public','{"kind":"youtube","id":"dQw4w9WgXcQ","title":"Rick Astley - Never Gonna Give You Up"}'::jsonb) is not null as x \gset
select id as rid2, code as code2 from public.rooms where status = 'open' and title = 'clean' \gset
select t_ok(t_sees(:B, :'rid2'), 'B sees the clean room');
select t_as(:B); select join_room(:'code2') is not null as j \gset
select t_ok((select count(*) from room_members where room_id = :'rid2') = 2, 'A and B are in the clean room');
select t_err(format($q$ select room_pick(%L, '{"kind":"video","title":"Desi XXX full video","url":"https://clips.example/x"}'::jsonb, true) $q$, :'rid2'), 'mature|Mature');
select t_as(:A);
select room_pick(:'rid2', '{"kind":"video","title":"Late night","url":"https://clips.example/y","nsfw":true}'::jsonb, true) is not null as x \gset
select t_ok(not exists(select 1 from room_members where room_id = :'rid2' and user_id = :B), 'B was taken out when the adult video started');
select t_ok(exists(select 1 from room_members where room_id = :'rid2' and user_id = :A), 'A (adult viewer) stays');
select t_ok(not t_sees(:B, :'rid2'), 'B no longer sees that room');
select t_as(:B); select t_err(format($q$ select join_room(%L) $q$, :'code2'), 'mature|18\+');
-- the room goes back to a clean video: B can come in again
select t_as(:A); select room_pick(:'rid2', '{"kind":"youtube","id":"9bZkp7q19f0","title":"PSY - GANGNAM STYLE"}'::jsonb, true) is not null as x \gset
select t_as(:B); select join_room(:'code2') is not null as j \gset
select t_ok(exists(select 1 from room_members where room_id = :'rid2' and user_id = :B), 'clean video again: B can join');

-- ---- the admin marks the playing video as 18+ after the deep check ----
select t_as(:B); select t_err(format($q$ select room_flag_nsfw(%L) $q$, :'rid2'), 'admin');
select t_as(:A); select room_flag_nsfw(:'rid2') as f \gset
select t_ok(:'f', 'admin can flag the video');
select t_ok((select media->>'nsfw' from rooms where id = :'rid2') = 'true', 'flag stored on the room');
select t_ok(not exists(select 1 from room_members where room_id = :'rid2' and user_id = :B), 'B taken out after the flag');
select t_as(:B); select t_err(format($q$ select join_room(%L) $q$, :'code2'), 'mature|18\+');

-- ---- turning Hide Mature ON while inside an adult room ----
select t_as(:E); select join_room(:'code2') is not null as j \gset
select t_ok(exists(select 1 from room_members where room_id = :'rid2' and user_id = :E), 'E is in the adult room');
update public.profiles set settings = '{"hideMature":true}' where id = :E;
select t_ok(not exists(select 1 from room_members where room_id = :'rid2' and user_id = :E), 'E turned Hide Mature ON -> out of the adult room at once');
select t_ok(not t_sees(:E, :'rid2'), 'and the room disappears from E''s home');
update public.profiles set settings = '{"hideMature":false}' where id = :E;
select t_ok(t_sees(:E, :'rid2'), 'turning it OFF again brings it back');
select t_as(:E); select join_room(:'code2') is not null as j \gset
select t_ok(exists(select 1 from room_members where room_id = :'rid2' and user_id = :E), 'and E can enter again');

-- ---- losing the 18+ verification counts the same ----
update public.profiles set maturity_verified = false where id = :E;
select t_ok(not exists(select 1 from room_members where room_id = :'rid2' and user_id = :E), 'verification removed -> out of the adult room');
update public.profiles set maturity_verified = true where id = :E;

-- ---- the profile "watching now" card ----
select t_as(:A); select join_room(:'code2') is not null as j \gset
select t_as(:B); select t_ok(public_room_for_user(:A) is null, 'B does not get the adult room on A''s profile');
select t_as(:E); select t_ok(public_room_for_user(:A) is not null, 'E does');

\echo ALL MATURE-GATE TESTS PASSED
