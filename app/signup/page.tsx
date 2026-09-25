'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { ALL_SPORTS } from '@/lib/sports'
import { errorMessage } from '@/lib/errors'

/* ── Stadium Night — the new-account flow ────────────────────────────────────
 *
 * Same ground, lockup and components as app/page.tsx and app/reset. Every
 * decorative box stays inside the viewport (see the note in app/page.tsx): the
 * sideways probe in tools/boot-smoke.mjs runs /signup at 320px, because this is
 * the longest form in the app.
 *
 * The floodlight is spent once in the whole flow: on CREATE ACCOUNT, the one
 * action that commits. CONTINUE on steps 1-4 is the same record-bar shape with
 * the light off — the flood marks the moment, not every tap on the way to it. */
const SN_CSS = `
.sn-page { min-height: 100vh; min-height: 100dvh; position: relative; background: var(--bg); color: var(--text); }
.sn-stage { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.sn-stage > * { position: absolute; inset: 0; }
.sn-rake {
  width: calc(100% - 46px);
  background: linear-gradient(180deg, color-mix(in srgb, var(--flood) 5.5%, transparent), color-mix(in srgb, var(--flood) 2%, transparent) 46%, transparent 84%);
  -webkit-mask-image: linear-gradient(107deg, transparent 0, black 40px, black 250px, transparent 300px);
          mask-image: linear-gradient(107deg, transparent 0, black 40px, black 250px, transparent 300px);
  animation: sn-rake 22s ease-in-out infinite alternate;
}
@keyframes sn-rake {
  from { transform: translateX(0) }
  to { transform: translateX(46px) }
}
@media (prefers-reduced-motion: reduce) {
  .sn-rake { animation: none; }
}
.sn-head { display: flex; align-items: center; gap: 10px; padding: 18px 0 0; }
.sn-mark {
  width: 30px; height: 30px; border-radius: 10px; flex: none;
  border: 1.5px solid var(--primary); color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  display: flex; align-items: center; justify-content: center;
}
.sn-wordmark { font-family: var(--font-cast); font-weight: 700; font-size: 16px; letter-spacing: .22em; line-height: 1; color: var(--text); }
.sn-rolecap { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .24em; line-height: 1; color: var(--primary); margin-top: 3px; text-transform: uppercase; }
.sn-ticker {
  margin-top: 13px; padding: 7px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 9px;
  font-family: var(--font-cast); font-weight: 600; font-size: 13px; letter-spacing: .16em; text-transform: uppercase; color: var(--text-2);
}
.sn-ticker .sn-step { color: var(--primary); font-weight: 700; }
.sn-ticker .sn-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); flex: none; }
.sn-ticker .sn-where { margin-left: auto; }
.sn-segs { display: flex; gap: 4px; margin-top: 9px; }
.sn-segs i { height: 4px; flex: 1; border-radius: 2px; background: var(--border); transition: background-color .3s ease; }
.sn-segs i.on { background: var(--primary); }
.sn-eyebrow {
  display: flex; align-items: center; gap: 8px; margin: 0 0 11px;
  font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em; text-transform: uppercase; color: var(--primary);
}
.sn-eyebrow::before { content: ''; width: 7px; height: 7px; background: var(--primary); flex: none; transform: skewX(-14deg); }
.sn-lede { font-family: var(--font-display); font-weight: 400; font-size: 29px; line-height: 1.1; letter-spacing: -.6px; color: var(--text); margin: 0; }
.sn-lede em { font-style: italic; font-weight: 500; }
.sn-sub { font-size: 15px; line-height: 1.5; color: var(--text-2); margin: 9px 0 22px; }
.sn-k {
  display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;
  font-family: var(--font-cast); font-weight: 700; font-size: 13px; line-height: 1.2;
  letter-spacing: .26em; text-transform: uppercase; color: var(--text-2);
}
.sn-k .sn-opt { margin-left: auto; font-weight: 600; letter-spacing: .2em; }
.sn-box {
  display: flex; align-items: center; gap: 11px; min-height: 56px; padding: 0 15px;
  border-radius: 16px; border: 1px solid var(--border);
  background: color-mix(in srgb, var(--text) 4.5%, transparent);
  transition: border-color .15s, box-shadow .15s, background-color .15s;
}
.sn-box:focus-within {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--text) 7.5%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent);
}
.sn-box > svg { flex: none; color: var(--text-2); }
.sn-box input {
  flex: 1; min-width: 0; height: 54px; padding: 0; margin: 0;
  background: transparent; border: 0; outline: 0; border-radius: 0;
  color: var(--text); font-family: var(--font-sans); font-size: 16px; font-weight: 500;
}
.sn-box input::placeholder { color: var(--text-2); font-weight: 400; }
.sn-box input.sn-code { font-family: var(--font-mono); font-size: 20px; letter-spacing: .14em; }
.sn-box input.sn-code::placeholder { font-family: var(--font-sans); font-size: 15px; letter-spacing: 0; }
.sn-hint { font-size: 14px; line-height: 1.45; color: var(--text-muted); margin: 8px 0 0; }
.sn-role {
  display: block; width: 100%; min-width: 0; padding: 18px 16px; text-align: left; cursor: pointer;
  border-radius: 17px; border: 1.5px solid var(--border);
  background: color-mix(in srgb, var(--text) 4.5%, transparent);
  color: var(--text); transition: border-color .15s ease, background-color .15s ease;
}
.sn-role-name { display: block; margin-top: 12px; font-family: var(--font-cast); font-weight: 700; font-size: 22px; line-height: 1; letter-spacing: .06em; text-transform: uppercase; }
.sn-role-desc { display: block; margin-top: 8px; font-size: 14px; line-height: 1.5; color: var(--text-2); }
.sn-pill {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 999px; cursor: pointer;
  font-family: var(--font-sans); font-size: 14px; text-align: left;
  transition: border-color .12s ease, background-color .12s ease;
}
.sn-goal {
  display: flex; align-items: center; width: 100%; min-height: 48px; padding: 10px 15px; border-radius: 14px; cursor: pointer;
  font-family: var(--font-sans); font-size: 15px; text-align: left; line-height: 1.35;
  transition: border-color .12s ease, background-color .12s ease;
}
.sn-found {
  position: relative; margin-top: 18px; border-radius: 20px; overflow: hidden; padding: 16px 16px 15px;
  border: 1px solid var(--border); background: color-mix(in srgb, var(--text) 4.5%, transparent);
}
.sn-found::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, var(--coach-on-light) 0%, color-mix(in srgb, var(--coach-on-light) 15%, transparent) 62%, transparent 100%);
}
.sn-found ul { list-style: none; margin: 12px 0 0; padding: 12px 0 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
.sn-found li { display: grid; grid-template-columns: 13px minmax(0, 1fr); gap: 9px; align-items: start; font-family: var(--font-display); font-size: 15px; line-height: 1.5; color: var(--text); }
.sn-found li::before { content: '•'; color: var(--primary); }
.sn-found li b { font-family: var(--font-cast); font-weight: 700; letter-spacing: .1em; }
.sn-actions { display: flex; gap: 10px; margin-top: 28px; }
.sn-back {
  width: 64px; min-height: 64px; flex: none; border-radius: 18px; cursor: pointer;
  border: 1px solid var(--border); background: color-mix(in srgb, var(--text) 4.5%, transparent); color: var(--text-2);
  display: flex; align-items: center; justify-content: center;
}
.sn-act {
  position: relative; display: flex; align-items: center; flex: 1; min-width: 0; min-height: 64px;
  padding: 12px 90px 12px 17px; border: 0; border-radius: 18px; overflow: hidden; text-align: left; cursor: pointer;
  font-family: var(--font-cast); font-weight: 800; font-size: 20px; line-height: 1.05; letter-spacing: .045em; text-transform: uppercase;
}
.sn-act.sn-lit { background: var(--flood); color: var(--ink-base); }
.sn-act.sn-dim { background: color-mix(in srgb, var(--text) 7.5%, transparent); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); }
.sn-act:disabled { cursor: progress; }
.sn-act .sn-t2 { display: block; margin-top: 5px; font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .08em; line-height: 1.2; overflow-wrap: anywhere; }
.sn-act .sn-cut {
  position: absolute; right: 0; top: 0; bottom: 0; width: 78px; background: var(--bg);
  clip-path: polygon(34% 0, 100% 0, 100% 100%, 0 100%);
  display: flex; align-items: center; justify-content: flex-end; padding-right: 15px;
}
.sn-ring {
  width: 34px; height: 34px; border-radius: 50%; flex: none; border: 2px solid; background: transparent;
  display: flex; align-items: center; justify-content: center;
}
.sn-lit .sn-ring { border-color: var(--flood); color: var(--flood); background: color-mix(in srgb, var(--flood) 10%, transparent); }
.sn-dim .sn-ring { border-color: var(--primary); color: var(--primary); }
.sn-act:focus-visible, .sn-back:focus-visible, .sn-role:focus-visible, .sn-pill:focus-visible, .sn-goal:focus-visible, .sn-x:focus-visible {
  outline: 2px solid var(--text); outline-offset: 3px;
}
.sn-x {
  width: 44px; height: 44px; margin: -8px -14px -8px 0; flex: none; border: 0; padding: 0; border-radius: 999px;
  display: flex; align-items: center; justify-content: center; background: transparent; color: var(--text-2); cursor: pointer;
}
`

