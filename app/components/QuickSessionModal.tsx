'use client'

import { useState, useRef, useEffect } from 'react'

interface Athlete {
  id: string
  first_name: string
  last_name: string
}

interface Group {
  id: string
  name: string
  color: string
  member_ids: string[]
}

interface QuickSessionModalProps {
  athletes: Athlete[]
  groups: Group[]
  defaultAthleteId?: string
  defaultGroupId?: string
  onClose: () => void
  onSaved: () => void
}

export default function QuickSessionModal({ athletes, groups, defaultAthleteId, defaultGroupId, onClose, onSaved }: QuickSessionModalProps) {
  const [mode, setMode] = useState<'athlete' | 'group'>(defaultGroupId ? 'group' : 'athlete')
  const [athleteId, setAthleteId] = useState(defaultAthleteId ?? athletes[0]?.id ?? '')
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? '')
  const [sessionName, setSessionName] = useState('')
  const [transcript, setTranscript] = useState('')
  const [shareWithAthlete, setShareWithAthlete] = useState(false)

  // Recording
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'record' | 'review'>('record')

  const [micLevel, setMicLevel] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const startRecording = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      analyserRef.current = analyser

      const tick = () => {
        const buf = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(buf)
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length
        setMicLevel(Math.min(1, avg / 80))
        animFrameRef.current = requestAnimationFrame(tick)
      }
      tick()

      const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      const mimeType = supported.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(250)
      mediaRecorderRef.current = mr
      setRecording(true)
    } catch {
      setError('Microphone access denied. Please allow microphone access.')
    }
  }

  const stopAndTranscribe = async () => {
    if (!mediaRecorderRef.current) return
    setRecording(false)
    cancelAnimationFrame(animFrameRef.current)
    setMicLevel(0)

    const mr = mediaRecorderRef.current
    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve()
      mr.stop()
    })
    streamRef.current?.getTracks().forEach((t) => t.stop())

    const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    if (blob.size < 1000) { setStep('review'); return }

    setTranscribing(true)
    try {
      const fd = new FormData()
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      fd.append('file', new File([blob], `recording.${ext}`, { type: mimeType }))

      const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Transcription failed. Please check your API key.')
      if (json.text) setTranscript(json.text)
    } catch {
      setError('Transcription failed. You can type the transcript manually.')
    } finally {
      setTranscribing(false)
      setStep('review')
    }
  }

  const save = async () => {
    if (!transcript.trim()) { setError('Please record or type a transcript.'); return }
    setSaving(true)
    setError('')

    try {
      if (mode === 'athlete') {
        if (!athleteId) { setError('Select an athlete.'); setSaving(false); return }
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            athlete_id: athleteId,
            session_name: sessionName.trim() || null,
            transcript: transcript.trim(),
            shared_with_athlete: shareWithAthlete,
          }),
        })
        if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to save')
      } else {
        // Group session: save one session per member
        const group = groups.find((g) => g.id === groupId)
        if (!group || group.member_ids.length === 0) { setError('This group has no members.'); setSaving(false); return }

        await Promise.all(
          group.member_ids.map((aid) =>
            fetch('/api/sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                athlete_id: aid,
                session_name: sessionName.trim() ? `[${group.name}] ${sessionName.trim()}` : `[${group.name}] Session`,
                transcript: transcript.trim(),
                shared_with_athlete: shareWithAthlete,
              }),
            })
          )
        )
      }

      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save session')
    } finally {
      setSaving(false)
    }
  }

  const groupMembers = groups.find((g) => g.id === groupId)?.member_ids ?? []
  const groupMemberNames = groupMembers
    .map((id) => athletes.find((a) => a.id === id))
    .filter(Boolean)
    .map((a) => `${a!.first_name} ${a!.last_name}`)

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 300,
      padding: 20,
    }}>
      <div className="card-lg" style={{ width: '100%', maxWidth: 560, padding: 32, position: 'relative' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Quick Session</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>Record a session without leaving the dashboard</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {/* Step 1: Record */}
        {step === 'record' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Session for: athlete or group */}
            <div>
              <label className="label">Session for</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button
                  onClick={() => setMode('athlete')}
                  className="btn"
                  style={{
                    flex: 1,
                    background: mode === 'athlete' ? 'var(--primary)' : 'var(--card)',
                    color: mode === 'athlete' ? '#fff' : 'var(--text)',
                    border: '1.5px solid',
                    borderColor: mode === 'athlete' ? 'var(--primary)' : 'var(--border)',
                    fontWeight: 600,
                  }}
                >
                  Individual Athlete
                </button>
                {groups.length > 0 && (
                  <button
                    onClick={() => setMode('group')}
                    className="btn"
                    style={{
                      flex: 1,
                      background: mode === 'group' ? 'var(--primary)' : 'var(--card)',
                      color: mode === 'group' ? '#fff' : 'var(--text)',
                      border: '1.5px solid',
                      borderColor: mode === 'group' ? 'var(--primary)' : 'var(--border)',
                      fontWeight: 600,
                    }}
                  >
                    Group / Squad
                  </button>
                )}
              </div>

              {mode === 'athlete' ? (
                athletes.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>
                    No athletes yet — add one first before recording a session.
                  </div>
                ) : (
                  <select
                    className="input"
                    value={athleteId}
                    onChange={(e) => setAthleteId(e.target.value)}
                  >
                    {athletes.map((a) => (
                      <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>
                    ))}
                  </select>
                )
              ) : (
                <div>
                  <select
                    className="input"
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name} ({g.member_ids.length} athletes)</option>
                    ))}
                  </select>
                  {groupMemberNames.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                      Session will be saved for: {groupMemberNames.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Session name */}
            <div>
              <label className="label">Session name (optional)</label>
              <input
                className="input"
                placeholder="e.g. Tackling drills, Speed work"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
            </div>

            {/* Record button */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '20px 0' }}>
              {recording ? (
                <>
                  {/* Mic level bars */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
                    {Array.from({ length: 12 }).map((_, i) => {
                      const h = Math.max(4, Math.round(micLevel * 36 * (0.5 + 0.5 * Math.sin(i * 0.8 + Date.now() / 200))))
                      return (
                        <div key={i} className="mic-bar" style={{ height: Math.max(4, micLevel > 0 ? (4 + Math.round(micLevel * 32 * Math.abs(Math.sin(i)))) : 4) }} />
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="recording-dot" />
                    <span style={{ fontWeight: 700, color: 'var(--danger)' }}>Recording…</span>
                  </div>
                  <button
                    className="btn btn-danger btn-lg"
                    onClick={stopAndTranscribe}
                    style={{ width: 200 }}
                  >
                    Stop & Transcribe
                  </button>
                </>
              ) : transcribing ? (
                <div style={{ color: 'var(--text-2)', fontSize: 15 }}>Transcribing audio…</div>
              ) : (
                <>
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={startRecording}
                    style={{ width: 200, fontSize: 16 }}
                  >
                    🎙 Start Recording
                  </button>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>or</div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setStep('review')}
                    style={{ fontSize: 13 }}
                  >
                    Skip — type transcript manually →
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Review */}
        {step === 'review' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="label" style={{ margin: 0 }}>Transcript</label>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => { setStep('record'); setTranscript('') }}
                >
                  ← Re-record
                </button>
              </div>
              <textarea
                className="input"
                rows={6}
                placeholder="Type or paste transcript here…"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                style={{ resize: 'vertical', fontSize: 14, lineHeight: 1.6 }}
              />
            </div>

            {/* AI summary note */}
            <div style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span>✨</span>
              <span>AI summary will be generated automatically when you save.</span>
            </div>

            {/* Share toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={shareWithAthlete}
                onChange={(e) => setShareWithAthlete(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span>Share transcript & summary with athlete{mode === 'group' ? 's' : ''}</span>
            </label>

            {error && (
              <div style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
              <button
                className="btn btn-primary btn-lg"
                onClick={save}
                disabled={saving || !transcript.trim()}
                style={{ flex: 2 }}
              >
                {saving ? 'Saving…' : mode === 'group' ? `Save for ${groupMembers.length} Athletes` : 'Save Session'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
