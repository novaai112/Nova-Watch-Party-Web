-- Nova Chat Pro: WhatsApp / Telegram / Instagram-style messaging features.
-- Run AFTER schema.sql and chat-schema.sql, in Supabase SQL Editor. Safe to re-run.
--
-- Adds: pinned / muted / archived chats, drafts, clear + delete conversation,
-- replies, edit, delete-for-me / delete-for-everyone, forwarding, reactions,
-- per-recipient delivery + read receipts, online / last-seen privacy, message
-- requests, scheduled messages, pinned messages, view-once media, reports,
-- global + conversation search, and an idempotent client_id for retries.

-- ============================================================================
-- 1. Columns
-- ============================================================================
alter table public.conversation_members
  add column if not exists pinned_at timestamptz,
  add column if not exists muted_until timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists hidden_at timestamptz,
  add column if not exists cleared_at timestamptz,
  add column if not exists draft text,
  add column if not exists draft_updated_at timestamptz,
  add column if not exists request_status text not null default 'accepted';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversation_members_request_status_check') then
    alter table public.conversation_members
      add constraint conversation_members_request_status_check
      check (request_status in ('accepted', 'pending', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversation_members_draft_len_check') then
    alter table public.conversation_members
      add constraint conversation_members_draft_len_check
      check (draft is null or length(draft) <= 5000);
  end if;
end $$;

alter table public.chat_messages
  add column if not exists kind text not null default 'text',
  add column if not exists reply_to uuid references public.chat_messages (id) on delete set null,
  add column if not exists client_id uuid,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists forwarded boolean not null default false;

do $$
declare c record;
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_kind_check') then
    alter table public.chat_messages
      add constraint chat_messages_kind_check
      check (kind in ('text', 'media', 'voice', 'video_note', 'contact', 'sticker', 'system'));
  end if;
  -- The original "body or attachment required" check must allow deleted messages.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.chat_messages'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%length(body) > 0%'
  loop
    execute format('alter table public.chat_messages drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_has_content') then
    alter table public.chat_messages
      add constraint chat_messages_has_content
      check (deleted_at is not null or length(body) > 0
             or (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) > 0));
  end if;
end $$;

create unique index if not exists chat_messages_client_id_idx
  on public.chat_messages (sender_id, client_id) where client_id is not null;
create index if not exists chat_messages_reply_idx on public.chat_messages (reply_to) where reply_to is not null;
create index if not exists chat_messages_attachments_gin
  on public.chat_messages using gin (attachments jsonb_path_ops);
create index if not exists conversation_members_pinned_idx
  on public.conversation_members (user_id, pinned_at) where pinned_at is not null;

-- ============================================================================
-- 2. New tables
-- ============================================================================
create table if not exists public.message_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists public.message_receipts (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);
create index if not exists message_receipts_user_idx on public.message_receipts (user_id, message_id);

create table if not exists public.message_hidden (
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create table if not exists public.pinned_messages (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  pinned_by uuid references auth.users (id) on delete set null,
  pinned_at timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

create table if not exists public.message_views (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  idx integer not null default 0,
  viewed_at timestamptz not null default now(),
  primary key (message_id, user_id, idx)
);

create table if not exists public.chat_privacy (
  user_id uuid primary key references auth.users (id) on delete cascade,
  show_last_seen text not null default 'everyone' check (show_last_seen in ('everyone', 'friends', 'nobody')),
  show_online text not null default 'everyone' check (show_online in ('everyone', 'friends', 'nobody')),
  read_receipts boolean not null default true,
  typing_indicator boolean not null default true,
  who_can_request text not null default 'everyone' check (who_can_request in ('everyone', 'nobody')),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid references auth.users (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.chat_messages (id) on delete set null,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'impersonation', 'scam', 'other')),
  details text check (details is null or length(details) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null default '' check (length(body) <= 5000),
  mentions uuid[] not null default '{}',
  reply_to uuid references public.chat_messages (id) on delete set null,
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  check (length(btrim(body)) > 0)
);
create index if not exists scheduled_messages_due_idx on public.scheduled_messages (send_at) where status = 'pending';
create index if not exists scheduled_messages_owner_idx on public.scheduled_messages (sender_id, conversation_id, status);

-- ============================================================================
-- 3. Helper functions
-- ============================================================================
create or replace function public.chat_are_friends(p_a uuid, p_b uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.user_id = p_a and f.friend_id = p_b) or (f.user_id = p_b and f.friend_id = p_a))
  );
$$;

create or replace function public.chat_can_see_message(p_message uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select coalesce((select public.is_chat_member(m.conversation_id)
                   from public.chat_messages m where m.id = p_message), false);
$$;

create or replace function public.chat_is_sender(p_message uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.chat_messages m where m.id = p_message and m.sender_id = auth.uid());
$$;

create or replace function public.chat_reply_valid(p_conversation uuid, p_reply uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select p_reply is null or exists (
    select 1 from public.chat_messages m where m.id = p_reply and m.conversation_id = p_conversation
  );
$$;

create or replace function public.chat_privacy_of(p_user uuid)
returns public.chat_privacy language sql security definer set search_path = '' stable as $$
  select coalesce(
    (select cp from public.chat_privacy cp where cp.user_id = p_user),
    row(p_user, 'everyone', 'everyone', true, true, 'everyone', now())::public.chat_privacy
  );
$$;

revoke all on function public.chat_are_friends(uuid, uuid) from public, anon;
revoke all on function public.chat_can_see_message(uuid) from public, anon;
revoke all on function public.chat_is_sender(uuid) from public, anon;
revoke all on function public.chat_reply_valid(uuid, uuid) from public, anon;
revoke all on function public.chat_privacy_of(uuid) from public, anon, authenticated;
grant execute on function public.chat_are_friends(uuid, uuid) to authenticated;
grant execute on function public.chat_can_see_message(uuid) to authenticated;
grant execute on function public.chat_is_sender(uuid) to authenticated;
grant execute on function public.chat_reply_valid(uuid, uuid) to authenticated;

-- ============================================================================
-- 4. Row level security
-- ============================================================================
alter table public.message_reactions enable row level security;
alter table public.message_receipts enable row level security;
alter table public.message_hidden enable row level security;
alter table public.pinned_messages enable row level security;
alter table public.message_views enable row level security;
alter table public.chat_privacy enable row level security;
alter table public.user_presence enable row level security;
alter table public.chat_reports enable row level security;
alter table public.scheduled_messages enable row level security;

drop policy if exists "reactions read" on public.message_reactions;
create policy "reactions read" on public.message_reactions
  for select to authenticated using (public.chat_can_see_message(message_id));
drop policy if exists "reactions add own" on public.message_reactions;
create policy "reactions add own" on public.message_reactions
  for insert to authenticated with check (user_id = auth.uid() and public.chat_can_see_message(message_id));
drop policy if exists "reactions change own" on public.message_reactions;
create policy "reactions change own" on public.message_reactions
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.chat_can_see_message(message_id));
drop policy if exists "reactions remove own" on public.message_reactions;
create policy "reactions remove own" on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "receipts read" on public.message_receipts;
create policy "receipts read" on public.message_receipts
  for select to authenticated using (user_id = auth.uid() or public.chat_is_sender(message_id));

drop policy if exists "hidden own" on public.message_hidden;
create policy "hidden own" on public.message_hidden
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "hidden add own" on public.message_hidden;
create policy "hidden add own" on public.message_hidden
  for insert to authenticated with check (user_id = auth.uid() and public.chat_can_see_message(message_id));
drop policy if exists "hidden remove own" on public.message_hidden;
create policy "hidden remove own" on public.message_hidden
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "pins read" on public.pinned_messages;
create policy "pins read" on public.pinned_messages
  for select to authenticated using (public.is_chat_member(conversation_id));
drop policy if exists "pins add" on public.pinned_messages;
create policy "pins add" on public.pinned_messages
  for insert to authenticated with check (
    pinned_by = auth.uid() and public.is_chat_member(conversation_id)
    and public.chat_reply_valid(conversation_id, message_id));
drop policy if exists "pins remove" on public.pinned_messages;
create policy "pins remove" on public.pinned_messages
  for delete to authenticated using (public.is_chat_member(conversation_id));

drop policy if exists "views read own" on public.message_views;
create policy "views read own" on public.message_views
  for select to authenticated using (user_id = auth.uid() or public.chat_is_sender(message_id));

drop policy if exists "privacy own" on public.chat_privacy;
create policy "privacy own" on public.chat_privacy
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "privacy insert own" on public.chat_privacy;
create policy "privacy insert own" on public.chat_privacy
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "privacy update own" on public.chat_privacy;
create policy "privacy update own" on public.chat_privacy
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reports insert own" on public.chat_reports;
create policy "reports insert own" on public.chat_reports
  for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists "scheduled read own" on public.scheduled_messages;
create policy "scheduled read own" on public.scheduled_messages
  for select to authenticated using (sender_id = auth.uid());
drop policy if exists "scheduled insert own" on public.scheduled_messages;
create policy "scheduled insert own" on public.scheduled_messages
  for insert to authenticated with check (
    sender_id = auth.uid() and status = 'pending' and public.is_chat_member(conversation_id)
    and public.chat_reply_valid(conversation_id, reply_to));
drop policy if exists "scheduled update own" on public.scheduled_messages;
create policy "scheduled update own" on public.scheduled_messages
  for update to authenticated using (sender_id = auth.uid() and status = 'pending')
  with check (sender_id = auth.uid() and status in ('pending', 'cancelled'));
drop policy if exists "scheduled delete own" on public.scheduled_messages;
create policy "scheduled delete own" on public.scheduled_messages
  for delete to authenticated using (sender_id = auth.uid());

revoke all on public.message_reactions, public.message_receipts, public.message_hidden, public.pinned_messages,
  public.message_views, public.chat_privacy, public.user_presence, public.chat_reports, public.scheduled_messages
  from public, anon, authenticated;
grant select, insert, update, delete on public.message_reactions to authenticated;
grant select on public.message_receipts to authenticated;
grant select, insert, delete on public.message_hidden to authenticated;
grant select, insert, delete on public.pinned_messages to authenticated;
grant select on public.message_views to authenticated;
grant select, insert, update on public.chat_privacy to authenticated;
grant insert on public.chat_reports to authenticated;
grant select, insert, delete on public.scheduled_messages to authenticated;
grant update (send_at, status) on public.scheduled_messages to authenticated;

-- Members may change only their own personal chat settings (never request_status).
revoke update on public.conversation_members from authenticated;
grant update (last_read_at, pinned_at, muted_until, archived_at, hidden_at, cleared_at, draft, draft_updated_at)
  on public.conversation_members to authenticated;

-- Messages: replies must point inside the same conversation; kind is validated by a check.
drop policy if exists "chat messages send" on public.chat_messages;
create policy "chat messages send" on public.chat_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and public.is_chat_member(conversation_id)
    and public.chat_mentions_are_members(conversation_id, mentions)
    and public.chat_reply_valid(conversation_id, reply_to)
    and deleted_at is null and edited_at is null
  );

-- ============================================================================
-- 5. Triggers
-- ============================================================================
create or replace function public.chat_message_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_group boolean; v_sent integer;
begin
  select is_group into v_group from public.conversations where id = new.conversation_id;
  if not coalesce(v_group, true) then
    if exists (select 1 from public.conversation_members m
               where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id
                 and m.request_status = 'rejected') then
      raise exception 'You cannot send messages to this user';
    end if;
    if exists (select 1 from public.conversation_members m
               where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id
                 and m.request_status = 'pending') then
      select count(*) into v_sent from public.chat_messages
        where conversation_id = new.conversation_id and sender_id = new.sender_id;
      if v_sent >= 1 then
        raise exception 'Wait for this user to accept your message request';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.chat_message_before_insert() from public, anon, authenticated;
drop trigger if exists chat_message_before_insert_trg on public.chat_messages;
create trigger chat_message_before_insert_trg before insert on public.chat_messages
  for each row execute function public.chat_message_before_insert();

create or replace function public.bump_chat_conversation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations
    set updated_at = new.created_at, last_message_at = new.created_at
    where id = new.conversation_id;
  -- A new message brings a hidden chat back; archived chats return unless muted.
  update public.conversation_members
    set hidden_at = null
    where conversation_id = new.conversation_id and hidden_at is not null
      and (request_status <> 'pending' or user_id = new.sender_id);
  update public.conversation_members
    set archived_at = null
    where conversation_id = new.conversation_id and archived_at is not null
      and (muted_until is null or muted_until < now());
  -- Replying to a message request accepts it.
  update public.conversation_members
    set request_status = 'accepted'
    where conversation_id = new.conversation_id and user_id = new.sender_id and request_status = 'pending';
  return new;
end;
$$;
revoke all on function public.bump_chat_conversation() from public, anon, authenticated;

create or replace function public.chat_limit_pins()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'conversation_members' then
    if new.pinned_at is not null and old.pinned_at is null and
       (select count(*) from public.conversation_members
        where user_id = new.user_id and pinned_at is not null) >= 5 then
      raise exception 'You can pin up to 5 chats';
    end if;
  else
    if (select count(*) from public.pinned_messages where conversation_id = new.conversation_id) >= 3 then
      raise exception 'You can pin up to 3 messages';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.chat_limit_pins() from public, anon, authenticated;
drop trigger if exists chat_limit_pinned_chats on public.conversation_members;
create trigger chat_limit_pinned_chats before update of pinned_at on public.conversation_members
  for each row execute function public.chat_limit_pins();
drop trigger if exists chat_limit_pinned_messages on public.pinned_messages;
create trigger chat_limit_pinned_messages before insert on public.pinned_messages
  for each row execute function public.chat_limit_pins();

-- ============================================================================
-- 6. Receipts, presence and privacy
-- ============================================================================
create or replace function public.chat_mark_delivered()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.message_receipts (message_id, user_id, delivered_at)
  select m.id, auth.uid(), now()
  from public.chat_messages m
  where m.conversation_id in (select cm.conversation_id from public.conversation_members cm where cm.user_id = auth.uid())
    and m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at > now() - interval '30 days'
    and not public.users_blocked(auth.uid(), m.sender_id)
    and not exists (select 1 from public.message_receipts r where r.message_id = m.id and r.user_id = auth.uid())
  on conflict (message_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.chat_mark_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_share boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_chat_member(p_conversation) then raise exception 'You do not have access to this conversation'; end if;
  update public.conversation_members set last_read_at = now()
    where conversation_id = p_conversation and user_id = auth.uid();
  v_share := (public.chat_privacy_of(auth.uid())).read_receipts;
  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  select m.id, auth.uid(), now(), case when v_share then now() end
  from public.chat_messages m
  where m.conversation_id = p_conversation and m.sender_id <> auth.uid() and m.deleted_at is null
    and m.created_at > now() - interval '30 days'
    and not exists (select 1 from public.message_receipts r
                    where r.message_id = m.id and r.user_id = auth.uid() and (r.read_at is not null or not v_share))
  on conflict (message_id, user_id) do update
    set read_at = coalesce(public.message_receipts.read_at, excluded.read_at),
        delivered_at = coalesce(public.message_receipts.delivered_at, excluded.delivered_at);
end;
$$;

create or replace function public.chat_touch_presence()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v timestamptz := now();
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.user_presence (user_id, last_seen_at) values (auth.uid(), v)
    on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
  return v;
end;
$$;

create or replace function public.chat_get_privacy()
returns public.chat_privacy language sql security definer set search_path = '' stable as $$
  select public.chat_privacy_of(auth.uid());
$$;

create or replace function public.chat_set_privacy(p_settings jsonb)
returns public.chat_privacy language plpgsql security definer set search_path = '' as $$
declare cur public.chat_privacy;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  cur := public.chat_privacy_of(auth.uid());
  insert into public.chat_privacy (user_id, show_last_seen, show_online, read_receipts, typing_indicator, who_can_request, updated_at)
  values (
    auth.uid(),
    coalesce(p_settings ->> 'show_last_seen', cur.show_last_seen),
    coalesce(p_settings ->> 'show_online', cur.show_online),
    coalesce((p_settings ->> 'read_receipts')::boolean, cur.read_receipts),
    coalesce((p_settings ->> 'typing_indicator')::boolean, cur.typing_indicator),
    coalesce(p_settings ->> 'who_can_request', cur.who_can_request),
    now())
  on conflict (user_id) do update set
    show_last_seen = excluded.show_last_seen, show_online = excluded.show_online,
    read_receipts = excluded.read_receipts, typing_indicator = excluded.typing_indicator,
    who_can_request = excluded.who_can_request, updated_at = now();
  return public.chat_privacy_of(auth.uid());
end;
$$;

-- What the caller may know about other people (WhatsApp rules: hide yours, lose theirs).
create or replace function public.chat_peer_state(p_users uuid[])
returns table (user_id uuid, last_seen_at timestamptz, can_see_online boolean, read_receipts boolean, typing_ok boolean)
language plpgsql security definer set search_path = '' stable as $$
declare me public.chat_privacy; peer record; theirs public.chat_privacy; v_friend boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  me := public.chat_privacy_of(auth.uid());
  for peer in select distinct u from unnest(coalesce(p_users, '{}'::uuid[])) as u where u is not null and u <> auth.uid() loop
    if public.users_blocked(auth.uid(), peer.u) then continue; end if;
    theirs := public.chat_privacy_of(peer.u);
    v_friend := public.chat_are_friends(auth.uid(), peer.u);
    user_id := peer.u;
    last_seen_at := case
      when me.show_last_seen <> 'nobody'
       and (theirs.show_last_seen = 'everyone' or (theirs.show_last_seen = 'friends' and v_friend))
      then (select p.last_seen_at from public.user_presence p where p.user_id = peer.u) end;
    can_see_online := me.show_online <> 'nobody'
      and (theirs.show_online = 'everyone' or (theirs.show_online = 'friends' and v_friend));
    read_receipts := me.read_receipts and theirs.read_receipts;
    typing_ok := me.typing_indicator and theirs.typing_indicator;
    return next;
  end loop;
end;
$$;

-- ============================================================================
-- 7. Inbox, search and conversation actions
-- ============================================================================
create or replace function public.chat_inbox()
returns jsonb language sql security definer set search_path = '' stable as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by (x.pinned_at is null), x.pinned_at desc, x.last_message_at desc), '[]'::jsonb)
  from (
    select c.id, c.title, c.is_group, c.last_message_at, c.created_at,
      me.pinned_at, me.muted_until, me.archived_at, me.draft, me.draft_updated_at,
      me.last_read_at, me.request_status, me.cleared_at,
      (select coalesce(jsonb_agg(m2.user_id), '[]'::jsonb)
         from public.conversation_members m2 where m2.conversation_id = c.id) as member_ids,
      (select count(*) from public.chat_messages cm
        where cm.conversation_id = c.id and cm.sender_id <> auth.uid() and cm.deleted_at is null
          and cm.created_at > greatest(me.last_read_at, coalesce(me.cleared_at, '-infinity'::timestamptz))
          and not exists (select 1 from public.message_hidden h where h.message_id = cm.id and h.user_id = auth.uid())) as unread,
      (select to_jsonb(lm) from (
         select l.id, l.sender_id, l.body, l.kind, l.attachments, l.created_at, l.deleted_at, l.forwarded
         from public.chat_messages l
         where l.conversation_id = c.id and l.created_at > coalesce(me.cleared_at, '-infinity'::timestamptz)
           and not exists (select 1 from public.message_hidden h where h.message_id = l.id and h.user_id = auth.uid())
         order by l.created_at desc limit 1) lm) as last_message,
      (not c.is_group and exists (
         select 1 from public.conversation_members o
         join public.user_blocks b on b.blocker_id = auth.uid() and b.blocked_id = o.user_id
         where o.conversation_id = c.id and o.user_id <> auth.uid())) as blocked_by_me
    from public.conversations c
    join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid()
    where me.hidden_at is null and me.request_status <> 'rejected'
  ) x;
