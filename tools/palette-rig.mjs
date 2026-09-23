#!/usr/bin/env node
/**
 * tools/palette-rig.mjs — the palette's contrast, computed rather than asserted.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every contrast number in globals.css is written in a comment. Comments do not
 * fail. The #9BA29B regression shipped with a comment next to it, and the
 * primary button has been failing AA across half its area at 35 call sites,
 * under a token whose own comment records a passing ratio for the OTHER end of
 * the gradient.
 *
 * `tsc`, `eslint`, `next build` and the boot harness all pass on every one of
 * those. A contrast failure is not a type error and not a runtime error; it is
 * a number nobody recomputed.
 *
 * So this reads the real values out of app/globals.css and checks them.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It does not have an opinion about which colours are nice. It checks three
 * things that are facts: text clears 4.5:1 on the surface it sits on, the
 * wellness scale stays ordered by lightness so it survives colour blindness and
 * greyscale, and no gradient stop under white text falls below AA.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
// The real modules, never a copy — section 4 checks what the product declares.
const { SESSION_RESPONSES } = await import('../lib/session-response.ts')
const { INJURY_STATUSES } = await import('../lib/injury.ts')

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'

// ── colour maths ──────────────────────────────────────────────────────────
const toLin = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
function lum(hex) {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => toLin(parseInt(f.substr(i, 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)]
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
function lstar(hex) {
  const y = lum(hex)
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y
}

/** Every `--token: #hex;` in the :root block. */
const tokens = {}
for (const m of CSS.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
  tokens[m[1]] = m[2]
}

let checks = 0
const failures = []
function check(ok, name, detail) {
  checks++
  if (ok) console.log(`   ${GREEN}PASS${OFF}  ${name}   ${DIM}${detail ?? ''}${OFF}`)
  else {
    failures.push(`${name} — ${detail}`)
    console.log(`   ${RED}FAIL${OFF}  ${name}   ${RED}${detail}${OFF}`)
  }
}
const t = (n) => {
  if (!tokens[n]) throw new Error(`palette-rig: token ${n} not found in globals.css`)
  return tokens[n]
}

console.log(`\n  ${DIM}Palette rig — the contrast numbers, recomputed from globals.css${OFF}\n`)

// ── 1 · text on the surfaces it actually sits on ─────────────────────────
console.log(`   ${BOLD}Text${OFF} ${DIM}— 4.5:1, the floor for a phone in sunlight${OFF}`)
for (const [fg, bg, label] of [
  ['--text', '--bg', 'body text on the ground'],
  ['--text', '--card', 'body text on a card'],
  ['--text-2', '--bg', 'secondary text on the ground'],
  ['--text-2', '--card', 'secondary text on a card'],
  ['--text-muted', '--card', 'muted text on a card'],
]) {
  const r = ratio(t(fg), t(bg))
  check(r >= 4.5, label, `${t(fg)} on ${t(bg)} = ${r.toFixed(2)}:1`)
}

// ── 2 · the wellness scale ───────────────────────────────────────────────
console.log(`\n   ${BOLD}Wellness${OFF} ${DIM}— readable, and ordered by lightness${OFF}`)
const states = ['good', 'ok', 'low', 'none']
for (const s of states) {
  const fg = t(`--wellness-${s}`), tint = t(`--wellness-${s}-tint`)
  const worst = Math.min(ratio(fg, '#FFFFFF'), ratio(fg, t('--bg')), ratio(fg, tint))
  check(worst >= 4.5, `${s} is readable on every surface it appears on`,
    `worst of white / ground / own tint = ${worst.toFixed(2)}:1`)
}

/* The ordering check.
 *
 * This is the one that catches the bug the palette actually had: four states at
 * L* 40.9-42.3, told apart by hue alone, indistinguishable under deuteranopia
 * and in greyscale. The separation lives in the TINTS — see the comment in
 * globals.css for why it cannot live in the foreground — so that is what is
 * pinned here.
 *
 * `none` is excluded on purpose: "no data" is not a degree of wellness. */
const axis = ['good', 'ok', 'low']
const tintL = axis.map((s) => lstar(t(`--wellness-${s}-tint`)))
check(
  tintL[0] > tintL[1] && tintL[1] > tintL[2],
  'the scale reads light → dark from good to low',
  `L* ${tintL.map((x) => x.toFixed(1)).join(' > ')}`,
)
const spread = tintL[0] - tintL[2]
check(spread >= 10, 'the scale is separated enough to survive greyscale',
  `spread ${spread.toFixed(1)} L* (needs 10+; it was 2.7)`)

// ── 3 · gradients under white text ───────────────────────────────────────
console.log(`\n   ${BOLD}Gradients${OFF} ${DIM}— both ends, not just the dark one${OFF}`)
/* A gradient has two ends and only one of them tends to get measured. The
 * primary button passed at its dark stop (5.94:1) and failed at its light one
 * (3.65:1) — across half the area of the most-used control in the product, 35
 * call sites, for as long as it has existed. */
