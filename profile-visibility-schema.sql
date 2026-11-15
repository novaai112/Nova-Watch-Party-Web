-- =====================================================================
--  PROFILE VISIBILITY: Public / Friends / Hidden for every profile section,
--  plus separate settings for Most watched (top), History and Likes.
--  Run once in the Supabase SQL editor AFTER schema.sql. Safe to re-run.
--
--  profiles.visibility stores one mode per section:
--     { "bio":"public", "gallery":"friends", "top":"hidden", "history":"friends", "likes":"public", ... }
--  Old boolean values still work (true = public, false = hidden).
--  A missing top / history / likes key follows the old "videos" setting.
--  Enforced on the server: a hidden or friends-only section is never sent to someone who may not see it.
-- =====================================================================

-- 1) mode helpers ------------------------------------------------------
create or replace function public._vis_mode(v jsonb, k text)
returns text language sql immutable set search_path = '' as $$
  select case
    when v is null then 'public'
    when jsonb_typeof(v -> k) = 'string'  and (v ->> k) in ('public','friends','hidden') then v ->> k
    when jsonb_typeof(v -> k) = 'boolean' then case when (v ->> k)::boolean then 'public' else 'hidden' end
    when k in ('top','history','likes') and v ? 'videos' then
         case when jsonb_typeof(v -> 'videos') = 'boolean'
              then case when (v ->> 'videos')::boolean then 'public' else 'hidden' end
              when (v ->> 'videos') in ('public','friends','hidden') then v ->> 'videos'
              else 'public' end
    else 'public' end;
$$;

-- may this viewer see section k?   own = the owner, is_friend = accepted friendship
create or replace function public._can_see(v jsonb, k text, own boolean, is_friend boolean)
returns boolean language sql immutable set search_path = '' as $$
  select own or case public._vis_mode(v, k)
                  when 'public'  then true
                  when 'friends' then coalesce(is_friend, false)
                  else false end;
$$;

-- keep the old signature working for anything that still calls it
create or replace function public._vis(v jsonb, k text, own boolean)
returns boolean language sql immutable set search_path = '' as $$
  select public._can_see(v, k, own, false);
$$;

-- 2) only known sections and known modes can be stored ---------------------
create or replace function public.clean_visibility()
returns trigger language plpgsql set search_path = '' as $$
declare k text; res jsonb := '{}'::jsonb;
begin
  if new.visibility is null or jsonb_typeof(new.visibility) <> 'object' then
    new.visibility := '{}'::jsonb;
  end if;
  foreach k in array array['bio','gallery','stats','socials','top','history','likes','keywords','channels','interests'] loop
    res := res || jsonb_build_object(k, public._vis_mode(new.visibility, k));
  end loop;
  new.visibility := res;
  return new;
end; $$;
drop trigger if exists profiles_clean_visibility on public.profiles;
create trigger profiles_clean_visibility before insert or update of visibility on public.profiles
  for each row execute function public.clean_visibility();

alter table public.profiles alter column visibility set default
  '{"bio":"public","gallery":"public","stats":"public","friends":"public","socials":"public","top":"public","history":"public","likes":"public","keywords":"public","channels":"public","interests":"public"}'::jsonb;

-- bring every existing row to the new shape (the trigger normalises it)
update public.profiles set visibility = coalesce(visibility, '{}'::jsonb);

-- 3) watch activity that other people may be allowed to see ----------------
alter table public.watch_history drop constraint if exists watch_history_count_ok;
alter table public.watch_history add constraint watch_history_count_ok check (watch_count >= 0);

-- a link for any item kept on the device (YouTube id, playlist id or url)
create or replace function public._item_url(i jsonb)
returns text language sql immutable set search_path = '' as $$
  select left(coalesce(
    nullif(i ->> 'url', ''),
    case when nullif(i ->> 'id', '') is not null then 'https://www.youtube.com/watch?v=' || (i ->> 'id') end,
    case when nullif(i ->> 'pl', '') is not null then 'https://www.youtube.com/playlist?list=' || (i ->> 'pl') end), 500);
$$;

