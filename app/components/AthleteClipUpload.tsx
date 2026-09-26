'use client'

/**
 * An athlete sends their coach a short clip — about one session, or just "for
 * my coach" — and later watches it back with the coach's drawings on it.
 *
 * The clip goes straight from the phone to the private `session-videos` bucket
 * through a signed upload URL (the same shape as the recorder's audio upload);
 * the app server never carries the bytes. The route that mints the URL proves
 * the caller is this athlete, and builds the path itself.
 *
 * The limits are checked here before a byte leaves the phone and again by the
 * server: 60 seconds (Max, 2026-09-26) and the coach's own size and format
 * rules (lib/video-preflight.ts). See lib/video-clip.ts athleteClipVerdict.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import VideoAnnotator, { type AnnotationStroke } from '@/app/components/VideoAnnotator'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { athleteClipVerdict, formatClipTime, MAX_ATHLETE_CLIP_SECONDS } from '@/lib/video-clip'

type Clip = {
  id: string
  session_id: string | null
  file_name: string | null
  note: string | null
  duration_s: number | null
  created_at: string
  shared_with_athlete: boolean
  annotations: AnnotationStroke[]
  signedUrl: string | null
}

type Props = {
  athleteId: string | null
  /** A session this clip is about. Omitted (or null) for a general clip. */
  sessionId?: string | null
  /** When set, the list shows only this session's clips. */
  listScope?: 'session' | 'all'
}

/**
 * How long is this clip? From the file's own metadata, in the browser.
 *
 * A WebM written by Chrome's MediaRecorder reports `Infinity` until it has been
 * seeked to the end — the recorder never goes back to write the duration — so
 * that case seeks far past the end and reads the real value once the browser
 * has found it. Gives up after eight seconds rather than hanging the button.
 */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    let settled = false
    const done = (d: number | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      v.removeAttribute('src')
      v.load()
      URL.revokeObjectURL(url)
      resolve(d)
    }
    const timer = window.setTimeout(() => done(null), 8000)
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) { done(v.duration); return }
      v.ondurationchange = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) done(v.duration)
      }
      v.currentTime = 1e7
    }
    v.onerror = () => done(null)
    v.src = url
  })
}

const LINE = 'color-mix(in srgb, var(--text) 11%, transparent)'
const LINE_2 = 'color-mix(in srgb, var(--text) 19%, transparent)'

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 44, padding: '0 16px', borderRadius: 11, border: 'none', cursor: 'pointer',
  background: 'var(--primary)', color: 'var(--on-primary)', fontWeight: 700, fontSize: 'var(--t-body-tight)',
}
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 44, padding: '0 14px', borderRadius: 11, border: `1px solid ${LINE_2}`, cursor: 'pointer',
  background: 'transparent', color: 'var(--text)', fontWeight: 600, fontSize: 'var(--t-body-tight)',
}

