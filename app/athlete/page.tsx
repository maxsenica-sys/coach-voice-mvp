'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import Calendar, { type CalendarEvent } from '@/app/components/Calendar'
import VideoAnnotator from '@/app/components/VideoAnnotator'
import WellnessSubmit from '@/app/components/WellnessSubmit'
import { getDailyQuote } from '@/lib/quotes'
import { fmtDate, fmtDateTime } from '@/lib/date-utils'

type Tab = 'home' | 'sessions' | 'calendar' | 'notes' | 'messages' | 'wellness' | 'plans'

type SessionRow = {
  id: string
  session_name: string | null
  title: string | null
  summary: string | null
  transcript: string | null
  shared_with_athlete: boolean
  created_at: string | null
  sport_context: string | null
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
    case 'pencil':   return <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    case 'file':     return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    default:         return null
  }
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
  const [athleteName, setAthleteName] = useState('')
  const [athleteId, setAthleteId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null)
  const [todayWellness, setTodayWellness] = useState<Record<string, any> | null>(null)
  const [sport, setSport] = useState('')
  const [error, setError] = useState('')

  // Sessions
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [openSession, setOpenSession] = useState<string | null>(null)

  // Notes
  const [notes, setNotes] = useState<AthleteNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [plans, setPlans] = useState<any[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
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
                .select('id, session_name, title, summary, transcript, shared_with_athlete, created_at, sport_context')
                .eq('athlete_id', athRecord.id)
                .eq('shared_with_athlete', true)
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

      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
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

  // ── Today's wellness ──────────────────────────────────────
  useEffect(() => {
    if (!athleteId) return
    const today = new Intl.DateTimeFormat('en-CA').format(new Date())
    fetch(`/api/wellness?athlete_id=${athleteId}&days=1`)
      .then(r => r.json())
      .then(j => {
        const entry = (j.checkins ?? []).find((c: any) => c.check_date === today) ?? null
        setTodayWellness(entry)
      })
      .catch(() => {})
  }, [athleteId])

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

  // ── Load training plans ────────────────────────────────────
  useEffect(() => {
    if (tab !== 'plans' || !athleteId) return
    setPlansLoading(true)
    fetch(`/api/training-plans?athlete_id=${athleteId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load plans'))))
      .then((j) => setPlans(j.plans ?? []))
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false))
  }, [tab, athleteId])

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
    await fetch('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, athlete_id: athleteId, status }),
    })
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
      const res = await fetch(`/api/sessions/${sessionId}/videos`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      setSessionVideos((prev) => ({ ...prev, [sessionId]: json.videos ?? [] }))
    } catch {}
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
    await fetch(`/api/athlete-notes?id=${id}`, { method: 'DELETE' })
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  // Voice note recording
  const startNoteRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
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
    await fetch(`/api/calendar?id=${id}`, { method: 'DELETE' })
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
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9BA29B', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontFamily: 'monospace' }}>{onboardDate}</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 34, letterSpacing: -0.8, lineHeight: 1.1, color: '#1F2421' }}>
              Welcome to CoachVoice,<br/>
              <span style={{ fontStyle: 'italic', fontWeight: 500 }}>{onboardFirstName}.</span>
            </h1>
            <p style={{ margin: '12px 0 0', fontSize: 14, color: '#5D6661', lineHeight: 1.6, maxWidth: 340 }}>
              Your coach has set up your training profile. Here's how to get started.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
            {[
              { icon: '🏃', title: 'Check in daily', desc: 'Your coach tracks your energy, mood, sleep, soreness and stress. Takes 10 seconds.' },
              { icon: '📋', title: 'View your sessions', desc: 'After each session, your coach will share notes and feedback here.' },
              { icon: '💬', title: 'Message your coach', desc: "Ask questions, share how you're feeling, stay connected." },
            ].map((step, i) => (
              <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E3DED2', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#F4F1EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{step.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1F2421', marginBottom: 4 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: '#5D6661', lineHeight: 1.55 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <button
            className="btn btn-primary btn-lg"
            style={{ width: '100%', fontSize: 16, padding: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={dismissOnboarding}
          >
            Let's go →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-grain" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(251,248,243,0.94)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid #E3DED2',
      }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: '#6F8E6B', color: '#fff', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {(athleteName.split(' ')[0]?.[0] ?? 'A').toUpperCase()}{(athleteName.split(' ')[1]?.[0] ?? '').toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: '#9BA29B', letterSpacing: 1, textTransform: 'uppercase' }}>
                {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2421', marginTop: 1 }}>
                {athleteName || 'Athlete'}{sport ? ` · ${sport}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ width: 36, height: 36, borderRadius: 10, background: '#FFFFFF', border: '1px solid #E3DED2', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5D6661', cursor: 'pointer' }}>
              <AthleteIcon name="messages" size={15} strokeWidth={1.8} />
              {sessions.length > 0 && <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: '50%', background: '#B55C3E', border: '1.5px solid #FFFFFF' }} />}
            </button>
            <button onClick={logout} style={{ width: 36, height: 36, borderRadius: 10, background: '#FFFFFF', border: '1px solid #E3DED2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5D6661', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
              Out
            </button>
          </div>
        </div>
      </header>

      <main ref={mainRef} style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '16px' : '28px 20px', overflowY: 'auto', paddingBottom: isMobile ? 'max(100px, calc(80px + env(safe-area-inset-bottom)))' : undefined }}>
        {/* No athlete record — show join form */}
        {error === 'no-athlete-record' && (
          <div style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '1px solid #f59e0b', borderRadius: 16, padding: 24, marginBottom: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 6, color: '#92400e' }}>🔗 Connect to your coach</div>
            <p style={{ fontSize: 14, color: '#78350f', marginBottom: 16, margin: '0 0 16px' }}>
              Your account isn't linked to a coach yet. Enter your coach's invite code below to get started.
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
            {joinMsg && <p style={{ marginTop: 10, fontSize: 13, color: joinMsg.includes('Success') ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{joinMsg}</p>}
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
              { key: 'plans',    label: 'Plans' },
            ] as { key: Tab; label: string }[]).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  border: tab === t.key ? 'none' : '1px solid var(--border)',
                  background: tab === t.key
                    ? 'linear-gradient(135deg, #6F8E6B 0%, #4F6B4B 100%)'
                    : 'var(--card)',
                  color: tab === t.key ? '#fff' : 'var(--text-2)',
                  fontWeight: tab === t.key ? 800 : 600,
                  fontSize: 13,
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Greeting */}
            <div>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 30, letterSpacing: -0.8, lineHeight: 1.05, color: '#1F2421' }}>
                Welcome back,<br/>
                <span style={{ fontStyle: 'italic', fontWeight: 500 }}>{athleteName.split(' ')[0] || 'Athlete'}.</span>
              </h1>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#5D6661', lineHeight: 1.5 }}>
                {sessions.length} session{sessions.length !== 1 ? 's' : ''} from your coach
              </p>
            </div>

            {/* Wellness check-in card */}
            {athleteId && (
              todayWellness ? (
                <div style={{ background: 'var(--primary-light)', border: '1px solid #CBD7C0', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary)', marginBottom: 10 }}>✓ Check-in complete</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {([
                      { key: 'energy', label: 'Energy' },
                      { key: 'mood', label: 'Mood' },
                      { key: 'sleep_q', label: 'Sleep' },
                      { key: 'soreness', label: 'Soreness' },
                      { key: 'stress', label: 'Stress' },
                    ] as const).map(m => (
                      todayWellness[m.key] != null && (
                        <span key={m.key} style={{ background: '#FFFFFF', border: '1px solid #CBD7C0', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#4F6B4B' }}>
                          {m.label} {todayWellness[m.key]}/5
                        </span>
                      )
                    ))}
                  </div>
                  <button onClick={() => setTab('wellness')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: 0, fontWeight: 600 }}>
                    See your trends →
                  </button>
                </div>
              ) : (
                <div style={{ background: 'linear-gradient(135deg, var(--primary-light) 0%, #FBF8F3 100%)', border: '1px solid var(--border)', borderLeft: '4px solid var(--primary)', borderRadius: 14, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', boxShadow: '0 0 0 2px rgba(111,142,107,0.25)' }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Daily Check-in</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: '#1F2421', marginBottom: 12 }}>How are you feeling today?</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {([
                      { icon: '⚡', label: 'Energy' },
                      { icon: '😊', label: 'Mood' },
                      { icon: '🌙', label: 'Sleep' },
                      { icon: '💪', label: 'Soreness' },
                      { icon: '🧠', label: 'Stress' },
                    ] as const).map(m => (
                      <button key={m.label} onClick={() => setTab('wellness')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: '#FFFFFF', border: '1px solid #E3DED2', borderRadius: 10, padding: '8px 2px', cursor: 'pointer' }}>
                        <span style={{ fontSize: 18 }}>{m.icon}</span>
                        <span style={{ fontSize: 10, color: '#5D6661', fontWeight: 600 }}>{m.label}</span>
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setTab('wellness')}>
                    Check in now →
                  </button>
                </div>
              )
            )}

            {/* New from coach — most recent session */}
            {sessions.length > 0 && (
              <div style={{ background: 'linear-gradient(135deg, #F4DED3 0%, #FCF9F2 100%)', borderRadius: 16, padding: '14px 14px 14px 16px', border: '1px solid #EBCBBC', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: -28, right: -28, width: 100, height: 100, borderRadius: '50%', border: '1.5px dashed #B55C3E', opacity: 0.25 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, position: 'relative' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#B55C3E' }} />
                  <span style={{ fontSize: 9.5, fontWeight: 800, color: '#B55C3E', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    New from Coach · {fmtDate(sessions[0].created_at)}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 500, color: '#1F2421', lineHeight: 1.35, letterSpacing: -0.2, marginBottom: 4, fontStyle: 'italic', position: 'relative' }}>
                  {sessions[0].session_name ?? sessions[0].title ?? 'Latest Session'}
                </div>
                {sessions[0].summary && (
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 13.5, color: '#1F2421', lineHeight: 1.55, position: 'relative', marginBottom: 12 }}>
                    &ldquo;{sessions[0].summary.slice(0, 120)}{sessions[0].summary.length > 120 ? '…' : ''}&rdquo;
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                  <button onClick={() => setTab('sessions')} style={{ flex: 1, padding: '9px 0', background: '#1F2421', color: '#FBF8F3', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
                    Read full session →
                  </button>
                </div>
              </div>
            )}

            {/* Quick stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { label: 'Sessions', value: sessions.length, color: '#6F8E6B', delta: 'from coach', onClick: () => setTab('sessions') },
                { label: 'My Notes', value: notes.length, color: '#B55C3E', delta: 'private', onClick: () => setTab('notes') },
                { label: 'Last Session', value: sessions[0] ? fmtDate(sessions[0].created_at) : '—', color: '#C9933A', delta: sessions[0] ? 'most recent' : 'none yet', onClick: () => setTab('sessions') },
              ].map((s, idx) => (
                <button key={s.label} onClick={s.onClick} style={{
                  background: '#FFFFFF', borderRadius: 14, padding: '11px 10px 10px',
                  border: '1px solid #E3DED2', cursor: 'pointer', textAlign: 'left',
                  gridColumn: isMobile && idx === 2 ? 'span 3' : undefined,
                  position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{ position: 'absolute', top: 0, left: 10, right: 10, height: 2, background: s.color, borderRadius: '0 0 4px 4px' }} />
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: isMobile ? 24 : 28, fontWeight: 500, color: '#1F2421', lineHeight: 1, letterSpacing: -1, marginTop: 4 }}>{s.value}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: '#5D6661', marginTop: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>{s.label}</div>
                  <div style={{ fontSize: 9, color: '#9BA29B', marginTop: 3, fontWeight: 600 }}>{s.delta}</div>
                </button>
              ))}
            </div>

            {/* Add a private note CTA */}
            <button onClick={() => setTab('notes')} style={{ width: '100%', padding: '11px 13px', background: 'transparent', borderRadius: 12, border: '1.5px dashed #E3DED2', display: 'flex', alignItems: 'center', gap: 9, color: '#5D6661', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: '#EFEAE0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5D6661' }}>
                <AthleteIcon name="pencil" size={12} strokeWidth={2} />
              </div>
              <span style={{ flex: 1, textAlign: 'left' }}>Add a private note…</span>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#B55C3E', display: 'flex', alignItems: 'center', gap: 3 }}>
                <AthleteIcon name="mic" size={10} strokeWidth={2.4} /> VOICE
              </div>
            </button>

            {/* Training plans CTA */}
            <button onClick={() => setTab('plans')} style={{ width: '100%', padding: '11px 13px', background: 'transparent', borderRadius: 12, border: '1.5px dashed #E3DED2', display: 'flex', alignItems: 'center', gap: 9, color: '#5D6661', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: '#EFEAE0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5D6661' }}>
                <AthleteIcon name="file" size={12} strokeWidth={2} />
              </div>
              <span style={{ flex: 1, textAlign: 'left' }}>View training plans{plans.length > 0 ? ` (${plans.length})` : ''}…</span>
            </button>

          </div>
        )}

        {/* ─── Tab: Sessions ─── */}
        {tab === 'sessions' && (
          <div>
            {/* Hero card — most recent session from coach */}
            {sessions.length > 0 && (
              <div style={{
                background: 'linear-gradient(135deg, var(--coach-light) 0%, #FBF8F3 100%)',
                border: '1px solid var(--border)',
                borderLeft: '4px solid var(--coach-color)',
                borderRadius: 14,
                padding: 16,
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--coach-color)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--coach-color)', display: 'inline-block' }} />
                  From your coach
                </div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>
                  {sessions[0].session_name ?? sessions[0].title ?? 'Latest Session'}
                </div>
                {sessions[0].summary && (
                  <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 8 }}>
                    {sessions[0].summary.slice(0, 140)}{sessions[0].summary.length > 140 ? '…' : ''}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(sessions[0].created_at)}</div>
              </div>
            )}

            {sessions.length === 0 ? (
              <div style={{ background: 'linear-gradient(135deg, var(--primary-light) 0%, #e0f2fe 100%)', border: '1px solid var(--border)', borderRadius: 18, padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 14 }}>📋</div>
                <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8, color: 'var(--text)' }}>No sessions yet</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 300, margin: '0 auto' }}>
                  Your coach will share sessions with you here after each training. Keep grinding! 💪
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
                          <div style={{ width: 44, height: 44, borderRadius: 12, background: isOpen ? 'linear-gradient(135deg, #6F8E6B 0%, #4F6B4B 100%)' : 'var(--athlete-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, transition: 'all 0.2s ease', boxShadow: isOpen ? '0 4px 12px rgb(111 142 107 / .3)' : 'none' }}>
                            🎙️
                          </div>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{s.session_name ?? s.title ?? 'Session'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              {fmtDateTime(s.created_at)}
                              {s.sport_context ? ` · ${s.sport_context}` : ''}
                              {sNotes.length > 0 && ` · 📝 ${sNotes.length}`}
                              {sVideos.length > 0 && ` · 🎬 ${sVideos.length}`}
                            </div>
                          </div>
                        </div>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: isOpen ? '#6F8E6B' : 'var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', flexShrink: 0 }}>
                          <span style={{ color: isOpen ? '#fff' : 'var(--text-muted)', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {/* Session body */}
                      {isOpen && (
                        <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)' }}>
                          {/* Coach summary */}
                          {s.summary && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--coach-color)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
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
                              <summary style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', cursor: 'pointer', padding: '8px 0' }}>
                                View full transcript
                              </summary>
                              <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)', marginTop: 8, padding: '12px 14px', background: 'var(--border-soft)', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
                                {s.transcript}
                              </div>
                            </details>
                          )}

                          {/* Videos */}
                          {sVideos.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
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
                                      await fetch(`/api/sessions/${v.session_id}/videos?video_id=${v.id}`, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ annotations: strokes }),
                                      })
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* My private notes for this session */}
                          <div style={{ marginTop: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                My Private Notes
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Only you can see these</span>
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
                                  style={{ padding: '8px 12px', fontSize: 13 }}
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
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>All messages between you and your coach stay private here.</div>

            {/* Message list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16, minHeight: 120 }}>
              {msgLoading && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>Loading…</div>}
              {!msgLoading && messages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30 }}>No messages yet. Send your coach a message below!</div>
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
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: isAthlete ? 'rgba(255,255,255,0.8)' : 'var(--text-2)' }}>🎤 Voice message</div>
                          <audio controls src={msg.media_url} style={{ height: 36, width: 220 }} />
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, paddingLeft: isAthlete ? 0 : 4, paddingRight: isAthlete ? 4 : 0 }}>
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
                style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: msgText.trim() ? 'var(--athlete-color)' : 'var(--border)', color: '#fff', cursor: msgText.trim() ? 'pointer' : 'not-allowed', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
              >↑</button>
            </div>
          </div>
        )}

        {/* ─── Tab: Wellness ─── */}
        {tab === 'wellness' && athleteId && (
          <div style={{ maxWidth: 520 }}>
            <WellnessSubmit athleteId={athleteId} onSaved={() => {}} />
          </div>
        )}

        {/* ─── Tab: Calendar ─── */}
        {tab === 'calendar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Daily quote */}
            <p className="quote-strip">"{getDailyQuote('athlete')}"</p>

          <div className="card" style={{ padding: 24 }}>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="section-title">My Calendar</div>
                <div className="section-sub">
                  Coach-scheduled events (in blue/coloured) plus your own personal entries. Coaches only see what they've added.
                </div>
              </div>
              {calSaveMsg && (
                <div style={{
                  fontSize: 13, fontWeight: 700,
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
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Events needing your response</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rsvpEvents.map((evt: any) => {
                    const status = rsvpMap[evt.id]
                    return (
                      <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{evt.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(evt.event_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{evt.event_time ? ` at ${evt.event_time}` : ''}</div>
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
                                fontWeight: status === s ? 700 : 400, fontSize: 12, cursor: 'pointer',
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
              {!isMobile && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 10 }}>Filter by session</div>}
              {isMobile && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>Filter by session</div>}
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
                    fontSize: 13,
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
                        fontSize: 13,
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
                <div className="section-title" style={{ marginBottom: 6, fontSize: 16 }}>Add a note</div>
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

        {tab === 'plans' && (
          <div>
            {plansLoading ? (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
            ) : plans.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>No training plans yet</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Plans your coach uploads for you will show up here.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plans.map((plan: any) => (
                  <div key={plan.id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--athlete-light)', color: 'var(--athlete-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <AthleteIcon name="file" size={17} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {plan.created_at ? fmtDate(plan.created_at) : '—'}
                      </div>
                    </div>
                    {plan.signedUrl && (
                      <a href={plan.signedUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 12px', flexShrink: 0 }}>
                        View
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                    <button key={t} onClick={() => setEventForm({ ...eventForm, event_type: t })} className={`badge badge-${t}`} style={{ cursor: 'pointer', border: `1.5px solid ${eventForm.event_type === t ? 'currentColor' : 'transparent'}`, padding: '5px 12px', fontSize: 12 }}>
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
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: calSaveMsg.includes('added') ? 'var(--success-light)' : 'var(--danger-light)', color: calSaveMsg.includes('added') ? 'var(--success)' : 'var(--danger)', fontSize: 13, fontWeight: 600 }}>
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
          borderTop: '1px solid #E3DED2',
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
                      background: 'linear-gradient(135deg, #B55C3E 0%, #8E3F27 100%)',
                      border: '2px solid #FFFFFF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(181,92,62,0.35), 0 0 0 3px #FBF8F3',
                      color: '#fff',
                    }}
                  >
                    <AthleteIcon name="mic" size={18} strokeWidth={2.2} />
                  </button>
                  <span style={{ fontSize: 9, color: '#B55C3E', fontWeight: 600, lineHeight: 1 }}>Wellness</span>
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
                color: active ? '#1F2421' : '#9BA29B',
                transition: 'all 0.15s ease',
              }}>
                {active && <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', width: 18, height: 2, background: '#1F2421', borderRadius: 2 }} />}
                <AthleteIcon name={item.icon} size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, lineHeight: 1 }}>{item.label}</span>
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
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {new Date(note.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
          {note.note_type === 'voice' && <span className="badge badge-session" style={{ fontSize: 10 }}>🎙️ Voice</span>}
          {sessionName && <span className="badge badge-athlete" style={{ fontSize: 10 }}>{sessionName}</span>}
        </div>
        {!isEditing && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="btn btn-ghost" onClick={onStartEdit} style={{ padding: '4px 8px', fontSize: 12 }}>Edit</button>
            <button className="btn btn-danger" onClick={onDelete} style={{ padding: '4px 8px', fontSize: 12 }}>Delete</button>
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
