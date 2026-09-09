// lib/session-response.ts
//
// The three things an athlete can say back about a session, in one place.
//
// This is the first athlete-authored signal in the product. Everything else a
// coach sees is either their own words or a model's summary of them, so the
// vocabulary is worth defining once and deliberately rather than typing three
// string literals into two render sites and an API route.
//
// The wording is doing real work and is not interchangeable with synonyms:
//
// - "Got it" is an acknowledgement, not a promise. It must not read as "I have
//   already fixed this", or an athlete will hesitate to tap it.
// - "Working on it" is the honest middle. Without it the only options are
//   claiming success or admitting confusion, and most weeks are neither.
// - "Not sure what you mean" is the one that earns the feature, and it is
//   phrased to put the ambiguity on the message rather than on the reader.
//   "I don't understand" makes a fifteen-year-old the one who failed; a coach
//   needs them to tap it anyway.

export type SessionResponse = 'got_it' | 'working_on_it' | 'not_clear'

export interface ResponseOption {
  value: SessionResponse
  /** What the athlete taps. */
  label: string
  /** How the coach reads it back. Deliberately third-person and neutral. */
  coachLabel: string
  /** Token for the chip when selected, and for the coach's badge. */
  color: string
  tint: string
}

export const SESSION_RESPONSES: ResponseOption[] = [
  {
    value: 'got_it',
    label: 'Got it',
    coachLabel: 'Got it',
    color: 'var(--wellness-good)',
    tint: 'var(--wellness-good-tint)',
  },
  {
    value: 'working_on_it',
    label: 'Working on it',
    coachLabel: 'Working on it',
    color: 'var(--energy-dark)',
    tint: 'var(--wellness-ok-tint)',
  },
  {
    value: 'not_clear',
    label: 'Not sure what you mean',
    coachLabel: 'Not clear to them',
    color: 'var(--coach-on-light)',
    tint: 'var(--coach-light)',
  },
]

export function isSessionResponse(v: unknown): v is SessionResponse {
  return typeof v === 'string' && SESSION_RESPONSES.some((r) => r.value === v)
}

export function responseOption(v: string | null | undefined): ResponseOption | null {
  if (!v) return null
  return SESSION_RESPONSES.find((r) => r.value === v) ?? null
}
