#!/usr/bin/env node
/**
 * tools/roster-rig.mjs — does the roster tell the truth about who has arrived?
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * On 2026-09-17 Max asked why Leo Bridgeford read PENDING on the roster when
 * he had been an athlete on it for days. He was right to ask. Leo had signed
 * himself up, typed his coach's code into his own portal, and been inserted
 * into `athletes` with `invited_at` and nothing else — so `first_login_at`,
 * the one column the whole ACTIVE/PENDING answer is derived from, was null for
 * an athlete who was at that moment looking at the app.
 *
 * The bug was not in any one line. It was in the gap between two halves that
 * nothing held together:
 *
 *   * the READER — `athleteStatus()` in lib/athlete-status.ts — answers from
 *     `first_login_at`, and
 *   * the WRITERS — three insert/update sites across app/api — of which only
 *     one ever wrote that column.
 *
 * Every one of those files type-checks. `tsc` cannot know that a row inserted
 * in `app/api/join/route.ts` will later be read by a function in
 * `lib/athlete-status.ts` that looks at a column the insert never set. This is
 * the same shape as the DST bug the clock rig exists for and the wordmark
 * flash the boot harness exists for: **the defect is in the joins between
 * files, not inside any of them.**
 *
 * ── What makes it trustworthy ─────────────────────────────────────────────
 *
 * Part 1 imports the REAL lib/athlete-status.ts and makes the writer and the
 * reader face each other: whatever `activationFields()` produces must read
 * back as ACTIVE, and must count. A copy of the logic here would prove only
 * that the copy agrees with itself.
 *
 * Part 2 is a static scan, because the thing that actually went wrong was an
 * insert site that existed and was never wired up. There is no runtime path a
 * Node rig can take to discover a route it has never heard of; finding them by
 * reading the source is the only way to notice the next one.
 *
 * ── Proven by breaking it ─────────────────────────────────────────────────
 *
 * Per CLAUDE.md, a check that has never failed is not known to work. Both
 * parts were verified by reverting the real fix — deleting `activationFields()`
 * from `app/api/join/route.ts` — and watching R3 name that file and that line.
 * R1/R2 were verified by making `activationFields` return `status` alone.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { athleteStatus, activeCount, activationFields } from '../lib/athlete-status.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m'
const DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'

const results = []
const check = (id, title, why, fn) => {
  let problems
  try { problems = fn() ?? [] } catch (e) { problems = [`threw: ${e.message}`] }
  results.push({ id, title, why, problems })
}

/**
 * Insert sites that deliberately do NOT activate, each with the reason.
 *
 * An exemption list rather than a looser rule, for the reason SG1 gives in
 * tools/safeguard-check.mjs: a rule slack enough to let the coach-invite path
 * through is also slack enough to let the next forgotten one through. Adding
 * to this costs you a sentence, and the sentence is printed on every run.
 */
const INVITE_ONLY_BY_DESIGN = {
  'app/api/athletes/route.ts':
    'The coach invites someone who is not here yet. This row is created from the coach\'s dashboard against an email address; the athlete has not signed up, not set a password and not opened anything. PENDING is the truth, and it is the only place in the app where it is.',
}

// ── Part 1: the writer and the reader, made to face each other ────────────

check(
  'R1',
  'What the app writes when an athlete arrives reads back as ACTIVE',
  'The roster\'s answer comes from `first_login_at`. If the helper that records an arrival ever stops setting that exact column — renamed, dropped, or set to something falsy — every athlete silently becomes permanently PENDING and nothing else in the codebase notices.',
  () => {
    const bad = []
    const fields = activationFields(new Date('2026-09-14T00:33:55.324Z'))
    if (athleteStatus(fields) !== 'ACTIVE') {
      bad.push(`activationFields() produced a row that reads back as ${athleteStatus(fields)}`)
    }
    if (activeCount([fields]) !== 1) {
      bad.push('an athlete the app just activated does not count towards the dashboard\'s "N active"')
    }
    // The three columns are read by different things — the API derives status
    // from first_login_at, while migration 020 and anything querying the table
    // directly read `status`. They drifted apart once already; 020 was the
    // clean-up, and this assertion is what stops a third round of it.
    if (fields.status !== 'active') bad.push(`status column written as ${JSON.stringify(fields.status)}, not 'active'`)
    if (fields.activated_at !== fields.first_login_at) {
      bad.push('activated_at and first_login_at disagree — they record the same event')
    }
    return bad
  },
)

