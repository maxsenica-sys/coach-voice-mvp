'use client'

import { useEffect, useRef, useState, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import Calendar, { type CalendarEvent } from '@/app/components/Calendar'
import QuickSessionModal from '@/app/components/QuickSessionModal'
import MessagingPanel from '@/app/components/MessagingPanel'
import SportWheelPicker from '@/app/components/SportWheelPicker'
import { overallWellnessScore, overallScoreColor, type WellnessCheckin } from '@/lib/wellness-config'
import { apiMutate } from '@/lib/api-client'
import DayWheel, { wheelMonths, toDateStr, type WheelEvent } from '@/app/components/DayWheel'
import { readCachedProfile, writeCachedProfile, clearCachedProfile, displayName, initialsFor } from '@/lib/profile-cache'

type Tab = 'home' | 'athletes' | 'groups' | 'sessions' | 'calendar' | 'messages' | 'settings'
type CalMode = 'personal' | 'athlete' | 'group'

interface Athlete {
  id: string; first_name: string; last_name: string
  email: string; athlete_user_id: string | null; status?: 'INVITED' | 'ACTIVE'
}
interface Group {
  id: string; name: string; color: string; description: string | null
  member_count: number; member_ids: string[]
}
interface Session {
  id: string; session_name: string | null; summary: string | null
  shared_with_athlete: boolean; created_at: string
  athlete_id: string; athletes?: { id: string; first_name: string; last_name: string; email: string }
}

const GROUP_COLORS = ['#2563eb','#7c3aed','#059669','#dc2626','#d97706','#0891b2','#db2777','#65a30d']

// ── SVG Icon system ──────────────────────────────────────────────
function Icon({ name, size = 20, strokeWidth = 2 }: { name: string; size?: number; strokeWidth?: number }) {
  const s: React.CSSProperties = { width: size, height: size, display: 'block', flexShrink: 0 }
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: s }
  switch (name) {
    case 'home':     return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    case 'athletes': return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    case 'groups':   return <svg {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
    case 'sessions': return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    case 'calendar': return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    case 'messages': return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    case 'settings': return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    case 'mic':      return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    case 'plus':     return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    case 'arrow':    return <svg {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    case 'trash':    return <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    case 'copy':     return <svg {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    case 'edit':     return <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    case 'signout':  return <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
    case 'refresh':  return <svg {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.9-6.32"/></svg>
    default:         return null
  }
}

// ── Nav definitions ──────────────────────────────────────────────
const NAV_ITEMS: { key: Tab; icon: string; label: string }[] = [
  { key: 'home',     icon: 'home',     label: 'Home'     },
  { key: 'athletes', icon: 'athletes', label: 'Athletes' },
  { key: 'groups',   icon: 'groups',   label: 'Groups'   },
  { key: 'sessions', icon: 'sessions', label: 'Sessions' },
  { key: 'calendar', icon: 'calendar', label: 'Calendar' },
  { key: 'messages', icon: 'messages', label: 'Messages' },
  { key: 'settings', icon: 'settings', label: 'Settings' },
]
// 5-column Instagram-style nav: 2 | FAB | 2
const BOTTOM_NAV_ITEMS: ({ key: Tab; icon: string; label: string } | { fab: true })[] = [
  { key: 'home',     icon: 'home',     label: 'Home'     },
  { key: 'athletes', icon: 'athletes', label: 'Athletes' },
  { fab: true },
  { key: 'calendar', icon: 'calendar', label: 'Calendar' },
  { key: 'messages', icon: 'messages', label: 'Inbox' },
]

// ── Sidebar item style ───────────────────────────────────────────
function sideItem(active: boolean, color?: string) {
  return {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', borderRadius: 8, border: 'none', width: '100%',
    background: active ? (color ?? 'var(--primary)') : 'transparent',
    color: active ? '#fff' : 'var(--text-2)',
    fontWeight: active ? 700 : 500, fontSize: 13,
    cursor: 'pointer', textAlign: 'left' as const, transition: 'all 0.12s',
  }
}

// ── Avatar ───────────────────────────────────────────────────────
function Avatar({ initials, size = 38, bg = 'var(--coach-color)' }: { initials: string; size?: number; bg?: string }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: bg, color: '#fff', fontWeight: 900,
      fontSize: Math.round(size * 0.37), display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}>{initials}</div>
  )
}

// ── Simple Toast (success / error) ───────────────────────────────
interface SimpleToastData { id: string; message: string; type: 'success' | 'error' }

function SimpleToast({ data, onDismiss }: { data: SimpleToastData; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const dismiss = () => { setLeaving(true); setTimeout(onDismiss, 320) }
  useEffect(() => { const t = setTimeout(dismiss, 4000); return () => clearTimeout(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const isSuccess = data.type === 'success'
  return (
    <div style={{
      background: isSuccess ? 'var(--success)' : 'var(--danger)',
      color: '#fff',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      animation: leaving ? 'toastOut 0.32s ease forwards' : 'toastIn 0.35s ease',
      minWidth: 240,
      maxWidth: 340,
      width: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <span style={{ fontSize: 16 }}>{isSuccess ? '✓' : '✕'}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{data.message}</span>
        <button onClick={dismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.2)' }}>
        <div style={{ height: '100%', background: 'rgba(255,255,255,0.6)', animation: 'toastProgress 4s linear forwards' }} />
      </div>
    </div>
  )
}

// ── Join Toast ───────────────────────────────────────────────────
interface JoinToastData { toastId: string; athlete: Athlete }

function JoinToast({ data, onDismiss }: { data: JoinToastData; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const dismiss = () => { setLeaving(true); setTimeout(onDismiss, 320) }

  useEffect(() => {
    const t = setTimeout(dismiss, 7000)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{
      background: 'var(--coach-color)',
      color: '#fff',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgb(15 32 66 / .40)',
      border: '1px solid rgba(255,255,255,0.08)',
      animation: leaving ? 'toastOut 0.32s ease forwards' : 'toastIn 0.35s ease',
      minWidth: 290,
      maxWidth: 340,
      width: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px 12px' }}>
        {/* Blue accent bar */}
        <div style={{ width: 4, background: 'var(--primary)', borderRadius: 2, alignSelf: 'stretch', flexShrink: 0 }} />
        {/* Avatar */}
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {data.athlete.first_name[0].toUpperCase()}
        </div>
        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>{data.athlete.first_name} {data.athlete.last_name}</div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>accepted your invite</div>
        </div>
        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Link href={`/athletes/${data.athlete.id}`} style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, textDecoration: 'none', background: 'rgba(37,99,235,0.15)', padding: '4px 10px', borderRadius: 6 }}>
            View
          </Link>
          <button onClick={dismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 20, padding: 0, lineHeight: 1, display: 'flex' }}>
            ×
          </button>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)' }}>
        <div style={{ height: '100%', background: 'var(--primary)', animation: 'toastProgress 7s linear forwards', borderRadius: 0 }} />
      </div>
    </div>
  )
}

// ── Settings Tab ─────────────────────────────────────────────────
function SettingsTab({ coachName, coachSport, coachEmail, inviteCode, codeEditing, codeDraft, codeSaving, codeMsg, setCodeDraft, setCodeEditing, setCodeMsg, saveCode, onNameChange, logout }: {
  coachName: string; coachSport: string; coachEmail: string; inviteCode: string | null
  codeEditing: boolean; codeDraft: string; codeSaving: boolean; codeMsg: string
  setCodeDraft: (v: string) => void; setCodeEditing: (v: boolean) => void; setCodeMsg: (v: string) => void
  saveCode: () => void; onNameChange: (f: string, l: string, s: string, e?: string) => void; logout: () => void
}) {
  const [profileForm, setProfileForm] = useState(() => {
    const parts = coachName.trim().split(' ')
    return { first_name: parts[0] ?? '', last_name: parts.slice(1).join(' ') ?? '', sport: coachSport, email: coachEmail }
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')

  const saveProfile = async () => {
    if (!profileForm.first_name.trim() || !profileForm.last_name.trim()) {
      setProfileMsg('First and last name are required.'); return
    }
    setProfileSaving(true); setProfileMsg('')
    try {
      const res = await fetch('/api/coach-profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: profileForm.first_name, last_name: profileForm.last_name, sport: profileForm.sport, email: profileForm.email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error)
      onNameChange(json.first_name, json.last_name, json.sport ?? '', profileForm.email)
      setProfileMsg('Profile updated!')
      setTimeout(() => setProfileMsg(''), 3000)
    } catch (e: any) { setProfileMsg(e?.message ?? 'Failed') }
    finally { setProfileSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 560 }}>
      <h2 style={{ margin: 0, fontWeight: 900, fontSize: 22 }}>Settings</h2>

      {/* ── Profile ── */}
      <div className="card" style={{ padding: 26 }}>
        <div className="section-title" style={{ marginBottom: 4 }}>Your Profile</div>
        <div className="section-sub" style={{ marginBottom: 18 }}>How you appear to athletes and in session reports.</div>
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
            <label className="label">Email address</label>
            <input className="input" type="email" value={profileForm.email} onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>Changing email updates your login credentials.</p>
          </div>
          <div>
            <label className="label">Sport / discipline (optional)</label>
            <SportWheelPicker value={profileForm.sport} onChange={v => setProfileForm(f => ({ ...f, sport: v }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-primary" onClick={saveProfile} disabled={profileSaving} style={{ minWidth: 120 }}>
              {profileSaving ? 'Saving…' : 'Save profile'}
            </button>
            {profileMsg && (
              <span style={{ fontSize: 13, fontWeight: 600, color: profileMsg.includes('updated') ? 'var(--success)' : 'var(--danger)' }}>
                {profileMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Invite Code ── */}
      <div className="card" style={{ padding: 26 }}>
        <div className="section-title" style={{ marginBottom: 6 }}>Athlete Invite Code</div>
        <div className="section-sub" style={{ marginBottom: 18 }}>Share this so athletes can join your roster during sign-up.</div>
        {inviteCode && !codeEditing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, padding: '12px 16px', background: 'var(--coach-light)', border: '2px solid var(--coach-color)', borderRadius: 10, fontFamily: 'monospace', fontSize: 18, fontWeight: 900, color: 'var(--coach-color)', letterSpacing: 1 }}>{inviteCode}</div>
            <button onClick={() => { setCodeDraft(inviteCode); setCodeEditing(true); setCodeMsg('') }} className="btn btn-ghost" title="Edit"><Icon name="edit" size={14} /></button>
            <button onClick={() => { navigator.clipboard.writeText(inviteCode); setCodeMsg('Copied!') }} className="btn btn-ghost" title="Copy"><Icon name="copy" size={14} /></button>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <label className="label">Invite code</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={codeDraft} onChange={e => setCodeDraft(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="coachsmith4821" style={{ fontFamily: 'monospace', fontWeight: 700 }} />
              <button className="btn btn-primary" onClick={saveCode} disabled={codeSaving}>{codeSaving ? '…' : 'Save'}</button>
              {codeEditing && <button className="btn btn-ghost" onClick={() => { setCodeEditing(false); setCodeMsg('') }}>Cancel</button>}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>Letters, numbers, hyphens, underscores · 4–32 chars</p>
          </div>
        )}
        {codeMsg && <p style={{ fontSize: 13, fontWeight: 600, color: codeMsg.includes('Copied') || codeMsg.includes('updated') ? 'var(--success)' : 'var(--danger)' }}>{codeMsg}</p>}
        <div className="divider" />
        <div className="section-title" style={{ fontSize: 15, marginBottom: 10 }}>How athletes join</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: 'var(--text-2)' }}>
          {[['Invite via email', 'Use "Add Athlete" on the Athletes tab.'], ['Share your code', 'Athletes enter it at sign-up to auto-join your roster.']].map(([t, d], i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
              <span><strong>{t}</strong> — {d}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Account ── */}
      <div className="card" style={{ padding: 18 }}>
        <div className="section-title" style={{ fontSize: 15, marginBottom: 4 }}>Account</div>
        <div className="section-sub" style={{ marginBottom: 14 }}>Signed in as {coachName}</div>
        <button onClick={logout} className="btn btn-ghost" style={{ gap: 6, fontSize: 13, color: 'var(--danger)' }}>
          <Icon name="signout" size={14} /> Sign Out
        </button>
      </div>
    </div>
  )
}

function DashboardPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createSupabaseBrowserClient()

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Read ?tab= and ?athlete= from URL to support deep linking (e.g. from athlete profile Message button)
  const urlTab = searchParams.get('tab') as Tab | null
  const urlAthlete = searchParams.get('athlete')
  const [tab, setTab] = useState<Tab>(urlTab ?? 'home')
  const mainRef = useRef<HTMLElement>(null)

  // Scroll to top whenever tab changes
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [tab])

  // Seeded from the session cache so returning to the dashboard paints the
  // coach's real name on the first frame instead of flashing "Coach" while the
  // profile query round-trips. Revalidated in boot() below.
  const cachedProfile = readCachedProfile()
  const [coachName, setCoachName] = useState(() => (cachedProfile ? displayName(cachedProfile) : ''))
  const [coachInitials, setCoachInitials] = useState(() => (cachedProfile ? initialsFor(cachedProfile) : ''))
  const [coachSport, setCoachSport] = useState(cachedProfile?.sport ?? '')
  const [coachEmail, setCoachEmail] = useState(cachedProfile?.email ?? '')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [codeEditing, setCodeEditing] = useState(false)
  const [codeDraft, setCodeDraft] = useState('')
  const [codeMsg, setCodeMsg] = useState('')
  const [codeSaving, setCodeSaving] = useState(false)

  const [athletes, setAthletes] = useState<Athlete[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(false)
  const [wellnessByAthlete, setWellnessByAthlete] = useState<Map<string, WellnessCheckin>>(new Map())
  const [athleteSearch, setAthleteSearch] = useState('')
  const [athleteFilter, setAthleteFilter] = useState<'all' | 'ACTIVE' | 'INVITED'>('all')
  const [addForm, setAddForm] = useState({ firstName: '', lastName: '', email: '' })
  const [addMsg, setAddMsg] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [showAddAthlete, setShowAddAthlete] = useState(false)
  const [onboardStep, setOnboardStep] = useState({ code: false, athlete: false, session: false })

  const [groups, setGroups] = useState<Group[]>([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [newGroupForm, setNewGroupForm] = useState({ name: '', color: '#2563eb', description: '' })
  const [groupMsg, setGroupMsg] = useState('')
  const [groupSaving, setGroupSaving] = useState(false)
  const [addMemberMap, setAddMemberMap] = useState<Record<string, string>>({})

  const [allSessions, setAllSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessionsSearch, setSessionsSearch] = useState('')
  const [sessionsAthleteFilter, setSessionsAthleteFilter] = useState('')

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [msgPreselectedId, setMsgPreselectedId] = useState<string | null>(urlAthlete ?? null)

  const [deleteConfirmAthlete, setDeleteConfirmAthlete] = useState<Athlete | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Join notifications
  const [joinToasts, setJoinToasts] = useState<JoinToastData[]>([])
  const athletesRef = useRef<Athlete[]>([])
  const [coachUserId, setCoachUserId] = useState<string | null>(null)

  // Simple toasts (success/error)
  const [simpleToasts, setSimpleToasts] = useState<SimpleToastData[]>([])
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setSimpleToasts(prev => [...prev, { id, message, type }])
  }

  const [quickSessionOpen, setQuickSessionOpen] = useState(false)
  const [quickSessionAthleteId, setQuickSessionAthleteId] = useState<string | undefined>()
  const [quickSessionGroupId, setQuickSessionGroupId] = useState<string | undefined>()

  const [calMode, setCalMode] = useState<CalMode>('personal')
  const [calTargetId, setCalTargetId] = useState('')
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [calLoading, setCalLoading] = useState(false)
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [addEventModal, setAddEventModal] = useState<{ date: string } | null>(null)
  const [eventForm, setEventForm] = useState({ title: '', description: '', event_type: 'session', event_time: '' })
  const [eventSaving, setEventSaving] = useState(false)
  const [alsoAddToCoach, setAlsoAddToCoach] = useState(false)

  // Today's events for home tab
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([])
  const [homeWeekEvents, setHomeWeekEvents] = useState<CalendarEvent[]>([])
  const [homeSelectedDay, setHomeSelectedDay] = useState<string | null>(null)

  // The day wheel spans roughly eight weeks either side of today, which can
  // cross three or four calendar months — fetch each one the range touches and
  // merge, rather than the single current month the old seven-day strip needed.
  const refreshHomeEvents = useCallback(async () => {
    try {
      const months = wheelMonths()
      const results = await Promise.all(
        months.map((m) =>
          fetch(`/api/calendar?mode=personal&month=${m}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : { events: [] }))
            .catch(() => ({ events: [] })),
        ),
      )
      const byId = new Map<string, CalendarEvent>()
      for (const r of results) for (const ev of (r.events ?? []) as CalendarEvent[]) byId.set(ev.id, ev)
      const allEvs = Array.from(byId.values())
      const todayStr = toDateStr(new Date())
      setHomeWeekEvents(allEvs)
      setTodayEvents(allEvs.filter((e) => e.event_date === todayStr))
    } catch {
      /* leave whatever is already on screen rather than blanking the wheel */
    }
  }, [])

  useEffect(() => {
    const boot = async () => {
      // The roster, groups, sessions and unread counts are all cookie-authenticated
      // API routes — they don't need the user id on the client, so they start
      // immediately instead of queueing behind getUser() and the profile query.
      // That removes two serial round trips from every arrival on the dashboard.
      const dataReady = Promise.all([
        fetchAthletes(), fetchGroups(), fetchAllSessions(), fetchUnreadCounts(),
      ])

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase
        .from('profiles').select('role,first_name,last_name,sport,invite_code')
        .eq('id', user.id).single()

      if (profile?.role === 'athlete') { router.push('/athlete'); return }

      const name = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || (user.email ?? '')
      const initials = profile?.first_name && profile?.last_name
        ? `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase()
        : (user.email?.[0] ?? '?').toUpperCase()

      setCoachUserId(user.id)
      setCoachName(name); setCoachInitials(initials)
      setCoachSport(profile?.sport ?? '')
      setCoachEmail(user.email ?? '')

      // Keep the cache fresh so the next navigation paints instantly.
      writeCachedProfile({
        userId: user.id,
        role: 'coach',
        firstName: profile?.first_name ?? '',
        lastName: profile?.last_name ?? '',
        sport: profile?.sport ?? '',
        email: user.email ?? '',
      })
      setInviteCode(profile?.invite_code ?? null)
      if (profile?.invite_code) setCodeDraft(profile.invite_code)

      await dataReady
      await refreshHomeEvents()
    }
    void boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wellness roster summary (home tab strip + athletes tab) — self-contained
  // fetch, same pattern as the athlete profile's at-a-glance card: a failure
  // here just means no scores show, it shouldn't block anything else.
  useEffect(() => {
    let cancelled = false
    fetch('/api/wellness?days=14', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load wellness'))))
      .then(json => {
        if (cancelled) return
        const list: WellnessCheckin[] = json.checkins ?? []
        const map = new Map<string, WellnessCheckin>()
        for (const c of list) map.set(c.athlete_id, c) // ascending by check_date, so last write wins = latest
        setWellnessByAthlete(map)
      })
      .catch(() => { if (!cancelled) setWellnessByAthlete(new Map()) })
    return () => { cancelled = true }
  }, [])

  const fetchAthletes = async () => {
    setLoadingAthletes(true)
    try {
      const res = await fetch('/api/athletes', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setAthletes((json.athletes ?? json) as Athlete[])
    } finally { setLoadingAthletes(false) }
  }

  const fetchUnreadCounts = async () => {
    try {
      const res = await fetch('/api/messages/unread', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setUnreadCounts(json.counts ?? {})
    } catch {}
  }

  const fetchGroups = async () => {
    setLoadingGroups(true)
    try {
      const res = await fetch('/api/groups', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setGroups(json.groups ?? [])
    } finally { setLoadingGroups(false) }
  }

  const fetchAllSessions = async (search = '', athleteId = '') => {
    setLoadingSessions(true)
    try {
      const p = new URLSearchParams({ limit: '50' })
      if (search) p.set('search', search)
      if (athleteId) p.set('athlete_id', athleteId)
      const res = await fetch(`/api/sessions/all?${p}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setAllSessions(json.sessions ?? [])
    } finally { setLoadingSessions(false) }
  }

  const handleUnreadChange = useCallback((counts: Record<string, number>) => {
    setUnreadCounts(counts)
  }, [])

  const fetchCalendar = useCallback(async (mode: CalMode, targetId: string, month: string) => {
    // Don't fetch athlete/group calendars until a target is selected
    if ((mode === 'athlete' || mode === 'group') && !targetId) {
      setCalEvents([])
      return
    }
    setCalLoading(true)
    try {
      const p = new URLSearchParams({ month })
      if (mode === 'personal') p.set('mode', 'personal')
      else if (mode === 'group') p.set('group_id', targetId)
      else p.set('athlete_id', targetId)
      const res = await fetch(`/api/calendar?${p}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setCalEvents(json.events ?? [])
      else console.error('[Calendar fetch]', json?.error)
    } finally { setCalLoading(false) }
  }, [])

  // Keep ref in sync so Realtime closure always sees fresh athletes
  useEffect(() => { athletesRef.current = athletes }, [athletes])

  // Realtime: detect when invited athlete accepts and becomes active
  useEffect(() => {
    if (!coachUserId) return
    const channel = supabase
      .channel(`athlete-joins-${coachUserId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'athletes' }, (payload: any) => {
        const prev = payload.old
        const next = payload.new
        // Athlete just activated: had no user_id before, now has one
        if (!prev?.athlete_user_id && next?.athlete_user_id) {
          const match = athletesRef.current.find(a => a.id === next.id)
          if (match) {
            setJoinToasts(t => [...t, { toastId: `${next.id}-${Date.now()}`, athlete: match }])
            void fetchAthletes() // refresh status
          }
        }
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachUserId])

  useEffect(() => {
    if (tab === 'calendar') fetchCalendar(calMode, calTargetId, calMonth)
  }, [tab, calMode, calTargetId, calMonth, fetchCalendar])

  useEffect(() => {
    setOnboardStep(prev => ({ ...prev, code: !!inviteCode }))
  }, [inviteCode])

  const saveCode = async () => {
    setCodeSaving(true); setCodeMsg('')
    try {
      const res = await fetch('/api/coach-code', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeDraft }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error)
      setInviteCode(json.inviteCode); setCodeEditing(false); setCodeMsg('Code updated!')
    } catch (e: any) { setCodeMsg(e?.message ?? 'Failed') }
    finally { setCodeSaving(false) }
  }

  const createAthlete = async () => {
    if (!addForm.firstName.trim() || !addForm.lastName.trim() || !addForm.email.trim()) {
      setAddMsg('All fields are required.'); return
    }
    setAddLoading(true); setAddMsg('')
    try {
      const res = await fetch('/api/athletes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: addForm.firstName, last_name: addForm.lastName, email: addForm.email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error)
      setAddForm({ firstName: '', lastName: '', email: '' })
      setAddMsg('Athlete invited!'); setShowAddAthlete(false)
      await fetchAthletes()
    } catch (e: any) { setAddMsg(e?.message ?? 'Failed') }
    finally { setAddLoading(false) }
  }

  const createGroup = async () => {
    if (!newGroupForm.name.trim()) { setGroupMsg('Name is required.'); return }
    setGroupSaving(true); setGroupMsg('')
    try {
      const res = await fetch('/api/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupForm.name.trim(), color: newGroupForm.color, description: newGroupForm.description.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error)
      setGroups(prev => [json.group, ...prev])
      setNewGroupForm({ name: '', color: '#2563eb', description: '' })
    } catch (e: any) { setGroupMsg(e?.message ?? 'Failed') }
    finally { setGroupSaving(false) }
  }

  const deleteGroup = async (id: string) => {
    if (!confirm('Delete this group? Athletes are not removed.')) return
    try {
      await apiMutate(`/api/groups?id=${id}`, { method: 'DELETE' })
    } catch (e: any) {
      showToast(e?.message ?? 'Could not delete the group', 'error')
      return
    }
    setGroups(prev => prev.filter(g => g.id !== id))
    if (expandedGroup === id) setExpandedGroup(null)
  }

  const addMemberToGroup = async (groupId: string) => {
    const athleteId = addMemberMap[groupId]
    if (!athleteId) return
    const res = await fetch(`/api/groups/${groupId}/members`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athlete_id: athleteId }),
    })
    if (res.ok) { setAddMemberMap(prev => ({ ...prev, [groupId]: '' })); await fetchGroups() }
  }

  const removeMemberFromGroup = async (groupId: string, athleteId: string) => {
    try {
      await apiMutate(`/api/groups/${groupId}/members?athlete_id=${athleteId}`, { method: 'DELETE' })
    } catch (e: any) {
      showToast(e?.message ?? 'Could not remove that athlete', 'error')
      return
    }
    await fetchGroups()
  }

  const saveEvent = async () => {
    if (!addEventModal || !eventForm.title.trim()) return
    setEventSaving(true)
    try {
      const base = {
        title: eventForm.title, description: eventForm.description || null,
        event_type: eventForm.event_type, event_date: addEventModal.date,
        event_time: eventForm.event_time || null,
      }
      const body: Record<string, any> = { ...base }
      if (calMode === 'athlete') body.athlete_id = calTargetId
      else if (calMode === 'group') body.group_id = calTargetId

      const res = await fetch('/api/calendar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        showToast(json?.error ?? 'Failed to save event', 'error')
        return
      }

      // Optionally also add the same event to coach's personal calendar.
      // The athlete's copy is already saved at this point, so a failure here is
      // reported but doesn't discard that.
      let coachCopyFailed = false
      if (alsoAddToCoach && (calMode === 'athlete' || calMode === 'group')) {
        try {
          await apiMutate('/api/calendar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(base), // no athlete_id/group_id = personal event
          })
        } catch {
          coachCopyFailed = true
        }
      }

      setAddEventModal(null)
      setEventForm({ title: '', description: '', event_type: 'session', event_time: '' })
      setAlsoAddToCoach(false)
      await fetchCalendar(calMode, calTargetId, calMonth)

      // Refresh the wheel so a new event shows without a page reload.
      await refreshHomeEvents()

      const label = calMode === 'group' ? 'Event added for group' : 'Event added to calendar'
      if (coachCopyFailed) {
        showToast(`${label}, but it could not be added to your own calendar`, 'error')
      } else {
        showToast(`✓ ${label}${alsoAddToCoach ? ' + your calendar' : ''}`)
      }
    } catch {
      showToast('Failed to save event', 'error')
    } finally { setEventSaving(false) }
  }

  const deleteEvent = async (id: string) => {
    try {
      await apiMutate(`/api/calendar?id=${id}`, { method: 'DELETE' })
    } catch (e: any) {
      showToast(e?.message ?? 'Could not delete the event', 'error')
      return
    }
    setCalEvents(prev => prev.filter(e => e.id !== id))
  }

  const confirmDelete = async () => {
    if (!deleteConfirmAthlete) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/athletes/${deleteConfirmAthlete.id}/hard-delete`, { method: 'POST' })
      if (res.ok) {
        setDeleteConfirmAthlete(null)
        await fetchAthletes()
      } else {
        const json = await res.json().catch(() => ({}))
        alert(json?.error ?? 'Delete failed')
      }
    } finally { setDeleteLoading(false) }
  }

  const logout = async () => { clearCachedProfile(); await supabase.auth.signOut(); router.push('/') }

  const filteredAthletes = athletes.filter(a => {
    const status = a.status ?? (a.athlete_user_id ? 'ACTIVE' : 'INVITED')
    if (athleteFilter !== 'all' && status !== athleteFilter) return false
    const s = athleteSearch.toLowerCase()
    return !s || a.first_name.toLowerCase().includes(s) || a.last_name.toLowerCase().includes(s) || a.email.toLowerCase().includes(s)
  })
  const activeAthletes = athletes.filter(a => a.athlete_user_id)
  const recentSessions = allSessions.slice(0, 3)
  const thisWeek = allSessions.filter(s => Date.now() - new Date(s.created_at).getTime() < 7 * 86400000)
  const totalUnreadAll = Object.values(unreadCounts).reduce((a: number, b: number) => a + b, 0)

  const calTitle = calMode === 'personal'
    ? 'My Calendar'
    : calMode === 'group'
      ? (groups.find(g => g.id === calTargetId)?.name ?? 'Group') + ' Calendar'
      : (() => { const a = athletes.find(a => a.id === calTargetId); return a ? `${a.first_name}'s Calendar` : 'Calendar' })()
  const calSubtitle = calMode === 'personal'
    ? 'Personal events only you can see'
    : calMode === 'group'
      ? `Event is added for all ${groups.find(g => g.id === calTargetId)?.member_count ?? 0} athletes in this group`
      : 'Only what you add here is visible to the athlete'

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = coachName.split(' ')[0]

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ════════ DESKTOP SIDEBAR ════════ */}
      {!isMobile && (
        <nav style={{
          width: 220, minWidth: 220,
          background: 'linear-gradient(180deg, #1F2421 0%, #3a4f38 100%)',
          display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', zIndex: 100,
        }}>
          {/* Logo */}
          <div style={{ padding: '22px 18px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgb(111 142 107 / .4)' }}>
                <Icon name="mic" size={18} strokeWidth={2.5} />
              </div>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: -0.3, lineHeight: 1.1, color: '#fff' }}>CoachVoice</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 }}>COACH PORTAL</div>
              </div>
            </div>
          </div>

          {/* Record button */}
          <div style={{ padding: '0 12px 12px' }}>
            <button
              onClick={() => { setQuickSessionAthleteId(undefined); setQuickSessionGroupId(undefined); setQuickSessionOpen(true) }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 12px', fontSize: 14, fontWeight: 800,
                background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
                color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer',
                boxShadow: '0 4px 16px rgb(111 142 107 / .4)',
                transition: 'all 0.18s ease',
              }}
            >
              <Icon name="mic" size={15} /> Record Session
            </button>
          </div>

          {/* Nav items */}
          <div style={{ flex: 1, padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV_ITEMS.map(item => {
              const unread = item.key === 'messages' ? totalUnreadAll : 0
              const active = tab === item.key
              return (
                <button key={item.key} onClick={() => setTab(item.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 9, border: 'none', width: '100%',
                  background: active ? 'rgba(111,142,107,0.25)' : 'transparent',
                  color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                  fontWeight: active ? 700 : 500, fontSize: 13,
                  cursor: 'pointer', textAlign: 'left' as const, transition: 'all 0.12s',
                  borderLeft: active ? '3px solid var(--primary)' : '3px solid transparent',
                }}>
                  <Icon name={item.icon} size={17} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {unread > 0 && (
                    <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: 99, minWidth: 18, height: 18, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                      {unread}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Coach info */}
          <div style={{ padding: '14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Avatar initials={coachInitials} size={34} bg="linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#fff' }}>{coachName}</div>
                {coachSport && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{coachSport}</div>}
              </div>
            </div>
            <button onClick={logout} style={{ width: '100%', fontSize: 13, padding: '8px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'rgba(255,255,255,0.55)', transition: 'all 0.12s' }}>
              <Icon name="signout" size={13} /> Sign Out
            </button>
          </div>
        </nav>
      )}

      {/* ════════ MAIN CONTENT ════════ */}
      <main ref={mainRef} style={{
        flex: 1, overflowY: 'auto',
        maxHeight: isMobile ? 'calc(100dvh - 60px)' : '100vh',
        paddingBottom: isMobile ? 'max(100px, calc(80px + env(safe-area-inset-bottom)))' : 0,
      }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 100,
            background: 'rgba(251,248,243,0.94)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid #E3DED2',
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: '#1F2421', color: '#fff', fontWeight: 800, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: 0.2,
              }}>{coachInitials}</div>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: '#9BA29B', letterSpacing: 1, textTransform: 'uppercase' }}>
                  {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2421', marginTop: 1 }}>{coachName || 'Coach'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setTab('messages')} style={{
                width: 36, height: 36, borderRadius: 10, background: '#FFFFFF',
                border: '1px solid #E3DED2', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5D6661', cursor: 'pointer',
              }}>
                <Icon name="messages" size={15} strokeWidth={1.8} />
                {totalUnreadAll > 0 && <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: '50%', background: '#B55C3E', border: '1.5px solid #FFFFFF' }} />}
              </button>
              <button onClick={() => setTab('settings')} style={{
                width: 36, height: 36, borderRadius: 10, background: '#FFFFFF',
                border: '1px solid #E3DED2',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5D6661', cursor: 'pointer',
              }}>
                <Icon name="settings" size={15} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        )}


<div style={{ padding: isMobile ? '16px' : '28px' }}>

          {/* ════ HOME TAB ════ */}
          {tab === 'home' && (() => {
            // Day maths now lives in DayWheel, which spans months rather than
            // one fixed week.
            const _toneColors = ['#B55C3E','#6F8E6B','#C9933A']
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Greeting */}
                <div style={{ paddingBottom: 4, textAlign: 'center' }}>
                  <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 30, letterSpacing: -0.8, lineHeight: 1.1, color: '#1F2421' }}>
                    {greeting}, <span style={{ fontStyle: 'italic', fontWeight: 500 }}>{firstName || 'Coach'}.</span>
                  </h1>
                </div>

                {/* Stats — 3 cards with delta sub-text */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {([
                    { label: 'Athletes', value: athletes.length, color: '#4A6B47', delta: athletes.length > 0 ? `${athletes.filter(a => a.athlete_user_id).length} active` : 'none yet', tab: 'athletes' as Tab },
                    { label: 'Sessions', value: thisWeek.length, color: '#8B3E2A', delta: 'this week', tab: 'sessions' as Tab },
                    { label: 'Unread',   value: totalUnreadAll,  color: '#9A7229', delta: totalUnreadAll > 0 ? 'messages' : 'all clear', tab: 'messages' as Tab },
                  ]).map(stat => (
                    <button key={stat.label} onClick={() => setTab(stat.tab)} style={{
                      background: stat.color, border: 'none',
                      borderRadius: 14, padding: '11px 11px 10px',
                      position: 'relative', overflow: 'hidden',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.18s ease',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 30, lineHeight: 1, color: '#FFFFFF', letterSpacing: -1.5, marginTop: 4 }}>{stat.value}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginTop: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>{stat.label}</div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)', marginTop: 3, fontWeight: 600 }}>{stat.delta}</div>
                    </button>
                  ))}
                </div>

                {/* Day wheel — scrolls back through what you've done and
                    forward through what's booked, with a Today control. */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -22 }}>
                    <button onClick={() => setTab('calendar')} style={{ fontSize: 10, color: '#9BA29B', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: 0, position: 'relative', zIndex: 1 }}>
                      Calendar <Icon name="arrow" size={9} />
                    </button>
                  </div>
                  <DayWheel
                    events={homeWeekEvents as WheelEvent[]}
                    selectedDay={homeSelectedDay}
                    onSelectDay={setHomeSelectedDay}
                  />
                </div>

                {/* Today's sessions — time-based list */}
                {todayEvents.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#5D6661', textTransform: 'uppercase', letterSpacing: 1.2 }}>Today</div>
                      <div style={{ fontSize: 10, color: '#9BA29B' }}>{todayEvents.length} event{todayEvents.length !== 1 ? 's' : ''}</div>
                    </div>
                    <div style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E3DED2', overflow: 'hidden' }}>
                      {todayEvents.map((ev, i) => {
                        const m = ev.event_time?.match(/^(\d+):(\d+)/)
                        const hrs = m ? parseInt(m[1]) : null
                        const mins = m ? m[2] : null
                        const ampm = hrs !== null ? (hrs >= 12 ? 'pm' : 'am') : null
                        const dh = hrs !== null ? (hrs > 12 ? hrs - 12 : hrs === 0 ? 12 : hrs) : null
                        return (
                          <Link key={ev.id} href={ev.athlete_id ? `/athletes/${ev.athlete_id}` : '#'} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderTop: i === 0 ? 'none' : '1px solid #EFEAE0', textDecoration: 'none', color: 'inherit', cursor: ev.athlete_id ? 'pointer' : 'default' }}>
                            <div style={{ minWidth: 38, flexShrink: 0 }}>
                              {dh !== null ? (
                                <>
                                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500, color: '#1F2421', lineHeight: 1, letterSpacing: -0.4 }}>{dh}:{mins}</div>
                                  <div style={{ fontSize: 9, color: '#9BA29B', marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{ampm}</div>
                                </>
                              ) : <div style={{ fontSize: 12, color: '#9BA29B' }}>—</div>}
                            </div>
                            <div style={{ width: 1, alignSelf: 'stretch', background: '#EFEAE0', flexShrink: 0 }} />
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: _toneColors[i % 3], color: '#fff', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {(ev.title[0] ?? '?').toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 12.5, color: '#1F2421', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
                              {ev.event_type && <div style={{ fontSize: 11, color: '#5D6661', marginTop: 1 }}>{ev.event_type}</div>}
                            </div>
                            <Icon name="arrow" size={13} strokeWidth={1.8} />
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Invite code banner */}
                {!inviteCode && (
                  <div style={{ background: '#1F2421', color: '#FBF8F3', borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>Set your invite code</div>
                      <div style={{ fontSize: 13, opacity: 0.7, marginTop: 3 }}>Athletes need your code to join your roster.</div>
                    </div>
                    <button className="btn" onClick={() => setTab('settings')} style={{ background: '#B55C3E', color: '#fff', fontWeight: 800, flexShrink: 0, border: 'none' }}>
                      Settings
                    </button>
                  </div>
                )}

                {/* Recent sessions */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#5D6661', textTransform: 'uppercase', letterSpacing: 1.2 }}>Recent sessions</div>
                    <button onClick={() => setTab('sessions')} style={{ fontSize: 10, color: '#9BA29B', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}>
                      All <Icon name="arrow" size={9} />
                    </button>
                  </div>
                  {loadingSessions ? (
                    <div style={{ color: '#9BA29B', textAlign: 'center', padding: 20, fontSize: 14 }}>Loading…</div>
                  ) : recentSessions.length === 0 ? (
                    <div style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E3DED2', padding: '24px', textAlign: 'center' }}>
                      <div style={{ color: '#9BA29B', fontSize: 14, marginBottom: 12 }}>No sessions yet.</div>
                      <button className="btn btn-primary" onClick={() => { setQuickSessionAthleteId(undefined); setQuickSessionGroupId(undefined); setQuickSessionOpen(true) }} style={{ gap: 6 }}>
                        <Icon name="mic" size={15} /> Record your first session
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {recentSessions.map((s, i) => {
                        const a = s.athletes
                        const initials = a ? `${a.first_name[0] ?? ''}${a.last_name[0] ?? ''}`.toUpperCase() : '?'
                        const tone = _toneColors[i % 3]
                        const ago = (() => {
                          const diff = Date.now() - new Date(s.created_at).getTime()
                          const h = Math.floor(diff / 3600000)
                          if (h < 1) return 'just now'
                          if (h < 24) return `${h}h`
                          const d = Math.floor(h / 24)
                          return d === 1 ? 'Yesterday' : `${d}d`
                        })()
                        return (
                          // Opens the session, not its athlete. The Sessions tab
                          // was fixed for this; the home list had been missed.
                          <Link key={s.id} href={`/sessions/${s.id}`} style={{ background: '#FFFFFF', borderRadius: 12, padding: '11px 12px', border: '1px solid #E3DED2', display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <div style={{ width: 34, height: 34, borderRadius: '50%', background: tone, color: '#fff', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials}</div>
                              <div style={{ position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #FFFFFF' }}>
                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#F4DED3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#B55C3E' }}>
                                  <Icon name="mic" size={8} strokeWidth={2.4} />
                                </div>
                              </div>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                <span style={{ fontWeight: 700, fontSize: 12.5, color: '#1F2421' }}>{a ? `${a.first_name} ${a.last_name}` : 'Unknown'}</span>
                                <span style={{ fontSize: 10, color: '#9BA29B' }}>· {ago}</span>
                              </div>
                              <div style={{ fontSize: 11.5, color: '#5D6661', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.session_name ?? 'Session'}</div>
                            </div>
                            <div style={{ fontSize: 9, fontWeight: 700, padding: '3px 7px', borderRadius: 99, letterSpacing: 0.3, flexShrink: 0, ...(s.shared_with_athlete ? { color: '#4F6B4B', background: '#E6ECDF', border: '1px solid #CBD7C0' } : { color: '#5D6661', background: '#EFEAE0', border: '1px solid #E3DED2' }) }}>
                              {s.shared_with_athlete ? 'SHARED' : 'DRAFT'}
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Your athletes — horizontal scroll strip */}
                {athletes.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#5D6661', textTransform: 'uppercase', letterSpacing: 1.2 }}>Athletes</div>
                      <button onClick={() => setTab('athletes')} style={{ fontSize: 10, color: '#9BA29B', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}>
                        Roster <Icon name="arrow" size={9} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 9, overflowX: 'auto', marginLeft: -16, marginRight: -16, padding: '0 16px 4px', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                      {athletes.slice(0, 8).map((a, i) => {
                        const status = a.status ?? (a.athlete_user_id ? 'ACTIVE' : 'INVITED')
                        const unread = (unreadCounts[a.id] ?? 0) as number
                        const tone = _toneColors[i % 3]
                        const wellnessScore = overallWellnessScore(wellnessByAthlete.get(a.id) ?? null)
                        const wellnessColor = overallScoreColor(wellnessScore)
                        return (
                          <div key={a.id} style={{ minWidth: 78, background: '#FFFFFF', borderRadius: 14, border: '1px solid #E3DED2', padding: '12px 8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative', flexShrink: 0 }}>
                            {unread > 0 && <div style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 99, background: '#B55C3E', color: '#fff', fontSize: 9, fontWeight: 800, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread}</div>}
                            <div style={{ width: 42, height: 42, borderRadius: '50%', background: tone, color: '#fff', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {(a.first_name?.[0] ?? '?').toUpperCase()}
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 11.5, color: '#1F2421', marginTop: 1 }}>{a.first_name}</div>
                            {wellnessScore !== null ? (
                              <div title={`Wellness ${wellnessScore}/5`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: wellnessColor, flexShrink: 0 }} />
                                <span style={{ fontSize: 9.5, fontWeight: 800, color: wellnessColor }}>{wellnessScore}</span>
                              </div>
                            ) : (
                              <div style={{ fontSize: 9, color: status === 'INVITED' ? '#C9933A' : '#9BA29B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{status === 'INVITED' ? 'Pending' : 'Active'}</div>
                            )}
                          </div>
                        )
                      })}
                      <button onClick={() => { setTab('athletes'); setShowAddAthlete(true) }} style={{ minWidth: 78, background: 'transparent', borderRadius: 14, border: '1.5px dashed #E3DED2', padding: '12px 8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#9BA29B', cursor: 'pointer', flexShrink: 0 }}>
                        <div style={{ width: 42, height: 42, borderRadius: '50%', border: '1.5px dashed #9BA29B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="plus" size={18} />
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600 }}>Invite</div>
                      </button>
                    </div>
                  </div>
                )}

                {/* Onboarding flow (empty state) */}
                {athletes.length === 0 && !loadingAthletes && (() => {
                  const completedCount = onboardStep.code ? 1 : 0
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/* Header */}
                      <div>
                        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 28, letterSpacing: -0.6, fontStyle: 'italic', color: '#1F2421' }}>
                          You're all set up.
                        </h2>
                        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#5D6661' }}>
                          Complete these steps to get started with your first athlete.
                        </p>
                        <div style={{ fontSize: 11, fontWeight: 700, color: completedCount > 0 ? 'var(--primary)' : '#9BA29B', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                          {completedCount} of 3 complete
                        </div>
                      </div>

                      {/* Step 1 — Set invite code */}
                      <div style={{ background: '#FFFFFF', border: `1px solid ${onboardStep.code ? '#CBD7C0' : '#E3DED2'}`, borderLeft: `4px solid ${onboardStep.code ? 'var(--primary)' : '#E3DED2'}`, borderRadius: 14, padding: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: onboardStep.code ? 'var(--primary)' : '#EFEAE0', color: onboardStep.code ? '#fff' : '#5D6661', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                          {onboardStep.code ? '✓' : '1'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#1F2421', marginBottom: 3 }}>Set your invite code</div>
                          <div style={{ fontSize: 13, color: '#5D6661', marginBottom: 10 }}>Athletes enter this code when signing up to join your roster automatically.</div>
                          {onboardStep.code ? (
                            <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 900, color: 'var(--primary)', background: 'var(--primary-light)', borderRadius: 8, padding: '6px 12px', display: 'inline-block', letterSpacing: 1 }}>{inviteCode}</div>
                          ) : (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                className="input"
                                value={codeDraft}
                                onChange={e => setCodeDraft(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                                placeholder="coachsmith4821"
                                style={{ fontFamily: 'monospace', fontWeight: 700, maxWidth: 200 }}
                              />
                              <button className="btn btn-primary" onClick={saveCode} disabled={codeSaving || !codeDraft.trim()}>
                                {codeSaving ? '…' : 'Save'}
                              </button>
                            </div>
                          )}
                          {codeMsg && <div style={{ fontSize: 12, color: codeMsg.includes('updated') || codeMsg.includes('Copied') ? 'var(--success)' : 'var(--danger)', marginTop: 6, fontWeight: 600 }}>{codeMsg}</div>}
                        </div>
                      </div>

                      {/* Step 2 — Add first athlete */}
                      <div style={{ background: '#FFFFFF', border: '1px solid #E3DED2', borderLeft: '4px solid #E3DED2', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#EFEAE0', color: '#5D6661', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>2</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#1F2421', marginBottom: 3 }}>Add your first athlete</div>
                          <div style={{ fontSize: 13, color: '#5D6661', marginBottom: 10 }}>Invite them by email — they'll get a link to set up their account.</div>
                          <button className="btn btn-primary" onClick={() => setShowAddAthlete(true)} style={{ gap: 6 }}>
                            <Icon name="plus" size={14} /> Add Athlete →
                          </button>
                        </div>
                      </div>

                      {/* Step 3 — Record first session */}
                      <div style={{ background: '#FFFFFF', border: '1px solid #E3DED2', borderLeft: '4px solid #E3DED2', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#EFEAE0', color: '#5D6661', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>3</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#1F2421', marginBottom: 3 }}>Record your first session</div>
                          <div style={{ fontSize: 13, color: '#5D6661', marginBottom: 10 }}>After a training session, hit record and speak your notes. AI transcribes and summarises.</div>
                          <button className="btn btn-primary" onClick={() => { setQuickSessionAthleteId(undefined); setQuickSessionGroupId(undefined); setQuickSessionOpen(true) }} style={{ gap: 6 }}>
                            <Icon name="mic" size={14} /> Record Session →
                          </button>
                        </div>
                      </div>

                      {/* Share card — only if invite code is set */}
                      {inviteCode && (
                        <div style={{ background: '#1F2421', color: '#FBF8F3', borderRadius: 14, padding: '16px 20px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Share this with your athletes</div>
                          <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 900, letterSpacing: 2, marginBottom: 14, color: '#FBF8F3' }}>{inviteCode}</div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                              className="btn"
                              onClick={() => { navigator.clipboard.writeText(inviteCode); setCodeMsg('Copied!'); setTimeout(() => setCodeMsg(''), 2000) }}
                              style={{ background: 'rgba(255,255,255,0.12)', color: '#FBF8F3', border: '1px solid rgba(255,255,255,0.18)', gap: 6 }}
                            >
                              <Icon name="copy" size={13} /> Copy code
                            </button>
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Or go to Athletes tab to invite by email</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}

              </div>
            )
          })()}

          {/* ════ ATHLETES TAB ════ */}
          {tab === 'athletes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, fontWeight: 900, fontSize: 22 }}>Athletes</h2>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{athletes.length} total · {activeAthletes.length} active</div>
                </div>
                <button className="btn btn-primary" onClick={() => setShowAddAthlete(true)} style={{ gap: 6 }}>
                  <Icon name="plus" size={14} /> Add Athlete
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input" placeholder="Search…" value={athleteSearch} onChange={e => setAthleteSearch(e.target.value)} style={{ maxWidth: 260 }} />
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['all','ACTIVE','INVITED'] as const).map(f => (
                    <button key={f} onClick={() => setAthleteFilter(f)} style={{ padding: '7px 12px', borderRadius: 7, border: '1.5px solid', borderColor: athleteFilter === f ? 'var(--primary)' : 'var(--border)', background: athleteFilter === f ? 'var(--primary)' : 'transparent', color: athleteFilter === f ? '#fff' : 'var(--text-2)', fontSize: 12, fontWeight: athleteFilter === f ? 700 : 400, cursor: 'pointer' }}>
                      {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost" onClick={fetchAthletes} disabled={loadingAthletes} style={{ fontSize: 12, padding: '7px 10px' }}>
                  <Icon name="refresh" size={14} />
                </button>
              </div>

              {filteredAthletes.length === 0 ? (
                <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  {athletes.length === 0 ? 'No athletes yet. Add one to get started.' : 'No athletes match your search.'}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
                  {filteredAthletes.map(a => {
                    const status = (a.status ?? (a.athlete_user_id ? 'ACTIVE' : 'INVITED')).toUpperCase()
                    const last = allSessions.find(s => s.athlete_id === a.id)
                    const count = allSessions.filter(s => s.athlete_id === a.id).length
                    return (
                      <div key={a.id} className="card" style={{ padding: 16 }}>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <Avatar initials={(a.first_name?.[0] ?? '?').toUpperCase()} size={44} bg="var(--coach-color)" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <Link href={`/athletes/${a.id}`} style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', textDecoration: 'none' }}>{a.first_name} {a.last_name}</Link>
                              <span className={`badge ${status === 'ACTIVE' ? 'badge-active' : 'badge-invited'}`} style={{ fontSize: 10 }}>{status}</span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.email}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                              {last ? `Last session ${new Date(last.created_at).toLocaleDateString()}` : 'No sessions yet'}
                              {count > 0 && ` · ${count} total`}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                          <Link href={`/athletes/${a.id}`} className="btn btn-ghost" style={{ flex: 1, textAlign: 'center', fontSize: 12, padding: 7 }}>View</Link>
                          <button onClick={() => { setQuickSessionAthleteId(a.id); setQuickSessionGroupId(undefined); setQuickSessionOpen(true) }} className="btn btn-primary" style={{ fontSize: 12, padding: '7px 12px' }} title="Record session">
                            <Icon name="mic" size={14} />
                          </button>
                          <button onClick={() => { setMsgPreselectedId(a.id); setTab('messages') }} className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 12px', position: 'relative' }} title="Message">
                            <Icon name="messages" size={14} />
                            {(unreadCounts[a.id] ?? 0) > 0 && <span style={{ position: 'absolute', top: 3, right: 3, width: 8, height: 8, background: 'var(--primary)', borderRadius: '50%' }} />}
                          </button>
                          <button onClick={() => { setTab('calendar'); setCalMode('athlete'); setCalTargetId(a.id) }} className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 12px' }} title="Calendar">
                            <Icon name="calendar" size={14} />
                          </button>
                          <button onClick={() => setDeleteConfirmAthlete(a)} className="btn btn-danger" style={{ fontSize: 12, padding: '7px 10px' }}>
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ════ GROUPS TAB ════ */}
          {tab === 'groups' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <h2 style={{ margin: 0, fontWeight: 900, fontSize: 22 }}>Groups & Squads</h2>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>Record one session for an entire group at once</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', gap: 18, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {loadingGroups ? (
                    <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
                  ) : groups.length === 0 ? (
                    <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No groups yet. Create one.</div>
                  ) : groups.map(g => {
                    const isExp = expandedGroup === g.id
                    const members = athletes.filter(a => g.member_ids.includes(a.id))
                    const nonMembers = athletes.filter(a => !g.member_ids.includes(a.id))
                    return (
                      <div key={g.id} className="card" style={{ overflow: 'hidden', padding: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 800, fontSize: 15 }}>{g.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.member_count} athlete{g.member_count !== 1 ? 's' : ''}{g.description ? ` · ${g.description}` : ''}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => { setQuickSessionAthleteId(undefined); setQuickSessionGroupId(g.id); setQuickSessionOpen(true) }} className="btn btn-primary" style={{ fontSize: 12, padding: '6px 10px', gap: 5 }}>
                              <Icon name="mic" size={13} /> Record
                            </button>
                            <button onClick={() => { setTab('calendar'); setCalMode('group'); setCalTargetId(g.id) }} className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 8px' }} title="Group calendar">
                              <Icon name="calendar" size={14} />
                            </button>
                            <button onClick={() => setExpandedGroup(isExp ? null : g.id)} className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 8px' }}>
                              {isExp ? '▲' : '▼'}
                            </button>
                            <button onClick={() => deleteGroup(g.id)} className="btn btn-danger" style={{ fontSize: 12, padding: '6px 8px' }}>
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                        </div>
                        {isExp && (
                          <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', background: 'var(--bg)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>Members</div>
                            {members.length === 0
                              ? <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>No members yet.</div>
                              : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
                                  {members.map(a => (
                                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                                      <span style={{ fontSize: 13 }}>{a.first_name} {a.last_name}</span>
                                      <button onClick={() => removeMemberFromGroup(g.id, a.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
                                    </div>
                                  ))}
                                </div>
                              )
                            }
                            {nonMembers.length > 0 && (
                              <div style={{ display: 'flex', gap: 8 }}>
                                <select className="input" value={addMemberMap[g.id] ?? ''} onChange={e => setAddMemberMap(prev => ({ ...prev, [g.id]: e.target.value }))} style={{ flex: 1, fontSize: 13 }}>
                                  <option value="">Add athlete…</option>
                                  {nonMembers.map(a => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
                                </select>
                                <button className="btn btn-primary" onClick={() => addMemberToGroup(g.id)} disabled={!addMemberMap[g.id]}>Add</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="card" style={{ padding: 22 }}>
                  <div className="section-title" style={{ fontSize: 15, marginBottom: 4 }}>Create Group</div>
                  <div className="section-sub" style={{ marginBottom: 16 }}>Record one session for all members at once.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label className="label">Name *</label>
                      <input className="input" placeholder="Sprint Squad, U18 Boys…" value={newGroupForm.name} onChange={e => setNewGroupForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Colour</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {GROUP_COLORS.map(c => (
                          <button key={c} onClick={() => setNewGroupForm(f => ({ ...f, color: c }))} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: newGroupForm.color === c ? '3px solid var(--text)' : '3px solid transparent', cursor: 'pointer' }} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="label">Description (optional)</label>
                      <input className="input" placeholder="Tue/Thu sprint group…" value={newGroupForm.description} onChange={e => setNewGroupForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    {groupMsg && <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600, margin: 0 }}>{groupMsg}</p>}
                    <button className="btn btn-primary btn-lg" onClick={createGroup} disabled={groupSaving || !newGroupForm.name.trim()}>
                      {groupSaving ? 'Creating…' : 'Create Group'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ SESSIONS TAB ════ */}
          {tab === 'sessions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontWeight: 900, fontSize: 22 }}>All Sessions</h2>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{allSessions.length} session{allSessions.length !== 1 ? 's' : ''}</div>
                </div>
                <button className="btn btn-primary" onClick={() => { setQuickSessionAthleteId(undefined); setQuickSessionGroupId(undefined); setQuickSessionOpen(true) }} style={{ gap: 6 }}>
                  <Icon name="mic" size={15} /> Record Session
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="input" placeholder="Search sessions…" value={sessionsSearch} onChange={e => setSessionsSearch(e.target.value)} style={{ maxWidth: 260 }} onKeyDown={e => e.key === 'Enter' && fetchAllSessions(sessionsSearch, sessionsAthleteFilter)} />
                <select className="input" value={sessionsAthleteFilter} onChange={e => setSessionsAthleteFilter(e.target.value)} style={{ maxWidth: 180 }}>
                  <option value="">All athletes</option>
                  {athletes.map(a => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
                </select>
                <button className="btn btn-primary" onClick={() => fetchAllSessions(sessionsSearch, sessionsAthleteFilter)} style={{ padding: '9px 16px' }}>Search</button>
                {(sessionsSearch || sessionsAthleteFilter) && <button className="btn btn-ghost" onClick={() => { setSessionsSearch(''); setSessionsAthleteFilter(''); fetchAllSessions('','') }} style={{ padding: '9px 14px' }}>Clear</button>}
              </div>
              {loadingSessions
                ? <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
                : allSessions.length === 0
                  ? <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No sessions found.</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {allSessions.map(s => {
                        const a = s.athletes
                        return (
                          // The whole row is the link — tapping a session opens
                          // that session, not its athlete.
                          <Link
                            key={s.id}
                            href={`/sessions/${s.id}`}
                            className="card"
                            style={{ padding: '14px 16px', textDecoration: 'none', color: 'inherit', display: 'block' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                              <Avatar initials={a ? `${a.first_name[0]}${a.last_name[0]}`.toUpperCase() : '?'} size={38} bg="var(--coach-color)" />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 800, fontSize: 14 }}>{a ? `${a.first_name} ${a.last_name}` : 'Unknown'}</span>
                                  {s.session_name && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>— {s.session_name}</span>}
                                  {s.shared_with_athlete && <span className="badge badge-active" style={{ fontSize: 10 }}>Shared</span>}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{new Date(s.created_at).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
                                {s.summary && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.summary}</div>}
                              </div>
                              <span className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 10px', flexShrink: 0, gap: 4 }}>
                                Open <Icon name="arrow" size={11} />
                              </span>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )
              }
            </div>
          )}

          {/* ════ CALENDAR TAB ════ */}
          {tab === 'calendar' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 style={{ margin: 0, fontWeight: 900, fontSize: 22 }}>Calendar</h2>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '200px 1fr', gap: 16, alignItems: 'start' }}>
                <div className="card" style={{ padding: 14 }}>
                  <button onClick={() => { setCalMode('personal'); setCalTargetId('') }} style={sideItem(calMode === 'personal', 'var(--primary)')}>
                    <Icon name="calendar" size={15} /> My Calendar
                  </button>
                  {athletes.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, padding: '10px 12px 4px' }}>Athletes</div>
                      {athletes.map(a => (
                        <button key={a.id} onClick={() => { setCalMode('athlete'); setCalTargetId(a.id) }} style={sideItem(calMode === 'athlete' && calTargetId === a.id, 'var(--coach-color)')}>
                          <Avatar initials={a.first_name[0].toUpperCase()} size={22} bg={calMode === 'athlete' && calTargetId === a.id ? 'rgba(255,255,255,0.25)' : 'var(--coach-color)'} />
                          {a.first_name} {a.last_name}
                        </button>
                      ))}
                    </>
                  )}
                  {groups.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, padding: '10px 12px 4px' }}>Groups</div>
                      {groups.map(g => (
                        <button key={g.id} onClick={() => { setCalMode('group'); setCalTargetId(g.id) }} style={sideItem(calMode === 'group' && calTargetId === g.id, g.color)}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: g.color, flexShrink: 0, border: '2px solid rgba(255,255,255,0.5)' }} />
                          {g.name}
                        </button>
                      ))}
                    </>
                  )}
                </div>
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ marginBottom: 14 }}>
                    <div className="section-title" style={{ fontSize: 16 }}>{calTitle}</div>
                    <div className="section-sub">{calSubtitle}</div>
                  </div>
                  {calLoading
                    ? <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 30 }}>Loading…</div>
                    : <Calendar events={calEvents} role="coach" onAddEvent={date => setAddEventModal({ date })} onDeleteEvent={deleteEvent} onMonthChange={m => setCalMonth(m)} />
                  }
                </div>
              </div>
            </div>
          )}

          {/* ════ MESSAGES TAB ════ */}
          {tab === 'messages' && (
            <div style={{ margin: isMobile ? '-16px' : '-28px', height: isMobile ? 'calc(100dvh - 136px)' : 'calc(100% + 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <MessagingPanel
                athletes={athletes}
                unreadCounts={unreadCounts}
                preselectedAthleteId={msgPreselectedId}
                onUnreadChange={handleUnreadChange}
              />
            </div>
          )}

          {/* ════ SETTINGS TAB ════ */}
          {tab === 'settings' && (
            <SettingsTab
              coachName={coachName}
              coachSport={coachSport}
              coachEmail={coachEmail}
              inviteCode={inviteCode}
              codeEditing={codeEditing}
              codeDraft={codeDraft}
              codeSaving={codeSaving}
              codeMsg={codeMsg}
              setCodeDraft={setCodeDraft}
              setCodeEditing={setCodeEditing}
              setCodeMsg={setCodeMsg}
              saveCode={saveCode}
              onNameChange={(first, last, sport, email) => {
                setCoachName(`${first} ${last}`.trim())
                setCoachSport(sport)
                if (email) setCoachEmail(email)
              }}
              logout={logout}
            />
          )}
        </div>
      </main>

      {/* ════════ MOBILE BOTTOM NAV ════════ */}
      {isMobile && (
        <nav style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
          background: 'rgba(251,248,243,0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderTop: '1px solid var(--border)',
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2,
          alignItems: 'center',
          padding: '8px 6px',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}>
          {BOTTOM_NAV_ITEMS.map((item, i) => {
            if ('fab' in item) {
              return (
                <button key="fab"
                  onClick={() => { setQuickSessionAthleteId(undefined); setQuickSessionGroupId(undefined); setQuickSessionOpen(true) }}
                  style={{
                    justifySelf: 'center', background: 'none', border: 'none', padding: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 46, height: 46, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--coach-color) 0%, #8E3F27 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(181,92,62,0.35), 0 0 0 3px var(--bg)',
                    border: '2px solid var(--card)',
                  }}>
                    <Icon name="mic" size={20} strokeWidth={2.4} />
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text)', letterSpacing: 0.3, marginTop: 1 }}>Record</span>
                </button>
              )
            }
            const active = tab === item.key
            const unread = item.key === 'messages' ? totalUnreadAll : 0
            return (
              <button key={item.key} onClick={() => setTab(item.key)} style={{
                background: 'none', border: 'none', padding: 4, position: 'relative',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                color: active ? 'var(--text)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}>
                {active && <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', width: 18, height: 2, background: 'var(--text)', borderRadius: 2 }} />}
                <div style={{ position: 'relative' }}>
                  <Icon name={item.icon} size={18} strokeWidth={active ? 2.2 : 1.8} />
                  {unread > 0 && (
                    <span style={{ position: 'absolute', top: -3, right: -7, minWidth: 13, height: 13, borderRadius: 99, background: 'var(--coach-color)', color: '#fff', fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{unread > 9 ? '9+' : unread}</span>
                  )}
                </div>
                <span style={{ fontSize: 9, fontWeight: active ? 800 : 600, letterSpacing: 0.2 }}>{item.label}</span>
              </button>
            )
          })}
        </nav>
      )}

      {/* ════════ MODALS ════════ */}

      {showAddAthlete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div className="card-lg" style={{ width: '100%', maxWidth: 440, padding: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Add Athlete</div>
              <button onClick={() => { setShowAddAthlete(false); setAddMsg('') }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>An invite email will be sent with a link to set their password.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {[['First name','Alex','firstName'],['Last name','Johnson','lastName']].map(([label,ph,key]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input className="input" placeholder={ph} value={(addForm as any)[key]} onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label className="label">Email address</label>
                <input className="input" type="email" placeholder="alex@example.com" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              {addMsg && <p style={{ fontSize: 13, fontWeight: 600, color: addMsg.includes('invited') ? 'var(--success)' : 'var(--danger)', margin: 0 }}>{addMsg}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="btn btn-ghost" onClick={() => { setShowAddAthlete(false); setAddMsg('') }} style={{ flex: 1 }}>Cancel</button>
                <button className="btn btn-primary btn-lg" onClick={createAthlete} disabled={addLoading} style={{ flex: 2 }}>{addLoading ? 'Inviting…' : 'Send Invite'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {addEventModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div className="card-lg" style={{ width: '100%', maxWidth: 440, padding: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 17 }}>Add Event — {calTitle}</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>
                  {new Date(addEventModal.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
              </div>
              <button onClick={() => setAddEventModal(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <label className="label">Title *</label>
                <input className="input" placeholder="e.g. Team meeting, Speed drills, Rest day" value={eventForm.title} onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))} autoFocus />
              </div>
              <div>
                <label className="label">Type</label>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {['session','homework','goal','reminder','other'].map(t => (
                    <button key={t} onClick={() => setEventForm(f => ({ ...f, event_type: t }))} className={`badge badge-${t}`} style={{ cursor: 'pointer', border: `1.5px solid ${eventForm.event_type === t ? 'currentColor' : 'transparent'}`, padding: '5px 10px', fontSize: 11 }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Time (optional)</label>
                <input className="input" type="time" value={eventForm.event_time} onChange={e => setEventForm(f => ({ ...f, event_time: e.target.value }))} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input" rows={3} value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))} placeholder="Extra details…" />
              </div>
              {calMode === 'group' && (
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                  This event will be added to all {groups.find(g => g.id === calTargetId)?.member_count ?? 0} athletes in this group.
                </div>
              )}
              {(calMode === 'athlete' || calMode === 'group') && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, padding: '10px 12px', background: alsoAddToCoach ? '#f0f9ff' : 'var(--bg)', border: `1.5px solid ${alsoAddToCoach ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8 }}>
                  <input type="checkbox" checked={alsoAddToCoach} onChange={e => setAlsoAddToCoach(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--primary)' }} />
                  <span style={{ fontWeight: alsoAddToCoach ? 700 : 400 }}>Also add to my personal calendar</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>prevents double-booking</span>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => { setAddEventModal(null); setAlsoAddToCoach(false) }} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={saveEvent} disabled={eventSaving || !eventForm.title.trim()} style={{ flex: 2 }}>
                {eventSaving ? 'Saving…' : calMode === 'group' ? 'Add for Group' : 'Add to Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ DELETE CONFIRM MODAL ════════ */}
      {deleteConfirmAthlete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20 }}>
          <div className="card-lg" style={{ width: '100%', maxWidth: 400, padding: 28 }}>
            {/* Icon */}
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--danger-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Icon name="trash" size={22} strokeWidth={2} />
            </div>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>Remove athlete?</div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '0 0 20px', lineHeight: 1.6 }}>
              This will permanently delete <strong>{deleteConfirmAthlete.first_name} {deleteConfirmAthlete.last_name}</strong> and all their sessions, notes, and data. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setDeleteConfirmAthlete(null)} disabled={deleteLoading} style={{ flex: 1 }}>
                Cancel
              </button>
              <button className="btn btn-danger btn-lg" onClick={confirmDelete} disabled={deleteLoading} style={{ flex: 1, fontWeight: 800 }}>
                {deleteLoading ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ JOIN TOASTS ════════ */}
      {(joinToasts.length > 0 || simpleToasts.length > 0) && (
        <div style={{
          position: 'fixed',
          bottom: isMobile ? 'calc(env(safe-area-inset-bottom) + 72px)' : 24,
          right: isMobile ? 12 : 24,
          left: isMobile ? 12 : 'auto',
          zIndex: 500,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'flex-end',
        }}>
          {simpleToasts.map(t => (
            <SimpleToast
              key={t.id}
              data={t}
              onDismiss={() => setSimpleToasts(prev => prev.filter(x => x.id !== t.id))}
            />
          ))}
          {joinToasts.map(t => (
            <JoinToast
              key={t.toastId}
              data={t}
              onDismiss={() => setJoinToasts(prev => prev.filter(x => x.toastId !== t.toastId))}
            />
          ))}
        </div>
      )}

      {quickSessionOpen && (
        <QuickSessionModal
          athletes={athletes}
          groups={groups}
          defaultAthleteId={quickSessionAthleteId}
          defaultGroupId={quickSessionGroupId}
          coachSport={coachSport}
          onClose={() => { setQuickSessionOpen(false); setQuickSessionAthleteId(undefined); setQuickSessionGroupId(undefined) }}
          onSaved={() => { fetchAllSessions(); fetchAthletes() }}
        />
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: 'var(--text-muted)' }}>Loading…</div></div>}>
      <DashboardPageInner />
    </Suspense>
  )
}
