-- RLS test for 035_staff_athletes.sql: an assistant sees only the athletes
-- their head coach gave them.
--
--   H1  head coach        X1  H1's athlete, given to A1
--   A1  H1's assistant    X3  H1's athlete, given to A5 (not A1)
--   A5  H1's assistant    X2  H2's athlete
--   A3  H1's revoked assistant, still holding an assignment row
--   H2  another head coach
--
--   G1  H1's squad: X1 and X3        G2  H1's squad: X1 only
--   R   one recording split between X1 and X3 (shared_recording_id)

\set ON_ERROR_STOP 1
begin;

create temp table t_result (name text, ok boolean) on commit drop;
grant all on t_result to authenticated;

-- ── fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'h1@t35'),
  ('00000000-0000-0000-0000-0000000005a2', 'a1@t35'),
  ('00000000-0000-0000-0000-0000000005a3', 'a3@t35'),
  ('00000000-0000-0000-0000-0000000005a5', 'a5@t35'),
  ('00000000-0000-0000-0000-0000000005b1', 'h2@t35');

insert into public.athletes (id, coach_id, first_name, last_name) values
  ('10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 'Xena', 'Given'),
  ('10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', 'Xavier', 'NotGiven'),
  ('10000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-0000000005b1', 'Xavi', 'OtherTeam');

insert into public.coach_staff (id, head_coach_id, member_user_id, invited_email, status) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a2', 'a1@t35', 'active'),
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a5', 'a5@t35', 'active'),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a3', 'a3@t35', 'revoked');

insert into public.coach_staff_athletes (staff_id, athlete_id, head_coach_id) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1'),
  ('50000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1');

