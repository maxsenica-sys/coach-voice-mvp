'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import {
  ATTEMPT_KEY, BUSY_SELECTOR, CHECK_EVERY_MS, TEXT_ENTRY_SELECTOR, VERSION_URL,
  servedVersion, updateDecision, type Moment,
} from '@/lib/app-update'

/** The version this bundle was built as; next.config.ts sets it. */
const RUNNING = process.env.NEXT_PUBLIC_APP_VERSION ?? ''

/** Something on screen that a reload would lose. */
function busyNow(): boolean {
  if (document.querySelector(BUSY_SELECTOR)) return true
  for (const el of document.querySelectorAll<HTMLElement>(TEXT_ENTRY_SELECTOR)) {
    const text = el.isContentEditable ? el.textContent : (el as HTMLInputElement).value
    if (text?.trim()) return true
  }
  return false
}

/**
 * Ask which version is live and act on the answer. Returns whether a newer
 * version is still waiting for a safe moment. Offline or a failed request
 * changes nothing: the next check asks again.
 */
async function checkForUpdate(moment: Moment, awayMs: number, wasPending: boolean): Promise<boolean> {
  let served: string | null
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' })
    if (!res.ok) return wasPending
    served = servedVersion(await res.json())
  } catch { return wasPending }
  let lastAttempt: string | null = null
  try { lastAttempt = localStorage.getItem(ATTEMPT_KEY) } catch { /* storage blocked */ }
  const decision = updateDecision({ running: RUNNING, served, moment, awayMs, busy: busyNow(), lastAttempt, now: Date.now() })
  if (decision === 'reload' && served) {
    try { localStorage.setItem(ATTEMPT_KEY, `${served}|${Date.now()}`) } catch { /* reload anyway */ }
    location.reload()
  }
  return decision !== 'none'
}

/**
 * Brings a running app up to the deployed version without anyone deleting it
 * from their Home Screen. Renders nothing. When and why it reloads is
 * lib/app-update.ts.
 */
export default function UpdateWatcher() {
  const pathname = usePathname()
  const lastPath = useRef(pathname)
  // A newer version is known to be live and is waiting for a safe moment.
  const pending = useRef(false)

  useEffect(() => {
    if (!RUNNING || RUNNING === 'dev') return
    let hiddenAt: number | null = null
    const run = (moment: Moment, awayMs = 0) => {
      void checkForUpdate(moment, awayMs, pending.current).then((p) => { pending.current = p })
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt
      hiddenAt = null
      run('resume', away)
    }
    // A page restored from the back/forward cache is the same frozen page.
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) run('resume', Infinity) }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run('interval')
    }, CHECK_EVERY_MS)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      clearInterval(timer)
    }
  }, [])

  // Moving to another page throws the old screen away anyway, so it is always
  // a safe moment. The URL has already changed; a reload loads it afresh.
  useEffect(() => {
    if (pathname === lastPath.current) return
    lastPath.current = pathname
    if (pending.current) {
      void checkForUpdate('navigate', 0, true).then((p) => { pending.current = p })
    }
  }, [pathname])

  return null
}
