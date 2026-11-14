\set ON_ERROR_STOP on
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(c,false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  - %', msg; end $$;
create or replace function t_err(sql text, pat text) returns void language plpgsql as $$
begin execute sql; raise exception 'FAIL: expected error /%/ from %', pat, sql;
exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm !~* pat then raise exception 'FAIL: wrong error "%" (wanted /%/)', sqlerrm, pat; end if; raise notice 'ok  - error: %', sqlerrm; end $$;
truncate public.rooms cascade; delete from public.profiles;
insert into public.profiles(id, full_name, username) select u, n, n from (values
 ('00000000-0000-0000-0000-00000000000a'::uuid,'A'),('00000000-0000-0000-0000-00000000000b'::uuid,'B'),('00000000-0000-0000-0000-00000000000c'::uuid,'C')) v(u,n);
insert into auth.users(id) select id from public.profiles on conflict do nothing;
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
select t_as(:A);
select create_room('t','public','{"kind":"youtube","id":"aaaaaaaaaaa","title":"First"}'::jsonb) is null as x \gset
select id as rid, code from public.rooms limit 1 \gset
select t_as(:B); select join_room(:'code') is not null as j \gset
select t_as(:C); select join_room(:'code') is not null as j \gset
select t_ok((select playback_mode from rooms where id=:'rid')='vote','default mode is vote');

-- ===== LET'S VOTE =====
select t_as(:B); select room_pick(:'rid','{"kind":"youtube","id":"bbbbbbbbbbb","title":"X"}'::jsonb);
select t_as(:C); select room_pick(:'rid','{"kind":"youtube","id":"ccccccccccc","title":"Y"}'::jsonb);
select t_err($$select room_pick('$$||:'rid'||$$','{"kind":"youtube","id":"bbbbbbbbbbb","title":"X again"}'::jsonb)$$, 'Already in Up next');
select t_err($$select room_pick('$$||:'rid'||$$','{"kind":"youtube","id":"aaaaaaaaaaa","title":"same"}'::jsonb)$$, 'already playing');
select id as qx from room_queue where media->>'id'='bbbbbbbbbbb' \gset
select id as qy from room_queue where media->>'id'='ccccccccccc' \gset
select t_ok((select votes from room_queue where id=:'qx') = array[:B::uuid], 'adder auto-votes');
select t_as(:B); select room_vote(:'qy');
select t_ok((select cardinality(votes) from room_queue where id=:'qx')=0 and (select cardinality(votes) from room_queue where id=:'qy')=2, 'ONE vote: B moved X -> Y');
select room_vote(:'qy');
select t_ok((select cardinality(votes) from room_queue where id=:'qy')=1, 'tap again withdraws vote');
select t_as(:C); select room_vote(:'qy'); select room_vote(:'qy');
select t_ok((select cardinality(votes) from room_queue where id=:'qy')=1 and (select votes from room_queue where id=:'qy')=array[:C::uuid], 'no duplicate votes');
select t_as(:B); select t_err($$select room_ended('$$||:'rid'||$$')$$, 'admin');
select t_as(:A); select room_ended(:'rid'); select room_ended(:'rid');
select t_ok((select (play_state->>'vote_until') is not null from rooms where id=:'rid'), 'video end opens voting once');
select t_ok((select count(*) from room_queue)=5, 'suggestions fill vote to 5 candidates');
select t_ok((select count(*) from room_queue where suggested)=3, '3 suggestions');
select t_as(:A); select t_ok((room_advance(:'rid')->>'waiting')::boolean, 'admin cannot close the vote early');
-- window expires, B tries to vote -> refused
update rooms set play_state = jsonb_set(play_state,'{vote_until}', to_jsonb(room_now()-1000)) where id=:'rid';
select t_as(:B); select t_err($$select room_vote('$$||:'qx'||$$')$$, 'closed');
select t_err($$select room_advance('$$||:'rid'||$$')$$, 'still open');   -- non admin too early (3s grace)
select t_as(:A); select room_advance(:'rid');
select t_ok((select media->>'id' from rooms where id=:'rid')='ccccccccccc', 'winner (most votes) plays');
select t_ok((select count(*) from room_queue)=1 and (select cardinality(votes) from room_queue)=0, 'new video = new voting session; suggestions removed');
select t_ok((select (play_state->>'playing')::boolean and play_state->>'vote_until' is null from rooms where id=:'rid'), 'playing, vote closed');

-- tie -> leader gets 10 s, then earliest added
select t_as(:C); select room_pick(:'rid','{"kind":"youtube","id":"ddddddddddd","title":"D"}'::jsonb);
select t_as(:B); select room_pick(:'rid','{"kind":"youtube","id":"eeeeeeeeeee","title":"E"}'::jsonb);
select t_as(:A); select room_ended(:'rid');
update rooms set play_state = jsonb_set(play_state,'{vote_until}', to_jsonb(room_now()-1000)) where id=:'rid';
select t_ok((room_advance(:'rid')->>'need_leader')::boolean, 'tie: admin must choose (waits)');
select t_as(:B); select t_err($$select room_advance('$$||:'rid'||$$')$$, 'still open');
update rooms set play_state = jsonb_set(play_state,'{vote_until}', to_jsonb(room_now()-14000)) where id=:'rid';
select t_ok((select count(*) from room_queue where media->>'id' in ('ddddddddddd','eeeeeeeeeee') and cardinality(votes)=1)=2, 'two tied leaders');
select room_advance(:'rid');
select t_ok((select media->>'id' from rooms where id=:'rid')='ddddddddddd', 'timeout fallback = earliest added of tied videos');

-- ===== JUST PLAY =====
select t_as(:A); select room_update(:'rid', p_mode=>'play');
select t_as(:B); select room_pick(:'rid','{"kind":"youtube","id":"fffffffffff","title":"F"}'::jsonb);
select t_ok((select count(*) from room_queue where media->>'id'='fffffffffff')=1 and (select media->>'id' from rooms where id=:'rid')='ddddddddddd','just play: add only queues');
select t_ok((select count(*) from room_queue where cardinality(votes)>0)=0, 'no votes outside vote mode');
select t_err($$select room_vote('$$||(select id from room_queue limit 1)||$$')$$, 'Let.s vote');
select t_as(:A); select room_ended(:'rid');
select t_ok((select play_state->>'ended' = 'true' and play_state->>'vote_until' is null from rooms where id=:'rid'), 'just play: stops, no vote UI');
select t_ok((select count(*) from room_queue)>=1, 'queue kept while stopped');
select t_as(:B); select t_err($$select room_advance('$$||:'rid'||$$', '$$||(select id from room_queue limit 1)||$$')$$, 'admin');
select t_as(:A); select room_advance(:'rid', (select id from room_queue order by created_at limit 1));
select t_ok((select (play_state->>'playing')::boolean from rooms where id=:'rid'), 'leader manually picks next');

-- ===== AUTOPLAY =====
select t_as(:C); select room_pick(:'rid','{"kind":"youtube","id":"ggggggggggg","title":"G"}'::jsonb);
select t_as(:A); select room_update(:'rid', p_mode=>'autoplay');
select t_ok((select media->>'id' from rooms where id=:'rid') is not null and (select (play_state->>'playing')::boolean from rooms where id=:'rid'), 'mode switch does not interrupt playing video');
select media->>'id' as exp from room_queue order by created_at limit 1 \gset
select room_ended(:'rid');
select t_ok((select media->>'id' from rooms where id=:'rid')=:'exp', 'autoplay: next queue item in order (oldest first)');
do $$ declare n int; begin loop select count(*) into n from room_queue; exit when n=0; perform room_ended((select id from rooms limit 1)); end loop; end $$;
select room_ended(:'rid');
select t_ok((select play_state->>'ended' from rooms where id=:'rid')='true' and (select count(*) from room_queue)=0, 'autoplay: empty queue stops');
select t_as(:B); select room_pick(:'rid','{"kind":"youtube","id":"hhhhhhhhhhh","title":"H"}'::jsonb);
select t_ok((select media->>'id' from rooms where id=:'rid')='hhhhhhhhhhh', 'autoplay resumes when a video is added');
select t_as(:A); select room_skip(:'rid'); select room_skip(:'rid');
select t_ok((select play_state->>'ended' from rooms where id=:'rid')='true', 'skip with empty queue stops (double skip safe)');

-- ===== LEADER'S CHOICE =====
select room_update(:'rid', p_mode=>'leader');
select t_as(:B); select t_err($$select room_pick('$$||:'rid'||$$','{"kind":"youtube","id":"iiiiiiiiiii","title":"I"}'::jsonb)$$, 'admin');
select t_as(:A); select room_pick(:'rid','{"kind":"youtube","id":"iiiiiiiiiii","title":"I"}'::jsonb);
select t_ok((select media->>'id' from rooms where id=:'rid')='iiiiiiiiiii', 'leader plays any video, outside queue');
select room_pick(:'rid','{"kind":"youtube","id":"jjjjjjjjjjj","title":"J"}'::jsonb);
select t_ok((select media->>'id' from rooms where id=:'rid')='iiiiiiiiiii' and (select count(*) from room_queue)=1, 'leader pick during playback queues it');
select t_ok((select next_id from rooms where id=:'rid') = (select id from room_queue where media->>'id'='jjjjjjjjjjj'), 'leader queue pick becomes the selected next video');
select room_ended(:'rid'); select room_ended(:'rid');
select t_ok((select media->>'id' from rooms where id=:'rid')='jjjjjjjjjjj' and (select next_id from rooms where id=:'rid') is null, 'leader mode starts the leader''s selected next video (once)');
select room_ended(:'rid');
select t_ok((select play_state->>'ended' from rooms where id=:'rid')='true' and (select play_state->>'phase' from rooms where id=:'rid')='WAITING_FOR_LEADER' and (select play_state->>'vote_until' from rooms where id=:'rid') is null, 'leader mode with nothing selected waits for the leader, no vote');

-- ===== MODE SWITCH while voting =====
select room_update(:'rid', p_mode=>'vote');
select t_ok((select play_state->>'vote_until' from rooms where id=:'rid') is not null, 'waiting + switch to vote opens vote');
select room_update(:'rid', p_mode=>'play');
select t_ok((select play_state->>'vote_until' from rooms where id=:'rid') is null and (select count(*) from room_queue where cardinality(votes)>0)=0 and (select media->>'id' from rooms where id=:'rid')='jjjjjjjjjjj', 'vote -> just play cancels the vote, starts nothing');

-- ===== failure =====
select room_pick(:'rid','{"kind":"youtube","id":"kkkkkkkkkkk","title":"K"}'::jsonb, true);
select room_update(:'rid', p_mode=>'autoplay');
select t_ok((select count(*) from room_queue)>=0, 'setup');
select room_media_failed(:'rid'); select room_media_failed(:'rid');
select t_ok((select play_state->>'ended' from rooms where id=:'rid')='true', 'media failure moves on once');

-- =====================================================================================================
-- v3: state machine, early close, reorder, event ids, unavailable items, delete rule, mode-switch cleanup
-- =====================================================================================================
select t_as(:A);
select room_update(:'rid', p_mode=>'vote');
select room_pick(:'rid','{"kind":"youtube","id":"v3v3v3v3v31","title":"V1"}'::jsonb, true);
select t_ok((select play_state->>'phase' from rooms where id=:'rid')='PLAYING', 'phase PLAYING after a video starts');
select room_set_state(:'rid', false, 12);
select t_ok((select play_state->>'phase' from rooms where id=:'rid')='PAUSED', 'phase PAUSED');
select room_set_state(:'rid', true, 12);

-- vote: adding / voting BEFORE the video ends is allowed; leaving does not erase an accepted vote
select t_as(:B); select room_pick(:'rid','{"kind":"youtube","id":"v3v3v3v3v32","title":"V2"}'::jsonb);
select t_as(:C); select room_pick(:'rid','{"kind":"youtube","id":"v3v3v3v3v33","title":"V3"}'::jsonb);
select id as q2 from room_queue where media->>'id'='v3v3v3v3v32' \gset
select id as q3 from room_queue where media->>'id'='v3v3v3v3v33' \gset
select t_as(:B); select room_vote(:'q3');
select t_ok((select cardinality(votes) from room_queue where id=:'q3')=2, 'voting before the video ends works (B moved to V3, C already on V3)');
select leave_room(:'rid');
select t_ok((select cardinality(votes) from room_queue where id=:'q3')=2, 'a member leaving does not erase their accepted vote');
select t_as(:B); select join_room(:'code') is not null as j \gset
select t_as(:A); select t_ok((select play_state->>'vote_until' from rooms where id=:'rid') is null, 'no vote window while the video plays');

-- version check: a stale end event is ignored, the real one opens the vote ONCE
select media_ver as v from rooms where id=:'rid' \gset
select t_ok((room_ended(:'rid', :v - 1)->>'noop')::boolean, 'stale end event (old media_ver) is ignored');
select room_ended(:'rid', :v);
select t_ok((room_ended(:'rid', :v)->>'noop')::boolean, 'duplicate end event is ignored');
select t_ok((select count(*) from room_playback_log where event='finished' and ver=:v)=1, 'exactly one finished event per video (event id)');
select t_ok((select play_state->>'phase' from rooms where id=:'rid')='VOTING', 'phase VOTING');
select t_ok((select count(*) from room_queue)=5, 'vote has 5 candidates, never empty');
select t_ok((select (play_state->>'vote_ms')::int from rooms where id=:'rid')=12000, 'vote lasts the configured 12 s');

-- join during voting may vote; non-admin cannot close early; admin early close picks the winner right away
select t_as(:C); select room_vote(:'q3'); select room_vote(:'q3'); select room_vote(:'q2');
select t_ok((select cardinality(votes) from room_queue where id=:'q2')=1, 'C moved their single vote during the vote window');
select t_err($$select room_close_vote('$$||:'rid'||$$')$$, 'admin');
select t_as(:A);
select t_ok(not (room_close_vote(:'rid')->>'played')::boolean, 'tie after the move: early close waits for the leader');
select room_advance(:'rid', :'q2');
select t_ok((select media->>'id' from rooms where id=:'rid')='v3v3v3v3v32', 'leader picks the tied winner');
select t_ok((select (detail->>'chosen_by_leader')::boolean from room_playback_log where event='winner' order by id desc limit 1), 'winner logged (chosen by leader)');
select t_ok((select count(*) from room_queue where suggested)=0, 'suggestions disappear when the winner starts');

-- clear winner: early close starts it immediately
select t_as(:B); select room_pick(:'rid','{"kind":"youtube","id":"v3v3v3v3v34","title":"V4"}'::jsonb);
select t_as(:A); select room_ended(:'rid');
select id as q4 from room_queue where media->>'id'='v3v3v3v3v34' \gset
select t_as(:C); select room_vote(:'q4');
select t_as(:A); select t_ok((room_close_vote(:'rid')->>'played')::boolean, 'early close with a clear winner plays it at once');
select t_ok((select media->>'id' from rooms where id=:'rid')='v3v3v3v3v34', 'early close winner is the most-voted video');

-- Autoplay: order, add goes to END, admin reorder, unavailable items skipped, mode-switch cleanup
select room_update(:'rid', p_mode=>'autoplay');
delete from room_queue;
select t_as(:B); select room_pick(:'rid','{"kind":"youtube","id":"a0a0a0a0a01","title":"A1"}'::jsonb);
select t_as(:C); select room_pick(:'rid','{"kind":"youtube","id":"a0a0a0a0a02","title":"A2"}'::jsonb);
select room_pick(:'rid','{"kind":"youtube","id":"a0a0a0a0a03","title":"A3"}'::jsonb);
select t_ok((select string_agg(media->>'title', ',' order by pos) from room_queue)='A1,A2,A3', 'new videos are added to the end of the queue');
select t_as(:B); select t_err($$select room_queue_move('$$||(select id from room_queue where media->>'title'='A3')||$$', -1)$$, 'admin');
select t_as(:A); select room_queue_move((select id from room_queue where media->>'title'='A3'), -1); select room_queue_move((select id from room_queue where media->>'title'='A3'), -1);
select t_ok((select string_agg(media->>'title', ',' order by pos) from room_queue)='A3,A1,A2', 'admin reorder moves an item up');
select room_queue_move((select id from room_queue where media->>'title'='A3'), -1);
select t_ok((select string_agg(media->>'title', ',' order by pos) from room_queue)='A3,A1,A2', 'moving the first item up is harmless');
select media_ver as v from rooms where id=:'rid' \gset
select room_ended(:'rid', :v); select room_ended(:'rid', :v);
select t_ok((select media->>'title' from rooms where id=:'rid')='A3', 'autoplay follows the reordered queue; a double end plays ONE video');
select t_ok((select count(*) from room_queue)=2, 'each queue item is processed once');
-- A3 fails -> marked unavailable, next plays; queueing A3 again later it is skipped by autoplay
select room_media_failed(:'rid');
select t_ok((select media->>'title' from rooms where id=:'rid')='A1', 'failed video: autoplay moves on');
select t_ok((select count(*) from room_playback_log where event='failed')>=1, 'failure is recorded');
select t_ok(public._unavailable((select id from rooms where id=:'rid'), '{"kind":"youtube","id":"a0a0a0a0a03"}'::jsonb), 'the failed video is marked unavailable');
select room_pick(:'rid','{"kind":"youtube","id":"a0a0a0a0a03","title":"A3"}'::jsonb);
select room_pick(:'rid','{"kind":"youtube","id":"a0a0a0a0a04","title":"A4"}'::jsonb);
select room_skip(:'rid');
select t_ok((select media->>'title' from rooms where id=:'rid')='A2', 'skip -> next in order');
select room_skip(:'rid');
select t_ok((select media->>'title' from rooms where id=:'rid')='A4' and (select count(*) from room_playback_log where event='skipped_unavailable')=1, 'an unavailable item is skipped and recorded');
select room_ended(:'rid');
select t_ok((select play_state->>'phase' from rooms where id=:'rid')='QUEUE_EMPTY', 'phase QUEUE_EMPTY when autoplay runs out');

-- a vote is open, mode switches to Autoplay: suggestions are NOT auto-played
select room_update(:'rid', p_mode=>'vote');
select t_ok((select count(*) from room_queue where suggested)>0 and (select play_state->>'vote_until' from rooms where id=:'rid') is not null, 'switch to vote while waiting opens a vote with suggestions');
select room_update(:'rid', p_mode=>'autoplay');
select t_ok((select count(*) from room_queue)=0 and (select play_state->>'phase' from rooms where id=:'rid')='QUEUE_EMPTY' and (select play_state->>'vote_until' from rooms where id=:'rid') is null, 'vote -> autoplay: vote closed, suggestions dropped, nothing auto-started');

-- Just play: waiting phase; Leader's choice: selected next video is toggle-able and only for the leader
select room_update(:'rid', p_mode=>'play');
select t_ok((select play_state->>'phase' from rooms where id=:'rid')='WAITING_FOR_SELECTION', 'phase WAITING_FOR_SELECTION');
select t_err($$select room_set_next('$$||:'rid'||$$', null)$$, 'Leader');
select room_update(:'rid', p_mode=>'leader');
select room_pick(:'rid','{"kind":"youtube","id":"l0l0l0l0l01","title":"L1"}'::jsonb);
select room_pick(:'rid','{"kind":"youtube","id":"l0l0l0l0l02","title":"L2"}'::jsonb);
select room_pick(:'rid','{"kind":"youtube","id":"l0l0l0l0l03","title":"L3"}'::jsonb);
select t_ok((select media->>'title' from rooms where id=:'rid')='L1', 'leader picks a video while waiting: it plays');
select room_pick(:'rid','{"kind":"youtube","id":"l0l0l0l0l04","title":"L4"}'::jsonb);
select room_set_next(:'rid', (select id from room_queue where media->>'title'='L3'));
select t_ok((select media->>'title' from room_queue where id=(select next_id from rooms where id=:'rid'))='L3', 'leader changes the selected next video');
select room_set_next(:'rid', (select id from room_queue where media->>'title'='L3'));
select t_ok((select next_id from rooms where id=:'rid') is null, 'tapping the selected video again clears the selection');
select room_set_next(:'rid', (select id from room_queue where media->>'title'='L3'));
select room_ended(:'rid');
select t_ok((select media->>'title' from rooms where id=:'rid')='L3', 'selected next video starts when the current one ends');

-- the vote window length is configurable
select room_update(:'rid', p_mode=>'vote', p_vote_seconds=>30);
select room_ended(:'rid');
select room_pick(:'rid','{"kind":"youtube","id":"c0c0c0c0c01","title":"C1"}'::jsonb, true);
select media_ver as v from rooms where id=:'rid' \gset
select room_ended(:'rid', :v);
select t_ok((select (play_state->>'vote_ms')::int from rooms where id=:'rid')=30000, 'configured vote time is used');
select t_err($$select room_update('$$||:'rid'||$$', p_vote_seconds=>2)$$, '5 to 120');
-- play/pause events after the end must not wipe an open vote
select room_set_state(:'rid', true, 5);
select t_ok((select play_state->>'vote_until' from rooms where id=:'rid') is not null, 'late play event cannot wipe the vote');

-- Delete / Cancel invite: only for invited rooms and Friends / Invite-only rooms
select t_as(:C); select t_err($$select room_dismiss('$$||:'rid'||$$')$$, 'Public rooms cannot be deleted');
select t_as(:A); select room_update(:'rid', p_privacy=>'friends');
select t_as(:C); select room_dismiss(:'rid');
select t_ok((select count(*) from room_dismissed where room_id=:'rid' and user_id=:C::uuid)=1, 'friends-only room can be deleted from my list');
select t_as(:A); select room_update(:'rid', p_privacy=>'public');
delete from room_dismissed;
insert into room_invites(room_id,user_id,invited_by) values (:'rid', :C::uuid, :A::uuid);
select t_as(:C); select room_dismiss(:'rid');
select t_ok((select count(*) from room_invites where room_id=:'rid' and user_id=:C::uuid)=0, 'an invite to a public room can be cancelled');

select 'ALL PASSED' as result;
