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
  const { calendarDaysBetween, parseISODate, todayISODate, sessionISODate, sessionDate, yesterdayISODate } =
    await import(pathToFileURL(path.join(ROOT, 'lib/session-date.ts')).href)
  const { buildSpine, startOfWeek, completeSpineWeeks, SPINE_WEEKS } =
    await import(pathToFileURL(path.join(ROOT, 'lib/training-spine.ts')).href)
  // date-utils was outside this rig while carrying the exact bug the rig
  // exists for: two `Math.floor(diffMs / 86400000)` calls deciding whether a
  // message says "Today" or "Yesterday". A rig that does not import a module
  // cannot hold an opinion about it.
  const { fmtDateDivider, fmtTime, fmtShortDate } =
    await import(pathToFileURL(path.join(ROOT, 'lib/date-utils.ts')).href)
  // The pre-session brief's window: "twenty minutes before a calendar event"
  // is a date, a wall-clock time and no timezone, turned into an instant.
  const { eventStart, briefPhase, upcomingBrief, startLabel, BRIEF_LEAD_MINUTES, BRIEF_GRACE_MINUTES } =
    await import(pathToFileURL(path.join(ROOT, 'lib/pre-session.ts')).href)

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

    // ── P7b · a capped session list covers only the weeks after its oldest ─
    // The dashboard's spark loads the newest N sessions. If the oldest is in
    // the week n weeks back, only the n weeks after it are complete, whichever
    // day of that week it fell on. Getting this wrong by one draws a
    // half-empty week as a quiet one.
    if (i % 7 === 0) {
      const monday = startOfWeek(today)
      for (let n = 0; n <= SPINE_WEEKS + 2; n++) {
        const want = Math.min(SPINE_WEEKS, n)
        for (const offset of [0, 6]) {
          const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * n + offset)
          const got = completeSpineWeeks([{ session_date: iso(d) }, { session_date: label }], true, today)
          check(got === want, 'P7b complete weeks after the oldest session', `${label}, oldest ${iso(d)} gave ${got}, want ${want}`)
        }
      }
      check(completeSpineWeeks([], false, today) === SPINE_WEEKS, 'P7b an unfilled list is complete', label)
      check(completeSpineWeeks([], true, today) === 0, 'P7b a full list of no dates covers nothing', label)
    }

    // ── P8b · a date-only string is shown as that date ───────────────────
    // new Date('YYYY-MM-DD') is UTC midnight, the previous evening west of
    // UTC. A check-in dated today must print as today in every zone.
    {
      const want = today.toLocaleDateString([], { month: 'short', day: 'numeric' })
      const got = fmtShortDate(label)
      check(got === want, 'P8b fmtShortDate keeps a date-only day', `${label} printed ${got}, want ${want}`)
    }

    // ── P8c · yesterday is the previous calendar date, just after midnight ─
    // At 00:30 the day after a 23-hour day, subtracting 24 hours lands two
    // dates back. Every day of the year is stood on at 00:30 and at 23:30.
    if (i > 0) {
      for (const [h, m] of [[0, 30], [23, 30]]) {
        const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m)
        const got = yesterdayISODate(at)
        check(got === iso(days[i - 1]), 'P8c yesterday is the previous date', `${label} ${h}:${m} gave ${got}, want ${iso(days[i - 1])}`)
      }
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

    // ── P10 · the divider names the right calendar day, at any hour ───────
    //
    // The shipped bug: `Math.floor(diffMs / 86400000)`. A message sent at 23:40
    // and read at 01:10 the next morning is 90 minutes old, floors to zero
    // whole days, and gets labelled "Today" when it was yesterday.
    //
    // `now` is passed in rather than read from the wall clock, which is the
    // whole point: the first version of this property built its timestamps from
    // the year being walked (2027) while the real clock said 2026, so every
    // stamp was in the future, the Today/Yesterday branches never ran, and it
    // passed against the broken code. A property that cannot reach the failing
    // state is not a test.
    for (const [sentH, sentM, nowH, nowM, dayShift, expected] of [
      [23, 40,  1, 10, 1, 'Yesterday'],  // the exact reported case
      [23, 59,  0,  1, 1, 'Yesterday'],  // one minute apart, across midnight
      [ 0,  5, 23, 55, 0, 'Today'],      // 23h50m apart, same calendar day
      [12,  0, 12,  0, 0, 'Today'],      // same instant
      [ 9,  0, 10,  0, 2, null],         // two days back is neither
    ]) {
      const sent = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sentH, sentM)
      const nowD = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayShift, nowH, nowM)
      const divider = fmtDateDivider(sent.toISOString(), nowD)
      if (expected) {
        check(
          divider === expected,
          'P10 divider names the right day',
          `sent ${label} ${sentH}:${String(sentM).padStart(2, '0')}, read +${dayShift}d ${nowH}:${String(nowM).padStart(2, '0')} -> "${divider}", expected "${expected}"`,
        )
      } else {
        check(
          divider !== 'Today' && divider !== 'Yesterday',
          'P10 an older message is neither Today nor Yesterday',
          `sent ${label}, read +${dayShift}d -> "${divider}"`,
        )
      }

      // fmtTime answers the same question and must never disagree with it.
      const t = fmtTime(sent.toISOString(), nowD)
      if (expected === 'Yesterday') {
        check(t === 'Yesterday', 'P10 fmtTime agrees on Yesterday', `${label} -> "${t}"`)
      }
      if (expected === 'Today') {
        check(t !== 'Yesterday', 'P10 fmtTime never calls today Yesterday', `${label} -> "${t}"`)
      }
    }
  }

  // ── P11 · the pre-session brief opens at the right instant ──────────────
  //
  // Every day of the year, at wall times chosen for the traps: midnight and
  // just after it (a Santiago spring-forward day has no 00:00), 01:30 and
  // 02:30 (inside northern gaps and overlaps), an afternoon session, and one
  // just before midnight.
  const MIN = 60000
  for (let i = 0; i < days.length; i++) {
    const today = days[i]
    const label = iso(today)
    for (const time of ['00:00', '00:10', '01:30', '02:30', '16:30:00', '23:55']) {
      const start = eventStart(label, time)
      // P11a · the start is on the event's own local date, at that wall time
      // — or, inside a spring-forward gap, a little after it (never before,
      // never another day).
      check(start !== null && iso(start) === label, 'P11a eventStart keeps the local date', `${label} ${time} -> ${start && start.toString()}`)
      if (!start) continue
      const [hh, mm] = time.split(':').map(Number)
      const wantMin = hh * 60 + mm
      const gotMin = start.getHours() * 60 + start.getMinutes()
      check(gotMin >= wantMin && gotMin - wantMin <= 60, 'P11a eventStart is that wall time', `${label} ${time} -> ${start.getHours()}:${start.getMinutes()}`)

      // P11b · the window edges, in elapsed minutes from the real instant.
      const at = (m) => new Date(start.getTime() + m * MIN)
      check(briefPhase(start, at(-BRIEF_LEAD_MINUTES - 1)) === 'early', 'P11b 21 min before is early', `${label} ${time}`)
      check(briefPhase(start, at(-BRIEF_LEAD_MINUTES)) === 'soon', 'P11b exactly 20 min before is soon', `${label} ${time}`)
      check(briefPhase(start, at(-1)) === 'soon', 'P11b 1 min before is soon', `${label} ${time}`)
      check(briefPhase(start, at(0)) === 'started', 'P11b the start is started', `${label} ${time}`)
      check(briefPhase(start, at(BRIEF_GRACE_MINUTES)) === 'started', 'P11b end of grace is started', `${label} ${time}`)
      check(briefPhase(start, at(BRIEF_GRACE_MINUTES + 1)) === 'past', 'P11b after grace is past', `${label} ${time}`)

      // P11c · upcomingBrief finds it from the other side of midnight. It is
      // given the event's DATE and judged on instants; a version that first
      // kept only "today's" events finds nothing at 23:50 for a 00:10 session.
      const ev = { id: 'e1', title: 'Senior A training', event_date: label, event_time: time, event_type: 'session', athlete_id: 'a1' }
      const sib = { ...ev, id: 'e2', athlete_id: 'a2' }
      const own = { ...ev, id: 'e3', athlete_id: null }
      const soon = upcomingBrief([ev, sib, own], at(-15))
      check(soon !== null && soon.event.id === 'e1' && soon.phase === 'soon', 'P11c found 15 min before', `${label} ${time} at ${at(-15).toString()}`)
      check(soon === null || soon.athleteCount === 2, 'P11c a squad session counts its athletes, not the coach copy', `${label} ${time} gave ${soon && soon.athleteCount}`)
      const late = upcomingBrief([ev], at(8))
      check(late !== null && late.phase === 'started', 'P11c found 8 min after the start', `${label} ${time} at ${at(8).toString()}`)
      check(upcomingBrief([ev], at(-BRIEF_LEAD_MINUTES - 1)) === null, 'P11c nothing 21 min before', `${label} ${time}`)
      check(upcomingBrief([ev], at(BRIEF_GRACE_MINUTES + 1)) === null, 'P11c nothing after grace', `${label} ${time}`)
      // The same wall time on the next day is a day away, not "now".
      const tomorrow = { ...ev, event_date: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)) }
      check(upcomingBrief([tomorrow], at(-15)) === null, 'P11c the same time tomorrow is not due', `${label} ${time}`)
    }
  }
  // P11d · labels are the wall time the coach typed, in every zone.
  for (const [t, want] of [['16:30:00', '4:30pm'], ['00:05', '12:05am'], ['12:00', '12:00pm'], ['09:07:00', '9:07am']]) {
    check(startLabel(t) === want, 'P11d startLabel', `${t} -> ${startLabel(t)}, want ${want}`)
  }
  check(eventStart('2027-02-31', '10:00') === null, 'P11d an impossible date is refused', '2027-02-31')
  check(eventStart('2027-03-01', null) === null, 'P11d an untimed event has no start', '2027-03-01')

  // ── P9 · todayISODate agrees with the local clock ───────────────────────
  const now = new Date()
  check(
    todayISODate() === iso(now),
    'P9 todayISODate matches the local date',
    `${todayISODate()} vs ${iso(now)}`,
  )

  // ── D · the weekly digest and takeaway reminder (lib/digest.ts) ────────
  await digestChecks(year, check, iso, days)

  return { zone, checks, failures }
}

