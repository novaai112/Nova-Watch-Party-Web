-- Watch-room attachments (photos, videos, audio, documents, GIPHY / KLIPY / Unsplash).
-- Run once in Supabase SQL Editor AFTER rooms-schema.sql. Safe to re-run.

-- 1. messages may carry attachments, and text may be empty when there is an attachment
alter table public.room_messages add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.room_messages'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%char_length(body)%'
  loop
    execute format('alter table public.room_messages drop constraint %I', c);
  end loop;
end $$;

alter table public.room_messages drop constraint if exists room_messages_body_len;
alter table public.room_messages add constraint room_messages_body_len check (char_length(body) <= 500);
alter table public.room_messages drop constraint if exists room_messages_attachments_ok;
alter table public.room_messages add constraint room_messages_attachments_ok check (
  jsonb_typeof(attachments) = 'array'
  and jsonb_array_length(attachments) <= 8
  and (char_length(body) > 0 or jsonb_array_length(attachments) > 0)
);

drop policy if exists msgs_member_insert on public.room_messages;
create policy msgs_member_insert on public.room_messages for insert to authenticated
  with check (user_id = auth.uid() and kind = 'chat' and public.is_room_member(room_id));

-- 2. private storage bucket: path is  <room id>/<user id>/<file>
create or replace function public.room_storage_member(p_room text)
returns boolean language sql security definer set search_path = '' stable as $$
  select case when p_room ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_room_member(p_room::uuid) else false end
$$;
revoke all on function public.room_storage_member(text) from public, anon;
grant execute on function public.room_storage_member(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-media', 'room-media', false, 20971520,
  array[
    'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif','image/bmp','image/tiff',
    'video/mp4','video/webm','video/quicktime','video/ogg','video/3gpp','video/x-msvideo',
    'audio/mpeg','audio/mp4','audio/ogg','audio/webm','audio/wav','audio/x-wav','audio/aac','audio/flac','audio/3gpp',
    'application/pdf','text/plain','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "room media read members" on storage.objects;
create policy "room media read members" on storage.objects
  for select to authenticated
  using (bucket_id = 'room-media' and public.room_storage_member((storage.foldername(name))[1]));

drop policy if exists "room media upload own" on storage.objects;
create policy "room media upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'room-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.room_storage_member((storage.foldername(name))[1])
  );

drop policy if exists "room media delete own" on storage.objects;
create policy "room media delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'room-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.room_storage_member((storage.foldername(name))[1])
  );
