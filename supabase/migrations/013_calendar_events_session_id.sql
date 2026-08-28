-- Migration 013: Link calendar_events to their originating session.
-- Lets us tell whether a calendar entry already exists for a given session
-- (avoids duplicate entries when a session is shared with the athlete after
-- it was first saved) instead of guessing from title/date matching.

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS cal_session_idx ON calendar_events (session_id);