// ── lib/digest.ts: the athlete's weekly digest and takeaway reminder ─────
//
// Its own block so the week rule is read in one place. The rule: the digest
// week is the Monday-to-Sunday week whose Sunday is the most recent Sunday on
// or before today; it shows by itself on Sunday, Monday and Tuesday. The
// awkward minutes are Sunday 23:30 and Monday 00:30 — the same digest week,
// an hour apart, often across a clock change — and Saturday 23:30 against
// Sunday 00:30, which are different weeks. Every Sunday of the year is stood
// on in every zone, so the DST weekends are in the walk rather than picked.
async function digestChecks(year, check, iso, days) {
  const D = await import(pathToFileURL(path.join(ROOT, 'lib/digest.ts')).href)
  const { calendarDaysBetween, parseISODate } =
    await import(pathToFileURL(path.join(ROOT, 'lib/session-date.ts')).href)
  const at = (d, h, m, plus = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus, h, m)

  for (let i = 0; i < days.length; i++) {
    const today = days[i]
    const label = iso(today)
    const dow = today.getDay()

    for (const [h, m] of [[0, 30], [12, 0], [23, 30]]) {
      const now = at(today, h, m)
      const w = D.digestWeek(now)
      const start = parseISODate(w.startISO)
      const end = parseISODate(w.endISO)
      const when = `${label} ${h}:${String(m).padStart(2, '0')}`

      // D1 · a week is Monday to Sunday, seven calendar days.
      check(start?.getDay() === 1, 'D1 digest week starts on a Monday', `${when} -> ${w.startISO}`)
      check(end?.getDay() === 0, 'D1 digest week ends on a Sunday', `${when} -> ${w.endISO}`)
      check(start && end && calendarDaysBetween(start, end) === 6, 'D1 digest week is seven days', `${when} -> ${w.startISO}..${w.endISO}`)

      // D2 · it is the week ending on the most recent Sunday on or before today.
      const back = end ? calendarDaysBetween(end, today) : NaN
      check(dow === 0 ? back === 0 : back >= 1 && back <= 6, 'D2 digest week ends on the latest Sunday', `${when} (day ${dow}) -> ends ${w.endISO}, ${back} days back`)
      check(w.endsToday === (dow === 0), 'D2 endsToday only on Sunday', `${when} -> ${w.endsToday}`)
      check(D.inDigestWeek(label, w) === (dow === 0), 'D2 today is inside the digest week only on Sunday', `${when}`)

      // D3 · it shows by itself on Sunday, Monday and Tuesday, at any hour.
      check(D.isDigestDay(now) === (dow === 0 || dow === 1 || dow === 2), 'D3 shown Sun-Tue only', `${when} (day ${dow}) -> ${D.isDigestDay(now)}`)

      // D4 · one session on each of the nine days around the week: the seven
      // inside count, the day before Monday and the day after Sunday do not.
      if (h === 0 || h === 23) {
        const around = []
        for (let k = -1; k <= 7; k++) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k)
          around.push({ id: 's' + k, session_date: iso(d), focus_points: ['Point ' + k], athlete_response: k % 2 ? 'got_it' : null })
        }
        const checkins = around.map((s) => ({ check_date: s.session_date }))
        const dg = D.buildDigest({ sessions: around, checkins, injuries: [] }, now)
        check(dg.sessions.length === 7, 'D4 seven sessions in the week', `${when} -> ${dg.sessions.length}`)
        check(dg.checkinDays === 7, 'D4 seven check-in days in the week', `${when} -> ${dg.checkinDays}`)
        check(dg.sessions[0]?.iso === w.startISO && dg.sessions[6]?.iso === w.endISO, 'D4 sessions run Monday to Sunday', `${when} -> ${dg.sessions.map((s) => s.iso).join(',')}`)
        check(dg.takeaways.length === 7, 'D4 one takeaway per session', `${when} -> ${dg.takeaways.length}`)

        // D5 · a timestamp is placed by the local day it happened on.
        const inj = (id, ts) => ({ id, body_area: 'knee', status: 'recovering', started_on: '2000-01-01', cleared_on: null, updated_at: ts })
        const firstMinute = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 30).toISOString()
        const lastMinute = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 30).toISOString()
        const before = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, 23, 30).toISOString()
        const after = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 30).toISOString()
        const ch = D.buildDigest({ sessions: [], checkins: [], injuries: [inj('a', firstMinute), inj('b', lastMinute), inj('c', before), inj('d', after)] }, now)
        check(ch.injuryChanges.map((c) => c.id).join() === 'a,b', 'D5 injury updates placed by local day', `${when} -> ${ch.injuryChanges.map((c) => c.id).join()}`)
      }
    }

    // D6 · Sunday 23:30 and the Monday 00:30 an hour later are the same digest
    // week; Saturday 23:30 and Sunday 00:30 are consecutive weeks.
    if (dow === 0 && i + 1 < days.length) {
      const sun = D.digestWeek(at(today, 23, 30))
      const mon = D.digestWeek(at(today, 0, 30, 1))
      check(sun.startISO === mon.startISO, 'D6 Sunday 23:30 and Monday 00:30 share a digest week', `${label}: ${sun.startISO} vs ${mon.startISO}`)
      if (i > 0) {
        const sat = D.digestWeek(at(today, 23, 30, -1))
        const sun0 = D.digestWeek(at(today, 0, 30))
        const gap = calendarDaysBetween(parseISODate(sat.startISO), parseISODate(sun0.startISO))
        check(gap === 7, 'D6 Saturday 23:30 and Sunday 00:30 are consecutive weeks', `${label}: ${sat.startISO} -> ${sun0.startISO}`)
      }
    }
  }

  // D7 · the reminder's pure parts: no clock, but pinned so they cannot drift.
  const ev = (event_date, event_time, extra = {}) => ({ created_by_role: 'coach', event_type: 'session', event_date, event_time, session_id: null, ...extra })
  const t = '2027-03-28'
  check(D.trainingToday([ev(t, '18:00:00'), ev(t, '07:15:00')], t)?.event_time === '07:15:00', 'D7 earliest planned session today', 'order')
  check(D.trainingToday([ev(t, null), ev(t, '16:30:00')], t)?.event_time === '16:30:00', 'D7 timed session before untimed', 'untimed')
  check(D.trainingToday([ev(t, '16:30', { session_id: 'x' })], t) === null, 'D7 a recorded session is not a planned one', 'session_id')
  check(D.trainingToday([ev(t, '16:30', { created_by_role: 'athlete' })], t) === null, 'D7 only the coach plans training', 'role')
  check(D.trainingToday([ev('2027-03-29', '16:30')], t) === null, 'D7 tomorrow is not today', 'date')
  for (const [inp, want] of [['16:30:00', '4:30pm'], ['00:05', '12:05am'], ['12:00', '12:00pm'], ['9:45', '9:45am'], [null, null], ['25:00', null]]) {
    check(D.formatEventTime(inp) === want, 'D7 formatEventTime', `${inp} -> ${D.formatEventTime(inp)}, want ${want}`)
  }
  const P = (takeaway, newestSessionISO, trainsToday) => D.takeawayPlacement({ takeaway, newestSessionISO, todayISO: t, trainsToday })
  check(P('Hands up', '2027-03-25', true) === 'top', 'D7 training day pins an older takeaway to the top', P('Hands up', '2027-03-25', true))
  check(P('Hands up', t, true) === 'card', 'D7 a takeaway from today stays in its card', P('Hands up', t, true))
  check(P('Hands up', '2027-03-25', false) === 'card', 'D7 no training, takeaway stays in its card', P('Hands up', '2027-03-25', false))
  check(P(null, '2027-03-25', true) === 'none', 'D7 no takeaway, no reminder', P(null, '2027-03-25', true))
  const rs = (responses) => D.replySentence({ sessions: responses.map((r, k) => ({ id: String(k), response: r })), replies: [
    { value: 'got_it', label: 'Got it', count: responses.filter((r) => r === 'got_it').length },
    { value: 'working_on_it', label: 'Working on it', count: responses.filter((r) => r === 'working_on_it').length },
    { value: 'not_clear', label: 'Not sure what you mean', count: responses.filter((r) => r === 'not_clear').length },
  ] })
  check(rs(['got_it', 'got_it', null]) === 'You said Got it to 2 of 3.', 'D7 reply sentence', rs(['got_it', 'got_it', null]))
  check(rs(['got_it', 'working_on_it', null]) === 'Of 3 sessions, you said Got it to 1 and Working on it to 1.', 'D7 reply sentence, two kinds', rs(['got_it', 'working_on_it', null]))
  check(D.formatWeekRange({ startISO: '2026-09-28', endISO: '2026-10-04' }) === '28 Sep – 4 Oct', 'D7 week range across a month', D.formatWeekRange({ startISO: '2026-09-28', endISO: '2026-10-04' }))
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
        // A file:// URL, for the same reason the dynamic imports above use one.
      // Fixing only those left this line failing identically —
      // ERR_UNSUPPORTED_ESM_URL_SCHEME on all nine zones — so `npm run verify`
      // still died at step two and the two rigs after it never ran at all.
      // Half a portability fix is indistinguishable from none.
      '--import', pathToFileURL(path.join(HERE, 'alias-register.mjs')).href,
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