$$;

create or replace function public.chat_search(
  p_query text default null,
  p_conversation uuid default null,
  p_kind text default null,       -- media | docs | links | voice | audio | any
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 40,
  p_offset integer default 0)
returns table (id uuid, conversation_id uuid, sender_id uuid, body text, kind text, attachments jsonb,
               created_at timestamptz, reply_to uuid, forwarded boolean, edited_at timestamptz)
language plpgsql security definer set search_path = '' stable as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_q is not null then
    v_q := replace(replace(replace(left(v_q, 100), '\', '\\'), '%', '\%'), '_', '\_');
  end if;
  return query
  select m.id, m.conversation_id, m.sender_id, m.body, m.kind, m.attachments, m.created_at, m.reply_to, m.forwarded, m.edited_at
  from public.chat_messages m
  join public.conversation_members me on me.conversation_id = m.conversation_id and me.user_id = auth.uid()
  where m.deleted_at is null
    and public.is_chat_member(m.conversation_id)
    and m.created_at > coalesce(me.cleared_at, '-infinity'::timestamptz)
    and (p_conversation is null or m.conversation_id = p_conversation)
    and not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = auth.uid())
    and (p_from is null or m.created_at >= p_from)
    and (p_to is null or m.created_at < p_to)
    and (v_q is null
         or m.body ilike '%' || v_q || '%'
         or exists (select 1 from jsonb_array_elements(m.attachments) a
                    where a ->> 'name' ilike '%' || v_q || '%' or a ->> 'transcript' ilike '%' || v_q || '%'))
    and case coalesce(p_kind, 'any')
      when 'media' then exists (select 1 from jsonb_array_elements(m.attachments) a
                                where (a ->> 'type') like 'image/%' or (a ->> 'type') like 'video/%')
      when 'docs' then exists (select 1 from jsonb_array_elements(m.attachments) a
                               where a ->> 'path' is not null and coalesce(a ->> 'kind', '') not in ('voice', 'video_note', 'contact')
                                 and (a ->> 'type') not like 'image/%' and (a ->> 'type') not like 'video/%' and (a ->> 'type') not like 'audio/%')
      when 'voice' then exists (select 1 from jsonb_array_elements(m.attachments) a where a ->> 'kind' = 'voice')
      when 'audio' then exists (select 1 from jsonb_array_elements(m.attachments) a where (a ->> 'type') like 'audio/%')
      when 'links' then m.body ~* 'https?://'
      else true end
  order by m.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.chat_request_start(p_target uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid(); v_key text; v_conv uuid; v_body text := left(btrim(coalesce(p_body, '')), 5000);
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_target is null or p_target = v_me then raise exception 'Choose another user'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then raise exception 'User not found'; end if;
  if public.users_blocked(v_me, p_target) then raise exception 'Unable to message this user'; end if;
  if public.chat_are_friends(v_me, p_target) then
    return public.start_chat(array[p_target], null);
  end if;
  if (public.chat_privacy_of(p_target)).who_can_request = 'nobody' then
    raise exception 'This user is not accepting message requests';
  end if;
  if v_body = '' then raise exception 'Write a short message to send with your request'; end if;
  v_key := least(v_me::text, p_target::text) || ':' || greatest(v_me::text, p_target::text);
  select id into v_conv from public.conversations where direct_key = v_key;
  if v_conv is null then
    insert into public.conversations (created_by, is_group, direct_key) values (v_me, false, v_key)
      returning id into v_conv;
    -- The recipient starts "unread" (epoch), because member and message share one transaction timestamp.
    insert into public.conversation_members (conversation_id, user_id, request_status, last_read_at)
      values (v_conv, v_me, 'accepted', now()), (v_conv, p_target, 'pending', 'epoch'::timestamptz);
  elsif exists (select 1 from public.conversation_members m
                where m.conversation_id = v_conv and m.request_status = 'rejected') then
    raise exception 'Unable to message this user';
  end if;
  insert into public.chat_messages (conversation_id, sender_id, body, client_id)
    values (v_conv, v_me, v_body, gen_random_uuid());
  return v_conv;
end;
$$;

create or replace function public.chat_request_respond(p_conversation uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_action = 'accept' then
    update public.conversation_members set request_status = 'accepted', hidden_at = null
      where conversation_id = p_conversation and user_id = auth.uid() and request_status = 'pending';
  elsif p_action = 'reject' then
    update public.conversation_members set request_status = 'rejected', hidden_at = now(), cleared_at = now()
      where conversation_id = p_conversation and user_id = auth.uid() and request_status = 'pending';
  elsif p_action = 'delete' then
    update public.conversation_members set hidden_at = now(), cleared_at = now()
      where conversation_id = p_conversation and user_id = auth.uid() and request_status = 'pending';
  else
    raise exception 'Unknown action';
  end if;
end;
$$;

create or replace function public.edit_chat_message(p_id uuid, p_body text, p_mentions uuid[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare m public.chat_messages; v_body text := left(btrim(coalesce(p_body, '')), 5000);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into m from public.chat_messages where id = p_id;
  if not found or m.sender_id <> auth.uid() then raise exception 'You can only edit your own messages'; end if;
  if m.deleted_at is not null then raise exception 'This message was deleted'; end if;
  if m.created_at < now() - interval '15 minutes' then raise exception 'Messages can be edited for 15 minutes after sending'; end if;
  if not public.is_chat_member(m.conversation_id) then raise exception 'You do not have access to this conversation'; end if;
  if v_body = '' and jsonb_array_length(m.attachments) = 0 then raise exception 'A message cannot be empty'; end if;
  if not public.chat_mentions_are_members(m.conversation_id, p_mentions) then raise exception 'Invalid mention'; end if;
  update public.chat_messages set body = v_body, mentions = coalesce(p_mentions, '{}'), edited_at = now() where id = p_id;
end;
$$;

-- Returns storage paths nobody references any more, so the client can remove the files.
create or replace function public.delete_chat_message_everyone(p_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare m public.chat_messages; v_orphans text[];
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into m from public.chat_messages where id = p_id;
  if not found or m.sender_id <> auth.uid() then raise exception 'You can only delete your own messages for everyone'; end if;
  if m.deleted_at is not null then return '{}'; end if;
  if m.created_at < now() - interval '48 hours' then raise exception 'Messages can be deleted for everyone for 48 hours after sending'; end if;
  if not public.is_chat_member(m.conversation_id) then raise exception 'You do not have access to this conversation'; end if;
  update public.chat_messages set deleted_at = now(), body = '', attachments = '[]'::jsonb, mentions = '{}', edited_at = null
    where id = p_id;
  delete from public.message_reactions where message_id = p_id;
  delete from public.pinned_messages where message_id = p_id;
  select coalesce(array_agg(p), '{}') into v_orphans
  from (select distinct a ->> 'path' as p from jsonb_array_elements(m.attachments) a where a ->> 'path' is not null) paths
  where not exists (select 1 from public.chat_messages o
                    where o.id <> p_id and o.attachments @> jsonb_build_array(jsonb_build_object('path', paths.p)));
  return v_orphans;
end;
$$;

create or replace function public.forward_chat_messages(p_message_ids uuid[], p_conversation_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_conv uuid; v_msg public.chat_messages; v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if cardinality(coalesce(p_message_ids, '{}')) = 0 or cardinality(coalesce(p_conversation_ids, '{}')) = 0 then return 0; end if;
  if cardinality(p_message_ids) * cardinality(p_conversation_ids) > 100 then raise exception 'Too many messages or chats selected'; end if;
  foreach v_conv in array p_conversation_ids loop
    if not public.is_chat_member(v_conv) then raise exception 'You cannot forward to one of these chats'; end if;
    for v_msg in
      select m.* from public.chat_messages m
      where m.id = any (p_message_ids) and m.deleted_at is null and public.is_chat_member(m.conversation_id)
        and not exists (select 1 from jsonb_array_elements(m.attachments) a where (a ->> 'viewOnce') = 'true')
      order by m.created_at
    loop
      insert into public.chat_messages (conversation_id, sender_id, body, attachments, kind, forwarded, client_id)
        values (v_conv, auth.uid(), v_msg.body, v_msg.attachments, v_msg.kind, true, gen_random_uuid());
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

create or replace function public.chat_open_view_once(p_message_id uuid, p_index integer)
returns text language plpgsql security definer set search_path = '' as $$
declare m public.chat_messages; a jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into m from public.chat_messages where id = p_message_id;
  if not found or not public.is_chat_member(m.conversation_id) then raise exception 'You do not have access to this message'; end if;
  if m.deleted_at is not null then raise exception 'This message was deleted'; end if;
  a := m.attachments -> p_index;
  if a is null or (a ->> 'viewOnce') is distinct from 'true' then raise exception 'Not a view-once item'; end if;
  if m.sender_id = auth.uid() then raise exception 'View-once media cannot be reopened by the sender'; end if;
  insert into public.message_views (message_id, user_id, idx) values (p_message_id, auth.uid(), p_index);
  return a ->> 'path';
exception when unique_violation then
  raise exception 'This view-once item was already opened';
end;
$$;

create or replace function public.chat_report(
  p_user uuid, p_conversation uuid, p_message uuid, p_reason text, p_details text default null, p_block boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'Choose another user'; end if;
  insert into public.chat_reports (reporter_id, reported_user_id, conversation_id, message_id, reason, details)
    values (auth.uid(), p_user, p_conversation, p_message, p_reason, nullif(left(btrim(coalesce(p_details, '')), 1000), ''));
  if p_block then perform public.block_user(p_user); end if;
end;
$$;

-- Sends scheduled messages that are due. p_user null = every user (for pg_cron / service role only).
create or replace function public.chat_dispatch_due(p_user uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare s record; v_count integer := 0;
begin
  for s in
    select * from public.scheduled_messages
    where status = 'pending' and send_at <= now() and (p_user is null or sender_id = p_user)
    order by send_at for update skip locked limit 200
  loop
    if exists (select 1 from public.conversation_members m where m.conversation_id = s.conversation_id and m.user_id = s.sender_id)
       and not exists (select 1 from public.conversation_members o
                       join public.user_blocks b on (b.blocker_id = o.user_id and b.blocked_id = s.sender_id)
                                                 or (b.blocker_id = s.sender_id and b.blocked_id = o.user_id)
                       where o.conversation_id = s.conversation_id and o.user_id <> s.sender_id) then
      begin
        insert into public.chat_messages (conversation_id, sender_id, body, mentions, reply_to, client_id)
          values (s.conversation_id, s.sender_id, s.body, s.mentions,
                  case when exists (select 1 from public.chat_messages r where r.id = s.reply_to) then s.reply_to end,
                  s.id);
        update public.scheduled_messages set status = 'sent' where id = s.id;
        v_count := v_count + 1;
      exception when others then
        update public.scheduled_messages set status = 'failed', error = left(sqlerrm, 200) where id = s.id;
      end;
    else
      update public.scheduled_messages set status = 'failed', error = 'Conversation unavailable' where id = s.id;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.chat_dispatch_scheduled()
returns integer language sql security definer set search_path = '' as $$
  select public.chat_dispatch_due(auth.uid());
$$;

-- Optional (Dashboard -> Database -> Extensions -> pg_cron): send scheduled messages while nobody is online.
-- select cron.schedule('nova-chat-scheduled', '* * * * *', $$select public.chat_dispatch_due(null)$$);

do $$
declare f text;
begin
  foreach f in array array[
    'chat_mark_delivered()', 'chat_mark_read(uuid)', 'chat_touch_presence()', 'chat_get_privacy()',
    'chat_set_privacy(jsonb)', 'chat_peer_state(uuid[])', 'chat_inbox()',
    'chat_search(text,uuid,text,timestamptz,timestamptz,integer,integer)',
    'chat_request_start(uuid,text)', 'chat_request_respond(uuid,text)', 'edit_chat_message(uuid,text,uuid[])',
    'delete_chat_message_everyone(uuid)', 'forward_chat_messages(uuid[],uuid[])',
    'chat_open_view_once(uuid,integer)', 'chat_report(uuid,uuid,uuid,text,text,boolean)', 'chat_dispatch_scheduled()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.chat_dispatch_due(uuid) from public, anon, authenticated;

-- ============================================================================
-- 8. Storage: larger files, forwarded media, and view-once enforcement
-- ============================================================================
create or replace function public.chat_storage_can_read(p_name text)
returns boolean language plpgsql security definer set search_path = '' stable as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_conv uuid;
begin
  if auth.uid() is null or array_length(v_parts, 1) < 3 then return false; end if;
  begin v_conv := v_parts[1]::uuid; exception when others then return false; end;
  if v_parts[3] like 'once-%' then
    if v_parts[2] = auth.uid()::text then return public.is_chat_member(v_conv); end if;
    return exists (
      select 1 from public.message_views v
      join public.chat_messages m on m.id = v.message_id
      where v.user_id = auth.uid() and v.viewed_at > now() - interval '3 minutes'
        and (m.attachments -> v.idx) ->> 'path' = p_name);
  end if;
  if public.is_chat_member(v_conv) then return true; end if;
  return exists (
    select 1 from public.chat_messages m
    where m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
      and public.is_chat_member(m.conversation_id));
end;
$$;
revoke all on function public.chat_storage_can_read(text) from public, anon;
grant execute on function public.chat_storage_can_read(text) to authenticated;

update storage.buckets set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif','image/bmp','image/tiff',
    'video/mp4','video/webm','video/quicktime','video/ogg','video/3gpp','video/x-msvideo','video/x-m4v',
    'audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/ogg','audio/webm','audio/wav','audio/x-wav','audio/aac','audio/flac','audio/3gpp',
    'application/pdf','text/plain','text/csv','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip','application/x-zip-compressed'
  ]
where id = 'chat-media';

drop policy if exists "chat media read members" on storage.objects;
create policy "chat media read members" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-media' and public.chat_storage_can_read(name));

-- ============================================================================
-- 9. Realtime
-- ============================================================================
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['message_reactions', 'message_receipts', 'pinned_messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
