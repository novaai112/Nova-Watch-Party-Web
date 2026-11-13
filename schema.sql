-- =====================================================================
--  AUTH DATABASE SETUP  (Supabase / PostgreSQL)
--  Paste this whole file in: Supabase Dashboard > SQL Editor > New query > Run
--  Safe to run more than once.
-- =====================================================================
--  What Supabase Auth already gives you (no extra tables needed):
--    * auth.users       -> email, hashed password (bcrypt), confirmation state
--    * auth.identities  -> one row per login method (email, google)
--    * Same email via Google + Email/Password = ONE user (identities are linked)
--    * Password reset emails with secure, expiring, one-time links
--  This file adds a public "profiles" table that mirrors each user safely.
-- =====================================================================

-- 1) PROFILES TABLE ----------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text,
  full_name       text,
  avatar_url      text,
  providers       text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- 2) AUTO-UPDATE updated_at -------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 3) CREATE PROFILE WHEN A USER SIGNS UP (email OR google) -------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, providers, last_sign_in_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_app_meta_data -> 'providers')),
      '{}'
    ),
    new.last_sign_in_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) KEEP PROFILE IN SYNC (email change, new login method linked, last login)
create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
     set email           = new.email,
         providers       = coalesce(
                             array(select jsonb_array_elements_text(new.raw_app_meta_data -> 'providers')),
                             p.providers
                           ),
         full_name       = coalesce(p.full_name,
                             new.raw_user_meta_data ->> 'full_name',
                             new.raw_user_meta_data ->> 'name'),
         avatar_url      = coalesce(p.avatar_url,
                             new.raw_user_meta_data ->> 'avatar_url',
                             new.raw_user_meta_data ->> 'picture'),
         last_sign_in_at = new.last_sign_in_at
   where p.id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_user_updated();

-- 5) ROW LEVEL SECURITY: each user can only see / edit their OWN profile
alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile"   on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert/delete policies on purpose: rows are created by the trigger
-- and removed automatically when the auth user is deleted.

-- Only allow editing the safe columns from the browser
revoke update on public.profiles from authenticated;
grant  update (full_name, avatar_url) on public.profiles to authenticated;
grant  select on public.profiles to authenticated;

-- 6) BACKFILL profiles for users that already exist ---------------------
insert into public.profiles (id, email, full_name, avatar_url, providers, last_sign_in_at)
select u.id,
       u.email,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
       coalesce(array(select jsonb_array_elements_text(u.raw_app_meta_data -> 'providers')), '{}'),
       u.last_sign_in_at
from auth.users u
on conflict (id) do nothing;

-- =====================================================================
-- DONE. Now follow README.md for: Site URL, Redirect URLs, Google login.
-- =====================================================================

-- =====================================================================
--  PART 2: PROFILE, SETTINGS, GALLERY, FRIENDS, SUPPORT, DELETE ACCOUNT
-- =====================================================================
alter table public.profiles
  add column if not exists username     text unique,
  add column if not exists bio          text,
  add column if not exists country      text,
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision,
  add column if not exists country_code text,                 -- ISO 3166-1 alpha-2, e.g. 'IN' (drives the country flag)
  add column if not exists city         text,
  add column if not exists region       text,                 -- state / province
  add column if not exists location_updated_at timestamptz,
  add column if not exists settings     jsonb not null default
    '{"quick":"❤️","hideMature":true,"haptic":true,"floating":true,"translate":false,"mute":true,"hideLoc":false,"lang":"en","notif":true,"noShare":true}'::jsonb;

update public.profiles
set settings = settings - 'restrict'
where settings ? 'restrict';

alter table public.profiles drop constraint if exists username_format;
alter table public.profiles add constraint username_format
  check (username is null or username ~ '^[a-z0-9_.]{3,24}$');

-- Location values come from the browser (reverse-geocoded), so they are validated here too.
alter table public.profiles drop constraint if exists location_format;
alter table public.profiles add constraint location_format check (
  (country_code is null or country_code ~ '^[A-Z]{2}$')
  and (city   is null or (char_length(city)   <= 80 and city   !~ '[<>]'))
  and (region is null or (char_length(region) <= 80 and region !~ '[<>]'))
  and (country is null or (char_length(country) <= 80 and country !~ '[<>]'))
  and (location_lat is null or location_lat between -90  and 90)
  and (location_lng is null or location_lng between -180 and 180)
) not valid;   -- NOT VALID: enforced for every new write without failing on any old rows

revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, username, bio, country, country_code, city, region, location_lat, location_lng, location_updated_at, settings)
  on public.profiles to authenticated;

-- Public-safe view of other users (no email). Used by friends and chat.
-- "Hide Location" ON  -> others get NO city, state or coordinates (the map pin disappears) but still get country_code (the flag).
create or replace function public._loc_hidden(s jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((s ->> 'hideLoc')::boolean, false);
$$;
create or replace view public.public_profiles as
  select id, full_name, username, avatar_url, country, bio, created_at,
         country_code,
         case when public._loc_hidden(settings) then null else city   end as city,
         case when public._loc_hidden(settings) then null else region end as region,
         case when public._loc_hidden(settings) then null else round(location_lat::numeric, 2)::double precision end as location_lat,
         case when public._loc_hidden(settings) then null else round(location_lng::numeric, 2)::double precision end as location_lng
  from public.profiles;
grant select on public.public_profiles to authenticated;

-- Map: users with "Hide Location" ON never appear.
create or replace view public.map_users as
  select id, full_name, username, avatar_url, location_lat, location_lng
  from public.profiles
  where coalesce((settings ->> 'hideLoc')::boolean, false) = false
    and location_lat is not null and location_lng is not null;
grant select on public.map_users to authenticated;

-- Gallery
create table if not exists public.gallery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);
alter table public.gallery enable row level security;
drop policy if exists "gallery select" on public.gallery;
drop policy if exists "gallery insert" on public.gallery;
drop policy if exists "gallery delete" on public.gallery;
create policy "gallery select" on public.gallery for select to authenticated using (true);
create policy "gallery insert" on public.gallery for insert to authenticated with check (auth.uid() = user_id);
create policy "gallery delete" on public.gallery for delete to authenticated using (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('gallery', 'gallery', true) on conflict do nothing;
drop policy if exists "gallery upload own" on storage.objects;
drop policy if exists "gallery remove own" on storage.objects;
create policy "gallery upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "gallery remove own" on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and (storage.foldername(name))[1] = auth.uid()::text);

-- Friends
create table if not exists public.friendships (
  user_id   uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  status    text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id), check (user_id <> friend_id)
);
alter table public.friendships enable row level security;
drop policy if exists "friends select" on public.friendships;
drop policy if exists "friends insert" on public.friendships;
drop policy if exists "friends update" on public.friendships;
drop policy if exists "friends delete" on public.friendships;
create policy "friends select" on public.friendships for select to authenticated using (auth.uid() in (user_id, friend_id));
create policy "friends insert" on public.friendships for insert to authenticated with check (auth.uid() = user_id);
create policy "friends update" on public.friendships for update to authenticated using (auth.uid() = friend_id);
create policy "friends delete" on public.friendships for delete to authenticated using (auth.uid() in (user_id, friend_id));

drop function if exists public.can_invite(uuid);

-- Support tickets (Contact us)
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text, subject text not null check (char_length(subject) between 3 and 150),
  message text not null check (char_length(message) between 10 and 4000),
  status text not null default 'open', created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
drop policy if exists "tickets select" on public.support_tickets;
drop policy if exists "tickets insert" on public.support_tickets;
create policy "tickets select" on public.support_tickets for select to authenticated using (auth.uid() = user_id);
create policy "tickets insert" on public.support_tickets for insert to authenticated with check (auth.uid() = user_id);

-- Delete account (removes auth user; everything else cascades)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end; $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
-- DONE (part 2)

-- =====================================================================
--  PART 3: WATCH HISTORY, PROFILE SECTIONS (videos, channels, interests,
--          friends, socials, per-section visibility)
-- =====================================================================
alter table public.profiles
  add column if not exists visibility jsonb not null default
    '{"bio":true,"gallery":true,"stats":true,"friends":true,"videos":true,"keywords":true,"channels":true,"interests":true,"socials":true}'::jsonb,
  add column if not exists socials jsonb not null default '{}'::jsonb;
grant update (visibility, socials) on public.profiles to authenticated;

