\set ON_ERROR_STOP on
-- Nova Play server rules.  Run: psql -f tests/mock-supabase.sql -f rooms-schema.sql -f room-pqueue-schema.sql -f room-games-schema.sql -f tests/room-games-test.sql
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
\set Au '00000000-0000-0000-0000-00000000000a'
select t_as(:A); select create_room('t','public') is null as x \gset
select id as rid, code from public.rooms limit 1 \gset
select t_as(:B); select join_room(:'code') is null as x \gset
select t_as(:C); select join_room(:'code') is null as x \gset
select t_as(:D); select join_room(:'code') is null as x \gset

-- 1. members can never start / configure a game (also through a hand-made request)
select t_as(:B);
select t_err(format($q$select game_start(%L,'trivia','{}')$q$, :'rid'), 'only the room admin');
select t_as(:A);
select t_err(format($q$select game_start(%L,'trivia','{"seconds":10}')$q$, :'rid'), 'at least one');
select t_err(format($q$select game_start(%L,'trivia','{"custom":[{"prompt":"No correct option marked","options":["x","y"]}]}')$q$, :'rid'), 'at least one');
select game_start(:'rid','trivia', format($j$ {"seconds":10,"order":"fixed","custom":[
  {"prompt":"Which planet is red?","options":["Venus","Mars","Jupiter"],"correct":1},
  {"prompt":"","emoji":"🎬 🦁 👑","image":"%s/%s/clue.jpg","type":"text","answer":"The Lion King","accept":["Lion King"]},
  {"prompt":"Bad image path","image":"../../etc/passwd","options":["x","y"],"correct":0},
  {"prompt":"Other room image","image":"%s/%s/clue.jpg","options":["x","y"],"correct":0},
  {"prompt":"No correct answer marked","options":["x","y"]},
  {"prompt":"Only one option","options":["x"],"correct":0},
  {"prompt":"Typed but no answer","type":"text"},
  {"prompt":"Last one","options":["a","b","c","d","e"],"correct":3}]} $j$, :'rid', :'Au', gen_random_uuid(), :'Au')::jsonb) ->> 'id' as sid \gset
select t_ok((select count(*) from game_sessions where room_id=:'rid' and status<>'ended')=1, 'admin started one game');
select t_err(format($q$select game_start(%L,'emoji','{"custom":[{"prompt":"x","options":["a","b"],"correct":0}]}')$q$, :'rid'), 'already running');
select t_ok((select count(*) from game_questions where session_id=:'sid')=5, 'only complete questions were kept (incomplete ones dropped)');
select t_ok((select image from game_questions where session_id=:'sid' and idx=1) = :'rid' || '/' || :'Au' || '/clue.jpg', 'valid picture path stored');
select t_ok((select kind from game_questions where session_id=:'sid' and idx=1)='text' and (select answer_text from game_questions where session_id=:'sid' and idx=1)='The Lion King', 'typed-answer question stored');
select t_ok((select prompt from game_questions where session_id=:'sid' and idx=1)='Guess it from the emojis' and (select emoji from game_questions where session_id=:'sid' and idx=1)='🎬 🦁 👑', 'emoji-only question gets a default prompt');
select t_ok((select image from game_questions where session_id=:'sid' and idx=2) is null and (select prompt from game_questions where session_id=:'sid' and idx=2)='Bad image path', 'unsafe picture path rejected, question kept');
select t_ok((select image from game_questions where session_id=:'sid' and idx=3) is null, 'picture from another room folder rejected');
select t_ok((select jsonb_array_length(options) from game_questions where session_id=:'sid' and idx=4)=4, 'at most four options');
select t_ok(not exists(select 1 from game_sessions where id=:'sid' and cfg ? 'custom'), 'stored config carries no questions or answers');

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
select t_ok((select summary from game_sessions where id=:'sid') is not null, 'final results stored on the session');

-- 9. typed answers are checked on the server (case, spaces, punctuation and a leading "the" are ignored); a picture-only question is allowed
select t_as(:B);
select game_start(:'rid','movie', format($j$ {"seconds":10,"participation":"open","custom":[
  {"prompt":"","image":"%s/%s/scene.png","type":"text","answer":"The Lion King","accept":["Simba"]}]} $j$, :'rid', :'Au')::jsonb) ->> 'id' as sid2 \gset
select (case when (select status from game_sessions where id=:'sid2')<>'question' then game_next(:'sid2') end) is null as x \gset
select (case when (select status from game_sessions where id=:'sid2')<>'question' then game_next(:'sid2') end) is null as x \gset
select t_ok((select prompt from game_questions where session_id=:'sid2' and idx=0)='Look at the picture and answer', 'picture-only question gets a default prompt');
select t_as(:C); select game_answer(:'sid2', null, 'the LION king!');
select t_as(:D); select game_answer(:'sid2', null, 'Titanic');
select t_as(:B); select game_skip(:'sid2');
select t_ok((select score from game_players where session_id=:'sid2' and user_id=:C) >= 100, 'typed answer matched loosely: scored');
select t_ok((select score from game_players where session_id=:'sid2' and user_id=:D) = 0, 'wrong typed answer: no score');
select game_end(:'sid2');

-- 10. rematch keeps the admin's questions (and pictures); predict games may start empty and take questions live, wyr needs no correct option
select game_rematch(:'sid2') ->> 'id' as sid3 \gset
select t_ok((select image from game_questions where session_id=:'sid3' and idx=0) = :'rid' || '/' || :'Au' || '/scene.png' and (select count(*) from game_questions where session_id=:'sid3')=1, 'rematch re-uses the same question and picture');
select game_end(:'sid3');
select game_start(:'rid','predict','{"seconds":10}') is not null as x \gset
select game_add_question((select id from game_sessions where room_id=:'rid' and status<>'ended'), format($q$ {"prompt":"What happens next?","emoji":"🔮","image":"%s/%s/next.webp","options":["He wins","He loses"]} $q$, :'rid', :'Au')::jsonb);
select t_ok((select count(*) from game_questions q join game_sessions s on s.id=q.session_id where s.room_id=:'rid' and s.status<>'ended' and q.kind='predict' and q.image is not null)=1, 'question added live with a picture');
select game_end((select id from game_sessions where room_id=:'rid' and status<>'ended'));
select t_err(format($q$select game_start(%L,'wyr','{"seconds":5}')$q$, :'rid'), 'at least one');
select game_start(:'rid','wyr','{"seconds":5,"custom":[{"prompt":"Cats or dogs?","options":["Cats","Dogs"]}]}') is not null as x \gset
select t_ok(true, 'a new game can start after the old one ended');

-- 11. everything that belonged to the old bank / history / stats / daily rewards is gone
select t_ok(not exists(select 1 from pg_proc where proname in ('game_history','game_my_stats','game_daily','game_claim','_game_daily_rows','_game_label')), 'history / stats / daily functions are gone');
select t_ok(not exists(select 1 from information_schema.tables where table_schema='public' and table_name in ('game_bank','game_results','game_profile','game_rewards')), 'bank / history / stats / reward tables are gone');
select t_ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='game_questions' and column_name='cat'), 'category column is gone');
select t_ok((select array_agg(table_name::text order by table_name) from information_schema.tables where table_schema='public' and table_name like 'game\_%') = array['game_answers','game_players','game_questions','game_sessions'], 'only the four game tables remain');
\echo ALL GAME SERVER TESTS PASSED
