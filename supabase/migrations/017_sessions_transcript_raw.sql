-- Migration 017: Preserve the pristine Whisper transcript alongside the
-- coach-reviewed/edited one.
--
-- sessions.transcript keeps its existing meaning (the final text the coach
-- approved before saving — already editable in the review step, now
-- pre-filled with a grammar/punctuation-cleaned version instead of the raw
-- Whisper output). transcript_raw is new: the untouched Whisper output,
-- written once at save time, purely as an audit trail in case the cleanup
-- pass ever drifts from what was actually said.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS transcript_raw TEXT;
