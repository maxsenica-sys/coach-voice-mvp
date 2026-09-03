'use client'

import { useState } from 'react'

/**
 * Plays back the original recording for a session.
 *
 * The `session-audio` bucket is private, so the URL is fetched on demand from
 * `/api/sessions/[id]/audio-url` — which checks the caller owns (or was shared)
 * the session — rather than being minted for every card on load.
 *
 * Render this only when the session actually has `audio_path` set; sessions
 * saved before recordings were persisted, or typed by hand, have no audio.
 */
export default function SessionAudioPlayer({ sessionId }: { sessionId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}/audio-url`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not open the recording.')
      if (!json.url) throw new Error('No recording found for this session.')
      setUrl(json.url)
    } catch (e: any) {
      setError(e?.message ?? 'Could not open the recording.')
    } finally {
      setLoading(false)
    }
  }

  if (url) {
    return (
      <audio
        controls
        src={url}
        preload="metadata"
        style={{ width: '100%', height: 34, marginTop: 8 }}
      />
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={load}
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
        <div style={{ fontSize: 11.5, color: 'var(--danger, #B55C3E)', marginTop: 5 }}>{error}</div>
      )}
    </div>
  )
}
