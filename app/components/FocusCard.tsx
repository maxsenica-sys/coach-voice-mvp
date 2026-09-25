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

/* ── Type on the canvas, in the same scale as the type in the app ──────────
 *
 * CSS tokens do not reach a canvas: every size below is a number in a 1080px
 * coordinate space, and nothing about the type-scale change touched them. They
 * still have to answer to it, because this file is read at a scale. A
 * 1080-wide image fills a 390px phone at 2.77×, so a canvas size divided by
 * 2.77 is roughly what the athlete's thumb-width reading of it measures.
 *
 * The app's floors are --t-furniture 13px and --t-body 15px. At 2.77× those
 * are 36 and 42 here. The date and the wordmark were 30px — 10.8px on the
 * phone this is saved to, which is below the floor every other label in the
 * product was just raised to, on the one artefact designed to leave it.
 */
const LINE_HEIGHT = 1.24
const FURNITURE = 36      // 13px × 2.77 — the date and the wordmark
const SENTENCE_MAX = 86   // ≈ the 30px display step at the same scale
const SENTENCE_MIN = 46   // 15px × 2.77 is 42; 46 is the step at or above it

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

/**
 * Split one token that is wider than the whole column.
 *
 * "counter-rotation-through-the-hips" measures 1281px at 86px against an 860px
 * column, and a greedy wrapper has nowhere to put it: it goes on a line of its
 * own and runs 200px off the side of the image, taking the last two words of
 * the compound with it. Breaking after the hyphens is where a reader expects
 * the break anyway; a token with no hyphens is broken by character, which is
 * ugly and is still better than deleting the end of a coach's sentence.
 *
 * No lookbehind in the regex on purpose — Safari only learned it in 16.4, and
 * a SyntaxError here takes the whole chunk down on the phones this is for.
 */
function splitToken(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const chunks = word.split('-').map((part, i, all) => (i < all.length - 1 ? `${part}-` : part)).filter(Boolean)
  const pieces: string[] = []
  let piece = ''
  const push = (fragment: string) => {
    if (!piece) { piece = fragment; return }
    if (ctx.measureText(piece + fragment).width <= maxWidth) piece += fragment
    else { pieces.push(piece); piece = fragment }
  }
  for (const chunk of chunks) {
    if (ctx.measureText(chunk).width <= maxWidth) { push(chunk); continue }
    // Still too wide with the hyphens used up: character by character.
    for (const ch of chunk) {
      if (piece && ctx.measureText(piece + ch).width > maxWidth) { pieces.push(piece); piece = ch }
      else piece += ch
    }
  }
  if (piece) pieces.push(piece)
  return pieces
}

/** Greedy wrap at the current font, breaking only tokens that cannot fit. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (!word) continue
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue }
    if (line) { lines.push(line); line = '' }
    if (ctx.measureText(word).width <= maxWidth) { line = word; continue }
    const pieces = splitToken(ctx, word, maxWidth)
    lines.push(...pieces.slice(0, -1))
    line = pieces[pieces.length - 1] ?? ''
  }
  if (line) lines.push(line)
  return lines
}

/**
 * The biggest size at which the sentence fits `maxLines`.
 *
 * Three stages, in the order of what is worth giving up. The shape of the card
 * goes first, then the size floor; the words never go. The old version of this
 * gave up the words: when nothing fit in five lines it returned `[text]` — the
 * entire sentence as a single unbroken line at 40px, which draws off both
 * sides of the image. A focus point is capped at 200 characters and the model
 * is asked for 90, so that path took a coach typing two sentences to reach,
 * and it lost most of both.
 */
function layout(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  maxWidth: number,
  maxLines: number,
  maxHeight: number,
): { lines: string[]; size: number } {
  const fits = (lines: string[], size: number) => lines.length * size * LINE_HEIGHT <= maxHeight
  let last = { lines: [text], size: SENTENCE_MIN }

  // 1 · the drawn shape: as large as possible within maxLines.
  for (let size = SENTENCE_MAX; size >= SENTENCE_MIN; size -= 4) {
    ctx.font = `500 ${size}px ${family}`
    last = { lines: wrap(ctx, text, maxWidth), size }
    if (last.lines.length <= maxLines) return last
  }

  // 2 · a long one: hold the floor and let the block run to more lines, so
  //     long as it still clears the date.
  if (fits(last.lines, last.size)) return last

  // 3 · only now does the type go under the floor, because a sentence the
  //     athlete can read half of is worse than one set small.
  for (let size = SENTENCE_MIN - 4; size >= 20; size -= 4) {
    ctx.font = `500 ${size}px ${family}`
    last = { lines: wrap(ctx, text, maxWidth), size }
    if (fits(last.lines, last.size)) return last
  }
  return last
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

    // The two lines at the foot of the card, as baselines rather than tops —
    // at 36px the old `top` positions put 4px between them.
    const textTop = 372
    const dateBaseline = H - margin - 56
    const wordmarkBaseline = H - margin
    // How far the sentence may run before it crowds the date.
    const maxTextHeight = dateBaseline - FURNITURE - 40 - textTop

    const { lines, size } = layout(ctx, point, family, maxWidth, 5, maxTextHeight)
    // layout() leaves ctx.font on whichever size it settled on, but say it
    // here anyway: a future early return in there must not silently draw the
    // sentence at the wrong size.
    ctx.font = `500 ${size}px ${family}`
    ctx.fillStyle = onInk
    ctx.textBaseline = 'top'
    const lineHeight = size * LINE_HEIGHT
    let y = textTop
    for (const line of lines) {
      ctx.fillText(line, margin, y)
      y += lineHeight
    }

    // Date and wordmark. Nothing here names a person.
    ctx.textBaseline = 'alphabetic'
    ctx.font = `600 ${FURNITURE}px ${token('--font-sans', 'system-ui')}`
    ctx.fillStyle = onInk
    ctx.globalAlpha = 0.72
    ctx.fillText(dateLabel, margin, dateBaseline)
    ctx.globalAlpha = 1

    ctx.font = `500 ${FURNITURE}px ${family}`
    ctx.fillStyle = onInk
    ctx.globalAlpha = 0.55
    ctx.fillText('CoachVoice', margin, wordmarkBaseline)
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