-- Mirror this device's History and Likes to the account (additive: it never deletes).
create or replace function public.sync_watch_activity(p_history jsonb, p_likes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare i jsonb; u text; th text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  for i in select * from jsonb_array_elements(coalesce(case when jsonb_typeof(p_history) = 'array' then p_history end, '[]'::jsonb)) limit 200 loop
    u := public._item_url(i); continue when u is null or u !~ '^https?://';
    th := nullif(i ->> 'th', ''); if th is not null and th !~ '^https://' then th := null; end if;
    insert into public.watch_history (user_id, video_url, title, thumb, source, channel, watch_count, last_watched)
    values (auth.uid(), u, left(coalesce(i ->> 't', ''), 200), th, left(coalesce(nullif(i ->> 'provider', ''), 'web'), 40),
            left(nullif(i ->> 'ch', ''), 120), greatest(coalesce((i ->> 'n')::int, 1), 1),
            coalesce(to_timestamp(nullif(i ->> 'at', '')::double precision / 1000.0), now()))
    on conflict (user_id, video_url) do update set
      watch_count = greatest(public.watch_history.watch_count, excluded.watch_count),
      last_watched = greatest(public.watch_history.last_watched, excluded.last_watched),
      title = case when excluded.title <> '' then excluded.title else public.watch_history.title end,
      thumb = coalesce(excluded.thumb, public.watch_history.thumb),
      channel = coalesce(excluded.channel, public.watch_history.channel);
  end loop;
  for i in select * from jsonb_array_elements(coalesce(case when jsonb_typeof(p_likes) = 'array' then p_likes end, '[]'::jsonb)) limit 200 loop
    u := public._item_url(i); continue when u is null or u !~ '^https?://';
    th := nullif(i ->> 'th', ''); if th is not null and th !~ '^https://' then th := null; end if;
    insert into public.watch_history (user_id, video_url, title, thumb, source, channel, watch_count, liked)
    values (auth.uid(), u, left(coalesce(i ->> 't', ''), 200), th, left(coalesce(nullif(i ->> 'provider', ''), 'web'), 40),
            left(nullif(i ->> 'ch', ''), 120), 0, true)          -- liked only: not counted as watched
    on conflict (user_id, video_url) do update set liked = true;
  end loop;
end; $$;
grant execute on function public.sync_watch_activity(jsonb, jsonb) to authenticated;

-- Remove one video from History (a liked video stays in Likes), or clear all History.
create or replace function public.remove_watch(p_url text)
returns void language sql security invoker set search_path = '' as $$
  delete from public.watch_history where user_id = auth.uid() and video_url = p_url and not liked;
  update public.watch_history set watch_count = 0 where user_id = auth.uid() and video_url = p_url and liked;
$$;
create or replace function public.clear_watch_history()
returns void language sql security invoker set search_path = '' as $$
  delete from public.watch_history where user_id = auth.uid() and not liked;
  update public.watch_history set watch_count = 0, seconds = 0 where user_id = auth.uid() and liked;
$$;
grant execute on function public.remove_watch(text) to authenticated;
grant execute on function public.clear_watch_history() to authenticated;

-- Unlike: drop the row when it was never watched either.
create or replace function public.set_like(p_url text, p_liked boolean)
returns void language sql security invoker set search_path = '' as $$
  update public.watch_history set liked = p_liked where user_id = auth.uid() and video_url = p_url;
  delete from public.watch_history where user_id = auth.uid() and video_url = p_url and not liked and watch_count = 0;
$$;
grant execute on function public.set_like(text, boolean) to authenticated;


-- 3b) per-photo privacy: every gallery photo is Public / Friends / Hidden on its own -------
alter table public.gallery add column if not exists visibility text not null default 'public';
alter table public.gallery drop constraint if exists gallery_visibility_ok;
alter table public.gallery add constraint gallery_visibility_ok check (visibility in ('public','friends','hidden'));
grant update (visibility) on public.gallery to authenticated;
drop policy if exists "gallery update own" on public.gallery;
create policy "gallery update own" on public.gallery for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- other people never read the table directly any more: they get photos only through public_profile()
drop policy if exists "gallery select" on public.gallery;
drop policy if exists "gallery select own" on public.gallery;
create policy "gallery select own" on public.gallery for select to authenticated using (auth.uid() = user_id);

