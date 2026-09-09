-- 025_injuries.sql
--
-- An injury as a thing the app knows about, rather than a number in a form.
--
-- ── Why ──────────────────────────────────────────────────────────────────
--
-- CoachVoice asks a fifteen-year-old to rate their soreness every morning and
-- then does nothing structural with the answer. Soreness is a daily number.
-- An injury is a **state**: it starts, it has a severity, someone decides when
-- the athlete is back, and until then the rest of the app should behave
-- differently.
--
-- Nothing modelled that, so today the app will cheerfully ask an athlete on
-- crutches to rate their energy, and let a coach record a technique note for
-- someone who has not trained in three weeks. For a product used by minors in
-- sport, that is not a missing feature so much as a missing duty.
--
-- ── Shape ────────────────────────────────────────────────────────────────
--
-- One row per injury, not per day. `body_area` is a region id from
-- `lib/body-map.ts`, which is the same vocabulary the athlete taps on the
-- daily check-in — so "where were you sore" and "where are you injured" are
-- the same words and can be compared without a translation table.
--
-- `status` is deliberately three values and not a free-text field. A coach is
-- not a physiotherapist and this app must not invite them to write a
-- diagnosis about a child; it records availability, which is the coach's
-- actual job.
--
--   active      — not training this
--   recovering  — training modified
--   cleared     — back to normal, kept for history
--
-- `expected_return` is nullable and always a guess. Nothing computes with it;
-- it is shown to the coach as a date they typed, not as a prediction.

create table if not exists public.injuries (
  id               uuid primary key default gen_random_uuid(),
  athlete_id       uuid not null references public.athletes(id) on delete cascade,
  -- Denormalised so the coach's own rows can be found without a join, and so
  -- the RLS policy below is a single column comparison.
  coach_id         uuid not null references auth.users(id) on delete cascade,
  body_area        text not null,
  status           text not null default 'active'
                   check (status in ('active', 'recovering', 'cleared')),
  -- 0-10, the standard numeric pain scale. Nullable: a coach logging an injury
  -- on behalf of an athlete often does not have a number.
  severity         smallint check (severity is null or (severity between 0 and 10)),
  started_on       date not null default current_date,
  expected_return  date,
  cleared_on       date,
  note             text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

comment on table public.injuries is
  'An injury as a state with a status and a return date, not a daily score. body_area uses the region vocabulary in lib/body-map.ts, the same words the athlete taps on their check-in.';

-- "What is currently open for this athlete" is the query every screen makes.
create index if not exists injuries_athlete_open_idx
  on public.injuries (athlete_id, status, started_on desc);

create index if not exists injuries_coach_open_idx
  on public.injuries (coach_id, status);

alter table public.injuries enable row level security;

-- The coach who owns the roster row owns the injury record. They create it,
-- update the status and clear it.
create policy "injuries: coach full access"
  on public.injuries for all
  using     (coach_id = auth.uid())
  with check (coach_id = auth.uid());

-- The athlete can READ their own, and only read. An athlete must be able to
-- see what their coach has recorded about their availability — being marked
-- unavailable without being told is worse than not tracking it at all — but
-- they must not be able to clear themselves to play.
create policy "injuries: athlete read own"
  on public.injuries for select
  using (
    athlete_id in (select id from public.athletes where athlete_user_id = auth.uid())
  );
