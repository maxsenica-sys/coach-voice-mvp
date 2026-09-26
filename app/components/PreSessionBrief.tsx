'use client'

/**
 * The pre-session brief — coach-only.
 *
 * Twenty minutes before a session the coach's Home shows who is on it and how
 * each of them arrives: today's readiness or that they have not checked in,
 * where they are sore, any open injury, and the last thing the coach asked
 * them to work on with how they answered. Athletes who have not checked in are
 * listed first and can be nudged with a one-line in-app message.
 *
 * When the window opens is decided in lib/pre-session.ts, where the clock rig
 * can run it under nine timezones. This file only draws it.
 *
 * Never import this from an athlete surface: it is a comparison of children's
 * readiness laid out for the coach, which is exactly the kind of data
 * lib/attention.ts's "coach-only, always" rule exists for.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiJson, apiMutate } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { regionLabel } from '@/lib/body-map'
import { injuryStatusOption } from '@/lib/injury'
import { responseOption } from '@/lib/session-response'
import {
  briefPhase, countdownLabel, eventStart, nudgeMessage, startLabel, upcomingBrief,
  type BriefAthlete, type BriefResponse, type BriefableEvent,
} from '@/lib/pre-session'

type NudgeState = 'sending' | 'sent' | 'failed'

const tint = (token: string, pct: number) => `color-mix(in srgb, ${token} ${pct}%, transparent)`
const PANEL = tint('var(--text)', 4.5)
const HAIR = '1px solid var(--border-soft)'
const HAIR_2 = '1px solid var(--border)'
const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: '.02em' }
function cast(size: number, weight = 700, tracking = '.16em'): React.CSSProperties {
  return { fontFamily: 'var(--font-cast)', fontSize: size, fontWeight: weight, letterSpacing: tracking, textTransform: 'uppercase' }
}

/** Readiness in the same three words the athlete tapped. */
const READINESS: Record<1 | 2 | 3, { label: string; color: string; tint: string }> = {
  1: { label: 'Flat', color: 'var(--wellness-low)', tint: 'var(--wellness-low-tint)' },
  2: { label: 'OK', color: 'var(--wellness-ok)', tint: 'var(--wellness-ok-tint)' },
  3: { label: 'Good', color: 'var(--wellness-good)', tint: 'var(--wellness-good-tint)' },
}

function Pill({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <span style={{ ...cast(13, 700, '.1em'), color, background: bg, borderRadius: 999, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1.2 }}>
      {children}
    </span>
  )
}

