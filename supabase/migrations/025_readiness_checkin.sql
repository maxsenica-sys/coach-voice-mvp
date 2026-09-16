-- 025 — The check-in becomes two taps attached to a session.
--
-- ── Why the five-slider form is going ─────────────────────────────────────
--
-- It asked a thirteen-year-old for eight to eleven taps every day: five ordinal
-- metrics, then "are you sore anywhere?", then an eleven-point clinical pain
-- scale running the OPPOSITE way to the five above it (reconciled by a sentence
-- of copy admitting so), then free text. The 0-10 row measured 23.6px per
-- target on a 390px phone — below WCAG 2.2 SC 2.5.8, the smallest target in the
-- product, on a question about a child's pain.
--
-- It also had no trigger. A daily form has no natural moment, so it was filled
-- in rarely and the coach's data was sparse where it mattered.
--
-- ── What replaces it ──────────────────────────────────────────────────────
--
-- Two taps, attached to a session rather than to a date:
--
--   · a body silhouette, where marking NOTHING is the answer "I'm fine" — the
--     common case costs zero taps and is the default
--   · one three-way readiness control: Flat / OK / Good
--
-- Plus, only when the athlete has an open injury on file, a short follow-up on
-- that specific injury. It is contextual rather than another daily question.
--
-- The trigger is the session. A coach schedules Tuesday 4pm; the athlete checks
-- in against it; the coach opens the session already knowing what walked
-- through the door. Checking in IS the attendance signal, which replaces the
-- half-built RSVP feature rather than finishing it (rsvp_enabled is filtered on
-- but never written by any UI, and GET /api/rsvp has no callers).
--
-- An athlete can also check in with no session scheduled. Coaches forget; an
-- athlete being proactive is a signal worth having, and making the check-in
-- depend on the coach would lose it.
--
-- ── The safeguarding path is not touched ──────────────────────────────────
--
-- computeWellnessAlert, the caretaker escalation and the coach's roster dot all
-- read the existing 1-5 columns through overallWellnessScore. Readiness is
-- therefore ALSO written into those columns, on the same 5-is-good scale the
-- existing data uses, so every one of those keeps working on old and new rows
-- alike with no branch and no backfill:
--
--     Flat = 2   OK = 3   Good = 4
--
-- 2 and 4 rather than 1 and 5 on purpose: the endpoints of the old scale were
-- reached by a deliberate slider drag, and a three-way control should not be
-- able to trip an alert as hard as someone who explicitly chose "1".
--
-- Soreness is derived from the silhouette: nothing marked is 5 (no soreness),
-- anything marked is 3, scaled down by how much is marked. That keeps
-- "soreness" meaning what every existing row means by it.

alter table public.wellness_checkins
  add column if not exists readiness smallint check (readiness between 1 and 3),
  add column if not exists sore_areas text[] not null default '{}',
  add column if not exists session_event_id uuid references public.calendar_events(id) on delete set null,
  add column if not exists injury_update text;

comment on column public.wellness_checkins.readiness is
  'Three-way readiness: 1 = Flat, 2 = OK, 3 = Good. Also written to energy/mood/stress on the legacy 1-5 scale so computeWellnessAlert and the caretaker escalation keep working unchanged.';

comment on column public.wellness_checkins.sore_areas is
  'Region ids from lib/body-map.ts. EMPTY IS A REAL ANSWER — it means "nothing hurts", not "not asked". Do not treat [] as missing data.';

comment on column public.wellness_checkins.session_event_id is
  'The scheduled session this check-in was made against, when there was one. Null for a proactive check-in with nothing scheduled, which is explicitly allowed.';

comment on column public.wellness_checkins.injury_update is
  'The athlete answer to a follow-up shown only when they have an open injury on file. Null when they had none.';

-- A check-in is looked up by athlete and session when the coach opens a
-- session. Without this that is a scan of every check-in the athlete has made.
create index if not exists wellness_session_event_idx
  on public.wellness_checkins (session_event_id)
  where session_event_id is not null;
