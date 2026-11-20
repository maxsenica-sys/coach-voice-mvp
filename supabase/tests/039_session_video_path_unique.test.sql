-- Test for 039_session_video_path_unique.sql: a video file is recorded once.
--
--   H1  head coach, with athlete X1 and session S1
--
-- Proven by breaking 039 on purpose: without the index, the second insert of
-- the same path succeeds and the session holds the clip twice.

\set ON_ERROR_STOP 1
begin;

create temp table t_result (name text, ok boolean) on commit drop;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000039a1', 'h1@t39');
insert into public.athletes (id, coach_id, first_name, last_name) values
  ('10000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-0000000039a1', 'Xia', 'One');
insert into public.sessions (id, coach_id, athlete_id, session_date) values
  ('20000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-0000000039a1', '10000000-0000-0000-0000-000000003901', current_date);

insert into public.session_videos (session_id, storage_path, uploaded_by) values
  ('20000000-0000-0000-0000-000000003901', 't39/s1/1.mp4', '00000000-0000-0000-0000-0000000039a1');

do $$
declare refused boolean := false;
begin
  begin
    insert into public.session_videos (session_id, storage_path, uploaded_by) values
      ('20000000-0000-0000-0000-000000003901', 't39/s1/1.mp4', '00000000-0000-0000-0000-0000000039a1');
  exception when unique_violation then refused := true;
  end;
  insert into t_result values ('the same file recorded a second time is refused', refused);
end $$;

insert into public.session_videos (session_id, storage_path, uploaded_by) values
  ('20000000-0000-0000-0000-000000003901', 't39/s1/2.mp4', '00000000-0000-0000-0000-0000000039a1');

insert into t_result values
  ('the clip is on the session once', (select count(*) = 1 from public.session_videos where storage_path = 't39/s1/1.mp4')),
  ('a second, different clip is still recorded', (select count(*) = 2 from public.session_videos where session_id = '20000000-0000-0000-0000-000000003901'));

select case when ok then 'PASS' else 'FAIL' end || '  ' || name from t_result;
do $$
declare bad int;
begin
  select count(*) into bad from t_result where ok is not true;
  if bad > 0 then raise exception '% case(s) failed', bad; end if;
  raise notice 'all % cases pass', (select count(*) from t_result);
end $$;

rollback;
