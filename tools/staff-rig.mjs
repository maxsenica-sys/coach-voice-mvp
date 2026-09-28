#!/usr/bin/env node
/**
 * Staff rig — who is on whose coaching team, decided by lib/coach-scope.ts.
 *
 * Every coach route asks scopeFromStaffRow "whose athletes are these?". If it
 * ever answers "the head's" for a revoked or merely invited assistant, the
 * database policies still refuse (supabase/tests/034_coach_staff.test.sql),
 * but every route using the service role would not. So the pure answer is held
 * here, against the real module.
 *
 * Each rule was broken on purpose to watch it fail:
 *   S1  scopeFromStaffRow ignoring `status`
 *   S2  a row naming the caller as their own head
 *   S3  permissions read with `!== false` instead of `=== true`
 *   S4  the result left mutable
 *   S5  acceptBlock skipping the email comparison
 *   S6  newInviteToken storing the token instead of its hash
 *   S7  escapeHtml not escaping "<"
 *   S8  canSeeAthlete letting an assistant reach an athlete not given to them
 *   S9  athleteFilter sending an empty list (PostgREST's `in ()`) for nobody
 *   S10 mayHearRecording ignoring the recording's other athletes
 *   S11 parseAthleteIds keeping the valid part of a malformed list
 *
 * Usage:  npm run verify:staff
 */

import { scopeFromStaffRow, HEAD_ONLY_MESSAGE, canSeeAthlete, athleteFilter, mayHearRecording, NO_ATHLETE } from '@/lib/coach-scope'
import {
  acceptBlock, ACCEPT_MESSAGES, newInviteToken, hashInviteToken, isInviteTokenShape,
  normaliseEmail, maskEmail, escapeHtml, INVITE_TTL_DAYS, inviteExpiry,
  parseAthleteIds, assignmentDiff, assignedNoticeText, MAX_ASSIGN,
} from '@/lib/staff-invite'

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'
const ME = '00000000-0000-0000-0000-00000000000a'
const HEAD = '00000000-0000-0000-0000-00000000000b'
const row = (over = {}) => ({ id: 'staff-1', head_coach_id: HEAD, status: 'active', can_record: true, can_message: true, can_view_wellness: true, ...over })

const results = []
const check = (id, title, fn) => {
  let problems
  try { problems = fn() ?? [] } catch (e) { problems = [`threw: ${e.message}`] }
  results.push({ id, title, problems })
}

check('S1', 'Only an ACTIVE membership puts a coach on someone else\'s team', () => {
  const bad = []
  const s = scopeFromStaffRow(ME, row())
  if (s.headId !== HEAD || s.isHead) bad.push(`active row gave headId=${s.headId} isHead=${s.isHead}`)
  for (const status of ['invited', 'revoked', 'ACTIVE', '', 'pending']) {
    const x = scopeFromStaffRow(ME, row({ status }))
    if (x.headId !== ME || !x.isHead || x.staffId !== null) bad.push(`status "${status}" put the caller on the head's team`)
  }
  for (const nothing of [null, undefined]) {
    const x = scopeFromStaffRow(ME, nothing)
    if (x.headId !== ME || !x.isHead) bad.push(`no row did not leave the caller as their own head`)
  }
  return bad
})

check('S2', 'A row can never make a coach an assistant to themself, or to no one', () => {
  const bad = []
  const self = scopeFromStaffRow(ME, row({ head_coach_id: ME }))
  if (!self.isHead || self.staffId !== null) bad.push('a row naming the caller as their own head made them staff')
  const empty = scopeFromStaffRow(ME, row({ head_coach_id: '' }))
  if (empty.headId !== ME) bad.push('a row with no head gave headId ' + JSON.stringify(empty.headId))
  return bad
})

check('S3', 'An assistant has exactly the permissions switched on — never by default', () => {
  const bad = []
  const off = scopeFromStaffRow(ME, row({ can_record: false, can_message: false, can_view_wellness: false }))
  if (off.can.record || off.can.message || off.can.wellness) bad.push(`switched-off permissions read as on: ${JSON.stringify(off.can)}`)
  const missing = scopeFromStaffRow(ME, row({ can_record: undefined, can_message: null, can_view_wellness: 'yes' }))
  if (missing.can.record || missing.can.message || missing.can.wellness) bad.push(`missing or non-boolean permissions read as on: ${JSON.stringify(missing.can)}`)
  const head = scopeFromStaffRow(ME, null)
  if (!head.can.record || !head.can.message || !head.can.wellness) bad.push('a head coach lost a permission over their own team')
  return bad
})

check('S4', 'A scope cannot be changed after it is decided', () => {
  const bad = []
  const s = scopeFromStaffRow(ME, row({ can_record: false }))
  try { s.headId = ME } catch { /* frozen: expected in strict mode */ }
  try { s.can.record = true } catch { /* frozen */ }
  if (s.headId !== HEAD) bad.push('headId was reassigned')
  if (s.can.record) bad.push('a permission was switched on after the fact')
  if (!HEAD_ONLY_MESSAGE) bad.push('the head-only message is empty')
  return bad
})

