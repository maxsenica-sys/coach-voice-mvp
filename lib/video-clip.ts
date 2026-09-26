// lib/video-clip.ts
//
// The arithmetic and the access rule behind three video features: a moment
// clipped onto a session's takeaway, two videos compared side by side, and a
// clip an athlete sends their coach.
//
// Pure, and in lib/ rather than a component, so tools/video-rig.mjs can import
// the real thing — CLAUDE.md's rule for computations whose correctness is not
// obvious from reading them. Every number here decides what a child is shown:
// a range one second off opens the wrong moment under the coach's drawing, and
// a visibility rule one clause short shows one athlete another athlete's video.
//
// ── Why a moment is data, not a new file ──────────────────────────────────
//
// A moment is (video, start, end). Nothing is re-encoded or copied: the player
// opens the original with the coach's strokes and stops at `end`. So a moment
// can never drift from the video it cuts, costs no storage, and disappears with
// its video (the foreign key cascades) instead of outliving it as an orphan.

import { preflightVideo, type VideoVerdict } from '@/lib/video-preflight'

/** Longest moment a coach can clip. Mirrored by a CHECK in migration 032 — the rig compares them. */
export const MAX_CLIP_SECONDS = 60
/** Shorter than this is not a moment anyone can watch; it is a mis-tap. */
export const MIN_CLIP_SECONDS = 0.5
/** "Around now": this many seconds either side of the playhead. */
export const DEFAULT_MOMENT_PAD = 3
/** Longest clip an athlete can send. Max, 2026-09-26: "a short video (e.g. ≤60s)". */
export const MAX_ATHLETE_CLIP_SECONDS = 60
/**
 * Slack on the duration check. A browser reports a 60-second phone clip as
 * 60.04s or 60.3s depending on container padding; refusing that would refuse
 * exactly the clip the limit was written to allow.
 */
export const DURATION_TOLERANCE_S = 0.5
/** The widest offset the compare view accepts, either way. */
export const MAX_COMPARE_OFFSET_S = 600

/** One decimal: enough to land on a frame boundary's neighbourhood, and what the column stores. */
export function roundTenth(n: number): number {
  return Math.round(n * 10) / 10
}

export type ClipRange = { start_s: number; end_s: number }
export type ClipVerdict = ({ ok: true } & ClipRange) | { ok: false; reason: string }

/**
 * Is this a range a coach may save?
 *
 * `durationS` is the video's length as the browser reported it, or null when
 * it is not known (the server has no decoder; it is told the duration by the
 * client and checks against that when given). Unknown duration still enforces
 * everything else.
 *
 * Returns the range rounded to a tenth, which is what gets stored — so the
 * checks run against the value that will actually be saved, not a
 * higher-precision one that rounds over a limit afterwards.
 */
export function validateClipRange(range: { start_s: unknown; end_s: unknown }, durationS: number | null = null): ClipVerdict {
  const start = typeof range.start_s === 'number' ? range.start_s : Number.NaN
  const end = typeof range.end_s === 'number' ? range.end_s : Number.NaN
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, reason: 'Mark a start and an end first.' }
  }
  const s = roundTenth(start)
  const e = roundTenth(end)
  if (s < 0) return { ok: false, reason: 'The start is before the video begins.' }
  if (e <= s) return { ok: false, reason: 'The end has to come after the start.' }
  const len = roundTenth(e - s)
  if (len < MIN_CLIP_SECONDS) {
    return { ok: false, reason: `A moment has to be at least ${MIN_CLIP_SECONDS} seconds long.` }
  }
  if (len > MAX_CLIP_SECONDS) {
    return { ok: false, reason: `A moment can be at most ${MAX_CLIP_SECONDS} seconds. This one is ${formatClipTime(len)}.` }
  }
  if (durationS !== null) {
    if (!Number.isFinite(durationS) || durationS <= 0) {
      return { ok: false, reason: 'The video has not loaded yet. Wait a moment and try again.' }
    }
    if (e > roundTenth(durationS) + 0.05) {
      return { ok: false, reason: 'The end is past the end of the video.' }
    }
  }
  return { ok: true, start_s: s, end_s: e }
}

