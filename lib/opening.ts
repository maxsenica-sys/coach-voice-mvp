// lib/opening.ts
//
// The opening: a coach's voice becomes the winner's wreath.
//
// Max, 2026-10-09, choosing from five mock-ups: "Voice Becomes the Wreath …
// definitely my favourite by a long shot", with "Hear it. Own it." under the
// name. A line of voice bars pulses like a coach talking, then each bar flies up
// and becomes one leaf of the laurel: the coach's words turn into the athlete's
// honour. Then the name, then the line.
//
// It replaces the montage of fourteen sports, which Max retired ("I'm not a big
// fan of it"). Its sprite, its generator and its timing module are deleted.
//
// ── Why this is a .ts of strings and numbers ───────────────────────────────
//
// The opening plays in three places and they must be the same picture:
//
//   1. the boot shell in app/layout.tsx, which is inline CSS over server
//      markup so it plays before any JavaScript exists (see CLAUDE.md, "an
//      animation that lives in the page bundle cannot cover the wait for the
//      page bundle");
//   2. the sign-in page's intro, app/components/IntroSequence.tsx;
//   3. the iOS launch images, rendered from the resting frame by
//      tools/build-launch-images.mjs under plain Node.
//
// Node can strip TypeScript but cannot parse JSX, so the geometry, the timing
// and the CSS live here, with no imports beyond the wreath itself. The React
// markup is app/components/OpeningMark.tsx, built from the same arrays.
//
// Every animation is gated on `prefers-reduced-motion: no-preference`, and
// every element's un-animated style IS its resting frame. So reduced motion,
// a missing stylesheet rule or dead JavaScript all show the finished lockup,
// never an empty screen.

import { LAUREL_LEAVES, LAUREL_STEMS, LAUREL_STEM_WIDTH } from '@/lib/brand-mark'

/** The line under the name. Max's other shortlisted lines, kept in
 *  .claude/MEMORY.md in case he swaps: "Listen. Learn. Win." and
 *  "Heard today. Better tomorrow." */
export const SLOGAN = 'Hear it. Own it.'

// ── Timing (ms from the moment the opening is first painted) ────────────────

/** The voice bars pulse, then fly up into the wreath. */
export const BARS_AT = 40
export const BARS_MS = 1500
/** The two branch stems draw upward as the bars arrive. */
export const STEMS_AT = 900
export const STEMS_MS = 650
/** Leaves sprout bottom to tip, both branches together, one rank per step. */
export const LEAVES_AT = 1150
export const LEAF_STEP_MS = 40
export const LEAF_MS = 420
/** The name rises once the wreath has closed, then the line. */
export const WORD_AT = 1700
export const WORD_MS = 520
export const SLOGAN_AT = 2100
export const SLOGAN_MS = 600
/** Everything after this is a held frame. */
export const SEQUENCE_MS = SLOGAN_AT + SLOGAN_MS // 2700

// ── Geometry (the wreath's own 48×48 box, lib/brand-mark.ts) ────────────────

/**
 * Amplitude envelope of a real 8-second coaching clip, reduced to 64 peaks.
 * Moved here from the deleted lib/montage-schedule.ts; the bars below sample it
 * so the line pulses like a real voice rather than at random.
 */
export const PEAKS = [
  3, 6, 4, 9, 14, 10, 18, 26, 20, 32, 24, 16, 22, 30, 38, 30,
  22, 14, 20, 28, 22, 15, 10, 17, 25, 34, 27, 19, 12, 8, 14, 21,
  29, 23, 16, 11, 7, 12, 18, 26, 20, 13, 9, 15, 22, 17, 11, 7,
  10, 14, 9, 6, 4, 7, 5, 3, 5, 8, 5, 3, 4, 6, 3, 2,
]

/** One bar per leaf. */
export const BAR_COUNT = LAUREL_LEAVES.length // 24
const HALF = BAR_COUNT / 2