check('S5', 'Only the invited person, on a coach account with no roster and no other team, can accept', () => {
  const bad = []
  const now = new Date('2026-09-27T12:00:00Z')
  const invite = { status: 'invited', invited_email: 'Sam@Club.org ', invite_expires_at: '2026-09-30T00:00:00Z', head_coach_id: HEAD }
  const ok = { invite, userId: ME, userEmail: 'sam@club.org', role: 'coach', ownsAthletes: false, ownsGroups: false, activeElsewhere: false, now }
  if (acceptBlock(ok) !== null) bad.push(`the invited coach was refused: ${acceptBlock(ok)}`)
  const cases = [
    [{ invite: null }, 'not-found'],
    [{ invite: { ...invite, status: 'active' } }, 'not-pending'],
    [{ invite: { ...invite, status: 'revoked' } }, 'not-pending'],
    [{ invite: { ...invite, invite_expires_at: '2026-09-27T11:59:59Z' } }, 'expired'],
    [{ invite: { ...invite, invite_expires_at: null } }, 'expired'],
    [{ invite: { ...invite, invite_expires_at: 'not a date' } }, 'expired'],
    [{ userEmail: 'someone.else@club.org' }, 'wrong-email'],
    [{ userEmail: null }, 'wrong-email'],
    [{ role: 'athlete' }, 'not-a-coach'],
    [{ role: null }, 'not-a-coach'],
    [{ ownsAthletes: true }, 'own-roster'],
    [{ ownsGroups: true }, 'own-roster'],
    [{ activeElsewhere: true }, 'other-team'],
    [{ userId: HEAD }, 'own-team'],
  ]
  for (const [over, want] of cases) {
    const got = acceptBlock({ ...ok, ...over })
    if (got !== want) bad.push(`${JSON.stringify(over)} gave ${got}, expected ${want}`)
  }
  for (const k of Object.keys(ACCEPT_MESSAGES)) if (!ACCEPT_MESSAGES[k]) bad.push(`no message for ${k}`)
  return bad
})

check('S6', 'An invite link is single-use, unguessable, and never stored as itself', () => {
  const bad = []
  const a = newInviteToken(), b = newInviteToken()
  if (a.token === b.token) bad.push('two tokens were the same')
  if (!isInviteTokenShape(a.token)) bad.push(`token "${a.token}" is not 43 base64url characters`)
  if (a.hash === a.token || a.hash.includes(a.token)) bad.push('the stored value contains the token')
  if (a.hash !== hashInviteToken(a.token) || !/^[0-9a-f]{64}$/.test(a.hash)) bad.push('the stored value is not the sha256 of the token')
  for (const t of ['', 'abc', null, 42, a.token + 'x', a.token.slice(1) + '!']) {
    if (isInviteTokenShape(t)) bad.push(`${JSON.stringify(t)} was accepted as a token`)
  }
  const exp = Date.parse(inviteExpiry(new Date('2026-09-27T00:00:00Z')))
  if (exp !== Date.parse('2026-09-27T00:00:00Z') + INVITE_TTL_DAYS * 86_400_000) bad.push('expiry is not the stated number of days')
  return bad
})

