#!/usr/bin/env node
/**
 * Wellness rig — what pulled an athlete's score down, named honestly.
 *
 * The coach's roster used to show one flattened mean ("2.6") with no way to
 * tell a child who slept badly from one who is very stressed or very sore.
 * lib/wellness-config.ts wellnessDriver() names the cause. The part a reader
 * cannot check by eye is what it must NOT say: the two-tap check-in asks one
 * question and derives energy, mood and stress from it, so "Mood 2/5" on such
 * a row would report something the athlete was never asked.
 *
 * Runs the real module. Each rule was broken on purpose to watch it fail:
 *   W1  the readiness branch removed (a two-tap row reported "Energy 2")
 *   W2  the low bucket widened from `< 3` to `<= 3`
 *   W3  the sort dropped (worst no longer first)
 *   W4  the short form given the full list
 *   W5  notify_wellness_alerts dropped from caretakerPrefs (a parent switched
 *       off still listed); the picker's filter changed to `=== true`
 *   W6  the caretakers route reading the switches by hand again
 *
 * Usage:  npm run verify:wellness
 */

import { wellnessDriver, WELLNESS_METRICS } from '@/lib/wellness-config'
import { readinessToMetrics } from '@/lib/readiness'
import { regionLabel } from '@/lib/body-map'
import { caretakerPrefs, wellnessAlertRecipients } from '@/lib/caretaker-prefs'
import { readFileSync } from 'node:fs'

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'
const results = []
const check = (id, title, fn) => {
  let problems
  try { problems = fn() ?? [] } catch (e) { problems = [`threw: ${e.message}`] }
  results.push({ id, title, problems })
}
const row = (over) => ({ id: 'c', athlete_id: 'a', check_date: '2026-09-28', energy: 4, mood: 4, sleep_q: 4, soreness: 4, stress: 4, notes: null, ...over })
const twoTap = (readiness, areas) => row({ readiness, sore_areas: areas, sleep_q: null, ...readinessToMetrics(readiness, areas) })

check('W1', 'A two-tap check-in is described by what the athlete said, never by derived numbers', () => {
  const bad = []
  const flat = wellnessDriver(twoTap(1, []), regionLabel)
  if (!flat || flat.short !== 'Flat' || /Energy|Mood|Stress/.test(flat.full)) bad.push(`"Flat" reported as ${JSON.stringify(flat)}`)
  for (const r of [2, 3]) {
    const d = wellnessDriver(twoTap(r, []), regionLabel)
    if (d !== null) bad.push(`readiness ${r} with nothing sore gave ${JSON.stringify(d)} — nothing was low`)
  }
  const sore = wellnessDriver(twoTap(2, ['knee_l', 'lower_back']), regionLabel)
  if (!sore || sore.short !== 'Sore' || /knee_l|lower_back/.test(sore.full)) bad.push(`marked areas reported as ${JSON.stringify(sore)} — expected human region names`)
  const both = wellnessDriver(twoTap(1, ['knee_l']), regionLabel)
  if (!both || !both.full.includes('Felt flat') || !both.full.startsWith('Felt flat') || !both.full.includes('Sore:')) bad.push(`flat and sore reported as ${JSON.stringify(both)}`)
  return bad
})

check('W2', 'On a five-slider check-in, only metrics in the low bucket are named — 3 is OK, not low', () => {
  const bad = []
  if (wellnessDriver(row({ sleep_q: 3, stress: 3 })) !== null) bad.push('3/5 was named as a cause — it is the OK bucket, the same line metricColor draws')
  const one = wellnessDriver(row({ sleep_q: 2 }))
  if (!one || one.full !== 'Sleep 2/5') bad.push(`sleep 2 alone gave ${JSON.stringify(one)}`)
  if (wellnessDriver(row({ sleep_q: null, energy: null })) !== null) bad.push('unanswered metrics were treated as low')
  if (wellnessDriver(null) !== null) bad.push('no check-in produced a cause')
  return bad
})

