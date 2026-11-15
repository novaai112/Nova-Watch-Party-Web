-- Nova: messages from people who are NOT your friend go to "Message requests" (Chats > Requests),
-- even when an old direct chat with them already exists.  Safe to re-run.  Run once in the Supabase SQL editor.

create or replace function public.chat_message_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_group boolean; v_sent integer; v_other uuid; v_other_status text;
begin
  select is_group into v_group from public.conversations where id = new.conversation_id;
  if not coalesce(v_group, true) then
    if exists (select 1 from public.conversation_members m
               where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id
                 and m.request_status = 'rejected') then
      raise exception 'You cannot send messages to this user';
    end if;
    -- A non-friend writing into an old/open direct chat is a MESSAGE REQUEST for the recipient,
    -- unless the recipient has already written in this chat themselves.
    select m.user_id, m.request_status into v_other, v_other_status
      from public.conversation_members m
      where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id limit 1;
    if v_other is not null and v_other_status = 'accepted'
       and not public.chat_are_friends(new.sender_id, v_other)
       and not exists (select 1 from public.chat_messages x
                       where x.conversation_id = new.conversation_id and x.sender_id = v_other) then
      update public.conversation_members set request_status = 'pending', hidden_at = null
        where conversation_id = new.conversation_id and user_id = v_other and request_status = 'accepted';
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

-- Accepting a friend request also accepts a waiting message request from that person.
create or replace function public._friend_accept_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    update public.conversation_members m set request_status = 'accepted'
      from public.conversations c
      where m.conversation_id = c.id and not c.is_group and m.request_status = 'pending'
        and c.direct_key = least(new.user_id::text, new.friend_id::text) || ':' || greatest(new.user_id::text, new.friend_id::text);
  end if;
  return new;
end;
$$;
revoke all on function public._friend_accept_requests() from public, anon, authenticated;
drop trigger if exists friendship_accept_requests_trg on public.friendships;
create trigger friendship_accept_requests_trg after insert or update of status on public.friendships
  for each row execute function public._friend_accept_requests();

-- One-time cleanup: chats that already sit in Chats although the other person is not a friend,
-- wrote to you, and you never replied -> move to Requests.
update public.conversation_members m set request_status = 'pending', hidden_at = null
from public.conversations c
where m.conversation_id = c.id and not c.is_group and m.request_status = 'accepted'
  and exists (select 1 from public.chat_messages x where x.conversation_id = c.id and x.sender_id <> m.user_id)
  and not exists (select 1 from public.chat_messages y where y.conversation_id = c.id and y.sender_id = m.user_id)
  and not public.chat_are_friends(m.user_id,
        (select o.user_id from public.conversation_members o where o.conversation_id = c.id and o.user_id <> m.user_id limit 1));

notify pgrst, 'reload schema';