check('S7', 'Names and addresses cannot inject into the invite email or leak in full', () => {
  const bad = []
  const evil = '<img src=x onerror="alert(1)">&\'"'
  const safe = escapeHtml(evil)
  if (/[<>"']/.test(safe) || /&(?!amp;|lt;|gt;|quot;|#39;)/.test(safe)) bad.push(`escapeHtml left markup: ${safe}`)
  if (normaliseEmail('  Sam@Club.ORG ') !== 'sam@club.org') bad.push('an address is not trimmed and lower-cased')
  for (const e of ['', 'sam', 'sam@', '@club.org', 'sam club@x.org', 42, null]) {
    if (normaliseEmail(e) !== null) bad.push(`${JSON.stringify(e)} was treated as an address`)
  }
  const m = maskEmail('samantha@club.org')
  if (m.includes('samantha') || !m.endsWith('@club.org') || !m.startsWith('sa')) bad.push(`mask "${m}" shows too much or too little`)
  return bad
})

const X1 = '10000000-0000-0000-0000-000000000001'
const X3 = '10000000-0000-0000-0000-000000000003'

check('S8', 'An assistant reaches only the athletes the head gave them (Max, 2026-09-28)', () => {
  const bad = []
  const a = scopeFromStaffRow(ME, row(), [X1])
  if (!canSeeAthlete(a, X1)) bad.push('an assistant cannot reach the athlete they were given')
  if (canSeeAthlete(a, X3)) bad.push('an assistant reaches an athlete they were NOT given')
  for (const nothing of [null, undefined, '']) if (canSeeAthlete(a, nothing)) bad.push(`${JSON.stringify(nothing)} counted as an athlete`)
  const none = scopeFromStaffRow(ME, row())
  if (none.athleteIds === null || none.athleteIds.length !== 0) bad.push('an assistant given nobody was not left with an empty list')
  if (canSeeAthlete(none, X1)) bad.push('an assistant given nobody reaches an athlete')
  const head = scopeFromStaffRow(ME, null, [X1])
  if (head.athleteIds !== null) bad.push('a head coach was narrowed to a list — their roster is coach_id, not assignments')
  if (!canSeeAthlete(head, X3)) bad.push('a head coach was refused one of their athletes')
  const revoked = scopeFromStaffRow(ME, row({ status: 'revoked' }), [X1])
  if (revoked.athleteIds !== null || revoked.headId !== ME) bad.push('a revoked assistant kept their assignments')
  try { a.athleteIds.push(X3) } catch { /* frozen */ }
  if (canSeeAthlete(a, X3)) bad.push('the assigned list could be extended after it was decided')
  return bad
})

check('S9', 'A list query for an assistant given nobody matches nothing, and a head is not narrowed', () => {
  const bad = []
  if (athleteFilter(scopeFromStaffRow(ME, null)) !== null) bad.push('a head coach got a filter')
  const empty = athleteFilter(scopeFromStaffRow(ME, row(), []))
  if (!Array.isArray(empty) || empty.length !== 1 || empty[0] !== NO_ATHLETE) bad.push(`nobody assigned gave ${JSON.stringify(empty)} — an empty in() is not reliably "no rows"`)
  const one = athleteFilter(scopeFromStaffRow(ME, row(), [X1, X1]))
  if (JSON.stringify(one) !== JSON.stringify([X1])) bad.push(`assigned [X1, X1] filtered as ${JSON.stringify(one)}`)
  return bad
})

check('S10', 'An assistant hears a recording about several athletes only when every one is theirs, or they made it', () => {
  const bad = []
  const a = scopeFromStaffRow(ME, row(), [X1])
  const solo = { athlete_id: X1, group_id: null, shared_recording_id: null, recorded_by: HEAD }
  if (!mayHearRecording(a, solo, [X1])) bad.push('refused a one-to-one with their own athlete')
  const squad = { athlete_id: X1, group_id: 'g1', shared_recording_id: null, recorded_by: HEAD }
  if (mayHearRecording(a, squad, [X1, X3])) bad.push('heard a squad talk that includes an athlete not given to them')
  if (!mayHearRecording(a, squad, [X1])) bad.push('refused a squad talk whose members are all theirs')
  const split = { athlete_id: X1, group_id: null, shared_recording_id: 'r1', recorded_by: HEAD }
  if (mayHearRecording(a, split, [X1, X3])) bad.push('heard a split recording shared with an athlete not given to them')
  if (!mayHearRecording(a, { ...split, recorded_by: ME }, [X1, X3])) bad.push('refused a recording they made themself')
  if (mayHearRecording(a, { ...solo, athlete_id: X3 }, [X3])) bad.push('heard a one-to-one with an athlete not given to them')
  if (!mayHearRecording(scopeFromStaffRow(ME, null), squad, [X1, X3])) bad.push('a head coach was refused their own squad talk')
  return bad
})

check('S11', 'Which athletes an assistant gets is exactly what the head ticked — never a repaired guess', () => {
  const bad = []
  const ok = parseAthleteIds([X1, X3.toUpperCase(), X1])
  if (JSON.stringify(ok) !== JSON.stringify([X1, X3])) bad.push(`[X1, X3 upper, X1] parsed as ${JSON.stringify(ok)} — expected deduplicated, lower-case, in order`)
  if (JSON.stringify(parseAthleteIds([])) !== '[]') bad.push('an empty list was not an empty list')
  for (const junk of [[X1, 'not-an-id'], [X1, 42], [X1, null], 'X1', null, undefined, { 0: X1 }]) {
    if (parseAthleteIds(junk) !== null) bad.push(`${JSON.stringify(junk)} was accepted — a malformed list must be refused whole, not trimmed`)
  }
  if (parseAthleteIds(Array(MAX_ASSIGN + 1).fill(X1)) !== null) bad.push(`a list longer than ${MAX_ASSIGN} was accepted`)
  const d = assignmentDiff([X1], [X3])
  if (JSON.stringify(d) !== JSON.stringify({ add: [X3], remove: [X1] })) bad.push(`X1 → X3 diffed as ${JSON.stringify(d)}`)
  const same = assignmentDiff([X1, X3], [X3.toUpperCase(), X1])
  if (same.add.length || same.remove.length) bad.push(`an unchanged list (different case and order) diffed as ${JSON.stringify(same)} — the athlete would be told twice`)
  const text = assignedNoticeText('Sam Reid', 'Jordan Lee')
  if (!text.includes('Sam Reid') || !text.includes('Jordan Lee') || !/check-ins/.test(text)) bad.push(`the athlete's notice does not say who, whose team and what they see: "${text}"`)
  return bad
})

console.log(`\n${BOLD}Staff rig${OFF} ${DIM}— lib/coach-scope.ts, run for real${OFF}\n`)
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
if (failed) {
  console.log(`${RED}✗ ${failed} of ${results.length} staff rules failed.${OFF}\n`)
  process.exit(1)
}
console.log(`${GREEN}✓ ${results.length} staff rules hold.${OFF}\n`)
