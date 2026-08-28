-- Migration 014: Remove duplicate RLS policies, add missing FK indexes.
--
-- Background: athletes, notes, profiles, and sessions each ended up with two
-- policies covering the exact same command with the exact same predicate
-- (just reordered, e.g. `coach_id = auth.uid()` vs `auth.uid() = coach_id`)
-- and two different naming conventions ("table: description" vs
-- table_verb_own). This wasn't caught by any tracked migration because these
-- four tables' RLS was set up before this repo tracked migrations at all —
-- see .claude/MEMORY.md for the full history. Harmless for correctness
-- (Postgres just OR's duplicate permissive policies together) but it's
-- exactly the kind of drift that makes the next schema edit error-prone:
-- editing one copy and not realizing its twin still exists. This migration
-- keeps the "table: description" style (matches the convention already used
-- for calendar_events/athlete_notes/session_videos in migration 003) and
-- drops the redundant twin.
--
-- Also adds indexes for every foreign key that didn't have one (Supabase
-- performance advisor: unindexed_foreign_keys) — purely additive, no
-- behavior change.

-- ── athletes ──
DROP POLICY IF EXISTS "coaches_manage_own_athletes" ON athletes;
DROP POLICY IF EXISTS "athletes_view_self" ON athletes;

-- ── notes ──
DROP POLICY IF EXISTS "coaches_manage_notes_for_their_athletes" ON notes;
DROP POLICY IF EXISTS "athletes_view_shared_notes" ON notes;

-- ── profiles ──
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

-- ── sessions ──
DROP POLICY IF EXISTS "athlete_select_shared_sessions" ON sessions;

-- ── Missing FK indexes ──
CREATE INDEX IF NOT EXISTS athlete_caretakers_coach_id_idx ON athlete_caretakers (coach_id);
CREATE INDEX IF NOT EXISTS athletes_athlete_user_id_idx    ON athletes (athlete_user_id);
CREATE INDEX IF NOT EXISTS athletes_coach_id_idx            ON athletes (coach_id);
CREATE INDEX IF NOT EXISTS calendar_events_created_by_idx   ON calendar_events (created_by_user_id);
CREATE INDEX IF NOT EXISTS messages_athlete_id_idx          ON messages (athlete_id);
CREATE INDEX IF NOT EXISTS messages_sender_id_idx           ON messages (sender_id);
CREATE INDEX IF NOT EXISTS notes_athlete_id_idx              ON notes (athlete_id);
CREATE INDEX IF NOT EXISTS notes_coach_id_idx                ON notes (coach_id);
CREATE INDEX IF NOT EXISTS notes_session_id_idx              ON notes (session_id);
CREATE INDEX IF NOT EXISTS profiles_coach_id_idx             ON profiles (coach_id);
CREATE INDEX IF NOT EXISTS session_videos_uploaded_by_idx    ON session_videos (uploaded_by);
CREATE INDEX IF NOT EXISTS sessions_athlete_id_idx           ON sessions (athlete_id);
CREATE INDEX IF NOT EXISTS sessions_coach_id_idx             ON sessions (coach_id);
CREATE INDEX IF NOT EXISTS wellness_checkins_coach_id_idx    ON wellness_checkins (coach_id);