check(
  'R2',
  'An athlete who has never opened the portal still reads PENDING',
  'The fix for the bug above must not become "call everyone active". A coach inviting someone by email needs that person to show as PENDING until they actually arrive — that badge is how the coach knows to chase them.',
  () => {
    const bad = []
    if (athleteStatus({ first_login_at: null }) !== 'INVITED') bad.push('a null first_login_at no longer reads INVITED')
    if (athleteStatus({}) !== 'INVITED') bad.push('a row with no first_login_at field at all no longer reads INVITED')
    // Having an auth account is NOT arrival: `athlete_user_id` is written at
    // invite time by admin.auth.admin.generateLink, before the invite email is
    // even sent. Deriving status from it was one of the three disagreeing
    // definitions lib/athlete-status.ts was created to replace, and it is the
    // reason Leo read ACTIVE for days before reading PENDING for days.
    if (athleteStatus({ first_login_at: null, athlete_user_id: 'uuid' }) !== 'INVITED') {
      bad.push('having an auth account counts as having arrived again — see the note in lib/athlete-status.ts')
    }
    if (activeCount([{ first_login_at: null }, { first_login_at: '2026-09-14T00:00:00Z' }]) !== 1) {
      bad.push('activeCount disagrees with athleteStatus about the same two rows')
    }
    return bad
  },
)

// ── Part 2: every writer into `athletes`, found by reading the source ─────

function sources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sources(full, acc)
    else if (/\.tsx?$/.test(full)) acc.push({ rel: relative(ROOT, full), text: readFileSync(full, 'utf8') })
  }
  return acc
}

/** Strip comments, so prose about a fix can neither trip nor satisfy a rule. */
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

const lineOf = (text, needle) => {
  const i = text.indexOf(needle)
  return i < 0 ? 1 : text.slice(0, i).split('\n').length
}

/**
 * Every place this source inserts a row into `athletes`, as offsets.
 *
 * Two traps, both of which this rule fell into before it was mutation-tested:
 *
 * 1. The `.insert(` must belong to the SAME builder chain as the
 *    `.from('athletes')` — no other `.from(` in between. Without that,
 *    `app/api/messages/route.ts` matched, because a `.from('athletes')
 *    .select('coach_id')` sits a dozen lines above an unrelated
 *    `.from('messages').insert(...)`.
 *
 * 2. It cannot be one lazy global regex. `matchAll` resumes after the end of
 *    each match, so in a file that checks `.from('athletes').select(...)` for
 *    an existing row BEFORE inserting — which app/api/join/route.ts does — the
 *    first (rejected) match swallows the real insert and the file reads as
 *    having none. That made R3 pass while the Leo bug was reinstated: the rule
 *    was inert and looked clean, which is the exact failure mode CLAUDE.md
 *    says to mutation-test for. So: scan from each `.from('athletes')`
 *    independently.
 */