create table if not exists public.watch_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_url text not null, title text not null default '', thumb text,
  source text not null default 'web', channel text,
  nsfw boolean not null default false, liked boolean not null default false,
  watch_count int not null default 1, seconds int not null default 0,
  last_watched timestamptz not null default now(),
  unique (user_id, video_url)
);
create index if not exists watch_history_user_idx on public.watch_history (user_id, last_watched desc);
alter table public.watch_history enable row level security;
drop policy if exists "wh own select" on public.watch_history;
drop policy if exists "wh own insert" on public.watch_history;
drop policy if exists "wh own update" on public.watch_history;
drop policy if exists "wh own delete" on public.watch_history;
create policy "wh own select" on public.watch_history for select to authenticated using (auth.uid() = user_id);
create policy "wh own insert" on public.watch_history for insert to authenticated with check (auth.uid() = user_id);
create policy "wh own update" on public.watch_history for update to authenticated using (auth.uid() = user_id);
create policy "wh own delete" on public.watch_history for delete to authenticated using (auth.uid() = user_id);

-- Call whenever a user watches a video (every user gets their OWN history).
create or replace function public.log_watch(p_url text, p_title text, p_thumb text, p_source text,
  p_channel text, p_nsfw boolean, p_seconds int default 0)
returns void language sql security invoker set search_path = '' as $$
  insert into public.watch_history (user_id, video_url, title, thumb, source, channel, nsfw, seconds)
  values (auth.uid(), p_url, left(coalesce(p_title,''),200), p_thumb, coalesce(p_source,'web'), p_channel,
          coalesce(p_nsfw,false), greatest(coalesce(p_seconds,0),0))
  on conflict (user_id, video_url) do update set
    watch_count = public.watch_history.watch_count + 1, last_watched = now(),
    seconds = public.watch_history.seconds + excluded.seconds, title = excluded.title,
    thumb = coalesce(excluded.thumb, public.watch_history.thumb);
$$;
create or replace function public.set_like(p_url text, p_liked boolean)
returns void language sql security invoker set search_path = '' as $$
  update public.watch_history set liked = p_liked where user_id = auth.uid() and video_url = p_url;
$$;
grant execute on function public.log_watch(text,text,text,text,text,boolean,int) to authenticated;
grant execute on function public.set_like(text,boolean) to authenticated;

create or replace function public._vis(v jsonb, k text, own boolean)
returns boolean language sql immutable set search_path = '' as $$
  select own or coalesce((v ->> k)::boolean, true);
$$;

-- One call returns a profile as THIS viewer may see it.
--  * hidden sections are never sent to other users (enforced here, not in the browser)
--  * NSFW videos only appear if the profile owner flagged include_nsfw AND the viewer has
--    "Hide Mature Content" turned OFF
--  * preview = true shows the owner exactly what others see
drop function if exists public.public_profile(uuid,boolean,boolean);
create or replace function public.public_profile(p_uid uuid, p_preview boolean default false, p_nsfw boolean default false)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare p public.profiles; own boolean; s jsonb; incl boolean; vids jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into p from public.profiles where id = p_uid;
  if not found then return null; end if;
  own := (auth.uid() = p_uid and not p_preview);
  incl := p_nsfw and coalesce((select (not coalesce((settings ->> 'hideMature')::boolean, true)) and maturity_verified from public.profiles where id = auth.uid()), false);
  s := jsonb_build_object(
    'bio', public._vis(p.visibility,'bio',own), 'gallery', public._vis(p.visibility,'gallery',own),
    'stats', public._vis(p.visibility,'stats',own), 'friends', public._vis(p.visibility,'friends',own),
    'videos', public._vis(p.visibility,'videos',own), 'keywords', public._vis(p.visibility,'keywords',own),
    'channels', public._vis(p.visibility,'channels',own), 'interests', public._vis(p.visibility,'interests',own),
    'socials', public._vis(p.visibility,'socials',own));
  with h as (select * from public.watch_history where user_id = p_uid and (not nsfw or incl))
  select jsonb_build_object(
    'top',     (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select video_url,title,thumb,source,channel,watch_count from h order by watch_count desc, last_watched desc limit 20) t),
    'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select video_url,title,thumb,source,channel,watch_count from h order by last_watched desc limit 30) t),
    'liked',   (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select video_url,title,thumb,source,channel,watch_count from h where liked order by last_watched desc limit 30) t),
    'channels',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select channel as name, sum(watch_count)::int as n from h where channel is not null and channel <> '' group by 1 order by 2 desc limit 12) t),
    'interests',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select source as name, sum(watch_count)::int as n from h group by 1 order by 2 desc limit 8) t),
    'titles',  (select coalesce(jsonb_agg(title),'[]') from (select title from h order by last_watched desc limit 100) t)
  ) into vids;
  return jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'username', p.username, 'avatar', p.avatar_url, 'country', p.country,
    'country_code', p.country_code,
    'city',   case when public._loc_hidden(p.settings) then null else p.city end,
    'region', case when public._loc_hidden(p.settings) then null else p.region end,
    'lat',    case when public._loc_hidden(p.settings) then null else round(p.location_lat::numeric, 2) end,
    'lng',    case when public._loc_hidden(p.settings) then null else round(p.location_lng::numeric, 2) end,
    'joined', p.created_at, 'own', own, 'visibility', case when own then p.visibility end, 's', s,
    'bio',     case when (s->>'bio')::boolean then coalesce(p.bio,'') end,
    'socials', case when (s->>'socials')::boolean then p.socials end,
    'gallery', case when (s->>'gallery')::boolean then (select coalesce(jsonb_agg(path order by created_at desc),'[]') from public.gallery where user_id = p_uid) end,
    'stats',   case when (s->>'stats')::boolean then jsonb_build_object(
                 'videos', (select count(*) from public.watch_history where user_id = p_uid),
                 'hours',  round(coalesce((select sum(seconds) from public.watch_history where user_id = p_uid),0) / 3600.0, 1),
                 'friends',(select count(*) from public.friendships where status='accepted' and p_uid in (user_id, friend_id))) end,
    'friends', case when (s->>'friends')::boolean then (select coalesce(jsonb_agg(to_jsonb(f)),'[]') from (
                 select pp.id, pp.full_name, pp.username, pp.avatar_url,
                        (select count(*) from public.watch_history w where w.user_id = pp.id) as score
                 from public.friendships fr
                 join public.profiles pp on pp.id = case when fr.user_id = p_uid then fr.friend_id else fr.user_id end
                 where fr.status='accepted' and p_uid in (fr.user_id, fr.friend_id)
                 order by score desc limit 20) f) end,
    'videos',  case when (s->>'videos')::boolean then jsonb_build_object('top',vids->'top','history',vids->'history','liked',vids->'liked') end,
    'channels',case when (s->>'channels')::boolean then vids->'channels' end,
    'interests',case when (s->>'interests')::boolean then vids->'interests' end,
    'titles',  case when (s->>'keywords')::boolean then vids->'titles' end);
