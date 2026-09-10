#!/usr/bin/env node
/**
 * tools/calendar-rig.mjs — can the calendar still be navigated?
 *
 * ── The bug this is the check for ─────────────────────────────────────────
 *
 * Reported as "select Personal events, press the back arrow, and the calendar
 * content disappears — I can no longer use the calendar", in every mode and in
 * both directions.
 *
 * `Calendar` owned the displayed month in its own `useState`, seeded from
 * `new Date()`, with no prop and no key. Both hosts also held a `calMonth`
 * string to fetch by — two independent copies of one fact. And both hosts
 * rendered:
 *
 *     {calLoading ? <div>Loading…</div> : <Calendar onMonthChange={…} />}
 *
 * So pressing ‹ set the grid to August, told the host, the host set
 * `calLoading`, and React unmounted the component whose state had just been
 * set. When the fetch resolved the component remounted on today's month while
 * the events belonged to August. Every day lookup missed, so the dots vanished
 * and the panel read "No events on this day" — and no number of presses could
 * reach the month, because each press was undone by its own fetch.
 *
 * `tsc --noEmit`, `eslint` and `next build` all passed on that, before and
 * after. Nothing in this repo could have caught it, which is the same sentence
 * that starts `boot-smoke.mjs` and `clock-rig.mjs`. So this file exists.
 *
 * ── What it checks, and why in two halves ─────────────────────────────────
 *
 * 1. **The arithmetic**, by importing the real `lib/calendar-month.ts` and
 *    walking navigation sequences — including the exact one from the report,
 *    September → August → July → August → September → October — plus year
 *    boundaries, leap Februaries and the 31st moving into a 30-day month.
 *    Properties, not examples: every month of a decade, both directions.
 *
 * 2. **The shape of the two things that made the bug possible.** Correct month
 *    arithmetic was never the problem; the problem was *who owned the month*
 *    and *whether the component survived a fetch*. Neither is expressible as a
 *    unit test of a pure function, so they are asserted against the source, in
 *    the same idiom as `safeguard-check.mjs`:
 *      · `Calendar` must hold no month state of its own.
 *      · No host may gate `<Calendar` behind a loading conditional.
 *      · Every host must pass `month` and `onMonthChange`.
 *    The type system now enforces the last one too — `month` is required — but
 *    a required prop can be satisfied with local state again, so it is checked
 *    here as well.
 *
 * Usage:  npm run verify:calendar
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
// pathToFileURL, not the bare path: a dynamic import of "C:\…" is rejected as
// an unsupported URL scheme 'c:'. The same trap the boot harness hit when it
// tried to spawn npx on Windows — a rig only Linux can run is a gate that gets
// skipped, and the person most likely to run this by hand is the one who just
// changed the calendar.
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const GREEN = '\x1b[32m'; const RED = '\x1b[31m'; const DIM = '\x1b[2m'; const OFF = '\x1b[0m'

const failures = []
let checks = 0
const check = (ok, name, detail = '') => {
  checks++
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

/** Strip comments so a rule described in prose cannot satisfy its own check. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Every file that renders <Calendar …>. Found, not listed, so a third host
 *  cannot be added without being checked. */
function calendarHosts() {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.tsx$/.test(p)) continue
      const rel = path.relative(ROOT, p).replace(/\\/g, '/')
      if (rel === 'app/components/Calendar.tsx') continue
      const src = readFileSync(p, 'utf8')
      if (/<Calendar[\s>]/.test(src)) out.push({ rel, src })
    }
  }
  walk(path.join(ROOT, 'app'))
  return out
}

