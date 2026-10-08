#!/usr/bin/env node
/**
 * Email rig — text a person typed never becomes markup in someone's inbox.
 *
 * Every notification Pindar sends is HTML built from things people type:
 * a coach's name, a session title, an athlete's message, a check-in note. An
 * email client renders what it is given. Until this rig, all of those went in
 * raw, so an athlete who typed
 *
 *     <a href="https://evil.example/">tap here</a>
 *
 * into a message put a working link in their coach's inbox, sent by Pindar.
 * A name did the same thing to a whole roster's invite emails.
 *
 * This drives the REAL builders in lib/notify.ts — not copies — with hostile
 * text in every field, and reads what would have been handed to Resend. The
 * network is a stub: nothing is sent, no key is needed.
 *
 * Each rule was broken on purpose to watch it fail:
 *   E1  escapeHtml not escaping "<"
 *   E2  renderBrandedEmail printing `heading` raw
 *   E3  notifyNewMessage's preview not escaped (athlete → coach)
 *   E4  a check-in note printed raw in the coach's wellness alert
 *   E5  fromHeader not stripping "<"
 *   E6  a route interpolating a name into an HTML literal without escapeHtml
 *
 * KNOWN GAP: the caretaker report built in app/athletes/[id]/page.tsx
 * (buildSessionEmailHtml) escapes its arguments but lives in a .tsx, which
 * Node cannot import, so it is read, not run. And POST /api/email accepts
 * HTML from the head coach by design — it is their own report to their own
 * athlete's caretakers — so what reaches it is only as safe as that builder.
 *
 * Usage:  npm run verify:email
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'

// ── The stub network ──────────────────────────────────────────────────────
// Resend POSTs are captured. The admin client's getUserById (the coach's
// address, for athlete → coach mail) is answered. Anything else is a failure.
process.env.RESEND_API_KEY = 'rig-not-a-key'
// Gmail wins over Resend when both are set (lib/notify.ts), and Gmail is a real
// SMTP connection the stub network below cannot see. A developer with these in
// their shell would otherwise send real mail from the rig.
delete process.env.GMAIL_USER
delete process.env.GMAIL_APP_PASSWORD
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.rig.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'rig-not-a-key'
const sent = []
const unexpected = []
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url === 'https://api.resend.com/emails') {
    sent.push(JSON.parse(init.body))
    return json({ id: `rig-${sent.length}` })
  }
  const m = url.match(/\/auth\/v1\/admin\/users\/([^/?]+)/)
  if (m) return json({ id: m[1], email: 'coach@rig.invalid', aud: 'authenticated' })
  unexpected.push(url)
  return new Response('{}', { status: 404 })
}

const { escapeHtml, fromHeader } = await import('@/lib/escape-html')
const notify = await import('@/lib/notify')

// ── Hostile text ──────────────────────────────────────────────────────────
const HOSTILE = '<img src=x onerror=alert(1)><a href="https://evil.example/">tap here</a>'
// Only what exists when the text is NOT escaped; escaped text still contains
// the words, so a marker like `onerror=` would flag correct output.
const RAW_MARKERS = ['<img', '<a href="https://evil']
const NAME = `Kovačević ${HOSTILE}`

/** A supabase client that answers every read with hostile rows. */
function fakeSupabase() {
  const rows = {
    athletes: { email: 'athlete@rig.invalid', first_name: NAME, last_name: 'Nguyễn' },
    profiles: { first_name: NAME, last_name: 'Coach' },
  }
  return {
    from(table) {
      const q = {
        select: () => q, eq: () => q, is: () => q, neq: () => q,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        single: async () => ({ data: rows[table] ?? null, error: null }),
        then: (res) => res({ data: [], count: 0, error: null }),
      }
      return q
    },
  }
}
const req = new Request('https://coachvoice.rig.invalid/api/x', { headers: { host: 'coachvoice.rig.invalid' } })
// auth-js refuses anything but a UUID before it ever makes a request
const COACH = '00000000-0000-4000-8000-00000000000c'
const CHECKIN = { energy: 1, mood: 1, sleep_q: 1, soreness: 5, stress: 5, notes: HOSTILE }

