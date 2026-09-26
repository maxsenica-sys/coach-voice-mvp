'use client'

/**
 * Session detail — /sessions/[id]
 *
 * Sessions used to be accordion rows inside the athlete page: tapping one took
 * you to the athlete, and a session had nowhere to grow. This gives a session
 * its own page, with room to add what makes it worth revisiting — the coach's
 * own notes, the points to carry into next time, and images.
 *
 * Reads everything in one request (/detail) so the page doesn't waterfall.
 * Serves both roles: the coach edits, the athlete reads.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiJson, apiMutate } from '@/lib/api-client'
import SessionAudioPlayer from '@/app/components/SessionAudioPlayer'
import FocusCard from '@/app/components/FocusCard'
import { errorMessage } from '@/lib/errors'
import { metricColor, metricTint, scoreLabel, type MetricKey } from '@/lib/wellness-config'
import { SESSION_RESPONSES, responseOption, type SessionResponse } from '@/lib/session-response'
import { formatSessionDate, parseISODate, sessionDate, sessionISODate } from '@/lib/session-date'

type FocusPoint = string

/**
 * Whether the page before this one is ours, so back can be a real back.
 *
 * A coach reaches a session from the athlete's profile, the dashboard's
 * Sessions tab, the calendar or a notification. Back used to be a fixed link to
 * the athlete profile, which from the dashboard cost a detour and a second tap.
 *
 * The test: did this document start life on a different URL of this app? The
 * Navigation Timing entry records the URL the document was loaded at and is
 * fixed for the document's life. Next's client-side navigations don't create a
 * new document, so if it was loaded at /dashboard and we are now at
 * /sessions/x, the previous history entry is an in-app page and router.back()
 * lands on it. If the document was loaded right here — a deep link, a
 * notification, a reload, a pasted URL — history.back() could leave the app or
 * do nothing, so the fixed link is used instead.
 *
 * Chosen over the alternatives because each fails silently:
 *  - history.length counts entries from other sites and forward entries too;
 *  - document.referrer is never updated by client-side navigation;
 *  - a sessionStorage marker would have to be set by every page that links
 *    here, and the first one that forgets sends back out of the app.
 */
function previousPageIsInApp(): boolean {
  try {
    if (window.history.length <= 1) return false
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (!nav?.name) return false
    const loadedAt = new URL(nav.name)
    return loadedAt.origin === window.location.origin && loadedAt.pathname !== window.location.pathname
  } catch {
    return false
  }
}
const noSubscribe = () => () => {}

type SessionDetail = {
  athlete_response?: string | null
  athlete_responded_at?: string | null
  id: string
  athlete_id: string
  session_name: string | null
  title: string | null
  summary: string | null
  transcript: string | null
  coach_notes: string | null
  focus_points: FocusPoint[]
  shared_with_athlete: boolean
  session_date?: string | null
  sport_context: string | null
  created_at: string
  audio_url: string | null
  audio_mime: string | null
}

type AthleteLite = {
  id: string
  first_name: string
  last_name: string
  sport: string | null
  photo_url: string | null
} | null

type VideoRow = {
  id: string
  file_name: string | null
  mime_type: string | null
  shared_with_athlete: boolean
  signedUrl: string | null
}

type AttachmentRow = {
  id: string
  file_name: string | null
  mime_type: string | null
  caption: string | null
  created_at: string
  signedUrl: string | null
}

/**
 * The athlete's own check-in from the morning of the session. Coach-only —
 * the API sends null to an athlete viewer — and deliberately three metrics,
 * not five. See loadSessionCheckin in the detail route for why.
 */
type SessionCheckin = {
  energy: number | null
  sleep_q: number | null
  soreness: number | null
  check_date: string
}

/**
 * The three check-in metrics a coach sees next to a session, in order.
 *
 * `mood` and `stress` are absent by design, not by omission — see the detail
 * route. Typed as a subset of MetricKey so the wellness-config helpers still
 * apply and this list cannot silently grow to five.
 */
const CHECKIN_METRICS: { key: Extract<MetricKey, 'energy' | 'sleep_q' | 'soreness'>; label: string }[] = [
  { key: 'energy', label: 'Energy' },
  { key: 'sleep_q', label: 'Sleep' },
  { key: 'soreness', label: 'Soreness' },
]

type DetailResponse = {
  viewerRole: 'coach' | 'athlete'
  session: SessionDetail
  athlete: AthleteLite
  checkin: SessionCheckin | null
  videos: VideoRow[]
  attachments: AttachmentRow[]
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const p = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { width: size, height: size, display: 'block', flexShrink: 0 },
  }
  switch (name) {
    case 'back':   return <svg {...p}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
    case 'mic':    return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
    case 'spark':  return <svg {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
    case 'target': return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>
    case 'note':   return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
    case 'image':  return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
    case 'video':  return <svg {...p}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
    case 'text':   return <svg {...p}><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>
    case 'pulse':  return <svg {...p}><polyline points="2 12 6 12 9 4 15 20 18 12 22 12" /></svg>
    case 'plus':   return <svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case 'x':      return <svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
    case 'check':  return <svg {...p}><polyline points="20 6 9 17 4 12" /></svg>
    default:       return null
  }
}

