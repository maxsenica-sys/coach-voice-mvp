'use client'

/**
 * The coach's view of when an athlete opened what they were sent.
 *
 * Max, 2026-09-26: "Audit log — so I can see when the athlete accesses the
 * information." Two renders of the same log (supabase/migrations/030):
 *
 *   <AccessLog athleteId firstName />      "Activity" on the athlete profile —
 *                                           the last 20 things they opened.
 *   <SessionSeen sessionId firstName />    one line on a shared session:
 *                                           "Seen by Mathilde · Fri 4:12pm".
 *
 * Coach surfaces only. The athlete is told their opens are logged; they are
 * never shown the log (SG10 in tools/safeguard-check.mjs keeps this file out
 * of app/athlete/). Both read GET /api/coach/access-log, which is roster-scoped.
 *
 * Neither ever blocks the page it sits on: loading renders nothing, and a
 * failure says so in one quiet line rather than taking the page with it.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { accessKindLabel, formatAccessTime } from '@/lib/access-log'

type AccessEvent = {
  id: string
  kind: string
  session_id: string | null
  session_title: string | null
  created_at: string
}

type AccessLogResponse = { available: boolean; events: AccessEvent[] }

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; available: boolean; events: AccessEvent[] }

function useAccessLog(query: string): [State, () => void] {
  // Each result remembers which query it answers, so a change of athlete or
  // session reads as loading until its own answer arrives — derived here
  // rather than by resetting state inside the effect.
  const [result, setResult] = useState<{ query: string; attempt: number; state: State } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    apiJson<AccessLogResponse>(`/api/coach/access-log?${query}`, { cache: 'no-store' })
      .then((json) => {
        if (cancelled) return
        setResult({
          query, attempt,
          state: { status: 'ready', available: json.available !== false, events: Array.isArray(json.events) ? json.events : [] },
        })
      })
      .catch((e: unknown) => {
        if (!cancelled) setResult({ query, attempt, state: { status: 'error', message: errorMessage(e, 'Could not load activity.') } })
      })
    return () => { cancelled = true }
  }, [query, attempt])

  const state: State = result && result.query === query && result.attempt === attempt
    ? result.state
    : { status: 'loading' }
  return [state, () => setAttempt((n) => n + 1)]
}

const QUIET: React.CSSProperties = {
  fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', margin: 0, lineHeight: 1.45,
  overflowWrap: 'anywhere',
}

/**
 * "Seen by Mathilde · Fri 4:12pm" / "Not opened yet" — under a shared
 * session's title. The caller renders it only when the session is shared: an
 * unshared session cannot have been seen, and saying "not opened" about it
 * would read as a reproach to the athlete.
 */
export function SessionSeen({ sessionId, firstName }: { sessionId: string; firstName: string }) {
  const [state] = useAccessLog(`session_id=${encodeURIComponent(sessionId)}`)
  const who = firstName || 'the athlete'

  // Nothing while loading, and nothing if logging is not switched on yet:
  // "Not opened yet" would be a claim the app cannot back.
  if (state.status === 'loading') return null
  if (state.status === 'ready' && !state.available) return null

  let text: React.ReactNode
  if (state.status === 'error') {
    text = 'Could not check whether this has been opened.'
  } else {
    const latest = state.events[0]
    text = latest
      ? <>Seen by {who} · <span style={{ whiteSpace: 'nowrap' }}>{formatAccessTime(latest.created_at)}</span></>
      : 'Not opened yet'
  }

  return (
    <p data-testid="session-seen" style={{
      ...QUIET, display: 'flex', alignItems: 'center', gap: 8, minHeight: 24, marginTop: 4,
    }}>
      <i aria-hidden style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: state.status === 'ready' && state.events.length > 0 ? 'var(--primary)' : 'var(--line-2)',
      }} />
      <span style={{ minWidth: 0 }}>{text}</span>
    </p>
  )
}

/** "Activity" — the last 20 things this athlete opened. For the athlete profile. */
export default function AccessLog({ athleteId, firstName }: { athleteId: string; firstName: string }) {
  const [state, retry] = useAccessLog(`athlete_id=${encodeURIComponent(athleteId)}`)
  const who = firstName || 'this athlete'

  return (
    <section aria-label="Activity" data-testid="access-log" style={{ minWidth: 0 }}>
      <h2 style={{
        fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)',
        textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--text-2)',
        margin: '0 0 8px', lineHeight: 1.2,
      }}>
        Activity
      </h2>

      {state.status === 'loading' && <p style={QUIET}>Loading…</p>}

      {state.status === 'error' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px 12px', flexWrap: 'wrap' }}>
          <p style={{ ...QUIET, color: 'var(--danger)' }}>{state.message}</p>
          <button onClick={retry} style={{
            minHeight: 44, padding: '0 14px', borderRadius: 11, cursor: 'pointer',
            border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--text)',
            fontSize: 'var(--t-body-tight)',
          }}>
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && !state.available && (
        <p style={QUIET}>Activity tracking is not switched on yet.</p>
      )}

      {state.status === 'ready' && state.available && state.events.length === 0 && (
        <p style={QUIET}>
          Nothing opened yet. When {who} opens a session you have shared, it shows here.
        </p>
      )}

      {state.status === 'ready' && state.available && state.events.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--line)' }}>
          {state.events.map((e) => {
            // Line one: what happened and when, the time held to the label so
            // every row reads the same way. Line two: which session, full
            // width, wrapping rather than cut.
            const body = (
              <>
                <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2px 12px', minWidth: 0 }}>
                  <span style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0 }}>
                    {accessKindLabel(e.kind)}
                  </span>
                  <time dateTime={e.created_at} style={{
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)', whiteSpace: 'nowrap',
                  }}>
                    {formatAccessTime(e.created_at)}
                  </time>
                </span>
                {e.session_title && (
                  <span style={{ display: 'block', fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', overflowWrap: 'anywhere', marginTop: 2 }}>
                    {e.session_title}
                  </span>
                )}
              </>
            )
            const row: React.CSSProperties = {
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              minHeight: 44, padding: '8px 0', minWidth: 0,
              color: 'inherit', textDecoration: 'none',
            }
            return (
              <li key={e.id} style={{ borderBottom: '1px solid var(--line)' }}>
                {e.session_id
                  ? <Link href={`/sessions/${e.session_id}`} style={row}>{body}</Link>
                  : <div style={row}>{body}</div>}
              </li>
            )
          })}
        </ol>
      )}

      <p style={{ ...QUIET, marginTop: 8 }}>
        Logged when {who} opens something you shared. Your own views are not recorded.
      </p>
    </section>
  )
}
