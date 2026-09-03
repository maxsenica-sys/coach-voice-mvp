-- 017_rls_initplan_and_roles.sql
--
-- Two mechanical changes to every RLS policy. No policy's meaning changes.
--
-- 1. `auth.uid()` → `(select auth.uid())`
--    Bare auth.uid() is re-evaluated for every candidate row. Wrapping it in a
--    scalar subquery lets Postgres evaluate it once per statement and cache it.
--    This is the `auth_rls_initplan` performance advisory — 31 instances.
--
-- 2. `TO authenticated` on every policy (they defaulted to `public`).
--    Every predicate here already requires auth.uid() to match something, so an
--    anonymous request could never satisfy one — the roles were doing nothing
--    but multiplying the `multiple_permissive_policies` advisory across anon,
--    authenticator and dashboard_user. Naming the role makes the intent explicit
--    and drops the bulk of those 65 warnings.
--
-- The service-role key bypasses RLS entirely, so admin-client routes are
-- unaffected. Predicates below are copied verbatim from pg_policies before the
-- change; only auth.uid() wrapping and the role clause differ.

-- ── athlete_caretakers ───────────────────────────────────────────────────────
drop policy if exists "caretakers: coach manages" on public.athlete_caretakers;
create policy "caretakers: coach manages" on public.athlete_caretakers
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- ── athlete_notes ────────────────────────────────────────────────────────────
drop policy if exists "athlete_notes: owner full access" on public.athlete_notes;
create policy "athlete_notes: owner full access" on public.athlete_notes
  for all to authenticated
  using ((select auth.uid()) = athlete_user_id)
  with check ((select auth.uid()) = athlete_user_id);

-- ── athletes ─────────────────────────────────────────────────────────────────
drop policy if exists "athletes: athlete can read own" on public.athletes;
create policy "athletes: athlete can read own" on public.athletes
  for select to authenticated
  using ((select auth.uid()) = athlete_user_id);

drop policy if exists "athletes: athlete marks active" on public.athletes;
create policy "athletes: athlete marks active" on public.athletes
  for update to authenticated
  using (athlete_user_id = (select auth.uid()))
  with check (athlete_user_id = (select auth.uid()));

drop policy if exists "athletes: coach can manage own" on public.athletes;
create policy "athletes: coach can manage own" on public.athletes
  for all to authenticated
  using ((select auth.uid()) = coach_id)
  with check ((select auth.uid()) = coach_id);

-- ── calendar_events ──────────────────────────────────────────────────────────
drop policy if exists "cal: athlete manages own events" on public.calendar_events;
create policy "cal: athlete manages own events" on public.calendar_events
  for all to authenticated
  using (created_by_role = 'athlete' and created_by_user_id = (select auth.uid()))
  with check (
    created_by_role = 'athlete'
    and created_by_user_id = (select auth.uid())
    and athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid()))
  );

drop policy if exists "cal: athlete sees coach events" on public.calendar_events;
create policy "cal: athlete sees coach events" on public.calendar_events
  for select to authenticated
  using (
    created_by_role = 'coach'
    and athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid()))
  );

drop policy if exists "cal: coach manages own athlete events" on public.calendar_events;
create policy "cal: coach manages own athlete events" on public.calendar_events
  for all to authenticated
  using (
    created_by_role = 'coach'
    and created_by_user_id = (select auth.uid())
    and (athlete_id is null or athlete_id in (select id from public.athletes where coach_id = (select auth.uid())))
  )
  with check (
    created_by_role = 'coach'
    and created_by_user_id = (select auth.uid())
    and (athlete_id is null or athlete_id in (select id from public.athletes where coach_id = (select auth.uid())))
  );

-- ── event_rsvps ──────────────────────────────────────────────────────────────
drop policy if exists "rsvps: athlete manages" on public.event_rsvps;
create policy "rsvps: athlete manages" on public.event_rsvps
  for all to authenticated
  using (athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())))
  with check (athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())));

drop policy if exists "rsvps: coach reads" on public.event_rsvps;
create policy "rsvps: coach reads" on public.event_rsvps
  for select to authenticated
  using (event_id in (select id from public.calendar_events where created_by_user_id = (select auth.uid())));