/* ── Stadium Night surfaces ──────────────────────────────────────────────────
 * The spec's --line, --line-2, --panel and ember are not tokens in globals.css
 * yet. These are those exact values, expressed against the tokens that are, so
 * a token change still moves them and no hex is invented here. */
const LINE = 'color-mix(in srgb, var(--text) 11%, transparent)'
const LINE_2 = 'color-mix(in srgb, var(--text) 19%, transparent)'
const PANEL = 'color-mix(in srgb, var(--text) 4.5%, transparent)'
/** #E39A7A — the coach's mark. Everything the athlete's screen spends floodlight on, this page spends ember on. */
const EMBER = 'var(--coach-on-light)'
/** #E4BC6B — the forward-looking line. */
const AMBER = 'var(--energy-dark)'
/** #A8CBA0 — sage lifted to be read on ink. */
const SAGE = 'var(--primary)'

/** Uppercase furniture: eyebrows, section heads, tickers. Big Shoulders, tracked. */
const CAST: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)',
  textTransform: 'uppercase', lineHeight: 1.2,
}

/* The stage: ink, a sage floodlight from the top right, an ember spill from
 * the left, and the 39px pitch-marking grid. Positions are in px, not %, because
 * this element is the whole scrolling page and a percentage of its height would
 * put the beam thousands of pixels off the top. No grain: the shared .bg-grain
 * layer composites at 0.14, over the 0.13 ceiling that keeps small text above
 * 4.5:1. */
const STAGE_BACKGROUND = [
  'radial-gradient(740px 430px at calc(100% + 30px) -40px, color-mix(in srgb, var(--primary) 20%, transparent) 0%, transparent 62%)',
  'radial-gradient(520px 380px at -50px 60px, color-mix(in srgb, var(--coach-on-light) 9%, transparent) 0%, transparent 60%)',
  'repeating-linear-gradient(to right, color-mix(in srgb, var(--text) 3.5%, transparent) 0 1px, transparent 1px 39px)',
  'repeating-linear-gradient(to bottom, color-mix(in srgb, var(--text) 2.5%, transparent) 0 1px, transparent 1px 39px)',
].join(', ')

/** Section shell — one consistent head so the page reads as a sequence, not a pile of cards. */
function Section({
  label, meta, children, action,
}: {
  label: string; meta?: React.ReactNode
  children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, minHeight: 28, flexWrap: 'wrap' }}>
        <h2 style={{ ...CAST, margin: 0, letterSpacing: '0.26em', color: 'var(--text-2)', flex: '1 1 auto', minWidth: 0 }}>
          {label}
        </h2>
        {meta !== undefined && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', letterSpacing: '0.06em', color: 'var(--text-2)' }}>
            {meta}
          </span>
        )}
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * The summary, set as a feature.
 *
 * Summaries are written as "•" bullets (lib/summary-prompt.ts), and older ones
 * as prose. Each line keeps its words exactly; a bullet line becomes a list
 * item with the coach's ember mark in place of the glyph, so a wrapped bullet
 * hangs instead of running back under its own marker. Prose gets the drop cap
 * — only when it opens on a letter or digit, never on a quote or an emoji.
 */
function SummaryFeature({ text }: { text: string }) {
  type Block = { kind: 'para'; text: string } | { kind: 'list'; items: string[] }
  const blocks: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('•')) {
      const item = line.replace(/^•\s*/, '')
      const last = blocks[blocks.length - 1]
      if (last && last.kind === 'list') last.items.push(item)
      else blocks.push({ kind: 'list', items: [item] })
    } else {
      blocks.push({ kind: 'para', text: line })
    }
  }

  const read: React.CSSProperties = {
    fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 17, lineHeight: 1.58,
    color: 'var(--text)', overflowWrap: 'anywhere',
  }

  return (
    <div>
      {blocks.map((b, bi) => {
        if (b.kind === 'list') {
          return (
            <ul key={bi} style={{ listStyle: 'none', margin: bi ? '10px 0 0' : 0, padding: 0 }}>
              {b.items.map((item, ii) => (
                <li key={ii} style={{
                  ...read, display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', alignItems: 'start',
                  padding: '7px 0', borderTop: ii ? `1px solid ${LINE}` : 'none',
                }}>
                  <span aria-hidden style={{
                    width: 7, height: 7, marginTop: '0.62em', background: EMBER, transform: 'skewX(-14deg)',
                  }} />
                  <span style={{ minWidth: 0 }}>{item}</span>
                </li>
              ))}
            </ul>
          )
        }
        const chars = Array.from(b.text)
        const cap = bi === 0 && /[\p{L}\p{N}]/u.test(chars[0] ?? '') && chars.length > 1
        return (
          <p key={bi} style={{ ...read, margin: bi ? '10px 0 0' : 0 }}>
            {cap ? (
              <>
                <span aria-hidden style={{
                  float: 'left', fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 50,
                  lineHeight: 0.86, padding: '5px 9px 0 0', color: 'var(--text)',
                }}>{chars[0]}</span>
                <span className="sr-only">{chars[0]}</span>
                {chars.slice(1).join('')}
              </>
            ) : b.text}
          </p>
        )
      })}
    </div>
  )
}

