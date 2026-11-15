-- ============================================================================
-- Nova Play — DATABASE CLEAN-UP  (run once in the Supabase SQL editor, safe to re-run)
--
-- Removes everything the website no longer uses: the built-in question bank, game history,
-- player statistics, XP / badges and daily challenges. Games now run ONLY on questions the
-- room admin writes (text, emoji, image, answer options or a typed answer).
--
-- Order:  1) this file   2) room-games-schema.sql   (the schema file also repeats these drops, so either order is fine)
-- Nothing here touches rooms, room_members, chat, profiles, storage or any other table.
-- ============================================================================

-- 1) functions that only served history / stats / daily challenges / the old question builder
drop function if exists public.game_history(uuid, int);
drop function if exists public.game_my_stats();
drop function if exists public.game_daily();
drop function if exists public.game_claim(text);
drop function if exists public._game_daily_rows(uuid);
drop function if exists public._game_label(text);
drop function if exists public._game_cfg(text, jsonb);
drop function if exists public._game_add_q(uuid, int, jsonb, boolean, int, int);

-- 2) tables that only served the question bank, history, stats and rewards
drop table if exists public.game_rewards cascade;
drop table if exists public.game_profile cascade;
drop table if exists public.game_results  cascade;
drop table if exists public.game_bank     cascade;

-- 3) game_questions: the old "category" column goes, the new "image" column (a path in the room-media bucket) arrives
alter table if exists public.game_questions drop column if exists cat;
alter table if exists public.game_questions add column if not exists image text;

-- 4) finished games older than 30 days (their questions, players and answers cascade with them)
delete from public.game_sessions where status = 'ended' and ended_at < now() - interval '30 days';

notify pgrst, 'reload schema';

-- Check afterwards (should list ONLY: game_answers, game_players, game_questions, game_sessions):
--   select table_name from information_schema.tables where table_schema = 'public' and table_name like 'game\_%' order by 1;
