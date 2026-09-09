'use client'

import { useState } from 'react'
import { WELLNESS_METRICS, metricColor, metricTint } from '@/lib/wellness-config'
import { apiMutate } from '@/lib/api-client'
import BodyMap from '@/app/components/BodyMap'
import { BODY_MAP_THRESHOLD, isBodyRegion } from '@/lib/body-map'

/** Today's check-in, when there already is one. Shaped to accept a row
 *  straight from GET /api/wellness, where every metric is nullable. */
export interface WellnessEntry {
  energy?: number | null
  mood?: number | null
  sleep_q?: number | null
  soreness?: number | null
  stress?: number | null
  notes?: string | null
  /** 0-10 Numeric Rating Scale, MORE IS WORSE. Not the same scale as `soreness`. */
  soreness_score?: number | null
  soreness_areas?: string[] | null
}

interface Props {
  athleteId: string
  /**
   * Today's row, if the athlete has already checked in. Without this the form
   * opened blank every time: an athlete who checked in at 8am and came back at
   * 6pm was shown five empty rows and a button that refused to save until all
   * five were re-entered — the app's own record of the day, presented as if it
   * had never happened.
   */
  initial?: WellnessEntry | null
  onSaved?: () => void
}

const METRICS = WELLNESS_METRICS

function seedScores(entry?: WellnessEntry | null): Record<string, number> {
  if (!entry) return {}
  const out: Record<string, number> = {}
  for (const m of METRICS) {
    const v = (entry as Record<string, unknown>)[m.key]
    if (typeof v === 'number') out[m.key] = v
  }
  return out
}