export default function SessionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = String(params?.id ?? '')

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [actionError, setActionError] = useState('')
  const [savedFlash, setSavedFlash] = useState('')

  const [notesDraft, setNotesDraft] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [newFocus, setNewFocus] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const isCoach = data?.viewerRole === 'coach'

  /**
   * The athlete's answer, held locally so a tap is instant.
   *
   * Seeded from the loaded session and updated optimistically; a failed write
   * puts the previous value back rather than leaving the chip lying.
   */
  const [response, setResponse] = useState<string | null>(null)
  useEffect(() => { setResponse(data?.session.athlete_response ?? null) }, [data?.session.athlete_response])

  const answer = async (next: SessionResponse) => {
    const previous = response
    const value = previous === next ? null : next
    setResponse(value)
    try {
      await apiMutate(`/api/sessions/${sessionId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: value }),
      })
    } catch (e: unknown) {
      setResponse(previous)
      setActionError(errorMessage(e, 'Could not send that to your coach'))
    }
  }
  const session = data?.session
  const athlete = data?.athlete

  const load = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      const json = await apiJson<DetailResponse>(`/api/sessions/${sessionId}/detail`, { cache: 'no-store' })
      setData(json)
      setNotesDraft(json.session.coach_notes ?? '')
      setNotesDirty(false)
    } catch (e: unknown) {
      setPageError(errorMessage(e, 'Could not open this session.'))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { if (sessionId) void load() }, [sessionId, load])

  const flash = (msg: string) => {
    setSavedFlash(msg)
    window.setTimeout(() => setSavedFlash(''), 2200)
  }

  const patchSession = async (updates: Record<string, unknown>, okMsg?: string) => {
    try {
      await apiMutate(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (okMsg) flash(okMsg)
      return true
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'That change did not save.'))
      return false
    }
  }

  const saveNotes = async () => {
    if (!session) return
    const ok = await patchSession({ coach_notes: notesDraft }, 'Notes saved')
    if (ok) {
      setNotesDirty(false)
      setData((d) => (d ? { ...d, session: { ...d.session, coach_notes: notesDraft } } : d))
    }
  }

  const setFocusPoints = async (points: FocusPoint[]): Promise<boolean> => {
    if (!session) return false
    const previous = session.focus_points
    setData((d) => (d ? { ...d, session: { ...d.session, focus_points: points } } : d))
    const ok = await patchSession({ focus_points: points })
    if (!ok) {
      setData((d) => (d ? { ...d, session: { ...d.session, focus_points: previous } } : d))
    }
    return ok
  }

  const [addingFocus, setAddingFocus] = useState(false)
  const addFocus = async () => {
    const text = newFocus.trim()
    if (!text || !session || addingFocus) return
    // The input is only cleared once the point has saved. It used to be
    // emptied before the PATCH, so a failed save (patchSession shows the
    // error) threw away what the coach had typed. The busy flag stops a second
    // tap adding the same point twice while the first is in flight.
    setAddingFocus(true)
    const ok = await setFocusPoints([...session.focus_points, text])
    setAddingFocus(false)
    // Only clear if the coach hasn't started typing something else meanwhile.
    if (ok) setNewFocus((cur) => (cur.trim() === text ? '' : cur))
  }

  const canGoBack = useSyncExternalStore(noSubscribe, previousPageIsInApp, () => false)

  const toggleShare = async () => {
    if (!session) return
    const next = !session.shared_with_athlete
    setData((d) => (d ? { ...d, session: { ...d.session, shared_with_athlete: next } } : d))
    const ok = await patchSession({ shared_with_athlete: next }, next ? 'Shared with athlete' : 'Set to private')
    if (!ok) setData((d) => (d ? { ...d, session: { ...d.session, shared_with_athlete: !next } } : d))
  }

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setActionError('Only images can be attached to a session.')
      return
    }
    setUploading(true)
    setActionError('')
    try {
      const { signedUrl, path } = await apiJson<{ signedUrl: string; path: string }>(
        `/api/sessions/${sessionId}/attachments?` +
        new URLSearchParams({ file_name: file.name, mime_type: file.type }),
      )
      const put = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      })
      if (!put.ok) throw new Error('The image could not be uploaded.')

      const { attachment } = await apiJson<{ attachment: AttachmentRow }>(
        `/api/sessions/${sessionId}/attachments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storage_path: path, file_name: file.name, mime_type: file.type }),
        },
      )
      setData((d) => (d ? { ...d, attachments: [...d.attachments, attachment] } : d))
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'The image could not be uploaded.'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const deleteAttachment = async (attachmentId: string) => {
    if (!confirm('Remove this image from the session?')) return
    try {
      await apiMutate(`/api/sessions/${sessionId}/attachments?attachment_id=${attachmentId}`, { method: 'DELETE' })
      setData((d) => (d ? { ...d, attachments: d.attachments.filter((a) => a.id !== attachmentId) } : d))
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not remove that image.'))
    }
  }

  // ── States ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '28px 20px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }} aria-busy="true">
          <div className="cv-skeleton" style={{ height: 13, width: 120, borderRadius: 6 }} />
          <div className="cv-skeleton" style={{ height: 34, width: '62%', borderRadius: 9, marginTop: 16 }} />
          <div className="cv-skeleton" style={{ height: 132, borderRadius: 'var(--radius)', marginTop: 22 }} />
          <div className="cv-skeleton" style={{ height: 92, borderRadius: 'var(--radius)', marginTop: 14 }} />
        </div>
      </div>
    )
  }

  if (pageError || !session) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ padding: 24, maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 8 }}>Session unavailable</div>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 16px', overflowWrap: 'anywhere' }}>
            {pageError || 'This session could not be opened.'}
          </p>
          <button className="btn btn-primary" onClick={() => router.back()} style={{ minHeight: 44 }}>Go back</button>
        </div>
      </div>
    )
  }

  const dateLabel = formatSessionDate(session, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const heading = session.session_name || session.title || 'Coaching session'
  const athleteName = athlete ? `${athlete.first_name} ${athlete.last_name}` : 'Athlete'
  const athleteFirst = athlete?.first_name?.trim() ?? ''
  const backHref = isCoach && athlete ? `/athletes/${athlete.id}` : '/athlete'

  /* The dateline: the day of the month is the one enormous number on this
     page, as a masthead's date is. Split out of the same session date the
     label above uses, so the two can never disagree. */
  const hasDate = sessionDate(session) !== null
  const dayNumeral = hasDate ? formatSessionDate(session, { day: 'numeric' }) : '—'
  const weekdayMonth = hasDate
    ? `${formatSessionDate(session, { weekday: 'short' })} ${formatSessionDate(session, { month: 'short' })}`
    : ''
  const year = hasDate ? formatSessionDate(session, { year: 'numeric' }) : ''
  const isoDate = sessionISODate(session) ?? undefined
  const recorded = Boolean(session.audio_url || session.transcript)
  const reply = isCoach ? responseOption(data!.session.athlete_response) : null
  const wordCount = session.transcript ? session.transcript.split(/\s+/).filter(Boolean).length : 0

  /** A hairline panel — the Stadium Night card. */
  const panel: React.CSSProperties = {
    background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16,
  }
  /** A secondary control in the same furniture voice as the section heads. */
  const toolButton: React.CSSProperties = {
    ...CAST, letterSpacing: '0.14em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 6, minHeight: 44, padding: '0 14px', borderRadius: 11, border: `1px solid ${LINE_2}`,
    background: PANEL, color: 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap',
  }

  return (
    <div style={{
      minHeight: '100vh', paddingBottom: 72,
      backgroundColor: 'var(--bg)', backgroundImage: STAGE_BACKGROUND, backgroundRepeat: 'no-repeat, no-repeat, repeat, repeat',
    }}>

      {actionError && (
        <div role="alert" style={{
          position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 2000, maxWidth: 520, margin: '0 auto',
          background: 'var(--danger)', color: 'var(--on-primary)', borderRadius: 12, padding: '4px 4px 4px 14px',
          display: 'flex', gap: 10, alignItems: 'center', fontSize: 'var(--t-body-tight)', fontWeight: 600,
          boxShadow: 'var(--shadow-lg)',
        }}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', padding: '8px 0' }}>{actionError}</span>
          <button onClick={() => setActionError('')} aria-label="Dismiss"
            style={{
              background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0,
              width: 44, height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      {savedFlash && (
        <div style={{
          position: 'fixed', top: 14, left: 0, right: 0, zIndex: 2000, display: 'flex', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{
            background: 'var(--text)', color: 'var(--bg)', fontSize: 'var(--t-furniture)', fontWeight: 600,
            padding: '7px 14px', borderRadius: 999, boxShadow: 'var(--shadow)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Icon name="check" size={12} /> {savedFlash}
          </span>
        </div>
      )}

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '18px 20px 0' }}>

        {/* ── Head: back, and the wordmark with the page's role under it ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href={backHref}
            onClick={(e) => {
              // A real back when the previous page is ours (see
              // previousPageIsInApp); the href stays as the fallback and for
              // open-in-new-tab.
              if (!canGoBack || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
              e.preventDefault()
              router.back()
            }}
            aria-label={canGoBack ? 'Back' : isCoach ? `Back to ${athleteName}` : 'Back to my portal'}
            style={{
              width: 44, height: 44, borderRadius: 13, flexShrink: 0, textDecoration: 'none',
              border: `1px solid ${LINE_2}`, background: PANEL, color: 'var(--text-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="back" size={16} />
          </Link>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...CAST, fontSize: 16, letterSpacing: '0.22em', lineHeight: 1, color: 'var(--text)' }}>CoachVoice</div>
            <div style={{ ...CAST, letterSpacing: '0.26em', lineHeight: 1, color: SAGE, marginTop: 4 }}>Session</div>
          </div>
        </div>

        {/* ── Ticker ──
            What this record is and who can see it. Wraps rather than clipping:
            a sport name is free text, and a ticker that cuts it off is dropping
            data to make a line fit. */}
        <div style={{
          ...CAST, fontWeight: 600, letterSpacing: '0.16em', color: 'var(--text-2)',
          marginTop: 14, padding: '9px 0', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`,
          display: 'flex', alignItems: 'center', gap: '6px 12px', flexWrap: 'wrap',
        }}>
          {session.sport_context && (
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{session.sport_context}</span>
          )}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, color: isCoach && !session.shared_with_athlete ? EMBER : SAGE }}>
            {isCoach && !session.shared_with_athlete
              ? <i aria-hidden style={{ width: 7, height: 7, background: EMBER, transform: 'skewX(-14deg)', flexShrink: 0 }} />
              : <i aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: SAGE, flexShrink: 0 }} />}
            {isCoach ? (session.shared_with_athlete ? 'Shared' : 'Private') : 'From your coach'}
          </span>
        </div>

        {/* ── Masthead ──
            The dateline band deliberately breaks the gutter: a skewed beam with
            an ember hairline, clipped by its own wrapper so it can never push
            the page sideways. */}
        <header style={{ position: 'relative', margin: '0 -20px', padding: '18px 20px 16px' }}>
          {/* The beam is a clip-path parallelogram rather than a skew
              transform: a skewed box pokes its corners out past its own
              bounds, and at the page edge that is a sideways scroll. The ember
              hairline is its left edge, drawn inside a 14px strip that ends
              before the gutter, so no glyph of the dateline ever sits on it —
              measured, a label crossing that line dropped to 4.0:1. */}
          <div aria-hidden style={{
            position: 'absolute', inset: '6px 0 4px 0',
            background: 'linear-gradient(100deg, color-mix(in srgb, var(--text) 5.5%, transparent), transparent 60%)',
            clipPath: 'polygon(14px 0, 100% 0, 100% 100%, 0 100%)',
          }} />
          <div aria-hidden style={{
            position: 'absolute', top: 6, bottom: 4, left: 0, width: 14,
            background: 'linear-gradient(to top right, transparent calc(50% - 0.75px), color-mix(in srgb, var(--coach-on-light) 45%, transparent) 50%, transparent calc(50% + 0.75px))',
          }} />
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
            <time dateTime={isoDate} style={{ display: 'block', paddingTop: 2 }}>
              <span className="sr-only">{dateLabel}</span>
              <span aria-hidden style={{
                display: 'block', fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 56, lineHeight: 0.8,
                letterSpacing: '-3px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums', marginLeft: -3,
              }}>{dayNumeral}</span>
              {weekdayMonth && (
                <span aria-hidden style={{ ...CAST, display: 'block', letterSpacing: '0.2em', color: 'var(--text-2)', marginTop: 10 }}>
                  {weekdayMonth}
                </span>
              )}
              {year && (
                <span aria-hidden style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', letterSpacing: '0.1em', color: 'var(--text-2)', marginTop: 3 }}>
                  {year}
                </span>
              )}
            </time>

            <div style={{ minWidth: 0 }}>
              <div style={{ ...CAST, letterSpacing: '0.26em', color: EMBER, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i aria-hidden style={{ width: 7, height: 7, background: EMBER, transform: 'skewX(-14deg)', flexShrink: 0 }} />
                {recorded ? 'Recorded session' : 'Session'}
              </div>
              <h1 style={{
                fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'clamp(26px, 7.4vw, 40px)',
                lineHeight: 1.02, letterSpacing: '0.02em', textTransform: 'uppercase',
                margin: '8px 0 0', color: 'var(--text)',
                // `text-wrap: balance` is CSS the React type definitions do not
                // know about yet. Widening the property is honest; `as any` on the
                // value silenced the whole style object.
                textWrap: 'balance' as React.CSSProperties['textWrap'],
                // `balance` chooses where to break between words; it will not break
                // inside one, and a session name is free text.
                overflowWrap: 'anywhere',
              }}>
                {heading}
              </h1>

              {isCoach && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px 10px', flexWrap: 'wrap', marginTop: 6 }}>
                  {athlete && (
                    <Link href={`/athletes/${athlete.id}`} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 9, textDecoration: 'none',
                      minHeight: 44, minWidth: 0, maxWidth: '100%', color: 'var(--text)',
                    }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', background: SAGE,
                        color: 'var(--on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 800,
                        letterSpacing: '0.04em', overflow: 'hidden', flexShrink: 0,
                      }}>
                        {athlete.photo_url
                          ? <img src={athlete.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : `${athlete.first_name[0] ?? ''}${athlete.last_name[0] ?? ''}`.toUpperCase()}
                      </span>
                      <span style={{
                        ...CAST, fontSize: 17, letterSpacing: '0.04em', color: 'var(--text)',
                        minWidth: 0, overflowWrap: 'anywhere',
                      }}>{athleteName}</span>
                    </Link>
                  )}

                  {/* The share toggle. The button is the 44px target; the chip
                      inside it is what is drawn. */}
                  <button
                    onClick={toggleShare}
                    aria-pressed={session.shared_with_athlete}
                    title={session.shared_with_athlete ? 'Visible to the athlete — tap to make private' : 'Private — tap to share with the athlete'}
                    style={{
                      minHeight: 44, padding: 0, background: 'none', border: 'none', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center',
                    }}
                  >
                    <span style={{
                      ...CAST, letterSpacing: '0.16em', padding: '5px 11px', borderRadius: 999,
                      color: session.shared_with_athlete ? SAGE : AMBER,
                      border: `1px solid color-mix(in srgb, ${session.shared_with_athlete ? SAGE : AMBER} 42%, transparent)`,
                      background: `color-mix(in srgb, ${session.shared_with_athlete ? SAGE : AMBER} 9%, transparent)`,
                    }}>
                      {session.shared_with_athlete ? 'Shared' : 'Private'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ── Recording ──
            A band with an ember hairline across its top — the coach's own voice. */}
        {session.audio_url && (
          <section aria-label="Recording" style={{
            ...panel, position: 'relative', overflow: 'hidden', borderRadius: 18, padding: '6px 14px 12px',
          }}>
            <div aria-hidden style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: `linear-gradient(90deg, ${EMBER} 0%, color-mix(in srgb, var(--coach-on-light) 15%, transparent) 62%, transparent 100%)`,
            }} />
            <SessionAudioPlayer
              sessionId={session.id}
              initialUrl={session.audio_url}
              mime={session.audio_mime}
            />
            <p style={{
              fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', margin: '10px 0 0', paddingTop: 9,
              borderTop: `1px solid ${LINE}`,
            }}>
              Streams on demand — nothing downloads until you press play.
            </p>
          </section>
        )}

        {/* ── Summary: the reason to open the page ── */}
        <Section label="Session summary">
          {session.summary ? (
            <SummaryFeature text={session.summary} />
          ) : (
            <div style={{ ...panel, padding: 15, fontSize: 'var(--t-body-tight)', color: 'var(--text-2)' }}>
              No summary was generated for this session.
            </div>
          )}
        </Section>

        {/* ── The athlete's answer ──
            The only thing in this product that travels from the athlete back
            to the coach. Placed directly under the focus points, because what
            it answers is the focus point: the coach said do this, and this is
            whether it landed.

            Two renders of one field. The athlete gets buttons; the coach gets
            a read-only badge, because a coach editing an athlete's answer
            would make the signal worthless. */}
        {!isCoach && (
          <Section label="Tell your coach">
            <div style={{ ...panel, padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {SESSION_RESPONSES.map((opt) => {
                  const on = response === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => void answer(opt.value)}
                      style={{
                        padding: '9px 15px', minHeight: 44, borderRadius: 999, maxWidth: '100%',
                        border: `1px solid ${on ? opt.color : LINE_2}`,
                        background: on ? opt.tint : PANEL,
                        color: on ? opt.color : 'var(--text-2)',
                        fontFamily: 'inherit',
                        fontSize: 'var(--fs-3)', fontWeight: on ? 800 : 600,
                        cursor: 'pointer', lineHeight: 1.2,
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 10, lineHeight: 1.5 }}>
                {response
                  ? 'Your coach can see this. Tap again to undo.'
                  : 'One tap. Your coach sees which one you picked, and nothing else.'}
              </div>
            </div>
          </Section>
        )}

        {reply && (
          <Section label="What they said back">
            <div style={{ ...panel, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px 12px', flexWrap: 'wrap' }}>
              <span style={{
                ...CAST, fontSize: 'var(--fs-3)', letterSpacing: '0.1em', textTransform: 'none',
                padding: '6px 13px', borderRadius: 999,
                background: reply.tint, color: reply.color,
                border: `1px solid color-mix(in srgb, ${reply.color} 40%, transparent)`,
              }}>
                {reply.coachLabel}
              </span>
              <span style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', minWidth: 0 }}>
                {athleteFirst || 'They'} answered
                {data!.session.athlete_responded_at
                  ? ` ${new Date(data!.session.athlete_responded_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                  : ''}
                {data!.session.athlete_response === 'not_clear'
                  ? ' — worth a word before the next session.'
                  : '.'}
              </span>
            </div>
          </Section>
        )}

        {/* ── How they came in ──
            The athlete's own check-in from the morning of this session, shown
            to the coach only. This is the first place in the app where wellness
            data and session data meet: until now the athlete answered five
            questions a day and the coach read them, if at all, on a separate
            graph on a separate page, never alongside the session they explain.

            Renders nothing when there is no check-in for that date. That is
            deliberate — a "did not check in" row would turn a coaching tool
            into a compliance report about a child. */}
        {isCoach && data!.checkin && (
          <Section label="How they came in">
            <div style={{ ...panel, padding: 12 }}>
              {/* A grid, not a `flex: 1` row.
                  Three `flex: 1` tiles have an automatic minimum of their
                  min-content, and at 13px furniture "SORENESS" plus the tile
                  padding is 85px — three of those plus the gaps is 2px wider
                  than a 320px screen allows, so the third tile was pushed into
                  the card's right padding and the row could not give. auto-fit
                  drops to two tiles on the narrowest phones and keeps three
                  from 375 up; every metric stays on screen either way. */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8,
              }}>
                {CHECKIN_METRICS.map(({ key, label }) => {
                  const score = data!.checkin![key]
                  return (
                    <div key={key} style={{
                      minWidth: 0, borderRadius: 11, padding: '9px 11px 10px',
                      background: metricTint(key, score),
                    }}>
                      {/* --text, not --text-2: on the good-state tint --text-2 measures
                          3.76:1. The tint carries the state; the label only has
                          to be read. */}
                      <div style={{ ...CAST, letterSpacing: '0.14em', color: 'var(--text)' }}>{label}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        <span style={{
                          fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, lineHeight: 1,
                          color: metricColor(key, score), fontVariantNumeric: 'tabular-nums',
                        }}>
                          {score ?? '—'}
                        </span>
                        {/* A partially filled check-in leaves a metric null.
                            The score already renders as an em dash, so the
                            label is suppressed rather than repeating it. */}
                        {score !== null && (
                          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: metricColor(key, score) }}>
                            {scoreLabel(key, score)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 10, overflowWrap: 'anywhere' }}>
                {athleteFirst ? `${athleteFirst}'s own check-in on ` : 'Their own check-in on '}
                {parseISODate(data!.checkin.check_date)?.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) ?? data!.checkin.check_date}
                . Only you can see this.
              </div>
            </div>
          </Section>
        )}

        {/* ── Focus points ──
            Hairline rows, numbered in amber: the one forward-looking line the
            product makes, in the order the coach set it. */}
        {(isCoach || session.focus_points.length > 0) && (
          <Section
            label="Take into next session"
            meta={session.focus_points.length > 0 ? session.focus_points.length : undefined}
          >
            <div>
              {session.focus_points.length === 0 && !isCoach && (
                <div style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-2)' }}>Nothing noted yet.</div>
              )}

              {session.focus_points.map((point, i) => (
                <div key={`${point}-${i}`} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0',
                  borderTop: `1px solid ${i === 0 ? LINE_2 : LINE}`,
                  borderBottom: i === session.focus_points.length - 1 ? `1px solid ${LINE}` : 'none',
                }}>
                  <span style={{
                    width: 18, flexShrink: 0, fontFamily: 'var(--font-cast)', fontWeight: 800, fontSize: 16,
                    lineHeight: 1.4, letterSpacing: '0.04em', color: AMBER,
                  }}>{i + 1}</span>
                  <span style={{
                    flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 'var(--t-body)', fontWeight: 500,
                    lineHeight: 1.5, color: 'var(--text)',
                  }}>{point}</span>
                  {isCoach && (
                    <button
                      onClick={() => setFocusPoints(session.focus_points.filter((_, j) => j !== i))}
                      aria-label="Remove point"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)',
                        width: 44, height: 44, flexShrink: 0, margin: '-10px 0',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              ))}

              {/* ── Keep it ──
                  Offered to the athlete only, and only when there is a point
                  to keep. The coach has the whole session; the athlete has one
                  sentence, and this is the only thing in the product they can
                  take out of it. The image carries no name and no link — see
                  FocusCard. */}
              {!isCoach && session.focus_points.length > 0 && (
                <div style={{ padding: '12px 0 2px' }}>
                  <FocusCard point={session.focus_points[0]} dateLabel={dateLabel} />
                </div>
              )}

              {isCoach && (
                <div style={{ display: 'flex', gap: 8, paddingTop: session.focus_points.length ? 12 : 0 }}>
                  <input
                    value={newFocus}
                    onChange={(e) => setNewFocus(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addFocus() } }}
                    placeholder="Something to work on next time…"
                    style={{
                      flex: 1, minWidth: 0, minHeight: 44, border: `1px solid ${LINE_2}`, borderRadius: 11,
                      padding: '8px 12px', font: 'inherit', fontSize: 16,
                      background: PANEL, color: 'var(--text)',
                    }}
                  />
                  <button onClick={() => void addFocus()} disabled={!newFocus.trim() || addingFocus}
                    style={{ ...toolButton, flexShrink: 0, opacity: newFocus.trim() && !addingFocus ? 1 : 0.5, cursor: newFocus.trim() && !addingFocus ? 'pointer' : 'not-allowed' }}>
                    <Icon name="plus" size={13} /> {addingFocus ? 'Adding…' : 'Add'}
                  </button>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── Coach notes ── */}
        {(isCoach || session.coach_notes) && (
          <Section
            label={isCoach ? 'Your notes' : 'Notes from your coach'}
            action={isCoach && notesDirty ? (
              <button className="btn btn-primary" onClick={saveNotes} style={{ minHeight: 44, padding: '0 16px', fontSize: 'var(--t-furniture)' }}>
                Save
              </button>
            ) : undefined}
          >
            {isCoach ? (
              <textarea
                value={notesDraft}
                onChange={(e) => { setNotesDraft(e.target.value); setNotesDirty(true) }}
                onBlur={() => { if (notesDirty) void saveNotes() }}
                placeholder="Anything worth remembering — context, what you tried, what to watch for."
                rows={4}
                style={{
                  display: 'block', width: '100%', border: `1px solid ${LINE_2}`, borderRadius: 16,
                  padding: '13px 15px', font: 'inherit', fontSize: 16, lineHeight: 1.6,
                  background: PANEL, color: 'var(--text)', resize: 'vertical', minHeight: 104,
                }}
              />
            ) : (
              <div style={{
                ...panel, padding: '13px 15px', fontFamily: 'var(--font-display)', fontSize: 17, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text)',
              }}>
                {session.coach_notes}
              </div>
            )}
          </Section>
        )}

        {/* ── Images ── */}
        {(isCoach || (data?.attachments.length ?? 0) > 0) && (
          <Section
            label="Images"
            meta={(data?.attachments.length ?? 0) > 0 ? data!.attachments.length : undefined}
            action={isCoach ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f) }}
                />
                <button disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  style={{ ...toolButton, cursor: uploading ? 'progress' : 'pointer' }}>
                  <Icon name="plus" size={12} /> {uploading ? 'Uploading…' : 'Add'}
                </button>
              </>
            ) : undefined}
          >
            {(data?.attachments.length ?? 0) === 0 ? (
              <div style={{ ...panel, padding: 14, fontSize: 'var(--t-body-tight)', color: 'var(--text-2)' }}>
                {isCoach
                  ? 'Add a whiteboard shot, a still from video, or a drill diagram.'
                  : 'No images for this session.'}
              </div>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 10,
              }}>
                {data!.attachments.map((a) => (
                  <figure key={a.id} style={{ ...panel, margin: 0, padding: 0, overflow: 'hidden', position: 'relative', minWidth: 0 }}>
                    {a.signedUrl && (
                      <a href={a.signedUrl} target="_blank" rel="noreferrer">
                        <img
                          src={a.signedUrl}
                          alt={a.caption ?? a.file_name ?? 'Session image'}
                          loading="lazy"
                          style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                        />
                      </a>
                    )}
                    {a.caption && (
                      <figcaption style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', padding: '8px 10px', overflowWrap: 'anywhere' }}>
                        {a.caption}
                      </figcaption>
                    )}
                    {isCoach && (
                      /* 44px target around a 28px disc. The disc is ink over
                         whatever the photo is, so the cross reads on a white
                         whiteboard shot and a dark gym alike. */
                      <button
                        onClick={() => deleteAttachment(a.id)}
                        aria-label="Remove image"
                        style={{
                          position: 'absolute', top: 0, right: 0, width: 44, height: 44, padding: 0,
                          background: 'none', border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <span style={{
                          width: 28, height: 28, borderRadius: '50%', color: 'var(--text)',
                          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
                          border: `1px solid ${LINE_2}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon name="x" size={12} />
                        </span>
                      </button>
                    )}
                  </figure>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Videos ── */}
        {(data?.videos.length ?? 0) > 0 && (
          <Section label="Video" meta={data!.videos.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data!.videos.map((v) => v.signedUrl && (
                <div key={v.id} style={{ ...panel, padding: 0, overflow: 'hidden' }}>
                  <video
                    controls
                    preload="none"
                    src={v.signedUrl}
                    style={{ width: '100%', display: 'block', background: 'color-mix(in srgb, var(--bg), black 35%)' }}
                  />
                  <div style={{ padding: '6px 6px 6px 13px', fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {v.file_name ?? 'Video'}
                    </span>
                    {isCoach && (
                      <span style={{
                        ...CAST, letterSpacing: '0.16em', padding: '4px 10px', borderRadius: 999, flexShrink: 0,
                        color: v.shared_with_athlete ? SAGE : AMBER,
                        border: `1px solid color-mix(in srgb, ${v.shared_with_athlete ? SAGE : AMBER} 42%, transparent)`,
                        background: `color-mix(in srgb, ${v.shared_with_athlete ? SAGE : AMBER} 9%, transparent)`,
                      }}>
                        {v.shared_with_athlete ? 'Shared' : 'Private'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Transcript, last: reference material, not the headline ──
            One hairline row, the way the mockup ends the page; it opens in place. */}
        {session.transcript && (
          <details style={{ marginTop: 26, borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
            <summary style={{
              ...CAST, letterSpacing: '0.2em', color: 'var(--text-2)', cursor: 'pointer',
              listStyle: 'none', display: 'flex', alignItems: 'center', gap: '4px 10px', flexWrap: 'wrap',
              minHeight: 48, padding: '6px 0',
            }}>
              <span style={{ flex: '1 1 auto' }}>Full transcript</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', letterSpacing: '0.06em', fontWeight: 500, textTransform: 'uppercase' }}>
                {wordCount} words
              </span>
              <span aria-hidden style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="back" size={14} /></span>
            </summary>
            <div style={{
              padding: '4px 0 16px',
              fontSize: 'var(--t-body-tight)', lineHeight: 1.75, color: 'var(--text-2)', whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}>
              {session.transcript}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
