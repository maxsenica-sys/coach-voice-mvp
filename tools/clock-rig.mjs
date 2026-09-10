#!/usr/bin/env node
/**
 * tools/clock-rig.mjs — run the app's date arithmetic under other people's clocks.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * CoachVoice has shipped a date bug that every check it owned passed on.
 *
 * The twelve-week training chart bucketed sessions by dividing a millisecond
 * difference by 86,400,000. That assumes every local day is 24 hours long. Two
 * local midnights a week apart are 167 or 169 hours apart across a daylight
 * saving change, so a session recorded on Monday 29 March 2027 landed in the
 * *previous* week's bucket in Europe/London and America/New_York — and landed
 * correctly in UTC. `tsc`, `eslint` and `next build` all passed. CI runs in
 * UTC, so CI passed too. It would have been wrong for most of the app's users,
 * twice a year, invisibly.
 *
 * That is the same shape as every startup bug this project has had, which is
 * why `tools/boot-smoke.mjs` exists: **the failure is not in the types, it is
 * in the environment the code runs in.** A type checker cannot hold an opinion
 * about March in London. So this rig does what the boot harness does for the
 * first paint — it runs the real code under the real conditions and asserts on
 * the result.
 *
 * ── What makes it trustworthy ─────────────────────────────────────────────
 *
 * It imports the **actual modules** — `lib/session-date.ts` and
 * `lib/training-spine.ts` — using Node's native TypeScript stripping. It does
 * not re-implement the arithmetic. A rig that tests a copy of the logic proves
 * only that the copy is self-consistent, and drifts silently the first time the
 * real function changes. (This is not hypothetical either: the DST bug above
 * was first probed with a hand-copied replica, which is exactly the habit this
 * file exists to replace.)
 *
 * Each timezone runs in its own child process, because `TZ` is read when a
 * process starts and mutating it mid-run is not reliably honoured.
 *
 * ── What it checks ────────────────────────────────────────────────────────
 *
 * Properties, not examples. Every property is asserted for all 365 days of a
 * year in each zone, so a transition date cannot be missed by not having
 * thought of it. The properties are chosen to be things a human would say out
 * loud about a calendar: consecutive days are one day apart; a session today is
 * in this week; the buckets add up.
 *
 * Usage:
 *   node tools/clock-rig.mjs             # every zone
 *   node tools/clock-rig.mjs --zone UTC  # one zone (used internally)
 *   node tools/clock-rig.mjs --year 2027
 */

import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// pathToFileURL, not the bare path. A dynamic import of "C:\Users\…" is
// rejected outright as an unsupported URL scheme 'c:', so this rig could only
// ever run on Linux — and CI is the only place that is, which makes it a gate
// the person who just changed the code cannot run before opening the PR. Same
// lesson as the boot harness and its `npx` spawn.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

/**
 * Zones chosen to cover the ways a calendar can be awkward, not to be a long
 * list: northern and southern DST, a half-hour offset, a 45-minute offset, a
 * zone that never changes, and the two extremes of the day.
 */
const ZONES = [
  'UTC',
  'Europe/London',      // northern DST, the author's own zone
  'America/New_York',   // northern DST, different transition dates
  'America/Santiago',   // southern DST — transitions run the other way
  'Australia/Sydney',   // southern DST
  'America/St_Johns',   // -03:30, and it observes DST
  'Pacific/Chatham',    // +12:45 / +13:45 — the awkward one
  'Asia/Kolkata',       // +05:30, no DST at all
  'Pacific/Kiritimati', // +14:00, the earliest date on earth
]

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

// ── child mode: run every property in one zone ────────────────────────────

