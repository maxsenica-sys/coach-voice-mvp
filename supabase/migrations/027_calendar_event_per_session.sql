-- 027_calendar_event_per_session.sql
--
-- One calendar event per session, enforced by the database.
--
-- ── Context ─────────────────────────────────────────────────────────────────
--
-- Reported as: some athletes have their recorded sessions on their calendar
-- and others do not, apparently depending on when the athlete or the session
-- was created.
--
-- The data was not the problem, and this migration does not change any. Every
-- session had exactly one linked calendar event, correctly owned and correctly
-- dated, and migration 018's backfill had done its job:
--
--   42 sessions · 42 linked events · 0 missing · 0 duplicated · 0 mis-dated
--   8 athletes · all with created_by_user_id = their coach
--
-- What produced the symptom was the read window. The calendar fetches one
-- month, opens on the current one, and month navigation was broken (see
-- lib/calendar-month.ts) — so of eight athletes only the three with a session
-- dated in the current month showed anything, and the other five rendered an
-- empty grid for a month that genuinely had nothing in it, with no way to
-- reach the month that did. Fixed in the calendar, not here.
--
-- ── What this does change ───────────────────────────────────────────────────
--
-- The invariant the whole feature rests on — one event per session — was
-- application convention and nothing else. `cal_session_idx` from migration
-- 013 is a plain btree, so the database has always permitted two events for
-- one session. That matters because `syncSessionCalendarEvent` looks the
-- existing row up with `maybeSingle()`, which ERRORS on more than one row: a
-- single duplicate would make every subsequent share toggle for that session
-- fall through and insert yet another. One bad row would compound.
--
-- A unique index is the cheapest possible guarantee that the class of bug in
-- 018 cannot return quietly. It is partial because a coach's own personal
-- events and manually added athlete events have `session_id is null`, and
-- there are many of those.
--
-- Not concurrently, and deliberately: `create index concurrently` cannot run
-- inside a transaction block, and this table is small enough that the brief
-- lock is not worth the complication.

create unique index if not exists calendar_events_session_id_key
  on public.calendar_events (session_id)
  where session_id is not null;

comment on index public.calendar_events_session_id_key is
  'One calendar event per session. syncSessionCalendarEvent looks the row up with maybeSingle(), which errors on a second row and would then insert a third — so the duplicate has to be impossible rather than merely avoided.';
