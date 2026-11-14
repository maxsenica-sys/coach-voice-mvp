#!/usr/bin/env node
/**
 * Recording rig — a recording stopped but never saved can be finished, and is
 * never thrown away behind the coach's back.
 *
 * Found 2026-11-14: such a recording sat under "On this phone" with only a
 * Discard button and was deleted automatically after 14 days. Now it can be
 * finished (lib/recording-finish.ts), and the save goes through the queue's
 * own body builder (lib/recording-sync.ts sessionBodies), which this rig runs
 * against the finished row so the join between the two is held, not assumed.
 *
 * Runs the real modules. Each rule was broken on purpose to watch it fail:
 *   RQ1  allowedFinishModes let a squad recording finish as one athlete
 *   RQ2  finishPatch for 'several' dropped the shared id
 *   RQ3  isStale counted a row the coach had asked to save
 *   RQ4  the panel's sweep put back (deleteRecording outside Discard)
 *   RQ5  the recorder's close button wired straight to onClose again
 *
 * Usage:  npm run verify:recording
 */

import { readFileSync } from 'node:fs'
import { allowedFinishModes, finishPatch, isStale, describePending, STALE_AFTER_MS } from '@/lib/recording-finish'
import { sessionBodies } from '@/lib/recording-sync'

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'
const results = []
const check = (id, title, fn) => {
  let problems
  try { problems = fn() ?? [] } catch (e) { problems = [`threw: ${e.message}`] }
  results.push({ id, title, problems })
}
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

const NOW = Date.UTC(2026, 10, 14, 9)
const row = (over = {}) => ({
  id: 'rec-1', createdAt: NOW - 60_000, blob: null, mimeType: 'audio/mp4',
  mode: 'athlete', athleteId: null, groupId: null, athleteIds: [], drafts: {}, sharedRecordingId: null,
  groupName: null, memberIds: [], rosterNames: [], targetLabel: 'Athlete not chosen yet',
  sessionName: '', delivery: null, sessionDate: '2026-11-14', coachSport: 'volleyball', shareWithAthlete: true,
  stage: 'uploaded', audioPath: 'coach/u/x.mp4', transcript: null, ready: false, attempts: 0, lastError: null,
  ...over,
})
const mia = { id: 'a-mia', first_name: 'Mia', last_name: 'Chen' }
const leo = { id: 'a-leo', first_name: 'Leo', last_name: 'Bridgeford' }
const squad = { id: 'g-1', name: 'Under 16s', member_ids: ['a-mia', 'a-leo'] }

check('RQ1', 'A recording keeps the kind it was made as, or one that withholds more', () => {
  const bad = []
  const a = allowedFinishModes('athlete'), g = allowedFinishModes('group'), s = allowedFinishModes('several')
  if (!a.includes('athlete') || !a.includes('group')) bad.push(`one-athlete recording should finish as athlete or squad, got ${a}`)
  if (g.join() !== 'group') bad.push(`a squad talk must stay a squad talk (finishing it "for Mia" hands her the transcript about everyone), got ${g}`)
  if (s.join() !== 'several') bad.push(`a split recording must stay split, got ${s}`)
  const out = finishPatch(row({ mode: 'group' }), { mode: 'athlete', transcript: 'said things', share: true, athlete: mia })
  if (!('error' in out)) bad.push('finishPatch accepted a squad recording as one athlete\'s session')
  return bad
})

