-- RLS test for 037_session_first_shared.sql.
--
--   H1  head coach          X1  H1's athlete, given to A1, signed in as U1
--   A1  H1's assistant      X3  H1's athlete, given to nobody
--   A3  H1's revoked asst.  X2  H2's athlete
--   H2  another head coach
--
-- Holds: the first share is claimed exactly once, by whoever may edit the
-- session; who may delete which session; an athlete's own notes survive the
-- session they were about; the session's calendar event goes with it.

\set ON_ERROR_STOP 1
begin;

create temp table t_result (name text, ok boolean) on commit drop;
grant all on t_result to authenticated;

-- ── fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000037a1', 'h1@t37'),
  ('00000000-0000-0000-0000-0000000037a2', 'a1@t37'),
  ('00000000-0000-0000-0000-0000000037a3', 'a3@t37'),
  ('00000000-0000-0000-0000-0000000037b1', 'h2@t37'),
  ('00000000-0000-0000-0000-0000000037c1', 'u1@t37');

insert into public.athletes (id, coach_id, athlete_user_id, first_name, last_name) values
  ('10000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a1', '00000000-0000-0000-0000-0000000037c1', 'Xia', 'Given'),
  ('10000000-0000-0000-0000-000000003703', '00000000-0000-0000-0000-0000000037a1', null, 'Xavier', 'NotGiven'),
  ('10000000-0000-0000-0000-000000003702', '00000000-0000-0000-0000-0000000037b1', null, 'Xan', 'Other');

insert into public.coach_staff (id, head_coach_id, member_user_id, invited_email, status) values
  ('50000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a1', '00000000-0000-0000-0000-0000000037a2', 'a1@t37', 'active'),
  ('50000000-0000-0000-0000-000000003703', '00000000-0000-0000-0000-0000000037a1', '00000000-0000-0000-0000-0000000037a3', 'a3@t37', 'revoked');
insert into public.coach_staff_athletes (staff_id, athlete_id, head_coach_id) values
  ('50000000-0000-0000-0000-000000003701', '10000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a1'),
  ('50000000-0000-0000-0000-000000003703', '10000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a1');

-- id suffix: 01 H1's own, 11 A1's of X1, 13 A1's of X3 (no longer given),
-- 21 A3's of X1 (revoked), 02 H2's, 31 H1's to be deleted with a note and an event.
insert into public.sessions (id, coach_id, athlete_id, recorded_by, transcript, shared_with_athlete) values
  ('20000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a1', '10000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a1', 'h1 own', false),
  ('20000000-0000-0000-0000-000000003711', '00000000-0000-0000-0000-0000000037a1', '10000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a2', 'a1 x1', false),
  ('20000000-0000-0000-0000-000000003713', '00000000-0000-0000-0000-0000000037a1', '10000000-0000-0000-0000-000000003703', '00000000-0000-0000-0000-0000000037a2', 'a1 x3', false),
  ('20000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-0000000037a1', '10000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a3', 'a3 x1', false),
  ('20000000-0000-0000-0000-000000003702', '00000000-0000-0000-0000-0000000037b1', '10000000-0000-0000-0000-000000003702', '00000000-0000-0000-0000-0000000037b1', 'h2 own', false),
  ('20000000-0000-0000-0000-000000003731', '00000000-0000-0000-0000-0000000037a1', '10000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a1', 'to delete', true);

insert into public.athlete_notes (id, athlete_user_id, session_id, content) values
  ('60000000-0000-0000-0000-000000003731', '00000000-0000-0000-0000-0000000037c1', '20000000-0000-0000-0000-000000003731', 'my own note');
