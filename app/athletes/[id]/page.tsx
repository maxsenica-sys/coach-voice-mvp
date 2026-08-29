'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import SportWheelPicker from '@/app/components/SportWheelPicker'
import VideoAnnotator, { type AnnotationStroke } from '@/app/components/VideoAnnotator'
import WellnessGraph from '@/app/components/WellnessGraph'
import QuickSessionModal from '@/app/components/QuickSessionModal'
import {
  WELLNESS_METRICS, metricColor, overallWellnessScore, overallScoreColor,
  type WellnessCheckin, type WellnessAlert,
} from '@/lib/wellness-config'

interface Athlete {
  id: string; first_name: string; last_name: string
  email: string; status?: string
  photo_signed_url?: string | null
  photo_url?: string | null
  position?: string | null
  height_cm?: number | null
  height?: string | null
  sport?: string | null
  sport_metrics?: Record<string, string>
  goals?: string | null
  custom_fields?: { label: string; value: string }[]
}
interface Session {
  id: string; session_name: string | null; summary: string | null
  transcript: string | null; shared_with_athlete: boolean
  created_at: string | null; sport_context?: string | null
}
interface SessionVideo {
  id: string; session_id: string; file_name: string | null
  annotations: AnnotationStroke[]; signedUrl: string | null; created_at: string
}
type RecordingState = 'idle' | 'recording' | 'transcribing' | 'ready'

// ── SVG Icon (reused from dashboard) ────────────────────────────
function Icon({ name, size = 18, strokeWidth = 2 }: { name: string; size?: number; strokeWidth?: number }) {
  const s: React.CSSProperties = { width: size, height: size, display: 'block', flexShrink: 0 }
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: s }
  switch (name) {
    case 'arrow-left': return <svg {...p}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
    case 'mic':        return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    case 'messages':   return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    case 'report':     return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
    case 'users':      return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    case 'share':      return <svg {...p}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
    case 'pdf':        return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    case 'video':      return <svg {...p}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
    case 'trash':      return <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    case 'chevron-down': return <svg {...p}><polyline points="6 9 12 15 18 9"/></svg>
    case 'chevron-up':   return <svg {...p}><polyline points="18 15 12 9 6 15"/></svg>
    case 'check':      return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>
    case 'mail':       return <svg {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
    case 'x':          return <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    default:           return null
  }
}

