-- ============================================================================
-- Nova Play — interactive watch-room games   (run AFTER rooms-schema.sql; safe to re-run)
-- Then run room-games-bank.sql once to load the question bank.
--
--  * ONLY the current room admin (rooms.admin_id, read live on every call) can start / configure / pause /
--    resume / skip / end / reveal / rematch. Every member can join, answer and view results.
--  * The SERVER decides time: room_now() is the only clock; clients tick overdue rounds through game_state().
--  * Correct answers live in game_questions (no client access). Answers live in game_answers (no client access)
--    and are only summarised after the reveal.
--  * Scores are computed once, inside the reveal transaction that moves question -> reveal (row-locked).
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.game_bank (
  id         bigint generated always as identity primary key,
  game       text not null check (game in ('trivia','movie','emoji','song','wyr')),
  category   text not null,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  q          jsonb not null
);
create unique index if not exists game_bank_uq on public.game_bank (game, (q->>'prompt'), (coalesce(q->>'emoji','')));

create table if not exists public.game_sessions (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  game         text not null check (game in ('trivia','movie','emoji','song','predict','wyr','video')),
  status       text not null default 'lobby' check (status in ('lobby','countdown','idle','question','locked','reveal','paused','ended')),
  cfg          jsonb not null default '{}'::jsonb,
  admin_id     uuid not null,                   -- admin of record: follows rooms.admin_id
  started_by   uuid not null,                   -- who pressed Start (history)
  q_idx        int  not null default -1,
  total        int  not null default 0,
  phase_start  bigint not null default 0,       -- server ms
  phase_end    bigint not null default 0,       -- server ms, 0 = no deadline
  phase_ms     bigint not null default 0,       -- length of the current timed phase
  paused_phase text, paused_left bigint not null default 0, paused_timed boolean not null default false,
  paused_at    bigint not null default 0, paused_reason text,
  current      jsonb,                           -- the question every member sees (never the answer)
  reveal       jsonb,                           -- result of the last question
  summary      jsonb,                           -- final results
  seq          int  not null default 0,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);
-- ONE active game per room
create unique index if not exists game_sessions_one_active on public.game_sessions(room_id) where status <> 'ended';
create index if not exists game_sessions_room_idx on public.game_sessions(room_id, created_at desc);

create table if not exists public.game_questions (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  idx        int  not null,
  kind       text not null check (kind in ('mcq','text','poll','predict')),
  prompt     text not null,
  emoji      text,
  options    jsonb,
  correct    int,
  answer_text text,
  accept     jsonb,
  seconds    int,
  cat        text,
  primary key (session_id, idx)
);

create table if not exists public.game_players (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  room_id    uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  team       text check (team in ('red','blue')),
  spectator  boolean not null default false,
  left_game  boolean not null default false,
  from_idx   int not null default 0,
  score int not null default 0, correct int not null default 0, answered int not null default 0,
  streak int not null default 0, best_streak int not null default 0, total_ms bigint not null default 0,
  joined_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.game_answers (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  idx        int  not null,
  user_id    uuid not null,
  choice     int,
  text_answer text,
  at_ms      bigint not null,
  primary key (session_id, idx, user_id)
);

create table if not exists public.game_results (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  room_id    uuid not null,
  game       text not null,
  score int not null default 0, correct int not null default 0, answered int not null default 0,
  rank int not null default 0, players int not null default 1, best_streak int not null default 0,
  team text, won boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index if not exists game_results_user_idx on public.game_results(user_id, created_at desc);

create table if not exists public.game_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp bigint not null default 0,
  badges text[] not null default '{}',
  daily_streak int not null default 0,
  last_daily date
);
create table if not exists public.game_rewards (       -- one row per claimed daily challenge
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null, key text not null, xp int not null,
  primary key (user_id, day, key)
);

-- ---------- row level security: reads only, ALL writes go through the functions below ----------
alter table public.game_bank      enable row level security;
alter table public.game_sessions  enable row level security;
alter table public.game_questions enable row level security;
alter table public.game_players   enable row level security;
alter table public.game_answers   enable row level security;
alter table public.game_results   enable row level security;
alter table public.game_profile   enable row level security;
alter table public.game_rewards   enable row level security;
revoke all on public.game_bank, public.game_questions, public.game_answers, public.game_rewards from public, anon, authenticated;
revoke all on public.game_sessions, public.game_players, public.game_results, public.game_profile from public, anon, authenticated;

drop policy if exists game_sessions_member_select on public.game_sessions;
drop policy if exists game_players_member_select  on public.game_players;
drop policy if exists game_results_select         on public.game_results;
drop policy if exists game_profile_own_select     on public.game_profile;
create policy game_sessions_member_select on public.game_sessions for select to authenticated using (public.is_room_member(room_id));
create policy game_players_member_select  on public.game_players  for select to authenticated using (public.is_room_member(room_id));
create policy game_results_select         on public.game_results  for select to authenticated using (user_id = auth.uid() or public.is_room_member(room_id));
create policy game_profile_own_select     on public.game_profile  for select to authenticated using (user_id = auth.uid());
grant select on public.game_sessions, public.game_players, public.game_results, public.game_profile to authenticated;

-- ---------- internal helpers ----------
create or replace function public._game_label(g text) returns text language sql immutable as $$
  select case g when 'trivia' then 'Quick Trivia' when 'movie' then 'Guess the Movie' when 'emoji' then 'Emoji Challenge'
    when 'song' then 'Guess the Song' when 'predict' then 'Predict What Happens Next' when 'wyr' then 'Would You Rather?'
    when 'video' then 'Video Knowledge Challenge' else g end
$$;

create or replace function public._game_name(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(full_name, ''), nullif(username, '')) from public.public_profiles where id = uid), 'Someone')
$$;

-- lower-case, letters+digits only, leading "the" dropped: "The Lion-King!" = "lion king" = "lionking"
create or replace function public._game_norm(t text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(t, '')), '[^[:alnum:]]+', '', 'g'), '^the', '')
$$;

create or replace function public._game_int(t text, lo int, hi int) returns int language sql immutable as $$
  select case when t ~ '^[0-9]{1,4}$' then case when t::int between lo and hi then t::int end end
$$;

