// lib/athlete-recording.ts
//
// May an athlete hear the recording behind a session shared with them?
//
// Only when the recording is about them alone. A squad recording (group_id,
// migration 023) and one recording about several athletes
// (shared_recording_id, migration 029) are the coach talking about other
// children too, so their audio, like their transcript, never reaches an
// athlete. The detail route and the audio-url route have always refused it.
//
// Found 2026-11-14: the athlete portal still showed an "Audio" badge and a
// player on every row with an audio_path, squad and several-athlete sessions
// included, and the player then failed with Forbidden. The list route now
// decides with this function and withholds the audio fields where the answer
// is no, so the portal has nothing to draw. tools/staff-rig.mjs (S12) holds
// the rule and checks the other two routes still say the same thing.

export type RecordingShape = {
  group_id: string | null
  shared_recording_id: string | null
}

/** True only for a one-to-one recording. Both fields must be read, never assumed. */
export function athleteMayHearRecording(row: RecordingShape): boolean {
  return !row.group_id && !row.shared_recording_id
}

/**
 * A session row as the athlete's list should carry it: the audio fields
 * withheld when the athlete may not hear the recording, and shared_recording_id
 * never sent (it links this row to other children's; the portal needs only
 * group_id, which it uses to label a squad session).
 */
export function forAthleteList<T extends RecordingShape & { audio_path?: string | null; audio_mime?: string | null }>(
  row: T,
): Omit<T, 'shared_recording_id'> {
  const { shared_recording_id: _omit, ...rest } = row
  void _omit
  if (athleteMayHearRecording(row)) return rest
  return { ...rest, audio_path: null, audio_mime: null }
}
