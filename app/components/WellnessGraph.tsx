'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  WELLNESS_METRICS, metricColor, overallWellnessScore, overallScoreColor,
  type MetricKey, type WellnessCheckin as Checkin,
} from '@/lib/wellness-config'
import { fmtShortDate as fmtDate } from '@/lib/date-utils'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'

interface Props {
  athleteId: string
}

const METRICS = WELLNESS_METRICS

// ─── SVG Line Chart ───────────────────────────────────────────────────────────
/**
 * One user unit in here is one CSS pixel, and that is the whole point.
 *
 * This was a fixed `viewBox="0 0 520 150"` drawn at `width: 100%`, which scales
 * everything inside it — text included. The axis labels said `fontSize="9"`, but
 * nine units of a 520-unit box drawn 300px wide land on the glass at 5.2px, and
 * the 2px lines came out as hairlines. The stated size was not the rendered
 * size at any width the app actually uses.
 *
 * So the chart measures its own box and sizes the viewBox to match. After that
 * `font-size: var(--t-data)` means 13px on a phone and 13px on a laptop.
 */
function LineChart({ checkins, activeMetrics }: { checkins: Checkin[], activeMetrics: Set<MetricKey> }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [boxW, setBoxW] = useState(0)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setBoxW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* Taller than the old 150, because five gridlines labelled at 13px need
     roughly 30px of room each. The chart gained height; it lost nothing. */
  const H = 190, PL = 28, PR = 14, PT = 14, PB = 34
  const W = boxW
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const lastIdx = checkins.length - 1

  const xScale = (i: number) => PL + (lastIdx < 1 ? 0 : (i / lastIdx) * chartW)
  const yScale = (v: number) => PT + (1 - (v - 1) / 4) * chartH

  // Y-axis gridlines
  const gridLines = [1, 2, 3, 4, 5]

  /* TICK THINNING, NOT DATA THINNING.
   *
   * Every check-in is still plotted — it keeps its point on every active line.
   * What is rationed is how many of them get a date printed underneath, because
   * "Sep 21" at 13px mono wants about 50px of room and the old every-sixth rule put
   * seven of them across a phone. The first and last check-in are always
   * labelled, so the window the chart covers is still stated outright rather
   * than inferred from a gap. */
  // 80, not 58: the dates are set in mono now, and the check below compares
  // a centred label against an END-anchored last one, so the room needed is
  // half of one date plus all of the other plus a gap — "Sep 19" and
  // "Sep 25" collided at 58.
  const TICK_W = 80
  const ticks: number[] = []
  if (lastIdx > 0 && chartW > 0) {
    const maxTicks = Math.max(2, Math.floor(chartW / TICK_W))
    const step = Math.max(1, Math.ceil(lastIdx / (maxTicks - 1)))
    for (let i = 0; i < lastIdx; i += step) ticks.push(i)
    const gapToLast = (lastIdx - ticks[ticks.length - 1]) * (chartW / lastIdx)
    if (ticks.length > 1 && gapToLast < TICK_W) ticks.pop()
    ticks.push(lastIdx)
  }

  return (
    <div ref={boxRef} style={{ width: '100%', minHeight: H }}>
      {W > 0 && checkins.length >= 2 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
          {/* Grid. All five scale points keep their label: 1-5 is the scale the
              athlete answered on, and dropping every other one would change
              what the axis says. At 13px they sit 35px apart, so they all fit. */}
          {gridLines.map((v) => (
            <g key={v}>
              <line x1={PL} y1={yScale(v)} x2={W - PR} y2={yScale(v)} stroke="var(--border-soft)" strokeWidth="1" />
              <text x={PL - 7} y={yScale(v) + 4.5} textAnchor="end" fill="var(--text-2)" style={{ fontSize: 'var(--t-data)', fontFamily: 'var(--font-mono)' }}>{v}</text>
            </g>
          ))}

          {/* X-axis labels — first and last always, the rest as room allows.
              textAnchor pins the end labels inside the box so neither is cut. */}
          {ticks.map((i) => (
            <text
              key={checkins[i].id}
              x={xScale(i)}
              y={H - 10}
              textAnchor={i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'}
              fill="var(--text-2)"
              style={{ fontSize: 'var(--t-data)', fontFamily: 'var(--font-mono)' }}
            >
              {fmtDate(checkins[i].check_date)}
            </text>
          ))}

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
      )}
    </div>
  )
}

// ─── Score Bar (horizontal) ───────────────────────────────────────────────────
/* One hairline-free row per metric: the name in the cast face, a track, the
 * score in mono. The fill takes the good / ok / low bucket colour from
 * metricColor — the same rule as the number beside it and the dot on the
 * coach's roster — rather than the series hue, which identifies a LINE on the
 * trend chart and means nothing about how the score is doing. */
