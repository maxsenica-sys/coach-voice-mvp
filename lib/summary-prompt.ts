// lib/summary-prompt.ts
//
// The summariser, minus the network call: how the prompt is built, and how the
// model's reply is parsed back into `{ summary, next }`.
//
// This is the most consequential text in the product. It is what turns a coach
// talking in a car park into the thing a fifteen-year-old reads, and until now
// it lived inline in `app/api/sessions/route.ts` — a file that imports
// `next/server`, so nothing outside a running Next.js server could execute a
// single line of it. The prompt could be edited in any direction with no check
// beyond a human reading the diff, and the parse step had no test at all.
//
// Splitting it out is what makes `tools/prompt-rig.mjs` possible: the rig can
// build the real prompt over recorded transcripts and assert the things that
// must be true of it, offline and for free, on every commit. The route keeps
// the part that genuinely needs a server — the fetch and the API key.
//
// Nothing about the prompt's wording changed in the move. That is checked
// rather than asserted: the rig has a case pinning the un-personalised prompt.

import { getSportTerminologyHint } from '@/lib/sports'

export interface QuickSummary {
  summary: string | null
  next: string | null
}

export const EMPTY_SUMMARY: QuickSummary = { summary: null, next: null }

// Anything longer than this is the model writing prose rather than the coach's
// one instruction, so it is dropped rather than shown. The prompt asks for 90.
export const MAX_NEXT_LENGTH = 120

/**
 * Did the coach actually say this athlete's name in this recording?
 *
 * This is the guard that makes per-athlete summaries safe, and it deliberately
 * runs in code rather than being left to the model. A squad recording is saved
 * as one session per member — the same transcript, posted N times — so without
 * a hard gate, asking the model to "write this for Ana" on a transcript that
 * never mentions Ana invites it to invent a point and attribute it to her. A
 * fabricated coaching instruction, addressed to a named child, is the worst
 * output this product could produce.
 *
 * So: no name in the transcript, no personalisation, and the prompt is
 * byte-for-byte the one that shipped before this existed.
 *
 * `\b` is not used because it is defined on ASCII word characters, so it
 * misfires on names like "Zoë" or "Łukasz". This tests for a non-letter (or a
 * string edge) either side instead, under the `u` flag.
 */
export function transcriptNames(transcript: string, firstName: string | null | undefined): boolean {
  const name = (firstName ?? '').trim()
  // One-letter "names" are almost always placeholder roster data and would
  // match far too much prose.
  if (name.length < 2) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'iu').test(transcript)
  } catch {
    return false
  }
}

/**
 * The full prompt sent to the model.
 *
 * Pure and synchronous on purpose — given the same three arguments it returns
 * the same string, which is the property the rig depends on.
 */
export function buildSummaryPrompt(
  transcript: string,
  sport?: string | null,
  athleteName?: string | null,
): string {
  // The sport matters more than it looks. The transcript comes from Whisper
  // transcribing a coach talking, often near a noisy court, so sport jargon
  // arrives mangled ("set" as "sat", "libero" as "libro"). Without knowing the
  // sport the model guesses from context and gets terminology subtly wrong —
  // the "summary references the wrong thing" problem. Naming the sport and its
  // vocabulary lets it read through the mishearings instead of inventing.
  const trimmedSport = (sport ?? '').trim()
  const terminology = trimmedSport ? getSportTerminologyHint(trimmedSport) : ''

  const sportBlock = trimmedSport
    ? `SPORT: ${trimmedSport}\n` +
      (terminology ? `Common terms in this sport: ${terminology.slice(0, 400)}\n` : '') +
      `Interpret ambiguous or misheard words as ${trimmedSport} terminology where that is the plausible reading. Never introduce terms from a different sport.\n`
    : `SPORT: not specified. Keep the language general — do NOT assume a particular sport, and do not use sport-specific jargon that isn't already in the transcript.\n`

  // Personalisation, gated on the coach having actually said the name.
  //
  // Why this exists: a squad recording fans out to one session per member, each
  // running this same summariser over the identical transcript. Without it a
  // coach who talks for four minutes about eleven athletes pays for eleven
  // model calls and gets eleven copies of one paragraph, none of which is about
  // the athlete reading it. The work was already being done; it was just being
  // done eleven times with the same answer.
  //
  // Note the shape of the interpolation below: when `named` is false this block
  // is the empty string and the prompt is character-for-character the one that
  // shipped before personalisation existed — not merely equivalent. The rig
  // pins that.
  const named = transcriptNames(transcript, athleteName)
  const addressee = (athleteName ?? '').trim()
  const personalBlock = named
    ? `

WHO THIS IS FOR
You are writing this for ${addressee}, and the coach used their name in the recording. This may be a talk to a whole squad; if so, every member gets their own version of this summary.
Lead with the point the coach addressed to ${addressee}, in the coach's own words. Then give the points meant for everyone.
Never mention any other athlete by name — not in a bullet, not in the NEXT line. Refer to the rest of the group as "the group" or "the team".
Never attribute a point to ${addressee} that the coach did not address to them. If their name appears only in a greeting, a register or a list, write only the points meant for everyone and personalise nothing.`
    : ''

  return `
You are summarising a coach's spoken notes from a training session, for the athlete to read afterwards.${personalBlock}

${sportBlock}
WHAT YOU ARE READING
The text below is an automatic transcript of the coach talking out loud, not a written report. Expect run-on sentences, filler, self-corrections and misheard words. Read it for intent — the coach's actual coaching points — and quietly ignore transcription noise.

WRITE
2–5 bullets, each starting with •, each a short specific coaching point in the coach's own voice. Prefer what the athlete should DO next over abstract praise. Aim for under 300 characters total.

THEN, ON A FINAL SEPARATE LINE
If — and only if — the coach said something about what to work on next time, add one line in exactly this form:
NEXT: <the one thing to work on next session>
Under 90 characters, an instruction the athlete can act on, in the coach's own words. One thing, not several.
If the coach did not say anything forward-looking, omit this line entirely. Do not invent one, do not restate a bullet as a NEXT line, and do not write "NEXT: none".

NEVER
- Never state anything the coach did not say. If the transcript is too garbled or too short to summarise, output only: • Recording too unclear to summarise.
- Never write empty categories, "N/A", "None", or placeholders — omit the point instead.
- Never invent drills, numbers, scores or names that are not in the transcript.
- Never repeat the whole transcript back; this is a summary.
- No preamble, no heading, no sign-off. Bullets only.

TRANSCRIPT
${transcript}
`.trim()
}

/**
 * Split the model's reply into the athlete-facing bullets and the one
 * forward-looking line.
 *
 * A missing, over-long or placeholder NEXT line is dropped rather than shown:
 * this renders to a fourteen-year-old as an instruction, so a bad one is worse
 * than none.
 */
export function parseSummaryResponse(content: string): QuickSummary {
  const trimmed = (content ?? '').trim()
  if (!trimmed) return EMPTY_SUMMARY

  const lines = trimmed.split('\n')
  const nextIndex = lines.findIndex((l) => l.trim().toUpperCase().startsWith('NEXT:'))
  if (nextIndex === -1) return { summary: trimmed, next: null }

  const next = lines[nextIndex].trim().slice('NEXT:'.length).trim()
  const summary = lines.slice(0, nextIndex).join('\n').trim() || null

  const usable =
    next.length > 0 &&
    next.length <= MAX_NEXT_LENGTH &&
    !/^(none|n\/a|nothing)\b/i.test(next)

  return { summary, next: usable ? next : null }
}
