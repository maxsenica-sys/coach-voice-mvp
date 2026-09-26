// lib/summary-guard.ts
//
// What the model returns is checked in code before anyone reads it.
//
// Max, 2026-09-26: "the summary was just a randomly generated one. It didn't
// actually take the notes from what I said and a lot of notes were generated
// … I want to cap it at five so that the athlete doesn't get overwhelmed."
//
// The prompt already said "never state anything the coach did not say" and
// "five bullets". The model read the first as advice and the second as a quota:
// on a recording with no coaching in it at all it wrote "keep your platform
// steady", which appears nowhere in what was said, and filled to five. A prompt
// is a request. This file is the part that is enforced:
//
//   1. capBullets — never more than MAX_BULLETS, whatever the model sends.
//   2. isGrounded — a bullet (or the NEXT line) survives only if most of its
//      meaningful words were actually said in the recording. The coach's own
//      words, not the model's.
//
// Both are pure and are run by tools/prompt-rig.mjs, against made-up
// transcripts written to reproduce the complaint — never an athlete's words.

/** The most bullets an athlete is ever shown. */
export const MAX_BULLETS = 5

/**
 * Share of a bullet's meaningful words that must appear in the transcript.
 *
 * Most, not all: the model may say "attacking" where the coach said "attack",
 * and joins a point together with a word or two of its own. A point the coach
 * made shares most of its content with what they said; an invented one
 * ("keep your platform steady" on a recording that never mentions a platform)
 * shares almost none.
 */
export const GROUNDING_RATIO = 0.6

// Words that carry no content of their own. Includes the coaching verbs the
// model uses to frame any point ("focus on", "keep", "work on", "maintain"),
// which would otherwise let an invented bullet borrow grounding from filler.
const STOP = new Set(`
a an the and or but if then so to of in on at by for with from into onto over under up down out off
is are was were be been being am do does did done doing have has had having will would shall should can could may might must
i me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those
what when where which who whom why how all any both each few more most other some such no nor not only own same than too very
just also still even again ever now here there about above after before below between during through while until against
as because like get got getting make makes made making keep keeps kept keeping focus focusing focused work working worked works
maintain maintaining continue continuing improve improving improved try trying tried use using used need needs needed want wants
really good great well better best nice lot lots bit little make sure sure time times next session today way thing things one two
let lets going gonna go goes went come comes came see seen look looking every always never
discuss discussed discussing emphasise emphasised emphasize emphasized emphasizing emphasising ensure ensuring
instruct instructed highlight highlighted remember reminded important importance critical
`.trim().split(/\s+/))

/**
 * The line the prompt asks for when a recording has no coaching in it. It is an
 * answer for the model, not something to show an athlete: the guard turns it
 * into "no summary", which the coach sees and can write over.
 */
export const NO_COACHING_LINE = '• No coaching points in this recording.'
const NO_COACHING_RE = /^\s*[•\-*]?\s*no coaching points in this recording\.?\s*$/i

/** Lower-case letter runs, accents folded. */
function words(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[a-z]+/g) ?? []
}

/**
 * A crude stem: the first five letters of a word of five or more, the whole
 * word otherwise. "attacking" and "attack", "consistency" and "consistent",
 * "serves" and "serve" all meet; "platform" and "plate" do not.
 */
function stem(w: string): string {
  // A plural meets its singular: "balls" is "ball", "serves" is "serve".
  const base = w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w
  return base.length >= 5 ? base.slice(0, 5) : base
}

/** The meaningful words of a line: not stop words, at least three letters. */
function contentWords(s: string): string[] {
  return words(s).filter((w) => w.length >= 3 && !STOP.has(w))
}

/** Every stem the coach said, for membership tests. */
export function transcriptStems(transcript: string): Set<string> {
  return new Set(words(transcript).map(stem))
}

/**
 * Was this line said, near enough, in the recording?
 *
 * A line with no meaningful words at all ("• Great work!") has nothing to
 * check and is treated as not grounded: it is exactly the padding Max asked to
 * be rid of.
 */
export function isGrounded(line: string, stems: Set<string>, ratio = GROUNDING_RATIO): boolean {
  // Each clause must stand on its own. "Focus on your volleyball technique;
  // keep your platform steady" borrowed its grounding from a real first half
  // (the coach did say volleyball) to carry an invented second one — the exact
  // bullet Max complained about. A partly invented point is still invented.
  const clauses = line
    .replace(/^\s*[•\-*]\s*/, '')
    .split(/[;:—–]|\s-\s/)
    .map((c) => contentWords(c))
    .filter((cw) => cw.length > 0)
  if (clauses.length === 0) return false
  return clauses.every((cw) => cw.filter((w) => stems.has(stem(w))).length / cw.length >= ratio)
}

/** The bullet lines of a summary, in order, without the blank lines. */
export function bulletLines(summary: string): string[] {
  return summary
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/** At most `max` bullets. Pure truncation, in the model's order. */
export function capBullets(summary: string, max = MAX_BULLETS): string {
  return bulletLines(summary).slice(0, max).join('\n')
}

export interface GuardResult {
  summary: string | null
  next: string | null
  /** How many bullets were dropped for not being in the recording. */
  droppedUngrounded: number
  /** How many were dropped for being past the cap. */
  droppedOverCap: number
  /** The model said there was no coaching in the recording. */
  noCoaching: boolean
}

/**
 * Apply both rules to a parsed summary.
 *
 * Grounding runs first, then the cap, so an invented bullet never takes the
 * place of a real fifth point. A NEXT line that fails grounding is dropped: it
 * renders to the athlete as an instruction, and an instruction the coach never
 * gave is worse than none.
 */
export function guardSummary(
  parsed: { summary: string | null; next: string | null },
  transcript: string,
  max = MAX_BULLETS,
): GuardResult {
  const stems = transcriptStems(transcript)
  const lines = parsed.summary ? bulletLines(parsed.summary) : []
  // Nothing to coach on means nothing at all — not even a takeaway.
  if (lines.some((l) => NO_COACHING_RE.test(l))) {
    return { summary: null, next: null, droppedUngrounded: 0, droppedOverCap: 0, noCoaching: true }
  }
  const grounded = lines.filter((l) => isGrounded(l, stems))
  const kept = grounded.slice(0, max)
  const next = parsed.next && isGrounded(parsed.next, stems) ? parsed.next : null
  return {
    summary: kept.length ? kept.join('\n') : null,
    next,
    droppedUngrounded: lines.length - grounded.length,
    droppedOverCap: grounded.length - kept.length,
    noCoaching: false,
  }
}
