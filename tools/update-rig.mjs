#!/usr/bin/env node
/**
 * tools/update-rig.mjs — new versions reach an installed app without anyone
 * deleting it, and never at a moment that loses something.
 *
 *   npm run verify:update
 *
 * Max, 2026-10-09: "it's becoming increasingly frustrating that we have to
 * keep constantly deleting the app." Why that was, and what replaced it, is
 * lib/app-update.ts. The rules:
 *
 *   U1  Same version: nothing happens. A newer one: the app acts.
 *   U2  Never reloads over something in progress — a sheet, a recording, an
 *       unsent clip, typed text — whatever the moment.
 *   U3  Coming back after a real absence reloads; a glance away does not.
 *   U4  A periodic check while on screen never reloads by itself; it waits.
 *   U5  Moving to another page is a safe moment.
 *   U6  A reload that did not land is not retried in a loop.
 *   U7  An unreadable answer changes nothing.
 *   U8  Every marker the busy test relies on still exists in the screen it
 *       was taken from — a recorder whose markup changes turns this red
 *       rather than quietly becoming reloadable.
 *   U9  The build and the manifest carry the same version, and it is never
 *       a timestamp (a same-code redeploy would reload every open app).
 *   U10 The service worker never answers for the manifest, so the answer is
 *       the server's.
 *
 * Imports the real module; U8–U10 read the real source files.
 */

import { readFileSync } from 'node:fs'
import {
  updateDecision, servedVersion, BUSY_SELECTOR, TEXT_ENTRY_SELECTOR,
  MIN_AWAY_MS, RETRY_AFTER_MS, VERSION_FIELD, VERSION_URL,
} from '../lib/app-update.ts'

let failed = 0
function check(name, ok, detail = '') {
  if (ok) console.log(`   \x1b[32mPASS\x1b[0m  ${name}`)
  else { failed++; console.log(`   \x1b[31mFAIL\x1b[0m  ${name}${detail ? `  — ${detail}` : ''}`) }
}

const NOW = 1_780_000_000_000
const base = { running: 'aaa111', served: 'bbb222', moment: 'resume', awayMs: 5 * 60_000, busy: false, lastAttempt: null, now: NOW }
const d = (over) => updateDecision({ ...base, ...over })

check('U1  same version on resume: nothing', d({ served: 'aaa111' }) === 'none')
check('U1  same version on navigate: nothing', d({ served: 'aaa111', moment: 'navigate' }) === 'none')
check('U1  newer version, back after 5 minutes, nothing open: reload', d({}) === 'reload')

for (const moment of ['resume', 'navigate', 'interval']) {
  check(`U2  busy on ${moment}: waits, never reloads`, d({ moment, busy: true, awayMs: 24 * 3600_000 }) === 'wait')
}

check('U3  back after exactly MIN_AWAY_MS: reload', d({ awayMs: MIN_AWAY_MS }) === 'reload')
check('U3  back after a glance (MIN_AWAY_MS - 1): waits', d({ awayMs: MIN_AWAY_MS - 1 }) === 'wait')
check('U3  back from the back/forward cache (Infinity): reload', d({ awayMs: Infinity }) === 'reload')
check('U3  MIN_AWAY_MS is short enough to matter and long enough to spare a glance',
  MIN_AWAY_MS >= 10_000 && MIN_AWAY_MS <= 5 * 60_000, `${MIN_AWAY_MS}ms`)

check('U4  periodic check, newer version, nothing open: waits', d({ moment: 'interval' }) === 'wait')

check('U5  page change with a newer version: reload', d({ moment: 'navigate', awayMs: 0 }) === 'reload')

check('U6  tried this version a minute ago: nothing', d({ lastAttempt: `bbb222|${NOW - 60_000}` }) === 'none')
check('U6  …and on a page change too', d({ moment: 'navigate', lastAttempt: `bbb222|${NOW - 60_000}` }) === 'none')
check('U6  tried it RETRY_AFTER_MS ago: tries again', d({ lastAttempt: `bbb222|${NOW - RETRY_AFTER_MS}` }) === 'reload')
check('U6  an attempt at an older version does not block a newer one', d({ lastAttempt: `aaa000|${NOW - 1000}` }) === 'reload')
check('U6  an attempt stamped in the future (clock change) does not block for ever', d({ lastAttempt: `bbb222|${NOW + 3600_000}` }) === 'reload')
check('U6  a garbage stored value does not block', d({ lastAttempt: 'x' }) === 'reload' && d({ lastAttempt: '|' }) === 'reload')
check('U6  a version containing "|" still parses', d({ served: 'a|b', lastAttempt: `a|b|${NOW - 1000}` }) === 'none')