-- clean + clamp the admin's configuration (never trust the client)
create or replace function public._game_cfg(p_game text, p jsonb) returns jsonb
language plpgsql stable as $$
declare
  c jsonb := case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end;
  v_cnt int := coalesce(public._game_int(c->>'count', 1, 20), 10);
  v_sec int := coalesce(public._game_int(c->>'seconds', 3, 120), 15);
  v_cust jsonb := '[]'::jsonb; e jsonb; o jsonb; v_opts jsonb; v_cor int; v_s int;
  v_red text := left(coalesce(nullif(btrim(c#>>'{team_names,red}'), ''), 'Red Team'), 20);
  v_blue text := left(coalesce(nullif(btrim(c#>>'{team_names,blue}'), ''), 'Blue Team'), 20);
begin
  if v_cnt not in (5, 10, 15, 20) then v_cnt := 10; end if;
  if v_sec not in (5, 10, 15, 30, 60) then v_sec := 15; end if;
  if jsonb_typeof(c->'custom') = 'array' then
    for e in select * from jsonb_array_elements(c->'custom') limit 30 loop
      continue when jsonb_typeof(e) <> 'object' or length(btrim(coalesce(e->>'prompt', ''))) = 0;
      select coalesce(jsonb_agg(left(btrim(x), 80)), '[]'::jsonb) into v_opts
        from (select x from jsonb_array_elements_text(case when jsonb_typeof(e->'options') = 'array' then e->'options' else '[]'::jsonb end) x
              where length(btrim(x)) > 0 limit 4) z;
      continue when jsonb_array_length(v_opts) < 2;
      v_cor := public._game_int(e->>'correct', 0, jsonb_array_length(v_opts) - 1);
      v_s := public._game_int(e->>'seconds', 3, 120);
      if v_s is not null and v_s not in (5, 10, 15, 30, 60) then v_s := null; end if;
      v_cust := v_cust || jsonb_build_array(jsonb_build_object('prompt', left(btrim(e->>'prompt'), 200), 'options', v_opts,
                                                               'correct', v_cor, 'seconds', v_s));
    end loop;
  end if;
  return jsonb_build_object(
    'difficulty',    case when c->>'difficulty' in ('easy','medium','hard','mix') then c->>'difficulty' else 'medium' end,
    'count',         v_cnt,
    'seconds',       v_sec,
    'mode',          case when c->>'mode' = 'team' and p_game not in ('wyr') then 'team' else 'individual' end,
    'team_pick',     case when c->>'team_pick' = 'choose' then 'choose' else 'auto' end,
    'team_names',    jsonb_build_object('red', v_red, 'blue', v_blue),
    'participation', case when c->>'participation' = 'optional' then 'optional' else 'open' end,
    'order',         case when c->>'order' = 'fixed' then 'fixed' else 'random' end,
    'show',          case when c->>'show' = 'end' then 'end' else 'each' end,
    'changes',       coalesce((c->>'changes')::boolean, true),
    'spectator',     coalesce((c->>'spectator')::boolean, true),
    'sound',         coalesce((c->>'sound')::boolean, true),
    'lang',          left(coalesce(nullif(btrim(c->>'lang'), ''), 'en'), 8),
    'category',      left(coalesce(nullif(btrim(c->>'category'), ''), 'Random Mix'), 40),
    'movie_cat',     case when c->>'movie_cat' in ('any','description','actor','scene','emoji','mcq') then c->>'movie_cat' else 'any' end,
    'emoji_cat',     case when c->>'emoji_cat' in ('any','movie','character','song','phrase') then c->>'emoji_cat' else 'any' end,
    'emoji_mc',      coalesce((c->>'emoji_mc')::boolean, false),
    'song_mode',     case when c->>'song_mode' in ('title','artist','mix') then c->>'song_mode' else 'mix' end,
    'manual',        p_game in ('video', 'predict'),
    'custom',        v_cust);
exception when invalid_text_representation then
  return public._game_cfg(p_game, null);
end $$;

-- add one question to a session (shuffles MCQ options; custom questions keep the admin's order)
create or replace function public._game_add_q(p_sid uuid, p_idx int, p_q jsonb, p_shuffle boolean, p_cor int default null, p_secs int default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_kind text := p_q->>'kind'; v_ans text := p_q->>'answer'; v_opts jsonb := null; v_cor int := p_cor;
begin
  if v_kind in ('mcq', 'poll', 'predict') or jsonb_typeof(p_q->'options') = 'array' and v_kind = 'text' and coalesce((p_q->>'as_mcq')::boolean, false) then
    select case when p_shuffle and v_kind <> 'poll' then jsonb_agg(o order by random()) else jsonb_agg(o order by ord) end into v_opts
      from jsonb_array_elements_text(p_q->'options') with ordinality t(o, ord);
    if v_ans is not null then
      select (ord - 1)::int into v_cor from jsonb_array_elements_text(v_opts) with ordinality t(o, ord) where o = v_ans limit 1;
    end if;
    if coalesce((p_q->>'as_mcq')::boolean, false) then v_kind := 'mcq'; end if;
  end if;
  insert into public.game_questions(session_id, idx, kind, prompt, emoji, options, correct, answer_text, accept, seconds, cat)
  values (p_sid, p_idx, v_kind, p_q->>'prompt', nullif(p_q->>'emoji', ''), v_opts, v_cor, v_ans,
          case when v_kind = 'text' then coalesce(p_q->'accept', '[]'::jsonb) end, p_secs, p_q->>'cat');
end $$;

-- smaller team gets the next player (random on a tie)
create or replace function public._game_small_team(p_sid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when r < b or (r = b and random() < 0.5) then 'red' else 'blue' end
  from (select count(*) filter (where team = 'red' and not spectator and not left_game) r,
               count(*) filter (where team = 'blue' and not spectator and not left_game) b
        from public.game_players where session_id = p_sid) x
$$;

create or replace function public._game_assign_teams(p_sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl record;
begin
  for pl in select user_id from public.game_players where session_id = p_sid and team is null and not spectator order by random() loop
    update public.game_players set team = public._game_small_team(p_sid) where session_id = p_sid and user_id = pl.user_id;
  end loop;
end $$;

-- ---------- state machine ----------
create or replace function public._game_open_question(p_sid uuid, p_idx int, p_anchor bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions; q public.game_questions; v_sec int;
begin
  select * into s from public.game_sessions where id = p_sid;
  select * into q from public.game_questions where session_id = p_sid and idx = p_idx;
  if not found then return; end if;
  if p_idx = 0 and s.cfg->>'mode' = 'team' then perform public._game_assign_teams(p_sid); end if;
  v_sec := coalesce(q.seconds, public._game_int(s.cfg->>'seconds', 3, 120), 15);
  update public.game_sessions set status = 'question', q_idx = p_idx, phase_start = p_anchor, phase_end = p_anchor + v_sec * 1000,
         phase_ms = v_sec * 1000, reveal = null, seq = seq + 1,
         current = jsonb_build_object('idx', q.idx, 'n', q.idx + 1, 'total', s.total, 'kind', q.kind, 'prompt', q.prompt,
                                      'emoji', q.emoji, 'options', q.options, 'cat', q.cat, 'seconds', v_sec)
   where id = p_sid;
end $$;

-- score the question ONCE (callers hold the session row lock and only call this from status question/locked)
create or replace function public._game_reveal(p_sid uuid, p_anchor bigint, p_correct int default null, p_override boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions; q public.game_questions; pl record; v_ok boolean; v_pts int; v_speed int; v_ns int; v_ms bigint;
  v_acc text[]; v_res jsonb := '{}'::jsonb; v_counts jsonb := '[]'::jsonb; v_fast uuid; v_fast_ms bigint; v_n int; v_show boolean; v_dur bigint;
begin
  select * into s from public.game_sessions where id = p_sid;
  select * into q from public.game_questions where session_id = p_sid and idx = s.q_idx;
  if not found then return; end if;
  if p_override then update public.game_questions set correct = p_correct where session_id = p_sid and idx = q.idx; q.correct := p_correct; end if;
  v_show := s.cfg->>'show' = 'each' or q.kind = 'predict';
  select array_agg(public._game_norm(x)) into v_acc
    from (select q.answer_text x union all select jsonb_array_elements_text(coalesce(q.accept, '[]'::jsonb))) t where x is not null;
  for pl in
    select p.user_id, p.streak, a.choice, a.text_answer, a.at_ms
      from public.game_players p
      left join public.game_answers a on a.session_id = p.session_id and a.idx = q.idx and a.user_id = p.user_id
     where p.session_id = p_sid and not p.spectator and p.from_idx <= q.idx
  loop
    v_ok := false; v_pts := 0; v_ms := 0; v_ns := pl.streak;
    if q.kind = 'poll' then
      if pl.at_ms is not null then update public.game_players set answered = answered + 1 where session_id = p_sid and user_id = pl.user_id; end if;
      v_res := v_res || jsonb_build_object(pl.user_id::text, jsonb_build_object('ans', pl.at_ms is not null));
      continue;
    end if;
    if pl.at_ms is not null then
      if q.kind in ('mcq', 'predict') then v_ok := q.correct is not null and pl.choice = q.correct;
      else v_ok := public._game_norm(pl.text_answer) = any(coalesce(v_acc, '{}'::text[])) and length(public._game_norm(pl.text_answer)) > 0; end if;
    end if;
    if v_ok then
      v_ms := greatest(0, pl.at_ms - s.phase_start);
      v_speed := greatest(0, least(50, floor(50 * (1 - v_ms::numeric / greatest(s.phase_ms, 1)))::int));
      v_ns := pl.streak + 1;
      v_pts := 100 + v_speed + case v_ns when 3 then 25 when 5 then 50 else 0 end;
      update public.game_players set score = score + v_pts, correct = correct + 1, answered = answered + 1, streak = v_ns,
             best_streak = greatest(best_streak, v_ns), total_ms = total_ms + v_ms where session_id = p_sid and user_id = pl.user_id;
      if v_fast is null or v_ms < v_fast_ms then v_fast := pl.user_id; v_fast_ms := v_ms; end if;
    else
      v_ns := 0;
      update public.game_players set streak = 0, answered = answered + (case when pl.at_ms is not null then 1 else 0 end)
       where session_id = p_sid and user_id = pl.user_id;
    end if;
    v_res := v_res || jsonb_build_object(pl.user_id::text, jsonb_build_object('pts', v_pts, 'ok', v_ok, 'ms', v_ms, 'ans', pl.at_ms is not null, 'streak', v_ns));
  end loop;
  v_n := coalesce(jsonb_array_length(q.options), 0);
  if v_n > 0 then
    select coalesce(jsonb_agg(coalesce(c.n, 0) order by g.i), '[]'::jsonb) into v_counts
      from generate_series(0, v_n - 1) g(i)
      left join (select choice, count(*) n from public.game_answers where session_id = p_sid and idx = q.idx group by choice) c on c.choice = g.i;
  end if;
  v_dur := case when s.cfg->>'manual' = 'true' then 0 when v_show then 5000 else 3000 end;
  update public.game_sessions set status = 'reveal', phase_start = p_anchor, phase_end = case when v_dur > 0 then p_anchor + v_dur else 0 end,
         phase_ms = v_dur, seq = seq + 1,
         reveal = jsonb_build_object('idx', q.idx, 'kind', q.kind, 'shown', v_show,
                    'correct', case when v_show then q.correct end,
                    'text', case when v_show and q.kind = 'text' then q.answer_text end,
                    'results', v_res, 'fastest', v_fast, 'counts', v_counts)
   where id = p_sid;
end $$;

create or replace function public._game_finish(p_sid uuid, p_reason text default 'completed') returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions; v_rank jsonb; v_teams jsonb := null; v_winner uuid := null; v_wteam text := null; v_review jsonb; v_pts boolean; v_cnt int;
  v_rs int; v_bs int; v_dur bigint; r record; v_first boolean; v_badges text[]; v_wname text;
begin
  select * into s from public.game_sessions where id = p_sid;
  if not found or s.status = 'ended' then return; end if;
  v_pts := s.game <> 'wyr';
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'score', score, 'correct', correct, 'answered', answered,
           'streak', best_streak, 'ms', total_ms, 'team', team, 'rank', rk) order by rk), '[]'::jsonb), count(*)::int
    into v_rank, v_cnt
    from (select p.*, row_number() over (order by p.score desc, p.correct desc, p.total_ms asc, p.user_id) rk
            from public.game_players p where p.session_id = p_sid and not p.spectator and p.answered > 0) x;
  if s.cfg->>'mode' = 'team' then
    select coalesce(sum(score), 0) into v_rs from public.game_players where session_id = p_sid and team = 'red'  and not spectator and answered > 0;
    select coalesce(sum(score), 0) into v_bs from public.game_players where session_id = p_sid and team = 'blue' and not spectator and answered > 0;
    v_teams := jsonb_build_object(
      'red',  (select jsonb_build_object('score', coalesce(sum(score), 0), 'correct', coalesce(sum(correct), 0), 'members', count(*), 'streak', coalesce(max(best_streak), 0))
                 from public.game_players where session_id = p_sid and team = 'red' and not spectator and answered > 0),
      'blue', (select jsonb_build_object('score', coalesce(sum(score), 0), 'correct', coalesce(sum(correct), 0), 'members', count(*), 'streak', coalesce(max(best_streak), 0))
                 from public.game_players where session_id = p_sid and team = 'blue' and not spectator and answered > 0));
    v_wteam := case when v_rs > v_bs then 'red' when v_bs > v_rs then 'blue' end;
    v_teams := v_teams || jsonb_build_object('winner', v_wteam);
  end if;
  select (x->>'user_id')::uuid into v_winner from jsonb_array_elements(v_rank) x where (x->>'rank')::int = 1 and (x->>'score')::int > 0;
  if not v_pts or s.cfg->>'mode' = 'team' then v_winner := null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('n', idx + 1, 'prompt', prompt, 'emoji', emoji,
           'answer', case when kind = 'poll' then null when kind = 'text' then answer_text when correct is not null then options->>correct end) order by idx), '[]'::jsonb)
    into v_review from public.game_questions where session_id = p_sid and idx <= s.q_idx;
  v_dur := greatest(0, (extract(epoch from now() - s.created_at) * 1000)::bigint);
  update public.game_sessions set status = 'ended', ended_at = now(), phase_end = 0, current = null, seq = seq + 1,
         summary = jsonb_build_object('reason', p_reason, 'winner', v_winner, 'ranking', v_rank, 'teams', v_teams, 'review', v_review,
                                      'participants', jsonb_array_length(v_rank), 'duration_ms', v_dur)
   where id = p_sid;
  -- history + rewards: only people who actually answered (no rewards for idle time)
  for r in select (x->>'user_id')::uuid uid, (x->>'score')::int sc, (x->>'correct')::int co, (x->>'answered')::int an,
                  (x->>'rank')::int rk, (x->>'streak')::int bst, x->>'team' tm from jsonb_array_elements(v_rank) x loop
    insert into public.game_results(session_id, user_id, room_id, game, score, correct, answered, rank, players, best_streak, team, won)
    values (p_sid, r.uid, s.room_id, s.game, r.sc, r.co, r.an, r.rk, jsonb_array_length(v_rank), r.bst, r.tm,
            case when s.cfg->>'mode' = 'team' then v_wteam is not null and r.tm = v_wteam
                 else v_pts and r.rk = 1 and jsonb_array_length(v_rank) >= 2 and r.sc > 0 end)
    on conflict do nothing;
    select not exists(select 1 from public.game_results g where g.user_id = r.uid and g.won and g.session_id <> p_sid) into v_first;
    v_badges := '{}';
    if r.bst >= 5 then v_badges := array_append(v_badges, 'streak5'::text); end if;
    if s.cfg->>'mode' = 'team' then v_badges := array_append(v_badges, 'team_player'::text); end if;
    if v_first and exists(select 1 from public.game_results g where g.session_id = p_sid and g.user_id = r.uid and g.won) then v_badges := array_append(v_badges, 'first_win'::text); end if;
    insert into public.game_profile(user_id, xp, badges)
    values (r.uid, 10 + r.sc / 20 + case when exists(select 1 from public.game_results g where g.session_id = p_sid and g.user_id = r.uid and g.won) then 25 else 0 end, v_badges)
    on conflict (user_id) do update set xp = public.game_profile.xp + excluded.xp,
      badges = (select coalesce(array_agg(distinct b), '{}') from unnest(public.game_profile.badges || excluded.badges) b);
  end loop;
  if v_winner is not null then v_wname := public._game_name(v_winner); end if;
  perform public._notice(s.room_id, s.admin_id, case
    when s.cfg->>'mode' = 'team' and v_wteam is not null then 'Game ended · ' || (s.cfg#>>array['team_names', v_wteam]) || ' wins'
    when v_wname is not null then 'Game ended · Winner: ' || v_wname
    else 'Game ended' end);
end $$;

-- one natural/forced transition. p_anchor = the moment the old phase ended (keeps the rhythm drift-free)
create or replace function public._game_advance(p_sid uuid, p_anchor bigint, p_force boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions; v_manual boolean;
begin
  select * into s from public.game_sessions where id = p_sid;
  if not found or s.status in ('ended', 'paused') then return; end if;
  v_manual := s.cfg->>'manual' = 'true';
  if s.status = 'lobby' then
    update public.game_sessions set status = 'countdown', phase_start = p_anchor, phase_end = p_anchor + 3000, phase_ms = 3000, seq = seq + 1 where id = p_sid;
  elsif s.status = 'countdown' then
    if v_manual then
      update public.game_sessions set status = 'idle', phase_start = p_anchor, phase_end = 0, phase_ms = 0, seq = seq + 1 where id = p_sid;
    else perform public._game_open_question(p_sid, 0, p_anchor); end if;
  elsif s.status = 'question' then
    if s.game = 'predict' then
      update public.game_sessions set status = 'locked', phase_end = 0, seq = seq + 1 where id = p_sid;
    else perform public._game_reveal(p_sid, p_anchor); end if;
  elsif s.status = 'reveal' then
    if v_manual and not p_force then return; end if;
    if s.q_idx + 1 < s.total then perform public._game_open_question(p_sid, s.q_idx + 1, p_anchor);
    elsif v_manual then raise exception 'No more questions. Add one or end the game.';
    else perform public._game_finish(p_sid, 'completed'); end if;
  elsif s.status = 'idle' then
    if p_force then
      if s.total < 1 then raise exception 'Add a question first.'; end if;
      perform public._game_open_question(p_sid, 0, p_anchor);
    end if;
  elsif s.status = 'locked' then
    if p_force then perform public._game_reveal(p_sid, p_anchor, null, true); end if;
  end if;
end $$;

create or replace function public._game_pause(p_sid uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions; v_now bigint := public.room_now();
begin
  select * into s from public.game_sessions where id = p_sid;
  if not found or s.status = 'ended' then return; end if;
  if s.status = 'paused' then
    update public.game_sessions set paused_reason = p_reason, paused_at = case when p_reason = 'admin' then v_now else paused_at end, seq = seq + 1 where id = p_sid;
    return;
  end if;
  update public.game_sessions set paused_phase = status, paused_timed = phase_end > 0, paused_left = greatest(phase_end - v_now, 0),
         paused_at = v_now, paused_reason = p_reason, status = 'paused', phase_end = 0, seq = seq + 1 where id = p_sid;
end $$;

create or replace function public._game_resume(p_sid uuid, p_now bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions; v_dur bigint;
begin
  select * into s from public.game_sessions where id = p_sid;
  if not found or s.status <> 'paused' then return; end if;
  v_dur := greatest(0, p_now - s.paused_at);
  update public.game_sessions set status = coalesce(paused_phase, 'idle'), paused_reason = null,
         phase_end = case when paused_timed then p_now + paused_left else 0 end,
         phase_start = phase_start + v_dur, seq = seq + 1 where id = p_sid;
  -- answers given before the pause keep their time-to-answer: shift them by the pause length
  if s.paused_phase = 'question' then
    update public.game_answers set at_ms = at_ms + v_dur where session_id = p_sid and idx = s.q_idx;
  end if;
end $$;

create or replace function public._game_tick_locked(p_sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions; v_now bigint; it int := 0;
begin
  loop
    it := it + 1; exit when it > 60;
    select * into s from public.game_sessions where id = p_sid;
    exit when not found or s.status = 'ended';
    v_now := public.room_now();
    if s.status = 'paused' then
      -- admin changed: the server resumes after 60 s if the new admin has not
      exit when not (s.paused_reason = 'admin' and v_now - s.paused_at > 60000);
      perform public._game_resume(p_sid, v_now);
    elsif s.phase_end > 0 and v_now >= s.phase_end then
      perform public._game_advance(p_sid, s.phase_end);
    else exit; end if;
  end loop;
end $$;

create or replace function public._game_tick(p_sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.game_sessions where id = p_sid and status <> 'ended' for update skip locked;
  if not found then return; end if;
  perform public._game_tick_locked(p_sid);
end $$;

create or replace function public._game_admin(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.rooms where id = p_room and admin_id = auth.uid() and status = 'open') then
    raise exception 'Only the room admin can control games';
  end if;
end $$;

-- lock a session for an admin action, after proving the caller is the CURRENT room admin
create or replace function public._game_lock(p_sid uuid) returns public.game_sessions
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions;
begin
  select * into s from public.game_sessions where id = p_sid for update;
  if not found then raise exception 'Game not found'; end if;
  perform public._game_admin(s.room_id);
  if s.status = 'ended' then raise exception 'This game has ended'; end if;
  perform public._game_tick_locked(p_sid);
  select * into s from public.game_sessions where id = p_sid;
  if s.status = 'ended' then raise exception 'This game has ended'; end if;
  return s;
end $$;

-- ---------- admin transitions + closing rooms ----------
create or replace function public._game_on_room_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if new.status = 'closed' and old.status <> 'closed' then
    for g in select id from public.game_sessions where room_id = new.id and status <> 'ended' loop
      perform public._game_finish(g.id, 'room closed');
    end loop;
  elsif new.admin_id is distinct from old.admin_id then
    for g in select id from public.game_sessions where room_id = new.id and status <> 'ended' loop
      update public.game_sessions set admin_id = new.admin_id where id = g.id;      -- the old admin loses control immediately
      perform public._game_pause(g.id, 'admin');                                     -- paused until the new admin (or the server) resumes
    end loop;
    if found then perform public._notice(new.id, new.admin_id, 'Game paused while the room admin changes'); end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_game_room_change on public.rooms;
create trigger trg_game_room_change after update of admin_id, status on public.rooms
  for each row execute function public._game_on_room_change();

-- ============================================================================
-- ADMIN RPCs
-- ============================================================================
create or replace function public._game_start(p_room uuid, p_game text, p_cfg jsonb, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb; sid uuid; v_now bigint := public.room_now(); n int := 0; v_want int; r record; e jsonb; v_q jsonb; v_manual boolean; v_opt boolean;
begin
  if p_game not in ('trivia','movie','emoji','song','predict','wyr','video') then raise exception 'Unknown game'; end if;
  v_cfg := public._game_cfg(p_game, p_cfg);
  v_manual := v_cfg->>'manual' = 'true';
  v_opt := v_cfg->>'participation' = 'optional';
  v_want := (v_cfg->>'count')::int;
  if p_game = 'video' and jsonb_array_length(v_cfg->'custom') < 1 then raise exception 'Add at least one question about the video.'; end if;
  if exists(select 1 from public.game_sessions where room_id = p_room and status <> 'ended') then
    raise exception 'A game is already running. End it before starting another.';
  end if;
  -- the stored (member-readable) config never carries the admin's custom questions or their correct answers
  insert into public.game_sessions(room_id, game, status, cfg, admin_id, started_by, phase_start, phase_end, phase_ms)
  values (p_room, p_game, case when v_opt then 'lobby' else 'countdown' end,
          v_cfg - 'custom' || jsonb_build_object('custom_n', jsonb_array_length(v_cfg->'custom')), p_uid, p_uid, v_now,
          v_now + case when v_opt then 10000 else 3000 end, case when v_opt then 10000 else 3000 end)
  returning id into sid;
  -- the admin's own questions first (their order), then the bank
  for e in select * from jsonb_array_elements(v_cfg->'custom') loop
    perform public._game_add_q(sid, n, jsonb_build_object('kind', case when p_game = 'wyr' then 'poll' when p_game = 'predict' then 'predict' else 'mcq' end,
      'prompt', e->>'prompt', 'options', e->'options', 'answer', case when e->>'correct' is not null and p_game <> 'predict' then e->'options'->>((e->>'correct')::int) end, 'cat', 'Custom'),
      false, case when p_game = 'predict' then null else (e->>'correct')::int end, (e->>'seconds')::int);
    n := n + 1;
  end loop;
  if p_game in ('trivia','movie','emoji','song','wyr') then
    for r in
      select b.q, b.category from public.game_bank b
       where b.game = p_game
         and (p_game <> 'trivia' or v_cfg->>'category' in ('Random Mix', '') or b.category = v_cfg->>'category')
         and (p_game <> 'movie' or v_cfg->>'movie_cat' = 'any' or b.category = v_cfg->>'movie_cat')
         and (p_game <> 'emoji' or v_cfg->>'emoji_cat' = 'any' or b.category = v_cfg->>'emoji_cat')
       order by case when v_cfg->>'difficulty' = 'mix' or b.difficulty = v_cfg->>'difficulty' then 0 else 1 end,
                case when v_cfg->>'order' = 'fixed' then b.id::double precision else random() end
       limit greatest(v_want - n, case when n = 0 then v_want else 0 end)
    loop
      exit when n >= v_want and n > 0;
      v_q := r.q || jsonb_build_object('cat', r.category);
      if p_game = 'song' then
        if v_cfg->>'song_mode' = 'title' or (v_cfg->>'song_mode' = 'mix' and n % 2 = 0) then
          v_q := jsonb_build_object('kind', 'mcq', 'prompt', 'Which song is this? ' || (r.q->>'prompt'), 'options', r.q->'titleOptions', 'answer', r.q->>'title', 'cat', 'Song');
        else
          v_q := jsonb_build_object('kind', 'mcq', 'prompt', 'Who sings it? ' || (r.q->>'prompt'), 'options', r.q->'artistOptions', 'answer', r.q->>'artist', 'cat', 'Artist');
        end if;
      elsif p_game = 'emoji' then
        v_q := v_q || jsonb_build_object('as_mcq', v_cfg->>'emoji_mc' = 'true');
        v_q := v_q || jsonb_build_object('kind', 'text');
      end if;
      perform public._game_add_q(sid, n, v_q, true);
      n := n + 1;
    end loop;
  end if;
  if n = 0 and not v_manual then raise exception 'No questions available for these settings.'; end if;
  update public.game_sessions set total = n where id = sid;
  -- players: everyone in the room (open) or just the admin until others press Join (optional)
  insert into public.game_players(session_id, room_id, user_id)
    select sid, p_room, m.user_id from public.room_members m where m.room_id = p_room and (not v_opt or m.user_id = p_uid);
  if v_cfg->>'mode' = 'team' and v_cfg->>'team_pick' = 'auto' then perform public._game_assign_teams(sid); end if;
  perform public._notice(p_room, p_uid, public._game_name(p_uid) || ' started ' || public._game_label(p_game));
  return jsonb_build_object('id', sid);
end $$;

create or replace function public.game_start(p_room uuid, p_game text, p_cfg jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._game_admin(p_room);
  return public._game_start(p_room, p_game, p_cfg, auth.uid());
exception when unique_violation then
  raise exception 'A game is already running. End it before starting another.';
end $$;

create or replace function public.game_pause(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions;
begin
  s := public._game_lock(p_session);
  if s.status = 'paused' then return; end if;
  perform public._game_pause(p_session, 'manual');
  perform public._notice(s.room_id, auth.uid(), 'Game paused');
end $$;

create or replace function public.game_resume(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions;
begin
  s := public._game_lock(p_session);
  if s.status <> 'paused' then return; end if;
  perform public._game_resume(p_session, public.room_now());
  perform public._notice(s.room_id, auth.uid(), 'Game resumed');
end $$;

-- p_mode 'skip' = close this question now;  'next' = go on from the results screen
create or replace function public._game_force(p_session uuid, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions; v_now bigint := public.room_now();
begin
  s := public._game_lock(p_session);
  if s.status = 'paused' then raise exception 'Resume the game first.'; end if;
  if s.status = 'question' and p_mode = 'next' then raise exception 'Wait for the question to finish, or skip it.'; end if;
  perform public._game_advance(p_session, v_now, true);
end $$;
create or replace function public.game_skip(p_session uuid) returns void language sql security definer set search_path = public as $$ select public._game_force(p_session, 'skip') $$;
create or replace function public.game_next(p_session uuid) returns void language sql security definer set search_path = public as $$ select public._game_force(p_session, 'next') $$;

create or replace function public.game_end(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions;
begin
  s := public._game_lock(p_session);
  perform public._game_finish(p_session, 'ended by admin');
end $$;

-- Predict What Happens Next: the admin reveals which option really happened (null = nothing happened / no points)
create or replace function public.game_reveal(p_session uuid, p_correct int default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions; q public.game_questions;
begin
  s := public._game_lock(p_session);
  if s.game <> 'predict' then raise exception 'Only Predict What Happens Next uses a manual reveal.'; end if;
  if s.status <> 'locked' then raise exception 'Answers are still open.'; end if;
  select * into q from public.game_questions where session_id = p_session and idx = s.q_idx;
  if p_correct is not null and (p_correct < 0 or p_correct >= coalesce(jsonb_array_length(q.options), 0)) then raise exception 'Pick one of the options.'; end if;
  perform public._game_reveal(p_session, public.room_now(), p_correct, true);
end $$;

-- the admin adds a question while the game runs (Video Knowledge Challenge / Predict What Happens Next)
create or replace function public.game_add_question(p_session uuid, p_q jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions; v_c jsonb;
begin
  s := public._game_lock(p_session);
  if s.game not in ('video', 'predict') then raise exception 'Questions can only be added live to video and prediction games.'; end if;
  v_c := (public._game_cfg(s.game, jsonb_build_object('custom', jsonb_build_array(p_q))))->'custom'->0;
  if v_c is null then raise exception 'Write a question and at least two options.'; end if;
  if s.game = 'video' and v_c->>'correct' is null then raise exception 'Mark the correct answer.'; end if;
  if s.total >= 60 then raise exception 'That is plenty of questions for one game.'; end if;
  perform public._game_add_q(p_session, s.total,
    jsonb_build_object('kind', case when s.game = 'predict' then 'predict' else 'mcq' end, 'prompt', v_c->>'prompt', 'options', v_c->'options',
      'answer', case when s.game = 'video' then v_c->'options'->>((v_c->>'correct')::int) end, 'cat', 'Custom'),
    false, case when s.game = 'video' then (v_c->>'correct')::int end, (v_c->>'seconds')::int);
  update public.game_sessions set total = total + 1, seq = seq + 1,
         current = case when current is not null then jsonb_set(current, '{total}', to_jsonb(total + 1)) end where id = p_session;
end $$;

create or replace function public.game_rematch(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions;
begin
  select * into s from public.game_sessions where id = p_session;
  if not found then raise exception 'Game not found'; end if;
  perform public._game_admin(s.room_id);
  if s.status <> 'ended' then raise exception 'End the current game first.'; end if;
  return public._game_start(s.room_id, s.game, s.cfg || jsonb_build_object('custom', coalesce((
      select jsonb_agg(jsonb_build_object('prompt', prompt, 'options', options, 'correct', correct, 'seconds', seconds) order by idx)
        from public.game_questions where session_id = p_session and cat = 'Custom'), '[]'::jsonb)), auth.uid());
exception when unique_violation then raise exception 'A game is already running. End it before starting another.';
end $$;

-- ============================================================================
-- MEMBER RPCs
-- ============================================================================
create or replace function public.game_join(p_session uuid, p_team text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.game_sessions; pl public.game_players; v_early boolean; v_team text;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into s from public.game_sessions where id = p_session;
  if not found or s.status = 'ended' then raise exception 'This game has ended'; end if;
  if not public.is_room_member(s.room_id) then raise exception 'Not in this room'; end if;
  v_early := s.q_idx < 0;
  select * into pl from public.game_players where session_id = p_session and user_id = uid;
  v_team := case when s.cfg->>'mode' = 'team' then
              case when p_team in ('red','blue') and s.cfg->>'team_pick' = 'choose' and v_early then p_team else null end end;
  if found then
    update public.game_players set left_game = false,
           team = case when s.cfg->>'mode' = 'team' and v_team is not null then v_team else team end
     where session_id = p_session and user_id = uid;
  else
    insert into public.game_players(session_id, room_id, user_id, spectator, from_idx, team)
    values (p_session, s.room_id, uid,
            not v_early and s.status not in ('lobby','countdown','idle') and coalesce((s.cfg->>'spectator')::boolean, true),
            case when v_early then 0 else s.q_idx + 1 end, v_team);
    if s.cfg->>'mode' = 'team' and v_team is null then
      update public.game_players set team = public._game_small_team(p_session) where session_id = p_session and user_id = uid;
    end if;
  end if;
  update public.game_sessions set seq = seq + 1 where id = p_session;
end $$;

create or replace function public.game_leave(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.game_players set left_game = true where session_id = p_session and user_id = auth.uid();
  update public.game_sessions set seq = seq + 1 where id = p_session and status <> 'ended';
end $$;

create or replace function public.game_answer(p_session uuid, p_choice int default null, p_text text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.game_sessions; pl public.game_players; q public.game_questions; v_now bigint; v_t text; v_had boolean; v_n int;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  -- FOR SHARE: a reveal (FOR UPDATE) waits for in-flight answers, so no answer slips between "closed" and "scored"
  select * into s from public.game_sessions where id = p_session for share;
  if not found then raise exception 'Game not found'; end if;
  if not public.is_room_member(s.room_id) then raise exception 'Not in this room'; end if;
  v_now := public.room_now();
  if s.status <> 'question' or v_now >= s.phase_end then raise exception 'Time is up'; end if;
  select * into pl from public.game_players where session_id = p_session and user_id = uid;
  if not found or pl.spectator or pl.left_game or pl.from_idx > s.q_idx then raise exception 'You are not playing this round'; end if;
  select * into q from public.game_questions where session_id = p_session and idx = s.q_idx;
  if q.kind = 'text' then
    v_t := left(btrim(coalesce(p_text, '')), 120);
    if length(v_t) = 0 then raise exception 'Type your answer first'; end if;
    p_choice := null;
  else
    v_n := coalesce(jsonb_array_length(q.options), 0);
    if p_choice is null or p_choice < 0 or p_choice >= v_n then raise exception 'Pick one of the options'; end if;
    v_t := null;
  end if;
  select exists(select 1 from public.game_answers where session_id = p_session and idx = s.q_idx and user_id = uid) into v_had;
  if v_had and not coalesce((s.cfg->>'changes')::boolean, true) then raise exception 'Your answer is locked in'; end if;
  insert into public.game_answers(session_id, idx, user_id, choice, text_answer, at_ms) values (p_session, s.q_idx, uid, p_choice, v_t, v_now)
  on conflict (session_id, idx, user_id) do update set choice = excluded.choice, text_answer = excluded.text_answer, at_ms = excluded.at_ms;
  return jsonb_build_object('ok', true, 'changed', v_had);
end $$;

-- the whole picture for one member: session, players, and THIS member's own answer
create or replace function public.game_state(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.game_sessions; v_pl jsonb; v_me jsonb; v_ans jsonb;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if not public.is_room_member(p_room) then raise exception 'Not in this room'; end if;
  select * into s from public.game_sessions where room_id = p_room and status <> 'ended';
  if found then
    perform public._game_tick(s.id);
    select * into s from public.game_sessions where id = s.id;
  end if;
  if s.id is null or s.status = 'ended' then
    select * into s from public.game_sessions where room_id = p_room and status = 'ended' and ended_at > now() - interval '15 minutes'
     order by ended_at desc limit 1;
  end if;
  if s.id is null then return jsonb_build_object('now', public.room_now(), 'session', null); end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'team', team, 'spectator', spectator, 'left', left_game, 'from_idx', from_idx,
           'score', score, 'correct', correct, 'answered', answered, 'streak', streak, 'best', best_streak, 'ms', total_ms)), '[]'::jsonb)
    into v_pl from public.game_players where session_id = s.id;
  select to_jsonb(p) into v_me from (select team, spectator, left_game as "left", from_idx from public.game_players where session_id = s.id and user_id = uid) p;
  select jsonb_build_object('choice', choice, 'text', text_answer) into v_ans from public.game_answers where session_id = s.id and idx = s.q_idx and user_id = uid;
  return jsonb_build_object('now', public.room_now(), 'session', to_jsonb(s) - 'paused_left' - 'paused_timed',
                            'players', v_pl, 'me', v_me, 'answer', v_ans);
end $$;

create or replace function public.game_tick(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  perform 1 from public.game_sessions s where s.id = p_session and public.is_room_member(s.room_id);
  if found then perform public._game_tick(p_session); end if;
end $$;

-- ---------- history, statistics, daily challenges ----------
create or replace function public.game_history(p_room uuid, p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_room_member(p_room) then raise exception 'Not in this room'; end if;
  return coalesce((select jsonb_agg(h order by (h->>'ended_at') desc) from (
    select jsonb_build_object('id', id, 'game', game, 'started_by', started_by, 'created_at', created_at, 'ended_at', ended_at,
             'duration_ms', summary->'duration_ms', 'participants', summary->'participants', 'winner', summary->'winner',
             'mode', cfg->>'mode', 'teams', summary->'teams', 'ranking', summary->'ranking', 'names', cfg->'team_names') h
      from public.game_sessions where room_id = p_room and status = 'ended' and summary is not null
      order by ended_at desc limit least(greatest(coalesce(p_limit, 20), 1), 50)) z), '[]'::jsonb);
end $$;

create or replace function public.game_my_stats() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_p public.game_profile; v_xp bigint;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into v_p from public.game_profile where user_id = uid;
  v_xp := coalesce(v_p.xp, 0);
  return jsonb_build_object(
    'played', (select count(*) from public.game_results where user_id = uid),
    'wins', (select count(*) from public.game_results where user_id = uid and won),
    'correct', (select coalesce(sum(correct), 0) from public.game_results where user_id = uid),
    'points', (select coalesce(sum(score), 0) from public.game_results where user_id = uid),
    'best_rank', (select min(rank) from public.game_results where user_id = uid),
    'best_streak', (select coalesce(max(best_streak), 0) from public.game_results where user_id = uid),
    'favourite', (select game from public.game_results where user_id = uid group by game order by count(*) desc, max(created_at) desc limit 1),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('game', game, 'score', score, 'rank', rank, 'players', players, 'won', won, 'at', created_at) order by created_at desc)
                          from (select * from public.game_results where user_id = uid order by created_at desc limit 5) r), '[]'::jsonb),
    'xp', v_xp, 'badges', to_jsonb(coalesce(v_p.badges, '{}'::text[])), 'streak', coalesce(v_p.daily_streak, 0),
    'title', case when v_xp >= 4000 then 'Legend' when v_xp >= 1500 then 'Champion' when v_xp >= 600 then 'Challenger' when v_xp >= 200 then 'Player' else 'Rookie' end,
    'frame', case when v_xp >= 4000 then 'gold' when v_xp >= 1500 then 'silver' when v_xp >= 500 then 'bronze' end);
end $$;

create or replace function public._game_daily_rows(uid uuid) returns table(key text, title text, goal int, progress int, xp int)
language sql stable security definer set search_path = public as $$
  with t as (select * from public.game_results where user_id = uid and (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date)
  select 'trivia1', 'Complete one Quick Trivia game', 1, (select count(*)::int from t where game = 'trivia'), 30
  union all select 'correct5', 'Answer five questions correctly', 5, (select coalesce(sum(correct), 0)::int from t), 40
  union all select 'emoji_win', 'Win one Emoji Challenge', 1, (select count(*)::int from t where game = 'emoji' and won), 50
  union all select 'team1', 'Participate in a team battle', 1, (select count(*)::int from t where team is not null), 40
$$;

create or replace function public.game_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_day date := (now() at time zone 'utc')::date;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', d.key, 'title', d.title, 'goal', d.goal, 'progress', least(d.progress, d.goal), 'xp', d.xp,
            'done', d.progress >= d.goal, 'claimed', exists(select 1 from public.game_rewards w where w.user_id = uid and w.day = v_day and w.key = d.key)))
          from public._game_daily_rows(uid) d), '[]'::jsonb);
end $$;

create or replace function public.game_claim(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_day date := (now() at time zone 'utc')::date; d record; v_p public.game_profile; v_streak int; v_badges text[] := '{}';
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into d from public._game_daily_rows(uid) x where x.key = p_key;
  if not found then raise exception 'Unknown challenge'; end if;
  if d.progress < d.goal then raise exception 'Challenge not finished yet'; end if;
  insert into public.game_rewards(user_id, day, key, xp) values (uid, v_day, d.key, d.xp) on conflict do nothing;
  if not found then raise exception 'Already claimed'; end if;
  select * into v_p from public.game_profile where user_id = uid;
  v_streak := case when v_p.last_daily = v_day then coalesce(v_p.daily_streak, 1)
                   when v_p.last_daily = v_day - 1 then coalesce(v_p.daily_streak, 0) + 1 else 1 end;
  if v_streak >= 3 then v_badges := array_append(v_badges, 'streak3'::text); end if;
  if v_streak >= 7 then v_badges := array_append(v_badges, 'streak7'::text); end if;
  insert into public.game_profile(user_id, xp, badges, daily_streak, last_daily) values (uid, d.xp + case when v_streak in (3, 7) and v_p.last_daily is distinct from v_day then 50 else 0 end, v_badges, v_streak, v_day)
  on conflict (user_id) do update set xp = public.game_profile.xp + excluded.xp, daily_streak = excluded.daily_streak, last_daily = excluded.last_daily,
    badges = (select coalesce(array_agg(distinct b), '{}') from unnest(public.game_profile.badges || excluded.badges) b);
  return jsonb_build_object('xp', d.xp, 'streak', v_streak);
end $$;

-- ---------- permissions ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('game_start','game_pause','game_resume','game_skip','game_next','game_end','game_reveal','game_add_question',
             'game_rematch','game_join','game_leave','game_answer','game_state','game_tick','game_history','game_my_stats','game_daily','game_claim') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_game_label','_game_name','_game_norm','_game_int','_game_cfg','_game_add_q','_game_small_team','_game_assign_teams',
             '_game_open_question','_game_reveal','_game_finish','_game_advance','_game_pause','_game_resume','_game_tick_locked','_game_tick','_game_admin','_game_lock',
             '_game_on_room_change','_game_start','_game_force','_game_daily_rows') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- realtime: ONE event per state change (game_sessions only; players are read through game_state)
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.game_sessions';
  exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
