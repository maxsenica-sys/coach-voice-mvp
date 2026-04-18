'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { ALL_SPORTS } from '@/lib/sports'

// ── Sport Wheel Picker ───────────────────────────────────────────
const ITEM_H = 48
const VISIBLE = 5
const CONTAINER_H = ITEM_H * VISIBLE

function SportWheelPicker({
  sports,
  value,
  onChange,
}: {
  sports: string[]
  value: string
  onChange: (s: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Scroll to selected value on mount / value change from outside
  useEffect(() => {
    const idx = sports.indexOf(value)
    if (idx >= 0 && containerRef.current) {
      containerRef.current.scrollTop = idx * ITEM_H
    }
  }, [sports, value])

  const handleScroll = useCallback(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      if (!containerRef.current) return
      const idx = Math.round(containerRef.current.scrollTop / ITEM_H)
      const sport = sports[Math.min(Math.max(0, idx), sports.length - 1)]
      if (sport && sport !== value) onChange(sport)
    }, 80)
  }, [sports, value, onChange])

  return (
    <div className="wheel-picker-container" style={{ height: CONTAINER_H }}>
      {/* Centre highlight band */}
      <div style={{
        position: 'absolute',
        top: ITEM_H * 2, left: 8, right: 8,
        height: ITEM_H,
        background: 'var(--primary-light)',
        borderRadius: 10,
        border: '1.5px solid var(--primary)',
        pointerEvents: 'none',
        zIndex: 1,
      }} />
      {/* Top fade */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_H * 2,
        background: 'linear-gradient(to bottom, var(--card) 20%, transparent 100%)',
        pointerEvents: 'none', zIndex: 2,
      }} />
      {/* Bottom fade */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_H * 2,
        background: 'linear-gradient(to top, var(--card) 20%, transparent 100%)',
        pointerEvents: 'none', zIndex: 2,
      }} />
      {/* Scroll area */}
      <div
        ref={containerRef}
        className="wheel-picker-scroll"
        style={{ height: CONTAINER_H }}
        onScroll={handleScroll}
      >
        {/* Top spacer: 2 empty rows */}
        <div style={{ height: ITEM_H * 2 }} />
        {sports.map((s) => (
          <div
            key={s}
            className="wheel-picker-item"
            style={{
              height: ITEM_H,
              fontSize: value === s ? 15 : 13,
              fontWeight: value === s ? 700 : 400,
              color: value === s ? 'var(--primary)' : 'var(--text-2)',
            }}
            onClick={() => {
              onChange(s)
              const idx = sports.indexOf(s)
              containerRef.current?.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' })
            }}
          >
            {s}
          </div>
        ))}
        {/* Bottom spacer: 2 empty rows */}
        <div style={{ height: ITEM_H * 2 }} />
      </div>
    </div>
  )
}

type Role = 'coach' | 'athlete'

type FormData = {
  role: Role | null
  firstName: string
  lastName: string
  email: string
  password: string
  sport: string
  positionOrEvent: string
  experienceLevel: string
  coachingLevel: string
  goals: string
  coachCode: string // athletes can optionally enter their coach's code
}

const EXPERIENCE_LEVELS = [
  'Beginner (0–2 years)',
  'Intermediate (3–5 years)',
  'Advanced (6–10 years)',
  'Elite / Semi-professional',
  'Professional',
]

const COACHING_LEVELS = [
  'Youth (under 12)',
  'Junior (12–18)',
  'High School / College',
  'Amateur / Club',
  'Semi-professional',
  'Professional / Elite',
  'Paralympic / Adaptive',
  'Masters / Veterans',
]

const GOALS_OPTIONS_ATHLETE = [
  'Improve technical skills',
  'Increase speed & power',
  'Recover from injury',
  'Reach elite / professional level',
  'Improve mental performance',
  'Maintain fitness & longevity',
  'Prepare for a specific competition',
]

const GOALS_OPTIONS_COACH = [
  'Better athlete communication',
  'Track athlete progress over time',
  'Streamline session notes',
  'Share video feedback with athletes',
  'Build a professional coaching program',
  'Manage a large athlete roster',
]

// Sorted alphabetical sports list for wheel picker
const SORTED_SPORTS = [...ALL_SPORTS].sort((a, b) => a.localeCompare(b))

