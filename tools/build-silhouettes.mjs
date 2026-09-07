/**
 * Generates app/components/sportSilhouettes.tsx.
 *
 *   node tools/build-silhouettes.mjs
 *
 * Figures are built from skeletons — joint coordinates rendered as limbs — so
 * that weight, proportion and framing stay identical across the set. Editing a
 * pose means moving a coordinate here and re-running; never hand-edit the
 * generated file.
 *
 * The geometry below is the result of a measured critique of the previous set.
 * Four things it found, all of which are now constraints rather than choices:
 *
 *   · The shoulder disc was r=10 against a head of r=8 — shoulders wider than
 *     heads, in all twelve. Shoulder mass is now 6.5 and the deltoid corner
 *     carries the width instead.
 *   · The head overlapped the shoulder in every figure, so the neck was
 *     decorative and the top read as a snowman. The one exception, sprinting,
 *     was visibly the best figure in the set. NECK is now long enough to leave
 *     daylight.
 *   · Every joint was a circle whose radius exactly equalled the limb's
 *     half-width, so all 120 joints were the same perfect cap. They are
 *     ellipses now, offset toward the extensor side.
 *   · Figures were never registered to each other: head-x jittered 68px
 *     between frames. At montage speed the eye reads consecutive frames as
 *     motion, so the most salient feature was jumping at random. Every figure
 *     is now normalised to a common frame by tools/register-silhouettes.mjs,
 *     which measures real bounding boxes in a browser.
 */

import fs from 'node:fs'

const N = (v) => Number(v.toFixed(1))
const P = (x, y) => `${N(x)} ${N(y)}`

/** A limb segment with a belly: straight dowels are what read as sticks. */
const seg = (a, b, w1, w2, bulge = 1.11) => {
  const [x1, y1] = a, [x2, y2] = b
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1
  const nx = -dy / L, ny = dx / L
  const bt = 0.33                              // where the belly sits
  const bx = x1 + dx * bt, by = y1 + dy * bt
  const wb = (w1 + (w2 - w1) * bt)
  const out = wb * bulge, inn = wb * 0.96
  return `M${P(x1 + nx * w1, y1 + ny * w1)}`
       + `Q${P(bx + nx * out, by + ny * out)} ${P(x2 + nx * w2, y2 + ny * w2)}`
       + `L${P(x2 - nx * w2, y2 - ny * w2)}`
       + `Q${P(bx - nx * inn, by - ny * inn)} ${P(x1 - nx * w1, y1 - ny * w1)}Z`
}

/** An elliptical joint, long axis across the bend, nudged to the outside. */
const joint = ([x, y], r, ang = 0, ecc = 1.25) => {
  const rx = r * ecc, ry = r
  const c = Math.cos(ang), s = Math.sin(ang)
  const p1 = [x - rx * c, y - rx * s], p2 = [x + rx * c, y + rx * s]
  const deg = N((ang * 180) / Math.PI)
  return `M${P(p1[0], p1[1])}A${N(rx)} ${N(ry)} ${deg} 0 1 ${P(p2[0], p2[1])}`
       + `A${N(rx)} ${N(ry)} ${deg} 0 1 ${P(p1[0], p1[1])}Z`
}

const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0])

/** An egg, tilted toward travel — a free directional cue on every figure. */
const head = ([x, y], tilt = 0, rx = 7.2, ry = 8.6) => {
  const deg = N((tilt * 180) / Math.PI)
  return `M${P(x, y - ry)}A${rx} ${ry} ${deg} 0 1 ${P(x, y + ry)}A${rx} ${ry} ${deg} 0 1 ${P(x, y - ry)}Z`
}

/** A foot with a heel behind the ankle. `short` for a foot seen end-on. */
const foot = (ankle, dir, short = false) => {
  const [ax, ay] = ankle, L = Math.hypot(dir[0], dir[1]) || 1
  const ux = dir[0] / L, uy = dir[1] / L
  const toe = short ? 6 : 11.5, heel = short ? 2.4 : 4
  return seg([ax - ux * heel, ay - uy * heel], [ax + ux * toe, ay + uy * toe], 4.2, 2.6, 1.04)
       + joint([ax, ay], 4.0, ang([ax, ay], [ax + ux, ay + uy]))
}

