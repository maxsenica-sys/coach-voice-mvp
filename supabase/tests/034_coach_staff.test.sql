-- RLS test for 034_coach_staff.sql. Runs against a database carrying the
-- production schema (see supabase/tests/README.md) and fails loudly.
--
--   H1  head coach            X1  H1's athlete (has a login)
--   A1  H1's active assistant X2  H2's athlete (has a login)
--   A3  H1's revoked assistant
--   A4  H1's invited-but-not-accepted assistant
--   H2  a different head coach
--
-- Every case is written as "this must be true". A case that the policies get
-- wrong prints FAIL and the script exits non-zero.

\set ON_ERROR_STOP 1
begin;

create temp table t_result (name text, ok boolean) on commit drop;
grant all on t_result to authenticated;

-- ── fixtures (as the superuser, i.e. the service role's position) ──────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'h1@test'),
  ('00000000-0000-0000-0000-0000000000a2', 'a1@test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a3@test'),
  ('00000000-0000-0000-0000-0000000000a4', 'a4@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'h2@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'x1@test'),
  ('00000000-0000-0000-0000-0000000000c2', 'x2@test');
update public.profiles set role = 'athlete' where id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');

insert into public.athletes (id, coach_id, athlete_user_id, first_name, last_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Xena', 'One'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2', 'Xavi', 'Two');

insert into public.coach_staff (head_coach_id, member_user_id, invited_email, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'a1@test', 'active'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', 'a3@test', 'revoked'),
  ('00000000-0000-0000-0000-0000000000a1', null, 'a4@test', 'invited');
update public.coach_staff set invite_token_hash = 'secret-hash' where invited_email = 'a4@test';

insert into public.sessions (id, coach_id, athlete_id, recorded_by, transcript, shared_with_athlete) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'h1 said', true),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 'h2 said', true);
insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'athlete', 'hi coach'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', 'athlete', 'hi other coach');
insert into public.wellness_checkins (athlete_id, coach_id, energy, notes) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 3, 'private note'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 3, 'other private note');
insert into public.groups (id, coach_id, name) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'H1 squad'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 'H2 squad');
insert into public.injuries (athlete_id, coach_id, body_area) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'ankle');

-- ── helpers ─────────────────────────────────────────────────────────────────
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
-- Runs a statement as the current role; true when it raised.
create or replace function pg_temp.refused(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end $$;

-- ── A1, the active assistant: sees H1's team, never H2's ──────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into t_result values
  ('A1 sees H1''s athlete',          (select count(*) = 1 from public.athletes where id = '10000000-0000-0000-0000-000000000001')),
  ('A1 never sees H2''s athlete',    (select count(*) = 0 from public.athletes where id = '10000000-0000-0000-0000-000000000002')),
  ('A1 sees H1''s session',          (select count(*) = 1 from public.sessions where id = '20000000-0000-0000-0000-000000000001')),
  ('A1 never sees H2''s session',    (select count(*) = 0 from public.sessions where id = '20000000-0000-0000-0000-000000000002')),
  ('A1 sees H1''s thread',           (select count(*) = 1 from public.messages where coach_id = '00000000-0000-0000-0000-0000000000a1')),
  ('A1 never sees H2''s thread',     (select count(*) = 0 from public.messages where coach_id = '00000000-0000-0000-0000-0000000000b1')),
  ('A1 sees H1''s full check-ins (Max: everything)', (select count(*) = 1 from public.wellness_checkins where notes = 'private note')),
  ('A1 never sees H2''s check-ins',  (select count(*) = 0 from public.wellness_checkins where coach_id = '00000000-0000-0000-0000-0000000000b1')),
  ('A1 sees H1''s injuries',         (select count(*) = 1 from public.injuries)),
  ('A1 sees H1''s squads only',      (select array_agg(name) = array['H1 squad'] from public.groups)),
  ('A1 reads own staff row',         (select count(*) = 1 from public.coach_staff)),
  ('A1 cannot read the token hash',  pg_temp.refused('select invite_token_hash from public.coach_staff')),
  ('A1 can record for H1''s athlete',
     not pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'a1 said')$q$)),
  ('A1 cannot record as someone else',
     pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'forged')$q$)),
  ('A1 cannot record onto H2''s athlete',
     pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2', 'x')$q$)),
  ('A1 cannot own a session of H1''s athlete',
     pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'x')$q$)),
  ('A1 cannot re-own their own recording',
     pg_temp.refused($q$update public.sessions set coach_id = '00000000-0000-0000-0000-0000000000a2' where transcript = 'a1 said'$q$)),
  ('A1 can send in H1''s thread',
     not pg_temp.refused($q$insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content)
       values ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'coach', 'from a1')$q$)),
  ('A1 cannot send as the head',
     pg_temp.refused($q$insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content)
       values ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'coach', 'forged')$q$)),
  ('A1 cannot send into H2''s thread',
     pg_temp.refused($q$insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content)
       values ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2', 'coach', 'x')$q$)),
  ('A1 cannot add an athlete',
     pg_temp.refused($q$insert into public.athletes (coach_id, first_name, last_name) values ('00000000-0000-0000-0000-0000000000a1', 'New', 'Kid')$q$)),
  ('A1 cannot add a squad',
     pg_temp.refused($q$insert into public.groups (coach_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'x')$q$)),
  ('A1 cannot add a caretaker',
     pg_temp.refused($q$insert into public.athlete_caretakers (athlete_id, coach_id, caretaker_name, caretaker_email)
       values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'P', 'p@test')$q$)),
  ('A1 cannot make themself head of anything',
     pg_temp.refused($q$update public.coach_staff set status = 'active'$q$)),
  ('A1 cannot read the access log',  (select count(*) = 0 from public.access_log));

