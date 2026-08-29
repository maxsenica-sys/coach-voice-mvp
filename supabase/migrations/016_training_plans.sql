-- Migration 016: Training plan file uploads.
-- A coach uploads an existing plan file (PDF, image, doc — whatever they
-- already made in Word/Excel/Notion/etc) from their phone or computer and
-- attaches it to an athlete. Deliberately file-based, not a structured
-- workout/plan builder — matches how coaches already produce plans instead
-- of asking them to re-author one in a new UI.

CREATE TABLE IF NOT EXISTS training_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id   uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  title        text NOT NULL,
  storage_path text NOT NULL,
  file_name    text,
  mime_type    text,
  file_size    bigint,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_plans_athlete_idx ON training_plans (athlete_id);
CREATE INDEX IF NOT EXISTS training_plans_coach_idx   ON training_plans (coach_id);

ALTER TABLE training_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_plans: coach manages own"  ON training_plans;
DROP POLICY IF EXISTS "training_plans: athlete views own"   ON training_plans;

CREATE POLICY "training_plans: coach manages own"
  ON training_plans FOR ALL
  USING     (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());

CREATE POLICY "training_plans: athlete views own"
  ON training_plans FOR SELECT
  USING (athlete_id IN (SELECT id FROM athletes WHERE athlete_user_id = auth.uid()));

-- Storage bucket for plan files (private; access brokered via signed URLs
-- from the service-role client, same as session-audio/session-videos/athlete-photos).
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-plans', 'training-plans', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "coach_upload_training_plan"       ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_training_plan" ON storage.objects;

CREATE POLICY "coach_upload_training_plan"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'training-plans');

CREATE POLICY "authenticated_read_training_plan"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'training-plans');
