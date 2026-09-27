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
 *
 * Usage:  npm run verify:staff
 */

import { scopeFromStaffRow, HEAD_ONLY_MESSAGE } from '@/lib/coach-scope'
import {
  acceptBlock, ACCEPT_MESSAGES, newInviteToken, hashInviteToken, isInviteTokenShape,
  normaliseEmail, maskEmail, escapeHtml, INVITE_TTL_DAYS, inviteExpiry,
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
