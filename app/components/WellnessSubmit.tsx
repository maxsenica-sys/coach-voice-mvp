'use client'

import { useState } from 'react'

interface Props {
  athleteId: string
  onSaved?: () => void
}

const METRICS = [
  { key: 'energy',   label: 'Energy',   icon: '⚡', hint: 'How energetic do you feel today?' },
  { key: 'mood',     label: 'Mood',     icon: '😊', hint: 'How is your overall mood?' },
  { key: 'sleep_q',  label: 'Sleep',    icon: '😴', hint: 'How well did you sleep last night?' },
  { key: 'soreness', label: 'Soreness', icon: '💪', hint: '1 = very sore, 5 = no soreness' },
  { key: 'stress',   label: 'Stress',   icon: '🧠', hint: '1 = very stressed, 5 = relaxed' },
] as const

const LABELS: Record<number, string> = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }

const COLOR_MAP: Record<string, string[]> = {
  energy:   ['#fef2f2','#fef3c7','#fef9c3','#f0fdf4','#dcfce7'],
  mood:     ['#fef2f2','#fef3c7','#fef9c3','#eff6ff','#dbeafe'],
  sleep_q:  ['#fef2f2','#fef3c7','#fef9c3','#faf5ff','#ede9fe'],
  soreness: ['#dcfce7','#f0fdf4','#fef9c3','#fef3c7','#fef2f2'],
  stress:   ['#dcfce7','#f0fdf4','#fef9c3','#fef3c7','#fef2f2'],
}

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

      {METRICS.map(({ key, label, icon, hint }) => (
        <div key={key} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <span style={{ fontSize: 16 }}>{icon}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {hint}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((v) => {
              const selected = scores[key] === v
              const bg = COLOR_MAP[key]?.[v - 1] ?? '#f8fafc'
              return (
                <button
                  key={v}
                  onClick={() => setScore(key, v)}
                  style={{
                    flex: 1, height: 40, borderRadius: 8,
                    border: selected ? '2px solid var(--primary)' : '1.5px solid var(--border)',
                    background: selected ? bg : '#fff',
                    fontWeight: selected ? 800 : 600, fontSize: 15,
                    color: selected ? 'var(--primary)' : 'var(--text-2)',
                    cursor: 'pointer', transition: 'all 0.1s',
                    boxShadow: selected ? '0 0 0 3px var(--primary-light)' : 'none',
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
          background: 'var(--success-light)', border: '1px solid #bbf7d0', borderRadius: 8,
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
