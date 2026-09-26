#!/usr/bin/env node
/**
 * tools/checkin-queue-rig.mjs — does a check-in made with no signal arrive,
 * on the right day, or say plainly that it did not?
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * lib/checkin-queue.ts keeps a check-in on the phone when the athlete has no
 * signal and sends it later. Two things about that are easy to get wrong and
 * invisible to tsc:
 *
 *   * WHICH DAY. app/api/wellness/route.ts accepts check_date only within one
 *     day of UTC today and silently rewrites anything else to today. A queued
 *     Tuesday answer sent on Thursday would be filed as Thursday's. The queue
 *     must apply the same window first — in UTC, in every timezone, across
 *     midnight and across a DST change — and drop what falls outside it.
 *
 *   * WHAT COUNTS AS OFFLINE. Only a network failure may be queued. A 400 must
 *     be shown, not kept and re-sent for a day. The signal comes from the
 *     wording of an Error in lib/api-client.ts, so C5 drives the REAL apiMutate
 *     into a failing fetch and checks the wording is still recognised.
 *
 * It imports the real module. Nothing here is a copy of the logic.
 *
 * ── Proven by breaking it ─────────────────────────────────────────────────
 *
 * Each rule was watched going red against a deliberate break in
 * lib/checkin-queue.ts, then the break was reverted:
 *   C1  utcDateShift using local getDate()/setDate() instead of UTC
 *   C2  the window compare changed from `<` to `<=` (off by one at midnight)
 *   C3  checkinDayLabel via new Date(iso).getDay()
 *   C4  classifyResponse treating 401 as permanent
 *   C5  isOfflineFailure without the "Network error" match
 *   C6  runDrain without the sort, and without the stop-on-offline
 *   C7  drainCheckins without the in-flight guard
 *   C8  the route line changed to shift(-2), in a copy of the route (not the route)
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiMutate } from '@/lib/api-client'
import {
  sendability, checkinDayLabel, classifyResponse, isOfflineFailure,
  runDrain, drainCheckins, checkinKey, queueNote,
} from '@/lib/checkin-queue'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m'
const DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'

const results = []
const check = async (id, title, why, fn) => {
  let problems
  try { problems = (await fn()) ?? [] } catch (e) { problems = [`threw: ${e.message}`] }
  results.push({ id, title, why, problems })
}

// Node re-reads TZ when process.env.TZ is assigned, so one process can run
// the same assertions in every zone. Confirmed below rather than assumed.
const ZONES = [
  'UTC', 'Europe/London', 'America/New_York', 'America/St_Johns', 'Pacific/Honolulu',
  'Pacific/Auckland', 'Pacific/Kiritimati', 'Australia/Lord_Howe', 'Asia/Kolkata',
]
function inEveryZone(fn) {
  const bad = []
  const original = process.env.TZ
  for (const tz of ZONES) {
    process.env.TZ = tz
    const probe = new Date('2026-07-01T12:00:00Z').getTimezoneOffset()
    if (tz === 'Pacific/Honolulu' && probe !== 600) bad.push(`TZ switch did not take effect (${tz} offset ${probe})`)
    for (const p of fn(tz)) bad.push(`[${tz}] ${p}`)
  }
  if (original === undefined) delete process.env.TZ; else process.env.TZ = original
  return bad
}

// Each case: the check_date the phone stored, the instant the drain runs, and
// what the server would do with it. Instants are absolute, so the expected
// answer is the same in every zone the rig runs in.
const WINDOW_CASES = [
  ['2026-09-22', '2026-09-22T12:00:00Z', 'send', 'same day'],
  ['2026-09-22', '2026-09-23T23:59:59Z', 'send', 'last second of UTC tomorrow — still inside the window'],
  ['2026-09-22', '2026-09-24T00:00:00Z', 'expired', 'UTC midnight two days on — the server would rewrite it'],
  ['2026-09-22', '2026-09-30T08:00:00Z', 'expired', 'a week later'],
  // Europe/London, clocks go back 01:00Z on 25 Oct 2026. Checked in 23:30 BST Sat.
  ['2026-10-24', '2026-10-25T23:30:00Z', 'send', 'London, across the autumn DST change, next evening'],
  ['2026-10-24', '2026-10-26T00:00:30Z', 'expired', 'London, across the DST change, just past UTC midnight'],
  // America/New_York, clocks go forward 14 Mar 2027. Checked in 23:50 EST Sat 13th (04:50Z 14th).
  ['2027-03-13', '2027-03-14T23:59:00Z', 'send', 'New York, across the spring DST change'],
  ['2027-03-13', '2027-03-15T00:00:00Z', 'expired', 'New York, across the spring DST change, a day on'],
  // Pacific/Kiritimati is UTC+14: local Tue 00:30 is Mon 10:30Z.
  ['2026-09-22', '2026-09-21T10:30:00Z', 'send', 'UTC+14 checking in just after local midnight'],
  ['2026-09-23', '2026-09-21T10:30:00Z', 'hold', 'two days ahead of UTC — only a wrong phone clock does this'],
  // Pacific/Honolulu is UTC-10: local Mon 23:00 is Tue 09:00Z; local Tue 14:00 is Wed 00:00Z.
  ['2026-09-21', '2026-09-22T23:59:00Z', 'send', 'Honolulu, late Monday, sent Tuesday lunchtime'],
  ['2026-09-21', '2026-09-23T00:00:00Z', 'expired', 'Honolulu, late Monday, sent Tuesday 14:00 local'],
  // Year and leap boundaries.
  ['2026-12-31', '2027-01-01T23:00:00Z', 'send', 'across New Year'],
  ['2028-02-28', '2028-03-01T00:00:00Z', 'expired', 'leap year: 29 Feb exists, so 28 Feb is two days back'],
  ['2028-02-29', '2028-03-01T12:00:00Z', 'send', 'leap day itself'],
  // Not a real date: the server would rewrite it, so it must not be sent.
  ['2026-02-30', '2026-02-28T12:00:00Z', 'expired', 'impossible date'],
  ['22/09/2026', '2026-09-22T12:00:00Z', 'expired', 'wrong format'],
]

await check('C1', 'A queued check-in is sendable exactly when the server would keep its date',
  'app/api/wellness/route.ts files anything outside UTC today ± 1 under UTC today. Sending such an item gives the coach — and the wellness alert that emails parents — an answer for a day the athlete never answered.',
  () => inEveryZone(() => WINDOW_CASES
    .map(([date, at, want, why]) => [sendability(date, new Date(at)), date, at, want, why])
    .filter(([got, , , want]) => got !== want)
    .map(([got, date, at, want, why]) => `${date} at ${at}: got ${got}, want ${want} (${why})`)))

await check('C2', 'The window edge is the server\'s edge — not a day early, not a day late',
  'Off by one here either drops a check-in the server would have kept or sends one it would rewrite. Walked hour by hour through two days around one date.',
  () => inEveryZone(() => {
    const bad = []
    for (let h = 0; h < 72; h++) {
      const at = new Date(Date.UTC(2026, 8, 22, h, 0, 0))
      const want = h < 48 ? 'send' : 'expired'
      const got = sendability('2026-09-22', at)
      if (got !== want) bad.push(`${at.toISOString()}: got ${got}, want ${want}`)
    }
    return bad.slice(0, 4)
  }))

await check('C3', 'The note names the right weekday in every timezone',
  '"A check-in from Tue couldn\'t be sent in time" must say the day the athlete checked in. new Date("2026-09-22") is Monday west of Greenwich.',
  () => inEveryZone(() => {
    const want = { '2026-09-22': 'Tue', '2026-10-25': 'Sun', '2027-03-14': 'Sun', '2026-12-31': 'Thu', '2028-02-29': 'Tue' }
    const bad = Object.entries(want).filter(([d, w]) => checkinDayLabel(d) !== w).map(([d, w]) => `${d}: got ${checkinDayLabel(d)}, want ${w}`)
    const note = queueNote({ key: 'k', id: 'i', queuedAt: 0, attempts: 0, lastError: null, status: 'expired',
      payload: { athlete_id: 'a', check_date: '2026-09-22', readiness: 3, sore_areas: [], session_event_id: null, injury_update: null } })
    if (note !== 'A check-in from Tue couldn’t be sent in time.') bad.push(`expired note reads ${JSON.stringify(note)}`)
    return bad
  }))

await check('C4', 'Only a real refusal gives up; a sign-in or a bad moment retries',
  'A 401 at the field is an expired session, not a bad check-in — the athlete signs in again and it should still arrive. A 400 will be refused forever and must stop being sent.',
  () => {
    const want = { 200: 'sent', 201: 'sent', 204: 'sent', 400: 'rejected', 403: 'rejected', 404: 'rejected', 422: 'rejected',
      401: 'retry', 408: 'retry', 429: 'retry', 500: 'retry', 502: 'retry', 503: 'retry', 504: 'retry' }
    return Object.entries(want).filter(([s, w]) => classifyResponse(+s) !== w).map(([s, w]) => `${s}: got ${classifyResponse(+s)}, want ${w}`)
  })

await check('C5', 'The real apiMutate\'s network failure is recognised as offline; a server "no" is not',
  'CheckIn queues only when isOfflineFailure says so, and that reads the wording of apiMutate\'s Error. If lib/api-client.ts rewords it, every offline check-in goes back to being lost — this is where that shows up.',
  async () => {
    const bad = []
    const realFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
      try { await apiMutate('/api/wellness', { method: 'POST' }); bad.push('apiMutate did not throw on a network failure') }
      catch (e) { if (!isOfflineFailure(e, true)) bad.push(`network failure not recognised: ${JSON.stringify(e.message)}`) }

      for (const status of [400, 401, 403, 500, 503]) {
        globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Pick how you are feeling first.' }), { status, headers: { 'Content-Type': 'application/json' } })
        try { await apiMutate('/api/wellness', { method: 'POST' }); bad.push(`apiMutate did not throw on ${status}`) }
        catch (e) { if (isOfflineFailure(e, true)) bad.push(`a ${status} from the server was treated as offline: ${JSON.stringify(e.message)}`) }
      }
      if (!isOfflineFailure(new Error('anything'), false)) bad.push('navigator.onLine === false was not treated as offline')
    } finally {
      globalThis.fetch = realFetch
    }
    return bad
  })

// An in-memory store with the IndexedDB store's compare-by-id semantics.
function memStore(rows) {
  const m = new Map(rows.map((r) => [r.key, { ...r }]))
  return {
    rows: m,
    async list() { return [...m.values()].map((r) => ({ ...r })) },
    async patchIfUnchanged(key, id, patch) { const c = m.get(key); if (c && c.id === id) m.set(key, { ...c, ...patch }) },
    async removeIfUnchanged(key, id) { const c = m.get(key); if (c && c.id === id) m.delete(key) },
  }
}
const row = (athlete, date, queuedAt, extra = {}) => ({
  key: checkinKey(athlete, date), id: `${athlete}-${date}-${queuedAt}`, queuedAt, status: 'queued', attempts: 0, lastError: null,
  payload: { athlete_id: athlete, check_date: date, readiness: 3, sore_areas: [], session_event_id: null, injury_update: null },
  ...extra,
})
const NOW = () => new Date('2026-09-23T09:00:00Z')

await check('C6', 'The drain sends oldest first, keeps what the network lost, and says what it gave up on',
  'Out of order, an older answer lands after a newer one for another day and nothing is wrong — but a pass that keeps hammering after the first network failure drains a battery at the field, and one that drops a row on a 503 loses an answer.',
  async () => {
    const bad = []
    // 1. Order, outcomes by status, expiry.
    {
      const store = memStore([
        row('a', '2026-09-23', 30), row('a', '2026-09-22', 10), row('b', '2026-09-23', 20),
        row('c', '2026-09-23', 40), row('d', '2026-09-23', 50), row('e', '2026-09-20', 5),
        row('f', '2026-09-19', 1, { status: 'expired' }),
      ])
      const sentOrder = []
      const statusFor = { a: 200, b: 400, c: 503, d: 401 }
      const r = await runDrain({ store, now: NOW, send: async (p) => {
        sentOrder.push(`${p.athlete_id}:${p.check_date}`)
        return { network: false, status: statusFor[p.athlete_id], message: statusFor[p.athlete_id] === 200 ? null : 'Nope.' }
      } })
      const wantOrder = ['a:2026-09-22', 'b:2026-09-23', 'a:2026-09-23', 'c:2026-09-23', 'd:2026-09-23']
      if (sentOrder.join() !== wantOrder.join()) bad.push(`send order ${sentOrder.join(' ')} — want ${wantOrder.join(' ')}`)
      const s = (a, d) => store.rows.get(checkinKey(a, d))
      if (s('a', '2026-09-22') || s('a', '2026-09-23')) bad.push('a 200 did not remove the row')
      if (s('b', '2026-09-23')?.status !== 'rejected' || s('b', '2026-09-23')?.lastError !== 'Nope.') bad.push('a 400 did not become a rejected note with lastError')
      if (s('c', '2026-09-23')?.status !== 'queued' || s('c', '2026-09-23')?.attempts !== 1) bad.push('a 503 did not keep the row queued with attempts counted')
      if (s('d', '2026-09-23')?.status !== 'queued') bad.push('a 401 gave up on the row')
      if (s('e', '2026-09-20')?.status !== 'expired') bad.push('a three-day-old item was not marked expired')
      if (sentOrder.some((x) => x.startsWith('e:') || x.startsWith('f:'))) bad.push('an expired item was sent')
      if (r.sent !== 2 || r.rejected !== 1 || r.expired !== 1 || r.kept !== 2) bad.push(`counts ${JSON.stringify(r)}`)
    }
    // 2. Network failure: row untouched, pass stops.
    {
      const store = memStore([row('a', '2026-09-23', 1), row('b', '2026-09-23', 2)])
      let calls = 0
      const r = await runDrain({ store, now: NOW, send: async () => { calls++; throw new TypeError('Failed to fetch') } })
      if (calls !== 1) bad.push(`kept sending after the network failed (${calls} sends)`)
      const a = store.rows.get(checkinKey('a', '2026-09-23'))
      if (!a || a.status !== 'queued' || a.attempts !== 0) bad.push('a network failure changed or removed the row')
      if (r.kept !== 2) bad.push(`network pass kept ${r.kept}, want 2`)
    }
    // 3. A newer answer saved mid-send is not deleted by the drain.
    {
      const store = memStore([row('a', '2026-09-23', 1)])
      await runDrain({ store, now: NOW, send: async () => {
        store.rows.set(checkinKey('a', '2026-09-23'), row('a', '2026-09-23', 2))
        return { network: false, status: 200, message: null }
      } })
      if (store.rows.get(checkinKey('a', '2026-09-23'))?.id !== 'a-2026-09-23-2') bad.push('the drain deleted a newer check-in saved while it was sending')
    }
    return bad
  })

await check('C7', 'Two drains at once send each check-in once',
  'CheckIn drains on mount and on "online", and the athlete page drains on its own mount — on a phone regaining signal those land together. Two passes would POST twice, and each POST can email a parent a wellness alert.',
  async () => {
    const store = memStore([row('a', '2026-09-23', 1), row('b', '2026-09-23', 2)])
    let sends = 0
    const deps = { store, now: NOW, send: async () => { sends++; await new Promise((r) => setTimeout(r, 20)); return { network: false, status: 200, message: null } } }
    const [x, y] = await Promise.all([drainCheckins(deps), drainCheckins(deps)])
    const bad = []
    if (sends !== 2) bad.push(`${sends} POSTs for 2 queued check-ins`)
    if (x.sent !== 2 || y.sent !== 2) bad.push(`results disagree: ${JSON.stringify(x)} / ${JSON.stringify(y)}`)
    const z = await drainCheckins(deps)
    if (z.sent !== 0) bad.push('a later drain re-sent rows already sent')
    return bad
  })

await check('C8', 'The server still uses the window C1 assumes',
  'C1 tests the queue against a copy of the server\'s rule, because the rule lives inline in the route. This is the tripwire: if the route\'s window changes, the queue\'s must change with it, and this goes red until someone looks.',
  () => {
    const src = readFileSync(join(ROOT, 'app/api/wellness/route.ts'), 'utf8')
    return /check_date\s*>=\s*shift\(-1\)\s*&&\s*check_date\s*<=\s*shift\(1\)/.test(src) && /toISOString\(\)\.split\('T'\)\[0\]/.test(src)
      ? []
      : ['app/api/wellness/route.ts no longer reads `check_date >= shift(-1) && check_date <= shift(1)` against a UTC today — re-check sendability() in lib/checkin-queue.ts']
  })

console.log(`\n  ${DIM}Check-in queue rig — does an offline check-in arrive on the right day, or say it did not?${OFF}\n`)

let failed = 0
for (const r of results) {
  if (r.problems.length === 0) {
    console.log(`   ${GREEN}PASS${OFF}  ${r.id}  ${r.title}`)
  } else {
    failed += r.problems.length
    console.log(`   ${RED}FAIL${OFF}  ${r.id}  ${r.title}`)
    console.log(`         ${DIM}Why this rule exists:${OFF} ${r.why}`)
    for (const p of r.problems.slice(0, 8)) console.log(`         ${RED}${p}${OFF}`)
    if (r.problems.length > 8) console.log(`         ${RED}…and ${r.problems.length - 8} more${OFF}`)
  }
}

console.log(`\n  ${BOLD}KNOWN GAPS${OFF} ${DIM}— what this rig cannot see${OFF}`)
for (const gap of [
  'IndexedDB itself. Node has none, so the compare-by-id writes in the real store are exercised in a browser, not here; C6 holds the drain loop to the same semantics over an in-memory store.',
  'The server\'s window is copied as a rule, not imported: it lives inline in app/api/wellness/route.ts. C8 is a text match on that line, so a rewrite that keeps the meaning goes red, and one that changes the meaning in different words stays green.',
  'A phone whose clock is wrong. The drain judges "too old" by the phone\'s clock and the server by its own; a phone set a day behind can send an item the server then rewrites.',
  'Athletes west of UTC get less than a day and a half: an answer from late Monday in Honolulu is out of the window by Tuesday 14:00 local. That is the server\'s rule, reported honestly, not a bug here.',
]) {
  const wrapped = gap.match(/.{1,74}(\s|$)/g) ?? [gap]
  console.log(`   ${YELLOW}·${OFF} ${wrapped.map((l, i) => (i ? '     ' + l.trim() : l.trim())).join('\n')}`)
}

console.log('')
if (failed === 0) {
  console.log(`  ${GREEN}✓ ${results.length} check-in queue rules hold.${OFF}\n`)
  process.exit(0)
}
console.log(`  ${RED}✗ ${failed} check-in queue violation${failed === 1 ? '' : 's'}.${OFF}\n`)
process.exit(1)
