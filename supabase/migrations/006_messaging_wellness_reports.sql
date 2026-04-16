-- Migration 006: Messaging, Wellness Check-ins, Caretakers, RSVP, Video Sharing, Monthly Reports
-- Run in: Supabase Dashboard > SQL Editor

-- ─── 1. Messages ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id  uuid        NOT NULL REFERENCES athletes(id)   ON DELETE CASCADE,
  sender_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role text        NOT NULL CHECK (sender_role IN ('coach', 'athlete')),
  content     text,
  msg_type    text        NOT NULL DEFAULT 'text'
                          CHECK (msg_type IN ('text', 'image', 'video', 'audio')),
  media_url   text,
  media_name  text,
  read_at     timestamptz,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_coach_athlete_idx ON messages (coach_id, athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_unread_idx        ON messages (coach_id, athlete_id, read_at) WHERE read_at IS NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages: coach full access"  ON messages;
DROP POLICY IF EXISTS "messages: athlete access"     ON messages;

CREATE POLICY "messages: coach full access"
  ON messages FOR ALL
  USING     (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());

CREATE POLICY "messages: athlete access"
  ON messages FOR ALL
  USING (
    athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
  )
  WITH CHECK (
    sender_id = auth.uid()
    AND athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
  );


-- ─── 2. Wellness Check-ins ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wellness_checkins (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id  uuid  NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  coach_id    uuid  NOT NULL REFERENCES auth.users(id),
  check_date  date  NOT NULL DEFAULT CURRENT_DATE,
  energy      int   CHECK (energy  BETWEEN 1 AND 5),
  mood        int   CHECK (mood    BETWEEN 1 AND 5),
  sleep_q     int   CHECK (sleep_q BETWEEN 1 AND 5),
  soreness    int   CHECK (soreness BETWEEN 1 AND 5),
  stress      int   CHECK (stress  BETWEEN 1 AND 5),
  notes       text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (athlete_id, check_date)
);

CREATE INDEX IF NOT EXISTS wellness_athlete_date_idx ON wellness_checkins (athlete_id, check_date DESC);

ALTER TABLE wellness_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wellness: coach read"      ON wellness_checkins;
DROP POLICY IF EXISTS "wellness: athlete manage"  ON wellness_checkins;

CREATE POLICY "wellness: coach read"
  ON wellness_checkins FOR SELECT
  USING (coach_id = auth.uid());

CREATE POLICY "wellness: athlete manage"
  ON wellness_checkins FOR ALL
  USING (
    athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
  )
  WITH CHECK (
    athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
  );


-- ─── 3. Athlete Caretakers ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS athlete_caretakers (
  id                      uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id              uuid  NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  coach_id                uuid  NOT NULL REFERENCES auth.users(id),
  caretaker_name          text  NOT NULL,
  caretaker_email         text  NOT NULL,
  relationship            text  DEFAULT 'parent',
  notify_session_reports  bool  DEFAULT true,
  notify_monthly_reports  bool  DEFAULT true,
  created_at              timestamptz DEFAULT now(),
  UNIQUE (athlete_id, caretaker_email)
);

CREATE INDEX IF NOT EXISTS caretaker_athlete_idx ON athlete_caretakers (athlete_id);

ALTER TABLE athlete_caretakers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "caretakers: coach manages" ON athlete_caretakers;

CREATE POLICY "caretakers: coach manages"
  ON athlete_caretakers FOR ALL
  USING     (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());


-- ─── 4. Calendar RSVP ───────────────────────────────────────────────────────
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS rsvp_enabled bool DEFAULT false;

CREATE TABLE IF NOT EXISTS event_rsvps (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid  NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  athlete_id  uuid  NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  status      text  DEFAULT 'pending' CHECK (status IN ('pending', 'yes', 'no', 'maybe')),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (event_id, athlete_id)
);

CREATE INDEX IF NOT EXISTS rsvps_event_idx   ON event_rsvps (event_id);
CREATE INDEX IF NOT EXISTS rsvps_athlete_idx ON event_rsvps (athlete_id);

ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvps: coach reads"    ON event_rsvps;
DROP POLICY IF EXISTS "rsvps: athlete manages" ON event_rsvps;

CREATE POLICY "rsvps: coach reads"
  ON event_rsvps FOR SELECT
  USING (
    event_id IN (
      SELECT id FROM calendar_events WHERE created_by_user_id = auth.uid()
    )
  );

CREATE POLICY "rsvps: athlete manages"
  ON event_rsvps FOR ALL
  USING (
    athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
  )
  WITH CHECK (
    athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
  );


-- ─── 5. Video Analysis Sharing ───────────────────────────────────────────────
ALTER TABLE session_videos ADD COLUMN IF NOT EXISTS shared_with_athlete bool    DEFAULT false;
ALTER TABLE session_videos ADD COLUMN IF NOT EXISTS share_note          text;

-- Refresh athlete video access policy to use the new column
DROP POLICY IF EXISTS "videos: athlete sees shared session videos" ON session_videos;

CREATE POLICY "videos: athlete sees shared session videos"
  ON session_videos FOR SELECT
  USING (
    shared_with_athlete = true
    AND session_id IN (
      SELECT id FROM sessions
      WHERE athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid())
    )
  );


-- ─── 6. Monthly Report Toggle on Athletes ────────────────────────────────────
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS auto_monthly_report bool DEFAULT false;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS auto_report_day     int  DEFAULT 1;


-- ─── 7. Supabase Storage: create "messages-media" bucket manually ────────────
-- In Supabase dashboard > Storage, create a private bucket called "messages-media"