check('RQ2', 'A finished row saves through the queue\'s own bodies, to exactly who was chosen', () => {
  const bad = []
  const none = finishPatch(row(), { mode: 'athlete', transcript: '   ', share: true, athlete: mia })
  if (!('error' in none)) bad.push('saved with no transcript')
  const noOne = finishPatch(row(), { mode: 'athlete', transcript: 'serve toss lower', share: true, athlete: null })
  if (!('error' in noOne)) bad.push('saved with nobody chosen')

  const one = finishPatch(row(), { mode: 'athlete', transcript: ' serve toss lower ', share: false, athlete: mia, summary: 'Toss lower.', next: 'Toss below the hand.' })
  if ('error' in one) return [`athlete finish refused: ${one.error}`]
  const r1 = { ...row(), ...one.patch }
  if (!r1.ready) bad.push('a finished row is not marked to send')
  const b1 = sessionBodies(r1, r1.transcript, r1.audioPath)
  if (b1.length !== 1 || b1[0].athlete_id !== 'a-mia') bad.push(`athlete finish saves ${JSON.stringify(b1.map((b) => b.athlete_id))}`)
  if (b1[0].summary !== 'Toss lower.' || b1[0].next !== 'Toss below the hand.') bad.push('the summary the coach reviewed was not sent')
  if (b1[0].shared_with_athlete !== false) bad.push('Share unticked in the sheet was not respected')
  if (b1[0].transcript !== 'serve toss lower') bad.push('transcript not trimmed / not the one typed')

  const asSquad = finishPatch(row(), { mode: 'group', transcript: 'squad talk', share: true, group: squad })
  if ('error' in asSquad) return [...bad, `squad finish refused: ${asSquad.error}`]
  const b2 = sessionBodies({ ...row(), ...asSquad.patch }, 'squad talk', 'coach/u/x.mp4')
  if (b2.map((b) => b.athlete_id).join() !== 'a-mia,a-leo' || b2.some((b) => b.group_id !== 'g-1')) bad.push(`squad finish bodies ${JSON.stringify(b2)}`)
  if (!('error' in finishPatch(row(), { mode: 'group', transcript: 'x', share: true, group: { ...squad, member_ids: [] } }))) bad.push('saved for an empty squad')

  const sev = row({ mode: 'several', athleteIds: ['a-mia', 'a-leo'] })
  const noDrafts = finishPatch(sev, { mode: 'several', transcript: 'both', share: true, athletes: [mia, leo], drafts: {}, newSharedRecordingId: 'shared-1' })
  if (!('error' in noDrafts)) bad.push('a split recording saved before each part was drafted (it would save with no summaries)')
  const split = finishPatch(sev, { mode: 'several', transcript: 'both', share: true, athletes: [mia, leo], drafts: { 'a-mia': { summary: 'Mia part', next: '' }, 'a-leo': { summary: '', next: '' } }, newSharedRecordingId: 'shared-1' })
  if ('error' in split) return [...bad, `several finish refused: ${split.error}`]
  if (split.patch.sharedRecordingId !== 'shared-1') bad.push('a split recording finished without the shared id that withholds the transcript')
  const b3 = sessionBodies({ ...sev, ...split.patch }, 'both', null)
  if (b3.some((b) => b.shared_recording_id !== 'shared-1')) bad.push('a sibling saved without the shared id')
  if (b3.find((b) => b.athlete_id === 'a-mia')?.summary !== 'Mia part' || b3.find((b) => b.athlete_id === 'a-leo')?.summary !== null) bad.push('a sibling carried someone else\'s part')
  const keep = finishPatch({ ...sev, sharedRecordingId: 'kept' }, { mode: 'several', transcript: 'both', share: true, athletes: [mia, leo], drafts: { 'a-mia': { summary: '', next: '' }, 'a-leo': { summary: '', next: '' } }, newSharedRecordingId: 'fresh' })
  if ('error' in keep || keep.patch.sharedRecordingId !== 'kept') bad.push('an existing shared id was replaced')
  if (!('error' in finishPatch(sev, { mode: 'several', transcript: 'x', share: true, athletes: [mia], drafts: { 'a-mia': { summary: '', next: '' } }, newSharedRecordingId: 's' }))) bad.push('a split saved for one athlete')
  return bad
})

check('RQ3', 'A recording nobody saved is flagged after two weeks, never deleted, and says so', () => {
  const bad = []
  const old = row({ createdAt: NOW - STALE_AFTER_MS - 1 })
  if (!isStale(old, NOW)) bad.push('a recording older than two weeks is not flagged')
  if (isStale(row({ createdAt: NOW - STALE_AFTER_MS - 1, ready: true }), NOW)) bad.push('a recording the coach asked to save was counted as stale')
  if (isStale(row(), NOW)) bad.push('a new recording was flagged')
  if (!/until you finish or discard it/.test(describePending(old, NOW))) bad.push(`a stale row does not say it is kept: "${describePending(old, NOW)}"`)
  if (describePending(row({ transcript: 'x' }), NOW) !== 'Recorded and transcribed, not saved yet') bad.push('an unsaved transcribed row is described wrongly')
  if (describePending(row({ ready: true, transcript: 'x' }), NOW) !== 'Waiting to send') bad.push('a ready row is described wrongly')
  return bad
})

check('RQ4', 'The panel offers Finish on an unsaved row and deletes only on Discard', () => {
  const bad = []
  const panel = src('app/components/PendingRecordings.tsx')
  const deletes = panel.match(/deleteRecording\(/g)?.length ?? 0
  if (deletes !== 1) bad.push(`PendingRecordings calls deleteRecording ${deletes} times; only Discard may (a sweep deletes what the coach never discarded)`)
  if (/isAbandoned|ABANDONED_TTL/.test(panel + src('lib/recording-queue.ts'))) bad.push('the 14-day auto-delete is back')
  if (!/FinishRecordingSheet/.test(panel) || !/Finish\s*</.test(panel)) bad.push('the panel has no Finish action for an unsaved row')
  const sheet = src('app/components/FinishRecordingSheet.tsx')
  if (!/finishPatch\(/.test(sheet)) bad.push('the finish sheet does not use finishPatch')
  if (!/role="dialog"/.test(sheet)) bad.push('the finish sheet is not role="dialog", so an app update can reload over it')
  if (!/exclusive/.test(panel) || !/drainingRef\.current\) return whenBusy/.test(panel)) bad.push('finishing does not share the drain\'s lock (a double send is a duplicate session)')
  return bad
})

check('RQ5', 'Closing the recorder while it is recording asks first', () => {
  const bad = []
  const modal = src('app/components/QuickSessionModal.tsx')
  if (!/const requestClose = \(\) => \{\s*if \(recording && !window\.confirm\(/.test(modal)) bad.push('requestClose no longer asks while recording')
  if (!/onClick=\{requestClose\}\s*aria-label="Close"/.test(modal)) bad.push('the sheet\'s close button calls onClose directly: closing mid-recording loses the audio without asking')
  return bad
})

console.log(`\n${BOLD}Recording rig${OFF} ${DIM}— lib/recording-finish.ts and the queue's save, run for real${OFF}\n`)
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
if (failed) { console.log(`${RED}✗ ${failed} of ${results.length} recording rules failed.${OFF}\n`); process.exit(1) }
console.log(`${GREEN}✓ ${results.length} recording rules hold.${OFF}\n`)
