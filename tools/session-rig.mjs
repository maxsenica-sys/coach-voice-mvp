#!/usr/bin/env node
/**
 * tools/session-rig.mjs — a session after it was saved: shared later, edited,
 * deleted.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Found 2026-11-14 by the content audit, three bugs that all type-checked:
 *
 *   * A SHARE LATER WAS SILENT. The notify sat behind "the calendar sync
 *     inserted an event", and every session gets its event at save time, so a
 *     session saved private and shared later told the athlete nothing. The
 *     condition read sensibly and was never true.
 *   * NO EDIT, NO DELETE. A typo in a title or a wrong date lived for ever.
 *   * NOTES THAT SAID "YOUR NOTES" were shown to the athlete.
 *
 * Deleting is where the danger is. One recording about several athletes is one
 * row per athlete over the same audio file, so removing "this session's
 * recording" can silence every other athlete's copy. An athlete's own clip
 * about a session is the athlete's, not the coach's to delete. Each of those
 * is one wrong filter away, and each wrong filter type-checks.
 *
 * It imports the real modules (lib/session-edit.ts, lib/session-date.ts) and
 * reads the real route and page source for the wiring. Nothing is a copy.
 *
 * ── Proven by breaking it ─────────────────────────────────────────────────
 *
 * Each rule was watched going red against a deliberate break, then reverted:
 *   SE1  checkSessionDate without the round-trip (2026-02-30 accepted)
 *   SE1  latestDateOnEarth in UTC instead of UTC+14 (a Kiritimati today refused)
 *   SE2  checkSessionEdits cutting a six-point summary instead of refusing it
 *   SE3  sessionDeletePlan removing the audio even when another row plays it
 *   SE3  sessionDeletePlan removing the athlete's clip instead of detaching it
 *   SE4  deleteWarning without the "other athletes keep it" line
 *   SE5  PATCH notifying on the calendar sync's 'inserted' again
 *   SE5  PATCH notifying without the conditional first_shared_at claim
 *   SE6  DELETE without canSeeAthlete
 *   SE7  the notes label back to "Your notes"
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkSessionEdits, sessionDeletePlan, deleteWarning, MAX_TITLE_LENGTH,
} from '@/lib/session-edit'
import { checkSessionDate, latestDateOnEarth } from '@/lib/session-date'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const GREEN = '\x1b[32m', RED = '\x1b[31m', OFF = '\x1b[0m'

const results = []
const check = (id, title, fn) => {
  let problems
  try { problems = fn() ?? [] } catch (e) { problems = [`threw: ${e.message}`] }
  results.push({ id, title, problems })
}

/** The calendar date in a zone at an instant. */
const dateIn = (zone, at) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at)
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

check('SE1', 'a session date is a real day that is not in the future anywhere', () => {
  const p = []
  const now = new Date('2026-11-14T10:00:00Z')
  for (const bad of ['', 'yesterday', '2026-1-5', '2026-02-30', '2026-13-01', '2026-11-31', null, 20261114]) {
    if (checkSessionDate(bad, now).ok) p.push(`accepted ${JSON.stringify(bad)}`)
  }
  for (const good of ['2026-11-14', '2026-11-13', '2024-02-29', '2020-01-01']) {
    if (!checkSessionDate(good, now).ok) p.push(`refused ${good}`)
  }
  // Every hour of two days, in the zones at both ends of the clock: the
  // coach's own today is never refused, and the day after the latest date
  // on earth always is.
  const zones = ['Pacific/Kiritimati', 'Pacific/Chatham', 'Australia/Sydney', 'UTC', 'Europe/London', 'America/St_Johns', 'America/New_York', 'Pacific/Pago_Pago']
  for (let h = 0; h < 48; h++) {
    const at = new Date(Date.UTC(2027, 2, 27, h, 30)) // across the March DST weekend
    for (const z of zones) {
      const today = dateIn(z, at)
      if (!checkSessionDate(today, at).ok) p.push(`refused today (${today}) in ${z} at ${at.toISOString()}`)
    }
    const tooLate = addDays(latestDateOnEarth(at), 1)
    if (checkSessionDate(tooLate, at).ok) p.push(`accepted ${tooLate}, after the latest date on earth, at ${at.toISOString()}`)
  }
  return p
})

