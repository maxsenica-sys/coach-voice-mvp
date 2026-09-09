'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import VideoAnnotator, { type AnnotationStroke } from '@/app/components/VideoAnnotator'
import { errorMessage } from '@/lib/errors'
import { apiJson } from '@/lib/api-client'

interface ClipVideo {
  signedUrl: string | null
  annotations: AnnotationStroke[]
  file_name: string | null
}

/** The dark full-page shell the loading, invalid and error states all share. */
function ClipMessage({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff', gap: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>
      {action}
    </div>
  )
}

export default function ShareClipPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const videoId = (params?.videoId as string) ?? ''
  const sessionId = searchParams?.get('session') ?? ''
  const startTime = parseFloat(searchParams?.get('t') ?? '0') || 0

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [video, setVideo] = useState<ClipVideo | null>(null)

  // A malformed link is knowable from the URL alone, so it is derived rather
  // than pushed into state from inside the effect. Setting state synchronously
  // in an effect body schedules a second render before the first has painted —
  // which is what react-hooks flags here, and it was doing it on the one path
  // that renders no content at all.
  const linkIsValid = Boolean(videoId && sessionId)

  useEffect(() => {
    if (!linkIsValid) return
    let cancelled = false
    // apiJson, not raw fetch: the previous version read the body before
    // checking the status, so a non-2xx with no `error` key resolved to
    // `undefined` and rendered an empty player rather than an error.
    apiJson<{ video?: ClipVideo }>(`/api/share/clip/${videoId}?session=${sessionId}`)
      .then((j) => { if (!cancelled) setVideo(j.video ?? null) })
      .catch((e: unknown) => { if (!cancelled) setError(errorMessage(e, 'Failed to load clip')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [videoId, sessionId, linkIsValid])

  if (!linkIsValid) return (
    <ClipMessage action={<Link href="/" style={{ color: '#60a5fa', fontSize: 14 }}>Go to CoachVoice</Link>}>
      Invalid share link
    </ClipMessage>
  )

  if (loading) return <ClipMessage>Loading clip…</ClipMessage>

  if (error || !video?.signedUrl) return (
    <ClipMessage action={<Link href="/" style={{ color: '#60a5fa', fontSize: 14 }}>Go to CoachVoice</Link>}>
      {error ?? 'Clip not available'}
    </ClipMessage>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎙</div>
        <span style={{ fontWeight: 900, fontSize: 16, color: '#fff', letterSpacing: -0.3 }}>CoachVoice</span>
        <span style={{ color: 'rgba(255,255,255,0.3)', margin: '0 4px' }}>·</span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>
          {video.file_name ?? 'Shared Clip'}
          {startTime > 0 && ` · ${formatTime(startTime)}`}
        </span>
      </header>

      {/* Video */}
      <main style={{ flex: 1, maxWidth: 900, width: '100%', margin: '0 auto', padding: 20 }}>
        <VideoAnnotator
          videoUrl={video.signedUrl}
          initialAnnotations={video.annotations}
          readOnly
          sessionId={sessionId}
          videoId={videoId}
        />
        {startTime > 0 && (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8, textAlign: 'center' }}>
            Shared from timestamp {formatTime(startTime)} — seek manually or reload to jump there
          </p>
        )}
      </main>
    </div>
  )
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
