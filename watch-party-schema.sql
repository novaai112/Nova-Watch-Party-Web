-- Realtime watch rooms with server-enforced host/admin permissions.
-- Run after schema.sql and chat-schema.sql in the Supabase SQL Editor.

create table if not exists public.watch_rooms (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  visibility text not null default 'invite'
    check (visibility in ('public', 'friends', 'invite')),
  current_source text check (current_source is null or current_source in ('youtube', 'direct')),
  current_url text,
  current_title text,
  is_playing boolean not null default false,
  position_seconds double precision not null default 0
    check (position_seconds >= 0 and position_seconds <= 86400),
  playback_updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((current_source is null and current_url is null)
      or (current_source is not null and current_url is not null))
);

create table if not exists public.watch_room_members (
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.watch_room_invites (
  code text primary key,
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0)
);

create table if not exists public.watch_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (length(body) <= 5000),
  check (case when jsonb_typeof(attachments) = 'array'
    then jsonb_array_length(attachments) <= 8 else false end),
  check (length(body) > 0 or case when jsonb_typeof(attachments) = 'array'
    then jsonb_array_length(attachments) > 0 else false end)
);

create index if not exists watch_rooms_public_recent_idx
  on public.watch_rooms (created_at desc) where visibility = 'public';
create index if not exists watch_room_members_user_idx
  on public.watch_room_members (user_id, room_id);
create index if not exists watch_room_messages_recent_idx
  on public.watch_room_messages (room_id, created_at desc);
create index if not exists watch_room_invites_room_idx
  on public.watch_room_invites (room_id, expires_at);

