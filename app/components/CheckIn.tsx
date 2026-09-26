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
 * Readiness first — one three-way control — then one two-way question:
 * "Nothing sore" or "Something's sore". "Nothing sore" starts pressed, because
 * it is the common case and because it is the answer this screen has always
 * recorded for an untouched body map; it is now said in words on the screen
 * rather than implied by a blank drawing. Two taps for the ordinary day:
 * readiness, then Done.
 *
 * The body map only appears behind "Something's sore". It is ~690px tall on a
 * phone, and when it sat first, readiness and Done were below the fold — the
 * "two-tap" check-in was a scroll and two taps, every day, to report nothing.
 * Switching back to "Nothing sore" hides the map but keeps what was tapped on
 * it, so a mis-tap does not throw away the athlete's marks; what is SENT
 * follows the visible choice.
 *
 * A follow-up appears only when the athlete has an open injury on file, and it
 * asks about THAT injury rather than adding a standing daily question.
 *
 * The safeguarding path is untouched: lib/readiness.ts derives the legacy 1-5
 * columns, so computeWellnessAlert, the caretaker escalation and the coach's
 * roster dot read new and old rows through one code path.
 *
 * ── No signal ─────────────────────────────────────────────────────────────
 *
 * Athletes check in at the side of a pitch, where there often is no signal.
 * When the POST fails because the phone is offline — never when the server
 * rejects the answer — the exact body is kept on the phone (lib/checkin-queue.ts)
 * and the card says so, done: "Saved on this phone. It'll send when you have
 * signal." It is sent on the next mount, on the 'online' event, and from the
 * athlete page. If it can no longer be sent for the day it was made, the card
 * says that too instead of letting the server file it under another day. With
 * no IndexedDB (a private window) it shows the error it always showed.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import BodyMap from '@/app/components/BodyMap'
