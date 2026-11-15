-- Nova: let a room's video carry several qualities (media.q) so every member's player picks the one THEIR connection can hold.
-- X posts offer ~320 / 480 / 720 / 1080 mp4 files; the room keeps all of them (max 5) next to the default `url`.
-- Run once in the Supabase SQL editor, AFTER nsfw-flag-schema.sql (safe to run again). Only this one function changes;
-- everything the previous version kept (title, provider, nsfw mark, thumb, youtube ids) is still kept.
--   media.q = [ {"h": 720, "u": "https://…/720x1280/….mp4", "b": 2176000}, … ]   h = short side in px, b = bit/s (0 if unknown)

create or replace function public._clean_media(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; u text; r jsonb; qa jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  k := p->>'kind';
  if k is null or k not in ('youtube','video','embed') then raise exception 'Unsupported media'; end if;
  r := jsonb_build_object('kind', k,
        'title', left(coalesce(nullif(p->>'title',''), 'Video'), 160),
        'provider', left(coalesce(nullif(p->>'provider',''), k), 20));
  if k = 'youtube' then
    if coalesce(p->>'id','') <> '' then
      if p->>'id' !~ '^[A-Za-z0-9_-]{6,20}$' then raise exception 'Bad video id'; end if;
      r := r || jsonb_build_object('id', p->>'id');
    end if;
    if coalesce(p->>'pl','') <> '' then
      if p->>'pl' !~ '^[A-Za-z0-9_-]{10,64}$' then raise exception 'Bad playlist id'; end if;
      r := r || jsonb_build_object('pl', p->>'pl');
    end if;
    if r->>'id' is null and r->>'pl' is null then raise exception 'Missing video'; end if;
    if coalesce(p->>'live','') = 'true' then r := r || '{"live":true}'::jsonb; end if;
  else
    u := p->>'url';
    if u is null or length(u) > 1000 or u !~ '^https://[^\s<>"'']+$' then raise exception 'Invalid link'; end if;
    r := r || jsonb_build_object('url', u);
    -- quality ladder (plain files only): max 5 rungs, each a valid https link + sane numbers; anything else is dropped silently
    if k = 'video' and jsonb_typeof(p->'q') = 'array' then
      select coalesce(jsonb_agg(jsonb_build_object('h', s.h, 'u', s.u, 'b', s.b) order by s.h), '[]'::jsonb) into qa
        from (
          select (e->>'h')::int as h, e->>'u' as u, coalesce((e->>'b')::int, 0) as b
            from jsonb_array_elements(p->'q') with ordinality as t(e, n)
           where n <= 5
             and jsonb_typeof(e) = 'object'
             and coalesce(e->>'u','') ~ '^https://[^\s<>"'']+$' and length(e->>'u') <= 400
             and coalesce(e->>'h','') ~ '^[0-9]{3,4}$'
             and coalesce(e->>'b','0') ~ '^[0-9]{1,9}$'
        ) s;
      if jsonb_array_length(qa) > 1 then r := r || jsonb_build_object('q', qa); end if;
    end if;
  end if;
  if coalesce(p->>'nsfw','') = 'true' then r := r || '{"nsfw":true}'::jsonb; end if;
  u := p->>'thumb';
  if u is not null and length(u) <= 500 and u ~ '^https://[^\s<>"'']+$' then
    r := r || jsonb_build_object('thumb', u);
  end if;
  return r;
end $$;
