-- 023_sessions_group_id.sql
--
-- Tells a squad session apart from an individual one.
--
-- ── The problem this exists to fix ───────────────────────────────────────
--
-- A group recording is saved as one row per member: `QuickSessionModal` fans
-- the save out across `group.member_ids`, and every one of those rows carries
-- the *same* transcript — the coach's whole talk to the whole squad.
--
-- The athlete app then selects that transcript and renders it under "View full
-- transcript". So if a coach says "Ellie, that block was lazy, you switched
-- off", every other child in that squad can read that sentence about Ellie.
-- Not in theory: today, in production.
--
-- Nothing in the schema could distinguish the two cases, so nothing could
-- suppress it. The only marker was a `[Squad name] ` prefix the modal writes
-- into `session_name`, which is display text a coach can edit.
--
-- ── What this does, and deliberately does not, do ────────────────────────
--
-- It adds the flag. The suppression is in the application: the athlete's
-- client no longer selects `transcript` at all, and the one route that can
-- serve it withholds it from an athlete viewer when `group_id` is set. That
-- ordering matters — a column the browser can query is readable regardless of
-- what the UI chooses to draw.
--
-- It does NOT backfill. Existing squad sessions cannot be identified after the
-- fact with any confidence: the name prefix is editable, and guessing wrong in
-- either direction is worse than leaving them alone. What protects those rows
-- is the same change from the other end — the athlete client stops selecting
-- transcripts full stop, so historic squad sessions stop leaking too, even
-- though this column is null for them.
--
-- Nullable, and null means "not known to be a group session".

alter table public.sessions
  add column if not exists group_id uuid references public.groups(id) on delete set null;

comment on column public.sessions.group_id is
  'The squad this session was recorded for, when it was a group recording. Null for an individual session, and also null for group sessions saved before this column existed. When set, the transcript is never served to an athlete viewer: it is the coach talking to the whole squad and may name other children.';

-- "Every session for this squad" is the query this enables; without the index
-- it is a full scan of the coach's sessions.
create index if not exists sessions_group_id_idx
  on public.sessions (group_id)
  where group_id is not null;
