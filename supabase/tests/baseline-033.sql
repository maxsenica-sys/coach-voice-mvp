-- The production public schema after migration 033, read from pg_catalog on
-- 2026-09-27 (the earliest tables were made by hand before migrations were
-- tracked, so replaying 001-033 cannot rebuild them).
--
-- Tables, constraints, triggers, grants and every RLS policy are exact. Only a
-- handful of indexes are kept: none of them change what a query returns.
--
-- tools/rls-rig.mjs loads this, then every migration numbered after 033, then
-- runs supabase/tests/*.test.sql. When a later migration has shipped, this file
-- does not need regenerating: it is the base those migrations are applied to.
create table public.access_log (id uuid default gen_random_uuid() not null, coach_id uuid not null, athlete_id uuid not null, athlete_user_id uuid not null, session_id uuid, kind text not null, created_at timestamp with time zone default now() not null);
create table public.athlete_caretakers (id uuid default gen_random_uuid() not null, athlete_id uuid not null, coach_id uuid not null, caretaker_name text not null, caretaker_email text not null, relationship text default 'parent'::text, notify_session_reports boolean default true, notify_monthly_reports boolean default true, created_at timestamp with time zone default now(), notify_wellness_alerts boolean default true);
create table public.athlete_notes (id uuid default gen_random_uuid() not null, athlete_user_id uuid not null, session_id uuid, content text not null, note_type text default 'typed'::text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.athletes (id uuid default gen_random_uuid() not null, coach_id uuid not null, athlete_user_id uuid, first_name text not null, last_name text not null, email text, created_at timestamp with time zone default now(), status text default 'invited'::text not null, invited_at timestamp with time zone default now() not null, activated_at timestamp with time zone, auto_monthly_report boolean default false, auto_report_day integer default 1, first_login_at timestamp with time zone, photo_url text, "position" text, height_cm numeric(5,1), sport_metrics jsonb default '{}'::jsonb, goals text, custom_fields jsonb default '[]'::jsonb, sport text, height text);
create table public.calendar_events (id uuid default gen_random_uuid() not null, athlete_id uuid, created_by_user_id uuid, created_by_role text not null, title text not null, description text, event_type text default 'session'::text, event_date date not null, event_time time without time zone, created_at timestamp with time zone default now(), rsvp_enabled boolean default false, session_id uuid, visible_to_athlete boolean default true not null, checkin_requested boolean default false not null);
create table public.event_rsvps (id uuid default gen_random_uuid() not null, event_id uuid not null, athlete_id uuid not null, status text default 'pending'::text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.group_members (group_id uuid not null, athlete_id uuid not null, added_at timestamp with time zone default now());
create table public.groups (id uuid default gen_random_uuid() not null, coach_id uuid not null, name text not null, color text default '#2563eb'::text not null, description text, created_at timestamp with time zone default now());
create table public.injuries (id uuid default gen_random_uuid() not null, athlete_id uuid not null, coach_id uuid not null, body_area text not null, status text default 'active'::text not null, severity smallint, started_on date default CURRENT_DATE not null, expected_return date, cleared_on date, note text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.messages (id uuid default gen_random_uuid() not null, coach_id uuid not null, athlete_id uuid not null, sender_id uuid not null, sender_role text not null, content text, msg_type text default 'text'::text not null, media_url text, media_name text, read_at timestamp with time zone, created_at timestamp with time zone default now(), media_path text);
create table public.notes (id uuid default gen_random_uuid() not null, athlete_id uuid not null, coach_id uuid not null, audio_url text, transcript text, summary text, key_takeaways jsonb, shared_with_athlete boolean default false, created_at timestamp with time zone default now(), session_id uuid);
create table public.profiles (id uuid not null, role text not null, coach_id uuid, created_at timestamp with time zone default now(), first_name text, last_name text, sport text, position_or_event text, experience_level text, coaching_level text, goals text, invite_code text);
create table public.push_subscriptions (id uuid default gen_random_uuid() not null, user_id uuid not null, endpoint text not null, p256dh text not null, auth text not null, user_agent text, created_at timestamp with time zone default now() not null, last_used_at timestamp with time zone);
create table public.session_attachments (id uuid default gen_random_uuid() not null, session_id uuid not null, coach_id uuid not null, storage_path text not null, file_name text, mime_type text, caption text, created_at timestamp with time zone default now() not null);
create table public.session_videos (id uuid default gen_random_uuid() not null, session_id uuid, storage_path text not null, file_name text, mime_type text, uploaded_by uuid, annotations jsonb default '[]'::jsonb, created_at timestamp with time zone default now(), shared_with_athlete boolean default false, share_note text, uploaded_by_role text default 'coach'::text not null, athlete_id uuid, duration_s numeric(8,2), note text);
create table public.sessions (id uuid default gen_random_uuid() not null, coach_id uuid not null, athlete_id uuid not null, summary text, shared_with_athlete boolean default false not null, created_at timestamp with time zone default now() not null, transcript text, audio_path text, audio_mime text, title text, session_name text, sport_context text, coach_notes text, focus_points jsonb default '[]'::jsonb not null, session_date date, group_id uuid, athlete_response text, athlete_responded_at timestamp with time zone, shared_recording_id uuid);
create table public.video_clips (id uuid default gen_random_uuid() not null, session_id uuid not null, video_id uuid not null, start_s numeric(8,1) not null, end_s numeric(8,1) not null, label text, focus_point text, created_by uuid, created_at timestamp with time zone default now() not null);
create table public.wellness_checkins (id uuid default gen_random_uuid() not null, athlete_id uuid not null, coach_id uuid not null, check_date date default CURRENT_DATE not null, energy integer, mood integer, sleep_q integer, soreness integer, stress integer, notes text, created_at timestamp with time zone default now(), soreness_score smallint, soreness_areas text[], readiness smallint, sore_areas text[] default '{}'::text[] not null, session_event_id uuid, injury_update text);

alter table access_log add constraint access_log_pkey PRIMARY KEY (id);
alter table athlete_caretakers add constraint athlete_caretakers_athlete_id_caretaker_email_key UNIQUE (athlete_id, caretaker_email);
alter table athlete_caretakers add constraint athlete_caretakers_pkey PRIMARY KEY (id);
alter table athlete_notes add constraint athlete_notes_pkey PRIMARY KEY (id);
alter table athletes add constraint athletes_pkey PRIMARY KEY (id);
alter table calendar_events add constraint calendar_events_pkey PRIMARY KEY (id);
alter table event_rsvps add constraint event_rsvps_event_id_athlete_id_key UNIQUE (event_id, athlete_id);
alter table event_rsvps add constraint event_rsvps_pkey PRIMARY KEY (id);
alter table group_members add constraint group_members_pkey PRIMARY KEY (group_id, athlete_id);
alter table groups add constraint groups_pkey PRIMARY KEY (id);
alter table injuries add constraint injuries_pkey PRIMARY KEY (id);
alter table messages add constraint messages_pkey PRIMARY KEY (id);
alter table notes add constraint notes_pkey PRIMARY KEY (id);
alter table profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);
alter table push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table session_attachments add constraint session_attachments_pkey PRIMARY KEY (id);
alter table session_videos add constraint session_videos_pkey PRIMARY KEY (id);
alter table sessions add constraint sessions_pkey PRIMARY KEY (id);
alter table video_clips add constraint video_clips_pkey PRIMARY KEY (id);
alter table wellness_checkins add constraint wellness_checkins_athlete_id_check_date_key UNIQUE (athlete_id, check_date);
alter table wellness_checkins add constraint wellness_checkins_pkey PRIMARY KEY (id);

alter table access_log add constraint access_log_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table access_log add constraint access_log_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table access_log add constraint access_log_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table access_log add constraint access_log_athlete_user_id_fkey FOREIGN KEY (athlete_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table athlete_caretakers add constraint athlete_caretakers_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table athlete_caretakers add constraint athlete_caretakers_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id);
alter table athlete_notes add constraint athlete_notes_athlete_user_id_fkey FOREIGN KEY (athlete_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table athlete_notes add constraint athlete_notes_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table athletes add constraint athletes_athlete_user_id_fkey FOREIGN KEY (athlete_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table athletes add constraint athletes_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table calendar_events add constraint calendar_events_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table calendar_events add constraint calendar_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table calendar_events add constraint calendar_events_created_by_role_check CHECK ((created_by_role = ANY (ARRAY['coach'::text, 'athlete'::text])));
alter table calendar_events add constraint calendar_events_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table event_rsvps add constraint event_rsvps_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table event_rsvps add constraint event_rsvps_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;
alter table group_members add constraint group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
alter table group_members add constraint group_members_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table groups add constraint groups_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table injuries add constraint injuries_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table injuries add constraint injuries_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table messages add constraint messages_sender_role_check CHECK ((sender_role = ANY (ARRAY['coach'::text, 'athlete'::text])));
alter table messages add constraint messages_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table messages add constraint messages_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table messages add constraint messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table notes add constraint notes_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table notes add constraint notes_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
alter table notes add constraint notes_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table profiles add constraint profiles_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table profiles add constraint profiles_role_check CHECK ((role = ANY (ARRAY['coach'::text, 'athlete'::text])));
alter table push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table session_attachments add constraint session_attachments_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table session_attachments add constraint session_attachments_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id);
alter table session_videos add constraint session_videos_belongs_somewhere CHECK (((session_id IS NOT NULL) OR (athlete_id IS NOT NULL)));
alter table session_videos add constraint session_videos_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table session_videos add constraint session_videos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table session_videos add constraint session_videos_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table sessions add constraint sessions_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table sessions add constraint sessions_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table sessions add constraint sessions_audio_path_owned CHECK (((audio_path IS NULL) OR ((audio_path ~~ (('coach/'::text || (coach_id)::text) || '/%'::text)) AND (POSITION(('..'::text) IN (audio_path)) = 0))));
alter table sessions add constraint sessions_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;
alter table video_clips add constraint video_clips_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table video_clips add constraint video_clips_video_id_fkey FOREIGN KEY (video_id) REFERENCES session_videos(id) ON DELETE CASCADE;
alter table video_clips add constraint video_clips_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table wellness_checkins add constraint wellness_checkins_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table wellness_checkins add constraint wellness_checkins_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES auth.users(id);
alter table wellness_checkins add constraint wellness_checkins_session_event_id_fkey FOREIGN KEY (session_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL;

CREATE INDEX athletes_coach_id_idx ON public.athletes USING btree (coach_id);
CREATE INDEX athletes_athlete_user_id_idx ON public.athletes USING btree (athlete_user_id);
CREATE UNIQUE INDEX calendar_events_session_id_key ON public.calendar_events USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE UNIQUE INDEX profiles_invite_code_unique ON public.profiles USING btree (invite_code) WHERE (invite_code IS NOT NULL);
CREATE INDEX sessions_coach_id_idx ON public.sessions USING btree (coach_id);
CREATE INDEX messages_coach_athlete_idx ON public.messages USING btree (coach_id, athlete_id, created_at DESC);

alter table public.access_log enable row level security;
alter table public.athlete_caretakers enable row level security;
alter table public.athlete_notes enable row level security;
alter table public.athletes enable row level security;
alter table public.calendar_events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.group_members enable row level security;
alter table public.groups enable row level security;
alter table public.injuries enable row level security;
alter table public.messages enable row level security;
alter table public.notes enable row level security;
alter table public.profiles enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.session_attachments enable row level security;
alter table public.session_videos enable row level security;
alter table public.sessions enable row level security;
alter table public.video_clips enable row level security;
alter table public.wellness_checkins enable row level security;

CREATE OR REPLACE FUNCTION public.guard_athlete_link()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare
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
$function$;

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare
  is_client boolean := current_user in ('authenticated', 'anon');
begin
  if not is_client then
    return new;
  end if;
  if tg_op = 'INSERT' then
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
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, role, coach_id)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'role', 'coach'),
    CASE WHEN new.raw_user_meta_data->>'coach_id' IS NOT NULL THEN (new.raw_user_meta_data->>'coach_id')::uuid ELSE NULL END)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$function$;

CREATE TRIGGER athletes_guard_link BEFORE INSERT OR UPDATE ON public.athletes FOR EACH ROW EXECUTE FUNCTION guard_athlete_link();
CREATE TRIGGER profiles_guard_privileged_columns BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_privileged_columns();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

create policy "access_log: coach read own" on public.access_log as PERMISSIVE for SELECT to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)));
create policy "caretakers: coach manages" on public.athlete_caretakers as PERMISSIVE for ALL to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check (((coach_id = ( SELECT auth.uid() AS uid)) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid))))));
create policy "athlete_notes: owner full access" on public.athlete_notes as PERMISSIVE for ALL to authenticated using ((( SELECT auth.uid() AS uid) = athlete_user_id)) with check ((( SELECT auth.uid() AS uid) = athlete_user_id));
create policy "athletes: athlete can read own" on public.athletes as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = athlete_user_id));
create policy "athletes: coach can manage own" on public.athletes as PERMISSIVE for ALL to authenticated using ((( SELECT auth.uid() AS uid) = coach_id)) with check ((( SELECT auth.uid() AS uid) = coach_id));
create policy "cal: athlete manages own events" on public.calendar_events as PERMISSIVE for ALL to authenticated using (((created_by_role = 'athlete'::text) AND (created_by_user_id = ( SELECT auth.uid() AS uid)))) with check (((created_by_role = 'athlete'::text) AND (created_by_user_id = ( SELECT auth.uid() AS uid)) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))));
create policy "cal: athlete sees coach events" on public.calendar_events as PERMISSIVE for SELECT to authenticated using (((created_by_role = 'coach'::text) AND visible_to_athlete AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))));
create policy "cal: coach manages own athlete events" on public.calendar_events as PERMISSIVE for ALL to authenticated using (((created_by_role = 'coach'::text) AND (created_by_user_id = ( SELECT auth.uid() AS uid)) AND ((athlete_id IS NULL) OR (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid))))))) with check (((created_by_role = 'coach'::text) AND (created_by_user_id = ( SELECT auth.uid() AS uid)) AND ((athlete_id IS NULL) OR (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid)))))));
create policy "rsvps: athlete manages" on public.event_rsvps as PERMISSIVE for ALL to authenticated using ((athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))) with check ((athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid)))));
create policy "rsvps: coach reads" on public.event_rsvps as PERMISSIVE for SELECT to authenticated using ((event_id IN ( SELECT calendar_events.id FROM calendar_events WHERE (calendar_events.created_by_user_id = ( SELECT auth.uid() AS uid)))));
create policy "group_members: coach full access" on public.group_members as PERMISSIVE for ALL to authenticated using ((group_id IN ( SELECT groups.id FROM groups WHERE (groups.coach_id = ( SELECT auth.uid() AS uid))))) with check (((group_id IN ( SELECT groups.id FROM groups WHERE (groups.coach_id = ( SELECT auth.uid() AS uid)))) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid))))));
create policy "groups: coach full access" on public.groups as PERMISSIVE for ALL to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check ((coach_id = ( SELECT auth.uid() AS uid)));
create policy "injuries: athlete read own" on public.injuries as PERMISSIVE for SELECT to authenticated using ((athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid)))));
create policy "injuries: coach full access" on public.injuries as PERMISSIVE for ALL to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check (((coach_id = ( SELECT auth.uid() AS uid)) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid))))));
create policy "messages: athlete marks read" on public.messages as PERMISSIVE for UPDATE to authenticated using (((sender_role = 'coach'::text) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid)))))) with check (((sender_role = 'coach'::text) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))));
create policy "messages: athlete read" on public.messages as PERMISSIVE for SELECT to authenticated using ((athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid)))));
create policy "messages: athlete send" on public.messages as PERMISSIVE for INSERT to authenticated with check (((sender_id = ( SELECT auth.uid() AS uid)) AND (sender_role = 'athlete'::text) AND (EXISTS ( SELECT 1 FROM athletes a WHERE ((a.id = messages.athlete_id) AND (a.athlete_user_id = ( SELECT auth.uid() AS uid)) AND (a.coach_id = messages.coach_id))))));
create policy "messages: coach marks read" on public.messages as PERMISSIVE for UPDATE to authenticated using (((coach_id = ( SELECT auth.uid() AS uid)) AND (sender_role = 'athlete'::text))) with check (((coach_id = ( SELECT auth.uid() AS uid)) AND (sender_role = 'athlete'::text) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid))))));
create policy "messages: coach read" on public.messages as PERMISSIVE for SELECT to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)));
create policy "messages: coach send" on public.messages as PERMISSIVE for INSERT to authenticated with check (((coach_id = ( SELECT auth.uid() AS uid)) AND (sender_id = ( SELECT auth.uid() AS uid)) AND (sender_role = 'coach'::text) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid))))));
create policy "notes: athlete can read shared" on public.notes as PERMISSIVE for SELECT to authenticated using (((shared_with_athlete = true) AND (EXISTS ( SELECT 1 FROM athletes a WHERE ((a.id = notes.athlete_id) AND (a.athlete_user_id = ( SELECT auth.uid() AS uid)))))));
create policy "notes: coach can manage own" on public.notes as PERMISSIVE for ALL to authenticated using ((( SELECT auth.uid() AS uid) = coach_id)) with check (((( SELECT auth.uid() AS uid) = coach_id) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid)))) AND ((session_id IS NULL) OR (session_id IN ( SELECT sessions.id FROM sessions WHERE (sessions.coach_id = ( SELECT auth.uid() AS uid)))))));
create policy "profiles: auth admin can read for token hook" on public.profiles as PERMISSIVE for SELECT to supabase_auth_admin using (true);
create policy "profiles: coach can read their athletes" on public.profiles as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = coach_id));
create policy "profiles: user can read own" on public.profiles as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = id));
create policy "profiles: user can update own" on public.profiles as PERMISSIVE for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = id)) with check ((( SELECT auth.uid() AS uid) = id));
create policy "push_subscriptions: delete own" on public.push_subscriptions as PERMISSIVE for DELETE to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "push_subscriptions: read own" on public.push_subscriptions as PERMISSIVE for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "attachments: athlete sees shared" on public.session_attachments as PERMISSIVE for SELECT to authenticated using ((session_id IN ( SELECT s.id FROM sessions s WHERE (s.shared_with_athlete AND (s.athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))))));
create policy "attachments: coach manages own" on public.session_attachments as PERMISSIVE for ALL to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check (((coach_id = ( SELECT auth.uid() AS uid)) AND (session_id IN ( SELECT sessions.id FROM sessions WHERE (sessions.coach_id = ( SELECT auth.uid() AS uid)))) AND (storage_path ~~ (((('attachments/'::text || (( SELECT auth.uid() AS uid))::text) || '/'::text) || (session_id)::text) || '/%'::text))));
create policy "videos: athlete reads own uploads" on public.session_videos as PERMISSIVE for SELECT to authenticated using (((uploaded_by_role = 'athlete'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid)) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))));
create policy "videos: athlete sees shared session videos" on public.session_videos as PERMISSIVE for SELECT to authenticated using (((shared_with_athlete = true) AND (session_id IN ( SELECT sessions.id FROM sessions WHERE (sessions.athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))))));
create policy "videos: coach manages own session videos" on public.session_videos as PERMISSIVE for ALL to authenticated using ((session_id IN ( SELECT sessions.id FROM sessions WHERE (sessions.coach_id = ( SELECT auth.uid() AS uid))))) with check (((session_id IN ( SELECT sessions.id FROM sessions WHERE (sessions.coach_id = ( SELECT auth.uid() AS uid)))) AND (storage_path ~~ ((((( SELECT auth.uid() AS uid))::text || '/'::text) || (session_id)::text) || '/%'::text))));
create policy "videos: coach reads own athletes clips" on public.session_videos as PERMISSIVE for SELECT to authenticated using ((athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid)))));
create policy "athlete can read shared sessions" on public.sessions as PERMISSIVE for SELECT to authenticated using (((shared_with_athlete = true) AND (group_id IS NULL) AND (shared_recording_id IS NULL) AND (EXISTS ( SELECT 1 FROM athletes a WHERE ((a.id = sessions.athlete_id) AND (a.athlete_user_id = ( SELECT auth.uid() AS uid)))))));
create policy coach_delete_own_sessions on public.sessions as PERMISSIVE for DELETE to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)));
create policy coach_insert_own_sessions on public.sessions as PERMISSIVE for INSERT to authenticated with check (((coach_id = ( SELECT auth.uid() AS uid)) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid)))) AND ((group_id IS NULL) OR (group_id IN ( SELECT groups.id FROM groups WHERE (groups.coach_id = ( SELECT auth.uid() AS uid))))) AND ((audio_path IS NULL) OR (audio_path ~~ (('coach/'::text || (( SELECT auth.uid() AS uid))::text) || '/%'::text)))));
create policy coach_select_own_sessions on public.sessions as PERMISSIVE for SELECT to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)));
create policy coach_update_own_sessions on public.sessions as PERMISSIVE for UPDATE to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check (((coach_id = ( SELECT auth.uid() AS uid)) AND (athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.coach_id = ( SELECT auth.uid() AS uid)))) AND ((group_id IS NULL) OR (group_id IN ( SELECT groups.id FROM groups WHERE (groups.coach_id = ( SELECT auth.uid() AS uid))))) AND ((audio_path IS NULL) OR (audio_path ~~ (('coach/'::text || (( SELECT auth.uid() AS uid))::text) || '/%'::text)))));
create policy "clips: athlete reads shared moments" on public.video_clips as PERMISSIVE for SELECT to authenticated using (((session_id IN ( SELECT s.id FROM sessions s WHERE ((s.shared_with_athlete = true) AND (s.athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))))) AND (video_id IN ( SELECT v.id FROM session_videos v WHERE (v.shared_with_athlete = true)))));
create policy "clips: coach manages own session clips" on public.video_clips as PERMISSIVE for ALL to authenticated using ((session_id IN ( SELECT sessions.id FROM sessions WHERE (sessions.coach_id = ( SELECT auth.uid() AS uid))))) with check ((session_id IN ( SELECT sessions.id FROM sessions WHERE (sessions.coach_id = ( SELECT auth.uid() AS uid)))));
create policy "wellness: athlete manage" on public.wellness_checkins as PERMISSIVE for ALL to authenticated using ((athlete_id IN ( SELECT athletes.id FROM athletes WHERE (athletes.athlete_user_id = ( SELECT auth.uid() AS uid))))) with check ((EXISTS ( SELECT 1 FROM athletes a WHERE ((a.id = wellness_checkins.athlete_id) AND (a.athlete_user_id = ( SELECT auth.uid() AS uid)) AND (a.coach_id = wellness_checkins.coach_id)))));
create policy "wellness: coach read" on public.wellness_checkins as PERMISSIVE for SELECT to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)));

grant all on all tables in schema public to anon, authenticated, service_role;
revoke update, delete on public.messages from authenticated, anon;
grant update (read_at) on public.messages to authenticated;
