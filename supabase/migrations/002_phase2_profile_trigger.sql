-- =============================================================
-- Phase 2: Auto-create profiles row when a new auth user is created
-- Run this in: Supabase Dashboard > SQL Editor
-- =============================================================

-- Trigger function: fires AFTER INSERT on auth.users
-- Reads optional metadata fields 'role' and 'coach_id' set by inviteUserByEmail.
-- Self-signups get role='coach' and no coach_id.
-- Athlete invites pass role='athlete' and coach_id=<coach uuid> via user metadata.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, coach_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'role', 'coach'),
    CASE
      WHEN new.raw_user_meta_data->>'coach_id' IS NOT NULL
      THEN (new.raw_user_meta_data->>'coach_id')::uuid
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- Drop and recreate trigger to ensure it uses the latest function body
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
