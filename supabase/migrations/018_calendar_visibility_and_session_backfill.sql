-- 018_calendar_visibility_and_session_backfill.sql
--
-- Fixes two linked complaints: athletes couldn't see their sessions, and
-- recorded sessions never appeared on the coach's calendar.
--
-- ROOT CAUSE. Since 2026-08-28 a session only got a calendar_events row when
-- `shared_with_athlete` was true. That conflated two different things:
--   * whether the ATHLETE may see the session, and
--   * whether it shows on the COACH's own calendar.
-- A coach's calendar is a record of work they did; it should show every session
-- regardless of who else can see it. Because the save UI defaulted to private,
-- 27 of 40 sessions were unshared, so nothing reached either calendar and the
-- athlete portal (which filters on shared_with_athlete) showed almost nothing.
--
-- THE FIX. Calendar events are now always created, and athlete visibility is
-- carried by its own column instead of being implied by whether the row exists.

-- ── 1. Visibility column ─────────────────────────────────────────────────────
alter table public.calendar_events
  add column if not exists visible_to_athlete boolean not null default true;

comment on column public.calendar_events.visible_to_athlete is
  'False hides the event from the athlete while keeping it on the coach''s calendar. For session events this mirrors sessions.shared_with_athlete.';

-- The athlete-facing read path must respect it. (The coach paths query by
-- created_by_user_id and are deliberately unaffected.)
drop policy if exists "cal: athlete sees coach events" on public.calendar_events;
create policy "cal: athlete sees coach events" on public.calendar_events
  for select to authenticated
  using (
    created_by_role = 'coach'
    and visible_to_athlete
    and athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid()))
  );

-- ── 2. Relink legacy session events ──────────────────────────────────────────
-- 12 session-type events predate the session_id column, so nothing could dedupe
-- against them. Match each to its session on (athlete, date) before backfilling,
-- otherwise step 4 would create a second event for the same session.
update public.calendar_events c
set session_id = s.id
from public.sessions s
where c.session_id is null
  and c.event_type = 'session'
  and c.athlete_id = s.athlete_id
  and c.event_date = (s.created_at at time zone 'UTC')::date
  and not exists (
    select 1 from public.calendar_events c2
    where c2.session_id = s.id
  );

-- ── 3. Share the existing backlog, silently ──────────────────────────────────
-- Deliberately done in SQL, not through PATCH /api/sessions/[id]: that route
-- fires notifySessionShared, which would have sent one "your coach shared
-- feedback" email per session — 27 emails for sessions weeks old. The user
-- explicitly chose to make these visible without notifying.
update public.sessions
set shared_with_athlete = true
where shared_with_athlete = false;

-- ── 4. Give every session a calendar event ───────────────────────────────────
insert into public.calendar_events
  (athlete_id, session_id, created_by_user_id, created_by_role, title,
   event_type, event_date, description, visible_to_athlete)
select
  s.athlete_id,
  s.id,
  s.coach_id,
  'coach',
  coalesce(nullif(btrim(coalesce(s.session_name, s.title, '')), ''), 'Coaching Session'),
  'session',
  (s.created_at at time zone 'UTC')::date,
  left(s.summary, 300),
  s.shared_with_athlete
from public.sessions s
where not exists (
  select 1 from public.calendar_events c where c.session_id = s.id
);

-- ── 5. Keep visibility consistent for events that already existed ────────────
update public.calendar_events c
set visible_to_athlete = s.shared_with_athlete
from public.sessions s
where c.session_id = s.id
  and c.visible_to_athlete is distinct from s.shared_with_athlete;

create index if not exists calendar_events_visible_idx
  on public.calendar_events (athlete_id, visible_to_athlete);
