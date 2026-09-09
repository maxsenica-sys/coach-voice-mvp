'use client'

/**
 * The Focus Card — the one sentence, as something an athlete can keep.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * A focus point is the only structured, forward-looking, athlete-actionable
 * thing this product makes. It is the coach's own words, lifted out of their
 * recording, addressed to one person, about the next session. And it renders
 * as a 13px line in a tinted box — the same visual weight as a caption.
 *
 * Separately: CoachVoice has no *object*. Nothing anyone can hold up, put on a
 * wall, or put on a phone. It cannot have one the usual way either, because
 * there is no public surface and there must not be one — the athletes are
 * minors. An image is the way out of that: a file is not a URL, so it needs no
 * public read, no share link and no server.
 *
 * And it gives the ink identity a reason to exist beyond the 1.24 seconds of
 * the cold-start splash.
 *
 * ── Safeguarding, stated rather than buried ──────────────────────────────
 *
 * The image contains **the coaching sentence, the date, and the wordmark**.
 * No athlete name, no surname, no photograph, no coach name, no URL, no
 * session id, nothing that identifies a child to anyone who receives it. That
 * is a deliberate ceiling, not an oversight: this file is designed to be
 * shareable *because* it carries nothing worth protecting.
 *
 * A screenshot achieves the same distribution today, with worse typography and
 * strictly more identifying detail on screen.
 *
 * ── Two things that could break, and what happens ────────────────────────
 *
 * `next/font` hashes its family names, so the CSS variable does not resolve to
 * anything canvas understands. The real family is read off a probe element
 * instead. If that fails the card still renders in the serif fallback.
 *
 * `navigator.share` with files is not universally available, and inside an
 * installed PWA on iOS it behaves differently from Safari. The download link
 * is the fallback, and it is always wired up rather than being a rescue path
 * nobody has run.
 */
import { useRef, useState } from 'react'

const W = 1080
const H = 1350

/** Read a CSS custom property off the document root. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * The family `--font-display` actually resolves to.
 *
 * `getPropertyValue('--font-display')` returns `var(--font-newsreader),
 * 'Georgia', serif` — a variable reference, which canvas cannot use. Rendering
 * a probe element and reading its *computed* fontFamily resolves the chain.
 */
function displayFamily(): string {
  if (typeof document === 'undefined') return 'Georgia, serif'
  const probe = document.createElement('span')
  probe.style.fontFamily = 'var(--font-display)'
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).fontFamily
  probe.remove()
  return resolved || 'Georgia, serif'
}

/** Greedy wrap to at most `maxLines`, shrinking the size until it fits. */
function layout(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; size: number } {
  for (let size = 86; size >= 40; size -= 4) {
    ctx.font = `500 ${size}px ${family}`
    const lines: string[] = []
    let line = ''
    for (const word of text.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate
      } else {
        if (line) lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
    if (lines.length <= maxLines) return { lines, size }
  }
  // Nothing fits: draw what we have at the floor rather than nothing at all.
  ctx.font = `500 40px ${family}`
  return { lines: [text], size: 40 }
}

export default function FocusCard({ point, dateLabel }: { point: string; dateLabel: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const draw = async (): Promise<Blob | null> => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Without this the first render can land before the webfont is ready and
    // silently fall back to Georgia.
    try { await document.fonts.ready } catch { /* older browsers: draw anyway */ }

    const family = displayFamily()
    const inkBase = token('--ink-base', '#1F2421')
    const inkMid = token('--ink-mid', '#3A4F38')
    const inkFigure = token('--ink-figure', '#445C42')
    const onInk = token('--on-ink', '#F5ECD7')

    canvas.width = W
    canvas.height = H

    // The exact geometry of --grad-ink, which is 160deg.
    const rad = ((160 - 90) * Math.PI) / 180
    const cx = W / 2
    const cy = H / 2
    const len = Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad))
    const g = ctx.createLinearGradient(
      cx - (Math.cos(rad) * len) / 2, cy - (Math.sin(rad) * len) / 2,
      cx + (Math.cos(rad) * len) / 2, cy + (Math.sin(rad) * len) / 2,
    )
    g.addColorStop(0, inkBase)
    g.addColorStop(1, inkMid)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    const margin = 110
    const maxWidth = W - margin * 2

    // The entrance's opening mark, quoted once.
    ctx.fillStyle = inkFigure
    ctx.fillRect(margin, 300, 132, 3)

    const { lines, size } = layout(ctx, point, family, maxWidth, 5)
    ctx.fillStyle = onInk
    ctx.textBaseline = 'top'
    const lineHeight = size * 1.24
    let y = 372
    for (const line of lines) {
      ctx.fillText(line, margin, y)
      y += lineHeight
    }

    // Date and wordmark. Nothing here names a person.
    ctx.font = `600 30px ${token('--font-sans', 'system-ui')}`
    ctx.fillStyle = onInk
    ctx.globalAlpha = 0.72
    ctx.fillText(dateLabel, margin, H - margin - 40)
    ctx.globalAlpha = 1

    ctx.font = `500 30px ${family}`
    ctx.fillStyle = onInk
    ctx.globalAlpha = 0.55
    ctx.fillText('CoachVoice', margin, H - margin)
    ctx.globalAlpha = 1

    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
  }

  const save = async () => {
    setBusy(true)
    setNote('')
    try {
      const blob = await draw()
      if (!blob) { setNote('Could not make the image on this device.'); return }
      const file = new File([blob], 'focus.png', { type: 'image/png' })

      // The share sheet is the good path on a phone — it offers "Save to
      // Photos", which is where this is meant to end up.
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      if (nav.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
          return
        } catch (e: unknown) {
          // A user who backs out of the share sheet has not hit an error, and
          // must not be shown one.
          if (e instanceof DOMException && e.name === 'AbortError') return
        }
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'focus.png'
      a.click()
      URL.revokeObjectURL(url)
      setNote('Saved to your downloads.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="btn btn-ghost"
        style={{ gap: 7, fontSize: 'var(--fs-2)', padding: '8px 13px' }}
      >
        {busy ? 'Making it…' : 'Save this as an image'}
      </button>
      {note && (
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-muted)', marginTop: 7 }}>{note}</div>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden />
    </>
  )
}
