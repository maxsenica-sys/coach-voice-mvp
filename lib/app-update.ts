/**
 * New versions reaching an installed iPhone without deleting the app.
 *
 * Max, 2026-10-09: "it's becoming increasingly frustrating that we have to
 * keep constantly deleting the app … we need to fix that immediately."
 *
 * Why it happened: an app on the Home Screen is never closed. iOS freezes it
 * when you switch away and thaws the same page when you come back, still
 * running the JavaScript it was opened with — for days, if the phone has the
 * memory. Nothing in the app ever asked whether a newer version had shipped,
 * so a deploy only reached a phone when iOS happened to kill the app, and the
 * one reliable way to make that happen was to delete it.
 *
 * What happens now (app/components/UpdateWatcher.tsx): the app asks which
 * version is live whenever it comes back to the screen and every few minutes
 * while it is open, and when the answer differs from what it is running it
 * reloads — at a moment when a reload cannot lose anything:
 *
 *   - coming back after at least MIN_AWAY_MS away, with nothing in progress
 *     on screen (the "in progress" test is BUSY_SELECTOR and typed text);
 *   - or the next time the person moves to another page, which is when the
 *     screen they were on is thrown away anyway.
 *
 * Never mid-recording, never with a sheet open, never over typed text.
 *
 * The live version is read from the web app manifest, which is public by
 * definition (the browser fetches it with no session), already carries nothing
 * private, and is built in the same build as the code — so it names the
 * deployed version without adding a route to the app's surface.
 *
 * What this cannot fix: the Home Screen icon, its name and the launch image.
 * iOS copies those once, when "Add to Home Screen" is tapped, and has no API to
 * change them — lib/reinstall-nudge.ts. Everything inside the app updates.
 */

/** The manifest member that carries the build's version. Browsers ignore
 *  members they do not know, so it changes nothing about the install. */
export const VERSION_FIELD = 'pindar_version'

/** Where the live version is read from. */
export const VERSION_URL = '/manifest.webmanifest'

/** How often to ask while the app stays on screen. */
export const CHECK_EVERY_MS = 10 * 60 * 1000

/** Away for less than this (a glance at a text message) and coming back does
 *  not reload; the update waits for the next page change or a longer absence. */
export const MIN_AWAY_MS = 60 * 1000

/** If a reload for a version did not land it (a CDN still serving the old
 *  page), do not try again for that version within this window. Without it a
 *  half-propagated deploy would reload the app in a loop. */
export const RETRY_AFTER_MS = 10 * 60 * 1000

/** Where the last attempt is remembered: `${version}|${epochMs}`. */
export const ATTEMPT_KEY = 'pindar_update_attempt'

/**
 * Anything on screen that a reload would destroy. Each entry is how a real
 * screen in this app says so; tools/update-rig.mjs checks every one still
 * appears in the source it was taken from, so a recorder whose markup changes
 * turns the rig red instead of quietly becoming reloadable.
 *
 *   [role="dialog"], [aria-modal="true"], dialog[open]
 *       — any sheet, including QuickSessionModal, the coach's session recorder
 *   .recording-dot                 — the athlete's voice note, while recording
 *   [aria-label="Stop recording"]  — a voice message, while recording
 *   audio[src^="blob:"], video[src^="blob:"]
 *       — a recorded clip on this phone that has not been sent yet
 */
export const BUSY_SELECTOR = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog[open]',
  '.recording-dot',
  '[aria-label="Stop recording"]',
  'audio[src^="blob:"]',
  'video[src^="blob:"]',
].join(', ')

/** Fields whose content would be lost. Hidden, file, checkbox-like and button
 *  inputs hold nothing a person typed. */
export const TEXT_ENTRY_SELECTOR =
  'textarea, input:not([type]), input[type="text"], input[type="email"], input[type="search"], input[type="tel"], input[type="url"], input[type="number"], input[type="password"], [contenteditable="true"]'

/** The version in a fetched manifest, or null if it carries none. */
export function servedVersion(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object') return null
  const v = (manifest as Record<string, unknown>)[VERSION_FIELD]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export type Moment =
  /** The app came back to the screen. */
  | 'resume'
  /** The person moved to another page. */
  | 'navigate'
  /** A periodic check while the app stayed on screen. */
  | 'interval'

export interface UpdateInputs {
  /** The version this page was built with. */
  running: string
  /** The version the server says is live, or null if it could not be read. */
  served: string | null
  moment: Moment
  /** How long the app was off screen before this resume, ms. */
  awayMs: number
  /** Something on screen would be lost: BUSY_SELECTOR matched, or typed text. */
  busy: boolean
  /** The ATTEMPT_KEY value, or null. */
  lastAttempt: string | null
  now: number
}

/**
 * 'reload' now; 'wait' — a newer version is live, reload at the next safe
 * moment; 'none' — nothing to do.
 */
export function updateDecision(i: UpdateInputs): 'reload' | 'wait' | 'none' {
  if (!i.served || !i.running || i.served === i.running) return 'none'

  // Already tried to reach this version recently and are still not on it.
  if (i.lastAttempt) {
    const bar = i.lastAttempt.lastIndexOf('|')
    const version = bar > 0 ? i.lastAttempt.slice(0, bar) : ''
    const at = Number(i.lastAttempt.slice(bar + 1))
    if (version === i.served && Number.isFinite(at) && i.now - at >= 0 && i.now - at < RETRY_AFTER_MS) {
      return 'none'
    }
  }

  if (i.busy) return 'wait'
  if (i.moment === 'navigate') return 'reload'
  if (i.moment === 'resume' && i.awayMs >= MIN_AWAY_MS) return 'reload'
  return 'wait'
}
