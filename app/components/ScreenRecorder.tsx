'use client'

/**
 * Record an online coaching call from the computer, into a session.
 *
 * The coach shares the browser tab the call is in, with its sound; their
 * microphone is mixed in; the recording uploads to the session as video, in
 * parts if the call is long. Snippets are then the session page's existing
 * "moments", marked on that video. The decisions live in
 * lib/screen-recording.ts, where tools/video-rig.mjs runs them.
 *
 * A dialog (role="dialog"), so UpdateWatcher never reloads the page over a
 * recording in progress. Nothing recorded is ever thrown away: a part that
 * fails to upload stays on screen as a download.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadSessionVideo } from '@/lib/video-upload'
import { preflightVideo } from '@/lib/video-preflight'
import { errorMessage } from '@/lib/errors'
import {
  pickScreenMime, extensionFor, shouldStartNewPart, partFileName,
  VIDEO_BITS_PER_SECOND, AUDIO_BITS_PER_SECOND,
} from '@/lib/screen-recording'

type Phase = 'consent' | 'starting' | 'recording' | 'saving' | 'done'

const CAST: React.CSSProperties = { fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase' }
const BODY: React.CSSProperties = { fontSize: 'var(--t-body-tight)', lineHeight: 1.5, color: 'var(--text-2)', margin: 0 }
const BTN: React.CSSProperties = {
  minHeight: 48, padding: '0 18px', borderRadius: 14, border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 'var(--t-body)', fontWeight: 700,
}

function clock(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`
}

export default function ScreenRecorder({ sessionId, onClose, onUploaded }: {
  sessionId: string
  onClose: () => void
  /** Called after each part lands, so the page can show it. */
  onUploaded: () => void
}) {
  const [phase, setPhase] = useState<Phase>('consent')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [partNo, setPartNo] = useState(0)
  const [savedParts, setSavedParts] = useState(0)
  const [upload, setUpload] = useState<{ name: string; pct: number; eta: string } | null>(null)
  const [noCallAudio, setNoCallAudio] = useState(false)
  const [failed, setFailed] = useState<{ name: string; url: string }[]>([])

  const streams = useRef<MediaStream[]>([])
  const combined = useRef<MediaStream | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const mime = useRef('')
  const parts = useRef(0)
  const stopping = useRef(false)
  const openRecorders = useRef(0)
  const queue = useRef<File[]>([])
  const uploading = useRef(false)
  const startedAt = useRef(0)
  const dateLabel = useRef(new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))
  const onUploadedRef = useRef(onUploaded)
  useEffect(() => { onUploadedRef.current = onUploaded }, [onUploaded])

  const finishIfDone = useCallback(() => {
    if (stopping.current && openRecorders.current === 0 && !uploading.current && queue.current.length === 0) {
      setPhase('done')
    }
  }, [])

  const drainQueue = useCallback(async () => {
    if (uploading.current) return
    uploading.current = true
    while (queue.current.length) {
      const file = queue.current.shift() as File
      const verdict = preflightVideo(file)
      if (!verdict.ok) {
        setError(verdict.reason)
        setFailed((f) => [...f, { name: file.name, url: URL.createObjectURL(file) }])
        continue
      }
      try {
        await uploadSessionVideo(sessionId, file, ({ pct, eta }) => setUpload({ name: file.name, pct, eta }))
        setSavedParts((n) => n + 1)
        onUploadedRef.current()
      } catch (e: unknown) {
        setError(errorMessage(e, 'A part of the recording did not upload.'))
        setFailed((f) => [...f, { name: file.name, url: URL.createObjectURL(file) }])
      } finally {
        setUpload(null)
      }
    }
    uploading.current = false
    finishIfDone()
  }, [sessionId, finishIfDone])

  const releaseDevices = useCallback(() => {
    for (const s of streams.current) for (const t of s.getTracks()) t.stop()
    streams.current = []
    void audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
  }, [])

  // One part: its own recorder and its own chunks, so a part that closes
  // while the next one has started can never mix with it.
  const startPart = useCallback(() => {
    const stream = combined.current
    if (!stream) return
    parts.current += 1
    const n = parts.current
    setPartNo(n)
    const chunks: Blob[] = []
    let bytes = 0
    const rec = new MediaRecorder(stream, {
      ...(mime.current ? { mimeType: mime.current } : {}),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    })
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      chunks.push(e.data)
      bytes += e.data.size
      // A long call: close this part and carry on in the next, on the same
      // shared screen. The new recorder starts before the old one stops.
      if (!stopping.current && recorder.current === rec && shouldStartNewPart(bytes)) {
        startPart()
        rec.stop()
      }
    }
    rec.onstop = () => {
      openRecorders.current -= 1
      const actual = rec.mimeType || mime.current || 'video/webm'
      if (chunks.length) {
        const total = stopping.current && n === 1 ? 1 : null
        const name = partFileName(dateLabel.current, n, total, extensionFor(actual))
        queue.current.push(new File([new Blob(chunks, { type: actual })], name, { type: actual }))
        void drainQueue()
      }
      if (stopping.current && openRecorders.current === 0) releaseDevices()
      finishIfDone()
    }
    openRecorders.current += 1
    recorder.current = rec
    rec.start(10_000)
  }, [drainQueue, finishIfDone, releaseDevices])

  const stop = useCallback(() => {
    if (stopping.current) return
    stopping.current = true
    setPhase('saving')
    const rec = recorder.current
    if (rec && rec.state !== 'inactive') rec.stop()
    else { releaseDevices(); finishIfDone() }
  }, [releaseDevices, finishIfDone])

  const start = async () => {
    setError('')
    setPhase('starting')
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true })
      streams.current.push(display)
      let mic: MediaStream | null = null
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true })
        streams.current.push(mic)
      } catch { mic = null }

      const tracks: MediaStreamTrack[] = [...display.getVideoTracks()]
      const callAudio = display.getAudioTracks()
      setNoCallAudio(callAudio.length === 0)
      if (callAudio.length || mic) {
        const ctx = new AudioContext()
        audioCtx.current = ctx
        const dest = ctx.createMediaStreamDestination()
        if (callAudio.length) ctx.createMediaStreamSource(new MediaStream(callAudio)).connect(dest)
        if (mic) ctx.createMediaStreamSource(mic).connect(dest)
        tracks.push(...dest.stream.getAudioTracks())
      }
      combined.current = new MediaStream(tracks)
      // The browser's own "Stop sharing" ends the recording and saves it.
      display.getVideoTracks()[0]?.addEventListener('ended', () => stop())

      mime.current = pickScreenMime((t) => MediaRecorder.isTypeSupported(t))
      startedAt.current = Date.now()
      startPart()
      setPhase('recording')
    } catch (e: unknown) {
      releaseDevices()
      setPhase('consent')
      // Cancelling the browser's share picker is a choice, not a failure.
      const name = (e as { name?: string })?.name
      setError(name === 'NotAllowedError' ? '' : errorMessage(e, 'The screen could not be shared.'))
    }
  }

  // The clock, while recording.
  useEffect(() => {
    if (phase !== 'recording') return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase])

  // Leaving the page mid-call would lose what is not uploaded yet.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'saving') return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  // Closing the dialog never leaves the screen or the microphone shared.
  useEffect(() => () => {
    for (const s of streams.current) for (const t of s.getTracks()) t.stop()
    void audioCtx.current?.close().catch(() => {})
  }, [])

  const busy = phase === 'recording' || phase === 'saving' || phase === 'starting'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(21,25,22,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sr-title" style={{
        width: '100%', maxWidth: 480, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box',
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 20,
        display: 'flex', flexDirection: 'column', gap: 14, color: 'var(--text)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 id="sr-title" style={{ ...CAST, fontSize: 22, letterSpacing: '.04em', margin: 0, flex: 1 }}>Record an online call</h2>
          {!busy && (
            <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, border: 'none', background: 'none', color: 'var(--text-2)', fontSize: 22, cursor: 'pointer' }}>×</button>
          )}
        </div>

        {phase === 'consent' && (
          <>
            <ul style={{ ...BODY, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Have the call open in Chrome or Edge on this computer: Zoom, Google Meet or Teams in a browser tab.</li>
              <li>Next, pick that tab and tick <strong style={{ color: 'var(--text)' }}>Also share tab audio</strong>, so the other side is heard. Your microphone is added too.</li>
              <li>When you stop, it saves to this session. Then mark the moments you want on the video.</li>
            </ul>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 'var(--t-body-tight)', lineHeight: 1.5 }}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, flex: 'none' }} />
              <span>Everyone on the call knows it is being recorded, and a parent has agreed for anyone under 18.</span>
            </label>
            {error && <p role="alert" style={{ ...BODY, color: 'var(--danger)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => void start()} disabled={!agreed} style={{ ...BTN, flex: '1 1 160px', background: agreed ? 'var(--flood)' : 'var(--surface-2)', color: agreed ? 'var(--on-primary)' : 'var(--text-muted)', cursor: agreed ? 'pointer' : 'not-allowed' }}>
                Choose the call and start
              </button>
              <button onClick={onClose} style={{ ...BTN, background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)' }}>Cancel</button>
            </div>
          </>
        )}

        {phase === 'starting' && <p style={BODY} aria-live="polite">Waiting for you to choose what to share…</p>}

        {phase === 'recording' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} aria-live="off">
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--danger)', flex: 'none' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28 }}>{clock(elapsed)}</span>
              {partNo > 1 && <span style={{ ...BODY }}>part {partNo}</span>}
            </div>
            {noCallAudio && (
              <p role="alert" style={{ ...BODY, color: 'var(--warning)' }}>
                This share has no call sound, so only your microphone is being recorded. To hear the other side,
                stop, start again, and tick &ldquo;Also share tab audio&rdquo;.
              </p>
            )}
            {upload && <p style={BODY}>Saving the previous part… {upload.pct}%</p>}
            <button onClick={stop} style={{ ...BTN, background: 'var(--danger)', color: 'var(--on-primary)' }}>Stop and save</button>
          </>
        )}

        {phase === 'saving' && (
          <p style={BODY} aria-live="polite">
            {upload ? `Saving ${upload.name}… ${upload.pct}% · ${upload.eta}` : 'Finishing the recording…'}
          </p>
        )}

        {phase === 'done' && (
          <>
            <p style={{ ...BODY, color: 'var(--text)' }}>
              {savedParts > 0
                ? `Saved to this session${savedParts > 1 ? ` in ${savedParts} parts` : ''}. Mark the moments you want on the video.`
                : 'Nothing was saved.'}
            </p>
            <button onClick={onClose} style={{ ...BTN, background: 'var(--primary)', color: 'var(--on-primary)' }}>Done</button>
          </>
        )}

        {failed.length > 0 && (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ ...BODY, color: 'var(--danger)' }}>
              {error || 'Part of the recording did not upload.'} It is still on this computer, so save it now and add it with Add video:
            </p>
            {failed.map((f) => (
              <a key={f.url} href={f.url} download={f.name} style={{ color: 'var(--primary)', fontWeight: 700, minHeight: 44, display: 'inline-flex', alignItems: 'center', overflowWrap: 'anywhere' }}>
                Download {f.name}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