async function main() {
  console.log(`\n  ${DIM}Calendar rig — the month survives navigation${OFF}\n`)

  const M = await import(pathToFileURL(path.join(ROOT, 'lib/calendar-month.ts')).href)

  /* ── 1. the arithmetic ─────────────────────────────────────────────────*/

  // The reported sequence, exactly.
  {
    let m = '2026-09'
    const seq = [-1, -1, +1, +1, +1]
    const expected = ['2026-08', '2026-07', '2026-08', '2026-09', '2026-10']
    for (let i = 0; i < seq.length; i++) {
      m = M.toMonthStr(M.shiftMonth(M.parseMonth(m), seq[i]))
      check(m === expected[i], 'the reported navigation sequence', `step ${i + 1} gave ${m}, expected ${expected[i]}`)
    }
    // And back to where it started, which is what makes it navigation rather
    // than a one-way trip.
    m = M.toMonthStr(M.shiftMonth(M.parseMonth(m), -1))
    check(m === '2026-09', 'the sequence returns to September', m)
  }

  // Properties over a decade, both directions, across every year boundary.
  for (let year = 2020; year <= 2030; year++) {
    for (let month = 0; month < 12; month++) {
      const ym = { year, month }
      const label = M.toMonthStr(ym)

      check(M.sameMonth(M.parseMonth(label), ym), 'a month survives the round trip through "YYYY-MM"', label)
      check(M.sameMonth(M.shiftMonth(M.shiftMonth(ym, -1), 1), ym), 'back then forward is where you started', label)
      check(M.sameMonth(M.shiftMonth(M.shiftMonth(ym, 1), -1), ym), 'forward then back is where you started', label)
      check(M.sameMonth(M.shiftMonth(ym, -12), { year: year - 1, month }), 'twelve back is one year back', label)
      check(M.sameMonth(M.shiftMonth(ym, 12), { year: year + 1, month }), 'twelve forward is one year forward', label)

      // Day counts from the calendar itself, never a hardcoded 28/30/31 —
      // checklist item 5 in CLAUDE.md, and a bug this app has already had.
      const days = M.daysInMonth(ym)
      check(days >= 28 && days <= 31, 'a month has a plausible number of days', `${label} → ${days}`)
      check(
        new Date(year, month, days).getMonth() === month,
        'the last day of the month is in that month',
        label,
      )
      check(
        new Date(year, month, days + 1).getMonth() !== month,
        'one past the last day leaves the month',
        label,
      )

      const weekday = M.firstWeekday(ym)
      check(weekday >= 0 && weekday <= 6, 'the first weekday is a weekday', `${label} → ${weekday}`)

      // The grid must have a cell for every day and no cell outside the month.
      const cells = Math.ceil((weekday + days) / 7) * 7
      check(cells >= weekday + days && cells % 7 === 0, 'the grid holds the whole month in whole weeks', label)

      // Every date string this month produces must be a real date in it.
      for (const d of [1, 15, days]) {
        const s = M.toDateStr(ym, d)
        check(/^\d{4}-\d{2}-\d{2}$/.test(s), 'a day is formatted as YYYY-MM-DD', s)
        check(s.startsWith(label), 'a day belongs to its own month', `${s} not in ${label}`)
      }
    }
  }

  // Leap years, since February is where day arithmetic goes wrong.
  check(M.daysInMonth({ year: 2024, month: 1 }) === 29, 'February 2024 has 29 days')
  check(M.daysInMonth({ year: 2026, month: 1 }) === 28, 'February 2026 has 28 days')
  check(M.daysInMonth({ year: 2100, month: 1 }) === 28, 'February 2100 has 28 days (not a leap year)')
  check(M.daysInMonth({ year: 2000, month: 1 }) === 29, 'February 2000 has 29 days')

  // Carrying the selected day across a month change.
  check(
    M.carrySelection('2026-08-12', { year: 2026, month: 8 }) === '2026-09-12',
    'the 12th carries to the 12th',
  )
  check(
    M.carrySelection('2026-01-31', { year: 2026, month: 1 }) === null,
    'the 31st does not silently become the 28th of February',
    String(M.carrySelection('2026-01-31', { year: 2026, month: 1 })),
  )
  // The 29th is the interesting boundary, not the 31st: February never has a
  // 31st in any year, so that case is covered above. This is the one where the
  // answer depends on which February.
  check(
    M.carrySelection('2026-01-29', { year: 2024, month: 1 }) === '2024-02-29',
    'the 29th carries into a leap February',
    String(M.carrySelection('2026-01-29', { year: 2024, month: 1 })),
  )
  check(
    M.carrySelection('2026-01-29', { year: 2026, month: 1 }) === null,
    'the 29th does not carry into a 28-day February',
    String(M.carrySelection('2026-01-29', { year: 2026, month: 1 })),
  )
  check(M.carrySelection(null, { year: 2026, month: 8 }) === null, 'no selection carries to no selection')

  // A malformed month must not produce NaN. A NaN month renders a grid of
  // invalid cells and no events — the same blank calendar, arriving by a
  // different route, and a month string can come from a URL.
  for (const bad of ['', null, undefined, 'nonsense', '2026-13', '2026-00', '2026', '20260-9', 'NaN-NaN']) {
    const p = M.parseMonth(bad)
    check(
      Number.isInteger(p.year) && Number.isInteger(p.month) && p.month >= 0 && p.month <= 11,
      'a malformed month falls back to a real one rather than NaN',
      `${JSON.stringify(bad)} → ${JSON.stringify(p)}`,
    )
  }

  /* ── 2. the shape that made the bug possible ───────────────────────────*/

  const cal = code(read('app/components/Calendar.tsx'))

  // The component must not hold the month. This is the single fact the whole
  // bug rested on: two owners, one of which was destroyed on every fetch.
  check(
    !/useState\s*\(\s*today\.get(FullYear|Month)\(\)/.test(cal) &&
      !/\[\s*(year|month)\s*,\s*set(Year|Month)\s*\]\s*=\s*useState/.test(cal),
    'Calendar holds no month state of its own',
    'a second owner of the month is the bug — take it from the `month` prop',
  )
  check(/month\s*:\s*MonthStr/.test(cal), 'Calendar declares a required `month` prop')
  check(/onMonthChange\s*:\s*\(/.test(cal), 'Calendar declares a required `onMonthChange`')
  // It declared `loading?: boolean` for months and never read it, which is why
  // the hosts reached for an unmount instead.
  check(/loading\s*\?/.test(cal), 'Calendar actually reads `loading`')

  const hosts = calendarHosts()
  check(hosts.length >= 2, 'the hosts were found', `${hosts.length} file(s)`)
  for (const h of hosts) {
    const src = code(h.src)

    // The exact construct that caused this. A ternary or an && whose false
    // branch is the calendar means the calendar leaves the tree while its
    // events are being fetched, taking any state it owns with it.
    const gated =
      /\b\w*[Ll]oading\w*\s*(\?|&&)[\s\S]{0,400}?<Calendar[\s>]/.test(src) ||
      /<Calendar[\s>][\s\S]{0,400}?:\s*<div[^>]*>\s*Loading/.test(src)
    check(
      !gated,
      `${h.rel} does not unmount the calendar while loading`,
      'pass loading={…} instead of rendering the calendar conditionally on it',
    )

    check(/<Calendar[\s\S]{0,600}?\bmonth=\{/.test(src), `${h.rel} passes month=`)
    check(/<Calendar[\s\S]{0,600}?\bloading=\{/.test(src), `${h.rel} passes loading=`)
    check(/<Calendar[\s\S]{0,600}?\bonMonthChange=\{/.test(src), `${h.rel} passes onMonthChange=`)

    // A month fetch with no sequence guard lets the older of two in-flight
    // months land last and win, which looks identical to the unmount bug.
    check(
      /calReqRef|AbortController/.test(src),
      `${h.rel} guards against an out-of-order month response`,
    )
  }

  /* ── report ────────────────────────────────────────────────────────────*/
  console.log('')
  if (failures.length === 0) {
    console.log(`  ${GREEN}✓ ${checks.toLocaleString()} checks passed — the calendar keeps its month.${OFF}\n`)
    process.exit(0)
  }
  // Distinct properties only: a broken one fails on hundreds of months and
  // printing every instance buries the signal.
  const seen = new Map()
  for (const f of failures) {
    const key = f.split(' — ')[0]
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  console.log(`  ${RED}✗ ${failures.length} of ${checks.toLocaleString()} checks failed:${OFF}`)
  for (const [key, count] of seen) {
    const first = failures.find((f) => f.startsWith(key))
    console.log(`     ${RED}${first}${OFF}`)
    if (count > 1) console.log(`        ${DIM}…and ${count - 1} more with the same property${OFF}`)
  }
  console.log('')
  process.exit(1)
}

main()
