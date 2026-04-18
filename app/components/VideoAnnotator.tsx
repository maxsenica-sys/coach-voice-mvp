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
  onAnnotationsChange?: (strokes: AnnotationStroke[]) => void
  readOnly?: boolean
  sessionId?: string
  videoId?: string
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff', '#000000']
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

export default function VideoAnnotator({ videoUrl, initialAnnotations = [], onAnnotationsChange, readOnly = false, sessionId, videoId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const currentStrokeRef = useRef<AnnotationStroke | null>(null)
  const isDrawingRef = useRef(false)

  const [strokes, setStrokes] = useState<AnnotationStroke[]>(initialAnnotations)
  const [drawMode, setDrawMode] = useState(false)
  const [color, setColor] = useState('#ef4444')
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
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Video + canvas overlay */}
      <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          src={videoUrl}
          controls
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

        {/* Draw mode indicator */}
        {drawMode && (
          <div style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            padding: '4px 12px',
            borderRadius: 999,
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none',
          }}>
            ✏️ Draw mode — pause video to annotate
          </div>
        )}
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {/* Row 1: Draw toggle + undo/clear */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={`btn ${drawMode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDrawMode((v) => !v)}
              style={{ gap: 6 }}
            >
              ✏️ {drawMode ? 'Drawing ON' : 'Draw mode'}
            </button>
            <button className="btn btn-ghost" onClick={undoLast} disabled={strokes.length === 0}>
              ↩ Undo
            </button>
            <button className="btn btn-danger" onClick={clearAll} disabled={strokes.length === 0}>
              🗑 Clear all
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
              {strokes.length} annotation{strokes.length !== 1 ? 's' : ''}
            </span>
            {sessionId && videoId && (
              <button
                className="btn btn-ghost"
                onClick={copyShareLink}
                style={{ gap: 5, fontSize: 12, color: shareCopied ? 'var(--success)' : undefined }}
                title="Copy link to current clip timestamp"
              >
                🔗 {shareCopied ? 'Copied!' : 'Share clip'}
              </button>
            )}
          </div>

          {drawMode && (
            <>
              {/* Row 2: Colors */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', minWidth: 50 }}>Colour</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: c,
                        border: color === c ? '3px solid var(--primary)' : '2px solid var(--border)',
                        cursor: 'pointer',
                        outline: color === c ? '2px solid rgba(37,99,235,0.3)' : 'none',
                        outlineOffset: 1,
                        boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #ccc' : 'none',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Row 3: Width + Duration */}
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', minWidth: 50 }}>Width</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {WIDTHS.map((w) => (
                      <button
                        key={w}
                        onClick={() => setStrokeWidth(w)}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          border: `1.5px solid ${strokeWidth === w ? 'var(--primary)' : 'var(--border)'}`,
                          background: strokeWidth === w ? 'var(--primary-light)' : 'var(--card)',
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

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', minWidth: 60 }}>Duration</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {DURATIONS.map((d) => (
                      <button
                        key={d.value}
                        onClick={() => setDuration(d.value)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: `1.5px solid ${duration === d.value ? 'var(--primary)' : 'var(--border)'}`,
                          background: duration === d.value ? 'var(--primary-light)' : 'var(--card)',
                          color: duration === d.value ? 'var(--primary)' : 'var(--text-2)',
                          fontWeight: duration === d.value ? 700 : 400,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                💡 Pause the video first, then draw. Annotations appear at the video timestamp where you drew them.
                {duration > 0 ? ` Each stroke will fade after ${duration}s with a burst effect.` : ' Strokes are permanent.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
