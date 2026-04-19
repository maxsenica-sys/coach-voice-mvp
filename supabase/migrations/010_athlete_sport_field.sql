-- Migration 010: Add sport column to athletes table
-- Adds per-athlete sport field for sport-specific profile tracking.
-- Run this in the Supabase SQL Editor.

ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS sport TEXT;