export default function AthleteClipUpload({ athleteId, sessionId = null, listScope = sessionId ? 'session' : 'all' }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [picked, setPicked] = useState<{ file: File; duration: number } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const [clips, setClips] = useState<Clip[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!athleteId) return
    try {
      const qs = new URLSearchParams({ athlete_id: athleteId })
      if (listScope === 'session' && sessionId) qs.set('session_id', sessionId)
      const json = await apiJson<{ clips?: Clip[] }>(`/api/athlete/clips?${qs}`, { cache: 'no-store' })
      setClips(json.clips ?? [])
      setListError(null)
    } catch (e: unknown) {
      setListError(errorMessage(e, 'Could not load your clips.'))
    }
  }, [athleteId, sessionId, listScope])

  useEffect(() => { void load() }, [load])

  const onPick = async (file: File) => {
    setError(null); setWarning(null); setSent(false); setPicked(null)
    setChecking(true)
    const duration = file.type.startsWith('video/') || !file.type ? await readDuration(file) : null
    setChecking(false)
    const verdict = athleteClipVerdict(file, duration)
    if (!verdict.ok) { setError(verdict.reason); return }
    setWarning(verdict.warning)
    setPicked({ file, duration: duration as number })
  }

  const reset = () => {
    setPicked(null); setNote(''); setWarning(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const send = async () => {
    if (!picked || !athleteId || sending) return
    setSending(true); setError(null)
    try {
      const { file, duration } = picked
      const qs = new URLSearchParams({ athlete_id: athleteId, file_name: file.name, mime_type: file.type || 'video/mp4' })
      if (sessionId) qs.set('session_id', sessionId)
      const { signedUrl, path } = await apiJson<{ signedUrl: string; path: string }>(`/api/athlete/clips/upload-url?${qs}`)

      const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': file.type || 'video/mp4' }, body: file })
      if (!put.ok) throw new Error('The clip could not be uploaded. Check your signal and try again.')

      await apiJson<{ clip: Clip }>('/api/athlete/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId, session_id: sessionId, path,
          file_name: file.name, mime_type: file.type || 'video/mp4',
          duration_s: duration, note: note.trim() || null,
        }),
      })
      reset()
      setSent(true)
      void load()
    } catch (e: unknown) {
      setError(errorMessage(e, 'The clip could not be sent. Try again.'))
    } finally {
      setSending(false)
    }
  }

  if (!athleteId) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f) }}
      />

      {!picked && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={checking}
            style={{ ...primaryBtn, cursor: checking ? 'progress' : 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ width: 16, height: 16, flexShrink: 0 }}>
              <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
            {checking ? 'Checking the clip…' : sessionId ? 'Send your coach a clip from this session' : 'Send your coach a clip'}
          </button>
          <span style={{ fontSize: 'var(--t-furniture)', color: 'var(--text-2)', lineHeight: 1.4 }}>
            Up to {MAX_ATHLETE_CLIP_SECONDS} seconds. Only your coach sees it.
          </span>
        </div>
      )}

      {picked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 12, border: `1px solid ${LINE_2}` }}>
          <div style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text)', overflowWrap: 'anywhere' }}>
            {picked.file.name} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)' }}>· {formatClipTime(picked.duration)}</span>
          </div>
          {warning && (
            <div style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.5, color: 'var(--text-2)' }}>{warning}</div>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 'var(--t-furniture)', fontWeight: 700, color: 'var(--text-2)' }}>What should your coach look at? (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="e.g. Is my elbow dropping on the follow-through?"
              style={{ width: '100%', minWidth: 0, borderRadius: 10, border: `1px solid ${LINE_2}`, padding: '10px 12px', font: 'inherit', fontSize: 16, background: 'transparent', color: 'var(--text)', resize: 'vertical' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void send()} disabled={sending} style={{ ...primaryBtn, cursor: sending ? 'progress' : 'pointer', opacity: sending ? 0.7 : 1 }}>
              {sending ? 'Sending…' : 'Send to my coach'}
            </button>
            <button type="button" onClick={reset} disabled={sending} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.5, color: 'var(--danger)' }}>{error}</div>
      )}
      {sent && (
        <div role="status" style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.5, color: 'var(--primary)' }}>
          Sent. Your coach has a message saying it is there.
        </div>
      )}

      {/* The athlete's own clips, and what came back. */}
      {listError && (
        <div style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-2)' }}>{listError}</div>
      )}
      {clips && clips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div className="ah-eyebrow">My clips ({clips.length})</div>
          {clips.map((c) => {
            const replied = c.shared_with_athlete
            const isOpen = open === c.id
            return (
              <div key={c.id} style={{ borderTop: `1px solid ${LINE}`, paddingTop: 8, minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : c.id)}
                  aria-expanded={isOpen}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--text)', flexWrap: 'wrap' }}
                >
                  <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: 'var(--t-body-tight)', overflowWrap: 'anywhere' }}>
                    {c.note ?? c.file_name ?? 'Clip'}
                    <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)', marginTop: 2 }}>
                      {new Date(c.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      {c.duration_s ? ` · ${formatClipTime(c.duration_s)}` : ''}
                    </span>
                  </span>
                  <span style={{
                    flexShrink: 0, padding: '4px 10px', borderRadius: 999, fontSize: 'var(--t-furniture)', fontWeight: 700,
                    color: replied ? 'var(--primary)' : 'var(--text-2)',
                    border: `1px solid ${replied ? 'color-mix(in srgb, var(--primary) 45%, transparent)' : LINE_2}`,
                  }}>
                    {replied ? 'Coach marked it up' : 'With your coach'}
                  </span>
                </button>
                {isOpen && c.signedUrl && (
                  <div style={{ marginTop: 8 }}>
                    <VideoAnnotator videoUrl={c.signedUrl} initialAnnotations={c.annotations ?? []} readOnly />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
