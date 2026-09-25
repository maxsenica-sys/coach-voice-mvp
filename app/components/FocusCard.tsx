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
 * The family a font token actually resolves to.
 *
 * `getPropertyValue('--font-display')` returns `var(--font-newsreader),
 * 'Georgia', serif` — a variable reference, which canvas cannot use. Rendering
 * a probe element and reading its *computed* fontFamily resolves the chain.
 */
function tokenFamily(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const probe = document.createElement('span')
  probe.style.fontFamily = `var(${name})`
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).fontFamily
  probe.remove()
  return resolved || fallback
}

function displayFamily(): string {
  return tokenFamily('--font-display', 'Georgia, serif')
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

/* ── Stadium Night on the card ────────────────────────────────────────────
 *
 * The composition of the approved Focus Card: an ink ground under still stage
 * lighting (a sage beam from the top right, a softer one from the left, the
 * pitch marking scaled 2.77× so it still reads as ten columns), a sage opening
 * rule, the sentence, and under a hairline the date and the wordmark. No
 * floodlight — a saved image has no live or unread state — and no animation,
 * because the output is a still file.
 *
 * Every layer below is decoration at low alpha. None of it sits behind the
 * text at a strength that moves its contrast: the lightest the ground gets
 * under the sentence is a few levels above the ink.
 */
const SAGE_LIFT = '#A8CBA0'   // the opening rule — 8.79:1 on the ink, a graphic
const WORDMARK = 52           // Big Shoulders, tracked — 18.8px on the phone
const HAIR_Y = H - 272        // the rule over the date
const DATE_BASELINE = H - 202
const WORDMARK_BASELINE = H - 115
const TEXT_TOP = 530          // where a sentence of up to four lines starts
const TEXT_TOP_MIN = 372      // how high a longer one may climb
const OPENER_GAP = 78         // opener top to text top: 8px of rule, 70 of air

/** An elliptical radial glow, as CSS `radial-gradient(rx ry at cx cy, …)` draws it. */
function glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, stops: [number, string][]) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1, ry / rx)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
  for (const [at, colour] of stops) g.addColorStop(at, colour)
  ctx.fillStyle = g
  ctx.fillRect(-4 * W, -4 * H * (rx / ry), 8 * W, 8 * H * (rx / ry))
  ctx.restore()
}

/** A CSS `linear-gradient(<deg>, …)` across the whole card, as a canvas gradient. */
function cssLinear(ctx: CanvasRenderingContext2D, deg: number, stops: [number, string][]): CanvasGradient {
  const rad = ((deg - 90) * Math.PI) / 180
  const len = Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad))
  const g = ctx.createLinearGradient(
    W / 2 - (Math.cos(rad) * len) / 2, H / 2 - (Math.sin(rad) * len) / 2,
    W / 2 + (Math.cos(rad) * len) / 2, H / 2 + (Math.sin(rad) * len) / 2,
  )
  for (const [at, colour] of stops) g.addColorStop(at, colour)
  return g
}

/** Draw a layer on its own canvas, cut it with a mask, and lay it on the card. */
function masked(ctx: CanvasRenderingContext2D, paint: (l: CanvasRenderingContext2D) => void, mask: (l: CanvasRenderingContext2D) => CanvasGradient) {
  const layer = document.createElement('canvas')
  layer.width = W
  layer.height = H
  const l = layer.getContext('2d')
  if (!l) return
  paint(l)
  l.globalCompositeOperation = 'destination-in'
  l.fillStyle = mask(l)
  l.fillRect(0, 0, W, H)
  ctx.drawImage(layer, 0, 0)
}

/**
 * Letter-spaced text, one glyph at a time.
 *
 * `ctx.letterSpacing` would do this, but it is missing from Safari before 17
 * — which is exactly the phone this is saved on — and silently ignored there.
 * Drawing each character and advancing by its width plus the tracking reads
 * the same in every engine.
 */
function trackedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  let w = 0
  for (const ch of text) w += ctx.measureText(ch).width + tracking
  return w - tracking
}
function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  let at = x
  for (const ch of text) {
    ctx.fillText(ch, at, y)
    at += ctx.measureText(ch).width + tracking
  }
}

