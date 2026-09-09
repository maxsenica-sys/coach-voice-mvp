// lib/audio-mime.ts
//
// The recorded MIME type, and the filename extension Whisper reads it by.
//
// ── Read CLAUDE.md before touching anything here ─────────────────────────
//
// This is the single most breakable detail in the product, and it breaks
// *silently*. Chrome records `audio/webm`; Safari and iOS record `audio/mp4`.
// Whisper detects the codec from the **filename extension**, so a file named
// `recording.webm` containing mp4 data is rejected or mis-transcribed, and the
// coach sees "transcription failed" with no clue why — on Apple devices only.
//
// The list order is a second, separate decision. mp4 first because iOS Safari
// cannot decode WebM *at all*: a WebM recording made in Chrome plays back as an
// endless spinner on an iPhone weeks later. Every browser that can play WebM
// can also play mp4, so preferring mp4 makes a saved recording playable
// everywhere. `isTypeSupported` still guards the choice, and WebM remains the
// fallback for browsers that cannot record mp4.
//
// ── Why this moved into lib/ ─────────────────────────────────────────────
//
// It was one line inside `stopAndTranscribe`. Offline capture needs the exact
// same mapping when it replays a queued recording hours later, and the only
// two options were to duplicate the line or to share it. A duplicated
// extension table is how one of these paths eventually starts disagreeing with
// the other, on one browser, quietly. Sharing it means the rule has one home.
//
// The logic is unchanged from the version that shipped. It is not to be
// "simplified" — the substring checks are deliberately loose because a real
// `mimeType` carries codec parameters (`audio/mp4;codecs=mp4a.40.2`).

/**
 * Candidate recording types, in preference order. mp4 first — see above.
 * Exported so the recorder and any future capture path cannot drift apart.
 */
export const SUPPORTED_RECORDING_TYPES = [
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const

/**
 * The filename extension Whisper needs for this MIME type.
 *
 * Never hardcode an extension at a call site. Never default the *mime* to
 * webm either — pass what `MediaRecorder.mimeType` actually reported.
 */
export function audioExtension(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
}

/** The File to send to `/api/transcribe`, named so Whisper can read it. */
export function transcribeFile(blob: Blob, mimeType: string): File {
  return new File([blob], `recording.${audioExtension(mimeType)}`, { type: mimeType })
}