-- A1 edits of the head's recording silently match nothing (RLS), which is
-- what "cannot" looks like for UPDATE. Check it did not land.
update public.sessions set summary = 'tampered' where id = '20000000-0000-0000-0000-000000000001';
delete from public.sessions where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.as_admin();
insert into t_result values
  ('A1''s edit of the head''s recording did not land', (select summary is null from public.sessions where id = '20000000-0000-0000-0000-000000000001')),
  ('A1 could not delete the head''s recording',       (select count(*) = 1 from public.sessions where id = '20000000-0000-0000-0000-000000000001')),
  ('A1''s recording is owned by the head',             (select coach_id = '00000000-0000-0000-0000-0000000000a1' from public.sessions where transcript = 'a1 said'));

-- ── A3 revoked, A4 invited: nothing ─────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
insert into t_result values
  ('revoked A3 sees no athlete', (select count(*) = 0 from public.athletes)),
  ('revoked A3 sees no session', (select count(*) = 0 from public.sessions)),
  ('revoked A3 sees no message', (select count(*) = 0 from public.messages)),
  ('revoked A3 sees no check-in', (select count(*) = 0 from public.wellness_checkins)),
  ('revoked A3 cannot record',
     pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'x')$q$));
select pg_temp.as_admin();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
insert into t_result values
  ('invited A4 sees no athlete', (select count(*) = 0 from public.athletes)),
  ('invited A4 sees no session', (select count(*) = 0 from public.sessions));
select pg_temp.as_admin();

-- ── H2 and the athletes see nothing new ────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into t_result values
  ('H2 still never sees H1''s athlete', (select count(*) = 0 from public.athletes where coach_id = '00000000-0000-0000-0000-0000000000a1')),
  ('H2 sees no one else''s staff',       (select count(*) = 0 from public.coach_staff));
select pg_temp.as_admin();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into t_result values
  ('athlete X1 sees no staff rows',     (select count(*) = 0 from public.coach_staff)),
  ('athlete X1 sees only their own row', (select count(*) = 1 from public.athletes)),
  ('athlete X1 sees the assistant''s message', (select count(*) = 1 from public.messages where content = 'from a1'));
select pg_temp.as_admin();

-- ── H1, the head: sees the assistant's work; nothing about H1 changed ──────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into t_result values
  ('H1 sees A1''s recording',  (select count(*) = 1 from public.sessions where transcript = 'a1 said')),
  ('H1 sees A1''s message',    (select count(*) = 1 from public.messages where content = 'from a1')),
  ('H1 sees the whole team',   (select count(*) = 3 from public.coach_staff)),
  ('H1 can still add an athlete',
     not pg_temp.refused($q$insert into public.athletes (coach_id, first_name, last_name) values ('00000000-0000-0000-0000-0000000000a1', 'New', 'Kid')$q$));
select pg_temp.as_admin();

-- ── integrity, from the service role (where routes write) ─────────────────
insert into t_result values
  ('service role cannot file a session under a coach who is not the athlete''s',
     pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, transcript)
       values ('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 'x')$q$)),
  ('service role cannot file a message under the wrong coach',
     pg_temp.refused($q$insert into public.messages (coach_id, athlete_id, sender_id, sender_role, content)
       values ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'coach', 'x')$q$)),
  ('service role can still write normally',
     not pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, recorded_by, transcript)
       values ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'via route')$q$));

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
