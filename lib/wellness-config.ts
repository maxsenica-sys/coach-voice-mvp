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
  colorMap: string[] // 5 bg colors indexed 0-4 (score 1-5)
}

export const WELLNESS_METRICS: WellnessMetric[] = [
  {
    key: 'energy', label: 'Energy', icon: '⚡', color: '#10b981',
    hint: 'How energetic do you feel today?',
    colorMap: ['#fef2f2','#fef3c7','#fef9c3','#f0fdf4','#dcfce7'],
  },
  {
    key: 'mood', label: 'Mood', icon: '😊', color: '#3b82f6',
    hint: 'How is your overall mood?',
    colorMap: ['#fef2f2','#fef3c7','#fef9c3','#eff6ff','#dbeafe'],
  },
  {
    key: 'sleep_q', label: 'Sleep', icon: '😴', color: '#8b5cf6',
    hint: 'How well did you sleep last night?',
    colorMap: ['#fef2f2','#fef3c7','#fef9c3','#faf5ff','#ede9fe'],
  },
  {
    key: 'soreness', label: 'Soreness', icon: '💪', color: '#f59e0b',
    hint: '1 = very sore, 5 = no soreness', inverted: true,
    colorMap: ['#dcfce7','#f0fdf4','#fef9c3','#fef3c7','#fef2f2'],
  },
  {
    key: 'stress', label: 'Stress', icon: '🧠', color: '#ef4444',
    hint: '1 = very stressed, 5 = relaxed', inverted: true,
    colorMap: ['#dcfce7','#f0fdf4','#fef9c3','#fef3c7','#fef2f2'],
  },
]

export function metricColor(key: MetricKey, score: number | null): string {
  const cfg = WELLNESS_METRICS.find(m => m.key === key)!
  if (score === null) return '#94a3b8'
  const val = cfg.inverted ? 6 - score : score
  if (val >= 4) return '#10b981'
  if (val >= 3) return '#f59e0b'
  return '#ef4444'
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

/** Same green/amber/red thresholds used everywhere an overall score is shown. */
export function overallScoreColor(score: number | null): string {
  if (score === null) return '#94a3b8'
  if (score >= 3.5) return '#10b981'
  if (score >= 2.5) return '#f59e0b'
  return '#ef4444'
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
