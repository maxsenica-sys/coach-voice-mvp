'use client'

/**
 * The opening sequence on `/` — Direction A, "The Voice".
 *
 * A hairline draws across the centre, becomes a waveform taken from a real
 * coaching clip's amplitude envelope, then collapses into the mic mark that
 * the screen keeps. 2.1 seconds, no assets, no dependency.
 *
 * Directions B (15 sport silhouettes) and D (one stroke swelling into
 * silhouettes) are built and kept in `_banked/IntroSequenceAll.tsx`. Nothing
 * imports that file, so its silhouettes never reach this bundle.
 *
 * ── Two rules this component exists under ──────────────────────────────────
 *
 * **It never blocks.** `pointer-events: none`, behind a sign-in card that is
 * interactive from the first frame. There is nothing to skip because nothing
 * is in the way — tapping the email field is the skip.
 *
 * **The figure colour is a safety constraint, not a style choice.** WCAG 2.3.1
 * counts a "general flash" as a luminance swing of 10% or more. Against
 * --ink-base (#1F2421, L 0.01663), --ink-figure #445C42 sits at 7.6%, so no
 * flash occurs at any cadence. --primary-dark is 11.0% and --primary is 22.1%,
 * and either would flash. The audience is 13-18 year olds. If the waveform
 * needs to read harder, make it bigger or slower — never lighter.
 *
 * Under prefers-reduced-motion nothing animates: the component renders its
 * resolved final frame, which is also the screen's resting state.
 *
 * The animation writes styles through refs rather than React state. Rendering
 * 64 bars sixty times a second on a phone is work for nothing, and it keeps
 * the server markup identical to the first client frame.
 */

import { useEffect, useRef } from 'react'

/** Total run time, ms. */
export const INTRO_MS = 2100

const DRAW_MS = 450 // hairline
const GROW_MS = 650 // bars rise
const FADE_AT = 1100 // waveform collapses
const MARK_AT = 1200
const WORD_AT = 1500

/** Amplitude envelope of a real 8-second coaching clip, reduced to 64 peaks.
 *  Shared with ColdStartSplash so both draw the same voice. */
export const PEAKS = [
  3, 6, 4, 9, 14, 10, 18, 26, 20, 32, 24, 16, 22, 30, 38, 30,
  22, 14, 20, 28, 22, 15, 10, 17, 25, 34, 27, 19, 12, 8, 14, 21,
  29, 23, 16, 11, 7, 12, 18, 26, 20, 13, 9, 15, 22, 17, 11, 7,
  10, 14, 9, 6, 4, 7, 5, 3, 5, 8, 5, 3, 4, 6, 3, 2,
]

const MicMark = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
  </svg>
)

export default function IntroSequence({
  play = true,
  onDone,
}: {
  /** False renders the resolved final frame at once — a returning visitor, or
   *  someone sent here from a link they were already trying to open. */
  play?: boolean
  onDone?: () => void
}) {
  const hair = useRef<HTMLDivElement | null>(null)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const mark = useRef<HTMLDivElement | null>(null)
  const word = useRef<HTMLDivElement | null>(null)

  // Held in a ref so a caller passing an inline callback cannot restart the
  // sequence on every render.
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])

  useEffect(() => {
    if (!play) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const markEl = mark.current
    const wordEl = word.current
    const hairEl = hair.current

    // Rewind to the pre-animation frame with transitions suppressed. Without
    // this the mark and wordmark are rendered resolved and would visibly fade
    // *out* over 200ms before the sequence started.
    const suppress = (el: HTMLElement | null) => { if (el) el.style.transition = 'none' }
    suppress(markEl); suppress(wordEl)

    if (markEl) {
      markEl.style.opacity = '0'
      markEl.style.transform = 'translate(-50%, calc(-50% - 4px)) scale(0.7)'
    }
    if (wordEl) {
      wordEl.style.opacity = '0'
      wordEl.style.transform = 'translateY(6px)'
    }
    if (hairEl) hairEl.style.transform = 'scaleX(0)'
    bars.current.forEach((b) => { if (b) { b.style.height = '2px'; b.style.opacity = '0' } })

    // Force the rewind to land before the transitions come back.
    void document.body.offsetHeight
    if (markEl) markEl.style.transition = 'opacity 200ms linear, transform 320ms var(--ease-brand)'
    if (wordEl) wordEl.style.transition = 'opacity 220ms linear, transform 320ms var(--ease-brand)'

    let raf = 0
    const start = performance.now()

    const frame = (now: number) => {
      const t = now - start

      if (hairEl) {
        hairEl.style.transform = `scaleX(${Math.min(1, t / DRAW_MS)})`
        hairEl.style.opacity = t > FADE_AT ? String(Math.max(0, 1 - (t - FADE_AT) / 300)) : '1'
      }

      // The bars stay hidden until the hairline has finished drawing, so the
      // line reads as one stroke rather than as 64 dots waiting to grow.
      const rising = t > DRAW_MS
      let k = rising ? Math.min(1, (t - DRAW_MS) / GROW_MS) : 0
      if (t > FADE_AT) k = Math.max(0, 1 - (t - FADE_AT) / 350)

      bars.current.forEach((b, i) => {
        if (!b) return
        b.style.opacity = rising ? '1' : '0'
        b.style.height = `${Math.max(2, PEAKS[i] * 1.5 * k)}px`
      })

      const m = t > MARK_AT ? Math.min(1, (t - MARK_AT) / 400) : 0
      const w = t > WORD_AT ? Math.min(1, (t - WORD_AT) / 300) : 0
      if (markEl) {
        markEl.style.opacity = String(m)
        markEl.style.transform = `translate(-50%, calc(-50% - 4px)) scale(${0.7 + m * 0.3})`
      }
      if (wordEl) {
        wordEl.style.opacity = String(w)
        wordEl.style.transform = `translateY(${(1 - w) * 6}px)`
      }

      if (t < INTRO_MS) raf = requestAnimationFrame(frame)
      else done.current?.()
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [play])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0,
        pointerEvents: 'none', // never in the way of the form
      }}
    >
      {/* The line, and the waveform that grows out of it */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 'min(78vw, 300px)', height: 92,
        transform: 'translate(-50%, -50%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2,
      }}>
        <div ref={hair} style={{
          position: 'absolute', left: 0, right: 0, top: '50%', height: 1,
          background: 'var(--ink-figure)', transformOrigin: 'left', opacity: 0,
        }} />
        {PEAKS.map((_, i) => (
          <span
            key={i}
            ref={(el) => { bars.current[i] = el }}
            style={{
              flex: 1, height: 2, minHeight: 2, borderRadius: 99, opacity: 0,
              background: 'var(--ink-figure)',
              transition: 'height 110ms cubic-bezier(.22,1,.36,1)',
            }}
          />
        ))}
      </div>

      {/* What the sequence resolves into — and the screen's resting state */}
      <div ref={mark} style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, calc(-50% - 4px)) scale(1)',
        width: 34, height: 34, borderRadius: 10,
        background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
        boxShadow: '0 4px 12px rgb(111 142 107 / .40)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'opacity 200ms linear, transform 320ms var(--ease-brand)',
      }}>
        <MicMark />
      </div>

      <div ref={word} style={{
        position: 'absolute', top: 'calc(50% + 30px)', left: 0, right: 0,
        textAlign: 'center', color: 'var(--on-ink)',
        fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em',
        transition: 'opacity 220ms linear, transform 320ms var(--ease-brand)',
      }}>
        CoachVoice
      </div>
    </div>
  )
}
