-- Nova: keep the 18+ (NSFW) mark of a video inside the room's media, so every user sees the badge on Nova Home.
-- Run once in the Supabase SQL editor (safe to run again). Only this one function changes.

create or replace function public._clean_media(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; u text; r jsonb;
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
  end if;
  if coalesce(p->>'nsfw','') = 'true' then r := r || '{"nsfw":true}'::jsonb; end if;
  u := p->>'thumb';
  if u is not null and length(u) <= 500 and u ~ '^https://[^\s<>"'']+$' then
    r := r || jsonb_build_object('thumb', u);
  end if;
  return r;
end $$;
