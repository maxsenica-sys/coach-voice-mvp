'use client'

import { useState, useRef, useEffect } from 'react'
import { apiJson, apiMutate } from '@/lib/api-client'
import { formatSessionDate, todayISODate, yesterdayISODate } from '@/lib/session-date'
import { errorMessage } from '@/lib/errors'
import { responseOption } from '@/lib/session-response'
import type { LastFocus } from '@/app/api/athletes/[id]/last-focus/route'
import { SUPPORTED_RECORDING_TYPES, transcribeFile } from '@/lib/audio-mime'
import { newRecordingId, patchRecording, putRecording, deleteRecording, type PendingRecording } from '@/lib/recording-queue'

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
  coachSport?: string
  onClose: () => void
  onSaved: () => void
}

export default function QuickSessionModal({ athletes, groups, defaultAthleteId, defaultGroupId, coachSport = '', onClose, onSaved }: QuickSessionModalProps) {
  const [mode, setMode] = useState<'athlete' | 'group'>(defaultGroupId ? 'group' : 'athlete')
  // No fallback to athletes[0]/groups[0]. The roster arrives ordered
  // created_at desc, so that fallback silently attributed a session to whoever
  // was added to the roster most recently — a different person each time the
  // roster grew. Sharing defaults on, so save then emailed that athlete and
  // their caretakers, and a session can be neither deleted nor reassigned.
  // Opened without a target, the modal now opens with no target.
  const [athleteId, setAthleteId] = useState(defaultAthleteId ?? '')
  const [groupId, setGroupId] = useState(defaultGroupId ?? '')
  const [sessionName, setSessionName] = useState('')
  // Sessions are often written up after the fact — the day before's training
  // logged over breakfast. Defaults to today; the picker moves it back.
  const [sessionDate, setSessionDate] = useState(todayISODate())
  const [transcript, setTranscript] = useState('')
  const [audioPath, setAudioPath] = useState<string | null>(null)
  const [audioMime, setAudioMime] = useState<string | null>(null)
  // Shared by default: the point of recording a session is that the athlete
  // receives it. Defaulting to private meant 27 of 40 sessions silently never
  // reached anyone — untick before saving to keep one to yourself.
  const [shareWithAthlete, setShareWithAthlete] = useState(true)

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

  /**
   * What this athlete was last asked to work on, and whether it landed.
   *
   * `focus_points` is the only forward-looking field the product has, and
   * nothing has ever carried it forward — the coach records session two with
   * no memory of what they asked for in session one. This is that memory, at
   * the only moment it can change what gets said: the seconds before the
   * recording starts.
   *
   * Read-only. It never pre-fills anything and never blocks a save; a coach who
   * wants to talk about something else just talks about something else.
   */
  const [lastFocus, setLastFocus] = useState<LastFocus | null>(null)

  /**
   * The id of this recording's row in the local queue, once it has one.
   *
   * Set the moment the recorder stops, before any network call. Everything
   * after that updates the same row, and the row is deleted when the session
   * finally saves. Null means either no recording was made (the coach typed a
   * transcript) or the device has no usable local storage.
   */
  const queuedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (mode !== 'athlete' || !athleteId) { setLastFocus(null); return }
    let cancelled = false
    apiJson<{ focus: LastFocus | null }>(`/api/athletes/${athleteId}/last-focus`, { cache: 'no-store' })
      .then((j) => { if (!cancelled) setLastFocus(j.focus ?? null) })
      // A missing prompt is not worth an error message on top of a recorder.
      .catch(() => { if (!cancelled) setLastFocus(null) })
    return () => { cancelled = true }
  }, [athleteId, mode])

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

      // The candidate list and its order now live in lib/audio-mime.ts, so the
      // offline replay path cannot drift from this one. The order is unchanged
      // and load-bearing: mp4 first because iOS Safari cannot decode WebM at
      // all, and isTypeSupported still guards the choice.
      const mimeType = SUPPORTED_RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const mr = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 })
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

    // ── The recording is durable from here ──────────────────────────────
    // Written to IndexedDB before anything touches the network, because this
    // blob is the only irreplaceable thing in the flow. A sports hall has no
    // signal, and until now a failed upload — or iOS discarding a backgrounded
    // PWA — destroyed forty seconds the coach cannot say again.
    //
    // Best-effort: if local storage is unavailable this returns false and the
    // flow behaves exactly as it did before the queue existed.
    const queueId = newRecordingId()
    const group = groups.find((g) => g.id === groupId)
    const athlete = athletes.find((a) => a.id === athleteId)
    const queued: PendingRecording = {
      id: queueId,
      createdAt: Date.now(),
      blob,
      mimeType,
      mode,
      athleteId: mode === 'athlete' ? athleteId : null,
      groupId: mode === 'group' ? groupId : null,
      // Snapshotted so a queued recording survives the squad being renamed.
      groupName: group?.name ?? null,
      memberIds: mode === 'group' ? (group?.member_ids ?? []) : [],
      targetLabel: mode === 'group'
        ? (group?.name ?? 'Squad')
        : athlete ? `${athlete.first_name} ${athlete.last_name}` : 'an athlete',
      sessionName,
      sessionDate,
      coachSport: coachSport || null,
      shareWithAthlete,
      stage: 'captured',
      audioPath: null,
      transcript: null,
      // Not yet: the coach has not seen the review step, let alone agreed to
      // save. See the note on `ready` in lib/recording-queue.ts.
      ready: false,
      attempts: 0,
      lastError: null,
    }
    if (await putRecording(queued)) queuedIdRef.current = queueId

    setTranscribing(true)
    try {
      let uploadedPath: string | null = null

      // Upload straight to Supabase Storage with a signed URL. Only the path then
      // travels through Vercel, so the 4.5MB serverless body limit no longer applies.
      try {
        const urlRes = await fetch(
          '/api/sessions/audio-upload-url?' + new URLSearchParams({ mime_type: mimeType }),
        )
        if (urlRes.ok) {
          const { signedUrl, path } = await urlRes.json()
          const putRes = await fetch(signedUrl, {
            method: 'PUT',
            headers: { 'content-type': mimeType },
            body: blob,
          })
          if (putRes.ok) uploadedPath = path
        }
      } catch {
        /* fall back to sending the file inline below */
      }

      const fd = new FormData()
      if (uploadedPath) {
        fd.append('audio_path', uploadedPath)
      } else {
        // Fallback for when the signed upload is unavailable. Works under 4.5MB.
        // The filename extension comes from lib/audio-mime.ts — Whisper reads
        // the codec from it, and it must match what was actually recorded.
        fd.append('file', transcribeFile(blob, mimeType))
      }
      if (coachSport) fd.append('sport', coachSport)

      const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error(
            `That recording is too large to upload (${(blob.size / 1048576).toFixed(1)}MB). ` +
            'Record in shorter parts, or type the transcript below.'
          )
        }
        throw new Error(json.error ?? `Transcription failed (${res.status}). You can type the transcript below.`)
      }
      if (json.text) setTranscript(json.text)

      // The recording is already in storage — keep the path on the session so a
      // mis-heard transcript can be replayed later.
      if (uploadedPath) {
        setAudioPath(uploadedPath)
        setAudioMime(mimeType)
      }

      // Record what was achieved, so a later retry resumes rather than paying
      // for the upload and the transcription again.
      if (queuedIdRef.current) {
        await patchRecording(queuedIdRef.current, {
          audioPath: uploadedPath,
          transcript: typeof json.text === 'string' ? json.text : null,
          stage: json.text ? 'transcribed' : uploadedPath ? 'uploaded' : 'captured',
        })
      }
    } catch (e: unknown) {
      setError(errorMessage(e, 'Transcription failed. You can type the transcript manually.'))
    } finally {
      setTranscribing(false)
      setStep('review')
    }
  }

  const save = async () => {
    if (!transcript.trim()) { setError('Please record or type a transcript.'); return }
    // Saving a cleared date would quietly file the session under today, which
    // is the exact mistake the picker exists to prevent.
    if (!sessionDate) { setError('Pick the date this session happened.'); return }
    if (sessionDate > todayISODate()) { setError('A session date cannot be in the future.'); return }
    setSaving(true)
    setError('')

    // Mark the queued recording as wanted BEFORE attempting the network, and
    // with the coach's final answers on it. If the save fails from here the row
    // is already complete and `ready`, so the drainer can finish it later
    // without the coach re-entering anything.
    if (queuedIdRef.current) {
      await patchRecording(queuedIdRef.current, {
        ready: true,
        transcript: transcript.trim(),
        sessionName,
        sessionDate,
        shareWithAthlete,
        audioPath,
      })
    }

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
            session_date: sessionDate,
            sport_context: coachSport || null,
            audio_path: audioPath,
            audio_mime: audioMime,
          }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Failed to save')
      } else {
        // Group session: save one session per member
        if (!groupId) { setError('Select a group.'); setSaving(false); return }
        const group = groups.find((g) => g.id === groupId)
        if (!group || group.member_ids.length === 0) { setError('This group has no members.'); setSaving(false); return }

        // One session per member. Previously these were fired without checking
        // any response, so a group save reported success even when every insert
        // failed. Report partial failure by name instead of swallowing it.
        const results = await Promise.all(
          group.member_ids.map(async (aid) => {
            try {
              await apiMutate('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  athlete_id: aid,
                  // Marks the row as a squad recording. This is what lets the
                  // athlete side withhold a transcript that is the coach
                  // talking about the whole group — until this existed, every
                  // member could read what the coach said about every other
                  // member. The server validates it against the coach's own
                  // groups rather than trusting it.
                  group_id: group.id,
                  session_name: sessionName.trim() ? `[${group.name}] ${sessionName.trim()}` : `[${group.name}] Session`,
                  transcript: transcript.trim(),
                  shared_with_athlete: shareWithAthlete,
                  session_date: sessionDate,
                  sport_context: coachSport || null,
                  audio_path: audioPath,
                  audio_mime: audioMime,
                }),
              })
              return { aid, ok: true }
            } catch {
              return { aid, ok: false }
            }
          })
        )

        const failed = results.filter((r) => !r.ok)
        if (failed.length === results.length) {
          throw new Error('Could not save this session for anyone in the group. Nothing was recorded.')
        }
        if (failed.length > 0) {
          const names = failed
            .map((r) => athletes.find((a) => a.id === r.aid))
            .map((a) => (a ? `${a.first_name} ${a.last_name}` : 'an athlete'))
            .join(', ')
          throw new Error(`Saved for ${results.length - failed.length} of ${results.length}. Failed for: ${names}.`)
        }
      }

      // Saved for real — the local copy has done its job.
      if (queuedIdRef.current) {
        await deleteRecording(queuedIdRef.current)
        queuedIdRef.current = null
      }

      onSaved()
      onClose()
    } catch (e: unknown) {
      // The recording is not lost. It is on this device, marked ready, and the
      // pending panel on the dashboard will retry it — so the message says that
      // rather than implying the last forty seconds are gone.
      setError(
        queuedIdRef.current
          ? `${errorMessage(e, 'Could not save that')} — the recording is saved on this phone and will send when you are back online.`
          : errorMessage(e, 'Failed to save session'),
      )
    } finally {
      setSaving(false)
    }
  }

  // Recomputed per render rather than held in state: a modal left open across
  // midnight would otherwise cap the picker at yesterday.
  const today = todayISODate()
  const sessionDateLabel = !sessionDate
    ? 'Pick the day this session happened'
    : sessionDate === today
      ? 'Today'
      : sessionDate === yesterdayISODate()
        ? 'Yesterday'
        : formatSessionDate({ session_date: sessionDate }, { weekday: 'long', month: 'short', day: 'numeric' })

  // The chips are the only live control until a target is picked, which is what
  // makes the required choice self-evident without a line of instructional text.
  const hasTarget = mode === 'athlete' ? !!athleteId : !!groupId

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
      // The review step runs ~600px. Without this the card clipped
      // unscrollably on a short viewport, or with the keyboard raised over the
      // transcript textarea — .card-lg sets no max-height of its own.
      overflowY: 'auto',
    }}>
      <div className="card-lg" style={{ width: '100%', maxWidth: 560, padding: 32, position: 'relative', maxHeight: '100%', overflowY: 'auto' }}>
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

              {/* Chips rather than a native <select>. A select hides the current
                  value's meaning behind an interaction and costs a wheel drag;
                  with no pre-selection the target has to be visible, not
                  discovered. Same filled-chip treatment as the mode toggle
                  above, so the pattern is already familiar in this modal. */}
              {mode === 'athlete' ? (
                athletes.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>
                    No athletes yet — add one first before recording a session.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 132, overflowY: 'auto' }}>
                    {athletes.map((a) => {
                      const on = athleteId === a.id
                      return (
                        <button
                          key={a.id}
                          onClick={() => setAthleteId(on ? '' : a.id)}
                          aria-pressed={on}
                          style={{
                            minHeight: 40,
                            padding: '8px 14px',
                            borderRadius: 999,
                            border: '1.5px solid',
                            borderColor: on ? 'var(--primary)' : 'var(--border)',
                            background: on ? 'var(--primary)' : 'var(--card)',
                            color: on ? '#fff' : 'var(--text)',
                            fontSize: 14,
                            fontWeight: on ? 700 : 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {a.first_name} {a.last_name}
                        </button>
                      )
                    })}
                  </div>
                )
              ) : (
                <div>
                  {groups.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>
                      No squads yet — create one first, or record for an individual athlete.
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 132, overflowY: 'auto' }}>
                    {groups.map((g) => {
                      const on = groupId === g.id
                      return (
                        <button
                          key={g.id}
                          onClick={() => setGroupId(on ? '' : g.id)}
                          aria-pressed={on}
                          style={{
                            minHeight: 40,
                            padding: '8px 14px',
                            borderRadius: 999,
                            border: '1.5px solid',
                            borderColor: on ? 'var(--primary)' : 'var(--border)',
                            background: on ? 'var(--primary)' : 'var(--card)',
                            color: on ? '#fff' : 'var(--text)',
                            fontSize: 14,
                            fontWeight: on ? 700 : 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {g.name} ({g.member_ids.length})
                        </button>
                      )
                    })}
                  </div>
                  {groupMemberNames.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                      Session will be saved for: {groupMemberNames.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Last time you said ──
                Read-only, and only when there is something to show. It does
                not pre-fill the transcript, gate the recording, or ask the
                coach to confirm anything — a prompt that demands a response
                before you may speak is worse than no prompt courtside.

                When the athlete answered "not sure what you mean", that is the
                single most useful sentence this app can put in front of a
                coach, so it is said plainly rather than colour-coded. */}
            {lastFocus && (
              <div style={{
                padding: '11px 13px', borderRadius: 10,
                background: 'var(--coach-light)', border: '1px solid var(--coach-border)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--coach-on-light)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                  Last time you said
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.45 }}>
                  {lastFocus.point}
                </div>
                {(() => {
                  const answered = responseOption(lastFocus.response)
                  const when = lastFocus.session_date
                    ? formatSessionDate({ session_date: lastFocus.session_date }, { day: 'numeric', month: 'short' })
                    : null
                  return (
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
                      {when ? `${when}. ` : ''}
                      {answered
                        ? (lastFocus.response === 'not_clear'
                            ? 'They said it was not clear — worth covering again.'
                            : `They said: ${answered.coachLabel.toLowerCase()}.`)
                        : 'They have not answered yet.'}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Session name + date */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '2 1 220px', minWidth: 0 }}>
                <label className="label">Session name (optional)</label>
                <input
                  className="input"
                  placeholder="e.g. Tackling drills, Speed work"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                />
              </div>
              <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                <label className="label">Session date</label>
                <input
                  className="input"
                  type="date"
                  value={sessionDate}
                  max={today}
                  onChange={(e) => setSessionDate(e.target.value)}
                />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
                  {sessionDateLabel}
                </div>
              </div>
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
                    disabled={!hasTarget}
                    style={{ width: 200, fontSize: 16 }}
                  >
                    🎙 Start Recording
                  </button>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>or</div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setStep('review')}
                    disabled={!hasTarget}
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
                  onClick={() => {
                    // Stop any lingering mic stream before re-recording
                    streamRef.current?.getTracks().forEach(t => t.stop())
                    streamRef.current = null
                    // Re-recording is an explicit decision to discard, so the
                    // queued copy goes with it rather than lingering as an
                    // abandoned blob the coach never meant to keep.
                    if (queuedIdRef.current) {
                      void deleteRecording(queuedIdRef.current)
                      queuedIdRef.current = null
                    }
                    setStep('record')
                    setTranscript('')
                    setAudioPath(null)
                    setAudioMime(null)
                  }}
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

            {/* Session date — the save happens on this step, so it stays
                editable here for anyone who skipped straight to typing. */}
            <div>
              <label className="label">Session date</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  className="input"
                  type="date"
                  value={sessionDate}
                  max={today}
                  onChange={(e) => setSessionDate(e.target.value)}
                  style={{ maxWidth: 190 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sessionDateLabel}</span>
              </div>
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
