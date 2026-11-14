-- Personal queue server rules.  Run: psql -f tests/mock-supabase.sql -f rooms-schema.sql -f room-pqueue-schema.sql -f tests/room-pqueue-test.sql
-- (NOT run in the authoring sandbox: no Postgres there. Run it once against your Supabase/Postgres test DB.)
\set ON_ERROR_STOP on
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(c,false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  - %', msg; end $$;
create or replace function t_err(sql text, pat text) returns void language plpgsql as $$
begin execute sql; raise exception 'FAIL: expected error /%/ from %', pat, sql;
exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm !~* pat then raise exception 'FAIL: wrong error "%" (wanted /%/)', sqlerrm, pat; end if; raise notice 'ok  - error: %', sqlerrm; end $$;
truncate public.rooms cascade; delete from public.profiles;
insert into public.profiles(id, full_name, username) select u, n, n from (values
 ('00000000-0000-0000-0000-00000000000a'::uuid,'A'),('00000000-0000-0000-0000-00000000000b'::uuid,'B')) v(u,n);
insert into auth.users(id) select id from public.profiles on conflict do nothing;
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
select t_as(:A);
select create_room('t','public','{"kind":"youtube","id":"aaaaaaaaaaa","title":"First"}'::jsonb) is null as x \gset
select id as rid, code from public.rooms limit 1 \gset
select t_as(:B); select join_room(:'code') is not null as j \gset

-- add: duplicates skipped, invalid skipped
select t_as(:B);
select t_ok((pq_add(:'rid','[{"kind":"youtube","id":"bbbbbbbbbbb","title":"B1","ch":"C","d":"3:05"},{"kind":"youtube","id":"ccccccccccc","title":"B2"},{"kind":"youtube","id":"bbbbbbbbbbb","title":"dup"},{"kind":"nope"}]'::jsonb)->>'added')::int = 2, 'adds 2, skips duplicate + invalid');
select t_ok(jsonb_array_length(pq_list(:'rid')->'items') = 2, 'list shows my 2');
select t_ok(pq_list(:'rid')->'items'->0->'media'->>'ch' = 'C', 'channel + duration kept for display');

-- privacy: A sees none of B's items and cannot touch them
select t_as(:A);
select t_ok(jsonb_array_length(pq_list(:'rid')->'items') = 0, 'A cannot see B''s queue');
select id as bid from room_pqueue where media->>'id'='bbbbbbbbbbb' \gset
select pq_remove(:'rid', :'bid'); select pq_reorder(:'rid', array[:'bid'::uuid]); select t_ok((select count(*) from room_pqueue)=2, 'A cannot delete B''s item');
select pq_clear(:'rid'); select t_ok((select count(*) from room_pqueue)=2, 'A cannot clear B''s queue');
select t_ok((select count(*) from room_pqueue where user_id = :B::uuid)=2, 'A cannot reorder B''s queue');
select t_err($$select count(*) from room_pqueue$$, 'permission denied') ;

-- reorder (B): c first
select t_as(:B);
select id as cid from room_pqueue where media->>'id'='ccccccccccc' \gset
select pq_reorder(:'rid', array[:'cid'::uuid, :'bid'::uuid]);
select t_ok(pq_list(:'rid')->'items'->0->'media'->>'id' = 'ccccccccccc', 'reorder applied');

-- one at a time, strictly in order.  Room is playing "First" -> goes to Up next (vote)
select t_ok(pq_submit(:'rid')->>'action' = 'queued', 'first item submitted to the vote');
select t_ok((select media->>'id' from room_queue where added_by = :B::uuid) = 'ccccccccccc', 'it was the FIRST in my order');
select t_err($$select pq_submit('$$||:'rid'||$$')$$, 'still in the vote');
select t_ok(jsonb_array_length(pq_list(:'rid')->'items') = 1, 'the submitted item left my pending list (never auto-resubmitted)');
-- vote round finishes: the item is no longer in Up next
delete from room_queue where added_by = :B::uuid;
select t_ok(pq_list(:'rid')->'active' is null, 'submission settled once its video left the vote');
select t_ok(pq_submit(:'rid')->>'action' = 'queued', 'next one can now go');

-- leave + rejoin keeps pending queue; non-member is refused
select pq_add(:'rid','[{"kind":"youtube","id":"ddddddddddd","title":"D"}]'::jsonb);
select leave_room(:'rid');
select t_ok((select count(*) from room_pqueue where user_id=:B::uuid and media->>'id'='ddddddddddd')=1, 'pending queue survives leaving');
select t_err($$select pq_list('$$||:'rid'||$$')$$, 'Join the room first');
select join_room(:'code') is not null as j \gset
select t_ok(jsonb_array_length(pq_list(:'rid')->'items') = 1, 'rejoin: my pending video is back');

-- retention: deleting the (closed) room removes every queue row
select t_as(:A); select leave_room(:'rid'); select t_as(:B); select leave_room(:'rid');
delete from public.rooms where id = :'rid';
select t_ok((select count(*) from room_pqueue)=0 and (select count(*) from room_pq_active)=0, 'room removal cleans all personal queues');
