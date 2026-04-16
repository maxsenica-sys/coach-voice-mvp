-- =============================================================
-- Phase 1: Add role + coach_id to profiles, set RLS policies
-- Run this in: Supabase Dashboard > SQL Editor
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Schema changes: profiles
-- ─────────────────────────────────────────────────────────────

-- Add role column: 'coach' or 'athlete', defaults to 'coach' for self-signups
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'coach'
  CHECK (role IN ('coach', 'athlete'));

-- Add coach_id: set when an athlete profile is created by a coach
-- Nullable: coaches have no coach_id (they ARE the coach)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS coach_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;


-- ─────────────────────────────────────────────────────────────
-- 2. RLS: profiles
-- ─────────────────────────────────────────────────────────────

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid name conflicts on re-run
DROP POLICY IF EXISTS "profiles: user can read own"           ON profiles;
DROP POLICY IF EXISTS "profiles: user can insert own"         ON profiles;
DROP POLICY IF EXISTS "profiles: user can update own"         ON profiles;
DROP POLICY IF EXISTS "profiles: coach can read their athletes" ON profiles;

-- Users can read their own profile row
CREATE POLICY "profiles: user can read own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can insert their own profile row (used on first login)
CREATE POLICY "profiles: user can insert own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can update their own profile row
CREATE POLICY "profiles: user can update own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Coaches can read profiles where coach_id = their user id
-- (needed to look up athletes' profile data)
CREATE POLICY "profiles: coach can read their athletes"
  ON profiles FOR SELECT
  USING (auth.uid() = coach_id);


-- ─────────────────────────────────────────────────────────────
-- 3. RLS: athletes
-- ─────────────────────────────────────────────────────────────

ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athletes: coach can manage own"    ON athletes;
DROP POLICY IF EXISTS "athletes: athlete can read own"    ON athletes;

-- Coaches can SELECT / INSERT / UPDATE / DELETE their own athlete rows
CREATE POLICY "athletes: coach can manage own"
  ON athletes FOR ALL
  USING (auth.uid() = coach_id)
  WITH CHECK (auth.uid() = coach_id);

-- Athletes can read their own record (to resolve their coach, etc.)
CREATE POLICY "athletes: athlete can read own"
  ON athletes FOR SELECT
  USING (auth.uid() = athlete_user_id);


-- ─────────────────────────────────────────────────────────────
-- 4. RLS: notes
-- ─────────────────────────────────────────────────────────────

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notes: coach can manage own"       ON notes;
DROP POLICY IF EXISTS "notes: athlete can read shared"    ON notes;

-- Coaches can manage notes they created
CREATE POLICY "notes: coach can manage own"
  ON notes FOR ALL
  USING (auth.uid() = coach_id)
  WITH CHECK (auth.uid() = coach_id);

-- Athletes can read notes that have been explicitly shared with them.
-- Joins via athletes table to map auth user -> athlete record -> note.
CREATE POLICY "notes: athlete can read shared"
  ON notes FOR SELECT
  USING (
    shared_with_athlete = true
    AND EXISTS (
      SELECT 1 FROM athletes
      WHERE athletes.id = notes.athlete_id
        AND athletes.athlete_user_id = auth.uid()
    )
  );
