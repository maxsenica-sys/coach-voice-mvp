// lib/video-preflight.ts
//
// Whether a clip can be uploaded, and whether the coach's own laptop will be
// able to play it back afterwards. Decided BEFORE a byte leaves the phone.
//
// ── The two failures this exists for ──────────────────────────────────────
//
// No size limit was enforced on the path that runs. The 500MB guard lives in a
// FormData branch of app/api/sessions/[id]/videos/route.ts that has no caller;
// the signed-upload path had none in the route, the URL minter or the client.
// An iPhone shooting 4K60 produces roughly 400MB a minute, so a two-minute clip
// is 800MB — several minutes of uploading on a pitch, and the storage bucket
// accepted it.
//
// And an iPhone records HEVC (H.265) by default under "High Efficiency". Safari
// plays it; Chrome on a desktop generally does not. So a coach uploads a clip
// from their phone, it succeeds, and the video is a black rectangle when they
// open it on a laptop later — with nothing anywhere saying why. That reads as
// "the app is broken", and no error was ever raised because nothing failed.
//
// Pure and synchronous apart from the codec probe, and in lib/ rather than a
// component, so the rigs can reach it — CLAUDE.md's rule about computations
// whose correctness is not obvious from reading them.

/** Matches the bucket limit set in migration 023. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024

/** Above this, an upload on a pitch is long enough to warn about. */
const SLOW_UPLOAD_BYTES = 80 * 1024 * 1024

export type VideoVerdict =
  /** Do not upload. The reason is written for a coach, not a developer. */
  | { ok: false; reason: string }
  /** Upload, but say something first. */
  | { ok: true; warning: string }
  | { ok: true; warning: null }

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/**
 * Can THIS browser play this file back?
 *
 * `canPlayType` returns '', 'maybe' or 'probably'. Empty means no, and that is
 * the case worth catching: an HEVC clip in Chrome. A 'maybe' is not a problem —
 * browsers are conservative about codec strings they cannot fully inspect.
 *
 * This asks the CURRENT browser, which is the coach's own. It cannot know what
 * their laptop will say later, so the HEVC warning below is based on the type
 * string rather than on this probe alone.
 */
export function browserCanPlay(mimeType: string): boolean {
  if (typeof document === 'undefined') return true
  if (!mimeType) return true
  try {
    const el = document.createElement('video')
    return el.canPlayType(mimeType) !== ''
  } catch {
    return true
  }
}

/** True for the container/codec combinations Apple devices produce by default. */
export function looksLikeHevc(file: { type?: string; name?: string }): boolean {
  const type = (file.type ?? '').toLowerCase()
  const name = (file.name ?? '').toLowerCase()
  if (/hevc|h\.?265|hvc1|hev1/.test(type)) return true
  // A .mov from an iPhone is HEVC whenever the camera is set to High Efficiency,
  // and the type string does not say so. Worth a word, not a refusal — a .mov
  // can equally be H.264 and play everywhere.
  if (name.endsWith('.mov')) return true
  return false
}

export function preflightVideo(file: { size: number; type?: string; name?: string }): VideoVerdict {
  if (!file.size) {
    return { ok: false, reason: 'That file looks empty. Try picking it again.' }
  }

  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      reason:
        `That clip is ${formatBytes(file.size)}, over the ${formatBytes(MAX_VIDEO_BYTES)} limit. ` +
        `Trim it, or record a shorter one — on an iPhone, Settings › Camera › Record Video ` +
        `at 1080p/30 makes clips roughly a quarter of the size with no visible difference on a phone.`,
    }
  }

  const type = (file.type ?? '').toLowerCase()
  if (type && !type.startsWith('video/')) {
    return { ok: false, reason: 'That is not a video file. Pick a clip to upload.' }
  }

  if (looksLikeHevc(file) && !browserCanPlay(file.type ?? '')) {
    return {
      ok: true,
      warning:
        'This clip is in Apple’s High Efficiency format. It will upload, but it may not play ' +
        'on a Windows PC or in Chrome. Settings › Camera › Formats › Most Compatible ' +
        'records clips that play everywhere.',
    }
  }

  if (file.size > SLOW_UPLOAD_BYTES) {
    return {
      ok: true,
      warning: `That is a ${formatBytes(file.size)} clip — it may take a few minutes on mobile data.`,
    }
  }

  return { ok: true, warning: null }
}
