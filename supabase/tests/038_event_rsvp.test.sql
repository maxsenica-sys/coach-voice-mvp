-- RLS test for 038_event_rsvp.sql: who may answer an event, and who reads the answers.
--
--   H1  head coach            X1  H1's athlete, signed in as U1, given to A1
--   A1  H1's assistant (X1)   X2  H1's athlete, signed in as U2, NOT given to A1
--   H2  another head coach    X3  H2's athlete
--
--   E1  H1's event for X1, RSVP asked          E4  H1's event for X1, hidden from them, RSVP asked
--   E2  H1's event for X1, no RSVP asked       E5  H1's event for X2, RSVP asked
--   E3  A1's event for X1, RSVP asked          E6  H2's event for X3, RSVP asked
--
-- Proven by breaking 038 on purpose:
--   · the old "athlete manages" check (own athlete_id only) lets U1 answer E2,
--     E4 and E5, and move an answer onto E2;
--   · the old "coach reads" (created_by_user_id) hides E3's answer from H1 and
--     shows A1 nothing on H1's events;
--   · without the status constraint, 'perhaps' is stored.

\set ON_ERROR_STOP 1
begin;

create temp table t_result (name text, ok boolean) on commit drop;
grant all on t_result to authenticated;

-- ── fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000038a1', 'h1@t38'),
  ('00000000-0000-0000-0000-0000000038a2', 'a1@t38'),
  ('00000000-0000-0000-0000-0000000038b1', 'h2@t38'),
  ('00000000-0000-0000-0000-0000000038c1', 'u1@t38'),
  ('00000000-0000-0000-0000-0000000038c2', 'u2@t38');

insert into public.athletes (id, coach_id, athlete_user_id, first_name, last_name) values
  ('10000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-0000000038a1', '00000000-0000-0000-0000-0000000038c1', 'Xia', 'One'),
  ('10000000-0000-0000-0000-000000003802', '00000000-0000-0000-0000-0000000038a1', '00000000-0000-0000-0000-0000000038c2', 'Xoe', 'Two'),
  ('10000000-0000-0000-0000-000000003803', '00000000-0000-0000-0000-0000000038b1', null, 'Xan', 'Three');

insert into public.coach_staff (id, head_coach_id, member_user_id, invited_email, status) values
  ('50000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-0000000038a1', '00000000-0000-0000-0000-0000000038a2', 'a1@t38', 'active');
insert into public.coach_staff_athletes (staff_id, athlete_id, head_coach_id) values
  ('50000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-0000000038a1');

insert into public.calendar_events (id, athlete_id, created_by_user_id, created_by_role, title, event_date, visible_to_athlete, rsvp_enabled) values
  ('30000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-0000000038a1', 'coach', 'E1', '2026-12-01', true,  true),
  ('30000000-0000-0000-0000-000000003802', '10000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-0000000038a1', 'coach', 'E2', '2026-12-01', true,  false),
  ('30000000-0000-0000-0000-000000003803', '10000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-0000000038a2', 'coach', 'E3', '2026-12-02', true,  true),
  ('30000000-0000-0000-0000-000000003804', '10000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-0000000038a1', 'coach', 'E4', '2026-12-03', false, true),
  ('30000000-0000-0000-0000-000000003805', '10000000-0000-0000-0000-000000003802', '00000000-0000-0000-0000-0000000038a1', 'coach', 'E5', '2026-12-04', true,  true),
  ('30000000-0000-0000-0000-000000003806', '10000000-0000-0000-0000-000000003803', '00000000-0000-0000-0000-0000000038b1', 'coach', 'E6', '2026-12-05', true,  true);

insert into public.event_rsvps (event_id, athlete_id, status) values
  ('30000000-0000-0000-0000-000000003805', '10000000-0000-0000-0000-000000003802', 'no'),
  ('30000000-0000-0000-0000-000000003806', '10000000-0000-0000-0000-000000003803', 'yes');

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

