-- Phase 3: Full feature expansion
-- Run this in: Supabase Dashboard > SQL Editor

-- 1. Enrich profiles table

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name        text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name         text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sport             text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS position_or_event text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS experience_level  text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS coaching_level    text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS goals             text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS invite_code       text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_invite_code_unique
  ON profiles (invite_code)
  WHERE invite_code IS NOT NULL;


-- 2. athlete_notes (private notes by athletes, coaches cannot see these)

CREATE TABLE IF NOT EXISTS athlete_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id      uuid        REFERENCES sessions(id) ON DELETE CASCADE,
  content         text        NOT NULL,
  note_type       text        DEFAULT 'typed' CHECK (note_type IN ('typed', 'voice')),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS athlete_notes_user_idx    ON athlete_notes (athlete_user_id);
CREATE INDEX IF NOT EXISTS athlete_notes_session_idx ON athlete_notes (session_id);

ALTER TABLE athlete_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete_notes: owner full access" ON athlete_notes;

CREATE POLICY "athlete_notes: owner full access"
  ON athlete_notes FOR ALL
  USING     (auth.uid() = athlete_user_id)
  WITH CHECK (auth.uid() = athlete_user_id);


-- 3. calendar_events (dual-privacy: coaches add for athletes, athletes add privately)

CREATE TABLE IF NOT EXISTS calendar_events (
  id                 uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         uuid  NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_by_user_id uuid  REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_role    text  NOT NULL CHECK (created_by_role IN ('coach', 'athlete')),
  title              text  NOT NULL,
  description        text,
  event_type         text  DEFAULT 'session'
                           CHECK (event_type IN ('session','homework','goal','reminder','other')),
  event_date         date  NOT NULL,
  event_time         time,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cal_athlete_idx ON calendar_events (athlete_id);
CREATE INDEX IF NOT EXISTS cal_date_idx    ON calendar_events (event_date);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cal: coach manages own athlete events" ON calendar_events;
DROP POLICY IF EXISTS "cal: athlete sees coach events"        ON calendar_events;
DROP POLICY IF EXISTS "cal: athlete manages own events"       ON calendar_events;

CREATE POLICY "cal: coach manages own athlete events"
  ON calendar_events FOR ALL
  USING (
    created_by_role = 'coach'
    AND created_by_user_id = auth.uid()
  )
  WITH CHECK (
    created_by_role = 'coach'
    AND created_by_user_id = auth.uid()
    AND athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())
  );

CREATE POLICY "cal: athlete sees coach events"
  ON calendar_events FOR SELECT
  USING (
    created_by_role = 'coach'
    AND athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
  );

CREATE POLICY "cal: athlete manages own events"
  ON calendar_events FOR ALL
  USING (
    created_by_role = 'athlete'
    AND created_by_user_id = auth.uid()
  )
  WITH CHECK (
    created_by_role = 'athlete'
    AND created_by_user_id = auth.uid()
    AND athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
  );


-- 4. session_videos (video files stored in Supabase Storage bucket "session-videos")

CREATE TABLE IF NOT EXISTS session_videos (
  id           uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid  NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  storage_path text  NOT NULL,
  file_name    text,
  mime_type    text,
  uploaded_by  uuid  REFERENCES auth.users(id) ON DELETE SET NULL,
  annotations  jsonb DEFAULT '[]'::jsonb,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_videos_session_idx ON session_videos (session_id);

ALTER TABLE session_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "videos: coach manages own session videos"    ON session_videos;
DROP POLICY IF EXISTS "videos: athlete sees shared session videos"  ON session_videos;

CREATE POLICY "videos: coach manages own session videos"
  ON session_videos FOR ALL
  USING     (session_id IN (SELECT id FROM sessions WHERE coach_id = auth.uid()))
  WITH CHECK (session_id IN (SELECT id FROM sessions WHERE coach_id = auth.uid()));

CREATE POLICY "videos: athlete sees shared session videos"
  ON session_videos FOR SELECT
  USING (
    session_id IN (
      SELECT id FROM sessions
      WHERE shared_with_athlete = true
        AND athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
    )
  );


-- 5. Add sport_context to sessions

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sport_context text;