const Arrow = ({ back = false }: { back?: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={back ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M4.5 12h14" /><path d="m12.8 6 5.7 6-5.7 6" />
  </svg>
)

/* Line glyphs in the nav-icon stroke language, replacing the two emoji the
   role cards used — a medal and a lightning bolt drawn in the OS's colours. */
const RoleGlyph = ({ role }: { role: 'coach' | 'athlete' }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {role === 'coach'
      ? <><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V2.8h6V4" /><path d="M8.5 10h7M8.5 14h7M8.5 18h4" /></>
      : <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z" />}
  </svg>
)

function Stage() {
  return (
    <div className="sn-stage" aria-hidden="true">
      <div style={{ background: 'radial-gradient(660px 540px at 50% 118%, color-mix(in srgb, var(--ink-mid) 55%, transparent) 0%, transparent 66%)' }} />
      <div style={{ background: 'radial-gradient(780px 470px at 108% -14%, color-mix(in srgb, var(--primary) 14%, transparent) 0%, transparent 62%), radial-gradient(560px 420px at -16% 12%, color-mix(in srgb, var(--flood) 8%, transparent) 0%, transparent 60%)' }} />
      <div className="sn-rake" />
      <div style={{
        backgroundImage: 'repeating-linear-gradient(to right, color-mix(in srgb, var(--text) 4.5%, transparent) 0 1px, transparent 1px 39px), repeating-linear-gradient(to bottom, color-mix(in srgb, var(--text) 3%, transparent) 0 1px, transparent 1px 39px)',
        WebkitMaskImage: 'linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%)',
        maskImage: 'linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%)',
      }} />
      <div style={{ opacity: 0.5, backgroundImage: 'radial-gradient(color-mix(in srgb, var(--text) 13%, transparent) 0.5px, transparent 0.5px)', backgroundSize: '13px 13px' }} />
    </div>
  )
}

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
    } catch (e: unknown) {
      setError(errorMessage(e, 'Something went wrong.'))
    } finally {
      setLoading(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────

  const totalSteps = 5
  const stepName = step === 1 ? 'Your role' : step === 2 ? 'Your name' : step === 3 ? 'Login details' : step === 4 ? 'Your sport' : 'About you'

  // Selected / resting treatment for the choice buttons on step 5.
  const choice = (sel: boolean): React.CSSProperties => ({
    border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
    background: sel ? 'var(--primary-light)' : 'color-mix(in srgb, var(--text) 4.5%, transparent)',
    color: sel ? 'var(--primary)' : 'var(--text)',
    fontWeight: sel ? 700 : 500,
  })

  return (
    <div className="sn-page">
      <style>{SN_CSS}</style>
      <Stage />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 500, margin: '0 auto', padding: '0 20px 32px' }}>

        {/* Lockup */}
        <header className="sn-head">
          {/* The whole lockup is the way back to sign in, so the target is
              the lockup's height, not the 30px mark's. */}
          <Link href="/" aria-label="CoachVoice — back to sign in" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, textDecoration: 'none' }}>
            <span className="sn-mark" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5" /><path d="M12 18.5V21" />
              </svg>
            </span>
            <span aria-hidden="true">
              <span className="sn-wordmark" style={{ display: 'block' }}>COACHVOICE</span>
              <span className="sn-rolecap" style={{ display: 'block' }}>New account</span>
            </span>
          </Link>
        </header>

        {/* Ticker + progress */}
        <div className="sn-ticker">
          <span className="sn-step">Step {step} of {totalSteps}</span>
          {form.role && <><i className="sn-sep" aria-hidden="true" /><span>{form.role}</span></>}
          <span className="sn-where">{stepName}</span>
        </div>
        <div
          className="sn-segs"
          role="progressbar"
          aria-label="Signup progress"
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={step}
        >
          {Array.from({ length: totalSteps }, (_, i) => <i key={i} className={i < step ? 'on' : undefined} />)}
        </div>

        <div style={{ paddingTop: 26 }}>
          {/* ── Step 1: Role ── */}
          {step === 1 && (
            <div className="fade-in">
              <h2 className="sn-lede">How will you use <em>CoachVoice?</em></h2>
              <p className="sn-sub">This determines your experience on the platform.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 12 }}>
                {(['coach', 'athlete'] as Role[]).map((r) => {
                  const selected = form.role === r
                  // Ember marks the coach, sage the athlete — the same split
                  // every screen in the app makes. Both are text-safe on
                  // their own tint.
                  const color = r === 'coach' ? 'var(--coach-on-light)' : 'var(--athlete-color)'
                  const lightColor = r === 'coach' ? 'var(--coach-light)' : 'var(--athlete-light)'
                  const desc = r === 'coach'
                    ? 'Record sessions, manage athletes, upload video, share AI summaries.'
                    : 'View your sessions, add notes, track calendar, watch coach feedback.'
                  return (
                    <button
                      key={r}
                      type="button"
                      className="sn-role"
                      aria-pressed={selected}
                      onClick={() => set('role', r)}
                      style={{
                        borderColor: selected ? color : 'var(--border)',
                        background: selected ? lightColor : undefined,
                      }}
                    >
                      <span style={{ display: 'flex', color: selected ? color : 'var(--text-2)' }}><RoleGlyph role={r} /></span>
                      <span className="sn-role-name" style={{ color: selected ? color : 'var(--text)' }}>{r}</span>
                      <span className="sn-role-desc">{desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: Name ── */}
          {step === 2 && (
            <div className="fade-in">
              <h2 className="sn-lede">What&apos;s your <em>name?</em></h2>
              <p className="sn-sub">
                This is how you&apos;ll appear to {form.role === 'coach' ? 'your athletes' : 'your coach'}.
              </p>
              <label htmlFor="sn-first" className="sn-k">First name</label>
              <div className="sn-box">
                <input
                  id="sn-first"
                  type="text"
                  placeholder="e.g. Alex"
                  value={form.firstName}
                  autoComplete="given-name"
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  maxLength={60}
                  autoFocus
                  onChange={(e) => set('firstName', e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && next()}
                />
              </div>
              <label htmlFor="sn-last" className="sn-k" style={{ marginTop: 18 }}>Last name</label>
              <div className="sn-box">
                <input
                  id="sn-last"
                  type="text"
                  placeholder="e.g. Johnson"
                  value={form.lastName}
                  autoComplete="family-name"
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  maxLength={60}
                  onChange={(e) => set('lastName', e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && next()}
                />
              </div>
            </div>
          )}

          {/* ── Step 3: Email + Password ── */}
          {step === 3 && (
            <div className="fade-in">
              <h2 className="sn-lede">Your login <em>details</em></h2>
              <p className="sn-sub">You&apos;ll use these to sign in every time.</p>
              <label htmlFor="sn-email" className="sn-k">Email address</label>
              <div className="sn-box">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2.6" y="4.8" width="18.8" height="14.4" rx="3" /><path d="m3.4 7.2 8.6 6 8.6-6" />
                </svg>
                <input
                  id="sn-email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  autoFocus
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <label htmlFor="sn-password" className="sn-k" style={{ marginTop: 18 }}>Password</label>
              <div className="sn-box">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4.2" y="10.4" width="15.6" height="9.8" rx="3" /><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
                </svg>
                <input
                  id="sn-password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={form.password}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  minLength={6}
                  onChange={(e) => set('password', e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && next()}
                />
              </div>
              <p className="sn-hint">Minimum 6 characters</p>
            </div>
          )}

          {/* ── Step 4: Sport ── */}
          {step === 4 && (
            <div className="fade-in">
              <h2 className="sn-lede">
                {form.role === 'coach' ? <>What sport do you <em>coach?</em></> : <>What sport do you <em>play?</em></>}
              </h2>
              <p className="sn-sub" style={{ marginBottom: 16 }}>
                Scroll to your sport — or search to jump straight to it.
              </p>

              {/* Search filter */}
              <div className="sn-box" style={{ marginBottom: 12 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" />
                </svg>
                <input
                  type="text"
                  aria-label="Filter sports"
                  placeholder="Filter sports…"
                  value={sportSearch}
                  inputMode="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  autoComplete="off"
                  onChange={(e) => {
                    setSportSearch(e.target.value)
                    // Auto-select first match when filtering
                    const q = e.target.value.trim().toLowerCase()
                    if (q) {
                      const match = SORTED_SPORTS.find(s => s.toLowerCase().includes(q))
                      if (match) set('sport', match)
                    }
                  }}
                />
              </div>

              {/* Selected badge */}
              {form.sport && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%',
                  background: 'var(--primary-light)', border: '1.5px solid var(--primary)',
                  borderRadius: 999, padding: '8px 16px', fontSize: 14, fontWeight: 700,
                  color: 'var(--primary)', marginBottom: 12, overflowWrap: 'anywhere',
                }}>
                  ✓ {form.sport}
                  <button
                    type="button"
                    className="sn-x"
                    aria-label={`Clear ${form.sport}`}
                    onClick={() => { set('sport', ''); setSportSearch('') }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
              )}

              {/* Wheel picker */}
              {wheelSports.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-2)', fontSize: 14 }}>
                  No sports match that search.
                </div>
              ) : (
                <SportWheelPicker
                  sports={wheelSports}
                  /* Not `form.sport || wheelSports[0]`.
                   *
                   * That rendered the first sport in the list as though it were
                   * chosen — bold, primary-coloured, inside the highlight band —
                   * while form.sport was still ''. Pressing Continue then said
                   * "Please select your sport" while pointing at a sport that
                   * visibly WAS selected, on the last mandatory step before the
                   * account is created.
                   *
                   * The picker already renders an empty value correctly, as a
                   * muted "Select sport…". It just never got the chance. */
                  value={form.sport}
                  onChange={(s) => set('sport', s)}
                />
              )}

              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', letterSpacing: '.04em',
                color: 'var(--text-2)', textAlign: 'center', margin: '10px 0 0',
              }}>
                Scroll the wheel · tap to select · {wheelSports.length} sports available
              </p>
            </div>
          )}

          {/* ── Step 5: About you ── */}
          {step === 5 && (
            <div className="fade-in">
              <p className="sn-eyebrow">Last step</p>
              <h2 className="sn-lede">Almost <em>there!</em></h2>
              <p className="sn-sub">
                A couple more details to personalise your experience. (All optional)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                {form.role === 'athlete' && (
                  <div>
                    <label htmlFor="sn-position" className="sn-k">Primary position or event <span className="sn-opt">Optional</span></label>
                    <div className="sn-box">
                      <input
                        id="sn-position"
                        type="text"
                        placeholder={`e.g. Centre midfielder, 100m sprinter, Goalkeeper…`}
                        value={form.positionOrEvent}
                        autoCapitalize="sentences"
                        enterKeyHint="next"
                        maxLength={80}
                        onChange={(e) => set('positionOrEvent', e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div role="group" aria-labelledby="sn-level-k">
                  <div id="sn-level-k" className="sn-k">
                    {form.role === 'coach' ? 'Level you coach at' : 'Experience level'} <span className="sn-opt">Optional</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(form.role === 'coach' ? COACHING_LEVELS : EXPERIENCE_LEVELS).map((lvl) => {
                      const sel = (form.role === 'coach' ? form.coachingLevel : form.experienceLevel) === lvl
                      return (
                        <button
                          key={lvl}
                          type="button"
                          className="sn-pill"
                          aria-pressed={sel}
                          onClick={() => set(form.role === 'coach' ? 'coachingLevel' : 'experienceLevel', lvl)}
                          style={choice(sel)}
                        >
                          {lvl}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div role="group" aria-labelledby="sn-goal-k">
                  <div id="sn-goal-k" className="sn-k">Your main goal <span className="sn-opt">Optional</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(form.role === 'coach' ? GOALS_OPTIONS_COACH : GOALS_OPTIONS_ATHLETE).map((goal) => {
                      const sel = form.goals === goal
                      return (
                        <button
                          key={goal}
                          type="button"
                          className="sn-goal"
                          aria-pressed={sel}
                          onClick={() => set('goals', sel ? '' : goal)}
                          style={choice(sel)}
                        >
                          {sel ? '✓ ' : ''}{goal}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {form.role === 'athlete' && (
                  <div>
                    <label htmlFor="sn-code" className="sn-k">Coach invite code <span className="sn-opt">Optional</span></label>
                    <div className="sn-box">
                      <input
                        id="sn-code"
                        className="sn-code"
                        type="text"
                        placeholder="e.g. johndoe4821 — your coach provides this"
                        value={form.coachCode}
                        /* The value is lowercased on change, but iOS still opened
                           a shifted keyboard and the first character looked wrong
                           as it was typed. autoCapitalize="none" makes what the
                           athlete sees match what is stored. */
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="text"
                        enterKeyHint="done"
                        autoComplete="off"
                        maxLength={40}
                        onChange={(e) => set('coachCode', e.target.value.toLowerCase().trim())}
                      />
                    </div>
                    <p className="sn-hint">
                      You can also connect with your coach later from your portal.
                    </p>

                    {/* What the code does — stated, because it is the one thing
                        on this form with a consequence on someone else's screen.
                        Only what /api/complete-signup actually does: a code that
                        matches a coach puts the athlete on that roster with
                        activationFields() — ACTIVE at once. It does not claim
                        the code was recognised; nothing checks it until submit. */}
                    <div className="sn-found">
                      <div className="sn-k" style={{ margin: 0 }}>What the code does</div>
                      <ul>
                        <li><span>If it matches your coach&apos;s code, you join their roster as <b style={{ color: 'var(--primary)' }}>ACTIVE</b> the moment this account is made &mdash; not a week later.</span></li>
                        <li><span><b style={{ color: 'var(--warning)' }}>PENDING</b> on a roster only means invited and not yet arrived. With a code, you skip it.</span></li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p role="alert" style={{ marginTop: 16, fontSize: 14, lineHeight: 1.45, color: 'var(--danger)', fontWeight: 600, overflowWrap: 'anywhere' }}>{error}</p>
          )}

          {/* Navigation */}
          <div className="sn-actions">
            {step > 1 && (
              <button type="button" className="sn-back" onClick={back} aria-label="Back">
                <Arrow back />
              </button>
            )}
            {step < totalSteps ? (
              <button type="button" className="sn-act sn-dim" onClick={next}>
                Continue
                <span className="sn-cut" aria-hidden="true"><span className="sn-ring"><Arrow /></span></span>
              </button>
            ) : (
              <button type="button" className="sn-act sn-lit" onClick={submit} disabled={loading}>
                <span style={{ display: 'block', minWidth: 0 }}>
                  {loading ? 'Creating your account…' : 'Create account'}
                  {(form.role || form.sport) && (
                    <span className="sn-t2">{[form.role, form.sport].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                <span className="sn-cut" aria-hidden="true"><span className="sn-ring"><Arrow /></span></span>
              </button>
            )}
          </div>

          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-2)', margin: '14px 0 0' }}>
            Already have an account?{' '}
            <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
