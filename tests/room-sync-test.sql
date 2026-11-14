\set ON_ERROR_STOP on
-- Sync Engine v2 (F1) server side: rooms.wait_mode, room_sync_report, room_sync_metrics_daily.  Run after rooms-schema.sql:
--   psql -f tests/mock-supabase.sql -f rooms-schema.sql -f tests/room-sync-test.sql
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
select t_as(:A); select create_room('t','public') is null as x \gset
select id as rid, code from public.rooms limit 1 \gset
select t_as(:B); select join_room(:'code') is null as x \gset

-- wait mode
select t_ok((select wait_mode from rooms where id=:'rid') = 'wait', 'default: wait for everyone');
select t_as(:B); select t_err($$select room_update('$$||:'rid'||$$', p_wait_mode => 'never')$$, 'only the room admin');
select t_as(:A); select t_err($$select room_update('$$||:'rid'||$$', p_wait_mode => 'sometimes')$$, 'bad sync mode');
select room_update(:'rid', p_wait_mode => 'never') is null as x \gset
select t_ok((select wait_mode from rooms where id=:'rid') = 'never', 'admin switches to Never wait');
select t_ok(exists(select 1 from room_messages where room_id=:'rid' and kind='notice' and body like '%never waits%'), 'the room is told about the change');
select t_ok((room_update(:'rid', p_wait_mode => 'wait'))->>'wait_mode' = 'wait', 'room_update returns the new wait_mode to the client');
select room_update(:'rid', p_title => 'renamed') is null as x \gset
select t_ok((select wait_mode from rooms where id=:'rid') = 'wait', 'other settings do not reset the sync mode');
select t_ok((select count(*) from pg_proc where proname = 'room_update') = 1, 'room_update has a single signature (no stale overload)');

-- telemetry
select t_as(:B);
select room_sync_report(:'rid', '{"samples":120,"median_drift":0.31,"p95_drift":0.92,"nudges":2,"hard_seeks":0,"manual_resyncs":1,"buffer_ms":1500,"reconnects":1,"reconnect_ok":1,"evil":"x","nudges2":{"a":1}}'::jsonb);
select t_ok((select detail->>'median_drift' from room_playback_log where room_id=:'rid' and event='sync_stats' and user_id=:B) = '0.31', 'stats stored');
select t_ok((select not (detail ? 'evil') and not (detail ? 'nudges2') from room_playback_log where room_id=:'rid' and event='sync_stats'), 'unknown keys are dropped');
select room_sync_report(:'rid', '{"samples":999}'::jsonb);
select t_ok((select count(*) from room_playback_log where room_id=:'rid' and event='sync_stats') = 1, 'rate limited: one periodic report per 20 s per member');
select room_sync_report(:'rid', '{"reconnects":1,"reconnect_ok":1,"reconnect_attempts":3,"away_ms":9000}'::jsonb);
select t_ok((select count(*) from room_playback_log where room_id=:'rid' and event='sync_stats') = 1, 'a reconnect report right after a periodic one is also throttled (2 s floor)');
select pg_sleep(2.1);
select room_sync_report(:'rid', '{"reconnects":1,"reconnect_ok":1,"reconnect_attempts":3,"away_ms":9000}'::jsonb);
select t_ok((select count(*) from room_playback_log where room_id=:'rid' and event='sync_stats') = 2, 'reconnect reports are only throttled to 2 s, so they are not lost behind the 20 s limit');
select room_sync_report(:'rid', '{"samples":-5,"median_drift":99999999999}'::jsonb);   -- throttled; only proves it does not raise
select t_as(:C); select room_sync_report(:'rid', '{"samples":5}'::jsonb);
select t_ok((select count(*) from room_playback_log where room_id=:'rid' and event='sync_stats') = 2, 'non-members cannot write stats');
select t_as(:B); select room_sync_report(:'rid', '"nope"'::jsonb); select room_sync_report(:'rid', '{"evil":1}'::jsonb);
select t_ok((select count(*) from room_playback_log where room_id=:'rid' and event='sync_stats') = 2, 'malformed / empty reports are ignored');
select t_as(null); select t_err($$select room_sync_report('$$||:'rid'||$$', '{"samples":1}'::jsonb)$$, 'sign in required');

-- metrics view: closed to clients, correct for operators
select t_as(:B); set role authenticated;
select t_err($$select * from public.room_sync_metrics_daily$$, 'permission denied');
reset role;
select t_ok((select member_sessions from public.room_sync_metrics_daily) = 1, 'metrics: one member-session');
select t_ok((select median_drift_s from public.room_sync_metrics_daily) = 0.31, 'metrics: median drift');
select t_ok((select desync_actions_per_1000 from public.room_sync_metrics_daily) = 1000.0, 'metrics: manual resyncs per 1,000 member-sessions (1 press / 1 session)');
select t_ok((select reconnect_success_rate from public.room_sync_metrics_daily) = 1.000, 'metrics: reconnect success rate');
\echo ALL SYNC SQL TESTS PASSED
