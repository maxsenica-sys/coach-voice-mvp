'use client'

/**
 * BANKED — NOT DEPLOYED. Nothing imports this file, so none of it (including
 * the 15 silhouettes, which are the bulk of it) reaches the `/` bundle.
 *
 * Kept because Directions B and D were built and judged worth keeping, not
 * worth shipping. To bring one back: import this in `app/page.tsx` in place of
 * `IntroSequence` and pass `variant="B"` or `variant="D"`. It is a drop-in —
 * the live component is this file with A alone.
 *
 * Before shipping either, two things are outstanding:
 *   · the silhouettes are hand-authored placeholders and want an illustrator
 *   · D's caption is a placeholder; it needs one real consented recording
 *
 * ── The original header follows ────────────────────────────────────────────
 *
 * The opening sequence on `/`.
 *
 * Three variants are built. `A` is live; `B` and `D` are kept ready so the
 * direction can be swapped by changing one prop, with no other edits.
 *
 *   A · The Voice      2.10s  a hairline becomes a waveform becomes the mark
 *   B · The Roll Call  3.20s  15 sport silhouettes, then the mark
 *   D · The Line       2.25s  one stroke drawing left to right, swelling into
 *                             13 silhouettes at its peaks, then the mark
 *
 * ── Why the figures are this dark, and why that is not negotiable ──────────
 *
 * WCAG 2.3.1 counts a "general flash" as opposing changes in relative
 * luminance of 10% or more, over more than a small area. Against --ink-base
 * (#1F2421, L 0.01663):
 *
 *     --ink-figure  #445C42   L 0.09277    7.6%   under the threshold
 *     --primary-dark #4F6B4B  L 0.12686   11.0%   would flash
 *     --primary     #6F8E6B   L 0.23787   22.1%   would flash badly
 *     --bg          #FBF8F3   L 0.94115   92.5%   hazard
 *
 * Because 7.6% never reaches the threshold, **no flash occurs at any
 * frequency** — which is the only reason B can run at 133ms per figure and D
 * at 173ms without a seizure risk. The audience is 13-18 year olds. Do not
 * brighten the figures to make them more visible; that trade is not available.
 * If they need to read harder, make them bigger or slower, not lighter.
 *
 * The sole bright element is the 34px mic tile, which is 5.6% of the permitted
 * flash area (~143x143 CSS px at phone geometry) and appears once, then stays.
 *
 * The sequence never blocks: it is pointer-events: none and sits behind a
 * sign-in card that is interactive from the first frame. There is nothing to
 * skip because nothing is in the way — tapping the email field is the skip.
 *
 * Under prefers-reduced-motion the whole thing collapses to its final frame in
 * one 200ms opacity fade. Opacity only: vestibular triggers are motion of
 * position and scale, not alpha, so the brand moment survives and the movement
 * does not.
 *
 * The animation is driven by writing styles through refs rather than by React
 * state. Re-rendering 64 bars and an SVG sixty times a second on a phone is
 * work for nothing, and it also means the markup is identical on the server and
 * on the first client frame: the component renders its resolved final frame,
 * and the sequence rewinds it before paint.
 */

import { useEffect, useRef } from 'react'

export type IntroVariant = 'A' | 'B' | 'D'

/** Total run time per variant, ms. `page.tsx` reads these; keep them truthful. */
export const INTRO_MS: Record<IntroVariant, number> = { A: 2100, B: 3200, D: 2250 }

/* ── Silhouettes ────────────────────────────────────────────────────────────
 * Hand-authored placeholders. They are recognisable at 150px and consistent in
 * weight, but they are not illustration — if a direction using them ships,
 * these should be redrawn properly. Ordered so consecutive figures differ in
 * overall shape, which is what makes a fast montage read as variety rather
 * than as flicker.
 */