import { regionLabel } from '@/lib/body-map'
import { READINESS_OPTIONS, type Readiness } from '@/lib/readiness'
import { apiMutate } from '@/lib/api-client'
import { todayISODate } from '@/lib/session-date'
import {
  CHECKIN_QUEUE_EVENT,
  checkinDayLabel,
  checkinKey,
  drainCheckins,
  isOfflineFailure,
  listCheckins,
  putCheckin,
  queueNote,
  removeCheckin,
  settleDrain,
  type CheckinPayload,
  type QueuedCheckin,
} from '@/lib/checkin-queue'

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
  // Which of the two answers is pressed. Derived once from today's row, so a
  // re-check-in opens on what they said last time.
  const [somethingSore, setSomethingSore] = useState<boolean>((initial?.sore_areas?.length ?? 0) > 0)
  const [readiness, setReadiness] = useState<Readiness | null>(
    (initial?.readiness as Readiness | undefined) ?? null,
  )
  const [injuryUpdate, setInjuryUpdate] = useState(initial?.injury_update ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  /** Done, but only on this phone so far. */
  const [queued, setQueued] = useState(false)
  /** This athlete's queue rows worth a line: other days still waiting, and ones that could not be sent. */
  const [notes, setNotes] = useState<QueuedCheckin[]>([])
  const noteId = useId()

  // Refs, not deps: an inline `onSaved` from the parent is a new function every
  // render, and as a dependency it would re-subscribe (and re-drain) on each one.
  const onSavedRef = useRef(onSaved)
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])
  const queuedRef = useRef(false)

  /* Re-read the queue and make the card agree with it. Runs on mount, after
   * every drain anywhere on the page, and after this card writes to it. */
  const refresh = useCallback(async () => {
    const rows = (await listCheckins()).filter((r) => r.payload.athlete_id === athleteId)
    const todayKey = checkinKey(athleteId, todayISODate())
    const todayRow = rows.find((r) => r.key === todayKey)
    setNotes(rows.filter((r) => !(r.key === todayKey && r.status === 'queued')))
    if (todayRow?.status === 'queued') {
      queuedRef.current = true
      setQueued(true)
      setDone(true)
    } else if (queuedRef.current) {
      queuedRef.current = false
      setQueued(false)
      if (!todayRow) {
        // Gone from the queue: it reached the server. The card stays done and
        // becomes the ordinary "Checked in." — and the page re-reads, so the
        // home card stops asking.
        onSavedRef.current?.()
      } else {
        // Sent and refused, or out of time. Bring the form back; the note
        // above it says what happened.
        setDone(false)
      }
    }
  }, [athleteId])

  useEffect(() => {
    let alive = true
    const sync = () => { if (alive) void refresh() }
    const onOnline = () => { void drainCheckins().then(sync) }
    void refresh().then(() => drainCheckins()).then(sync)
    window.addEventListener(CHECKIN_QUEUE_EVENT, sync)
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      window.removeEventListener(CHECKIN_QUEUE_EVENT, sync)
      window.removeEventListener('online', onOnline)
    }
  }, [refresh])

  const dismissNote = async (key: string) => {
    await removeCheckin(key)
    await refresh()
  }

  const save = async () => {
    if (readiness === null) {
      setError('Pick how you are feeling first — one tap.')
      return
    }
    if (somethingSore && soreAreas.length === 0) {
      // "Something's sore" with nothing marked would be saved as [] — which
      // this route reads as "nothing hurts", the opposite of what they said.
      setError('Tap where it is sore on the body — or pick “Nothing sore”.')
      return
    }
    setSaving(true)
    setError(null)
    // Built once: this object is what is POSTed and, offline, exactly what is
    // kept on the phone and POSTed later.
    const payload: CheckinPayload = {
      athlete_id: athleteId,
      // The phone's own date, so the check-in lands on the athlete's day,
      // not the server's UTC one. See app/api/wellness/route.ts.
      check_date: todayISODate(),
      readiness,
      // Sent explicitly, including when empty: [] means "nothing hurts",
      // which is an answer, not an absence of one.
      sore_areas: somethingSore ? soreAreas : [],
      session_event_id: sessionEventId ?? null,
      injury_update: openInjuries.length ? injuryUpdate.trim() || null : null,
    }
    try {
      // An older answer for today still waiting on this phone is superseded by
      // this one. Let any drain that is already sending it finish first, then
      // drop it, so it can never reach the server after this answer does.
      await settleDrain()
      await removeCheckin(checkinKey(payload.athlete_id, payload.check_date))
      await apiMutate('/api/wellness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setDone(true)
      onSaved?.()
    } catch (e) {
      // No signal: keep it and say so. A server that answered no is NOT this
      // case — that answer would be refused again later, so it is shown now.
      const online = typeof navigator === 'undefined' || navigator.onLine !== false
      if (isOfflineFailure(e, online) && (await putCheckin(payload))) {
        queuedRef.current = true
        setQueued(true)
        setDone(true)
      } else {
        // Includes a phone that cannot store anything (private mode): the
        // behaviour this screen always had.
        setError(e instanceof Error ? e.message : 'Could not save your check-in. Try again.')
      }
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

  /* Lines about other days' check-ins on this phone. A waiting one needs no
   * action; one that could not be sent stays until it is dismissed, because
   * an athlete who never learns an answer was lost thinks their coach has it. */
  const notesBlock = notes.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
      {notes.map((n) => {
        const failed = n.status !== 'queued'
        return (
          <div
            key={n.key}
            role={failed ? 'alert' : 'status'}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '10px 12px', borderRadius: 10,
              background: failed ? 'var(--warning-light)' : 'var(--surface-2)',
              border: `1px solid ${failed ? 'var(--warning-border)' : 'var(--border)'}`,
            }}
          >
            <div style={{ flex: '1 1 160px', minWidth: 0, color: 'var(--text)', fontSize: 'var(--fs-3)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
              {failed
                ? queueNote(n)
                : `Your check-in from ${checkinDayLabel(n.payload.check_date)} is saved on this phone. It’ll send when you have signal.`}
            </div>
            {failed && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void dismissNote(n.key)}
                style={{ minHeight: 44, minWidth: 44, padding: '0 14px', fontSize: 'var(--fs-2)', flexShrink: 0 }}
              >
                Dismiss
              </button>
            )}
          </div>
        )
      })}
    </div>
  )

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
        {/* The athlete's part is done either way, so the tick stays. What is
            not done yet is said plainly, in the place they are looking. */}
        {queued && (
          <div role="status" style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: 'var(--fs-3)', lineHeight: 1.45, overflowWrap: 'anywhere',
          }}>
            Saved on this phone. It’ll send when you have signal.
          </div>
        )}
        <div style={{ color: 'var(--text-2)', marginTop: 10, fontSize: 'var(--fs-3)', lineHeight: 1.5 }}>
          {coachSees}
        </div>
        {notesBlock}
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

      {notesBlock}

      {/* ── 1 · readiness, first, so it is on screen without a scroll ───── */}
      {/* One track, three stops. A low answer is drawn exactly like a high
          one — same fill, same weight — because the control records where you
          are and must not react to it. */}
      <div style={{ marginTop: 16 }}>
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

      {/* ── 2 · the body, behind one question ────────────────────────────── */}
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={EYEBROW} id={`${noteId}-sore`}>Anything sore?</div>
        <div
          role="group"
          aria-labelledby={`${noteId}-sore`}
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, marginTop: 10,
            padding: 4, borderRadius: 18, border: '1px solid var(--border)', background: 'var(--bg)',
          }}
        >
          {([
            { value: false, label: 'Nothing sore' },
            { value: true, label: 'Something’s sore' },
          ]).map((opt) => {
            const on = somethingSore === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={on}
                onClick={() => { setSomethingSore(opt.value); setError(null) }}
                style={{
                  minWidth: 0, minHeight: 48, padding: '8px 6px',
                  borderRadius: 14, cursor: 'pointer', border: 'none',
                  background: on ? 'var(--primary)' : 'transparent',
                  color: on ? 'var(--on-primary)' : 'var(--text)',
                  fontFamily: 'inherit', fontWeight: on ? 800 : 600,
                  fontSize: 'var(--fs-4)', lineHeight: 1.25, textAlign: 'center',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        {somethingSore && (
          <>
            <div style={{ marginTop: 14, fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.5 }}>
              Tap each place that is sore or bothering you.
            </div>
            <div style={{ marginTop: 12 }}>
              {/* showSelection off: the line below is the one list of what is
                  marked. BodyMap's own "Selected: …" said the same thing in
                  different words, and disagreed with it when empty. */}
              <BodyMap selected={soreAreas} onChange={(next) => { setSoreAreas(next); setError(null) }} perspective="self" showSelection={false} />
            </div>
            <div aria-live="polite" style={{ marginTop: 8, fontSize: 'var(--fs-3)', color: 'var(--text)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              {soreAreas.length === 0
                ? 'Nothing marked yet — tap where it is sore.'
                : <><strong>Marked: </strong>{soreAreas.map(regionLabel).join(', ')}</>}
            </div>
          </>
        )}
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
