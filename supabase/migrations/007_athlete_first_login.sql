-- Migration 007: Track when an athlete first logs in
-- Run in: Supabase Dashboard > SQL Editor
--
-- WHY: generateLink() creates the auth user immediately at invite time,
-- so athlete_user_id is set even though the athlete hasn't logged in yet.
-- first_login_at is only set when the athlete visits their portal — that's
-- the real "ACTIVE" signal.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS first_login_at timestamptz;

-- Add update policy so athletes can set first_login_at on themselves
DROP POLICY IF EXISTS "athletes: athlete marks active" ON athletes;

CREATE POLICY "athletes: athlete marks active"
  ON athletes FOR UPDATE
  USING     (athlete_user_id = auth.uid())
  WITH CHECK (athlete_user_id = auth.uid());