const arm = (s, e, w) =>
  seg(s, e, 5.4, 4.3) + joint(e, 4.3, ang(s, e) + Math.PI / 2)
  + seg(e, w, 4.3, 3.4) + joint(w, 3.9, ang(e, w))
const leg = (h, k, a, toe, short = false) =>
  seg(h, k, 7.6, 5.6) + joint(k, 5.6, ang(h, k) + Math.PI / 2)
  + seg(k, a, 5.6, 4.0) + foot(a, toe, short)

const NECK = 11

const figureParts = (s) => {
  const t = s.tilt ?? 0
  // Neck runs from the shoulder toward the head, but stops short of it, so
  // head and shoulder mass never fuse.
  const d = Math.hypot(s.h[0] - s.sh[0], s.h[1] - s.sh[1]) || 1
  const nk = [s.sh[0] + (s.h[0] - s.sh[0]) * (NECK / d), s.sh[1] + (s.h[1] - s.sh[1]) * (NECK / d)]
  // Deltoid corners. The width lives here rather than in a ball at the joint,
  // and the quad is wide at the bottom and narrow at the top so it reads as
  // the slope of the trapezius. It used to flare the other way, which put a
  // pair of small horns above the collarbone on every figure.
  const sa = ang(s.sh, s.hip) + Math.PI / 2
  const dxs = Math.cos(sa) * 14.5, dys = Math.sin(sa) * 14.5
  const dn = ang(s.sh, s.hip)
  const dxo = Math.cos(dn) * 3.5, dyo = Math.sin(dn) * 3.5
  const shoulders = `M${P(s.sh[0] - dxs + dxo, s.sh[1] - dys + dyo)}`
    + `L${P(s.sh[0] + dxs + dxo, s.sh[1] + dys + dyo)}`
    + `L${P(s.sh[0] + dxs * 0.5, s.sh[1] + dys * 0.5)}`
    + `L${P(s.sh[0] - dxs * 0.5, s.sh[1] - dys * 0.5)}Z`

  // Arms hang off the deltoid corner, not off the middle of the chest. Rooting
  // them at the shoulder centre left a shelf of deltoid sticking out past the
  // arm on the side the arm was reaching away from.
  const root = (elbow) => {
    const k = Math.sign((elbow[0] - s.sh[0]) * Math.cos(sa) + (elbow[1] - s.sh[1]) * Math.sin(sa)) || 1
    return [s.sh[0] + dxs * 0.78 * k, s.sh[1] + dys * 0.78 * k]
  }

  const parts = [
    arm(root(s.aL[0]), s.aL[0], s.aL[1]),
    leg(s.hip, s.lL[0], s.lL[1], s.lL[2], s.lL[3]),
    seg(s.sh, s.hip, 12.6, 8.4, 1.02), shoulders, joint(s.sh, 6.5), joint(s.hip, 7.4),
    seg(nk, s.sh, 4.4, 7.2, 1.0),
    leg(s.hip, s.lR[0], s.lR[1], s.lR[2], s.lR[3]),
    arm(root(s.aR[0]), s.aR[0], s.aR[1]),
    head(s.h, t),
  ]
  // One <path> per subpath, not one path for the whole figure. A single path
  // unions its subpaths by the nonzero rule, which depends on winding
  // direction — and seg() winds with the limb, so a thigh pointing down and a
  // shin pointing back wind opposite ways and cancel where they overlap. That
  // is what punched a dark notch through every knee and elbow in the last set.
  // Separate opaque paths of the same colour union visually with no winding to
  // get wrong, at a cost of a few hundred bytes.
  const subs = parts.join('').split(/(?=M)/).filter(Boolean)
  return { body: subs.map((x) => `<path d="${x}"/>`).join(''), prop: s.prop ?? '' }
}

/** Body and prop joined — the shape that ships. */
const figure = (s) => { const f = figureParts(s); return f.body + f.prop }

/** The head alone — the registration pass measures it separately, because the
 *  head is what the eye tracks between frames. */
const headMark = (s) => `<path d="${head(s.h, s.tilt ?? 0)}"/>`

/** Flip wrapper: several poses face left, and a set that all face one way
 *  reads as a repeated stamp rather than as movement. */
const flipped = (inner) => `<g transform="translate(120,0) scale(-1,1)">${inner}</g>`

export { figure, figureParts, headMark, flipped }
export const SPORTS_DEF = JSON.parse(fs.readFileSync(new URL('./silhouette-poses.json', import.meta.url), 'utf8'))
