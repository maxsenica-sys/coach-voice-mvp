// lib/boot-shell.ts
//
// What is left of the cold-start splash in JavaScript: when to take it down.
//
// ── What used to be here ──────────────────────────────────────────────────
//
// app/components/ColdStartSplash.tsx — 330 lines of React that drew the whole
// opening sequence in a requestAnimationFrame loop, and is deleted. It could
// not work, for a reason no amount of tuning inside it would have fixed:
// /dashboard and /athlete are client components, so their server HTML is a
// Suspense bail-out and nothing they render exists until roughly a megabyte of
// JavaScript has downloaded, parsed and hydrated. The sequence it drew was
// timed from the start of the navigation. On the slow launch it was built for,
// its own clock said the montage of fourteen sports was over before the code
// that draws them was alive; on a fast one, its ready-handler skipped the
// montage deliberately. That is why Max saw the people disappear. The full
// account is in lib/montage-schedule.ts.
//
// The sequence is now CSS in the boot shell in app/layout.tsx. It paints with
// the document and there is nothing left that can be late for it. So the only
// thing JavaScript still decides is when the app has something to show — which
// is a fact only the pages know, and it is the one thing they were always
// right to own.

/** Set for the life of the webview. Cleared only when the app is really closed.
 *  Consumed by the inline script in app/layout.tsx and claimed by the sign-in
 *  page, so someone who has just watched the sign-in sequence does not land on
 *  the dashboard and immediately watch a compressed version of the same thing. */
export const SPLASH_SESSION_KEY = 'cv_splash_session'

type BootWindow = Window & { __cvBootLeave?: (force?: boolean) => void }

let announced = false

/**
 * A page calls this when its first real data has landed.
 *
 * It asks the shell to leave; the shell decides when, because the floor that
 * keeps the montage from being cut short lives with the animation rather than
 * with each caller. `__cvBootLeave` is defined by the inline script in the
 * document head, before anything paints, so by the time any page can call this
 * it either exists or this launch was never a cold start — in which case there
 * is nothing on screen to dismiss and doing nothing is correct.
 */
export function markAppReady(): void {
  if (announced) return
  announced = true
  if (typeof window === 'undefined') return
  const leave = (window as BootWindow).__cvBootLeave
  if (typeof leave === 'function') leave()
}
