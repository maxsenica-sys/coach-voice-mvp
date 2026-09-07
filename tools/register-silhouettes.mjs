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

/** Montage order. Drawn artwork wins over a generated pose of the same name;
 *  anything here with no `art` and no pose is an error rather than a gap.
 *
 *  The order alternates facing direction so consecutive frames read as one
 *  figure turning rather than as a stamp repeated, opens on the tallest and
 *  most unambiguous figure, and closes on the only front-facing one — arms
 *  overhead, which is where the mark rises from. Skateboarding and cricket
 *  are the single same-facing pair, parked at frame 12-13 where each shows
 *  for about a tenth of a second and the repeat costs nothing. */
const ORDER = JSON.parse(fs.readFileSync(new URL('./silhouette-order.json', import.meta.url), 'utf8'))

const VW = 120, VH = 170

// Margin the athlete and any prop drawn inside the frame must stay within.
// Near zero on purpose: the artwork is drawn to the frame edge, and demanding
// a few units of breathing room is this script's taste, not the drawing's.
const MX = 1, MY = 1

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
const art = (slug) => {
  if (!slug) return null
  const f = new URL(`${slug}.svg`, ART_DIR)
  if (!fs.existsSync(f)) throw new Error(`silhouette-art/${slug}.svg is listed in the order but missing`)
  const inner = fs.readFileSync(f, 'utf8')
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')   // C2PA provenance: keep it on disk, not in the bundle
    .replace(/^[\s\S]*?<svg[^>]*>|<\/svg>[\s\S]*$/g, '')
    .replace(/\s+/g, ' ').trim()
  // Split after the first *complete* path element. The athlete may be written
  // either self-closing or as a matched pair, and slicing at the first ">"
  // cut a paired one in half — leaving the athlete's open tag in the body
  // group and its closing tag at the head of the prop group. Browsers repair
  // that silently, so it measured and rendered correctly and only surfaced as
  // a build error once the markup reached a JSX parser.
  const m = inner.match(/<path\b[^>]*?(?:\/>|>\s*<\/path>)/)
  if (!m) throw new Error(`${slug}.svg: expected the athlete as the first <path>`)
  const first = m.index + m[0].length

  return { body: `<g class="body">${inner.slice(0, first)}</g><g class="prop">${inner.slice(first)}</g>` }
}

const build = (pose) => {
  const hand = art(pose.art)
  if (hand) return { body: hand.body, marker: '', drawn: true }
  if (!pose.h) throw new Error(`${pose.name}: no artwork and no pose to generate from`)
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
      // What must stay in shot: the athlete, plus every prop element that the
      // artist drew inside the frame. An element already crossing the viewBox
      // edge in the source — a ground band, a pair of oars, the barbell — was
      // drawn to bleed, and constraining it would drag the athlete sideways to
      // keep a shadow in shot.
      const b = g.getBBox(), bb = box(g.querySelector('.body')), hb = box(h)
      let k = { x: bb.x, y: bb.y, r: bb.x + bb.w, b2: bb.y + bb.h }
      for (const el of g.querySelectorAll('.prop > *')) {
        const e = box(el)
        if (e.x < -1 || e.y < -1 || e.x + e.w > VW + 1 || e.y + e.h > VH + 1) continue
        k = { x: Math.min(k.x, e.x), y: Math.min(k.y, e.y), r: Math.max(k.r, e.x + e.w), b2: Math.max(k.b2, e.y + e.h) }
      }
      return {
        x: b.x, y: b.y, w: b.width, h: b.height,
        kx: k.x, ky: k.y, kw: k.r - k.x, kh: k.b2 - k.y,
        bx: bb.x + bb.w / 2, by: bb.y + bb.h / 2, bw: bb.w, bh: bb.h,
        hx: hb.x + hb.w / 2, hy: hb.y + hb.h / 2,
      }
    })
  }, { parts, VW, VH })

const byName = new Map(SPORTS_DEF.map((p) => [p.name, p]))
const ENTRIES = ORDER.map((o) => ({ ...(byName.get(o.name) ?? {}), ...o }))

const parts = ENTRIES.map(build)
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
  // Clamp the *athlete* inside the frame, not the whole composition. The
  // ground bands, the oars and the barbell are drawn wider than the viewBox on
  // purpose — bleeding was invited — and clamping against them was dragging
  // the figure itself as much as 18 units off centre to keep a shadow in shot.
  const fit = (t, lo, hi) => (lo > hi ? (lo + hi) / 2 : clamp(t, lo, hi))
  if (m.kw > VW - MX * 2 || m.kh > VH - MY * 2) over.push(`${ENTRIES[i].name} ${m.kw.toFixed(0)}x${m.kh.toFixed(0)}`)
  tx = fit(tx, MX - m.kx, VW - MX - (m.kx + m.kw))
  ty = fit(ty, MY - m.ky, VH - MY - (m.ky + m.kh))

  return { ...ENTRIES[i], transform: `translate(${N(tx)} ${N(ty)})` }
})

