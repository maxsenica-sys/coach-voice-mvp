'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import VideoAnnotator, { type AnnotationStroke } from '@/app/components/VideoAnnotator'

export default function ShareClipPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const videoId = (params?.videoId as string) ?? ''
  const sessionId = searchParams?.get('session') ?? ''
  const startTime = parseFloat(searchParams?.get('t') ?? '0') || 0

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [video, setVideo] = useState<{ signedUrl: string | null; annotations: AnnotationStroke[]; file_name: string | null } | null>(null)

  useEffect(() => {
    if (!videoId || !sessionId) { setError('Invalid share link'); setLoading(false); return }
    fetch(`/api/share/clip/${videoId}?session=${sessionId}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) throw new Error(j.error)
        setVideo(j.video)
      })
      .catch(e => setError(e?.message ?? 'Failed to load clip'))
      .finally(() => setLoading(false))
  }, [videoId, sessionId])

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff', fontSize: 15 }}>
      Loading clip…
    </div>
  )

  if (error || !video?.signedUrl) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff', gap: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{error ?? 'Clip not available'}</div>
      <Link href="/" style={{ color: '#60a5fa', fontSize: 14 }}>Go to CoachVoice</Link>
    </div>
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