/** Each bar's centre x along the voice line, which runs across the wreath's middle. */
export const barX = (i: number): number => +(5 + i * (38 / (BAR_COUNT - 1))).toFixed(2)
export const BAR_Y = 24
export const BAR_W = 1.1
export const BAR_H = 8

/**
 * Which leaf each bar becomes. The left half of the line feeds the left branch
 * and the right half the right; the bars nearest the middle become the bottom
 * leaves, the outer ones the tips. Leaves are listed bottom-up per branch in
 * lib/brand-mark.ts, left branch first.
 */
export const leafForBar = (i: number): number => (i < HALF ? HALF - 1 - i : i)

/** A leaf's place up its own branch: 0 at the bottom, 11 at the tip. */
export const leafRank = (leaf: number): number => leaf % HALF

/** Three pulse heights per bar, as scale factors, sampled from the real voice. */
export function barPulses(i: number): [number, number, number] {
  const max = Math.max(...PEAKS)
  const s = (k: number) => {
    const v = PEAKS[(i * 2 + k * 21) % PEAKS.length] / max
    return +(0.28 + v * 0.95).toFixed(2)
  }
  return [s(0), s(1), s(2)]
}

// ── CSS ──────────────────────────────────────────────────────────────────────

/**
 * The animation, scoped under `root` (e.g. `#cv-boot`), gated so it only runs
 * when `gate` matches (e.g. `html[data-intro] `, or '' to run whenever the
 * element is displayed) and motion is allowed. Keyframe names carry `prefix`
 * so two copies on one page cannot collide.
 *
 * Colours are literals on purpose: the boot shell paints before any
 * stylesheet, so a var() here would be unresolved at the moment it matters.
 */
export function openingCss(root: string, gate = '', prefix = 'op'): string {
  const R = `${gate}${root}`
  const k = (n: string) => `${prefix}-${n}`
  const out: string[] = []

  // Resting frame — no animation required to see any of it. The bars exist only
  // to become the wreath, so at rest they are not there.
  out.push(`${root} .op-bar { opacity: 0 }`)
  out.push(`${root} .op-bar, ${root} .op-leaf { transform-box: fill-box; transform-origin: center }`)

  const anim: string[] = []
  // The stroke-opacity ramp is not decoration: with the dash fully offset, the
  // path's round caps still paint, as two stray dots at each end of the stem.
  anim.push(`@keyframes ${k('stem')} { 0% { stroke-dashoffset: 1; stroke-opacity: 0 } 6% { stroke-opacity: 1 } 100% { stroke-dashoffset: 0; stroke-opacity: 1 } }`)
  anim.push(`${R} .op-stem { stroke-dasharray: 1; animation: ${k('stem')} ${STEMS_MS}ms cubic-bezier(.4,0,.2,1) ${STEMS_AT}ms both }`)
  anim.push(`@keyframes ${k('leaf')} { 0% { transform: scale(0); opacity: 0 } 65% { transform: scale(1.18); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }`)
  for (let leaf = 0; leaf < BAR_COUNT; leaf++) {
    anim.push(`${R} .op-leaf.l${leaf} { animation: ${k('leaf')} ${LEAF_MS}ms cubic-bezier(.22,1,.36,1) ${LEAVES_AT + leafRank(leaf) * LEAF_STEP_MS}ms both }`)
  }
  for (let i = 0; i < BAR_COUNT; i++) {
    const [cx, cy, , , deg] = LAUREL_LEAVES[leafForBar(i)]
    const dx = +(cx - barX(i)).toFixed(2)
    const dy = +(cy - BAR_Y).toFixed(2)
    const [a, b, c] = barPulses(i)
    const t = (x: number, y: number, r: number, sx: number, sy: number) =>
      `transform: translate(${x}px, ${y}px) rotate(${r}deg) scale(${sx}, ${sy})`
    anim.push(`@keyframes ${k('b' + i)} {
  0% { opacity: 0; ${t(0, 0, 0, 1, 0.15)} }
  12% { opacity: 1; ${t(0, 0, 0, 1, a)} }
  26% { opacity: 1; ${t(0, 0, 0, 1, b)} }
  40% { opacity: 1; ${t(0, 0, 0, 1, c)} }
  52% { opacity: 1; ${t(0, 0, 0, 1, 0.5)} }
  100% { opacity: 0; ${t(dx, dy, deg + 90, 1.4, 0.55)} }
}`)
    // The middle of the line moves first, so the wreath fills from the bottom.
    const delay = BARS_AT + Math.round(Math.abs(i - (HALF - 0.5)) * 14)
    anim.push(`${R} .op-bar.b${i} { animation: ${k('b' + i)} ${BARS_MS}ms ease-in-out ${delay}ms both }`)
  }
  anim.push(`@keyframes ${k('rise')} { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }`)
  anim.push(`@keyframes ${k('fade')} { from { opacity: 0 } to { opacity: 1 } }`)
  anim.push(`${R} .op-word { animation: ${k('rise')} ${WORD_MS}ms cubic-bezier(.22,1,.36,1) ${WORD_AT}ms both }`)
  anim.push(`${R} .op-slogan { animation: ${k('fade')} ${SLOGAN_MS}ms ease-out ${SLOGAN_AT}ms both }`)

  out.push(`@media (prefers-reduced-motion: no-preference) {\n${anim.join('\n')}\n}`)
  return out.join('\n')
}