-- 4) one call returns a profile as THIS viewer may see it ----------------------
--  * every section follows its own mode: public / friends (accepted friends only) / hidden
--  * top (Most watched), history and likes are separate; the owner always sees everything
--  * NSFW videos only appear if the owner flagged include_nsfw AND the viewer has "Hide Mature Content" OFF
--  * preview = true shows the owner exactly what a (non-friend) visitor sees
drop function if exists public.public_profile(uuid, boolean, boolean);
create or replace function public.public_profile(p_uid uuid, p_preview boolean default false, p_nsfw boolean default false)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare p public.profiles; own boolean; fr boolean; s jsonb; incl boolean; vids jsonb; vis jsonb; k text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into p from public.profiles where id = p_uid;
  if not found then return null; end if;
  own := (auth.uid() = p_uid and not p_preview);
  fr  := (not own) and (auth.uid() <> p_uid) and exists (
           select 1 from public.friendships f where f.status = 'accepted'
             and ((f.user_id = auth.uid() and f.friend_id = p_uid) or (f.user_id = p_uid and f.friend_id = auth.uid())));
  incl := p_nsfw and coalesce((select (not coalesce((settings ->> 'hideMature')::boolean, true)) and maturity_verified from public.profiles where id = auth.uid()), false);

  s := '{}'::jsonb; vis := '{}'::jsonb;
  foreach k in array array['bio','gallery','stats','socials','top','history','likes','keywords','channels','interests'] loop
    s   := s   || jsonb_build_object(k, public._can_see(p.visibility, k, own, fr));
    vis := vis || jsonb_build_object(k, public._vis_mode(p.visibility, k));
  end loop;
  -- old clients read s.videos
  s := s || jsonb_build_object('videos', (s->>'top')::boolean or (s->>'history')::boolean or (s->>'likes')::boolean);

  with h as (select * from public.watch_history where user_id = p_uid and (not nsfw or incl))
  select jsonb_build_object(
    'top',     (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select video_url,title,thumb,source,channel,watch_count from h where watch_count >= 2 order by watch_count desc, last_watched desc limit 20) t),
    'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select video_url,title,thumb,source,channel,watch_count from h where watch_count > 0 order by last_watched desc limit 30) t),
    'liked',   (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select video_url,title,thumb,source,channel,watch_count from h where liked order by last_watched desc limit 30) t),
    'channels',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select channel as name, sum(watch_count)::int as n, (array_agg(thumb order by watch_count desc) filter (where thumb is not null and thumb <> ''))[1] as thumb from h where channel is not null and channel <> '' and watch_count > 0 group by 1 order by 2 desc limit 40) t),
    'interests',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select source as name, sum(watch_count)::int as n from h where watch_count > 0 group by 1 order by 2 desc limit 8) t),
    'titles',  (select coalesce(jsonb_agg(title),'[]') from (select title from h where watch_count > 0 order by last_watched desc limit 100) t)
  ) into vids;

  return jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'username', p.username, 'avatar', p.avatar_url, 'country', p.country,
    'country_code', p.country_code,
    'city',   case when public._loc_hidden(p.settings) then null else p.city end,
    'region', case when public._loc_hidden(p.settings) then null else p.region end,
    'lat',    case when public._loc_hidden(p.settings) then null else round(p.location_lat::numeric, 2) end,
    'lng',    case when public._loc_hidden(p.settings) then null else round(p.location_lng::numeric, 2) end,
    'joined', p.created_at, 'own', own, 'is_friend', fr, 'visibility', case when own then vis end, 's', s,
    'bio',     case when (s->>'bio')::boolean then coalesce(p.bio,'') end,
    'socials', case when (s->>'socials')::boolean then p.socials end,
    'gallery', case when (s->>'gallery')::boolean then (select coalesce(jsonb_agg(path order by created_at desc),'[]') from public.gallery
                 where user_id = p_uid and (own or visibility = 'public' or (visibility = 'friends' and fr))) end,
    'stats',   case when (s->>'stats')::boolean then jsonb_build_object(
                 'videos', (select count(*) from public.watch_history where user_id = p_uid and watch_count > 0),
                 'hours',  round(coalesce((select sum(seconds) from public.watch_history where user_id = p_uid),0) / 3600.0, 1),
                 'friends',(select count(*) from public.friendships where status='accepted' and p_uid in (user_id, friend_id))) end,
    -- each list only when its own mode allows it (null = not shared with this viewer)
    'videos',  case when (s->>'videos')::boolean then jsonb_build_object(
                 'top',     case when (s->>'top')::boolean     then vids->'top' end,
                 'history', case when (s->>'history')::boolean then vids->'history' end,
                 'liked',   case when (s->>'likes')::boolean   then vids->'liked' end) end,
    'channels',case when (s->>'channels')::boolean then vids->'channels' end,
    'interests',case when (s->>'interests')::boolean then vids->'interests' end,
    'titles',  case when (s->>'keywords')::boolean then vids->'titles' end);
end; $$;
grant execute on function public.public_profile(uuid, boolean, boolean) to authenticated;

-- make the API pick up the new functions straight away
notify pgrst, 'reload schema';
