// lib/readiness.ts
//
// The two-tap check-in, and how it feeds the scoring the rest of the app
// already does.
//
// ── The constraint that shapes all of this ────────────────────────────────
//
// computeWellnessAlert, the caretaker escalation email and the coach's roster
// dot all read wellness_checkins through overallWellnessScore, which averages
// the five 1-5 columns. That path decides whether a parent is told their child
// is struggling, so it is the last thing that should be rewritten alongside a
// UI change.
//
// So the new check-in does not replace those columns — it derives them. Old
// rows and new rows score identically through one code path, with no branch on
// which form produced them and no backfill.
//
// This lives in lib/ and not in the component because CLAUDE.md's rule applies
// exactly: a computation whose correctness is not obvious by reading it must be
// somewhere the offline rigs can reach.

import type { WellnessCheckin } from '@/lib/wellness-config'

export type Readiness = 1 | 2 | 3

export const READINESS_OPTIONS: { value: Readiness; label: string; hint: string }[] = [
  { value: 1, label: 'Flat',  hint: 'Heavy legs, tired, not feeling it' },
  { value: 2, label: 'OK',    hint: 'Normal — ready to train' },
  { value: 3, label: 'Good',  hint: 'Fresh, sharp, ready to go' },
]

/* Why 2 / 3 / 4 and not 1 / 3 / 5.
 *
 * The endpoints of the old scale were reached by deliberately dragging a slider
 * to its end. A three-way control is one tap, and one tap should not be able to
 * trip a caretaker alert as hard as an athlete who explicitly chose "1". Mapping
 * to the middle band keeps "Flat" meaningful without making the alert
 * hair-trigger on a control that is far easier to press.
 */
const READINESS_TO_FIVE: Record<Readiness, number> = { 1: 2, 2: 3, 3: 4 }

/* Soreness from the silhouette.
 *
 * Nothing marked is 5 — "no soreness", which is what 5 means in every existing
 * row. Marking one area is 3; more areas push it down, floored at 2 so a child
 * tapping several places does not on its own produce the lowest possible score.
 * A body map is a description of where, not a claim about severity.
 *
 * The empty array is a REAL answer here and not missing data. That distinction
 * is the whole point of "highlight only if something is wrong".
 */
export function sorenessFromAreas(areas: readonly string[]): number {
  const n = areas.length
  if (n === 0) return 5
  if (n === 1) return 3
  return Math.max(2, 4 - n)
}

/**
 * The 1-5 columns a readiness check-in writes, so every existing consumer of
 * wellness data keeps working untouched.
 *
 * `mood` and `stress` follow readiness because that is what the control is
 * actually asking — "how are you today" is a mood-and-stress question. `sleep_q`
 * is deliberately NOT derived: nothing in the new check-in asks about sleep, and
 * inventing a number for it would put fabricated data into a chart the coach
 * reads. It stays null, and overallWellnessScore already averages only the
 * metrics that are present.
 */
export function readinessToMetrics(
  readiness: Readiness,
  soreAreas: readonly string[],
): Pick<WellnessCheckin, 'energy' | 'mood' | 'stress' | 'soreness'> {
  const base = READINESS_TO_FIVE[readiness]
  return {
    energy: base,
    mood: base,
    stress: base,
    soreness: sorenessFromAreas(soreAreas),
  }
}