check('W3', 'The worst metric comes first, ties in the app\'s own metric order', () => {
  const bad = []
  const d = wellnessDriver(row({ energy: 2, stress: 1, sleep_q: 2 }))
  if (!d || d.full !== 'Stress 1/5, Energy 2/5, Sleep 2/5' || d.short !== 'Stress 1') bad.push(`energy 2, sleep 2, stress 1 gave ${JSON.stringify(d)}`)
  return bad
})

check('W4', 'The short form fits under a roster tile (76px) in every case', () => {
  const bad = []
  // Every metric low at once is the case that matters: a short form that
  // lists them all wraps. (The first version had one low metric per case, and
  // stayed green when the short form was given the full list.)
  const allLow = row(Object.fromEntries(WELLNESS_METRICS.map((m) => [m.key, 1])))
  const cases = [twoTap(1, ['knee_l', 'knee_r', 'lower_back']), allLow, ...WELLNESS_METRICS.map((m) => row({ [m.key]: 1 }))]
  for (const c of cases) {
    const d = wellnessDriver(c, regionLabel)
    if (!d) { bad.push(`no cause for ${JSON.stringify(c)}`); continue }
    if (d.short.length > 11) bad.push(`"${d.short}" is ${d.short.length} characters — it wraps under a 76px tile`)
  }
  return bad
})

check('W5', 'A caretaker switched off for wellness alerts is saved off, and is not offered in the alert', () => {
  const bad = []
  const off = caretakerPrefs({ notify_wellness_alerts: false, notify_session_reports: false, notify_monthly_reports: false })
  if (off.notify_wellness_alerts !== false) bad.push('notify_wellness_alerts: false was not kept (the bug: the route dropped it and the default made it true)')
  if (off.notify_session_reports !== false || off.notify_monthly_reports !== false) bad.push('a session or monthly switch turned off was not kept')
  const unsent = caretakerPrefs({})
  if (!unsent.notify_wellness_alerts || !unsent.notify_session_reports || !unsent.notify_monthly_reports) bad.push('a switch the client did not send should be on, as the form defaults it')
  if (caretakerPrefs({ notify_wellness_alerts: 'false' }).notify_wellness_alerts !== true) bad.push('a non-boolean was read as a decision')
  const list = wellnessAlertRecipients([
    { id: 'on', notify_wellness_alerts: true },
    { id: 'off', notify_wellness_alerts: false },
    { id: 'old', notify_wellness_alerts: null },
  ]).map((c) => c.id)
  if (list.includes('off')) bad.push('a caretaker switched off is offered in the alert')
  if (!list.includes('on') || !list.includes('old')) bad.push(`expected on and old (null = never asked) to be offered, got ${JSON.stringify(list)}`)
  return bad
})

check('W6', 'The caretakers route and the alert picker use those two functions, not their own copy', () => {
  const bad = []
  const route = readFileSync(new URL('../app/api/caretakers/route.ts', import.meta.url), 'utf8')
  if (!/caretakerPrefs\(/.test(route) || !/\.\.\.prefs/.test(route)) bad.push('app/api/caretakers/route.ts does not save caretakerPrefs(body): a switch can be dropped again')
  const page = readFileSync(new URL('../app/athletes/[id]/page.tsx', import.meta.url), 'utf8')
  if (!/wellnessAlertRecipients\(/.test(page)) bad.push('the athlete page filters the alert picker itself')
  return bad
})

console.log(`\n${BOLD}Wellness rig${OFF} ${DIM}— lib/wellness-config.ts wellnessDriver, run for real${OFF}\n`)
let failed = 0
for (const r of results) {
  if (r.problems.length === 0) console.log(`  ${GREEN}✓${OFF} ${r.id}  ${r.title}`)
  else {
    failed++
    console.log(`  ${RED}✗ ${r.id}  ${r.title}${OFF}`)
    for (const p of r.problems) console.log(`      ${RED}·${OFF} ${p}`)
  }
}
console.log('')
if (failed) { console.log(`${RED}✗ ${failed} of ${results.length} wellness rules failed.${OFF}\n`); process.exit(1) }
console.log(`${GREEN}✓ ${results.length} wellness rules hold.${OFF}\n`)