let failed = 0
function check(name, ok, detail = '') {
  if (ok) console.log(`  ${GREEN}✓${OFF} ${name}`)
  else { failed++; console.log(`  ${RED}✗ ${name}${OFF}${detail ? `\n      ${DIM}${detail}${OFF}` : ''}`) }
}
const rawIn = (html) => RAW_MARKERS.filter((m) => html.includes(m))

console.log(`\n${BOLD}Email rig${OFF} ${DIM}— typed text never becomes markup${OFF}\n`)

// E1
{
  const out = escapeHtml(`<>&"'`)
  check('E1  escapeHtml escapes < > & " \'', out === '&lt;&gt;&amp;&quot;&#39;', out)
  check('E1  …and leaves a name\'s letters alone', escapeHtml('Kovačević Nguyễn') === 'Kovačević Nguyễn')
}

// E2
{
  const html = notify.renderBrandedEmail({ heading: HOSTILE, bodyHtml: '<p>ok</p>', ctaText: HOSTILE, ctaHref: 'https://x.invalid/"><script>' })
  check('E2  renderBrandedEmail escapes heading, button text and link', rawIn(html).length === 0 && !html.includes('"><script>'),
    `raw in output: ${rawIn(html).join(', ')}`)
}

// E3, E4 — every notification, hostile text in every field
async function run(label, fn, rule) {
  const before = sent.length
  await fn()
  const mail = sent.slice(before)
  if (mail.length === 0) { check(`${rule}  ${label}`, false, 'no email was produced — the stub data stopped reaching this path, so the rule stopped looking'); return }
  const raw = mail.flatMap((m) => rawIn(m.html))
  check(`${rule}  ${label}`, raw.length === 0 && mail.every((m) => m.html.includes('&lt;img')),
    raw.length ? `raw markup in the email: ${[...new Set(raw)].join(', ')}` : 'the hostile text is missing entirely — it should arrive escaped, not dropped')
}

await run('session shared: coach name, title, summary', () => notify.notifySessionShared({
  supabase: fakeSupabase(), req, athleteId: 'a1', coachUserId: COACH, coachEmail: 'c@rig.invalid', sessionTitle: HOSTILE, summary: HOSTILE,
}), 'E3')
await run('message coach → athlete: the message itself', () => notify.notifyNewMessage({
  supabase: fakeSupabase(), req, messageId: 'm1', athleteId: 'a1', coachUserId: COACH, senderRole: 'coach', content: HOSTILE,
}), 'E3')
await run('message athlete → coach: the message and the athlete\'s name', () => notify.notifyNewMessage({
  supabase: fakeSupabase(), req, messageId: 'm2', athleteId: 'a1', coachUserId: COACH, senderRole: 'athlete', content: HOSTILE,
}), 'E3')
await run('calendar event with a check-in ask: title, date, description', () => notify.notifyCalendarEventCreated({
  supabase: fakeSupabase(), req, athleteId: 'a1', coachUserId: COACH, eventTitle: HOSTILE, eventType: 'session', eventDate: HOSTILE, description: HOSTILE, checkinRequested: true,
}), 'E3')
await run('wellness alert to the coach: athlete name and check-in note', () => notify.notifyWellnessAlert({
  req, athleteId: 'a1', coachUserId: COACH, athleteName: NAME, todayScore: 1, avgScore: 2, reason: 'both', checkin: CHECKIN,
}), 'E4')
{
  const html = notify.buildWellnessAlertHtml({ athleteName: NAME, todayScore: 1, avgScore: 2, reason: 'both', checkin: CHECKIN, audience: 'parent' })
  check('E4  wellness alert to a parent: athlete name', rawIn(html).length === 0, `raw: ${rawIn(html).join(', ')}`)
  check('E4  …and the athlete\'s note still does not go to a parent', !html.includes('Note from check-in'))
}

