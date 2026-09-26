-- 032_video_clips.sql
--
-- Three video features Max approved on 2026-09-26:
--
--   1. A moment clipped onto a session's takeaway ("Watch the moment").
--   2. Two videos of one athlete compared side by side.        (no schema)
--   3. An athlete sending their coach a short clip.
--
-- Additive throughout. Every new column is nullable or has a default that is
-- true of every existing row, so nothing already stored changes meaning.
--
-- ── 1. video_clips — a moment is data, not a file ────────────────────────
--
-- (session, video, start, end, label). Nothing is re-encoded or copied: the
-- athlete's player opens the original video with the coach's drawings and
-- stops at end_s. The range limits are the ones lib/video-clip.ts enforces
-- (MAX_CLIP_SECONDS = 60); tools/video-rig.mjs reads this file and fails if
-- the two ever disagree.
--
-- `focus_point` is the TEXT of the takeaway the moment belongs to, not its
-- index. focus_points is a plain text[] the coach reorders and deletes from;
-- an index would silently re-attach the moment to whatever point moved into
-- its slot. If the takeaway is later edited away, the moment is not lost — the
-- session page lists it under the video instead of beside the takeaway.
--
-- ── 3. session_videos — the athlete's clip ───────────────────────────────
--
-- An athlete's clip is a session_videos row like any other, so the coach
-- annotates it with the same VideoAnnotator and "sends it back" with the same
-- shared_with_athlete flag. What is new:
--
--   uploaded_by_role  'coach' | 'athlete' — so both screens can label it.
--                     Default 'coach' is true of every existing row: until
--                     now only a coach route could insert.
--   athlete_id        whose clip it is. Set on every athlete upload; lets a
--                     clip exist with no session ("for my coach").
--   duration_s        as reported by the athlete's browser, checked ≤ 60s by
--                     the register route. Informational for coach uploads.
--   note              the athlete's line to the coach ("is my elbow dropping?").
--
-- session_id loses NOT NULL for the general clip, replaced by a CHECK that a
-- row still belongs to something: a session, or an athlete.
--
-- ── Storage: deliberately NO new storage.objects policy ──────────────────
--
-- The bucket stays private and nothing reads it directly. Uploads go through a
-- signed upload URL minted by app/api/athlete/clips/upload-url for the path
-- `${auth.uid()}/athlete/${athlete_id}/${ts}.${ext}`, and every read is a
-- signed URL minted by a route that has already applied the visibility rule
-- in lib/video-clip.ts. A signed URL does not consult storage policies, so a
-- policy here would grant nothing the app uses — only direct client access,
-- which is the excess migration 023 removed from athlete-photos.
--
-- ── Visibility (the RLS below mirrors lib/video-clip.ts athleteMayViewVideo)
--
-- An athlete sees a video only if it is their own upload, or the session is
-- theirs AND shared AND the video is shared. Squad and shared-recording
-- sessions are one row per athlete and a video hangs off one row, so this is
-- "shared to that athlete individually" — no rule reads group_id to widen it.

-- ── session_videos ─────────────────────────────────────────────────────────

alter table public.session_videos
  add column if not exists uploaded_by_role text not null default 'coach';

alter table public.session_videos
  drop constraint if exists session_videos_uploaded_by_role_check;
alter table public.session_videos
  add constraint session_videos_uploaded_by_role_check
  check (uploaded_by_role in ('coach', 'athlete'));

alter table public.session_videos
  add column if not exists athlete_id uuid references public.athletes(id) on delete cascade;

alter table public.session_videos
  add column if not exists duration_s numeric(8,2);

alter table public.session_videos
  add column if not exists note text;

alter table public.session_videos
  alter column session_id drop not null;

alter table public.session_videos
  drop constraint if exists session_videos_belongs_somewhere;
alter table public.session_videos
  add constraint session_videos_belongs_somewhere
  check (session_id is not null or athlete_id is not null);

-- An athlete's upload always says whose it is; that is what scopes it.
alter table public.session_videos
  drop constraint if exists session_videos_athlete_upload_named;
alter table public.session_videos
  add constraint session_videos_athlete_upload_named
  check (uploaded_by_role <> 'athlete' or (athlete_id is not null and uploaded_by is not null));

create index if not exists session_videos_athlete_id_idx
  on public.session_videos (athlete_id)
  where athlete_id is not null;

comment on column public.session_videos.uploaded_by_role is
  'coach | athlete. An athlete upload is visible to that athlete always, and its annotations only once shared_with_athlete is true (the coach sent it back).';
comment on column public.session_videos.athlete_id is
  'Set on athlete uploads. With session_id null, the clip was sent "for my coach" rather than about a session.';

-- The coach reads their athletes' clips, including ones with no session (the
-- existing coach policy is keyed on session_id and cannot see those).
drop policy if exists "videos: coach reads own athletes clips" on public.session_videos;
create policy "videos: coach reads own athletes clips" on public.session_videos
  for select to authenticated
  using (
    athlete_id in (select id from public.athletes where coach_id = (select auth.uid()))
  );

-- The athlete reads their own uploads.
drop policy if exists "videos: athlete reads own uploads" on public.session_videos;
create policy "videos: athlete reads own uploads" on public.session_videos
  for select to authenticated
  using (
    uploaded_by_role = 'athlete'
    and uploaded_by = (select auth.uid())
    and athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid()))
  );

-- ── video_clips ────────────────────────────────────────────────────────────

create table if not exists public.video_clips (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        not null references public.sessions(id) on delete cascade,
  video_id     uuid        not null references public.session_videos(id) on delete cascade,
  start_s      numeric(8,1) not null,
  end_s        numeric(8,1) not null,
  label        text,
  focus_point  text,
  created_by   uuid        references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint video_clips_range check (
    start_s >= 0
    and end_s > start_s
    and end_s - start_s <= 60
  )
);

create index if not exists video_clips_session_idx on public.video_clips (session_id);
create index if not exists video_clips_video_idx   on public.video_clips (video_id);
create index if not exists video_clips_created_by_idx on public.video_clips (created_by);

alter table public.video_clips enable row level security;

drop policy if exists "clips: coach manages own session clips" on public.video_clips;
create policy "clips: coach manages own session clips" on public.video_clips
  for all to authenticated
  using      (session_id in (select id from public.sessions where coach_id = (select auth.uid())))
  with check (session_id in (select id from public.sessions where coach_id = (select auth.uid())));

-- The athlete reads a moment only when they could read the video it cuts:
-- their own session, shared, and the video itself shared.
drop policy if exists "clips: athlete reads shared moments" on public.video_clips;
create policy "clips: athlete reads shared moments" on public.video_clips
  for select to authenticated
  using (
    session_id in (
      select s.id from public.sessions s
      where s.shared_with_athlete = true
        and s.athlete_id in (select id from public.athletes where athlete_user_id = (select auth.uid()))
    )
    and video_id in (select v.id from public.session_videos v where v.shared_with_athlete = true)
  );

comment on table public.video_clips is
  'A moment of a session video, attached to a takeaway. Data only — the player opens the original video at start_s and stops at end_s.';