const SPORTS: { name: string; d: React.ReactNode }[] = [
  { name: 'Volleyball', d: (<>
    <circle cx="64" cy="34" r="9.5" />
    <path d="M55 44c-4 9-5 21-2 34l16 2c4-14 4-26 2-36z" />
    <path d="M68 46c8-8 16-22 20-34l9 5c-5 15-13 31-23 40z" />
    <path d="M55 49c-10 2-20 0-28-6l-2 9c9 8 21 10 30 8z" />
    <path d="M55 78c-4 13-10 23-16 31l9 7c11-9 17-22 19-35z" />
    <path d="M67 80c4 12 8 24 6 36h11c4-15 0-29-6-39z" />
    <circle cx="99" cy="8" r="7" />
  </>) },
  { name: 'Sprinting', d: (<>
    <circle cx="66" cy="26" r="9.5" />
    <path d="M57 36c-4 10-4 22 0 33l16-3c3-12 2-22-1-31z" />
    <path d="M72 42c9-3 17-9 22-17l7 7c-6 11-16 18-27 21z" />
    <path d="M58 44c-9 4-15 12-18 21l9 5c3-7 8-13 14-16z" />
    <path d="M58 68c-3 12-12 20-22 26l7 9c14-7 24-18 28-31z" />
    <path d="M70 68c6 9 8 20 5 31l11 3c4-15 1-29-7-39z" />
    <path d="M36 94c-5 5-11 8-18 9l2 9c11-1 20-6 26-13z" />
  </>) },
  { name: 'Swimming', d: (<>
    <circle cx="52" cy="76" r="9.5" />
    <path d="M60 68c14-2 30-1 44 3l-2 15c-14 3-29 3-43 1z" />
    <path d="M60 70c8-11 18-20 30-26l6 8c-10 6-18 14-24 23z" />
    <path d="M104 74c6-2 12-2 18 0l-1 12c-6 1-12 1-18-1z" />
    <path d="M46 82c-9 2-17 7-23 14l8 7c5-5 11-9 18-11z" />
    <path d="M8 100c-4 3-6 7-7 12l11 2c1-3 3-6 6-8z" />
  </>) },
  { name: 'Boxing', d: (<>
    <circle cx="60" cy="32" r="10" />
    <path d="M50 44c-4 10-5 24-2 37l22 1c4-14 4-28 1-38z" />
    <path d="M68 50c8 1 15 6 19 13l-9 7c-3-4-7-7-12-8z" />
    <path d="M52 52c-8 2-13 8-15 16l10 4c1-4 4-7 8-9z" />
    <path d="M48 82c-3 14-4 27-2 39h12c1-13 2-26 4-38z" />
    <path d="M66 82c4 13 8 25 12 36l11-4c-4-13-8-25-13-35z" />
    <circle cx="83" cy="66" r="8" /><circle cx="42" cy="70" r="8" />
  </>) },
  { name: 'Gymnastics', d: (<>
    <circle cx="60" cy="24" r="9" />
    <path d="M53 34c-3 10-3 22 0 32h16c3-11 3-22 0-32z" />
    <path d="M55 40c-13-3-25-9-35-17l-5 9c11 10 25 17 40 20z" />
    <path d="M66 40c13-3 25-9 35-17l5 9c-11 10-25 17-40 20z" />
    <path d="M55 66c-2 16-2 32 0 48h11c1-16 2-32 3-48z" />
    <path d="M67 66c9 10 20 16 32 19l3-11c-9-3-17-8-24-15z" />
  </>) },
  { name: 'Football', d: (<>
    <circle cx="56" cy="28" r="9.5" />
    <path d="M47 38c-3 11-3 23 0 35l18-1c3-12 3-24 1-34z" />
    <path d="M64 44c8 3 14 9 18 17l-9 6c-3-6-8-10-13-12z" />
    <path d="M48 46c-8 3-14 9-18 17l9 5c3-6 8-10 13-12z" />
    <path d="M47 72c-2 14-2 27 1 39l11-1c0-13 1-26 3-38z" />
    <path d="M63 72c8 9 17 15 27 19l4-11c-8-3-15-8-21-14z" />
    <circle cx="99" cy="98" r="10" />
  </>) },
  { name: 'Basketball', d: (<>
    <circle cx="58" cy="36" r="9.5" />
    <path d="M49 46c-4 10-4 23-1 35l19-1c4-13 3-25 1-35z" />
    <path d="M66 48c6-9 13-17 22-23l7 8c-8 6-15 14-20 23z" />
    <path d="M50 52c-9 1-16 6-21 14l9 6c3-5 8-8 14-9z" />
    <path d="M49 80c-4 13-10 23-17 31l9 7c11-9 18-21 21-34z" />
    <path d="M64 80c3 13 4 26 2 38h11c3-14 3-28-1-40z" />
    <circle cx="97" cy="18" r="10" />
  </>) },
  { name: 'Tennis', d: (<>
    <circle cx="58" cy="34" r="9.5" />
    <path d="M49 44c-4 10-4 23-1 35l19-1c4-13 3-25 1-35z" />
    <path d="M66 46c5-10 12-19 21-25l7 8c-8 6-14 14-18 24z" />
    <path d="M50 50c-9 3-15 9-18 18l10 4c2-5 6-9 11-11z" />
    <path d="M49 80c-3 13-5 26-4 38h11c1-13 3-25 5-37z" />
    <path d="M64 80c5 12 11 23 18 32l9-7c-7-8-12-18-15-28z" />
    <ellipse cx="98" cy="14" rx="9" ry="12" transform="rotate(24 98 14)" />
  </>) },
  { name: 'Rugby', d: (<>
    <circle cx="60" cy="30" r="9.5" />
    <path d="M51 40c-4 11-4 24-1 36l19-1c4-13 3-25 1-35z" />
    <path d="M68 52c7 1 13 4 18 9l-7 9c-4-3-8-5-13-6z" />
    <path d="M52 54c-8 4-13 11-15 20l10 3c2-6 6-10 11-13z" />
    <path d="M51 76c-4 14-11 25-19 33l9 7c12-10 20-23 24-38z" />
    <path d="M67 76c4 13 6 26 4 38h11c3-15 1-29-5-41z" />
    <ellipse cx="76" cy="62" rx="11" ry="7" transform="rotate(-18 76 62)" />
  </>) },
  { name: 'Cycling', d: (<>
    <circle cx="46" cy="40" r="9" />
    <path d="M54 44c14 2 27 8 38 17l-8 11c-10-8-21-13-33-15z" />
    <path d="M88 60c6 2 11 5 15 10l-9 8c-3-3-7-6-11-7z" />
    <path d="M56 62c-2 12-2 24 2 35l12-3c-3-9-3-19-2-28z" />
    <path d="M68 92c7 6 12 13 15 21l-11 5c-2-6-6-11-11-15z" />
    <circle cx="30" cy="122" r="22" fill="none" strokeWidth="6" stroke="currentColor" />
    <circle cx="96" cy="122" r="22" fill="none" strokeWidth="6" stroke="currentColor" />
  </>) },
  { name: 'Rowing', d: (<>
    <circle cx="54" cy="44" r="9.5" />
    <path d="M45 54c-3 10-3 21 0 31h19c3-11 3-22 1-31z" />
    <path d="M62 60c11 1 21 5 30 12l-7 10c-8-6-16-9-25-10z" />
    <path d="M46 62c-9 2-16 7-20 15l10 5c3-5 7-9 13-11z" />
    <path d="M45 86c1 12 5 22 12 30l10-7c-5-7-8-15-9-24z" />
    <path d="M62 86c8 9 18 15 29 18l3-11c-8-3-15-7-21-13z" />
    <path d="M18 40l92 62-5 8-92-62z" />
  </>) },
  { name: 'Skiing', d: (<>
    <circle cx="58" cy="38" r="9.5" />
    <path d="M49 48c-4 10-5 22-2 33l20-1c4-12 3-23 1-33z" />
    <path d="M67 56c9-3 18-3 27 0l-3 12c-8-2-16-2-23 0z" />
    <path d="M50 58c-9 0-17 3-24 9l8 9c5-4 11-6 17-6z" />
    <path d="M48 82c-1 13 1 24 6 34l11-5c-3-8-5-17-5-27z" />
    <path d="M65 82c6 11 14 20 24 27l7-10c-8-5-14-12-19-20z" />
    <path d="M24 130h84v8H24z" transform="rotate(-8 66 134)" />
  </>) },
  { name: 'Golf', d: (<>
    <circle cx="58" cy="30" r="9.5" />
    <path d="M49 40c-4 10-4 23-1 35l19-1c4-13 3-25 1-35z" />
    <path d="M65 44c9-4 19-5 29-3l-2 12c-8-1-16 0-24 3z" />
    <path d="M53 46c-9 0-16 4-21 12l10 6c3-5 7-8 12-9z" />
    <path d="M49 76c-3 14-4 27-2 39h11c0-13 2-26 5-38z" />
    <path d="M65 76c5 12 7 25 6 38h11c1-15-2-29-8-41z" />
    <path d="M92 42l24-24 6 6-24 24z" />
  </>) },
  { name: 'Cricket', d: (<>
    <circle cx="60" cy="32" r="9.5" />
    <path d="M51 42c-4 10-5 23-2 35l20-1c4-13 3-25 1-35z" />
    <path d="M68 48c8-2 15-7 21-14l8 8c-8 9-17 15-28 18z" />
    <path d="M52 50c-9 1-15 6-19 14l10 5c2-5 6-8 11-10z" />
    <path d="M50 78c-2 14-2 27 1 39h11c0-13 2-26 4-38z" />
    <path d="M66 78c5 12 8 25 8 38h11c0-15-3-29-9-41z" />
    <path d="M96 20l8 4-22 44-8-4z" />
  </>) },
  { name: 'Martial arts', d: (<>
    <circle cx="46" cy="40" r="9.5" />
    <path d="M37 50c-3 11-3 24 0 36l19-1c3-13 3-25 1-35z" />
    <path d="M54 56c9-1 17 2 24 8l-8 9c-4-3-9-5-15-5z" />
    <path d="M38 58c-8 3-13 9-15 18l10 3c2-5 5-9 10-11z" />
    <path d="M37 86c0 13 3 24 9 34l11-6c-4-8-6-17-6-26z" />
    <path d="M54 84c14 0 27-5 38-14l7 10c-13 12-30 18-47 18z" />
  </>) },
]

