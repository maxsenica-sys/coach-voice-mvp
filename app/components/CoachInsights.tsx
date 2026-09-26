'use client'

// CoachInsights — two coach-only mirrors on an athlete's profile.
//
//   What you repeat  The phrases the coach keeps coming back to with this
//                    athlete, counted across distinct sessions.
//   Replies          What the athlete has tapped back, and a nudge when
//                    "Not sure what you mean" keeps coming up.
//
// Framed as a mirror, not a verdict: a repeated cue can be a priority or a
// sign it has not landed yet, and the copy says both. All counting is in
// lib/insights.ts (proved by tools/insights-rig.mjs); this file only draws.
//
// Coach-only. Never render this on an athlete screen — the rig fails if
// anything under app/athlete/ imports it.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { todayISODate, parseISODate } from '@/lib/session-date'
import { SESSION_RESPONSES } from '@/lib/session-response'
import { NOT_SURE_LOOKBACK, REPLY_SESSIONS_READ, type AthleteInsightsResponse, type ThemeSessionRef } from '@/lib/insights'

const CAST: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em',
}
const EYEBROW: React.CSSProperties = {
  ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.22em', color: 'var(--text-2)', margin: 0,
}
const BODY: React.CSSProperties = { fontSize: 'var(--t-body-tight)', lineHeight: 1.55, color: 'var(--text-2)', margin: 0 }

function fmtDate(iso: string | null): string {
  const d = iso ? parseISODate(iso) : null
  return d ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Undated'
}

function SessionLinks({ sessions }: { sessions: ThemeSessionRef[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 6px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {sessions.map((s) => (
        <li key={s.id}>
          <Link
            href={`/sessions/${s.id}`}
            style={{
              display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 12px', borderRadius: 999,
              border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', textDecoration: 'none',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)',
            }}
          >
            {fmtDate(s.date)} →
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function CoachInsights({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const [data, setData] = useState<AthleteInsightsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ athlete_id: athleteId, today: todayISODate() })
      const json = await apiJson<AthleteInsightsResponse>(`/api/coach/insights?${q}`)
      if (!json?.themes || !json?.replies) throw new Error('Insights came back empty. Try again.')
      setData(json)
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not load insights.'))
    } finally {
      setLoading(false)
    }
  }, [athleteId])

  useEffect(() => { void load() }, [load])

  const name = athleteName || 'This athlete'

  return (
    <section aria-label="Coaching insights" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* ── What you repeat ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', minHeight: 44, marginBottom: 2 }}>
          <h2 style={EYEBROW}>What you repeat</h2>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {loading && !data ? (
            <p style={BODY} aria-live="polite">Reading your sessions with {name}…</p>
          ) : error ? (
            <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <p style={{ ...BODY, color: 'var(--text)', flex: '1 1 200px', minWidth: 0 }}>⚠ {error}</p>
              <button onClick={() => void load()} className="btn btn-ghost" style={{ ...CAST, fontSize: 'var(--t-furniture)', minHeight: 44 }}>
                Retry
              </button>
            </div>
          ) : data && data.themes.themes.length === 0 ? (
            <p style={BODY}>
              {data.themes.window_sessions < 3
                ? `${data.themes.window_sessions === 0 ? 'No' : `Only ${data.themes.window_sessions}`} session${data.themes.window_sessions === 1 ? '' : 's'} with ${name} in the last 8 weeks. Themes show up here once something comes up in 3 or more.`
                : `Nothing has come up in 3 or more of your last ${data.themes.window_sessions} sessions with ${name}.`}
            </p>
          ) : data ? (
            <>
              <p style={{ ...BODY, marginBottom: 10 }}>
                Phrases you keep coming back to with {name} over the last 8 weeks. A repeat can mean it&rsquo;s the
                priority — or that it might not be landing yet.
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.themes.themes.map((t) => {
                  const isOpen = open === t.phrase
                  const panelId = `theme-${t.phrase.replace(/\W+/g, '-')}`
                  return (
                    <li key={t.phrase} style={{ borderTop: '1px solid var(--border)' }}>
                      <button
                        onClick={() => setOpen(isOpen ? null : t.phrase)}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        style={{
                          width: '100%', minHeight: 44, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
                          display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
                          textAlign: 'left', color: 'inherit', font: 'inherit',
                        }}
                      >
                        <span style={{ display: 'block', minWidth: 0 }}>
                          <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 19, lineHeight: 1.2, color: 'var(--text)', overflowWrap: 'anywhere' }}>
                            &lsquo;{t.phrase}&rsquo;
                          </span>
                          <span style={{ display: 'block', fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', marginTop: 3, lineHeight: 1.4 }}>
                            You&rsquo;ve mentioned it in {t.count} of the last {data.themes.window_sessions} sessions
                          </span>
                        </span>
                        <span aria-hidden style={{ ...CAST, fontSize: 'var(--t-furniture)', color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                          {isOpen ? 'Hide' : 'See'} {t.count} {isOpen ? '▴' : '▾'}
                        </span>
                      </button>
                      {isOpen && (
                        <div id={panelId}>
                          <SessionLinks sessions={t.sessions} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Replies ── */}
      {data && !error && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', minHeight: 44, marginBottom: 2 }}>
            <h2 style={EYEBROW}>How {name} replied</h2>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.replies.flag && (
              <div role="note" style={{ borderLeft: '2px solid var(--coach-on-light)', paddingLeft: 12 }}>
                <p style={{ ...BODY, color: 'var(--text)', fontSize: 'var(--t-body)' }}>
                  {name} said &lsquo;not sure&rsquo; to {data.replies.recent_not_clear} of their last{' '}
                  {data.replies.recent_replied} takeaways — maybe rephrase.
                </p>
                <button
                  onClick={() => setOpen(open === '__not_sure' ? null : '__not_sure')}
                  aria-expanded={open === '__not_sure'}
                  aria-controls="replies-not-sure"
                  style={{ ...CAST, fontSize: 'var(--t-furniture)', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', minHeight: 44, padding: 0 }}
                >
                  {open === '__not_sure' ? 'Hide' : 'See'} those sessions {open === '__not_sure' ? '▴' : '▾'}
                </button>
                {open === '__not_sure' && (
                  <div id="replies-not-sure"><SessionLinks sessions={data.replies.flagged_sessions} /></div>
                )}
              </div>
            )}

            {data.replies.sessions_read === 0 ? (
              <p style={BODY}>No sessions with {name} yet.</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {SESSION_RESPONSES.map((r) => (
                    <div key={r.value} style={{ minWidth: 0, padding: '10px 10px 9px', borderRadius: 12, background: r.tint, border: `1px solid color-mix(in srgb, ${r.color} 42%, transparent)` }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                        {data.replies[r.value]}
                      </div>
                      <div style={{ ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.08em', lineHeight: 1.25, color: r.color, marginTop: 6, overflowWrap: 'anywhere' }}>
                        {r.coachLabel}
                      </div>
                    </div>
                  ))}
                </div>
                <p style={BODY}>
                  {data.replies.unanswered === 0
                    ? 'Every shared takeaway has an answer.'
                    : `${data.replies.unanswered} shared takeaway${data.replies.unanswered === 1 ? '' : 's'} not answered yet.`}
                  {data.replies.sessions_read >= REPLY_SESSIONS_READ ? ` Counted from your last ${data.replies.sessions_read} sessions.` : ''}
                  {!data.replies.flag && data.replies.recent_not_clear === 1
                    ? ` One of the last ${Math.min(NOT_SURE_LOOKBACK, data.replies.recent_replied)} replies was “not sure”.`
                    : ''}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