/* Two versions of this loop were wrong before this one, and both failed the
 * same way: they printed a clean section header and examined nothing.
 *
 * The first used `[^}]*?`, which cannot cross the `)` inside
 * `linear-gradient(...)`. The second matched `\.([\w-]+)` for the selector —
 * which also matches `.30` inside `rgb(111 142 107 / .30)`, so a decimal
 * swallowed the rule that followed it.
 *
 * Hence the guard below. A scan that finds nothing is not a pass, and this
 * section exists precisely because the primary button has been failing at one
 * end of its gradient, at 35 call sites, under a comment recording the ratio
 * for the OTHER end. Splitting on braces is duller and correct. */
let gradientsSeen = 0
for (const rule of CSS.split('}')) {
  const brace = rule.indexOf('{')
  if (brace === -1) continue
  const selector = rule.slice(0, brace).trim().split('\n').pop().trim()
  const body = rule.slice(brace + 1)
  if (!/linear-gradient/.test(body)) continue
  if (!/color:\s*(#fff\b|#ffffff\b|white\b)/i.test(body)) continue
  /* The whole declaration, not a paren-matched slice.
   *
   * A third wrong version lived here: `linear-gradient\(([\s\S]*?)\)` is
   * non-greedy, so it stopped at the first `)` in the string — which belongs to
   * `var(--primary)`, not to the gradient. It captured `135deg, var(--primary`
   * and then found no complete var() tokens in it. Nesting beats cleverness;
   * take the declaration up to its semicolon and read every token in it. */
  const decl = body.split(';').find((d) => d.includes('linear-gradient'))
  if (!decl) continue
  for (const x of decl.matchAll(/var\((--[\w-]+)\)/g)) {
    const stop = x[1]
    if (!tokens[stop]) continue
    gradientsSeen++
    const r = ratio('#FFFFFF', tokens[stop])
    check(r >= 4.5, `${selector} — white text over ${stop}`, `${tokens[stop]} = ${r.toFixed(2)}:1`)
  }
}
check(gradientsSeen > 0, 'the gradient scan actually found gradients',
  `${gradientsSeen} stop(s) examined — zero means this section is inert, not clean`)

// ── 4 · colour/tint pairs the code actually declares ─────────────────────
//
// Sections 1-3 check a token against the surfaces someone listed here. This one
// checks the pairs the PRODUCT declares, by importing them: `INJURY_STATUSES`
// and `SESSION_RESPONSES` each carry a `color` and the `tint` it is rendered
// on, so the pairing is a fact in the source rather than a guess in this file.
//
// It exists because a real failure walked straight past section 1. The selected
// "Working on it" chip paired `--energy-dark` with `--wellness-ok-tint` at
// 4.05:1, and the identical pair sat in the "Modified" injury status — one
// wrong token, two screens, both failing 1.4.3, both invisible to a rig that
// only ever checked tokens against `--bg` and white. `--energy-dark` is fine on
// white. It is the *pairing* that fails, and only the code knows the pairings.
//
// Two design agents found it independently while building mockups. Neither was
// looking for it. That is the argument for this section: a cartesian product of
// every token against every other would have found it too, and drowned it in
// dozens of combinations that never render.
console.log(`\n   ${BOLD}Declared pairs${OFF} ${DIM}— a colour and the tint it is actually drawn on${OFF}`)
let pairsSeen = 0
for (const [label, list] of [
  ['session response', SESSION_RESPONSES],
  ['injury status', INJURY_STATUSES],
]) {
  for (const opt of list) {
    const fg = tokens[(opt.color.match(/var\((--[\w-]+)\)/) ?? [])[1]]
    const bg = tokens[(opt.tint.match(/var\((--[\w-]+)\)/) ?? [])[1]]
    if (!fg || !bg) continue
    pairsSeen++
    const r = ratio(fg, bg)
    check(r >= 4.5, `${label} "${opt.label}" — ${opt.color} on ${opt.tint}`,
      `${fg} on ${bg} = ${r.toFixed(2)}:1`)
  }
}
// A scan that finds nothing to judge is inert, not clean — the same lesson the
// gradient section above records.
check(pairsSeen >= 6, 'the pair scan actually found pairs',
  `${pairsSeen} declared pair(s) examined`)

// ── 4 · the browser is told which theme this is ──────────────────────────
console.log(`\n   ${BOLD}Scheme${OFF}`)
check(/color-scheme:\s*light/.test(CSS), 'color-scheme is declared',
  'without it, UA-styled date and select controls render dark chrome on a white card')

// ── report ───────────────────────────────────────────────────────────────
console.log()
if (failures.length === 0) {
  console.log(`  ${GREEN}✓ ${checks} palette checks passed — every ratio recomputed from source.${OFF}\n`)
  process.exit(0)
}
console.log(`  ${RED}✗ ${failures.length} of ${checks} palette checks failed:${OFF}`)
for (const f of failures) console.log(`   ${RED}· ${f}${OFF}`)
console.log()
process.exit(1)
