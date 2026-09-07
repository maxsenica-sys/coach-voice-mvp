/**
 * Registers the twelve figures to a common frame and writes
 * app/components/sportSilhouettes.tsx.
 *
 *   node tools/register-silhouettes.mjs
 *
 * Why a browser is involved at all: the figures are drawn from Q-curves and
 * arcs, so their true extent is not something you can read off the pose
 * coordinates. Chromium is the only thing here that can answer `getBBox()`
 * honestly, and the whole point of this pass is to work from measurements
 * rather than from intent.
 *
 * What registration buys, and why it is the first thing to fix: at ~150ms a
 * frame the eye does not see twelve pictures, it sees one figure changing.
 * Anything that moves between frames reads as motion, so an unregistered set
 * makes the head jump around the screen — before the montage produced 68px of
 * head jitter across a 120-wide frame, which is more than half the frame and
 * far more salient than the sport being shown. Registering costs nothing at
 * runtime (one transform attribute per figure) and is the difference between
 * a flicker book and a morph.
 *
 * Each figure gets a uniform scale so its whole composition fills the same
 * target box, then a translation blended between two anchors:
 *
 *   · the composition's own centre, so nothing crowds an edge, and
 *   · the head, so the one feature the eye is locked to stays put.
 *
 * Pure head-locking would swing the wide props (rowing's oars, the barbell)
 * off frame; pure bbox-centring is what produced the jitter. The weights below
 * are the compromise, and the script prints the residual jitter it achieved so
 * the trade is a number rather than an opinion.
 */

import fs from 'node:fs'
import { chromium } from 'playwright'
import { figureParts, headMark, flipped, SPORTS_DEF } from './build-silhouettes.mjs'

const VW = 120, VH = 170

// Margins the composition — figure *and* prop — must stay inside.
const MX = 3, MY = 4

// Where the body should sit, and how far the head is allowed to pull it.
// Registering on the body rather than on the head is deliberate: a crouched
// cyclist's head belongs low and forward, and locking heads would drag the
// bike off frame to put it where a sprinter's head is. What the eye needs is a
// consistent optical centre, not a nailed-down skull.
const CX = 60, CY = 84
const HX = 58, HY = 44
const W_HEAD = 0.28

// No per-figure scaling. Every pose is drawn against the same fixed head size,
// so the twelve already share one scale; rescaling to fill a box would undo
// that and make a crouched figure bigger than a standing one. A composition
// too wide for the frame is a pose to fix in the JSON, and the run says so.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const N = (v) => Number(v.toFixed(3))

const ART_DIR = new URL('./silhouette-art/', import.meta.url)

/** A hand-drawn replacement for a generated figure, if one has been dropped in.
 *
 *  The contract is the one tools/SILHOUETTE-BRIEF.md hands to the illustrator:
 *  a 120x170 viewBox, the athlete as the first <path>, the prop as everything
 *  after it. Nothing else needs tagging. Art files have no measurable head, so
 *  they register on body centre alone — which is what the head weight is a
 *  small correction to anyway.
 */
const art = (name) => {
  const f = new URL(`${name}.svg`, ART_DIR)
  if (!fs.existsSync(f)) return null
  const inner = fs.readFileSync(f, 'utf8').replace(/^[\s\S]*?<svg[^>]*>|<\/svg>[\s\S]*$/g, '').trim()
  const first = inner.indexOf('>', inner.indexOf('<path')) + 1
  if (first <= 0) throw new Error(`${name}.svg: expected the athlete as the first <path>`)
  return { body: `<g class="body">${inner.slice(0, first)}</g><g class="prop">${inner.slice(first)}</g>` }
}

const build = (pose) => {
  const hand = art(pose.name)
  if (hand) return { body: hand.body, marker: '', drawn: true }
  const f = figureParts(pose)
  const wrap = pose.flip ? flipped : (x) => x
  return {
    body: wrap(`<g class="body">${f.body}</g><g class="prop">${f.prop}</g>`),
    marker: wrap(`<g class="head" fill="none">${headMark(pose)}</g>`),
  }
}

const page = await (await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })).newPage()

