'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

export type AnnotationStroke = {
  id: string
  color: string
  width: number
  points: { x: number; y: number }[]
  videoTimestamp: number  // seconds into video when stroke was drawn
  displayDuration: number // -1 = permanent, N = show for N seconds then burst-fade
}

type Props = {
  videoUrl: string
  initialAnnotations?: AnnotationStroke[]
  onAnnotationsChange?: (strokes: AnnotationStroke[]) => void | Promise<void>
  readOnly?: boolean
  sessionId?: string
  videoId?: string
  /**
   * Where to begin playback, in seconds.
   *
   * The share link this component builds carries `?t=`, and the page receiving
   * it parsed the value, printed it, and threw it away — under copy telling the
   * viewer to "seek manually or reload to jump there", which also did nothing.
   * The sending half worked; nothing ever acted on it.
   */
  startTime?: number
}

/* The pen colours — Stadium Night's five, replacing nine stock Tailwind hues
 * (#ef4444, #3b82f6 …) that belonged to no system.
 *
 * Literal hex, not tokens, and on purpose: a stroke's colour is SAVED into the
 * annotation and replayed on other people's screens later, and a canvas cannot
 * resolve `var(--x)` anyway. These are the exact values of the system colours
 * they name. Strokes drawn in the old colours keep their own saved colour and
 * still render exactly as drawn.
 *
 * Floodlight (#CBEF5E) is deliberately NOT offered. It is spent on state only —
 * record, live, unread, now — and a pen that could paint it on anything would
 * end that discipline the first week. Ember comes first because it is the
 * coach's mark everywhere else in the product. */
const COLORS = [
  { value: '#E39A7A', name: 'Ember' },
  { value: '#E4BC6B', name: 'Amber' },
  { value: '#A8CBA0', name: 'Sage' },
  { value: '#F5ECD7', name: 'Cream' },
  { value: '#151916', name: 'Ink' },
]
const WIDTHS = [2, 4, 7, 12]
const DURATIONS = [
  { label: 'Permanent', value: -1 },
  { label: '2 sec', value: 2 },
  { label: '4 sec', value: 4 },
  { label: '8 sec', value: 8 },
]

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/* Stadium Night surfaces, expressed against the tokens so a token change moves
 * them: the spec's --line, --line-2, --panel and ember are not globals yet. */
const LINE = 'color-mix(in srgb, var(--text) 11%, transparent)'
const LINE_2 = 'color-mix(in srgb, var(--text) 19%, transparent)'
const PANEL = 'color-mix(in srgb, var(--text) 4.5%, transparent)'
const PANEL_2 = 'color-mix(in srgb, var(--text) 10%, transparent)'
const EMBER = 'var(--coach-on-light)'
/* The frame's letterbox: one step under the ink ground, as the mockup's stage floor. */
const STAGE_FLOOR = 'color-mix(in srgb, var(--bg), black 35%)'

/** A toolbar control: Big Shoulders furniture on a hairline, 44px tall. */
function toolStyle(on = false, disabled = false): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 44, padding: '0 14px', borderRadius: 11,
    border: `1px solid ${on ? EMBER : LINE_2}`,
    background: on ? EMBER : PANEL,
    color: on ? 'var(--on-primary)' : 'var(--text-2)',
    fontFamily: 'var(--font-cast)', fontWeight: on ? 800 : 700,
    fontSize: 'var(--t-furniture)', letterSpacing: '0.14em', textTransform: 'uppercase',
    lineHeight: 1.1, whiteSpace: 'nowrap',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  }
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)',
  letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-2)',
}

