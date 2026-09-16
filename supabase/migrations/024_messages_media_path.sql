-- 024 — Store where the media IS, not a link that stops working.
--
-- `messages.media_url` held a signed URL minted in the browser with a one-hour
-- TTL. An hour after sending, every image, video and voice note in a thread was
-- a dead link for both people — and because the object's PATH was never stored
-- anywhere, nothing could re-sign it and no sweep could ever identify the
-- orphan. The file stayed on the bill forever and the message stayed broken
-- forever. The bug was invisible in testing because it needs an hour to appear.
--
-- The path is the durable identifier. URLs are derived from it at read time in
-- app/api/messages/route.ts, fresh on every request, which is the only shape
-- where a link cannot expire inside a conversation.
--
-- ── No backfill is possible, and that is not an oversight ──────────────────
--
-- A signed URL does not contain enough information to reconstruct its own
-- storage path: the object key is inside a signed token, not the query string.
-- Existing `media_url` rows are already long dead, so there is nothing to
-- recover even in principle. The column is kept, not dropped, so historic rows
-- still render whatever they can and so the read path can tell a legacy row
-- from a new one. New writes never touch it.
--
-- Pre-dating this migration, media messages could not be sent AT ALL — the
-- messages-media bucket had no storage policy and RLS denied every upload (see
-- migration 023). So the population of affected rows is small by construction.

alter table public.messages
  add column if not exists media_path text;

comment on column public.messages.media_path is
  'Storage object path inside the messages-media bucket, e.g. `<auth.uid()>/<athlete_id>/<ts>.<ext>`. The API signs this on read. Never store a URL here.';

comment on column public.messages.media_url is
  'LEGACY. Held an expiring signed URL written by the browser before 024. Dead for every existing row and never written again — new media uses media_path. Kept so historic rows are distinguishable rather than silently blank.';

-- Reading one conversation newest-first is the only query this table serves,
-- and it had no index for it: the API orders by created_at within an athlete_id
-- and takes 300. Without this, that is a scan of every message the pair has
-- ever exchanged, growing linearly forever.
create index if not exists messages_athlete_created_idx
  on public.messages (athlete_id, created_at desc);

-- The unread badge polls `sender_role` + `read_at is null` per athlete. Partial,
-- because the rows that matter are the unread ones and they are a small and
-- self-limiting fraction of the table.
create index if not exists messages_unread_idx
  on public.messages (athlete_id, sender_role)
  where read_at is null;
