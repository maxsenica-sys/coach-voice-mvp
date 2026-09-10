-- 028_pre_session_checkin.sql
--
-- "I am coaching this athlete today. Has the athlete checked in, and how is
-- their body feeling?"
--
-- ── Deliberately one boolean ────────────────────────────────────────────────
--
-- The ask was explicit about what NOT to build: no booking platform, no
-- appointment management, no scheduling infrastructure, no payments, no new
-- notification system. And: if a future session can be represented with what
-- already exists, reuse it.
--
-- It can. A future session is already expressible as a `calendar_events` row —
-- `event_type = 'session'`, an `event_date` in the future, `athlete_id` set,
-- `created_by_role = 'coach'`, and `session_id` still null because nothing has
-- been recorded yet. When the session is recorded,
-- `syncSessionCalendarEvent` writes its own row for the day it happened; the
-- planned one stays as the plan. Nothing new is needed for the session itself.
--
-- What was missing is one bit of intent: did the coach ask this athlete to
-- complete their pre-session check-in on the day? That is this column and
-- nothing else. No new table, no join, no status machine.
--
-- The reminder is the notification that already fires when a coach creates an
-- athlete event (`notifyCalendarEventCreated` in lib/notify.ts). It is reused
-- rather than reimplemented, which is the whole point of putting the flag on
-- the event.
--
-- The check-in itself is the existing daily wellness check-in — the same five
-- questions and the same `wellness_checkins` row the athlete already fills in.
-- "Has it been done?" is answered by looking for a row on that date. So there
-- is no completion state to store here, and therefore none to get out of step:
-- deleting a check-in cannot leave a stale "completed" flag behind.
--
-- Default false. Every existing event, and every event created by a client
-- that knows nothing about this, is simply not requesting a check-in.

alter table public.calendar_events
  add column if not exists checkin_requested boolean not null default false;

comment on column public.calendar_events.checkin_requested is
  'The coach asked this athlete to complete their daily wellness check-in before this session. Whether they did is answered by wellness_checkins for that athlete on event_date — never stored here, so it cannot go stale.';

-- The coach's only query against this is "which of my upcoming events for this
-- athlete want a check-in", which is already served by
-- calendar_events_created_by_idx plus cal_athlete_idx. A partial index on the
-- flag would be a third index on a table with five, for a handful of rows.
-- Not added on purpose.
