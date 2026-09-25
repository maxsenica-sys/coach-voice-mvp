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
 * It was written as a ratchet because there were 154 of these. They are all
 * gone, so the baseline is 0 and this is now a plain assertion: anything under
 * the floor fails. The ratchet is kept only in shape — if a future change adds
 * a batch too large for one commit, set BASELINE and drive it back down.
 *
 *   node tools/type-floor-check.mjs            fail if the count rose
 *   node tools/type-floor-check.mjs --list     print every offending line
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const FLOOR = 13

/* Zero, and it stays zero. Raising this is how a floor quietly stops being a
 * floor — if you are about to, you are adding type nobody can read outdoors. */
const BASELINE = 0

const SCAN = ['app', 'lib']
const SKIP = /node_modules|\.next|\/pdf\//   /* the PDF routes are print, not screen */

/* Resolve the app's own size tokens, transitively.
 *
 * The rig read 0 while ~150 call sites rendered at 11 and 12px, because they
 * said `fontSize: 'var(--fs-1)'` and the scanner only understood numbers. A
 * floor that a token can walk under is not a floor, and a green check that is
 * wrong is worse than no check — so the token values are read from the
 * stylesheet and followed through aliases before anything is judged. */
function sizeTokens() {
  const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
  const raw = new Map()
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) raw.set(m[1], m[2].trim())
  const seen = new Map()
  const resolve = (name, depth = 0) => {
    if (seen.has(name)) return seen.get(name)
    if (depth > 8) return null
    const v = raw.get(name)
    if (!v) return null
    let px = null
    const direct = v.match(/^([\d.]+)px$/)
    if (direct) px = parseFloat(direct[1])
    else {
      const alias = v.match(/^var\(\s*(--[\w-]+)/)
      if (alias) px = resolve(alias[1], depth + 1)
    }
    seen.set(name, px)
    return px
  }
  const out = new Map()
  for (const name of raw.keys()) {
    const px = resolve(name)
    if (px !== null) out.set(name, px)
  }
  return out
}
const TOKENS = sizeTokens()

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

/* Blank out comments before scanning, keeping line numbers intact.
 *
 * Without this the rig flags its own documentation: the comment in
 * WellnessGraph that explains the fontSize="9" bug contains the string
 * fontSize="9", and a scanner that reports a fix as a violation is a scanner
 * people learn to ignore. */
function codeOnly(src) {
  let out = '', inBlock = false, inLine = false, quote = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1]
    if (c === '\n') { inLine = false; quote = ''; out += c; continue }
    if (inBlock) { if (c === '*' && d === '/') { inBlock = false; out += '  '; i++ } else out += ' '; continue }
    if (inLine) { out += ' '; continue }
    if (quote) { if (c === '\\') { out += '  '; i++; continue } if (c === quote) quote = ''; out += c; continue }
    if (c === '/' && d === '*') { inBlock = true; out += '  '; i++; continue }
    if (c === '/' && d === '/') { inLine = true; out += '  '; i++; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue }
    out += c
  }
  return out
}

const hits = []
for (const file of SCAN.flatMap(d => walk(path.join(ROOT, d)))) {
  const rel = path.relative(ROOT, file)
  codeOnly(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
    /* the 16px iOS-zoom floor block sets sizes deliberately; it is not type */
    if (/iOS zoom|zoom prevention/.test(line)) return
    const add = (size, what) => hits.push({ rel, line: i + 1, size, what: what.trim().slice(0, 72) })

    for (const m of line.matchAll(/font-size:\s*([\d.]+)px/g))
      if (parseFloat(m[1]) < FLOOR) add(parseFloat(m[1]), line)
    for (const m of line.matchAll(/fontSize:\s*'?([\d.]+)(?:px)?'?/g))
      if (parseFloat(m[1]) < FLOOR) add(parseFloat(m[1]), line)
    /* SVG sets type as an ATTRIBUTE, not a style property: fontSize="9" with
     * no colon, which the rule above cannot see. This is not hypothetical —
     * WellnessGraph carried fontSize="9" axis labels inside a
     * viewBox="0 0 520 150" drawn at width:100%. A viewBox scales its contents,
     * so nine units of a 520-unit box painted into a ~300px phone card landed
     * on the glass at 5.2px, and the rig reported the file clean.
     *
     * A static scanner cannot resolve the viewBox ratio, so it cannot tell you
     * the rendered size. It can tell you the authored number is under the
     * floor, which is enough to make someone look. Under a viewBox the real
     * size is almost always SMALLER than the number, never larger. */
    for (const m of line.matchAll(/\bfont-?[sS]ize\s*=\s*["']?([\d.]+)["']?/g))
      if (parseFloat(m[1]) < FLOOR) add(parseFloat(m[1]), line)
    /* a token used as a font size, resolved to the px it actually paints */
    for (const m of line.matchAll(/font-?[sS]ize\s*[:=]\s*['"]?var\(\s*(--[\w-]+)/g)) {
      const px = TOKENS.get(m[1])
      if (px !== undefined && px !== null && px < FLOOR) add(px, line)
    }
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
