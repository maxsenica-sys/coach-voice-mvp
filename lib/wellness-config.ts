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
