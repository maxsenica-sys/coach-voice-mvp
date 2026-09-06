'use client'

/**
 * /dev/hearit — WOW-001 prototype.
 *
 * The question this page exists to answer, and nothing else: when a coach taps
 * a sentence they said and hears themselves say it, does anything happen in the
 * room? Show it to three coaches. If nobody asks to do it again, close the idea.
 *
 * It is deliberately disposable. No migration, no schema change, no write, and
 * nothing in the protected recording path. It stands entirely on two routes
 * that already exist:
 *
 *   POST /api/transcribe        already accepts `audio_path` and already asks
 *                               Whisper for verbose_json, already returning a
 *                               `segments` array with per-sentence timestamps
 *                               that nothing in the product has ever consumed.
 *   GET  /api/sessions/[id]/audio-url
 *                               already returns a signed playback URL + mime.
 *
 * Neither is modified. If the idea is worth building for real, the segments get
 * persisted at save time instead of re-transcribed here.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { apiJson } from '@/lib/api-client'
import { formatSessionDate } from '@/lib/session-date'

type SessionRow = {
  id: string
  session_name: string | null
  session_date?: string | null
  created_at: string | null
  audio_path: string | null
  athletes?: { first_name: string; last_name: string } | null
}

type Segment = { start: number; end: number; text: string }

const fmtClock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function HearItPrototype() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState('')

  const [active, setActive] = useState<SessionRow | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [audioUrl, setAudioUrl] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Where the current clip should stop. Read inside a timeupdate handler, so it
  // has to be a ref — state would be captured stale by the listener.
  const stopAtRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const json = await apiJson<{ sessions?: SessionRow[] }>('/api/sessions/all?limit=50')
        if (cancelled) return
        setSessions((json.sessions ?? []).filter((s) => s.audio_path))
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : 'Could not load sessions.')
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const open = async (s: SessionRow) => {
    setActive(s)
    setSegments([])
    setAudioUrl('')
    setError('')
    setPlayingIndex(null)
    stopAtRef.current = null
    setWorking(true)

    try {
      // Playback URL first — if the recording cannot be opened there is no
      // point paying for a transcription.
      const audio = await apiJson<{ url: string; mime: string }>(`/api/sessions/${s.id}/audio-url`)

      // Every recording made before 2026-09-05 is audio/webm, which iOS Safari
      // cannot decode at all — it never errors, it just never becomes ready.
      // Say so rather than showing a dead player.
      const probe = document.createElement('audio')
      if (audio.mime && probe.canPlayType(audio.mime) === '') {
        throw new Error(
          `This browser cannot play ${audio.mime}. Older recordings are WebM, which Safari and iOS cannot decode — try one recorded after 2026-09-05, or open this page in Chrome.`,
        )
      }

      // Re-transcribe to get the timestamps. In a real build these would have
      // been persisted at save time; the whole point of the prototype is that
      // no schema change is needed to find out whether the idea works.
      const fd = new FormData()
      fd.append('audio_path', s.audio_path ?? '')
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Transcription failed (${res.status}).`)

      const segs: Segment[] = (json.segments ?? [])
        .map((x: Segment) => ({ start: Number(x.start), end: Number(x.end), text: String(x.text ?? '').trim() }))
        .filter((x: Segment) => x.text && Number.isFinite(x.start) && Number.isFinite(x.end))

      if (segs.length === 0) {
        throw new Error('Whisper returned no timed segments for this recording.')
      }

      setAudioUrl(audio.url)
      setSegments(segs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setWorking(false)
    }
  }

  const playSegment = (i: number) => {
    const el = audioRef.current
    const seg = segments[i]
    if (!el || !seg) return
    stopAtRef.current = seg.end
    el.currentTime = seg.start
    setPlayingIndex(i)
    void el.play().catch(() => {
      setError('The browser blocked playback. Tap again.')
      setPlayingIndex(null)
    })
  }

  const onTimeUpdate = () => {
    const el = audioRef.current
    if (!el || stopAtRef.current === null) return
    if (el.currentTime >= stopAtRef.current) {
      el.pause()
      stopAtRef.current = null
      setPlayingIndex(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, letterSpacing: -0.6, margin: 0, color: 'var(--text)' }}>
            Hear It
          </h1>
          <Link href="/dashboard" className="btn btn-ghost" style={{ fontSize: 13 }}>← Dashboard</Link>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 4px' }}>
          Tap any sentence to hear your own voice say it. Prototype — it re-transcribes
          the recording each time to get the timings, so opening a session takes a few
          seconds and costs one Whisper call. Nothing is saved.
        </p>
        <div className="divider" />

        {!active && (
          <>
            {loadingList && <div style={{ color: 'var(--text-2)', fontSize: 14 }}>Loading your sessions…</div>}
            {listError && <div style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 600 }}>{listError}</div>}
            {!loadingList && !listError && sessions.length === 0 && (
              <div className="card" style={{ padding: 28, textAlign: 'center' }}>
                <div style={{ fontWeight: 800, marginBottom: 6, color: 'var(--text)' }}>No recordings yet</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
                  This page needs a session with saved audio. Record one from the dashboard first.
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => void open(s)}
                  className="card"
                  style={{ padding: '14px 16px', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
                >
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                    {s.session_name ?? 'Session'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                    {s.athletes ? `${s.athletes.first_name} ${s.athletes.last_name} · ` : ''}
                    {formatSessionDate(s)}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {active && (
          <>
            <button onClick={() => { setActive(null); setSegments([]); setAudioUrl(''); setError('') }}
              className="btn btn-ghost" style={{ marginBottom: 14, fontSize: 13 }}>
              ← All recordings
            </button>

            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>
              {active.session_name ?? 'Session'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              {active.athletes ? `${active.athletes.first_name} ${active.athletes.last_name} · ` : ''}
              {formatSessionDate(active)}
            </div>

            {working && (
              <div style={{ color: 'var(--text-2)', fontSize: 14, padding: '20px 0' }}>
                Transcribing — this takes a few seconds…
              </div>
            )}

            {error && (
              <div className="card" style={{ padding: 14, borderColor: '#EBCBBC', background: 'var(--danger-light)', color: 'var(--danger)', fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                {error}
              </div>
            )}

            {audioUrl && (
              <audio ref={audioRef} src={audioUrl} onTimeUpdate={onTimeUpdate}
                onEnded={() => { stopAtRef.current = null; setPlayingIndex(null) }} preload="auto" />
            )}

            {segments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {segments.map((seg, i) => {
                  const on = playingIndex === i
                  return (
                    <button
                      key={i}
                      onClick={() => playSegment(i)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
                        padding: '11px 13px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        background: on ? 'var(--primary-light)' : 'var(--card)',
                        border: `1px solid ${on ? 'var(--primary)' : 'var(--border-soft)'}`,
                        transition: 'background 0.12s, border-color 0.12s',
                      }}
                    >
                      <span style={{
                        flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                        background: on ? 'var(--primary)' : 'var(--border-soft)',
                        color: on ? '#fff' : 'var(--text-2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, marginTop: 1,
                      }}>
                        {on ? '❙❙' : '▶'}
                      </span>
                      <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.55, color: 'var(--text)' }}>
                        {seg.text}
                      </span>
                      <span className="font-mono" style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {fmtClock(seg.start)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
