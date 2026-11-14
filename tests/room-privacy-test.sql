-- Room privacy rules. Run like rooms-playback-test.sql (psql against a DB with mock-supabase.sql + rooms-schema.sql loaded).
\set ON_ERROR_STOP on
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(c,false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  - %', msg; end $$;
create or replace function t_err(sql text, pat text) returns void language plpgsql as $$
begin execute sql; raise exception 'FAIL: expected error /%/ from %', pat, sql;
exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm !~* pat then raise exception 'FAIL: wrong error "%" (wanted /%/)', sqlerrm, pat; end if; raise notice 'ok  - error: %', sqlerrm; end $$;
truncate public.rooms cascade; truncate public.friendships; delete from public.profiles;
insert into public.profiles(id, full_name, username) select u, n, n from (values
 ('00000000-0000-0000-0000-00000000000a'::uuid,'A'),('00000000-0000-0000-0000-00000000000b'::uuid,'B'),('00000000-0000-0000-0000-00000000000c'::uuid,'C'),('00000000-0000-0000-0000-00000000000d'::uuid,'D')) v(u,n);
insert into auth.users(id) select id from public.profiles on conflict do nothing;
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
\set D '''00000000-0000-0000-0000-00000000000d'''
-- B is an accepted friend of A, C only has a pending request, D is a stranger
insert into public.friendships(user_id, friend_id, status) values (:A, :B, 'accepted'), (:A, :C, 'pending');

select t_as(:A);
select create_room('p') is null as x \gset
select id as rid, code from public.rooms limit 1 \gset
select t_ok((select privacy_chosen from rooms where id=:'rid') = false, 'new room: privacy not chosen yet');
select t_ok((select privacy from rooms where id=:'rid') = 'public', 'new room defaults to Public');
select room_privacy_confirm(:'rid') is not null as x \gset
select t_ok((select count(*) from room_messages where kind='notice') = 0, 'confirm before 14 s does nothing');
update rooms set created_at = now() - interval '20 seconds' where id = :'rid';
select room_privacy_confirm(:'rid') is not null as x \gset
select room_privacy_confirm(:'rid') is not null as x \gset
select t_ok((select count(*) from room_messages where kind='notice' and body='Room is set to Public') = 1, 'unanswered card -> Public notice, once');

-- PUBLIC: anyone signed in joins
select t_as(:D); select join_room(:'code') is not null as j \gset
select leave_room(:'rid');

-- FRIENDS ONLY
select t_as(:A); select room_update(:'rid', p_privacy => 'friends') is not null as x \gset
select t_ok((select count(*) from room_messages where body='Room is set to Friends only') = 1, 'friends notice');
select t_as(:B); select join_room(:'code') is not null as j \gset
select leave_room(:'rid');
select t_as(:C); select t_err(format('select join_room(%L)', :'code'), 'friends of the room host');
select t_as(:D); select t_err(format('select join_room(%L)', :'code'), 'friends of the room host');

-- INVITE ONLY: friendship is not enough; an invitation is
select t_as(:A); select room_update(:'rid', p_privacy => 'invite') is not null as x \gset
select t_as(:B); select t_err(format('select join_room(%L)', :'code'), 'invite only');
select t_as(:A); select room_invite(:'rid', array[:B]::uuid[]) as n \gset
select t_as(:B); select join_room(:'code') is not null as j \gset
select leave_room(:'rid');
select t_as(:D); select t_err(format('select join_room(%L)', :'code'), 'invite only');

-- NEARBY: location required, inside the configured radius
select t_as(:A); select t_err(format('select room_update(%L, p_privacy => ''nearby'')', :'rid'), 'Location permission');
select room_update(:'rid', p_privacy => 'nearby', p_lat => 30.9010, p_lng => 75.8573) is not null as x \gset
select t_as(:D); select t_err(format('select join_room(%L)', :'code'), 'Location permission');
select t_err(format('select join_room(%L, 28.6139, 77.2090)', :'code'), 'nearby');      -- ~280 km away
select join_room(:'code', 30.9050, 75.8600) is not null as j \gset                         -- a few hundred metres away
select leave_room(:'rid');
select t_as(:A); select room_update(:'rid', p_privacy => 'friends') is not null as x \gset
select t_ok((select lat is null and lng is null from rooms where id=:'rid'), 'leaving Nearby deletes the stored location');

-- existing members survive a privacy change
select t_as(:B); select join_room(:'code') is not null as j \gset
select t_as(:A); select room_update(:'rid', p_privacy => 'invite') is not null as x \gset
select t_ok(exists(select 1 from room_members where room_id=:'rid' and user_id=:B), 'members stay after the mode changes');

-- admin notices: voice + per-member mic
select room_update(:'rid', p_privacy => 'public') is not null as x \gset
select t_ok(exists(select 1 from room_messages where body='Mic is enabled for everyone'), 'public -> mic enabled for everyone');
select room_update(:'rid', p_voice => false) is not null as x \gset
select t_ok(exists(select 1 from room_messages where body='Mic is disabled for everyone'), 'voice off notice');
select room_update(:'rid', p_voice => true, p_privacy => 'friends') is not null as x \gset
select room_set_member_mic(:'rid', :B, true);
select t_ok(exists(select 1 from room_messages where body = 'B''s mic is enabled'), 'per-user mic notice');
select t_err(format('insert into room_messages(room_id,user_id,kind,body) values (%L,%L,''notice'',''x'')', :'rid', :'A'), 'row-level|permission');
\echo ALL PRIVACY TESTS PASSED
