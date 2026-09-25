#!/usr/bin/env node
/* bodymap-rig — every region of the body map is big enough to tap.
 *
 * The body map is how an athlete tells their coach where it hurts. It is used
 * one-handed, often by someone who is sore, and a region too small to hit
 * accurately does not fail loudly — it marks the WRONG BODY PART, which is
 * worse than marking nothing. WCAG 2.5.8 sets the floor at 24x24 CSS px.
 *
 * WHY A RIG: the numbers in lib/body-map.ts are viewBox units, not pixels. An
 * SVG viewBox scales its contents, so the authored number understates the real
 * target by whatever the scale factor happens to be — here by a third. Nobody
 * reading `rect(78, 346, 13, 26, 6)` can see that 13 means 20.8px, and tsc,
 * eslint and next build cannot either. The achilles shipped that way and was
 * the only one of twenty-three regions under the floor.
 *
 * This imports the real module. A rig that tested a copy of the geometry would
 * prove the copy consistent and drift the first time the drawing changed.
 */
import { BODY_REGIONS, BODY_VIEWBOX } from '../lib/body-map.ts'
import { readFileSync } from 'node:fs'

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', OFF = '\x1b[0m'

/* The width the figure actually renders at, read from the component rather
 * than repeated here — if someone narrows the SVG, every target shrinks with
 * it and this rig must notice. */
const src = readFileSync(new URL('../app/components/BodyMap.tsx', import.meta.url), 'utf8')
const m = src.match(/maxWidth:\s*(\d+)/)
if (!m) {
  console.log(`\n  ${RED}✗ could not find the SVG maxWidth in BodyMap.tsx${OFF}`)
  console.log('    The rendered scale is what turns viewBox units into pixels.\n')
  process.exit(1)
}
const renderedWidth = parseInt(m[1], 10)
const scale = renderedWidth / BODY_VIEWBOX.w
const FLOOR = 24

/* A phone narrower than the figure scales it down again. 320px is the
 * narrowest screen this app targets; the card's own padding is what the
 * figure actually gets, so this is the generous read and still has to pass. */
const NARROW = 320
const narrowScale = Math.min(scale, NARROW / BODY_VIEWBOX.w)

const sizeOf = (shape) =>
  'w' in shape ? { w: shape.w, h: shape.h } : { w: shape.rx * 2, h: shape.ry * 2 }

const fails = []
for (const r of BODY_REGIONS) {
  const { w, h } = sizeOf(r.shape)
  const px = { w: w * narrowScale, h: h * narrowScale }
  if (px.w < FLOOR || px.h < FLOOR) fails.push({ r, px })
}

console.log(`\n  body map — every region tappable at ${FLOOR}px`)
console.log(`  ${DIM}${BODY_REGIONS.length} regions · viewBox ${BODY_VIEWBOX.w}x${BODY_VIEWBOX.h} · rendered ${renderedWidth}px · scale ${narrowScale.toFixed(2)}x${OFF}\n`)

if (fails.length) {
  for (const { r, px } of fails)
    console.log(`  ${RED}✗${OFF} ${r.label.padEnd(12)} ${r.view.padEnd(5)} ${px.w.toFixed(1)} x ${px.h.toFixed(1)} px`)
  console.log(`\n  ${RED}✗ ${fails.length} region(s) below ${FLOOR}px.${OFF}`)
  console.log('    These are viewBox units, not pixels — widen the shape in')
  console.log('    lib/body-map.ts, or widen the figure in BodyMap.tsx. An')
  console.log('    athlete who misses marks the wrong body part.\n')
  process.exit(1)
}

const tightest = BODY_REGIONS
  .map((r) => ({ r, px: sizeOf(r.shape) }))
  .map(({ r, px }) => ({ r, min: Math.min(px.w, px.h) * narrowScale }))
  .sort((a, b) => a.min - b.min)[0]

console.log(`  ${GREEN}✓ all ${BODY_REGIONS.length} regions clear ${FLOOR}px.${OFF}`)
console.log(`  ${DIM}tightest: ${tightest.r.label} at ${tightest.min.toFixed(1)}px${OFF}\n`)
