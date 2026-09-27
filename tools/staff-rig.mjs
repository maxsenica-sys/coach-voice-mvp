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
 *
 * Usage:  npm run verify:staff
 */

import { scopeFromStaffRow, HEAD_ONLY_MESSAGE } from '@/lib/coach-scope'

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
