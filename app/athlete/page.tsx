'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import Calendar, { type CalendarEvent } from '@/app/components/Calendar'
import VideoAnnotator from '@/app/components/VideoAnnotator'
import WellnessSubmit from '@/app/components/WellnessSubmit'
import ColdStartSplash, { markAppReady } from '@/app/components/ColdStartSplash'
import { getDailyQuote } from '@/lib/quotes'
import {
  WELLNESS_METRICS, metricColor,
  overallWellnessScore, overallScoreColor,
  type WellnessCheckin,
} from '@/lib/wellness-config'
import { fmtDate, fmtDateTime } from '@/lib/date-utils'
import SessionAudioPlayer from '@/app/components/SessionAudioPlayer'
import { apiMutate, apiJson } from '@/lib/api-client'
import { readCachedProfile, writeCachedProfile, displayName, clearCachedProfile } from '@/lib/profile-cache'
import { formatSessionDate } from '@/lib/session-date'
import { errorMessage } from '@/lib/errors'

type Tab = 'home' | 'sessions' | 'calendar' | 'notes' | 'messages' | 'wellness'

type WellnessRow = WellnessCheckin

type SessionRow = {
  id: string
  session_name: string | null
  title: string | null
  summary: string | null
  transcript: string | null
  focus_points?: string[] | null
  session_date?: string | null
  shared_with_athlete: boolean
  created_at: string | null
  sport_context: string | null
  audio_path?: string | null
  audio_mime?: string | null
}

type AthleteNote = {
  id: string
  session_id: string | null
  content: string
  note_type: 'typed' | 'voice'
  created_at: string
  updated_at: string
}

type SessionVideo = {
  id: string
  session_id: string
  storage_path: string
  file_name: string | null
  annotations: any[]
  created_at: string
  signedUrl: string | null
}

function AthleteIcon({ name, size = 20, strokeWidth = 2 }: { name: string; size?: number; strokeWidth?: number }) {
  const s: React.CSSProperties = { width: size, height: size, display: 'block', flexShrink: 0 }
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: s }
  switch (name) {
    case 'home':     return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    case 'book':     return <svg {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
    case 'calendar': return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    case 'messages': return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    case 'mic':      return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    case 'video':    return <svg {...p}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
    case 'pencil':   return <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    default:         return null
  }
}

/** Local date key (YYYY-MM-DD), matching what the API stores in check_date. */
function dateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA').format(d)
}

/**
 * The athlete's own fourteen days, and one sentence about them.
 *
 * This is the return half of the wellness loop. Until now the athlete gave the
 * app five numbers a day and got nothing back at all: "Trends →" led to a
 * blank form. That is the configuration the monitoring literature describes as
 * the one that fails — athletes stop answering honestly when they cannot see
 * the data being used — so this is not decoration on top of the alert, it is
 * the alert's data quality.
 *
 * Deliberately NOT WellnessGraph, which is mounted for the coach on the
 * athlete profile. That chart plots five ordinal series, two of them inverted,
 * as continuous lines in a 520x150 box. A coach with context can read it. A
 * fourteen-year-old cannot answer "so what do I do?" from it. One sentence
 * beats it.
 */
function WellnessHistory({ rows }: { rows: WellnessRow[] }) {
  const DAYS = 14

  const cells = useMemo(() => {
    const byDate = new Map(rows.map((r) => [r.check_date, r]))
    const out: { key: string; date: Date; row: WellnessRow | undefined }[] = []
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date()
      d.setHours(12, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const key = dateKey(d)
      out.push({ key, date: d, row: byDate.get(key) })
    }
    return out
  }, [rows])

  const sentence = useMemo(() => {
    const present = cells.filter((c) => c.row)
    // Below this there is not enough to say anything true about a trend.
    if (present.length < 5) {
      return { text: 'Keep checking in — after a week we can show you what is changing.', tone: 'quiet' as const }
    }

    // Only energy and sleep are eligible to be named.
    //
    // `mood` and `stress` are excluded on purpose: telling an unaccompanied
    // teenager that their mood is their worst number and falling is a clinical
    // statement, and the channel for that already exists and has an adult on
    // the other end (the coach alert, and the caretaker email). They still
    // count toward the dots and toward the coach's alert — they are just not
    // narrated back to the child.
    //
    // `soreness` is included. It was held out while WELLNESS_METRICS marked it
    // `inverted` and every scoring function computed `6 - raw` against a hint
    // that said the opposite — a sentence built on that would have told an
    // athlete the reverse of the truth. That flag was wrong and is gone, so a
    // raw score now means what the athlete was asked, and 5 is the good end of
    // all three of these.
    const ELIGIBLE = ['energy', 'sleep_q', 'soreness'] as const

    const meanOf = (subset: typeof cells, key: (typeof ELIGIBLE)[number]) => {
      const vals = subset
        .map((c) => c.row?.[key])
        .filter((v): v is number => typeof v === 'number')
      return vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }

    const recent = cells.slice(7)
    const prior = cells.slice(0, 7)

    let worst: { key: (typeof ELIGIBLE)[number]; now: number; was: number; drop: number } | null = null
    let compared = false
    for (const key of ELIGIBLE) {
      const now = meanOf(recent, key)
      const was = meanOf(prior, key)
      if (now === null || was === null) continue
      compared = true
      const drop = was - now
      if (drop >= 0.75 && (!worst || drop > worst.drop)) worst = { key, now, was, drop }
    }

    // Five check-ins is enough to be worth saying something, but they can all
    // sit in the same week — in which case there is no previous week to
    // compare against and "nothing much has moved" would be an assertion we
    // have not earned. Say the true thing instead.
    if (!compared) {
      return { text: 'A few more days and we can show you what is changing week to week.', tone: 'quiet' as const }
    }
    if (!worst) {
      return { text: 'Nothing much has moved this week. That is usually a good sign.', tone: 'quiet' as const }
    }
    const label = WELLNESS_METRICS.find((m) => m.key === worst.key)?.label ?? worst.key
    return {
      text: `${label} is your biggest drop this week — averaging ${worst.now.toFixed(1)} out of 5, down from ${worst.was.toFixed(1)} the week before.`,
      tone: 'flag' as const,
    }
  }, [cells])

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 11 }}>
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
          Your check-ins
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)' }}>Last 14 days</span>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {cells.map((c, i) => {
          const score = overallWellnessScore(c.row ?? null)
          const isToday = i === cells.length - 1
          return (
            <div key={c.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                title={`${c.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${c.row ? '' : ' — no check-in'}`}
                style={{
                  width: '100%', height: 26, borderRadius: 5,
                  background: c.row ? overallScoreColor(score) : 'transparent',
                  border: c.row ? 'none' : '1.5px dashed var(--border)',
                  boxShadow: isToday ? '0 0 0 2px var(--bg), 0 0 0 3.5px var(--text-2)' : 'none',
                }}
              />
            </div>
          )
        })}
      </div>

      <div style={{
        fontSize: 'var(--fs-3)',
        lineHeight: 1.5,
        fontWeight: sentence.tone === 'flag' ? 600 : 500,
        color: sentence.tone === 'flag' ? 'var(--text)' : 'var(--text-2)',
      }}>
        {sentence.text}
      </div>
    </div>
  )
}

