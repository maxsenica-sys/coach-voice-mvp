-- Migration 012: Add audio storage + title alias fields to sessions table.
-- Resolves the session_name vs title dual-naming inconsistency and adds
-- audio storage columns needed by /api/sessions/audio/route.ts.
-- Run in: Supabase Dashboard > SQL Editor
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title      TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS audio_path TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS audio_mime TEXT;

-- Backfill title from session_name for any existing rows that have a name
UPDATE sessions SET title = session_name WHERE title IS NULL AND session_name IS NOT NULL;