insert into public.calendar_events (id, athlete_id, created_by_user_id, created_by_role, title, event_date, session_id) values
  ('70000000-0000-0000-0000-000000003731', '10000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-0000000037a1', 'coach', 'to delete', current_date, '20000000-0000-0000-0000-000000003731');

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
-- How many rows a statement changed (errors count as none).
create or replace function pg_temp.changed(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
exception when others then
  return 0;
end $$;
grant execute on function pg_temp.changed(text) to authenticated;

-- The claim the share routes make: set first_shared_at only if nobody has.
create or replace function pg_temp.claim(sid text) returns text language sql as $$
  select format($q$update public.sessions set first_shared_at = now() where id = %L and first_shared_at is null$q$, sid)
$$;
create or replace function pg_temp.del(sid text) returns text language sql as $$
  select format($q$delete from public.sessions where id = %L$q$, sid)
$$;

-- ── the column ─────────────────────────────────────────────────────────────
insert into t_result values
  ('a new session has no first share', (select first_shared_at is null from public.sessions where id = '20000000-0000-0000-0000-000000003701'));

-- ── the first share is claimed exactly once ────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000037a1');
insert into t_result values ('H1 claims the first share of their session', pg_temp.changed(pg_temp.claim('20000000-0000-0000-0000-000000003701')) = 1);
insert into t_result values ('a second claim changes nothing (no second nod)', pg_temp.changed(pg_temp.claim('20000000-0000-0000-0000-000000003701')) = 0);
select pg_temp.as_admin();

select pg_temp.as_user('00000000-0000-0000-0000-0000000037a2');
insert into t_result values ('A1 claims the first share of a session they recorded', pg_temp.changed(pg_temp.claim('20000000-0000-0000-0000-000000003711')) = 1);
insert into t_result values ('A1 cannot claim one H1 recorded', pg_temp.changed(pg_temp.claim('20000000-0000-0000-0000-000000003701')) = 0);
select pg_temp.as_admin();

select pg_temp.as_user('00000000-0000-0000-0000-0000000037b1');
insert into t_result values ('H2 cannot claim H1''s session', pg_temp.changed(pg_temp.claim('20000000-0000-0000-0000-000000003713')) = 0);
select pg_temp.as_admin();
insert into t_result values ('H2''s attempt left it unclaimed', (select first_shared_at is null from public.sessions where id = '20000000-0000-0000-0000-000000003713'));

select pg_temp.as_user('00000000-0000-0000-0000-0000000037c1');
insert into t_result values ('the athlete cannot claim a share', pg_temp.changed(pg_temp.claim('20000000-0000-0000-0000-000000003721')) = 0);
select pg_temp.as_admin();

-- ── who may delete ─────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000037a2');
insert into t_result values ('A1 cannot delete a session H1 recorded', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003701')) = 0);
insert into t_result values ('A1 cannot delete their recording of an athlete no longer given to them', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003713')) = 0);
insert into t_result values ('A1 cannot delete what another assistant recorded', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003721')) = 0);
insert into t_result values ('A1 deletes a session they recorded, of an athlete given to them', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003711')) = 1);
select pg_temp.as_admin();

select pg_temp.as_user('00000000-0000-0000-0000-0000000037a3');
insert into t_result values ('a revoked assistant deletes nothing they recorded', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003721')) = 0);
select pg_temp.as_admin();

select pg_temp.as_user('00000000-0000-0000-0000-0000000037b1');
insert into t_result values ('H2 cannot delete H1''s session', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003701')) = 0);
select pg_temp.as_admin();

select pg_temp.as_user('00000000-0000-0000-0000-0000000037c1');
insert into t_result values ('the athlete cannot delete a session', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003731')) = 0);
select pg_temp.as_admin();

insert into t_result values
  ('everything refused above is still there',
     (select count(*) = 5 from public.sessions where id in (
        '20000000-0000-0000-0000-000000003701', '20000000-0000-0000-0000-000000003713',
        '20000000-0000-0000-0000-000000003721', '20000000-0000-0000-0000-000000003702',
        '20000000-0000-0000-0000-000000003731')));

-- ── what a delete takes, and what it leaves ────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000037a1');
insert into t_result values ('H1 deletes their own session', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003731')) = 1);
insert into t_result values ('H1 deletes a session their assistant recorded', pg_temp.changed(pg_temp.del('20000000-0000-0000-0000-000000003721')) = 1);
select pg_temp.as_admin();
insert into t_result values
  ('the athlete''s own note survives the session', (select count(*) = 1 from public.athlete_notes where id = '60000000-0000-0000-0000-000000003731')),
  ('the note is kept unattached, not pointing at a missing session', (select session_id is null from public.athlete_notes where id = '60000000-0000-0000-0000-000000003731')),
  ('the session''s calendar event goes with it', (select count(*) = 0 from public.calendar_events where id = '70000000-0000-0000-0000-000000003731'));

select pg_temp.as_user('00000000-0000-0000-0000-0000000037c1');
insert into t_result values ('the athlete still reads their own note', (select count(*) = 1 from public.athlete_notes where id = '60000000-0000-0000-0000-000000003731'));
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
