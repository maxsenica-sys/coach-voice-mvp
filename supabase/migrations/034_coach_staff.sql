-- 034_coach_staff.sql
--
-- Assistant coaches. Max, 2026-09-27: an assistant sees ALL of the head
-- coach's athletes, sees EVERYTHING the head sees in wellness check-ins, and is
-- invited by an email link.
--
-- ── The shape ───────────────────────────────────────────────────────────────
--
-- A "team" is one head coach. Every row in the app stays owned by the head
-- (coach_id = head), exactly as today; an assistant's work is recorded against
-- the head's athletes and marked with who did it (sessions.recorded_by,
-- messages.sender_id, …). So revoking an assistant never orphans anything, and
-- every query, index and report the head already has keeps working unchanged.
--
-- Membership lives in ONE place: public.coach_staff, read live. Never in
-- profiles, never in user_metadata, never in the JWT. Those are all either
-- user-editable or stale for up to an hour; this table is written only by
-- /api/staff/* on the service role, so revoking is immediate.
--
-- ── Why this migration changes nothing on its own ──────────────────────────
--
-- With coach_staff empty, private.my_coach_ids() is {auth.uid()} and
-- private.my_athlete_ids() is exactly "athletes where coach_id = auth.uid()" —
-- today's semantics. Every new policy is named "… staff …" and is OR'd with the
-- existing ones, so until an invite is accepted no one can see or do anything
-- they could not before. The two integrity triggers only refuse rows that are
-- already impossible (checked on production 2026-09-27: zero violations).
--
-- ── What an assistant can do at the database ───────────────────────────────
--
--   read:   the head's athletes, sessions, messages, wellness check-ins,
--           injuries, squads and squad members
--   write:  record a session (as themselves), edit their own recordings,
--           send a message in an athlete's thread, mark the athlete's
--           messages read
--   never:  create, edit or delete athletes; caretakers; squads; delete
--           anything; read the access log or coach-attention data
--
-- Everything else an assistant does goes through a route that checks
-- lib/coach-scope.ts first and then uses the service role, as the head's routes
-- already do. The policies here are the second lock, not the only one.
--
-- Deploy order: this migration first (inert), then the code.

begin;

-- ═══ 1. membership ══════════════════════════════════════════════════════════

create table if not exists public.coach_staff (
  id                uuid primary key default gen_random_uuid(),
  head_coach_id     uuid not null references auth.users(id) on delete cascade,
  member_user_id    uuid references auth.users(id) on delete cascade,
  invited_email     text not null check (length(invited_email) between 3 and 320),
  invited_name      text check (invited_name is null or length(invited_name) <= 120),
  -- sha256 of a single-use 32-byte token; the token itself is only ever in the email.
  invite_token_hash text unique,
  invite_expires_at timestamptz,
  status            text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  can_record        boolean not null default true,
  can_message       boolean not null default true,
  -- Max chose "everything you see". Kept as a column so it can be narrowed per
  -- assistant later without a migration.
  can_view_wellness boolean not null default true,
  created_at        timestamptz not null default now(),
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  check (member_user_id is null or member_user_id <> head_coach_id),
  check (status <> 'active' or member_user_id is not null)
);

-- One team per assistant, and one live invite per address per team.
create unique index if not exists coach_staff_one_team on public.coach_staff (member_user_id) where status = 'active';
create unique index if not exists coach_staff_one_invite on public.coach_staff (head_coach_id, lower(invited_email)) where status in ('invited', 'active');
create index if not exists coach_staff_head_idx on public.coach_staff (head_coach_id);

-- Append-only record of who invited, accepted, revoked — with the actor.
create table if not exists public.coach_staff_events (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.coach_staff(id) on delete cascade,
  actor_id   uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('invited', 'accepted', 'revoked', 'left', 'reinvited')),
  created_at timestamptz not null default now()
);
create index if not exists coach_staff_events_staff_idx on public.coach_staff_events (staff_id, created_at desc);

alter table public.coach_staff enable row level security;
alter table public.coach_staff_events enable row level security;

-- Clients may READ their own team's rows, never write them, and never see the
-- token hash. A column REVOKE is ignored while a table-level grant stands, so
-- the table grant goes and the safe columns come back one by one.
revoke all on public.coach_staff from anon, authenticated;
grant select (id, head_coach_id, member_user_id, invited_email, invited_name, status,
              can_record, can_message, can_view_wellness, created_at, accepted_at, revoked_at)
  on public.coach_staff to authenticated;
revoke all on public.coach_staff_events from anon, authenticated;
grant select on public.coach_staff_events to authenticated;

drop policy if exists "coach_staff: head reads team" on public.coach_staff;
create policy "coach_staff: head reads team" on public.coach_staff
  for select to authenticated using (head_coach_id = (select auth.uid()));
drop policy if exists "coach_staff: member reads own" on public.coach_staff;
create policy "coach_staff: member reads own" on public.coach_staff
  for select to authenticated using (member_user_id = (select auth.uid()));
drop policy if exists "coach_staff_events: head reads" on public.coach_staff_events;
create policy "coach_staff_events: head reads" on public.coach_staff_events
  for select to authenticated
  using (staff_id in (select id from public.coach_staff where head_coach_id = (select auth.uid())));

-- ═══ 2. the scope helpers ═══════════════════════════════════════════════════
--
-- In a schema PostgREST does not expose. SECURITY DEFINER is required, not a
-- convenience: the athletes policy below calls a function that reads athletes,
-- which would recurse through RLS otherwise. search_path is empty and every
-- name is qualified.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- The coach ids whose data the caller works on: themself, plus the head of the
-- one team they are an ACTIVE member of (optionally only if a permission is on).
create or replace function private.my_coach_ids(perm text default null)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid())
  union
  select cs.head_coach_id
    from public.coach_staff cs
   where cs.member_user_id = (select auth.uid())
     and cs.status = 'active'
     and (perm is null
          or (perm = 'record'   and cs.can_record)
          or (perm = 'message'  and cs.can_message)
          or (perm = 'wellness' and cs.can_view_wellness))
$$;

-- The athletes the caller may see: their own roster, or their head's.
create or replace function private.my_athlete_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select a.id from public.athletes a
   where a.coach_id in (select private.my_coach_ids())
$$;

revoke all on function private.my_coach_ids(text), private.my_athlete_ids() from public, anon;
grant execute on function private.my_coach_ids(text), private.my_athlete_ids() to authenticated;

-- ═══ 3. provenance ══════════════════════════════════════════════════════════
--
-- Who actually did it, alongside the unchanged owner column.

alter table public.sessions add column if not exists recorded_by uuid references auth.users(id) on delete set null;
update public.sessions set recorded_by = coach_id where recorded_by is null;
create index if not exists sessions_recorded_by_idx on public.sessions (recorded_by);

alter table public.injuries add column if not exists created_by uuid references auth.users(id) on delete set null;
update public.injuries set created_by = coach_id where created_by is null;

alter table public.session_attachments add column if not exists uploaded_by uuid references auth.users(id) on delete set null;
update public.session_attachments set uploaded_by = coach_id where uploaded_by is null;

-- A recording lives in the folder of whoever recorded it: the upload URL is
-- minted as coach/<recorder>/…. 033 required the OWNER's folder, which is the
-- same person until an assistant records for their head — then every one of
-- their sessions would have been refused. So the rule becomes "the owner's or
-- the recorder's folder", and still never anyone else's, and still no "..".
alter table public.sessions drop constraint if exists sessions_audio_path_owned;
alter table public.sessions
  add constraint sessions_audio_path_owned check (
    audio_path is null
    or ((audio_path like 'coach/' || coach_id::text || '/%'
         or (recorded_by is not null and audio_path like 'coach/' || recorded_by::text || '/%'))
        and position('..' in audio_path) = 0)
  );

-- ═══ 4. staff policies ══════════════════════════════════════════════════════
--
-- "coach_id <> auth.uid()" on every staff WRITE keeps the staff branch from
-- ever being the reason a head's own write is allowed: the head's policies
-- above already decide those.

drop policy if exists "athletes: staff read team" on public.athletes;
create policy "athletes: staff read team" on public.athletes
  for select to authenticated
  using (coach_id in (select private.my_coach_ids()) and coach_id <> (select auth.uid()));

drop policy if exists "sessions: staff read team" on public.sessions;
create policy "sessions: staff read team" on public.sessions
  for select to authenticated
  using (coach_id in (select private.my_coach_ids()) and coach_id <> (select auth.uid()));

drop policy if exists "sessions: staff record" on public.sessions;
create policy "sessions: staff record" on public.sessions
  for insert to authenticated
  with check (
    coach_id in (select private.my_coach_ids('record'))
    and coach_id <> (select auth.uid())
    and recorded_by = (select auth.uid())
    and athlete_id in (select private.my_athlete_ids())
    and (group_id is null or group_id in (select g.id from public.groups g where g.coach_id = sessions.coach_id))
    -- the assistant's own recording, in the assistant's own folder
    and (audio_path is null or audio_path like 'coach/' || (select auth.uid())::text || '/%')
  );

drop policy if exists "sessions: staff edit own recordings" on public.sessions;
create policy "sessions: staff edit own recordings" on public.sessions
  for update to authenticated
  using (recorded_by = (select auth.uid()) and coach_id in (select private.my_coach_ids('record')) and coach_id <> (select auth.uid()))
  with check (
    recorded_by = (select auth.uid())
    and coach_id in (select private.my_coach_ids('record'))
    and coach_id <> (select auth.uid())
    and athlete_id in (select private.my_athlete_ids())
  );

drop policy if exists "messages: staff read team" on public.messages;
create policy "messages: staff read team" on public.messages
  for select to authenticated
  using (coach_id in (select private.my_coach_ids('message')) and coach_id <> (select auth.uid()));

drop policy if exists "messages: staff send" on public.messages;
create policy "messages: staff send" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_role = 'coach'
    and coach_id in (select private.my_coach_ids('message'))
    and coach_id <> (select auth.uid())
    and exists (select 1 from public.athletes a where a.id = messages.athlete_id and a.coach_id = messages.coach_id)
  );

drop policy if exists "messages: staff marks read" on public.messages;
create policy "messages: staff marks read" on public.messages
  for update to authenticated
  using (sender_role = 'athlete' and coach_id in (select private.my_coach_ids('message')) and coach_id <> (select auth.uid()))
  with check (sender_role = 'athlete' and coach_id in (select private.my_coach_ids('message')) and coach_id <> (select auth.uid()));

drop policy if exists "wellness: staff read team" on public.wellness_checkins;
create policy "wellness: staff read team" on public.wellness_checkins
  for select to authenticated
  using (coach_id in (select private.my_coach_ids('wellness')) and coach_id <> (select auth.uid()));

drop policy if exists "injuries: staff read team" on public.injuries;
create policy "injuries: staff read team" on public.injuries
  for select to authenticated
  using (coach_id in (select private.my_coach_ids()) and coach_id <> (select auth.uid()));

drop policy if exists "groups: staff read team" on public.groups;
create policy "groups: staff read team" on public.groups
  for select to authenticated
  using (coach_id in (select private.my_coach_ids()) and coach_id <> (select auth.uid()));

drop policy if exists "group_members: staff read team" on public.group_members;
create policy "group_members: staff read team" on public.group_members
  for select to authenticated
  using (group_id in (select g.id from public.groups g
                       where g.coach_id in (select private.my_coach_ids())
                         and g.coach_id <> (select auth.uid())));

-- ═══ 5. integrity ═══════════════════════════════════════════════════════════
--
-- (a) A row's coach is always its athlete's coach. For every writer, the
--     service role included: it is the routes that use the service role that
--     an assistant reaches, and a route that wrote coach_id = <the assistant>
--     would hide the row from the head and keep it after revocation. Zero rows
--     violate this on production (checked 2026-09-27).

create or replace function private.coach_matches_athlete()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  owner uuid;
begin
  if new.athlete_id is null then
    return new;
  end if;
  select a.coach_id into owner from public.athletes a where a.id = new.athlete_id;
  if owner is null or new.coach_id is distinct from owner then
    raise exception '%: coach_id must be the athlete''s coach', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['sessions', 'messages', 'wellness_checkins', 'injuries', 'notes', 'athlete_caretakers', 'access_log']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_coach_matches_athlete', t);
    execute format('create trigger %I before insert or update of coach_id, athlete_id on public.%I
                    for each row execute function private.coach_matches_athlete()', t || '_coach_matches_athlete', t);
  end loop;
end $$;

-- (b) Who owns a row, and who made it, never changes from a client. Postgres
--     ORs the WITH CHECK of every permissive policy, so without this a staff
--     UPDATE policy and a head UPDATE policy could combine into a path neither
--     was written to allow. Server routes (service role) are not clients.

create or replace function private.owner_immutable()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (to_jsonb(new) -> 'coach_id') is distinct from (to_jsonb(old) -> 'coach_id')
     or (to_jsonb(new) -> 'recorded_by') is distinct from (to_jsonb(old) -> 'recorded_by')
     or (to_jsonb(new) -> 'created_by') is distinct from (to_jsonb(old) -> 'created_by')
     or (to_jsonb(new) -> 'uploaded_by') is distinct from (to_jsonb(old) -> 'uploaded_by') then
    raise exception '%: who owns or made a row cannot be changed', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['sessions', 'wellness_checkins', 'injuries', 'notes', 'athlete_caretakers', 'groups', 'session_attachments']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_owner_immutable', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function private.owner_immutable()', t || '_owner_immutable', t);
  end loop;
end $$;

commit;

-- ── After applying, confirm (read-only) ───────────────────────────────────
-- select count(*) from public.coach_staff;                       -- 0
-- select private.my_coach_ids();                                 -- (as a user) just themself
-- select count(*) from public.sessions where recorded_by is null; -- 0
-- select tgname from pg_trigger where tgname like '%coach_matches_athlete' or tgname like '%owner_immutable';
