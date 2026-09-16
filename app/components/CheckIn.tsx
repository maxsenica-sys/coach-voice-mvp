'use client'

/* The check-in, as two taps.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * WellnessSubmit asked a thirteen-year-old for eight to eleven taps daily: five
 * ordinal sliders, then "are you sore anywhere?", then an eleven-point clinical
 * pain scale running the OPPOSITE way to the five above it — reconciled by a
 * line of copy admitting it was "the opposite of the five questions above" —
 * then free text. The 0-10 row measured 23.6px per target on a 390px phone,
 * below WCAG 2.2 SC 2.5.8 and the smallest target in the product, on a question
 * about a child's pain. The form also permitted "Soreness: 2" and "Are you
 * sore? No" together and never reconciled them.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 *
 * Marking nothing on the body is the answer "nothing hurts". That is the common
 * case and it costs zero taps — the athlete presses Done. Then one three-way
 * readiness control. Two taps for the ordinary day.
 *
 * A follow-up appears only when the athlete has an open injury on file, and it
 * asks about THAT injury rather than adding a standing daily question.
 *
 * The safeguarding path is untouched: lib/readiness.ts derives the legacy 1-5
 * columns, so computeWellnessAlert, the caretaker escalation and the coach's
 * roster dot read new and old rows through one code path.
 */

import { useState } from 'react'
import BodyMap from '@/app/components/BodyMap'
import { regionLabel } from '@/lib/body-map'
import { READINESS_OPTIONS, type Readiness } from '@/lib/readiness'
import { apiMutate } from '@/lib/api-client'

export interface OpenInjury {
  id: string
  body_area: string
  status: string
}

interface Props {
  athleteId: string
  /** The scheduled session this is against, when the coach set one. */
  sessionEventId?: string | null
  /** What the coach called it, for the heading. */
  sessionLabel?: string | null
  /** Shown as a follow-up. Empty when the athlete has nothing open. */
  openInjuries?: OpenInjury[]
  /** Today's check-in, if they already made one. */
  initial?: {
    readiness?: number | null
    sore_areas?: string[] | null
    injury_update?: string | null
  } | null
  onSaved?: () => void
}

export default function CheckIn({
  athleteId,
  sessionEventId,
  sessionLabel,
  openInjuries = [],
  initial,
  onSaved,
}: Props) {
  const [soreAreas, setSoreAreas] = useState<string[]>(initial?.sore_areas ?? [])
  const [readiness, setReadiness] = useState<Readiness | null>(
    (initial?.readiness as Readiness | undefined) ?? null,
  )
  const [injuryUpdate, setInjuryUpdate] = useState(initial?.injury_update ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const save = async () => {
    if (readiness === null) {
      setError('Pick how you are feeling first — one tap.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await apiMutate('/api/wellness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          readiness,
          // Sent explicitly, including when empty: [] means "nothing hurts",
          // which is an answer, not an absence of one.
          sore_areas: soreAreas,
          session_event_id: sessionEventId ?? null,
          injury_update: openInjuries.length ? injuryUpdate.trim() || null : null,
        }),
      })
      setDone(true)
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your check-in. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="card" style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 28, lineHeight: 1 }} aria-hidden="true">✓</div>
        <div style={{ fontWeight: 700, marginTop: 8, fontSize: 'var(--fs-4)' }}>Checked in.</div>
        <div style={{ color: 'var(--text-2)', marginTop: 4, fontSize: 'var(--fs-3)', lineHeight: 1.5 }}>
          Your coach will see this before {sessionLabel ? `“${sessionLabel}”` : 'your next session'}.
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <h2 style={{ margin: 0, fontSize: 'var(--fs-5)', fontWeight: 800 }}>
        {sessionLabel ? `Before ${sessionLabel}` : 'How are you today?'}
      </h2>

      {/* ── 1 · the body, where nothing is the normal answer ──────────────── */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.5 }}>
          Anything sore or bothering you? <strong>Only mark it if something is wrong</strong> —
          leaving this blank tells your coach you are fine.
        </div>
        <div style={{ marginTop: 12 }}>
          <BodyMap selected={soreAreas} onChange={setSoreAreas} />
        </div>
        <div aria-live="polite" style={{ marginTop: 8, fontSize: 'var(--fs-3)', color: 'var(--text-2)' }}>
          {soreAreas.length === 0
            ? 'Nothing marked — nothing hurts.'
            : `Marked: ${soreAreas.map(regionLabel).join(', ')}`}
        </div>
      </div>

      {/* ── 2 · readiness ────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)' }}>How are you feeling?</div>
        <div role="group" aria-label="How are you feeling" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {READINESS_OPTIONS.map((opt) => {
            const on = readiness === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={on}
                onClick={() => { setReadiness(opt.value); setError(null) }}
                style={{
                  flex: 1, minHeight: 64, borderRadius: 12, cursor: 'pointer',
                  border: '1.5px solid', borderColor: on ? 'var(--primary)' : 'var(--border)',
                  background: on ? 'var(--primary)' : 'var(--card)',
                  color: on ? '#fff' : 'var(--text)',
                  fontFamily: 'inherit', fontWeight: on ? 800 : 600,
                  fontSize: 'var(--fs-4)', display: 'flex',
                  flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                }}
              >
                {opt.label}
                <span style={{ fontSize: 'var(--fs-1)', fontWeight: 500, opacity: 0.85, lineHeight: 1.2, textAlign: 'center', paddingInline: 4 }}>
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 3 · only if something is already on file ──────────────────────── */}
      {openInjuries.length > 0 && (
        <div style={{ marginTop: 20, padding: 14, borderRadius: 12, background: 'var(--surface-2)' }}>
          <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text)', lineHeight: 1.5 }}>
            How is your {openInjuries.map((i) => regionLabel(i.body_area)).join(' and ')} today?
            Anything changed?
          </div>
          <textarea
            className="input"
            rows={2}
            style={{ resize: 'none', marginTop: 8 }}
            placeholder="Still tight, but better than Monday…"
            value={injuryUpdate}
            onChange={(e) => setInjuryUpdate(e.target.value)}
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            maxLength={500}
          />
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)', marginTop: 5 }}>
            Optional — skip it if nothing has changed.
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--danger-light)', fontSize: 'var(--fs-3)', lineHeight: 1.45 }}>
          {error}
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={() => void save()}
        disabled={saving}
        style={{ width: '100%', justifyContent: 'center', marginTop: 18, minHeight: 50, fontSize: 'var(--fs-4)' }}
      >
        {saving ? 'Saving…' : 'Done'}
      </button>
    </div>
  )
}
