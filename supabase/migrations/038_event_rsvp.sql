-- 038_event_rsvp.sql
--
-- RSVPs to a coach's calendar event, made reachable.
--
-- The schema has had calendar_events.rsvp_enabled and public.event_rsvps since
-- early on, and the athlete portal had a list of "events needing your
-- response", but nothing ever set rsvp_enabled, so the list was always empty.
-- From 2026-11-14 a coach can ask for an RSVP when adding an event for an
-- athlete or a squad, the athlete answers Going or Can't make it, and the
-- coach sees who said what. These are the rules that answer may live under.
--
-- ── What changes ───────────────────────────────────────────────────────────
--
-- 1. "rsvps: athlete manages" let an athlete write an RSVP row for ANY event
--    id, as long as the athlete_id was their own. Now the event must be a
--    coach's event, on that same athlete's calendar, visible to them, with an
--    RSVP asked for. An athlete cannot answer an event they cannot see, or one
--    that never asked, or move their answer onto someone else's event.
--
-- 2. "rsvps: coach reads" let only the coach who CREATED the event read its
--    answers. So a head coach could not see the answers to an event an
--    assistant added, and an assistant's read was tied to authorship rather
--    than to the athletes they were given. Now a coach reads the RSVPs of the
--    athletes they may see: their own roster, or for an assistant exactly the
--    athletes their head ticked (private.my_athlete_ids, migration 035).
--
-- 3. status is held to the four values the route has always accepted. NOT
--    VALID: rows already written are not re-judged (the route only ever wrote
--    these four), only new and updated ones are checked.
--
-- Coaches still never write an RSVP: it is the athlete's answer.
-- supabase/tests/038_event_rsvp.test.sql holds every case.

drop policy if exists "rsvps: athlete manages" on public.event_rsvps;
create policy "rsvps: athlete manages" on public.event_rsvps
  for all to authenticated
  using (athlete_id in (select a.id from public.athletes a where a.athlete_user_id = (select auth.uid())))
  with check (
    athlete_id in (select a.id from public.athletes a where a.athlete_user_id = (select auth.uid()))
    and exists (
      select 1 from public.calendar_events e
       where e.id = event_rsvps.event_id
         and e.athlete_id = event_rsvps.athlete_id
         and e.created_by_role = 'coach'
         and e.visible_to_athlete
         and e.rsvp_enabled
    )
  );

drop policy if exists "rsvps: coach reads" on public.event_rsvps;
create policy "rsvps: coach reads" on public.event_rsvps
  for select to authenticated
  using (athlete_id in (select private.my_athlete_ids()));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_rsvps_status_check') then
    alter table public.event_rsvps
      add constraint event_rsvps_status_check check (status in ('pending', 'yes', 'no', 'maybe')) not valid;
  end if;
end $$;
