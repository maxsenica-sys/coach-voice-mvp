'use client'

/**
 * The cold-start splash.
 *
 * Two sequences, one switch (`SPLASH_VARIANT`):
 *
 *   'D'  the stroke draws across the screen and swells into sport silhouettes
 *        as it passes its loudest moments, then everything collapses into the
 *        mark. Sound and sport are the same line.
 *   'A'  the same stroke without the silhouettes — quieter, zero assets.
 *
 * ── It holds until the app is ready ────────────────────────────────────────
 *
 * The first version ran for a fixed 1.0s and then vanished while the dashboard
 * was still fetching, so it read as a flicker followed by a loading screen —
 * both "too quick" and "slow to load" at once. It now stays up until the page
 * underneath says it has something to show, with a floor so it is never a
 * flash and a ceiling so it can never hang. Slow loading now happens behind a
 * deliberate brand moment instead of behind a blank screen.
 *
 * ── Flash safety, scoped correctly this time ───────────────────────────────
 *
 * WCAG 2.3.1 permits three flashes per second; a flash is a luminance swing of
 * 10% or more over a large area. That ceiling binds the *silhouettes*, which
 * are full-height and change as fast as every 105ms, so they stay at
 * --ink-figure (7.6% against the ink ground).
 *
 * It does not bind the waveform. Each bar rises once, and the whole stroke is
 * thin slivers rather than a large field, so brightness there costs nothing —
 * an earlier version dimmed it under a rule that was never about it, which is
 * why it was hard to see. The bars are --primary now, and the mark is the
 * brightest thing on screen, which is the point of the whole sequence.
 */

import { useEffect, useRef } from 'react'
import { PEAKS } from '@/app/components/IntroSequence'
import { SPORTS } from '@/app/components/sportSilhouettes'

/** 'D' silhouettes + stroke · 'A' stroke alone. One word to switch. */
const SPLASH_VARIANT: 'A' | 'D' = 'D'

/** Set for the life of the webview. Cleared only when the app is really closed. */
export const SPLASH_SESSION_KEY = 'cv_splash_session'
// The rest of the cold-start decision — the `cv_splash_at` cooldown floor and
// how long it is — lives as literals in the inline script in app/layout.tsx,
// because that script runs before the document paints and cannot import.
// Copies used to sit here too (`SPLASH_LAST_KEY`, `COOLDOWN_MS`) and drifted
// out of agreement with the real ones while nothing read them: lint does not
// flag an unused module-level const, so they looked authoritative for as long
// as nobody checked. Do not reintroduce them. One source of truth, in
// layout.tsx.

const DRAW_MS = 240 // the hairline

/**
 * How long each sport holds, in order. Geometric decay from 220ms to 70ms —
 * the Marvel title card: the first few turn over slowly enough to read, and by
 * the end it is a thumb riffling a book. The stroke's crossing is tied to the
 * same schedule, so the waveform accelerates with the figures rather than
 * running at its own tempo.
 *
 * The tail must not bottom out too low: at 40ms, two frames, the last third
 * was a smear rather than a run of sports. 70ms is four frames — still a
 * riffle, and you can still tell what went past. That is the floor; if the
 * montage needs to be shorter again, drop sports rather than this number.
 */
const FIG_MS: number[] = (() => {
  const n = SPORTS.length, first = 220, last = 70
  const r = Math.pow(last / first, 1 / (n - 1))
  return Array.from({ length: n }, (_, i) => Math.round(first * Math.pow(r, i)))
})()
const MONTAGE_MS = FIG_MS.reduce((a, b) => a + b, 0) // ~1850 across 14 sports
/** Cumulative start time of each sport, for looking up which one is showing. */
const FIG_AT: number[] = FIG_MS.reduce<number[]>((acc, d, i) => {
  acc.push(i === 0 ? DRAW_MS : acc[i - 1] + FIG_MS[i - 1])
  return acc
}, [])

const COLLAPSE_AT = DRAW_MS + MONTAGE_MS // ~2090
const MARK_AT = COLLAPSE_AT + 100 // the logo rises
const WORD_AT = MARK_AT + 300
/**
 * The floor is now a guard against a *flash*, not a scheduled wait.
 *
 * It used to be MARK_AT + 750 — about 2.9s — and it was honoured even when the
 * app had been ready for two seconds, which made the splash a toll rather than
 * a cover: the faster the app loaded, the more of the user's time it took. The
 * sequence's full length is still available to a slow launch, because a slow
 * launch simply never reaches leaveWhenReady early. See leaveWhenReady.
 */
const FLOOR_MS = 900
/** From the collapse: 100ms into the mark, 420ms for it to rise, a beat to land. */
const MARK_LAND_MS = 720
const CEILING_MS = 5600 // never longer, however slow the app is
const OUT_MS = 460 // the fade off

/** Pages call this when their first real data lands. */
let readyAt = 0
const readyListeners = new Set<() => void>()
export function markAppReady() {
  if (readyAt) return
  readyAt = Date.now()
  readyListeners.forEach((fn) => fn())
  readyListeners.clear()
}

