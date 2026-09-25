#!/usr/bin/env node
/* type-floor-check — nothing in this app renders below 13px.
 *
 * Max, 2026-09-25: "maximise human retention and viewage using the furniture
 * floor. everything should be easily viewable."
 *
 * The app shipped its uppercase furniture and mono data at 9–12px. Legible at a
 * desk; not on a touchline in the sun, not to a fifteen-year-old on a cracked
 * screen, and not to a parent reading over a shoulder. `--t-min: 13px` in
 * globals.css is the floor, and this is what holds it.
 *
 * WHY A RIG AND NOT A CODE REVIEW: every type regression this project has had
 * passed `tsc`, `eslint` and `next build`. A number is a number to all three.
 *
 * WHY A RATCHET, NOT A HARD ZERO: there are 151 of these today. Failing on all
 * of them would mean either one unreviewable commit or a disabled check, and a
 * disabled check is worth nothing. So the count may only ever go DOWN. Lower
 * the baseline in the same commit that fixes the call sites — the rig prints
 * the exact line to change. The target is 0, at which point this becomes a
 * plain assertion and the baseline constant goes away.
 *
 *   node tools/type-floor-check.mjs            fail if the count rose
 *   node tools/type-floor-check.mjs --list     print every offending line
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const FLOOR = 13

/* Lower this — never raise it — in the same commit that removes call sites.
 * Raising it is how a floor quietly stops being a floor. */
const BASELINE = 154

const SCAN = ['app', 'lib']
const SKIP = /node_modules|\.next|\/pdf\//   /* the PDF routes are print, not screen */

/* A Tailwind size class that is below the floor. text-xs is 12px. */
const TW = { 'text-xs': 12, 'text-\\[10px\\]': 10, 'text-\\[11px\\]': 11, 'text-\\[12px\\]': 12 }

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (SKIP.test(p)) continue
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(p)
  }
  return out
}

const hits = []
for (const file of SCAN.flatMap(d => walk(path.join(ROOT, d)))) {
  const rel = path.relative(ROOT, file)
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    /* the 16px iOS-zoom floor block sets sizes deliberately; it is not type */
    if (/iOS zoom|zoom prevention/.test(line)) return
    const add = (size, what) => hits.push({ rel, line: i + 1, size, what: what.trim().slice(0, 72) })

    for (const m of line.matchAll(/font-size:\s*([\d.]+)px/g))
      if (parseFloat(m[1]) < FLOOR) add(parseFloat(m[1]), line)
    for (const m of line.matchAll(/fontSize:\s*'?([\d.]+)(?:px)?'?/g))
      if (parseFloat(m[1]) < FLOOR) add(parseFloat(m[1]), line)
    for (const [cls, px] of Object.entries(TW))
      if (new RegExp(`(^|["'\\s])${cls}(["'\\s]|$)`).test(line)) add(px, line)
  })
}

const list = process.argv.includes('--list')
const byFile = new Map()
for (const h of hits) byFile.set(h.rel, (byFile.get(h.rel) ?? 0) + 1)

console.log(`\n  type floor — nothing below ${FLOOR}px\n`)
if (list) {
  for (const h of hits) console.log(`  ${h.rel}:${h.line}  ${h.size}px  ${h.what}`)
  console.log('')
} else {
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(4)}  ${f}`)
  console.log('\n  (--list prints every line)')
}

const n = hits.length
if (n > BASELINE) {
  console.log(`\n  \x1b[31m✗ ${n} runs below ${FLOOR}px — the baseline is ${BASELINE}.\x1b[0m`)
  console.log('    Something new was added under the floor. Use a token:')
  console.log('    --t-furniture / --t-data (13px), --t-body-tight (14px), --t-body (15px).\n')
  process.exit(1)
}
if (n < BASELINE) {
  console.log(`\n  \x1b[33m${n} runs below ${FLOOR}px — down from ${BASELINE}.\x1b[0m`)
  console.log(`    Lower BASELINE to ${n} in tools/type-floor-check.mjs in this commit.\n`)
  process.exit(1)
}
console.log(`\n  \x1b[32m✓ ${n} runs below ${FLOOR}px, matching the baseline. Target is 0.\x1b[0m\n`)
