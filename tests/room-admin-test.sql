\set ON_ERROR_STOP on
-- Admin priority / transfer rules.  Run: psql -f tests/mock-supabase.sql -f rooms-schema.sql -f tests/room-admin-test.sql
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(c,false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  - %', msg; end $$;
create or replace function t_err(sql text, pat text) returns void language plpgsql as $$
begin execute sql; raise exception 'FAIL: expected error /%/ from %', pat, sql;
exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm !~* pat then raise exception 'FAIL: wrong error "%" (wanted /%/)', sqlerrm, pat; end if; raise notice 'ok  - error: %', sqlerrm; end $$;
truncate public.rooms cascade; delete from public.profiles;
insert into public.profiles(id, full_name, username) select u, n, n from (values
 ('00000000-0000-0000-0000-00000000000a'::uuid,'A'),('00000000-0000-0000-0000-00000000000b'::uuid,'B'),
 ('00000000-0000-0000-0000-00000000000c'::uuid,'C'),('00000000-0000-0000-0000-00000000000d'::uuid,'D')) v(u,n);
insert into auth.users(id) select id from public.profiles on conflict do nothing;
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
\set D '''00000000-0000-0000-0000-00000000000d'''
-- helpers run as the table owner
create or replace function adm(rid uuid) returns uuid language sql as $$ select admin_id from public.rooms where id = rid $$;
create or replace function backdate(rid uuid, u uuid, mins int) returns void language sql as $$
  update public.room_roster set first_joined_at = now() - make_interval(mins => mins) where room_id = rid and user_id = u;
  update public.room_members set joined_at = now() - make_interval(mins => mins) where room_id = rid and user_id = u $$;

-- A creates, B C D join (join times forced apart: A oldest, then B, C, D)
select t_as(:A); select create_room('t','public') is null as x \gset
select id as rid, code from public.rooms limit 1 \gset
select t_as(:B); select join_room(:'code') is null as x \gset
select t_as(:C); select join_room(:'code') is null as x \gset
select t_as(:D); select join_room(:'code') is null as x \gset
select backdate(:'rid', :A, 40), backdate(:'rid', :B, 30), backdate(:'rid', :C, 20), backdate(:'rid', :D, 10) \gset
select t_ok((select creator_id from rooms where id=:'rid') = :A and adm(:'rid') = :A, 'creator is admin at creation');
select t_ok((select array_agg(user_id order by joined_at) from room_members where room_id=:'rid') = array[:A,:B,:C,:D]::uuid[], 'members listed in original joining order');

-- 1. creator leaves while admin -> earliest joiner (B) gets it; creator returns -> restored even if it changed hands
select t_as(:A); select leave_room(:'rid');
select t_ok(adm(:'rid') = :B, 'creator left: admin goes to earliest joined member (B)');
select t_as(:B); select room_transfer(:'rid', :D);
select t_ok(adm(:'rid') = :D, 'B manually passes admin to D meanwhile');
select t_as(:A); select join_room(:'code') is null as x \gset
select t_ok(adm(:'rid') = :A, 'creator rejoins: admin restored even though it was handed on');
select t_ok((select joined_at from room_members where room_id=:'rid' and user_id=:A) < now() - interval '30 minutes', 'creator keeps ORIGINAL join time after rejoining');
select t_ok((select array_agg(user_id order by joined_at) from room_members where room_id=:'rid') = array[:A,:B,:C,:D]::uuid[], 'list order unchanged after creator rejoined');

-- 2. creator hands admin over ON PURPOSE -> leaving + rejoining does NOT restore it
select t_as(:A); select room_transfer(:'rid', :C);
select t_ok(adm(:'rid') = :C and (select creator_released from rooms where id=:'rid'), 'manual transfer recorded (creator_released)');
select leave_room(:'rid');
select t_as(:A); select join_room(:'code') is null as x \gset
select t_ok(adm(:'rid') = :C, 'creator rejoined after manual transfer: NOT restored');
-- ... until the current admin manually gives it back
select t_as(:C); select room_transfer(:'rid', :A);
select t_ok(adm(:'rid') = :A and not (select creator_released from rooms where id=:'rid'), 'admin handed it back manually: creator is admin and flag cleared');

-- 3. automatic transfer follows ORIGINAL joining order, also for a member who left and rejoined
select t_as(:B); select leave_room(:'rid');
select t_as(:B); select join_room(:'code') is null as x \gset
select t_ok((select joined_at from room_members where room_id=:'rid' and user_id=:B) < now() - interval '20 minutes', 'rejoining member keeps original join time');
select t_as(:A); select leave_room(:'rid');
select t_ok(adm(:'rid') = :B, 'B left+rejoined but still outranks C and D (original order)');
select t_as(:B); select leave_room(:'rid');
select t_ok(adm(:'rid') = :C, 'next in original order: C');
-- creator regains it on rejoin (it was never released on purpose)
select t_as(:A); select join_room(:'code') is null as x \gset
select t_ok(adm(:'rid') = :A, 'creator regains admin after two automatic hand-overs');

-- 4. non-creator admin leaves without transferring -> creator (highest priority) gets it again if present
select t_as(:A); select room_transfer(:'rid', :C);
select t_as(:C); select leave_room(:'rid');
select t_ok(adm(:'rid') = :A, 'admin C left: present creator A is first in line again');
select t_ok(not (select creator_released from rooms where id=:'rid'), 'creator holding admin clears released flag');

-- 5. the creator cannot be kicked; transfer log keeps every change
select t_as(:D); select t_err($$select room_kick('$$||:'rid'||$$','$$||:A||$$')$$, 'only the room admin');
select t_as(:A); select t_ok(adm(:'rid') = :A, 'still admin');
select t_ok((select count(*) from room_admin_log where room_id=:'rid' and kind='created') = 1
        and (select count(*) from room_admin_log where room_id=:'rid' and kind='manual') >= 4
        and (select count(*) from room_admin_log where room_id=:'rid' and kind='auto') >= 3
        and (select count(*) from room_admin_log where room_id=:'rid' and kind='restore') >= 2, 'every change logged: created / manual / auto / restore');
-- empty room closes; roster survives until the room is deleted
select t_ok((select count(*) from room_roster where room_id=:'rid') = 4, 'roster keeps all 4 members');
\echo ALL ROOM ADMIN TESTS PASSED
