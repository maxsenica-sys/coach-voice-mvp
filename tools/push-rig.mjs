#!/usr/bin/env node
/**
 * tools/push-rig.mjs — what a push notification is allowed to say, and when.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * A push notification is the one piece of this product that is shown to
 * whoever is holding the phone, without a sign-in, on a lock screen. The
 * people receiving them are coaches and 13–18 year olds. So the rule is
 * absolute: a notification names who it is from — "New message from Max",
 * "Max shared a new session", "New message from Mathilde" — and never carries
 * message text, a transcript, a summary, or anything about wellness or injury.
 *
 * Every way of breaking that type-checks. Adding `body: content` to an object
 * literal is one line and every build passes it. So this rig runs the real
 * code — lib/push.ts through the alias hook, and public/sw.js inside a VM with
 * a fake worker global — and asserts on what comes out.
 *
 * It also holds Max's scope rule: the weekly digest and the takeaway reminder
 * stay in the app. The kinds are a closed list, and only the message and
 * session routes may call a notifier — from `after()`, so a push failure can
 * never fail the request that caused it.
 *
 * ── Proven by breaking it ─────────────────────────────────────────────────
 *
 * Each rule was watched going red against a deliberate break, then reverted:
 *   PU1  buildPushPayload given a `body: input.content` key
 *   PU2  serializePushPayload changed to JSON.stringify({ ...p })
 *   PU3  the coach URL built from the raw athleteId instead of the checked one
 *   PU4  pushDisplayName without the control-character flattening
 *   PU5  a 'weekly-digest' kind appended to PUSH_KINDS
 *   PU6  `after(() => notifyPush…)` in the messages route changed to `await notifyPush…`;
 *        a notifier import planted in lib/push-client.ts; and the scanner's own
 *        self-test (a planted digest route) runs on every pass
 *   PU7  the endpoint allowlist matching endsWith(h) instead of endsWith(`.${h}`)
 *   PU8  pushConfig accepting a subject that is neither mailto: nor https:
 *   PU9  sendPushToUser sending JSON.stringify(payload) instead of the serialiser
 *   PU10 the worker passing `body: data.body` to showNotification
 *   PU11 the worker's pushTarget without the same-origin check
 *
 * Usage:  npm run verify:push
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import {
  PUSH_KINDS, PUSH_PAYLOAD_KEYS, buildPushPayload, serializePushPayload, pushDisplayName,
  isAllowedPushEndpoint, isPushKey, isGonePushStatus, pushConfig,
} from '@/lib/push'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'

const results = []
const check = async (id, title, fn) => {
  let problems
  try { problems = (await fn()) ?? [] } catch (e) { problems = [`threw: ${e.message}`] }
  results.push({ id, title, problems })
}

const SECRET = 'SECRET-ankle-still-sore-and-I-cried'
const ATHLETE = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c'

/** An input stuffed with everything a notification must never carry. */
function hostile(base) {
  return {
    ...base,
    body: SECRET, content: SECRET, message: SECRET, summary: SECRET, transcript: SECRET,
    wellness: SECRET, injury: SECRET, session_name: SECRET, text: SECRET,
  }
}

// ── PU1 ─────────────────────────────────────────────────────────────────────
await check('PU1', 'The payload names the sender and carries nothing else', () => {
  const bad = []
  const cases = [
    [{ kind: 'message-to-athlete', senderFirstName: 'Max', athleteId: ATHLETE }, 'New message from Max'],
    [{ kind: 'message-to-coach', senderFirstName: 'Mathilde', athleteId: ATHLETE }, 'New message from Mathilde'],
    [{ kind: 'session-shared', coachFirstName: 'Max', athleteId: ATHLETE }, 'Max shared a new session'],
  ]
  const allowed = [...PUSH_PAYLOAD_KEYS].sort().join(',')
  for (const [input, title] of cases) {
    const p = buildPushPayload(hostile(input))
    const keys = Object.keys(p).sort().join(',')
    if (keys !== allowed) bad.push(`${input.kind}: keys are [${keys}], allowed [${allowed}]`)
    if ('body' in p) bad.push(`${input.kind}: has a body field`)
    if (JSON.stringify(p).includes(SECRET)) bad.push(`${input.kind}: content leaked into the payload`)
    if (p.title !== title) bad.push(`${input.kind}: title "${p.title}", expected "${title}"`)
  }
  if (allowed !== 'tag,title,url') bad.push(`PUSH_PAYLOAD_KEYS grew: [${allowed}]`)
  return bad
})