export default function SignupPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sportSearch, setSportSearch] = useState('')

  const [form, setForm] = useState<FormData>({
    role: null,
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    sport: '',
    positionOrEvent: '',
    experienceLevel: '',
    coachingLevel: '',
    goals: '',
    coachCode: '',
  })

  const set = (key: keyof FormData, val: string) => {
    setError('')
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  // Wheel picker shows filtered (or all) sports
  const wheelSports = useMemo(
    () => sportSearch.trim()
      ? SORTED_SPORTS.filter((s) => s.toLowerCase().includes(sportSearch.toLowerCase()))
      : SORTED_SPORTS,
    [sportSearch]
  )

  // ─── Validation per step ───────────────────────────────────

  const canProceed = (): boolean => {
    if (step === 1) return form.role !== null
    if (step === 2) return form.firstName.trim().length > 0 && form.lastName.trim().length > 0
    if (step === 3) return form.email.trim().length > 4 && form.password.length >= 6
    if (step === 4) return form.sport.length > 0
    if (step === 5) return true // optional fields
    return false
  }

  const next = () => {
    if (!canProceed()) {
      if (step === 1) setError('Please select your role to continue.')
      if (step === 2) setError('First and last name are required.')
      if (step === 3) {
        if (!form.email.trim()) setError('Email is required.')
        else if (form.password.length < 6) setError('Password must be at least 6 characters.')
      }
      if (step === 4) setError('Please select your sport.')
      return
    }
    setError('')
    setStep((s) => s + 1)
  }

  const back = () => {
    setError('')
    setStep((s) => s - 1)
  }

  // ─── Final submit ──────────────────────────────────────────

  const submit = async () => {
    setLoading(true)
    setError('')

    try {
      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: {
            role: form.role,
            first_name: form.firstName.trim(),
            last_name: form.lastName.trim(),
          },
        },
      })

      if (authError) throw new Error(authError.message)
      if (!authData.user) throw new Error('Signup failed — no user returned.')

      // 2. Save full profile via API (generates coach code if coach)
      const res = await fetch('/api/complete-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: form.role,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          sport: form.sport,
          positionOrEvent: form.positionOrEvent.trim(),
          experienceLevel: form.experienceLevel,
          coachingLevel: form.coachingLevel,
          goals: form.goals,
          coachCode: form.coachCode.trim().toLowerCase(),
        }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error ?? 'Could not save profile.')

      if (!authData.session) {
        // Email confirmation required
        router.push('/signup/confirm')
        return
      }

      router.push(form.role === 'athlete' ? '/athlete' : '/dashboard')
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────

  const totalSteps = 5
  const progress = (step / totalSteps) * 100

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #312e81 70%, #6366f1 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 500 }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{ fontSize: 24 }}>🎙️</span>
            <span style={{ color: '#fff', fontSize: 22, fontWeight: 900, marginLeft: 8, letterSpacing: -0.5 }}>
              CoachVoice
            </span>
          </Link>
        </div>

        <div className="card-lg" style={{ padding: 32 }}>
          {/* Progress bar */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>
                Step {step} of {totalSteps}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {step === 1 ? 'Your role' : step === 2 ? 'Your name' : step === 3 ? 'Login details' : step === 4 ? 'Your sport' : 'About you'}
              </span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: form.role === 'coach' ? 'var(--coach-color)' : form.role === 'athlete' ? 'var(--athlete-color)' : 'var(--primary)',
                borderRadius: 999,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* ── Step 1: Role ── */}
          {step === 1 && (
            <div className="fade-in">
              <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>How will you use CoachVoice?</h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 24 }}>
                This determines your experience on the platform.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {(['coach', 'athlete'] as Role[]).map((r) => {
                  const selected = form.role === r
                  const color = r === 'coach' ? 'var(--coach-color)' : 'var(--athlete-color)'
                  const lightColor = r === 'coach' ? 'var(--coach-light)' : 'var(--athlete-light)'
                  const emoji = r === 'coach' ? '🏅' : '⚡'
                  const desc = r === 'coach'
                    ? 'Record sessions, manage athletes, upload video, share AI summaries.'
                    : 'View your sessions, add notes, track calendar, watch coach feedback.'
                  return (
                    <button
                      key={r}
                      onClick={() => set('role', r)}
                      style={{
                        padding: '20px 16px',
                        border: `2px solid ${selected ? color : 'var(--border)'}`,
                        borderRadius: 14,
                        background: selected ? lightColor : 'var(--card)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                        boxShadow: selected ? `0 0 0 4px ${r === 'coach' ? 'rgba(124,58,237,.12)' : 'rgba(5,150,105,.12)'}` : 'none',
                      }}
                    >
                      <div style={{ fontSize: 28, marginBottom: 10 }}>{emoji}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: selected ? color : 'var(--text)', textTransform: 'capitalize' }}>{r}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>{desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: Name ── */}
          {step === 2 && (
            <div className="fade-in">
              <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>What's your name?</h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 24 }}>
                This is how you'll appear to {form.role === 'coach' ? 'your athletes' : 'your coach'}.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="label">First name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Alex"
                    value={form.firstName}
                    autoFocus
                    onChange={(e) => set('firstName', e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && next()}
                  />
                </div>
                <div>
                  <label className="label">Last name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Johnson"
                    value={form.lastName}
                    onChange={(e) => set('lastName', e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && next()}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Email + Password ── */}
          {step === 3 && (
            <div className="fade-in">
              <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>Your login details</h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 24 }}>
                You'll use these to sign in every time.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="label">Email address</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    autoFocus
                    onChange={(e) => set('email', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="At least 6 characters"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && next()}
                  />
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>Minimum 6 characters</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Sport ── */}
          {step === 4 && (
            <div className="fade-in">
              <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>
                {form.role === 'coach' ? 'What sport do you coach?' : 'What sport do you play?'}
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
                Scroll to your sport — or search to jump straight to it.
              </p>

              {/* Search filter */}
              <input
                className="input"
                type="text"
                placeholder="Filter sports…"
                value={sportSearch}
                onChange={(e) => {
                  setSportSearch(e.target.value)
                  // Auto-select first match when filtering
                  const q = e.target.value.trim().toLowerCase()
                  if (q) {
                    const match = SORTED_SPORTS.find(s => s.toLowerCase().includes(q))
                    if (match) set('sport', match)
                  }
                }}
                style={{ marginBottom: 12 }}
              />

              {/* Selected badge */}
              {form.sport && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'var(--primary-light)', border: '1.5px solid var(--primary)',
                  borderRadius: 999, padding: '4px 14px', fontSize: 13, fontWeight: 700,
                  color: 'var(--primary)', marginBottom: 12,
                }}>
                  ✓ {form.sport}
                  <button
                    onClick={() => { set('sport', ''); setSportSearch('') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0 }}
                  >×</button>
                </div>
              )}

              {/* Wheel picker */}
              {wheelSports.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                  No sports match that search.
                </div>
              ) : (
                <SportWheelPicker
                  sports={wheelSports}
                  value={form.sport || wheelSports[0]}
                  onChange={(s) => set('sport', s)}
                />
              )}

              <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 10 }}>
                Scroll the wheel · tap to select · {wheelSports.length} sports available
              </p>
            </div>
          )}

          {/* ── Step 5: About you ── */}
          {step === 5 && (
            <div className="fade-in">
              <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>Almost there!</h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 24 }}>
                A couple more details to personalise your experience. (All optional)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {form.role === 'athlete' && (
                  <div>
                    <label className="label">Primary position or event (optional)</label>
                    <input
                      className="input"
                      type="text"
                      placeholder={`e.g. Centre midfielder, 100m sprinter, Goalkeeper…`}
                      value={form.positionOrEvent}
                      onChange={(e) => set('positionOrEvent', e.target.value)}
                    />
                  </div>
                )}

                <div>
                  <label className="label">
                    {form.role === 'coach' ? 'Level you coach at' : 'Experience level'}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {(form.role === 'coach' ? COACHING_LEVELS : EXPERIENCE_LEVELS).map((lvl) => {
                      const sel = (form.role === 'coach' ? form.coachingLevel : form.experienceLevel) === lvl
                      return (
                        <button
                          key={lvl}
                          onClick={() => set(form.role === 'coach' ? 'coachingLevel' : 'experienceLevel', lvl)}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 999,
                            border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                            background: sel ? 'var(--primary-light)' : 'var(--card)',
                            color: sel ? 'var(--primary)' : 'var(--text-2)',
                            fontWeight: sel ? 700 : 500,
                            fontSize: 13,
                            cursor: 'pointer',
                            transition: 'all 0.12s ease',
                          }}
                        >
                          {lvl}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="label">Your main goal (optional)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(form.role === 'coach' ? GOALS_OPTIONS_COACH : GOALS_OPTIONS_ATHLETE).map((goal) => {
                      const sel = form.goals === goal
                      return (
                        <button
                          key={goal}
                          onClick={() => set('goals', sel ? '' : goal)}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 10,
                            border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                            background: sel ? 'var(--primary-light)' : 'var(--card)',
                            color: sel ? 'var(--primary)' : 'var(--text)',
                            fontWeight: sel ? 700 : 400,
                            fontSize: 14,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.12s ease',
                          }}
                        >
                          {sel ? '✓ ' : ''}{goal}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {form.role === 'athlete' && (
                  <div>
                    <label className="label">Coach invite code (optional)</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="e.g. johndoe4821 — your coach provides this"
                      value={form.coachCode}
                      onChange={(e) => set('coachCode', e.target.value.toLowerCase().trim())}
                    />
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
                      You can also connect with your coach later from your portal.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p style={{ marginTop: 14, fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>{error}</p>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
            {step > 1 && (
              <button className="btn btn-ghost" onClick={back} style={{ flex: 1 }}>
                ← Back
              </button>
            )}
            {step < totalSteps ? (
              <button
                className="btn btn-primary btn-lg"
                onClick={next}
                style={{ flex: 2 }}
              >
                Continue →
              </button>
            ) : (
              <button
                className="btn btn-primary btn-lg"
                onClick={submit}
                disabled={loading}
                style={{ flex: 2, background: form.role === 'coach' ? 'var(--coach-color)' : 'var(--athlete-color)', borderColor: 'transparent' }}
              >
                {loading ? 'Creating your account…' : 'Create account 🎉'}
              </button>
            )}
          </div>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', marginTop: 16 }}>
            Already have an account?{' '}
            <Link href="/" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

