-- 021_sessions_session_date.sql
--
-- Lets a coach record a session on a date other than today.
--
-- Until now "when did this session happen" was answered by `created_at` — the
-- moment the recording was saved. That is fine when you log a session as it
-- ends, and wrong every other time: a coach who records Tuesday's session on
-- Wednesday morning had no way to say so, and the session landed on Wednesday
-- in every list, every calendar and every PDF.
--
-- `session_date` is the date the session actually happened. `created_at` stays
-- exactly as it is — the audit trail of when the row was written.

alter table public.sessions
  add column if not exists session_date date;

comment on column public.sessions.session_date is
  'The date the session actually took place, chosen by the coach. Falls back to created_at''s date for rows saved before this column existed.';

-- Backfill: every existing session happened the day it was saved, which is the
-- assumption the whole app has been making anyway.
update public.sessions
   set session_date = (created_at at time zone 'UTC')::date
 where session_date is null;

-- Session lists are ordered newest-first by date, with created_at as the
-- tiebreak for several sessions logged against the same day.
create index if not exists sessions_coach_session_date_idx
  on public.sessions (coach_id, session_date desc, created_at desc);
