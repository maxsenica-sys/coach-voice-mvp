'use client'

// CoverageInsight — "Least attention this month", for the coach's dashboard.
//
// Every athlete on the roster over the last 30 days, grouped by how many
// sessions were saved for them ("No sessions", "1 session" … "5+ sessions"),
// least attention first inside each group. Nobody is left off — the athlete at
// the bottom of a coach's attention is the one this card exists for, and a
// list that stopped at ten would stop before them on a big roster. Each name
// is a link to the athlete; its tooltip carries the sessions and words.
//
// Until 2026-11-14 it was one row per athlete with a words bar, the roster
// median and a paragraph explaining that words are only a proxy. Max: "it's a
// lot of text" — so the groups replaced it. The wording stays neutral: a
// part-time coach with twenty athletes will always have a tail, and a scold is
// not a gift.
//
// 2026-11-20 (Max: "if there are things that are only going to be used
// periodically, then there's not much point" in giving them room): it is one
// closed row on the coach's home, and the row says the headline while closed:
// how many athletes are in the lowest group ("2 with no sessions"). Opening it
// shows every group and every name, as before. It still loads on mount, so
// the closed row is never a guess, and a failed load opens it so the reason
// and the Retry are on screen.
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
import { coverageGroups } from '@/lib/insights'
import Disclosure from '@/app/components/Disclosure'
import type { CoverageInsightResponse, CoverageInsight as Coverage } from '@/lib/insights'

const CAST: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em',
}
const plural = (n: number) => `${n} athlete${n === 1 ? '' : 's'}`
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

  const groups = data ? coverageGroups(data.rows) : []
  // What the closed row says: the lowest group, which is the one the card is for.
  const summary = loading && !data ? 'Adding up…'
    : error ? 'Could not load'
    : groups.length > 0 ? `${groups[0].rows.length} with ${groups[0].label.toLowerCase()}`
    : data ? 'No athletes yet'
    : undefined

  return (
    <section aria-label="Least attention this month" style={{ minWidth: 0 }}>
      <Disclosure label="Least attention this month" summary={summary} open={error ? true : undefined}>
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
          <div>
            {/* Grouped by how many sessions, every athlete named (Max,
                2026-11-14): the explanation paragraph, the bars and the median
                line made this the busiest thing on the home screen. Least
                attention first inside each group, as before. */}
            {groups.map((g) => (
              <div key={g.label} style={{
                display: 'grid', gridTemplateColumns: 'minmax(84px, 96px) minmax(0, 1fr)', gap: 10,
                alignItems: 'start', padding: '10px 0', borderTop: '1px solid var(--border)',
              }}>
                <div style={{ minWidth: 0, paddingTop: 10 }}>
                  <div style={{ fontSize: 'var(--t-body)', fontWeight: 600, color: 'var(--text)', lineHeight: 1.25 }}>{g.label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)' }}>
                    {plural(g.rows.length)}
                  </div>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                  {g.rows.map((r) => {
                    const name = `${r.first_name} ${r.last_name}`.trim() || 'Unnamed athlete'
                    return (
                      <li key={r.athlete_id} style={{ minWidth: 0, maxWidth: '100%' }}>
                        <Link
                          href={athleteHref(r.athlete_id)}
                          title={`${r.sessions} session${r.sessions === 1 ? '' : 's'} · ${nf.format(r.words)} words`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 12px',
                            borderRadius: 999, background: 'var(--panel)', border: '1px solid var(--border-soft)',
                            color: 'var(--text)', textDecoration: 'none', fontSize: 'var(--t-body-tight)',
                            overflowWrap: 'anywhere', maxWidth: '100%', boxSizing: 'border-box',
                          }}
                        >
                          {name}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </Disclosure>
    </section>
  )
}
