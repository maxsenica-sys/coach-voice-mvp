// lib/wellness-config.ts
// Single source of truth for wellness metric definitions.
// Used by WellnessGraph (display/chart) and WellnessSubmit (input form).

export type MetricKey = 'energy' | 'mood' | 'sleep_q' | 'soreness' | 'stress'

export interface WellnessMetric {
  key: MetricKey
  label: string
  icon: string
  color: string
  hint: string
  inverted?: boolean // true = higher raw score means worse (soreness, stress)
}

export const WELLNESS_METRICS: WellnessMetric[] = [
  {
    key: 'energy', label: 'Energy', icon: '⚡', color: '#10b981',
    hint: 'How energetic do you feel today?',
  },
  {
    key: 'mood', label: 'Mood', icon: '😊', color: '#3b82f6',
    hint: 'How is your overall mood?',
  },
  {
    key: 'sleep_q', label: 'Sleep', icon: '😴', color: '#8b5cf6',
    hint: 'How well did you sleep last night?',
  },
  // NOT inverted, despite the names. `inverted` means "a higher raw score is
  // worse" — and for both of these a higher raw score is BETTER, because that
  // is what the athlete is asked. Read the hints: 5 is "no soreness" and
  // "relaxed". The scale was written that way on purpose so that 5 is always
  // the good end of every question, which is the right call for a form a
  // 13-year-old fills in daily.
  //
  // They carried `inverted: true` from e32ac64 until 2026-09-09, while the
  // hints have said 5-is-good since the initial commit. Every scoring function
  // therefore computed `6 - raw` on answers that were already the right way
  // round, and flipped them. The effect was not cosmetic: because
  // overallWellnessScore averages these with the other three,
  // computeWellnessAlert ran backwards. An athlete answering 4/4/4 with no
  // soreness and no stress scored 2.8 and tripped the alert; one answering
  // 2/2/2 while very sore and very stressed scored 3.2 and did not. The
  // coach's roster dot, the graph, the alert email and the caretaker escalation
  // were all reading these two metrics upside down.
  //
  // Fixed by deleting the flag rather than by changing the hints, because the
  // hints are what athletes have always answered against — the stored data is
  // already 5-is-good, so no migration is needed. Do not "restore" this flag.
  {
    key: 'soreness', label: 'Soreness', icon: '💪', color: '#f59e0b',
    hint: '1 = very sore, 5 = no soreness',
  },
  {
    key: 'stress', label: 'Stress', icon: '🧠', color: '#ef4444',
    hint: '1 = very stressed, 5 = relaxed',
  },
]

/**
 * The good / ok / low bucket for a single metric, as a CSS colour.
 *
 * Every wellness colour in the app comes from here or from `overallScoreColor`
 * below — the per-metric `colorMap` that used to sit alongside these entries
 * bucketed the same three ways, 40 lines apart, and only ever rendered as a
 * selected-button fill. One rule now, and the selected check-in button means
 * the same thing as the dot on the coach's roster.
 */
export function metricColor(key: MetricKey, score: number | null): string {
  const cfg = WELLNESS_METRICS.find(m => m.key === key)!
  if (score === null) return 'var(--wellness-none)'
  const val = cfg.inverted ? 6 - score : score
  if (val >= 4) return 'var(--wellness-good)'
  if (val >= 3) return 'var(--wellness-ok)'
  return 'var(--wellness-low)'
}

/**
 * The light pair for `metricColor`, for backgrounds behind that text.
 * Replaces concatenating a hex alpha suffix onto the colour (`color + '18'`),
 * which only worked because the values happened to be 6-digit hex and left the
 * text sitting on a tint of itself at ~2:1.
 */
export function metricTint(key: MetricKey, score: number | null): string {
  const cfg = WELLNESS_METRICS.find(m => m.key === key)!
  if (score === null) return 'var(--wellness-none-tint)'
  const val = cfg.inverted ? 6 - score : score
  if (val >= 4) return 'var(--wellness-good-tint)'
  if (val >= 3) return 'var(--wellness-ok-tint)'
  return 'var(--wellness-low-tint)'
}