// E5 — the From header
{
  const h = fromHeader('Coach <boss@elsewhere.example>\r\nBcc: x@y', 'reports@coachvoice.app')
  check('E5  a name cannot add an address or a header to From', h === '"Coach boss@elsewhere.example Bcc: x@y" <reports@coachvoice.app>', h)
  check('E5  an empty name falls back to Pindar', fromHeader('  ', 'a@b.c') === '"Pindar" <a@b.c>')
  const froms = sent.map((m) => m.from)
  check('E5  every email sendEmail produced has a clean From', froms.length > 0 && froms.every((f) => /^"[^"<>\r\n]*" <[^<>\s]+>$/.test(f)),
    froms.filter((f) => !/^"[^"<>\r\n]*" <[^<>\s]+>$/.test(f)).join(' | '))
}

// E6 — routes that build their own HTML literal (not through lib/notify)
{
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
  const bad = []
  let seen = 0
  for (const f of walk(join(ROOT, 'app', 'api')).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(f, 'utf8')
    for (const lit of src.matchAll(/`([^`]*<(?:p|strong|div|a|h\d|span|td|tr|table|br)\b[^`]*)`/g)) {
      for (const [, expr] of lit[1].matchAll(/\$\{([^}]*)\}/g)) {
        seen++
        if (!/^\s*escapeHtml\(/.test(expr) && !/^\s*[A-Z][A-Z0-9_]*\s*$/.test(expr)) bad.push(`${relative(ROOT, f)}: \${${expr}}`)
      }
    }
  }
  check('E6  every value a route puts in an HTML literal goes through escapeHtml', seen > 0 && bad.length === 0,
    seen === 0 ? 'found no HTML literal in any route — the pattern stopped matching, so this rule stopped looking' : bad.join('\n      '))
}

// E7 — "is email set up?" is asked of lib/notify.ts, never of one variable.
{
  const keep = { g: process.env.GMAIL_USER, p: process.env.GMAIL_APP_PASSWORD, r: process.env.RESEND_API_KEY }
  const set = (g, p, r) => {
    for (const [k, v] of [['GMAIL_USER', g], ['GMAIL_APP_PASSWORD', p], ['RESEND_API_KEY', r]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  }
  set(undefined, undefined, undefined); const none = notify.emailConfigured()
  set('coach@gmail.com', 'abcd efgh ijkl mnop', undefined); const gmail = notify.emailConfigured()
  set(undefined, undefined, 're_x'); const resend = notify.emailConfigured()
  set('coach@gmail.com', undefined, undefined); const half = notify.emailConfigured()
  set('  ', '  ', undefined); const blank = notify.emailConfigured()
  set(keep.g, keep.p, keep.r)
  check('E7  nothing set: email is off', none === false)
  check('E7  Gmail alone is enough (no domain needed)', gmail === true)
  check('E7  Resend alone is enough', resend === true)
  check('E7  a Gmail address without its app password is not', half === false)
  check('E7  blank values are not', blank === false)
  const routes = ['app/api/athletes/route.ts', 'app/api/staff/route.ts', 'app/api/email/route.ts']
  const direct = routes.filter((r) => readFileSync(join(ROOT, r), 'utf8').includes('process.env.RESEND_API_KEY'))
  check('E7  no route decides "email is off" from RESEND_API_KEY alone', direct.length === 0, direct.join(', '))
}

check('the stub network saw nothing unexpected', unexpected.length === 0, unexpected.join(', '))

console.log(`\n${DIM}KNOWN GAP: app/athletes/[id]/page.tsx buildSessionEmailHtml is a .tsx and is not run here;${OFF}`)
console.log(`${DIM}POST /api/email accepts the head coach's own report HTML by design.${OFF}\n`)
if (failed) { console.log(`${RED}✗ ${failed} email rule(s) failed.${OFF}\n`); process.exit(1) }
console.log(`${GREEN}✓ Every email escapes what people typed.${OFF}\n`)
