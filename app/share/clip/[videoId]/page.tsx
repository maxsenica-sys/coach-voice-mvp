'use client'

import { useEffect, useState } from 'react'
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

/* ── Stadium Night, for the one page a link lands on ─────────────────────
 *
 * Everything here reads the app's tokens, so it is the same ink ground and
 * cream text as the rest of the product. No floodlight: nothing on this page
 * is live, unread or "now", and the design spends it on nothing else.
 *
 * What the page shows is unchanged — the clip, the coach's drawing on it, its
 * file name and the timecode it was shared at. It is not a public page: the
 * route returns 401 without a session and serves only the coach who owns the
 * session or the athlete it was shared with, and the one line of copy added
 * here says exactly that and nothing more.
 */

/** The stage lighting: a sage beam, the 39px pitch marking, both still. */
const STAGE: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none',
  background:
    'radial-gradient(760px 440px at -14% -10%, rgba(125,168,120,0.22) 0%, rgba(125,168,120,0) 62%),' +
    'radial-gradient(640px 520px at 50% 116%, rgba(58,79,56,0.45) 0%, rgba(31,36,33,0) 66%)',
}
const GRID: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none',
  backgroundImage:
    'repeating-linear-gradient(to right, rgba(245,236,215,0.045) 0 1px, transparent 1px 39px),' +
    'repeating-linear-gradient(to bottom, rgba(245,236,215,0.030) 0 1px, transparent 1px 39px)',
  WebkitMaskImage: 'linear-gradient(164deg, #000 0%, rgba(0,0,0,0.22) 52%, rgba(0,0,0,0.8) 100%)',
  maskImage: 'linear-gradient(164deg, #000 0%, rgba(0,0,0,0.22) 52%, rgba(0,0,0,0.8) 100%)',
}

const CAST = 'var(--font-cast)'
const MONO = 'var(--font-mono)'

function Mark() {
  return (
    <div
      aria-hidden
      style={{
        width: 30, height: 30, borderRadius: 10, flex: 'none',
        border: '1.5px solid var(--primary)', color: 'var(--primary)', background: 'var(--primary-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5" /><path d="M12 18.5V21" />
      </svg>
    </div>
  )
}

function Wordmark() {
  return (
    <span style={{ fontFamily: CAST, fontWeight: 700, fontSize: 16, letterSpacing: '.22em', lineHeight: 1, color: 'var(--text)' }}>
      COACHVOICE
    </span>
  )
}

const homeLink: React.CSSProperties = {
  color: 'var(--primary)', fontSize: 15, fontWeight: 700, textDecoration: 'none',
  minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 12px',
}

/** The full-page shell the loading, invalid and error states all share. */
function ClipMessage({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text)', gap: 16, padding: '0 20px', textAlign: 'center', position: 'relative', isolation: 'isolate' }}>
      <div aria-hidden style={STAGE} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Mark /><Wordmark /></div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 500, lineHeight: 1.3, maxWidth: 320, overflowWrap: 'anywhere' }}>{children}</div>
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
    <ClipMessage action={<Link href="/" style={homeLink}>Go to CoachVoice</Link>}>
      Invalid share link
    </ClipMessage>
  )

  if (loading) return <ClipMessage>Loading clip…</ClipMessage>

  if (error || !video?.signedUrl) return (
    <ClipMessage action={<Link href="/" style={homeLink}>Go to CoachVoice</Link>}>
      {error ?? 'Clip not available'}
    </ClipMessage>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column', position: 'relative', isolation: 'isolate' }}>
      <div aria-hidden style={STAGE} />
      <div aria-hidden style={GRID} />

      <div style={{ width: '100%', maxWidth: 900, margin: '0 auto', padding: '20px 20px 0', minWidth: 0 }}>
        {/* Header — the wordmark and nothing else */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 13, borderBottom: '1px solid var(--border)' }}>
          <Mark />
          <Wordmark />
        </header>

        {/* The clip's own title: its file name, as it always was */}
        <div style={{ position: 'relative', padding: '15px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: CAST, fontWeight: 700, fontSize: 13, letterSpacing: '.26em', color: 'var(--text-2)' }}>
            <i aria-hidden style={{ width: 7, height: 7, background: 'var(--text-muted)', flex: 'none', transform: 'skewX(-14deg)' }} />
            SHARED CLIP
          </div>
          <h1 style={{ fontFamily: CAST, fontWeight: 800, fontSize: 27, letterSpacing: '.035em', lineHeight: 1.04, color: 'var(--text)', margin: '9px 0 0', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>
            {video.file_name ?? 'Shared Clip'}
          </h1>
          {startTime > 0 && (
            <div style={{ fontFamily: MONO, fontWeight: 500, fontSize: 13, letterSpacing: '.06em', color: 'var(--text-2)', marginTop: 8 }}>
              AT {formatTime(startTime)}
            </div>
          )}
        </div>
      </div>

      {/* Video */}
      <main style={{ flex: 1, maxWidth: 900, width: '100%', margin: '0 auto', padding: '13px 20px 20px', minWidth: 0 }}>
        <VideoAnnotator
          videoUrl={video.signedUrl}
          initialAnnotations={video.annotations}
          readOnly
          sessionId={sessionId}
          videoId={videoId}
          startTime={startTime}
        />
        {startTime > 0 && (
          <p style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', marginTop: 9, lineHeight: 1.4, textAlign: 'center' }}>
            Starts at {formatTime(startTime)}, where your coach shared it
          </p>
        )}

        {/* Who this link is for — stated because it is true, and only that */}
        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 18, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
          <h2 style={{ fontFamily: CAST, fontWeight: 700, fontSize: 13, letterSpacing: '.26em', color: 'var(--text-2)', margin: 0 }}>WHO CAN OPEN THIS</h2>
        </div>
        <p style={{ margin: '8px 0 0', padding: '12px 15px 13px', borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 17, lineHeight: 1.35, color: 'var(--text)' }}>
          Only the coach who recorded this session and the athlete it was shared with, signed in to CoachVoice.
        </p>

        <div style={{ marginTop: 22, paddingTop: 4, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
          <Link href="/" style={homeLink}>Go to CoachVoice</Link>
        </div>
      </main>
    </div>
  )
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
