-- ============================================================================
-- Nova watch-party rooms  —  run ONCE in Supabase → SQL editor (safe to re-run)
-- Needs: auth.users, public.friendships(user_id,friend_id,status), public.public_profiles view
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                       -- invite code (auto created)
  admin_id      uuid not null references auth.users(id) on delete cascade,
  title         text not null default 'Nova room',
  privacy       text not null default 'public'  check (privacy in ('public','nearby','friends','invite')),
  playback_mode text not null default 'vote'    check (playback_mode in ('vote','play','autoplay','leader')),
  voice_enabled boolean not null default true,
  lat           double precision,
  lng           double precision,
  media         jsonb,                                      -- {kind,id,pl,url,title,thumb,provider,duration}
  media_ver     int  not null default 0,
  play_state    jsonb not null default '{"playing":false,"pos":0,"ts":0,"seq":0,"idx":0}'::jsonb,
  status        text not null default 'open' check (status in ('open','closed')),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists rooms_status_idx on public.rooms(status, created_at desc);

create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  mic_allowed boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_members add column if not exists mic_allowed boolean not null default false;
-- a user is in ONE room at a time and is listed ONCE (even with several tabs)
create unique index if not exists room_members_one_room on public.room_members(user_id);

create table if not exists public.room_bans (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (room_id, user_id)
);

create table if not exists public.room_invites (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_queue (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  added_by   uuid references auth.users(id) on delete set null,
  media      jsonb not null,
  votes      uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists room_queue_room_idx on public.room_queue(room_id, created_at);

create table if not exists public.room_messages (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null default 'chat' check (kind in ('chat','system')),
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists room_messages_room_idx on public.room_messages(room_id, created_at desc);

create table if not exists public.room_reports (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (reason in ('harassment','hate_speech','spam','inappropriate','safety','other')),
  details     text not null default '' check (char_length(details) <= 1000),
  created_at  timestamptz not null default now(),
  check (reporter_id <> reported_id)
);

-- rooms a user removed from their own home list (Delete) or whose invite they cancelled.
-- A dismissed room stays hidden until somebody invites that user again (room_invite clears it).
create table if not exists public.room_dismissed (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- "Report video" from a room card (long-press / right-click). media is a snapshot of what was playing.
create table if not exists public.room_video_reports (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  media       jsonb,
  reason      text not null check (reason in ('sexual','violent','hateful','spam','copyright','misleading','other')),
  details     text not null default '' check (char_length(details) <= 1000),
  created_at  timestamptz not null default now()
);
create index if not exists room_video_reports_idx on public.room_video_reports(reporter_id, created_at desc);

-- ---------- row level security (reads only; ALL writes go through the RPCs below) ----------
create or replace function public.is_room_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.room_members where room_id = rid and user_id = auth.uid())
$$;

alter table public.rooms         enable row level security;
alter table public.room_members  enable row level security;
alter table public.room_bans     enable row level security;
alter table public.room_invites  enable row level security;
alter table public.room_queue    enable row level security;
alter table public.room_messages enable row level security;
alter table public.room_reports  enable row level security;
revoke all on public.room_reports from public, anon, authenticated;
alter table public.room_dismissed enable row level security;
revoke all on public.room_dismissed from public, anon, authenticated;
alter table public.room_video_reports enable row level security;
revoke all on public.room_video_reports from public, anon, authenticated;

drop policy if exists rooms_member_select    on public.rooms;
drop policy if exists members_member_select  on public.room_members;
drop policy if exists queue_member_select    on public.room_queue;
drop policy if exists msgs_member_select     on public.room_messages;
drop policy if exists msgs_member_insert     on public.room_messages;
drop policy if exists invites_own_select     on public.room_invites;

create policy rooms_member_select   on public.rooms         for select to authenticated using (public.is_room_member(id));
create policy members_member_select on public.room_members  for select to authenticated using (public.is_room_member(room_id));
create policy queue_member_select   on public.room_queue    for select to authenticated using (public.is_room_member(room_id));
create policy msgs_member_select    on public.room_messages for select to authenticated using (public.is_room_member(room_id));
create policy msgs_member_insert    on public.room_messages for insert to authenticated
  with check (user_id = auth.uid() and kind = 'chat' and public.is_room_member(room_id));
create policy invites_own_select    on public.room_invites  for select to authenticated
  using (user_id = auth.uid() or invited_by = auth.uid());

-- ---------- internal helpers ----------
create or replace function public.room_now() returns bigint language sql stable as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

create or replace function public._is_friend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.user_id = a and f.friend_id = b) or (f.user_id = b and f.friend_id = a)))
$$;

