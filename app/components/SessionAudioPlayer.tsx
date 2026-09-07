'use client'

import { useEffect, useRef, useState } from 'react'
import { apiJson } from '@/lib/api-client'

/**
 * Plays back the original recording for a session.
 *
 * Two things this has to handle beyond "render an <audio> tag":
 *
 * 1. CODEC. Recordings made in Chrome before 2026-09-05 are `audio/webm;
 *    codecs=opus`, which iOS Safari cannot decode at all. The browser doesn't
 *    error usefully — it just never fires `canplay`, so the control sits there
 *    apparently loading forever. We check `canPlayType` up front and say so
 *    plainly, with a download link, instead of spinning. New recordings prefer
 *    mp4/AAC precisely so this stops happening.
 *
 * 2. SLOW CONNECTIONS. `preload="none"` means nothing is fetched until play is
 *    pressed, and the element's own events drive an explicit buffering state,
 *    so a slow network reads as "Buffering…" rather than a dead button.
 */

type Props = {
  sessionId: string
  /** Pass a URL already minted by the caller to skip the extra round trip. */
  initialUrl?: string | null
  mime?: string | null
}

/** '' = definitely unplayable here, otherwise 'maybe' | 'probably'. */
function canPlay(mime: string | null | undefined): string {
  if (typeof document === 'undefined') return 'maybe'
  const el = document.createElement('audio')
  if (!mime) return 'maybe'
  // canPlayType wants `audio/webm; codecs="opus"` — normalise what we stored.
  const normalised = mime.replace(/codecs=([^"';]+)/, 'codecs="$1"')
  return el.canPlayType(normalised) || el.canPlayType(normalised.split(';')[0]) || ''
}

export default function SessionAudioPlayer({ sessionId, initialUrl = null, mime = null }: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [loading, setLoading] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [error, setError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [unsupported, setUnsupported] = useState(false)
  useEffect(() => { setUnsupported(canPlay(mime) === '') }, [mime])

  const openUrl = async () => {
    if (url) return url
    setLoading(true)
    setError('')
    try {
      const json = await apiJson<{ url?: string }>(`/api/sessions/${sessionId}/audio-url`, { cache: 'no-store' })
      if (!json.url) throw new Error('No recording is saved for this session.')
      setUrl(json.url)
      return json.url
    } catch (e: any) {
      setError(e?.message ?? 'Could not open the recording.')
      return null
    } finally {
      setLoading(false)
    }
  }

  // ── Recorded in a format this device can't decode ─────────────────────────
  if (unsupported) {
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{
          fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-2, #5D6661)',
          background: 'var(--warning-light, #F6E9CC)', border: '1px solid #E4CE9A',
          borderRadius: 10, padding: '10px 12px',
        }}>
          This device can’t play the format this session was recorded in.
          {url
            ? <> <a href={url} download style={{ color: 'inherit', fontWeight: 700 }}>Download the recording</a> to play it in another app.</>
            : <> <button onClick={() => void openUrl()} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>Get a download link</button>.</>}
          <div style={{ marginTop: 5, fontSize: 11.5, opacity: 0.85 }}>
            Recordings made from now on play everywhere — this affects older ones only.
          </div>
        </div>
      </div>
    )
  }

  if (url) {
    return (
      <div style={{ marginTop: 8 }}>
        <audio
          ref={audioRef}
          controls
          preload="none"
          src={url}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onError={() => setError('The recording could not be played. It may still be uploading.')}
          style={{ width: '100%', height: 34 }}
        />
        {buffering && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted, var(--text-muted))', marginTop: 4 }}>
            Buffering — it will start as soon as enough has arrived.
          </div>
        )}
        {error && (
          <div style={{ fontSize: 11.5, color: 'var(--danger, #B0473A)', marginTop: 4 }}>{error}</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={async () => {
          const got = await openUrl()
          // Autoplay once fetched, so it's one tap rather than two.
          if (got) window.setTimeout(() => void audioRef.current?.play().catch(() => {}), 0)
        }}
        disabled={loading}
        className="btn btn-ghost"
        style={{ padding: '5px 10px', fontSize: 11.5, gap: 6, display: 'inline-flex', alignItems: 'center' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13, display: 'block' }}>
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        {loading ? 'Opening…' : 'Play recording'}
      </button>
      {error && (
        <div style={{ fontSize: 11.5, color: 'var(--danger, #B0473A)', marginTop: 5 }}>{error}</div>
      )}
    </div>
  )
}
