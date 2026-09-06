'use client'

/**
 * The cold-start splash, for people who are already signed in.
 *
 * Direction A compressed to 1.24 seconds and put over the app while it loads.
 * It is not a gate: the page underneath is fetching and rendering the whole
 * time, and any touch dismisses it at once.
 *
 * ── "Cold start" means what it means on a normal app ───────────────────────
 *
 * Not every mount, not every navigation, and not every time you switch back
 * from another app. The rule is two conditions, and both have to pass:
 *
 *   sessionStorage — empty only when the webview is genuinely new. It survives
 *     backgrounding, resuming, in-app navigation and even a refresh, so
 *     alternating between apps never replays this. It dies when the app is
 *     actually closed, which is the definition we want.
 *
 *   a 30-minute floor in localStorage — because iOS discards a backgrounded
 *     PWA's webview aggressively, and without this a coach flicking between
 *     CoachVoice and their timer app could get a "cold start" every few
 *     minutes. Genuinely cold, but not something anyone wants to watch again.
 *
 * If storage throws (private mode, blocked cookies) the splash does not show.
 * Failing closed is right here: an animation nobody asked for, replayed on
 * every single launch because we could not remember showing it, is worse than
 * no animation at all.
 *
 * Signing in sets the session flag too, so the sign-in intro and this never
 * run back to back.
 */

import { useEffect, useRef } from 'react'
import { PEAKS } from '@/app/components/IntroSequence'

/** Set for the life of the webview. Cleared only when the app is really closed. */
export const SPLASH_SESSION_KEY = 'cv_splash_session'
const SPLASH_LAST_KEY = 'cv_splash_at'
const COOLDOWN_MS = 30 * 60 * 1000

// Compressed from the 2.1s sign-in sequence. On screen for 1.24s all in.
const DRAW_MS = 200
const GROW_MS = 360
const FADE_AT = 560
const MARK_AT = 640
const WORD_AT = 780
const HOLD_MS = 1000
const OUT_MS = 240

/** True at most once per genuinely cold launch. Records the decision as it goes. */
function isColdStart(): boolean {
  try {
    if (sessionStorage.getItem(SPLASH_SESSION_KEY)) return false
    sessionStorage.setItem(SPLASH_SESSION_KEY, '1')
    const last = Number(localStorage.getItem(SPLASH_LAST_KEY) ?? 0)
    if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return false
    localStorage.setItem(SPLASH_LAST_KEY, String(Date.now()))
    return true
  } catch {
    return false
  }
}

export default function ColdStartSplash() {
  const root = useRef<HTMLDivElement | null>(null)
  const hair = useRef<HTMLDivElement | null>(null)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const mark = useRef<HTMLDivElement | null>(null)
  const word = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = root.current
    if (!el || !isColdStart()) return

    let raf = 0
    let outTimer: ReturnType<typeof setTimeout>
    let killTimer: ReturnType<typeof setTimeout>

    const dismiss = () => {
      cancelAnimationFrame(raf)
      clearTimeout(outTimer)
      el.style.pointerEvents = 'none'
      el.style.opacity = '0'
      killTimer = setTimeout(() => { el.hidden = true }, OUT_MS)
    }

    el.hidden = false
    el.addEventListener('pointerdown', dismiss, { once: true })

    // No motion: the mark, briefly, then out. The brand moment survives; the
    // movement does not.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (mark.current) mark.current.style.opacity = '1'
      if (word.current) word.current.style.opacity = '1'
      outTimer = setTimeout(dismiss, 520)
      return () => { clearTimeout(outTimer); clearTimeout(killTimer); el.removeEventListener('pointerdown', dismiss) }
    }

    const start = performance.now()
    const frame = (now: number) => {
      const t = now - start

      if (hair.current) {
        hair.current.style.transform = `scaleX(${Math.min(1, t / DRAW_MS)})`
        hair.current.style.opacity = t > FADE_AT ? String(Math.max(0, 1 - (t - FADE_AT) / 200)) : '1'
      }

      const rising = t > DRAW_MS
      let k = rising ? Math.min(1, (t - DRAW_MS) / GROW_MS) : 0
      if (t > FADE_AT) k = Math.max(0, 1 - (t - FADE_AT) / 240)

      bars.current.forEach((b, i) => {
        if (!b) return
        b.style.opacity = rising ? '1' : '0'
        b.style.height = `${Math.max(2, PEAKS[i] * 1.5 * k)}px`
      })

      const m = t > MARK_AT ? Math.min(1, (t - MARK_AT) / 260) : 0
      const w = t > WORD_AT ? Math.min(1, (t - WORD_AT) / 220) : 0
      if (mark.current) {
        mark.current.style.opacity = String(m)
        mark.current.style.transform = `translate(-50%, calc(-50% - 4px)) scale(${0.72 + m * 0.28})`
      }
      if (word.current) {
        word.current.style.opacity = String(w)
        word.current.style.transform = `translateY(${(1 - w) * 6}px)`
      }

      if (t < HOLD_MS) raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    outTimer = setTimeout(dismiss, HOLD_MS)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(outTimer)
      clearTimeout(killTimer)
      el.removeEventListener('pointerdown', dismiss)
    }
  }, [])

  // Rendered hidden on both server and client, then revealed by the effect if
  // this turns out to be a cold start. Deciding during render instead would
  // make the server and client markup disagree.
  return (
    <div
      ref={root}
      hidden
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'var(--grad-ink)',
        opacity: 1, transition: `opacity ${OUT_MS}ms ease-out`,
      }}
    >
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 'min(78vw, 300px)', height: 92,
        transform: 'translate(-50%, -50%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2,
      }}>
        <div ref={hair} style={{
          position: 'absolute', left: 0, right: 0, top: '50%', height: 1,
          background: 'var(--ink-figure)', transformOrigin: 'left',
          transform: 'scaleX(0)', opacity: 0,
        }} />
        {PEAKS.map((_, i) => (
          <span
            key={i}
            ref={(el) => { bars.current[i] = el }}
            style={{
              flex: 1, height: 2, minHeight: 2, borderRadius: 99, opacity: 0,
              background: 'var(--ink-figure)',
              transition: 'height 90ms cubic-bezier(.22,1,.36,1)',
            }}
          />
        ))}
      </div>

      <div ref={mark} style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, calc(-50% - 4px)) scale(0.72)',
        width: 34, height: 34, borderRadius: 10, opacity: 0,
        background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
        boxShadow: '0 4px 12px rgb(111 142 107 / .40)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'opacity 160ms linear, transform 280ms var(--ease-brand)',
      }}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
          <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
        </svg>
      </div>

      <div ref={word} style={{
        position: 'absolute', top: 'calc(50% + 30px)', left: 0, right: 0,
        textAlign: 'center', color: 'var(--on-ink)', opacity: 0,
        fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em',
        transform: 'translateY(6px)',
        transition: 'opacity 180ms linear, transform 280ms var(--ease-brand)',
      }}>
        CoachVoice
      </div>
    </div>
  )
}
