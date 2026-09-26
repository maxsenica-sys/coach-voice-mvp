-- 030_access_log.sql
--
-- "Audit log — so I can see when the athlete accesses the information."
--   Max, 2026-09-26
--
-- ── What this records ───────────────────────────────────────────────────────
--
-- One row each time an athlete opens something their coach shared with them:
-- a session page, a summary opened inline on their home, a video, the audio, a
-- report. It answers the coach's question "has she seen it?" and nothing else.
--
-- It records ATHLETE access only. A coach reading their own athlete's session
-- is not an event anyone needs to be told about, and logging it would bury the
-- one signal this table exists for. The routes enforce that — every insert
-- site first proves the caller is the athlete on the session (SG10 in
-- tools/safeguard-check.mjs holds them to it).
--
-- ── Who can write, who can read ─────────────────────────────────────────────
--
-- Inserts come ONLY from API routes, through the service role, after the route
-- has proven the caller is the athlete. There is deliberately no insert,
-- update or delete policy: an athlete must not be able to forge, back-date or
-- erase their own trail through the anon key, and a coach must not be able to
-- write one on the athlete's behalf. A log anyone can write to is not a log.
--
-- The coach can SELECT their own rows. The athlete cannot read the table at
-- all. That is a product decision, not an oversight: the log is a coaching
-- aid, and it is disclosed to athletes in words rather than shown to them as a
-- feed of their own behaviour.
--
-- ── Shape ───────────────────────────────────────────────────────────────────
--
-- `coach_id` is denormalised so the RLS policy is a single column comparison
-- and the coach's feed is one index scan. `athlete_user_id` is the auth user
-- who actually opened the thing — kept alongside `athlete_id` because it is
-- what the route compared against, and it is the fact being recorded.
-- `session_id` is nullable because a report is not a session.
--
-- `kind` is a closed list. Adding a kind is a migration, which is the point:
-- every new thing the app tells a coach about a child's behaviour should be a
-- decision someone wrote down.
--
-- Duplicate opens (the same athlete, session and kind within ten minutes) are
-- dropped by the route, not here — see lib/access-log.ts. A unique constraint
-- cannot express "within ten minutes", and the log is best-effort by design:
-- a failed insert never breaks the page the athlete is reading.
--
-- Additive only. No existing table, column or policy is touched.

create table if not exists public.access_log (
  id               uuid primary key default gen_random_uuid(),
  coach_id         uuid not null references auth.users(id) on delete cascade,
  athlete_id       uuid not null references public.athletes(id) on delete cascade,
  athlete_user_id  uuid not null references auth.users(id) on delete cascade,
  session_id       uuid references public.sessions(id) on delete cascade,
  kind             text not null
                   check (kind in ('session_opened', 'summary_viewed', 'video_viewed', 'audio_played', 'report_viewed')),
  created_at       timestamptz not null default now()
);

comment on table public.access_log is
  'When an athlete opened something their coach shared. Athlete access only; coach views are never logged. Written only by API routes through the service role after proving the caller is the athlete; readable only by the coach. See lib/access-log.ts.';

-- The coach's feed: "latest activity across my roster / for this athlete".
create index if not exists access_log_coach_created_idx
  on public.access_log (coach_id, created_at desc);

-- "Has this session been seen?" and the route's ten-minute duplicate check.
create index if not exists access_log_session_idx
  on public.access_log (session_id);

alter table public.access_log enable row level security;

-- Read-only for the coach who owns the roster row. No insert, update or delete
-- policy exists for any client role, on purpose — see the header.
drop policy if exists "access_log: coach read own" on public.access_log;
create policy "access_log: coach read own"
  on public.access_log for select
  to authenticated
  using (coach_id = (select auth.uid()));