// ── PU2 ─────────────────────────────────────────────────────────────────────
await check('PU2', 'The serialiser ships only title, url and tag, whatever the object holds', () => {
  const bad = []
  const grown = { title: 'New message from Max', url: '/athlete', tag: 'cv', body: SECRET, content: SECRET }
  const wire = serializePushPayload(grown)
  const parsed = JSON.parse(wire)
  if (Object.keys(parsed).sort().join(',') !== 'tag,title,url') bad.push(`wire keys: ${Object.keys(parsed).join(',')}`)
  if (wire.includes(SECRET)) bad.push('a stray field reached the wire')
  return bad
})

// ── PU3 ─────────────────────────────────────────────────────────────────────
await check('PU3', 'A tap opens the right page, and the URL cannot be steered', () => {
  const bad = []
  const want = [
    [{ kind: 'message-to-athlete', senderFirstName: 'Max', athleteId: ATHLETE }, '/athlete?tab=messages'],
    [{ kind: 'message-to-coach', senderFirstName: 'Mathilde', athleteId: ATHLETE }, `/dashboard?tab=messages&athlete=${ATHLETE}`],
    [{ kind: 'session-shared', coachFirstName: 'Max', athleteId: ATHLETE }, '/athlete'],
  ]
  for (const [input, url] of want) {
    const got = buildPushPayload(input).url
    if (got !== url) bad.push(`${input.kind}: "${got}", expected "${url}"`)
  }
  for (const id of ['x&tab=settings', '../../evil', 'https://evil.example', `${ATHLETE}&x=1`]) {
    const got = buildPushPayload({ kind: 'message-to-coach', senderFirstName: 'M', athleteId: id })
    if (got.url !== '/dashboard?tab=messages') bad.push(`athleteId "${id}" produced url "${got.url}"`)
    if (got.tag !== 'cv-messages') bad.push(`athleteId "${id}" produced tag "${got.tag}"`)
  }
  for (const k of PUSH_KINDS) {
    const u = buildPushPayload({ kind: k, senderFirstName: 'A', coachFirstName: 'A', athleteId: ATHLETE }).url
    if (!u.startsWith('/') || u.startsWith('//')) bad.push(`${k}: url "${u}" is not a same-origin path`)
  }
  return bad
})

// ── PU4 ─────────────────────────────────────────────────────────────────────
await check('PU4', 'A name cannot forge a second line, and a real name is never shortened', () => {
  const bad = []
  const forged = pushDisplayName('Max\nYour password has expired\u2028tap here', 'x')
  if (/[\n\r\u2028\u2029]/.test(forged)) bad.push(`control characters survived: ${JSON.stringify(forged)}`)
  if (pushDisplayName('   ', 'your coach') !== 'your coach') bad.push('blank name did not fall back')
  if (pushDisplayName(null, 'your coach') !== 'your coach') bad.push('null name did not fall back')
  for (const real of ['Mathilde', 'Anne-Marie', "Siobhán", 'Nguyễn Thị Minh', 'Oluwaseun Adebayo-Williams']) {
    if (pushDisplayName(real, 'x') !== real) bad.push(`"${real}" was altered to "${pushDisplayName(real, 'x')}"`)
  }
  const long = pushDisplayName('A'.repeat(500), 'x')
  if (long.length > 60) bad.push(`a 500-character name came out ${long.length} long`)
  if (/…|\.\.\.$/.test(long)) bad.push('a capped name was ellipsised')
  const p = buildPushPayload({ kind: 'message-to-athlete', senderFirstName: '  ', athleteId: ATHLETE })
  if (p.title !== 'New message from your coach') bad.push(`no-name title: "${p.title}"`)
  return bad
})

