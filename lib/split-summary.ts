// lib/split-summary.ts
//
// One recording, several athletes: how the prompt that splits it is built, and
// how the model's reply is parsed back into one summary per athlete.
//
// Max, 2026-09-26: "I do sometimes combine athletes and it becomes difficult.
// Splitting the summary just has to be careful — I'd rather talk and include
// the athletes in one message and then it can split from there."
//
// ── What "careful" means here ─────────────────────────────────────────────
//
// The failure is not a bad summary. It is Kai reading what the coach said
// about Mia, or Mia's criticism arriving on Kai's phone under his name. So the
// split is guarded three times, and only one of those guards is the model:
//
//  1. The name gate runs in code, before the model is asked anything. An
//     athlete the coach never named — or whose first name is shared with
//     another athlete in the same recording, so it cannot identify one child —
//     is not put in the prompt at all and gets an empty summary. The model is
//     never invited to write for someone the coach did not speak to.
//  2. The prompt says, in as many ways as it takes, that each section holds
//     only what was said to or about that athlete.
//  3. The parser checks the reply. A section for an athlete id nobody asked
//     for is dropped; a section that names another athlete in the recording is
//     withheld and reported rather than shown.
//
// An empty summary is a result, not a failure: the coach is told "Nothing
// specific for Kai" and writes one or leaves it. Inventing one is the failure.
//
// Pure and synchronous like lib/summary-prompt.ts, so tools/prompt-rig.mjs can
// pin the prompt and run the parser offline. The network call lives in
// app/api/sessions/split-summary/route.ts.

import { getSportTerminologyHint } from '@/lib/sports'
import { MAX_NEXT_LENGTH, mayPersonalise, transcriptNames } from '@/lib/summary-prompt'

/** A recording is split between at least two and at most this many athletes. */
export const MIN_SPLIT_ATHLETES = 2
export const MAX_SPLIT_ATHLETES = 5

export interface SplitAthlete {
  id: string
  first_name: string
  last_name?: string | null
}

/**
 * Why a section came back the way it did, so the UI can say it in words.
 *
 *  - `drafted`         the model wrote something for this athlete
 *  - `not-named`       the coach never said their name; nobody was asked
 *  - `ambiguous-name`  another athlete in this recording shares the first name
 *  - `nothing-specific` named, but the model found nothing meant for them
 *  - `named-another`   the draft mentioned another athlete and was withheld
 */
export type SplitReason = 'drafted' | 'not-named' | 'ambiguous-name' | 'nothing-specific' | 'named-another'

export interface SplitSection {
  athlete_id: string
  summary: string | null
  next: string | null
  reason: SplitReason
}

export class SplitParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SplitParseError'
  }
}

/**
 * Who the model may write for.
 *
 * `mayPersonalise` with the whole recording's first names as the roster: true
 * only when the coach said this athlete's name AND no other athlete in the same
 * recording answers to it. Everyone else gets an empty section without a model
 * call ever mentioning them.
 */
export function splitEligibility(
  transcript: string,
  athletes: readonly SplitAthlete[],
): { eligible: SplitAthlete[]; skipped: Array<{ athlete_id: string; reason: SplitReason }> } {
  const roster = athletes.map((a) => a.first_name)
  const eligible: SplitAthlete[] = []
  const skipped: Array<{ athlete_id: string; reason: SplitReason }> = []
  for (const a of athletes) {
    if (!transcriptNames(transcript, a.first_name)) {
      skipped.push({ athlete_id: a.id, reason: 'not-named' })
    } else if (!mayPersonalise(transcript, a.first_name, roster)) {
      skipped.push({ athlete_id: a.id, reason: 'ambiguous-name' })
    } else {
      eligible.push(a)
    }
  }
  return { eligible, skipped }
}

/**
 * The full prompt sent to the model for a split.
 *
 * `athletes` must already be the eligible ones — see splitEligibility. Given the
 * same arguments it returns the same string; the rig pins it.
 */