/** Amplitude envelope of a real 8-second coaching clip, reduced to 64 peaks. */
const PEAKS = [
  3, 6, 4, 9, 14, 10, 18, 26, 20, 32, 24, 16, 22, 30, 38, 30,
  22, 14, 20, 28, 22, 15, 10, 17, 25, 34, 27, 19, 12, 8, 14, 21,
  29, 23, 16, 11, 7, 12, 18, 26, 20, 13, 9, 15, 22, 17, 11, 7,
  10, 14, 9, 6, 4, 7, 5, 3, 5, 8, 5, 3, 4, 6, 3, 2,
]

/** The 13 loudest peaks, for D's silhouette swells. */
const SWELL_AT = [7, 9, 14, 17, 25, 32, 39, 44, 49, 53, 57, 60, 62]

const MicMark = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
  </svg>
)

export default function IntroSequence({
  variant = 'A',
  play = true,
  onDone,
}: {
  variant?: IntroVariant
  /** False renders the resolved final frame at once — a returning visitor, or
   *  someone sent here from a link they were already trying to open. */
  play?: boolean
  onDone?: () => void
}) {
  const hair = useRef<HTMLDivElement | null>(null)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const figs = useRef<(HTMLDivElement | null)[]>([])
  const mark = useRef<HTMLDivElement | null>(null)
  const word = useRef<HTMLDivElement | null>(null)
  // Held in a ref so a caller passing an inline callback cannot restart the
  // sequence on every render.
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])

  useEffect(() => {
    if (!play) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const total = INTRO_MS[variant]
    const showWave = variant === 'A' || variant === 'D'
    const showFig = variant === 'B' || variant === 'D'
    const beat = 2000 / SPORTS.length // B: 133ms per figure

    // Rewind to the pre-animation frame. Synchronous, before the next paint,
    // so the resolved frame that was rendered never actually shows.
    if (mark.current) { mark.current.style.opacity = '0'; mark.current.style.transform = 'translate(-50%, calc(-50% - 4px)) scale(0.7)' }
    if (word.current) { word.current.style.opacity = '0'; word.current.style.transform = 'translateY(6px)' }
    if (hair.current) hair.current.style.transform = 'scaleX(0)'
    bars.current.forEach((b) => { if (b) { b.style.height = '2px'; b.style.opacity = showWave ? '1' : '0' } })
    figs.current.forEach((f) => { if (f) f.style.opacity = '0' })

    let raf = 0
    const start = performance.now()

    const frame = (now: number) => {
      const t = now - start

      if (showWave) {
        const drawMs = variant === 'A' ? 450 : 250
        const growFrom = variant === 'A' ? 450 : 250
        const growMs = variant === 'A' ? 650 : 1700
        const fadeAt = variant === 'A' ? 1100 : 1950

        if (hair.current) {
          hair.current.style.transform = `scaleX(${Math.min(1, t / drawMs)})`
          hair.current.style.opacity = t > fadeAt ? String(Math.max(0, 1 - (t - fadeAt) / 300)) : '1'
        }

        // A grows every bar together; D draws left to right in real time.
        const reach = variant === 'A' ? PEAKS.length : ((t - growFrom) / growMs) * PEAKS.length
        let k = t > fadeAt ? Math.max(0, 1 - (t - fadeAt) / 350) : 1
        if (variant === 'A') k *= Math.min(1, Math.max(0, (t - growFrom) / growMs))

        bars.current.forEach((b, i) => {
          if (!b) return
          const on = i <= reach
          b.style.opacity = on ? '1' : '0'
          b.style.height = `${on ? Math.max(2, PEAKS[i] * 1.5 * k) : 2}px`
        })
      }

      if (showFig) {
        let active = -1
        if (variant === 'B') {
          if (t > 200 && t < 2200) active = Math.min(SPORTS.length - 1, Math.floor((t - 200) / beat))
        } else {
          // One silhouette blooms as the stroke passes each of its 13 peaks.
          const bar = Math.floor(((t - 250) / 1700) * PEAKS.length)
          const hit = SWELL_AT.findIndex((sw) => bar >= sw && bar < sw + 2)
          if (hit !== -1 && t < 1950) active = hit % SPORTS.length
        }
        figs.current.forEach((f, i) => {
          if (f) f.style.opacity = i === active ? (variant === 'D' ? '0.9' : '1') : '0'
        })
      }

      const markAt = variant === 'A' ? 1200 : variant === 'B' ? 2200 : 1950
      const wordAt = variant === 'A' ? 1500 : variant === 'B' ? 2600 : 2050
      const m = t > markAt ? Math.min(1, (t - markAt) / 400) : 0
      const w = t > wordAt ? Math.min(1, (t - wordAt) / 300) : 0
      if (mark.current) {
        mark.current.style.opacity = String(m)
        mark.current.style.transform = `translate(-50%, calc(-50% - 4px)) scale(${0.7 + m * 0.3})`
      }
      if (word.current) {
        word.current.style.opacity = String(w)
        word.current.style.transform = `translateY(${(1 - w) * 6}px)`
      }

      if (t < total) raf = requestAnimationFrame(frame)
      else done.current?.()
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [variant, play])

  const showWave = variant === 'A' || variant === 'D'
  const showFig = variant === 'B' || variant === 'D'

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0,
        pointerEvents: 'none', // never in the way of the form
      }}
    >
      {/* Silhouettes. All are mounted and toggled by opacity — swapping SVG
          markup 15 times in two seconds would thrash the DOM. */}
      {showFig && SPORTS.map((sport, i) => (
        <div
          key={sport.name}
          ref={(el) => { figs.current[i] = el }}
          style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 190, height: 250, transform: 'translate(-50%, -56%)',
            opacity: 0, transition: 'opacity 80ms linear',
            color: 'var(--ink-figure)',
          }}
        >
          <svg viewBox="0 0 120 170" width="100%" height="100%" fill="currentColor">{sport.d}</svg>
        </div>
      ))}

      {/* The line, and the waveform that grows out of it */}
      {showWave && (
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
      )}

      {/* What the whole thing resolves into — and the screen's resting state */}
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