// ── PU5 ─────────────────────────────────────────────────────────────────────
await check('PU5', 'Only messages and shared sessions are pushed — never the digest or the takeaway reminder', () => {
  const bad = []
  const want = ['message-to-athlete', 'message-to-coach', 'session-shared']
  if ([...PUSH_KINDS].sort().join(',') !== want.sort().join(',')) bad.push(`kinds are [${PUSH_KINDS.join(', ')}]`)
  for (const k of PUSH_KINDS) {
    if (/digest|takeaway|reminder|wellness|injur|check-?in/i.test(k)) bad.push(`"${k}" is in-app only`)
  }
  return bad
})

// ── PU6 ─────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full)
  }
  return out
}
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

/** Where a notifier may be called from. Everything else must not. */
const NOTIFIER_CALLERS = {
  'app/api/messages/route.ts': 'notifyPushNewMessage',
  'app/api/sessions/route.ts': 'notifyPushSessionShared',
}

function scanCallers(files) {
  const bad = []
  for (const { rel, text } of files) {
    if (rel === 'lib/push.ts') continue
    const src = stripComments(text)
    const mentions = src.match(/\bnotifyPush\w*/g) ?? []
    const sends = /\bsendPushToUser\b|\bsendNotification\s*\(/.test(src) || /from\s+['"]web-push['"]/.test(src)
    if (sends) bad.push(`${rel}: sends push directly — only lib/push.ts may`)
    if (!mentions.length) continue
    const allowed = NOTIFIER_CALLERS[rel]
    if (!allowed) { bad.push(`${rel}: calls ${[...new Set(mentions)].join(', ')} — only the message and session routes may push`); continue }
    const other = mentions.filter((m) => m !== allowed)
    if (other.length) bad.push(`${rel}: uses ${[...new Set(other)].join(', ')}, may only use ${allowed}`)
    const calls = [...src.matchAll(new RegExp(`\\b${allowed}\\s*\\(`, 'g'))].length
    const deferred = [...src.matchAll(new RegExp(`after\\(\\s*\\(\\)\\s*=>\\s*${allowed}\\s*\\(`, 'g'))].length
    if (calls !== 1) bad.push(`${rel}: ${allowed} is called ${calls} times, expected once`)
    if (deferred !== calls) bad.push(`${rel}: ${allowed} is not inside after(() => …) — a push failure would hold up or fail the request`)
    const argText = (src.match(new RegExp(`${allowed}\\s*\\(([^)]*)\\)`)) ?? [])[1] ?? ''
    if (/content|summary|transcript|session_name|media/i.test(argText)) bad.push(`${rel}: ${allowed} is handed content (${argText.trim()})`)
  }
  return bad
}

await check('PU6', 'Only the message and session routes push, and only after the response', () => {
  const bad = []
  // The scanner has to be able to see a violation before its silence means
  // anything. Every run starts by planting one.
  const planted = scanCallers([
    { rel: 'app/api/digest/route.ts', text: "import { notifyPushNewMessage } from '@/lib/push'\nafter(() => notifyPushNewMessage({ athleteId }))" },
    { rel: 'app/api/messages/route.ts', text: 'await notifyPushNewMessage({ athleteId, senderUserId, senderRole })' },
  ])
  if (planted.length < 2) bad.push(`scanner self-test: a planted digest push and an awaited push produced ${planted.length} finding(s), expected 2`)

  const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))].map((full) => ({
    rel: relative(ROOT, full).split(sep).join('/'),
    text: readFileSync(full, 'utf8').replace(/\r\n/g, '\n'),
  }))
  for (const rel of Object.keys(NOTIFIER_CALLERS)) {
    if (!files.some((f) => f.rel === rel && f.text.includes(NOTIFIER_CALLERS[rel]))) bad.push(`${rel} no longer pushes — was that meant?`)
  }
  return [...bad, ...scanCallers(files)]
})

