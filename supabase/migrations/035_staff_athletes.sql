-- 035_staff_athletes.sql
--
-- Assistant coaches see only the athletes the head coach chose for them.
--
-- Max, 2026-09-28: "I want it to be selecting the athletes the coach gets
-- access to, but with all the submission tools available." And, asked:
--   · a new athlete is NOT given to an assistant automatically — the head ticks
--   · parents and caretakers stay with the head
--   · an athlete is told when an assistant is given access to them
--
-- 034 made a team: an active assistant saw every athlete of their head. This
-- narrows the team to a list. Nothing else about 034 changes — rows are still
-- owned by the head, membership is still read live from coach_staff, and the
-- policies below keep their names so there is one policy per question.
--
-- ── What changes for whom ─────────────────────────────────────────────────
--
--   head coach:  nothing. Their own policies are untouched.
--   athlete:     nothing.
--   assistant:   every staff policy now asks "is this athlete one of mine?"
--                instead of "is this my head's?". An assistant with no athletes
--                assigned sees nothing and can do nothing.
--
-- Production has no coach_staff rows at all (checked 2026-09-28), so no
-- assistant loses access they were using.
--
-- ── One recording about several athletes ───────────────────────────────────
--
-- A squad talk (group_id) or one recording split per athlete
-- (shared_recording_id) is saved as a row per athlete, and every row carries
-- the whole transcript and audio path — the coach talking about all of them.
-- An assistant given two of a squad's eight must not read that. Row security
-- cannot hide one column, so the row itself is readable by an assistant only
-- when they may hear the whole of it: every athlete in it is theirs, or they
-- recorded it. The summary written for their own athlete still reaches them
-- through the routes, which read on the service role and withhold the
-- transcript and audio — lib/coach-scope.ts, recordingAudience().
--
-- Deploy order: the code first is harmless (routes already filter by the
-- assignment once they can read it); this migration first leaves assistants
-- with nothing until the head ticks athletes. Either order is safe.

begin;

-- ═══ 1. who is given which athletes ═════════════════════════════════════════