create or replace function public._sys(rid uuid, uid uuid, txt text) returns void
language sql security definer set search_path = public as $$
  insert into public.room_messages(room_id, user_id, kind, body) values (rid, uid, 'system', txt)
$$;

-- validates + normalises media coming from clients (blocks javascript:, data:, huge strings…)
create or replace function public._clean_media(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; u text; r jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  k := p->>'kind';
  if k is null or k not in ('youtube','video','embed') then raise exception 'Unsupported media'; end if;
  r := jsonb_build_object('kind', k,
        'title', left(coalesce(nullif(p->>'title',''), 'Video'), 160),
        'provider', left(coalesce(nullif(p->>'provider',''), k), 20));
  if k = 'youtube' then
    if coalesce(p->>'id','') <> '' then
      if p->>'id' !~ '^[A-Za-z0-9_-]{6,20}$' then raise exception 'Bad video id'; end if;
      r := r || jsonb_build_object('id', p->>'id');
    end if;
    if coalesce(p->>'pl','') <> '' then
      if p->>'pl' !~ '^[A-Za-z0-9_-]{10,64}$' then raise exception 'Bad playlist id'; end if;
      r := r || jsonb_build_object('pl', p->>'pl');
    end if;
    if r->>'id' is null and r->>'pl' is null then raise exception 'Missing video'; end if;
    if coalesce(p->>'live','') = 'true' then r := r || '{"live":true}'::jsonb; end if;
  else
    u := p->>'url';
    if u is null or length(u) > 1000 or u !~ '^https://[^\s<>"'']+$' then raise exception 'Invalid link'; end if;
    r := r || jsonb_build_object('url', u);
  end if;
  u := p->>'thumb';
  if u is not null and length(u) <= 500 and u ~ '^https://[^\s<>"'']+$' then
    r := r || jsonb_build_object('thumb', u);
  end if;
  return r;
end $$;

create or replace function public._set_media(rid uuid, m jsonb) returns void
language sql security definer set search_path = public as $$
  update public.rooms set media = m, media_ver = media_ver + 1,
    play_state = jsonb_build_object('playing', true, 'pos', 0, 'ts', public.room_now(),
                   'seq', coalesce((play_state->>'seq')::int, 0) + 1, 'idx', 0)
  where id = rid
$$;

-- remove a member; hand admin to the longest-staying member; close the room when nobody is left
create or replace function public._room_drop_member(rid uuid, uid uuid, txt text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; nxt uuid;
begin
  delete from public.room_members where room_id = rid and user_id = uid;
  if not found then return; end if;
  if txt is not null then perform public._sys(rid, uid, txt); end if;
  select * into r from public.rooms where id = rid;
  if r.id is null then return; end if;
  if r.admin_id = uid then
    select user_id into nxt from public.room_members where room_id = rid order by joined_at asc limit 1;
    if nxt is not null then
      update public.rooms set admin_id = nxt where id = rid;
      perform public._sys(rid, nxt, 'is now the admin');
    end if;
  end if;
  if not exists(select 1 from public.room_members where room_id = rid) then
    update public.rooms set status = 'closed', closed_at = now() where id = rid and status = 'open';
    delete from public.room_queue where room_id = rid;
  end if;
end $$;

-- drop members whose browser went quiet (no heartbeat for 90s)
create or replace function public._room_sweep(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from public.room_members
           where room_id = rid and last_seen < now() - interval '90 seconds' loop
    perform public._room_drop_member(rid, u, 'left');
  end loop;
end $$;

create or replace function public._room_sweep_all() returns void
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  for rid in select id from public.rooms where status = 'open' loop
    perform public._room_sweep(rid);
  end loop;
  delete from public.rooms where status = 'closed' and closed_at < now() - interval '1 hour';
end $$;

create or replace function public._room_next(rid uuid, qid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it public.room_queue; md text;
begin
  select playback_mode into md from public.rooms where id = rid;
  if qid is not null then
    select * into it from public.room_queue where id = qid and room_id = rid;
  else
    select * into it from public.room_queue where room_id = rid
      order by case when md = 'vote' then cardinality(votes) else 0 end desc, created_at asc limit 1;
  end if;
  if it.id is null then return null; end if;
  delete from public.room_queue where id = it.id;
  perform public._set_media(rid, it.media);
  return it.media;
end $$;

-- ---------- public RPCs ----------
create or replace function public.create_room(
  p_title text, p_privacy text default 'public', p_media jsonb default null,
  p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rid uuid; x uuid; c text; m jsonb; n int := 0;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if p_privacy not in ('public','nearby','friends','invite') then raise exception 'Bad privacy'; end if;
  m := public._clean_media(p_media);
  for x in select room_id from public.room_members where user_id = uid loop
    perform public._room_drop_member(x, uid, 'left');
  end loop;
  loop
    c := substr(md5(random()::text || clock_timestamp()::text || uid::text), 1, 8);
    exit when not exists(select 1 from public.rooms where code = c);
    n := n + 1; if n > 10 then raise exception 'Try again'; end if;
  end loop;
  insert into public.rooms(code, admin_id, title, privacy, media, media_ver, play_state, lat, lng)
  values (c, uid, left(coalesce(nullif(trim(p_title), ''), 'Nova room'), 80), p_privacy, m,
          case when m is null then 0 else 1 end,
          jsonb_build_object('playing', m is not null, 'pos', 0, 'ts', public.room_now(), 'seq', 1, 'idx', 0),
          p_lat, p_lng)
  returning id into rid;
  insert into public.room_members(room_id, user_id) values (rid, uid);
  perform public._sys(rid, uid, 'created the room');
  return (select to_jsonb(r) from public.rooms r where r.id = rid);
end $$;

create or replace function public.join_room(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; x uuid;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into r from public.rooms where code = trim(p_code);
  if r.id is null then raise exception 'Room not found'; end if;
  perform public._room_sweep(r.id);
  select * into r from public.rooms where id = r.id;
  if r.status <> 'open' then raise exception 'This room is closed'; end if;
  if exists(select 1 from public.room_bans where room_id = r.id and user_id = uid) then
    raise exception 'You were removed from this room';
  end if;
  if exists(select 1 from public.room_members where room_id = r.id and user_id = uid) then
    update public.room_members set last_seen = now() where room_id = r.id and user_id = uid;
    return to_jsonb(r);
  end if;
  if r.privacy = 'friends' and r.admin_id <> uid
     and not (public._is_friend(uid, r.admin_id)
              or exists(select 1 from public.room_invites where room_id = r.id and user_id = uid)) then
    raise exception 'This room is for the host''s friends only';
  end if;
  if r.privacy = 'invite' and r.admin_id <> uid
     and not exists(select 1 from public.room_invites where room_id = r.id and user_id = uid) then
    raise exception 'This room is invite only';
  end if;
  if (select count(*) from public.room_members where room_id = r.id) >= 50 then
    raise exception 'This room is full';
  end if;
  for x in select room_id from public.room_members where user_id = uid loop
    perform public._room_drop_member(x, uid, 'left');
  end loop;
  insert into public.room_members(room_id, user_id) values (r.id, uid);
  perform public._sys(r.id, uid, 'joined');
  return to_jsonb(r);
end $$;

create or replace function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  perform public._room_drop_member(p_room, auth.uid(), 'left');
end $$;

create or replace function public.room_heartbeat(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  update public.room_members set last_seen = now() where room_id = p_room and user_id = uid;
  perform public._room_sweep(p_room);
  select * into r from public.rooms where id = p_room;
  return jsonb_build_object(
    'member', exists(select 1 from public.room_members where room_id = p_room and user_id = uid),
    'status', coalesce(r.status, 'closed'),
    'admin_id', r.admin_id);
end $$;

-- admin only: play / pause / seek
create or replace function public.room_set_state(
  p_room uuid, p_playing boolean, p_pos double precision,
  p_idx int default null, p_duration double precision default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.rooms set
    play_state = jsonb_build_object('playing', p_playing, 'pos', greatest(coalesce(p_pos, 0), 0),
                   'ts', public.room_now(), 'seq', coalesce((play_state->>'seq')::int, 0) + 1,
                   'idx', coalesce(p_idx, (play_state->>'idx')::int, 0)),
    media = case when p_duration is not null and p_duration > 0 and media is not null
                 then media || jsonb_build_object('duration', p_duration) else media end
  where id = p_room and admin_id = auth.uid() and status = 'open';
  if not found then raise exception 'Only the room admin can do this'; end if;
end $$;

-- choose a video. Server decides: play now, or add to the queue, by playback mode + role
create or replace function public.room_pick(p_room uuid, p_media jsonb, p_now boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; m jsonb; n int; isadm boolean;
        ended boolean; voting boolean; direct boolean;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into r from public.rooms where id = p_room and status = 'open';
  if r.id is null then raise exception 'Room is closed'; end if;
  if not exists(select 1 from public.room_members where room_id = p_room and user_id = uid) then
    raise exception 'Join the room first'; end if;
  m := public._clean_media(p_media);
  if m is null then raise exception 'Nothing to play'; end if;
  isadm  := (r.admin_id = uid);
  ended  := (r.media is null) or coalesce((r.play_state->>'ended')::boolean, false);
  voting := (r.play_state->'vote_until') is not null;
  if not isadm and r.playback_mode = 'leader' then raise exception 'Only the room admin can pick videos'; end if;
  direct := (isadm and (p_now or r.playback_mode in ('leader','play')))
         or ((not isadm) and r.playback_mode = 'play')
         or (ended and not voting);
  if direct then
    perform public._set_media(p_room, m);
    return jsonb_build_object('action', 'played');
  end if;
  select count(*) into n from public.room_queue where room_id = p_room;
  if n >= 30 then raise exception 'The queue is full'; end if;
  select count(*) into n from public.room_queue where room_id = p_room and added_by = uid;
  if n >= 6 and not isadm then raise exception 'You already have 6 videos in the queue'; end if;
  insert into public.room_queue(room_id, added_by, media, votes) values (p_room, uid, m, array[uid]);
  return jsonb_build_object('action', 'queued');
end $$;

-- admin only: the current video finished
create or replace function public.room_ended(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; q int;
begin
  select * into r from public.rooms where id = p_room and admin_id = uid and status = 'open';
  if r.id is null then raise exception 'Only the room admin can do this'; end if;
  if coalesce((r.play_state->>'ended')::boolean, false) then return jsonb_build_object('next', false); end if;
  select count(*) into q from public.room_queue where room_id = p_room;
  if q > 0 and r.playback_mode = 'autoplay' then
    perform public._room_next(p_room, null);
    return jsonb_build_object('next', true);
  end if;
  update public.rooms set play_state =
      jsonb_build_object('playing', false, 'pos', 0, 'ts', public.room_now(),
        'seq', coalesce((play_state->>'seq')::int, 0) + 1, 'idx', 0, 'ended', true)
      || case when q > 0 and r.playback_mode = 'vote'
              then jsonb_build_object('vote_until', public.room_now() + 12000) else '{}'::jsonb end
  where id = p_room;
  return jsonb_build_object('next', false);
end $$;

-- admin: skip / play a queued item. Anyone: pick the winner once the vote timer has expired (admin offline)
create or replace function public.room_advance(p_room uuid, p_queue_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; vu bigint; nx jsonb;
begin
  select * into r from public.rooms where id = p_room and status = 'open';
  if r.id is null then raise exception 'Room is closed'; end if;
  if not exists(select 1 from public.room_members where room_id = p_room and user_id = uid) then
    raise exception 'Join the room first'; end if;
  vu := (r.play_state->>'vote_until')::bigint;
  if r.admin_id <> uid then
    if p_queue_id is not null or vu is null or public.room_now() < vu + 3000 then
      raise exception 'Only the room admin can do this';
    end if;
  end if;
  nx := public._room_next(p_room, p_queue_id);
  if nx is null then
    update public.rooms set play_state = (play_state - 'vote_until')
      || jsonb_build_object('seq', coalesce((play_state->>'seq')::int, 0) + 1,
                            'ended', true, 'playing', false, 'ts', public.room_now())
    where id = p_room;
  end if;
  return jsonb_build_object('played', nx is not null);
end $$;

create or replace function public.room_vote(p_queue_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.room_queue set votes =
    case when auth.uid() = any(votes) then array_remove(votes, auth.uid()) else votes || auth.uid() end
  where id = p_queue_id and public.is_room_member(room_id);
end $$;

create or replace function public.room_queue_remove(p_queue_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.room_queue q
  where q.id = p_queue_id
    and (q.added_by = auth.uid()
         or exists(select 1 from public.rooms r where r.id = q.room_id and r.admin_id = auth.uid()));
end $$;

create or replace function public.room_update(
  p_room uuid, p_title text default null, p_privacy text default null, p_mode text default null,
  p_voice boolean default null, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms;
begin
  select * into r from public.rooms where id = p_room and admin_id = uid and status = 'open';
  if r.id is null then raise exception 'Only the room admin can do this'; end if;
  if p_privacy is not null and p_privacy not in ('public','nearby','friends','invite') then raise exception 'Bad privacy'; end if;
  if p_mode is not null and p_mode not in ('vote','play','autoplay','leader') then raise exception 'Bad mode'; end if;
  update public.rooms set
    title         = left(coalesce(nullif(trim(p_title), ''), title), 80),
    privacy       = coalesce(p_privacy, privacy),
    playback_mode = coalesce(p_mode, playback_mode),
    voice_enabled = coalesce(p_voice, voice_enabled),
    lat = case when coalesce(p_privacy, privacy) = 'nearby' and p_lat is not null then p_lat else lat end,
    lng = case when coalesce(p_privacy, privacy) = 'nearby' and p_lng is not null then p_lng else lng end
  where id = p_room;
  return (select to_jsonb(x) from public.rooms x where x.id = p_room);
end $$;

create or replace function public.room_transfer(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not exists(select 1 from public.rooms where id = p_room and admin_id = uid and status = 'open') then
    raise exception 'Only the room admin can do this'; end if;
  if p_user = uid then raise exception 'You are already the admin'; end if;
  if not exists(select 1 from public.room_members where room_id = p_room and user_id = p_user) then
    raise exception 'That person is not in the room'; end if;
  update public.rooms set admin_id = p_user where id = p_room;
  perform public._sys(p_room, p_user, 'is now the admin');
end $$;

create or replace function public.room_kick(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not exists(select 1 from public.rooms where id = p_room and admin_id = uid and status = 'open') then
    raise exception 'Only the room admin can do this'; end if;
  if p_user = uid then raise exception 'Use Leave instead'; end if;
  delete from public.room_invites where room_id = p_room and user_id = p_user;
  insert into public.room_bans(room_id, user_id) values (p_room, p_user) on conflict do nothing;
  perform public._room_drop_member(p_room, p_user, 'was removed');
end $$;

create or replace function public.room_invite(p_room uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u uuid; n int := 0; owner_id uuid;
begin
  if not exists(select 1 from public.room_members where room_id = p_room and user_id = uid) then
    raise exception 'Join the room first'; end if;
  select admin_id into owner_id from public.rooms where id = p_room and status = 'open';
  if owner_id is null then raise exception 'Room is closed'; end if;
  foreach u in array coalesce(p_users, '{}') loop
    if u <> uid and public._is_friend(uid, u)
       and not exists(select 1 from public.room_members where room_id = p_room and user_id = u) then
      if exists(select 1 from public.room_bans where room_id = p_room and user_id = u) then
        if uid <> owner_id then raise exception 'Only the admin can invite someone removed from this room'; end if;
        delete from public.room_bans where room_id = p_room and user_id = u;
      end if;
      delete from public.room_dismissed where room_id = p_room and user_id = u;   -- a new invite brings the room back
      insert into public.room_invites(room_id, user_id, invited_by) values (p_room, u, uid) on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.room_can_mic(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = auth.uid()
    where r.id = p_room and r.status = 'open' and r.voice_enabled
      and (r.admin_id = auth.uid() or r.privacy = 'public' or m.mic_allowed)
  )
$$;

create or replace function public.room_set_member_mic(p_room uuid, p_user uuid, p_allowed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.rooms where id = p_room and admin_id = uid and status = 'open') then
    raise exception 'Only the room admin can change microphone access';
  end if;
  if p_user = uid then raise exception 'The admin microphone is always available'; end if;
  update public.room_members set mic_allowed = coalesce(p_allowed, false)
  where room_id = p_room and user_id = p_user;
  if not found then raise exception 'That person is not in the room'; end if;
end $$;

create or replace function public.room_report_user(
  p_room uuid, p_user uuid, p_reason text, p_details text default '')
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if p_user is null or p_user = uid then raise exception 'Choose another room member'; end if;
  if p_reason is null or p_reason not in ('harassment','hate_speech','spam','inappropriate','safety','other') then
    raise exception 'Choose a valid report reason';
  end if;
  if not exists(select 1 from public.room_members where room_id = p_room and user_id = uid)
     or not exists(select 1 from public.room_members where room_id = p_room and user_id = p_user) then
    raise exception 'Both users must be in the room to report';
  end if;
  insert into public.room_reports(room_id, reporter_id, reported_id, reason, details)
  values (p_room, uid, p_user, p_reason, left(trim(coalesce(p_details, '')), 1000));
end $$;

-- Delete / Cancel invite: remove a room from MY home list. Any invite to me is deleted too, and the
-- room stays hidden until I am invited again.
create or replace function public.room_dismiss(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.rooms where id = p_room) then raise exception 'Room not found'; end if;
  delete from public.room_invites where room_id = p_room and user_id = uid;
  insert into public.room_dismissed(room_id, user_id) values (p_room, uid) on conflict do nothing;
end $$;

-- Report the video that is playing in a room (the reporter does not need to be inside the room).
create or replace function public.room_report_video(p_room uuid, p_reason text, p_details text default '')
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m jsonb;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if p_reason is null or p_reason not in ('sexual','violent','hateful','spam','copyright','misleading','other') then
    raise exception 'Choose a valid report reason';
  end if;
  select media into m from public.rooms where id = p_room;
  if not found then raise exception 'Room not found'; end if;
  if m is null then raise exception 'This room has no video to report'; end if;
  if (select count(*) from public.room_video_reports
       where reporter_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many reports. Please try again later.';
  end if;
  insert into public.room_video_reports(room_id, reporter_id, media, reason, details)
  values (p_room, uid, m, p_reason, left(trim(coalesce(p_details, '')), 1000));
end $$;

create or replace function public.public_room_for_user(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null or p_user is null then return null; end if;
  select jsonb_build_object(
    'id', r.id, 'code', r.code, 'title', r.title, 'admin_id', r.admin_id,
    'media', r.media,
    'count', (select count(*) from public.room_members all_members where all_members.room_id = r.id),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'username', p.username,
        'avatar_url', p.avatar_url, 'is_admin', p.id = r.admin_id,
        'country_code', p.country_code, 'city', p.city, 'region', p.region, 'lat', p.location_lat, 'lng', p.location_lng
      ) order by ordered.joined_at), '[]'::jsonb)
      from (
        select user_id, joined_at from public.room_members
        where room_id = r.id order by joined_at
      ) ordered
      join public.public_profiles p on p.id = ordered.user_id
    )
  ) into result
  from public.rooms r
  join public.room_members target on target.room_id = r.id and target.user_id = p_user
  where r.status = 'open' and r.privacy = 'public'
  limit 1;
  return result;
end $$;

-- rooms the caller may see on the Nova home screen
create or replace function public.list_rooms(p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return '[]'::jsonb; end if;
  perform public._room_sweep_all();
  return coalesce((
    select jsonb_agg(t.j order by t.created_at desc) from (
      select r.created_at,
        jsonb_build_object(
          'id', r.id, 'code', r.code, 'title', r.title, 'privacy', r.privacy, 'media', r.media,
          'play_state', r.play_state, 'admin_id', r.admin_id, 'created_at', r.created_at,
          'count', (select count(*) from public.room_members m where m.room_id = r.id),
          'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name,
                              'username', p.username, 'avatar_url', p.avatar_url, 'country_code', p.country_code) order by s.joined_at), '[]'::jsonb)
                      from (select user_id, joined_at from public.room_members mm
                            where mm.room_id = r.id order by joined_at limit 8) s
                      join public.public_profiles p on p.id = s.user_id),
          'invited', exists(select 1 from public.room_invites i where i.room_id = r.id and i.user_id = uid),
          'mine', exists(select 1 from public.room_members mm where mm.room_id = r.id and mm.user_id = uid)
        ) as j
      from public.rooms r
      where r.status = 'open'
        and not exists(select 1 from public.room_dismissed d where d.room_id = r.id and d.user_id = uid)
        and (
            r.privacy = 'public'
         or exists(select 1 from public.room_invites i where i.room_id = r.id and i.user_id = uid)
         or (r.privacy = 'friends' and public._is_friend(uid, r.admin_id))
         or (r.privacy = 'nearby' and p_lat is not null and p_lng is not null
             and r.lat is not null and r.lng is not null
             and 6371 * 2 * asin(sqrt(
                   power(sin(radians(r.lat - p_lat) / 2), 2)
                   + cos(radians(p_lat)) * cos(radians(r.lat)) * power(sin(radians(r.lng - p_lng) / 2), 2))) <= 50)
      )
    ) t
  ), '[]'::jsonb);
end $$;

-- ---------- permissions ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('room_now','is_room_member','create_room','join_room','leave_room','room_heartbeat',
                               'room_set_state','room_pick','room_ended','room_advance','room_vote','room_queue_remove',
                               'room_update','room_transfer','room_kick','room_invite','room_can_mic',
                               'room_set_member_mic','room_report_user','room_dismiss','room_report_video','public_room_for_user','list_rooms') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('_is_friend','_sys','_clean_media','_set_media','_room_drop_member',
                               '_room_sweep','_room_sweep_all','_room_next') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant select on public.rooms, public.room_members, public.room_queue, public.room_invites to authenticated;
grant select, insert on public.room_messages to authenticated;

-- ---------- realtime ----------
do $$
declare t text;
begin
  foreach t in array array['rooms','room_members','room_queue','room_messages'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- OPTIONAL: close empty/abandoned rooms even when nobody is online ----------
-- Supabase → Database → Extensions → enable pg_cron, then run:
--   select cron.schedule('nova-room-sweep', '* * * * *', $$select public._room_sweep_all()$$);