check('SE2', 'an edit is normalised, and a long summary is refused, never cut', () => {
  const p = []
  const now = new Date('2026-11-14T10:00:00Z')
  const untouched = checkSessionEdits({ shared_with_athlete: true }, now)
  if (!untouched.ok || Object.keys(untouched.updates).length) p.push('a body with no edits produced updates')
  const t = checkSessionEdits({ session_name: '  Serve receive  ' }, now)
  if (!t.ok || t.updates.session_name !== 'Serve receive') p.push('the title is not trimmed')
  const blank = checkSessionEdits({ session_name: '   ' }, now)
  if (!blank.ok || blank.updates.session_name !== null) p.push('a blank title is not cleared to null')
  if (checkSessionEdits({ session_name: 'x'.repeat(MAX_TITLE_LENGTH + 1) }, now).ok) p.push('an over-long title is accepted')
  if (checkSessionEdits({ session_name: 42 }, now).ok) p.push('a non-text title is accepted')
  const five = '• a\n• b\n\n• c\n• d\n• e'
  const s5 = checkSessionEdits({ summary: five }, now)
  if (!s5.ok || s5.updates.summary !== '• a\n• b\n• c\n• d\n• e') p.push('a five-point summary is not kept whole')
  const six = checkSessionEdits({ summary: five + '\n• f' }, now)
  if (six.ok) p.push('a six-point summary is accepted (and would be cut by the cap)')
  else if (!/6/.test(six.error)) p.push('the refusal does not say how many points there are')
  const empty = checkSessionEdits({ summary: '  \n ' }, now)
  if (!empty.ok || empty.updates.summary !== null) p.push('an emptied summary is not cleared to null')
  if (checkSessionEdits({ session_date: '2099-01-01' }, now).ok) p.push('a future date is accepted through an edit')
  const d = checkSessionEdits({ session_date: '2026-11-01' }, now)
  if (!d.ok || d.updates.session_date !== '2026-11-01') p.push('a past date is not accepted')
  return p
})

check('SE3', 'deleting one row never takes a file another row plays, or the athlete\'s clip', () => {
  const p = []
  const base = {
    audioPath: 'coach/h1/rec.mp4',
    audioUsedElsewhere: false,
    videos: [
      { id: 'v1', storage_path: 'h1/s1/coach.mp4', uploaded_by_role: 'coach' },
      { id: 'v2', storage_path: 'athlete/x1/clip.mp4', uploaded_by_role: 'athlete' },
      { id: 'v3', storage_path: 'h1/s1/legacy.mp4', uploaded_by_role: null },
    ],
    attachments: [{ storage_path: 'attachments/h1/s1/a.jpg' }, { storage_path: 'attachments/h1/s1/a.jpg' }],
    pathsUsedElsewhere: [],
  }
  const plan = sessionDeletePlan(base)
  if (plan.removeAudioPath !== 'coach/h1/rec.mp4') p.push('a one-to-one recording is not removed')
  if (sessionDeletePlan({ ...base, audioUsedElsewhere: true }).removeAudioPath !== null) {
    p.push('the recording is removed while another athlete\'s row still plays it')
  }
  if (plan.detachVideoIds.join() !== 'v2') p.push(`the athlete's clip is not the one kept: ${plan.detachVideoIds}`)
  if (plan.removeVideoPaths.includes('athlete/x1/clip.mp4')) p.push('the athlete\'s clip file is removed')
  for (const want of ['h1/s1/coach.mp4', 'h1/s1/legacy.mp4', 'attachments/h1/s1/a.jpg']) {
    if (!plan.removeVideoPaths.includes(want)) p.push(`${want} is left in storage with nothing pointing at it`)
  }
  if (plan.removeVideoPaths.length !== new Set(plan.removeVideoPaths).size) p.push('a path is removed twice')
  const shared = sessionDeletePlan({ ...base, pathsUsedElsewhere: ['h1/s1/coach.mp4'] })
  if (shared.removeVideoPaths.includes('h1/s1/coach.mp4')) p.push('a video another row still uses is removed')
  if (sessionDeletePlan({ ...base, audioPath: null }).removeAudioPath !== null) p.push('a session with no recording removes one')
  return p
})

check('SE4', 'the delete dialog names what goes and what stays', () => {
  const p = []
  const w = deleteWarning({ athleteFirst: 'Mia', hasRecording: true, coachVideoCount: 2, imageCount: 1, athleteClipCount: 1, partOfGroup: true, shared: true })
  const goes = w.goes.join(' | '), stays = w.stays.join(' | ')
  if (!/2 videos/.test(goes)) p.push('the coach\'s videos are not counted')
  if (!/1 image\b/.test(goes)) p.push('one image is not said in the singular')
  if (!/calendar/i.test(goes)) p.push('the calendar entry is not mentioned')
  if (!/Mia's copy of the recording/.test(goes)) p.push('a group row does not say only Mia\'s copy goes')
  if (!/other athletes/.test(stays)) p.push('a group row does not say the other athletes keep theirs')
  if (!/1 clip Mia sent you/.test(stays)) p.push('the athlete\'s clip is not said to stay')
  if (!/notes Mia wrote/.test(stays)) p.push('the athlete\'s own notes are not said to stay')
  const solo = deleteWarning({ athleteFirst: '', hasRecording: true, coachVideoCount: 0, imageCount: 0, athleteClipCount: 0, partOfGroup: false, shared: false })
  if (/other athletes/.test(solo.stays.join())) p.push('a one-to-one session talks about other athletes')
  if (!/recording and its transcript/.test(solo.goes.join())) p.push('a one-to-one recording is not said to go')
  if (/undefined|null/.test([...solo.goes, ...solo.stays].join())) p.push('a missing name prints as undefined')
  return p
})

