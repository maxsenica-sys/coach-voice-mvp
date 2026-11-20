'use client'

// CoachInsights — two coach-only mirrors on an athlete's profile.
//
//   What you repeat  The phrases the coach keeps coming back to with this
//                    athlete, counted across distinct sessions.
//   Replies          What the athlete has tapped back, and a nudge when
//                    "Not sure what you mean" keeps coming up.
//
// Both are closed rows on the profile (app/components/Disclosure.tsx): a coach
// reads these weekly at most, so each takes one line that says how much is
// inside. Two things are never tucked away, because they are waiting on the
// coach: a failed read, and the nudge that 'not sure' keeps coming up.
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
import Disclosure from '@/app/components/Disclosure'
import { NOT_SURE_LOOKBACK, REPLY_SESSIONS_READ, type AthleteInsightsResponse, type ThemeSessionRef } from '@/lib/insights'

const CAST: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em',
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
  const themes = data?.themes.themes ?? []
  const replied = data ? SESSION_RESPONSES.reduce((n, r) => n + data.replies[r.value], 0) : 0

  // We asked and could not find out. Said in the open, with a way to ask again:
  // a closed row reading "None yet" would be a claim about data we do not have.
  if (error) {
    return (
      <section aria-label="Coaching insights" style={{ minWidth: 0, borderTop: '1px solid var(--border)', padding: '10px 0' }}>
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <p style={{ ...BODY, color: 'var(--text)', flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>⚠ {error}</p>
          <button onClick={() => void load()} className="btn btn-ghost" style={{ ...CAST, fontSize: 'var(--t-furniture)', minHeight: 44 }}>
            Retry
          </button>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Coaching insights" style={{ minWidth: 0 }}>
      {/* ── The nudge: always in the open ── */}
      {data?.replies.flag && (
        <div role="note" style={{ borderTop: '1px solid var(--border)', padding: '12px 0 4px' }}>
          <div style={{ borderLeft: '2px solid var(--coach-on-light)', paddingLeft: 12 }}>
            <p style={{ ...BODY, color: 'var(--text)', fontSize: 'var(--t-body)' }}>
              {name} said &lsquo;not sure&rsquo; to {data.replies.recent_not_clear} of their last{' '}
              {data.replies.recent_replied} takeaways. Maybe rephrase.
            </p>
            <Disclosure
              flush
              label="Those sessions"
              summary={`${data.replies.flagged_sessions.length}`}
            >
              <SessionLinks sessions={data.replies.flagged_sessions} />
            </Disclosure>
          </div>
        </div>
      )}

      {/* ── What you repeat ── */}
      <Disclosure
        label="What you repeat"
        summary={loading && !data ? 'Reading…' : themes.length === 0 ? 'Nothing yet' : `${themes.length} theme${themes.length === 1 ? '' : 's'}`}
      >
        {loading && !data ? (
          <p style={BODY} aria-live="polite">Reading your sessions with {name}…</p>
        ) : data && themes.length === 0 ? (
          <p style={BODY}>
            {data.themes.window_sessions < 3
              ? `${data.themes.window_sessions === 0 ? 'No' : `Only ${data.themes.window_sessions}`} session${data.themes.window_sessions === 1 ? '' : 's'} with ${name} in the last 8 weeks. Themes show up here once something comes up in 3 or more.`
              : `Nothing has come up in 3 or more of your last ${data.themes.window_sessions} sessions with ${name}.`}
          </p>
        ) : data ? (
          <>
            <p style={{ ...BODY, marginBottom: 6 }}>
              Phrases you keep coming back to with {name} over the last 8 weeks. A repeat can mean it&rsquo;s the
              priority, or that it might not be landing yet.
            </p>
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              {themes.map((t) => (
                <Disclosure
                  key={t.phrase}
                  label={(
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 19, lineHeight: 1.2 }}>
                      &lsquo;{t.phrase}&rsquo;
                    </span>
                  )}
                  summary={`${t.count} of ${data.themes.window_sessions} sessions`}
                >
                  <SessionLinks sessions={t.sessions} />
                </Disclosure>
              ))}
            </div>
          </>
        ) : null}
      </Disclosure>

      {/* ── Replies ── */}
      {data && (
        <Disclosure
          label={`How ${name} replied`}
          summary={data.replies.sessions_read === 0
            ? 'No sessions yet'
            : `${replied} ${replied === 1 ? 'reply' : 'replies'}${data.replies.unanswered > 0 ? ` · ${data.replies.unanswered} not answered` : ''}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.replies.sessions_read === 0 ? (
              <p style={BODY}>No sessions with {name} yet.</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {SESSION_RESPONSES.map((r) => (
                    <div key={r.value} style={{ minWidth: 0, padding: '10px 8px 9px', borderRadius: 12, background: r.tint, border: `1px solid color-mix(in srgb, ${r.color} 42%, transparent)` }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                        {data.replies[r.value]}
                      </div>
                      <div style={{ ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.02em', lineHeight: 1.25, color: r.color, marginTop: 6, overflowWrap: 'anywhere' }}>
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
        </Disclosure>
      )}
    </section>
  )
}
