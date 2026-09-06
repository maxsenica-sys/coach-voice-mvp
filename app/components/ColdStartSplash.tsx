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
 * are full-height and change every ~170ms, so they stay at --ink-figure (7.6%
 * against the ink ground).
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
const SPLASH_LAST_KEY = 'cv_splash_at'
const COOLDOWN_MS = 3 * 60 * 1000

const DRAW_MS = 300 // the hairline
const WAVE_MS = 1250 // the stroke crossing the screen
const COLLAPSE_AT = DRAW_MS + WAVE_MS // 1550
const MARK_AT = COLLAPSE_AT + 180 // 1730 — the payoff
const WORD_AT = MARK_AT + 260 // 1990
const FLOOR_MS = 2450 // never shorter than this
const CEILING_MS = 4200 // never longer, however slow the app is
const OUT_MS = 420 // the fade off

/** Pages call this when their first real data lands. */
let readyAt = 0
const readyListeners = new Set<() => void>()
export function markAppReady() {
  if (readyAt) return
  readyAt = Date.now()
  readyListeners.forEach((fn) => fn())
  readyListeners.clear()
}

/** True at most once per genuinely cold launch. Records the decision as it goes. */
function isColdStart(): boolean {
  try {
    // ?splash=1 forces it, on any page, ignoring both gates. Without this the
    // only way to see it twice is to wait out the cooldown, which is exactly
    // what makes a working splash look like a broken one.
    if (new URLSearchParams(window.location.search).get('splash') === '1') return true
    if (sessionStorage.getItem(SPLASH_SESSION_KEY)) return false
    sessionStorage.setItem(SPLASH_SESSION_KEY, '1')
    const last = Number(localStorage.getItem(SPLASH_LAST_KEY) ?? 0)
    if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return false
    localStorage.setItem(SPLASH_LAST_KEY, String(Date.now()))
    return true
  } catch {
    // Private mode or blocked storage. An animation nobody asked for, replayed
    // on every launch because we could not remember showing it, is worse than
    // none — so fail closed.
    return false
  }
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
    if (!el || !isColdStart()) return

    let raf = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    const started = Date.now()
    let leaving = false

    const dismiss = () => {
      if (leaving) return
      leaving = true
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      el.style.pointerEvents = 'none'
      el.style.opacity = '0'
      timers.push(setTimeout(() => { el.hidden = true }, OUT_MS))
    }

    // Leave when the floor has passed AND the page has something to show —
    // or at the ceiling, whichever comes first.
    const leaveWhenReady = () => {
      const waited = Date.now() - started
      timers.push(setTimeout(dismiss, Math.max(0, FLOOR_MS - waited)))
    }
    if (readyAt) leaveWhenReady()
    else readyListeners.add(leaveWhenReady)
    timers.push(setTimeout(dismiss, CEILING_MS))

    el.hidden = false
    el.addEventListener('pointerdown', dismiss, { once: true })

    const cleanup = () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      readyListeners.delete(leaveWhenReady)
      el.removeEventListener('pointerdown', dismiss)
    }

    // No motion: the mark, held, then out. The brand moment survives; the
    // movement does not.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (mark.current) mark.current.style.opacity = '1'
      if (word.current) { word.current.style.opacity = '1'; word.current.style.transform = 'none' }
      return cleanup
    }

    const start = performance.now()
    const frame = (now: number) => {
      const t = now - start

      if (hair.current) {
        hair.current.style.transform = `scaleX(${Math.min(1, t / DRAW_MS)})`
        hair.current.style.opacity = t > COLLAPSE_AT ? String(Math.max(0, 1 - (t - COLLAPSE_AT) / 260)) : '1'
      }

      // The stroke crosses left to right; each bar rises as it is reached.
      const reach = ((t - DRAW_MS) / WAVE_MS) * PEAKS.length
      const collapse = t > COLLAPSE_AT ? Math.max(0, 1 - (t - COLLAPSE_AT) / 300) : 1

      bars.current.forEach((b, i) => {
        if (!b) return
        const on = t > DRAW_MS && i <= reach
        b.style.opacity = on ? '1' : '0'
        b.style.height = `${on ? Math.max(3, PEAKS[i] * 2.6 * collapse) : 3}px`
      })

      if (SPLASH_VARIANT === 'D') {
        // A continuous montage under the stroke: all 15 sports across the
        // 1250ms crossing, ~83ms each. That is 12 changes a second — Max's
        // original "0.1 second" cadence — and it is safe only because these
        // are --ink-figure. An earlier version tied each figure to a loud peak
        // and showed it for 39ms, which is one or two frames: technically
        // running, invisible in practice.
        const inStroke = t > DRAW_MS && t < COLLAPSE_AT
        const active = inStroke
          ? Math.min(SPORTS.length - 1, Math.floor(((t - DRAW_MS) / WAVE_MS) * SPORTS.length))
          : -1
        figs.current.forEach((f, i) => {
          if (f) f.style.opacity = i === active ? '1' : '0'
        })
      }

      const m = t > MARK_AT ? Math.min(1, (t - MARK_AT) / 420) : 0
      const w = t > WORD_AT ? Math.min(1, (t - WORD_AT) / 380) : 0
      if (mark.current) {
        mark.current.style.opacity = String(m)
        mark.current.style.transform = `translate(-50%, calc(-50% - 26px)) scale(${0.62 + m * 0.38})`
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
        transform: 'translate(-50%, calc(-50% - 26px)) scale(0.62)',
        width: 88, height: 88, borderRadius: 26, opacity: 0,
        background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
        boxShadow: '0 14px 40px rgb(111 142 107 / .45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'opacity 240ms linear, transform 520ms var(--ease-brand)',
      }}>
        <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round">
          <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
        </svg>
      </div>

      <div ref={word} style={{
        position: 'absolute', top: 'calc(50% + 44px)', left: 0, right: 0,
        textAlign: 'center', color: 'var(--on-ink)', opacity: 0,
        fontWeight: 800, fontSize: 32, letterSpacing: '-0.035em',
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
