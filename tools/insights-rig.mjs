#!/usr/bin/env node
/**
 * tools/insights-rig.mjs — do the coach insights say what actually happened?
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * lib/insights.ts puts three sentences in front of a coach: "You've mentioned
 * 'elbow' in 6 of your last 9 sessions", "Mathilde said 'not sure' to 2 of her
 * last 5 takeaways", and a list of who got least of their attention this month.
 * Each is a claim about a child and about the coach, and each is a number. A
 * number that is wrong by one — a phrase counted five times because it was said
 * five times in one session, a flag that fires on one "not sure" instead of two,
 * a quiet athlete sorted to the bottom instead of the top — type-checks, lints
 * and builds exactly like a right one.
 *
 * ── What makes it trustworthy ─────────────────────────────────────────────
 *
 * It imports the REAL lib/insights.ts. Every case is a small hand-built input
 * whose right answer is obvious by reading it, so a failure says which rule
 * broke rather than that some total changed.
 *
 * The last section is static: it reads app/athlete/ and fails if any athlete
 * surface imports this module or its components or calls its route, and it
 * reads the route and fails if a query there is not scoped to the caller.
 *
 * ── Proven by breaking it ─────────────────────────────────────────────────
 *
 * Per CLAUDE.md, a check that has never failed is not known to work. Verified
 * red on 2026-09-26 by breaking the real code, one change at a time:
 *   - counting per clause instead of per distinct session  → I1–I7 red;
 *   - `>=` → `>` in the not-sure flag                     → I8 red;
 *   - sorting coverage descending                          → I10 red;
 *   - folding every contained sub-phrase, and never folding → I3 red (both);
 *   - threshold `>= 3` → `> 3`                              → I1, I3, I4, I6, I7 red;
 *   - letting a squad transcript count                     → I6 red;
 *   - an app/athlete/ file importing @/lib/insights        → I13 red;
 *   - removing .eq('coach_id', userId) from one route query → I14 red.
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import {
  recurringThemes,
  replySignal,
  coverageRows,
  phrasesIn,
  median,
  isoDaysBefore,
  wordCount,
  THEME_MAX,
} from '../lib/insights.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m'
const DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'

const results = []
const check = (id, title, why, fn) => {
  let problems
  try { problems = fn() ?? [] } catch (e) { problems = [`threw: ${e.stack ?? e.message}`] }
  results.push({ id, title, why, problems })
}
const expect = (problems, cond, msg) => { if (!cond) problems.push(msg) }
const eq = (problems, got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) problems.push(`${msg}: got ${g}, want ${w}`)
}

const TODAY = '2026-09-26'
const day = (n) => isoDaysBefore(TODAY, n)
let seq = 0
const S = (daysAgo, transcript, extra = {}) => ({ id: `s${String(++seq).padStart(3, '0')}`, session_date: day(daysAgo), transcript, ...extra })
const phrases = (r) => r.themes.map((t) => t.phrase)
const theme = (r, p) => r.themes.find((t) => t.phrase === p)

// ── 1. What you repeat ────────────────────────────────────────────────────

check('I1', 'A phrase is counted once per session, however often it is said',
  'The sentence is "in 6 of the last 9 sessions". A coach who says "elbow" ten times in one drill has said it in one session; counting ten would claim a pattern that is really one bad afternoon.',
  () => {
    const p = []
    const r = recurringThemes([
      S(1, 'Elbow. Elbow! Elbow, elbow, elbow.'),
      S(2, 'Watch your elbow on the swing.'),
      S(3, 'The elbow again.'),
      S(4, 'Serve toss was lovely.'),
    ], { today: TODAY })
    eq(p, theme(r, 'elbow')?.count, 3, '"elbow" said 7 times across 3 sessions')
    eq(p, theme(r, 'elbow')?.sessions.length, 3, 'sessions listed for "elbow"')
    eq(p, r.window_sessions, 4, 'window_sessions')
    const r2 = recurringThemes([S(1, 'Pinky pinky pinky pinky pinky.'), S(2, 'Pinky pinky pinky pinky.'), S(3, 'Nothing here.')], { today: TODAY })
    expect(p, !phrases(r2).includes('pinky'), '"pinky" said 9 times in only 2 sessions must not be a theme')
    return p
  })

check('I2', 'Stopwords and coaching filler never become a theme',
  '"Yeah, okay, good" is in every session a coach records. Listing it is true and useless, and it would push the real cue off the list.',
  () => {
    const p = []
    const sess = [1, 2, 3, 4].map((d) => S(d, 'Yeah okay good, that was the thing. Um, you know, just really nice. Call the ball!'))
    const r = recurringThemes(sess, { today: TODAY })
    for (const bad of ['yeah', 'okay', 'good', 'the', 'um', 'you know', 'just', 'really', 'nice', 'that', 'was']) {
      expect(p, !phrases(r).includes(bad), `"${bad}" listed as a theme`)
    }
    expect(p, phrases(r).includes('call the ball'), '"call the ball" (inner stopword) must survive')
    const set = phrasesIn('the ball is up')
    expect(p, !set.has('the ball') && !set.has('ball is'), 'a phrase may not start or end on a stopword')
    expect(p, !phrasesIn('Rotate 10 times').has('10'), 'a bare number is not a phrase')
    expect(p, !phrasesIn('Good. Ball first').has('good ball'), 'a phrase must not span a sentence break')
    return p
  })

check('I3', 'A sub-phrase folds into the longer phrase unless it recurs in its own right',
  '"call", "ball" and "call the ball" in the same four sessions are one theme said three ways. "high" in "high elbow" and once in "hands high" is a shared word, not a second cue. But "elbow" in six sessions, three of them without "high", is two facts — and a kept phrase always shows its true count.',
  () => {
    const p = []
    const r = recurringThemes([
      S(1, 'Call the ball.'), S(2, 'Call the ball early.'), S(3, 'Call the ball please.'), S(4, 'Call the ball!'),
    ], { today: TODAY })
    eq(p, phrases(r).filter((x) => /call|ball/.test(x)), ['call the ball'], 'identical-evidence sub-phrases')
    const r2 = recurringThemes([
      S(1, 'High elbow.'), S(2, 'High elbow on contact.'), S(3, 'High elbow.'),
      S(4, 'Elbow up.'), S(5, 'Your elbow.'), S(6, 'Elbow through.'), S(7, 'Hands high on the block.'),
    ], { today: TODAY })
    eq(p, theme(r2, 'elbow')?.count, 6, '"elbow" (3 sessions of its own) keeps its true 6')
    eq(p, theme(r2, 'high elbow')?.count, 3, '"high elbow" keeps its 3')
    expect(p, !phrases(r2).includes('high'), '"high" (1 session of its own) folds into "high elbow"')
    const r3 = recurringThemes([
      S(1, 'High elbow.'), S(2, 'High elbow.'), S(3, 'High elbow.'), S(4, 'Elbow up.'), S(5, 'Elbow up.'),
    ], { today: TODAY })
    expect(p, !phrases(r3).includes('elbow'), '"elbow" with only 2 sessions of its own folds')
    return p
  })

check('I4', 'The threshold is three distinct sessions, and exactly three qualifies',
  'Two is a coincidence; the card promises a pattern. An off-by-one here either hides the first real repeat or shows noise.',
  () => {
    const p = []
    const two = recurringThemes([S(1, 'First step.'), S(2, 'First step.'), S(3, 'Hands.')], { today: TODAY })
    expect(p, !phrases(two).includes('first step'), '2 sessions must not qualify')
    const three = recurringThemes([S(1, 'First step.'), S(2, 'First step.'), S(3, 'First step.')], { today: TODAY })
    eq(p, theme(three, 'first step')?.count, 3, '3 sessions must qualify')
    return p
  })

check('I5', `At most ${THEME_MAX}, ranked by sessions then specificity, deterministically`,
  'The coach should see the loudest repeats first, and the same data must always produce the same list.',
  () => {
    const p = []
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf']
    const sess = []
    for (let d = 1; d <= 8; d++) sess.push(S(d, words.filter((_, i) => d <= 8 - i).join('. ')))
    const r = recurringThemes(sess, { today: TODAY })
    eq(p, r.themes.length, THEME_MAX, 'capped')
    eq(p, phrases(r), ['alpha', 'bravo', 'charlie', 'delta', 'echo'], 'ranked by session count')
    const r2 = recurringThemes([...sess].reverse(), { today: TODAY })
    eq(p, phrases(r2), phrases(r), 'input order must not change the answer')
    const t = theme(r, 'alpha')
    eq(p, t.sessions.map((s) => s.date), [...t.sessions.map((s) => s.date)].sort().reverse(), 'sessions newest first')
    return p
  })

check('I6', 'Only this athlete\'s own words, inside the eight-week window',
  'A squad recording is saved to every member with the same transcript, which is the coach talking to twelve children and naming some of them. Only the summary and focus point are this athlete\'s.',
  () => {
    const p = []
    const r = recurringThemes([
      S(1, 'Serve.'), S(2, 'Serve.'),
      S(3, 'Serve. Serve. Blocking footwork.', { group_id: 'g1', summary: 'Worked on blocking footwork.' }),
      S(4, 'Blocking footwork.'), S(5, 'Blocking footwork.'),
      S(57, 'Serve.'), S(58, 'Serve.'),
      S(-1, 'Serve.'),
    ], { today: TODAY })
    expect(p, !phrases(r).includes('serve'), 'squad transcript, out-of-window and future sessions must not make "serve" a theme')
    eq(p, theme(r, 'blocking footwork')?.count, 3, 'squad summary counts for this athlete')
    eq(p, r.window_sessions, 5, 'window_sessions excludes 57/58 days ago and tomorrow')
    const edge = recurringThemes([S(55, 'Pivot.'), S(56, 'Pivot.'), S(54, 'Pivot.')], { today: TODAY })
    eq(p, edge.window_sessions, 2, '56 days ago is outside an 8-week window, 55 is inside')
    return p
  })

check('I7', 'Roster names are never a theme, and no transcript text leaves the lib',
  'The athlete\'s own name would top every list; a teammate\'s name is another child. And the route promises phrases and counts, not a child\'s recorded speech.',
  () => {
    const p = []
    const long = 'Mathilde you dropped your left shoulder again on the approach'
    const r = recurringThemes([S(1, long), S(2, long), S(3, long)], { today: TODAY, ignoreWords: ['Mathilde', 'Ross', 'Ellie'] })
    expect(p, !phrases(r).some((x) => x.includes('mathilde')), 'athlete name listed as a theme')
    expect(p, phrases(r).includes('left shoulder'), '"left shoulder" should still be found')
    const json = JSON.stringify(r)
    expect(p, !json.includes('dropped your left shoulder'), 'a transcript fragment longer than a phrase leaked into the output')
    expect(p, r.themes.every((t) => t.phrase.split(' ').length <= 3), 'phrase longer than 3 words')
    return p
  })

// ── 2. Replies ────────────────────────────────────────────────────────────

const R = (daysAgo, athlete_response, extra = {}) => ({
  id: `r${String(++seq).padStart(3, '0')}`, session_date: day(daysAgo), athlete_response,
  shared_with_athlete: true, focus_points: ['Hold the finish'], ...extra,
})

check('I8', 'The "not sure" flag fires at 2 of the last 5 replies, not 1, and not 2 of 6',
  'The card says "maybe rephrase". One "not sure" is a single message that missed; two in five is a pattern worth a coach\'s attention. Unanswered sessions are not replies and must not dilute the five.',
  () => {
    const p = []
    const one = replySignal([R(1, 'not_clear'), R(2, 'got_it'), R(3, 'got_it'), R(4, 'working_on_it'), R(5, 'got_it')])
    eq(p, [one.flag, one.recent_not_clear], [false, 1], '1 of 5')
    const two = replySignal([R(1, 'got_it'), R(2, 'not_clear'), R(3, 'got_it'), R(4, 'got_it'), R(5, 'not_clear')])
    eq(p, [two.flag, two.recent_not_clear, two.recent_replied], [true, 2, 5], '2 of 5')
    eq(p, two.flagged_sessions.length, 2, 'flagged sessions listed')
    const sixth = replySignal([R(1, 'got_it'), R(2, 'not_clear'), R(3, 'got_it'), R(4, 'got_it'), R(5, 'got_it'), R(6, 'not_clear')])
    eq(p, sixth.flag, false, 'the 6th most recent reply is outside the lookback')
    const gaps = replySignal([R(1, null), R(2, 'not_clear'), R(3, null), R(4, 'not_clear'), R(5, null)])
    eq(p, [gaps.flag, gaps.recent_replied], [true, 2], 'unanswered sessions do not count toward the five')
    return p
  })

check('I9', 'Counts and unanswered takeaways are counted from the right rows',
  'Only a shared session can be answered, and "unanswered takeaway" means there was a takeaway. Counting a private session as unanswered blames a child for not replying to something they cannot see.',
  () => {
    const p = []
    const r = replySignal([
      R(1, 'got_it'), R(2, 'working_on_it'), R(3, 'working_on_it'), R(4, 'not_clear'),
      R(5, null), R(6, null, { shared_with_athlete: false }), R(7, null, { focus_points: [] }), R(8, 'bogus'),
    ])
    eq(p, [r.got_it, r.working_on_it, r.not_clear, r.unanswered, r.sessions_read], [1, 2, 1, 2, 8], 'got/working/not/unanswered/read (an unknown value is not a reply)')
    return p
  })

// ── 3. Coverage ───────────────────────────────────────────────────────────

check('I10', 'Coverage: least attention first, median marked, squad talk shared',
  'The card exists to put the least-attended child at the top. Sorted the wrong way it hides them at the bottom of a long list; a squad talk counted in full for every member makes a squad-only athlete look as attended as a one-to-one.',
  () => {
    const p = []
    const A = (id, first) => ({ id, first_name: first, last_name: 'X' })
    const athletes = [A('a', 'Ana'), A('b', 'Ben'), A('c', 'Cleo'), A('d', 'Dev')]
    const ten = 'one two three four five six seven eight nine ten'
    const sessions = [
      { athlete_id: 'a', session_date: day(1), transcript: ten + ' ' + ten },          // 20
      { athlete_id: 'a', session_date: day(2), transcript: ten },                      // 10 → 30
      { athlete_id: 'b', session_date: day(3), transcript: ten, group_id: 'g' },       // 10 / 2 = 5
      { athlete_id: 'c', session_date: day(3), transcript: ten, group_id: 'g' },       // 5
      { athlete_id: 'c', session_date: day(4), transcript: ten },                      // +10 → 15
      { athlete_id: 'b', session_date: day(40), transcript: ten + ten + ten },         // outside 30 days
      { athlete_id: 'zzz', session_date: day(1), transcript: ten },                    // not on roster
    ]
    const r = coverageRows(athletes, sessions, { today: TODAY })
    eq(p, r.rows.map((x) => x.athlete_id), ['d', 'b', 'c', 'a'], 'ascending by words, never-recorded first')
    eq(p, r.rows.map((x) => x.words), [0, 5, 15, 30], 'words')
    eq(p, r.rows.map((x) => x.sessions), [0, 1, 2, 2], 'sessions')
    eq(p, r.median_words, 10, 'median of 0,5,15,30')
    eq(p, [median([3, 1, 2]), median([4]), median([])], [2, 4, 0], 'median odd/single/empty')
    eq(p, wordCount("Don't drop the elbow — twice."), 5, 'word count')
    return p
  })

check('I11', 'Empty inputs give empty answers, not errors',
  'A new coach, a new athlete, a quiet month. Each renders an empty state; none may throw.',
  () => {
    const p = []
    const t = recurringThemes([], { today: TODAY })
    eq(p, [t.window_sessions, t.themes.length], [0, 0], 'themes')
    const r = replySignal([])
    eq(p, [r.flag, r.unanswered, r.recent_replied], [false, 0, 0], 'replies')
    const c = coverageRows([], [], { today: TODAY })
    eq(p, [c.rows.length, c.median_words], [0, 0], 'coverage')
    const bad = recurringThemes([S(1, 'x')], { today: 'not-a-date' })
    eq(p, bad.window_sessions, 0, 'malformed today')
    return p
  })

check('I12', 'Window arithmetic is calendar days in every timezone',
  'The clock rig exists because milliseconds ÷ 86,400,000 put a session in the wrong week in London and New York while passing in UTC.',
  () => {
    const p = []
    const saved = process.env.TZ
    for (const tz of ['UTC', 'Europe/London', 'America/New_York', 'Australia/Sydney', 'Pacific/Auckland']) {
      process.env.TZ = tz
      eq(p, isoDaysBefore('2027-03-29', 1), '2027-03-28', `${tz} spring-forward`)
      eq(p, isoDaysBefore('2026-11-02', 7), '2026-10-26', `${tz} fall-back`)
      eq(p, isoDaysBefore('2026-10-05', 56), '2026-08-10', `${tz} 8 weeks`)
    }
    process.env.TZ = saved
    return p
  })

// ── 4. Static: who may see it, and whose data it reads ────────────────────

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.(tsx?|jsx?)$/.test(e)) out.push(f)
  }
  return out
}

check('I13', 'No athlete surface imports the insights or calls their route',
  'Every figure here is a coach\'s habit or a comparison between children. On an athlete screen "your coach keeps telling you the same thing" is a verdict, and the coverage list is a league table of who the coach likes best.',
  () => {
    const p = []
    const forbidden = /@\/lib\/insights|\/api\/coach\/insights|components\/(CoachInsights|CoverageInsight)\b/
    for (const f of walk(path.join(ROOT, 'app/athlete'))) {
      const src = readFileSync(f, 'utf8')
      const i = src.split('\n').findIndex((l) => forbidden.test(l))
      if (i >= 0) p.push(`${path.relative(ROOT, f)}:${i + 1} reaches coach-only insights`)
    }
    return p
  })

check('I14', 'Every query in the insights route is scoped to the calling coach',
  'An athlete id in a URL is guessable. Each query must carry coach_id = the caller, or it describes someone else\'s children.',
  () => {
    const p = []
    const f = path.join(ROOT, 'app/api/coach/insights/route.ts')
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    const queries = [...src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)([\s\S]*?)(?=\.from\(|\]\s*\)|$)/g)]
    expect(p, queries.length >= 5, `expected at least 5 queries, found ${queries.length}`)
    for (const q of queries) {
      if (!/\.eq\(\s*['"]coach_id['"]\s*,\s*userId\s*\)/.test(q[2])) p.push(`query on "${q[1]}" is not scoped with .eq('coach_id', userId)`)
    }
    expect(p, /routeIdentity\s*\(/.test(src) && /401/.test(src), 'route must establish identity and answer 401')
    return p
  })

// ── Report ────────────────────────────────────────────────────────────────

console.log(`\n  ${DIM}Insights rig — do the coach insights say what actually happened?${OFF}\n`)
let failed = 0
for (const r of results) {
  if (r.problems.length === 0) {
    console.log(`   ${GREEN}PASS${OFF}  ${r.id}  ${r.title}`)
  } else {
    failed += r.problems.length
    console.log(`   ${RED}FAIL${OFF}  ${r.id}  ${r.title}`)
    console.log(`         ${DIM}Why this rule exists:${OFF} ${r.why}`)
    for (const pr of r.problems) console.log(`         ${RED}${pr}${OFF}`)
  }
}

console.log(`\n  ${BOLD}KNOWN GAPS${OFF} ${DIM}— what this rig cannot see${OFF}`)
for (const gap of [
  'Whether a theme is a good one. The rig proves the counting; it cannot tell a coaching cue from a word the filler list has not met yet. New filler is added to FILLER in lib/insights.ts with the transcript that surfaced it.',
  'Words spoken is a proxy for attention, not a measure of it. A coach who says little and watches closely reads as "least attention". The card says so on its face; nothing here can check that it still does.',
  'Squad recordings saved before migration 023 have no group_id, so their transcripts count in full for every member and read as one-to-one words.',
  'I13 reads app/athlete/ only. A coach-only component mounted inside a shared component that an athlete page also renders would not be seen.',
]) {
  const wrapped = gap.match(/.{1,74}(\s|$)/g) ?? [gap]
  console.log(`   ${YELLOW}·${OFF} ${wrapped.map((l, i) => (i ? '     ' + l.trim() : l.trim())).join('\n')}`)
}

console.log('')
if (failed === 0) {
  console.log(`  ${GREEN}✓ ${results.length} insight rules hold.${OFF}\n`)
  process.exit(0)
}
console.log(`  ${RED}✗ ${failed} insight violation${failed === 1 ? '' : 's'}.${OFF}\n`)
process.exit(1)
