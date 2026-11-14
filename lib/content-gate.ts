// lib/content-gate.ts
//
// Nothing sexual, hateful or threatening is ever summarised for, or shared
// with, an athlete. The readers are 13 to 18.
//
// Found 2026-09-26: a recording with no coaching in it, describing sexual
// activity with a named athlete, was summarised into bullets ("work on giving
// consent before action") and a takeaway, and shared with her. The summariser
// had no concept of "this should not be summarised at all", and the save route
// had no concept of "this must not reach a child". This file is both.
//
// Two layers, because either alone fails somewhere:
//   - OpenAI's moderation endpoint, which understands context and innuendo. It
//     can be down or slow, and then it answers nothing.
//   - A short list of unambiguous words, checked in code, always. It cannot
//     read innuendo, but it never fails open.
//
// The decision logic is pure and tested by tools/prompt-rig.mjs.

/** Moderation categories that stop a summary and block sharing. */
export const BLOCKING_CATEGORIES = [
  'sexual',
  'sexual/minors',
  'hate',
  'hate/threatening',
  'harassment/threatening',
  'self-harm/instructions',
  'violence/graphic',
] as const

// Whole words only. Chosen so that nothing a coach says about sport or a body
// in training can match: no "strip", "touch", "consent", "body" or "chest".
const UNAMBIGUOUS = [
  'naked', 'nude', 'nudes', 'nudity', 'sex', 'sexual', 'sexually', 'sexy', 'porn', 'porno',
  'pornography', 'horny', 'orgasm', 'genital', 'genitals', 'erection', 'masturbate',
  'masturbating', 'intercourse', 'condom', 'blowjob',
]
const WORD_RE = new RegExp(`(?:^|[^\\p{L}])(${UNAMBIGUOUS.join('|')})(?=$|[^\\p{L}])`, 'iu')

export interface GateResult {
  blocked: boolean
  /** Why, for logs and for the coach's message. Never shown to an athlete. */
  reasons: string[]
}

/** The in-code backstop. Pure. */
export function keywordGate(text: string): GateResult {
  const m = WORD_RE.exec(text ?? '')
  return m ? { blocked: true, reasons: [`word:${m[1].toLowerCase()}`] } : { blocked: false, reasons: [] }
}

/** Turn a moderation response's categories into a decision. Pure. */
export function moderationDecision(categories: Record<string, boolean> | null | undefined): GateResult {
  const hit = BLOCKING_CATEGORIES.filter((c) => categories?.[c] === true)
  return { blocked: hit.length > 0, reasons: hit.map((c) => `moderation:${c}`) }
}

/**
 * Check text before it is summarised or shared.
 *
 * The keyword backstop always runs. The moderation call runs when a key is
 * set; if it fails, the backstop's answer stands (it does not block
 * everything, which would stop every coach sharing whenever OpenAI is down).
 */
export async function checkContent(text: string): Promise<GateResult> {
  const local = keywordGate(text)
  const key = process.env.OPENAI_API_KEY
  if (!key || !text.trim()) return local
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text.slice(0, 20000) }),
    })
    if (!res.ok) return local
    const json = await res.json()
    const remote = moderationDecision(json?.results?.[0]?.categories)
    return { blocked: local.blocked || remote.blocked, reasons: [...local.reasons, ...remote.reasons] }
  } catch {
    return local
  }
}

/** What the coach is told. Plain, and not an accusation. */
export const BLOCKED_MESSAGE =
  "This recording can't be summarised or shared with an athlete: it contains content that isn't appropriate for them. You can still keep it as a private note by unticking Share."

/* ── Sharing or editing a session that is already saved ──────────────────
 *
 * Found 2026-11-14: the gate ran only when a session was shared at save. A
 * session saved private and shared later from the toggle, or a shared
 * session whose summary or notes were edited afterwards, reached the athlete
 * unchecked (PATCH /api/sessions/[id]). That was the whole of the hole: save
 * private, then tap Share.
 *
 * Only future actions are checked. A session that is already shared stays
 * shared; nothing is re-judged retroactively. */

/** The session fields an athlete reads, and the transcript (1:1 sessions). */
export const ATHLETE_VISIBLE_FIELDS = ['session_name', 'title', 'summary', 'coach_notes', 'focus_points'] as const

export interface SessionText {
  shared_with_athlete?: boolean | null
  transcript?: string | null
  session_name?: string | null
  title?: string | null
  summary?: string | null
  coach_notes?: string | null
  focus_points?: unknown
}

export interface ShareGateCheck {
  /** 'share': the session is becoming shared, so everything an athlete would
   *  read is checked. 'edit': it is already shared and athlete-visible text is
   *  changing, so the new text is checked. */
  kind: 'share' | 'edit'
  text: string
}

function textOf(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return []
}

/**
 * What a PATCH must have checked before it is written, or null when nothing
 * new reaches an athlete (unsharing, editing a private session, a sport tag).
 * Pure.
 */
export function shareGateCheck(current: SessionText, updates: Record<string, unknown>): ShareGateCheck | null {
  const wasShared = current.shared_with_athlete === true
  const willBeShared = 'shared_with_athlete' in updates ? updates.shared_with_athlete === true : wasShared
  if (!willBeShared) return null

  if (!wasShared) {
    const after: Record<string, unknown> = { ...current, ...updates }
    const text = ['transcript', ...ATHLETE_VISIBLE_FIELDS].flatMap((f) => textOf(after[f])).join('\n')
    return { kind: 'share', text }
  }

  const changed = ATHLETE_VISIBLE_FIELDS.filter((f) => f in updates)
  if (changed.length === 0) return null
  return { kind: 'edit', text: changed.flatMap((f) => textOf(updates[f])).join('\n') }
}

/** Told to the coach when sharing a saved session is refused. */
export const SHARE_BLOCKED_MESSAGE =
  "This session can't be shared with an athlete: it contains content that isn't appropriate for them. It stays private."

/** Told to the coach when an edit to a shared session is refused. */
export const EDIT_BLOCKED_MESSAGE =
  "That can't be saved on a shared session: it contains content that isn't appropriate for an athlete. Nothing was changed."
