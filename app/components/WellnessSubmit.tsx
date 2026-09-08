'use client'

import { useState } from 'react'
import { WELLNESS_METRICS, metricColor, metricTint } from '@/lib/wellness-config'
import { apiMutate } from '@/lib/api-client'

/** Today's check-in, when there already is one. Shaped to accept a row
 *  straight from GET /api/wellness, where every metric is nullable. */
export interface WellnessEntry {
  energy?: number | null
  mood?: number | null
  sleep_q?: number | null
  soreness?: number | null
  stress?: number | null
  notes?: string | null
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
        body: JSON.stringify({ athlete_id: athleteId, ...scores, notes: notes.trim() || null }),
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