insert into public.groups (id, coach_id, name) values
  ('30000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 'G1 both'),
  ('30000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-0000000005a1', 'G2 only X1');
insert into public.group_members (group_id, athlete_id) values
  ('30000000-0000-0000-0000-000000000501', '10000000-0000-0000-0000-000000000501'),
  ('30000000-0000-0000-0000-000000000501', '10000000-0000-0000-0000-000000000503'),
  ('30000000-0000-0000-0000-000000000502', '10000000-0000-0000-0000-000000000501');

insert into public.sessions (id, coach_id, athlete_id, recorded_by, transcript, group_id, shared_recording_id) values
  -- one-to-one sessions
  ('20000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 'x1 alone', null, null),
  ('20000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', 'x3 alone', null, null),
  -- G1 squad talk, one row each
  ('20000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 'g1 talk', '30000000-0000-0000-0000-000000000501', null),
  ('20000000-0000-0000-0000-000000000513', '00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', 'g1 talk', '30000000-0000-0000-0000-000000000501', null),
  -- G2 squad talk: every member is A1's
  ('20000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 'g2 talk', '30000000-0000-0000-0000-000000000502', null),
  -- R: one recording split between X1 and X3
  ('20000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 'r talk', null, '40000000-0000-0000-0000-000000000501'),
  ('20000000-0000-0000-0000-000000000533', '00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', 'r talk', null, '40000000-0000-0000-0000-000000000501'),
  -- H2's
  ('20000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-0000000005b1', '10000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-0000000005b1', 'h2 talk', null, null);

insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content) values
  ('00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 'coach', 'to x1'),
  ('00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', 'coach', 'to x3');
insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content, read_at) values
  ('00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', 'athlete', 'x3 unread', null);
insert into public.wellness_checkins (athlete_id, coach_id, energy, notes) values
  ('10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 3, 'x1 note'),
  ('10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', 3, 'x3 note');
insert into public.injuries (athlete_id, coach_id, body_area) values
  ('10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a1', 'x1 ankle'),
  ('10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1', 'x3 knee');

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function pg_temp.refused(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end $$;

-- ── A1: X1 only ─────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a2');
insert into t_result values
  ('A1 sees the athlete they were given',     (select count(*) = 1 from public.athletes where id = '10000000-0000-0000-0000-000000000501')),
  ('A1 never sees a teammate''s athlete',     (select count(*) = 0 from public.athletes where id = '10000000-0000-0000-0000-000000000503')),
  ('A1 never sees another team''s athlete',   (select count(*) = 0 from public.athletes where id = '10000000-0000-0000-0000-000000000502')),
  ('A1 sees X1''s one-to-one session',        (select count(*) = 1 from public.sessions where id = '20000000-0000-0000-0000-000000000501')),
  ('A1 never sees X3''s one-to-one session',  (select count(*) = 0 from public.sessions where id = '20000000-0000-0000-0000-000000000503')),
  ('A1 cannot read X1''s row of a squad talk that includes X3',
     (select count(*) = 0 from public.sessions where id = '20000000-0000-0000-0000-000000000511')),
  ('A1 can read a squad talk whose members are all theirs',
     (select count(*) = 1 from public.sessions where id = '20000000-0000-0000-0000-000000000521')),
  ('A1 cannot read X1''s split of a recording shared with X3',
     (select count(*) = 0 from public.sessions where id = '20000000-0000-0000-0000-000000000531')),
  ('A1 never reads a transcript that names X3', (select count(*) = 0 from public.sessions where transcript in ('g1 talk', 'r talk', 'x3 alone'))),
  ('A1 sees X1''s thread only',               (select array_agg(content) = array['to x1'] from public.messages)),
  ('A1 sees X1''s check-ins only',            (select array_agg(notes) = array['x1 note'] from public.wellness_checkins)),
  ('A1 sees X1''s injuries only',             (select array_agg(body_area) = array['x1 ankle'] from public.injuries)),
  ('A1 sees the squads X1 is in',             (select array_agg(name order by name) = array['G1 both', 'G2 only X1'] from public.groups)),
  ('A1 sees only X1 in those squads',         (select count(*) = 2 and bool_and(athlete_id = '10000000-0000-0000-0000-000000000501') from public.group_members)),
  ('A1 reads their own assignment only',      (select count(*) = 1 from public.coach_staff_athletes)),
  ('A1 can record for X1',
     not pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a2', 'a1 on x1')$q$)),
  ('A1 cannot record for X3',
     pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a2', 'a1 on x3')$q$)),
  ('A1 can message X1',
     not pg_temp.refused($q$insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content)
       values ('00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a2', 'coach', 'a1 to x1')$q$)),
  ('A1 cannot message X3',
     pg_temp.refused($q$insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content)
       values ('00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a2', 'coach', 'a1 to x3')$q$)),
  ('A1 cannot give themself X3',
     pg_temp.refused($q$insert into public.coach_staff_athletes (staff_id, athlete_id, head_coach_id)
       values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1')$q$));
-- A recording A1 made about X1, split onto their own athlete only: readable.
select pg_temp.as_admin();
insert into public.sessions (id, coach_id, athlete_id, recorded_by, transcript, shared_recording_id) values
  ('20000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a2', 'a1 recorded', '40000000-0000-0000-0000-000000000541');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a2');
insert into t_result values
  ('A1 reads a recording they made themself', (select count(*) = 1 from public.sessions where id = '20000000-0000-0000-0000-000000000541'));
-- Marking X3's message read matches nothing for A1.
update public.messages set read_at = now() where content = 'x3 unread';
select pg_temp.as_admin();
insert into t_result values
  ('A1 could not mark X3''s message read', (select read_at is null from public.messages where content = 'x3 unread'));

-- ── A5: X3 only, and nothing of A1's ─────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a5');
insert into t_result values
  ('A5 sees X3, not X1',                    (select array_agg(first_name) = array['Xavier'] from public.athletes)),
  ('A5 never sees A1''s assignment',        (select count(*) = 1 from public.coach_staff_athletes)),
  ('A5 never reads the recording A1 made',  (select count(*) = 0 from public.sessions where transcript = 'a1 recorded'));
select pg_temp.as_admin();

-- ── A3 revoked, still holding an assignment row: nothing ───────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a3');
insert into t_result values
  ('revoked A3 sees no athlete despite an assignment', (select count(*) = 0 from public.athletes)),
  ('revoked A3 sees no session',                       (select count(*) = 0 from public.sessions)),
  ('revoked A3 cannot record for their old athlete',
     pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000005a3', 'x')$q$));
select pg_temp.as_admin();

-- ── H1: unchanged, and sees every assignment on the team ───────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a1');
insert into t_result values
  ('H1 still sees both athletes',            (select count(*) = 2 from public.athletes)),
  ('H1 still reads every squad transcript',  (select count(*) = 2 from public.sessions where transcript = 'g1 talk')),
  ('H1 sees the team''s assignments',        (select count(*) = 3 from public.coach_staff_athletes)),
  ('H1 still sees both squads'' members',    (select count(*) = 3 from public.group_members)),
  ('H1 cannot write an assignment directly',
     pg_temp.refused($q$insert into public.coach_staff_athletes (staff_id, athlete_id, head_coach_id)
       values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1')$q$));
select pg_temp.as_admin();

select pg_temp.as_user('00000000-0000-0000-0000-0000000005b1');
insert into t_result values
  ('H2 sees none of H1''s assignments', (select count(*) = 0 from public.coach_staff_athletes));
select pg_temp.as_admin();

-- ── integrity, from the service role (the only writer) ─────────────────────
insert into t_result values
  ('an assistant cannot be given another team''s athlete',
     pg_temp.refused($q$insert into public.coach_staff_athletes (staff_id, athlete_id, head_coach_id)
       values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-0000000005a1')$q$)),
  ('an assignment cannot name the wrong head',
     pg_temp.refused($q$insert into public.coach_staff_athletes (staff_id, athlete_id, head_coach_id)
       values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005b1')$q$)),
  ('the service role can give A1 X3',
     not pg_temp.refused($q$insert into public.coach_staff_athletes (staff_id, athlete_id, head_coach_id)
       values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000005a1')$q$)),
  ('the event log takes an assignment',
     not pg_temp.refused($q$insert into public.coach_staff_events (staff_id, actor_id, kind, athlete_id)
       values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005a1', 'assigned', '10000000-0000-0000-0000-000000000503')$q$));

-- Now that every member of G1 and R is A1's, A1 hears the whole of both.
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a2');
insert into t_result values
  ('given all of G1, A1 reads the squad talk',   (select count(*) = 2 from public.sessions where transcript = 'g1 talk')),
  ('given all of R, A1 reads the split recording', (select count(*) = 2 from public.sessions where transcript = 'r talk'));
select pg_temp.as_admin();

-- An athlete who moves to another coach leaves the assistant with them.
update public.athletes set coach_id = '00000000-0000-0000-0000-0000000005b1' where id = '10000000-0000-0000-0000-000000000501';
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a2');
insert into t_result values
  ('an athlete who leaves the head''s roster leaves the assistant too',
     (select count(*) = 0 from public.athletes where id = '10000000-0000-0000-0000-000000000501'));
select pg_temp.as_admin();

-- ── report ──────────────────────────────────────────────────────────────────
select case when ok then 'PASS' else 'FAIL' end || '  ' || name from t_result;
do $$
declare bad int;
begin
  select count(*) into bad from t_result where ok is not true;
  if bad > 0 then raise exception '% RLS case(s) failed', bad; end if;
  raise notice 'all % RLS cases pass', (select count(*) from t_result);
end $$;

rollback;
