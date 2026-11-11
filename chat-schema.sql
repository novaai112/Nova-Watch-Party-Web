-- Realtime direct and group chat for the Nova account app.
-- Run after schema.sql in Supabase SQL Editor. Safe to re-run.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  title text check (title is null or length(title) between 1 and 80),
  is_group boolean not null default false,
  direct_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((is_group and direct_key is null) or (not is_group and direct_key is not null))
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null default '',
  mentions uuid[] not null default '{}',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (length(body) <= 5000),
  check (cardinality(mentions) <= 50),
  check (case when jsonb_typeof(attachments) = 'array' then jsonb_array_length(attachments) <= 8 else false end),
  check (length(body) > 0 or case when jsonb_typeof(attachments) = 'array' then jsonb_array_length(attachments) > 0 else false end)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, conversation_id);
create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);
create index if not exists chat_messages_recent_idx
  on public.chat_messages (conversation_id, created_at desc);

create or replace function public.is_chat_member(p_conversation uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation and m.user_id = auth.uid()
  );
$$;

create or replace function public.chat_mentions_are_members(p_conversation uuid, p_mentions uuid[])
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_chat_member(p_conversation) and not exists (
    select 1 from unnest(coalesce(p_mentions, '{}'::uuid[])) as mentioned(user_id)
    where not exists (
      select 1 from public.conversation_members m
      where m.conversation_id = p_conversation and m.user_id = mentioned.user_id
    )
  );
$$;

create or replace function public.chat_storage_member(p_conversation text)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id::text = p_conversation and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_chat_member(uuid) from public, anon;
revoke all on function public.chat_mentions_are_members(uuid, uuid[]) from public, anon;
revoke all on function public.chat_storage_member(text) from public, anon;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.chat_mentions_are_members(uuid, uuid[]) to authenticated;
grant execute on function public.chat_storage_member(text) to authenticated;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat conversation members read" on public.conversations;
create policy "chat conversation members read" on public.conversations
  for select to authenticated using (public.is_chat_member(id));

drop policy if exists "chat members read" on public.conversation_members;
create policy "chat members read" on public.conversation_members
  for select to authenticated using (public.is_chat_member(conversation_id));
drop policy if exists "chat members mark own read" on public.conversation_members;
create policy "chat members mark own read" on public.conversation_members
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "chat messages read" on public.chat_messages;
create policy "chat messages read" on public.chat_messages
  for select to authenticated using (public.is_chat_member(conversation_id));
drop policy if exists "chat messages send" on public.chat_messages;
create policy "chat messages send" on public.chat_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and public.is_chat_member(conversation_id)
    and public.chat_mentions_are_members(conversation_id, mentions)
  );

revoke all on public.conversations, public.conversation_members, public.chat_messages from public, anon;
grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;
grant select, insert on public.chat_messages to authenticated;

create or replace function public.start_chat(p_member_ids uuid[], p_title text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  friend_ids uuid[];
  all_members uuid[];
  friend_id uuid;
  conversation_id uuid;
  group_chat boolean;
  direct_pair text;
  clean_title text := nullif(left(trim(coalesce(p_title, '')), 80), '');
begin
  if current_user_id is null then raise exception 'not authenticated'; end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
    into friend_ids
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as requested(member_id)
    where member_id is not null and member_id <> current_user_id;

  if cardinality(friend_ids) < 1 or cardinality(friend_ids) > 49 then
    raise exception 'Select between 1 and 49 friends';
  end if;

  foreach friend_id in array friend_ids loop
    if not exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_id = current_user_id and f.friend_id = friend_id)
          or (f.friend_id = current_user_id and f.user_id = friend_id))
    ) then
      raise exception 'Chat is available only with accepted friends';
    end if;
  end loop;

  group_chat := cardinality(friend_ids) > 1;
  select array_agg(member_id order by member_id) into all_members
    from (select current_user_id as member_id
          union select unnest(friend_ids) as member_id) members;

  if not group_chat then
    direct_pair := least(current_user_id::text, friend_ids[1]::text)
      || ':' || greatest(current_user_id::text, friend_ids[1]::text);
  end if;

  insert into public.conversations (created_by, title, is_group, direct_key)
  values (current_user_id, case when group_chat then clean_title else null end, group_chat, direct_pair)
  on conflict (direct_key) do nothing
  returning id into conversation_id;

  if conversation_id is null then
    select c.id into conversation_id
      from public.conversations c where c.direct_key = direct_pair;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
    select conversation_id, member_id from unnest(all_members) as members(member_id)
    on conflict do nothing;

  return conversation_id;
end;
$$;
revoke all on function public.start_chat(uuid[], text) from public, anon;
grant execute on function public.start_chat(uuid[], text) to authenticated;

create or replace function public.bump_chat_conversation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations
    set updated_at = new.created_at, last_message_at = new.created_at
    where id = new.conversation_id;
  return new;
end;
$$;
revoke all on function public.bump_chat_conversation() from public, anon, authenticated;
drop trigger if exists chat_message_bump_conversation on public.chat_messages;
create trigger chat_message_bump_conversation
  after insert on public.chat_messages
  for each row execute function public.bump_chat_conversation();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 20971520,
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

drop policy if exists "chat media read members" on storage.objects;
create policy "chat media read members" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-media' and public.chat_storage_member((storage.foldername(name))[1]));
drop policy if exists "chat media upload own" on storage.objects;
create policy "chat media upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.chat_storage_member((storage.foldername(name))[1])
  );
drop policy if exists "chat media delete own" on storage.objects;
create policy "chat media delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.chat_storage_member((storage.foldername(name))[1])
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
      execute 'alter publication supabase_realtime add table public.conversations';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members') then
      execute 'alter publication supabase_realtime add table public.conversation_members';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
      execute 'alter publication supabase_realtime add table public.chat_messages';
    end if;
  end if;
end;
$$;