export function scoreLabel(key: MetricKey, score: number | null): string {
  if (score === null) return '—'
  const cfg = WELLNESS_METRICS.find(m => m.key === key)!
  const val = cfg.inverted ? 6 - score : score
  if (val >= 4) return 'Good'
  if (val >= 3) return 'OK'
  return 'Low'
}

// Shape returned by GET /api/wellness — shared so every consumer (the graph,
// the athlete-profile at-a-glance summary) reads the same fields.
export interface WellnessCheckin {
  id: string
  athlete_id: string
  check_date: string
  energy: number | null
  mood: number | null
  sleep_q: number | null
  soreness: number | null
  stress: number | null
  notes: string | null
  /**
   * The soreness follow-up, added 2026-09-09. Both nullable and both absent
   * for every row written before then.
   *
   * `soreness_score` is a 0-10 Numeric Rating Scale where **more is worse** —
   * the opposite direction to `soreness` above, which runs 5 = no soreness
   * like every other daily metric. They answer different questions and must
   * never be averaged together. None of the scoring functions in this file
   * touch `soreness_score`, and that is deliberate.
   */
  soreness_score?: number | null
  /** Region ids from lib/body-map.ts. Only ever set above the map threshold. */
  soreness_areas?: string[] | null
}

/** Average of each metric's normalised (inverted metrics flipped) 1-5 value. */
export function overallWellnessScore(checkin: WellnessCheckin | null): number | null {
  if (!checkin) return null
  const vals = WELLNESS_METRICS.map(({ key, inverted }) => {
    const raw = checkin[key]
    if (raw === null) return null
    return inverted ? 6 - raw : raw
  }).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
}

/** Same good/ok/low thresholds used everywhere an overall score is shown. */
export function overallScoreColor(score: number | null): string {
  if (score === null) return 'var(--wellness-none)'
  if (score >= 3.5) return 'var(--wellness-good)'
  if (score >= 2.5) return 'var(--wellness-ok)'
  return 'var(--wellness-low)'
}

/** The light pair for `overallScoreColor`. */
export function overallScoreTint(score: number | null): string {
  if (score === null) return 'var(--wellness-none-tint)'
  if (score >= 3.5) return 'var(--wellness-good-tint)'
  if (score >= 2.5) return 'var(--wellness-ok-tint)'
  return 'var(--wellness-low-tint)'
}

export type WellnessAlertReason = 'today' | 'average' | 'both'

export interface WellnessAlert {
  active: boolean
  reason: WellnessAlertReason | null
  todayScore: number | null
  /** Average overall score over the most recent check-ins (up to 7). */
  avgScore: number | null
}

const ALERT_THRESHOLD = 3
const ALERT_AVG_WINDOW = 7

/**
 * The single definition of "this athlete needs attention": today's overall
 * score is below 3, or the recent (up to 7 check-in) average is below 3.
 * Shared by the API (to gate the coach email) and the UI (to show the same
 * banner) so they can never disagree about what counts as an alert.
 * `checkins` must be ordered oldest-first (same order GET /api/wellness returns).
 */
export function computeWellnessAlert(checkins: WellnessCheckin[]): WellnessAlert {
  if (checkins.length === 0) return { active: false, reason: null, todayScore: null, avgScore: null }

  const todayScore = overallWellnessScore(checkins[checkins.length - 1])

  const recentScores = checkins
    .slice(-ALERT_AVG_WINDOW)
    .map(overallWellnessScore)
    .filter((v): v is number => v !== null)
  const avgScore = recentScores.length
    ? +(recentScores.reduce((a, b) => a + b, 0) / recentScores.length).toFixed(1)
    : null

  const todayLow = todayScore !== null && todayScore < ALERT_THRESHOLD
  const avgLow = avgScore !== null && avgScore < ALERT_THRESHOLD
  const reason: WellnessAlertReason | null = todayLow && avgLow ? 'both' : todayLow ? 'today' : avgLow ? 'average' : null

  return { active: reason !== null, reason, todayScore, avgScore }
}
