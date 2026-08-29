-- Migration 015: Let caretakers opt in/out of wellness alert emails,
-- separately from session/monthly report notifications.
ALTER TABLE athlete_caretakers ADD COLUMN IF NOT EXISTS notify_wellness_alerts boolean DEFAULT true;
