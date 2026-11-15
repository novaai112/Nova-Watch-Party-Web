-- Watch Room chat reactions (double-tap a message = react with your Settings > Quick Reaction).
-- Run once in the Supabase SQL editor (safe to re-run). Needs rooms-schema.sql first.
-- One reaction per person per message: reacting again with another emoji replaces it, with the same emoji removes it.

create table if not exists public.room_message_reactions (
  message_id bigint      not null references public.room_messages(id) on delete cascade,
  room_id    uuid        not null references public.rooms(id) on delete cascade,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  emoji      text        not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists room_message_reactions_room_idx on public.room_message_reactions(room_id);

-- DELETE realtime events carry the whole old row (so clients can tell which room it belonged to)
alter table public.room_message_reactions replica identity full;

alter table public.room_message_reactions enable row level security;
grant select, insert, update, delete on public.room_message_reactions to authenticated;

drop policy if exists rmr_select on public.room_message_reactions;
drop policy if exists rmr_insert on public.room_message_reactions;
drop policy if exists rmr_update on public.room_message_reactions;
drop policy if exists rmr_delete on public.room_message_reactions;

-- members of the room see its reactions
create policy rmr_select on public.room_message_reactions for select to authenticated
  using (public.is_room_member(room_id));

-- a member reacts as themselves, on a chat message that really belongs to that room
create policy rmr_insert on public.room_message_reactions for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_room_member(room_id)
    and exists (select 1 from public.room_messages m where m.id = message_id and m.room_id = room_message_reactions.room_id and m.kind = 'chat')
  );

create policy rmr_update on public.room_message_reactions for update to authenticated
  using (user_id = auth.uid() and public.is_room_member(room_id))
  with check (user_id = auth.uid() and public.is_room_member(room_id)
    and exists (select 1 from public.room_messages m where m.id = message_id and m.room_id = room_message_reactions.room_id and m.kind = 'chat'));

-- people remove their own reaction
create policy rmr_delete on public.room_message_reactions for delete to authenticated
  using (user_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.room_message_reactions;
exception when duplicate_object then null;
end $$;