/**
 * A single timestamp widened into a moment: `pad` seconds either side, kept
 * inside the video. When the playhead is near an edge the window slides rather
 * than shrinks, so "around now" at 0:01 is still six seconds long.
 */
export function momentAround(t: number, durationS: number, pad = DEFAULT_MOMENT_PAD): ClipRange {
  const d = Number.isFinite(durationS) && durationS > 0 ? durationS : t + pad
  const width = Math.min(pad * 2, d, MAX_CLIP_SECONDS)
  let start = Math.max(0, t - pad)
  let end = start + width
  if (end > d) {
    end = d
    start = Math.max(0, end - width)
  }
  // Floor the end and ceil the start to the tenth, so rounding can only ever
  // shrink the window back inside [0, duration] — never push it past either.
  return { start_s: Math.ceil(start * 10) / 10, end_s: Math.floor(end * 10) / 10 }
}

/** "0:07.5", "1:02", "12:00". Tenths only when there are any. */
export function formatClipTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const tenths = Math.round(seconds * 10)
  const whole = Math.floor(tenths / 10)
  const frac = tenths % 10
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, '0')}${frac ? `.${frac}` : ''}`
}

// ── Compare ────────────────────────────────────────────────────────────────
//
// Two videos, one clock. The coach scrubs A; B follows at A + offset. The
// offset is how the coach lines up "the moment the foot plants" in a clip
// shot a month apart, where one recording started three seconds earlier.

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0
  return roundTenth(Math.max(-MAX_COMPARE_OFFSET_S, Math.min(MAX_COMPARE_OFFSET_S, offset)))
}

/**
 * Where B should be when A is at `aTime`. Clamped into B, because a seek past
 * either end of a video is silently ignored by the browser — the two players
 * would stop being in step with nothing on screen saying so.
 */
export function compareTimeForB(aTime: number, offset: number, bDuration: number): number {
  const t = aTime + offset
  if (!Number.isFinite(t)) return 0
  if (!Number.isFinite(bDuration) || bDuration <= 0) return Math.max(0, t)
  return Math.max(0, Math.min(t, bDuration))
}

/** The offset that puts the two current frames together — "line them up here". */
export function offsetFromPositions(aTime: number, bTime: number): number {
  return clampOffset(bTime - aTime)
}

/** How far B may drift from where it should be before a correcting seek. Seeks are not free. */
export const COMPARE_DRIFT_S = 0.15

export function needsResync(aTime: number, bTime: number, offset: number, bDuration: number): boolean {
  return Math.abs(bTime - compareTimeForB(aTime, offset, bDuration)) > COMPARE_DRIFT_S
}

// ── The athlete's clip ─────────────────────────────────────────────────────

/**
 * Before a byte leaves the athlete's phone. The size and format rules are the
 * coach's (lib/video-preflight.ts, 500MB, the bucket's own limit) — a clip is
 * the same file whoever sends it — plus the length Max set for athletes.
 *
 * `durationS` null means the browser could not read the clip's length. That is
 * refused rather than waved through: the length is the one limit this adds,
 * and a clip we cannot measure is a clip we cannot hold to it.
 */
export function athleteClipVerdict(
  file: { size: number; type?: string; name?: string },
  durationS: number | null,
): VideoVerdict {
  const base = preflightVideo(file)
  if (!base.ok) return base
  if (durationS === null || !Number.isFinite(durationS) || durationS <= 0) {
    return { ok: false, reason: 'That clip could not be read on this phone. Try a different one, or record it again.' }
  }
  if (durationS > MAX_ATHLETE_CLIP_SECONDS + DURATION_TOLERANCE_S) {
    return {
      ok: false,
      reason: `That clip is ${formatClipTime(durationS)} long. Clips for your coach can be up to ${MAX_ATHLETE_CLIP_SECONDS} seconds — trim it in your Photos app first.`,
    }
  }
  return base
}

/** The server's half of the same length rule, on the duration the client reported. */
export function athleteDurationOk(durationS: unknown): boolean {
  return typeof durationS === 'number' && Number.isFinite(durationS) && durationS > 0 &&
    durationS <= MAX_ATHLETE_CLIP_SECONDS + DURATION_TOLERANCE_S
}

const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'm4v'] as const

/**
 * The extension a stored clip gets. From an allow-list, never raw from the
 * file name: a name is whatever the phone called it, and `clip.mp4/../../x`
 * or an extension-less name must not become part of a storage path.
 */
export function safeVideoExt(fileName: string | null | undefined, mimeType: string | null | undefined): string {
  const fromName = (fileName ?? '').toLowerCase().match(/\.([a-z0-9]{2,4})$/)?.[1]
  if (fromName && (VIDEO_EXTS as readonly string[]).includes(fromName)) return fromName
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.includes('quicktime')) return 'mov'
  if (mime.includes('webm')) return 'webm'
  return 'mp4'
}

/**
 * Where an athlete's clip lives in the private `session-videos` bucket.
 *
 * The first folder is the caller's own auth uid — the same convention every
 * other upload path in this bucket and in messages-media follows — then a
 * literal `athlete` segment so a coach's `${coachId}/${sessionId}/…` prefix
 * can never collide with it, then the athlete row. Built only on the server,
 * from the verified user id; the client never names its own path.
 */
export function athleteClipPath(userId: string, athleteId: string, ext: string, now: number): string {
  return `${userId}/athlete/${athleteId}/${now}.${ext}`
}

/**
 * Does a client-supplied path sit inside this athlete's own folder? The
 * register step receives the path back from the browser, so it has to be
 * re-checked — otherwise "register my upload" means "register any object".
 */
export function isAthleteClipPath(path: unknown, userId: string, athleteId: string): boolean {
  if (typeof path !== 'string') return false
  const prefix = `${userId}/athlete/${athleteId}/`
  if (!path.startsWith(prefix)) return false
  const rest = path.slice(prefix.length)
  return /^\d+\.(mp4|mov|webm|m4v)$/.test(rest)
}

// ── Who may see a video ────────────────────────────────────────────────────

export type VisibilitySession = { athlete_id: string; shared_with_athlete: boolean | null } | null
export type VisibilityVideo = {
  shared_with_athlete: boolean | null
  uploaded_by_role?: string | null
  uploaded_by?: string | null
  athlete_id?: string | null
}

/**
 * May this athlete viewer see this video at all?
 *
 * Exactly two ways in, and no third:
 *
 *  1. It is their OWN upload: uploaded by an athlete, by this user, into an
 *     athlete row this user holds.
 *  2. The coach sent it to them: the session is theirs, the session is shared,
 *     AND the video itself is shared.
 *
 * Squad sessions and one-recording-several-athletes sessions (group_id,
 * shared_recording_id) are saved as one session row PER athlete, and a video
 * is attached to one row. So rule 2 already means "shared to this athlete
 * individually": a video on Kai's row is never reachable from Mia's row, even
 * though both rows came from one squad recording. Nothing here reads group_id
 * to widen access, and nothing should — a squad video shows other children.
 *
 * `athleteIds` are the athlete rows whose athlete_user_id is the caller,
 * looked up by the route on the server; never taken from the request.
 */
export function athleteMayViewVideo(
  video: VisibilityVideo,
  session: VisibilitySession,
  viewer: { userId: string; athleteIds: readonly string[] },
): boolean {
  if (
    video.uploaded_by_role === 'athlete' &&
    !!video.uploaded_by && video.uploaded_by === viewer.userId &&
    !!video.athlete_id && viewer.athleteIds.includes(video.athlete_id)
  ) {
    return true
  }
  if (!session) return false
  if (!viewer.athleteIds.includes(session.athlete_id)) return false
  if (session.shared_with_athlete !== true) return false
  return video.shared_with_athlete === true
}

/**
 * The coach's drawings reach the athlete only once the coach sends the video
 * back. On an athlete's own upload the coach may be half-way through marking
 * it up; those strokes are the coach's draft, not a reply.
 */
export function athleteSeesAnnotations(video: VisibilityVideo): boolean {
  return video.shared_with_athlete === true
}

/** What the athlete reads under their own clip. */
export function athleteClipStatus(video: VisibilityVideo & { annotations?: unknown }): 'waiting' | 'replied' {
  return video.shared_with_athlete === true ? 'replied' : 'waiting'
}