/** The still stage: ground, beams, rake, pitch marking, grain, vignette. */
function paintStage(ctx: CanvasRenderingContext2D, inkToken: string, inkMidToken: string) {
  // The beams add an alpha byte to these, so they must be plain #rrggbb.
  const hex = /^#[0-9a-f]{6}$/i
  const ink = hex.test(inkToken) ? inkToken : '#1F2421'
  const inkMid = hex.test(inkMidToken) ? inkMidToken : '#3A4F38'
  ctx.fillStyle = ink
  ctx.fillRect(0, 0, W, H)

  // The deep beam rising from below — the old --grad-ink's green, as light.
  glow(ctx, W * 0.5, H * 1.16, 1400, 1100, [[0, `${inkMid}85`], [0.66, `${ink}00`]])
  // The sage beams: a soft one from the left, the key light from the top right.
  glow(ctx, W * -0.12, H * 0.26, 1100, 820, [[0, 'rgba(125,168,120,0.14)'], [0.6, 'rgba(125,168,120,0)']])
  glow(ctx, W * 1.08, H * -0.08, 1500, 900, [[0, 'rgba(125,168,120,0.30)'], [0.62, 'rgba(125,168,120,0)']])

  // The light rake, held still: a skewed band fading down and to the right.
  masked(ctx, (l) => {
    l.save()
    l.translate(130, 730)
    l.transform(1, 0, Math.tan((-17 * Math.PI) / 180), 1, 0, 0)
    l.translate(-130, -730)
    const g = l.createLinearGradient(0, -220, 0, 1680)
    g.addColorStop(0, 'rgba(245,236,215,0.034)')
    g.addColorStop(0.44, 'rgba(245,236,215,0.009)')
    g.addColorStop(0.76, 'rgba(245,236,215,0)')
    l.fillStyle = g
    l.fillRect(-250, -220, 760, 1900)
    l.restore()
  }, (l) => {
    const g = l.createLinearGradient(-250, 0, 510, 0)
    g.addColorStop(0, '#000')
    g.addColorStop(0.72, '#000')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    return g
  })

  // The 39px pitch marking at 2.77×: a line every 108px, stronger at the top.
  masked(ctx, (l) => {
    l.fillStyle = 'rgba(245,236,215,0.045)'
    for (let x = 0; x < W; x += 108) l.fillRect(x, 0, 2, H)
    l.fillStyle = 'rgba(245,236,215,0.030)'
    for (let y = 0; y < H; y += 108) l.fillRect(0, y, W, 2)
  }, (l) => cssLinear(l, 196, [[0, '#000'], [0.5, 'rgba(0,0,0,0.22)'], [1, 'rgba(0,0,0,0.85)']]))

  // Grain, at an effective 0.065 — well under the 0.13 ceiling.
  ctx.fillStyle = 'rgba(245,236,215,0.065)'
  for (let y = 18; y < H; y += 36) {
    for (let x = 18; x < W; x += 36) {
      ctx.beginPath()
      ctx.arc(x, y, 1.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  glow(ctx, W * 0.5, H * 0.42, 1500, 1200, [[0.44, 'rgba(10,12,11,0)'], [1, 'rgba(10,12,11,0.36)']])
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
    const cast = tokenFamily('--font-cast', "'Arial Narrow', sans-serif")
    const mono = tokenFamily('--font-mono', 'ui-monospace, monospace')
    // `fonts.ready` only waits for faces something has already asked for. The
    // wordmark's weight of Big Shoulders may never have been used on the page
    // this button sits on, so ask for all three faces the card draws in.
    //
    // Each face is asked for by its first family alone and settled separately.
    // next/font also declares a "… Fallback" face built on local() fonts, and
    // on a device without that local font the whole load() rejects — early,
    // before the real face has arrived — which drew the card in Times.
    const first = (list: string) => list.split(',')[0].trim()
    try {
      await Promise.allSettled([
        document.fonts.load(`500 ${SENTENCE_MAX}px ${first(family)}`),
        document.fonts.load(`800 ${WORDMARK}px ${first(cast)}`),
        document.fonts.load(`500 ${FURNITURE}px ${first(mono)}`),
      ])
    } catch { /* draw in whatever has arrived */ }

    const inkBase = token('--ink-base', '#1F2421')
    const inkMid = token('--ink-mid', '#3A4F38')
    const onInk = token('--on-ink', '#F5ECD7')

    canvas.width = W
    canvas.height = H

    paintStage(ctx, inkBase, inkMid)

    const margin = 110
    const maxWidth = W - margin * 2

    // How far the sentence may run before it crowds the rule over the date.
    const maxTextHeight = HAIR_Y - 40 - TEXT_TOP_MIN

    const { lines, size } = layout(ctx, point, family, maxWidth, 5, maxTextHeight)
    const lineHeight = size * LINE_HEIGHT
    // A short sentence sits where the design puts it; a long one climbs, never
    // past TEXT_TOP_MIN, so its last line always clears the rule.
    const textTop = Math.max(TEXT_TOP_MIN, Math.min(TEXT_TOP, HAIR_Y - 40 - lines.length * lineHeight))

    // The entrance's opening mark, quoted once, in sage.
    ctx.fillStyle = SAGE_LIFT
    ctx.fillRect(margin, textTop - OPENER_GAP, 132, 8)

    // layout() leaves ctx.font on whichever size it settled on, but say it
    // here anyway: a future early return in there must not silently draw the
    // sentence at the wrong size.
    ctx.font = `500 ${size}px ${family}`
    ctx.fillStyle = onInk
    ctx.textBaseline = 'top'
    // The half-leading CSS puts above the first line, so the type sits in its
    // line box the way the drawn card sets it.
    let y = textTop + ((LINE_HEIGHT - 1) / 2) * size
    for (const line of lines) {
      ctx.fillText(line, margin, y)
      y += lineHeight
    }

    // The hairline, then the date and the wordmark. Nothing here names a person.
    ctx.fillStyle = 'rgba(245,236,215,0.19)'
    ctx.fillRect(margin, HAIR_Y, maxWidth, 2)

    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = onInk
    ctx.globalAlpha = 0.72

    ctx.font = `500 ${FURNITURE}px ${mono}`
    const date = dateLabel.toUpperCase()
    // Tracked when it fits, set solid when a long locale's date would not —
    // the date is never cut.
    const dateTracking = trackedWidth(ctx, date, FURNITURE * 0.09) <= maxWidth ? FURNITURE * 0.09 : 0
    drawTracked(ctx, date, margin, DATE_BASELINE, dateTracking)

    ctx.font = `800 ${WORDMARK}px ${cast}`
    drawTracked(ctx, 'COACHVOICE', margin, WORDMARK_BASELINE, WORDMARK * 0.22)
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