const storageKey = (key: string) => `cv:brief-nudged:${key}`
function readSent(key: string): string[] {
  try {
    const raw = sessionStorage.getItem(storageKey(key))
    const v: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
function writeSent(key: string, ids: string[]) {
  try { sessionStorage.setItem(storageKey(key), JSON.stringify(ids)) } catch { /* not kept */ }
}

export interface BriefEvent {
  id: string
  title: string
  event_date: string
  event_time?: string | null
}

/**
 * One session's brief. `variant="card"` is the Home card; `"sheet"` is the
 * same content in a dialog, opened from a session in Today.
 */
export default function PreSessionBrief({ event, now: nowProp, variant, onClose }: {
  event: BriefEvent
  /** The caller's clock, so the card and the window agree. Ticks itself when absent. */
  now?: Date
  variant: 'card' | 'sheet'
  onClose?: () => void
}) {
  const [ownNow, setOwnNow] = useState(() => new Date())
  useEffect(() => {
    if (nowProp) return
    const t = setInterval(() => setOwnNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [nowProp])
  const now = nowProp ?? ownNow

  const [data, setData] = useState<BriefResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const json = await apiJson<BriefResponse>(`/api/coach/brief?event_id=${encodeURIComponent(event.id)}`, { cache: 'no-store' })
      if (mine !== seq.current) return
      if (!Array.isArray(json.athletes)) throw new Error('Could not load the brief.')
      setData(json)
      setError(null)
    } catch (e: unknown) {
      if (mine !== seq.current) return
      // Keep what was already shown; say the refresh failed.
      setError(errorMessage(e, 'Could not load the brief.'))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [event.id])

  // Once, then every minute: the point of the brief is watching check-ins
  // arrive after a nudge.
  useEffect(() => {
    void load()
    const t = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(t)
  }, [load])

  // ── nudges ──
  const [nudges, setNudges] = useState<Record<string, NudgeState>>({})
  const [nudgeErr, setNudgeErr] = useState<Record<string, string>>({})
  const inFlight = useRef(new Set<string>())
  const key = data?.key ?? null

  // What was already sent for this session in this tab — so reopening the
  // brief, or the card re-mounting, cannot send the same nudge twice.
  useEffect(() => {
    if (!key) return
    const sent = readSent(key)
    if (sent.length === 0) return
    setNudges((prev) => {
      const next = { ...prev }
      for (const id of sent) next[id] = 'sent'
      return next
    })
  }, [key])

  const sendNudge = useCallback(async (a: BriefAthlete) => {
    if (!key) return
    if (inFlight.current.has(a.id) || readSent(key).includes(a.id)) return
    inFlight.current.add(a.id)
    setNudges((p) => ({ ...p, [a.id]: 'sending' }))
    try {
      await apiMutate('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: a.id, content: nudgeMessage(event.event_time), msg_type: 'text' }),
      })
      writeSent(key, Array.from(new Set([...readSent(key), a.id])))
      setNudges((p) => ({ ...p, [a.id]: 'sent' }))
      setNudgeErr((p) => { const n = { ...p }; delete n[a.id]; return n })
    } catch (e: unknown) {
      setNudges((p) => ({ ...p, [a.id]: 'failed' }))
      setNudgeErr((p) => ({ ...p, [a.id]: errorMessage(e, 'Not sent.') }))
    } finally {
      inFlight.current.delete(a.id)
    }
  }, [key, event.event_time])

  const athletes = useMemo(() => data?.athletes ?? [], [data])
  const missing = athletes.filter((a) => a.checkin === null)
  const nudgeable = missing.filter((a) => nudges[a.id] !== 'sent' && nudges[a.id] !== 'sending')
  const nudgeAll = () => { for (const a of nudgeable) void sendNudge(a) }

  // Escape closes the sheet.
  useEffect(() => {
    if (variant !== 'sheet' || !onClose) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, onClose])

  const start = eventStart(event.event_date, event.event_time)
  const phase = start ? briefPhase(start, now) : null
  const at = startLabel(event.event_time)
  const headline = at ? `Starting at ${at}` : 'Session'
  const when = start && (phase === 'soon' || phase === 'started') ? countdownLabel(start, now) : null

  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, ...cast(13, 700, '.24em'), color: 'var(--flood)', flex: '1 1 auto', minWidth: 0 }}>
          <i aria-hidden className="sn-livedot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--flood)', flex: 'none' }} />
          Pre-session brief
        </span>
        {when && <span style={{ ...MONO, fontSize: 13, color: 'var(--text-2)' }}>{when}</span>}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close brief" style={{ width: 44, height: 44, marginRight: -8, background: 'none', border: 'none', color: 'var(--text-2)', fontSize: 22, cursor: 'pointer', flex: 'none' }}>×</button>
        )}
      </div>
      <h2 style={{ margin: '8px 0 0', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 24, lineHeight: 1.18, letterSpacing: -0.4, color: 'var(--text)', overflowWrap: 'anywhere' }}>
        {headline} <span aria-hidden style={{ color: 'var(--text-2)' }}>·</span> <em style={{ fontStyle: 'italic', fontWeight: 500 }}>{event.title}</em>
      </h2>

      {data && athletes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: 'var(--t-body-tight)', color: missing.length ? 'var(--text)' : 'var(--text-2)', overflowWrap: 'anywhere' }}>
            {missing.length === 0
              ? `All ${athletes.length} checked in.`
              : `${missing.length} of ${athletes.length} not checked in.`}
          </span>
          {nudgeable.length > 1 && (
            <button type="button" onClick={nudgeAll} className="btn btn-primary" style={{ minHeight: 44, padding: '0 16px' }}>
              Nudge all ({nudgeable.length})
            </button>
          )}
        </div>
      )}

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12, padding: '6px 6px 6px 12px', borderRadius: 8, background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 'var(--t-furniture)', fontWeight: 600 }}>
          <span style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>{error}{data ? ' Showing what was last loaded.' : ''}</span>
          <button type="button" onClick={() => void load()} className="btn btn-ghost" style={{ minHeight: 44, padding: '0 14px' }}>Retry</button>
        </div>
      )}

      {!data && loading && !error && (
        <div role="status" style={{ marginTop: 14, fontSize: 'var(--t-body-tight)', color: 'var(--text-2)' }}>Loading who is on this session…</div>
      )}

      {data && athletes.length === 0 && (
        <p style={{ margin: '14px 0 0', fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', lineHeight: 1.45 }}>
          No athletes are on this session in your calendar. Add it for an athlete or a squad to see their readiness here.
        </p>
      )}

      {athletes.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
          {athletes.map((a, i) => (
            <AthleteRow key={a.id} a={a} first={i === 0} nudge={nudges[a.id]} nudgeError={nudgeErr[a.id]} onNudge={() => void sendNudge(a)} />
          ))}
        </ul>
      )}
    </>
  )

  if (variant === 'card') {
    return (
      <section aria-label="Pre-session brief" data-brief="card" style={{
        position: 'relative', borderRadius: 20, overflow: 'hidden', background: PANEL, border: HAIR_2,
        padding: '14px 15px 8px', minWidth: 0,
      }}>
        <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, var(--flood) 0%, ${tint('var(--flood)', 16)} 62%, transparent 100%)` }} />
        {body}
      </section>
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Brief: ${event.title}`} data-brief="sheet"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      style={{ position: 'fixed', inset: 0, zIndex: 320, background: tint('black', 55), display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', overflowX: 'hidden', padding: '16px 16px calc(16px + env(safe-area-inset-bottom))' }}>
      <div className="card-lg" style={{ width: '100%', maxWidth: 560, minWidth: 0, padding: '14px 16px 10px', margin: 'auto 0' }}>
        {body}
      </div>
    </div>
  )
}