end; $$;
grant execute on function public.public_profile(uuid,boolean,boolean) to authenticated;

-- Plan badge shown on login.html ("Free Plan" / "Pro Plan"). Written only by your server / payment webhook.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'inactive', current_period_end timestamptz,
  created_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "sub own select" on public.subscriptions;
create policy "sub own select" on public.subscriptions for select to authenticated using (auth.uid() = user_id);
-- DONE (part 3). Next: README.md

-- =====================================================================
--  PART 4: PRODUCTION PROFILE  (required username, availability check,
--          avatar storage, gallery limits, social links validation)
--  Safe to re-run.
-- =====================================================================

-- Unique username, case-insensitive
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- Field limits (NOT VALID = applies to new/changed rows, never breaks old data)
alter table public.profiles drop constraint if exists bio_length;
alter table public.profiles add constraint bio_length check (bio is null or char_length(bio) <= 300) not valid;
alter table public.profiles drop constraint if exists name_length;
alter table public.profiles add constraint name_length check (full_name is null or char_length(full_name) between 1 and 60) not valid;
alter table public.profiles drop constraint if exists socials_shape;
alter table public.profiles add constraint socials_shape check (jsonb_typeof(socials) = 'object' and pg_column_size(socials) < 4000) not valid;

-- Reserved + format rules enforced on the server (the browser check is only a convenience)
create or replace function public.enforce_username()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.username is not null and (tg_op = 'INSERT' or new.username is distinct from old.username) then
    new.username := lower(new.username);
    if new.username !~ '^[a-z0-9_.]{3,24}$' or new.username ~ '^[._]|[._]$|[._]{2}'
       or new.username = any (array['admin','administrator','root','support','help','nova','system','moderator','mod','staff','official','null','undefined','api','www','settings','login','logout','signup','profile','user','users','me']) then
      raise exception 'invalid username' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists profiles_enforce_username on public.profiles;
create trigger profiles_enforce_username before insert or update of username on public.profiles
  for each row execute function public.enforce_username();

