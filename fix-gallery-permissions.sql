-- Run this ONCE: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- =====================================================================
--  PART 5: TABLE PERMISSIONS  (fixes "permission denied for table gallery")
--  Row-Level-Security policies only filter rows. The `authenticated` role ALSO needs
--  table-level GRANTs, and newer Supabase projects no longer add them automatically.
--  Safe to run any number of times.
-- =====================================================================
grant usage on schema public to anon, authenticated;

grant select, insert, delete          on public.gallery         to authenticated;
grant select, insert, update, delete  on public.friendships     to authenticated;
grant select, insert, update, delete  on public.watch_history   to authenticated;
grant select, insert                  on public.support_tickets to authenticated;
grant select                          on public.subscriptions   to authenticated;
grant select                          on public.profiles        to authenticated;
grant update (full_name, avatar_url, username, bio, country, location_lat, location_lng, settings, visibility, socials)
  on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- DONE (part 5)
