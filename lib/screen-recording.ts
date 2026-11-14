// lib/screen-recording.ts
//
// Recording an online coaching call from the computer, straight into a
// session (Max, 2026-11-14: "screen record online and then take small snippets
// of the online meeting and put it into the app seamlessly").
//
// The coach shares the browser tab the call is in (Zoom, Meet or Teams on the
// web) with its sound, the app mixes in their microphone, and the result is
// uploaded to the session as video. The snippets are the session page's
// existing "moments": marked on that video afterwards, up to 60s each.
//
// What it cannot do, and the UI says so rather than failing:
//   · phones: no browser on iOS or Android can capture the screen;
//   · Safari and Firefox: they capture the picture but not the call's sound;
//   · FaceTime, WhatsApp, the Zoom desktop app: not in a tab, so not shared
//     with sound. Record those another way and use Add video.
//
// Pure decisions only, so tools/video-rig.mjs can run them.

import { MAX_VIDEO_BYTES } from '@/lib/video-preflight'

/**
 * mp4 first, as the project's audio rule does and for the same reason: an
 * iPhone cannot play WebM, and an athlete may watch this on one. Chrome
 * records mp4 from version 126; older Chrome and Edge fall back to WebM.
 */
export const SCREEN_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const

export function pickScreenMime(isTypeSupported: (t: string) => boolean): string {
  return SCREEN_MIME_CANDIDATES.find((t) => {
    try { return isTypeSupported(t) } catch { return false }
  }) ?? ''
}

/** The file extension that names the container the recorder actually used. */
export function extensionFor(actualMime: string): 'mp4' | 'webm' {
  return actualMime.toLowerCase().includes('mp4') ? 'mp4' : 'webm'
}

/**
 * Bitrates sized for a talking-heads call with shared slides, not for sport
 * footage: about 300MB an hour together.
 */
export const VIDEO_BITS_PER_SECOND = 600_000
export const AUDIO_BITS_PER_SECOND = 64_000

/**
 * A long call is saved in parts. The storage limit is MAX_VIDEO_BYTES per
 * file, so once a part reaches this size it is closed and a new one starts on
 * the same shared screen, without a gap the coach has to do anything about.
 * Headroom below the limit for the final chunk that lands after the decision.
 */
export const PART_LIMIT_BYTES = Math.floor(MAX_VIDEO_BYTES * 0.8)

export function shouldStartNewPart(bytesInPart: number): boolean {
  return bytesInPart >= PART_LIMIT_BYTES
}

/** "Call recording 14 Nov — part 2.mp4". Part numbers only when there are several. */
export function partFileName(dateLabel: string, part: number, total: number | null, ext: string): string {
  const base = `Call recording ${dateLabel}`
  return `${total === 1 ? base : `${base} — part ${part}`}.${ext}`
}

/** True where the browser can share a screen at all. Phones say no. */
export function canRecordScreen(nav: { mediaDevices?: { getDisplayMedia?: unknown } } | undefined): boolean {
  return typeof nav?.mediaDevices?.getDisplayMedia === 'function'
}