/** Did the boot shell arm this launch?
 *
 *  The decision itself is made by the inline script in app/layout.tsx, before
 *  the document paints. It has to be: the shell is on screen long before this
 *  component exists, and two independent answers to "is this a cold start" —
 *  one of them a second and a half later — would disagree exactly when it
 *  matters. This reads the answer rather than recomputing it, and the storage
 *  keys are consumed in one place. */
function bootArmed(): boolean {
  return document.documentElement.getAttribute('data-boot') === '1'
}

/** When the document started painting the shell, so the animation can join a
 *  timeline already in progress rather than restarting one. */
function bootAt(): number {
  const t = (window as unknown as { __cvBootAt?: number }).__cvBootAt
  return typeof t === 'number' ? t : Date.now()
}

export default function ColdStartSplash() {
  const root = useRef<HTMLDivElement | null>(null)
  const hair = useRef<HTMLDivElement | null>(null)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const figs = useRef<(HTMLDivElement | null)[]>([])
  const mark = useRef<HTMLDivElement | null>(null)
  const word = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = root.current
    if (!el || !bootArmed()) return

    let raf = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    // Everything below is timed from when the shell went up, not from when
    // this effect ran. Hydration on a phone can take well over a second, and
    // anchoring here would have added that to the splash instead of spending
    // it — the animation would start, in full, after the wait it exists to
    // cover. Anchored to the document, a slow launch simply arrives further
    // into the sequence, and a very slow one arrives at the resting frame.
    const started = bootAt()
    let leaving = false
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // The frame loop measures `t` from here. It is a `let` rather than a
    // `const` because leaveWhenReady pulls it forward — see below.
    let start = performance.now() - (Date.now() - started)

    const dismiss = () => {
      if (leaving) return
      leaving = true
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      el.style.pointerEvents = 'none'
      el.style.opacity = '0'
      timers.push(setTimeout(() => {
        el.hidden = true
        const d = document.documentElement
        d.removeAttribute('data-boot')
        d.removeAttribute('data-boot-anim')
      }, OUT_MS))
    }

    // Leave once the page has something to show — but never so fast that the
    // splash is a flash, and never so slow that it outlives the wait it exists
    // to cover.
    //
    // The old version scheduled dismissal at a fixed ~2.9s floor and then sat
    // there even if the app had signalled ready at 700ms. That is the failure
    // this fixes: a splash is a cover for a wait, and the moment it outlives
    // the wait it stops being craft and becomes a toll.
    //
    // So when the app is ready before the sequence has reached its collapse,
    // the *timeline* jumps forward rather than the clock waiting for it. The
    // stroke gathers, the mark rises, the word lands — the brand moment plays
    // in full, just now instead of in two seconds. Jumping to COLLAPSE_AT
    // rather than straight to MARK_AT costs 100ms and buys the gesture that
    // earns the mark; cutting to the mark makes it pop in from nothing.
    const leaveWhenReady = () => {
      const waited = Date.now() - started
      let delay: number
      if (reduced) {
        // No timeline to skew — the resting frame is all there is.
        delay = 0
      } else if (waited < COLLAPSE_AT) {
        start = performance.now() - COLLAPSE_AT
        delay = MARK_LAND_MS
      } else {
        delay = COLLAPSE_AT + MARK_LAND_MS - waited
      }
      timers.push(setTimeout(dismiss, Math.max(0, delay, FLOOR_MS - waited)))
    }
    if (readyAt) leaveWhenReady()
    else readyListeners.add(leaveWhenReady)
    timers.push(setTimeout(dismiss, CEILING_MS))

    el.hidden = false
    // Hide the static shell only once this one is rendered and in the same
    // place, so the handover is a repaint of identical pixels rather than a
    // gap. Both are the resting frame; only this one can move.
    document.documentElement.setAttribute('data-boot-anim', '1')
    el.addEventListener('pointerdown', dismiss, { once: true })

    const cleanup = () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      readyListeners.delete(leaveWhenReady)
      el.removeEventListener('pointerdown', dismiss)
    }

    // No motion: the mark, held, then out. The brand moment survives; the
    // movement does not. Note that this branch used to sit *after* the floor
    // timer was scheduled at ~2.9s, so the person who had asked their OS for
    // less motion got the longest wait of anyone — a frozen ink screen for
    // three seconds. With the floor at 900ms and leaveWhenReady's `reduced`
    // path leaving as soon as the app is ready, they now get the shortest.
    if (reduced) {
      if (mark.current) mark.current.style.opacity = '1'
      if (word.current) { word.current.style.opacity = '1'; word.current.style.transform = 'none' }
      return cleanup
    }

    const frame = (now: number) => {
      const t = now - start

      if (hair.current) {
        hair.current.style.transform = `scaleX(${Math.min(1, t / DRAW_MS)})`
        hair.current.style.opacity = t > COLLAPSE_AT ? String(Math.max(0, 1 - (t - COLLAPSE_AT) / 260)) : '1'
      }

      // The stroke crosses left to right, on the montage's clock so the two
      // accelerate together.
      const reach = ((t - DRAW_MS) / MONTAGE_MS) * PEAKS.length
      const collapse = t > COLLAPSE_AT ? Math.max(0, 1 - (t - COLLAPSE_AT) / 300) : 1

      bars.current.forEach((b, i) => {
        if (!b) return
        const on = t > DRAW_MS && i <= reach
        b.style.opacity = on ? '1' : '0'
        b.style.height = `${on ? Math.max(3, PEAKS[i] * 2.6 * collapse) : 3}px`
      })

      if (SPLASH_VARIANT === 'D') {
        // A continuous montage under the stroke: all 14 sports across the
        // 1250ms crossing, ~83ms each. That is 12 changes a second — Max's
        // original "0.1 second" cadence — and it is safe only because these
        // are --ink-figure. An earlier version tied each figure to a loud peak
        // and showed it for 39ms, which is one or two frames: technically
        // running, invisible in practice.
        // Which sport is up, from the accelerating schedule rather than an
        // even division — that ramp is the whole effect.
        let active = -1
        if (t > DRAW_MS && t < COLLAPSE_AT) {
          for (let i = FIG_AT.length - 1; i >= 0; i--) {
            if (t >= FIG_AT[i]) { active = i; break }
          }
        }
        figs.current.forEach((f, i) => {
          if (f) f.style.opacity = i === active ? '1' : '0'
        })
      }

      const m = t > MARK_AT ? Math.min(1, (t - MARK_AT) / 420) : 0
      const w = t > WORD_AT ? Math.min(1, (t - WORD_AT) / 380) : 0
      if (mark.current) {
        // Rises as it grows, rather than just fading up in place.
        const rise = (1 - m) * 46
        mark.current.style.opacity = String(m)
        mark.current.style.transform =
          `translate(-50%, calc(-50% - 34px + ${rise}px)) scale(${0.55 + m * 0.45})`
      }
      if (word.current) {
        word.current.style.opacity = String(w)
        word.current.style.transform = `translateY(${(1 - w) * 14}px)`
      }

      if (t < WORD_AT + 500) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return cleanup
  }, [])

  // Rendered hidden on both server and client, then revealed by the effect if
  // this turns out to be a cold start. Deciding during render would make the
  // two disagree, because the answer depends on storage the server cannot see.
  return (
    <div
      ref={root}
      hidden
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'var(--grad-ink)',
        opacity: 1, transition: `opacity ${OUT_MS}ms ease-out`,
      }}
    >
      {/* Silhouettes, behind the stroke */}
      {SPLASH_VARIANT === 'D' && SPORTS.map((sport, i) => (
        <div
          key={sport.name}
          ref={(el) => { figs.current[i] = el }}
          style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 'min(62vw, 260px)', height: 'min(84vw, 350px)',
            transform: 'translate(-50%, -54%)',
            opacity: 0, transition: 'opacity 40ms linear',
            color: 'var(--ink-figure)',
          }}
        >
          <svg viewBox="0 0 120 170" width="100%" height="100%" fill="currentColor">{sport.d}</svg>
        </div>
      ))}

      {/* The stroke */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 'min(86vw, 440px)', height: 170,
        transform: 'translate(-50%, -50%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2,
      }}>
        <div ref={hair} style={{
          position: 'absolute', left: 0, right: 0, top: '50%', height: 2,
          background: 'var(--primary)', transformOrigin: 'left',
          transform: 'scaleX(0)', opacity: 0, borderRadius: 99,
        }} />
        {PEAKS.map((_, i) => (
          <span
            key={i}
            ref={(el) => { bars.current[i] = el }}
            style={{
              flex: 1, height: 3, minHeight: 3, borderRadius: 99, opacity: 0,
              background: 'var(--primary)',
              transition: 'height 120ms cubic-bezier(.22,1,.36,1)',
            }}
          />
        ))}
      </div>

      {/* The mark — the thing the whole sequence exists to arrive at */}
      <div ref={mark} style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, calc(-50% - 34px + 46px)) scale(0.55)',
        width: 118, height: 118, borderRadius: 34, opacity: 0,
        background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
        boxShadow: '0 20px 56px rgb(111 142 107 / .48)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'opacity 260ms linear, transform 620ms var(--ease-brand)',
      }}>
        <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round">
          <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
        </svg>
      </div>

      <div ref={word} style={{
        position: 'absolute', top: 'calc(50% + 62px)', left: 0, right: 0,
        textAlign: 'center', color: 'var(--on-ink)', opacity: 0,
        fontWeight: 800, fontSize: 38, letterSpacing: '-0.04em',
        transform: 'translateY(14px)',
        transition: 'opacity 300ms linear, transform 520ms var(--ease-brand)',
      }}>
        CoachVoice
      </div>

      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom) + 34px)',
        textAlign: 'center', color: 'var(--on-ink-2)',
        fontSize: 13, fontStyle: 'italic', fontFamily: 'var(--font-display)',
      }}>
        Your private training journal
      </div>
    </div>
  )
}
