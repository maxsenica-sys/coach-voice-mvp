'use client'

import { useEffect, useRef, useState } from 'react'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'

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
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not open the recording.'))
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
          fontSize: 'var(--t-body-tight)', lineHeight: 1.55, color: 'var(--text-2)',
          background: 'var(--warning-light)', border: '1px solid var(--warning-border)',
          borderRadius: 12, padding: '10px 12px', overflowWrap: 'anywhere',
        }}>
          This device can’t play the format this session was recorded in.
          {url
            ? <> <a href={url} download style={{ color: 'var(--text)', fontWeight: 700 }}>Download the recording</a> to play it in another app.</>
            : <> <button onClick={() => void openUrl()} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: 'var(--text)', textDecoration: 'underline', cursor: 'pointer', minHeight: 44 }}>Get a download link</button>.</>}
          {/* Was the same colour at 0.85 opacity. On the ink ground that
              composites under 4.5:1, so the step down is carried by size. */}
          <div style={{ marginTop: 6, fontSize: 'var(--t-min)', lineHeight: 1.45, color: 'var(--text-2)' }}>
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
          style={{ width: '100%', height: 44 }}
        />
        {buffering && (
          <div style={{ fontSize: 'var(--t-min)', lineHeight: 1.45, color: 'var(--text-muted)', marginTop: 5 }}>
            Buffering — it will start as soon as enough has arrived.
          </div>
        )}
        {error && (
          <div style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.45, color: 'var(--danger)', marginTop: 5 }}>{error}</div>
        )}
      </div>
    )
  }

  /* The resting state: one round transport button and its label, as the
   * Stadium Night recording band draws it. Deliberately not floodlight — that
   * is spent on RECORD and live state, and pressing play on something already
   * saved is neither. The whole row is the button, so the tap target is the
   * 44px circle plus its label rather than the circle alone. */
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
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 12, minHeight: 44, maxWidth: '100%',
          padding: 0, background: 'none', border: 'none', color: 'var(--text)',
          cursor: loading ? 'progress' : 'pointer', textAlign: 'left',
        }}
      >
        <span aria-hidden style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          border: '1.5px solid var(--text-2)', color: 'var(--text)',
          background: 'color-mix(in srgb, var(--text) 6%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ width: 15, height: 15, display: 'block', marginLeft: 2 }}>
            <polygon points="6 3.5 20 12 6 20.5" />
          </svg>
        </span>
        <span style={{
          fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)',
          letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-2)', minWidth: 0,
        }}>
          {loading ? 'Opening…' : 'Play recording'}
        </span>
      </button>
      {error && (
        <div style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.45, color: 'var(--danger)', marginTop: 6 }}>{error}</div>
      )}
    </div>
  )
}