// ── PU7 ─────────────────────────────────────────────────────────────────────
await check('PU7', 'A subscription may only point at a real push service (no server-side request forgery)', () => {
  const bad = []
  const ok = [
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGuQyavXutnMaYBv6o',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
  ]
  const no = [
    'http://fcm.googleapis.com/fcm/send/abc', 'https://10.0.0.5/admin', 'https://localhost/x',
    'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com/x', 'https://fcm.googleapis.com@evil.example/x',
    'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'javascript:alert(1)',
    `https://fcm.googleapis.com/${'a'.repeat(1100)}`, 42, null,
  ]
  for (const e of ok) if (!isAllowedPushEndpoint(e)) bad.push(`rejected a real endpoint: ${e}`)
  for (const e of no) if (isAllowedPushEndpoint(e)) bad.push(`accepted: ${String(e).slice(0, 60)}`)
  if (!isPushKey('BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM')) bad.push('rejected a real p256dh')
  if (isPushKey('<script>alert(1)</script>xxxxx')) bad.push('accepted a non-base64url key')
  if (!isGonePushStatus(404) || !isGonePushStatus(410) || isGonePushStatus(500) || isGonePushStatus(429)) bad.push('gone-status rule wrong: only 404 and 410 delete a subscription')
  return bad
})

// ── PU8 ─────────────────────────────────────────────────────────────────────
await check('PU8', 'Without all three VAPID settings, push is off — silently', () => {
  const bad = []
  const full = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:max@example.com' }
  if (!pushConfig(full)) bad.push('a complete config was refused')
  for (const k of Object.keys(full)) {
    if (pushConfig({ ...full, [k]: undefined }) !== null) bad.push(`missing ${k} still configured push`)
    if (pushConfig({ ...full, [k]: '  ' }) !== null) bad.push(`blank ${k} still configured push`)
  }
  if (pushConfig({ ...full, VAPID_SUBJECT: 'max@example.com' }) !== null) bad.push('a subject without mailto:/https: was accepted')
  if (pushConfig({}) !== null) bad.push('an empty environment configured push')
  return bad
})

// ── PU9 ─────────────────────────────────────────────────────────────────────
await check('PU9', 'What is sent is what the serialiser produced', () => {
  const bad = []
  const src = stripComments(readFileSync(join(ROOT, 'lib', 'push.ts'), 'utf8'))
  const sends = [...src.matchAll(/sendNotification\(\s*\{[\s\S]*?\}\s*\}\s*,\s*([A-Za-z_$][\w$]*)\s*,/g)]
  if (sends.length !== 1) bad.push(`expected one sendNotification call with a named payload, found ${sends.length}`)
  for (const m of sends) {
    if (!new RegExp(`const\\s+${m[1]}\\s*=\\s*serializePushPayload\\(`).test(src)) bad.push(`the payload "${m[1]}" is not the serialiser's output`)
  }
  return bad
})

// ── the service worker ──────────────────────────────────────────────────────