/**
 * The wreath and its voice bars as an SVG string, at rest, for the places that
 * build strings: the launch images. app/components/OpeningMark.tsx renders the
 * same elements as JSX.
 */
export function openingSvgMarkup(color = '#F5ECD7', barColor = '#A8CBA0'): string {
  const bars = Array.from({ length: BAR_COUNT }, (_, i) =>
    `<rect class="op-bar b${i}" x="${+(barX(i) - BAR_W / 2).toFixed(2)}" y="${BAR_Y - BAR_H / 2}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_W / 2}" fill="${barColor}"/>`).join('')
  const stems = LAUREL_STEMS
    .map((d) => `<path class="op-stem" d="${d}" pathLength="1" fill="none" stroke="${color}" stroke-width="${LAUREL_STEM_WIDTH}" stroke-linecap="round"/>`).join('')
  const leaves = LAUREL_LEAVES.map(([x, y, rx, ry, deg], i) =>
    `<g class="op-leaf l${i}"><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${deg} ${x} ${y})" fill="${color}"/></g>`).join('')
  return `<svg class="op-wreath" viewBox="0 0 48 48" aria-hidden="true">${stems}${leaves}${bars}</svg>`
}

/**
 * Where the opening sits on a full screen: the boot shell's layout, and the
 * iOS launch images' too. They must be the same pixels — the handoff from the
 * OS's launch image to the shell is a repaint of one frame, and
 * tools/boot-smoke.mjs compares them for every device geometry — so both read
 * this one string rather than each keeping a copy.
 *
 * System fonts only: this paints before any webfont can exist. A var() would
 * be unresolved at this instant and an unresolved var() invalidates the whole
 * declaration, fallbacks included.
 */
export function fullScreenFrameCss(root: string): string {
  return `${root} .op-wreath {
  position: absolute; top: 50%; left: 50%;
  width: min(50vw, 210px); height: min(50vw, 210px);
  transform: translate(-50%, calc(-50% - 74px));
  overflow: visible;
}
${root} .op-word {
  position: absolute; top: calc(50% + 46px); left: 0; right: 0;
  text-align: center; color: #F5ECD7;
  font-weight: 800; font-size: 40px; letter-spacing: -0.04em;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
${root} .op-slogan {
  position: absolute; top: calc(50% + 102px); left: 0; right: 0;
  text-align: center; color: rgba(245, 236, 215, .8);
  font-size: 20px; font-style: italic;
  font-family: Georgia, "Times New Roman", serif;
}`
}
