-- Phase 4: Groups / Squads
-- Run this in: Supabase Dashboard > SQL Editor

-- 1. Coach groups (squads)

CREATE TABLE IF NOT EXISTS groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#2563eb',
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS groups_coach_idx ON groups (coach_id);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "groups: coach full access" ON groups;

CREATE POLICY "groups: coach full access"
  ON groups FOR ALL
  USING     (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());


-- 2. Group members (many-to-many: groups <-> athletes)

CREATE TABLE IF NOT EXISTS group_members (
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  added_at   timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, athlete_id)
);

CREATE INDEX IF NOT EXISTS group_members_group_idx   ON group_members (group_id);
CREATE INDEX IF NOT EXISTS group_members_athlete_idx ON group_members (athlete_id);

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_members: coach full access" ON group_members;

CREATE POLICY "group_members: coach full access"
  ON group_members FOR ALL
  USING (
    group_id IN (SELECT id FROM groups WHERE coach_id = auth.uid())
  )
  WITH CHECK (
    group_id IN (SELECT id FROM groups WHERE coach_id = auth.uid())
  );