function AthleteRow({ a, first, nudge, nudgeError, onNudge }: {
  a: BriefAthlete; first: boolean; nudge?: NudgeState; nudgeError?: string; onNudge: () => void
}) {
  const name = `${a.first_name} ${a.last_name}`.trim() || 'Athlete'
  const c = a.checkin
  const readiness = c?.readiness ? READINESS[c.readiness] : null
  const response = a.last_focus ? responseOption(a.last_focus.response) : null
  return (
    <li data-athlete={a.id} data-checked-in={c ? 'yes' : 'no'} style={{ padding: '12px 0', borderTop: first ? HAIR_2 : HAIR, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ flex: '1 1 140px', minWidth: 0, ...cast(17, 700, '.04em'), color: 'var(--text)', lineHeight: 1.15, overflowWrap: 'anywhere' }}>{name}</span>
        {c === null ? (
          <Pill color="var(--coach-on-light)" bg="var(--coach-light)">
            <span aria-hidden>⚑</span> Not checked in
          </Pill>
        ) : readiness ? (
          <Pill color={readiness.color} bg={readiness.tint}>{readiness.label}</Pill>
        ) : (
          <Pill color="var(--text-2)" bg={tint('var(--text)', 7)}>Checked in{c.score !== null ? ` · ${c.score}/5` : ''}</Pill>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7, fontSize: 'var(--t-body-tight)', lineHeight: 1.4, color: 'var(--text-2)' }}>
        {c && (
          <div style={{ overflowWrap: 'anywhere' }}>
            {c.sore_areas.length > 0
              ? <><span style={{ color: 'var(--text)', fontWeight: 600 }}>Sore:</span> {c.sore_areas.map(regionLabel).join(', ')}</>
              : 'No soreness marked'}
          </div>
        )}
        {a.injuries.map((inj) => {
          const opt = injuryStatusOption(inj.status)
          return (
            <div key={inj.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Pill color={opt?.color ?? 'var(--text-2)'} bg={opt?.tint ?? PANEL}>{opt?.label ?? inj.status}</Pill>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere', color: 'var(--text)' }}>
                {regionLabel(inj.body_area)}
                {inj.expected_return ? <span style={{ color: 'var(--text-2)' }}> · back {fmtDay(inj.expected_return)}</span> : null}
              </span>
            </div>
          )
        })}
        {a.last_focus ? (
          <div style={{ minWidth: 0 }}>
            <span style={{ ...cast(13, 700, '.14em'), color: 'var(--text-2)' }}>Last takeaway</span>{' '}
            <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 'var(--t-body)', color: 'var(--text)', overflowWrap: 'anywhere' }}>“{a.last_focus.point}”</span>{' '}
            <div style={{ marginTop: 5 }}>
              {response
                ? <Pill color={response.color} bg={response.tint}>{response.coachLabel}</Pill>
                : <span style={{ ...MONO, fontSize: 13, color: 'var(--text-2)' }}>No reply yet</span>}
            </div>
          </div>
        ) : (
          <div>No takeaway set yet.</div>
        )}
      </div>

      {c === null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <button
            type="button"
            onClick={onNudge}
            disabled={nudge === 'sending' || nudge === 'sent'}
            data-nudge={nudge ?? 'idle'}
            aria-label={nudge === 'sent' ? `Nudge sent to ${name}` : `Nudge ${name} to check in`}
            style={{
              minHeight: 44, padding: '0 16px', borderRadius: 12, cursor: nudge === 'sending' || nudge === 'sent' ? 'default' : 'pointer',
              border: nudge === 'sent' ? '1px solid var(--success-border)' : HAIR_2,
              background: nudge === 'sent' ? 'var(--success-light)' : tint('var(--text)', 4),
              color: nudge === 'sent' ? 'var(--success)' : nudge === 'failed' ? 'var(--danger)' : 'var(--text)',
              ...cast(13, 700, '.14em'), display: 'inline-flex', alignItems: 'center', gap: 7,
            }}
          >
            {nudge === 'sending' ? 'Sending…' : nudge === 'sent' ? '✓ Nudge sent' : nudge === 'failed' ? 'Retry nudge' : 'Nudge'}
          </button>
          {nudge === 'failed' && (
            <span role="alert" style={{ flex: '1 1 140px', minWidth: 0, fontSize: 'var(--t-furniture)', fontWeight: 600, color: 'var(--danger)', overflowWrap: 'anywhere' }}>
              Not sent. {nudgeError}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

function fmtDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * The Home card: renders the brief for the session inside the window, or
 * nothing. Re-evaluates every 30 seconds so it appears at twenty minutes out
 * without a reload, and disappears after the grace period.
 */
export function UpcomingBrief({ events }: { events: readonly BriefableEvent[] }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  const up = useMemo(() => upcomingBrief(events, now), [events, now])
  if (!up) return null
  return <PreSessionBrief key={up.key} event={up.event} now={now} variant="card" />
}