create table if not exists public.coach_staff_athletes (
  staff_id      uuid not null references public.coach_staff(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  head_coach_id uuid not null references auth.users(id) on delete cascade,
  assigned_by   uuid references auth.users(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  primary key (staff_id, athlete_id)
);
create index if not exists coach_staff_athletes_athlete_idx on public.coach_staff_athletes (athlete_id);
create index if not exists coach_staff_athletes_head_idx on public.coach_staff_athletes (head_coach_id);

alter table public.coach_staff_athletes enable row level security;

-- Written only by /api/staff on the service role, like coach_staff itself.
revoke all on public.coach_staff_athletes from anon, authenticated;
grant select on public.coach_staff_athletes to authenticated;

drop policy if exists "coach_staff_athletes: head reads team" on public.coach_staff_athletes;
create policy "coach_staff_athletes: head reads team" on public.coach_staff_athletes
  for select to authenticated using (head_coach_id = (select auth.uid()));
drop policy if exists "coach_staff_athletes: member reads own" on public.coach_staff_athletes;
create policy "coach_staff_athletes: member reads own" on public.coach_staff_athletes
  for select to authenticated
  using (staff_id in (select cs.id from public.coach_staff cs where cs.member_user_id = (select auth.uid())));

-- An assignment is always inside one team: the staff row's head, the athlete's
-- coach and the row's own head_coach_id are the same person. From every
-- writer, the service role included — it is the only writer.
create or replace function private.staff_athlete_same_team()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.coach_staff cs
      join public.athletes a on a.coach_id = cs.head_coach_id
     where cs.id = new.staff_id
       and a.id = new.athlete_id
       and cs.head_coach_id = new.head_coach_id
  ) then
    raise exception 'coach_staff_athletes: the athlete must be on the assistant''s head coach''s roster' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists coach_staff_athletes_same_team on public.coach_staff_athletes;
create trigger coach_staff_athletes_same_team
  before insert or update on public.coach_staff_athletes
  for each row execute function private.staff_athlete_same_team();

-- The team's history says who was given which athlete, and who took it away.
alter table public.coach_staff_events add column if not exists athlete_id uuid references public.athletes(id) on delete set null;
alter table public.coach_staff_events drop constraint if exists coach_staff_events_kind_check;
alter table public.coach_staff_events
  add constraint coach_staff_events_kind_check
  check (kind in ('invited', 'accepted', 'revoked', 'left', 'reinvited', 'assigned', 'unassigned'));

-- Notes become an assistant's to write too ("all the submission tools"), so
-- they get the provenance column sessions, injuries and attachments got in 034.
-- 034's owner_immutable trigger on notes already refuses a client changing it.
alter table public.notes add column if not exists created_by uuid references auth.users(id) on delete set null;
update public.notes set created_by = coach_id where created_by is null;

-- ═══ 2. the scope helpers ═══════════════════════════════════════════════════

-- The athletes an ACTIVE assistant was given, still on their head's roster,
-- optionally only if a permission is on. Never the caller's own roster: that
-- is what the head's policies are for.
create or replace function private.my_staff_athlete_ids(perm text default null)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select csa.athlete_id
    from public.coach_staff_athletes csa
    join public.coach_staff cs on cs.id = csa.staff_id
    join public.athletes a on a.id = csa.athlete_id and a.coach_id = cs.head_coach_id
   where cs.member_user_id = (select auth.uid())
     and cs.status = 'active'
     and (perm is null
          or (perm = 'record'   and cs.can_record)
          or (perm = 'message'  and cs.can_message)
          or (perm = 'wellness' and cs.can_view_wellness))
$$;

-- 034's "athletes the caller may see": their own roster, plus the ones given
-- to them — no longer the head's whole roster.
create or replace function private.my_athlete_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select a.id from public.athletes a where a.coach_id = (select auth.uid())
  union
  select private.my_staff_athlete_ids()
$$;

-- May an assistant read this session row — i.e. hear the whole recording?
-- Their athlete's, and either about their athletes only, or recorded by them.
create or replace function private.staff_may_hear(
  p_athlete_id uuid, p_group_id uuid, p_shared_recording_id uuid, p_recorded_by uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_athlete_id in (select private.my_staff_athlete_ids())
     and (
       p_recorded_by = (select auth.uid())
       or (
         (p_group_id is null or not exists (
            select 1 from public.group_members gm
             where gm.group_id = p_group_id
               and gm.athlete_id not in (select private.my_staff_athlete_ids())))
         and
         (p_shared_recording_id is null or not exists (
            select 1 from public.sessions s2
             where s2.shared_recording_id = p_shared_recording_id
               and s2.athlete_id not in (select private.my_staff_athlete_ids())))
       )
     )
$$;

-- Does this squad have at least one of the assistant's athletes in it?
-- A function rather than a subquery in the policy: the head's own
-- group_members policy reads groups, so a groups policy that read
-- group_members through RLS would recurse.
create or replace function private.staff_sees_group(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.group_members gm
                  where gm.group_id = p_group_id
                    and gm.athlete_id in (select private.my_staff_athlete_ids()))
$$;

-- Is this squad the given coach's? For the record policy, for the same reason.
create or replace function private.group_is_coachs(p_group_id uuid, p_coach_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.groups g where g.id = p_group_id and g.coach_id = p_coach_id)
$$;

revoke all on function private.my_staff_athlete_ids(text), private.my_athlete_ids(),
  private.staff_may_hear(uuid, uuid, uuid, uuid), private.staff_sees_group(uuid),
  private.group_is_coachs(uuid, uuid) from public, anon;
grant execute on function private.my_staff_athlete_ids(text), private.my_athlete_ids(),
  private.staff_may_hear(uuid, uuid, uuid, uuid), private.staff_sees_group(uuid),
  private.group_is_coachs(uuid, uuid) to authenticated;

-- ═══ 3. every staff policy asks about the athlete ═══════════════════════════
--
-- Same names as 034, so each replaces its predecessor. "coach_id <>
-- auth.uid()" stays on each: the staff branch is never why a head's own
-- read or write is allowed.

drop policy if exists "athletes: staff read team" on public.athletes;
create policy "athletes: staff read team" on public.athletes
  for select to authenticated
  using (id in (select private.my_staff_athlete_ids()) and coach_id <> (select auth.uid()));

drop policy if exists "sessions: staff read team" on public.sessions;
create policy "sessions: staff read team" on public.sessions
  for select to authenticated
  using (coach_id <> (select auth.uid())
         and private.staff_may_hear(athlete_id, group_id, shared_recording_id, recorded_by));

drop policy if exists "sessions: staff record" on public.sessions;
create policy "sessions: staff record" on public.sessions
  for insert to authenticated
  with check (
    coach_id in (select private.my_coach_ids('record'))
    and coach_id <> (select auth.uid())
    and recorded_by = (select auth.uid())
    and athlete_id in (select private.my_staff_athlete_ids('record'))
    and (group_id is null or private.group_is_coachs(group_id, coach_id))
    and (audio_path is null or audio_path like 'coach/' || (select auth.uid())::text || '/%')
  );

drop policy if exists "sessions: staff edit own recordings" on public.sessions;
create policy "sessions: staff edit own recordings" on public.sessions
  for update to authenticated
  using (recorded_by = (select auth.uid())
         and coach_id <> (select auth.uid())
         and athlete_id in (select private.my_staff_athlete_ids('record')))
  with check (
    recorded_by = (select auth.uid())
    and coach_id in (select private.my_coach_ids('record'))
    and coach_id <> (select auth.uid())
    and athlete_id in (select private.my_staff_athlete_ids('record'))
  );

drop policy if exists "messages: staff read team" on public.messages;
create policy "messages: staff read team" on public.messages
  for select to authenticated
  using (athlete_id in (select private.my_staff_athlete_ids('message')) and coach_id <> (select auth.uid()));

drop policy if exists "messages: staff send" on public.messages;
create policy "messages: staff send" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_role = 'coach'
    and coach_id in (select private.my_coach_ids('message'))
    and coach_id <> (select auth.uid())
    and athlete_id in (select private.my_staff_athlete_ids('message'))
    and exists (select 1 from public.athletes a where a.id = messages.athlete_id and a.coach_id = messages.coach_id)
  );

drop policy if exists "messages: staff marks read" on public.messages;
create policy "messages: staff marks read" on public.messages
  for update to authenticated
  using (sender_role = 'athlete' and athlete_id in (select private.my_staff_athlete_ids('message')) and coach_id <> (select auth.uid()))
  with check (sender_role = 'athlete' and athlete_id in (select private.my_staff_athlete_ids('message')) and coach_id <> (select auth.uid()));

drop policy if exists "wellness: staff read team" on public.wellness_checkins;
create policy "wellness: staff read team" on public.wellness_checkins
  for select to authenticated
  using (athlete_id in (select private.my_staff_athlete_ids('wellness')) and coach_id <> (select auth.uid()));

drop policy if exists "injuries: staff read team" on public.injuries;
create policy "injuries: staff read team" on public.injuries
  for select to authenticated
  using (athlete_id in (select private.my_staff_athlete_ids()) and coach_id <> (select auth.uid()));

-- A squad is visible when at least one of its members is the assistant's, and
-- then only those members: the rest of the list is other people's children.
drop policy if exists "groups: staff read team" on public.groups;
create policy "groups: staff read team" on public.groups
  for select to authenticated
  using (coach_id <> (select auth.uid()) and private.staff_sees_group(id));

drop policy if exists "group_members: staff read team" on public.group_members;
create policy "group_members: staff read team" on public.group_members
  for select to authenticated
  -- An assigned athlete is always on someone else's roster (their head's), so
  -- this is never the reason a head reads their own squads.
  using (athlete_id in (select private.my_staff_athlete_ids()));

commit;

-- ── After applying, confirm (read-only) ───────────────────────────────────
-- select count(*) from public.coach_staff_athletes;   -- 0
-- select private.my_athlete_ids();                     -- (as a head) their own roster
