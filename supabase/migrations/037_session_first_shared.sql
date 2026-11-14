-- 037_session_first_shared.sql
--
-- Three changes found by the 2026-11-14 content audit, all about a session
-- after it was saved.
--
-- ── 1. first_shared_at: a later share tells the athlete ────────────────────
--
-- A session saved private and shared later from the toggle sent the athlete
-- nothing. PATCH /api/sessions/[id] notified only when the calendar sync
-- inserted a new event, and since every session gets its event at save time,
-- that branch never ran for a later share.
--
-- The column records when a session was first shared. The share routes set it
-- with a conditional update (where first_shared_at is null), and only the
-- request whose update changed a row sends the email and the push — so a
-- re-toggle never notifies twice, nor does a double tap.
--
-- Back-filled to created_at for every session shared today: those athletes
-- were told at save time, and re-sharing one after unsharing it must not
-- notify again. A session that was shared once and is private today cannot
-- be told apart from one never shared, so it stays null; sharing it again
-- sends one nod. That is the safe direction: one extra message, never a
-- missed one.
--
-- ── 2. An assistant may delete a session they recorded ────────────────────
--
-- DELETE /api/sessions/[id] goes through the caller's own client, so the
-- database decides. A head already deletes their own rows
-- (coach_delete_own_sessions). An assistant deletes only a session they
-- recorded, about an athlete still given to them: the same rule as
-- "sessions: staff edit own recordings" (035).
--
-- ── 3. An athlete's own notes survive the session being deleted ───────────
--
-- athlete_notes.session_id was ON DELETE CASCADE, so deleting a session would
-- have deleted the private notes an athlete wrote about it — the athlete's
-- words, removed by the coach's action, without either knowing. It is now
-- ON DELETE SET NULL: the note stays, no longer attached to a session.
--
-- supabase/tests/037_session_first_shared.test.sql holds all three.

alter table public.sessions
  add column if not exists first_shared_at timestamptz;

update public.sessions
   set first_shared_at = created_at
 where shared_with_athlete = true
   and first_shared_at is null;

comment on column public.sessions.first_shared_at is
  'When the session was first shared with the athlete. Set once, by a conditional update; only the request that sets it notifies.';

drop policy if exists "sessions: staff delete own recordings" on public.sessions;
create policy "sessions: staff delete own recordings" on public.sessions
  for delete to authenticated
  using (recorded_by = (select auth.uid())
         and coach_id <> (select auth.uid())
         and coach_id in (select private.my_coach_ids('record'))
         and athlete_id in (select private.my_staff_athlete_ids('record')));

alter table public.athlete_notes
  drop constraint if exists athlete_notes_session_id_fkey;
alter table public.athlete_notes
  add constraint athlete_notes_session_id_fkey
  foreign key (session_id) references public.sessions(id) on delete set null;
