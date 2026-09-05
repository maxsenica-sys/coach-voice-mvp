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
  {
    key: 'soreness', label: 'Soreness', icon: '💪', color: '#f59e0b',
    hint: '1 = very sore, 5 = no soreness', inverted: true,
  },
  {
    key: 'stress', label: 'Stress', icon: '🧠', color: '#ef4444',
    hint: '1 = very stressed, 5 = relaxed', inverted: true,
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
