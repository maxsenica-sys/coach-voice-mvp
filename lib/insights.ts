// lib/insights.ts
//
// Three coach-only mirrors, computed deterministically from data the coach
// already has. No model call anywhere in this file: a theme list that changes
// when you refresh the page is not a mirror, and the rig has to be able to
// assert the exact answer.
//
//   1. recurringThemes()  — "What you repeat": phrases the coach keeps saying to
//      one athlete, counted across DISTINCT sessions.
//   2. replySignal()      — the athlete's one-tap replies as a signal, with a
//      flag when "Not sure what you mean" keeps coming back.
//   3. coverageRows()     — how the coach's recorded attention is spread across
//      the roster over the last 30 days, least first, with the median.
//
// ── Coach-only, always ─────────────────────────────────────────────────────
//
// Everything here describes the coach's own habits or compares children with
// each other. None of it may reach an athlete screen: "your coach keeps telling
// you the same thing" is a verdict a fifteen-year-old did not ask for, and the
// coverage list is a ranking of the coach's attention across a squad of
// children — exactly the between-kids comparison the product forbids. The rig
// (tools/insights-rig.mjs) fails if anything under app/athlete/ imports this
// module or calls the route that serves it.
//
// ── Dates ──────────────────────────────────────────────────────────────────
//
// Windows are compared as `YYYY-MM-DD` strings, and the cutoff is built with
// the Date(y, m-1, d-N) constructor — calendar arithmetic, never milliseconds
// divided by 86,400,000. See calendarDaysBetween in lib/session-date.ts for the
// DST bug that rule exists for.

import { sessionISODate, type SessionDateFields } from '@/lib/session-date'
import { isSessionResponse, type SessionResponse } from '@/lib/session-response'

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

/** `today` minus `days` calendar days, as YYYY-MM-DD. Null if `today` is malformed. */
export function isoDaysBefore(today: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - days)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** Is this a plausible YYYY-MM-DD? Used to validate a client-supplied `today`. */
export function isISODate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDaysBefore(s, 0) === s
}

function focusStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : []
}