export default function WellnessSubmit({ athleteId, initial, onSaved }: Props) {
  // Seeded once, on mount. Deliberately not synced to `initial` afterwards:
  // re-seeding on every parent refetch would overwrite an answer the athlete
  // was part-way through changing.
  const [scores, setScores] = useState<Record<string, number>>(() => seedScores(initial))
  const [notes, setNotes] = useState(initial?.notes ?? '')

  /**
   * The soreness follow-up, in three steps that each unlock the next.
   *
   * Sore? -> how bad (0-10) -> where, but only from BODY_MAP_THRESHOLD up.
   *
   * The gating is the feature. An athlete with nothing wrong taps "No" and is
   * finished; a body map shown to everyone every morning is a form, and forms
   * get abandoned. Mild soreness gets a number and no map, because "where" is
   * not worth asking when the answer changes nothing a coach would do.
   *
   * The 0-10 scale here runs the OPPOSITE way to the five metrics above, where
   * 5 is always the good end. That is deliberate: this is the Numeric Rating
   * Scale athletes and physios already use, and 4 is its conventional mild /
   * moderate boundary. The two are never averaged — see migration 026.
   */
  const [sore, setSore] = useState<boolean | null>(() => {
    if (initial?.soreness_score != null) return true
    return null
  })
  const [soreScore, setSoreScore] = useState<number | null>(initial?.soreness_score ?? null)
  const [soreAreas, setSoreAreas] = useState<string[]>(
    () => (initial?.soreness_areas ?? []).filter(isBodyRegion),
  )

  const showBodyMap = sore === true && soreScore !== null && soreScore >= BODY_MAP_THRESHOLD
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const editing = METRICS.every((m) => seedScores(initial)[m.key] !== undefined)

  const setScore = (key: string, val: number) => {
    setScores((prev) => ({ ...prev, [key]: val }))
    setSaved(false)
  }

  const handleSubmit = async () => {
    const filled = METRICS.filter((m) => scores[m.key] !== undefined).length
    if (filled < 5) { setError('Please rate all 5 metrics before submitting.'); return }
    setSaving(true)
    setError('')
    try {
      await apiMutate('/api/wellness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          ...scores,
          notes: notes.trim() || null,
          // "No soreness" clears both fields rather than leaving yesterday's
          // answer attached to today's row.
          soreness_score: sore === true ? soreScore : null,
          // Areas only travel when the map was actually shown. Below the
          // threshold there is nothing to send, and a stale selection from a
          // worse day must not ride along.
          soreness_areas: showBodyMap && soreAreas.length ? soreAreas : null,
        }),
      })
      setSaved(true)
      onSaved?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
        {editing ? 'Change your answers' : 'Daily Wellness Check-in'}
      </div>
      <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-muted)', marginBottom: 18 }}>
        {editing
          ? 'You checked in today. Update anything that has changed.'
          : 'Rate yourself 1–5. Takes 30 seconds.'}
      </div>

      {METRICS.map((m) => (
        <div key={m.key} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <span style={{ fontSize: 16 }}>{m.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{m.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {m.hint}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((v) => {
              const selected = scores[m.key] === v
              // The selected state now carries the same good/ok/low meaning as
              // the coach's roster dot. It also used to make the answer the
              // athlete had just given the *least* legible thing on screen —
              // --primary on a pale tint measured 2.99-3.48:1 against 5.93:1
              // unselected, so choosing a score dropped it below AA.
              const bg = selected ? metricTint(m.key, v) : '#fff'
              return (
                <button
                  key={v}
                  onClick={() => setScore(m.key, v)}
                  style={{
                    // 44px: Apple HIG and the app's own house rule in
                    // globals.css, which is scoped to .btn and so never reached
                    // these bare buttons.
                    flex: 1, height: 44, borderRadius: 8,
                    border: selected ? `2px solid ${metricColor(m.key, v)}` : '1.5px solid var(--border)',
                    background: bg,
                    fontWeight: selected ? 800 : 600, fontSize: 15,
                    color: selected ? metricColor(m.key, v) : 'var(--text-2)',
                    cursor: 'pointer', transition: 'all 0.1s',
                    boxShadow: selected ? `0 0 0 3px ${metricTint(m.key, v)}` : 'none',
                    transform: selected ? 'scale(1.05)' : 'none',
                  }}
                >
                  {v}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* ── Soreness follow-up ──
          Three steps, each unlocking the next, and every one of them skippable
          by answering "No" at the top. See the note on the state above for why
          the gate matters more than the map. */}
      <div style={{
        marginBottom: 16, padding: '13px 14px',
        borderRadius: 'var(--radius-sm)', background: 'var(--bg)',
        border: '1px solid var(--border-soft)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          Are you sore anywhere today?
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { v: false, label: 'No' },
            { v: true, label: 'Yes' },
          ].map((opt) => {
            const on = sore === opt.v
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSore(opt.v)
                  setSaved(false)
                  // Answering "No" clears the follow-up rather than hiding it,
                  // so a mind changed twice cannot leave a stale body map
                  // attached to a day the athlete said they were fine.
                  if (!opt.v) { setSoreScore(null); setSoreAreas([]) }
                }}
                style={{
                  flex: 1, minHeight: 44, borderRadius: 8,
                  border: `1.5px solid ${on ? 'var(--primary-dark)' : 'var(--border)'}`,
                  background: on ? 'var(--primary-light)' : 'var(--card)',
                  color: on ? 'var(--primary-dark)' : 'var(--text-2)',
                  fontFamily: 'inherit', fontSize: 15, fontWeight: on ? 800 : 600,
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {sore === true && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              How bad is it?
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, marginBottom: 8 }}>
              0 is nothing, 10 is the worst it has been. Here more is worse — the
              opposite of the five questions above.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: 3 }}>
              {Array.from({ length: 11 }, (_, v) => {
                const on = soreScore === v
                const bad = v >= BODY_MAP_THRESHOLD
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${v} out of 10`}
                    onClick={() => {
                      setSoreScore(v)
                      setSaved(false)
                      // Dropping back below the threshold discards the areas:
                      // they were an answer to a question no longer being asked.
                      if (v < BODY_MAP_THRESHOLD) setSoreAreas([])
                    }}
                    style={{
                      minHeight: 44, borderRadius: 7,
                      border: on
                        ? `2px solid ${bad ? 'var(--wellness-low)' : 'var(--wellness-ok)'}`
                        : '1px solid var(--border)',
                      background: on
                        ? (bad ? 'var(--wellness-low-tint)' : 'var(--wellness-ok-tint)')
                        : 'var(--card)',
                      color: on
                        ? (bad ? 'var(--wellness-low)' : 'var(--wellness-ok)')
                        : 'var(--text-2)',
                      fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 800 : 600,
                      cursor: 'pointer', padding: 0,
                    }}
                  >
                    {v}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {showBodyMap && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
              Where?
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              Tap anywhere that hurts. You can pick more than one.
            </div>
            <BodyMap selected={soreAreas} onChange={(next) => { setSoreAreas(next); setSaved(false) }} />
          </div>
        )}

        {sore === true && soreScore !== null && !showBodyMap && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            Noted. We only ask where it hurts from {BODY_MAP_THRESHOLD} upwards.
          </div>
        )}
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 16 }}>
        <label className="label" style={{ marginBottom: 6, display: 'block' }}>Anything else to note? (optional)</label>
        <textarea
          className="input"
          rows={2}
          style={{ resize: 'none', fontSize: 13 }}
          placeholder="Feeling a bit tired, sore left knee…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {saved ? (
        <div style={{
          background: 'var(--success-light)', border: '1px solid #CBD7C0', borderRadius: 8,
          padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--success)',
        }}>
          ✓ Saved. Your coach can see your wellness scores.
        </div>
      ) : (
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Submit check-in'}
        </button>
      )}
    </div>
  )
}