const measure = async (parts) =>
  page.evaluate(({ parts, VW, VH }) => {
    // The transform goes on an inner group: getBBox() reports an element's own
    // user space and ignores a transform set on that same element, so measuring
    // the transformed figure means measuring its parent.
    document.body.innerHTML = parts
      .map((p, i) => `<svg viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}">`
        + `<g id="fig${i}"><g transform="${p.transform ?? ''}">${p.body}${p.marker}</g></g></svg>`)
      .join('')
    return parts.map((_, i) => {
      const g = document.getElementById(`fig${i}`)
      const h = g.querySelector('.head') ?? g.querySelector('.body')
      const box = (el) => {
        // getBBox() answers in the element's own space; walk its transform up
        // to the SVG viewport so every number below is in frame units.
        const b = el.getBBox(), m = el.getCTM()
        const pt = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
        const cs = [pt(b.x, b.y), pt(b.x + b.width, b.y), pt(b.x, b.y + b.height), pt(b.x + b.width, b.y + b.height)]
        const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1])
        const x = Math.min(...xs), y = Math.min(...ys)
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
      }
      const b = g.getBBox(), bb = box(g.querySelector('.body')), hb = box(h)
      return {
        x: b.x, y: b.y, w: b.width, h: b.height,
        bx: bb.x + bb.w / 2, by: bb.y + bb.h / 2, bw: bb.w, bh: bb.h,
        hx: hb.x + hb.w / 2, hy: hb.y + hb.h / 2,
      }
    })
  }, { parts, VW, VH })

const parts = SPORTS_DEF.map(build)
const raw = await measure(parts)

const over = []
const placed = raw.map((m, i) => {
  const wh = parts[i].drawn ? 0 : W_HEAD
  let tx = wh * (HX - m.hx) + (1 - wh) * (CX - m.bx)
  let ty = wh * (HY - m.hy) + (1 - wh) * (CY - m.by)

  // The frame outranks the anchors: a limb or a prop leaving the viewBox is
  // clipped at runtime, and a clipped prop is exactly what makes a sport
  // unreadable. Where a composition is too big to fit at all, say so instead
  // of silently splitting the difference.
  const fit = (t, lo, hi) => (lo > hi ? (lo + hi) / 2 : clamp(t, lo, hi))
  if (m.w > VW - MX * 2 || m.h > VH - MY * 2) over.push(`${SPORTS_DEF[i].name} ${m.w.toFixed(0)}x${m.h.toFixed(0)}`)
  tx = fit(tx, MX - m.x, VW - MX - (m.x + m.w))
  ty = fit(ty, MY - m.y, VH - MY - (m.y + m.h))

  return { ...SPORTS_DEF[i], transform: `translate(${N(tx)} ${N(ty)})` }
})

const after = await measure(parts.map((p, i) => ({ ...p, transform: placed[i].transform })))
await page.context().browser().close()

const spread = (vals) => Math.max(...vals) - Math.min(...vals)
const report = (label, pick) =>
  `${label.padEnd(10)} before ${spread(raw.map(pick)).toFixed(1).padStart(6)}   after ${spread(after.map(pick)).toFixed(1).padStart(6)}`

console.log(report('head x', (m) => m.hx))
console.log(report('head y', (m) => m.hy))
console.log(report('body cx', (m) => m.bx))
console.log(report('body cy', (m) => m.by))
console.log(report('body h', (m) => m.bh))
console.log()
for (let i = 0; i < placed.length; i++) {
  const a = after[i]
  const clipped = a.x < -0.5 || a.y < -0.5 || a.x + a.w > VW + 0.5 || a.y + a.h > VH + 0.5
  console.log(`  ${placed[i].name.padEnd(14)} all ${a.w.toFixed(0).padStart(3)}x${a.h.toFixed(0).padStart(3)}`
    + `  body ${a.bw.toFixed(0).padStart(3)}x${a.bh.toFixed(0).padStart(3)} @ ${a.bx.toFixed(0).padStart(3)},${a.by.toFixed(0).padStart(3)}`
    + `  head ${a.hx.toFixed(0).padStart(3)},${a.hy.toFixed(0).padStart(3)}`
    + (clipped ? '  ← CLIPPED' : ''))
}
if (over.length) console.log(`\n  too big for the frame: ${over.join(', ')}`)

const jsx = (svg) => svg
  .replace(/strokeWidth=/g, 'strokeWidth=')
  .replace(/<(path|circle|ellipse|g)([^>]*?)\/>/g, '<$1$2 />')

const header = fs.readFileSync(new URL('./silhouettes-header.txt', import.meta.url), 'utf8')
const body = placed.map((p, i) => {
  const inner = parts[i].body.replace(/ class="(body|prop)"/g, '')
  return `  { name: '${p.name}', d: (<g transform="${p.transform}">${jsx(inner)}</g>) },`
}).join('\n')

fs.writeFileSync(
  new URL('../app/components/sportSilhouettes.tsx', import.meta.url),
  `${header}\nimport type { ReactNode } from 'react'\n\nexport const SPORTS: { name: string; d: ReactNode }[] = [\n${body}\n]\n`,
)
console.log('\nwrote app/components/sportSilhouettes.tsx')
