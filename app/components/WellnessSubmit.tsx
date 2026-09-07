'use client'

import { useState } from 'react'
import { WELLNESS_METRICS, metricColor, metricTint } from '@/lib/wellness-config'

interface Props {
  athleteId: string
  onSaved?: () => void
}

const METRICS = WELLNESS_METRICS
const LABELS: Record<number, string> = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }

export default function WellnessSubmit({ athleteId, onSaved }: Props) {
  const [scores, setScores] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

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
      const res = await fetch('/api/wellness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId, ...scores, notes: notes.trim() || null }),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error) }
      setSaved(true)
      onSaved?.()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Daily Wellness Check-in</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
        Rate yourself 1–5. Takes 30 seconds.
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
          ✓ Check-in saved! Your coach can now see your wellness data.
        </div>
      ) : (
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Submit check-in'}
        </button>
      )}
    </div>
  )
}
