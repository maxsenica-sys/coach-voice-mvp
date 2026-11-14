-- 036_session_delivery.sql
--
-- Whether a session was coached in person or online.
--
-- Max, 2026-11-14: "some option to say whether it was done online or in person,
-- I think would be important. But the selection shouldn't take up a lot of
-- space." The recorder asks with a two-way switch; this is where the answer
-- lives.
--
-- ── Shape ──────────────────────────────────────────────────────────────────
--
--   delivery  'in_person' | 'online' | null
--
-- Null means "not recorded": every session saved before this migration, and
-- any client that does not send the field (an older app still open on a phone,
-- a recording queued offline before the update). It is never back-filled to
-- 'in_person' — that would be a guess written down as a fact.
--
-- ── Who can see and write it ──────────────────────────────────────────────
--
-- A column on public.sessions, so every existing row policy covers it
-- unchanged: whoever may read or write a session row may read or write this.
-- No new policy, no new grant. supabase/tests/036_session_delivery.test.sql
-- holds that, and holds the check constraint.

alter table public.sessions
  add column if not exists delivery text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_delivery_check'
  ) then
    alter table public.sessions
      add constraint sessions_delivery_check check (delivery is null or delivery in ('in_person', 'online'));
  end if;
end $$;

comment on column public.sessions.delivery is
  'How the session was coached: in_person or online. Null = not recorded (sessions before 036, older clients).';
