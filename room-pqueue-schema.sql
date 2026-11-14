-- =====================================================================
-- Personal watch queue (per member, per room).  Run AFTER rooms-schema.sql.
--   * room_pqueue    : each member's own pending videos, in their own order.  PRIVATE: RLS on, no client policy,
--                      every read/write goes through the pq_* functions below, which only ever touch auth.uid()'s rows.
--   * room_pq_active : the ONE video a member currently has in the room vote (so the next one waits).
-- Retention: rows are kept while the member is away (leave + rejoin keeps the queue) and are deleted with the room
-- (on delete cascade; closed rooms are removed by _room_sweep_all one hour after they close).
-- Voting: pq_submit hands the member's FIRST pending video to the existing public.room_pick(), so Let's vote / Autoplay /
-- Just play / Leader's choice rules, limits and the synced player are exactly the ones every other pick uses.
-- =====================================================================
create table if not exists public.room_pqueue (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  media      jsonb not null,
  pos        double precision not null default (extract(epoch from clock_timestamp()) * 1000),
  created_at timestamptz not null default now()
);
create index if not exists room_pqueue_user_idx on public.room_pqueue(room_id, user_id, pos);

create table if not exists public.room_pq_active (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  queue_id  uuid,
  media     jsonb not null,
  media_ver int  not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_pqueue    enable row level security;
alter table public.room_pq_active enable row level security;
revoke all on public.room_pqueue, public.room_pq_active from public, anon, authenticated;

-- membership + open room check shared by every pq_* function
create or replace function public._pq_guard(p_room uuid) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into r from public.rooms where id = p_room and status = 'open';
  if r.id is null then raise exception 'Room is closed'; end if;
  if not exists(select 1 from public.room_members where room_id = p_room and user_id = auth.uid()) then
    raise exception 'Join the room first'; end if;
  return r;
end $$;

-- the previous submission is finished once its video left Up next (played / removed) or another video has started since
create or replace function public._pq_settle(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.room_pq_active; r public.rooms;
begin
  select * into a from public.room_pq_active where room_id = p_room and user_id = p_user;
  if a.room_id is null then return; end if;
  select * into r from public.rooms where id = p_room;
  if r.id is null or r.media_ver <> a.media_ver
     or a.queue_id is null or not exists(select 1 from public.room_queue where id = a.queue_id) then
    delete from public.room_pq_active where room_id = p_room and user_id = p_user;
  end if;
end $$;

create or replace function public.pq_list(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; a public.room_pq_active; items jsonb;
begin
  r := public._pq_guard(p_room);
  perform public._pq_settle(p_room, uid);
  select * into a from public.room_pq_active where room_id = p_room and user_id = uid;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'media', media) order by pos, created_at), '[]'::jsonb)
    into items from public.room_pqueue where room_id = p_room and user_id = uid;
  return jsonb_build_object('items', items,
    'active', case when a.room_id is null then null else jsonb_build_object('media', a.media, 'queue_id', a.queue_id) end,
    'mode', r.playback_mode);
end $$;

