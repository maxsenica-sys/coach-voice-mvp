-- 033_security_integrity.sql
--
-- Row-level security that says "you own this row" but never "…and it is about
-- someone you are allowed to write about". Read from the LIVE pg_policies on
-- 2026-09-26, not from the migration files: several of these policies were
-- created by hand (see 017's header), so every DROP below uses the exact live
-- name, and every CREATE restates the whole policy.
--
-- What was open, and what closes it:
--
--  1. profiles — "user can update own" had USING (auth.uid() = id) and nothing
--     else. Any signed-in user, a child included, could PATCH their own row
--     through PostgREST with the anon key and set role = 'coach'. The proxy,
--     every coach route, and the custom access token hook (022, which copies
--     profiles.role into the JWT's user_role) all trust that column. That is
--     privilege escalation to coach. The app-level guard in
--     /api/complete-signup never saw it: PostgREST does not go through the app.
--     → A trigger refuses any change to role, coach_id or invite_code made by
--       a client role (current_user authenticated/anon — see the function). The service-role key (every legitimate writer:
--       complete-signup, coach-code, coach-profile, join) and the
--       SECURITY DEFINER signup trigger from 002 pass through.
--     → The client INSERT policy is dropped. The 002 trigger creates every
--       profile row, and no client code inserts one (checked: every profiles
--       write in app/ and lib/ is on the service-role client).
--
--  2. sessions — "athlete can read shared sessions" returned the WHOLE row,
--     transcript included, for squad (group_id) and shared-recording
--     (shared_recording_id) sessions. Those transcripts are the coach talking
--     about other children. SG6 only ever checked that the athlete APP did not
--     select the column; anyone holding an athlete's token could.
--     → The athlete policy is narrowed to one-to-one sessions. The portal now
--       lists sessions through /api/athlete/sessions (service-role, no
--       transcript column), and one session's transcript through the detail
--       route, which already withholds squad and shared ones.
--     Chosen over revoking column SELECT on `transcript`: Postgres ignores a
--     column REVOKE while the table-level grant stands, so it would mean
--     revoking SELECT on the table and granting every other column back.
--     That breaks every `select('*')` on sessions (the coach's /pdf/session
--     report), every coach-side read of transcript through a user-scoped
--     client (/api/sessions POST's returning select, /api/coach/insights),
--     and silently hides every column added after this migration until
--     someone remembers to grant it. Narrowing the athlete's row set breaks
--     nothing that still reads it directly, and it fails closed for new
--     columns because the whole row is withheld.
--
--  3. sessions INSERT/UPDATE checked only coach_id = auth.uid(), so a coach
--     could write a session onto ANOTHER coach's athlete_id — and it would then
--     appear to that child. Same shape in messages, group_members, notes,
--     injuries, athlete_caretakers, session_attachments and session_videos.
--     → Every coach WITH CHECK now also requires the athlete (or session) to
--       be the caller's own.
--
--  4. sessions.audio_path is a client string that the audio-url and detail
--     routes sign with the service-role key. Nothing tied it to its owner.
--     → WITH CHECK and a CHECK constraint: it must sit under coach/<coach_id>/,
--       the only prefix /api/sessions/audio-upload-url ever mints.
--
--  5. messages — both "full access" policies were FOR ALL, so either side could
--     rewrite or delete the other's messages, a coach could post into another
--     coach's athlete's thread, and an athlete could post with any coach_id.
--     → Split by verb. Inserts must be the sender's own, in a thread they are
--       party to. UPDATE is granted on read_at only, and only on the other
--       side's messages. DELETE is revoked (hard-delete uses service-role).
--
--  6. athletes — "coach can manage own" let a coach INSERT a roster row with
--     athlete_user_id pointing at any user: that user's portal would then read
--     the stranger's messages and calendar, and their own `maybeSingle()`
--     roster lookup would break. "athlete marks active" let an athlete UPDATE
--     any column of their row, coach_id included — moving themselves onto a
--     roster that never invited them.
--     → athlete_user_id is written only by the service-role routes that prove
--       it (/api/athletes invite, /api/join, /api/complete-signup). A trigger
--       refuses it from a client. The athlete UPDATE policy is dropped:
--       activation moved to /api/athlete/activate (service-role) long ago and
--       nothing else uses it.
--
--  7. wellness_checkins — "athlete manage" never pinned coach_id, so a child's
--     check-in could be filed under any coach ("wellness: coach read" is
--     coach_id = auth.uid()). → coach_id must be the athlete's own coach.
--
-- ── DEPLOY ORDER ───────────────────────────────────────────────────────────
--
-- CODE FIRST, THEN THIS MIGRATION.
--
-- The one ordering hazard is (2): with the narrowed policy live and the OLD
-- athlete portal still selecting `sessions` directly, squad and shared sessions
-- would silently drop out of a child's list — no error, just fewer rows. The
-- new portal reads through /api/athlete/sessions (service-role), which works
-- under either policy. Everything else here only refuses writes that no
-- shipped code makes (every legitimate writer is service-role, or already
-- satisfies the tighter check), so it is safe against old and new code alike.
--
-- Rollback of the CODE after this is applied is the unsafe direction for the
-- same reason; roll back this migration's section 2 first if that is ever
-- needed.
--
-- Idempotent: every policy is dropped by name before it is created, the
-- functions are CREATE OR REPLACE, triggers are dropped first, and the
-- constraint is added only if absent. Live data was checked on 2026-09-26:
-- zero rows violate any of the new checks.

begin;

-- ═══ 1. profiles ═════════════════════════════════════════════════════════════

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- A client is a request made with the anon key or a user's token: PostgREST
  -- runs those as SET ROLE authenticated / anon. The service-role key runs as
  -- service_role; the 002 signup trigger (SECURITY DEFINER), foreign-key
  -- ON DELETE actions and GoTrue run as their owners. None of those is a client.
  --
  -- current_user, deliberately NOT auth.role(). auth.role() casts the
  -- request.jwt.claims setting to jsonb, and on a connection where that
  -- setting exists but is empty it raises "invalid input syntax for type
  -- json" — which, inside this trigger, would fail the signup trigger's own
  -- INSERT and every ON DELETE SET NULL on profiles.coach_id. Found by running
  -- this migration against a local Postgres, not by reading it.
  is_client boolean := current_user in ('authenticated', 'anon');
begin
  if not is_client then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Only the bare row the 002 trigger would make for a self-signup.
    if new.invite_code is not null or new.coach_id is not null or new.role is distinct from 'coach' then
      raise exception 'profiles: role, coach_id and invite_code are set by the server, not the client'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.coach_id is distinct from old.coach_id
     or new.invite_code is distinct from old.invite_code
     or new.id is distinct from old.id then
    raise exception 'profiles: role, coach_id and invite_code can only be changed by the server'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

-- The 002 trigger creates every profile; no client code inserts one.
drop policy if exists "profiles: user can insert own" on public.profiles;

drop policy if exists "profiles: user can update own" on public.profiles;
create policy "profiles: user can update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ═══ 2–4. sessions ═══════════════════════════════════════════════════════════

-- One-to-one sessions only. A squad or shared-recording row carries a
-- transcript about other children; athletes get those rows through
-- /api/athlete/sessions and /api/sessions/[id]/detail, never PostgREST.
drop policy if exists "athlete can read shared sessions" on public.sessions;
create policy "athlete can read shared sessions" on public.sessions
  for select to authenticated
  using (
    shared_with_athlete = true
    and group_id is null
    and shared_recording_id is null
    and exists (
      select 1 from public.athletes a
      where a.id = sessions.athlete_id and a.athlete_user_id = (select auth.uid())
    )
  );

drop policy if exists "coach_insert_own_sessions" on public.sessions;
create policy "coach_insert_own_sessions" on public.sessions
  for insert to authenticated
  with check (
    coach_id = (select auth.uid())
    and athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
    and (group_id is null or group_id in (select id from public.groups where coach_id = (select auth.uid())))
    and (audio_path is null or audio_path like 'coach/' || (select auth.uid())::text || '/%')
  );

drop policy if exists "coach_update_own_sessions" on public.sessions;
create policy "coach_update_own_sessions" on public.sessions
  for update to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
    and (group_id is null or group_id in (select id from public.groups where coach_id = (select auth.uid())))
    and (audio_path is null or audio_path like 'coach/' || (select auth.uid())::text || '/%')
  );

-- The same rule for every writer, service-role included: a stored recording
-- path is always under its own coach's prefix, so the routes that sign it with
-- the service-role key can never be pointed at someone else's file.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sessions'::regclass and conname = 'sessions_audio_path_owned'
  ) then
    alter table public.sessions
      add constraint sessions_audio_path_owned check (
        audio_path is null
        or (audio_path like 'coach/' || coach_id::text || '/%' and position('..' in audio_path) = 0)
      ) not valid;
  end if;
  begin
    alter table public.sessions validate constraint sessions_audio_path_owned;
  exception when check_violation then
    -- New rows are held to it either way; say so rather than fail the deploy.
    raise notice 'sessions_audio_path_owned: existing rows violate it; left NOT VALID';
  end;
end $$;

-- ═══ 5. messages ═════════════════════════════════════════════════════════════

drop policy if exists "messages: coach full access" on public.messages;
drop policy if exists "messages: athlete access" on public.messages;

drop policy if exists "messages: coach read" on public.messages;
create policy "messages: coach read" on public.messages
  for select to authenticated
  using (coach_id = (select auth.uid()));

drop policy if exists "messages: coach send" on public.messages;
create policy "messages: coach send" on public.messages
  for insert to authenticated
  with check (
    coach_id = (select auth.uid())
    and sender_id = (select auth.uid())
    and sender_role = 'coach'
    and athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
  );

drop policy if exists "messages: coach marks read" on public.messages;
create policy "messages: coach marks read" on public.messages
  for update to authenticated
  using (coach_id = (select auth.uid()) and sender_role = 'athlete')
  with check (
    coach_id = (select auth.uid())
    and sender_role = 'athlete'
    and athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
  );

drop policy if exists "messages: athlete read" on public.messages;
create policy "messages: athlete read" on public.messages
  for select to authenticated
  using (athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())));

