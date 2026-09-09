// lib/body-map.ts
//
// The body, as a fixed vocabulary of tappable regions.
//
// ── Why a vocabulary and not a text box ──────────────────────────────────
//
// "Where does it hurt" is the one question a coach can act on. "What is wrong
// with you" is a medical conversation, and this app must not host one about a
// child. A closed list of regions keeps the answer to a location, which is
// what a coach needs to modify a session, and stops the product accumulating
// free-text symptom descriptions written by minors.
//
// The same ids are used by `injuries.body_area` and by
// `wellness_checkins.soreness_areas`, so "where were you sore all month" and
// "where is she injured" are the same words and can be compared without a
// translation table.
//
// ── Why geometry data and not hand-drawn paths ───────────────────────────
//
// Every region is a rounded rectangle or an ellipse in a 200x440 space. That
// is deliberate. Thirty hand-authored SVG paths would be unreadable, unmerge-
// able, and impossible to adjust without redrawing; as data, a region can be
// nudged by changing a number. It reads as a body because of the arrangement,
// which is how clinical pain maps have always looked.
//
// ── Sides, which are the easy thing to get wrong ─────────────────────────
//
// Regions are authored once on the viewer's left and mirrored. The mirroring
// is not cosmetic: **in a FRONT view the shape on the viewer's left is the
// athlete's RIGHT side, and in a BACK view it is their left.** Getting that
// backwards would tell a coach the wrong hamstring, so the side label is
// derived from the view rather than typed per region.

export type BodyView = 'front' | 'back'
export type BodySide = 'left' | 'right' | 'centre'

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }

export interface BodyRegion {
  /** Stable id, stored in the database. Never renumber these. */
  id: string
  /** What the athlete reads. Side is appended at render time. */
  label: string
  view: BodyView
  side: BodySide
  shape: Shape
}

export const BODY_VIEWBOX = { w: 200, h: 440 }

/** Mirror a shape across the vertical centre line. */
function mirror(shape: Shape): Shape {
  return shape.kind === 'rect'
    ? { ...shape, x: BODY_VIEWBOX.w - (shape.x + shape.w) }
    : { ...shape, cx: BODY_VIEWBOX.w - shape.cx }
}

const rect = (x: number, y: number, w: number, h: number, r = 7): Shape =>
  ({ kind: 'rect', x, y, w, h, r })
const ellipse = (cx: number, cy: number, rx: number, ry: number): Shape =>
  ({ kind: 'ellipse', cx, cy, rx, ry })

/**
 * Regions that sit on the centre line and are not mirrored.
 * `centre` is a real value, not a fallback: nobody has a left lower back.
 */
const CENTRE: Omit<BodyRegion, 'side'>[] = [
  { id: 'head', label: 'Head', view: 'front', shape: ellipse(100, 30, 21, 24) },
  { id: 'neck', label: 'Neck', view: 'front', shape: rect(89, 54, 22, 16, 5) },
  { id: 'chest', label: 'Chest', view: 'front', shape: rect(80, 78, 40, 30, 9) },
  { id: 'abs', label: 'Stomach', view: 'front', shape: rect(83, 112, 34, 52, 9) },
  { id: 'groin', label: 'Groin', view: 'front', shape: rect(87, 168, 26, 22, 8) },

  { id: 'head_back', label: 'Head', view: 'back', shape: ellipse(100, 30, 21, 24) },
  { id: 'neck_back', label: 'Neck', view: 'back', shape: rect(89, 54, 22, 16, 5) },
  { id: 'traps', label: 'Traps', view: 'back', shape: rect(76, 72, 48, 24, 9) },
  { id: 'upper_back', label: 'Upper back', view: 'back', shape: rect(80, 98, 40, 40, 9) },
  { id: 'lower_back', label: 'Lower back', view: 'back', shape: rect(83, 140, 34, 34, 9) },
]

/**
 * Regions authored on the viewer's LEFT, mirrored to make the pair.
 * See the note on sides above before changing any x value.
 */