const after = await measure(parts.map((p, i) => ({ ...p, transform: placed[i].transform })))
await page.context().browser().close()

const spread = (vals) => Math.max(...vals) - Math.min(...vals)
const report = (label, pick) =>
  `${label.padEnd(10)} before ${spread(raw.map(pick)).toFixed(1).padStart(6)}   after ${spread(after.map(pick)).toFixed(1).padStart(6)}`

const drawn = parts.every((p) => p.drawn)
if (!drawn) { console.log(report('head x', (m) => m.hx)); console.log(report('head y', (m) => m.hy)) }
console.log(report('body cx', (m) => m.bx))
console.log(report('body cy', (m) => m.by))
console.log(report('body h', (m) => m.bh))
console.log()
for (let i = 0; i < placed.length; i++) {
  const a = after[i]
  const cut = a.kx < -0.5 || a.ky < -0.5 || a.kx + a.kw > VW + 0.5 || a.ky + a.kh > VH + 0.5
  console.log(`  ${placed[i].name.padEnd(14)} ${(parts[i].drawn ? 'art' : 'gen').padEnd(4)}`
    + ` figure ${a.bw.toFixed(0).padStart(3)}x${a.bh.toFixed(0).padStart(3)} @ ${a.bx.toFixed(0).padStart(3)},${a.by.toFixed(0).padStart(3)}`
    + `  must fit ${a.kw.toFixed(0).padStart(3)}x${a.kh.toFixed(0).padStart(3)}`
    + `  all ${a.w.toFixed(0).padStart(3)}x${a.h.toFixed(0).padStart(3)}`
    + (cut ? '  ← CLIPPED' : ''))
}
if (over.length) console.log(`\n  does not fit the frame even centred: ${over.join(', ')}`)

/** Path data as delivered is `M 48.06 94.24Q 45.26 96.11 ...` — two decimals
 *  and a space after every command. On a 120x170 viewBox drawn at 260px one
 *  unit is 2.2px, so the second decimal is a fifth of a pixel and cannot be
 *  seen. Dropping it and the redundant whitespace roughly halves the file,
 *  which matters here more than it usually would: this component is in the
 *  first chunk of the splash, and the splash exists to not be a blank screen. */
const squeeze = (svg) => svg.replace(/\sd="([^"]+)"/g, (_, d) => ` d="${
  d.replace(/-?\d+\.?\d*/g, (v) => String(Math.round(Number(v) * 10) / 10))
   .replace(/\s+/g, ' ')
   .replace(/\s?([A-Za-z])\s?/g, '$1')
   .replace(/(?<=\d)\s(?=-)/g, '')
   .trim()
}"`)

/** SVG markup into JSX. The artwork is written as HTML — `<path ...>` left
 *  open, attributes hyphenated — and both are syntax errors in a .tsx file, so
 *  this is what stands between a valid drawing and a build failure. Anything
 *  hyphenated that is not in the map below is a deliberate error rather than a
 *  silent camelCase guess: `data-` and `aria-` attributes stay hyphenated in
 *  JSX, and quietly mangling one would be worse than stopping. */
const ATTR = {
  'fill-rule': 'fillRule', 'clip-rule': 'clipRule',
  'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin', 'stroke-dasharray': 'strokeDasharray',
  'stroke-miterlimit': 'strokeMiterlimit', 'stroke-opacity': 'strokeOpacity',
  'fill-opacity': 'fillOpacity', 'vector-effect': 'vectorEffect',
}
const VOID = 'path|circle|ellipse|rect|line|polyline|polygon|use|stop'

const jsx = (svg) => {
  const out = squeeze(svg)
    // The artwork writes shapes as a matched pair, `<path ...></path>`. JSX
    // wants one self-closing tag, and self-closing the opener without dropping
    // the closer leaves `<path /></path>`, which parses in a browser and fails
    // the build.
    .replace(new RegExp(`<(${VOID})\\b([^>]*?)\\s*/?>\\s*</\\1>`, 'g'), '<$1$2 />')
    .replace(new RegExp(`<(${VOID})\\b([^>]*?)\\s*/?>`, 'g'), '<$1$2 />')
    .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (m, name) => {
      if (name.startsWith('data-') || name.startsWith('aria-')) return m
      const jsxName = ATTR[name]
      if (!jsxName) throw new Error(`unmapped SVG attribute "${name}" — add it to ATTR in register-silhouettes.mjs`)
      return ` ${jsxName}=`
    })

  // Cheap structural check, because a malformed figure fails the build with a
  // column number into a 100KB line and nothing else to go on.
  const open = (out.match(/<g\b/g) ?? []).length, close = (out.match(/<\/g>/g) ?? []).length
  if (open !== close) throw new Error(`unbalanced <g>: ${open} open, ${close} closed`)
  const leftover = out.match(new RegExp(`</(${VOID})>`, 'g'))
  if (leftover) throw new Error(`stray closing tag(s): ${[...new Set(leftover)].join(' ')}`)
  return out
}

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
