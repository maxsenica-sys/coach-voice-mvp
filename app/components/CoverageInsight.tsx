'use client'

// CoverageInsight — "Least attention this month", for the coach's dashboard.
//
// Every athlete on the roster, least recorded attention first, over the last
// 30 days: sessions saved for them and words spoken in those sessions, with the
// roster median marked. Nobody is left off — the athlete at the bottom of a
// coach's attention is the one this card exists for, and a list that stopped
// at ten would stop before them on a big roster.
//
// Words spoken is a proxy for attention, not a measure of it, and the card
// says so on its face. The wording is neutral on purpose: a part-time coach
// with twenty athletes will always have a tail, and a scold is not a gift.
//
// Self-contained: it fetches its own data. Mount it with no props.
//
// Coach-only, always. This is a ranking of a coach's attention across a squad
// of children; the rig (tools/insights-rig.mjs) fails if anything under
// app/athlete/ imports it.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { todayISODate } from '@/lib/session-date'
import type { CoverageInsightResponse, CoverageInsight as Coverage } from '@/lib/insights'

const CAST: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em',
}
const BODY: React.CSSProperties = { fontSize: 'var(--t-body-tight)', lineHeight: 1.55, color: 'var(--text-2)', margin: 0 }
const nf = new Intl.NumberFormat()

export default function CoverageInsight({ athleteHref = (id: string) => `/athletes/${id}` }: {
  /** Where tapping an athlete goes. Defaults to their profile. */
  athleteHref?: (athleteId: string) => string
} = {}) {
  const [data, setData] = useState<Coverage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ scope: 'coverage', today: todayISODate() })
      const json = await apiJson<CoverageInsightResponse>(`/api/coach/insights?${q}`)
      if (!json?.coverage) throw new Error('Coverage came back empty. Try again.')
      setData(json.coverage)
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not load coverage.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const maxWords = data ? Math.max(1, data.median_words, ...data.rows.map((r) => r.words)) : 1
  const medianPct = data ? (data.median_words / maxWords) * 100 : 0
  // The median line sits above the first athlete at or over it.
  const medianAt = data ? data.rows.findIndex((r) => r.words >= data.median_words) : -1

  return (
    <section aria-labelledby="coverage-insight-h" style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: 44, marginBottom: 2 }}>
        <h2 id="coverage-insight-h" style={{ ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.22em', color: 'var(--text-2)', margin: 0 }}>
          Least attention this month
        </h2>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        {loading && !data ? (
          <p style={BODY} aria-live="polite">Adding up the last 30 days…</p>
        ) : error ? (
          <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <p style={{ ...BODY, color: 'var(--text)', flex: '1 1 200px', minWidth: 0 }}>⚠ {error}</p>
            <button onClick={() => void load()} className="btn btn-ghost" style={{ ...CAST, fontSize: 'var(--t-furniture)', minHeight: 44 }}>
              Retry
            </button>
          </div>
        ) : data && data.rows.length === 0 ? (
          <p style={BODY}>No athletes on your roster yet. Once you add some, this shows how your recorded time is spread across them.</p>
        ) : data ? (
          <>
            <p style={{ ...BODY, marginBottom: 10 }}>
              Last 30 days, least first. Words spoken is a rough stand-in for attention — it can&rsquo;t see
              watching, a quick word between reps, or anything you didn&rsquo;t record. Squad recordings are
              shared evenly across the athletes they were saved for.
            </p>

            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.rows.map((r, i) => {
                const name = `${r.first_name} ${r.last_name}`.trim() || 'Unnamed athlete'
                const pct = (r.words / maxWords) * 100
                return (
                  <li key={r.athlete_id}>
                    {i === medianAt && (
                      <div
                        role="separator"
                        aria-label={`Roster median: ${nf.format(Math.round(data.median_words))} words`}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}
                      >
                        <span aria-hidden style={{ flex: '1 1 12px', minWidth: 12, borderTop: '1px dashed var(--text-muted)' }} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)', textAlign: 'center' }}>
                          Roster median · {nf.format(Math.round(data.median_words))} words
                        </span>
                        <span aria-hidden style={{ flex: '1 1 12px', minWidth: 12, borderTop: '1px dashed var(--text-muted)' }} />
                      </div>
                    )}
                    <Link
                      href={athleteHref(r.athlete_id)}
                      style={{
                        display: 'block', minHeight: 44, padding: '10px 0', borderTop: '1px solid var(--border)',
                        textDecoration: 'none', color: 'inherit',
                      }}
                    >
                      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 10, rowGap: 2 }}>
                        <span style={{ fontSize: 'var(--t-body)', fontWeight: 600, color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0 }}>
                          {name}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                          {r.sessions} session{r.sessions === 1 ? '' : 's'} · {nf.format(r.words)} words
                        </span>
                      </span>
                      <span aria-hidden style={{ position: 'relative', display: 'block', height: 6, marginTop: 7, borderRadius: 3, background: 'var(--border)' }}>
                        {r.words > 0 && (
                          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(2, pct)}%`, borderRadius: 3, background: 'var(--primary)' }} />
                        )}
                        <span style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${medianPct}% - 1px)`, width: 2, background: 'var(--text)' }} />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ol>
            <p style={{ ...BODY, marginTop: 8, fontSize: 'var(--t-data)' }}>
              The dark tick on each bar is the roster median. Only you can see this.
            </p>
          </>
        ) : null}
      </div>
    </section>
  )
}
