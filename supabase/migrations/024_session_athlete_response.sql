-- 024_session_athlete_response.sql
--
-- Lets an athlete answer a session.
--
-- ── Why ──────────────────────────────────────────────────────────────────
--
-- CoachVoice is a one-way pipe. The coach speaks, the model summarises, the
-- athlete reads. Three separate review agents arrived at that same sentence
-- independently, from three different angles, and it is still true: **the
-- coach is the only author in the product.** An athlete can write private
-- notes to themselves and answer five wellness questions about their day, and
-- that is the whole of what they can say. They cannot respond to the one thing
-- the app exists to deliver.
--
-- The consequence is not just emotional. A coach records a focus point, it is
-- emailed and rendered, and nobody ever learns whether it landed. "Hold your
-- platform" read and understood, and "hold your platform" read and not
-- understood, are the same event as far as this system is concerned.
--
-- ── The shape, and why it is this small ──────────────────────────────────
--
-- Three values, one tap, no free text:
--
--   got_it          — understood, nothing needed
--   working_on_it   — understood, in progress
--   not_clear       — did not land
--
-- `not_clear` is the one that earns the feature. A coach cannot currently
-- distinguish a point that worked from a point that was never understood, and
-- a fifteen-year-old will not send a message saying "I don't get it" — the
-- social cost is too high. A single tap is cheap enough that they will.
--
-- Free text was deliberately left out. A text box invites a conversation the
-- messaging feature already handles, and it invites a child to write something
-- they may not want a permanent record of. Three buttons cannot be misused.
--
-- Columns rather than a table: the relationship is one response per session
-- per athlete, and a session already has exactly one athlete. A join table
-- would model a cardinality that does not exist.
--
-- Nullable, and null means "not answered" — which is a normal state, not a
-- failure, and the UI never nags about it.

alter table public.sessions
  add column if not exists athlete_response text
    constraint sessions_athlete_response_check
    check (athlete_response is null or athlete_response in ('got_it', 'working_on_it', 'not_clear')),
  add column if not exists athlete_responded_at timestamptz;

comment on column public.sessions.athlete_response is
  'How the athlete answered this session: got_it | working_on_it | not_clear. Null means they have not answered, which is a normal state. Written only by the athlete the session belongs to, and only when the session is shared with them.';

comment on column public.sessions.athlete_responded_at is
  'When the athlete last answered. Updated on every change, because an athlete may revise "working on it" to "got it" later, and the coach wants the latest.';

-- The coach's question is "which of my recent sessions did not land", so the
-- index covers exactly that: their sessions that carry a response.
create index if not exists sessions_coach_response_idx
  on public.sessions (coach_id, athlete_responded_at desc)
  where athlete_response is not null;