// ── Caretaker Panel ──────────────────────────────────────────────
function buildSessionEmailHtml(sessionName: string, summary: string, athleteName: string, coachName: string, date: string) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a2e">
<h2 style="color:#2563eb">Session Report – ${athleteName}</h2>
<p><strong>Session:</strong> ${sessionName}</p><p><strong>Date:</strong> ${date}</p><p><strong>Coach:</strong> ${coachName}</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.06em;color:#2563eb">AI Session Summary</h3>
<div style="background:#eff6ff;border-left:4px solid #2563eb;padding:14px 16px;border-radius:4px;font-size:15px;line-height:1.7;white-space:pre-wrap">${summary}</div>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
<p style="font-size:12px;color:#94a3b8">Sent via CoachVoice — the AI coaching platform</p>
</body></html>`
}

interface CaretakerPanelProps {
  athleteId: string; athleteName: string
  caretakers: any[]; setCaretakers: (v: any[]) => void
  form: any; setForm: (v: any) => void
  saving: boolean; setSaving: (v: boolean) => void
  msg: string; setMsg: (v: string) => void
  emailSending: boolean; setEmailSending: (v: boolean) => void
  emailMsg: string; setEmailMsg: (v: string) => void
}

function CaretakerPanel({ athleteId, athleteName, caretakers, setCaretakers, form, setForm, saving, setSaving, msg, setMsg, emailSending, setEmailSending, emailMsg, setEmailMsg }: CaretakerPanelProps) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (loaded) return
    fetch(`/api/caretakers?athlete_id=${athleteId}`)
      .then(r => r.json()).then(j => { setCaretakers(j.caretakers ?? []); setLoaded(true) })
  }, [athleteId, loaded, setCaretakers])

  const save = async () => {
    if (!form.name || !form.email) { setMsg('Name and email required'); return }
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/caretakers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ athlete_id: athleteId, caretaker_name: form.name, caretaker_email: form.email, relationship: form.relationship, notify_session_reports: form.notify_session_reports, notify_monthly_reports: form.notify_monthly_reports, notify_wellness_alerts: form.notify_wellness_alerts }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setCaretakers([...caretakers.filter(c => c.caretaker_email !== form.email), j.caretaker])
      setForm({ name: '', email: '', relationship: 'parent', notify_session_reports: true, notify_monthly_reports: true, notify_wellness_alerts: true })
      setMsg('Saved!')
    } catch (e: any) { setMsg(e?.message ?? 'Failed') }
    setSaving(false)
  }

  const sendTestEmail = async (email: string, name: string) => {
    setEmailSending(true); setEmailMsg('')
    try {
      const html = buildSessionEmailHtml('Example Session', '• Great work on technique today\n• Focus on footwork next session', athleteName, 'Coach', new Date().toLocaleDateString())
      const res = await fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: email, subject: `Session update for ${athleteName}`, html }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setEmailMsg(`Sent to ${name}!`)
    } catch (e: any) { setEmailMsg(e?.message ?? 'Failed') }
    setEmailSending(false)
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Caretakers</div>
      {caretakers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {caretakers.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.caretaker_name} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({c.relationship})</span></div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.caretaker_email}</div>
              </div>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 11, gap: 4 }} onClick={() => sendTestEmail(c.caretaker_email, c.caretaker_name)} disabled={emailSending}>
                <Icon name="mail" size={12} /> Send
              </button>
              <button className="btn btn-danger" style={{ padding: '4px 8px' }} onClick={async () => { await fetch(`/api/caretakers?id=${c.id}`, { method: 'DELETE' }); setCaretakers(caretakers.filter(x => x.id !== c.id)) }}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {emailMsg && <div style={{ fontSize: 12, color: emailMsg.includes('Sent') ? 'var(--success)' : 'var(--danger)', marginBottom: 10, fontWeight: 600 }}>{emailMsg}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input className="input" style={{ fontSize: 13 }} placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input className="input" style={{ fontSize: 13 }} type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <select className="input" style={{ fontSize: 13 }} value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })}>
          {['parent','guardian','family','manager','other'].map(r => <option key={r}>{r}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.notify_session_reports} onChange={e => setForm({ ...form, notify_session_reports: e.target.checked })} /> Notify on session reports
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.notify_monthly_reports} onChange={e => setForm({ ...form, notify_monthly_reports: e.target.checked })} /> Notify on monthly reports
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.notify_wellness_alerts} onChange={e => setForm({ ...form, notify_wellness_alerts: e.target.checked })} /> Show in wellness alert &quot;notify parent&quot; list
        </label>
        {msg && <div style={{ fontSize: 12, color: msg.includes('Saved') ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{msg}</div>}
        <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Caretaker'}</button>
      </div>
    </div>
  )
}

// ── Video upload progress bar ────────────────────────────────────
function VideoUploadBar({ pct, eta }: { pct: number; eta: string }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>Uploading… {pct}%</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{eta}</span>
      </div>
      <div style={{ height: 8, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: pct === 100 ? 'var(--success)' : 'var(--primary)', transition: 'width 0.3s ease' }} />
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────
export default function AthleteDetailPage() {
  const router = useRouter()
  const params = useParams()
  const athleteId = (params?.id as string) ?? ''
  const supabase = createSupabaseBrowserClient()

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const [athlete, setAthlete] = useState<Athlete | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [coachSport, setCoachSport] = useState('')

  const [sessionName, setSessionName] = useState('')
  const [share, setShare] = useState(true)
  const [transcript, setTranscript] = useState('')
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null)

  const [recordState, setRecordState] = useState<RecordingState>('idle')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioPath, setAudioPath] = useState<string | null>(null)
  const [audioMime, setAudioMime] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [micLevel, setMicLevel] = useState(0)

  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)

  const [autoMonthlyReport, setAutoMonthlyReport] = useState(false)
  const [showCaretakers, setShowCaretakers] = useState(false)
  const [caretakers, setCaretakers] = useState<any[]>([])
  const [caretakerForm, setCaretakerForm] = useState({ name: '', email: '', relationship: 'parent', notify_session_reports: true, notify_monthly_reports: true, notify_wellness_alerts: true })
  const [caretakerSaving, setCaretakerSaving] = useState(false)
  const [caretakerMsg, setCaretakerMsg] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')

  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const [sessionVideos, setSessionVideos] = useState<Record<string, SessionVideo[]>>({})
  const [videoProgress, setVideoProgress] = useState<Record<string, number | null>>({})
  const [videoEta, setVideoEta] = useState<Record<string, string>>({})

  // Profile editing
  const [showProfile, setShowProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    first_name: '', last_name: '', position: '', height: '',
    sport: '',
    goals: '', sport_metrics: {} as Record<string, string>,
    custom_fields: [] as { label: string; value: string }[],
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [metricKey, setMetricKey] = useState('')
  const [metricVal, setMetricVal] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customVal, setCustomVal] = useState('')

  // ── Tab navigation + Quick Session ───────────────────────────
  type AthleteTab = 'overview' | 'sessions' | 'wellness' | 'calendar' | 'profile' | 'notes' | 'plans'
  const [activeTab, setActiveTab] = useState<AthleteTab>('overview')
  const [showQuickSession, setShowQuickSession] = useState(false)
  const [sessionsShowAll, setSessionsShowAll] = useState(false)

  // ── Notes ─────────────────────────────────────────────────────
  const [notes, setNotes] = useState<any[]>([])
  const [noteText, setNoteText] = useState('')
  const [noteShared, setNoteShared] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteMsg, setNoteMsg] = useState('')
  const [notesLoaded, setNotesLoaded] = useState(false)

  // ── Training plans ────────────────────────────────────────────
  const [plans, setPlans] = useState<any[]>([])
  const [plansLoaded, setPlansLoaded] = useState(false)
  const [planTitle, setPlanTitle] = useState('')
  const [planFile, setPlanFile] = useState<File | null>(null)
  const [planUploading, setPlanUploading] = useState(false)
  const [planMsg, setPlanMsg] = useState('')

  const load = async () => {
    if (!athleteId) return
    setLoading(true); setPageError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: profile } = await supabase.from('profiles').select('sport').eq('id', user.id).single()
      setCoachSport(profile?.sport ?? '')
      const aRes = await fetch(`/api/athletes/${athleteId}`)
      if (aRes.status === 401) { router.push('/'); return }
      if (!aRes.ok) throw new Error((await aRes.json().catch(() => ({}))).error ?? 'Failed to load athlete')
      const { athlete: a } = await aRes.json()
      setAthlete(a); setAutoMonthlyReport(a.auto_monthly_report ?? false)
      setProfileForm({
        first_name: a.first_name ?? '',
        last_name: a.last_name ?? '',
        position: a.position ?? '',
        height: a.height ?? (a.height_cm != null ? String(a.height_cm) + 'cm' : ''),
        sport: a.sport ?? '',
        goals: a.goals ?? '',
        sport_metrics: a.sport_metrics ?? {},
        custom_fields: a.custom_fields ?? [],
      })
      const sRes = await fetch(`/api/sessions?athlete_id=${encodeURIComponent(athleteId)}`)
      if (!sRes.ok) throw new Error((await sRes.json().catch(() => ({}))).error ?? 'Failed to load sessions')
      const { sessions: s } = await sRes.json()
      setSessions(s ?? [])
    } catch (e: any) { setPageError(e?.message ?? 'Something went wrong') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [athleteId])

  // ── Wellness at-a-glance (Overview card + header chip) ───────────
  // Self-contained, same pattern as WellnessGraph's own fetch: a failure
  // here shouldn't block the rest of the profile from loading.
  const [wellnessLatest, setWellnessLatest] = useState<WellnessCheckin | null>(null)
  const [wellnessAlert, setWellnessAlert] = useState<WellnessAlert | null>(null)
  useEffect(() => {
    if (!athleteId) return
    let cancelled = false
    fetch(`/api/wellness?athlete_id=${encodeURIComponent(athleteId)}&days=14`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load wellness'))))
      .then(json => {
        if (cancelled) return
        const list: WellnessCheckin[] = json.checkins ?? []
        setWellnessLatest(list[list.length - 1] ?? null)
        setWellnessAlert(json.alert ?? null)
      })
      .catch(() => { if (!cancelled) { setWellnessLatest(null); setWellnessAlert(null) } })
    return () => { cancelled = true }
  }, [athleteId])
  const wellnessScore = overallWellnessScore(wellnessLatest)

  // ── Notify parent (wellness alert) ────────────────────────────────
  const [alertCaretakers, setAlertCaretakers] = useState<{ id: string; caretaker_name: string; caretaker_email: string; notify_wellness_alerts: boolean | null }[]>([])
  useEffect(() => {
    if (!athleteId) return
    fetch(`/api/caretakers?athlete_id=${encodeURIComponent(athleteId)}`)
      .then(res => (res.ok ? res.json() : { caretakers: [] }))
      .then(json => setAlertCaretakers(json.caretakers ?? []))
      .catch(() => setAlertCaretakers([]))
  }, [athleteId])
  const [alertSendTo, setAlertSendTo] = useState('')
  const [alertSending, setAlertSending] = useState(false)
  const [alertMsg, setAlertMsg] = useState('')
  const sendWellnessAlert = async (email: string) => {
    if (!email.includes('@')) { setAlertMsg('Enter a valid email.'); return }
    setAlertSending(true); setAlertMsg('')
    try {
      const res = await fetch('/api/wellness/alert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId, to: email }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Failed to send')
      setAlertMsg(`Sent to ${email}!`)
    } catch (e: any) { setAlertMsg(e?.message ?? 'Failed to send') }
    setAlertSending(false)
  }
  const wellnessColor = overallScoreColor(wellnessScore)
  useEffect(() => () => { cleanupAll() }, [])

  const cleanupAll = () => {
    cancelAnimationFrame(rafRef.current); setMicLevel(0)
    try { analyserRef.current?.disconnect() } catch {}
    try { audioCtxRef.current?.close() } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop())
    audioCtxRef.current = null; analyserRef.current = null; streamRef.current = null
  }

  const startMeter = async (stream: MediaStream) => {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined
    if (!Ctx) return
    const ctx = new Ctx(); audioCtxRef.current = ctx
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyserRef.current = analyser
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteTimeDomainData(data)
      let sum = 0; for (const v of data) sum += ((v - 128) / 128) ** 2
      setMicLevel(Math.min(1, Math.sqrt(sum / data.length) * 2.5))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const startRecording = async () => {
    setPageError(null)
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null); setAudioUrl(null); setAudioPath(null); setAudioMime(null); setTranscript(''); setSummary(''); chunksRef.current = []; setSavedSessionId(null)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(e => { setPageError(e?.message ?? 'Microphone access denied'); return null })
    if (!stream) return
    streamRef.current = stream; await startMeter(stream)
    const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    const mimeType = supported.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 }); mediaRecRef.current = rec
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = async () => {
      cleanupAll()
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
      setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob)); setRecordState('transcribing')
      await transcribeBlob(blob)
    }
    rec.start(); setRecordState('recording')
  }

  const stopRecording = () => { if (mediaRecRef.current?.state !== 'inactive') mediaRecRef.current?.stop(); setRecordState('transcribing') }

  const transcribeBlob = async (blob: Blob) => {
    const mime = blob.type || 'audio/webm'
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm'
    let uploadedPath: string | null = null

    // Browser -> Supabase directly, so Vercel never sees the 4.5MB body.
    try {
      const urlRes = await fetch('/api/sessions/audio-upload-url?' + new URLSearchParams({ mime_type: mime }))
      if (urlRes.ok) {
        const { signedUrl, path } = await urlRes.json()
        const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': mime }, body: blob })
        if (putRes.ok) uploadedPath = path
      }
    } catch {
      /* fall back to inline upload below */
    }

    const fd = new FormData()
    if (uploadedPath) {
      fd.append('audio_path', uploadedPath)
    } else {
      fd.append('file', new File([blob], `recording.${ext}`, { type: mime }))
    }
    if (coachSport) fd.append('sport', coachSport)

    const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setPageError(
        res.status === 413
          ? `That recording is too large to upload (${(blob.size / 1048576).toFixed(1)}MB). Record in shorter parts, or type the transcript.`
          : (j.error ?? `Transcription failed (${res.status})`),
      )
      setRecordState('idle'); return
    }
    if (uploadedPath) { setAudioPath(uploadedPath); setAudioMime(mime) }
    const json = await res.json(); setTranscript((json.text ?? '').trim()); setRecordState('ready')
  }

  const clearRecording = () => {
    if (recordState === 'recording') { mediaRecRef.current?.stop(); cleanupAll() }
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null); setAudioUrl(null); setTranscript(''); setSummary(''); setRecordState('idle'); setSavedSessionId(null)
  }

  const saveSession = async () => {
    if (!transcript.trim()) return
    setSaving(true); setPageError(null)
    try {
      // Audio already went straight to storage during transcription — reuse that path
      // rather than uploading the same blob a second time through Vercel.
      const audio_path = audioPath
      const audio_mime = audioMime
      const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ athlete_id: athleteId, session_name: sessionName.trim() || null, transcript: transcript.trim(), shared_with_athlete: share, sport_context: coachSport || null, session_date: new Intl.DateTimeFormat('en-CA').format(new Date()), audio_path, audio_mime }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save')
      const { session } = await res.json()
      setSavedSessionId(session.id); setSummary(session.summary ?? ''); setSessionName(''); setShare(true)
      await load()
    } catch (e: any) { setPageError(e?.message ?? 'Failed to save session') }
    finally { setSaving(false) }
  }

  const toggleShare = async (sessionId: string, current: boolean) => {
    await fetch(`/api/sessions/${sessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shared_with_athlete: !current }) })
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, shared_with_athlete: !current } : s))
  }

  const loadVideos = async (sessionId: string) => {
    if (sessionVideos[sessionId]) return
    const res = await fetch(`/api/sessions/${sessionId}/videos`, { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    setSessionVideos(prev => ({ ...prev, [sessionId]: json.videos ?? [] }))
  }

  const openSession = (id: string) => {
    if (openSessionId === id) { setOpenSessionId(null); return }
    setOpenSessionId(id); loadVideos(id)
  }

  const handleVideoUpload = (file: File, sessionId: string) => {
    setVideoProgress(prev => ({ ...prev, [sessionId]: 0 }))
    setVideoEta(prev => ({ ...prev, [sessionId]: 'Preparing…' }))

    const doUpload = async () => {
      try {
        // Step 1: get a signed upload URL from our server (fast — no file transfer)
        const urlRes = await fetch(
          `/api/sessions/${sessionId}/videos/upload-url?` +
          new URLSearchParams({ file_name: file.name, mime_type: file.type || 'video/mp4' })
        )
        if (!urlRes.ok) {
          const j = await urlRes.json().catch(() => ({}))
          throw new Error(j?.error ?? 'Failed to prepare upload')
        }
        const { signedUrl, path } = await urlRes.json()

        // Step 2: upload directly to Supabase via PUT (browser → Supabase, no Next.js middleman)
        // PUT with direct file body is the correct method for Supabase signed upload URLs —
        // it skips multipart parsing overhead and is significantly faster than POST + FormData.
        const startTime = Date.now()
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.upload.onprogress = e => {
            if (!e.lengthComputable) return
            const pct = Math.round((e.loaded / e.total) * 100)
            setVideoProgress(prev => ({ ...prev, [sessionId]: pct }))
            const elapsed = (Date.now() - startTime) / 1000
            const rate = e.loaded / elapsed
            const remaining = (e.total - e.loaded) / rate
            const mbps = (rate / (1024 * 1024)).toFixed(1)
            const timeStr = remaining < 5 ? 'Almost done…' : remaining < 60 ? `~${Math.ceil(remaining)}s left` : `~${Math.ceil(remaining / 60)}min left`
            setVideoEta(prev => ({ ...prev, [sessionId]: `${mbps} MB/s · ${timeStr}` }))
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve()
            else reject(new Error(`Upload failed (${xhr.status})`))
          }
          xhr.onerror = () => reject(new Error('Upload failed — check your connection.'))
          xhr.open('PUT', signedUrl)
          xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
          xhr.setRequestHeader('x-upsert', 'false')
          xhr.send(file)
        })

        // Step 3: register the video row in our database
        const regRes = await fetch(`/api/sessions/${sessionId}/videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, file_name: file.name, mime_type: file.type || 'video/mp4' }),
        })
        if (!regRes.ok) {
          const j = await regRes.json().catch(() => ({}))
          throw new Error(j?.error ?? 'Video uploaded but failed to save record')
        }
        const { video } = await regRes.json()
        setSessionVideos(prev => ({ ...prev, [sessionId]: [...(prev[sessionId] ?? []), video] }))
      } catch (err: any) {
        setPageError(err?.message ?? 'Upload failed')
      } finally {
        setVideoProgress(prev => ({ ...prev, [sessionId]: null }))
        setVideoEta(prev => ({ ...prev, [sessionId]: '' }))
      }
    }

    void doUpload()
  }

  const saveAnnotations = async (sessionId: string, videoId: string, annotations: AnnotationStroke[]) => {
    await fetch(`/api/sessions/${sessionId}/videos?video_id=${videoId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotations }) })
    setSessionVideos(prev => ({ ...prev, [sessionId]: (prev[sessionId] ?? []).map(v => v.id === videoId ? { ...v, annotations } : v) }))
  }

  const deleteVideo = async (sessionId: string, videoId: string) => {
    if (!confirm('Delete this video?')) return
    await fetch(`/api/sessions/${sessionId}/videos?video_id=${videoId}`, { method: 'DELETE' })
    setSessionVideos(prev => ({ ...prev, [sessionId]: (prev[sessionId] ?? []).filter(v => v.id !== videoId) }))
  }

  const toggleVideoShare = async (sessionId: string, videoId: string, current: boolean) => {
    await fetch(`/api/sessions/${sessionId}/videos?video_id=${videoId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shared_with_athlete: !current }) })
    setSessionVideos(prev => ({ ...prev, [sessionId]: (prev[sessionId] ?? []).map(v => v.id === videoId ? { ...v, shared_with_athlete: !current } as any : v) }))
  }

  const saveProfile = async () => {
    setProfileSaving(true); setProfileMsg('')
    try {
      const body: any = {
        first_name: profileForm.first_name.trim(),
        last_name: profileForm.last_name.trim(),
        position: profileForm.position.trim() || null,
        height: profileForm.height.trim() || null,
        sport: profileForm.sport.trim() || null,
        goals: profileForm.goals.trim() || null,
        sport_metrics: profileForm.sport_metrics,
        custom_fields: profileForm.custom_fields,
      }
      const res = await fetch(`/api/athletes/${athleteId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed')
      const { athlete: updated } = await res.json()
      setAthlete(prev => prev ? { ...prev, ...updated } : prev)
      setProfileMsg('Saved!')
      setTimeout(() => setProfileMsg(''), 3000)
    } catch (e: any) { setProfileMsg(e?.message ?? 'Failed') }
    finally { setProfileSaving(false) }
  }

  const loadNotes = async () => {
    if (notesLoaded) return
    try {
      const res = await fetch(`/api/notes?athlete_id=${encodeURIComponent(athleteId)}`)
      if (!res.ok) return
      const json = await res.json()
      setNotes(json.notes ?? [])
      setNotesLoaded(true)
    } catch {}
  }

  const saveNote = async () => {
    if (!noteText.trim()) return
    setNoteSaving(true); setNoteMsg('')
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId, summary: noteText.trim(), shared_with_athlete: noteShared }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed')
      const json = await res.json()
      setNotes(prev => [json.note, ...prev])
      setNoteText(''); setNoteMsg('Note saved!')
      setTimeout(() => setNoteMsg(''), 3000)
    } catch (e: any) { setNoteMsg(e?.message ?? 'Failed') }
    finally { setNoteSaving(false) }
  }

  const loadPlans = async () => {
    if (plansLoaded) return
    try {
      const res = await fetch(`/api/training-plans?athlete_id=${encodeURIComponent(athleteId)}`)
      if (!res.ok) return
      const json = await res.json()
      setPlans(json.plans ?? [])
      setPlansLoaded(true)
    } catch {}
  }

  const uploadPlan = async () => {
    if (!planFile) return
    setPlanUploading(true); setPlanMsg('')
    try {
      const urlRes = await fetch('/api/training-plans/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId, file_name: planFile.name }),
      })
      if (!urlRes.ok) throw new Error((await urlRes.json().catch(() => ({}))).error ?? 'Failed to get upload URL')
      const { uploadUrl, storagePath } = await urlRes.json()

      const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: planFile, headers: { 'Content-Type': planFile.type || 'application/octet-stream' } })
      if (!uploadRes.ok) throw new Error('Upload failed')

      const registerRes = await fetch('/api/training-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          storage_path: storagePath,
          title: planTitle.trim() || planFile.name,
          file_name: planFile.name,
          mime_type: planFile.type || null,
          file_size: planFile.size,
        }),
      })
      if (!registerRes.ok) throw new Error((await registerRes.json().catch(() => ({}))).error ?? 'Failed to save plan')
      const json = await registerRes.json()
      setPlans(prev => [json.plan, ...prev])
      setPlanTitle(''); setPlanFile(null); setPlanMsg('Plan uploaded!')
      setTimeout(() => setPlanMsg(''), 3000)
    } catch (e: any) { setPlanMsg(e?.message ?? 'Upload failed') }
    finally { setPlanUploading(false) }
  }

  const deletePlan = async (id: string) => {
    if (!confirm('Delete this training plan?')) return
    try {
      const res = await fetch(`/api/training-plans?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Delete failed')
      setPlans(prev => prev.filter(p => p.id !== id))
    } catch (e: any) { setPlanMsg(e?.message ?? 'Delete failed') }
  }

  const uploadPhoto = async (file: File) => {
    setPhotoUploading(true)
    try {
      // 1. Get signed upload URL
      const urlRes = await fetch(`/api/athletes/${athleteId}/photo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileType: file.type }),
      })
      if (!urlRes.ok) throw new Error('Failed to get upload URL')
      const { uploadUrl, storagePath } = await urlRes.json()

      // 2. Upload to storage
      const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!uploadRes.ok) throw new Error('Upload failed')

      // 3. Save photo_url to athlete record
      const patchRes = await fetch(`/api/athletes/${athleteId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: storagePath }),
      })
      if (!patchRes.ok) throw new Error('Failed to save photo reference')

      // 4. Reload athlete to get new signed URL
      const reloadRes = await fetch(`/api/athletes/${athleteId}`)
      const { athlete: a } = await reloadRes.json()
      setAthlete(prev => prev ? { ...prev, photo_signed_url: a.photo_signed_url, photo_url: a.photo_url } : prev)
    } catch (e: any) { setProfileMsg(e?.message ?? 'Photo upload failed') }
    finally { setPhotoUploading(false) }
  }

  // ── Render ────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>
    </div>
  )

  const p = isMobile ? '16px' : '20px'
  const maxW = 860

  // Session list shown in Sessions tab
  const visibleSessions = sessionsShowAll ? sessions : sessions.slice(0, 3)

  // Tab definitions
  const TABS: { key: AthleteTab; label: string }[] = [
    { key: 'overview',  label: 'Overview' },
    { key: 'sessions',  label: `Sessions${sessions.length > 0 ? ` (${sessions.length})` : ''}` },
    { key: 'wellness',  label: 'Wellness' },
    { key: 'calendar',  label: 'Calendar' },
    { key: 'profile',   label: 'Profile' },
    { key: 'notes',     label: 'Notes' },
    { key: 'plans',     label: `Plans${plans.length > 0 ? ` (${plans.length})` : ''}` },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Quick Session Modal ── */}
      {showQuickSession && athlete && (
        <QuickSessionModal
          athletes={[athlete as any]}
          groups={[]}
          defaultAthleteId={athleteId}
          coachSport={coachSport}
          onClose={() => setShowQuickSession(false)}
          onSaved={() => { setShowQuickSession(false); void load() }}
        />
      )}

      {/* ── Sticky header ── */}
      <header style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: maxW, margin: '0 auto', padding: `0 ${p}`, height: 52, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/dashboard" style={{ color: 'var(--text)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, flexShrink: 0, padding: '6px 10px', borderRadius: 8, background: 'var(--bg)', border: '1.5px solid var(--border)' }}>
            <Icon name="arrow-left" size={18} /> {!isMobile && 'Dashboard'}
          </Link>
          {athlete && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                {athlete.photo_signed_url ? (
                  <img src={athlete.photo_signed_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--border)' }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--coach-color)', color: '#fff', fontWeight: 900, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {(athlete.first_name?.[0] ?? '?').toUpperCase()}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{athlete.first_name} {athlete.last_name}</div>
                  {!isMobile && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -1 }}>{athlete.email}</div>}
                </div>
                {athlete.status && <span className={`badge ${athlete.status === 'ACTIVE' ? 'badge-active' : 'badge-invited'}`} style={{ fontSize: 10, flexShrink: 0 }}>{athlete.status}</span>}
                {wellnessScore !== null && (
                  <button
                    onClick={() => setActiveTab('wellness')}
                    title={`Latest wellness score: ${wellnessScore}/5`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                      background: wellnessColor + '18', border: `1px solid ${wellnessColor}40`,
                      borderRadius: 99, padding: '2px 8px 2px 6px', cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: wellnessColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: wellnessColor }}>{wellnessScore}</span>
                  </button>
                )}
              </div>
              {/* Record Session CTA */}
              <button
                className="btn btn-coach"
                style={{ fontSize: 12, padding: '7px 14px', gap: 6, flexShrink: 0, fontWeight: 700 }}
                onClick={() => setShowQuickSession(true)}
              >
                <Icon name="mic" size={13} /> Record Session
              </button>
            </>
          )}
        </div>

        {/* Tab bar */}
        {athlete && (
          <div style={{ maxWidth: maxW, margin: '0 auto', padding: `0 ${p}`, display: 'flex', overflowX: 'auto', gap: 0, borderTop: '1px solid var(--border)' }}>
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key)
                  if (tab.key === 'notes') void loadNotes()
                  if (tab.key === 'plans') void loadPlans()
                }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 14px', fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 500,
                  color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-muted)',
                  borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                  whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.12s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <main style={{ maxWidth: maxW, margin: '0 auto', padding: `20px ${p}` }}>
        {pageError && pageError !== 'no-athlete-record' && (
          <div style={{ background: 'var(--danger-light)', border: '1px solid #fca5a5', borderRadius: 10, padding: 14, color: 'var(--danger)', fontWeight: 600, marginBottom: 20 }}>
            {pageError}
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: OVERVIEW
        ══════════════════════════════════════ */}
        {activeTab === 'overview' && athlete && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Hero card */}
            <div className="card" style={{ padding: isMobile ? 16 : 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--border)', overflow: 'hidden', border: '3px solid var(--border)', flexShrink: 0 }}>
                  {athlete.photo_signed_url
                    ? <img src={athlete.photo_signed_url} alt="profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--coach-color)', color: '#fff', fontWeight: 900, fontSize: 28 }}>{(athlete.first_name?.[0] ?? '?').toUpperCase()}</div>
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 20, lineHeight: 1.2 }}>{athlete.first_name} {athlete.last_name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{athlete.email}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {athlete.sport && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', background: 'var(--bg)', borderRadius: 99, border: '1px solid var(--border)' }}>{athlete.sport}</span>}
                    {athlete.position && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', background: 'var(--bg)', borderRadius: 99, border: '1px solid var(--border)' }}>{athlete.position}</span>}
                    {athlete.height && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', background: 'var(--bg)', borderRadius: 99, border: '1px solid var(--border)' }}>{athlete.height}</span>}
                    {athlete.status && <span className={`badge ${athlete.status === 'ACTIVE' ? 'badge-active' : 'badge-invited'}`} style={{ fontSize: 11 }}>{athlete.status}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Wellness at-a-glance */}
            <div
              className="card"
              style={{ padding: 16, cursor: 'pointer', ...(wellnessAlert?.active ? { border: '1.5px solid #ef4444' } : {}) }}
              onClick={() => setActiveTab('wellness')}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: wellnessLatest ? 12 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{wellnessAlert?.active ? '⚠️' : '💚'}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{wellnessAlert?.active ? 'Wellness — needs attention' : 'Wellness'}</div>
                    {wellnessLatest && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Last check-in: {new Date(wellnessLatest.check_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {wellnessScore !== null && (
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      background: wellnessColor + '15', borderRadius: 8, padding: '3px 9px',
                    }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: wellnessColor, lineHeight: 1 }}>{wellnessScore}</span>
                      <span style={{ fontSize: 8, color: wellnessColor, fontWeight: 700 }}>/ 5</span>
                    </div>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Details →</span>
                </div>
              </div>

              {wellnessLatest ? (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {WELLNESS_METRICS.map(({ key, label, icon }) => {
                    const score = wellnessLatest[key]
                    return (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 12 }}>{icon}</span>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: metricColor(key, score), flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{label} {score ?? '—'}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No check-ins yet — the athlete hasn&rsquo;t submitted one from their portal.</div>
              )}
            </div>

            {/* Quick stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: 'Sessions', value: sessions.length, color: '#4A6B47' },
                { label: 'Last session', value: sessions[0]?.created_at ? new Date(sessions[0].created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—', color: '#8B3E2A' },
                { label: 'Shared', value: sessions.filter(s => s.shared_with_athlete).length, color: '#9A7229' },
              ].map(stat => (
                <div key={stat.label} style={{ background: stat.color, borderRadius: 14, padding: '12px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, lineHeight: 1, color: '#fff', letterSpacing: -1 }}>{stat.value}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginTop: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Goals */}
            {athlete.goals && (
              <div className="card" style={{ padding: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Goals</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{athlete.goals}</div>
              </div>
            )}

            {/* Quick actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-coach" style={{ gap: 6, fontWeight: 700 }} onClick={() => setShowQuickSession(true)}>
                <Icon name="mic" size={14} /> Record Session
              </button>
              <Link href={`/dashboard?tab=messages&athlete=${athleteId}`} className="btn btn-ghost" style={{ gap: 6 }}>
                <Icon name="messages" size={14} /> Message
              </Link>
              <button className="btn btn-ghost" style={{ gap: 6 }} onClick={() => window.open(`/pdf/monthly/${athleteId}`, '_blank')}>
                <Icon name="report" size={14} /> Monthly Report
              </button>
              <button className="btn btn-ghost" style={{ gap: 6 }} onClick={() => { setActiveTab('notes'); void loadNotes() }}>
                <Icon name="report" size={14} /> Notes
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: SESSIONS
        ══════════════════════════════════════ */}
        {activeTab === 'sessions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="section-title">Session History</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
                <button className="btn btn-coach" style={{ fontSize: 12, padding: '6px 12px', gap: 5 }} onClick={() => setShowQuickSession(true)}>
                  <Icon name="mic" size={12} /> Record
                </button>
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}><Icon name="mic" size={32} /></div>
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No sessions yet.</div>
                <button className="btn btn-coach" style={{ marginTop: 16, gap: 6 }} onClick={() => setShowQuickSession(true)}>
                  <Icon name="mic" size={14} /> Record First Session
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {visibleSessions.map(s => {
                    const isOpen = openSessionId === s.id
                    const sVideos = sessionVideos[s.id] ?? []
                    const uploading = videoProgress[s.id] != null
                    const uploadPct = videoProgress[s.id] ?? 0

                    return (
                      <div key={s.id} className="card" style={{ overflow: 'hidden' }}>
                        <button
                          onClick={() => openSession(s.id)}
                          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.session_name ?? 'Session'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              {s.created_at ? new Date(s.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) : '—'}
                              {sVideos.length > 0 && ` · ${sVideos.length} video${sVideos.length > 1 ? 's' : ''}`}
                            </div>
                          </div>
                          <span className={`badge ${s.shared_with_athlete ? 'badge-active' : 'badge-invited'}`} style={{ fontSize: 10, flexShrink: 0 }}>
                            {s.shared_with_athlete ? 'Shared' : 'Private'}
                          </span>
                          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                            <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} />
                          </span>
                        </button>

                        <div style={{ display: 'flex', gap: 6, padding: '0 12px 12px', flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost" onClick={() => toggleShare(s.id, s.shared_with_athlete)} style={{ fontSize: 12, padding: '5px 10px', gap: 5 }}>
                            <Icon name="share" size={13} /> {s.shared_with_athlete ? 'Unshare' : 'Share'}
                          </button>
                          <button className="btn btn-ghost" onClick={() => window.open(`/pdf/session/${s.id}`, '_blank')} style={{ fontSize: 12, padding: '5px 10px', gap: 5 }}>
                            <Icon name="pdf" size={13} /> PDF
                          </button>
                          <label className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px', gap: 5, cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
                            <Icon name="video" size={13} /> {uploading ? `${uploadPct}%` : 'Video'}
                            <input type="file" accept="video/*" style={{ display: 'none' }} disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) { if (!isOpen) openSession(s.id); handleVideoUpload(f, s.id) } }} />
                          </label>
                        </div>

                        {isOpen && (
                          <div style={{ padding: '0 16px 18px', borderTop: '1px solid var(--border)' }}>
                            {s.summary && (
                              <div style={{ marginTop: 14 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>AI Summary</div>
                                <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'var(--border-soft)', padding: '12px 14px', borderRadius: 10 }}>{s.summary}</div>
                              </div>
                            )}
                            {s.transcript && (
                              <details style={{ marginTop: 12 }}>
                                <summary style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', cursor: 'pointer', padding: '8px 0' }}>Full transcript</summary>
                                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)', marginTop: 8, padding: '12px 14px', background: 'var(--border-soft)', borderRadius: 8, whiteSpace: 'pre-wrap' }}>{s.transcript}</div>
                              </details>
                            )}
                            {sVideos.length > 0 && (
                              <div style={{ marginTop: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Videos & Annotations ({sVideos.length})</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                  {sVideos.map(v => v.signedUrl && (
                                    <div key={v.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--border-soft)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 6 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>{v.file_name ?? 'Video'}</span>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                          <button className="btn btn-ghost" onClick={() => toggleVideoShare(s.id, v.id, (v as any).shared_with_athlete ?? false)} style={{ padding: '4px 10px', fontSize: 12, gap: 5 }}>
                                            <Icon name="share" size={12} /> {(v as any).shared_with_athlete ? 'Shared' : 'Share'}
                                          </button>
                                          <button className="btn btn-danger" onClick={() => deleteVideo(s.id, v.id)} style={{ padding: '4px 10px', fontSize: 12, gap: 5 }}>
                                            <Icon name="trash" size={12} /> Delete
                                          </button>
                                        </div>
                                      </div>
                                      <div style={{ padding: 14 }}>
                                        <VideoAnnotator videoUrl={v.signedUrl} initialAnnotations={v.annotations ?? []} onAnnotationsChange={strokes => saveAnnotations(s.id, v.id, strokes)} sessionId={s.id} videoId={v.id} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {uploading && <div style={{ marginTop: 12 }}><VideoUploadBar pct={uploadPct} eta={videoEta[s.id] ?? ''} /></div>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {sessions.length > 3 && (
                  <button
                    className="btn btn-ghost"
                    style={{ width: '100%', marginTop: 10, justifyContent: 'center', gap: 6 }}
                    onClick={() => setSessionsShowAll(v => !v)}
                  >
                    <Icon name={sessionsShowAll ? 'chevron-up' : 'chevron-down'} size={14} />
                    {sessionsShowAll ? 'Show less' : `Show all ${sessions.length} sessions`}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: WELLNESS
        ══════════════════════════════════════ */}
        {activeTab === 'wellness' && athlete && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {wellnessAlert?.active && (
              <div className="card" style={{ padding: 16, border: '1.5px solid #ef4444', background: '#fef2f2' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#991b1b' }}>Wellness alert</div>
                </div>
                <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 12 }}>
                  {wellnessAlert.reason === 'today' && `Today's overall score is ${wellnessAlert.todayScore}/5.`}
                  {wellnessAlert.reason === 'average' && `${athlete.first_name}'s 7-day average score is ${wellnessAlert.avgScore}/5.`}
                  {wellnessAlert.reason === 'both' && `Today's score (${wellnessAlert.todayScore}/5) and 7-day average (${wellnessAlert.avgScore}/5) are both low.`}
                  {' '}You can loop in a parent or caretaker below.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {alertCaretakers.filter(c => c.notify_wellness_alerts !== false).length > 0 && (
                    <select
                      className="input"
                      style={{ fontSize: 12, width: 'auto' }}
                      value={alertSendTo}
                      onChange={e => setAlertSendTo(e.target.value)}
                    >
                      <option value="">Choose a caretaker…</option>
                      {alertCaretakers.filter(c => c.notify_wellness_alerts !== false).map(c => (
                        <option key={c.id} value={c.caretaker_email}>{c.caretaker_name} ({c.caretaker_email})</option>
                      ))}
                    </select>
                  )}
                  <input
                    className="input" type="email" style={{ fontSize: 12, width: 200 }}
                    placeholder="or type a parent's email"
                    value={alertSendTo}
                    onChange={e => setAlertSendTo(e.target.value)}
                  />
                  <button
                    className="btn btn-danger" style={{ fontSize: 12, padding: '6px 12px' }}
                    disabled={alertSending || !alertSendTo}
                    onClick={() => sendWellnessAlert(alertSendTo)}
                  >
                    {alertSending ? 'Sending…' : 'Notify parent'}
                  </button>
                </div>
                {alertMsg && (
                  <div style={{ fontSize: 12, marginTop: 8, fontWeight: 600, color: alertMsg.includes('Sent') ? 'var(--success)' : 'var(--danger)' }}>
                    {alertMsg}
                  </div>
                )}
              </div>
            )}
            <WellnessGraph athleteId={athleteId} />
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: CALENDAR
        ══════════════════════════════════════ */}
        {activeTab === 'calendar' && athlete && (
          <div className="card" style={{ padding: isMobile ? 16 : 24 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Athlete Calendar</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              Sessions recorded with this athlete appear here. Use the main{' '}
              <button className="btn btn-ghost" style={{ fontSize: 13, padding: '2px 8px' }} onClick={() => router.push('/dashboard?tab=calendar')}>Calendar tab</button>{' '}
              to view your full schedule and add events.
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: PROFILE
        ══════════════════════════════════════ */}
        {activeTab === 'profile' && athlete && (
          <div className="card" style={{ padding: isMobile ? 16 : 24 }}>
            <div className="section-title" style={{ marginBottom: 16 }}>Athlete Profile</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '120px 1fr', gap: 20, alignItems: 'start' }}>
              {/* Photo */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--border)', overflow: 'hidden', border: '3px solid var(--border)', position: 'relative' }}>
                  {athlete.photo_signed_url
                    ? <img src={athlete.photo_signed_url} alt="profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--coach-color)', color: '#fff', fontWeight: 900, fontSize: 34 }}>{(athlete.first_name?.[0] ?? '?').toUpperCase()}</div>
                  }
                  {photoUploading && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
                      <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>…</span>
                    </div>
                  )}
                </div>
                <label style={{ cursor: 'pointer' }}>
                  <span className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}>
                    {photoUploading ? 'Uploading…' : 'Change photo'}
                  </span>
                  <input type="file" accept="image/*" style={{ display: 'none' }} disabled={photoUploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />
                </label>
              </div>

              {/* Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="label">First name</label>
                    <input className="input" value={profileForm.first_name} onChange={e => setProfileForm(f => ({ ...f, first_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Last name</label>
                    <input className="input" value={profileForm.last_name} onChange={e => setProfileForm(f => ({ ...f, last_name: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="label">Sport</label>
                  <SportWheelPicker value={profileForm.sport} onChange={v => setProfileForm(f => ({ ...f, sport: v }))} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="label">Position / Role</label>
                    <input className="input" placeholder="e.g. Striker, Setter, Sprinter" value={profileForm.position} onChange={e => setProfileForm(f => ({ ...f, position: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Height</label>
                    <input className="input" type="text" placeholder={`e.g. 6'2" or 188cm`} value={profileForm.height} onChange={e => setProfileForm(f => ({ ...f, height: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="label">Personal Goals</label>
                  <textarea className="input" rows={3} placeholder="Athlete's current goals and targets…" value={profileForm.goals} onChange={e => setProfileForm(f => ({ ...f, goals: e.target.value }))} />
                </div>

                {/* Sport-specific metrics */}
                <div>
                  <label className="label">Sport Metrics</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {Object.entries(profileForm.sport_metrics).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', minWidth: 100, padding: '6px 10px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>{k}</span>
                        <input className="input" style={{ flex: 1, fontSize: 13 }} value={v} onChange={e => setProfileForm(f => ({ ...f, sport_metrics: { ...f.sport_metrics, [k]: e.target.value } }))} />
                        <button onClick={() => setProfileForm(f => { const m = { ...f.sport_metrics }; delete m[k]; return { ...f, sport_metrics: m } })} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 18, padding: '0 4px', flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1, fontSize: 12 }} placeholder="Metric (e.g. 40m Sprint)" value={metricKey} onChange={e => setMetricKey(e.target.value)} />
                    <input className="input" style={{ flex: 1, fontSize: 12 }} placeholder="Value (e.g. 5.2s)" value={metricVal} onChange={e => setMetricVal(e.target.value)} />
                    <button className="btn btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => { if (!metricKey.trim()) return; setProfileForm(f => ({ ...f, sport_metrics: { ...f.sport_metrics, [metricKey.trim()]: metricVal.trim() } })); setMetricKey(''); setMetricVal('') }}>+ Add</button>
                  </div>
                </div>

                {/* Custom fields */}
                <div>
                  <label className="label">Custom Fields</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {profileForm.custom_fields.map((cf, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="input" style={{ flex: 1, fontSize: 12, fontWeight: 700 }} value={cf.label} onChange={e => setProfileForm(f => ({ ...f, custom_fields: f.custom_fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                        <input className="input" style={{ flex: 2, fontSize: 13 }} value={cf.value} onChange={e => setProfileForm(f => ({ ...f, custom_fields: f.custom_fields.map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))} />
                        <button onClick={() => setProfileForm(f => ({ ...f, custom_fields: f.custom_fields.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 18, padding: '0 4px', flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1, fontSize: 12 }} placeholder="Label (e.g. Club)" value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
                    <input className="input" style={{ flex: 2, fontSize: 12 }} placeholder="Value (e.g. City FC)" value={customVal} onChange={e => setCustomVal(e.target.value)} />
                    <button className="btn btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => { if (!customLabel.trim()) return; setProfileForm(f => ({ ...f, custom_fields: [...f.custom_fields, { label: customLabel.trim(), value: customVal.trim() }] })); setCustomLabel(''); setCustomVal('') }}>+ Add</button>
                  </div>
                </div>

                {/* Caretakers toggle */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Caretakers</div>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setShowCaretakers(v => !v)}>
                      {showCaretakers ? 'Hide' : 'Manage'}
                    </button>
                  </div>
                  {showCaretakers && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="card" style={{ padding: 14 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                          <input type="checkbox" checked={autoMonthlyReport} onChange={async e => {
                            const next = e.target.checked; setAutoMonthlyReport(next)
                            await fetch(`/api/athletes/${athleteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto_monthly_report: next }) })
                          }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>Auto Monthly Report</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Send monthly progress report to caretakers</div>
                          </div>
                        </label>
                      </div>
                      <CaretakerPanel athleteId={athleteId} athleteName={`${athlete.first_name} ${athlete.last_name}`} caretakers={caretakers} setCaretakers={setCaretakers} form={caretakerForm} setForm={setCaretakerForm} saving={caretakerSaving} setSaving={setCaretakerSaving} msg={caretakerMsg} setMsg={setCaretakerMsg} emailSending={emailSending} setEmailSending={setEmailSending} emailMsg={emailMsg} setEmailMsg={setEmailMsg} />
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <button className="btn btn-primary" onClick={saveProfile} disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save Profile'}</button>
                  {profileMsg && <span style={{ fontSize: 13, fontWeight: 600, color: profileMsg.includes('Saved') ? 'var(--success)' : 'var(--danger)' }}>{profileMsg}</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: NOTES
        ══════════════════════════════════════ */}
        {activeTab === 'notes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* New note form */}
            <div className="card" style={{ padding: isMobile ? 16 : 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Add Coach Note</div>
              <textarea
                className="input"
                rows={4}
                placeholder="Private coaching notes — observations, plans, reminders…"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={noteShared} onChange={e => setNoteShared(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
                  Share with athlete
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {noteMsg && <span style={{ fontSize: 13, fontWeight: 600, color: noteMsg.includes('saved') ? 'var(--success)' : 'var(--danger)' }}>{noteMsg}</span>}
                  <button className="btn btn-coach" onClick={saveNote} disabled={noteSaving || !noteText.trim()}>
                    {noteSaving ? 'Saving…' : 'Save Note'}
                  </button>
                </div>
              </div>
            </div>

            {/* Notes list */}
            {notes.length === 0 ? (
              <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                No notes yet. Add your first coaching note above.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {notes.map((n: any) => (
                  <div key={n.id} className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {n.created_at ? new Date(n.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) : '—'}
                      </span>
                      {n.shared_with_athlete && (
                        <span className="badge badge-active" style={{ fontSize: 10 }}>Shared</span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{n.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'plans' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Upload form */}
            <div className="card" style={{ padding: isMobile ? 16 : 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload Training Plan</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Any file from your phone or computer — PDF, photo, Word/Excel doc. The athlete can view and download it.
              </div>
              <input
                className="input"
                placeholder="Plan name (e.g. Week 12 Strength Block)"
                value={planTitle}
                onChange={e => setPlanTitle(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <input
                  type="file"
                  onChange={e => setPlanFile(e.target.files?.[0] ?? null)}
                  style={{ fontSize: 13, maxWidth: '100%' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {planMsg && <span style={{ fontSize: 13, fontWeight: 600, color: planMsg.includes('uploaded') ? 'var(--success)' : 'var(--danger)' }}>{planMsg}</span>}
                  <button className="btn btn-coach" onClick={uploadPlan} disabled={planUploading || !planFile}>
                    {planUploading ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
              </div>
            </div>

            {/* Plans list */}
            {plans.length === 0 ? (
              <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                No training plans yet. Upload one above.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plans.map((plan: any) => (
                  <div key={plan.id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="pdf" size={17} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {plan.created_at ? new Date(plan.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) : '—'}
                        {plan.file_name ? ` · ${plan.file_name}` : ''}
                      </div>
                    </div>
                    {plan.signedUrl && (
                      <a href={plan.signedUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 12px', flexShrink: 0 }}>
                        View
                      </a>
                    )}
                    <button onClick={() => deletePlan(plan.id)} className="btn btn-danger" style={{ fontSize: 12, padding: '7px 10px', flexShrink: 0 }}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  )
}