const PAIRED: Omit<BodyRegion, 'side'>[] = [
  // ── front ──
  { id: 'shoulder', label: 'Shoulder', view: 'front', shape: ellipse(69, 86, 14, 13) },
  { id: 'biceps', label: 'Upper arm', view: 'front', shape: rect(52, 100, 22, 46, 10) },
  { id: 'forearm', label: 'Forearm', view: 'front', shape: rect(46, 150, 20, 46, 9) },
  { id: 'hand', label: 'Hand', view: 'front', shape: ellipse(55, 206, 11, 13) },
  { id: 'hip', label: 'Hip', view: 'front', shape: ellipse(80, 176, 13, 14) },
  { id: 'quad', label: 'Thigh', view: 'front', shape: rect(72, 192, 25, 70, 11) },
  { id: 'knee', label: 'Knee', view: 'front', shape: ellipse(84, 274, 13, 13) },
  { id: 'shin', label: 'Shin', view: 'front', shape: rect(74, 288, 21, 62, 9) },
  { id: 'ankle', label: 'Ankle', view: 'front', shape: ellipse(84, 360, 11, 11) },
  { id: 'foot', label: 'Foot', view: 'front', shape: rect(72, 372, 24, 22, 8) },

  // ── back ──
  { id: 'shoulder_back', label: 'Shoulder', view: 'back', shape: ellipse(69, 86, 14, 13) },
  { id: 'triceps', label: 'Upper arm', view: 'back', shape: rect(52, 100, 22, 46, 10) },
  { id: 'forearm_back', label: 'Forearm', view: 'back', shape: rect(46, 150, 20, 46, 9) },
  { id: 'hand_back', label: 'Hand', view: 'back', shape: ellipse(55, 206, 11, 13) },
  { id: 'glute', label: 'Glute', view: 'back', shape: rect(74, 176, 24, 34, 10) },
  { id: 'hamstring', label: 'Hamstring', view: 'back', shape: rect(72, 214, 25, 58, 11) },
  { id: 'calf', label: 'Calf', view: 'back', shape: rect(74, 286, 21, 58, 10) },
  { id: 'achilles', label: 'Achilles', view: 'back', shape: rect(78, 346, 13, 26, 6) },
  { id: 'heel', label: 'Heel', view: 'back', shape: ellipse(84, 380, 12, 12) },
]

/** The athlete's own side for a shape drawn on the viewer's left. */
function sideForViewerLeft(view: BodyView): BodySide {
  return view === 'front' ? 'right' : 'left'
}

export const BODY_REGIONS: BodyRegion[] = [
  ...CENTRE.map((r) => ({ ...r, side: 'centre' as BodySide })),
  ...PAIRED.flatMap((r) => [
    { ...r, id: `${r.id}_l`, side: sideForViewerLeft(r.view) },
    { ...r, id: `${r.id}_r`, shape: mirror(r.shape), side: (sideForViewerLeft(r.view) === 'right' ? 'left' : 'right') as BodySide },
  ]),
]

const BY_ID = new Map(BODY_REGIONS.map((r) => [r.id, r]))

/** "Left hamstring", "Lower back" — what a human reads. */
export function regionLabel(id: string): string {
  const r = BY_ID.get(id)
  if (!r) return id
  if (r.side === 'centre') return r.label
  return `${r.side === 'left' ? 'Left' : 'Right'} ${r.label.toLowerCase()}`
}

export function regionsFor(view: BodyView): BodyRegion[] {
  return BODY_REGIONS.filter((r) => r.view === view)
}

export function isBodyRegion(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id)
}

/**
 * The pain rating at which the body map is worth asking for.
 *
 * 0-10 Numeric Rating Scale, more is worse. Four is the conventional boundary
 * between mild and moderate pain, and it is where asking "where?" stops being
 * noise and starts being something a coach should act on. Below it the athlete
 * answers one question and is done.
 *
 * Note this runs the OPPOSITE way to `wellness_checkins.soreness`, which is
 * 5 = no soreness like every other daily metric. The two are never combined.
 * See migration 026.
 */
export const BODY_MAP_THRESHOLD = 4