create or replace function public.is_watch_room_member(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select auth.uid() is not null and exists (
    select 1 from public.watch_room_members m
    where m.room_id = p_room_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.watch_room_is_admin(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select auth.uid() is not null and exists (
    select 1 from public.watch_room_members m
    where m.room_id = p_room_id and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.watch_room_create(p_name text, p_visibility text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Room name must be between 1 and 80 characters';
  end if;
  if p_visibility not in ('public', 'friends', 'invite') then
    raise exception 'Invalid room visibility';
  end if;

  insert into public.watch_rooms (created_by, name, visibility)
  values (v_user_id, trim(p_name), p_visibility)
  returning id into v_room_id;

  insert into public.watch_room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'owner');
  return v_room_id;
end;
$$;

create or replace function public.watch_room_join(
  p_room_id uuid,
  p_invite_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_visibility text;
  v_invite_code text;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  select r.visibility into v_visibility
  from public.watch_rooms r where r.id = p_room_id;
  if not found then raise exception 'Room not found'; end if;

  if p_invite_code is not null then
    update public.watch_room_invites i
       set uses = i.uses + 1
     where i.code = p_invite_code
       and i.room_id = p_room_id
       and i.revoked_at is null
       and i.expires_at > now()
       and (i.max_uses is null or i.uses < i.max_uses)
    returning i.code into v_invite_code;
    if v_invite_code is null then raise exception 'Invite link is invalid or expired'; end if;
  elsif v_visibility = 'invite' then
    raise exception 'This room requires a valid invite link';
  elsif v_visibility = 'friends' and not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.user_id = v_user_id and f.friend_id = (select r.created_by from public.watch_rooms r where r.id = p_room_id))
        or (f.friend_id = v_user_id and f.user_id = (select r.created_by from public.watch_rooms r where r.id = p_room_id)))
  ) then
    raise exception 'This room is limited to the host''s friends';
  end if;

  insert into public.watch_room_members (room_id, user_id, role)
  values (p_room_id, v_user_id, 'member')
  on conflict (room_id, user_id) do nothing;
end;
$$;

create or replace function public.watch_room_create_invite(
  p_room_id uuid,
  p_expires_hours integer default 168,
  p_max_uses integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := replace(gen_random_uuid()::text, '-', '');
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if not public.is_watch_room_member(p_room_id) then raise exception 'Room membership required'; end if;
  if p_expires_hours is null or p_expires_hours not between 1 and 720 then
    raise exception 'Invite duration must be between 1 and 720 hours';
  end if;
  if p_max_uses is not null and p_max_uses not between 1 and 500 then
    raise exception 'Invite use limit must be between 1 and 500';
  end if;

  insert into public.watch_room_invites (code, room_id, created_by, expires_at, max_uses)
  values (v_code, p_room_id, v_user_id, now() + make_interval(hours => p_expires_hours), p_max_uses);
  return v_code;
end;
$$;

create or replace function public.watch_room_join_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select i.room_id into v_room_id
  from public.watch_room_invites i
  where i.code = p_code and i.revoked_at is null and i.expires_at > now()
    and (i.max_uses is null or i.uses < i.max_uses);
  if v_room_id is null then raise exception 'Invite link is invalid or expired'; end if;
  perform public.watch_room_join(v_room_id, p_code);
  return v_room_id;
end;
$$;

create or replace function public.watch_room_set_admin(
  p_room_id uuid,
  p_user_id uuid,
  p_make_admin boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.watch_room_members m
    where m.room_id = p_room_id and m.user_id = v_user_id and m.role = 'owner'
  ) then raise exception 'Only the room owner can change admin roles'; end if;
  if p_user_id = v_user_id then raise exception 'The owner role cannot be changed'; end if;

  update public.watch_room_members
     set role = case when p_make_admin then 'admin' else 'member' end
   where room_id = p_room_id and user_id = p_user_id and role <> 'owner';
  if not found then raise exception 'Room member not found'; end if;
end;
$$;

create or replace function public.watch_room_kick(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  select role into v_actor_role from public.watch_room_members
  where room_id = p_room_id and user_id = auth.uid();
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'Admin permission required';
  end if;

  select role into v_target_role from public.watch_room_members
  where room_id = p_room_id and user_id = p_user_id;
  if v_target_role is null or v_target_role = 'owner' then raise exception 'Room member cannot be removed'; end if;
  if v_target_role = 'admin' and v_actor_role <> 'owner' then
    raise exception 'Only the owner can remove an admin';
  end if;

  delete from public.watch_room_members where room_id = p_room_id and user_id = p_user_id;
end;
$$;

create or replace function public.watch_room_leave(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (
    select 1 from public.watch_room_members
    where room_id = p_room_id and user_id = auth.uid() and role = 'owner'
  ) then raise exception 'The owner must delete the room or transfer ownership'; end if;
  delete from public.watch_room_members
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;

create or replace function public.watch_room_delete(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.watch_room_members
    where room_id = p_room_id and user_id = auth.uid() and role = 'owner'
  ) then raise exception 'Only the room owner can delete it'; end if;
  delete from public.watch_rooms where id = p_room_id;
end;
$$;

create or replace function public.watch_room_set_playback(
  p_room_id uuid,
  p_source text,
  p_url text,
  p_title text,
  p_position_seconds double precision,
  p_is_playing boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if not public.watch_room_is_admin(p_room_id) then raise exception 'Only a room admin can control playback'; end if;
  if p_position_seconds is null or p_position_seconds < 0 or p_position_seconds > 86400 then
    raise exception 'Invalid playback position';
  end if;
  if p_source is not null then
    if p_source not in ('youtube', 'direct') or p_url is null
       or p_url !~* '^https://' then raise exception 'Unsupported video source or URL'; end if;
    if p_source = 'youtube' and p_url !~* '^https://(www\.)?(youtube\.com|youtu\.be)/' then
      raise exception 'Use a YouTube video URL';
    end if;
    if p_source = 'direct' and p_url !~* '\.(mp4|webm|mov|ogv)([?#].*)?$' then
      raise exception 'Use a direct MP4, WebM, MOV, or OGV video URL';
    end if;
    if length(coalesce(p_title, '')) > 180 then raise exception 'Video title is too long'; end if;
  elsif p_url is not null then
    raise exception 'A media URL requires a supported source';
  end if;

  update public.watch_rooms
     set current_source = p_source,
         current_url = p_url,
         current_title = case when p_source is null then null else nullif(trim(p_title), '') end,
         position_seconds = p_position_seconds,
         is_playing = coalesce(p_is_playing, false),
         playback_updated_at = now(),
         updated_by = v_user_id,
         updated_at = now()
   where id = p_room_id;
  if not found then raise exception 'Room not found'; end if;
end;
$$;

create or replace function public.watch_room_media_member(p_room_id text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.is_watch_room_member(p_room_id::uuid);
$$;

revoke all on function public.is_watch_room_member(uuid) from public, anon;
revoke all on function public.watch_room_is_admin(uuid) from public, anon;
revoke all on function public.watch_room_create(text, text) from public, anon;
revoke all on function public.watch_room_join(uuid, text) from public, anon;
revoke all on function public.watch_room_create_invite(uuid, integer, integer) from public, anon;
revoke all on function public.watch_room_join_invite(text) from public, anon;
revoke all on function public.watch_room_set_admin(uuid, uuid, boolean) from public, anon;
revoke all on function public.watch_room_kick(uuid, uuid) from public, anon;
revoke all on function public.watch_room_leave(uuid) from public, anon;
revoke all on function public.watch_room_delete(uuid) from public, anon;
revoke all on function public.watch_room_set_playback(uuid, text, text, text, double precision, boolean) from public, anon;
revoke all on function public.watch_room_media_member(text) from public, anon;
grant execute on function public.is_watch_room_member(uuid) to authenticated;
grant execute on function public.watch_room_is_admin(uuid) to authenticated;
grant execute on function public.watch_room_create(text, text) to authenticated;
grant execute on function public.watch_room_join(uuid, text) to authenticated;
grant execute on function public.watch_room_create_invite(uuid, integer, integer) to authenticated;
grant execute on function public.watch_room_join_invite(text) to authenticated;
grant execute on function public.watch_room_set_admin(uuid, uuid, boolean) to authenticated;
grant execute on function public.watch_room_kick(uuid, uuid) to authenticated;
grant execute on function public.watch_room_leave(uuid) to authenticated;
grant execute on function public.watch_room_delete(uuid) to authenticated;
grant execute on function public.watch_room_set_playback(uuid, text, text, text, double precision, boolean) to authenticated;
grant execute on function public.watch_room_media_member(text) to authenticated;

alter table public.watch_rooms enable row level security;
alter table public.watch_room_members enable row level security;
alter table public.watch_room_invites enable row level security;
alter table public.watch_room_messages enable row level security;

drop policy if exists "watch rooms discover and member read" on public.watch_rooms;
create policy "watch rooms discover and member read" on public.watch_rooms
  for select to authenticated
  using (visibility = 'public' or public.is_watch_room_member(id));
drop policy if exists "watch rooms create own" on public.watch_rooms;
create policy "watch rooms create own" on public.watch_rooms
  for insert to authenticated with check (created_by = auth.uid());
revoke all on public.watch_rooms from public, anon, authenticated;
grant select on public.watch_rooms to authenticated;

drop policy if exists "watch room members read members" on public.watch_room_members;
create policy "watch room members read members" on public.watch_room_members
  for select to authenticated using (public.is_watch_room_member(room_id));
revoke all on public.watch_room_members from public, anon, authenticated;
grant select on public.watch_room_members to authenticated;

revoke all on public.watch_room_invites from public, anon, authenticated;

drop policy if exists "watch room messages read members" on public.watch_room_messages;
create policy "watch room messages read members" on public.watch_room_messages
  for select to authenticated using (public.is_watch_room_member(room_id));
drop policy if exists "watch room messages send members" on public.watch_room_messages;
create policy "watch room messages send members" on public.watch_room_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_watch_room_member(room_id));
drop policy if exists "watch room messages delete own or admin" on public.watch_room_messages;
create policy "watch room messages delete own or admin" on public.watch_room_messages
  for delete to authenticated
  using (sender_id = auth.uid() or public.watch_room_is_admin(room_id));
revoke all on public.watch_room_messages from public, anon, authenticated;
grant select, insert, delete on public.watch_room_messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'watch-media', 'watch-media', false, 20971520,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime','video/ogg',
    'audio/mpeg','audio/mp4','audio/ogg','audio/webm','audio/wav','audio/x-wav',
    'application/pdf','text/plain'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "watch media read room members" on storage.objects;
create policy "watch media read room members" on storage.objects
  for select to authenticated
  using (bucket_id = 'watch-media'
    and public.watch_room_media_member((storage.foldername(name))[1]));
drop policy if exists "watch media upload own room" on storage.objects;
create policy "watch media upload own room" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'watch-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.watch_room_media_member((storage.foldername(name))[1]));
drop policy if exists "watch media delete own or admin" on storage.objects;
create policy "watch media delete own or admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'watch-media'
    and ((storage.foldername(name))[2] = auth.uid()::text
      or public.watch_room_is_admin(((storage.foldername(name))[1])::uuid)));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'watch_rooms'
  ) then execute 'alter publication supabase_realtime add table public.watch_rooms'; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'watch_room_members'
  ) then execute 'alter publication supabase_realtime add table public.watch_room_members'; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'watch_room_messages'
  ) then execute 'alter publication supabase_realtime add table public.watch_room_messages'; end if;
end;
$$;