function athleteInsertSites(src) {
  const sites = []
  const from = /\.from\(\s*['"]athletes['"]\s*\)/g
  for (const m of src.matchAll(from)) {
    const window = src.slice(m.index + m[0].length, m.index + m[0].length + 400)
    const insertAt = window.indexOf('.insert(')
    if (insertAt < 0) continue
    if (window.slice(0, insertAt).includes('.from(')) continue
    sites.push(m.index)
  }
  return sites
}

const insertsAnAthlete = (src) => athleteInsertSites(src).length > 0

check(
  'R3',
  'Every route that puts an athlete on a roster records whether they are here',
  'This is the one that would have caught Leo. Two routes — /api/join and /api/complete-signup — create the roster row for an athlete who signed themselves up and is, by definition, signed in and looking at the portal while it happens. Both inserted `invited_at` alone, so both produced an athlete recorded as never having opened an app they were holding. The portal\'s own activate call could not save them: it fires from the load effect, which had already run before the row existed and does not run again.',
  () => {
    const bad = []
    for (const f of sources(join(ROOT, 'app', 'api'))) {
      const src = code(f.text)
      // Only insert sites. An update that sets first_login_at is the activate
      // route doing its job, and a select is nobody's business here.
      if (!insertsAnAthlete(src)) continue
      if (f.rel in INVITE_ONLY_BY_DESIGN) continue
      if (!/activationFields\s*\(/.test(src)) {
        bad.push(
          `${f.rel}:${lineOf(f.text, '.insert(')} inserts an athlete row without activationFields() ` +
          `— that athlete will read PENDING for ever (add it, or add a written exemption to INVITE_ONLY_BY_DESIGN)`,
        )
      }
    }
    if (sources(join(ROOT, 'app', 'api')).every((f) => !insertsAnAthlete(code(f.text)))) {
      // A scan that finds nothing to judge is inert, not clean. The palette rig
      // learned the same lesson about its gradient section.
      bad.push('found no athlete insert sites at all — this rule is no longer looking at anything')
    }
    return bad
  },
)

check(
  'R4',
  'The reader has exactly one definition, and the UI does not carry a second',
  'There were three disagreeing definitions of "active" before lib/athlete-status.ts, and the visible symptom was an athlete showing PENDING on the roster and ACTIVE on their own profile page. The dashboard still carries `a.status ?? (a.athlete_user_id ? ...)` fallbacks, which are the old wrong definition kept as a default. They are harmless only while the API always sends `status`.',
  () => {
    const bad = []
    for (const f of sources(join(ROOT, 'app', 'api'))) {
      const src = code(f.text)
      if (!/athletes/.test(src)) continue
      // Deriving the badge from athlete_user_id inside an API route is the old
      // bug. The client may keep a defensive fallback; the server may not.
      if (/athlete_user_id\s*\?\s*['"]ACTIVE['"]/.test(src)) {
        bad.push(`${f.rel} derives ACTIVE from athlete_user_id — that is invite-accepted, not arrived`)
      }
    }
    return bad
  },
)

// ── run ───────────────────────────────────────────────────────────────────

console.log(`\n  ${DIM}Roster rig — does the roster tell the truth about who has arrived?${OFF}\n`)

let failed = 0
for (const r of results) {
  if (r.problems.length === 0) {
    console.log(`   ${GREEN}PASS${OFF}  ${r.id}  ${r.title}`)
  } else {
    failed += r.problems.length
    console.log(`   ${RED}FAIL${OFF}  ${r.id}  ${r.title}`)
    console.log(`         ${DIM}Why this rule exists:${OFF} ${r.why}`)
    for (const p of r.problems) console.log(`         ${RED}${p}${OFF}`)
  }
}

const exemptions = Object.entries(INVITE_ONLY_BY_DESIGN)
if (exemptions.length) {
  console.log(`\n  ${BOLD}DELIBERATE EXEMPTIONS${OFF} ${DIM}— rows that are PENDING on purpose${OFF}`)
  for (const [file, reason] of exemptions) {
    console.log(`   ${YELLOW}·${OFF} ${file}`)
    console.log(`     ${DIM}${reason}${OFF}`)
  }
}

console.log(`\n  ${BOLD}KNOWN GAPS${OFF} ${DIM}— what this rig cannot see${OFF}`)
for (const gap of [
  'Whether the activate call actually reaches the server. It is fired from the portal without being awaited, so a user who closes the tab within the round trip stays PENDING. The route now logs and returns 500 on a write failure instead of swallowing it, but nothing retries.',
  'Rows already in the database. This rig reads source, not data. Leo\'s row was corrected by hand on 2026-09-17; any athlete who joined via a coach code before this fix shipped and has not been back since is still wrong, and only a query can find them.',
]) {
  const wrapped = gap.match(/.{1,74}(\s|$)/g) ?? [gap]
  console.log(`   ${YELLOW}·${OFF} ${wrapped.map((l, i) => (i ? '     ' + l.trim() : l.trim())).join('\n')}`)
}

console.log('')
if (failed === 0) {
  console.log(`  ${GREEN}✓ ${results.length} roster rules hold.${OFF}\n`)
  process.exit(0)
}
console.log(`  ${RED}✗ ${failed} roster violation${failed === 1 ? '' : 's'}.${OFF}\n`)
process.exit(1)
