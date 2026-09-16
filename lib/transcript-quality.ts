// lib/transcript-quality.ts
//
// Whether a transcript is worth acting on, decided from the data Whisper
// already returns and the app already throws away.
//
// ── The failure this exists for ───────────────────────────────────────────
//
// `/api/transcribe` asks for `verbose_json` and returns `segments`, and no
// client has ever read them. Every segment carries `no_speech_prob` and
// `avg_logprob` — exactly the signal for the two failures that currently pass
// in silence:
//
//   A recording with no speech in it. The only guard is `blob.size < 1000`,
//   which forty seconds of a muted microphone comfortably exceeds. So a silent
//   recording is uploaded, paid for, and handed to whisper-1 — which is well
//   known for hallucinating fluent text from silence. `if (json.text)` accepts
//   it, the summariser writes bullets about it, and lib/notify.ts emails those
//   bullets to a child and their caretakers. Nothing in that chain can tell
//   that the coach never spoke.
//
//   A recording the model half-heard. There is currently no way for the product
//   to say "some of this was unclear", so a transcript full of guesses looks
//   exactly like a clean one.
//
// This is deliberately a pure function over the segment shape, in lib/, so the
// rigs can reach it — per CLAUDE.md, a computation whose correctness is not
// obvious by reading it does not belong in a component.

/** The fields of a Whisper verbose_json segment this module reads. */
export interface TranscriptSegment {
  /** Whisper's own probability that this segment contains no speech. */
  no_speech_prob?: number
  /** Mean log probability of the tokens chosen. Closer to 0 is more confident. */
  avg_logprob?: number
  text?: string
}

export type TranscriptVerdict =
  /** Nothing worth keeping — almost certainly silence or noise. */
  | { quality: 'no-speech'; reason: string }
  /** Usable, but the coach should look before it is sent to a child. */
  | { quality: 'low-confidence'; reason: string }
  | { quality: 'ok' }

/* Thresholds.
 *
 * `no_speech_prob > 0.6` is OpenAI's own documented rule-of-thumb for treating
 * a segment as non-speech, and `avg_logprob < -1.0` is the companion one for
 * "the model was guessing". Both are applied over the WHOLE recording rather
 * than per segment: one uncertain segment in a four-minute session is a cough,
 * while a majority of them is a recording nobody should act on.
 */
const NO_SPEECH_PROB = 0.6
const LOW_CONFIDENCE_LOGPROB = -1.0
/** Below this many real words, there is nothing to summarise. */
const MIN_WORDS = 4

export function assessTranscript(
  text: string,
  segments: readonly TranscriptSegment[] = [],
): TranscriptVerdict {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean)

  if (words.length < MIN_WORDS) {
    return { quality: 'no-speech', reason: 'We could not make out any words in that recording.' }
  }

  if (segments.length === 0) {
    // No segment data (an older client, or a provider that did not return it).
    // Absence of evidence is not evidence, so this stays out of the way.
    return { quality: 'ok' }
  }

  const silent = segments.filter((s) => (s.no_speech_prob ?? 0) > NO_SPEECH_PROB).length
  const unsure = segments.filter((s) => (s.avg_logprob ?? 0) < LOW_CONFIDENCE_LOGPROB).length

  if (silent / segments.length > 0.8) {
    return {
      quality: 'no-speech',
      reason: 'That recording sounds like silence — check the microphone was picking you up.',
    }
  }

  if ((silent + unsure) / segments.length > 0.5) {
    return {
      quality: 'low-confidence',
      reason: 'Some of this was hard to make out. Read it through before saving.',
    }
  }

  return { quality: 'ok' }
}
