'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  WELLNESS_METRICS, metricColor, scoreLabel, overallWellnessScore, overallScoreColor,
  type MetricKey, type WellnessCheckin as Checkin,
} from '@/lib/wellness-config'
import { fmtShortDate as fmtDate } from '@/lib/date-utils'
import { apiJson } from '@/lib/api-client'

interface Props {
  athleteId: string
}

const METRICS = WELLNESS_METRICS

// ─── SVG Line Chart ───────────────────────────────────────────────────────────
function LineChart({ checkins, activeMetrics }: { checkins: Checkin[], activeMetrics: Set<MetricKey> }) {
  if (checkins.length < 2) return null

  const W = 520, H = 150, PL = 28, PR = 12, PT = 12, PB = 24
  const chartW = W - PL - PR
  const chartH = H - PT - PB

  const xScale = (i: number) => PL + (i / (checkins.length - 1)) * chartW
  const yScale = (v: number) => PT + (1 - (v - 1) / 4) * chartH

  // Y-axis gridlines
  const gridLines = [1, 2, 3, 4, 5]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Grid */}
      {gridLines.map((v) => (
        <g key={v}>
          <line x1={PL} y1={yScale(v)} x2={W - PR} y2={yScale(v)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={PL - 4} y={yScale(v) + 4} textAnchor="end" fontSize="9" fill="#94a3b8">{v}</text>
        </g>
      ))}

      {/* X-axis labels (show every Nth to avoid clutter) */}
      {checkins.map((c, i) => {
        const step = Math.max(1, Math.floor(checkins.length / 6))
        if (i % step !== 0 && i !== checkins.length - 1) return null
        return (
          <text key={c.id} x={xScale(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {fmtDate(c.check_date)}
          </text>
        )
      })}

      {/* Lines per metric */}
      {METRICS.map(({ key, color }) => {
        if (!activeMetrics.has(key)) return null
        const pts = checkins
          .map((c, i) => {
            const raw = c[key as keyof Checkin] as number | null
            if (raw === null) return null
            return { x: xScale(i), y: yScale(raw) }
          })
          .filter(Boolean) as { x: number; y: number }[]

        if (pts.length < 2) return null

        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

        return (
          <g key={key}>
            <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Score Bar (horizontal) ───────────────────────────────────────────────────
function ScoreBar({ metricKey, label, icon, color, score, inverted }: { metricKey: MetricKey; label: string; icon: string; color: string; score: number | null; inverted?: boolean }) {
  const fillScore = score === null ? 0 : (inverted ? 6 - score : score)
  const fillPct = (fillScore / 5) * 100
  const dotColor = metricColor(metricKey, score)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', width: 56, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 7, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${fillPct}%`,
          background: `linear-gradient(90deg, ${color}aa, ${color})`,
          borderRadius: 99,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: dotColor, width: 14, textAlign: 'right', flexShrink: 0 }}>
        {score ?? '—'}
      </span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WellnessGraph({ athleteId }: Props) {
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showChart, setShowChart] = useState(false)
  const [activeMetrics, setActiveMetrics] = useState<Set<MetricKey>>(
    new Set(['energy', 'mood', 'sleep_q', 'soreness', 'stress'])
  )

  const load = useCallback(async () => {
    if (!athleteId) return
    setLoading(true)
    setLoadError('')
    try {
      const json = await apiJson<{ checkins?: Checkin[] }>(
        `/api/wellness?athlete_id=${athleteId}&days=30`,
      )
      setCheckins(json.checkins ?? [])
    } catch (e: any) {
      // Without this the chart rendered as "no check-ins yet" on a failed
      // request, which reads as an athlete who never submitted one.
      setLoadError(e?.message ?? 'Could not load wellness check-ins')
      setCheckins([])
    } finally {
      setLoading(false)
    }
  }, [athleteId])

  useEffect(() => { void load() }, [load])

  const latest = checkins[checkins.length - 1] ?? null

  const toggleMetric = (key: MetricKey) => {
    setActiveMetrics((prev) => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key) } else { next.add(key) }
      return next
    })
  }

  if (!athleteId) return null

  const overallScore = overallWellnessScore(latest)
  const overallColor = overallScoreColor(overallScore)

  return (
    <div className="card" style={{ padding: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: overallScore !== null ? overallColor + '22' : '#f1f5f9',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20,
          }}>
            💚
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Wellness</div>
            {latest && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Last check-in: {fmtDate(latest.check_date)}
              </div>
            )}
          </div>
        </div>

        {overallScore !== null && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            background: overallColor + '15', borderRadius: 10, padding: '6px 12px',
          }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: overallColor, lineHeight: 1 }}>{overallScore}</span>
            <span style={{ fontSize: 10, color: overallColor, fontWeight: 600, marginTop: 1 }}>/ 5</span>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>Loading…</div>
      )}

      {!loading && loadError && (
        <div style={{ textAlign: 'center', fontSize: 13, padding: '12px 0', color: '#B55C3E' }}>
          {loadError}{' '}
          <button
            onClick={() => void load()}
            style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !loadError && checkins.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
          No check-ins yet. The athlete can submit from their portal.
        </div>
      )}

      {!loading && latest && (
        <>
          {/* Score bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {METRICS.map(({ key, label, icon, color, inverted }) => (
              <ScoreBar
                key={key}
                metricKey={key}
                label={label}
                icon={icon}
                color={color}
                score={((latest as unknown as Record<string, number | null>)[key]) ?? null}
                inverted={inverted}
              />
            ))}
          </div>

          {latest.notes && (
            <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--bg)', borderRadius: 8, fontSize: 12, color: 'var(--text-2)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Note: </span>{latest.notes}
            </div>
          )}

          {/* Trend toggle */}
          {checkins.length >= 2 && (
            <>
              <button
                onClick={() => setShowChart((v) => !v)}
                style={{
                  marginTop: 12, background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: 'var(--primary)', fontWeight: 600, padding: 0,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {showChart ? '▲ Hide' : '▼ Show'} 30-day trend
              </button>

              {showChart && (
                <div style={{ marginTop: 12 }}>
                  {/* Metric toggle pills */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {METRICS.map(({ key, label, color }) => (
                      <button
                        key={key}
                        onClick={() => toggleMetric(key)}
                        style={{
                          padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                          border: `1.5px solid ${activeMetrics.has(key) ? color : 'var(--border)'}`,
                          background: activeMetrics.has(key) ? color + '18' : 'transparent',
                          color: activeMetrics.has(key) ? color : 'var(--text-muted)',
                          cursor: 'pointer', transition: 'all 0.12s',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div style={{ borderRadius: 10, overflow: 'hidden', background: 'var(--bg)', padding: '10px 4px 4px' }}>
                    <LineChart checkins={checkins} activeMetrics={activeMetrics} />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