export function buildSplitSummaryPrompt(
  transcript: string,
  sport: string | null | undefined,
  athletes: readonly SplitAthlete[],
): string {
  // Same sport handling as the single summariser, word for word, because the
  // same Whisper mishearings arrive in the same way. The rig checks the two
  // prompts still agree on it.
  const trimmedSport = (sport ?? '').trim()
  const terminology = trimmedSport ? getSportTerminologyHint(trimmedSport) : ''
  const sportBlock = trimmedSport
    ? `SPORT: ${trimmedSport}\n` +
      (terminology ? `Common terms in this sport: ${terminology.slice(0, 400)}\n` : '') +
      `Interpret ambiguous or misheard words as ${trimmedSport} terminology where that is the plausible reading. Never introduce terms from a different sport.\n`
    : `SPORT: not specified. Keep the language general — do NOT assume a particular sport, and do not use sport-specific jargon that isn't already in the transcript.\n`

  const list = athletes
    .map((a) => `- id "${a.id}": ${[a.first_name, a.last_name ?? ''].map((s) => s.trim()).filter(Boolean).join(' ')}`)
    .join('\n')

  return `
You are splitting one coach's spoken notes into a separate summary for each athlete named below. The coach talked about several athletes in a single recording. Each athlete will read ONLY their own section, on their own phone, and must never see what the coach said about anyone else.

THE ATHLETES
${list}

${sportBlock}
WHAT YOU ARE READING
The text below is an automatic transcript of the coach talking out loud, not a written report. Expect run-on sentences, filler, self-corrections and misheard words. Read it for intent — the coach's actual coaching points — and quietly ignore transcription noise.

WHAT GOES IN EACH ATHLETE'S SECTION
Only what the coach said to that athlete or about that athlete, plus anything the coach clearly said to all of them together ("both of you", "all of you", "everyone").
A point the coach made about one athlete belongs to that athlete alone. Never copy it into another athlete's section, not even reworded.
Never mention any other athlete by name in a section — not in a bullet, not in "next". Never compare one athlete with another. If a point involves another athlete, write it without their name ("your partner", "the group").
If the coach said nothing specific to or about an athlete, give that athlete an empty summary and an empty next. Do not invent a point, do not pad it with the points meant for everyone, and do not write "nothing to report".

WRITE, FOR EACH ATHLETE
Up to five bullets, each starting with •, each a short specific coaching point in the coach's own voice, addressed to that athlete. Prefer what the athlete should DO next over abstract praise. Keep each to one line — under 70 characters a bullet, under 340 characters in total.
Five is a ceiling, not a quota. Write fewer if the coach did not make five distinct points to that athlete, and never pad, restate a point in different words, or add generic advice to reach the number.
"next": if — and only if — the coach said something about what that athlete should work on next time, one instruction under 90 characters in the coach's own words. Otherwise an empty string. One thing, not several.

NEVER
- Never state anything the coach did not say.
- Never write empty categories, "N/A", "None", or placeholders — leave the field empty instead.
- Never invent drills, numbers, scores or names that are not in the transcript.
- Never repeat the whole transcript back; this is a summary.

ABOUT THEIR BODY
The reader may be thirteen. If the coach said anything about their weight, their body shape, their size, their appearance, or what they eat, leave it out — even if the coach meant it kindly, and even if it was the main thing said. Do not soften it, do not rephrase it, do not allude to it. Write the rest.
Injuries, pain, tiredness and what a body can do today are training information and stay in: "keep off the ankle this week" is a coaching point, "you need to lose a bit" is not.

REPLY FORMAT
Reply with JSON only, no prose and no code fence, in exactly this shape, with one entry per athlete above and the id copied exactly:
{"athletes":[{"id":"<id>","summary":"• point\\n• point","next":"<one instruction or empty>"}]}

TRANSCRIPT
${transcript}
`.trim()
}

/** Strip a ```json fence if the model wrapped its reply in one anyway. */
function unfence(content: string): string {
  const t = content.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return m ? m[1] : t
}

const PLACEHOLDER = /^(none|n\/a|nothing|nothing to report|nothing specific|-|—)\.?$/i

function cleanSummary(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || PLACEHOLDER.test(s)) return null
  return s
}

function cleanNext(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s*\n+\s*/g, ' ').trim()
  if (!s || s.length > MAX_NEXT_LENGTH || /^(none|n\/a|nothing)\b/i.test(s)) return null
  return s
}

/**
 * Turn the model's reply into exactly one section per requested athlete, in
 * the order they were requested.
 *
 * Throws SplitParseError when the reply is not the JSON asked for: a split the
 * code cannot read is reported to the coach, never guessed at.
 *
 * `requested` is every athlete in the recording (not only the eligible ones),
 * so a section can be checked against every other name in it.
 */
export function parseSplitSummaryResponse(
  content: string,
  requested: readonly SplitAthlete[],
): SplitSection[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(unfence(content ?? ''))
  } catch {
    throw new SplitParseError('The reply was not JSON.')
  }
  const list = (parsed as { athletes?: unknown } | null)?.athletes
  if (!Array.isArray(list)) throw new SplitParseError('The reply had no "athletes" list.')

  const wanted = new Map(requested.map((a) => [a.id, a]))
  const got = new Map<string, { summary: string | null; next: string | null }>()
  for (const entry of list) {
    const id = typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id.trim() : ''
    // An id nobody asked for is dropped, whatever it says. The athlete it
    // would reach is not one this coach put in this recording.
    if (!wanted.has(id) || got.has(id)) continue
    got.set(id, {
      summary: cleanSummary((entry as { summary?: unknown }).summary),
      next: cleanNext((entry as { next?: unknown }).next),
    })
  }

  return requested.map((a) => {
    const s = got.get(a.id)
    if (!s || (!s.summary && !s.next)) {
      return { athlete_id: a.id, summary: null, next: null, reason: 'nothing-specific' as const }
    }
    // The prompt forbids naming anyone else; this is where that is enforced.
    // A section that names another athlete in the recording is withheld whole,
    // because the sentence that named them is the one most likely to be about
    // them rather than about this athlete.
    const others = requested.filter((o) => o.id !== a.id && o.first_name.trim().toLowerCase() !== a.first_name.trim().toLowerCase())
    const text = `${s.summary ?? ''}\n${s.next ?? ''}`
    if (others.some((o) => transcriptNames(text, o.first_name))) {
      return { athlete_id: a.id, summary: null, next: null, reason: 'named-another' as const }
    }
    return { athlete_id: a.id, summary: s.summary, next: s.next, reason: 'drafted' as const }
  })
}

/**
 * Merge the skipped athletes back in, so the caller always gets one section per
 * requested athlete in request order.
 */
export function assembleSplit(
  requested: readonly SplitAthlete[],
  skipped: ReadonlyArray<{ athlete_id: string; reason: SplitReason }>,
  drafted: readonly SplitSection[],
): SplitSection[] {
  return requested.map((a) => {
    const skip = skipped.find((s) => s.athlete_id === a.id)
    if (skip) return { athlete_id: a.id, summary: null, next: null, reason: skip.reason }
    return drafted.find((d) => d.athlete_id === a.id) ?? { athlete_id: a.id, summary: null, next: null, reason: 'nothing-specific' }
  })
}