drop policy if exists "messages: athlete send" on public.messages;
create policy "messages: athlete send" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_role = 'athlete'
    and exists (
      select 1 from public.athletes a
      where a.id = messages.athlete_id
        and a.athlete_user_id = (select auth.uid())
        and a.coach_id = messages.coach_id
    )
  );

drop policy if exists "messages: athlete marks read" on public.messages;
create policy "messages: athlete marks read" on public.messages
  for update to authenticated
  using (sender_role = 'coach' and athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())))
  with check (sender_role = 'coach' and athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())));

-- Append-only for clients, except the read marker. The UPDATE policies above
-- pick the rows; this picks the one column.
revoke update, delete on public.messages from authenticated, anon;
grant update (read_at) on public.messages to authenticated;

-- ═══ 3. group_members ════════════════════════════════════════════════════════

drop policy if exists "group_members: coach full access" on public.group_members;
create policy "group_members: coach full access" on public.group_members
  for all to authenticated
  using (group_id in (select id from public.groups where coach_id = (select auth.uid())))
  with check (
    group_id in (select id from public.groups where coach_id = (select auth.uid()))
    and athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
  );

-- ═══ 6. athletes ═════════════════════════════════════════════════════════════

create or replace function public.guard_athlete_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Same test, and the same reason, as guard_profile_privileged_columns.
  is_client boolean := current_user in ('authenticated', 'anon');