-- ── group_members ────────────────────────────────────────────────────────────
drop policy if exists "group_members: coach full access" on public.group_members;
create policy "group_members: coach full access" on public.group_members
  for all to authenticated
  using (group_id in (select id from public.groups where coach_id = (select auth.uid())))
  with check (group_id in (select id from public.groups where coach_id = (select auth.uid())));

-- ── groups ───────────────────────────────────────────────────────────────────
drop policy if exists "groups: coach full access" on public.groups;
create policy "groups: coach full access" on public.groups
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- ── messages ─────────────────────────────────────────────────────────────────
drop policy if exists "messages: athlete access" on public.messages;
create policy "messages: athlete access" on public.messages
  for all to authenticated
  using (athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())))
  with check (
    sender_id = (select auth.uid())
    and athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid()))
  );

drop policy if exists "messages: coach full access" on public.messages;
create policy "messages: coach full access" on public.messages
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- ── notes ────────────────────────────────────────────────────────────────────
drop policy if exists "notes: athlete can read shared" on public.notes;
create policy "notes: athlete can read shared" on public.notes
  for select to authenticated
  using (
    shared_with_athlete = true
    and exists (
      select 1 from public.athletes a
      where a.id = notes.athlete_id and a.athlete_user_id = (select auth.uid())
    )
  );

drop policy if exists "notes: coach can manage own" on public.notes;
create policy "notes: coach can manage own" on public.notes
  for all to authenticated
  using ((select auth.uid()) = coach_id)
  with check ((select auth.uid()) = coach_id);

-- ── profiles ─────────────────────────────────────────────────────────────────
drop policy if exists "profiles: coach can read their athletes" on public.profiles;
create policy "profiles: coach can read their athletes" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = coach_id);

drop policy if exists "profiles: user can insert own" on public.profiles;
create policy "profiles: user can insert own" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "profiles: user can read own" on public.profiles;
create policy "profiles: user can read own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles: user can update own" on public.profiles;
create policy "profiles: user can update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id);

-- ── session_videos ───────────────────────────────────────────────────────────
drop policy if exists "videos: athlete sees shared session videos" on public.session_videos;
create policy "videos: athlete sees shared session videos" on public.session_videos
  for select to authenticated
  using (
    shared_with_athlete = true
    and session_id in (
      select id from public.sessions
      where athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid()))
    )
  );

drop policy if exists "videos: coach manages own session videos" on public.session_videos;
create policy "videos: coach manages own session videos" on public.session_videos
  for all to authenticated
  using (session_id in (select id from public.sessions where coach_id = (select auth.uid())))
  with check (session_id in (select id from public.sessions where coach_id = (select auth.uid())));

-- ── sessions ─────────────────────────────────────────────────────────────────
-- These four coach_* policies were never in a migration file — they were applied
-- by hand before this repo tracked schema. Recreating them here puts the most
-- important table's access rules under version control for the first time.
drop policy if exists "athlete can read shared sessions" on public.sessions;
create policy "athlete can read shared sessions" on public.sessions
  for select to authenticated
  using (
    shared_with_athlete = true
    and exists (
      select 1 from public.athletes a
      where a.id = sessions.athlete_id and a.athlete_user_id = (select auth.uid())
    )
  );

drop policy if exists "coach_select_own_sessions" on public.sessions;
create policy "coach_select_own_sessions" on public.sessions
  for select to authenticated
  using (coach_id = (select auth.uid()));

drop policy if exists "coach_insert_own_sessions" on public.sessions;
create policy "coach_insert_own_sessions" on public.sessions
  for insert to authenticated
  with check (coach_id = (select auth.uid()));

drop policy if exists "coach_update_own_sessions" on public.sessions;
create policy "coach_update_own_sessions" on public.sessions
  for update to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

drop policy if exists "coach_delete_own_sessions" on public.sessions;
create policy "coach_delete_own_sessions" on public.sessions
  for delete to authenticated
  using (coach_id = (select auth.uid()));

-- ── wellness_checkins ────────────────────────────────────────────────────────
drop policy if exists "wellness: athlete manage" on public.wellness_checkins;
create policy "wellness: athlete manage" on public.wellness_checkins
  for all to authenticated
  using (athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())))
  with check (athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())));

drop policy if exists "wellness: coach read" on public.wellness_checkins;
create policy "wellness: coach read" on public.wellness_checkins
  for select to authenticated
  using (coach_id = (select auth.uid()));