function ToolIcon({ name }: { name: 'pen' | 'undo' | 'trash' | 'link' }) {
  const p = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
    style: { width: 14, height: 14, display: 'block', flexShrink: 0 },
  }
  switch (name) {
    case 'pen':   return <svg {...p}><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4.5 1.5L5 15Z" /></svg>
    case 'undo':  return <svg {...p}><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>
    case 'trash': return <svg {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
    case 'link':  return <svg {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
  }
}

/**
 * Paint one stroke onto the canvas.
 *
 * Module scope, not component scope. It closes over nothing — every input is a
 * parameter — and as a function declaration inside the component it was being
 * captured by the render loop's effect on first mount, which is what
 * react-hooks flags: an effect reading a binding declared after it cannot see
 * later versions of that binding. Hoisting made it work by accident. Moving it
 * out makes it correct on purpose, and makes it obvious there is no state here.
 */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: AnnotationStroke, alpha: number, burst: boolean) {
  if (stroke.points.length < 2) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = burst ? stroke.width * (1 + (1 - alpha) * 2) : stroke.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
  for (let i = 1; i < stroke.points.length; i++) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
  }
  ctx.stroke()
  ctx.restore()
}


export default function VideoAnnotator({ videoUrl, initialAnnotations = [], onAnnotationsChange, readOnly = false, sessionId, videoId, startTime = 0 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const currentStrokeRef = useRef<AnnotationStroke | null>(null)
  const isDrawingRef = useRef(false)

  const [strokes, setStrokes] = useState<AnnotationStroke[]>(initialAnnotations)
  const [drawMode, setDrawMode] = useState(false)
  const [color, setColor] = useState(COLORS[0].value)
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [duration, setDuration] = useState(-1)
  const [videoDimensions, setVideoDimensions] = useState({ w: 0, h: 0 })
  const [shareCopied, setShareCopied] = useState(false)

  // Sync strokes to parent when changed
  const strokesRef = useRef(strokes)
  useEffect(() => { strokesRef.current = strokes }, [strokes])

  const notifyChange = useCallback((newStrokes: AnnotationStroke[]) => {
    onAnnotationsChange?.(newStrokes)
  }, [onAnnotationsChange])

  // Size canvas to video
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const sync = () => {
      const { videoWidth, videoHeight } = video
      if (videoWidth && videoHeight) {
        canvas.width = videoWidth
        canvas.height = videoHeight
        setVideoDimensions({ w: videoWidth, h: videoHeight })
      }
    }
    video.addEventListener('loadedmetadata', sync)
    if (video.readyState >= 1) sync()
    return () => video.removeEventListener('loadedmetadata', sync)
  }, [videoUrl])

  /* Jump to the shared moment, once the browser knows how long the clip is.
   *
   * Seeking before `loadedmetadata` is a no-op — duration is NaN and
   * currentTime silently refuses — which is the trap a naive version of this
   * falls into. Clamping matters too: a link built from a longer cut of the
   * same clip would otherwise land the viewer on a black frame past the end.
   */
  useEffect(() => {
    if (!startTime || startTime <= 0) return
    const video = videoRef.current
    if (!video) return

    let done = false
    const seek = () => {
      if (done) return
      const d = video.duration
      if (!Number.isFinite(d) || d <= 0) return
      video.currentTime = Math.min(startTime, Math.max(0, d - 0.1))
      done = true
    }
    video.addEventListener('loadedmetadata', seek)
    if (video.readyState >= 1) seek()
    return () => video.removeEventListener('loadedmetadata', seek)
  }, [videoUrl, startTime])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')!

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const now = video.currentTime

      // Draw committed strokes
      for (const stroke of strokesRef.current) {
        const age = now - stroke.videoTimestamp
        if (age < 0) continue // not yet

        let alpha = 1
        if (stroke.displayDuration > 0) {
          if (age > stroke.displayDuration + 0.5) continue // fully gone
          if (age > stroke.displayDuration) {
            // burst-fade window (0 → 0.5s after expiry)
            const t = (age - stroke.displayDuration) / 0.5
            alpha = 1 - t
          }
        }

        drawStroke(ctx, stroke, alpha, stroke.displayDuration > 0 && age > stroke.displayDuration)
      }

      // Draw in-progress stroke
      if (currentStrokeRef.current) {
        drawStroke(ctx, currentStrokeRef.current, 1, false)
      }

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // Convert mouse/touch coords to canvas space
  function getCanvasPoint(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  const onPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawMode) return
    e.preventDefault()
    const pt = getCanvasPoint(e)
    if (!pt) return
    isDrawingRef.current = true
    currentStrokeRef.current = {
      id: uid(),
      color,
      width: strokeWidth,
      points: [pt],
      videoTimestamp: videoRef.current?.currentTime ?? 0,
      displayDuration: duration,
    }
  }

  const onPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawMode || !isDrawingRef.current || !currentStrokeRef.current) return
    e.preventDefault()
    const pt = getCanvasPoint(e)
    if (!pt) return
    currentStrokeRef.current.points.push(pt)
  }

  const onPointerUp = () => {
    if (!drawMode || !isDrawingRef.current || !currentStrokeRef.current) return
    isDrawingRef.current = false
    if (currentStrokeRef.current.points.length >= 2) {
      const newStrokes = [...strokesRef.current, currentStrokeRef.current]
      setStrokes(newStrokes)
      notifyChange(newStrokes)
    }
    currentStrokeRef.current = null
  }

  const undoLast = () => {
    setStrokes((prev) => {
      const next = prev.slice(0, -1)
      notifyChange(next)
      return next
    })
  }

  const clearAll = () => {
    setStrokes([])
    notifyChange([])
  }

  const copyShareLink = () => {
    if (!sessionId || !videoId) return
    const t = Math.round(videoRef.current?.currentTime ?? 0)
    const url = `${window.location.origin}/share/clip/${videoId}?session=${sessionId}&t=${t}`
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2500)
    })
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {/* Video + canvas overlay */}
      <div style={{
        position: 'relative', background: STAGE_FLOOR, borderRadius: 12, overflow: 'hidden',
        borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`,
      }}>
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          /* Metadata only until someone presses play.
           *
           * Without this, expanding a session with three clips starts three full
           * video downloads at once — on a phone, on mobile data, for clips the
           * coach may not watch. app/sessions/[id]/page.tsx already gets this
           * right; this component did not.
           *
           * `metadata` rather than `none` because the seek-to-shared-timestamp
           * below needs duration, and `none` would leave it NaN until play. */
          preload="metadata"
          playsInline
          style={{ width: '100%', display: 'block', maxHeight: 480 }}
        />
        <canvas
          ref={canvasRef}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            cursor: drawMode ? 'crosshair' : 'default',
            pointerEvents: drawMode ? 'all' : 'none',
            touchAction: 'none',
          }}
        />

        {/* Draw mode indicator — the one floodlight on this screen, because it
            is a live state: the frame is taking the coach's finger right now.
            Top-right, clear of the native controls along the bottom edge. The
            "pause first" instruction lives in the toolbar hint below, which
            renders whenever this does. */}
        {drawMode && (
          <div style={{
            position: 'absolute',
            top: 10,
            right: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: 'var(--flood)',
            color: 'var(--on-primary)',
            fontFamily: 'var(--font-cast)',
            fontSize: 'var(--t-furniture)',
            fontWeight: 800,
            letterSpacing: '0.2em',
            lineHeight: 1.2,
            padding: '5px 11px',
            borderRadius: 999,
            maxWidth: 'calc(100% - 20px)',
            pointerEvents: 'none',
          }}>
            {/* A 2.4s breath on a 6px dot — small-area motion only. The
                global reduced-motion rule stills it. */}
            <span aria-hidden style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--on-primary)', flexShrink: 0,
              animation: 'cv-skeleton-breathe 2.4s ease-in-out infinite',
            }} />
            DRAWING
          </div>
        )}
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <div style={{
          background: PANEL,
          border: `1px solid ${LINE}`,
          borderRadius: 18,
          padding: '12px 12px 13px',
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
          minWidth: 0,
        }}>
          {/* Row 1: Draw toggle + undo/clear */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => setDrawMode((v) => !v)}
              aria-pressed={drawMode}
              style={toolStyle(drawMode)}
            >
              <ToolIcon name="pen" /> {drawMode ? 'Drawing on' : 'Draw mode'}
            </button>
            <button onClick={undoLast} disabled={strokes.length === 0} style={toolStyle(false, strokes.length === 0)}>
              <ToolIcon name="undo" /> Undo
            </button>
            <button
              onClick={clearAll}
              disabled={strokes.length === 0}
              style={{ ...toolStyle(false, strokes.length === 0), color: 'var(--danger)' }}
            >
              <ToolIcon name="trash" /> Clear all
            </button>
            <span style={{
              marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)',
              letterSpacing: '0.06em', color: 'var(--text-2)', textTransform: 'uppercase',
            }}>
              {strokes.length} annotation{strokes.length !== 1 ? 's' : ''}
            </span>
            {sessionId && videoId && (
              <button
                onClick={copyShareLink}
                style={{ ...toolStyle(), color: shareCopied ? 'var(--success)' : 'var(--text-2)' }}
                title="Copy link to current clip timestamp"
              >
                <ToolIcon name="link" /> {shareCopied ? 'Copied!' : 'Share clip'}
              </button>
            )}
          </div>

          {drawMode && (
            <>
              {/* Row 2: Colors */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
                <span style={{ ...labelStyle, minWidth: 72 }}>Colour</span>
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {/* 44px buttons around a 28px swatch — this toolbar is used
                      on a phone at the side of a court. Selection is an outline
                      with a gap, so the true ground shows between swatch and
                      ring on whatever card hosts the annotator. */}
                  {COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setColor(c.value)}
                      aria-label={`Pen colour ${c.name}`}
                      aria-pressed={color === c.value}
                      style={{
                        width: 44,
                        height: 44,
                        padding: 0,
                        border: 'none',
                        background: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: c.value,
                          border: '1px solid var(--text-muted)',
                          outline: color === c.value ? '2px solid var(--text)' : 'none',
                          outlineOffset: 2,
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 3: Width + Duration */}
              <div style={{ display: 'flex', gap: '12px 20px', flexWrap: 'wrap', paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  <span style={{ ...labelStyle, minWidth: 72 }}>Width</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {WIDTHS.map((w) => (
                      <button
                        key={w}
                        onClick={() => setStrokeWidth(w)}
                        aria-label={`Pen width ${w}`}
                        aria-pressed={strokeWidth === w}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          border: `1px solid ${strokeWidth === w ? 'var(--text-2)' : LINE_2}`,
                          background: strokeWidth === w ? PANEL_2 : PANEL,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <div style={{ width: Math.min(w * 2, 20), height: w, background: color, borderRadius: 999 }} />
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  <span style={{ ...labelStyle, minWidth: 72 }}>Duration</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {DURATIONS.map((d) => (
                      <button
                        key={d.value}
                        onClick={() => setDuration(d.value)}
                        aria-pressed={duration === d.value}
                        style={{
                          ...toolStyle(),
                          padding: '0 12px',
                          borderRadius: 10,
                          letterSpacing: '0.12em',
                          border: `1px solid ${duration === d.value ? 'var(--text-2)' : LINE_2}`,
                          background: duration === d.value ? PANEL_2 : PANEL,
                          color: duration === d.value ? 'var(--text)' : 'var(--text-2)',
                          fontWeight: duration === d.value ? 800 : 700,
                        }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>
                Pause the video first, then draw. Annotations appear at the video timestamp where you drew them.
                {duration > 0 ? ` Each stroke will fade after ${duration}s with a burst effect.` : ' Strokes are permanent.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