/** Newest first; ties broken by id so the order never depends on the database's. */
function byDateDesc<T extends SessionDateFields & { id: string }>(a: T, b: T): number {
  const da = sessionISODate(a) ?? ''
  const db = sessionISODate(b) ?? ''
  if (da !== db) return da < db ? 1 : -1
  const ca = a.created_at ?? ''
  const cb = b.created_at ?? ''
  if (ca !== cb) return ca < cb ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. What you repeat
// ═══════════════════════════════════════════════════════════════════════════

/** How far back "recently" reaches. Eight weeks is a block of a season. */
export const THEME_WINDOW_DAYS = 56
/** A phrase has to turn up in at least this many different sessions. */
export const THEME_MIN_SESSIONS = 3
/** How many themes are worth putting in front of a coach at once. */
export const THEME_MAX = 5
/** Longest phrase counted, in words. */
export const THEME_MAX_WORDS = 3

/**
 * Words that carry no coaching content on their own. A phrase may not start or
 * end with one, and a one-word phrase may not be one — but one can sit inside a
 * longer phrase, which is how "call the ball" survives while "the" does not.
 *
 * Two lists because they fail differently. The English stopwords are the usual
 * grammar. The filler is how coaches actually talk on a court — "yeah", "okay",
 * "good", "nice", "come on" — and would otherwise top every list for every
 * athlete, which is true and useless.
 */
const STOPWORDS = new Set(`
a about above after again against all am an and any are as at be because been before being below between both but by
can cant could couldnt did didnt do does doesnt doing dont down during each few for from further had hadnt has hasnt have
havent having he hed hell hes her here heres hers herself him himself his how hows i id ill im ive if in into is isnt it
its itself lets me more most my myself no nor not of off on once only or other ought our ours ourselves out over own same
she shed shell shes should shouldnt so some such than that thats the their theirs them themselves then there theres these
they theyd theyll theyre theyve this those through to too under until up very was wasnt we wed well were weve werent what
whats when whens where wheres which while who whos whom why whys will with wont would wouldnt you youd youll youre youve
your yours yourself yourselves
`.split(/\s+/).filter(Boolean))

const FILLER = new Set(`
um umm uh uhh er erm ah oh hmm mm yeah yep yes yea nah nope ok okay alright right like just really actually basically
literally kind kinda sort sorta gonna wanna gotta got get gets getting go goes going went come comes coming came
know think thought mean means say said tell told thing things stuff bit lot lots little good great nice cool awesome
well now today again also still even much many one two three time times way want wanted need needs let see
look looking make makes made doing done try trying tried keep keeps put puts take takes give gives guys guy mate mates
everyone everybody someone something anything nothing maybe probably definitely obviously sure thanks thank cheers
session sessions week weeks day days yesterday tomorrow tonight morning
`.split(/\s+/).filter(Boolean))

/**
 * Split text into clauses of normalised tokens. A phrase never spans a clause
 * break, so "…the ball. First step…" cannot produce "ball first".
 *
 * Normalisation: lower-case, apostrophes removed ("don't" → "dont"), anything
 * that is not a letter or digit is a separator. Pure numbers are dropped — "10"
 * is not a theme.
 */
export function clauses(text: string): string[][] {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .split(/[.!?;:,\n\r()"“”—–]+/)
    .map((c) => (c.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !/^\p{N}+$/u.test(w)))
    .filter((c) => c.length > 0)
}

export function isStopword(w: string, extra?: ReadonlySet<string>): boolean {
  return STOPWORDS.has(w) || FILLER.has(w) || w.length < 2 || Boolean(extra?.has(w))
}

/**
 * Every 1–3 word phrase in `text` worth counting, as a SET — a phrase said five
 * times in one session is one piece of evidence, not five. Phrases may not
 * start or end on a stopword; a single stopword is never a phrase.
 */
export function phrasesIn(text: string, extra?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const c of clauses(text)) {
    for (let i = 0; i < c.length; i++) {
      if (isStopword(c[i], extra)) continue
      for (let n = 1; n <= THEME_MAX_WORDS && i + n <= c.length; n++) {
        const last = c[i + n - 1]
        if (isStopword(last, extra)) continue
        out.add(c.slice(i, i + n).join(' '))
      }
    }
  }
  return out
}

/** A session as the themes need it. Extra fields are ignored. */
export interface ThemeSessionInput extends SessionDateFields {
  id: string
  transcript?: string | null
  summary?: string | null
  focus_points?: unknown
  /** Set when this row is one member's copy of a squad recording. */
  group_id?: string | null
}

/**
 * The text a session contributes. For a squad recording the transcript is the
 * coach's talk to the whole squad — the same words are on every member's row,
 * and they name other children — so only the summary and focus point, which
 * are written for this athlete, count. A theme on Mathilde's page has to be
 * something said to Mathilde.
 */
export function sessionText(s: ThemeSessionInput): string {
  const parts: string[] = []
  if (!s.group_id && s.transcript) parts.push(s.transcript)
  if (s.summary) parts.push(s.summary)
  parts.push(...focusStrings(s.focus_points))
  return parts.join('\n')
}

export interface ThemeSessionRef {
  id: string
  /** YYYY-MM-DD, or null for a row with no usable date. */
  date: string | null
}

export interface Theme {
  phrase: string
  /** Distinct sessions in the window that contain the phrase. */
  count: number
  /** Those sessions, newest first. */
  sessions: ThemeSessionRef[]
}

export interface ThemesResult {
  /** Sessions for this athlete inside the window — the "of N" in "6 of 9". */
  window_sessions: number
  window_days: number
  themes: Theme[]
}

/** Does `longer` contain `shorter` as whole consecutive words? */
export function containsPhrase(longer: string, shorter: string): boolean {
  return longer !== shorter && ` ${longer} `.includes(` ${shorter} `)
}

/**
 * The recurring themes in a coach's sessions with one athlete.
 *
 * Merging: a shorter phrase is folded into the longer qualifying phrases that
 * contain it unless it recurs IN ITS OWN RIGHT — in at least `minSessions`
 * sessions where none of those longer phrases was said.
 *
 *   - "call", "ball", "call the ball" in the same four sessions: "call" and
 *     "ball" have no sessions of their own, so one theme, shown as the longer.
 *   - "high elbow" in 3 and "high" in 4, the fourth being "hands high on the
 *     block": "high" has one session of its own — a different cue that happens
 *     to share a word — so it folds, and "high elbow" stands.
 *   - "elbow" in 6 and "high elbow" in 3: "elbow" has three sessions of its
 *     own, so both are kept, each with its TRUE count. A kept phrase always
 *     shows every session it was said in; folding never edits a number.
 *
 * Ranking: most sessions first, then the longer (more specific) phrase, then
 * the most recent, then alphabetical — fully deterministic.
 */
export function recurringThemes(
  sessions: ThemeSessionInput[],
  opts: { today: string; ignoreWords?: Iterable<string>; windowDays?: number; minSessions?: number; max?: number },
): ThemesResult {
  const windowDays = opts.windowDays ?? THEME_WINDOW_DAYS
  const minSessions = opts.minSessions ?? THEME_MIN_SESSIONS
  const max = opts.max ?? THEME_MAX
  const cutoff = isoDaysBefore(opts.today, windowDays)
  // Names are ignored word by word, normalised the same way the text is.
  const extra = new Set<string>()
  for (const n of opts.ignoreWords ?? []) for (const c of clauses(n)) for (const w of c) extra.add(w)

  const inWindow = sessions
    .filter((s) => {
      const d = sessionISODate(s)
      return d !== null && cutoff !== null && d > cutoff && d <= opts.today
    })
    .sort(byDateDesc)

  const where = new Map<string, Set<string>>()
  for (const s of inWindow) {
    for (const p of phrasesIn(sessionText(s), extra)) {
      let set = where.get(p)
      if (!set) where.set(p, (set = new Set()))
      set.add(s.id)
    }
  }

  const candidates = [...where.entries()].filter(([, ids]) => ids.size >= minSessions)
  const kept = candidates.filter(([p, ids]) => {
    const longer = candidates.filter(([q]) => containsPhrase(q, p))
    if (longer.length === 0) return true
    let own = 0
    for (const id of ids) if (!longer.some(([, qids]) => qids.has(id))) own++
    return own >= minSessions
  })

  const order = new Map(inWindow.map((s, i) => [s.id, i]))
  const newest = (ids: Set<string>) => Math.min(...[...ids].map((id) => order.get(id) ?? Infinity))
  const words = (p: string) => p.split(' ').length
  kept.sort(([p, a], [q, b]) =>
    b.size - a.size || words(q) - words(p) || newest(a) - newest(b) || (p < q ? -1 : p > q ? 1 : 0),
  )

  const byId = new Map(inWindow.map((s) => [s.id, s]))
  return {
    window_sessions: inWindow.length,
    window_days: windowDays,
    themes: kept.slice(0, max).map(([phrase, ids]) => ({
      phrase,
      count: ids.size,
      sessions: [...ids]
        .map((id) => byId.get(id)!)
        .sort(byDateDesc)
        .map((s) => ({ id: s.id, date: sessionISODate(s) })),
    })),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Replies as a signal
// ═══════════════════════════════════════════════════════════════════════════

/** How many of an athlete's most recent sessions the route reads for replies. */
export const REPLY_SESSIONS_READ = 60

/** "Not sure" this many times … */
export const NOT_SURE_FLAG_AT = 2
/** … among this many most recent replied sessions raises the flag. */
export const NOT_SURE_LOOKBACK = 5

export interface ReplySessionInput extends SessionDateFields {
  id: string
  athlete_response?: string | null
  shared_with_athlete?: boolean | null
  focus_points?: unknown
}

export interface ReplySignal {
  /** How many sessions these counts were read from (the route reads at most REPLY_SESSIONS_READ). */
  sessions_read: number
  got_it: number
  working_on_it: number
  not_clear: number
  /** Shared sessions carrying a takeaway that the athlete has not answered. */
  unanswered: number
  /** How many of the last NOT_SURE_LOOKBACK replied sessions were "not sure". */
  recent_not_clear: number
  /** Size of that recent sample — fewer than 5 when they have replied fewer times. */
  recent_replied: number
  /** True when recent_not_clear ≥ NOT_SURE_FLAG_AT. */
  flag: boolean
  /** The "not sure" sessions inside the recent sample, newest first, for the tap-through. */
  flagged_sessions: ThemeSessionRef[]
}

export function replySignal(sessions: ReplySessionInput[]): ReplySignal {
  const sorted = [...sessions].sort(byDateDesc)
  const counts: Record<SessionResponse, number> = { got_it: 0, working_on_it: 0, not_clear: 0 }
  let unanswered = 0
  const replied: ReplySessionInput[] = []
  for (const s of sorted) {
    if (isSessionResponse(s.athlete_response)) {
      counts[s.athlete_response]++
      replied.push(s)
    } else if (s.shared_with_athlete && focusStrings(s.focus_points).length > 0) {
      // Only a shared session can be answered (see the respond route), and
      // "unanswered takeaway" means there was a takeaway to answer.
      unanswered++
    }
  }
  const recent = replied.slice(0, NOT_SURE_LOOKBACK)
  const unclear = recent.filter((s) => s.athlete_response === 'not_clear')
  return {
    sessions_read: sorted.length,
    ...counts,
    unanswered,
    recent_not_clear: unclear.length,
    recent_replied: recent.length,
    flag: unclear.length >= NOT_SURE_FLAG_AT,
    flagged_sessions: unclear.map((s) => ({ id: s.id, date: sessionISODate(s) })),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Coverage fairness
// ═══════════════════════════════════════════════════════════════════════════

export const COVERAGE_WINDOW_DAYS = 30

export interface CoverageAthleteInput {
  id: string
  first_name?: string | null
  last_name?: string | null
}

export interface CoverageSessionInput extends SessionDateFields {
  athlete_id: string | null
  transcript?: string | null
  group_id?: string | null
}

export interface CoverageInsightRow {
  athlete_id: string
  first_name: string
  last_name: string
  /** Sessions saved for them in the window, one-to-one and squad alike. */
  sessions: number
  /**
   * Words spoken — a PROXY for attention, not a measure of it. One-to-one
   * transcripts count in full. A squad recording is saved once per member with
   * the same transcript, so its words are split evenly across those rows:
   * otherwise one ten-minute squad talk would read as ten minutes with each of
   * twelve children.
   */
  words: number
}

export interface CoverageInsight {
  window_days: number
  /** Least attention first. */
  rows: CoverageInsightRow[]
  /** Median of `words` across every athlete on the roster, zeros included. */
  median_words: number
}

export function wordCount(text: string | null | undefined): number {
  if (!text) return 0
  return (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length
}

/** Median; the mean of the middle two for an even count; 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export function coverageRows(
  athletes: CoverageAthleteInput[],
  sessions: CoverageSessionInput[],
  opts: { today: string; windowDays?: number },
): CoverageInsight {
  const windowDays = opts.windowDays ?? COVERAGE_WINDOW_DAYS
  const cutoff = isoDaysBefore(opts.today, windowDays)
  const roster = new Set(athletes.map((a) => a.id))

  const inWindow = sessions.filter((s) => {
    if (!s.athlete_id || !roster.has(s.athlete_id)) return false
    const d = sessionISODate(s)
    return d !== null && cutoff !== null && d > cutoff && d <= opts.today
  })

  // Squad recordings: rows sharing a group_id, date and transcript are one talk.
  const shareKey = (s: CoverageSessionInput) => `${s.group_id}|${sessionISODate(s)}|${s.transcript ?? ''}`
  const shares = new Map<string, number>()
  for (const s of inWindow) if (s.group_id) shares.set(shareKey(s), (shares.get(shareKey(s)) ?? 0) + 1)

  const count = new Map<string, number>()
  const words = new Map<string, number>()
  for (const s of inWindow) {
    const id = s.athlete_id as string
    count.set(id, (count.get(id) ?? 0) + 1)
    const w = wordCount(s.transcript)
    const share = s.group_id ? w / (shares.get(shareKey(s)) ?? 1) : w
    words.set(id, (words.get(id) ?? 0) + share)
  }

  const rows: CoverageInsightRow[] = athletes.map((a) => ({
    athlete_id: a.id,
    first_name: a.first_name ?? '',
    last_name: a.last_name ?? '',
    sessions: count.get(a.id) ?? 0,
    words: Math.round(words.get(a.id) ?? 0),
  }))

  const name = (r: CoverageInsightRow) => `${r.first_name} ${r.last_name}`.trim().toLowerCase()
  rows.sort((x, y) =>
    x.words - y.words ||
    x.sessions - y.sessions ||
    (name(x) < name(y) ? -1 : name(x) > name(y) ? 1 : 0) ||
    (x.athlete_id < y.athlete_id ? -1 : x.athlete_id > y.athlete_id ? 1 : 0),
  )

  return { window_days: windowDays, rows, median_words: median(rows.map((r) => r.words)) }
}

// ═══════════════════════════════════════════════════════════════════════════
// Wire shapes (what the route returns)
// ═══════════════════════════════════════════════════════════════════════════

export interface AthleteInsightsResponse {
  themes: ThemesResult
  replies: ReplySignal
}

export interface CoverageInsightResponse {
  coverage: CoverageInsight
}
