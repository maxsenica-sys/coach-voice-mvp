-- 019_session_detail_fields.sql
--
-- Backs the new session detail page (/sessions/[id]).
--
-- Until now a session was only ever an accordion row inside the athlete page:
-- clicking one took you to the athlete, not the session, and there was nowhere
-- to add anything to a session after recording it. These columns give a session
-- somewhere to grow — the coach's own written notes, the points to carry into
-- next time, and images (whiteboard shots, stills, drill diagrams).

-- Free-form notes the coach types after the fact, alongside the AI summary.
alter table public.sessions
  add column if not exists coach_notes text;

-- "Things to think about" — short strings, ordered, shown as a checklist.
-- jsonb rather than a child table: they are always read and written with the
-- session, never queried independently.
alter table public.sessions
  add column if not exists focus_points jsonb not null default '[]'::jsonb;

comment on column public.sessions.focus_points is
  'Ordered array of short strings — what the athlete should carry into the next session.';

-- ── Images attached to a session ─────────────────────────────────────────────
-- Files live in the existing private `session-videos` bucket under an
-- attachments/ prefix; no new bucket needed.
create table if not exists public.session_attachments (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  coach_id     uuid not null references auth.users(id),
  storage_path text not null,
  file_name    text,
  mime_type    text,
  caption      text,
  created_at   timestamptz not null default now()
);

create index if not exists session_attachments_session_idx
  on public.session_attachments (session_id);
create index if not exists session_attachments_coach_idx
  on public.session_attachments (coach_id);

alter table public.session_attachments enable row level security;

-- Same shape as the session_videos policies: the owning coach manages them, and
-- the athlete sees them only once the parent session is shared.
drop policy if exists "attachments: coach manages own" on public.session_attachments;
create policy "attachments: coach manages own" on public.session_attachments
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

drop policy if exists "attachments: athlete sees shared" on public.session_attachments;
create policy "attachments: athlete sees shared" on public.session_attachments
  for select to authenticated
  using (
    session_id in (
      select s.id from public.sessions s
      where s.shared_with_athlete
        and s.athlete_id in (
          select id from public.athletes where athlete_user_id = (select auth.uid())
        )
    )
  );