-- ── U1, the athlete ─────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000038c1');
insert into t_result values
  ('U1 can answer an event that asked them (E1)',
     not pg_temp.refused($q$insert into public.event_rsvps (event_id, athlete_id, status)
       values ('30000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003801', 'yes')$q$)),
  ('U1 can answer an event an assistant added for them (E3)',
     not pg_temp.refused($q$insert into public.event_rsvps (event_id, athlete_id, status)
       values ('30000000-0000-0000-0000-000000003803', '10000000-0000-0000-0000-000000003801', 'no')$q$)),
  ('U1 cannot answer an event that asked for no RSVP (E2)',
     pg_temp.refused($q$insert into public.event_rsvps (event_id, athlete_id, status)
       values ('30000000-0000-0000-0000-000000003802', '10000000-0000-0000-0000-000000003801', 'yes')$q$)),
  ('U1 cannot answer an event hidden from them (E4)',
     pg_temp.refused($q$insert into public.event_rsvps (event_id, athlete_id, status)
       values ('30000000-0000-0000-0000-000000003804', '10000000-0000-0000-0000-000000003801', 'yes')$q$)),
  ('U1 cannot answer another athlete''s event as themself (E5)',
     pg_temp.refused($q$insert into public.event_rsvps (event_id, athlete_id, status)
       values ('30000000-0000-0000-0000-000000003805', '10000000-0000-0000-0000-000000003801', 'yes')$q$)),
  ('U1 cannot answer as another athlete (X2 on E1)',
     pg_temp.refused($q$insert into public.event_rsvps (event_id, athlete_id, status)
       values ('30000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003802', 'yes')$q$)),
  ('U1 cannot store a status outside the four',
     pg_temp.refused($q$update public.event_rsvps set status = 'perhaps'
       where event_id = '30000000-0000-0000-0000-000000003801'$q$)),
  ('U1 cannot move their answer onto an event that did not ask (E1 to E2)',
     pg_temp.refused($q$update public.event_rsvps set event_id = '30000000-0000-0000-0000-000000003802'
       where event_id = '30000000-0000-0000-0000-000000003801'$q$)),
  ('U1 never reads another athlete''s answer',
     (select count(*) = 0 from public.event_rsvps where athlete_id <> '10000000-0000-0000-0000-000000003801'));
update public.event_rsvps set status = 'no' where event_id = '30000000-0000-0000-0000-000000003801';
-- An update aimed at another athlete's answer: RLS filters it to no rows.
update public.event_rsvps set status = 'yes' where event_id = '30000000-0000-0000-0000-000000003805';
select pg_temp.as_admin();
insert into t_result values
  ('U1 can change their answer',
     (select status = 'no' from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003801' and athlete_id = '10000000-0000-0000-0000-000000003801'));

-- U2's existing answer stays theirs: U1's update above touched nothing of X2's.
insert into t_result values
  ('another athlete''s answer was not changed by U1',
     (select status = 'no' from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003805' and athlete_id = '10000000-0000-0000-0000-000000003802'));

-- ── H1, the head coach ──────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000038a1');
insert into t_result values
  ('H1 reads the answer to their own event (E1)',
     (select count(*) = 1 from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003801')),
  ('H1 reads the answer to an event their assistant added (E3)',
     (select count(*) = 1 from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003803')),
  ('H1 reads an athlete A1 was not given (E5)',
     (select count(*) = 1 from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003805')),
  ('H1 never reads another coach''s athletes'' answers (E6)',
     (select count(*) = 0 from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003806')),
  ('H1 cannot answer for an athlete',
     pg_temp.refused($q$insert into public.event_rsvps (event_id, athlete_id, status)
       values ('30000000-0000-0000-0000-000000003803', '10000000-0000-0000-0000-000000003801', 'yes')
       on conflict (event_id, athlete_id) do update set status = 'yes'$q$));
select pg_temp.as_admin();

-- ── A1, the assistant given X1 only ─────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000038a2');
insert into t_result values
  ('A1 reads the answers of the athlete they were given, on the head''s event too (E1)',
     (select count(*) = 1 from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003801')),
  ('A1 never reads an athlete they were not given (E5)',
     (select count(*) = 0 from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003805'));
update public.event_rsvps set status = 'yes' where event_id = '30000000-0000-0000-0000-000000003801';
select pg_temp.as_admin();
insert into t_result values
  ('A1 cannot change an athlete''s answer',
     (select status = 'no' from public.event_rsvps where event_id = '30000000-0000-0000-0000-000000003801' and athlete_id = '10000000-0000-0000-0000-000000003801'));

-- ── H2, another coach ───────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000038b1');
insert into t_result values
  ('H2 never reads H1''s athletes'' answers',
     (select count(*) = 0 from public.event_rsvps where athlete_id in
       ('10000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003802')));
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
