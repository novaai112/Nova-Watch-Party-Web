-- Watch Room chat: let people delete their own messages (and the room admin remove any chat message).
-- Run once in the Supabase SQL editor. Without it, "Delete for everyone" shows a hint; "Delete for me" always works.
grant delete on public.room_messages to authenticated;
drop policy if exists msgs_delete_own_or_admin on public.room_messages;
create policy msgs_delete_own_or_admin on public.room_messages for delete to authenticated
  using (
    kind = 'chat' and public.is_room_member(room_id) and (
      user_id = auth.uid()
      or exists (select 1 from public.rooms r where r.id = room_id and r.admin_id = auth.uid())
    )
  );