function ScoreBar({ metricKey, label, score, inverted }: { metricKey: MetricKey; label: string; score: number | null; inverted?: boolean }) {
  const fillScore = score === null ? 0 : (inverted ? 6 - score : score)
  const fillPct = (fillScore / 5) * 100
  const bucket = metricColor(metricKey, score)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) 22px', alignItems: 'center', gap: 10 }}>
      <span style={{
        fontFamily: 'var(--font-cast)', fontSize: 15, fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--text-2)', overflowWrap: 'anywhere',
      }}>{label}</span>
      <div style={{ height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${fillPct}%`,
          background: bucket,
          borderRadius: 99,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500, color: 'var(--text)', textAlign: 'right' }}>
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
    } catch (e: unknown) {
      // Without this the chart rendered as "no check-ins yet" on a failed
      // request, which reads as an athlete who never submitted one.
      setLoadError(errorMessage(e, 'Could not load wellness check-ins'))
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
    <div className="card" style={{ padding: 18, borderRadius: 'var(--radius-lg)' }}>
      {/* Header: the section in the cast face, when it was last answered in
          mono, and the overall score as the reading-face numeral. The numeral
          keeps its good / ok / low colour — on the coach's side that colour is
          the information. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700,
            letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--text-2)',
          }}>
            Wellness
          </div>
          {latest && (
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)',
              letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 6,
            }}>
              Last check-in · {fmtDate(latest.check_date)}
            </div>
          )}
        </div>

        {overallScore !== null && (
          <div aria-label={`Overall ${overallScore} out of 5`} style={{ display: 'flex', alignItems: 'baseline', gap: 2, lineHeight: 0.8 }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 500, letterSpacing: '-0.04em',
              color: overallColor, fontVariantNumeric: 'tabular-nums',
            }}>{overallScore}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 19, color: 'var(--text-2)' }}>/5</span>
          </div>
        )}
      </div>

      {loading && (
        <div style={{
          color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)',
          letterSpacing: '0.06em', textTransform: 'uppercase', padding: '12px 0',
        }}>Loading…</div>
      )}

      {!loading && loadError && (
        <div role="alert" style={{
          padding: '12px 14px', borderRadius: 12, background: 'var(--coach-light)',
          border: '1px solid var(--coach-border)', boxShadow: 'inset 0 2px 0 var(--coach-on-light)',
        }}>
          <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
            {loadError}
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => void load()}
            style={{
              marginTop: 10, minHeight: 44, paddingInline: 16, borderRadius: 999, fontSize: 'var(--fs-2)',
              color: 'var(--text)', background: 'var(--bg)', borderColor: 'var(--coach-border)',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>↻</span>
            Try again
          </button>
        </div>
      )}

      {!loading && !loadError && checkins.length === 0 && (
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-3)', lineHeight: 1.5, padding: '4px 0' }}>
          No check-ins yet. The athlete can submit from their portal.
        </div>
      )}

      {!loading && latest && (
        <>
          {/* Score bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {METRICS.map(({ key, label, inverted }) => (
              <ScoreBar
                key={key}
                metricKey={key}
                label={label}
                score={((latest as unknown as Record<string, number | null>)[key]) ?? null}
                inverted={inverted}
              />
            ))}
          </div>

          {latest.notes && (
            <div style={{ marginTop: 14, padding: '11px 13px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border-soft)', fontSize: 'var(--t-body)', lineHeight: 1.5, color: 'var(--text)', overflowWrap: 'anywhere' }}>
              <span style={{
                display: 'block', marginBottom: 3,
                fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700,
                letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-2)',
              }}>Note</span>
              {latest.notes}
            </div>
          )}

          {/* Trend toggle */}
          {checkins.length >= 2 && (
            <>
              <button
                onClick={() => setShowChart((v) => !v)}
                aria-expanded={showChart}
                style={{
                  marginTop: 8, background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-cast)', fontSize: 15, letterSpacing: '0.14em',
                  textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 700,
                  minHeight: 44, padding: '0 2px',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {showChart ? '▲ Hide' : '▼ Show'} 30-day trend
              </button>

              {showChart && (
                <div style={{ marginTop: 12 }}>
                  {/* Metric toggle pills */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {METRICS.map(({ key, label, color }) => {
                      const on = activeMetrics.has(key)
                      return (
                        <button
                          key={key}
                          onClick={() => toggleMetric(key)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            minHeight: 44, padding: '0 14px', borderRadius: 99,
                            fontSize: 'var(--t-furniture)', fontWeight: 600,
                            border: `1.5px solid ${on ? color : 'var(--border)'}`,
                            background: on ? 'var(--card)' : 'transparent',
                            // The five series hues identify a line on the chart,
                            // where they are fills governed by 3:1. As pill text
                            // they measured 2.00-3.78:1, so the identity moves to
                            // the dot and the label takes a legible colour.
                            color: on ? 'var(--text)' : 'var(--text-2)',
                            cursor: 'pointer', transition: 'all 0.12s',
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? color : 'var(--border)', flexShrink: 0 }} />
                          {label}
                        </button>
                      )
                    })}
                  </div>

                  <div style={{ borderRadius: 12, overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--border-soft)', padding: '10px 4px 4px' }}>
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