check('U7  manifest unreadable (null): nothing', d({ served: null }) === 'none')
check('U7  running version unknown: nothing', d({ running: '' }) === 'none')
check('U7  servedVersion reads the field', servedVersion({ [VERSION_FIELD]: ' abc ' }) === 'abc')
check('U7  …and nothing else', [null, undefined, 'abc', 42, {}, { [VERSION_FIELD]: '' }, { [VERSION_FIELD]: 7 }]
  .every((m) => servedVersion(m) === null))

// U8 — the busy markers, against the screens they come from.
const src = (f) => readFileSync(f, 'utf8')
const anchors = [
  ['[role="dialog"]', 'app/components/QuickSessionModal.tsx', /role="dialog"/, 'the coach session recorder is a dialog'],
  ['[aria-modal="true"]', 'app/components/QuickSessionModal.tsx', /aria-modal="true"/, 'and modal'],
  ['.recording-dot', 'app/athlete/page.tsx', /noteRecording \? <><span className="recording-dot"/, "the athlete's voice note shows it only while recording"],
  ['[aria-label="Stop recording"]', 'app/components/MessagingPanel.tsx', /aria-label=\{recordingAudio \? 'Stop recording'/, 'a voice message, while recording'],
  ['audio[src^="blob:"]', 'app/components/MessagingPanel.tsx', /<audio controls src=\{audioUrl!?\}/, 'an unsent voice message plays from a blob: URL'],
]
for (const [sel, file, re, why] of anchors) {
  check(`U8  ${sel} is in the busy test — ${why}`, BUSY_SELECTOR.includes(sel) && re.test(src(file)),
    !BUSY_SELECTOR.includes(sel) ? 'missing from BUSY_SELECTOR' : `${file} no longer matches ${re}`)
}
check('U8  an unsent voice message URL really is a blob: URL', /setAudioUrl\(URL\.createObjectURL\(/.test(src('app/components/MessagingPanel.tsx')))
check('U8  only text the person typed counts — a field the app filled in never holds an update back',
  /if \(!typedInto\.has\(el\)\) continue/.test(src('app/components/UpdateWatcher.tsx')) &&
  /addEventListener\('input', onInput, true\)/.test(src('app/components/UpdateWatcher.tsx')))
check('U8  typed text counts: textarea and plain inputs are text entry', ['textarea', 'input:not([type])', 'input[type="text"]'].every((s) => TEXT_ENTRY_SELECTOR.includes(s)))

// U9 — one version, the same in the bundle and the manifest.
const config = src('next.config.ts')
const manifest = src('app/manifest.ts')
const watcher = src('app/components/UpdateWatcher.tsx')
const layout = src('app/layout.tsx')
check('U9  next.config.ts sets NEXT_PUBLIC_APP_VERSION', /NEXT_PUBLIC_APP_VERSION:\s*appVersion\(\)/.test(config))
const fn = config.slice(config.indexOf('function appVersion'), config.indexOf('const nextConfig'))
check('U9  …from the commit, never a clock or a random value', /VERCEL_GIT_COMMIT_SHA/.test(fn) && !/Date\.now|new Date|Math\.random|randomUUID|hrtime/.test(fn))
check('U9  the manifest carries it under VERSION_FIELD', /\[VERSION_FIELD\]:\s*process\.env\.NEXT_PUBLIC_APP_VERSION/.test(manifest))
check('U9  the watcher compares against the same variable', /process\.env\.NEXT_PUBLIC_APP_VERSION/.test(watcher))
check('U9  the watcher is mounted in the root layout', /import UpdateWatcher from/.test(layout) && /<UpdateWatcher \/>/.test(layout))
check('U9  the watcher asks without the HTTP cache', /fetch\(VERSION_URL, \{ cache: 'no-store' \}\)/.test(watcher))

// U10 — the worker's own rule, run.
const sw = src('public/sw.js')
const body = sw.match(/function isCacheable\(url\) \{[\s\S]*?\n\}/)
let cacheable = null
try { cacheable = new Function(`${body[0]}; return isCacheable`)() } catch { /* reported below */ }
check('U10 the service worker\'s isCacheable was found and runs', typeof cacheable === 'function')
check('U10 …and does not claim the manifest', cacheable && !cacheable(new URL(`https://x${VERSION_URL}`)))

console.log()
if (failed) {
  console.log(`\x1b[31m✗ ${failed} update check(s) failed.\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32m✓ New versions reach an installed app on their own, and never over unsaved work.\x1b[0m')