async function runZone(zone, year) {
  const { calendarDaysBetween, parseISODate, todayISODate, sessionISODate, sessionDate } =
    await import(pathToFileURL(path.join(ROOT, 'lib/session-date.ts')).href)
  const { buildSpine, startOfWeek, SPINE_WEEKS } =
    await import(pathToFileURL(path.join(ROOT, 'lib/training-spine.ts')).href)

  const failures = []
  let checks = 0

  const check = (ok, name, detail) => {
    checks++
    if (!ok) failures.push(`${name} — ${detail}`)
  }

  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // Walk every local day of the year by incrementing the day-of-month, which
  // is DST-proof in a way that adding 86400000ms is not.
  const days = []
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
  }

  for (let i = 0; i < days.length; i++) {
    const today = days[i]
    const label = iso(today)

    // ── P1 · consecutive local days are exactly one day apart ─────────────
    // The single property the shipped DST bug violated.
    if (i + 1 < days.length) {
      const gap = calendarDaysBetween(today, days[i + 1])
      check(gap === 1, 'P1 consecutive days are 1 apart', `${label} -> ${iso(days[i + 1])} gave ${gap}`)
    }

    // ── P2 · antisymmetry ─────────────────────────────────────────────────
    if (i + 3 < days.length) {
      const fwd = calendarDaysBetween(today, days[i + 3])
      const back = calendarDaysBetween(days[i + 3], today)
      check(fwd === 3, 'P2 three days ahead is 3', `${label} gave ${fwd}`)
      check(fwd === -back, 'P2 antisymmetry', `${label} gave ${fwd} vs ${back}`)
    }

    // ── P3 · a date is zero days from itself ──────────────────────────────
    check(calendarDaysBetween(today, today) === 0, 'P3 self distance is 0', label)

    // ── P4 · ISO round-trip ───────────────────────────────────────────────
    const round = parseISODate(label)
    check(
      round !== null && calendarDaysBetween(round, today) === 0,
      'P4 parseISODate round-trips',
      `${label} parsed to ${round}`,
    )

    // ── P5 · week start is a Monday, and never in the future ──────────────
    const ws = startOfWeek(today)
    check(ws.getDay() === 1, 'P5 week starts on Monday', `${label} -> ${iso(ws)} (day ${ws.getDay()})`)
    const intoWeek = calendarDaysBetween(ws, today)
    check(
      intoWeek >= 0 && intoWeek <= 6,
      'P5 today is within its own week',
      `${label} is ${intoWeek} days into week starting ${iso(ws)}`,
    )

    // ── P6 · a session today lands in the last bucket ─────────────────────
    const spineToday = buildSpine([{ session_date: label }], today)
    check(
      spineToday.weeks[SPINE_WEEKS - 1] === 1 && spineToday.total === 1,
      'P6 today is in the current bucket',
      `${label} -> weeks ${JSON.stringify(spineToday.weeks)}`,
    )
    check(spineToday.daysSinceLast === 0, 'P6 today is 0 days ago', `${label} gave ${spineToday.daysSinceLast}`)

    // ── P7 · the buckets add up, and 84 days fill 12 sevens ───────────────
    // Run on a sample of days rather than all 365: it is the expensive one and
    // the transitions are covered by the sample stride plus P1 above.
    if (i % 7 === 0) {
      const window = []
      for (let k = 0; k < 84; k++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - k)
        window.push({ session_date: iso(d) })
      }
      const spine = buildSpine(window, today)
      const sum = spine.weeks.reduce((a, b) => a + b, 0)
      check(sum === spine.total, 'P7 weeks sum to total', `${label} sum ${sum} vs total ${spine.total}`)
      check(
        spine.weeks.every((n) => n === 7) === (spine.total === 84),
        'P7 84 consecutive days fill 12 buckets of 7',
        `${label} -> ${JSON.stringify(spine.weeks)}`,
      )
    }

    // ── P8 · sessionISODate preserves the coach's chosen date verbatim ─────
    check(
      sessionISODate({ session_date: label, created_at: null }) === label,
      'P8 sessionISODate is verbatim',
      label,
    )
    const sd = sessionDate({ session_date: label, created_at: null })
    check(
      sd !== null && iso(sd) === label,
      'P8 sessionDate keeps the day',
      `${label} -> ${sd ? iso(sd) : 'null'}`,
    )
  }

  // ── P9 · todayISODate agrees with the local clock ───────────────────────
  const now = new Date()
  check(
    todayISODate() === iso(now),
    'P9 todayISODate matches the local date',
    `${todayISODate()} vs ${iso(now)}`,
  )

  return { zone, checks, failures }
}

// ── parent mode: fan out over the zones ───────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const zoneArg = args.includes('--zone') ? args[args.indexOf('--zone') + 1] : null
  const year = args.includes('--year') ? Number(args[args.indexOf('--year') + 1]) : 2027

  if (zoneArg) {
    return runZone(zoneArg, year).then((r) => {
      process.stdout.write(JSON.stringify(r))
      process.exit(r.failures.length ? 1 : 0)
    })
  }

  console.log(`\n  ${DIM}The clock rig — the app's date logic under nine timezones, every day of ${year}${OFF}\n`)

  let totalChecks = 0
  let failedZones = 0

  for (const zone of ZONES) {
    const res = spawnSync(
      process.execPath,
      [
        // The `@/` alias the app's own lib modules import each other with.
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--import', path.join(HERE, 'alias-register.mjs'),
        fileURLToPath(import.meta.url), '--zone', zone, '--year', String(year),
      ],
      { env: { ...process.env, TZ: zone }, encoding: 'utf8' },
    )

    let parsed = null
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      // A crash is a failure, and the stderr is the interesting part.
      failedZones++
      console.log(`   ${RED}CRASH${OFF}  ${zone}`)
      console.log(`          ${(res.stderr || '').trim().split('\n').slice(-4).join('\n          ')}`)
      continue
    }

    totalChecks += parsed.checks
    if (parsed.failures.length === 0) {
      console.log(`   ${GREEN}PASS${OFF}   ${zone.padEnd(20)} ${DIM}${parsed.checks} checks${OFF}`)
    } else {
      failedZones++
      console.log(`   ${RED}FAIL${OFF}   ${zone.padEnd(20)} ${DIM}${parsed.checks} checks${OFF}`)
      // Distinct failures only: a broken property fails on hundreds of days and
      // printing every one buries the signal.
      const seen = new Set()
      for (const f of parsed.failures) {
        const key = f.split(' — ')[0]
        if (seen.has(key)) continue
        seen.add(key)
        const count = parsed.failures.filter((x) => x.startsWith(key)).length
        console.log(`          ${RED}${f}${OFF}`)
        if (count > 1) console.log(`          ${DIM}…and ${count - 1} more days with the same property${OFF}`)
      }
    }
  }

  console.log('')
  if (failedZones === 0) {
    console.log(`  ${GREEN}✓ ${totalChecks.toLocaleString()} checks passed across ${ZONES.length} timezones.${OFF}\n`)
    process.exit(0)
  }
  console.log(`  ${RED}✗ ${failedZones} of ${ZONES.length} timezones failed.${OFF}\n`)
  process.exit(1)
}

main()
