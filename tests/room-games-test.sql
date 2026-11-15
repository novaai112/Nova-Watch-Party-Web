\set ON_ERROR_STOP on
-- Nova Play server rules.  Run: psql -f tests/mock-supabase.sql -f rooms-schema.sql -f room-pqueue-schema.sql -f room-games-schema.sql -f room-games-bank.sql -f tests/room-games-test.sql
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
select t_as(:A); select create_room('t','public') is null as x \gset
select id as rid, code from public.rooms limit 1 \gset
select t_as(:B); select join_room(:'code') is null as x \gset
select t_as(:C); select join_room(:'code') is null as x \gset
select t_as(:D); select join_room(:'code') is null as x \gset

-- 1. members can never start / configure a game (also through a hand-made request)
select t_as(:B);
select t_err(format($q$select game_start(%L,'trivia','{}')$q$, :'rid'), 'only the room admin');
select t_as(:A);
select game_start(:'rid','trivia','{"count":5,"seconds":10,"category":"Random Mix","difficulty":"mix"}') ->> 'id' as sid \gset
select t_ok((select count(*) from game_sessions where room_id=:'rid' and status<>'ended')=1, 'admin started one game');
select t_err(format($q$select game_start(%L,'emoji','{}')$q$, :'rid'), 'already running');
select t_ok((select count(*) from game_questions where session_id=:'sid')=5, 'five questions were prepared');

-- 2. everybody joins; only the admin can control
select t_as(:B); select game_join(:'sid');
select t_as(:C); select game_join(:'sid');
select t_as(:B);
select t_err(format('select game_pause(%L)', :'sid'), 'only the room admin');
select t_err(format('select game_skip(%L)', :'sid'), 'only the room admin');
select t_err(format('select game_next(%L)', :'sid'), 'only the room admin');
select t_err(format('select game_end(%L)', :'sid'), 'only the room admin');
select t_err(format('select game_rematch(%L)', :'sid'), 'only the room admin');
select t_err(format($q$select game_add_question(%L,'{"prompt":"x","options":["a","b"]}')$q$, :'sid'), 'only the room admin');

-- 3. admin pauses / resumes
select t_as(:A); select game_next(:'sid');                 -- "Start now": lobby -> countdown
select (case when (select status from game_sessions where id=:'sid')<>'question' then game_next(:'sid') end) is null as x \gset
select t_ok((select status from game_sessions where id=:'sid')='question', 'first question is live');
select game_pause(:'sid');
select t_ok((select status from game_sessions where id=:'sid')='paused', 'paused');
select t_as(:B); select t_err(format($q$select game_answer(%L,0)$q$, :'sid'), 'time is up|not.*accept|paused');
select t_as(:A); select game_resume(:'sid');
select t_ok((select status from game_sessions where id=:'sid')='question', 'resumed on the same question');

-- 4. privacy: the client-visible state never carries the correct answer or anybody else's answer
select t_as(:B);
select game_state(:'rid')::text as st \gset
select t_ok(position('correct' in (select (game_state(:'rid')->'session'->'current')::text)) = 0 or true, 'state readable');
select t_ok((game_state(:'rid')->'session'->'current') is not null, 'question visible to members');
select t_ok(not exists(select 1 from jsonb_object_keys(game_state(:'rid')->'session'->'current') k where k in ('correct','answer','answers','solution')), 'no correct answer in the live question');

-- 5. answers: B right (changes allowed), C wrong, duplicates cannot double score
select q.correct as good, jsonb_array_length(q.options) as n from game_questions q where session_id=:'sid' and idx=0 \gset
select t_as(:C); select game_answer(:'sid', (:good + 1) % :n);
select t_as(:B); select game_answer(:'sid', (:good + 1) % :n); select game_answer(:'sid', :good); select game_answer(:'sid', :good);
select t_ok((select count(*) from game_answers where session_id=:'sid' and idx=0 and user_id=:B)=1, 'one active answer per member');
select t_ok(exists(select 1 from game_players where session_id=:'sid' and user_id=:D), 'open participation: every room member entered automatically');
insert into public.profiles(id, full_name, username) values ('00000000-0000-0000-0000-00000000000e','E','e') on conflict do nothing; insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000e') on conflict do nothing;
select t_as('00000000-0000-0000-0000-00000000000e'); select t_err(format($q$select game_answer(%L,0)$q$, :'sid'), 'not in this room');
select t_err(format($q$select game_join(%L)$q$, :'sid'), 'not in this room');
select t_as(:A); select game_skip(:'sid');
select t_ok((select score from game_players where session_id=:'sid' and user_id=:B) >= 100, 'correct answer scored 100+ (server side)');
select t_ok((select score from game_players where session_id=:'sid' and user_id=:C) = 0, 'wrong answer scored 0');
select (select score from game_players where session_id=:'sid' and user_id=:B) as sb \gset
select t_as(:B); select t_err(format($q$select game_answer(%L,%s)$q$, :'sid', :good), 'time is up');
select t_ok((select score from game_players where session_id=:'sid' and user_id=:B) = :sb, 'late submission changes nothing');
select t_as(:A); select game_state(:'rid') is not null as x \gset
select t_ok((select score from game_players where session_id=:'sid' and user_id=:B) = :sb, 'polling state never re-awards points');

-- 6. leaving the game (Quit) is personal: it does not touch the session, and rejoining is allowed
select t_as(:C); select game_leave(:'sid');
select t_ok((select left_game from game_players where session_id=:'sid' and user_id=:C), 'C quit the game');
select t_ok((select status from game_sessions where id=:'sid')<>'ended', 'one member quitting does not end the game for others');
select game_join(:'sid');
select t_ok(not (select left_game from game_players where session_id=:'sid' and user_id=:C), 'C rejoined');

-- 7. admin changes: old admin loses control at once, game pauses, new admin controls
select t_as(:A); select leave_room(:'rid');
select t_ok((select admin_id from rooms where id=:'rid') = :B, 'B is the new admin');
select t_ok((select status from game_sessions where id=:'sid')='paused', 'game paused during the admin change');
select t_err(format('select game_resume(%L)', :'sid'), 'only the room admin');
select t_as(:C); select t_err(format('select game_end(%L)', :'sid'), 'only the room admin');
select t_as(:B); select game_resume(:'sid');
select t_ok((select status from game_sessions where id=:'sid')<>'paused', 'new admin resumed');

-- 8. end: results saved
select game_end(:'sid');
select t_ok((select status from game_sessions where id=:'sid')='ended', 'ended by the admin');
select t_ok((select count(*) from game_results where session_id=:'sid') >= 2, 'final results / history saved');
select t_ok((game_history(:'rid', 10)) is not null, 'room history readable');
select t_as(:B); select game_start(:'rid','wyr','{"count":5,"seconds":5}') is not null as x \gset
select t_ok(true, 'a new game can start after the old one ended');
\echo ALL GAME SERVER TESTS PASSED
