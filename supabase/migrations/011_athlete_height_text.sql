-- Migration 011: Add height (text) column to athletes table
-- Allows flexible height format like "6'2\"" or "188cm"
-- Keeps existing height_cm numeric column for backwards compatibility.

ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS height TEXT;
