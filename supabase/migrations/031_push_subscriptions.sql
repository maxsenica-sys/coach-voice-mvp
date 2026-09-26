-- 031_push_subscriptions.sql
--
-- Web Push: one row per device a person has turned notifications on for.
--
-- ── What is pushed ──────────────────────────────────────────────────────────
--
-- A new message, and a session shared with an athlete. Nothing else — the
-- weekly digest and the takeaway reminder stay in the app. A notification says
-- who it is from and never what they said; see lib/push.ts.
--
-- ── Who can write, who can read ─────────────────────────────────────────────
--
-- Inserts and updates come ONLY from app/api/push/subscribe, through the
-- service role, after the route has established the caller. There is
-- deliberately no insert or update policy. An endpoint belongs to a browser
-- install, not a person: when a second person signs in on the same phone and
-- turns notifications on, the row must move to them, or the first person's
-- notifications keep arriving on a device someone else is holding. RLS cannot
-- express that move (the row belongs to the other user), so the route does it
-- and always writes the caller's own id.
--
-- A user may SELECT and DELETE only their own rows. Sending reads the table
-- with the service role, and deletes a row when the push service answers 404
-- or 410 (the browser dropped the subscription).
--
-- Additive only. No existing table, column or policy is touched.

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique
                check (endpoint like 'https://%' and length(endpoint) <= 1024),
  p256dh        text not null check (length(p256dh) <= 200),
  auth          text not null check (length(auth) <= 200),
  user_agent    text check (user_agent is null or length(user_agent) <= 300),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

comment on table public.push_subscriptions is
  'Web Push subscriptions, one per device. Written only by /api/push/subscribe via the service role after auth; a user may read and delete only their own. Payloads never carry message or session content — see lib/push.ts.';

-- "Every device this person has": the send path and the per-user cap.
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions: read own" on public.push_subscriptions;
create policy "push_subscriptions: read own"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions: delete own" on public.push_subscriptions;
create policy "push_subscriptions: delete own"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = (select auth.uid()));