begin
  if not is_client then
    return new;
  end if;
  if tg_op = 'INSERT' and new.athlete_user_id is not null then
    raise exception 'athletes: athlete_user_id is linked by the server, not the client'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.athlete_user_id is distinct from old.athlete_user_id
                           or new.coach_id is distinct from old.coach_id) then
    raise exception 'athletes: athlete_user_id and coach_id can only be changed by the server'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists athletes_guard_link on public.athletes;
create trigger athletes_guard_link
  before insert or update on public.athletes
  for each row execute function public.guard_athlete_link();

-- Activation is /api/athlete/activate on the service-role client. This policy
-- let an athlete rewrite every column of their row, coach_id included.
drop policy if exists "athletes: athlete marks active" on public.athletes;

-- ═══ 3. the other coach-written tables ═══════════════════════════════════════

drop policy if exists "caretakers: coach manages" on public.athlete_caretakers;
create policy "caretakers: coach manages" on public.athlete_caretakers
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
  );

drop policy if exists "notes: coach can manage own" on public.notes;
create policy "notes: coach can manage own" on public.notes
  for all to authenticated
  using ((select auth.uid()) = coach_id)
  with check (
    (select auth.uid()) = coach_id
    and athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
    and (session_id is null or session_id in (select id from public.sessions where coach_id = (select auth.uid())))
  );

-- Live roles were {public} with bare auth.uid(); restated as the rest are.
drop policy if exists "injuries: coach full access" on public.injuries;
create policy "injuries: coach full access" on public.injuries
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
  );

drop policy if exists "injuries: athlete read own" on public.injuries;
create policy "injuries: athlete read own" on public.injuries
  for select to authenticated
  using (athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())));

drop policy if exists "attachments: coach manages own" on public.session_attachments;
create policy "attachments: coach manages own" on public.session_attachments
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and session_id in (select id from public.sessions where coach_id = (select auth.uid()))
    and storage_path like 'attachments/' || (select auth.uid())::text || '/' || session_id::text || '/%'
  );

drop policy if exists "videos: coach manages own session videos" on public.session_videos;
create policy "videos: coach manages own session videos" on public.session_videos
  for all to authenticated
  using (session_id in (select id from public.sessions where coach_id = (select auth.uid())))
  with check (
    session_id in (select id from public.sessions where coach_id = (select auth.uid()))
    and storage_path like (select auth.uid())::text || '/' || session_id::text || '/%'
  );

-- ═══ 7. wellness_checkins ════════════════════════════════════════════════════

drop policy if exists "wellness: athlete manage" on public.wellness_checkins;
create policy "wellness: athlete manage" on public.wellness_checkins
  for all to authenticated
  using (athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid())))
  with check (
    exists (
      select 1 from public.athletes a
      where a.id = wellness_checkins.athlete_id
        and a.athlete_user_id = (select auth.uid())
        and a.coach_id = wellness_checkins.coach_id
    )
  );

commit;

-- ── After applying, confirm (read-only) ───────────────────────────────────
-- select policyname, cmd, qual, with_check from pg_policies
--  where schemaname = 'public'
--    and tablename in ('profiles','sessions','messages','group_members','athletes',
--                      'athlete_caretakers','notes','injuries','session_attachments',
--                      'session_videos','wellness_checkins')
--  order by tablename, policyname;
-- select tgname from pg_trigger where tgname in ('profiles_guard_privileged_columns','athletes_guard_link');
-- select convalidated from pg_constraint where conname = 'sessions_audio_path_owned';
-- select privilege_type, column_name from information_schema.column_privileges
--  where table_name = 'messages' and grantee = 'authenticated' and privilege_type = 'UPDATE';
