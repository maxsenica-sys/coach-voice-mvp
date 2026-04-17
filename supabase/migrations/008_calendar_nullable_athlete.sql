-- Migration 008: Ensure calendar_events.athlete_id is nullable (coach personal events)
-- Safe to run even if migration 005 has already been applied.
-- Run this in: Supabase Dashboard > SQL Editor

-- 1. Allow athlete_id to be NULL (coach personal events have no athlete)
ALTER TABLE calendar_events ALTER COLUMN athlete_id DROP NOT NULL;

-- 2. Recreate coach RLS policy to allow personal events (athlete_id IS NULL)
DROP POLICY IF EXISTS "cal: coach manages own athlete events" ON calendar_events;

CREATE POLICY "cal: coach manages own athlete events"
  ON calendar_events FOR ALL
  USING (
    created_by_role = 'coach'
    AND created_by_user_id = auth.uid()
    AND (
      athlete_id IS NULL
      OR athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())
    )
  )
  WITH CHECK (
    created_by_role = 'coach'
    AND created_by_user_id = auth.uid()
    AND (
      athlete_id IS NULL
      OR athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())
    )
  );
