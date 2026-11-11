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

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, conversation_id);
create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);
create index if not exists chat_messages_recent_idx
  on public.chat_messages (conversation_id, created_at desc);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id, blocker_id);

alter table public.user_blocks enable row level security;
drop policy if exists "chat blocks read own" on public.user_blocks;
create policy "chat blocks read own" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
revoke all on public.user_blocks from public, anon, authenticated;
grant select on public.user_blocks to authenticated;

create or replace function public.users_blocked(p_user_a uuid, p_user_b uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select auth.uid() is not null
    and (p_user_a = auth.uid() or p_user_b = auth.uid())
    and exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
$$;
revoke all on function public.users_blocked(uuid, uuid) from public, anon;

create or replace function public.can_add_friend(p_target uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select auth.uid() is not null
    and p_target is not null
    and p_target <> auth.uid()
    and not public.users_blocked(auth.uid(), p_target);
$$;
revoke all on function public.can_add_friend(uuid) from public, anon;
grant execute on function public.can_add_friend(uuid) to authenticated;

create or replace function public.block_user(p_blocked_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'not authenticated'; end if;
  if p_blocked_id is null or p_blocked_id = current_user_id then raise exception 'Cannot block this user'; end if;
  if not exists (select 1 from public.profiles where id = p_blocked_id) then raise exception 'User not found'; end if;
  insert into public.user_blocks (blocker_id, blocked_id)
    values (current_user_id, p_blocked_id) on conflict do nothing;
  delete from public.friendships f
    where (f.user_id = current_user_id and f.friend_id = p_blocked_id)
       or (f.user_id = p_blocked_id and f.friend_id = current_user_id);
end;
$$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_blocked_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.user_blocks
    where blocker_id = auth.uid() and blocked_id = p_blocked_id;
end;
$$;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

drop policy if exists "friends insert" on public.friendships;
create policy "friends insert" on public.friendships for insert to authenticated
  with check (auth.uid() = user_id and public.can_add_friend(friend_id));

create or replace function public.is_chat_member(p_conversation uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.conversation_members own_member
    join public.conversations c on c.id = own_member.conversation_id
    where own_member.conversation_id = p_conversation
      and own_member.user_id = auth.uid()
      and not exists (
        select 1 from public.conversation_members other_member
        where other_member.conversation_id = p_conversation
          and other_member.user_id <> auth.uid()
          and public.users_blocked(auth.uid(), other_member.user_id)
      )
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
  select public.is_chat_member(p_conversation::uuid);
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
  v_current_user_id uuid := auth.uid();
  v_friend_ids uuid[];
  v_all_members uuid[];
  v_friend_id uuid;
  v_conversation_id uuid;
  v_group_chat boolean;
  v_direct_key text;
  v_clean_title text := nullif(left(trim(coalesce(p_title, '')), 80), '');
begin
  if v_current_user_id is null then raise exception 'not authenticated'; end if;

  select coalesce(array_agg(distinct requested.member_id), '{}'::uuid[])
    into v_friend_ids
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as requested(member_id)
    where requested.member_id is not null and requested.member_id <> v_current_user_id;

  if cardinality(v_friend_ids) < 1 or cardinality(v_friend_ids) > 49 then
    raise exception 'Select between 1 and 49 friends';
  end if;

  foreach v_friend_id in array v_friend_ids loop
    if public.users_blocked(v_current_user_id, v_friend_id) then
      raise exception 'This user is blocked';
    end if;
    if not exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_id = v_current_user_id and f.friend_id = v_friend_id)
          or (f.friend_id = v_current_user_id and f.user_id = v_friend_id))
    ) then
      raise exception 'Chat is available only with accepted friends';
    end if;
  end loop;

  v_group_chat := cardinality(v_friend_ids) > 1;
  select array_agg(members.member_id order by members.member_id) into v_all_members
    from (select v_current_user_id as member_id
          union select unnest(v_friend_ids) as member_id) members;

  if not v_group_chat then
    v_direct_key := least(v_current_user_id::text, v_friend_ids[1]::text)
      || ':' || greatest(v_current_user_id::text, v_friend_ids[1]::text);
  end if;

  insert into public.conversations (created_by, title, is_group, direct_key)
  values (v_current_user_id, case when v_group_chat then v_clean_title else null end, v_group_chat, v_direct_key)
  on conflict (direct_key) do nothing
  returning id into v_conversation_id;

  if v_conversation_id is null then
    select c.id into v_conversation_id
      from public.conversations c where c.direct_key = v_direct_key;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
    select v_conversation_id, members.member_id from unnest(v_all_members) as members(member_id)
    on conflict do nothing;

  return v_conversation_id;
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