check('SE5', 'a later share tells the athlete once, and only the first time', () => {
  const p = []
  const patch = src('app/api/sessions/[id]/route.ts')
  const handler = patch.slice(patch.indexOf('export async function PATCH'), patch.indexOf('export async function DELETE'))
  if (/outcome\s*===\s*'inserted'/.test(handler)) p.push('the notify is gated on the calendar sync inserting again')
  const claim = handler.search(/\.update\(\{\s*first_shared_at:[\s\S]{0,120}?\.is\('first_shared_at',\s*null\)/)
  if (claim < 0) p.push('no conditional first_shared_at claim (where first_shared_at is null)')
  for (const fn of ['notifySessionShared(', 'notifyPushSessionShared(']) {
    const at = handler.indexOf(fn)
    if (at < 0) p.push(`${fn.slice(0, -1)} is not sent on a later share`)
    else if (claim >= 0 && at < claim) p.push(`${fn.slice(0, -1)} is sent before the claim decides it is the first share`)
  }
  if (!/claimed\s*\?\?\s*\[\]\)\.length\s*===\s*1/.test(handler)) p.push('the notify does not depend on the claim having changed a row')
  const post = src('app/api/sessions/route.ts')
  if (!/shared_with_athlete\s*\?\s*\{\s*first_shared_at:/.test(post)) p.push('a session shared at save is not claimed, so a re-toggle would notify twice')
  const mig = src('supabase/migrations/037_session_first_shared.sql')
  if (!/set first_shared_at = created_at[\s\S]*where shared_with_athlete = true/.test(mig)) p.push('sessions already shared are not back-filled, so re-toggling one re-notifies')
  return p
})

check('SE6', 'delete is scoped to what the caller may delete, and removes files', () => {
  const p = []
  const route = src('app/api/sessions/[id]/route.ts')
  const del = route.slice(route.indexOf('export async function DELETE'))
  if (!del.includes('export async function DELETE')) return ['there is no DELETE handler']
  if (!/canSeeAthlete\(scope,/.test(del)) p.push('an assistant is not narrowed to the athletes they were given')
  if (!/if \(!scope\.isHead\) read = read\.eq\('recorded_by', user\.id\)/.test(del)) p.push('an assistant is not limited to what they recorded')
  if (!/sessionDeletePlan\(/.test(del)) p.push('the delete does not use the plan (lib/session-edit.ts)')
  if (!/storage\.from\('session-videos'\)\.remove/.test(del) || !/storage\.from\('session-audio'\)\.remove/.test(del)) p.push('files are not removed, only rows')
  if (!/supabase\.from\('sessions'\)\.delete\(\)/.test(del)) p.push('the row is not deleted through the caller\'s own client (the database must decide too)')
  if (!/\.update\(\{ session_id: null \}\)/.test(del)) p.push('the athlete\'s clips are not moved off the session before it goes')
  const mig = src('supabase/migrations/037_session_first_shared.sql')
  if (!/on delete set null/i.test(mig)) p.push('an athlete\'s own notes still cascade away with the session')
  const detail = src('app/api/sessions/[id]/detail/route.ts')
  if (!/can_edit:\s*isCoach && \(scope\.isHead \|\| session\.recorded_by === user\.id\)/.test(detail)) p.push('the page is told it may edit when the caller may not')
  return p
})

check('SE7', 'session notes say who reads them', () => {
  const p = []
  const page = src('app/sessions/[id]/page.tsx')
  if (/'Your notes'/.test(page)) p.push('the coach\'s label is "Your notes", but the athlete reads them')
  if (!/sees these\./.test(page) || !/will see these if you share this session/.test(page)) p.push('the coach is not told who sees the notes')
  if (!/Private notes go on/.test(page)) p.push('the coach is not pointed to the private notes')
  if (/Anything worth remembering/.test(page)) p.push('the placeholder still invites private context')
  return p
})

let failed = 0
for (const r of results) {
  if (r.problems.length === 0) {
    console.log(`   ${GREEN}PASS${OFF}  ${r.id}  ${r.title}`)
  } else {
    failed++
    console.log(`   ${RED}FAIL${OFF}  ${r.id}  ${r.title}`)
    for (const m of r.problems) console.log(`         ${RED}·${OFF} ${m}`)
  }
}
console.log('')
if (failed) {
  console.log(`  ${RED}✗ ${failed} of ${results.length} session checks failed.${OFF}\n`)
  process.exit(1)
}
console.log(`  ${GREEN}✓ ${results.length} session checks hold.${OFF}\n`)
