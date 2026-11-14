-- RLS test for 036_session_delivery.sql: "in person" or "online" on a session.
--
--   H1  head coach        X1  H1's athlete, signed in as U1
--   H2  another coach     S1  H1's session for X1, shared with X1
--   U1  X1's own account  S2  H2's session for their athlete
--
-- delivery is a column on public.sessions, so the existing row policies are
-- the only gate. These cases prove that: the people who may read a session
-- read its delivery, nobody else does, and only the two values (or none)
-- are ever stored.

\set ON_ERROR_STOP 1
begin;

create temp table t_result (name text, ok boolean) on commit drop;
grant all on t_result to authenticated;

-- ── fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000036a1', 'h1@t36'),
  ('00000000-0000-0000-0000-0000000036b1', 'h2@t36'),
  ('00000000-0000-0000-0000-0000000036c1', 'u1@t36');

insert into public.athletes (id, coach_id, athlete_user_id, first_name, last_name) values
  ('10000000-0000-0000-0000-000000003601', '00000000-0000-0000-0000-0000000036a1', '00000000-0000-0000-0000-0000000036c1', 'Xia', 'One'),
  ('10000000-0000-0000-0000-000000003602', '00000000-0000-0000-0000-0000000036b1', null, 'Xan', 'Two');

insert into public.sessions (id, coach_id, athlete_id, transcript, shared_with_athlete, delivery) values
  ('20000000-0000-0000-0000-000000003601', '00000000-0000-0000-0000-0000000036a1', '10000000-0000-0000-0000-000000003601', 's1', true, 'online'),
  ('20000000-0000-0000-0000-000000003602', '00000000-0000-0000-0000-0000000036b1', '10000000-0000-0000-0000-000000003602', 's2', false, 'in_person');

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

-- ── the column itself ───────────────────────────────────────────────────────
insert into t_result values
  ('a value other than in_person/online is refused',
     pg_temp.refused($q$update public.sessions set delivery = 'zoom' where id = '20000000-0000-0000-0000-000000003601'$q$)),
  ('upper case is refused too (one spelling, one meaning)',
     pg_temp.refused($q$update public.sessions set delivery = 'Online' where id = '20000000-0000-0000-0000-000000003601'$q$)),
  ('null is allowed: older sessions and older clients say nothing',
     not pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, transcript)
       values ('00000000-0000-0000-0000-0000000036a1', '10000000-0000-0000-0000-000000003601', 'no delivery')$q$));
-- A separate statement: inside the one above, the new row is not yet visible.
insert into t_result values
  ('a session saved without it has no delivery, never a guessed one',
     (select delivery is null from public.sessions where transcript = 'no delivery'));

-- ── H1, the coach ───────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000036a1');
insert into t_result values
  ('H1 reads their session''s delivery',
     (select delivery = 'online' from public.sessions where id = '20000000-0000-0000-0000-000000003601')),
  ('H1 can save a new session as in person',
     not pg_temp.refused($q$insert into public.sessions (coach_id, athlete_id, transcript, delivery)
       values ('00000000-0000-0000-0000-0000000036a1', '10000000-0000-0000-0000-000000003601', 'h1 new', 'in_person')$q$)),
  ('H1 never reads H2''s session',
     (select count(*) = 0 from public.sessions where id = '20000000-0000-0000-0000-000000003602'));
update public.sessions set delivery = 'in_person' where id = '20000000-0000-0000-0000-000000003601';
select pg_temp.as_admin();
insert into t_result values
  ('H1 can correct their own session''s delivery',
     (select delivery = 'in_person' from public.sessions where id = '20000000-0000-0000-0000-000000003601'));

-- ── H2, another coach ───────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000036b1');
update public.sessions set delivery = 'online' where id = '20000000-0000-0000-0000-000000003601';
select pg_temp.as_admin();
insert into t_result values
  ('H2 cannot change H1''s session',
     (select delivery = 'in_person' from public.sessions where id = '20000000-0000-0000-0000-000000003601'));

-- ── U1, the athlete ─────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000036c1');
insert into t_result values
  ('the athlete reads delivery on a session shared with them',
     (select delivery = 'in_person' from public.sessions where id = '20000000-0000-0000-0000-000000003601')),
  ('the athlete never reads another coach''s session',
     (select count(*) = 0 from public.sessions where id = '20000000-0000-0000-0000-000000003602'));
update public.sessions set delivery = 'online' where id = '20000000-0000-0000-0000-000000003601';
select pg_temp.as_admin();
insert into t_result values
  ('the athlete cannot change it',
     (select delivery = 'in_person' from public.sessions where id = '20000000-0000-0000-0000-000000003601'));

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
