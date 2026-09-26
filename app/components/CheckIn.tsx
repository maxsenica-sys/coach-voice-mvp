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

import { useId, useState } from 'react'
import BodyMap from '@/app/components/BodyMap'
import { regionLabel } from '@/lib/body-map'
import { READINESS_OPTIONS, type Readiness } from '@/lib/readiness'
import { apiMutate } from '@/lib/api-client'
import { todayISODate } from '@/lib/session-date'

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
  const noteId = useId()

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
          // The phone's own date, so the check-in lands on the athlete's day,
          // not the server's UTC one. See app/api/wellness/route.ts.
          check_date: todayISODate(),
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

  /* Who can see what the athlete writes, said before they write it.
   *
   * Max, 2026-09-25: tell the athlete who sees it. The free text this screen
   * collects is the INJURY UPDATE, and it goes to the coach and to nobody else:
   * it is not in the monthly report, not in the automatic parent email, not in
   * any email. So the true sentence is the reassuring one, and it is said
   * plainly next to the box, before typing.
   *
   * The parents sentence that was here was written for `notes`, the free-text
   * field of the retired five-metric form — which DOES reach reports, and which
   * no current screen collects. Telling a child their words may go to their
   * parents when they cannot would put them off writing the one thing their
   * coach needs to read. If this screen ever collects text that can reach a
   * report, this line must change in the same commit. */
  const coachSees = `Only your coach sees this — they will read it before ${sessionLabel ? `“${sessionLabel}”` : 'your next session'}.`

  const EYEBROW: React.CSSProperties = {
    fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700,
    letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-2)',
  }

  if (done) {
    return (
      <div className="card" style={{ padding: 22, borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span aria-hidden="true" style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: 'var(--primary)', color: 'var(--on-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 800,
          }}>✓</span>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1.1, color: 'var(--text)' }}>
            Checked in.
          </div>
        </div>
        <div style={{ color: 'var(--text-2)', marginTop: 10, fontSize: 'var(--fs-3)', lineHeight: 1.5 }}>
          {coachSees}
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 18, borderRadius: 'var(--radius-lg)' }}>
      <h2 style={{
        margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400,
        lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--text)', overflowWrap: 'anywhere',
      }}>
        {sessionLabel ? `Before ${sessionLabel}` : <>How are you <em style={{ fontStyle: 'italic', fontWeight: 500 }}>today</em>?</>}
      </h2>

      {/* ── 1 · the body, where nothing is the normal answer ──────────────── */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.5 }}>
          Anything sore or bothering you? <strong style={{ color: 'var(--text)' }}>Only mark it if something is wrong</strong> —
          leaving this blank tells your coach you are fine.
        </div>
        <div style={{ marginTop: 12 }}>
          <BodyMap selected={soreAreas} onChange={setSoreAreas} perspective="self" />
        </div>
        <div aria-live="polite" style={{ marginTop: 8, fontSize: 'var(--fs-3)', color: 'var(--text)', lineHeight: 1.5 }}>
          {soreAreas.length === 0
            ? 'Nothing marked — nothing hurts.'
            : `Marked: ${soreAreas.map(regionLabel).join(', ')}`}
        </div>
      </div>

      {/* ── 2 · readiness ────────────────────────────────────────────────── */}
      {/* One track, three stops. A low answer is drawn exactly like a high
          one — same fill, same weight — because the control records where you
          are and must not react to it. */}
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={EYEBROW}>How are you feeling?</div>
        <div
          role="group"
          aria-label="How are you feeling"
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, marginTop: 10,
            padding: 4, borderRadius: 18, border: '1px solid var(--border)', background: 'var(--bg)',
          }}
        >
          {READINESS_OPTIONS.map((opt) => {
            const on = readiness === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={on}
                onClick={() => { setReadiness(opt.value); setError(null) }}
                style={{
                  // The padding is what stops the hint touching the border.
                  // Measured on a 320px phone: the tallest hint now runs to
                  // four lines and, with no padding, its last line sat 1px off
                  // the bottom edge of the button. The button grows instead —
                  // minHeight is a floor, so nothing is clipped either way.
                  minWidth: 0, minHeight: 64, padding: '9px 4px',
                  borderRadius: 14, cursor: 'pointer',
                  border: 'none',
                  background: on ? 'var(--primary)' : 'transparent',
                  // Ink on the lifted sage — white on it is 1.6:1.
                  color: on ? 'var(--on-primary)' : 'var(--text)',
                  fontFamily: 'inherit', fontWeight: on ? 800 : 600,
                  fontSize: 'var(--fs-4)', display: 'flex',
                  flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                }}
              >
                {opt.label}
                {/* No break-word and no ellipsis here on purpose: these hints
                    are a fixed, known list, and the longest word in them
                    ("Normal") measures 45px against the 68px column this gets
                    on a 320px phone. They wrap between whole words or not at
                    all. A hint that would not fit is a hint to rewrite, not to
                    hyphenate. lineHeight 1.3 rather than 1.2 because at 13px
                    over four lines the tighter setting closed the lines up.
                    Colour, not opacity: an 0.85 fade took the unselected hint
                    toward the floor on the dark track. */}
                <span style={{ fontSize: 'var(--fs-1)', fontWeight: 500, lineHeight: 1.3, textAlign: 'center', color: on ? 'var(--on-primary)' : 'var(--text-2)' }}>
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 3 · only if something is already on file ──────────────────────── */}
      {openInjuries.length > 0 && (
        <div style={{ marginTop: 20, padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <label htmlFor={noteId} style={{ display: 'block', fontSize: 'var(--fs-3)', color: 'var(--text)', lineHeight: 1.5 }}>
            How is your {openInjuries.map((i) => regionLabel(i.body_area)).join(' and ')} today?
            Anything changed?
          </label>
          <textarea
            id={noteId}
            aria-describedby={`${noteId}-who`}
            className="input"
            rows={2}
            style={{ resize: 'none', marginTop: 10, background: 'var(--bg)' }}
            placeholder="Still tight, but better than Monday…"
            value={injuryUpdate}
            onChange={(e) => setInjuryUpdate(e.target.value)}
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            maxLength={500}
          />
          {/* Rendered with the box, not after Done, so it is read before
              anything is typed. Same tier as the helper text around it: it is
              a plain fact, not a warning. */}
          <div id={`${noteId}-who`} style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5 }}>
            Optional — skip it if nothing has changed. {coachSees}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--danger-light)', color: 'var(--text)', fontSize: 'var(--fs-3)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
          {error}
        </div>
      )}

      {/* Sage, not floodlight: submitting a form is an action, not a state. */}
      <button
        className="btn btn-primary"
        onClick={() => void save()}
        disabled={saving}
        style={{
          width: '100%', justifyContent: 'center', marginTop: 18, minHeight: 52, borderRadius: 16,
          fontFamily: 'var(--font-cast)', fontSize: 20, letterSpacing: '0.16em', textTransform: 'uppercase',
        }}
      >
        {saving ? 'Saving…' : 'Done'}
      </button>
    </div>
  )
}