export default function AthletePage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const [tab, setTab] = useState<Tab>('home')
  const mainRef = useRef<HTMLElement>(null)

  // Scroll to top whenever tab changes
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [tab])

  const [loading, setLoading] = useState(true)
  // Seeded from cache so the athlete's own name doesn't flash blank on every
  // tab change or return to the portal.
  const [athleteName, setAthleteName] = useState(() => { const c = readCachedProfile(); return c ? displayName(c) : '' })
  const [athleteId, setAthleteId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null)
  const [todayWellness, setTodayWellness] = useState<WellnessRow | null>(null)
  const [wellnessHistory, setWellnessHistory] = useState<WellnessRow[]>([])
  const [sport, setSport] = useState(() => readCachedProfile()?.sport ?? '')
  const [error, setError] = useState('')
  // Failures from actions that used to fail silently (RSVP, deletes, annotation
  // saves). Separate from `error`, which is a fatal load failure for the page.
  const [actionError, setActionError] = useState('')

  // Sessions
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [openSession, setOpenSession] = useState<string | null>(null)

  // Notes
  const [notes, setNotes] = useState<AthleteNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [noteFilter, setNoteFilter] = useState<string | null>(null) // session_id or null for all
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteEditId, setNoteEditId] = useState<string | null>(null)
  const [noteEditText, setNoteEditText] = useState('')
  const [noteRecording, setNoteRecording] = useState(false)
  const [noteTranscribing, setNoteTranscribing] = useState(false)
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const noteChunksRef = useRef<BlobPart[]>([])

  // Calendar
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [calLoading, setCalLoading] = useState(false)
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [addEventModal, setAddEventModal] = useState<string | null>(null) // date string
  const [eventForm, setEventForm] = useState({ title: '', description: '', event_type: 'reminder', event_time: '' })
  const [eventSaving, setEventSaving] = useState(false)
  const [calSaveMsg, setCalSaveMsg] = useState('')

  // Videos
  const [sessionVideos, setSessionVideos] = useState<Record<string, SessionVideo[]>>({})

  // Messaging (athlete → coach)
  const [messages, setMessages] = useState<any[]>([])
  const [msgText, setMsgText] = useState('')
  const [msgSending, setMsgSending] = useState(false)
  const [msgLoading, setMsgLoading] = useState(false)
  const msgBottomRef = useRef<HTMLDivElement>(null)
  const msgFileInputRef = useRef<HTMLInputElement>(null)

  // RSVP
  const [rsvpMap, setRsvpMap] = useState<Record<string, string>>({}) // event_id → status
  const [rsvpEvents, setRsvpEvents] = useState<any[]>([])

  // Join coach by code
  const [joinCode, setJoinCode] = useState('')
  const [joinMsg, setJoinMsg] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)

  // ── Boot ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/'); return }
        if (cancelled) return

        setUserId(user.id)
        const onboardKey = `cv_onboarded_${user.id}`
        setHasOnboarded(localStorage.getItem(onboardKey) === 'true')

        // Fetch profile + athlete record first — the sessions query needs the
        // athlete's own id so it can't leak or miss rows if it ever runs
        // outside the intended RLS scope.
        const [{ data: profile }, { data: athRecord }] = await Promise.all([
          supabase.from('profiles').select('role, first_name, last_name, sport').eq('id', user.id).single(),
          supabase.from('athletes').select('id, first_name, last_name').eq('athlete_user_id', user.id).maybeSingle(),
        ])

        if (cancelled) return

        if (profile?.role === 'coach') { router.push('/dashboard'); return }

        setSport(profile?.sport ?? '')

        const [{ data: sessData }, notesRes] = await Promise.all([
          athRecord
            ? supabase.from('sessions')
                .select('id, session_name, title, summary, transcript, focus_points, shared_with_athlete, session_date, created_at, sport_context, audio_path, audio_mime')
                .eq('athlete_id', athRecord.id)
                .eq('shared_with_athlete', true)
                // By when the session happened, not when the row was written —
                // matching the coach side. Ordering by created_at alone put a
                // backdated session at the top of the athlete's list as though
                // it had happened tonight.
                .order('session_date', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [] as SessionRow[] }),
          fetch('/api/athlete-notes', { cache: 'no-store' }),
        ])

        if (cancelled) return

        if (athRecord) {
          setAthleteId(athRecord.id)
          const first = profile?.first_name ?? athRecord.first_name ?? ''
          const last = profile?.last_name ?? athRecord.last_name ?? ''
          setAthleteName(`${first} ${last}`.trim() || (user.email ?? 'Athlete'))
          writeCachedProfile({
            userId: user.id,
            role: 'athlete',
            firstName: first,
            lastName: last,
            sport: profile?.sport ?? '',
            email: user.email ?? '',
          })
          // Mark this athlete as ACTIVE on their first portal visit
          fetch('/api/athlete/activate', { method: 'POST' }).catch(() => {})
        } else {
          const first = profile?.first_name ?? ''
          const last = profile?.last_name ?? ''
          setAthleteName(`${first} ${last}`.trim() || (user.email ?? 'Athlete'))
          setError('no-athlete-record')
        }

        setSessions((sessData ?? []) as SessionRow[])

        const notesJson = await notesRes.json().catch(() => ({}))
        if (!cancelled) setNotes(notesJson.notes ?? [])

      } catch (e: unknown) {
        if (!cancelled) setError(errorMessage(e, 'Failed to load'))
      } finally {
        if (!cancelled) setLoading(false)
        markAppReady()
      }
    }
    void load()
    return () => { cancelled = true }
  }, [router, supabase])

  // ── Calendar ──────────────────────────────────────────────
  const fetchCalendar = useCallback(async (month: string) => {
    setCalLoading(true)
    try {
      const res = await fetch(`/api/calendar?month=${month}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setCalEvents(json.events ?? [])
    } finally {
      setCalLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'calendar' && athleteId) fetchCalendar(calMonth)
  }, [tab, athleteId, calMonth, fetchCalendar])

  // ── The athlete's own wellness history ────────────────────
  //
  // This used to fetch `days=1` and keep only today's row, which is why the
  // athlete could give this app five numbers a day and never be shown one
  // back. Three weeks is enough for a 14-day strip plus the previous week to
  // compare against, and the API has always allowed it — the RLS policy is
  // scoped to the athlete's own rows, so this is their data, not a new
  // permission.
  //
  // It also used a raw `fetch().then(r => r.json())` with no `res.ok` check:
  // CLAUDE.md checklist item 1, the bug class where a non-2xx silently becomes
  // empty data and the UI reports it as "no check-ins yet".
  const loadWellness = useCallback(async () => {
    if (!athleteId) return
    try {
      const j = await apiJson<{ checkins?: WellnessRow[] }>(
        `/api/wellness?athlete_id=${athleteId}&days=21`,
      )
      const rows = j.checkins ?? []
      const today = new Intl.DateTimeFormat('en-CA').format(new Date())
      setWellnessHistory(rows)
      setTodayWellness(rows.find((c) => c.check_date === today) ?? null)
    } catch {
      // Non-fatal: the card falls back to its "check in" state.
    }
  }, [athleteId])

  useEffect(() => { void loadWellness() }, [loadWellness])

  // ── Load messages ─────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'messages' || !athleteId) return
    setMsgLoading(true)
    fetch(`/api/messages?athlete_id=${athleteId}`)
      .then((r) => r.json())
      .then((j) => setMessages(j.messages ?? []))
      .finally(() => setMsgLoading(false))
  }, [tab, athleteId])

  useEffect(() => {
    msgBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Load RSVP events ──────────────────────────────────────
  useEffect(() => {
    if (tab !== 'calendar' || !athleteId) return
    // Load upcoming coach events with rsvp_enabled for this athlete
    fetch(`/api/calendar?month=${calMonth}`)
      .then((r) => r.json())
      .then((j) => {
        const coachEvents = (j.events ?? []).filter((e: any) => e.created_by_role === 'coach' && e.rsvp_enabled)
        setRsvpEvents(coachEvents)
      })
  }, [tab, athleteId, calMonth])

  const sendMessage = async () => {
    if (!athleteId || !msgText.trim() || msgSending) return
    setMsgSending(true)
    const content = msgText.trim()
    setMsgText('')
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId, content, msg_type: 'text' }),
      })
      const j = await res.json()
      if (res.ok && j.message) setMessages((prev) => [...prev, j.message])
    } finally {
      setMsgSending(false)
    }
  }

  const sendRsvp = async (eventId: string, status: string) => {
    if (!athleteId) return
    try {
      await apiMutate('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, athlete_id: athleteId, status }),
      })
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not send your reply — your coach did not get it.'))
      return
    }
    setRsvpMap((prev) => ({ ...prev, [eventId]: status }))
  }

  const uploadMsgMedia = async (file: File) => {
    if (!athleteId) return
    const msgType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio'
    const ext = file.name.split('.').pop() ?? 'bin'
    const path = `athlete/${athleteId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('messages-media').upload(path, file)
    if (error) { alert('Upload failed: ' + error.message); return }
    const { data: signedData, error: signErr } = await supabase.storage.from('messages-media').createSignedUrl(path, 3600)
    if (signErr || !signedData?.signedUrl) { alert('Could not get media URL'); return }
    const mediaUrl = signedData.signedUrl
    const res = await fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athlete_id: athleteId, content: null, msg_type: msgType, media_url: mediaUrl, media_name: file.name }),
    })
    const j = await res.json()
    if (res.ok && j.message) setMessages((prev) => [...prev, j.message])
  }

  // ── Session videos ────────────────────────────────────────
  const loadVideos = async (sessionId: string) => {
    if (sessionVideos[sessionId]) return
    try {
      // apiJson, not raw fetch: on a non-2xx this used to fall through to
      // `json.videos ?? []` and render "no videos" for a session that has
      // them. Checklist item 1 — a failure that looks like an empty result is
      // worse than one that looks like a failure.
      const json = await apiJson<{ videos?: SessionVideo[] }>(
        `/api/sessions/${sessionId}/videos`, { cache: 'no-store' },
      )
      setSessionVideos((prev) => ({ ...prev, [sessionId]: json.videos ?? [] }))
    } catch {
      // Left non-fatal deliberately: videos are an enhancement to the session
      // card, and the card is still useful without them.
    }
  }

  const openSessionToggle = (id: string) => {
    if (openSession === id) { setOpenSession(null); return }
    setOpenSession(id)
    loadVideos(id)
  }

  // ── Notes ─────────────────────────────────────────────────
  const saveNote = async (sessionId: string | null = null) => {
    if (!noteText.trim()) return
    setNoteSaving(true)
    try {
      const res = await fetch('/api/athlete-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteText.trim(), session_id: sessionId, note_type: 'typed' }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setNotes((prev) => [...prev, json.note])
        setNoteText('')
      }
    } finally {
      setNoteSaving(false)
    }
  }

  const updateNote = async (id: string) => {
    if (!noteEditText.trim()) return
    const res = await fetch('/api/athlete-notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, content: noteEditText.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setNotes((prev) => prev.map((n) => n.id === id ? { ...n, content: json.note.content } : n))
      setNoteEditId(null)
    }
  }

  const deleteNote = async (id: string) => {
    try {
      await apiMutate(`/api/athlete-notes?id=${id}`, { method: 'DELETE' })
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not delete that note'))
      return
    }
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  // Voice note recording
  const startNoteRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // mp4/AAC first: iOS Safari cannot decode WebM at all, so a WebM recording
    // made in Chrome played back as an endless spinner on an iPhone. Every
    // browser that can play WebM can also play mp4, so preferring it makes a
    // recording playable everywhere. isTypeSupported still guards the choice,
    // and WebM stays as the fallback for browsers that can't record mp4.
    const supported = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
      const mimeType = supported.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 })
      mediaRecRef.current = recorder
      noteChunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) noteChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(noteChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        setNoteTranscribing(true)
        try {
          const fd = new FormData()
          const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
          fd.append('file', new File([blob], `note.${ext}`, { type: blob.type }))
          if (sport) fd.append('sport', sport)
          const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
          const json = await res.json().catch(() => ({}))
          if (res.ok && json.text) {
            const savedRes = await fetch('/api/athlete-notes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: json.text, session_id: noteFilter, note_type: 'voice' }),
            })
            const savedJson = await savedRes.json().catch(() => ({}))
            if (savedRes.ok) setNotes((prev) => [...prev, savedJson.note])
          }
        } finally {
          setNoteTranscribing(false)
        }
      }
      recorder.start()
      setNoteRecording(true)
    } catch {}
  }

  const stopNoteRecording = () => {
    mediaRecRef.current?.stop()
    setNoteRecording(false)
  }

  // ── Calendar event ─────────────────────────────────────────
  const saveCalendarEvent = async () => {
    if (!addEventModal || !eventForm.title.trim()) return
    if (!athleteId) {
      setCalSaveMsg('You need to join a coach before adding calendar events.')
      return
    }
    setEventSaving(true)
    setCalSaveMsg('')
    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          title: eventForm.title,
          description: eventForm.description || null,
          event_type: eventForm.event_type,
          event_date: addEventModal,
          event_time: eventForm.event_time || null,
        }),
      })
      if (res.ok) {
        setAddEventModal(null)
        setEventForm({ title: '', description: '', event_type: 'reminder', event_time: '' })
        setCalSaveMsg('Event added!')
        setTimeout(() => setCalSaveMsg(''), 3000)
        // Refetch from DB so the calendar grid updates immediately
        await fetchCalendar(calMonth)
      } else {
        const json = await res.json().catch(() => ({}))
        setCalSaveMsg(json?.error ?? 'Failed to save event')
      }
    } catch {
      setCalSaveMsg('Failed to save event')
    } finally {
      setEventSaving(false)
    }
  }

  const deleteCalEvent = async (id: string) => {
    try {
      await apiMutate(`/api/calendar?id=${id}`, { method: 'DELETE' })
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not delete that event'))
      return
    }
    setCalEvents((prev) => prev.filter((e) => e.id !== id))
  }

  // ── Join coach ─────────────────────────────────────────────
  const joinCoach = async () => {
    if (!joinCode.trim()) return
    setJoinLoading(true)
    setJoinMsg('')
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: joinCode.trim().toLowerCase() }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setJoinMsg('Successfully joined your coach\'s database! Refresh to see your sessions.')
        setAthleteId(json.athleteId)
        setError('')
      } else {
        setJoinMsg(json?.error ?? 'Failed to join')
      }
    } finally {
      setJoinLoading(false)
    }
  }

  const logout = async () => {
    clearCachedProfile()
    await supabase.auth.signOut()
    router.push('/')
  }

  // ── Derived data ──────────────────────────────────────────
  const filteredNotes = noteFilter ? notes.filter((n) => n.session_id === noteFilter) : notes

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading your portal…</div>
      </div>
    )
  }

  // ── First-login onboarding ─────────────────────────────────
  if (hasOnboarded === false && sessions.length === 0) {
    const onboardFirstName = athleteName.split(' ')[0] || 'Athlete'
    const onboardDate = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()
    const dismissOnboarding = () => {
      if (userId) localStorage.setItem(`cv_onboarded_${userId}`, 'true')
      setHasOnboarded(true)
    }
    return (
      <div className="bg-grain" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontFamily: 'monospace' }}>{onboardDate}</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 34, letterSpacing: -0.8, lineHeight: 1.1, color: 'var(--text)' }}>
              Welcome to CoachVoice,<br/>
              <span style={{ fontStyle: 'italic', fontWeight: 500 }}>{onboardFirstName}.</span>
            </h1>
            <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 340 }}>
              Your coach has set up your training profile. Here&apos;s how to get started.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
            {[
              { icon: '🏃', title: 'Check in daily', desc: 'Your coach tracks your energy, mood, sleep, soreness and stress. Takes 10 seconds.' },
              { icon: '📋', title: 'View your sessions', desc: 'After each session, your coach will share notes and feedback here.' },
              { icon: '💬', title: 'Message your coach', desc: "Ask questions, share how you're feeling, stay connected." },
            ].map((step, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{step.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>{step.title}</div>
                  <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.55 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <button
            className="btn btn-primary btn-lg"
            style={{ width: '100%', fontSize: 'var(--fs-4)', padding: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={dismissOnboarding}
          >
            Let&apos;s go →
          </button>
        </div>
        <ColdStartSplash />
      </div>
    )
  }

  return (
    <div className="bg-grain" style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Shows only on a genuinely cold launch, over the page while it loads.
          Any touch dismisses it; it never delays anything. */}
      <ColdStartSplash />

      {/* Action failure banner */}
      {actionError && (
        <div
          role="alert"
          style={{
            position: 'fixed', left: 12, right: 12, bottom: 78, zIndex: 2000,
            maxWidth: 520, margin: '0 auto',
            background: 'var(--coach-color)', color: '#fff',
            borderRadius: 12, padding: '12px 14px',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            boxShadow: '0 6px 24px rgba(0,0,0,0.18)', fontSize: 'var(--fs-3)', lineHeight: 1.5,
          }}
        >
          <span style={{ flex: 1 }}>{actionError}</span>
          <button
            onClick={() => setActionError('')}
            aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-4)', lineHeight: 1, padding: 0, flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(251,248,243,0.94)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: 'var(--primary)', color: '#fff', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {(athleteName.split(' ')[0]?.[0] ?? 'A').toUpperCase()}{(athleteName.split(' ')[1]?.[0] ?? '').toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
                {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
              </div>
              <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text)', marginTop: 1 }}>
                {athleteName || 'Athlete'}{sport ? ` · ${sport}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Had no onClick at all, under a dot conditioned on
                sessions.length > 0 — an unread badge that meant "you have a
                session" and stayed lit forever. There is no athlete-side unread
                source: /api/messages/unread filters sender_role = 'athlete'
                against the caller's coach_id, so it is coach-only by
                construction. Button wired up, dot removed. */}
            <button onClick={() => setTab('messages')} aria-label="Messages" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--card)', border: '1px solid var(--border)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', cursor: 'pointer' }}>
              <AthleteIcon name="messages" size={15} strokeWidth={1.8} />
            </button>
            <button onClick={logout} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', cursor: 'pointer', fontSize: 'var(--fs-1)', fontWeight: 600 }}>
              Out
            </button>
          </div>
        </div>
      </header>

      <main ref={mainRef} style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '16px' : '28px 20px', overflowY: 'auto', paddingBottom: isMobile ? 'max(100px, calc(80px + env(safe-area-inset-bottom)))' : undefined }}>
        {/* No athlete record — show join form */}
        {error === 'no-athlete-record' && (
          // Was a saturated amber gradient from the retired palette.
          <div style={{ background: 'var(--warning-light)', border: '1px solid var(--warning-border)', borderRadius: 14, padding: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'var(--fs-5)', marginBottom: 6, color: 'var(--text)' }}>
              Connect to your coach
            </div>
            <p style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Your account isn&rsquo;t linked to a coach yet. Enter the invite code they gave you to get started.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                className="input"
                placeholder="Coach invite code (e.g. smithjohn4821)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toLowerCase().trim())}
                style={{ maxWidth: 280, fontFamily: 'monospace', fontWeight: 700 }}
              />
              <button className="btn btn-energy" onClick={joinCoach} disabled={joinLoading || !joinCode.trim()}>
                {joinLoading ? 'Joining…' : 'Join Team →'}
              </button>
            </div>
            {joinMsg && <p style={{ marginTop: 10, fontSize: 'var(--fs-3)', color: joinMsg.includes('Success') ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{joinMsg}</p>}
          </div>
        )}

        {/* Tabs (desktop only — mobile uses bottom nav) */}
        {!isMobile && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
            {([
              { key: 'home',     label: 'Home'     },
              { key: 'sessions', label: 'Sessions' },
              { key: 'messages', label: 'Messages' },
              { key: 'wellness', label: 'Wellness' },
              { key: 'calendar', label: 'Calendar' },
              { key: 'notes',    label: 'My Notes' },
            ] as { key: Tab; label: string }[]).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  border: tab === t.key ? 'none' : '1px solid var(--border)',
                  background: tab === t.key
                    ? 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)'
                    : 'var(--card)',
                  color: tab === t.key ? '#fff' : 'var(--text-2)',
                  fontWeight: tab === t.key ? 800 : 600,
                  fontSize: 'var(--fs-3)',
                  cursor: 'pointer',
                  transition: 'all 0.18s cubic-bezier(.34,1.56,.64,1)',
                  boxShadow: tab === t.key ? '0 3px 12px rgb(111 142 107 / .30)' : 'var(--shadow-sm)',
                  display: 'flex', alignItems: 'center', gap: 5,
                  transform: tab === t.key ? 'scale(1.02)' : 'scale(1)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* ─── Tab: Home ─── */}
        {tab === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

            {/* ── Greeting ── */}
            <div>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'var(--fs-6)', letterSpacing: -0.8, lineHeight: 1.05, color: 'var(--text)' }}>
                Welcome back,<br/>
                <span style={{ fontStyle: 'italic', fontWeight: 500 }}>{athleteName.split(' ')[0] || 'Athlete'}.</span>
              </h1>
              <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-2)', color: 'var(--text-2)', lineHeight: 1.5 }}>
                {sessions.length === 0
                  ? 'Nothing from your coach yet.'
                  : `${sessions.length} session${sessions.length !== 1 ? 's' : ''} from your coach`}
              </p>
            </div>

            {/* ── Today's check-in: the one thing to do here each day ──
                Was a gradient panel with emoji tiles. Now a single card using
                the same metric colours and bars as the coach's view, so a score
                means the same thing on both sides of the app. */}
            {athleteId && (
              <div className="card" style={{ padding: 16 }}>
                {todayWellness ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 13 }}>
                      <span style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--primary-dark)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                        Checked in today
                      </span>
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setTab('wellness')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 'var(--fs-1)', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                        Trends →
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                      {WELLNESS_METRICS.map(({ key, label }) => {
                        const score = todayWellness[key] as number | null
                        const pct = score ? (score / 5) * 100 : 0
                        return (
                          <div key={key}>
                            <div style={{ height: 4, background: 'var(--border-soft)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: metricColor(key, score), borderRadius: 2 }} />
                            </div>
                            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)', marginTop: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {label}
                            </div>
                            <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--text)', marginTop: 1 }}>{score ?? '—'}</div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--primary-dark)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                        Daily check-in
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)' }}>
                        {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-5)', fontWeight: 400, color: 'var(--text)', marginBottom: 13, letterSpacing: '-0.01em' }}>
                      How are you feeling today?
                    </div>
                    <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '11px' }} onClick={() => setTab('wellness')}>
                      Check in
                    </button>
                    <div style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)', marginTop: 9, textAlign: 'center' }}>
                      {/* Was: "Your coach sees the scores, not who said what to
                          whom." That sentence describes messaging, not
                          wellness — and it was the only thing a 13-year-old
                          was told about where their health data goes. What
                          actually happens, verified in
                          app/api/wellness/route.ts:92-105: the coach can read
                          every score, and a low run emails them automatically. */}
                      Takes about twenty seconds. Your coach can see these scores, and if they stay low your coach gets an email.
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── From your coach ──
                Previously one session in a decorated card, with the rest hidden
                behind a tab. This is the reason the app exists, so it gets a
                real list — and each row opens the full session. */}
            {sessions.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
                  <div style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                    From your coach
                  </div>
                  {sessions.length > 3 && (
                    <button onClick={() => setTab('sessions')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 'var(--fs-1)', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                      All {sessions.length} →
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sessions.slice(0, 3).map((s, i) => (
                    <a
                      key={s.id}
                      href={`/sessions/${s.id}`}
                      className="card"
                      style={{ padding: '13px 15px', textDecoration: 'none', color: 'inherit', display: 'block', position: 'relative' }}
                    >
                      {/* The newest one is the only thing marked — an unread-ish
                          cue that doesn't need its own panel. */}
                      {i === 0 && (
                        <span style={{ position: 'absolute', top: 13, right: 15, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--coach-color)' }} />
                          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--coach-color)', letterSpacing: '0.1em' }}>NEWEST</span>
                        </span>
                      )}
                      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {formatSessionDate(s)}
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-4)', fontWeight: 500, color: 'var(--text)', lineHeight: 1.3, marginTop: 3, paddingRight: i === 0 ? 62 : 0 }}>
                        {s.session_name ?? s.title ?? 'Coaching session'}
                      </div>
                      {s.summary && (
                        // Deliberately not in quotation marks: this is the model's
                        // summary of the recording, not words the coach said.
                        <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.55, marginTop: 6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {s.summary.replace(/^[•\s]+/, '')}
                        </div>
                      )}

                      {/* The one thing to work on next, on the newest session
                          only. Everything else here recaps what happened; this
                          is the only line that says what to do about it, so it
                          belongs where the athlete already looks rather than a
                          tap deeper. */}
                      {i === 0 && (() => {
                        const points = s.focus_points
                        const next = Array.isArray(points) && typeof points[0] === 'string' && points[0].trim()
                          ? points[0].trim()
                          : null
                        if (!next) return null
                        return (
                          <div style={{ marginTop: 9, padding: '9px 11px', background: 'var(--coach-light)', border: '1px solid var(--coach-border)', borderRadius: 9 }}>
                            <div style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--coach-on-light)', letterSpacing: '0.11em', textTransform: 'uppercase', marginBottom: 3 }}>
                              Take into next session
                            </div>
                            <div style={{ fontSize: 'var(--fs-3)', fontWeight: 600, color: 'var(--text)', lineHeight: 1.45 }}>
                              {next}
                            </div>
                          </div>
                        )
                      })()}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 9, fontSize: 'var(--fs-1)', fontWeight: 700, color: 'var(--primary-dark)' }}>
                        {s.audio_path && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--coach-color)', marginRight: 4 }}>
                            <AthleteIcon name="mic" size={10} strokeWidth={2.4} />
                            <span style={{ fontSize: 'var(--fs-1)', fontWeight: 800, letterSpacing: '0.06em' }}>AUDIO</span>
                          </span>
                        )}
                        Read session →
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* ── Private notes ── */}
            <button onClick={() => setTab('notes')} style={{ width: '100%', padding: '12px 14px', background: 'transparent', borderRadius: 12, border: '1.5px dashed var(--border)', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', fontSize: 'var(--fs-2)', fontWeight: 600, cursor: 'pointer' }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', flexShrink: 0 }}>
                <AthleteIcon name="pencil" size={12} strokeWidth={2} />
              </div>
              <span style={{ flex: 1, textAlign: 'left' }}>
                Add a private note
                {notes.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · {notes.length} saved</span>}
              </span>
              <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: 'var(--coach-color)', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <AthleteIcon name="mic" size={10} strokeWidth={2.4} /> VOICE
              </span>
            </button>

          </div>
        )}

        {/* ─── Tab: Sessions ─── */}
        {tab === 'sessions' && (
          <div>
            {/* The newest session used to be repeated in a hero card directly
                above the list that starts with it. Home surfaces what's new;
                this tab is the full record, so it's just the record. */}
            {sessions.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
                <div style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                  From your coach
                </div>
                <div style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}

            {sessions.length === 0 ? (
              <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                <div style={{ color: 'var(--text-muted)', display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <AthleteIcon name="book" size={30} strokeWidth={1.5} />
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>
                  No sessions yet
                </div>
                <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-3)', maxWidth: 290, margin: '0 auto', lineHeight: 1.6 }}>
                  After a training session your coach records their notes here. You&rsquo;ll see the summary, and can play back what they said.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sessions.map((s) => {
                  const isOpen = openSession === s.id
                  const sNotes = notes.filter((n) => n.session_id === s.id)
                  const sVideos = sessionVideos[s.id] ?? []

                  return (
                    <div key={s.id} className="card" style={{ overflow: 'hidden' }}>
                      {/* Session header */}
                      <button
                        onClick={() => openSessionToggle(s.id)}
                        style={{
                          width: '100%',
                          padding: '16px 20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          {/* Was an emoji microphone in a gradient tile. The
                              coach side uses drawn icons throughout; matching
                              that keeps one visual language across both. */}
                          <div style={{ width: 40, height: 40, borderRadius: 11, background: isOpen ? 'var(--primary)' : 'var(--athlete-light)', color: isOpen ? 'var(--bg)' : 'var(--primary-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.18s ease' }}>
                            <AthleteIcon name="mic" size={17} strokeWidth={2} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{s.session_name ?? s.title ?? 'Session'}</div>
                            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              <span>{formatSessionDate(s)}</span>
                              {s.sport_context && <span>· {s.sport_context}</span>}
                              {sNotes.length > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  · <AthleteIcon name="pencil" size={10} strokeWidth={2.2} /> {sNotes.length}
                                </span>
                              )}
                              {sVideos.length > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  · <AthleteIcon name="video" size={10} strokeWidth={2.2} /> {sVideos.length}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: isOpen ? 'var(--primary)' : 'var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', flexShrink: 0 }}>
                          <span style={{ color: isOpen ? '#fff' : 'var(--text-muted)', fontSize: 'var(--fs-1)', fontWeight: 900, lineHeight: 1 }}>{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {/* Session body */}
                      {isOpen && (
                        <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)' }}>
                          {/* Full session — focus points, images and coach notes
                              live on the session page, not in this quick view. */}
                          <a
                            href={`/sessions/${s.id}`}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: 8, marginTop: 14, padding: '10px 13px', borderRadius: 10,
                              background: 'var(--primary-light)', color: 'var(--primary-dark)',
                              textDecoration: 'none', fontSize: 'var(--fs-3)', fontWeight: 700,
                            }}
                          >
                            Open full session
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                            </svg>
                          </a>

                          {/* Recording from the session */}
                          {s.audio_path && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--coach-color)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--coach-color)', display: 'inline-block' }} />
                                Recording
                              </div>
                              <SessionAudioPlayer sessionId={s.id} mime={(s as any).audio_mime ?? null} />
                            </div>
                          )}

                          {/* Coach summary */}
                          {s.summary && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--coach-color)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--coach-color)', display: 'inline-block' }} />
                                Coach Summary
                              </div>
                              <div className="coach-summary" style={{ whiteSpace: 'pre-wrap' }}>
                                {s.summary}
                              </div>
                            </div>
                          )}

                          {/* Full transcript (collapsed) */}
                          {s.transcript && (
                            <details style={{ marginTop: 12 }}>
                              <summary style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text-2)', cursor: 'pointer', padding: '8px 0' }}>
                                View full transcript
                              </summary>
                              <div style={{ fontSize: 'var(--fs-3)', lineHeight: 1.7, color: 'var(--text-2)', marginTop: 8, padding: '12px 14px', background: 'var(--border-soft)', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
                                {s.transcript}
                              </div>
                            </details>
                          )}

                          {/* Videos */}
                          {sVideos.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                                Videos ({sVideos.length})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {sVideos.map((v) => v.signedUrl && (
                                  <VideoAnnotator
                                    key={v.id}
                                    videoUrl={v.signedUrl}
                                    initialAnnotations={v.annotations ?? []}
                                    sessionId={v.session_id}
                                    videoId={v.id}
                                    onAnnotationsChange={async (strokes) => {
                                      // FIX 3: athletes can now annotate; save via PATCH endpoint
                                      try {
                                        await apiMutate(`/api/sessions/${v.session_id}/videos?video_id=${v.id}`, {
                                          method: 'PATCH',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ annotations: strokes }),
                                        })
                                      } catch (e: unknown) {
                                        setActionError(errorMessage(e, 'Could not save your drawing — it is on screen but not stored.'))
                                      }
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* My private notes for this session */}
                          <div style={{ marginTop: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                              <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                My Private Notes
                              </div>
                              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)' }}>Only you can see these</span>
                            </div>

                            {sNotes.map((n) => (
                              <NoteCard
                                key={n.id}
                                note={n}
                                editId={noteEditId}
                                editText={noteEditText}
                                onStartEdit={() => { setNoteEditId(n.id); setNoteEditText(n.content) }}
                                onEditChange={setNoteEditText}
                                onSaveEdit={() => updateNote(n.id)}
                                onCancelEdit={() => setNoteEditId(null)}
                                onDelete={() => deleteNote(n.id)}
                              />
                            ))}

                            {/* Add note inline */}
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <textarea
                                className="input"
                                placeholder="Add a private note about this session…"
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                rows={2}
                                style={{ flex: 1 }}
                              />
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <button
                                  className="btn btn-athlete"
                                  onClick={() => saveNote(s.id)}
                                  disabled={noteSaving || !noteText.trim()}
                                  style={{ padding: '8px 12px', fontSize: 'var(--fs-3)' }}
                                >
                                  {noteSaving ? '…' : 'Save'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Tab: Messages ─── */}
        {tab === 'messages' && (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Messages from your coach</div>
            <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-muted)', marginBottom: 18 }}>All messages between you and your coach stay private here.</div>

            {/* Message list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16, minHeight: 120 }}>
              {msgLoading && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-3)', padding: 20 }}>Loading…</div>}
              {!msgLoading && messages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-3)', padding: 30 }}>No messages yet. Send your coach a message below!</div>
              )}
              {messages.map((msg: any) => {
                const isAthlete = msg.sender_role === 'athlete'
                return (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isAthlete ? 'flex-end' : 'flex-start', marginBottom: 4 }}>
                    <div style={{
                      maxWidth: '75%', padding: msg.msg_type === 'text' ? '9px 14px' : 6,
                      borderRadius: isAthlete ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: isAthlete ? 'var(--athlete-color)' : 'var(--card)',
                      color: isAthlete ? '#fff' : 'var(--text)',
                      border: isAthlete ? 'none' : '1px solid var(--border)',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)', fontSize: 14, lineHeight: 1.5,
                    }}>
                      {msg.msg_type === 'text' && <span>{msg.content}</span>}
                      {msg.msg_type === 'image' && msg.media_url && <img src={msg.media_url} alt="image" style={{ maxWidth: 240, maxHeight: 200, borderRadius: 10, display: 'block', cursor: 'pointer' }} onClick={() => window.open(msg.media_url, '_blank')} />}
                      {msg.msg_type === 'video' && msg.media_url && <video src={msg.media_url} controls style={{ maxWidth: 280, maxHeight: 180, borderRadius: 10, display: 'block' }} />}
                      {msg.msg_type === 'audio' && msg.media_url && (
                        <div style={{ padding: '6px 4px' }}>
                          <div style={{ fontSize: 'var(--fs-2)', fontWeight: 600, marginBottom: 4, color: isAthlete ? 'rgba(255,255,255,0.8)' : 'var(--text-2)' }}>🎤 Voice message</div>
                          <audio controls src={msg.media_url} style={{ height: 36, width: 220 }} />
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)', marginTop: 2, paddingLeft: isAthlete ? 0 : 4, paddingRight: isAthlete ? 4 : 0 }}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                )
              })}
              <div ref={msgBottomRef} />
            </div>

            {/* Input */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <button
                title="Attach photo or video"
                onClick={() => msgFileInputRef.current?.click()}
                style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >📎</button>
              <input ref={msgFileInputRef} type="file" accept="image/*,video/*,audio/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMsgMedia(f); e.target.value = '' }} />
              <textarea
                style={{ flex: 1, resize: 'none', borderRadius: 18, border: '1px solid var(--border)', padding: '9px 14px', fontSize: 14, lineHeight: 1.4, minHeight: 38, maxHeight: 100, background: 'var(--bg)', outline: 'none', fontFamily: 'inherit' }}
                placeholder="Type a message…"
                value={msgText}
                onChange={(e) => { setMsgText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                rows={1}
              />
              <button
                onClick={sendMessage}
                disabled={!msgText.trim() || msgSending}
                style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: msgText.trim() ? 'var(--athlete-color)' : 'var(--border)', color: '#fff', cursor: msgText.trim() ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
              >↑</button>
            </div>
          </div>
        )}

        {/* ─── Tab: Wellness ─── */}
        {tab === 'wellness' && athleteId && (
          <div style={{ maxWidth: 520 }}>
            {/* The history goes above the form on purpose: this tab is reached
                from a control labelled "Trends →", and it used to answer that
                with a blank form and nothing else. */}
            <WellnessHistory rows={wellnessHistory} />
            <WellnessSubmit
              athleteId={athleteId}
              initial={todayWellness}
              // Was `() => {}`. Because nothing re-read the data after a save,
              // an athlete could check in and then find the home card still
              // asking them to check in — the app refusing to acknowledge, in
              // the same session, something it had just stored.
              onSaved={() => { void loadWellness() }}
            />
          </div>
        )}

        {/* ─── Tab: Calendar ─── */}
        {tab === 'calendar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Daily quote */}
            <p className="quote-strip">&quot;{getDailyQuote('athlete')}&quot;</p>

          <div className="card" style={{ padding: 24 }}>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="section-title">My Calendar</div>
                <div className="section-sub">
                  Coach-scheduled events (in blue/coloured) plus your own personal entries. Coaches only see what they&apos;ve added.
                </div>
              </div>
              {calSaveMsg && (
                <div style={{
                  fontSize: 'var(--fs-3)', fontWeight: 700,
                  color: calSaveMsg.includes('Failed') ? 'var(--danger)' : 'var(--success)',
                  background: calSaveMsg.includes('Failed') ? 'var(--danger-light)' : 'var(--success-light)',
                  border: `1px solid ${calSaveMsg.includes('Failed') ? 'var(--danger)' : 'var(--success)'}`,
                  borderRadius: 8, padding: '6px 12px',
                }}>
                  {calSaveMsg.includes('Failed') ? '' : '✓ '}{calSaveMsg}
                </div>
              )}
            </div>
            {calLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>Loading calendar…</div>
            ) : !athleteId ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>Connect to a coach first to see your calendar.</div>
            ) : (
              <Calendar
                events={calEvents}
                role="athlete"
                onAddEvent={(date) => setAddEventModal(date)}
                onDeleteEvent={deleteCalEvent}
                onMonthChange={m => setCalMonth(m)}
              />
            )}

            {/* RSVP Section */}
            {rsvpEvents.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Events needing your response</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rsvpEvents.map((evt: any) => {
                    const status = rsvpMap[evt.id]
                    return (
                      <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700 }}>{evt.title}</div>
                          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)' }}>{new Date(evt.event_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{evt.event_time ? ` at ${evt.event_time}` : ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {(['yes', 'maybe', 'no'] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => sendRsvp(evt.id, s)}
                              style={{
                                padding: '5px 10px', borderRadius: 6, border: '1.5px solid',
                                borderColor: status === s ? (s === 'yes' ? 'var(--success)' : s === 'no' ? 'var(--danger)' : 'var(--warning)') : 'var(--border)',
                                background: status === s ? (s === 'yes' ? 'var(--success-light)' : s === 'no' ? 'var(--danger-light)' : 'var(--warning-light)') : 'transparent',
                                color: status === s ? (s === 'yes' ? 'var(--success)' : s === 'no' ? 'var(--danger)' : 'var(--warning)') : 'var(--text-2)',
                                fontWeight: status === s ? 700 : 400, fontSize: 'var(--fs-2)', cursor: 'pointer',
                              }}
                            >
                              {s === 'yes' ? '✓ Going' : s === 'maybe' ? '? Maybe' : '✗ No'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          </div>
        )}

        {/* ─── Tab: All Notes ─── */}
        {tab === 'notes' && (
          <div style={{ display: isMobile ? 'flex' : 'grid', flexDirection: isMobile ? 'column' : undefined, gridTemplateColumns: isMobile ? undefined : '220px 1fr', gap: isMobile ? 12 : 20 }}>
            {/* Filter sidebar */}
            <div className="card" style={{ padding: 16, height: 'fit-content' }}>
              {!isMobile && <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text-2)', marginBottom: 10 }}>Filter by session</div>}
              {isMobile && <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>Filter by session</div>}
              <div style={isMobile ? { display: 'flex', flexWrap: 'wrap', gap: 6 } : undefined}>
                <button
                  onClick={() => setNoteFilter(null)}
                  style={{
                    display: isMobile ? 'inline-block' : 'block',
                    width: isMobile ? 'auto' : '100%',
                    padding: isMobile ? '6px 12px' : '9px 12px',
                    borderRadius: 8,
                    border: `1.5px solid ${!noteFilter ? 'var(--athlete-color)' : 'var(--border)'}`,
                    background: !noteFilter ? 'var(--athlete-light)' : 'transparent',
                    color: !noteFilter ? 'var(--athlete-color)' : 'var(--text)',
                    fontWeight: !noteFilter ? 700 : 400,
                    fontSize: 'var(--fs-3)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    marginBottom: isMobile ? 0 : 6,
                  }}
                >
                  All notes ({notes.length})
                </button>
                {sessions.map((s) => {
                  const count = notes.filter((n) => n.session_id === s.id).length
                  if (count === 0) return null
                  return (
                    <button
                      key={s.id}
                      onClick={() => setNoteFilter(s.id)}
                      style={{
                        display: isMobile ? 'inline-block' : 'block',
                        width: isMobile ? 'auto' : '100%',
                        padding: isMobile ? '6px 12px' : '9px 12px',
                        borderRadius: 8,
                        border: `1.5px solid ${noteFilter === s.id ? 'var(--athlete-color)' : 'var(--border)'}`,
                        background: noteFilter === s.id ? 'var(--athlete-light)' : 'transparent',
                        color: noteFilter === s.id ? 'var(--athlete-color)' : 'var(--text)',
                        fontWeight: noteFilter === s.id ? 700 : 400,
                        fontSize: 'var(--fs-3)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        marginBottom: isMobile ? 0 : 4,
                      }}
                    >
                      {s.session_name ?? 'Session'} ({count})
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Notes list */}
            <div>
              {/* Add note form */}
              <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                <div className="section-title" style={{ marginBottom: 6, fontSize: 'var(--fs-4)' }}>Add a note</div>
                <div className="section-sub" style={{ marginBottom: 12 }}>
                  Your notes are 100% private — coaches cannot see them.
                </div>
                <textarea
                  className="input"
                  placeholder="Write a note about your training, how you felt, what you want to remember…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  style={{ marginBottom: 10 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-athlete btn-lg"
                    onClick={() => saveNote(noteFilter)}
                    disabled={noteSaving || !noteText.trim()}
                    style={{ flex: 1 }}
                  >
                    {noteSaving ? 'Saving…' : '✍️ Save note'}
                  </button>
                  <button
                    className={`btn ${noteRecording ? 'btn-danger' : 'btn-ghost'}`}
                    onClick={noteRecording ? stopNoteRecording : startNoteRecording}
                    disabled={noteTranscribing}
                    style={{ gap: 6 }}
                  >
                    {noteTranscribing ? '…transcribing' : noteRecording ? <><span className="recording-dot" /> Stop recording</> : '🎙️ Voice note'}
                  </button>
                </div>
              </div>

              {filteredNotes.length === 0 ? (
                <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📝</div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>No notes yet</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Your private notes will appear here.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredNotes.map((n) => (
                    <NoteCard
                      key={n.id}
                      note={n}
                      editId={noteEditId}
                      editText={noteEditText}
                      onStartEdit={() => { setNoteEditId(n.id); setNoteEditText(n.content) }}
                      onEditChange={setNoteEditText}
                      onSaveEdit={() => updateNote(n.id)}
                      onCancelEdit={() => setNoteEditId(null)}
                      onDelete={() => deleteNote(n.id)}
                      showSession={!noteFilter}
                      sessions={sessions}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Add Calendar Event Modal */}
      {addEventModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div className="card-lg" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div className="section-title" style={{ fontSize: 17 }}>Add Personal Event</div>
                <div className="section-sub">
                  {new Date(addEventModal + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
              </div>
              <button onClick={() => setAddEventModal(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="label">Title *</label>
                <input className="input" placeholder="e.g. Rest day, Self-training, Goal check" value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} autoFocus />
              </div>
              <div>
                <label className="label">Type</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['reminder', 'goal', 'other'].map((t) => (
                    <button key={t} onClick={() => setEventForm({ ...eventForm, event_type: t })} className={`badge badge-${t}`} style={{ cursor: 'pointer', border: `1.5px solid ${eventForm.event_type === t ? 'currentColor' : 'transparent'}`, padding: '5px 12px', fontSize: 'var(--fs-2)' }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Time (optional)</label>
                <input className="input" type="time" value={eventForm.event_time} onChange={(e) => setEventForm({ ...eventForm, event_time: e.target.value })} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input" rows={2} value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} />
              </div>
            </div>
            {calSaveMsg && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: calSaveMsg.includes('added') ? 'var(--success-light)' : 'var(--danger-light)', color: calSaveMsg.includes('added') ? 'var(--success)' : 'var(--danger)', fontSize: 'var(--fs-3)', fontWeight: 600 }}>
                {calSaveMsg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => { setAddEventModal(null); setCalSaveMsg('') }} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-athlete btn-lg" onClick={saveCalendarEvent} disabled={eventSaving || !eventForm.title.trim()} style={{ flex: 2 }}>
                {eventSaving ? 'Saving…' : 'Add event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ MOBILE BOTTOM NAV ════════ */}
      {isMobile && (
        <nav style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
          background: 'rgba(251,248,243,0.94)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border)',
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2,
          alignItems: 'center',
          padding: '8px 6px',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}>
          {([
            { key: 'home'     as Tab, icon: 'home',     label: 'Today'    },
            { key: 'sessions' as Tab, icon: 'book',     label: 'Sessions' },
            null,
            { key: 'calendar' as Tab, icon: 'calendar', label: 'Calendar' },
            { key: 'messages' as Tab, icon: 'messages', label: 'Messages' },
          ] as ({ key: Tab; icon: string; label: string } | null)[]).map((item, i) => {
            if (item === null) {
              return (
                <div key="fab" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <button
                    onClick={() => setTab('wellness')}
                    style={{
                      width: 46, height: 46,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--coach-color) 0%, var(--coach-on-light) 100%)',
                      border: '2px solid var(--card)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(181,92,62,0.35), 0 0 0 3px var(--bg)',
                      color: '#fff',
                    }}
                  >
                    <AthleteIcon name="mic" size={18} strokeWidth={2.2} />
                  </button>
                  <span style={{ fontSize: 'var(--fs-1)', color: 'var(--coach-color)', fontWeight: 600, lineHeight: 1 }}>Wellness</span>
                </div>
              )
            }
            const active = tab === item.key
            return (
              <button key={item.key} onClick={() => setTab(item.key)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '6px 0',
                border: 'none', background: 'none', cursor: 'pointer',
                position: 'relative',
                color: active ? 'var(--text)' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
              }}>
                {active && <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', width: 18, height: 2, background: 'var(--text)', borderRadius: 2 }} />}
                <AthleteIcon name={item.icon} size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span style={{ fontSize: 'var(--fs-1)', fontWeight: active ? 700 : 500, lineHeight: 1 }}>{item.label}</span>
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}

// ── Note card component ───────────────────────────────────────
function NoteCard({
  note, editId, editText, onStartEdit, onEditChange, onSaveEdit, onCancelEdit, onDelete, showSession, sessions,
}: {
  note: AthleteNote
  editId: string | null
  editText: string
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  showSession?: boolean
  sessions?: { id: string; session_name: string | null }[]
}) {
  const isEditing = editId === note.id
  const sessionName = showSession && sessions ? sessions.find((s) => s.id === note.session_id)?.session_name : null

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: isEditing ? 10 : 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)' }}>
            {new Date(note.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
          {note.note_type === 'voice' && <span className="badge badge-session" style={{ fontSize: 'var(--fs-1)' }}>🎙️ Voice</span>}
          {sessionName && <span className="badge badge-athlete" style={{ fontSize: 'var(--fs-1)' }}>{sessionName}</span>}
        </div>
        {!isEditing && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="btn btn-ghost" onClick={onStartEdit} style={{ padding: '4px 8px', fontSize: 'var(--fs-2)' }}>Edit</button>
            <button className="btn btn-danger" onClick={onDelete} style={{ padding: '4px 8px', fontSize: 'var(--fs-2)' }}>Delete</button>
          </div>
        )}
      </div>

      {isEditing ? (
        <>
          <textarea className="input" value={editText} onChange={(e) => onEditChange(e.target.value)} rows={3} autoFocus style={{ marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-athlete" onClick={onSaveEdit} disabled={!editText.trim()} style={{ flex: 1 }}>Save</button>
            <button className="btn btn-ghost" onClick={onCancelEdit} style={{ flex: 1 }}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="note-content">{note.content}</div>
      )}
    </div>
  )
}