function loadWorker() {
  const listeners = {}
  const shown = []
  const opened = []
  const ctx = {
    URL, console, Promise, setTimeout,
    location: { origin: 'https://app.test' },
    caches: { open: async () => ({}), keys: async () => [], delete: async () => true },
    fetch: async () => ({}),
    skipWaiting: async () => {},
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }) }, unregister: async () => true },
    clients: { claim: async () => {}, matchAll: async () => ctx._windows, openWindow: async (u) => { opened.push(u) } },
    _windows: [],
  }
  ctx.self = ctx
  vm.createContext(ctx)
  vm.runInContext(readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8'), ctx, { filename: 'public/sw.js' })
  const fire = async (type, event) => {
    const waits = []
    for (const fn of listeners[type] ?? []) fn({ ...event, waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
  }
  return { ctx, listeners, shown, opened, fire }
}
const pushEvent = (obj) => ({ data: { json: () => (typeof obj === 'function' ? obj() : obj) } })

await check('PU10', 'The worker shows a title and never a body, whatever the payload holds', async () => {
  const bad = []
  const w = loadWorker()
  for (const t of ['install', 'activate', 'fetch', 'message', 'push', 'notificationclick']) {
    if (!w.listeners[t]?.length) bad.push(`no ${t} listener`)
  }
  await w.fire('push', pushEvent({ title: 'New message from Max', body: SECRET, content: SECRET, summary: SECRET, url: '/athlete?tab=messages', tag: 'cv-messages', icon: 'https://evil.example/x.png' }))
  if (w.shown.length !== 1) bad.push(`showNotification called ${w.shown.length} times`)
  const n = w.shown[0]
  if (n) {
    if (n.title !== 'New message from Max') bad.push(`title "${n.title}"`)
    if ('body' in n.options) bad.push('options carry a body')
    if (JSON.stringify(n).includes(SECRET)) bad.push('content from the payload reached the notification')
    if (n.options.data?.url !== '/athlete?tab=messages') bad.push(`data.url "${n.options.data?.url}"`)
    if (n.options.icon !== '/icon-192.png') bad.push(`icon taken from the payload: ${n.options.icon}`)
  }
  // A malformed push still shows something (a silent push costs the subscription).
  await w.fire('push', pushEvent(() => { throw new SyntaxError('bad json') }))
  if (w.shown[1]?.title !== 'CoachVoice') bad.push(`malformed push showed "${w.shown[1]?.title}"`)
  await w.fire('push', { data: null })
  if (w.shown[2]?.title !== 'CoachVoice') bad.push('an empty push showed nothing')
  return bad
})

await check('PU11', 'A tap opens the app at the right page, and never another site', async () => {
  const bad = []
  const target = `/dashboard?tab=messages&athlete=${ATHLETE}`

  // No window open: open one.
  let w = loadWorker()
  await w.fire('notificationclick', { notification: { close() {}, data: { url: target } } })
  if (w.opened.join() !== target) bad.push(`no window: opened [${w.opened.join()}]`)

  // App already open: focus it and move it, do not open a second.
  w = loadWorker()
  const nav = []; let focused = 0
  w.ctx._windows = [
    { url: 'https://elsewhere.example/', focus: async () => { bad.push('focused a foreign window') }, navigate: async () => {} },
    { url: 'https://app.test/athlete', focus: async () => { focused++ }, navigate: async (u) => { nav.push(u) } },
  ]
  await w.fire('notificationclick', { notification: { close() {}, data: { url: target } } })
  if (focused !== 1 || nav.join() !== target || w.opened.length) bad.push(`open app: focused ${focused}, navigated [${nav}], opened [${w.opened}]`)

  // A payload pointing off-site lands on "/".
  for (const evil of ['https://evil.example/phish', '//evil.example/x', 'javascript:alert(1)']) {
    w = loadWorker()
    await w.fire('push', pushEvent({ title: 't', url: evil }))
    const stored = w.shown[0]?.options.data?.url
    if (stored !== '/') bad.push(`push url "${evil}" stored as "${stored}"`)
    w = loadWorker()
    await w.fire('notificationclick', { notification: { close() {}, data: { url: evil } } })
    if (w.opened.join() !== '/') bad.push(`click url "${evil}" opened [${w.opened}]`)
  }
  return bad
})

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Push notification rig${OFF} ${DIM}— lib/push.ts and public/sw.js, run for real${OFF}\n`)
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
  console.log(`${RED}✗ ${failed} of ${results.length} push rules failed.${OFF}\n`)
  process.exit(1)
}
console.log(`${GREEN}✓ ${results.length} push rules hold.${OFF}\n`)
