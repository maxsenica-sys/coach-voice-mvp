#!/usr/bin/env node
/**
 * tools/reinstall-rig.mjs — the "get the new icon" prompt, and the icon
 * version that lets Android pick the laurel up by itself.
 *
 *   npm run verify:reinstall
 *
 * The prompt asks a person to DELETE the app from their Home Screen. On iOS
 * that deletes the app's storage, which is where an offline check-in or
 * recording waits for a signal. So the rules here are not cosmetic:
 *
 *   R1  Never shown while anything is waiting to upload.
 *   R2  Only an iPhone/iPad, only from the Home Screen, only an install made
 *       before the rename. A fresh install already has the new icon.
 *   R3  "Got it" is for good; "Later" comes back after the snooze, not before.
 *   R4  The install is classified in the boot script BEFORE that script writes
 *       the storage keys it uses as evidence — otherwise every fresh install
 *       would look old and be told to delete itself.
 *   R5  Every place that names an icon file uses the same ?v= version, so the
 *       manifest Chrome compares, the iOS link and the service worker agree.
 *
 * Imports the real module; R4 and R5 read the real source files.
 */

import { readFileSync } from 'node:fs'
import {
  shouldShowReinstallNudge, isIosDevice, INSTALL_KEY, NUDGE_KEY, SNOOZE_MS,
} from '../lib/reinstall-nudge.ts'

let failed = 0
function check(name, ok, detail = '') {
  if (ok) console.log(`   \x1b[32mPASS\x1b[0m  ${name}`)
  else { failed++; console.log(`   \x1b[31mFAIL\x1b[0m  ${name}${detail ? `  — ${detail}` : ''}`) }
}

const NOW = 1_780_000_000_000
const base = { isIos: true, standalone: true, install: 'before-rename', nudge: null, pending: 0, now: NOW }
const show = (over) => shouldShowReinstallNudge({ ...base, ...over })

check('R0  an old iPhone install with nothing pending is asked', show({}) === true)
check('R1  one check-in or recording waiting: not asked', show({ pending: 1 }) === false)
check('R1  many waiting: not asked', show({ pending: 7 }) === false)
check('R2  not an iPhone/iPad: not asked (Android updates by itself)', show({ isIos: false }) === false)
check('R2  in a Safari tab, not installed: not asked', show({ standalone: false }) === false)
check('R2  installed after the rename: not asked', show({ install: 'after-rename' }) === false)
check('R2  no classification at all (blocked storage): not asked', show({ install: null }) === false)
check('R3  "Got it" is permanent', show({ nudge: 'done' }) === false)
check('R3  "Later" hides it until the snooze runs out', show({ nudge: String(NOW + SNOOZE_MS) }) === false)
check('R3  and it comes back after', show({ nudge: String(NOW - 1) }) === true)
check('R3  a garbage stored value does not hide it for ever', show({ nudge: 'x' }) === true)

check('R2  iPhone user agent is iOS', isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5))
check('R2  iPadOS reporting as a Mac with touch is iOS', isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5))
check('R2  a real Mac is not', !isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0))
check('R2  Android is not', !isIosDevice('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l', 5))

// R4 — order inside the real boot script.
const layout = readFileSync('app/layout.tsx', 'utf8')
const boot = layout.slice(layout.indexOf('const BOOT_JS'))
const classify = boot.indexOf(`localStorage.setItem('${INSTALL_KEY}'`)
const writes = ["localStorage.setItem('cv_intro_v1'", "localStorage.setItem('cv_splash_at'"].map((s) => boot.indexOf(s))
check('R4  the boot script classifies the install', classify > -1)
check('R4  …before it writes cv_intro_v1 or cv_splash_at', classify > -1 && writes.every((w) => w > classify),
  `classify at ${classify}, writes at ${writes.join(', ')}`)
check('R4  …using the same key the prompt reads', boot.includes(`localStorage.getItem('${INSTALL_KEY}')`))
check('R3  the snooze key is the one the prompt writes', readFileSync('app/components/ReinstallNudge.tsx', 'utf8').includes('NUDGE_KEY') && NUDGE_KEY.length > 0)

// R5 — one icon version everywhere.
const sources = {
  'app/manifest.ts': readFileSync('app/manifest.ts', 'utf8'),
  'app/layout.tsx': layout,
  'public/sw.js': readFileSync('public/sw.js', 'utf8'),
}
const versions = new Set()
let bare = []
for (const [file, src] of Object.entries(sources)) {
  for (const m of src.matchAll(/['"`](\/(?:icon[^'"`\s?]*|apple-icon)\.(?:png|svg))(\?v=[\w-]+)?['"`]/g)) {
    if (!m[2]) bare.push(`${file}: ${m[1]}`)
    else versions.add(m[2])
  }
}
check('R5  no icon is referenced without a version', bare.length === 0, bare.join('; '))
check('R5  every icon reference carries the same version', versions.size === 1, [...versions].join(' vs '))

console.log()
if (failed) {
  console.log(`\x1b[31m✗ ${failed} reinstall check(s) failed.\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32m✓ The new-icon prompt only asks the right people, at a safe time.\x1b[0m')
