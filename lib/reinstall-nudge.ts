/**
 * Getting the new Pindar icon onto iPhones that installed CoachVoice.
 *
 * Max, 2026-10-06: "Is there any way that we can update the old ones? … I
 * don't want to have to message every single athlete."
 *
 * Android and desktop Chrome re-read the web app manifest and update an
 * installed app's icon and name on their own (the icon URLs carry a version so
 * the change is visible to them — see app/manifest.ts). iOS does not, and
 * there is no API that makes it: Safari copies the icon, the name and the
 * launch images when "Add to Home Screen" is tapped and never looks again. The
 * only way to change them is to delete the app from the Home Screen and add it
 * again. So the app asks, once, in the app — instead of the coach messaging
 * every athlete.
 *
 * Who is asked: an installed iPhone/iPad app that was installed BEFORE the
 * rename. That is decided by the inline boot script in app/layout.tsx on the
 * first launch of this version, by whether the old app had ever written to
 * storage — it is the only code that runs before anything on a fresh install
 * writes there, so it is the only place the question can be answered. A fresh
 * install already has the new icon and is never asked.
 *
 * When: never while anything is still waiting to upload. Deleting a Home
 * Screen web app deletes its storage, and that storage is where an offline
 * check-in or recording waits for a signal (lib/checkin-queue.ts,
 * lib/recording-queue.ts). Asking someone to delete the app with a recording
 * still on the phone would lose it.
 */

/** Written once by the boot script: 'before-rename' | 'after-rename'. */
export const INSTALL_KEY = 'pindar_install'

/** 'done', or the epoch-ms time a "Later" snooze runs out. */
export const NUDGE_KEY = 'pindar_icon_nudge'

/** How long "Later" hides it for. */
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000

export interface NudgeInputs {
  /** An iPhone or iPad, including an iPad that reports itself as a Mac. */
  isIos: boolean
  /** Running from the Home Screen, not in a Safari tab. */
  standalone: boolean
  /** The INSTALL_KEY value, or null when storage had none. */
  install: string | null
  /** The NUDGE_KEY value, or null. */
  nudge: string | null
  /** Check-ins and recordings still waiting to upload on this device. */
  pending: number
  now: number
}

export function shouldShowReinstallNudge(i: NudgeInputs): boolean {
  if (!i.isIos || !i.standalone) return false
  if (i.install !== 'before-rename') return false
  if (i.pending > 0) return false
  if (i.nudge === 'done') return false
  const until = Number(i.nudge)
  if (Number.isFinite(until) && until > i.now) return false
  return true
}

/** iPhone, iPod, or an iPad (iPadOS 13+ reports "MacIntel" with touch). */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true
  return platform === 'MacIntel' && maxTouchPoints > 1
}