-- add many (or one) videos: [{kind:'youtube',id,title,thumb,...}, ...].  Duplicates (already in MY queue, or already
-- submitted and still in the vote) are skipped, never added twice.  Max 500 pending per member.
create or replace function public.pq_add(p_room uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); x jsonb; m jsonb; n int; added int := 0; dup int := 0; bad int := 0; base double precision; a public.room_pq_active;
begin
  perform public._pq_guard(p_room);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Nothing to add'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'Add up to 500 videos at a time'; end if;
  perform pg_advisory_xact_lock(hashtext(p_room::text || uid::text));
  perform public._pq_settle(p_room, uid);
  select * into a from public.room_pq_active where room_id = p_room and user_id = uid;
  select coalesce(max(pos), extract(epoch from clock_timestamp()) * 1000) into base
    from public.room_pqueue where room_id = p_room and user_id = uid;
  select count(*) into n from public.room_pqueue where room_id = p_room and user_id = uid;
  for x in select * from jsonb_array_elements(p_items) loop
    begin
      m := public._clean_media(x);
    exception when others then m := null; end;
    if m is null then bad := bad + 1; continue; end if;
    -- channel + duration are display-only extras for MY list (room_pick strips them again)
    if coalesce(x->>'ch','') <> '' then m := m || jsonb_build_object('ch', left(x->>'ch', 80)); end if;
    if coalesce(x->>'d','') ~ '^[0-9:]{1,9}$' then m := m || jsonb_build_object('d', x->>'d'); end if;
    if exists(select 1 from public.room_pqueue where room_id = p_room and user_id = uid and public._media_same(media, m))
       or (a.room_id is not null and public._media_same(a.media, m)) then dup := dup + 1; continue; end if;
    if n >= 500 then raise exception 'Your queue is full (500 videos)'; end if;
    base := base + 1000; n := n + 1; added := added + 1;
    insert into public.room_pqueue(room_id, user_id, media, pos) values (p_room, uid, m, base);
  end loop;
  return jsonb_build_object('added', added, 'duplicates', dup, 'invalid', bad, 'total', n);
end $$;

create or replace function public.pq_remove(p_room uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._pq_guard(p_room);
  delete from public.room_pqueue where id = p_id and room_id = p_room and user_id = auth.uid();
end $$;

create or replace function public.pq_clear(p_room uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public._pq_guard(p_room);
  delete from public.room_pqueue where room_id = p_room and user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- drag & drop / keyboard: the full new order of MY pending ids. Unknown ids are ignored; ids left out keep their
-- relative order after the listed ones.  Only my own rows can change.
create or replace function public.pq_reorder(p_room uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public._pq_guard(p_room);
  perform pg_advisory_xact_lock(hashtext(p_room::text || uid::text));
  update public.room_pqueue q set pos = o.rn * 1000
  from (select id, row_number() over (order by coalesce(array_position(p_ids, id), 2147483647), pos, created_at) as rn
          from public.room_pqueue where room_id = p_room and user_id = uid) o
  where q.id = o.id;
end $$;

-- submit MY first pending video to the room.  One at a time: refused while my previous video is still in the vote.
-- Items already playing / already in Up next are dropped from my queue and the next one is tried.
create or replace function public.pq_submit(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; it public.room_pqueue; res jsonb; qid uuid; a public.room_pq_active; ver int;
begin
  r := public._pq_guard(p_room);
  perform pg_advisory_xact_lock(hashtext(p_room::text || uid::text));
  select * into r from public.rooms where id = p_room and status = 'open' for update;
  perform public._pq_settle(p_room, uid);
  select * into a from public.room_pq_active where room_id = p_room and user_id = uid;
  if a.room_id is not null then raise exception 'Your previous video is still in the vote'; end if;
  loop
    select * into it from public.room_pqueue where room_id = p_room and user_id = uid order by pos, created_at limit 1;
    if it.id is null then raise exception 'Your queue is empty'; end if;
    exit when not ((r.media is not null and public._media_same(it.media, r.media) and not coalesce((r.play_state->>'ended')::boolean, false))
                   or exists(select 1 from public.room_queue where room_id = p_room and public._media_same(media, it.media)));
    delete from public.room_pqueue where id = it.id;           -- already playing / already in Up next
  end loop;
  res := public.room_pick(p_room, it.media, false);
  delete from public.room_pqueue where id = it.id;
  if res->>'action' = 'queued' then
    qid := nullif(res->>'id', '')::uuid;
    select media_ver into ver from public.rooms where id = p_room;
    insert into public.room_pq_active(room_id, user_id, queue_id, media, media_ver)
      values (p_room, uid, qid, it.media, ver)
      on conflict (room_id, user_id) do update set queue_id = excluded.queue_id, media = excluded.media, media_ver = excluded.media_ver, created_at = now();
  end if;
  return res || jsonb_build_object('title', it.media->>'title');
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('pq_list','pq_add','pq_remove','pq_clear','pq_reorder','pq_submit') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_pq_guard','_pq_settle') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
notify pgrst, 'reload schema';
