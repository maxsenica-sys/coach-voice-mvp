'use client'

import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { apiJson, apiMutate } from '@/lib/api-client'
import { MAX_NEXT_LENGTH } from '@/lib/summary-prompt'
import { formatSessionDate, todayISODate, yesterdayISODate } from '@/lib/session-date'
import { errorMessage } from '@/lib/errors'
import { responseOption } from '@/lib/session-response'
import type { LastFocus } from '@/app/api/athletes/[id]/last-focus/route'
import { SUPPORTED_RECORDING_TYPES, transcribeFile } from '@/lib/audio-mime'
import { newRecordingId, newSharedRecordingId, patchRecording, putRecording, deleteRecording, type PendingRecording } from '@/lib/recording-queue'
import { MAX_SPLIT_ATHLETES, MIN_SPLIT_ATHLETES, type SplitReason, type SplitSection } from '@/lib/split-summary'
import AthletePicker from '@/app/components/AthletePicker'

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

/* One athlete's part of a recording split between several. `reason` is why the
   draft is what it is, so an empty one can say so in words. */
interface SplitDraft {
  summary: string
  next: string
  reason: SplitReason | null
}

export default function QuickSessionModal({ athletes, groups, defaultAthleteId, defaultGroupId, coachSport = '', onClose, onSaved }: QuickSessionModalProps) {
  /* Three targets. 'several' is one recording about two to five named
     athletes, split into one reviewed summary each (Max, 2026-09-26: "I'd
     rather talk and include the athletes in one message and then it can split
     from there"). */
  const [mode, setMode] = useState<'athlete' | 'group' | 'several'>(defaultGroupId ? 'group' : 'athlete')
  // No fallback to athletes[0]/groups[0]. The roster arrives ordered
  // created_at desc, so that fallback silently attributed a session to whoever
  // was added to the roster most recently — a different person each time the
  // roster grew. Sharing defaults on, so save then emailed that athlete and
  // their caretakers, and a session can be neither deleted nor reassigned.
  // Opened without a target, the modal now opens with no target.
  const [athleteId, setAthleteId] = useState(defaultAthleteId ?? '')
  const [groupId, setGroupId] = useState(defaultGroupId ?? '')
  const [athleteIds, setAthleteIds] = useState<string[]>([])
  /* Record first, choose after. Max: "record fast". The target is no longer
     required to start recording — only to save. Opened with a target already
     (from an athlete's profile, a squad), the sheet behaves as it always has. */
  const hasDefaultTarget = Boolean(defaultAthleteId || defaultGroupId)
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

  /* ── The recorder's second proof of life ──────────────────────────────
   *
   * The level meter was the only thing on this screen saying the microphone
   * was live, and it proves it with motion and brightness — both of which
   * `prefers-reduced-motion: reduce` is entitled to take away, and neither of
   * which distinguishes "silent room" from "not recording": twelve bars at
   * their 4px floor look exactly like twelve bars that have stopped being
   * updated. The cost of getting that wrong is a coach talking to a phone that
   * is not listening, and a session that cannot be said again.
   *
   * So the live state is legible from text. `recSecs` advances once a second
   * in tabular mono; digits carry no animation for the media query to disable
   * and no luminance change to flash.
   *
   * Two things make it a proof rather than a decoration:
   *
   *  - It is derived from a wall-clock start time, not counted up, so a
   *    throttled or backgrounded tab still reads the true elapsed length.
   *  - It advances ONLY while the MediaRecorder is actually in its `recording`
   *    state with a live audio track. If the recorder dies under us — another
   *    app seizing the mic, an iOS call interrupting — the digits stop where
   *    they stopped and `recStalled` says so in words. A clock that keeps
   *    ticking past a dead recorder would be the same lie as the frozen meter.
   */
  const [recSecs, setRecSecs] = useState(0)
  const [recStalled, setRecStalled] = useState(false)

  /* Read only to decide whether to say in words what the meter can no longer
     show. It never re-enables an animation. */
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  /* What Whisper thought of its own output. Shown above the transcript in the
     review step, where the coach can still act on it. */
  const [transcriptWarning, setTranscriptWarning] = useState('')

  /* The draft the coach reads before anything sends.
   *
   * Max, 2026-09-25: the summary is drafted at stop-and-transcribe now, not at
   * save. Until this, the first person to read what the model wrote about a
   * named child was the child. */
  const [summaryDraft, setSummaryDraft] = useState('')
  const [nextDraft, setNextDraft] = useState('')
  const [summarising, setSummarising] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  /* 'several' mode: one draft per athlete, keyed by athlete id. */
  const [splitDrafts, setSplitDrafts] = useState<Record<string, SplitDraft>>({})
  const [splitting, setSplitting] = useState(false)
  const [splitError, setSplitError] = useState('')
  /* What Whisper heard, kept so the draft can be written once a target is
     picked — which, recording first, may be after the recording stopped. */
  const [heardText, setHeardText] = useState('')
  /* The id every sibling session of a 'several' save carries (migration 029).
     Made once per recording and reused on a retry, so a partial save that is
     finished later still links to the same siblings. */
  const sharedRecordingIdRef = useRef<string | null>(null)
  /* Athletes whose session from THIS recording has already saved. A retry
     after a partial failure skips them, so nobody gets a duplicate session —
     visible to them and not deletable from the app. */
  const savedIdsRef = useRef<Set<string>>(new Set())
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  /* One AudioContext, reused.
   *
   * startRecording created a new one on every recording and never closed it —
   * not on stop, not in the unmount cleanup below. Chrome allows about six per
   * document. The seventh throws, the bare catch in startRecording turns that
   * into "Microphone access denied. Please allow microphone access.", and the
   * coach is told to fix a permission that was never the problem and cannot be
   * granted. Six sessions in, on the same page, recording simply stops working.
   *
   * Contexts also suspend themselves when a tab is backgrounded, so the one
   * that survives needs resuming rather than replacing. */
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      void audioCtxRef.current?.close().catch(() => null)
      audioCtxRef.current = null
    }
  }, [])

  /* Drives the elapsed clock described above. Keyed off `recording` alone, so
     it starts and stops with the UI's own idea of the recorder without any
     change to startRecording or stopAndTranscribe — it only reads the refs
     those two own, and never writes them. */
  useEffect(() => {
    if (!recording) { setRecSecs(0); setRecStalled(false); return }
    const startedAt = Date.now()
    setRecSecs(0)
    setRecStalled(false)
    /* Sampled four times a second so the displayed second is never late by
       more than a quarter of one, and so a stall is noticed promptly. */
    const id = setInterval(() => {
      const live =
        mediaRecorderRef.current?.state === 'recording' &&
        (streamRef.current?.getAudioTracks() ?? []).some((t) => t.readyState === 'live')
      if (!live) { setRecStalled(true); return }
      setRecStalled(false)
      setRecSecs(Math.floor((Date.now() - startedAt) / 1000))
    }, 250)
    return () => clearInterval(id)
  }, [recording])

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
      /* Constraints, rather than whatever the browser felt like.
       *
       * This asked for `{ audio: true }`, so a Bluetooth or USB mic delivering
       * a stereo stream had the 32kbps budget split across two channels — the
       * coach on a windy pitch recorded at 16kbps per side. channelCount: 1 is
       * the single most useful line here; speech is mono and Whisper reads mono.
       *
       * The three processing flags are requests, not guarantees; a browser that
       * ignores them behaves exactly as it does today. */
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      // Reused, not recreated. See audioCtxRef.
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') await ctx.resume()
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
    } catch (e: unknown) {
      /* Say which thing went wrong.
       *
       * Every failure in this block used to report a denied permission, which
       * sent coaches to their browser settings to fix something that was
       * already fine. NotAllowedError is the only one that actually means that;
       * NotFoundError means no microphone exists, and NotReadableError means
       * another app — a call, a recorder, a meeting — is holding it. */
      const name = e instanceof Error ? e.name : ''
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access denied. Allow microphone access for this site and try again.'
          : name === 'NotFoundError'
            ? 'No microphone found. Check that one is connected, then try again.'
            : name === 'NotReadableError'
              ? 'Another app is using the microphone. Close it and try again.'
              : 'Could not start recording. Reload the page and try again.',
      )
    }
  }

  /* Ask the server for a draft summary and takeaway.
   *
   * Uses apiJson rather than raw fetch so a non-2xx throws with the server's
   * own message — a fetch whose only job is a side effect and which never
   * checks res.ok is the bug the pre-commit checklist exists for. Failure here
   * is surfaced quietly and never blocks the save: the coach can write it.
   */
  // Only the newest draft request may write, and never over words the coach
  // has typed while it was out. Both used to happen: a draft landing late
  // replaced what the coach had written, and a draft for one athlete could
  // arrive after the coach had moved on to another.
  const draftReqRef = useRef(0)
  const draftSummary = async (text: string, forAthleteId: string) => {
    const req = ++draftReqRef.current
    setSummarising(true)
    setSummaryError('')
    try {
      const out = await apiJson<{ summary: string | null; next: string | null }>(
        '/api/sessions/summary',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: text,
            athlete_id: forAthleteId,
            sport: coachSport || null,
          }),
        },
      )
      if (req !== draftReqRef.current) return
      setSummaryDraft((typed) => (typed.trim() ? typed : out.summary ?? ''))
      setNextDraft((typed) => (typed.trim() ? typed : out.next ?? ''))
    } catch (e: unknown) {
      if (req === draftReqRef.current) setSummaryError(errorMessage(e, 'Could not draft a summary. You can write one below.'))
    } finally {
      if (req === draftReqRef.current) setSummarising(false)
    }
  }

  /* A drafted summary names the athlete it was written for. If the target
   * changes, it is about the wrong child, so it goes, along with any draft
   * still on its way. Reset during render (React's pattern for "reset state
   * when an input changes"), so no frame shows A's summary under B. */
  const draftTarget = `${mode}:${mode === 'athlete' ? athleteId : mode === 'group' ? groupId : [...athleteIds].sort().join(',')}`
  const [draftFor, setDraftFor] = useState(draftTarget)
  if (draftFor !== draftTarget) {
    setDraftFor(draftTarget)
    draftReqRef.current++
    setSummaryDraft('')
    setNextDraft('')
    setSummaryError('')
    setSummarising(false)
    // A split is written for one set of athletes; a different set is a
    // different split (a shared first name, for one, changes who may be
    // written for at all).
    setSplitDrafts({})
    setSplitError('')
    setSplitting(false)
  }

  /* Ask the server to split the transcript between the chosen athletes.
   *
   * Same rules as draftSummary: only the newest request may write, and never
   * over words the coach has typed into a card while it was out. */
  const draftSplit = async (text: string, forAthleteIds: string[]) => {
    const req = ++draftReqRef.current
    setSplitting(true)
    setSplitError('')
    try {
      const out = await apiJson<{ sections: SplitSection[] }>('/api/sessions/split-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, athlete_ids: forAthleteIds, sport: coachSport || null }),
      })
      if (req !== draftReqRef.current) return
      setSplitDrafts((prev) => {
        const next: Record<string, SplitDraft> = { ...prev }
        for (const sec of out.sections ?? []) {
          if (!forAthleteIds.includes(sec.athlete_id)) continue
          const typed = prev[sec.athlete_id]
          next[sec.athlete_id] = {
            summary: typed?.summary.trim() ? typed.summary : sec.summary ?? '',
            next: typed?.next.trim() ? typed.next : sec.next ?? '',
            reason: sec.reason,
          }
        }
        return next
      })
    } catch (e: unknown) {
      if (req === draftReqRef.current) setSplitError(errorMessage(e, 'Could not split the recording. You can write each summary below.'))
    } finally {
      if (req === draftReqRef.current) setSplitting(false)
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
      // Snapshotted alongside memberIds, for the same reason: a replay hours
      // later must prime the names that were in the room, not today's squad.
      rosterNames: (mode === 'group'
        ? athletes.filter((a) => (group?.member_ids ?? []).includes(a.id))
        : athletes.filter((a) => a.id === athleteId)
      ).map((a) => a.first_name).filter(Boolean),
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

      /* The names this recording is about, so Whisper stops mangling them.
       *
       * Only the athletes this session is being saved for — the squad's
       * members, or the one athlete. That bound is the safety property: prompt
       * bleed can make Whisper insert a primed name that was never said, and an
       * inserted name would falsely open the personalisation gate. Keeping the
       * list to people who were actually in the room makes a hallucination
       * equivalent to a coach being misheard rather than a new failure.
       *
       * The `file` append above is untouched — the extension it carries is how
       * Whisper detects the codec. */
      const rosterForPrompt = mode === 'group'
        ? athletes.filter((a) => (groups.find((g) => g.id === groupId)?.member_ids ?? []).includes(a.id))
        : athletes.filter((a) => a.id === athleteId)
      const rosterNames = rosterForPrompt.map((a) => a.first_name).filter(Boolean)
      if (rosterNames.length) fd.append('roster', rosterNames.join(', '))

      const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      // Whisper's own confidence, surfaced rather than discarded. A recording
      // that is mostly silence must not quietly become a summary emailed to a
      // child — see lib/transcript-quality.ts.
      if (res.ok && typeof json.qualityReason === 'string' && json.qualityReason) {
        setTranscriptWarning(json.qualityReason)
      } else {
        setTranscriptWarning('')
      }
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

      /* Draft the summary now, so the review step has something to show and
       * change. Athlete mode only: a group save posts the same transcript once
       * per member and the server writes a different summary for each, gated by
       * mayPersonalise — one shared draft would be wrong for all of them.
       *
       * Deliberately not awaited into the transcription failure path: a draft
       * that does not arrive is a missing convenience, not a lost recording,
       * and the coach can still write the summary themselves. */
      if (json.text && mode === 'athlete' && athleteId) {
        void draftSummary(json.text, athleteId)
      }

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
            /* What the coach actually read and, if they changed it, wrote.
             * The server regenerates only when neither is sent, so an edit
             * here is never overwritten by a second call to the model. */
            summary: summaryDraft.trim() || null,
            next: nextDraft.trim() || null,
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

  /* mm:ss, with minutes growing past 59 rather than wrapping — a 72-minute
     session must never read back as twelve minutes. Padded and tabular so the
     digits sit in fixed columns and a changed second is obvious at a glance
     rather than shifting the whole line. */
  const elapsedClock = `${String(Math.floor(recSecs / 60)).padStart(2, '0')}:${String(recSecs % 60).padStart(2, '0')}`
  const elapsedSpoken = [
    Math.floor(recSecs / 60) > 0 ? `${Math.floor(recSecs / 60)} min` : null,
    `${recSecs % 60} sec`,
  ].filter(Boolean).join(' ')

  // The chips are the only live control until a target is picked, which is what
  // makes the required choice self-evident without a line of instructional text.
  const hasTarget = mode === 'athlete' ? !!athleteId : !!groupId

  const groupMembers = groups.find((g) => g.id === groupId)?.member_ids ?? []
  const groupMemberNames = groupMembers
    .map((id) => athletes.find((a) => a.id === id))
    .filter(Boolean)
    .map((a) => `${a!.first_name} ${a!.last_name}`)


  /* ── Stadium Night: one sheet, three states ─────────────────────────────
   *
   * Setup, live, review. The frame — grabber, eyebrow, step marks, close,
   * title, data line — is the same in all three; only the body and the one
   * action at the foot change, so the coach never loses their place.
   *
   * Floodlight (--flood) is spent on exactly two things here: the record
   * action, and the live clock with its meter, which are one object. Review
   * carries none — nothing on it is live. A stalled recorder drops out of
   * flood into --danger, so the colour itself stops claiming the mic is on. */
  const phase: 1 | 2 | 3 = step === 'review' ? 3 : recording || transcribing ? 2 : 1
  const selectedAthlete = athletes.find((a) => a.id === athleteId)
  const targetLabel = mode === 'group'
    ? (groups.find((g) => g.id === groupId)?.name ?? '')
    : selectedAthlete ? `${selectedAthlete.first_name} ${selectedAthlete.last_name}` : ''
  const dateShort = sessionDate
    ? formatSessionDate({ session_date: sessionDate }, { weekday: 'short', day: 'numeric', month: 'short' }, '')
    : ''
  const title = phase === 1
    ? 'Who and when'
    : phase === 3
      ? 'Before you send'
      : transcribing ? 'Transcribing' : recStalled ? 'Stopped' : 'Recording'
  const dataLine = phase === 1
    ? [coachSport, dateShort].filter(Boolean).join(' · ')
    : phase === 3
      ? [targetLabel, dateShort].filter(Boolean).join(' · ')
      : recording && !recStalled ? 'Stop when you are done talking' : ''
  const targetMeta = [
    mode === 'group' && groupId ? `${groupMembers.length} athlete${groupMembers.length === 1 ? '' : 's'}` : null,
    sessionName.trim() || null,
    dateShort || null,
  ].filter(Boolean).join(' · ')

  return (
    <div
      className="qs-scrim"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,13,12,0.62)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 300,
      }}
    >
      {/* Layout only: a bottom sheet on a phone, a centred sheet on a wider
          screen. Inline styles cannot hold a media query. */}
      <style>{QS_LAYOUT_CSS}</style>
      <div
        className="qs-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qs-title"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 560,
          background: 'var(--bg)',
          color: 'var(--text)',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -20px 46px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* The hero band: one skewed beam behind the head, off the grid on
            purpose. Low-luminance and static — nothing large changes. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', top: -14, left: -34, width: 250, height: 212, zIndex: 0,
            background: 'linear-gradient(100deg, rgba(245,236,215,0.055), rgba(245,236,215,0) 62%)',
            transform: 'skewX(-13deg)', borderRight: '1px solid rgba(168,203,160,0.20)',
            pointerEvents: 'none',
          }}
        />
        <div aria-hidden="true" style={{ position: 'relative', zIndex: 1, width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '9px auto 0', flexShrink: 0 }} />

        {/* Head */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 0 20px', flexShrink: 0 }}>
          <span style={{ ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.26em', color: 'var(--text-2)' }}>Quick session</span>
          <span aria-hidden="true" style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
            {[1, 2, 3].map((n) => (
              <i key={n} style={{ display: 'block', width: 20, height: 3, transform: 'skewX(-14deg)', background: n <= phase ? 'var(--text)' : 'var(--border)' }} />
            ))}
          </span>
          <span style={{ flex: 1 }} />
          {/* 44px square: it was a 26px glyph, which is a miss-and-lose-your-place
              on a phone. */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 44, height: 44, flexShrink: 0, borderRadius: 12,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-2)', fontSize: 22, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>
        <h2
          id="qs-title"
          style={{ ...CAST, position: 'relative', zIndex: 1, margin: 0, padding: '4px 20px 0', fontSize: 28, letterSpacing: '0.035em', lineHeight: 1, color: 'var(--text)', flexShrink: 0, overflowWrap: 'anywhere' }}
        >
          {title}
        </h2>
        {dataLine && (
          <div style={{ ...MONO, position: 'relative', zIndex: 1, padding: '7px 20px 0', color: 'var(--text-2)', flexShrink: 0, overflowWrap: 'anywhere' }}>
            {dataLine}
          </div>
        )}

        {/* Body — the only part that changes between the three states */}
        <div style={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '16px 20px 12px' }}>

          {/* ── 1 · Who and when ── */}
          {phase === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={LBL}>Session for</div>
                <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                  <button onClick={() => setMode('athlete')} aria-pressed={mode === 'athlete'} style={modeTab(mode === 'athlete', false)}>
                    One athlete
                  </button>
                  {/* Shown disabled with a reason rather than removed: a tab that
                      silently vanishes when there are no squads tells a new
                      coach nothing about the feature. */}
                  <button
                    onClick={() => setMode('group')}
                    aria-pressed={mode === 'group'}
                    disabled={groups.length === 0}
                    style={modeTab(mode === 'group', groups.length === 0)}
                  >
                    Squad <span style={{ ...MONO, letterSpacing: 0, textTransform: 'none' }}>{groups.length}</span>
                  </button>
                </div>
                {groups.length === 0 && mode === 'athlete' && (
                  <div style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.4, color: 'var(--text-muted)', marginTop: 8 }}>
                    No squads yet — create one first, or record for an individual athlete.
                  </div>
                )}

                {/* Chips rather than a native <select>. A select hides the current
                    value's meaning behind an interaction and costs a wheel drag;
                    with no pre-selection the target has to be visible, not
                    discovered. Selected is sage, not flood: in this sheet
                    chartreuse means the microphone. */}
                {mode === 'athlete' ? (
                  athletes.length === 0 ? (
                    <div style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-muted)', padding: '10px 0' }}>
                      No athletes yet — add one first before recording a session.
                    </div>
                  ) : (
                    // Search, squad filter and a list that scrolls with the
                    // sheet: the 132px chip box it replaces showed three rows
                    // of a twenty-athlete roster. See AthletePicker.
                    <AthletePicker athletes={athletes} squads={groups} value={athleteId} onChange={setAthleteId} />
                  )
                ) : (
                  <div>
                    {groups.length === 0 && (
                      <div style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-muted)', padding: '10px 0' }}>
                        No squads yet — create one first, or record for an individual athlete.
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                      {groups.map((g) => {
                        const on = groupId === g.id
                        return (
                          <button key={g.id} onClick={() => setGroupId(on ? '' : g.id)} aria-pressed={on} style={chip(on)}>
                            {g.name} ({g.member_ids.length})
                          </button>
                        )
                      })}
                    </div>
                    {/* Every name, in full, wrapping onto as many lines as it
                        takes. This is the coach's only confirmation of who the
                        recording is about, so nothing here is truncated. */}
                    {groupMemberNames.length > 0 && (
                      <div style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.45, color: 'var(--text-muted)', marginTop: 8, overflowWrap: 'anywhere' }}>
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
                <div style={{ padding: '10px 13px 11px', borderRadius: 14, background: 'var(--coach-light)', border: '1px solid var(--coach-border)' }}>
                  <div style={{ ...CAST, fontSize: 'var(--t-furniture)', fontWeight: 800, letterSpacing: '0.22em', color: 'var(--coach-on-light)' }}>
                    Last time you said
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, lineHeight: 1.35, color: 'var(--text)', marginTop: 4 }}>
                    {lastFocus.point}
                  </div>
                  {(() => {
                    const answered = responseOption(lastFocus.response)
                    const when = lastFocus.session_date
                      ? formatSessionDate({ session_date: lastFocus.session_date }, { day: 'numeric', month: 'short' })
                      : null
                    return (
                      <div style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.4, color: 'var(--text-2)', marginTop: 5 }}>
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

              {/* Session name */}
              <div>
                <label htmlFor="qs-name" style={{ ...LBL, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span>Session name</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontWeight: 600, letterSpacing: '0.18em' }}>Optional</span>
                </label>
                <input
                  id="qs-name"
                  className="input"
                  placeholder="e.g. Tackling drills, Speed work"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  style={FIELD}
                />
              </div>

              {/* Session date. The sport and the chosen day already sit in
                  the data line under the title, so there is no second sport
                  box here. Wraps rather than squeezing: a native date input
                  has a hard minimum width, and a too-wide row is invisibly
                  clipped rather than scrollable. */}
              <div>
                <label htmlFor="qs-date-1" style={LBL}>Session date</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <input
                    id="qs-date-1"
                    className="input"
                    type="date"
                    value={sessionDate}
                    max={today}
                    onChange={(e) => setSessionDate(e.target.value)}
                    style={{ ...FIELD, maxWidth: 200 }}
                  />
                  <span style={{ ...MONO, marginTop: 8, color: 'var(--text-2)', textTransform: sessionDate ? 'uppercase' : 'none', letterSpacing: sessionDate ? '0.07em' : 0 }}>
                    {sessionDateLabel}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── 2 · Recording ── */}
          {phase === 2 && (
            <>
              {targetLabel && (
                <div style={{ borderLeft: '2px solid var(--primary)', paddingLeft: 13, minHeight: 46, display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ ...CAST, fontSize: 23, letterSpacing: '0.045em', lineHeight: 1.05, color: 'var(--text)', overflowWrap: 'anywhere' }}>{targetLabel}</div>
                  {targetMeta && (
                    <div style={{ ...MONO, color: 'var(--text-2)', marginTop: 6, overflowWrap: 'anywhere' }}>{targetMeta}</div>
                  )}
                </div>
              )}
              {lastFocus && (
                <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 10, alignItems: 'baseline', marginTop: 15, paddingTop: 13, borderTop: '1px solid var(--border-soft)', flexShrink: 0 }}>
                  <span style={{ ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.2em', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Last time</span>
                  <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, lineHeight: 1.38, color: 'var(--text-2)' }}>{lastFocus.point}</p>
                </div>
              )}

              <div style={{ flex: '0.85 0 16px' }} />

              {recording ? (
                <div style={{ flexShrink: 0 }}>
                  {/* The clock. Floodlight while the recorder is live, --danger
                      the moment it is not, and nothing that blinks: the digits
                      carry no animation for reduced motion to disable. Mono,
                      not Newsreader: an elapsed time is a duration, and
                      tabular digits do not jiggle as the seconds turn. */}
                  <div
                    role="timer"
                    aria-label={`${recStalled ? 'Recording stopped at' : 'Recording'} ${elapsedSpoken}`}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'clamp(56px, 19vw, 74px)',
                      fontWeight: 500,
                      lineHeight: 0.9,
                      letterSpacing: '-2px',
                      fontVariantNumeric: 'tabular-nums',
                      color: recStalled ? 'var(--danger)' : 'var(--flood)',
                      marginLeft: -4,
                    }}
                  >
                    {elapsedClock}
                  </div>
                  {/* The meter: 3px bars under the clock, one object with it.
                      Decoration now, not evidence — the clock is what actually
                      says the recorder is running, so the bars are hidden from
                      assistive technology. */}
                  <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 3.4, height: 34, marginTop: 16 }}>
                    {Array.from({ length: VU_BARS }).map((_, i) => (
                      <i
                        key={i}
                        style={{
                          display: 'block', width: 3, flexShrink: 0, borderRadius: 1,
                          background: recStalled ? 'var(--border)' : 'var(--flood)',
                          height: Math.max(4, micLevel > 0 ? (4 + Math.round(micLevel * 30 * Math.abs(Math.sin(i)))) : 4),
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ ...CAST, fontSize: 15, letterSpacing: '0.22em', marginTop: 15, color: recStalled ? 'var(--danger)' : 'var(--flood)' }}>
                    {recStalled ? 'Recording stopped' : 'Recording'}
                  </div>
                  {/* Said in words, because under reduced motion the meter is
                      allowed to stand still and the ticking seconds become the
                      only honest signal left. */}
                  {reducedMotion && !recStalled && (
                    <div style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', marginTop: 10, maxWidth: 340, lineHeight: 1.4 }}>
                      The counter above moves every second while the microphone is live.
                    </div>
                  )}
                  {recStalled && (
                    <div
                      role="alert"
                      style={{ fontSize: 'var(--t-body-tight)', fontWeight: 600, color: 'var(--danger)', marginTop: 10, maxWidth: 360, lineHeight: 1.4 }}
                    >
                      The microphone stopped — another app may have taken it. Tap Stop &amp; Transcribe to keep what was recorded up to {elapsedClock}.
                    </div>
                  )}
                </div>
              ) : (
                <div role="status" style={{ color: 'var(--text-2)', fontSize: 'var(--t-body)', flexShrink: 0 }}>Transcribing audio…</div>
              )}

              <div style={{ flex: '1.15 0 16px' }} />
            </>
          )}

          {/* ── 3 · Before you send ── */}
          {phase === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label htmlFor="qs-transcript" style={LBL}>Transcript</label>
                  <span style={{ flex: 1 }} />
                  <button
                    /* 44px tall because it is a real target on a phone. */
                    style={{
                      ...CAST, fontSize: 14, letterSpacing: '0.14em', color: 'var(--text-2)',
                      minHeight: 44, padding: '0 12px', flexShrink: 0, cursor: 'pointer',
                      border: '1px solid var(--border)', borderRadius: 12, background: 'transparent',
                    }}
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
                      // The summary was written from the recording being
                      // discarded, so it is discarded with it. It used to
                      // survive, and could be saved on the next session.
                      draftReqRef.current++
                      setSummaryDraft('')
                      setNextDraft('')
                      setSummaryError('')
                      setSummarising(false)
                      setTranscriptWarning('')
                    }}
                  >
                    ← Re-record
                  </button>
                </div>
                {transcriptWarning && (
                  <div
                    role="status"
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '10px 12px', borderRadius: 12, marginBottom: 10,
                      background: 'var(--wellness-ok-tint)',
                      fontSize: 'var(--fs-3)', color: 'var(--text)', lineHeight: 1.45,
                    }}
                  >
                    <span aria-hidden="true" style={{ flexShrink: 0 }}>⚠</span>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{transcriptWarning}</span>
                  </div>
                )}
                {/* The coach's own words, so they are set in the reading face. */}
                <textarea
                  id="qs-transcript"
                  className="input"
                  rows={6}
                  placeholder="Type or paste transcript here…"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  autoCapitalize="sentences"
                  autoCorrect="on"
                  spellCheck
                  style={{ resize: 'vertical', fontFamily: 'var(--font-display)', fontSize: 16, lineHeight: 1.52, borderRadius: 14 }}
                />
              </div>

              {/* ── The draft, before it sends ──
                  Until 2026-09-25 this was a line of text promising a summary
                  would be written "when you save", which meant the first person
                  to read what a model wrote about a named child was the child.
                  It is drafted at stop now, and everything here is editable.
                  Group mode still generates per member on the server, gated by
                  mayPersonalise, so there is nothing single to show. */}
              {mode === 'athlete' && (
                <>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <label htmlFor="qs-summary" style={LBL}>Summary</label>
                      {summarising && <span style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-2)' }}>drafting…</span>}
                      {!summarising && (summaryDraft || nextDraft) && (
                        <span style={{
                          ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.16em',
                          color: 'var(--energy-dark)', background: 'var(--warning-light)',
                          border: '1px solid var(--warning-border)',
                          borderRadius: 999, padding: '2px 9px',
                        }}>Draft</span>
                      )}
                    </div>
                    <textarea
                      id="qs-summary"
                      className="input"
                      value={summaryDraft}
                      onChange={(e) => setSummaryDraft(e.target.value)}
                      rows={4}
                      placeholder={summarising ? 'Reading your recording…' : 'What happened in this session.'}
                      style={{ marginTop: 8, width: '100%', fontFamily: 'var(--font-display)', fontSize: 16, lineHeight: 1.45, resize: 'vertical', borderRadius: 14 }}
                    />
                    <div style={{ marginTop: 8, fontSize: 'var(--t-body-tight)', lineHeight: 1.4, color: 'var(--text-2)' }}>
                      Written from your words. Change anything — nothing sends until you save.
                    </div>
                  </div>

                  <div style={{ padding: '11px 13px 12px', borderRadius: 14, background: 'var(--coach-light)', border: '1px solid var(--coach-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                      <label htmlFor="qs-next" style={{ ...CAST, fontSize: 'var(--t-furniture)', fontWeight: 800, letterSpacing: '0.22em', color: 'var(--coach-on-light)' }}>
                        Take into next session
                      </label>
                      <span style={{ ...MONO, marginLeft: 'auto', color: 'var(--text-2)' }}>
                        {nextDraft.length}/{MAX_NEXT_LENGTH}
                      </span>
                    </div>
                    {/* A textarea so the whole line is readable at once — an
                        input would show a phone's width of it and scroll the
                        rest out of sight. It is still one line of meaning:
                        a line break becomes a space. */}
                    <textarea
                      id="qs-next"
                      className="input"
                      rows={2}
                      value={nextDraft}
                      maxLength={MAX_NEXT_LENGTH}
                      onChange={(e) => setNextDraft(e.target.value.replace(/\s*\n+\s*/g, ' '))}
                      placeholder="The one thing to work on."
                      style={{ ...FIELD, minHeight: 0, resize: 'none', fontWeight: 600, lineHeight: 1.4, borderColor: 'var(--coach-border)' }}
                    />
                    <div style={{ marginTop: 7, fontSize: 'var(--t-body-tight)', lineHeight: 1.4, color: 'var(--text-2)' }}>
                      This is the line your athlete reads first.
                    </div>
                  </div>

                  {summaryError && (
                    <div style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.4, color: 'var(--coach-on-light)' }}>
                      {summaryError}
                    </div>
                  )}
                </>
              )}

              {/* Session date — the save happens on this step, so it stays
                  editable here for anyone who skipped straight to typing. */}
              <div>
                <label htmlFor="qs-date-3" style={LBL}>Session date</label>
                {/* Wraps: a date input plus "Wednesday, Sep 24" is wider than
                    the sheet on a phone, and a too-wide row is invisibly
                    clipped rather than scrollable. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <input
                    id="qs-date-3"
                    className="input"
                    type="date"
                    value={sessionDate}
                    max={today}
                    onChange={(e) => setSessionDate(e.target.value)}
                    style={{ ...FIELD, maxWidth: 200 }}
                  />
                  <span style={{ ...MONO, marginTop: 8, color: 'var(--text-2)', textTransform: sessionDate ? 'uppercase' : 'none', letterSpacing: sessionDate ? '0.07em' : 0 }}>{sessionDateLabel}</span>
                </div>
              </div>

              {/* Share toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', minHeight: 44 }}>
                {/* appearance is restored here because globals.css strips it
                    from every input for iOS, which leaves a bare checkbox with
                    no box at all — the share decision drawn as nothing. */}
                <input
                  type="checkbox"
                  checked={shareWithAthlete}
                  onChange={(e) => setShareWithAthlete(e.target.checked)}
                  style={{ width: 22, height: 22, flexShrink: 0, accentColor: 'var(--primary)', WebkitAppearance: 'checkbox', appearance: 'auto' }}
                />
                <span style={{ fontSize: 'var(--t-body)', fontWeight: 600, color: 'var(--text)', lineHeight: 1.35 }}>
                  Share transcript & summary with athlete{mode === 'group' ? 's' : ''}
                </span>
              </label>

              {error && (
                <div role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--t-body-tight)', fontWeight: 600, lineHeight: 1.4 }}>{error}</div>
              )}
            </div>
          )}
        </div>

        {/* Foot — the one action for this state */}
        {(phase !== 2 || recording) && (
          <div style={{ position: 'relative', zIndex: 1, flexShrink: 0, padding: '10px 20px calc(16px + env(safe-area-inset-bottom, 0px))' }}>
            {phase === 1 && (
              <>
                {/* startRecording writes four carefully distinguished failures
                    into `error` — denied, no mic, mic in use, unknown. A tap on
                    Start that failed must say which thing to fix, right where
                    the coach is looking. */}
                {error && !recording && (
                  <div role="alert" style={{ fontSize: 'var(--t-body-tight)', fontWeight: 600, color: 'var(--danger)', lineHeight: 1.4, marginBottom: 10 }}>
                    {error}
                  </div>
                )}
                {/* The record action — floodlight, the first of its two uses. */}
                <button
                  onClick={startRecording}
                  disabled={!hasTarget}
                  style={{
                    width: '100%', minHeight: 62, borderRadius: 19, overflow: 'hidden', padding: 0,
                    display: 'flex', alignItems: 'stretch', border: 'none', textAlign: 'left',
                    background: hasTarget ? 'var(--flood)' : 'var(--card)',
                    color: hasTarget ? 'var(--on-primary)' : 'var(--text-muted)',
                    cursor: hasTarget ? 'pointer' : 'not-allowed',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, padding: '12px 8px 12px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <span style={{ ...CAST, fontSize: 22, fontWeight: 800, letterSpacing: '0.045em', lineHeight: 1 }}>Start recording</span>
                    {hasTarget && (
                      <span style={{ ...MONO, marginTop: 6, overflowWrap: 'anywhere' }}>
                        {[targetLabel, coachSport].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0, width: 96, background: 'var(--bg)',
                      clipPath: 'polygon(34% 0, 100% 0, 100% 100%, 0 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 17,
                    }}
                  >
                    <span style={{
                      width: 38, height: 38, borderRadius: '50%',
                      border: `2px solid ${hasTarget ? 'var(--flood)' : 'var(--border)'}`,
                      color: hasTarget ? 'var(--flood)' : 'var(--text-muted)',
                      background: hasTarget ? 'rgba(203,239,94,0.10)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <MicGlyph />
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => setStep('review')}
                  disabled={!hasTarget}
                  style={{
                    width: '100%', minHeight: 44, marginTop: 4, border: 'none', background: 'transparent',
                    fontSize: 'var(--t-body-tight)', fontWeight: 600, color: 'var(--text-2)',
                    cursor: hasTarget ? 'pointer' : 'not-allowed', opacity: hasTarget ? 1 : 0.6,
                  }}
                >
                  Skip — type transcript manually →
                </button>
              </>
            )}

            {phase === 2 && recording && (
              <button
                onClick={stopAndTranscribe}
                style={{
                  width: '100%', minHeight: 72, borderRadius: 20, cursor: 'pointer',
                  background: 'var(--card)', border: '1.5px solid var(--border)', color: 'var(--text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
                }}
              >
                <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 3, background: 'var(--text)', flexShrink: 0 }} />
                <span style={{ ...CAST, fontSize: 22, fontWeight: 800, letterSpacing: '0.07em' }}>Stop &amp; Transcribe</span>
              </button>
            )}

            {phase === 3 && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={onClose}
                  style={{
                    ...CAST, flex: 1, minWidth: 0, minHeight: 58, borderRadius: 19, cursor: 'pointer',
                    border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text-2)',
                    fontSize: 18, letterSpacing: '0.11em',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving || !transcript.trim()}
                  style={{
                    ...CAST, flex: 2, minWidth: 0, minHeight: 58, borderRadius: 19, border: 'none',
                    padding: '6px 12px', lineHeight: 1.1,
                    background: 'var(--primary)', color: 'var(--on-primary)',
                    fontSize: 20, fontWeight: 800, letterSpacing: '0.06em',
                    cursor: saving || !transcript.trim() ? 'not-allowed' : 'pointer',
                    opacity: saving || !transcript.trim() ? 0.5 : 1,
                  }}
                >
                  {saving ? 'Saving…' : mode === 'group' ? `Save for ${groupMembers.length} Athletes` : 'Save Session'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Stadium Night furniture ──────────────────────────────────────────────
 * Uppercase furniture is Big Shoulders, tracked; data is JetBrains Mono.
 * Nothing here is below the 13px floor. */
const CAST: CSSProperties = {
  fontFamily: 'var(--font-cast)',
  fontWeight: 700,
  textTransform: 'uppercase',
}

const MONO: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-data)',
  fontWeight: 500,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
}

const LBL: CSSProperties = {
  ...CAST,
  display: 'block',
  fontSize: 'var(--t-furniture)',
  letterSpacing: '0.26em',
  color: 'var(--text-2)',
}

const FIELD: CSSProperties = {
  marginTop: 8,
  minHeight: 48,
  borderRadius: 14,
  fontSize: 16,
}

/* Forty 3px bars fill 256px, which fits inside the narrowest sheet (a 320px
   phone less its gutters) without the meter ever needing to clip. */
const VU_BARS = 40

function modeTab(on: boolean, unavailable: boolean): CSSProperties {
  return {
    ...CAST,
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    border: `1.5px ${unavailable ? 'dashed' : 'solid'} var(--border)`,
    background: on ? 'var(--card)' : 'transparent',
    color: on ? 'var(--text)' : 'var(--text-2)',
    fontSize: 15,
    letterSpacing: '0.12em',
    cursor: unavailable ? 'not-allowed' : 'pointer',
  }
}

function chip(on: boolean): CSSProperties {
  return {
    ...CAST,
    minHeight: 44,
    maxWidth: '100%',
    padding: '6px 15px',
    borderRadius: 999,
    border: '1.5px solid',
    borderColor: on ? 'var(--primary)' : 'var(--border)',
    background: on ? 'var(--primary)' : 'transparent',
    color: on ? 'var(--on-primary)' : 'var(--text-2)',
    fontSize: 16,
    fontWeight: on ? 800 : 700,
    letterSpacing: '0.09em',
    lineHeight: 1.15,
    overflowWrap: 'anywhere',
    cursor: 'pointer',
  }
}

function MicGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5" />
      <path d="M12 18.5V21" />
    </svg>
  )
}

const QS_LAYOUT_CSS = `
.qs-scrim { align-items: flex-end; padding: 56px 0 0; }
.qs-sheet { height: 100%; border-radius: 28px 28px 0 0; }
@media (min-width: 640px) {
  .qs-scrim { align-items: center; padding: 24px; }
  .qs-sheet { height: min(820px, 100%); border-radius: 28px; border: 1px solid var(--border); }
}
`
