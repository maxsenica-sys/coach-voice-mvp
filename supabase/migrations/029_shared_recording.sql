-- 029_shared_recording.sql
--
-- One recording, several athletes.
--
-- Max, 2026-09-26: "I'd rather talk and include the athletes in one message and
-- then it can split from there." The recorder's "Several" mode does that: one
-- recording, split by /api/sessions/split-summary into one reviewed summary per
-- athlete, saved as one session row per athlete.
--
-- Every one of those rows carries the SAME transcript and audio — the coach
-- talking about all of them. So, exactly like a squad recording (migration 023,
-- group_id), the transcript must never reach the athlete: Kai must not read
-- what the coach said about Mia. Each athlete gets only their own summary.
--
-- This column is the flag that makes that possible. The same uuid goes on every
-- sibling row of one recording, and the detail route withholds the transcript
-- and audio from an athlete viewer whenever it is set. tools/safeguard-check.mjs
-- (SG6) holds that rule.
--
-- Additive and safe: a nullable column with no default, so existing rows are
-- untouched and null means "not a shared recording". No backfill — there are
-- no shared recordings before this migration. No foreign key: the id names a
-- recording, not a row in another table.

alter table public.sessions
  add column if not exists shared_recording_id uuid;

comment on column public.sessions.shared_recording_id is
  'Set on every session saved from one recording about several athletes; the same id on each sibling. When set, the transcript and audio are never served to an athlete viewer: they are the coach talking about every athlete in the recording.';

-- "The other sessions from this recording" is the query this enables.
create index if not exists sessions_shared_recording_id_idx
  on public.sessions (shared_recording_id)
  where shared_recording_id is not null;
