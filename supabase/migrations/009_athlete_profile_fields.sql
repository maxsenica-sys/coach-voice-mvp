-- Migration 009: Athlete profile fields
-- Adds richer profile data to the athletes table:
--   photo_url, position, height_cm, sport_metrics (JSONB), goals, custom_fields (JSONB)
-- Run this in the Supabase SQL Editor.

ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS photo_url        TEXT,
  ADD COLUMN IF NOT EXISTS position         TEXT,
  ADD COLUMN IF NOT EXISTS height_cm        NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS sport_metrics    JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS goals            TEXT,
  ADD COLUMN IF NOT EXISTS custom_fields    JSONB DEFAULT '[]';

-- Create storage bucket for athlete profile photos (skip if already exists).
INSERT INTO storage.buckets (id, name, public)
VALUES ('athlete-photos', 'athlete-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Drop and recreate policies so this script is idempotent.
DROP POLICY IF EXISTS "coach_upload_athlete_photo" ON storage.objects;
DROP POLICY IF EXISTS "coach_read_athlete_photo"   ON storage.objects;

CREATE POLICY "coach_upload_athlete_photo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'athlete-photos');

CREATE POLICY "coach_read_athlete_photo"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'athlete-photos');