-- Live "is this username free?" check used by the profile page
create or replace function public.username_available(p_username text)
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(p_username, '') ~ '^[a-z0-9_.]{3,24}$'
     and p_username !~ '^[._]|[._]$|[._]{2}'
     and p_username <> all (array['admin','administrator','root','support','help','nova','system','moderator','mod','staff','official','null','undefined','api','www','settings','login','logout','signup','profile','user','users','me'])
     and not exists (select 1 from public.profiles
                     where lower(username) = lower(p_username)
                       and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid));
$$;
revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- Do not bring a removed Google photo / name back on every login
create or replace function public.handle_user_updated()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p
     set email = new.email,
         providers = coalesce(array(select jsonb_array_elements_text(new.raw_app_meta_data -> 'providers')), p.providers),
         last_sign_in_at = new.last_sign_in_at
   where p.id = new.id;
  return new;
end; $$;

-- Storage: profile photos (public read, owner write) + safer limits for both buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'] where id = 'gallery';

drop policy if exists "avatars upload own" on storage.objects;
drop policy if exists "avatars update own" on storage.objects;
drop policy if exists "avatars remove own" on storage.objects;
create policy "avatars upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars remove own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Gallery: max 30 photos per user, and the table is private (others see it only through
-- public_profile(), which respects the 👁️/🙈 visibility switch)
create or replace function public.gallery_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.gallery where user_id = new.user_id) >= 30 then
    raise exception 'Gallery limit reached (30 photos)';
  end if;
  return new;
end; $$;
drop trigger if exists gallery_limit_trg on public.gallery;
create trigger gallery_limit_trg before insert on public.gallery for each row execute function public.gallery_limit();
drop policy if exists "gallery select" on public.gallery;
create policy "gallery select" on public.gallery for select to authenticated using (auth.uid() = user_id);
-- DONE (part 4)


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
grant update (full_name, avatar_url, username, bio, country, country_code, city, region, location_lat, location_lng, location_updated_at, settings, visibility, socials)
  on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- DONE (part 5)

-- =====================================================================
--  PART 6: 18+ AGE ASSURANCE (face liveness + age check)  — safe to re-run
--  * profiles.maturity_verified is written ONLY by the server (api/age-verify.js, service role).
--    The browser role has no UPDATE grant on these columns, so it can never self-verify.
--  * A trigger keeps "Hide Mature Content" ON for every account that is not verified,
--    even if someone edits their own settings JSON through the API.
--  * age_sessions holds one-time verification sessions (nonce hash, random challenge order,
--    progress). No images, landmarks or biometric templates are ever stored.
-- =====================================================================
alter table public.profiles
  add column if not exists maturity_verified    boolean not null default false,
  add column if not exists maturity_verified_at timestamptz,
  add column if not exists maturity_method      text;

-- (re)state the browser's column grants WITHOUT the maturity_* columns
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, username, bio, country, country_code, city, region, location_lat, location_lng, location_updated_at, settings, visibility, socials)
  on public.profiles to authenticated;

create or replace function public.enforce_mature_gate()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- a signed-in end user (auth.uid() is set) can never flip the verified flag;
  -- only the server (service role) or a dashboard/SQL session can
  if tg_op = 'UPDATE' and auth.uid() is not null then
    new.maturity_verified    := old.maturity_verified;
    new.maturity_verified_at := old.maturity_verified_at;
    new.maturity_method      := old.maturity_method;
  end if;
  -- unverified accounts always keep mature content hidden
  if not new.maturity_verified and new.settings is not null
     and coalesce((new.settings ->> 'hideMature')::boolean, true) = false then
    new.settings := jsonb_set(new.settings, '{hideMature}', 'true'::jsonb);
  end if;
  return new;
end; $$;
drop trigger if exists profiles_enforce_mature_gate on public.profiles;
create trigger profiles_enforce_mature_gate before insert or update on public.profiles
  for each row execute function public.enforce_mature_gate();

create table if not exists public.age_sessions (
  nonce_hash     text primary key,                               -- sha256 of the one-time nonce
  user_id        uuid not null references auth.users (id) on delete cascade,
  challenges     text[] not null,                                -- server-chosen random order
  step           int  not null default 0,                        -- next step the server expects
  total          int  not null,
  status         text not null default 'open' check (status in ('open','finalizing','passed','failed')),
  evidence       jsonb not null default '[]'::jsonb,
  step_issued_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);
create index if not exists age_sessions_user_idx on public.age_sessions (user_id, created_at desc);
alter table public.age_sessions enable row level security;      -- no policies: service role only
revoke all on public.age_sessions from anon, authenticated;
-- DONE (part 6)
